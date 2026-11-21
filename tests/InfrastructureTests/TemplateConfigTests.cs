using System.Text.RegularExpressions;
using Amazon.Extensions.Configuration.SystemsManager;
using Amazon.SimpleSystemsManagement.Model;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Configuration;

namespace InfrastructureTests;

/// <summary>
/// The SSM String parameters declared in template.yaml are the production configuration: every value must be JSON
/// that binds to the options class of its section with the values the code documents (a typo here would only show
/// up on a deployed stage).
/// </summary>
public partial class TemplateConfigTests
{
    [GeneratedRegex(@"Name: !Sub /droblet/\$\{Stage\}/(?<scope>api|worker|notifier)/(?<section>[A-Za-z/]+)\s*\n\s*Type: String\s*\n(?:\s*Description: [^\n]*\n)?\s*Value: (?:!If\s*\n\s*- IsProd\s*\n\s*- )?'(?<value>[^'\n]*)'")]
    // A value may be `!If [IsProd, '<prod>', '<dev>']` written as a block list; the prod literal is the one checked.
    private static partial Regex ParameterPattern();

    private static string Template()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "template.yaml")))
            directory = directory.Parent;
        Assert.NotNull(directory);
        return File.ReadAllText(Path.Combine(directory.FullName, "template.yaml"));
    }

    private static Dictionary<string, List<(string Section, string Value)>> Parameters() =>
        ParameterPattern().Matches(Template())
            .GroupBy(m => m.Groups["scope"].Value)
            .ToDictionary(g => g.Key, g => g.Select(m => (m.Groups["section"].Value, m.Groups["value"].Value)).ToList());

    /// <summary>Exactly what a Lambda sees: the SSM loader's own processor over the template's values.</summary>
    private static IConfiguration Configuration(string scope)
    {
        var path = $"/droblet/dev/{scope}";
        var processed = new JsonOrStringParameterProcessor().ProcessParameters(
            Parameters()[scope].Select(p => new Parameter { Name = $"{path}/{p.Section}", Value = p.Value }), path);
        return new ConfigurationBuilder().AddInMemoryCollection(processed!).Build();
    }

    private static T Bind<T>(string scope, string section) where T : new() =>
        Configuration(scope).GetSection(section).Get<T>() ?? new T();

    [Fact]
    public void EveryParameterValue_IsJson_AndEveryStringParameterWasRead()
    {
        var template = Template();
        var all = Parameters().SelectMany(p => p.Value).ToList();

        Assert.Equal(Regex.Matches(template, "Type: AWS::SSM::Parameter").Count, all.Count);
        Assert.All(all, p => System.Text.Json.JsonDocument.Parse(p.Value).Dispose());
        Assert.DoesNotContain("AWS::SES", template);
        Assert.DoesNotMatch(@"(?<![A-Za-z])ses:[A-Za-z*]", template);   // no SES IAM action either
        Assert.DoesNotContain("Type: SecureString", template);   // secrets are never template values
        Assert.True(Regex.Match(template, @"(?s)^.*?Description: >(.*?)\n\nParameters:").Groups[1].Value.Length < 1024); // CloudFormation limit
    }

    [Theory]
    [InlineData("api")]
    [InlineData("worker")]
    public void Entitlements_And_Packing_CarryTheOwnerDecisions(string scope)
    {
        var entitlements = Bind<EntitlementOptions>(scope, EntitlementOptions.Section);
        var packing = Bind<PackingOptions>(scope, PackingOptions.Section);

        Assert.Equal((30, 10), (entitlements.Premium.TryOnCreditsPerMonth, entitlements.Free.ItemRecognitionLimit));
        Assert.Equal((30, 30), (entitlements.Free.OutfitImportMaxPhotos, entitlements.Premium.OutfitImportMaxPhotos));
        Assert.False(entitlements.SelfServePremium.Enabled);   // the prod literal: self-serve premium is off in prod
        Assert.Equal((12, 21), (packing.CabinMaxItems, packing.MaxTripDays));
    }

    [Theory]
    [InlineData("api")]
    [InlineData("worker")]
    [InlineData("notifier")]
    public void Localization_IsTurkishAndEnglish_InEveryLambda(string scope)
    {
        var policy = LanguagePolicy.From(Bind<LocalizationOptions>(scope, LocalizationOptions.Section));

        Assert.Equal(["tr", "en"], policy.Supported.ToArray());
        Assert.Equal("tr", policy.Default);
    }

    [Theory]
    [InlineData("api")]
    [InlineData("worker")]
    public void Wardrobe_SlotMapping_IsTheApprovedDefault(string scope)
    {
        var wardrobe = Bind<WardrobeOptions>(scope, WardrobeOptions.Section);
        var mapping = SlotMapping.From(wardrobe.SlotMapping);

        Assert.Equal((30, 6), (wardrobe.MaxBatchUpload, wardrobe.MaxSplitPieces));
        Assert.Equal(2, wardrobe.SlotMapping.Count);
        foreach (var category in Enum.GetValues<ItemCategory>())
            Assert.Equal(SlotMapping.Default.SlotsOf(category), mapping.SlotsOf(category));
    }

    [Fact]
    public void ApiSections_BindToTheirOptions()
    {
        var palette = Bind<PaletteOptions>("api", PaletteOptions.Section);
        var admin = Bind<AdminAuthOptions>("api", AdminAuthOptions.Section);
        var weather = Bind<WeatherOptions>("api", WeatherOptions.Section);
        var catalog = Bind<CatalogOptions>("api", CatalogOptions.Section);
        var social = Bind<SocialOptions>("api", SocialOptions.Section);
        var notifications = Bind<NotificationOptions>("api", NotificationOptions.Section);
        var stylist = Bind<StylistOptions>("api", StylistOptions.Section);

        Assert.True(palette.NeutralsCountAsCompatible);
        Assert.Empty(palette.NeutralColorIds);
        Assert.Equal(("fehmianac@gmail.com", "https://droblet-admin.alatech.co"), (admin.BootstrapSuperAdminEmail, admin.PanelUrl));
        Assert.Equal(["https://droblet-admin.alatech.co"], admin.AllowedOrigins);   // prod value: no localhost
        Assert.Equal((10, 5, 600), (admin.CodeTtlMinutes, admin.CodeMaxAttempts, admin.RequestsPerMinute));
        Assert.Equal(("OpenMeteo", 60, "https://api.open-meteo.com"), (weather.Provider, weather.CacheMinutes, weather.ForecastBaseUrl));
        Assert.Equal((24, 60, 10 * 1024 * 1024L), (catalog.PageSize, catalog.MaxPageSize, catalog.MaxImageBytes));
        Assert.Empty(catalog.ImageHosts);
        Assert.Equal((500, "https://droblet.alatech.co/invite"), (social.MaxFollowing, social.InviteUrl));
        Assert.Equal(("07:30", "Europe/Istanbul"), (notifications.DefaultMorningLocal, notifications.DefaultTimeZone));
        Assert.Equal((26, 12), (stylist.HotFromC, stylist.ColdBelowC));
    }

    [Fact]
    public void SelfServePremium_IsOnInDev_OffInProd()
    {
        var template = Template();
        foreach (var scope in new[] { "api", "worker" })
        {
            var block = Regex.Match(template, @"Name: !Sub /droblet/\$\{Stage\}/" + scope + @"/Entitlements\s*\n(?:[^\n]*\n){2}\s*Value: !If\s*\n\s*- IsProd\s*\n\s*- '(?<prod>[^']*)'\s*\n\s*- '(?<dev>[^']*)'");
            Assert.True(block.Success, scope);
            Assert.Contains("\"SelfServePremium\":{\"Enabled\":false}", block.Groups["prod"].Value);
            Assert.Contains("\"SelfServePremium\":{\"Enabled\":true}", block.Groups["dev"].Value);
            // Everything else is the same on both stages.
            Assert.Equal(block.Groups["prod"].Value.Replace("false", "true"), block.Groups["dev"].Value);
        }
    }

    [Fact]
    public void WorkerSections_MatchTheApi_WhereBothSidesApplyTheSameRule()
    {
        var api = Parameters()["api"].ToDictionary(p => p.Section, p => p.Value);
        var worker = Parameters()["worker"].ToDictionary(p => p.Section, p => p.Value);

        foreach (var section in new[] { "Entitlements", "Localization", "Wardrobe", "Weather", "Stylist", "Packing", "Catalog", "Segments" })
            Assert.Equal(api[section], worker[section]);
    }

    [Fact]
    public void Segments_AreWomenOnlyInProd_WomenAndMenInDev_TeenNever()
    {
        foreach (var scope in new[] { "api", "worker" })
        {
            // The checked literal is the prod one.
            Assert.Equal([Segment.Women], SegmentPolicy.Available(Bind<SegmentOptions>(scope, SegmentOptions.Section)));

            var dev = Regex.Match(Template(), scope + @"/Segments[\s\S]*?- IsProd\s*\n\s*- '[^']*'\s*\n\s*- '(?<dev>[^']*)'").Groups["dev"].Value;
            var devOptions = System.Text.Json.JsonSerializer.Deserialize<SegmentOptions>(dev)!;
            Assert.Equal([Segment.Women, Segment.Men], SegmentPolicy.Available(devOptions));
            Assert.DoesNotContain("teen", dev, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public void Admin_TheOldConfigListIsGone_AndSsmWritesAreExactlyTheEditableParameters()
    {
        var template = Template();
        Assert.DoesNotMatch(@"/api/Admin\s", template);
        Assert.DoesNotContain("AllowOrigins: ['*']", template);   // CORS is answered by the Api, not the gateway

        var put = Regex.Match(template, @"Action: ssm:PutParameter\s*\n\s*Resource:\s*\n(?<arns>(?:\s*- !Sub arn:[^\n]*\n)+)");
        Assert.True(put.Success);
        var written = Regex.Matches(put.Groups["arns"].Value, @"parameter/droblet/\$\{Stage\}/(?<name>[A-Za-z/]+)")
            .Select(m => m.Groups["name"].Value).Order(StringComparer.Ordinal).ToList();
        var editable = Domain.Services.Admin.SettingsCatalog.WritableParameters.Select(p => $"{p.Scope}/{p.Section}").Order(StringComparer.Ordinal).ToList();
        Assert.Equal(editable, written);
        Assert.Single(Regex.Matches(template, "ssm:PutParameter"));   // no other statement may write SSM
    }

    [GeneratedRegex(@"\n  (?<resource>[A-Za-z]+):\n    Type: AWS::Serverless::Function\n    Properties:\n      FunctionName: !Sub droblet-\$\{Stage\}-(?<name>[a-z-]+)\n      LoggingConfig:\n        LogGroup: !Ref (?<group>[A-Za-z]+)\n")]
    private static partial Regex FunctionLoggingPattern();

    [Fact]
    public void EveryLambda_LogsToItsOwnNewGroup_WithTheStageRetention()
    {
        var template = Template();
        var functions = Regex.Matches(template, "Type: AWS::Serverless::Function").Count;
        var wired = FunctionLoggingPattern().Matches(template).ToList();

        Assert.Equal(11, functions);
        Assert.Equal(functions, wired.Count);   // every function has LoggingConfig.LogGroup
        Assert.Equal(functions, wired.Select(m => m.Groups["group"].Value).Distinct().Count());
        foreach (var match in wired)
        {
            var group = match.Groups["group"].Value;
            var declaration = Regex.Match(template, $@"\n  {group}:\n    Type: AWS::Logs::LogGroup\n    Properties:\n      LogGroupName: (?<name>[^\n]+)\n      RetentionInDays: (?<retention>[^\n]+)\n");
            Assert.True(declaration.Success, group);
            // A new name: the auto-created /aws/lambda/droblet-{Stage}-{fn} groups already exist on deployed stacks.
            Assert.Equal($"!Sub /droblet/${{Stage}}/lambda/{match.Groups["name"].Value}", declaration.Groups["name"].Value);
            Assert.Equal("!If [HasLogRetentionOverride, !Ref LogRetentionDays, !If [IsProd, 400, 90]]", declaration.Groups["retention"].Value);
        }
        Assert.DoesNotContain("LogGroupName: !Sub /aws/lambda/", template);
        Assert.Matches(@"LogRetentionDays:\n    Type: Number\n    Default: 0\n", template);
        Assert.Contains("HasLogRetentionOverride: !Not [!Equals [!Ref LogRetentionDays, '0']]", template);
        // Writing to the new groups is covered by the basic execution policy of every Lambda role.
        Assert.Equal(Regex.Matches(template, "Type: AWS::IAM::Role").Count - AdminOnlyRoles(template),
            Regex.Matches(template, "service-role/AWSLambdaBasicExecutionRole").Count);
    }

    [Fact]
    public void OutfitImport_HasItsQueue_Dlq_Alarm_Lifecycle_AndLeastPrivilege()
    {
        var template = Template();

        // Queue + DLQ (maxReceiveCount 3) + alarm, consumed by its own function with SQS MaximumConcurrency.
        Assert.Matches(@"OutfitImportRequestQueue:\n    Type: AWS::SQS::Queue\n    Properties:\n      QueueName: !Sub droblet-\$\{Stage\}-outfit-import-request\n      VisibilityTimeout: 150\n(?:.*\n){2}\s*deadLetterTargetArn: !GetAtt OutfitImportRequestDlq.Arn\n\s*maxReceiveCount: 3", template);
        Assert.Contains("Dimensions: [{ Name: QueueName, Value: !GetAtt OutfitImportRequestDlq.QueueName }]", template);
        Assert.Matches(@"Queue: !GetAtt OutfitImportRequestQueue.Arn\n\s*BatchSize: 1\n\s*FunctionResponseTypes: \[ReportBatchItemFailures\]\n\s*ScalingConfig:\n\s*MaximumConcurrency: !Ref OutfitImportMaxConcurrency", template);
        Assert.Contains("Handler: ItemProcessor::ItemProcessor.OutfitImportEntrypoint::FunctionHandler", template);

        // Originals under uploads/import/ expire after 7 days.
        Assert.Matches(@"- Id: expire-outfit-import-uploads\n\s*Status: Enabled\n\s*Prefix: uploads/import/\n\s*ExpirationInDays: 7", template);
        Assert.StartsWith("uploads/import/", StorageKeys.ImportUploadsRoot("t"));

        // The worker reads the originals and item images, writes only under tenant/*/import/, and re-sends to its own queue only.
        var role = Regex.Match(template, @"OutfitImportLambdaRole:\n(?<body>(?:    .*\n|\n)+?)\n  [A-Za-z]+:\n").Groups["body"].Value;
        Assert.Contains("Resource: !GetAtt OutfitImportRequestQueue.Arn", role);
        Assert.DoesNotContain("s3:DeleteObject", role);
        Assert.Matches(@"Action: \[s3:GetObject, s3:PutObject\]\n\s*Resource: !Sub '\$\{PhotoBucket.Arn\}/tenant/\*/import/\*'", role);
        Assert.DoesNotContain("parameter/droblet/${Stage}/api", role);

        // The Api signs the uploads and queues the photos.
        Assert.Contains("OUTFIT_IMPORT_REQUEST_QUEUE_URL: !Ref OutfitImportRequestQueue", template);
        Assert.Contains("- !Sub '${PhotoBucket.Arn}/uploads/import/*'", template);
    }

    /// <summary>Roles that are not assumed by Lambda (none today).</summary>
    private static int AdminOnlyRoles(string template) =>
        Regex.Matches(template, @"Principal: \{ Service: (?!lambda\.amazonaws\.com)").Count;

    [Fact]
    public void AiPricing_BindsToAi_ForTheOwnersModels_OnEveryStage()
    {
        var ai = Bind<AiOptions>("worker", AiOptions.Section);

        Assert.Equal((10m, 1m, 50m), (ai.Pricing.For("gpt-6-astra")!.Input, ai.Pricing.For("gpt-6-astra")!.CachedInput, ai.Pricing.For("gpt-6-astra")!.Output));
        var image = ai.Pricing.For("gpt-image-2.5-sunburst-2026-09-08")!;
        Assert.Equal((5m, 8m, 30m), (image.Input, image.ImageInput, image.ImageOutput));
        Assert.Equal(0.5m, ai.Pricing.MultiplierFor("flex"));
        Assert.True(ai.Pricing.UsdTry > 0);
        // Accounting only: the price list never changes a request (no model, effort or image setting in it).
        Assert.Null(ai.TextModel);
        Assert.Empty(ai.ReasoningEffort);
        // Same value on both stages (no !If): prices are facts, not a dev experiment.
        Assert.DoesNotMatch(@"worker/Ai/Pricing\s*\n(?:[^\n]*\n){1,3}?\s*Value: !If", Template());
    }

    [Fact]
    public void AiUsage_CarriesTheNetPricesOfDocsAiCost_AndSaneThresholds()
    {
        var usage = Bind<AiUsageOptions>("api", AiUsageOptions.Section);
        // docs/ai-cost.md §7: ₺199.99 monthly / ₺1,499.99 yearly, incl. 20% VAT, minus the 15% store fee; USD/TRY 43.
        Assert.Equal((141.66m, 88.54m, 43m), (usage.NetMonthlyPlanTry, usage.NetYearlyPlanPerMonthTry, usage.UsdTryRate));
        Assert.True(usage is { AnomalyMedianMultiplier: > 1, AnomalyAbsoluteDayUsd: > 0, AnomalyMinHistoryDays: >= 1, TopUsers: > 0, MaxRangeDays: >= 31 and <= 366 });
        // Same value on both stages: these are accounting facts, not a dev experiment.
        Assert.DoesNotMatch(@"api/AiUsage\s*\n(?:[^\n]*\n){1,3}?\s*Value: !If", Template());
    }

    [Fact]
    public void AiLimits_AreOffOnProd_AndOnInDev()
    {
        var prod = Bind<AiLimitsOptions>("api", AiLimitsOptions.Section);   // the checked literal is the prod one
        Assert.Equal((0, 0, 0, 0), (prod.StylistJobsPerDay, prod.ItemRecognitionsPerDay, prod.PaletteAnalysesPerDay, prod.AiStartsPerMinute));

        var dev = Regex.Match(Template(), @"api/AiLimits[\s\S]*?- IsProd\s*\n\s*- '[^']*'\s*\n\s*- '(?<dev>[^']*)'").Groups["dev"].Value;
        var devLimits = System.Text.Json.JsonSerializer.Deserialize<AiLimitsOptions>(dev)!;
        Assert.True(devLimits is { StylistJobsPerDay: > 0, ItemRecognitionsPerDay: > 0, PaletteAnalysesPerDay: > 0, AiStartsPerMinute: > 0 });
    }

    /// <summary>
    /// docs/images.md: the photo bucket has exactly one public grant — GetObject on public/{stage}/items/* from Cloudflare's ranges —
    /// and no private prefix can ever fall under it.
    /// </summary>
    [Fact]
    public void PhotoBucket_PublicGrant_IsOnlyGetObjectOnPublicItems_FromCloudflare_AndNoPrivatePrefixMatchesIt()
    {
        var template = Template();
        var bucket = Regex.Match(template, @"\n  PhotoBucket:\n(?<body>(?:    .*\n|\n)+?)\n  [A-Za-z]+:\n").Groups["body"].Value;
        var policy = Regex.Match(template, @"\n  PhotoBucketPolicy:\n(?<body>(?:    .*\n|\n)+?)\n  (?:[A-Za-z]+:|#)").Groups["body"].Value;
        Assert.NotEmpty(bucket);
        Assert.NotEmpty(policy);

        // ACLs stay blocked; owner-enforced objects; encryption at rest.
        Assert.Contains("BlockPublicAcls: true", bucket);
        Assert.Contains("IgnorePublicAcls: true", bucket);
        Assert.Contains("ObjectOwnership: BucketOwnerEnforced", bucket);
        Assert.Contains("SSEAlgorithm: AES256", bucket);

        // Exactly one Allow to Principal '*', and it is the Cloudflare-only GetObject on public/{stage}/items/*.
        var statements = Regex.Split(policy, @"\n          - ").Skip(1).ToList();
        var publicAllows = statements.Where(s => s.Contains("Effect: Allow") && s.Contains("Principal: '*'")).ToList();
        var grant = Assert.Single(publicAllows);
        Assert.Contains("Sid: PublicItemImagesFromCloudflare", grant);
        Assert.Matches(@"\n\s*Action: s3:GetObject\n", grant);
        Assert.DoesNotContain("s3:List", grant);
        Assert.DoesNotContain("s3:*", grant);
        var resources = Regex.Matches(grant, @"Resource: (?<r>.+)").Select(m => m.Groups["r"].Value.Trim()).ToList();
        Assert.Equal(["!Sub '${PhotoBucket.Arn}/public/${Stage}/items/*'"], resources);
        // The Cloudflare IP limit is on unless the stage serves directly (PublicImagesOrigin: auto = dev direct, prod Cloudflare).
        Assert.Contains("Condition: !If\n              - PublicImagesViaCloudflare", grant);
        Assert.Contains("PublicImagesViaCloudflare: !Or", template);
        Assert.Contains("- !And [!Equals [!Ref PublicImagesOrigin, auto], !Condition IsProd]", template);
        Assert.Contains("IpAddress:", grant);
        Assert.Contains("aws:SourceIp:", grant);
        Assert.Contains("- 173.245.48.0/20", grant);
        Assert.DoesNotContain("0.0.0.0/0", grant);
        // The HTTPS-only deny still covers the whole bucket.
        Assert.Contains("Sid: DenyInsecureTransport", policy);

        // Every private prefix the code builds lies outside public/{stage}/items/; the public keys lie inside it.
        const string tenant = "01JTENANT0000000000000000A";
        string[] privateKeys =
        [
            StorageKeys.TenantRoot(tenant), StorageKeys.UploadsRoot(tenant), StorageKeys.ImportUploadsRoot(tenant), StorageKeys.ExportsRoot(tenant),
            StorageKeys.PhotoPrefix(tenant, PhotoKind.Body), StorageKeys.PhotoPrefix(tenant, PhotoKind.Face), StorageKeys.TryOnPrefix(tenant),
            StorageKeys.AvatarPrefix(tenant), StorageKeys.ItemsPrefix(tenant), StorageKeys.ItemImage(tenant, "d"), StorageKeys.ItemOriginal(tenant, "d", "jpg"),
            StorageKeys.ItemImageRendition(StorageKeys.ItemImage(tenant, "d"), 256), StorageKeys.ImportPrefix(tenant, "s"), StorageKeys.Export(tenant, "e"),
        ];
        Assert.All(privateKeys, k => Assert.False(k.StartsWith("public/", StringComparison.Ordinal), k));
        var publicKey = StorageKeys.PublicItemImage(tenant, "i", "0123456789abcdef0123456789abcdef", "256");
        Assert.StartsWith(StorageKeys.PublicItemsPrefix, publicKey);
        Assert.Equal("public/dev/items/", StorageKeys.PublicItemsPrefix);   // the template's ${Stage} = the Lambda's STAGE
        Assert.DoesNotContain(tenant, publicKey);
        // Nothing expires public copies by accident; the bucket's lifecycle rules all name private prefixes.
        Assert.DoesNotMatch(@"Prefix: public/", bucket);
    }

    [Fact]
    public void Photos_PrivateReadUrls_LastAnHour_AndRolesReachPublicItems_OnlyWhereTheyPublish()
    {
        Assert.Equal(3600, Bind<PhotoOptions>("api", PhotoOptions.Section).ReadUrlTtlSeconds);
        var template = Template();
        string Role(string name) => Regex.Match(template, $@"\n  {name}:\n(?<body>(?:    .*\n|\n)+?)\n  [A-Za-z]+:\n").Groups["body"].Value;
        Assert.Contains("public/${Stage}/items/*", Role("ApiLambdaRole"));
        Assert.Contains("public/${Stage}/items/*", Role("ItemProcessorLambdaRole"));
        // Owner decision: cdn.alatech.co, in config; CDN links only once api/Photos/PublicUrlsEnabled is switched on.
        var photos = Bind<PhotoOptions>("api", PhotoOptions.Section);
        Assert.Equal(("https://cdn.alatech.co", false, (string?)null), (photos.PublicBaseUrl, photos.PublicUrlsEnabled, photos.EffectivePublicBaseUrl));
        // publish-item-images batches re-queue themselves on the item processor queue.
        Assert.Contains("ITEM_PROCESS_REQUEST_QUEUE_URL: !Ref ItemProcessorRequestQueue", template);
        Assert.Contains("sqs:ChangeMessageVisibility, sqs:SendMessage]\n                Resource: !GetAtt ItemProcessorRequestQueue.Arn", template.Replace("\r", ""));
        foreach (var role in new[] { "OutfitImportLambdaRole", "StylistLambdaRole", "TryOnLambdaRole", "PaletteLambdaRole", "NotifierLambdaRole", "DataExportLambdaRole" })
            Assert.DoesNotContain("public/", Role(role));
    }
}
