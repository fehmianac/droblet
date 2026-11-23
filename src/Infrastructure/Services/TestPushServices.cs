using System.Text.Json;
using Amazon.Lambda;
using Amazon.Lambda.Model;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Services;
using Microsoft.Extensions.Logging;

namespace Infrastructure.Services;

/// <summary><see cref="ITestPushSender"/>: the same message as the Ops push-test command, to the tenant's own devices.</summary>
public sealed class TestPushSender(IRepository repository, IPushProvider push, ILogger<TestPushSender> logger) : ITestPushSender
{
    public async Task<TestPushResultDto> SendAsync(string tenantId, CancellationToken ct)
    {
        var devices = (await repository.GetAllAsync<DeviceEntity>(DeviceEntity.GetPk(tenantId), ct)).Where(d => !string.IsNullOrEmpty(d.PushToken)).ToList();
        var results = new List<TestPushDeviceDto>(devices.Count);
        foreach (var device in devices)
        {
            var result = await push.SendAsync(new PushMessage(device.PushToken!, "Droblet", "Deneme bildirimi · Test notification",
                new Dictionary<string, string> { ["type"] = "test" }) { TokenType = device.PushTokenType ?? PushTokenType.Fcm }, ct);
            results.Add(new TestPushDeviceDto(device.Platform, result.ToString()));
        }
        var sent = results.Count(r => r.Result == nameof(PushResult.Sent));
        logger.LogInformation("Test push for tenant {TenantId}: {Sent} of {Devices} devices", tenantId, sent, devices.Count);
        return new TestPushResultDto(devices.Count, sent, results);
    }
}

/// <summary><see cref="ITestPushInvoker"/> over a synchronous invoke of the notifier's TestPush function (non-prod stages only).</summary>
public sealed class LambdaTestPushInvoker(IAmazonLambda lambda, ILogger<LambdaTestPushInvoker> logger) : ITestPushInvoker
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    public async Task<TestPushResultDto?> InvokeAsync(string tenantId, CancellationToken ct)
    {
        try
        {
            var response = await lambda.InvokeAsync(new InvokeRequest
            {
                FunctionName = TestPushRules.FunctionName(StorageKeys.Stage),
                InvocationType = InvocationType.RequestResponse,
                Payload = JsonSerializer.Serialize(new TestPushRequest(tenantId)),
            }, ct);
            if (response.StatusCode != 200 || !string.IsNullOrEmpty(response.FunctionError))
            {
                logger.LogWarning("Test push function answered {Status} {Error}", response.StatusCode, response.FunctionError);
                return null;
            }
            return await JsonSerializer.DeserializeAsync<TestPushResultDto>(response.Payload, Json, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning("Test push function could not be called ({Error})", ex.GetType().Name);
            return null;
        }
    }
}

public sealed class TestPushService(ITestPushInvoker invoker, IRateLimiter rateLimiter) : ITestPushService
{
    public bool Available => TestPushRules.IsAvailable(StorageKeys.Stage);

    public async Task<(TestPushOutcome Outcome, TestPushResultDto? Result)> SendAsync(string tenantId, CancellationToken ct)
    {
        if (!Available)
            return (TestPushOutcome.NotAvailable, null);
        if (!await rateLimiter.TryAcquireAsync("test-push", tenantId, TestPushRules.PerMinute, TimeSpan.FromMinutes(1), ct))
            return (TestPushOutcome.RateLimited, null);
        return await invoker.InvokeAsync(tenantId, ct) is { } result ? (TestPushOutcome.Ok, result) : (TestPushOutcome.Failed, null);
    }
}
