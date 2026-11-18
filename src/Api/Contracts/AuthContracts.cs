using Domain.Services;
using FluentValidation;

namespace Api.Contracts;

public record AuthResponse(
    string AccessToken,
    DateTime AccessTokenExpiresAt,
    string RefreshToken,
    DateTime RefreshTokenExpiresAt,
    string UserId,
    string TenantId,
    bool IsNewUser)
{
    public static AuthResponse From(AuthTokens t) =>
        new(t.AccessToken, t.AccessTokenExpiresAt, t.RefreshToken, t.RefreshTokenExpiresAt, t.UserId, t.TenantId, t.IsNewUser);
}

public static class PasswordRules
{
    public const int MinLength = 8;
    public const int MaxLength = 128;

    public static IRuleBuilderOptions<T, string> Password<T>(this IRuleBuilder<T, string> rule) =>
        rule.NotEmpty().WithErrorCode("password_required")
            .MinimumLength(MinLength).WithErrorCode("password_too_short")
            .MaximumLength(MaxLength).WithErrorCode("password_too_long");

    public static IRuleBuilderOptions<T, string> Email<T>(this IRuleBuilder<T, string> rule) =>
        rule.NotEmpty().WithErrorCode("email_required")
            .MaximumLength(254).WithErrorCode("email_too_long")
            .EmailAddress().WithErrorCode("email_invalid");
}
