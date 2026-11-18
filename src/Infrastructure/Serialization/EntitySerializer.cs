using System.Text.Json;
using System.Text.Json.Serialization;

namespace Infrastructure.Serialization;

/// <summary>Entity <-> JSON used for DynamoDB items. Enums are stored by name so reordering never corrupts data.</summary>
public static class EntitySerializer
{
    public static readonly JsonSerializerOptions Options = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter() },
    };

    public static string Serialize(object entity) => JsonSerializer.Serialize(entity, entity.GetType(), Options);

    public static T Deserialize<T>(string json) =>
        JsonSerializer.Deserialize<T>(json, Options) ?? throw new InvalidOperationException($"Could not deserialize {typeof(T).Name}.");
}
