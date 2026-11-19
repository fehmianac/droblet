using Domain.Domain;
using Domain.Entity;
using Domain.Enum;

namespace Domain.Services;

public record NotificationPrefsDto(
    bool MorningOutfit,
    string MorningOutfitLocalTime,
    bool WeeklyEdit,
    bool FriendRatings,
    string TimeZone,
    long Version,
    DateTime? UpdatedAt,
    bool PriceDrop = false,
    bool FollowRequests = false);

public record DeviceDto(string DeviceId, DevicePlatform Platform, bool PushEnabled, DateTime UpdatedAt);

public record CityDto(string Id, string Name, string? Region, string? Country, string? CountryCode, double Latitude, double Longitude, string? TimeZone);

public record SettingsDto(
    ClosetVisibility ClosetVisibility,
    string Language,
    string? CityId,
    CityDto? City,
    NotificationPrefsDto Notifications,
    IReadOnlyList<DeviceDto> Devices,
    long ProfileVersion);

public sealed record NotificationPrefsInput(bool MorningOutfit, string MorningOutfitLocalTime, bool WeeklyEdit, bool FriendRatings, string TimeZone, long BaseVersion,
    bool? PriceDrop = null, bool? FollowRequests = null);

public enum SettingsOutcome { Ok, NotFound, Conflict, LimitReached }

public interface ISettingsService
{
    /// <summary>Versioned. Updates PublicProfileIndex in the same transaction. Conflict returns the current profile.</summary>
    Task<(SettingsOutcome Outcome, TenantEntity? Tenant)> SetVisibilityAsync(string tenantId, ClosetVisibility visibility, long baseVersion, CancellationToken ct);

    Task<NotificationPrefsDto> GetNotificationPrefsAsync(string tenantId, string userId, CancellationToken ct);
    Task<(SettingsOutcome Outcome, NotificationPrefsDto Prefs)> SetNotificationPrefsAsync(string tenantId, string userId, NotificationPrefsInput input, CancellationToken ct);

    /// <summary>Registers / refreshes a push token. The first registration with a token switches on the morning outfit (decision 9; the weekly edit needs marketing consent).</summary>
    Task<(SettingsOutcome Outcome, DeviceDto? Device)> RegisterDeviceAsync(
        string tenantId, string userId, string deviceId, DevicePlatform platform, string? pushToken, PushTokenType? pushTokenType, string? timeZone, CancellationToken ct);
    Task RemoveDeviceAsync(string tenantId, string deviceId, CancellationToken ct);

    Task<SettingsDto?> GetSettingsAsync(string tenantId, string userId, CancellationToken ct);
}

// ── Notification inbox ──────────────────────────────────────────────────────────────────────────────────────────

/// <summary>type = the push code (morning_outfit, weekly_edit, friend_ratings, price_drop, follow_request); data = ids only.</summary>
public sealed record InboxNotificationDto(string Id, string Type, DateTime CreatedAt, DateTime? ReadAt, IReadOnlyDictionary<string, string> Data);

public sealed record InboxPageDto(IReadOnlyList<InboxNotificationDto> Items, string? PageToken, int UnreadCount);

public sealed record InboxReadResultDto(int UnreadCount);

public interface INotificationInbox
{
    /// <summary>Records an event once per (type, key): a repeated call keeps the first row (and its read state). True when added.</summary>
    Task<bool> AddAsync(string tenantId, NotificationType type, string key, IReadOnlyDictionary<string, string> data, DateTime now, CancellationToken ct);

    /// <summary>Newest first. pageToken = the opaque cursor of the previous page. Expired rows (TTL not yet applied) are skipped.</summary>
    Task<InboxPageDto> GetPageAsync(string tenantId, string? pageToken, int limit, CancellationToken ct);

    /// <summary>Marks the given ids (null = every unread row) as read; unknown ids are ignored. Returns the unread count left.</summary>
    Task<InboxReadResultDto> MarkReadAsync(string tenantId, IReadOnlyCollection<string>? ids, CancellationToken ct);
}

// ── Analytics ───────────────────────────────────────────────────────────────────────────────────────────────────

public sealed record AnalyticsBatchResult(int Accepted, IReadOnlyList<AnalyticsEventRejection> Rejected);

public interface IAnalyticsService
{
    Task<AnalyticsBatchResult> RecordBatchAsync(string tenantId, IReadOnlyList<AnalyticsEventInput> events, string? platform, string? appVersion, CancellationToken ct);
    /// <summary>Server-side (authoritative) events: brand_site_opened, conversion, invited_install. Never throws.</summary>
    Task RecordServerEventAsync(string name, string tenantId, IReadOnlyDictionary<string, string?>? props, CancellationToken ct);
    Task<FunnelReport> GetFunnelAsync(DateOnly from, DateOnly to, CancellationToken ct);
}

// ── Weather ─────────────────────────────────────────────────────────────────────────────────────────────────────

public sealed record DailyForecast(string Date, double MinC, double MaxC, WeatherCondition Condition, int WeatherCode = 0, int? PrecipitationProbability = null);

public sealed record WeatherForecast(string LocationKey, CityDto? City, DateTime FetchedAt, IReadOnlyList<DailyForecast> Days);

public sealed class WeatherUnavailableException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>
/// Daily + 7-day forecast (brief §6) by city or by coordinates, served from a global TTL cache.
/// Coordinates are rounded to 0.1° before they are used or stored: only an approximate location ever leaves the request.
/// </summary>
public interface IWeatherService
{
    /// <summary>Default length of <c>GET v1/weather</c> (brief §6: daily + 7-day forecast).</summary>
    public const int MaxDays = 7;

    /// <summary>
    /// How far ahead the provider forecasts (Open-Meteo: 16 days, today included). Every fetch caches the whole horizon,
    /// so a trip a week or two away still gets its days; dates after it are simply unknown ("not available yet").
    /// </summary>
    public const int HorizonDays = 16;

    /// <summary>Null when the city id is unknown. Throws <see cref="WeatherUnavailableException"/> when the provider fails and nothing is cached.</summary>
    Task<WeatherForecast?> GetForecastByCityAsync(string cityId, int days, CancellationToken ct);
    Task<WeatherForecast> GetForecastByLocationAsync(double latitude, double longitude, int days, CancellationToken ct);
    /// <summary>City names come back in the request language (provider data, cached per language).</summary>
    Task<IReadOnlyList<CityDto>> SearchCitiesAsync(string query, CancellationToken ct);
    Task<CityDto?> GetCityAsync(string cityId, CancellationToken ct);
}

/// <summary>The external forecast / geocoding provider behind <see cref="IWeatherService"/>.</summary>
public interface IWeatherProvider
{
    Task<IReadOnlyList<DailyForecast>> GetDailyAsync(double latitude, double longitude, int days, CancellationToken ct);
    Task<IReadOnlyList<CityDto>> SearchCitiesAsync(string query, string language, int count, CancellationToken ct);
}

// ── Push ────────────────────────────────────────────────────────────────────────────────────────────────────────

public sealed record PushMessage(string Token, string Title, string Body, IReadOnlyDictionary<string, string> Data)
{
    /// <summary>Which provider can deliver to Token: FCM (Android / FCM tokens) or APNs (raw iOS device token).</summary>
    public PushTokenType TokenType { get; init; } = PushTokenType.Fcm;
}

public enum PushResult { Sent, Unregistered, Failed, NotConfigured }

/// <summary>FCM HTTP v1 for iOS and Android. Photos / try-on images are never put in a notification.</summary>
public interface IPushProvider
{
    Task<PushResult> SendAsync(PushMessage message, CancellationToken ct);
}

/// <summary>
/// Seam to the plan slice: does the tenant have something to wear today (a planned look that still exists)?
/// Implemented by Infrastructure.Services.Integration.PlanMorningOutfitCheck on the PlanDay / Look partitions.
/// </summary>
public interface IMorningOutfitCheck
{
    Task<bool> HasOutfitForTodayAsync(string tenantId, string localDay, CancellationToken ct);
}
