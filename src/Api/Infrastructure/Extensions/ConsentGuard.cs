using Domain.Constant;
using Domain.Context;
using Domain.Enum;
using Domain.Options;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Infrastructure.Extensions;

/// <summary>
/// Server-side enforcement of the explicit consents: a gated endpoint answers 403 `consent_required` with the missing
/// types (`missing`: camelCase names) before its handler runs, so no photo, hash or AI call is processed without consent.
/// The app maps the 403 to the right consent screen.
/// </summary>
public static class ConsentGuard
{
    /// <summary>Always requires <paramref name="types"/>.</summary>
    public static RouteHandlerBuilder RequireConsent(this RouteHandlerBuilder builder, IReadOnlyList<ConsentType> types) =>
        builder.RequireConsent(_ => types);

    /// <summary>Requires what <paramref name="resolve"/> returns for this request (e.g. by photo kind or by the fields sent).</summary>
    public static RouteHandlerBuilder RequireConsent(this RouteHandlerBuilder builder, Func<EndpointFilterInvocationContext, IReadOnlyList<ConsentType>> resolve) =>
        builder.RequireConsentAsync(context => Task.FromResult(resolve(context)));

    /// <summary>Requires what <paramref name="resolve"/> finds for this request in stored state (e.g. the try-on path: body or face photo).</summary>
    public static RouteHandlerBuilder RequireConsentAsync(this RouteHandlerBuilder builder, Func<EndpointFilterInvocationContext, Task<IReadOnlyList<ConsentType>>> resolve) =>
        builder
            .AddEndpointFilter(async (context, next) =>
            {
                var required = await resolve(context);
                if (required.Count == 0)
                    return await next(context);

                var http = context.HttpContext;
                var tenantId = http.RequestServices.GetRequiredService<IApiContext>().TenantId;
                var missing = await http.RequestServices.GetRequiredService<IConsentService>().MissingAsync(tenantId, required, http.RequestAborted);
                return missing.Count == 0 ? await next(context) : Problem(missing);
            })
            .Produces<ProblemDetails>(StatusCodes.Status403Forbidden);

    /// <summary>
    /// "Üzerimde gör": the consents of the path the render would take now — body photo → bodyPhotoAi + crossBorderTransfer;
    /// face photo only → facePhotoTryOn + crossBorderTransfer; no photo → the body path's (the preferred path).
    /// </summary>
    public static RouteHandlerBuilder RequireTryOnConsent(this RouteHandlerBuilder builder) =>
        builder.RequireConsentAsync(async context =>
        {
            var http = context.HttpContext;
            var tenantId = http.RequestServices.GetRequiredService<IApiContext>().TenantId;
            var path = await http.RequestServices.GetRequiredService<ITryOnService>().PathAsync(tenantId, http.RequestAborted);
            return TryOnRules.ConsentsFor(path);
        });

    public static IResult Problem(IReadOnlyList<ConsentType> missing) =>
        TypedResults.Problem(new ProblemDetails
        {
            Status = StatusCodes.Status403Forbidden,
            Title = ErrorCodes.ConsentRequired,
            Type = $"https://droblet.alatech.co/errors/{ErrorCodes.ConsentRequired}",
            Extensions =
            {
                ["code"] = ErrorCodes.ConsentRequired,
                ["missing"] = missing.Select(ConsentOptions.Name).ToArray(),
            },
        });

    /// <summary>The first argument of type <typeparamref name="T"/> bound to the handler (the request body).</summary>
    public static T? Argument<T>(this EndpointFilterInvocationContext context) where T : class =>
        context.Arguments.OfType<T>().FirstOrDefault();
}
