using System.Text.Json;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Enum;
using Domain.Services.Admin;
using Domain.Services.Ai;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Contracts;

// Admin panel request bodies (docs/api/admin.md). Every body is validated on the server; codes are snake_case.

public record AdminLoginRequest(string Email, string Password);
public record AdminLoginResponse(string ChallengeId, DateTime ExpiresAt, int CodeLength);
public record AdminVerifyRequest(string ChallengeId, string Code);
public record AdminRefreshRequest(string RefreshToken);
public record AdminLogoutRequest(string? RefreshToken);
public record AdminForgotPasswordRequest(string Email);
public record AdminResetPasswordRequest(string Token, string NewPassword);
public record AdminChangePasswordRequest(string CurrentPassword, string NewPassword);
public record AdminUserCreateRequest(string Email, string Name, AdminRole Role);
public record AdminUserUpdateRequest(string Name, AdminRole Role, bool Disabled);
public record AdminSuspendRequest(string Reason);
public record AdminTestPremiumRequest(int Days, string? Note);
public record AdminCreditsRequest(int Credits, string? Note);
public record AdminImageUploadRequest(CatalogImagePurpose Purpose, string ContentType);
public record AdminSettingUpdateRequest(Dictionary<string, JsonElement>? Values);

public record AdminAiDraftRequest(string? Text);

public record AdminAiPublishRequest(string? Note, int? ExpectedVersion);

public record AdminAiRollbackRequest(int Version, string? Note);

public record AdminAiTrialRequest(Domain.Entity.AiTrialType Type, string? Key, string? Text, string? Input, List<string>? ImageUrls, string? Model, string? ModelKind,
    string? Effort, string? ServiceTier);

public record AdminLibraryItemRequest(
    IReadOnlyDictionary<string, string>? Name, ItemCategory? Category, IReadOnlyList<string>? ColorIds, string? Fabric,
    IReadOnlyList<Season>? Seasons, string? ImageUrl, int SortOrder, bool Retired = false);

public static class AdminPasswordRules
{
    public const int MinLength = 10;
    public const int MaxLength = 128;

    /// <summary>At least one letter and one digit, not one repeated character.</summary>
    public static bool IsStrongEnough(string? password) =>
        password is not null && password.Any(char.IsLetter) && password.Any(char.IsDigit) && password.Distinct().Count() > 3;

    public static IRuleBuilderOptions<T, string> AdminPassword<T>(this IRuleBuilder<T, string> rule) =>
        rule.NotEmpty().WithErrorCode("password_required")
            .MinimumLength(MinLength).WithErrorCode("password_too_short")
            .MaximumLength(MaxLength).WithErrorCode("password_too_long")
            .Must(IsStrongEnough).WithErrorCode("password_too_weak");
}

public class AdminLoginRequestValidator : AbstractValidator<AdminLoginRequest>
{
    public AdminLoginRequestValidator()
    {
        RuleFor(x => x.Email).NotEmpty().WithErrorCode("email_required").MaximumLength(254).WithErrorCode("email_too_long");
        RuleFor(x => x.Password).NotEmpty().WithErrorCode("password_required").MaximumLength(AdminPasswordRules.MaxLength).WithErrorCode("password_too_long");
    }
}

public class AdminVerifyRequestValidator : AbstractValidator<AdminVerifyRequest>
{
    public AdminVerifyRequestValidator()
    {
        RuleFor(x => x.ChallengeId).NotEmpty().WithErrorCode("challenge_required").MaximumLength(100).WithErrorCode("challenge_invalid");
        RuleFor(x => x.Code).Matches("^[0-9]{6}$").WithErrorCode("code_invalid");
    }
}

public class AdminRefreshRequestValidator : AbstractValidator<AdminRefreshRequest>
{
    public AdminRefreshRequestValidator() => RuleFor(x => x.RefreshToken).NotEmpty().WithErrorCode("refresh_token_required").MaximumLength(200).WithErrorCode("refresh_token_invalid");
}

public class AdminForgotPasswordRequestValidator : AbstractValidator<AdminForgotPasswordRequest>
{
    public AdminForgotPasswordRequestValidator() => RuleFor(x => x.Email).NotEmpty().WithErrorCode("email_required").EmailAddress().WithErrorCode("email_invalid").MaximumLength(254).WithErrorCode("email_too_long");
}

public class AdminResetPasswordRequestValidator : AbstractValidator<AdminResetPasswordRequest>
{
    public AdminResetPasswordRequestValidator()
    {
        RuleFor(x => x.Token).NotEmpty().WithErrorCode("token_required").MaximumLength(200).WithErrorCode("token_invalid");
        RuleFor(x => x.NewPassword).AdminPassword();
    }
}

public class AdminChangePasswordRequestValidator : AbstractValidator<AdminChangePasswordRequest>
{
    public AdminChangePasswordRequestValidator()
    {
        RuleFor(x => x.CurrentPassword).NotEmpty().WithErrorCode("password_required").MaximumLength(AdminPasswordRules.MaxLength).WithErrorCode("password_too_long");
        RuleFor(x => x.NewPassword).AdminPassword();
    }
}

public class AdminUserCreateRequestValidator : AbstractValidator<AdminUserCreateRequest>
{
    public AdminUserCreateRequestValidator()
    {
        RuleFor(x => x.Email).NotEmpty().WithErrorCode("email_required").EmailAddress().WithErrorCode("email_invalid").MaximumLength(254).WithErrorCode("email_too_long");
        RuleFor(x => x.Name).NotEmpty().WithErrorCode("name_required").MaximumLength(80).WithErrorCode("name_too_long");
        RuleFor(x => x.Role).IsInEnum().WithErrorCode("role_invalid");
    }
}

public class AdminUserUpdateRequestValidator : AbstractValidator<AdminUserUpdateRequest>
{
    public AdminUserUpdateRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().WithErrorCode("name_required").MaximumLength(80).WithErrorCode("name_too_long");
        RuleFor(x => x.Role).IsInEnum().WithErrorCode("role_invalid");
    }
}

public class AdminSuspendRequestValidator : AbstractValidator<AdminSuspendRequest>
{
    public AdminSuspendRequestValidator() => RuleFor(x => x.Reason).NotEmpty().WithErrorCode("reason_required").MaximumLength(500).WithErrorCode("reason_too_long");
}

public class AdminTestPremiumRequestValidator : AbstractValidator<AdminTestPremiumRequest>
{
    public AdminTestPremiumRequestValidator()
    {
        RuleFor(x => x.Days).InclusiveBetween(1, 90).WithErrorCode("days_out_of_range");
        RuleFor(x => x.Note).MaximumLength(500).WithErrorCode("note_too_long");
    }
}

public class AdminCreditsRequestValidator : AbstractValidator<AdminCreditsRequest>
{
    public AdminCreditsRequestValidator()
    {
        RuleFor(x => x.Credits).InclusiveBetween(1, 500).WithErrorCode("credits_out_of_range");
        RuleFor(x => x.Note).MaximumLength(500).WithErrorCode("note_too_long");
    }
}

public class AdminImageUploadRequestValidator : AbstractValidator<AdminImageUploadRequest>
{
    public AdminImageUploadRequestValidator()
    {
        RuleFor(x => x.Purpose).IsInEnum().WithErrorCode("purpose_invalid");
        RuleFor(x => x.ContentType).Must(t => t is "image/jpeg" or "image/png" or "image/webp").WithErrorCode("content_type_unsupported");
    }
}

/// <summary>Service outcome → HTTP result for the admin routes.</summary>
public static class AdminResults
{
    public static IResult ValidationErrors(IReadOnlyDictionary<string, string[]> errors)
    {
        var problem = new HttpValidationProblemDetails(errors.ToDictionary(e => e.Key, e => e.Value))
        {
            Title = ErrorCodes.ValidationFailed,
            Status = StatusCodes.Status400BadRequest,
            Type = "https://droblet.alatech.co/errors/validation_failed",
        };
        problem.Extensions["code"] = ErrorCodes.ValidationFailed;
        return TypedResults.Problem(problem);
    }

    public static IResult AdminUser(AdminUserOutcome outcome, object? value = null, int successStatus = StatusCodes.Status200OK) => outcome switch
    {
        AdminUserOutcome.Ok => successStatus switch
        {
            StatusCodes.Status201Created => Results.Created((string?)null, value),
            StatusCodes.Status202Accepted => Results.Accepted(),
            StatusCodes.Status204NoContent => Results.NoContent(),
            _ => Results.Ok(value),
        },
        AdminUserOutcome.NotFound => ApiResults.Problem(StatusCodes.Status404NotFound, ErrorCodes.NotFound),
        AdminUserOutcome.EmailTaken => ApiResults.Problem(StatusCodes.Status409Conflict, ErrorCodes.EmailTaken),
        AdminUserOutcome.CannotChangeSelf => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, ErrorCodes.CannotChangeSelf),
        _ => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, ErrorCodes.LastSuperAdmin),
    };

    public static IResult InvalidCode(int? attemptsLeft) => TypedResults.Problem(new ProblemDetails
    {
        Status = StatusCodes.Status401Unauthorized,
        Title = ErrorCodes.InvalidCode,
        Type = $"https://droblet.alatech.co/errors/{ErrorCodes.InvalidCode}",
        Extensions = { ["code"] = ErrorCodes.InvalidCode, ["attemptsLeft"] = attemptsLeft },
    });
}
