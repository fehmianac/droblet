using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Context;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.OutfitImport;

// "Kombinlerini içe aktar": session → background uploads (presigned POST) → per-photo confirmation → worker (detect, match,
// de-duplicate, look draft) → review → commit / discard. docs/api/outfit-import.md.

public class Post : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] CreateOutfitImportCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] IOutfitImportService imports,
        [FromServices] IValidator<CreateOutfitImportCommand> validator,
        HttpContext httpContext,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var result = await imports.CreateAsync(apiContext.TenantId, request, httpContext.RequestLanguage(), cancellationToken);
        return result.ToHttp(result.Value is { } created ? $"/v1/tenant/outfit-import/{created.Session.Id}" : null);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/outfit-import", Handler)
            .Produces<OutfitImportCreatedDto>(StatusCodes.Status201Created)
            .Produces<OutfitImportCreatedDto>(StatusCodes.Status200OK)
            .Problems(StatusCodes.Status402PaymentRequired, StatusCodes.Status403Forbidden, StatusCodes.Status422UnprocessableEntity)
            .Validated()
            .Tenant("Tenant OutfitImport", "Start an outfit import",
                "Creates the session (id = requestId) and one presigned POST per photo (uploads/import/{tenant}/{session}/{n}, image/jpeg). " +
                "count is limited by the plan (Entitlements:Free|Premium:OutfitImportMaxPhotos; 422 outfit_import_too_many_photos above it; maxPhotos in the answer and in GET entitlement → outfitImport). " +
                "A non-member's photos use the AI recognition allowance (one per photo): above what is left the session gets fewer slots (skipped); none left → 402 item_recognition_limit_reached (limit 0 → 403 premium_required). " +
                "The same requestId again answers 200 with the same session and fresh slots for the photos not uploaded yet (presigned forms expire).");
    }
}

public class GetAll : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IApiContext apiContext, [FromServices] IOutfitImportService imports, CancellationToken cancellationToken) =>
        Results.Ok(await imports.GetOpenAsync(apiContext.TenantId, cancellationToken));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/outfit-import", Handler)
            .Produces<IReadOnlyList<OutfitImportDto>>(StatusCodes.Status200OK)
            .Tenant("Tenant OutfitImport", "Open outfit imports", "Sessions not committed yet (newest first), so the app can resume an import the user left.");
    }
}

public class Get : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IApiContext apiContext, [FromServices] IOutfitImportService imports, CancellationToken cancellationToken) =>
        await imports.GetAsync(apiContext.TenantId, id, cancellationToken) is { } session ? Results.Ok(session) : Results.NotFound();

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/outfit-import/{id}", Handler)
            .Produces<OutfitImportDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .Tenant("Tenant OutfitImport", "Get an outfit import",
                "Progress counters (uploaded / detected / matched / ready / failed), status (uploading · processing · ready · failed · committed) and one look draft per photo: " +
                "its pieces tagged match (\"Gardırobunda var\", itemId) or new (\"Yeni\", pieceId shared by every photo that shows it), each with its slot.");
    }
}

public class PostUploaded : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromRoute] int index, [FromServices] IApiContext apiContext, [FromServices] IOutfitImportService imports,
        CancellationToken cancellationToken) =>
        (await imports.MarkUploadedAsync(apiContext.TenantId, id, index, cancellationToken)).ToHttp();

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/outfit-import/{id}/photos/{index:int}/uploaded", Handler)
            .Produces<OutfitImportDto>(StatusCodes.Status200OK)
            .Problems(StatusCodes.Status404NotFound, StatusCodes.Status409Conflict, StatusCodes.Status422UnprocessableEntity)
            .Tenant("Tenant OutfitImport", "Confirm one uploaded photo",
                "The app calls this after each successful S3 POST: the photo is queued for processing once (a repeated call changes nothing). 422 upload_missing when the object is not there; 409 outfit_import_committed.");
    }
}

public class PostCommit : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromBody] CommitOutfitImportCommand request, [FromServices] IApiContext apiContext,
        [FromServices] IOutfitImportService imports, [FromServices] IValidator<CommitOutfitImportCommand> validator, CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());
        return (await imports.CommitAsync(apiContext.TenantId, id, request, cancellationToken)).ToHttp();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/outfit-import/{id}/commit", Handler)
            .Produces<OutfitImportCommitResultDto>(StatusCodes.Status200OK)
            .Problems(StatusCodes.Status404NotFound, StatusCodes.Status409Conflict, StatusCodes.Status422UnprocessableEntity)
            .Validated()
            .Tenant("Tenant OutfitImport", "Approve an outfit import",
                "looks: [{photoIndex, keep, pieces: [{ref, keep}]}] — a photo or piece left out is kept (an empty list approves everything). Creates the kept new pieces as wardrobe items " +
                "(once each, however many photos show them; idempotent per piece), queues the background removal for those only, then one look per kept photo (the photo is its cover; " +
                "fewer than 2 pieces → skipped look_min_pieces). 409 outfit_import_not_ready while photos are processed; a committed session answers its stored result.");
    }
}

public class Delete : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IApiContext apiContext, [FromServices] IOutfitImportService imports, CancellationToken cancellationToken) =>
        await imports.DiscardAsync(apiContext.TenantId, id, cancellationToken) ? Results.NoContent() : Results.NotFound();

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapDelete("v1/tenant/outfit-import/{id}", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces(StatusCodes.Status404NotFound)
            .Tenant("Tenant OutfitImport", "Discard an outfit import",
                "Removes the session, its photos and crops (before a commit) and gives back the recognitions of photos not processed yet. After a commit only the session record and the originals go.");
    }
}
