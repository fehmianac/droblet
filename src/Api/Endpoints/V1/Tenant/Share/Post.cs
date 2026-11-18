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

namespace Api.Endpoints.V1.Tenant.Share;

public class Post : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] ShareRequest request,
        [FromServices] IValidator<ShareRequest> validator,
        [FromServices] IApiContext apiContext,
        [FromServices] IInviteService invites,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return Results.Ok(await invites.RecordShareAsync(apiContext.TenantId, request.ClientMutationId, request.Channel, request.TargetKind,
            request.TargetId, request.OwnerHandle, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/share", Handler)
            .Produces<ShareDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Record a share and get the link")
            .WithDescription("channel = whatsapp | pinterest | link; targetKind = app | profile | look | product | edit. Returns the link to share, carrying the caller's invite code. Idempotent by clientMutationId.")
            .WithTags("Tenant Invite");
    }
}
