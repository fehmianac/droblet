using System.Text.Json;
using Amazon.SimpleSystemsManagement;
using Amazon.SimpleSystemsManagement.Model;
using Domain.Entity;
using Domain.Services.Admin;

namespace Infrastructure.Services.Admin;

/// <summary>
/// SSM String parameters by full name. The Api role may read the editable parameters and put exactly them
/// (template.yaml); SecureString values are never requested with decryption here.
/// </summary>
public sealed class SsmSettingsStore(Lazy<IAmazonSimpleSystemsManagement> ssm) : ISettingsStore
{
    public async Task<string?> GetAsync(string name, CancellationToken ct)
    {
        try
        {
            var response = await ssm.Value.GetParameterAsync(new GetParameterRequest { Name = name, WithDecryption = false }, ct);
            return response.Parameter.Type == ParameterType.SecureString ? null : response.Parameter.Value;
        }
        catch (ParameterNotFoundException)
        {
            return null;
        }
        catch (AmazonSimpleSystemsManagementException ex)
        {
            throw new SettingsUnavailableException($"Parameter {name} could not be read.", ex);
        }
    }

    public async Task PutAsync(string name, string value, CancellationToken ct)
    {
        try
        {
            await ssm.Value.PutParameterAsync(new PutParameterRequest { Name = name, Value = value, Type = ParameterType.String, Overwrite = true }, ct);
        }
        catch (AmazonSimpleSystemsManagementException ex)
        {
            throw new SettingsUnavailableException($"Parameter {name} could not be written.", ex);
        }
    }
}

/// <summary>Panel settings (docs/api/admin.md §5): only <see cref="SettingsCatalog"/> groups, validated, audited.</summary>
public sealed class AdminSettingsService(ISettingsStore store, IAuditLog audit, string stage) : IAdminSettingsService
{
    public async Task<IReadOnlyList<SettingGroupDto>> GetAllAsync(CancellationToken ct)
    {
        var groups = new List<SettingGroupDto>();
        foreach (var group in SettingsCatalog.Groups)
            groups.Add(SettingsCatalog.Read(group, stage, await store.GetAsync(group.Parameters[0].Name(stage), ct)));
        return groups;
    }

    public async Task<SettingWriteResult> UpdateAsync(AdminUserEntity actor, string groupName, IReadOnlyDictionary<string, JsonElement> values, string? ip, CancellationToken ct)
    {
        var group = SettingsCatalog.Find(groupName);
        if (group is null)
            return new SettingWriteResult(SettingWriteOutcome.NotFound);
        var errors = SettingsCatalog.Validate(group, values);
        if (errors.Count > 0)
            return new SettingWriteResult(SettingWriteOutcome.Invalid, Errors: errors);

        var current = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (var parameter in group.Parameters)
            current[parameter.Name(stage)] = await store.GetAsync(parameter.Name(stage), ct);

        var first = group.Parameters[0].Name(stage);
        var before = SettingsCatalog.Read(group, stage, current[first]);
        foreach (var (name, json) in current)
            await store.PutAsync(name, SettingsCatalog.Apply(json, values), ct);

        var after = SettingsCatalog.Read(group, stage, SettingsCatalog.Apply(current[first], values));
        await audit.WriteAsync(actor, "setting.update", "setting", group.Name,
            before.Fields.ToDictionary(f => f.Key, f => f.Value), after.Fields.ToDictionary(f => f.Key, f => f.Value), ip, ct);
        return new SettingWriteResult(SettingWriteOutcome.Ok, after);
    }
}
