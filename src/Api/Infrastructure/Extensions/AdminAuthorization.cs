using Domain.Constant;
using Domain.Entity;
using Domain.Manager;
using Domain.Options;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;

namespace Api.Infrastructure.Extensions;

public sealed class AdminRequirement : IAuthorizationRequirement;

/// <summary>
/// v1/admin/* (README §9.2): a normal signed-in user whose id or e-mail is listed in config/SSM (Admin section).
/// The list is read on every request (SSM reloads every 60 s), so removing an admin takes effect without a deploy.
/// Not an admin → 403; the mobile app never calls these routes.
/// </summary>
public sealed class AdminAuthorizationHandler(IOptionsMonitor<AdminOptions> options, IRepository repository) : AuthorizationHandler<AdminRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, AdminRequirement requirement)
    {
        var userId = context.User.FindFirst(ClaimNames.Subject)?.Value;
        if (string.IsNullOrEmpty(userId))
            return;

        var admins = options.CurrentValue;
        if (admins.UserIds.Contains(userId, StringComparer.Ordinal))
        {
            context.Succeed(requirement);
            return;
        }

        if (admins.Emails.Count == 0)
            return;
        var user = await repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(userId));
        if (user?.Email is { Length: > 0 } email && admins.Emails.Contains(email, StringComparer.OrdinalIgnoreCase))
            context.Succeed(requirement);
    }
}

public static class AdminAuthorizationExtensions
{
    public static IServiceCollection AddAdminAuthorization(this IServiceCollection services)
    {
        services.AddSingleton<IAuthorizationHandler, AdminAuthorizationHandler>();
        services.AddAuthorizationBuilder()
            .AddPolicy(AdminOptions.Policy, policy => policy
                .AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme)
                .RequireAuthenticatedUser()
                .RequireClaim(ClaimNames.Subject)
                .AddRequirements(new AdminRequirement()));
        return services;
    }
}
