using System.Globalization;
using System.Security.Cryptography;
using Domain.Enum;

namespace Domain.Services;

/// <summary>Invite codes carried by every shared link (brief §5.7). 8 chars, no look-alike characters.</summary>
public static class InviteCodeRules
{
    public const int Length = 8;
    private const string Alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

    public static string Generate()
    {
        Span<char> chars = stackalloc char[Length];
        for (var i = 0; i < Length; i++)
            chars[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
        return new string(chars);
    }

    public static string Normalize(string? code) => (code ?? "").Trim().ToUpperInvariant();

    public static bool IsValid(string? code) =>
        Normalize(code) is { Length: Length } normalized && normalized.All(c => Alphabet.Contains(c));

    public static string Link(string baseUrl, string code, ShareTargetKind targetKind = ShareTargetKind.App, string? targetId = null, string? ownerHandle = null)
    {
        var url = $"{baseUrl.TrimEnd('/')}/{code}";
        if (targetKind == ShareTargetKind.App)
            return url;
        url += $"?t={targetKind.ToString().ToLowerInvariant()}";
        if (!string.IsNullOrEmpty(targetId))
            url += $"&id={Uri.EscapeDataString(targetId)}";
        if (!string.IsNullOrEmpty(ownerHandle))
            url += $"&u={Uri.EscapeDataString(ownerHandle)}";
        return url;
    }

    /// <summary>Attribution: once per account, never to yourself, only while the account is new (deferred deep link).</summary>
    public static InviteAttributionDecision Decide(string inviteeTenantId, string? inviterTenantId, bool alreadyAttributed, DateTime accountCreatedAt, DateTime nowUtc, int windowDays)
    {
        if (inviterTenantId is null)
            return InviteAttributionDecision.CodeNotFound;
        if (inviterTenantId == inviteeTenantId)
            return InviteAttributionDecision.Self;
        if (alreadyAttributed)
            return InviteAttributionDecision.AlreadyAttributed;
        if (nowUtc - accountCreatedAt > TimeSpan.FromDays(windowDays))
            return InviteAttributionDecision.WindowClosed;
        return InviteAttributionDecision.Attribute;
    }
}

public enum InviteAttributionDecision { Attribute, CodeNotFound, Self, AlreadyAttributed, WindowClosed }

/// <summary>
/// Morning reminder timing. The user picks a LOCAL time (quarter hours) and a time zone; the Reminder job runs every
/// 15 minutes and asks "whose local time is this slot right now?" — DST never shifts the reminder.
/// </summary>
public static class ReminderRules
{
    public const int SlotMinutes = 15;

    public static bool IsValidLocalTime(string? value) =>
        TimeOnly.TryParseExact(value, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var time)
        && time.Minute % SlotMinutes == 0;

    public static bool IsValidTimeZone(string? id) =>
        !string.IsNullOrWhiteSpace(id) && id.Length <= 64 && TimeZoneInfo.TryFindSystemTimeZoneById(id, out _);

    public static string Slot(TimeOnly time) =>
        new TimeOnly(time.Hour, time.Minute - time.Minute % SlotMinutes).ToString("HH:mm", CultureInfo.InvariantCulture);

    public static DateTime LocalNow(string timeZoneId, DateTime utcNow) =>
        TimeZoneInfo.TryFindSystemTimeZoneById(timeZoneId, out var zone)
            ? TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utcNow, DateTimeKind.Utc), zone)
            : utcNow;

    public static bool IsDueNow(string localTime, string timeZoneId, DateTime utcNow) =>
        Slot(TimeOnly.FromDateTime(LocalNow(timeZoneId, utcNow))) == localTime;

    /// <summary>UTC offsets in use anywhere (minutes), standard and daylight.</summary>
    private static readonly int[] OffsetsInUse =
    [
        -720, -660, -600, -570, -540, -480, -420, -360, -300, -240, -210, -180, -150, -120, -60, 0,
        60, 120, 180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 525, 540, 570, 600, 630, 660, 720, 765, 780, 825, 840,
    ];

    /// <summary>The local "HH:mm" slots that are current somewhere on earth — the slot partitions the Reminder job reads.</summary>
    public static IReadOnlyList<string> LocalSlotsNow(DateTime utcNow)
    {
        var slots = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var offset in OffsetsInUse)
            slots.Add(Slot(TimeOnly.FromDateTime(utcNow.AddMinutes(offset))));
        return slots.ToList();
    }

    public static string LocalDay(string timeZoneId, DateTime utcNow) =>
        WeeklyEditRules.Format(DateOnly.FromDateTime(LocalNow(timeZoneId, utcNow)));
}
