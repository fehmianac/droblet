using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Api.Endpoints.V1.Tenant.Photo;

public class PostUploadUrl : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] PhotoUploadUrlRequest request,
        [FromServices] IApiContext apiContext,
        [FromServices] IPhotoService photoService,
        [FromServices] IValidator<PhotoUploadUrlRequest> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var slot = await photoService.CreateUploadAsync(apiContext.TenantId, request.Kind, request.ContentType, cancellationToken);
        return Results.Ok(new PhotoUploadDto(slot.UploadId, request.Kind, slot.Upload.Url, slot.Upload.Fields, slot.Upload.ExpiresAt, slot.MaxBytes));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/photo/upload-url", Handler)
            .RequireConsent(c => ConsentRules.ForPhoto(c.Argument<PhotoUploadUrlRequest>()?.Kind ?? PhotoKind.Body))
            .Produces<PhotoUploadDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Get a presigned upload for a body/face photo")
            .WithDescription("Presigned POST (multipart form: all `fields` first, then `file`) to the private bucket; exact Content-Type and max size enforced by S3. Then call PUT v1/tenant/photo/{kind}.")
            .WithTags("Tenant Photo");
    }
}

public record PhotoUploadUrlRequest(PhotoKind Kind, string ContentType);

public class PhotoUploadUrlRequestValidator : AbstractValidator<PhotoUploadUrlRequest>
{
    public PhotoUploadUrlRequestValidator(IOptionsMonitor<PhotoOptions> options)
    {
        RuleFor(x => x.Kind).IsInEnum().WithErrorCode("photo_kind_invalid");
        RuleFor(x => x.ContentType).NotEmpty().WithErrorCode("content_type_required")
            .Must(ct => options.CurrentValue.AllowedContentTypes.Contains(ct)).WithErrorCode("content_type_unsupported");
    }
}
