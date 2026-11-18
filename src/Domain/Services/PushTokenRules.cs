using Domain.Enum;

namespace Domain.Services;

/// <summary>
/// Which push channel a device token belongs to. The app says it (pushTokenType); older clients do not, so it is
/// inferred: an iOS token made only of hex digits is a raw APNs device token (expo-notifications on iOS), anything
/// else (Android, FCM tokens with ':' / '-' / '_') goes through FCM.
/// </summary>
public static class PushTokenRules
{
    public static PushTokenType Resolve(DevicePlatform platform, string token, PushTokenType? declared)
    {
        if (declared is { } type)
            return type;
        return platform == DevicePlatform.Ios && token.Length >= 32 && token.All(char.IsAsciiHexDigit)
            ? PushTokenType.Apns
            : PushTokenType.Fcm;
    }
}
