using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services.Admin;
using Microsoft.Extensions.DependencyInjection;
using Ulid = Domain.Extensions.Ulid;

namespace Ops.Commands;

/// <summary>
/// ai-admin-smoke (dev only): the admin AI section end to end through the deployed Api and workers, with at most four
/// AI calls: a throw-away super admin (no password, token minted with the stage's AdminJwt key, deleted at the end)
/// → GET the prompt list → model list refresh (GET /v1/models, no tokens) and one tiny model test → a draft of
/// stylist.outfit.instructions that asks every title to start with "QA " → one dry-run ("Dene") → publish → wait
/// for the worker prompt cache (CacheSeconds + 10 s) → a stylist outfit job of a throw-away user must return titles
/// starting with "QA " (the published override was used) → rollback to the code default → the job user is deleted.
/// </summary>
internal sealed class AiAdminSmokeCommand(IServiceProvider services, OpsArguments args, OpsOutput output)
{
    public const string Key = "stylist.outfit.instructions";
    public const string Marker = " Start every outfit title with the two letters QA and a space.";
    private const string SmokeAdminId = "ops-ai-admin-smoke";

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(60) };
    private readonly List<string[]> _rows = [];
    private bool _failed;

    private void Check(string step, bool ok, TimeSpan elapsed, string detail)
    {
        _rows.Add([step, ok ? "ok" : "FAILED", $"{elapsed.TotalSeconds:0.0}s", detail]);
        if (!ok) _failed = true;
        output.Line($"{(ok ? "ok  " : "FAIL")} {step}: {detail}");
    }

    public async Task<int> RunAsync(CancellationToken ct)
    {
        _http.BaseAddress = new Uri((args.Option("api-url") ?? AiSmokeCommand.DevApiUrl).TrimEnd('/') + "/");
        var repository = services.GetRequiredService<IRepository>();
        var admin = new AdminUserEntity
        {
            Id = SmokeAdminId, Email = "ai-admin-smoke@ops.invalid", Name = "AI admin smoke (ops)", Role = AdminRole.SuperAdmin,
            PasswordSet = false, CreatedBy = OpsHost.ActorId, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        await repository.SaveAsync(admin, ct);
        var adminToken = services.GetRequiredService<IAdminTokenService>().CreateAccessToken(admin).Value;
        string? userToken = null;
        var published = false;
        var watch = Stopwatch.StartNew();
        try
        {
            var (status, body) = await CallAsync(HttpMethod.Get, "v1/admin/ai/prompt", null, adminToken, ct);
            var items = body?["items"]?.AsArray() ?? [];
            Check("GET v1/admin/ai/prompt", status == 200 && items.Count >= 29, watch.Elapsed,
                $"{status}, {items.Count} keys, {items.Count(i => i?["editable"]?.GetValue<bool>() == false)} view only, overridden: {string.Join(",", items.Where(i => i?["overridden"]?.GetValue<bool>() == true).Select(i => i?["key"]))}");
            if (status != 200)
                return 1;

            // ── models ───────────────────────────────────────────────────────────────────────────────────────────
            watch.Restart();
            var models = await TrialAsync(new JsonObject { ["type"] = "models" }, adminToken, ct);
            Check("trial models (GET /v1/models in the Stylist worker)", models?["status"]?.GetValue<string>() == "succeeded", watch.Elapsed,
                $"{models?["status"]}, {(models?["output"]?.GetValue<string>() ?? "").Split('\n', StringSplitOptions.RemoveEmptyEntries).Length} ids {models?["error"]}");
            (status, body) = await CallAsync(HttpMethod.Get, "v1/admin/ai/model", null, adminToken, ct);
            var textModel = body?["settings"]?["fields"]?.AsArray().FirstOrDefault(f => f?["key"]?.GetValue<string>() == "TextModel")?["value"]?.GetValue<string>();
            Check("GET v1/admin/ai/model", status == 200 && textModel is not null, TimeSpan.Zero,
                $"TextModel {textModel}, allow-list {body?["availableModels"]?.AsArray().Count}, in list: {body?["availableModels"]?.AsArray().Any(m => m?.GetValue<string>() == textModel)}");
            watch.Restart();
            var test = await TrialAsync(new JsonObject { ["type"] = "model", ["model"] = textModel, ["modelKind"] = "text", ["effort"] = "low" }, adminToken, ct);
            Check($"trial model test {textModel} (one tiny call)", test?["status"]?.GetValue<string>() == "succeeded", watch.Elapsed,
                $"{test?["status"]} {test?["latencyMs"]} ms, model {test?["usedModel"]}, output {test?["output"]} {test?["error"]}");

            // ── prompt: draft → dry-run → publish ────────────────────────────────────────────────────────────────
            (status, body) = await CallAsync(HttpMethod.Get, $"v1/admin/ai/prompt/{Key}", null, adminToken, ct);
            var defaultText = body?["defaultText"]?.GetValue<string>() ?? "";
            var version = body?["summary"]?["publishedVersion"]?.GetValue<int>() ?? 0;
            watch.Restart();
            (status, body) = await CallAsync(HttpMethod.Put, $"v1/admin/ai/prompt/{Key}/draft", new JsonObject { ["text"] = defaultText + Marker }, adminToken, ct);
            Check("PUT draft (code default + QA title rule)", status == 200, watch.Elapsed, $"{status} {AiSmokeCommand.Code(body)}");
            watch.Restart();
            var dry = await TrialAsync(new JsonObject { ["type"] = "prompt", ["key"] = Key }, adminToken, ct);
            Check("trial prompt (Dene, one call)", dry?["status"]?.GetValue<string>() == "succeeded" && dry?["parsed"]?.GetValue<bool>() == true, watch.Elapsed,
                $"{dry?["status"]}, parsed {dry?["parsed"]}, {dry?["latencyMs"]} ms, tokens {dry?["inputTokens"]} ({dry?["cachedTokens"]} cached) / {dry?["outputTokens"]}, system prompt ends with the rule: {dry?["systemPrompt"]?.GetValue<string>().Contains(Marker.Trim()) == true}, output {Truncate(dry?["output"]?.ToString() ?? dry?["error"]?.ToString() ?? "", 200)}");
            watch.Restart();
            (status, body) = await CallAsync(HttpMethod.Post, $"v1/admin/ai/prompt/{Key}/publish", new JsonObject { ["note"] = "ai-admin-smoke", ["expectedVersion"] = version }, adminToken, ct);
            published = status == 200;
            Check("POST publish", published, watch.Elapsed, $"{status} {AiSmokeCommand.Code(body)} → v{body?["summary"]?["publishedVersion"]}");
            if (!published)
                return 1;

            // ── a real stylist job uses the published override ──────────────────────────────────────────────────
            var cacheSeconds = services.GetRequiredService<Microsoft.Extensions.Options.IOptionsMonitor<AiOptions>>().CurrentValue.Prompts.CacheSeconds;
            output.Line($"waiting {cacheSeconds + 10} s for the worker prompt cache");
            await Task.Delay(TimeSpan.FromSeconds(cacheSeconds + 10), ct);

            var email = $"ai-admin-smoke+{DateTime.UtcNow:yyyyMMddHHmmss}@example.com";
            (status, body) = await CallAsync(HttpMethod.Post, "v1/auth/register",
                new JsonObject { ["name"] = "AI Admin Smoke", ["email"] = email, ["password"] = "Smoke-" + Guid.NewGuid().ToString("N"), ["ageConfirmed"] = true }, null, ct);
            if (status != 201)
            {
                Check("POST v1/auth/register", false, TimeSpan.Zero, $"{status} {AiSmokeCommand.Code(body)}");
                return 1;
            }
            userToken = body!["accessToken"]!.GetValue<string>();
            // Same set-up as ai-smoke: a test premium (admin service, audited as ops:github-actions), all consents, library pieces.
            await services.GetRequiredService<IAdminAppUserService>().GrantTestPremiumAsync(OpsHost.Actor, body["userId"]!.GetValue<string>(), 1, "ai-admin-smoke", null, ct);
            var consents = new JsonArray(AiSmokeCommand.ConsentTypes.Select(t => (JsonNode)new JsonObject { ["type"] = t, ["granted"] = true, ["version"] = ConsentOptions.DefaultVersion }).ToArray());
            await CallAsync(HttpMethod.Put, "v1/tenant/consents", new JsonObject { ["consents"] = consents, ["source"] = "onboarding", ["locale"] = "tr" }, userToken, ct);
            var rows = new JsonArray(AiSmokeCommand.LibraryPieces.Select(id => (JsonNode)new JsonObject { ["clientMutationId"] = Ulid.New(), ["libraryItemId"] = id }).ToArray());
            await CallAsync(HttpMethod.Post, "v1/tenant/item/from-library", new JsonObject { ["items"] = rows }, userToken, ct);

            watch.Restart();
            (status, body) = await CallAsync(HttpMethod.Post, "v1/tenant/stylist/outfit",
                new JsonObject { ["requestId"] = Ulid.New(), ["date"] = DateTime.UtcNow.ToString("yyyy-MM-dd"), ["occasion"] = "weekend", ["onlyMyWardrobe"] = true }, userToken, ct);
            var jobId = body?["id"]?.GetValue<string>() ?? body?["job"]?["id"]?.GetValue<string>();
            if (jobId is null)
                output.Line($"POST v1/tenant/stylist/outfit → {status}: {Truncate(body?.ToJsonString() ?? "", 600)}");
            JsonNode? job = null;
            while (jobId is not null && watch.Elapsed < TimeSpan.FromMinutes(4))
            {
                await Task.Delay(TimeSpan.FromSeconds(3), ct);
                (_, job) = await CallAsync(HttpMethod.Get, $"v1/tenant/job/{jobId}", null, userToken, ct);
                if (job?["status"]?.GetValue<string>() is "completed" or "failed")
                    break;
            }
            var suggestions = job?["result"]?["suggestions"]?.AsArray() ?? [];
            var titles = suggestions.Select(s => s?["title"]?.GetValue<string>() ?? "").ToList();
            var sources = string.Join(",", suggestions.Select(s => s?["source"]?.GetValue<string>()).Distinct());
            Check("stylist outfit job uses the published prompt (titles start with \"QA \")",
                job?["status"]?.GetValue<string>() == "completed" && titles.Count > 0 && titles.All(t => t.StartsWith("QA", StringComparison.Ordinal)), watch.Elapsed,
                $"POST {status}, job {jobId} {job?["status"]} {job?["failure"]}, source {sources}, titles: {string.Join(" | ", titles.Select(t => $"“{t}”"))}");
        }
        finally
        {
            if (published)
            {
                watch.Restart();
                var (status, body) = await CallAsync(HttpMethod.Post, $"v1/admin/ai/prompt/{Key}/rollback", new JsonObject { ["version"] = 0, ["note"] = "ai-admin-smoke: back to the code default" }, adminToken, CancellationToken.None);
                Check("POST rollback to the code default", status == 200 && body?["publishedText"] is null, watch.Elapsed,
                    $"{status} {AiSmokeCommand.Code(body)} → v{body?["summary"]?["publishedVersion"]}, history: {string.Join(", ", (body?["history"]?.AsArray() ?? []).Take(3).Select(h => $"v{h?["version"]} {h?["action"]}"))}");
                var audit = await services.GetRequiredService<IAuditLog>().QueryAsync(new AuditQuery(null, "ai.", null, null, 20), CancellationToken.None);
                Check("audit entries (ai.*)", audit.Items.Any(e => e.Action == "ai.prompt.publish") && audit.Items.Any(e => e.Action == "ai.prompt.rollback"), TimeSpan.Zero,
                    string.Join(", ", audit.Items.Take(6).Select(e => $"{e.Action} {e.TargetId}")));
            }
            if (userToken is not null)
                await CallAsync(HttpMethod.Delete, "v1/auth/me", null, userToken, CancellationToken.None);
            await repository.DeleteAsync(AdminUserEntity.GetPk(), AdminUserEntity.GetSk(SmokeAdminId), CancellationToken.None);
            output.Summary($"### ai-admin-smoke ({args.Stage})\n");
            output.Table(["step", "result", "time", "detail"], _rows);
        }
        return _failed ? 1 : 0;
    }

    private async Task<JsonNode?> TrialAsync(JsonObject request, string token, CancellationToken ct)
    {
        var (status, body) = await CallAsync(HttpMethod.Post, "v1/admin/ai/trial", request, token, ct);
        var id = body?["id"]?.GetValue<string>();
        if (status is not (200 or 202) || id is null)
            return new JsonObject { ["status"] = "error", ["error"] = $"{status} {AiSmokeCommand.Code(body)}" };
        var watch = Stopwatch.StartNew();
        while (body?["status"]?.GetValue<string>() is "queued" or "running" && watch.Elapsed < TimeSpan.FromMinutes(3))
        {
            await Task.Delay(TimeSpan.FromSeconds(2), ct);
            (_, body) = await CallAsync(HttpMethod.Get, $"v1/admin/ai/trial/{id}", null, token, ct);
        }
        return body;
    }

    private async Task<(int Status, JsonNode? Body)> CallAsync(HttpMethod method, string path, JsonNode? body, string? token, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, path);
        if (token is not null)
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.AcceptLanguage.ParseAdd("tr");
        if (body is not null)
            request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        using var response = await _http.SendAsync(request, ct);
        var text = await response.Content.ReadAsStringAsync(ct);
        try
        {
            return ((int)response.StatusCode, string.IsNullOrWhiteSpace(text) ? null : JsonNode.Parse(text));
        }
        catch (System.Text.Json.JsonException)
        {
            return ((int)response.StatusCode, new JsonObject { ["raw"] = Truncate(text, 300) });
        }
    }

    private static string Truncate(string text, int max) => text.Length > max ? text[..max] + "…" : text;
}
