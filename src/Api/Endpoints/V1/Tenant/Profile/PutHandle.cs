using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Entity;
using Domain.Manager;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Profile;

public class PutHandle : IEndpoint
{
    private const int MaxAttempts = 3;

    private static async Task<IResult> Handler(
        [FromBody] UpdateHandleRequest request,
        [FromServices] IApiContext apiContext,
        [FromServices] Domain.Services.IAvatarService avatars,
        [FromServices] Domain.Services.ITeenService teens,
        [FromServices] IRepository repository,
        [FromServices] IValidator<UpdateHandleRequest> validator,
        [FromServices] TimeProvider timeProvider,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var handle = HandleRules.Normalize(request.Handle);
        if (HandleRules.IsReserved(handle))
            return ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, ErrorCodes.HandleReserved);

        var user = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(apiContext.UserId), cancellationToken);

        for (var attempt = 0; attempt < MaxAttempts; attempt++)
        {
            var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(apiContext.TenantId), cancellationToken);
            if (tenant is null)
                return Results.NotFound();
            if (tenant.Handle == handle)
                return Results.Ok(await tenant.ToProfileDtoAsync(user, avatars, teens, cancellationToken));

            var now = timeProvider.GetUtcNow().UtcDateTime;
            var previous = tenant.Handle;
            tenant.Handle = handle;
            tenant.UpdatedAt = now;

            // Handle directory write is conditional (uniqueness); the old handle is released in the same transaction.
            var operations = new List<TransactWriteOperation>
            {
                TransactWriteOperation.Create(new HandleEntity { Handle = handle, TenantId = tenant.Id, CreatedAt = now }),
                TransactWriteOperation.PutVersioned(tenant),
            };
            if (previous is not null)
                operations.Add(TransactWriteOperation.Delete(HandleEntity.GetPk(), HandleEntity.GetSk(previous)));

            var result = await repository.TransactWriteAsync(operations, cancellationToken);
            if (result.Applied)
                return Results.Ok(await tenant.ToProfileDtoAsync(user, avatars, teens, cancellationToken));
            if (result.Outcome == TransactOutcome.ConditionFailed && result.FailedIndex == 0)
                return ApiResults.Problem(StatusCodes.Status409Conflict, ErrorCodes.HandleTaken);
            // Version conflict: another device changed the profile — re-read and retry (handle is a single field).
        }

        return ApiResults.Problem(StatusCodes.Status409Conflict, ErrorCodes.VersionConflict);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/tenant/profile/handle", Handler)
            .Produces<ProfileDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status409Conflict)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Claim or change @handle")
            .WithDescription("3–30 chars, a–z 0–9 . _ (lower-cased, leading @ ignored). 409 handle_taken, 422 handle_reserved.")
            .WithTags("Tenant Profile");
    }
}

public record UpdateHandleRequest(string Handle);

public class UpdateHandleRequestValidator : AbstractValidator<UpdateHandleRequest>
{
    public UpdateHandleRequestValidator()
    {
        RuleFor(x => x.Handle).NotEmpty().WithErrorCode("handle_required")
            .Must(h => HandleRules.IsValidFormat(HandleRules.Normalize(h))).WithErrorCode("handle_invalid");
    }
}
