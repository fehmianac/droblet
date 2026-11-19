using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Enum;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.TryOn;

public class Post : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] StartTryOnCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] ITryOnService tryOn,
        [FromServices] IValidator<StartTryOnCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return (await tryOn.StartAsync(apiContext.TenantId, request, cancellationToken)).ToHttp($"/v1/tenant/job/{request.RequestId}");
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/tryon", Handler)
            .RequireTryOnConsent()
            .Produces<TryOnStartDto>(StatusCodes.Status200OK)
            .Produces<TryOnStartDto>(StatusCodes.Status202Accepted)
            .Problems(StatusCodes.Status402PaymentRequired, StatusCodes.Status403Forbidden, StatusCodes.Status404NotFound, StatusCodes.Status409Conflict, StatusCodes.Status422UnprocessableEntity)
            .Validated()
            .Tenant("Tenant TryOn", "See it on me", "target.kind = item | look | product | editLook | suggestion (id = stylist job id + index). 200 status = cached when the image already exists (no credit); 202 status = queued with the job (1 credit reserved, refunded if the job fails). 402 credits_exhausted -> credit-pack sheet; 403 premium_required -> paywall; 403 consent_required (missing) -> consent step; 422 body_photo_required (neither a body nor a face photo). Path: the body photo when present, else the face photo + body profile (bodyType, height, size); image.source = body | face.");
    }
}
