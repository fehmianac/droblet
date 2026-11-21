namespace Domain.Options;

/// <summary>
/// Teen mode (docs/api/teen.md §2). SSM api/Teen, worker/Teen and notifier/Teen (the same JSON). The code defaults are the
/// safe ones: teen sign-up off, teen try-on off.
/// </summary>
public sealed class TeenOptions
{
    public const string Section = "Teen";

    /// <summary>16–17 may sign up (dev true, prod false). Off: 422 teen_not_available; existing teen accounts keep working.</summary>
    public bool Enabled { get; set; }

    /// <summary>
    /// Coordinator safety condition: false on every stage until OpenAI's usage policy is confirmed and a lawyer approves.
    /// Deliberately not editable in the admin panel (template.yaml only, i.e. a reviewed deploy).
    /// </summary>
    public bool TryOnEnabled { get; set; }

    public int ConsentLinkDays { get; set; } = 7;
    public int ConsentRequestsPerDay { get; set; } = 5;
    public int ConsentRequestsPerParentPerDay { get; set; } = 3;
    public int PhotoRetentionInactiveDays { get; set; } = 90;

    /// <summary>Transition: an old client's ageConfirmed: true without birthYear still registers an adult.</summary>
    public bool LegacyAgeCheckbox { get; set; } = true;

    /// <summary>The page of the e-mailed link (trailing slash: S3 drops the query on the /page → /page/ redirect).</summary>
    public string ParentConsentUrl { get; set; } = "https://droblet.alatech.co/parent-consent/";

    /// <summary>Version of the parent-facing text (landing /parent-consent/); the page sends it back with the decision.</summary>
    public string ParentalConsentTextVersion { get; set; } = "2026-11-21";

    /// <summary>The limited stylist of approved teens on the free tier (docs/api/teen.md §4.2). Editable in the panel.</summary>
    public TeenStylistOptions Stylist { get; set; } = new();

    public TimeSpan ConsentLinkLifetime => TimeSpan.FromDays(Math.Clamp(ConsentLinkDays, 1, 30));
}

/// <summary>
/// Teen:Stylist — owner decision 2026-11-21: an approved teen (free tier, paywall hidden) gets a limited text stylist.
/// Days and weeks are Europe/Istanbul (week = Monday 00:00). Every number 0 = that capability is off for teens.
/// </summary>
public sealed class TeenStylistOptions
{
    public bool Enabled { get; set; } = true;

    /// <summary>Outfit suggestion jobs (POST v1/tenant/stylist/outfit) per Istanbul day.</summary>
    public int DailyLimit { get; set; } = 3;

    /// <summary>Week plans (POST v1/tenant/stylist/week) per Istanbul week.</summary>
    public int WeekPlanPerWeek { get; set; } = 1;

    /// <summary>AI trip packing (POST v1/tenant/trip/{id}/pack) per Istanbul week; 0 (default) = off for teens.</summary>
    public int TripPackPerWeek { get; set; }
}
