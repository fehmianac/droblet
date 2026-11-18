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
        var admin = Bind<AdminOptions>("api", AdminOptions.Section);
        var weather = Bind<WeatherOptions>("api", WeatherOptions.Section);
        var catalog = Bind<CatalogOptions>("api", CatalogOptions.Section);
        var social = Bind<SocialOptions>("api", SocialOptions.Section);
        var notifications = Bind<NotificationOptions>("api", NotificationOptions.Section);
        var stylist = Bind<StylistOptions>("api", StylistOptions.Section);

        Assert.True(palette.NeutralsCountAsCompatible);
        Assert.Empty(palette.NeutralColorIds);
        Assert.Empty(admin.Emails);
        Assert.Empty(admin.UserIds);
        Assert.Equal(("OpenMeteo", 60, "https://api.open-meteo.com"), (weather.Provider, weather.CacheMinutes, weather.ForecastBaseUrl));
        Assert.Equal((24, 60, 10 * 1024 * 1024L), (catalog.PageSize, catalog.MaxPageSize, catalog.MaxImageBytes));
        Assert.Empty(catalog.ImageHosts);
        Assert.Equal((500, "https://droblet.alatech.co/i"), (social.MaxFollowing, social.InviteUrl));
        Assert.Equal(("07:30", "Europe/Istanbul"), (notifications.DefaultMorningLocal, notifications.DefaultTimeZone));
        Assert.Equal((26, 12), (stylist.HotFromC, stylist.ColdBelowC));
    }

    [Fact]
    public void WorkerSections_MatchTheApi_WhereBothSidesApplyTheSameRule()
    {
        var api = Parameters()["api"].ToDictionary(p => p.Section, p => p.Value);
        var worker = Parameters()["worker"].ToDictionary(p => p.Section, p => p.Value);

        foreach (var section in new[] { "Entitlements", "Localization", "Wardrobe", "Weather", "Stylist", "Packing", "Catalog" })
            Assert.Equal(api[section], worker[section]);
    }
}
