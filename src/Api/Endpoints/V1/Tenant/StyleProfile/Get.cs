using Api.Infrastructure.Contract;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Entity;
using Domain.Manager;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.StyleProfile;

public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IRepository repository,
        CancellationToken cancellationToken)
    {
        var entity = await repository.GetAsync<StyleProfileEntity>(StyleProfileEntity.GetPk(apiContext.TenantId), StyleProfileEntity.GetSk(), cancellationToken);
        return entity is null ? Results.NotFound() : Results.Ok(entity.ToDto());
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/style-profile", Handler)
            .Produces<StyleProfileDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Get style profile")
            .WithDescription("404 until onboarding step 03 is saved.")
            .WithTags("Tenant StyleProfile");
    }
}
