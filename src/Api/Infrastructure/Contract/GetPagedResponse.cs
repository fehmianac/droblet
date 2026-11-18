namespace Api.Infrastructure.Contract;

public record GetPagedResponse<T>(IReadOnlyList<T> Items, string? PageToken, long Count);
