using Domain.Constant;
using Domain.Entity;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Admin;
using Infrastructure.Services.Admin;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Api.Infrastructure.Extensions;

/// <summary>
/// Admin panel authentication and authorization (docs/api/admin.md). A separate bearer scheme with its own key,
/// issuer and audience: an app token never authenticates on an admin route (and an admin token never on an app route,
/// whose scheme validates the app key / audience and requires the tenant claim). The admin row is re-read on every
/// request, so a disable, a role change or "sign out all sessions" applies at once.
/// </summary>
public static class AdminAuthorization
{
    public const string AnyAdminPolicy = "admin:any";
    private const string AdminItemKey = "droblet.admin";

    public static string PolicyFor(string permission) => $"admin:{permission}";

    public static IServiceCollection AddAdminAuthorization(this IServiceCollection services)
    {
        services.AddAuthentication().AddJwtBearer(ClaimNames.AdminScheme);
        services.AddOptions<JwtBearerOptions>(ClaimNames.AdminScheme)
            .Configure<IOptionsMonitor<AdminJwtOptions>, IOptionsMonitor<JwtOptions>>((bearer, adminJwt, appJwt) =>
            {
                bearer.MapInboundClaims = false;
                bearer.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidIssuer = adminJwt.CurrentValue.Issuer,
                    ValidAudience = adminJwt.CurrentValue.Audience,
                    // Resolved per token: a missing / weak / shared key fails the request (401), not the whole Api.
                    IssuerSigningKeyResolver = (_, _, _, _) => [AdminTokenService.SigningKey(adminJwt.CurrentValue, appJwt.CurrentValue)],
                    ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                    ValidateIssuerSigningKey = true,
                    ValidateLifetime = true,
                    ClockSkew = TimeSpan.FromSeconds(30),
                    NameClaimType = ClaimNames.Subject,
                };
                bearer.Events = new JwtBearerEvents { OnTokenValidated = ValidateAdminAsync };
            });

        services.AddSingleton<IAuthorizationHandler, AdminPermissionHandler>();
        services.AddSingleton<IAuthorizationMiddlewareResultHandler, AdminForbiddenResultHandler>();
        var builder = services.AddAuthorizationBuilder();
        builder.AddPolicy(AnyAdminPolicy, policy => policy
            .AddAuthenticationSchemes(ClaimNames.AdminScheme)
            .RequireAuthenticatedUser()
            .AddRequirements(new AdminPermissionRequirement(null)));
        foreach (var permission in AdminPermissions.All)
        {
            builder.AddPolicy(PolicyFor(permission), policy => policy
                .AddAuthenticationSchemes(ClaimNames.AdminScheme)
                .RequireAuthenticatedUser()
                .AddRequirements(new AdminPermissionRequirement(permission)));
        }

        services.AddScoped<IAdminContext, AdminContext>();
        return services;
    }

    /// <summary>The token must be an admin token of an existing, enabled admin, issued after the last revocation.</summary>
    private static async Task ValidateAdminAsync(TokenValidatedContext context)
    {
        var principal = context.Principal;
        var adminId = principal?.FindFirst(ClaimNames.Subject)?.Value;
        if (principal?.FindFirst(ClaimNames.TokenType)?.Value != AdminTokenService.TokenType || string.IsNullOrEmpty(adminId))
        {
            context.Fail("not an admin token");
            return;
        }

        var repository = context.HttpContext.RequestServices.GetRequiredService<IRepository>();
        var admin = await repository.GetAsync<AdminUserEntity>(AdminUserEntity.GetPk(), AdminUserEntity.GetSk(adminId), context.HttpContext.RequestAborted);
        if (admin is null || admin.Disabled)
        {
            context.Fail("admin unknown or disabled");
            return;
        }
        if (admin.TokensValidAfter is { } validAfter
            && long.TryParse(principal.FindFirst(ClaimNames.IssuedAt)?.Value, out var issuedAt)
            // iat has whole seconds: a token from the revocation second itself is refused too (sign in again).
            && issuedAt <= new DateTimeOffset(DateTime.SpecifyKind(validAfter, DateTimeKind.Utc)).ToUnixTimeSeconds())
        {
            context.Fail("session revoked");
            return;
        }
        context.HttpContext.Items[AdminItemKey] = admin;
    }

    internal static AdminUserEntity? CurrentAdmin(HttpContext context) => context.Items[AdminItemKey] as AdminUserEntity;

    // ── Route builders ───────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Admin route that needs <paramref name="permission"/> (null = any signed-in admin). Rate limited per admin.</summary>
    public static RouteHandlerBuilder RequireAdmin(this RouteHandlerBuilder builder, string? permission) =>
        builder
            .RequireAuthorization(permission is null ? AnyAdminPolicy : PolicyFor(permission))
            .AddEndpointFilter<AdminRateLimitFilter>()
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status429TooManyRequests);

    /// <summary>Anonymous admin route (sign-in, refresh, password). Rate limited per IP.</summary>
    public static RouteHandlerBuilder AdminAnonymous(this RouteHandlerBuilder builder) =>
        builder.AllowAnonymous().AddEndpointFilter<AdminRateLimitFilter>().Produces(StatusCodes.Status429TooManyRequests);

    /// <summary>
    /// Audits a successful write: action, target (route value <paramref name="routeKey"/>), the record before (when
    /// <paramref name="before"/> is given) and after (the response value, or the request body when the response has none).
    /// </summary>
    public static RouteHandlerBuilder Audited(this RouteHandlerBuilder builder, string action, string targetType, string? routeKey = "id",
        Func<HttpContext, string, Task<object?>>? before = null) =>
        builder.AddEndpointFilter(async (context, next) =>
        {
            var http = context.HttpContext;
            var targetId = routeKey is null ? null : http.Request.RouteValues[routeKey]?.ToString();
            var previous = before is not null && targetId is not null ? await before(http, targetId) : null;
            var result = await next(context);
            var status = (result as IStatusCodeHttpResult)?.StatusCode ?? StatusCodes.Status200OK;
            if (status < 400)
            {
                var after = (result as IValueHttpResult)?.Value
                            ?? context.Arguments.FirstOrDefault(a => a is not null && a.GetType().Namespace is "Domain.Validation" or "Api.Endpoints.V1.Admin.Moderation" or "Api.Contracts");
                var admin = CurrentAdmin(http);
                await http.RequestServices.GetRequiredService<IAuditLog>()
                    .WriteAsync(admin, action, targetType, targetId, previous, after, http.ClientIp(), http.RequestAborted);
            }
            return result;
        });
}

public sealed record AdminPermissionRequirement(string? Permission) : IAuthorizationRequirement;

/// <summary>Role → permission check (AdminPermissions). The role comes from the admin row, never from the token.</summary>
public sealed class AdminPermissionHandler : AuthorizationHandler<AdminPermissionRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, AdminPermissionRequirement requirement)
    {
        var admin = context.Resource is HttpContext http ? AdminAuthorization.CurrentAdmin(http) : null;
        if (admin is not null && (requirement.Permission is null || AdminPermissions.Has(admin.Role, requirement.Permission)))
            context.Succeed(requirement);
        return Task.CompletedTask;
    }
}

/// <summary>Signed-in admin without the permission → 403 with code "forbidden" (other routes keep the empty 403).</summary>
public sealed class AdminForbiddenResultHandler : IAuthorizationMiddlewareResultHandler
{
    private readonly AuthorizationMiddlewareResultHandler _default = new();

    public async Task HandleAsync(RequestDelegate next, HttpContext context, AuthorizationPolicy policy, PolicyAuthorizationResult authorizeResult)
    {
        if (authorizeResult.Forbidden && policy.Requirements.OfType<AdminPermissionRequirement>().Any())
        {
            await ApiResults.Problem(StatusCodes.Status403Forbidden, ErrorCodes.Forbidden).ExecuteAsync(context);
            return;
        }
        await _default.HandleAsync(next, context, policy, authorizeResult);
    }
}

/// <summary>Every admin route: RequestsPerMinute per admin (signed in) or per IP (sign-in routes).</summary>
public sealed class AdminRateLimitFilter(IRateLimiter rateLimiter, IOptionsMonitor<AdminAuthOptions> options) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        var key = AdminAuthorization.CurrentAdmin(http)?.Id is { } adminId ? $"admin:{adminId}" : $"ip:{http.ClientIp() ?? "unknown"}";
        if (!await rateLimiter.TryAcquireAsync("admin-api", key, options.CurrentValue.RequestsPerMinute, TimeSpan.FromMinutes(1), http.RequestAborted))
            return ApiResults.Problem(StatusCodes.Status429TooManyRequests, ErrorCodes.TooManyRequests);
        return await next(context);
    }
}

/// <summary>The signed-in admin of the current request (admin routes only).</summary>
public interface IAdminContext
{
    AdminUserEntity Admin { get; }
    string? Ip { get; }
    string Language { get; }
    AdminRequestInfo Request => new(Ip, Language);
}

public sealed class AdminContext(IHttpContextAccessor accessor) : IAdminContext
{
    private HttpContext Http => accessor.HttpContext ?? throw new InvalidOperationException("No HTTP context.");

    public AdminUserEntity Admin => AdminAuthorization.CurrentAdmin(Http) ?? throw new UnauthorizedAccessException("No signed-in admin.");
    public string? Ip => Http.ClientIp();
    public string Language => Http.Language();
}

/// <summary>
/// CORS in the Api (not API Gateway): v1/admin/* answers only the admin panel origins (AdminAuth:AllowedOrigins); every
/// other route keeps the public "*" it had at the gateway (bearer tokens, no cookies). Preflights end here with 204.
/// </summary>
public static class DrobletCors
{
    private const string AllowMethods = "GET, POST, PUT, DELETE, OPTIONS, PATCH";
    private const string AllowHeaders = "Authorization, Content-Type, Accept, Accept-Language, Idempotency-Key, X-Client-Mutation-Id";

    public static bool IsAdminPath(PathString path)
    {
        var value = path.Value ?? "";
        return value.StartsWith("/v1/admin", StringComparison.OrdinalIgnoreCase) || value.Contains("/v1/admin/", StringComparison.OrdinalIgnoreCase)
               || value.EndsWith("/v1/admin", StringComparison.OrdinalIgnoreCase);
    }

    public static IApplicationBuilder UseDrobletCors(this IApplicationBuilder app) => app.Use(async (context, next) =>
    {
        var origin = context.Request.Headers.Origin.ToString();
        var headers = context.Response.Headers;
        if (IsAdminPath(context.Request.Path))
        {
            var allowed = context.RequestServices.GetRequiredService<IOptionsMonitor<AdminAuthOptions>>().CurrentValue.AllowedOrigins;
            if (origin.Length > 0 && allowed.Contains(origin.TrimEnd('/'), StringComparer.OrdinalIgnoreCase))
            {
                headers.AccessControlAllowOrigin = origin;
                headers.Vary = "Origin";
                headers.AccessControlAllowMethods = AllowMethods;
                headers.AccessControlAllowHeaders = AllowHeaders;
                headers.AccessControlMaxAge = "600";
            }
        }
        else if (origin.Length > 0)
        {
            headers.AccessControlAllowOrigin = "*";
            headers.AccessControlAllowMethods = AllowMethods;
            headers.AccessControlAllowHeaders = context.Request.Headers.AccessControlRequestHeaders.ToString() is { Length: > 0 } requested ? requested : "*";
            headers.AccessControlMaxAge = "600";
        }

        // Preflight: answered here (the ANY /{proxy+} route forwards OPTIONS to the Lambda).
        if (HttpMethods.IsOptions(context.Request.Method))
        {
            context.Response.StatusCode = StatusCodes.Status204NoContent;
            return;
        }
        await next();
    });
}
