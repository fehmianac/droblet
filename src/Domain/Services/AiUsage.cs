using System.Text.Json;
using Domain.Entity;
using Domain.Enum;

namespace Domain.Services;

/// <summary>One provider call as the usage counters see it: numbers and the model id only (no content).</summary>
public sealed record AiUsageCall(
    string Operation, string? Model, int Status, long InputTokens = 0, long OutputTokens = 0, long CachedTokens = 0,
    long ReasoningTokens = 0, long CostMicroUsd = 0)
{
    public bool Succeeded => Status is >= 200 and < 300;
    public bool IsImage => AiCost.IsImageOperation(Operation);
}

/// <summary>How a counted AI job ended. Refunded = failed and its reserved credit was given back.</summary>
public enum AiUsageOutcome { Completed, Failed, Refunded }

/// <summary>What one finished job (or one stage of an outfit import photo, or one admin trial) adds to the counters.</summary>
/// <param name="TenantId">The user's tenant, or <see cref="AiUsageEntity.AdminTenant"/> for an admin trial.</param>
/// <param name="MarkerId">Once-per-job key (the job id; "oi#{session}#{index}#{stage}"; "trial#{id}").</param>
/// <param name="CountsJob">False for a stage that only adds calls (the outfit import's detect stage).</param>
/// <param name="Source">Where the job came from when the kind alone is ambiguous (ItemClean of an outfit import commit).</param>
public sealed record AiUsageRecord(
    string TenantId, string MarkerId, JobKind? Kind, AiUsageOutcome Outcome, IReadOnlyList<AiUsageCall> Calls, DateTime At,
    bool CountsJob = true, string? Source = null);

/// <summary>Adds a finished job's usage to the durable counters, once per marker. Best effort: never throws.</summary>
public interface IAiUsageRecorder
{
    /// <summary>True when written now; false when already counted (or nothing to count, or the write failed and was logged).</summary>
    Task<bool> RecordAsync(AiUsageRecord record, CancellationToken ct);
}

/// <summary>The plan dimension of the aggregates: the user's tier when the job finished, or the admin trials.</summary>
public static class AiUsagePlans
{
    public const string Free = "free";
    public const string Premium = "premium";
    public const string Admin = "admin";

    public static readonly IReadOnlyList<string> All = [Free, Premium, Admin];

    public static string Of(Tier tier) => tier == Tier.Premium ? Premium : Free;
}

/// <summary>The usage operations (rows of the per-operation tables) and how a call is classified into one.</summary>
public static class AiUsageOperations
{
    public const string StylistOutfit = "stylist_outfit";
    public const string StylistWeek = "stylist_week";
    public const string StylistPack = "stylist_pack";
    public const string ItemDetection = "item_detection";
    public const string Cleanup = "cleanup";
    /// <summary>Background removal of a piece the user picked from a multi-item photo (ItemClean).</summary>
    public const string MultiItem = "multi_item";
    public const string ImportDetect = "import_detect";
    public const string ImportMatch = "import_match";
    public const string ImportCleanup = "import_cleanup";
    public const string Palette = "palette";
    public const string PhotoCheck = "photo_check";
    public const string TryOn = "tryon";
    public const string AdminTrial = "admin_trial";
    public const string Other = "other";

    /// <summary>ItemClean jobs queued by an outfit import commit carry this in their input (`usageSource`).</summary>
    public const string OutfitImportSource = "outfit_import";

    public static readonly IReadOnlyList<string> All =
    [
        StylistOutfit, StylistWeek, StylistPack, ItemDetection, Cleanup, MultiItem, ImportDetect, ImportMatch, ImportCleanup,
        Palette, PhotoCheck, TryOn, AdminTrial, Other,
    ];

    /// <summary>The usage operation of one provider call (operation = the provider's call name, e.g. "image_cleanup").</summary>
    public static string Classify(JobKind? kind, string callOperation, string? source = null)
    {
        if (callOperation == "photo_check")
            return PhotoCheck;
        var image = AiCost.IsImageOperation(callOperation);
        return kind switch
        {
            JobKind.AiTrial => AdminTrial,
            JobKind.StylistOutfit or JobKind.StylistComplete => StylistOutfit,
            JobKind.StylistWeek => StylistWeek,
            JobKind.StylistPack => StylistPack,
            JobKind.OutfitImport => callOperation == "item_match" ? ImportMatch : image ? ImportCleanup : ImportDetect,
            JobKind.ItemClean => source == OutfitImportSource ? ImportCleanup : MultiItem,
            JobKind.ItemProcess or JobKind.ItemSplit => image ? Cleanup : ItemDetection,
            JobKind.Palette => Palette,
            JobKind.TryOn => TryOn,
            _ => callOperation switch
            {
                "outfit" => StylistOutfit,
                "week_plan" => StylistWeek,
                "packing" => StylistPack,
                "item_detection" or "garment_draft" => ItemDetection,
                "image_cleanup" => Cleanup,
                "item_match" => ImportMatch,
                "palette_season" => Palette,
                "image_tryon" => TryOn,
                _ => Other,
            },
        };
    }

    /// <summary>The operation a job (its outcome, its failure) is counted under.</summary>
    public static string Primary(JobKind? kind, string? source = null) => kind switch
    {
        JobKind.AiTrial => AdminTrial,
        JobKind.StylistOutfit or JobKind.StylistComplete => StylistOutfit,
        JobKind.StylistWeek => StylistWeek,
        JobKind.StylistPack => StylistPack,
        JobKind.OutfitImport => ImportDetect,
        JobKind.ItemClean => source == OutfitImportSource ? ImportCleanup : MultiItem,
        JobKind.ItemProcess or JobKind.ItemSplit => ItemDetection,
        JobKind.Palette => Palette,
        JobKind.TryOn => TryOn,
        _ => Other,
    };

    /// <summary>`usageSource` of a job input (JSON), null when absent or not JSON.</summary>
    public static string? SourceOf(string? inputJson)
    {
        if (string.IsNullOrEmpty(inputJson) || !inputJson.Contains("usageSource", StringComparison.Ordinal))
            return null;
        try
        {
            using var document = JsonDocument.Parse(inputJson);
            return document.RootElement.ValueKind == JsonValueKind.Object
                   && document.RootElement.TryGetProperty("usageSource", out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

/// <summary>
/// Counter attribute names of an <see cref="AiUsageEntity"/> row and the increments one record adds. Totals:
/// jobs / completed / failed / refunded (job outcomes), calls / callErrors, in / out / cached / reasoning (tokens),
/// images (image outputs), cost (estimated micro-USD). Per operation <c>op|{op}|{metric}</c>; per model
/// <c>model|{model}|{metric}</c> (calls, in, out, cached, images, cost).
/// </summary>
public static class AiUsageCounters
{
    public const string Jobs = "jobs";
    public const string Completed = "completed";
    public const string Failed = "failed";
    public const string Refunded = "refunded";
    public const string Calls = "calls";
    public const string CallErrors = "callErrors";
    public const string Input = "in";
    public const string Output = "out";
    public const string Cached = "cached";
    public const string Reasoning = "reasoning";
    public const string Images = "images";
    public const string Cost = "cost";

    public const char Separator = '|';
    public const string OperationPrefix = "op|";
    public const string ModelPrefix = "model|";

    public static string Op(string operation, string metric) => $"{OperationPrefix}{operation}{Separator}{metric}";
    public static string Model(string model, string metric) => $"{ModelPrefix}{Clean(model)}{Separator}{metric}";

    /// <summary>Model ids go into attribute names: anything outside [A-Za-z0-9._:-] becomes "_" (max 80 chars).</summary>
    public static string Clean(string model)
    {
        var chars = model.Trim().Take(80).Select(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '-' or '_' or ':' ? c : '_').ToArray();
        return chars.Length == 0 ? "unknown" : new string(chars);
    }

    /// <summary>Everything one record adds (zeros left out). Empty = nothing to count.</summary>
    public static Dictionary<string, long> Increments(AiUsageRecord record)
    {
        var add = new Dictionary<string, long>(StringComparer.Ordinal);
        void Add(string name, long value)
        {
            if (value != 0)
                add[name] = add.GetValueOrDefault(name) + value;
        }

        if (record.CountsJob)
        {
            var primary = AiUsageOperations.Primary(record.Kind, record.Source);
            var outcome = record.Outcome switch
            {
                AiUsageOutcome.Completed => Completed,
                AiUsageOutcome.Refunded => Refunded,
                _ => Failed,
            };
            Add(Jobs, 1);
            Add(Op(primary, Jobs), 1);
            Add(outcome, 1);
            Add(Op(primary, outcome), 1);
            // A refund is a failure too ("failed" counts every failed job; "refunded" those that gave a credit back).
            if (record.Outcome == AiUsageOutcome.Refunded)
            {
                Add(Failed, 1);
                Add(Op(primary, Failed), 1);
            }
        }

        foreach (var call in record.Calls)
        {
            var op = AiUsageOperations.Classify(record.Kind, call.Operation, record.Source);
            var images = call.IsImage && call.Succeeded ? 1 : 0;
            Add(Calls, 1);
            Add(Op(op, Calls), 1);
            if (!call.Succeeded)
            {
                Add(CallErrors, 1);
                Add(Op(op, CallErrors), 1);
            }
            Add(Input, call.InputTokens);
            Add(Output, call.OutputTokens);
            Add(Cached, call.CachedTokens);
            Add(Reasoning, call.ReasoningTokens);
            Add(Images, images);
            Add(Cost, call.CostMicroUsd);
            Add(Op(op, Input), call.InputTokens);
            Add(Op(op, Output), call.OutputTokens);
            Add(Op(op, Cached), call.CachedTokens);
            Add(Op(op, Images), images);
            Add(Op(op, Cost), call.CostMicroUsd);
            if (call.Model is { Length: > 0 } model)
            {
                Add(Model(model, Calls), 1);
                Add(Model(model, Input), call.InputTokens);
                Add(Model(model, Output), call.OutputTokens);
                Add(Model(model, Cached), call.CachedTokens);
                Add(Model(model, Images), images);
                Add(Model(model, Cost), call.CostMicroUsd);
            }
        }
        return add;
    }

    /// <summary>
    /// Calls rebuilt from a job's stored aiCost (backfill of jobs finished before the counters existed): one entry per
    /// call of each operation, the operation's cost on the first. Tokens are unknown (0); the model is the job's only
    /// model when it used exactly one.
    /// </summary>
    public static IReadOnlyList<AiUsageCall> FromJobCost(IReadOnlyDictionary<string, long>? aiCost, IReadOnlyList<string>? models)
    {
        if (aiCost is null)
            return [];
        var model = models is { Count: 1 } ? models[0] : null;
        var calls = new List<AiUsageCall>();
        foreach (var (key, count) in aiCost.Where(kv => kv.Key.StartsWith("calls.", StringComparison.Ordinal)).OrderBy(kv => kv.Key, StringComparer.Ordinal))
        {
            var operation = key["calls.".Length..];
            var cost = aiCost.GetValueOrDefault(operation);
            for (var i = 0; i < count; i++)
                calls.Add(new AiUsageCall(operation, model, 200, CostMicroUsd: i == 0 ? cost : 0));
        }
        return calls;
    }
}
