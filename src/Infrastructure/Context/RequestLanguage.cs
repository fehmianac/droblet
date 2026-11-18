using Domain.Constant;
using Domain.Entity;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Infrastructure.Context;

/// <summary>
/// Request language: the signed-in user's profile language (if supported) → Accept-Language → default.
/// Resolved once per request (HttpContext.Items). Workers and the Notifier have no request: they get the default
/// and pick the recipient's profile language themselves.
/// </summary>
public sealed class RequestLanguage(IServiceProvider services, IRepository repository, IOptionsMonitor<LocalizationOptions> options) : IRequestLanguage
{
    private const string ItemKey = "droblet.language";
    private readonly IHttpContextAccessor? _accessor = services.GetService<IHttpContextAccessor>();

    public string Default => options.CurrentValue.DefaultLanguage;

    public async Task<string> GetAsync(CancellationToken ct)
    {
        var http = _accessor?.HttpContext;
        if (http is null)
            return Default;
        if (http.Items.TryGetValue(ItemKey, out var cached) && cached is string known)
            return known;

        var localization = options.CurrentValue;
        string? language = null;
        if (http.User.FindFirst(ClaimNames.TenantId)?.Value is { Length: > 0 } tenantId)
        {
            var tenant = await repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(tenantId), ct);
            if (localization.IsSupported(tenant?.Language))
                language = tenant!.Language;
        }

        language ??= LocalizedText.Negotiate(http.Request.Headers.AcceptLanguage.ToString(), localization.Languages) ?? localization.DefaultLanguage;
        http.Items[ItemKey] = language;
        return language;
    }
}
