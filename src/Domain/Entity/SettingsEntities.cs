using System.Text.Json.Serialization;
using Domain.Entity.Base;
using Domain.Enum;
using Domain.Extensions;

namespace Domain.Entity;

/// <summary>
/// Screen 29 switches. The morning time is the user's LOCAL wall-clock time plus an IANA time zone, so a DST change
/// never moves the reminder (deviation from the guide's "store UTC"; see docs/api/store-social-settings.md).
/// </summary>
public class NotificationPrefEntity : IVersionedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(UserId);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("userId")] public string UserId { get; set; } = null!;
    [JsonPropertyName("morningOutfit")] public bool MorningOutfit { get; set; }
    /// <summary>HH:mm, quarter hours only.</summary>
    [JsonPropertyName("morningOutfitLocalTime")] public string MorningOutfitLocalTime { get; set; } = "07:30";
    [JsonPropertyName("weeklyEdit")] public bool WeeklyEdit { get; set; }
    [JsonPropertyName("friendRatings")] public bool FriendRatings { get; set; }
    /// <summary>Watch-list price drops (decision 9: off by default).</summary>
    [JsonPropertyName("priceDrop")] public bool PriceDrop { get; set; }
    /// <summary>New follow requests (decision 8; off by default like every type outside decision 9's list).</summary>
    [JsonPropertyName("followRequests")] public bool FollowRequests { get; set; }
    /// <summary>
    /// Akış F2: the daily digest of likes on my shared looks is ON by default (owner decision 21), so the stored flag is
    /// the opt-out — a row written before the field, or no row at all, reads as on.
    /// </summary>
    [JsonPropertyName("feedLikesDigestOff")] public bool FeedLikesDigestOff { get; set; }
    [JsonPropertyName("timeZone")] public string TimeZone { get; set; } = "Europe/Istanbul";
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }
    [JsonPropertyName("version")] public long Version { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#notifpref";
    public static string GetSk(string userId) => userId;
}

/// <summary>Global: who wants the morning reminder at a given local time. The Reminder job reads the slots that are "now".</summary>
public class ReminderSlotEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(LocalTime);
    [JsonPropertyName("sk")] public string Sk => GetSk(SubscriberTenantId);

    [JsonPropertyName("localTime")] public string LocalTime { get; set; } = null!;
    [JsonPropertyName("subscriberTenantId")] public string SubscriberTenantId { get; set; } = null!;
    [JsonPropertyName("userId")] public string UserId { get; set; } = null!;
    [JsonPropertyName("timeZone")] public string TimeZone { get; set; } = null!;

    public static string GetPk(string localTime) => $"reminderlocal#{localTime}";
    public static string GetSk(string subscriberTenantId) => subscriberTenantId;
}

/// <summary>Global: tenants with a notification type switched on (WeeklyEdit, FriendRatings, PriceDrop, FollowRequest) — the Notifier's send list.</summary>
public class NotificationSubscriberEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(Type);
    [JsonPropertyName("sk")] public string Sk => GetSk(SubscriberTenantId);

    [JsonPropertyName("type")] public NotificationType Type { get; set; }
    [JsonPropertyName("subscriberTenantId")] public string SubscriberTenantId { get; set; } = null!;
    [JsonPropertyName("userId")] public string UserId { get; set; } = null!;

    public static string GetPk(NotificationType type) => $"notifsub#{type.ToString().ToLowerInvariant()}";
    public static string GetSk(string subscriberTenantId) => subscriberTenantId;
}

/// <summary>Send receipt so a notification goes out once per key (edit id, day). TTL 14 days.</summary>
public class NotificationSentEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Type, Key);

    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("type")] public NotificationType Type { get; set; }
    [JsonPropertyName("key")] public string Key { get; set; } = null!;
    [JsonPropertyName("sentAt")] public DateTime SentAt { get; set; }
    [JsonPropertyName("ttl")] public long Ttl => SentAt.AddDays(14).ToUnixTimeSeconds();

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#notifsent";
    public static string GetSk(NotificationType type, string key) => $"{type.ToString().ToLowerInvariant()}#{key}";
}

/// <summary>
/// The in-app notification inbox (Bildirimler): one row per event the Notifier handles — morning outfit, weekly edit, friend
/// ratings digest, price drop, follow request. The sort key is the push receipt key (type + key), so an event lands once.
/// Ids only (edit id, day, product id, handle) — sentences are built in the app. Kept 90 days (TTL; reads skip expired rows).
/// </summary>
public class NotificationInboxEntity : IEntity
{
    public const int RetentionDays = 90;

    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Type, Key);

    /// <summary>ULID (time ordered); the id the app marks as read.</summary>
    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;
    [JsonPropertyName("type")] public NotificationType Type { get; set; }
    [JsonPropertyName("key")] public string Key { get; set; } = null!;
    [JsonPropertyName("data")] public Dictionary<string, string> Data { get; set; } = [];
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("readAt")] public DateTime? ReadAt { get; set; }
    [JsonPropertyName("ttl")] public long Ttl => CreatedAt.AddDays(RetentionDays).ToUnixTimeSeconds();

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#inbox";
    public static string GetSk(NotificationType type, string key) => $"{type.ToString().ToLowerInvariant()}#{key}";
}

/// <summary>
/// Own analytics (README §9.2): no third-party SDK. No personal content: the actor is a salted hash of the tenant id,
/// properties are allow-listed scalars. TTL 400 days.
/// </summary>
public class AnalyticsEventEntity : IEntity
{
    public const int TtlDays = 400;

    [JsonPropertyName("pk")] public string Pk => GetPk(Day);
    [JsonPropertyName("sk")] public string Sk => GetSk(ReceivedAt, Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("day")] public string Day { get; set; } = null!;                    // yyyy-MM-dd UTC of OccurredAt
    [JsonPropertyName("name")] public string Name { get; set; } = null!;
    [JsonPropertyName("actor")] public string Actor { get; set; } = null!;
    [JsonPropertyName("occurredAt")] public DateTime OccurredAt { get; set; }
    [JsonPropertyName("receivedAt")] public DateTime ReceivedAt { get; set; }
    [JsonPropertyName("platform")] public string? Platform { get; set; }
    [JsonPropertyName("appVersion")] public string? AppVersion { get; set; }
    [JsonPropertyName("props")] public Dictionary<string, string> Props { get; set; } = [];
    [JsonPropertyName("ttl")] public long Ttl => ReceivedAt.AddDays(TtlDays).ToUnixTimeSeconds();

    public static string GetPk(string day) => $"analytics#{day}";
    public static string GetSk(DateTime receivedAt, string id) =>
        $"{receivedAt.ToUnixTimeMilliseconds().ToString("D13", System.Globalization.CultureInfo.InvariantCulture)}#{id}";
}

/// <summary>
/// Per-actor copy of an <see cref="AnalyticsEventEntity"/>, written with it: the user's own events in one partition,
/// newest last (sk = OccurredAt ms + id). Keyed by the same one-way actor hash, never by the tenant id in clear, so the
/// pseudonymisation of the day partitions is unchanged; Droblet derives the key from the tenant id only to answer the
/// user's own requests: "Verilerimi indir" reads this partition with one Query, account deletion removes it and, through
/// it, the day-partition rows (DeletionPlan + AccountDeletionService). Same 400-day TTL as the event.
/// </summary>
public class AnalyticsActorEventEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPkForActor(Actor);
    [JsonPropertyName("sk")] public string Sk => GetSk(OccurredAt, Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    [JsonPropertyName("actor")] public string Actor { get; set; } = null!;
    [JsonPropertyName("day")] public string Day { get; set; } = null!;                    // the event row: pk analytics#{day}
    [JsonPropertyName("name")] public string Name { get; set; } = null!;
    [JsonPropertyName("occurredAt")] public DateTime OccurredAt { get; set; }
    [JsonPropertyName("receivedAt")] public DateTime ReceivedAt { get; set; }             // the event row: sk {receivedAt ms}#{id}
    [JsonPropertyName("platform")] public string? Platform { get; set; }
    [JsonPropertyName("appVersion")] public string? AppVersion { get; set; }
    [JsonPropertyName("props")] public Dictionary<string, string> Props { get; set; } = [];
    [JsonPropertyName("ttl")] public long Ttl => ReceivedAt.AddDays(AnalyticsEventEntity.TtlDays).ToUnixTimeSeconds();

    /// <summary>Tenant-scoped through the hash (listed in DeletionPlan): the tenant id itself is never stored here.</summary>
    public static string GetPk(string tenantId) => GetPkForActor(Services.AnalyticsRules.Actor(tenantId));
    public static string GetPkForActor(string actor) => $"analytics-actor#{actor}";
    public static string GetSk(DateTime occurredAt, string id) =>
        $"{occurredAt.ToUnixTimeMilliseconds().ToString("D13", System.Globalization.CultureInfo.InvariantCulture)}#{id}";

    /// <summary>Key of the day-partition row this copy belongs to.</summary>
    public (string Pk, string Sk) EventKey => (AnalyticsEventEntity.GetPk(Day), AnalyticsEventEntity.GetSk(ReceivedAt, Id));
}

/// <summary>Global weather cache: one row per location and calendar day. Stale rows are ignored by FetchedAt, removed by TTL.</summary>
public class WeatherForecastEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(LocationKey);
    [JsonPropertyName("sk")] public string Sk => GetSk(Date);

    [JsonPropertyName("locationKey")] public string LocationKey { get; set; } = null!;
    [JsonPropertyName("date")] public string Date { get; set; } = null!;                  // yyyy-MM-dd, local day of the location
    [JsonPropertyName("minC")] public double MinC { get; set; }
    [JsonPropertyName("maxC")] public double MaxC { get; set; }
    [JsonPropertyName("condition")] public WeatherCondition Condition { get; set; }
    [JsonPropertyName("weatherCode")] public int WeatherCode { get; set; }
    [JsonPropertyName("precipitationProbability")] public int? PrecipitationProbability { get; set; }
    [JsonPropertyName("fetchedAt")] public DateTime FetchedAt { get; set; }
    [JsonPropertyName("ttl")] public long Ttl { get; set; }

    public static string GetPk(string locationKey) => $"weather#{locationKey}";
    public static string GetSk(string date) => date;
}

/// <summary>Global city reference, filled from the geocoding provider when a city is searched.</summary>
public class CityEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")] public string Id { get; set; } = null!;
    /// <summary>Localized names as the geocoding provider returned them, keyed by language.</summary>
    [JsonPropertyName("name")] public Dictionary<string, string> Name { get; set; } = [];
    [JsonPropertyName("region")] public Dictionary<string, string>? Region { get; set; }
    [JsonPropertyName("country")] public Dictionary<string, string>? Country { get; set; }
    [JsonPropertyName("countryCode")] public string? CountryCode { get; set; }
    [JsonPropertyName("latitude")] public double Latitude { get; set; }
    [JsonPropertyName("longitude")] public double Longitude { get; set; }
    [JsonPropertyName("timeZone")] public string? TimeZone { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    public static string GetPk() => "reference#city";
    public static string GetSk(string cityId) => cityId;
}
