using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Admin;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Ops.Commands;

/// <summary>
/// push-test [--email a@b.c]: says whether iOS (APNs) and Android (FCM) push are configured on the stage (never prints a
/// secret), and with --email sends one test notification to each device that user registered, printing the outcome.
/// </summary>
internal static class PushTestCommand
{
    public static async Task<int> RunAsync(IServiceProvider services, OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        var apns = services.GetRequiredService<IOptionsMonitor<ApnsOptions>>().CurrentValue;
        var fcm = services.GetRequiredService<IOptionsMonitor<FirebaseServiceAccountOptions>>().CurrentValue;
        output.Line($"iOS (APNs): {(apns.IsConfigured ? "configured" : "NOT configured")} · key id {Mask(apns.ApnsKeyId)} · team {apns.ApnsTeamId} · topic {apns.ApnsTopic}");
        output.Line($"Android (FCM): {(fcm.IsConfigured ? "configured" : "NOT configured")} · project {fcm.ProjectId ?? "-"}");

        if (args.Option("email") is not { } email)
            return apns.IsConfigured && fcm.IsConfigured ? 0 : 1;

        var page = await services.GetRequiredService<IAdminAppUserService>().SearchAsync(email.Trim(), null, 1, ct);
        if (page.Items.FirstOrDefault(u => string.Equals(u.Email, email.Trim(), StringComparison.OrdinalIgnoreCase)) is not { } user)
        {
            output.Error($"No app user with e-mail {email}.");
            return 1;
        }
        var devices = (await services.GetRequiredService<IRepository>().GetAllAsync<DeviceEntity>(DeviceEntity.GetPk(user.TenantId), ct))
            .Where(d => !string.IsNullOrEmpty(d.PushToken)).ToList();
        if (devices.Count == 0)
        {
            output.Error("The user has no device with a push token (open the app and allow notifications first).");
            return 1;
        }

        var push = services.GetRequiredService<IPushProvider>();
        var failed = 0;
        foreach (var device in devices)
        {
            var type = device.PushTokenType ?? PushTokenType.Fcm;
            var result = await push.SendAsync(new PushMessage(device.PushToken!, "Droblet", "Deneme bildirimi · Test notification",
                new Dictionary<string, string> { ["type"] = "test" }) { TokenType = type }, ct);
            output.Line($"device {device.Platform} ({type}) token …{Tail(device.PushToken)} → {result}");
            if (result != PushResult.Sent)
                failed++;
        }
        return failed == 0 ? 0 : 1;
    }

    private static string Mask(string? value) => string.IsNullOrEmpty(value) || value == "CHANGE_ME" ? "-" : value;
    private static string Tail(string? token) => token is { Length: > 6 } t ? t[^6..] : "?";
}
