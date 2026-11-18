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

namespace Api.Endpoints.V1.Admin.Moderation;

public class PostResolve : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] ResolveReportRequest request,
        [FromServices] IValidator<ResolveReportRequest> validator,
        [FromServices] IApiContext apiContext,
        [FromServices] ISocialService social,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var report = await social.ResolveReportAsync(id, request.Resolution, request.Note, apiContext.UserId, cancellationToken);
        return report is null ? StoreResults.NotFound() : Results.Ok(report);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/admin/moderation/report/{id}/resolve", Handler)
            .Produces<ModerationReportDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(AdminOptions.Policy)
            .WithSummary("Resolve a report")
            .WithDescription("resolution = dismissed | contentRemoved | userWarned | userSuspended. Records the decision; an already resolved report is returned unchanged.")
            .WithTags("Admin Moderation");
    }
}
