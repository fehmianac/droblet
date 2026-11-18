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

public class GetFind : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? kind,
        [FromQuery] string? id,
        [FromQuery] int? index,
        [FromServices] IApiContext apiContext,
        [FromServices] ITryOnService tryOn,
        CancellationToken cancellationToken)
    {
        if (!Enum.TryParse<TryOnTargetKind>(kind, ignoreCase: true, out var targetKind) || !Enum.IsDefined(targetKind) || int.TryParse(kind, out _) || string.IsNullOrWhiteSpace(id))
            return ApiResults.Problem(StatusCodes.Status400BadRequest, ErrorCodes.ValidationFailed);
        return (await tryOn.FindAsync(apiContext.TenantId, new TryOnTargetInput(targetKind, id, index), cancellationToken)).ToHttp();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/tryon", Handler)
            .Produces<TryOnImageDto>(StatusCodes.Status200OK)
            .Problems(StatusCodes.Status400BadRequest, StatusCodes.Status404NotFound)
            .Tenant("Tenant TryOn", "Find an existing try-on image", "The image already generated for this target with the current body photo, without generating anything. 404 when there is none.");
    }
}
