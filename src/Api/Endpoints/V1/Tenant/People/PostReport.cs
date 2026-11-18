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

public class PostReport : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string handle,
        [FromBody] ReportRequest request,
        [FromServices] IValidator<ReportRequest> validator,
        [FromServices] IApiContext apiContext,
        [FromServices] ISocialService social,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var (outcome, reportId) = await social.ReportAsync(apiContext.TenantId, handle, request.TargetKind, request.TargetId, request.Reason, request.Note, cancellationToken);
        return StoreResults.SocialError(outcome) ?? Results.Created($"/v1/admin/moderation/report/{reportId}", new ReportCreatedResponse(reportId!));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/people/{handle}/report", Handler)
            .Produces<ReportCreatedResponse>(StatusCodes.Status201Created)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .Produces<ProblemDetails>(StatusCodes.Status429TooManyRequests)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Report a person or their content")
            .WithDescription("targetKind = profile | look | item (targetId required for look / item). reason = spam | inappropriate | harassment | impersonation | minorSafety | other. Stored for moderation; rate limited per day.")
            .WithTags("Tenant Social");
    }
}
