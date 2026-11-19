using Domain.Enum;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Extensions;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Photo;

public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string kind,
        [FromBody] ActivatePhotoRequest request,
        [FromServices] IApiContext apiContext,
        [FromServices] IPhotoService photoService,
        [FromServices] IValidator<ActivatePhotoRequest> validator,
        CancellationToken cancellationToken)
    {
        if (!PhotoKindRoute.TryParse(kind, out var photoKind))
            return Results.NotFound();

        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var result = await photoService.ActivateAsync(apiContext.TenantId, photoKind, request.UploadId, request.ClientMutationId, cancellationToken);
        return result.Outcome switch
        {
            ActivatePhotoOutcome.Activated or ActivatePhotoOutcome.AlreadyApplied when result.Photo is not null => Results.Ok(result.Photo.ToDto()),
            ActivatePhotoOutcome.AlreadyApplied => Results.NotFound(), // applied earlier, then deleted
            ActivatePhotoOutcome.UploadNotFound => ApiResults.Problem(StatusCodes.Status404NotFound, ErrorCodes.UploadNotFound),
            ActivatePhotoOutcome.KindMismatch => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, ErrorCodes.UploadKindMismatch),
            ActivatePhotoOutcome.UploadMissing => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, ErrorCodes.UploadMissing),
            ActivatePhotoOutcome.TooLarge => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, ErrorCodes.PhotoTooLarge),
            _ => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, ErrorCodes.UnsupportedImage),
        };
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/tenant/photo/{kind}", Handler)
            .RequirePhotoConsent(c => PhotoKindRoute.TryParse(c.HttpContext.Request.RouteValues["kind"] as string, out var k) ? k : null)
            .Produces<PhotoDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Make an uploaded photo the active body/face photo")
            .WithDescription("kind = body | face. Validates the image (JPEG/PNG), strips EXIF/XMP, replaces the previous photo of that kind and deletes try-on images made from it. Idempotent by clientMutationId.")
            .WithTags("Tenant Photo");
    }
}

public record ActivatePhotoRequest(string UploadId, string ClientMutationId);

public class ActivatePhotoRequestValidator : AbstractValidator<ActivatePhotoRequest>
{
    public ActivatePhotoRequestValidator()
    {
        RuleFor(x => x.UploadId).Must(Ulid.IsValid).WithErrorCode("upload_id_invalid");
        RuleFor(x => x.ClientMutationId).Must(Ulid.IsValid).WithErrorCode("client_mutation_id_invalid");
    }
}
