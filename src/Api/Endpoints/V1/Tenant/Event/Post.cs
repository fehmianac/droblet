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

namespace Api.Endpoints.V1.Tenant.Event;

public class Post : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] AnalyticsBatchRequest request,
        [FromServices] IValidator<AnalyticsBatchRequest> validator,
        [FromServices] IApiContext apiContext,
        [FromServices] IAnalyticsService analytics,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var events = request.Events!.Select(e => e?.ToInput() ?? new AnalyticsEventInput(null, null, null)).ToList();
        return Results.Ok(await analytics.RecordBatchAsync(apiContext.TenantId, events, request.Platform, request.AppVersion, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/event", Handler)
            .Produces<AnalyticsBatchResult>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Analytics events (batch)")
            .WithDescription("1–50 events. Only allow-listed names and property keys; values are identifier-like scalars (no free text). Invalid events are reported per index and do not fail the batch. Events are stored without personal content and expire after 400 days.")
            .WithTags("Tenant Analytics");
    }
}
