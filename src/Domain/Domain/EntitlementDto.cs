using Domain.Enum;
using Domain.Services;

namespace Domain.Domain;

public record CreditsDto(int MonthlyAllowance, int AllowanceRemaining, int PackRemaining, int TotalRemaining, DateTime? ResetsAt);

public record EntitlementDto(Tier Tier, string? ProductId, StorePlatform? Platform, DateTime? ExpiresAt, CreditsDto Credits);

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
            snapshot.Credits.ResetsAt));
}
