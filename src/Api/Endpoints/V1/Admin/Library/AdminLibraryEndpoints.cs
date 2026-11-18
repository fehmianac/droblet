using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Services.Admin;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Admin.Library;

// Ready-made library (content.manage), catalog image uploads (image.upload), Parameter Store settings (settings.manage).

public class GetAll : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IAdminLibraryService library, CancellationToken ct) =>
        Results.Ok(await library.ListAsync(ct));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/admin/library", Handler)
            .Produces<IReadOnlyList<AdminLibraryItemDto>>(StatusCodes.Status200OK)
            .RequireAdmin(AdminPermissions.ContentManage)
            .WithSummary("Ready-made library items (admin)")
            .WithDescription("Retired included. Until the first write the built-in seed is listed with stored=false.")
            .WithTags("Admin Content");
}

public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] AdminLibraryItemRequest request,
        [FromServices] IAdminLibraryService library,
        CancellationToken ct)
    {
        var (errors, item) = await library.UpsertAsync(new LibraryItemInput(id, request.Name, request.Category, request.ColorIds, request.Fabric,
            request.Seasons, request.ImageUrl, request.SortOrder, request.Retired), ct);
        return errors.Count > 0 ? AdminResults.ValidationErrors(errors) : Results.Ok(item);
    }

    private static async Task<object?> Before(HttpContext http, string id) =>
        await http.RequestServices.GetRequiredService<IAdminLibraryService>().GetAsync(id, http.RequestAborted);

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPut("v1/admin/library/{id}", Handler)
            .Produces<AdminLibraryItemDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .RequireAdmin(AdminPermissions.ContentManage)
            .Audited("library.upsert", "library", "id", Before)
            .WithSummary("Create or update a library item")
            .WithDescription("Id ^lib-[a-z0-9-]+$; name L (tr required); known colour ids and fabric; at least one season; imageUrl https.")
            .WithTags("Admin Content");
}

public class Delete : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IAdminLibraryService library, CancellationToken ct) =>
        await library.RetireAsync(id, ct) ? Results.NoContent() : StoreResults.NotFound();

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapDelete("v1/admin/library/{id}", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .RequireAdmin(AdminPermissions.ContentManage)
            .Audited("library.retire", "library")
            .WithSummary("Retire a library item")
            .WithTags("Admin Content");
}

public class PostImageUploadUrl : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] AdminImageUploadRequest request,
        [FromServices] IValidator<AdminImageUploadRequest> validator,
        [FromServices] ICatalogImageStorage images,
        [FromServices] IAdminContext admin,
        [FromServices] IAuditLog audit,
        CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(request, ct);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var upload = await images.CreateUploadAsync(request.Purpose, request.ContentType, ct);
        if (upload is null)
            return ApiResults.Problem(StatusCodes.Status503ServiceUnavailable, ErrorCodes.ImageStorageNotConfigured);
        await audit.WriteAsync(admin.Admin, "image.upload_url", "image", upload.Key, null, new { request.Purpose, upload.PublicUrl }, admin.Ip, ct);
        return Results.Ok(upload);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/admin/image/upload-url", Handler)
            .Produces<CatalogImageUploadDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .RequireAdmin(AdminPermissions.ImageUpload)
            .WithSummary("Presigned upload for a catalog / content image")
            .WithDescription("POST the file with `fields` to `url` (multipart, file last); then store `publicUrl` (public https on the catalog image bucket).")
            .WithTags("Admin Content");
}

public class GetSettings : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IAdminSettingsService settings, CancellationToken ct)
    {
        try
        {
            return Results.Ok(await settings.GetAllAsync(ct));
        }
        catch (SettingsUnavailableException)
        {
            return ApiResults.Problem(StatusCodes.Status503ServiceUnavailable, ErrorCodes.SettingsUnavailable);
        }
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/admin/setting", Handler)
            .Produces<IReadOnlyList<SettingGroupDto>>(StatusCodes.Status200OK)
            .RequireAdmin(AdminPermissions.SettingsManage)
            .WithSummary("Owner-editable Parameter Store settings")
            .WithDescription("Only the non-secret groups of SettingsCatalog; secrets are never listed.")
            .WithTags("Admin Settings");
}

public class PutSetting : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string group,
        [FromBody] AdminSettingUpdateRequest request,
        [FromServices] IAdminSettingsService settings,
        [FromServices] IAdminContext admin,
        CancellationToken ct)
    {
        try
        {
            var result = await settings.UpdateAsync(admin.Admin, group, request.Values ?? [], admin.Ip, ct);
            return result.Outcome switch
            {
                SettingWriteOutcome.Ok => Results.Ok(result.Group),
                SettingWriteOutcome.NotFound => StoreResults.NotFound(),
                _ => AdminResults.ValidationErrors(result.Errors!),
            };
        }
        catch (SettingsUnavailableException)
        {
            return ApiResults.Problem(StatusCodes.Status503ServiceUnavailable, ErrorCodes.SettingsUnavailable);
        }
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPut("v1/admin/setting/{group}", Handler)
            .Produces<SettingGroupDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .RequireAdmin(AdminPermissions.SettingsManage)
            .WithSummary("Update a settings group")
            .WithDescription("Writes the listed fields into every parameter of the group (other keys kept). Applies within 60 s (config reload). Audited with before / after.")
            .WithTags("Admin Settings");
}
