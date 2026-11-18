using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Domain.Services.Ai;
using Domain.Services.Styling;
using Infrastructure.Ai;
using Infrastructure.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace InfrastructureTests;

/// <summary>
/// Request building and response parsing against a fake HttpMessageHandler. Nothing here talks to the real service:
/// the wire format is the documented OpenAI one and still has to be confirmed against the real API and model ids.
/// </summary>
public class OpenAiProviderTests
{
    private const string TextModel = "test-text-model";
    private const string ImageModel = "test-image-model";

    private sealed class FakeHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public List<(HttpRequestMessage Request, string Body, string? ContentType)> Calls { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var content = request.Content is null ? "" : Encoding.Latin1.GetString(await request.Content.ReadAsByteArrayAsync(cancellationToken));
            Calls.Add((request, content, request.Content?.Headers.ContentType?.MediaType));
            return new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        }
    }

    private static AiOptions Options(bool enabled = true, string? key = "sk-test", string? text = TextModel, string? image = ImageModel) =>
        new() { Enabled = enabled, ApiKey = key, TextModel = text, ImageModel = image, BaseUrl = "https://ai.test/", TimeoutSeconds = 5 };

    private static (OpenAiProvider Provider, FakeHandler Handler) Create(string body, HttpStatusCode status = HttpStatusCode.OK, AiOptions? options = null)
    {
        var handler = new FakeHandler(status, body);
        return (new OpenAiProvider(new HttpClient(handler), Fixtures.Monitor(options ?? Options()), NullLogger<OpenAiProvider>.Instance), handler);
    }

    private static string Chat(string content, string finishReason = "stop") => new JsonObject
    {
        ["choices"] = new JsonArray(new JsonObject
        {
            ["finish_reason"] = finishReason,
            ["message"] = new JsonObject { ["role"] = "assistant", ["content"] = content, ["refusal"] = null },
        }),
        ["usage"] = new JsonObject { ["total_tokens"] = 123 },
    }.ToJsonString();

    private static string Image(byte[] bytes) =>
        new JsonObject { ["data"] = new JsonArray(new JsonObject { ["b64_json"] = Convert.ToBase64String(bytes) }) }.ToJsonString();

    private static readonly byte[] Webp = [.. "RIFF"u8, 0, 0, 0, 0, .. "WEBP"u8, 1, 2, 3];
    private static readonly ImageInput Photo = new([0xFF, 0xD8, 0xFF, 0x01], "image/jpeg");

    // ── Text: request ─────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Generate_PostsStrictJsonSchemaChatRequest_WithModelAndKeyFromConfig()
    {
        var (provider, handler) = Create(Chat("""{"suggestions":[],"refusal":null}"""));

        var output = await provider.GenerateAsync(new StylistPrompt(JobKind.StylistOutfit, """{"candidates":[]}""", "tr"), default);

        var call = Assert.Single(handler.Calls);
        Assert.Equal(HttpMethod.Post, call.Request.Method);
        Assert.Equal("https://ai.test/v1/chat/completions", call.Request.RequestUri!.ToString());
        Assert.Equal("Bearer", call.Request.Headers.Authorization!.Scheme);
        Assert.Equal("sk-test", call.Request.Headers.Authorization.Parameter);

        var body = JsonNode.Parse(call.Body)!;
        Assert.Equal(TextModel, body["model"]!.GetValue<string>());
        Assert.Equal("system", body["messages"]![0]!["role"]!.GetValue<string>());
        Assert.Equal("user", body["messages"]![1]!["role"]!.GetValue<string>());
        Assert.Equal("""{"candidates":[]}""", body["messages"]![1]!["content"]![0]!["text"]!.GetValue<string>());
        Assert.Equal("json_schema", body["response_format"]!["type"]!.GetValue<string>());
        Assert.Equal("outfit", body["response_format"]!["json_schema"]!["name"]!.GetValue<string>());
        Assert.True(body["response_format"]!["json_schema"]!["strict"]!.GetValue<bool>());
        Assert.True(JsonNode.DeepEquals(AiSchemas.OutfitSchema(), body["response_format"]!["json_schema"]!["schema"]));
        Assert.Equal("""{"suggestions":[],"refusal":null}""", output);
    }

    [Theory]
    [InlineData(JobKind.StylistOutfit, "outfit")]
    [InlineData(JobKind.StylistWeek, "week_plan")]
    [InlineData(JobKind.StylistPack, "packing")]
    public async Task Generate_UsesTheSchemaOfTheJobKind(JobKind kind, string schemaName)
    {
        var (provider, handler) = Create(Chat("{}"));

        await provider.GenerateAsync(new StylistPrompt(kind, "{}"), default);

        Assert.Equal(schemaName, JsonNode.Parse(handler.Calls[0].Body)!["response_format"]!["json_schema"]!["name"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("tr", "Turkish", "language code: tr")]
    [InlineData("en", "English", "language code: en")]
    [InlineData("de", "Turkish", "language code: tr")] // unsupported -> Turkish
    public async Task Generate_TellsTheModelWhichLanguageToWriteIn(string language, string name, string code)
    {
        var (provider, handler) = Create(Chat("{}"));

        await provider.GenerateAsync(new StylistPrompt(JobKind.StylistOutfit, "{}", language), default);

        var system = JsonNode.Parse(handler.Calls[0].Body)!["messages"]![0]!["content"]!.GetValue<string>();
        Assert.Contains($"in {name}", system);
        Assert.Contains(code, system);
    }

    [Theory]
    [InlineData(JobKind.StylistOutfit)]
    [InlineData(JobKind.StylistWeek)]
    [InlineData(JobKind.StylistPack)]
    public void StylistPrompt_ForbidsBodyTalkAndInventedPieces_AndCarriesTheLanguage(JobKind kind)
    {
        var prompt = OpenAiPrompts.Stylist(kind, "en");

        Assert.Contains("Never comment on body shape, weight or health", prompt);
        Assert.Contains("ONLY wardrobe pieces", prompt);
        Assert.EndsWith("in English (language code: en).", prompt);
    }

    [Fact]
    public void VisionPrompts_CarryTheLanguage()
    {
        Assert.Contains("in English", OpenAiPrompts.GarmentVision("en"));
        Assert.Contains("in Turkish", OpenAiPrompts.GarmentVision(null));
        Assert.Contains("in English", OpenAiPrompts.OutfitPieces("en-GB"));
    }

    [Fact]
    public async Task Describe_SendsTheImageAsDataUrl_AndParsesTheGarment()
    {
        var (provider, handler) = Create(Chat("""
            {"isGarment":true,"garmentCount":1,"garment":{"name":"Navy blazer","category":"outerwear","colorIds":["navy","unicorn"],"fabric":"wool",
             "seasons":["autumn","monsoon"],"confidence":{"category":0.93,"colorIds":0.8,"fabric":0.4,"seasons":0.7}}}
            """));

        var suggestion = await provider.DescribeAsync(Photo, "en", default);

        var body = JsonNode.Parse(handler.Calls[0].Body)!;
        var image = body["messages"]![1]!["content"]![1]!;
        Assert.Equal("image_url", image["type"]!.GetValue<string>());
        Assert.Equal($"data:image/jpeg;base64,{Convert.ToBase64String(Photo.Data)}", image["image_url"]!["url"]!.GetValue<string>());
        Assert.Equal("garment_draft", body["response_format"]!["json_schema"]!["name"]!.GetValue<string>());
        Assert.Contains("in English", body["messages"]![0]!["content"]!.GetValue<string>());

        Assert.Equal(ItemCategoryHint.Outerwear, suggestion.Category);
        Assert.Equal(["navy", "unicorn"], suggestion.ColorIds); // passed on as-is: the guard drops what is not in the dictionary
        Assert.Equal("wool", suggestion.Fabric);
        Assert.Equal(2, suggestion.Seasons.Count);
        Assert.False(Enum.IsDefined(suggestion.Seasons[1]));
        Assert.Equal(0.4, suggestion.Confidence["fabric"]);
        Assert.Equal("Navy blazer", suggestion.Name);
        Assert.True(suggestion.IsGarment);

        var fields = GarmentVisionGuard.Apply(suggestion, 0.7);
        Assert.Equal(["navy"], fields.ColorIds);
        Assert.Equal(["colorIds", "fabric", "seasons"], fields.FlaggedFields);
    }

    [Fact]
    public async Task Describe_NoGarment_IsReported()
    {
        var (provider, _) = Create(Chat("""{"isGarment":false,"garmentCount":0,"garment":{"name":null,"category":null,"colorIds":[],"fabric":null,"seasons":[],"confidence":{"category":0,"colorIds":0,"fabric":0,"seasons":0}}}"""));

        Assert.False(GarmentVisionGuard.HasGarment(await provider.DescribeAsync(Photo, "tr", default)));
    }

    [Fact]
    public async Task DetectPieces_ParsesEveryPiece()
    {
        var (provider, handler) = Create(Chat("""
            {"pieces":[{"name":"Beyaz gömlek","category":"top","colorIds":["white"],"fabric":"cotton","seasons":["spring"],"confidence":{"category":0.9,"colorIds":0.9,"fabric":0.9,"seasons":0.9}},
                       {"name":null,"category":"shoes","colorIds":["black"],"fabric":null,"seasons":["autumn"],"confidence":{"category":0.8,"colorIds":0.8,"fabric":0,"seasons":0.8}}]}
            """));

        var pieces = await provider.DetectPiecesAsync(Photo, "tr", default);

        Assert.Equal([ItemCategoryHint.Top, ItemCategoryHint.Shoes], pieces.Select(p => p.Category));
        Assert.Equal("outfit_pieces", JsonNode.Parse(handler.Calls[0].Body)!["response_format"]!["json_schema"]!["name"]!.GetValue<string>());
    }

    [Fact]
    public async Task Analyze_ParsesSeasonType_AndNeverTakesColoursFromTheModel()
    {
        var (provider, handler) = Create(Chat("""{"facesDetected":1,"seasonTypeId":"warm-autumn","confidence":0.82,"refusal":null}"""));

        var analysis = await provider.AnalyzeAsync(Photo, default);

        Assert.Equal("warm-autumn", analysis.SeasonTypeId);
        Assert.Equal(1, analysis.FacesDetected);
        Assert.Equal(0.82, analysis.Confidence);
        Assert.Empty(analysis.FlatteringColorIds);
        Assert.Empty(analysis.AvoidColorIds);
        Assert.Null(analysis.Refusal);
        Assert.Equal("palette_season", JsonNode.Parse(handler.Calls[0].Body)!["response_format"]!["json_schema"]!["name"]!.GetValue<string>());
    }

    [Fact]
    public async Task Analyze_Refusal_IsPassedOn()
    {
        var (provider, _) = Create(Chat("""{"facesDetected":0,"seasonTypeId":null,"confidence":0,"refusal":"photo_unsuitable"}"""));

        var analysis = await provider.AnalyzeAsync(Photo, default);

        Assert.Equal("photo_unsuitable", analysis.Refusal);
        Assert.Equal(PaletteGuardOutcome.NoFace, PaletteOutputGuard.Evaluate(analysis, 0.6).Outcome);
    }

    // ── Images ────────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Render_PostsMultipartEdit_WithBodyPhotoFirstThenGarments_AndDecodesTheImage()
    {
        var (provider, handler) = Create(Image(Webp));
        var garment = new ImageInput([0x89, (byte)'P', (byte)'N', (byte)'G'], "image/png");

        var result = await provider.RenderAsync(Photo, [garment], default);

        var call = Assert.Single(handler.Calls);
        Assert.Equal("https://ai.test/v1/images/edits", call.Request.RequestUri!.ToString());
        Assert.Equal("multipart/form-data", call.ContentType);
        Assert.Equal("sk-test", call.Request.Headers.Authorization!.Parameter);
        Assert.Contains($"name=model\r\n\r\n{ImageModel}", call.Body);
        Assert.Contains("name=size\r\n\r\n1024x1536", call.Body);
        Assert.Contains("name=output_format\r\n\r\nwebp", call.Body);
        Assert.Contains("name=prompt", call.Body);
        Assert.Equal(2, call.Body.Split("name=\"image[]\"").Length - 1);
        Assert.True(call.Body.IndexOf("filename=image-0.jpg", StringComparison.Ordinal) < call.Body.IndexOf("filename=image-1.png", StringComparison.Ordinal));
        Assert.Equal(Webp, result.Data);
        Assert.Equal("image/webp", result.ContentType);
    }

    [Fact]
    public async Task Cleanup_And_ExtractPiece_UseTheImageModel()
    {
        var (provider, handler) = Create(Image(Webp));

        await provider.CleanupAsync(Photo, default);
        await provider.ExtractPieceAsync(Photo, new GarmentSuggestion(ItemCategoryHint.Shoes, ["black"], null, [], new Dictionary<string, double>()), default);

        Assert.Equal(2, handler.Calls.Count);
        Assert.All(handler.Calls, c => Assert.EndsWith("/v1/images/edits", c.Request.RequestUri!.AbsolutePath));
        Assert.Contains("only the shoes", handler.Calls[1].Body);
    }

    [Fact]
    public void TryOnPrompt_KeepsThePersonUnchanged() =>
        Assert.Contains("Do not change the person's body", OpenAiPrompts.TryOn(2));

    // ── Failure mapping ───────────────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(false, "sk-test", TextModel)]
    [InlineData(true, null, TextModel)]
    [InlineData(true, "sk-test", null)]
    public async Task DisabledOrIncompleteConfig_ThrowsAiProviderException_WithoutCallingOut(bool enabled, string? key, string? model)
    {
        var (provider, handler) = Create(Chat("{}"), options: Options(enabled, key, model));

        await Assert.ThrowsAsync<AiProviderException>(() => provider.GenerateAsync(new StylistPrompt(JobKind.StylistOutfit, "{}"), default));

        Assert.Empty(handler.Calls);
        Assert.False(provider.IsConfigured);
    }

    [Fact]
    public async Task ImageCall_WithoutImageModel_ThrowsAiProviderException()
    {
        var (provider, handler) = Create(Image(Webp), options: Options(image: null));

        await Assert.ThrowsAsync<AiProviderException>(() => provider.RenderAsync(Photo, [], default));
        Assert.Empty(handler.Calls);
    }

    [Fact]
    public void DefaultOptions_AreDisabled_AndCarryNoModelIds()
    {
        var defaults = new AiOptions();

        Assert.False(defaults.Enabled);
        Assert.Null(defaults.TextModel);
        Assert.Null(defaults.ImageModel);
        Assert.Null(defaults.ApiKey);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.NotFound)]
    public async Task ClientError_IsAProviderError_NotRetried(HttpStatusCode status)
    {
        var (provider, _) = Create("""{"error":{"code":"model_not_found","message":"secret prompt echo"}}""", status);

        var ex = await Assert.ThrowsAsync<AiProviderException>(() => provider.GenerateAsync(new StylistPrompt(JobKind.StylistOutfit, "{}"), default));

        Assert.Contains("model_not_found", ex.Message);
        Assert.DoesNotContain("secret prompt echo", ex.Message);
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.RequestTimeout)]
    public async Task RateLimitAndServerErrors_AreTransient_SoSqsRetries(HttpStatusCode status)
    {
        var (provider, _) = Create("""{"error":{"type":"server_error"}}""", status);

        var ex = await Assert.ThrowsAsync<HttpRequestException>(() => provider.GenerateAsync(new StylistPrompt(JobKind.StylistOutfit, "{}"), default));

        Assert.True(Infrastructure.Workers.WorkerFailure.IsRetryable(ex, isLastAttempt: false));
        Assert.False(Infrastructure.Workers.WorkerFailure.IsRetryable(ex, isLastAttempt: true));
    }

    [Fact]
    public void ParseChatContent_RefusalTruncationEmptyOrGarbage_AreProviderErrors()
    {
        var refusal = new JsonObject { ["choices"] = new JsonArray(new JsonObject { ["message"] = new JsonObject { ["content"] = null, ["refusal"] = "I can't help with that." } }) }.ToJsonString();

        Assert.Throws<AiProviderException>(() => OpenAiPayloads.ParseChatContent(refusal));
        Assert.Throws<AiProviderException>(() => OpenAiPayloads.ParseChatContent(Chat("{\"suggestions\":[", "length")));
        Assert.Throws<AiProviderException>(() => OpenAiPayloads.ParseChatContent(Chat("")));
        Assert.Throws<AiProviderException>(() => OpenAiPayloads.ParseChatContent("{}"));
        Assert.Throws<AiProviderException>(() => OpenAiPayloads.ParseChatContent("<html>"));
    }

    [Fact]
    public void ParseImage_MissingOrBrokenImage_IsAProviderError()
    {
        Assert.Throws<AiProviderException>(() => OpenAiPayloads.ParseImage("""{"data":[]}"""));
        Assert.Throws<AiProviderException>(() => OpenAiPayloads.ParseImage("""{"data":[{"b64_json":"***"}]}"""));
        Assert.Equal("image/png", OpenAiPayloads.ParseImage(Image([0x89, (byte)'P', (byte)'N', (byte)'G', 0])).ContentType);
    }

    [Fact]
    public void ParseGarment_NotJson_IsAProviderError() =>
        Assert.Throws<AiProviderException>(() => OpenAiPayloads.ParseGarment("sorry, I cannot"));

    [Fact]
    public void ErrorCode_And_TotalTokens_AreReadDefensively()
    {
        Assert.Equal("rate_limit_exceeded", OpenAiPayloads.ErrorCode("""{"error":{"code":"rate_limit_exceeded","type":"requests"}}"""));
        Assert.Equal("invalid_request_error", OpenAiPayloads.ErrorCode("""{"error":{"code":null,"type":"invalid_request_error"}}"""));
        Assert.Equal("unknown", OpenAiPayloads.ErrorCode("<html>"));
        Assert.Equal(123, OpenAiPayloads.TotalTokens(Chat("{}")));
        Assert.Null(OpenAiPayloads.TotalTokens("nope"));
    }
}

public class LibraryCatalogTests
{
    [Fact]
    public void EmbeddedSeed_IsTheRepoSeedFile_AndIsValid()
    {
        var items = LibraryCatalog.LoadEmbeddedSeed();

        Assert.True(items.Count >= 20);
        Assert.Equal(items.Count, items.Select(i => i.Id).Distinct().Count());
        Assert.All(items, i => Assert.All(Localized.Supported, language => Assert.False(string.IsNullOrWhiteSpace(i.Name[language]))));
        Assert.Equal(Enum.GetValues<ItemCategory>().Order(), items.Select(i => i.Category).Distinct().Order()); // every wardrobe chip has a starter piece
    }

    [Fact]
    public async Task GetAll_PrefersTheSeededPartition_AndHidesRetiredItems()
    {
        var repository = new Tests.Shared.InMemoryRepository();
        var empty = await new LibraryCatalog(repository).GetAllAsync(default);
        Assert.Equal(LibraryCatalog.LoadEmbeddedSeed().Count, empty.Count);

        await repository.SaveAsync(new Domain.Entity.LibraryItemEntity { Id = "lib-a", Name = new() { ["tr"] = "A" }, Category = ItemCategory.Top, ColorIds = ["black"] });
        await repository.SaveAsync(new Domain.Entity.LibraryItemEntity { Id = "lib-b", Name = new() { ["tr"] = "B" }, Category = ItemCategory.Top, Retired = true });

        var seeded = await new LibraryCatalog(repository).GetAllAsync(default);

        Assert.Equal(["lib-a"], seeded.Select(i => i.Id));
    }
}
