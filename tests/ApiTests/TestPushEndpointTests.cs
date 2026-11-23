using System.Net;
using System.Text.Json;
using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Infrastructure.Services;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;

namespace ApiTests;

/// <summary>
/// "Deneme bildirimi gönder" (Profil, non-prod stages): the endpoint asks the notifier (here: the real sender behind a
/// fake invoker and a fake push provider) and reports what each of the caller's own devices got. No real push is sent.
/// </summary>
public class TestPushEndpointTests(StoreSocialApiFactory factory) : IClassFixture<StoreSocialApiFactory>
{
    private sealed class FakePush : IPushProvider
    {
        public List<PushMessage> Sent { get; } = [];
        public Task<PushResult> SendAsync(PushMessage message, CancellationToken ct)
        {
            Sent.Add(message);
            return Task.FromResult(message.Token.StartsWith("dead", StringComparison.Ordinal) ? PushResult.Unregistered : PushResult.Sent);
        }
    }

    private sealed class Invoker(ITestPushSender? sender) : ITestPushInvoker
    {
        public async Task<TestPushResultDto?> InvokeAsync(string tenantId, CancellationToken ct) => sender is null ? null : await sender.SendAsync(tenantId, ct);
    }

    private HttpClient Client(TestUser user, ITestPushInvoker invoker)
    {
        var client = factory.WithWebHostBuilder(b => b.ConfigureTestServices(services =>
        {
            services.RemoveAll<ITestPushInvoker>();
            services.AddSingleton(invoker);
        })).CreateClient();
        client.DefaultRequestHeaders.Authorization = user.Client.DefaultRequestHeaders.Authorization;
        return client;
    }

    [Fact]
    public async Task Config_SaysTestPushOnTheTestStage_AndTheRulesCloseProd()
    {
        Assert.True((await (await factory.CreateClient().GetAsync("v1/config")).JsonAsync()).GetProperty("testPush").GetBoolean());
        Assert.True(TestPushRules.IsAvailable("dev"));
        Assert.False(TestPushRules.IsAvailable("prod"));
        Assert.Equal("droblet-dev-notifier-test-push", TestPushRules.FunctionName("dev"));
    }

    [Fact]
    public async Task TestPush_GoesToTheCallersOwnDevicesOnly_ReportsEachDevice_NoDeviceIsZero_FailureIs502_LimitIs429()
    {
        var push = new FakePush();
        var sender = new TestPushSender(factory.Repository, push, NullLogger<TestPushSender>.Instance);
        var user = await factory.UserAsync();
        var other = await factory.UserAsync();
        var client = Client(user, new Invoker(sender));

        // No device with a token yet.
        var empty = await (await client.PostAsync("v1/tenant/notification/test-push", null)).JsonAsync();
        Assert.Equal((0, 0), (empty.GetProperty("devices").GetInt32(), empty.GetProperty("sent").GetInt32()));

        await factory.Repository.SaveAsync(new DeviceEntity { TenantId = user.TenantId, DeviceId = "d1", Platform = "ios", PushToken = "tok-ios", PushTokenType = PushTokenType.Apns, UpdatedAt = DateTime.UtcNow });
        await factory.Repository.SaveAsync(new DeviceEntity { TenantId = user.TenantId, DeviceId = "d2", Platform = "android", PushToken = "dead-android", UpdatedAt = DateTime.UtcNow });
        await factory.Repository.SaveAsync(new DeviceEntity { TenantId = user.TenantId, DeviceId = "d3", Platform = "ios", UpdatedAt = DateTime.UtcNow });   // no token
        await factory.Repository.SaveAsync(new DeviceEntity { TenantId = other.TenantId, DeviceId = "o1", Platform = "ios", PushToken = "tok-other", UpdatedAt = DateTime.UtcNow });

        var response = await client.PostAsync("v1/tenant/notification/test-push", null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.JsonAsync();
        Assert.Equal((2, 1), (body.GetProperty("devices").GetInt32(), body.GetProperty("sent").GetInt32()));
        Assert.Equal(["ios:Sent", "android:Unregistered"],
            body.GetProperty("results").EnumerateArray().Select(r => $"{r.GetProperty("platform").GetString()}:{r.GetProperty("result").GetString()}"));
        Assert.Equal(["tok-ios", "dead-android"], push.Sent.Select(m => m.Token));
        Assert.All(push.Sent, m => Assert.Equal("test", m.Data["type"]));
        Assert.Equal(PushTokenType.Apns, push.Sent[0].TokenType);
        Assert.Equal(PushTokenType.Fcm, push.Sent[1].TokenType);

        // The notifier cannot be reached.
        Assert.Equal(HttpStatusCode.BadGateway, (await Client(user, new Invoker(null)).PostAsync("v1/tenant/notification/test-push", null)).StatusCode);
        // Five a minute: three calls so far, two more pass, the sixth is refused.
        await client.PostAsync("v1/tenant/notification/test-push", null);
        await client.PostAsync("v1/tenant/notification/test-push", null);
        var limited = await client.PostAsync("v1/tenant/notification/test-push", null);
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.Contains("too_many_attempts", await limited.Content.ReadAsStringAsync());
        // Signed out: 401.
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().PostAsync("v1/tenant/notification/test-push", null)).StatusCode);
    }
}
