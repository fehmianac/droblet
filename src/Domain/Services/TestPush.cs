namespace Domain.Services;

/// <summary>One device of a test push: its platform as registered ("ios" / "android" / null) and what the push provider answered.</summary>
public sealed record TestPushDeviceDto(string? Platform, string Result);

/// <summary>Devices = devices of the account with a push token; Sent = how many the provider accepted.</summary>
public sealed record TestPushResultDto(int Devices, int Sent, IReadOnlyList<TestPushDeviceDto> Results);

/// <summary>Payload of the notifier's TestPush function.</summary>
public sealed record TestPushRequest(string TenantId);

/// <summary>
/// "Deneme bildirimi gönder" (owner decision 2026-11-23): a test tool of the non-prod stages. The button on Profil sends
/// one notification to the caller's own devices, so push can be checked on a real phone without the Ops tool. Never on prod:
/// the endpoint answers 404 there, GET v1/config says testPush false, and the notifier function is not deployed.
/// </summary>
public static class TestPushRules
{
    public const int PerMinute = 5;
    public static bool IsAvailable(string stage) => !string.Equals(stage, "prod", StringComparison.OrdinalIgnoreCase);
    public static string FunctionName(string stage) => $"droblet-{stage}-notifier-test-push";
}

/// <summary>Notifier side: sends the test notification to every device of the tenant that has a push token.</summary>
public interface ITestPushSender
{
    Task<TestPushResultDto> SendAsync(string tenantId, CancellationToken ct);
}

/// <summary>Api side seam: the push secrets live with the notifier, so the Api asks its TestPush function. Null = the call failed.</summary>
public interface ITestPushInvoker
{
    Task<TestPushResultDto?> InvokeAsync(string tenantId, CancellationToken ct);
}

public enum TestPushOutcome { Ok, NotAvailable, RateLimited, Failed }

public interface ITestPushService
{
    bool Available { get; }
    Task<(TestPushOutcome Outcome, TestPushResultDto? Result)> SendAsync(string tenantId, CancellationToken ct);
}
