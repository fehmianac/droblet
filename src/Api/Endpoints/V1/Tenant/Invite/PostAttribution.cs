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

namespace Api.Endpoints.V1.Tenant.Invite;

public class PostAttribution : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] InviteAttributionRequest request,
        [FromServices] IValidator<InviteAttributionRequest> validator,
        [FromServices] IApiContext apiContext,
        [FromServices] IInviteService invites,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return await invites.AttributeAsync(apiContext.TenantId, request.Code, cancellationToken) switch
        {
            InviteOutcome.Attributed => Results.NoContent(),
            InviteOutcome.CodeNotFound => StoreResults.NotFound(StoreSocialErrorCodes.InviteCodeNotFound),
            InviteOutcome.Self => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, StoreSocialErrorCodes.CannotTargetSelf),
            InviteOutcome.AlreadyAttributed => ApiResults.Problem(StatusCodes.Status409Conflict, StoreSocialErrorCodes.InviteAlreadyAttributed),
            _ => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, StoreSocialErrorCodes.InviteWindowClosed),
        };
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/invite/attribution", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status409Conflict)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Attribute my install to an invite code")
            .WithDescription("Deferred deep link: called once after sign-up with the code the install link carried. Stored once per account, only for new accounts (Social:InviteAttributionWindowDays).")
            .WithTags("Tenant Invite");
    }
}
