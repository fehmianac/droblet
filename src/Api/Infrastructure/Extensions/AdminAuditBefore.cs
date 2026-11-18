using Domain.Domain;
using Domain.Enum;
using Domain.Services;

namespace Api.Infrastructure.Extensions;

/// <summary>"Before" snapshots for audited admin writes (the admin DTO of the record as it was, or null when new).</summary>
public static class AdminAuditBefore
{
    public static async Task<object?> Brand(HttpContext http, string id) =>
        (await Catalog(http).GetBrandAsync(id, http.RequestAborted))?.ToAdminDto();

    public static async Task<object?> Product(HttpContext http, string id) =>
        (await Catalog(http).GetProductAsync(id, http.RequestAborted))?.ToAdminDto();

    public static async Task<object?> Edit(HttpContext http, string id) =>
        (await Content(http).ListEditsAsync(http.RequestAborted)).FirstOrDefault(e => e.Id == id)?.ToAdminDto();

    public static async Task<object?> Collection(HttpContext http, string id) =>
        Enum.TryParse<ContentCollectionKind>(http.Request.RouteValues["kind"]?.ToString(), ignoreCase: true, out var kind)
            ? (await Content(http).ListCollectionsAsync(kind, http.RequestAborted)).FirstOrDefault(c => c.Id == id)?.ToAdminDto()
            : null;

    public static async Task<object?> CollectionLook(HttpContext http, string lookId) =>
        http.Request.RouteValues["id"]?.ToString() is { } collectionId
            ? (await Content(http).ListCollectionLooksAsync(collectionId, http.RequestAborted)).FirstOrDefault(l => l.Id == lookId)?.ToAdminDto()
            : null;

    private static ICatalogService Catalog(HttpContext http) => http.RequestServices.GetRequiredService<ICatalogService>();
    private static IContentService Content(HttpContext http) => http.RequestServices.GetRequiredService<IContentService>();
}
