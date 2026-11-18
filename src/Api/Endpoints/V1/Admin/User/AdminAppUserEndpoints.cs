using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Services.Admin;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Admin.User;

// App accounts for support and moderation (docs/api/admin.md §5). Never photos or generated images.

public class GetPaged : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? q,
        [FromQuery] string? pageToken,
        [FromQuery] int? limit,
        [FromServices] IAdminAppUserService users,
        CancellationToken ct)
    {
        if (q is { Length: > 254 })
            return StoreResults.BadQuery();
        return Results.Ok(await users.SearchAsync(q, pageToken, Math.Clamp(limit ?? 25, 1, 100), ct));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/admin/user", Handler)
            .Produces<AdminAppUserPageDto>(StatusCodes.Status200OK)
            .RequireAdmin(AdminPermissions.UsersRead)
            .WithSummary("Search app users")
            .WithDescription("q = exact e-mail, handle (with or without @) or user id → that user; otherwise newest first, filtered by part of the e-mail or name within each page.")
            .WithTags("Admin App Users");
}

public class Get : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IAdminAppUserService users, CancellationToken ct) =>
        await users.GetAsync(id, ct) is { } user ? Results.Ok(user) : StoreResults.NotFound();

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/admin/user/{id}", Handler)
            .Produces<AdminAppUserDetailDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .RequireAdmin(AdminPermissions.UsersRead)
            .WithSummary("App user detail")
            .WithDescription("Profile, counters, membership, credits, devices. No body / face photos, try-on or wardrobe images.")
            .WithTags("Admin App Users");
}

public class PostSuspend : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] AdminSuspendRequest request,
        [FromServices] IValidator<AdminSuspendRequest> validator,
        [FromServices] IAdminContext admin,
        [FromServices] IAdminAppUserService users,
        CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(request, ct);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());
        return await users.SuspendAsync(admin.Admin, id, request.Reason, admin.Ip, ct) is { } user ? Results.Ok(user) : StoreResults.NotFound();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/admin/user/{id}/suspend", Handler)
            .Produces<AdminAppUserDetailDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .RequireAdmin(AdminPermissions.UsersSuspend)
            .WithSummary("Suspend an app user")
            .WithDescription("The user cannot sign in or refresh (403 account_suspended); refresh tokens die now, access tokens within their lifetime.")
            .WithTags("Admin App Users");
}

public class PostUnsuspend : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IAdminContext admin, [FromServices] IAdminAppUserService users, CancellationToken ct) =>
        await users.UnsuspendAsync(admin.Admin, id, admin.Ip, ct) is { } user ? Results.Ok(user) : StoreResults.NotFound();

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/admin/user/{id}/unsuspend", Handler)
            .Produces<AdminAppUserDetailDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .RequireAdmin(AdminPermissions.UsersSuspend)
            .WithSummary("Lift a suspension")
            .WithTags("Admin App Users");
}

public class Delete : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IAdminContext admin, [FromServices] IAdminAppUserService users, CancellationToken ct) =>
        await users.DeleteAsync(admin.Admin, id, admin.Ip, ct) ? Results.NoContent() : StoreResults.NotFound();

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapDelete("v1/admin/user/{id}", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .RequireAdmin(AdminPermissions.UsersDelete)
            .WithSummary("Delete an app account")
            .WithDescription("The same deletion as DELETE v1/auth/me (every tenant partition and S3 prefix).")
            .WithTags("Admin App Users");
}

public class PutTestPremium : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] AdminTestPremiumRequest request,
        [FromServices] IValidator<AdminTestPremiumRequest> validator,
        [FromServices] IAdminContext admin,
        [FromServices] IAdminAppUserService users,
        CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(request, ct);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());
        return await users.GrantTestPremiumAsync(admin.Admin, id, request.Days, request.Note, admin.Ip, ct) is { } user ? Results.Ok(user) : StoreResults.NotFound();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPut("v1/admin/user/{id}/test-premium", Handler)
            .Produces<AdminAppUserDetailDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .RequireAdmin(AdminPermissions.UsersGrant)
            .WithSummary("Grant TEST premium")
            .WithDescription("A test entitlement (source admin) for 1–90 days; replaces an earlier test grant. Audited.")
            .WithTags("Admin App Users");
}

public class DeleteTestPremium : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IAdminContext admin, [FromServices] IAdminAppUserService users, CancellationToken ct) =>
        await users.RevokeTestPremiumAsync(admin.Admin, id, admin.Ip, ct) is { } user ? Results.Ok(user) : StoreResults.NotFound();

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapDelete("v1/admin/user/{id}/test-premium", Handler)
            .Produces<AdminAppUserDetailDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .RequireAdmin(AdminPermissions.UsersGrant)
            .WithSummary("Revoke TEST premium")
            .WithTags("Admin App Users");
}

public class PostCredits : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] AdminCreditsRequest request,
        [FromServices] IValidator<AdminCreditsRequest> validator,
        [FromServices] IAdminContext admin,
        [FromServices] IAdminAppUserService users,
        CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(request, ct);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());
        return await users.AddCreditsAsync(admin.Admin, id, request.Credits, request.Note, admin.Ip, ct) is { } user ? Results.Ok(user) : StoreResults.NotFound();
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/admin/user/{id}/credits", Handler)
            .Produces<AdminAppUserDetailDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .RequireAdmin(AdminPermissions.UsersGrant)
            .WithSummary("Add TEST credits")
            .WithDescription("Adds 1–500 pack credits with an admin-test reference. Audited.")
            .WithTags("Admin App Users");
}
