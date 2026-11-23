using System.Net;

namespace Ops.Commands.BrandImport;

/// <summary>One GET of a public page. Status 0 = no response (network error, timeout, or a URL the fetcher refused).</summary>
internal sealed record SourceResponse(int Status, string? Body, string? Error = null)
{
    public bool Ok => Status is >= 200 and < 300 && Body is not null;
}

/// <summary>The network as import-brand reads it (HttpClient in the tool, a fake in the tests).</summary>
internal interface ISiteClient
{
    Task<SourceResponse> GetAsync(string url, TimeSpan timeout, CancellationToken ct);
}

/// <summary>
/// Plain GETs with a browser-like user agent and nothing else: no sign-in, no script execution. It
/// refuses every URL outside the source's <see cref="SourceAccess"/> itself, whatever the caller asks.
/// </summary>
internal sealed class HttpSiteClient : ISiteClient, IDisposable
{
    private readonly HttpClient _http;
    private readonly SourceAccess _access;

    public HttpSiteClient(SourceAccess access)
    {
        _access = access;
        _http = new HttpClient(new SocketsHttpHandler { AutomaticDecompression = DecompressionMethods.All, AllowAutoRedirect = true, MaxAutomaticRedirections = 3 })
        {
            Timeout = Timeout.InfiniteTimeSpan,   // every request has its own deadline
        };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0");
        _http.DefaultRequestHeaders.Accept.ParseAdd("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
        _http.DefaultRequestHeaders.AcceptLanguage.ParseAdd("tr-TR,tr;q=0.9");
    }

    public async Task<SourceResponse> GetAsync(string url, TimeSpan timeout, CancellationToken ct)
    {
        if (!_access.Allows(url))
            return new SourceResponse(0, null, "url not allowed");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(timeout);
        try
        {
            using var response = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            var status = (int)response.StatusCode;
            if (!response.IsSuccessStatusCode)
                return new SourceResponse(status, null, $"HTTP {status}");
            return new SourceResponse(status, await response.Content.ReadAsStringAsync(deadline.Token));
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return new SourceResponse(0, null, "timeout");
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException)
        {
            return new SourceResponse(0, null, ex.GetType().Name);
        }
    }

    public void Dispose() => _http.Dispose();
}

/// <summary>
/// The one way a source or the import loop reaches a site. Brand-independent rules, enforced here so no source can
/// forget them:
/// <list type="bullet">
/// <item>sequential, with a pause of at least <see cref="MinDelay"/> before every request but the first;</item>
/// <item>only URLs the source's <see cref="SourceAccess"/> allows (no request is made for any other);</item>
/// <item>a hard cap on the requests of one run;</item>
/// <item>HTTP 403 / 429 stops the run at once; so do <see cref="MaxConsecutiveFailures"/> failed requests in a row.
/// Once stopped, nothing more is requested.</item>
/// </list>
/// </summary>
internal sealed class PoliteFetcher
{
    public static readonly TimeSpan MinDelay = TimeSpan.FromSeconds(1);
    public const int MaxConsecutiveFailures = 3;

    private readonly ISiteClient _client;
    private readonly SourceAccess _access;
    private readonly TimeSpan _delay;
    private readonly int _maxRequests;
    private readonly Func<TimeSpan, CancellationToken, Task> _pause;
    private int _failures;

    public PoliteFetcher(ISiteClient client, SourceAccess access, TimeSpan delay, int maxRequests, Func<TimeSpan, CancellationToken, Task>? pause = null)
    {
        if (delay < MinDelay)
            throw new ArgumentOutOfRangeException(nameof(delay), delay, "at least one second between two requests");
        _client = client;
        _access = access;
        _delay = delay;
        _maxRequests = Math.Max(0, maxRequests);
        _pause = pause ?? Task.Delay;
    }

    /// <summary>Requests that reached the network.</summary>
    public int Requests { get; private set; }

    /// <summary>Null while the run may go on; otherwise why it must stop.</summary>
    public string? Stopped { get; private set; }

    public async Task<SourceResponse> GetAsync(string url, TimeSpan timeout, CancellationToken ct)
    {
        if (Stopped is not null)
            return new SourceResponse(0, null, "stopped");
        if (!_access.Allows(url))
            return Failed(new SourceResponse(0, null, "url not allowed"));
        if (Requests >= _maxRequests)
        {
            Stopped = $"request cap reached ({_maxRequests})";
            return new SourceResponse(0, null, "request cap reached");
        }
        if (Requests > 0)
            await _pause(_delay, ct);
        Requests++;

        var response = await _client.GetAsync(url, timeout, ct);
        if (response.Status is 403 or 429)
        {
            Stopped = $"HTTP {response.Status} from the site — stopped at once";
            return response;
        }
        if (!response.Ok)
            return Failed(response);
        _failures = 0;
        return response;
    }

    private SourceResponse Failed(SourceResponse response)
    {
        if (++_failures >= MaxConsecutiveFailures)
            Stopped = $"{MaxConsecutiveFailures} failed requests in a row";
        return response;
    }
}
