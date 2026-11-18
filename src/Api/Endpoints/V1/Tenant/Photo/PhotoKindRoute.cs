using Domain.Enum;

namespace Api.Endpoints.V1.Tenant.Photo;

internal static class PhotoKindRoute
{
    public static bool TryParse(string? value, out PhotoKind kind)
    {
        kind = default;
        return value is not null
               && !int.TryParse(value, out _)
               && System.Enum.TryParse(value, ignoreCase: true, out kind)
               && System.Enum.IsDefined(kind);
    }
}
