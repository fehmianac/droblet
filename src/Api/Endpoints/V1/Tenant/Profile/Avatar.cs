using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Entity;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Api.Endpoints.V1.Tenant.Profile;

// Profile picture: shown to whoever may see the closet. Kept apart from the private body / face photos (own upload slots,
// own S3 prefix tenant/{id}/avatar/, own row) — see AvatarService.

public sealed record AvatarUploadUrlRequest(string ContentType);

public sealed record AvatarUploadDto(string UploadId, string Url, IReadOnlyDictionary<string, string> Fields, DateTime ExpiresAt, long MaxBytes);

public class AvatarUploadUrlRequestValidator : AbstractValidator<AvatarUploadUrlRequest>
{
    public AvatarUploadUrlRequestValidator(IOptionsMonitor<PhotoOptions> options)
    {
        RuleFor(x => x.ContentType).NotEmpty().WithErrorCode("content_type_required")
            .Must(ct => options.CurrentValue.AllowedContentTypes.Contains(ct)).WithErrorCode("content_type_unsupported");
    }
}

public class PostAvatarUploadUrl : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] AvatarUploadUrlRequest request,
        [FromServices] IValidator<AvatarUploadUrlRequest> validator,
        [FromServices] IApiContext apiContext,
        [FromServices] IAvatarService avatars,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var slot = await avatars.CreateUploadAsync(apiContext.TenantId, request.ContentType, cancellationToken);
        return Results.Ok(new AvatarUploadDto(slot.UploadId, slot.Upload.Url, slot.Upload.Fields, slot.Upload.ExpiresAt, slot.MaxBytes));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/tenant/profile/avatar/upload-url", Handler)
            .Produces<AvatarUploadDto>(StatusCodes.Status200OK)
            .Validated()
            .Tenant("Tenant Profile", "Get a presigned upload for my profile picture",
                "Presigned POST (multipart form: all `fields` first, then `file`); exact Content-Type (image/jpeg | image/png) and max size " +
                "(Photos:AvatarMaxUploadBytes, 1 MB) enforced by S3. The app resizes to 512 px first. Then call PUT v1/tenant/profile/avatar.");
}

public sealed record ActivateAvatarRequest(string UploadId, string ClientMutationId);

public class ActivateAvatarRequestValidator : AbstractValidator<ActivateAvatarRequest>
{
    public ActivateAvatarRequestValidator()
    {
        RuleFor(x => x.UploadId).Must(Ulid.IsValid).WithErrorCode("upload_id_invalid");
        RuleFor(x => x.ClientMutationId).Must(Ulid.IsValid).WithErrorCode("client_mutation_id_invalid");
    }
}

public class PutAvatar : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] ActivateAvatarRequest request,
        [FromServices] IValidator<ActivateAvatarRequest> validator,
        [FromServices] IApiContext apiContext,
        [FromServices] IAvatarService avatars,
        [FromServices] IRepository repository,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var outcome = await avatars.ActivateAsync(apiContext.TenantId, request.UploadId, request.ClientMutationId, cancellationToken);
        if (outcome is not (ActivateAvatarOutcome.Activated or ActivateAvatarOutcome.AlreadyApplied))
        {
            return outcome switch
            {
                ActivateAvatarOutcome.UploadNotFound => ApiResults.Problem(StatusCodes.Status404NotFound, ErrorCodes.UploadNotFound),
                ActivateAvatarOutcome.UploadMissing => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, ErrorCodes.UploadMissing),
                ActivateAvatarOutcome.TooLarge => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, ErrorCodes.PhotoTooLarge),
                ActivateAvatarOutcome.DimensionsTooLarge => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, ErrorCodes.AvatarTooLarge),
                _ => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, ErrorCodes.UnsupportedImage),
            };
        }

        var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(apiContext.TenantId), cancellationToken);
        if (tenant is null)
            return Results.NotFound();
        var user = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(apiContext.UserId), cancellationToken);
        return Results.Ok(await tenant.ToProfileDtoAsync(user, avatars, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPut("v1/tenant/profile/avatar", Handler)
            .Produces<ProfileDto>(StatusCodes.Status200OK)
            .Validated()
            .Problems(StatusCodes.Status404NotFound, StatusCodes.Status422UnprocessableEntity)
            .Tenant("Tenant Profile", "Make an uploaded image my profile picture",
                "Validates the image (JPEG/PNG magic bytes, ≤ 1 MB, longest side ≤ Photos:AvatarMaxDimension = 1024 px; no server-side resampling), strips " +
                "EXIF/XMP and replaces the previous picture. Idempotent by clientMutationId. Returns the profile with a fresh avatarUrl. " +
                "404 upload_not_found (also for a body/face photo upload id); 422 upload_missing | photo_too_large | unsupported_image | avatar_too_large.");
}

public class DeleteAvatar : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IApiContext apiContext, [FromServices] IAvatarService avatars, CancellationToken cancellationToken)
    {
        await avatars.DeleteAsync(apiContext.TenantId, cancellationToken);
        return Results.NoContent();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapDelete("v1/tenant/profile/avatar", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Tenant("Tenant Profile", "Remove my profile picture", "Deletes the picture (row and S3 objects). Idempotent. Body / face photos are not touched.");
}
