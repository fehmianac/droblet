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

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string handle,
        [FromServices] IApiContext apiContext,
        [FromServices] ISocialService social,
        CancellationToken cancellationToken)
    {

        var profile = await social.GetProfileAsync(apiContext.TenantId, handle, cancellationToken);
        return profile is null ? StoreResults.NotFound() : Results.Ok(profile);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/people/{handle}", Handler)
            .Produces<PersonProfileDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Person profile")
            .WithDescription("Card, counts, style match %, follow state. closetLocked = the Looks / Dolap tabs are not open to this viewer. 404 for unknown, private or blocked accounts.")
            .WithTags("Tenant Social");
    }
}
