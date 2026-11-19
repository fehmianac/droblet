using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Domain.Entity;

namespace Domain.Services;

public sealed record AnalyticsEventInput(string? Name, DateTime? OccurredAt, IReadOnlyDictionary<string, string?>? Props);

public sealed record AnalyticsEventRejection(int Index, string Code);

public sealed record FunnelStep(string Name, long Events, int Actors, double? RateFromPrevious, double? RateFromFirst);

public sealed record FunnelReport(string From, string To, long TotalEvents, int TotalActors, IReadOnlyList<FunnelStep> Steps);

/// <summary>
/// Own analytics (brief §6 event list). Only allow-listed names and property keys are stored; values must be
/// identifier-like (no spaces → no free text, no e-mail, no names). The actor is a hash of the tenant id.
/// </summary>
public static partial class AnalyticsRules
{
    public const int MaxBatch = 50;
    public const int MaxProps = 8;
    public static readonly TimeSpan MaxEventAge = TimeSpan.FromDays(7);
    public static readonly TimeSpan MaxClockSkew = TimeSpan.FromMinutes(10);

    // Server-recorded (authoritative, written where the business action happens): the client cannot send these.
    public const string AddToCart = "add_to_cart";
    public const string Share = "share";
    public const string BrandSiteOpened = "brand_site_opened";
    public const string Conversion = "conversion";
    public const string InvitedInstall = "invited_install";

    /// <summary>Funnel order = the order the investor report reads them (brief §6).</summary>
    public static readonly IReadOnlyList<string> FunnelOrder =
    [
        "signup_started", "signup_completed",
        "onboarding_style_completed", "onboarding_body_completed", "onboarding_photo_completed", "onboarding_first_items_completed",
        "first_item_added", "first_look_created",
        "paywall_viewed", "subscribed",
        "credit_spent", "credits_exhausted",
        "complete_look_clicked", AddToCart, BrandSiteOpened, Conversion,
        Share, InvitedInstall,
    ];

    public static readonly IReadOnlySet<string> ServerOnly = new HashSet<string>(StringComparer.Ordinal)
    {
        AddToCart, Share, BrandSiteOpened, Conversion, InvitedInstall,
    };

    public static readonly IReadOnlySet<string> ClientAllowed =
        FunnelOrder.Where(n => !ServerOnly.Contains(n)).ToHashSet(StringComparer.Ordinal);

    public static readonly IReadOnlySet<string> AllowedProps = new HashSet<string>(StringComparer.Ordinal)
    {
        "step", "source", "screen", "productId", "brandId", "lookId", "lookKind", "editId", "channel", "priceBand",
        "plan", "capability", "category", "count", "creditsRemaining", "platform", "appVersion",
    };

    [GeneratedRegex(@"^[A-Za-z0-9._:\-]{1,64}$")]
    private static partial Regex ValuePattern();

    public static bool IsSafeValue(string? value) => value is not null && ValuePattern().IsMatch(value);

    /// <summary>Null when the event is acceptable; otherwise the rejection code.</summary>
    public static string? Validate(AnalyticsEventInput input, DateTime nowUtc)
    {
        if (string.IsNullOrEmpty(input.Name))
            return "name_required";
        if (ServerOnly.Contains(input.Name))
            return "name_server_only";
        if (!ClientAllowed.Contains(input.Name))
            return "name_not_allowed";
        if (input.OccurredAt is { } at && (at > nowUtc + MaxClockSkew || at < nowUtc - MaxEventAge))
            return "occurred_at_out_of_range";
        if (input.Props is { Count: > MaxProps })
            return "too_many_props";
        if (input.Props is not null && input.Props.Any(p => !AllowedProps.Contains(p.Key)))
            return "prop_not_allowed";
        if (input.Props is not null && input.Props.Any(p => !IsSafeValue(p.Value)))
            return "prop_value_invalid";
        return null;
    }

    /// <summary>Stable pseudonymous actor. Not reversible without the tenant id; nothing else about the user is stored.</summary>
    public static string Actor(string tenantId) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes("droblet-analytics:" + tenantId)))[..32];

    public static AnalyticsEventEntity ToEntity(string name, string tenantId, DateTime occurredAt, DateTime receivedAt,
        IReadOnlyDictionary<string, string?>? props, string id)
    {
        var clean = props?.Where(p => p.Value is not null).ToDictionary(p => p.Key, p => p.Value!) ?? [];
        clean.Remove("platform", out var platform);
        clean.Remove("appVersion", out var appVersion);
        return new AnalyticsEventEntity
        {
            Id = id,
            Day = WeeklyEditRules.Format(DateOnly.FromDateTime(occurredAt)),
            Name = name,
            Actor = Actor(tenantId),
            OccurredAt = occurredAt,
            ReceivedAt = receivedAt,
            Platform = platform,
            AppVersion = appVersion,
            Props = clean,
        };
    }

    /// <summary>The per-actor copy written next to every event (export, account deletion).</summary>
    public static AnalyticsActorEventEntity ToActorEntity(AnalyticsEventEntity e) => new()
    {
        Id = e.Id,
        Actor = e.Actor,
        Day = e.Day,
        Name = e.Name,
        OccurredAt = e.OccurredAt,
        ReceivedAt = e.ReceivedAt,
        Platform = e.Platform,
        AppVersion = e.AppVersion,
        Props = new Dictionary<string, string>(e.Props, StringComparer.Ordinal),
    };

    public static FunnelReport BuildFunnel(IEnumerable<AnalyticsEventEntity> events, DateOnly from, DateOnly to)
    {
        var byName = new Dictionary<string, (long Events, HashSet<string> Actors)>(StringComparer.Ordinal);
        var allActors = new HashSet<string>(StringComparer.Ordinal);
        long total = 0;
        foreach (var e in events)
        {
            total++;
            allActors.Add(e.Actor);
            if (!byName.TryGetValue(e.Name, out var bucket))
                bucket = (0, new HashSet<string>(StringComparer.Ordinal));
            bucket.Actors.Add(e.Actor);
            byName[e.Name] = (bucket.Events + 1, bucket.Actors);
        }

        var steps = new List<FunnelStep>();
        int? first = null;
        int? previous = null;
        foreach (var name in FunnelOrder)
        {
            var (count, actors) = byName.TryGetValue(name, out var b) ? (b.Events, b.Actors.Count) : (0L, 0);
            steps.Add(new FunnelStep(name, count, actors, Rate(actors, previous), Rate(actors, first)));
            first ??= actors;
            previous = actors;
        }

        return new FunnelReport(WeeklyEditRules.Format(from), WeeklyEditRules.Format(to), total, allActors.Count, steps);
    }

    private static double? Rate(int actors, int? baseline) =>
        baseline is null or 0 ? null : Math.Round((double)actors / baseline.Value, 4);
}
