using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Services.Admin;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Admin.AdminUser;

// Admin accounts (super admin, admins.manage) and the audit log (audit.view). docs/api/admin.md §4.

public class GetAll : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IAdminUserService admins, CancellationToken ct) =>
        Results.Ok(await admins.ListAsync(ct));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/admin/admin-user", Handler)
            .Produces<IReadOnlyList<AdminUserDto>>(StatusCodes.Status200OK)
            .RequireAdmin(AdminPermissions.AdminsManage)
            .WithSummary("Admin users")
            .WithTags("Admin Users");
}

public class Post : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] AdminUserCreateRequest request,
        [FromServices] IValidator<AdminUserCreateRequest> validator,
        [FromServices] IAdminContext admin,
        [FromServices] IAdminUserService admins,
        CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(request, ct);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var result = await admins.CreateAsync(admin.Admin, request.Email, request.Name, request.Role, admin.Request, ct);
        return AdminResults.AdminUser(result.Outcome, result.Admin, StatusCodes.Status201Created);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/admin/admin-user", Handler)
            .Produces<AdminUserDto>(StatusCodes.Status201Created)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status409Conflict)
            .RequireAdmin(AdminPermissions.AdminsManage)
            .WithSummary("Invite an admin user")
            .WithDescription("E-mails are unique case-insensitively (409 email_taken). The invitation e-mail carries a set-password link (72 h).")
            .WithTags("Admin Users");
}

public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] AdminUserUpdateRequest request,
        [FromServices] IValidator<AdminUserUpdateRequest> validator,
        [FromServices] IAdminContext admin,
        [FromServices] IAdminUserService admins,
        CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(request, ct);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var result = await admins.UpdateAsync(admin.Admin, id, request.Name, request.Role, request.Disabled, admin.Ip, ct);
        return AdminResults.AdminUser(result.Outcome, result.Admin);
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPut("v1/admin/admin-user/{id}", Handler)
            .Produces<AdminUserDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .RequireAdmin(AdminPermissions.AdminsManage)
            .WithSummary("Change name, role or disabled")
            .WithDescription("422 cannot_change_self (own role / disable) or last_super_admin. A role change or disable ends that admin's sessions.")
            .WithTags("Admin Users");
}

public class PostInvite : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IAdminContext admin, [FromServices] IAdminUserService admins, CancellationToken ct) =>
        AdminResults.AdminUser(await admins.InviteAsync(admin.Admin, id, admin.Request, ct), successStatus: StatusCodes.Status202Accepted);

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/admin/admin-user/{id}/invite", Handler)
            .Produces(StatusCodes.Status202Accepted)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .RequireAdmin(AdminPermissions.AdminsManage)
            .WithSummary("Resend the set-password e-mail")
            .WithTags("Admin Users");
}

public class PostRevokeSessions : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IAdminContext admin, [FromServices] IAdminUserService admins, CancellationToken ct) =>
        AdminResults.AdminUser(await admins.RevokeSessionsAsync(admin.Admin, id, admin.Ip, ct), successStatus: StatusCodes.Status204NoContent);

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/admin/admin-user/{id}/revoke-sessions", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .RequireAdmin(AdminPermissions.AdminsManage)
            .WithSummary("End every session of an admin")
            .WithTags("Admin Users");
}

public class Delete : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IAdminContext admin, [FromServices] IAdminUserService admins, CancellationToken ct) =>
        AdminResults.AdminUser(await admins.DeleteAsync(admin.Admin, id, admin.Ip, ct), successStatus: StatusCodes.Status204NoContent);

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapDelete("v1/admin/admin-user/{id}", Handler)
            .Produces(StatusCodes.Status204NoContent)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status422UnprocessableEntity)
            .RequireAdmin(AdminPermissions.AdminsManage)
            .WithSummary("Delete an admin user")
            .WithTags("Admin Users");
}

public class GetAudit : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? adminId,
        [FromQuery] string? action,
        [FromQuery] string? targetType,
        [FromQuery] string? pageToken,
        [FromQuery] int? limit,
        [FromServices] IAuditLog audit,
        CancellationToken ct) =>
        Results.Ok(await audit.QueryAsync(new AuditQuery(adminId, action, targetType, pageToken, Math.Clamp(limit ?? 50, 1, 100)), ct));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/admin/audit", Handler)
            .Produces<AuditPageDto>(StatusCodes.Status200OK)
            .RequireAdmin(AdminPermissions.AuditView)
            .WithSummary("Audit log of admin writes")
            .WithDescription("Newest first. Filters (adminId, action prefix, targetType) apply within a page.")
            .WithTags("Admin Users");
}

public class GetDashboard : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IAdminDashboardService dashboard, CancellationToken ct) =>
        Results.Ok(await dashboard.GetAsync(ct));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/admin/dashboard", Handler)
            .Produces<DashboardDto>(StatusCodes.Status200OK)
            .RequireAdmin(AdminPermissions.DashboardView)
            .WithSummary("Dashboard counters")
            .WithTags("Admin Dashboard");
}
