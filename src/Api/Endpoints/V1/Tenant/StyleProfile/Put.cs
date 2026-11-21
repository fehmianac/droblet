using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Services;
using FluentValidation;
using Domain.Options;
using FluentValidation.Results;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Api.Endpoints.V1.Tenant.StyleProfile;

public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] UpdateStyleProfileRequest request,
        [FromServices] IApiContext apiContext,
        [FromServices] IRepository repository,
        [FromServices] IValidator<UpdateStyleProfileRequest> validator,
        [FromServices] TimeProvider timeProvider,
        [FromServices] IOptionsMonitor<SegmentOptions> segments,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        if (!SegmentPolicy.IsAvailable(request.Segment, segments.CurrentValue))
            return ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, ErrorCodes.SegmentNotAvailable);
        // Style tags are per segment (SegmentTaxonomy): e.g. romantic is a women's tag, tailored a men's one.
        if (request.StyleTags.Any(t => !SegmentTaxonomy.AllowsStyleTag(request.Segment, t)))
            return Results.BadRequest(new[] { new ValidationFailure(nameof(request.StyleTags), "style tag not offered for this segment") { ErrorCode = "style_tag_not_in_segment" } }.ToProblemDetails());

        var pk = StyleProfileEntity.GetPk(apiContext.TenantId);
        var entity = await repository.GetAsync<StyleProfileEntity>(pk, StyleProfileEntity.GetSk(), cancellationToken);
        if (entity is null && request.BaseVersion != 0)
            return Results.NotFound();
        if (entity is not null && entity.Version != request.BaseVersion)
            return Results.Conflict(entity.ToDto());

        entity ??= new StyleProfileEntity { TenantId = apiContext.TenantId };
        entity.Segment = request.Segment;
        entity.StyleTags = request.StyleTags.ToList();
        entity.Budget = request.Budget;
        entity.UpdatedAt = timeProvider.GetUtcNow().UtcDateTime;

        if (!await repository.SaveIfVersionAsync(entity, request.BaseVersion, cancellationToken))
        {
            var current = await repository.GetAsync<StyleProfileEntity>(pk, StyleProfileEntity.GetSk(), cancellationToken);
            return current is null ? Results.NotFound() : Results.Conflict(current.ToDto());
        }

        await SyncTenantSegmentAsync(repository, apiContext.TenantId, request.Segment, entity.UpdatedAt, cancellationToken);
        await ClearForeignBodyTypeAsync(repository, apiContext.TenantId, request.Segment, entity.UpdatedAt, cancellationToken);
        return Results.Ok(entity.ToDto());
    }

    /// <summary>
    /// A segment change leaves a body type of the other segment (e.g. hourglass for a man): it is cleared, so the app asks for it
    /// again on the next face try-on. The wardrobe is never touched. One attempt — a concurrent body profile edit wins.
    /// </summary>
    private static async Task ClearForeignBodyTypeAsync(IRepository repository, string tenantId, Segment segment, DateTime now, CancellationToken ct)
    {
        var body = await repository.GetAsync<BodyProfileEntity>(BodyProfileEntity.GetPk(tenantId), BodyProfileEntity.GetSk(), ct);
        if (body?.BodyType is not { } bodyType || SegmentTaxonomy.AllowsBodyType(segment, bodyType))
            return;
        body.BodyType = null;
        body.UpdatedAt = now;
        await repository.SaveIfVersionAsync(body, body.Version, ct);
    }

    // TenantEntity.segment drives discovery (PublicProfileIndex by segment). Single field, so retry on version conflict.
    private static async Task SyncTenantSegmentAsync(IRepository repository, string tenantId, Segment segment, DateTime now, CancellationToken ct)
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct);
            if (tenant is null || tenant.Segment == segment)
                return;
            tenant.Segment = segment;
            tenant.UpdatedAt = now;
            if (await repository.SaveIfVersionAsync(tenant, tenant.Version, ct))
                return;
        }
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/tenant/style-profile", Handler)
            .Produces<StyleProfileDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status404NotFound)
            .Produces<StyleProfileDto>(StatusCodes.Status409Conflict)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(ClaimNames.TenantUserPolicy)
            .WithSummary("Create or update style profile")
            .WithDescription("Exactly 3 distinct style tags, all offered for the segment (GET v1/config styleTags; else 400 style_tag_not_in_segment). " +
                             "segment must be open (Segments:Available, GET v1/config; else 422 segment_not_available; teen never). " +
                             "Changing the segment re-filters the library and the catalog and clears a body type of the other segment; the wardrobe is untouched. baseVersion 0 creates.")
            .WithTags("Tenant StyleProfile");
    }
}

public record UpdateStyleProfileRequest(Segment Segment, IReadOnlyList<StyleTag> StyleTags, Budget Budget, long BaseVersion);

public class UpdateStyleProfileRequestValidator : AbstractValidator<UpdateStyleProfileRequest>
{
    public const int RequiredTagCount = 3;

    public UpdateStyleProfileRequestValidator()
    {
        RuleFor(x => x.Segment).IsInEnum().WithErrorCode("segment_invalid");
        RuleFor(x => x.Budget).IsInEnum().WithErrorCode("budget_invalid");
        RuleFor(x => x.StyleTags).NotNull().WithErrorCode("style_tags_required")
            .Must(t => t is not null && t.Count == RequiredTagCount).WithErrorCode("style_tags_exactly_three")
            .Must(t => t is null || t.Distinct().Count() == t.Count).WithErrorCode("style_tags_duplicate");
        RuleForEach(x => x.StyleTags).IsInEnum().WithErrorCode("style_tag_invalid");
        RuleFor(x => x.BaseVersion).GreaterThanOrEqualTo(0).WithErrorCode("base_version_invalid");
    }
}
