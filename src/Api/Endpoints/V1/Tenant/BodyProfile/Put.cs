using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.BodyProfile;

public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] UpdateBodyProfileRequest request,
        [FromServices] IApiContext apiContext,
        [FromServices] IRepository repository,
        [FromServices] IValidator<UpdateBodyProfileRequest> validator,
        [FromServices] TimeProvider timeProvider,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var pk = BodyProfileEntity.GetPk(apiContext.TenantId);
        var entity = await repository.GetAsync<BodyProfileEntity>(pk, BodyProfileEntity.GetSk(), cancellationToken);
        if (entity is null && request.BaseVersion != 0)
            return Results.NotFound();
        if (entity is not null && entity.Version != request.BaseVersion)
            return Results.Conflict(entity.ToDto());

        entity ??= new BodyProfileEntity { TenantId = apiContext.TenantId };
        entity.HeightCm = request.HeightCm;
        entity.WeightKg = request.WeightKg;
        entity.Size = request.Size;
        entity.UpdatedAt = timeProvider.GetUtcNow().UtcDateTime;

        if (!await repository.SaveIfVersionAsync(entity, request.BaseVersion, cancellationToken))
        {
            var current = await repository.GetAsync<BodyProfileEntity>(pk, BodyProfileEntity.GetSk(), cancellationToken);
            return current is null ? Results.NotFound() : Results.Conflict(current.ToDto());
        }

        return Results.Ok(entity.ToDto());
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/tenant/body-profile", Handler)
            .Produces<BodyProfileDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status404NotFound)
            .Produces<BodyProfileDto>(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Create or update body profile")
            .WithDescription("Height 100–230 cm, weight optional 30–250 kg, size. baseVersion 0 creates.")
            .WithTags("Tenant BodyProfile");
    }
}

public record UpdateBodyProfileRequest(int HeightCm, decimal? WeightKg, ClothingSize Size, long BaseVersion);

public class UpdateBodyProfileRequestValidator : AbstractValidator<UpdateBodyProfileRequest>
{
    public UpdateBodyProfileRequestValidator()
    {
        RuleFor(x => x.HeightCm).InclusiveBetween(100, 230).WithErrorCode("height_out_of_range");
        RuleFor(x => x.WeightKg).InclusiveBetween(30m, 250m).WithErrorCode("weight_out_of_range").When(x => x.WeightKg is not null);
        RuleFor(x => x.Size).IsInEnum().WithErrorCode("size_invalid");
        RuleFor(x => x.BaseVersion).GreaterThanOrEqualTo(0).WithErrorCode("base_version_invalid");
    }
}
