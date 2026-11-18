using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services;

/// <summary>
/// E11 (screen 29): closet visibility, notification preferences, device registration. Visibility and notification
/// preferences are available in every plan (SECURITY_ENGINEER.md — rights that never close).
/// </summary>
public sealed class SettingsService(
    IRepository repository,
    IWeatherService weather,
    IOptionsMonitor<NotificationOptions> options,
    TimeProvider timeProvider) : ISettingsService
{
    private const int VisibilityAttempts = 1;

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    // ── Visibility ──────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<(SettingsOutcome Outcome, TenantEntity? Tenant)> SetVisibilityAsync(string tenantId, ClosetVisibility visibility, long baseVersion, CancellationToken ct)
    {
        for (var attempt = 0; attempt < VisibilityAttempts; attempt++)
        {
            var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct);
            if (tenant is null)
                return (SettingsOutcome.NotFound, null);
            if (tenant.Version != baseVersion)
                return (SettingsOutcome.Conflict, tenant);

            tenant.ClosetVisibility = visibility;
            tenant.UpdatedAt = Now;

            // PublicProfileIndex changes in the same transaction, so discovery can never list a closet that is no longer public.
            var operations = new List<TransactWriteOperation> { TransactWriteOperation.PutVersioned(tenant) };
            operations.AddRange(PublicIndexOperations(tenant, tenant.UpdatedAt));

            var result = await repository.TransactWriteAsync(operations, ct);
            if (result.Applied)
                return (SettingsOutcome.Ok, tenant);
        }

        var current = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct);
        return current is null ? (SettingsOutcome.NotFound, null) : (SettingsOutcome.Conflict, current);
    }

    /// <summary>Listed only when Public; Teen accounts are never listed (A-5). Every other segment partition is cleared.</summary>
    public static IEnumerable<TransactWriteOperation> PublicIndexOperations(TenantEntity tenant, DateTime now)
    {
        var segment = tenant.Segment ?? Segment.Women;
        var listed = tenant.ClosetVisibility == ClosetVisibility.Public && segment != Segment.Teen;
        foreach (var s in System.Enum.GetValues<Segment>())
        {
            if (listed && s == segment)
                yield return TransactWriteOperation.Put(new PublicProfileIndexEntity { Segment = s, PublicTenantId = tenant.Id, CreatedAt = now });
            else
                yield return TransactWriteOperation.Delete(PublicProfileIndexEntity.GetPk(s), PublicProfileIndexEntity.GetSk(tenant.Id));
        }
    }

    // ── Notification preferences ────────────────────────────────────────────────────────────────────────────────

    private Task<NotificationPrefEntity?> PrefAsync(string tenantId, string userId, CancellationToken ct) =>
        repository.GetAsync<NotificationPrefEntity>(NotificationPrefEntity.GetPk(tenantId), NotificationPrefEntity.GetSk(userId), ct);

    private NotificationPrefEntity DefaultPref(string tenantId, string userId, bool enabled, string? timeZone) => new()
    {
        TenantId = tenantId,
        UserId = userId,
        MorningOutfit = enabled,
        MorningOutfitLocalTime = ReminderRules.IsValidLocalTime(options.CurrentValue.DefaultMorningLocal) ? options.CurrentValue.DefaultMorningLocal : "07:30",
        WeeklyEdit = enabled,
        FriendRatings = enabled,
        TimeZone = ReminderRules.IsValidTimeZone(timeZone) ? timeZone! : options.CurrentValue.DefaultTimeZone,
    };

    private static NotificationPrefsDto ToDto(NotificationPrefEntity p) =>
        new(p.MorningOutfit, p.MorningOutfitLocalTime, p.WeeklyEdit, p.FriendRatings, p.TimeZone, p.Version, p.Version == 0 ? null : p.UpdatedAt);

    public async Task<NotificationPrefsDto> GetNotificationPrefsAsync(string tenantId, string userId, CancellationToken ct) =>
        ToDto(await PrefAsync(tenantId, userId, ct) ?? DefaultPref(tenantId, userId, enabled: false, timeZone: null));

    public async Task<(SettingsOutcome Outcome, NotificationPrefsDto Prefs)> SetNotificationPrefsAsync(
        string tenantId, string userId, NotificationPrefsInput input, CancellationToken ct)
    {
        var existing = await PrefAsync(tenantId, userId, ct);
        if ((existing?.Version ?? 0) != input.BaseVersion)
            return (SettingsOutcome.Conflict, ToDto(existing ?? DefaultPref(tenantId, userId, false, null)));

        var updated = new NotificationPrefEntity
        {
            TenantId = tenantId,
            UserId = userId,
            MorningOutfit = input.MorningOutfit,
            MorningOutfitLocalTime = input.MorningOutfitLocalTime,
            WeeklyEdit = input.WeeklyEdit,
            FriendRatings = input.FriendRatings,
            TimeZone = input.TimeZone,
            UpdatedAt = Now,
            Version = input.BaseVersion,
        };
        if (!await repository.SaveIfVersionAsync(updated, input.BaseVersion, ct))
        {
            var current = await PrefAsync(tenantId, userId, ct);
            return (SettingsOutcome.Conflict, ToDto(current ?? DefaultPref(tenantId, userId, false, null)));
        }

        await SyncSendListsAsync(existing, updated, ct);
        return (SettingsOutcome.Ok, ToDto(updated));
    }

    /// <summary>Keeps the Notifier's lists (reminder slot, per-type subscribers) equal to the preference. Idempotent.</summary>
    private async Task SyncSendListsAsync(NotificationPrefEntity? previous, NotificationPrefEntity current, CancellationToken ct)
    {
        var tenantId = current.TenantId;
        if (previous is { MorningOutfit: true } && (!current.MorningOutfit || previous.MorningOutfitLocalTime != current.MorningOutfitLocalTime))
            await repository.DeleteAsync(ReminderSlotEntity.GetPk(previous.MorningOutfitLocalTime), ReminderSlotEntity.GetSk(tenantId), ct);
        if (current.MorningOutfit)
        {
            await repository.SaveAsync(new ReminderSlotEntity
            {
                LocalTime = current.MorningOutfitLocalTime, SubscriberTenantId = tenantId, UserId = current.UserId, TimeZone = current.TimeZone,
            }, ct);
        }

        await SyncSubscriberAsync(NotificationType.WeeklyEdit, current.WeeklyEdit, current, ct);
        await SyncSubscriberAsync(NotificationType.FriendRatings, current.FriendRatings, current, ct);
    }

    private async Task SyncSubscriberAsync(NotificationType type, bool enabled, NotificationPrefEntity pref, CancellationToken ct)
    {
        if (enabled)
            await repository.SaveAsync(new NotificationSubscriberEntity { Type = type, SubscriberTenantId = pref.TenantId, UserId = pref.UserId }, ct);
        else
            await repository.DeleteAsync(NotificationSubscriberEntity.GetPk(type), NotificationSubscriberEntity.GetSk(pref.TenantId), ct);
    }

    // ── Devices ─────────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<(SettingsOutcome Outcome, DeviceDto? Device)> RegisterDeviceAsync(
        string tenantId, string userId, string deviceId, DevicePlatform platform, string? pushToken, string? timeZone, CancellationToken ct)
    {
        var pk = DeviceEntity.GetPk(tenantId);
        var existing = await repository.GetAsync<DeviceEntity>(pk, DeviceEntity.GetSk(deviceId), ct);
        if (existing is null && (await repository.GetKeysAsync(pk, ct)).Count >= options.CurrentValue.MaxDevicesPerTenant)
            return (SettingsOutcome.LimitReached, null);

        var device = new DeviceEntity
        {
            TenantId = tenantId,
            DeviceId = deviceId,
            Platform = platform.ToString().ToLowerInvariant(),
            PushToken = string.IsNullOrWhiteSpace(pushToken) ? null : pushToken,
            UpdatedAt = Now,
        };
        await repository.SaveAsync(device, ct);

        // Proposal (owner confirms): when push permission is first granted, the three notification types start switched on.
        if (device.PushToken is not null && await PrefAsync(tenantId, userId, ct) is null)
        {
            var pref = DefaultPref(tenantId, userId, enabled: true, timeZone);
            pref.UpdatedAt = device.UpdatedAt;
            if (await repository.SaveIfVersionAsync(pref, 0, ct))
                await SyncSendListsAsync(null, pref, ct);
        }

        return (SettingsOutcome.Ok, ToDto(device));
    }

    public Task RemoveDeviceAsync(string tenantId, string deviceId, CancellationToken ct) =>
        repository.DeleteAsync(DeviceEntity.GetPk(tenantId), DeviceEntity.GetSk(deviceId), ct);

    private static DeviceDto ToDto(DeviceEntity device) => new(
        device.DeviceId,
        System.Enum.TryParse<DevicePlatform>(device.Platform, ignoreCase: true, out var platform) ? platform : DevicePlatform.Ios,
        device.PushToken is not null,
        device.UpdatedAt);

    // ── Aggregate ───────────────────────────────────────────────────────────────────────────────────────────────

    public async Task<SettingsDto?> GetSettingsAsync(string tenantId, string userId, CancellationToken ct)
    {
        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct);
        if (tenant is null)
            return null;

        var devices = await repository.GetAllAsync<DeviceEntity>(DeviceEntity.GetPk(tenantId), ct);
        var city = string.IsNullOrEmpty(tenant.CityId) ? null : await weather.GetCityAsync(tenant.CityId, ct);
        return new SettingsDto(tenant.ClosetVisibility, tenant.Language, tenant.CityId, city,
            await GetNotificationPrefsAsync(tenantId, userId, ct),
            devices.OrderByDescending(d => d.UpdatedAt).Select(ToDto).ToList(),
            tenant.Version);
    }
}
