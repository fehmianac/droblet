using System.Text.Json;
using System.Text.Json.Serialization;

namespace Infrastructure.Serialization;

/// <summary>Queue message JSON (camelCase, enums by name). Shared by Api (publish) and workers (consume).</summary>
public static class MessageSerializer
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    public static string Serialize(object message) => JsonSerializer.Serialize(message, message.GetType(), Options);

    public static T Deserialize<T>(string body) =>
        JsonSerializer.Deserialize<T>(body, Options) ?? throw new JsonException($"Empty {typeof(T).Name} message.");
}
