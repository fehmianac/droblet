using System.Text.Json;
using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Validation;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Api.Endpoints.V1.Tenant.People;

public class GetLooks : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string handle,
        [FromServices] IApiContext apiContext,
        [FromServices] ISocialService social,
        CancellationToken cancellationToken)
    {

        var result = await social.GetLooksAsync(apiContext.TenantId, handle, cancellationToken);
        return result is null ? StoreResults.NotFound() : Results.Ok(result);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/people/{handle}/look", Handler)
            .Produces<List<SocialLookDto>>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Person: Looks tab")
            .WithDescription("Strictly through VisibilityPolicy: a refused read is a 404. Trips are open to the owner only until decision A-6.")
            .WithTags("Tenant Social");
    }
}
