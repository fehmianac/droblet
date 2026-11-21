using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using Api.Infrastructure.Contract;
using Domain.Constant;
using Domain.Options;
using FluentValidation;
using Infrastructure.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Api.Infrastructure.Extensions;

public static class StartupExtensions
{
    public static readonly JsonNamingPolicy EnumNaming = JsonNamingPolicy.CamelCase;

    public static IServiceCollection AddApiCore(this IServiceCollection services)
    {
        services.ConfigureHttpJsonOptions(o =>
        {
            o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
            o.SerializerOptions.Converters.Add(new JsonStringEnumConverter(EnumNaming, allowIntegerValues: false));
        });

        services.AddProblemDetails();
        services.AddValidatorsFromAssemblyContaining<Entrypoint>(ServiceLifetime.Singleton);

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
        services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
            .Configure<IOptions<JwtOptions>>((bearer, jwt) =>
            {
                bearer.MapInboundClaims = false;
                bearer.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidIssuer = jwt.Value.Issuer,
                    ValidAudience = jwt.Value.Audience,
                    IssuerSigningKey = TokenService.SigningKey(jwt.Value),
                    ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                    ValidateIssuerSigningKey = true,
                    ValidateLifetime = true,
                    ClockSkew = TimeSpan.FromSeconds(30),
                    NameClaimType = ClaimNames.Subject,
                };
            });

        services.AddAuthorizationBuilder()
            .AddPolicy(ClaimNames.TenantUserPolicy, policy => policy
                .AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme)
                .RequireAuthenticatedUser()
                .RequireClaim(ClaimNames.Subject)
                .RequireClaim(ClaimNames.TenantId));

        return services;
    }

    public static IEndpointRouteBuilder MapEndpointsCore(this IEndpointRouteBuilder endpoints, IEnumerable<Assembly> assemblies)
    {
        var endpointTypes = assemblies
            .SelectMany(a => a.GetTypes())
            .Where(t => typeof(IEndpoint).IsAssignableFrom(t));

        foreach (var endpointType in endpointTypes)
        {
            if (endpointType.IsInterface || endpointType.IsAbstract) continue;

            var endpoint = Activator.CreateInstance(endpointType);
            // Every endpoint passes the teen guard (docs/api/teen.md §4): a no-op outside TeenRouteRules.
            if (endpoint is IEndpoint endpointItem)
                endpointItem.MapEndpoint(endpoints).AddTeenGuard();
        }

        return endpoints;
    }
}
