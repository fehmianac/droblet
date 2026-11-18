using Domain.Constant;
using Domain.Context;
using Microsoft.AspNetCore.Http;

namespace Infrastructure.Context;

/// <summary>Reads the caller from the validated JWT. TenantId is never taken from a body or query.</summary>
public sealed class ApiContext(IHttpContextAccessor accessor) : IApiContext
{
    public string TenantId => Claim(ClaimNames.TenantId);
    public string UserId => Claim(ClaimNames.Subject);

    private string Claim(string type) =>
        accessor.HttpContext?.User.FindFirst(type)?.Value
        ?? throw new UnauthorizedAccessException($"Missing '{type}' claim.");
}
