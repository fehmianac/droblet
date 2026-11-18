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

public class PutRating : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string handle,
        [FromRoute] string lookId,
        [FromBody] RateLookRequest request,
        [FromServices] IValidator<RateLookRequest> validator,
        [FromServices] IApiContext apiContext,
        [FromServices] ISocialService social,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var (outcome, rating) = await social.RateAsync(apiContext.TenantId, handle, lookId, request.Score, cancellationToken);
        return StoreResults.SocialError(outcome) ?? Results.Ok(rating);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/tenant/people/{handle}/look/{lookId}/rating", Handler)
            .Produces<LookRatingDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Rate a look (1–5)")
            .WithDescription("One rating per user per look; a new score replaces the old one. Returns the new average, count and own score. Own looks cannot be rated (422 cannot_target_self).")
            .WithTags("Tenant Social");
    }
}
