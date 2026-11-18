using System.Text.Json;
using Domain.Entity;
using Domain.Enum;

namespace Domain.Domain;

public record JobDto(string Id, JobKind Kind, JobStatus Status, JobFailure? Failure, JsonElement? Result, DateTime CreatedAt, DateTime UpdatedAt);

public static class JobDtoMapper
{
    public static JobDto ToDto(this JobEntity entity) => new(
        entity.Id,
        entity.Kind,
        entity.Status,
        entity.Failure,
        string.IsNullOrEmpty(entity.Result) ? null : JsonDocument.Parse(entity.Result).RootElement.Clone(),
        entity.CreatedAt,
        entity.UpdatedAt);
}
