using System.Text.Json.Serialization;

namespace Domain.Entity.Base;

// Aynı hesabın birden fazla cihazından düzenlenebilen her entity bunu uygular.
// Version 0 = henüz yazılmamış kayıt; ilk yazımda 1 olur.
public interface IVersionedEntity : IEntity
{
    [JsonPropertyName("version")] public long Version { get; set; }
}
