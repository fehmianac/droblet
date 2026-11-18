using Domain.Enum;
using Domain.Services;

namespace Domain.Domain;

public record CreditsDto(int MonthlyAllowance, int AllowanceRemaining, int PackRemaining, int TotalRemaining, DateTime? ResetsAt);

/// <summary>AI garment recognitions: limit / remaining null = unlimited (members). used = completed + in progress.</summary>
public record ItemRecognitionDto(int? Limit, int Used, int? Remaining);

public record EntitlementDto(Tier Tier, string? ProductId, StorePlatform? Platform, DateTime? ExpiresAt, CreditsDto Credits, ItemRecognitionDto ItemRecognition);

public static class EntitlementDtoMapper
{
    public static EntitlementDto ToDto(this EntitlementSnapshot snapshot) => new(
        snapshot.Active.Tier,
        snapshot.Active.Source?.ProductId,
        snapshot.Active.Source?.Platform,
        snapshot.Active.Source?.ExpiresAt,
        new CreditsDto(
            snapshot.Credits.MonthlyAllowance,
            snapshot.Credits.AllowanceRemaining,
            snapshot.Credits.PackRemaining,
            snapshot.Credits.TotalRemaining,
            snapshot.Credits.ResetsAt),
        (snapshot.ItemRecognition ?? EntitlementPolicy.ItemRecognition(snapshot.Active.Tier, 0, 0)).ToDto());

    public static ItemRecognitionDto ToDto(this ItemRecognitionQuota quota) => new(quota.Limit, quota.Used, quota.Remaining);
}
