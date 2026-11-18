using System.Text.Json.Serialization;

namespace Domain.Entity.Base;

public interface IEntity
{
    [JsonPropertyName("pk")] public string Pk { get; }
    [JsonPropertyName("sk")] public string Sk { get; }
}
