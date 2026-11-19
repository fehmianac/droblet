namespace Domain.Services;

/// <summary>
/// Links into the static websites (landing, admin panel). They are S3 website buckets: a page lives at
/// <c>/page/index.html</c>, and S3 answers <c>/page?x=1</c> with a 302 to <c>/page/</c> that DROPS the query string.
/// So every page link that carries a query is written with the trailing slash.
/// </summary>
public static class WebLinks
{
    /// <summary><paramref name="pageUrl"/> with a trailing slash (unless its last segment is a file) and the query appended.</summary>
    public static string WithQuery(string pageUrl, string name, string value)
    {
        var url = pageUrl.Trim();
        var lastSegment = url[(url.LastIndexOf('/') + 1)..];
        if (!url.EndsWith('/') && !lastSegment.Contains('.'))
            url += "/";
        return $"{url}?{name}={Uri.EscapeDataString(value)}";
    }
}
