namespace Domain.Options;

/// <summary>
/// Notifier only: direct APNs (HTTP/2, token auth) for iOS devices that registered a raw APNs device token
/// (expo-notifications returns the APNs token on iOS, not an FCM token). SSM: SecureString notifier/Push/ApnsKey
/// (the .p8 file), String notifier/Push/ApnsKeyId and notifier/Push/ApnsTeamId. Any of them empty or CHANGE_ME = iOS push
/// switched off (PushResult.NotConfigured), exactly like FCM without its service account.
/// </summary>
public sealed class ApnsOptions
{
    public const string Section = "Push";

    public string? ApnsKey { get; set; }
    public string? ApnsKeyId { get; set; }
    public string? ApnsTeamId { get; set; }
    /// <summary>apns-topic = the app's bundle id.</summary>
    public string ApnsTopic { get; set; } = "com.alatech.droplet";
    public string ApnsProductionUrl { get; set; } = "https://api.push.apple.com";
    public string ApnsSandboxUrl { get; set; } = "https://api.sandbox.push.apple.com";

    public bool IsConfigured => ConfigSecret.IsSet(ApnsKey) && ConfigSecret.IsSet(ApnsKeyId) && ConfigSecret.IsSet(ApnsTeamId);
}
