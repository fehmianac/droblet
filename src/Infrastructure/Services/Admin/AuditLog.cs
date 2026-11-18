using System.Text.Json;
using System.Text.Json.Serialization;
using Domain.Entity;
using Domain.Extensions;
using Domain.Manager;
using Domain.Services.Admin;
using Microsoft.Extensions.Logging;

namespace Infrastructure.Services.Admin;

/// <summary>
/// Admin audit trail (partition admin#audit, newest first). before / after are compact JSON summaries of the record,
/// cut at <see cref="MaxSummaryLength"/>; callers never pass secrets (passwords, codes, tokens, signing keys).
/// A failed audit write is logged and does not undo the admin action that was already applied.
/// </summary>
public sealed class AuditLog(IRepository repository, TimeProvider timeProvider, ILogger<AuditLog> logger) : IAuditLog
{
    public const int MaxSummaryLength = 4000;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public async Task WriteAsync(AdminUserEntity? actor, string action, string? targetType, string? targetId, object? before, object? after, string? ip, CancellationToken ct)
    {
        var now = timeProvider.GetUtcNow().UtcDateTime;
        var entry = new AdminAuditEntity
        {
            Id = Ulid.New(now),
            At = now,
            AdminId = actor?.Id,
            AdminEmail = actor?.Email,
            Action = action,
            TargetType = targetType,
            TargetId = targetId is { Length: > 200 } ? targetId[..200] : targetId,
            Before = Summary(before),
            After = Summary(after),
            Ip = ip,
        };
        try
        {
            await repository.SaveAsync(entry, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "Audit write failed for action {Action} by admin {AdminId}", action, actor?.Id);
        }
    }

    public async Task<AuditPageDto> QueryAsync(AuditQuery query, CancellationToken ct)
    {
        var (entities, pageToken, _) = await repository.GetPagedAsync<AdminAuditEntity>(AdminAuditEntity.GetPk(), query.PageToken, Math.Clamp(query.Limit, 1, 100), ct);
        var items = entities
            .Where(e => string.IsNullOrEmpty(query.AdminId) || e.AdminId == query.AdminId)
            .Where(e => string.IsNullOrEmpty(query.ActionPrefix) || e.Action.StartsWith(query.ActionPrefix, StringComparison.Ordinal))
            .Where(e => string.IsNullOrEmpty(query.TargetType) || e.TargetType == query.TargetType)
            .Select(e => new AuditEntryDto(e.Id, e.At, e.AdminId, e.AdminEmail, e.Action, e.TargetType, e.TargetId, e.Before, e.After, e.Ip))
            .ToList();
        return new AuditPageDto(items, pageToken);
    }

    public static string? Summary(object? value)
    {
        if (value is null)
            return null;
        var json = value as string ?? JsonSerializer.Serialize(value, value.GetType(), Json);
        return json.Length <= MaxSummaryLength ? json : json[..MaxSummaryLength] + "…";
    }
}
