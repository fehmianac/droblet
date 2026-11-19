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
        Assert.Equal((500, "https://droblet.alatech.co/i"), (social.MaxFollowing, social.InviteUrl));
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

        foreach (var section in new[] { "Entitlements", "Localization", "Wardrobe", "Weather", "Stylist", "Packing", "Catalog" })
            Assert.Equal(api[section], worker[section]);
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

        Assert.Equal(9, functions);
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

    /// <summary>Roles that are not assumed by Lambda (none today).</summary>
    private static int AdminOnlyRoles(string template) =>
        Regex.Matches(template, @"Principal: \{ Service: (?!lambda\.amazonaws\.com)").Count;
}
