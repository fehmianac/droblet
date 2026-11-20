using System.Text.RegularExpressions;

namespace Ops;

/// <summary>
/// Command line of the operator tool:  Ops &lt;command&gt; --stage dev [--option value] [--flag]
/// Pure (no AWS, no network) so the guards are unit-tested: prod refusal, the image-call cap, id and range checks.
/// </summary>
internal sealed partial record OpsArguments(string Command, string Stage, IReadOnlyDictionary<string, string> Options, IReadOnlySet<string> Flags)
{
    public const string GrantTestPremium = "grant-test-premium";
    public const string RevokeTestPremium = "revoke-test-premium";
    public const string GenerateLibraryImages = "generate-library-images";
    public const string AiSmoke = "ai-smoke";
    public const string AiProbe = "ai-probe";
    public const string AiPerf = "ai-perf";
    public const string AiBench = "ai-bench";
    public const string AiCost = "ai-cost";

    /// <summary>ai-cost: ceiling of synthetic text-model calls in one run (image calls use <see cref="MaxImageCallsPerRun"/>).</summary>
    public const int MaxTextCallsPerRun = 120;

    /// <summary>ai-perf: at most this many runs of every flow (each run renders one try-on and cleans one item photo).</summary>
    public const int MaxPerfRuns = 10;
    public const string Logs = "logs";
    public const string AiSettings = "ai-settings";
    public const string CdnCheck = "cdn-check";
    public const string PublicUrls = "public-urls";
    public const string GoogleAuth = "google-auth";
    public const string PushTest = "push-test";
    public const string MigrateLibraryItemImages = "migrate-library-item-images";
    public const string AccountSmoke = "account-smoke";
    public const string OutfitImportSmoke = "outfit-import-smoke";
    public const string AiAdminSmoke = "ai-admin-smoke";
    /// <summary>Replays the job table (≤ 7 days) into the AI usage counters. No AI call; idempotent; allowed on prod.</summary>
    public const string AiUsageBackfill = "ai-usage-backfill";
    /// <summary>Copies existing cleaned item images to public/items/ with their thumbnails (docs/images.md). No AI call; idempotent; allowed on prod.</summary>
    public const string PublishItemImages = "publish-item-images";

    /// <summary>Hard ceiling of image-model calls in one run (library images and synthetic fixtures together).</summary>
    public const int MaxImageCallsPerRun = 30;

    public static readonly IReadOnlyList<string> Commands = [GrantTestPremium, RevokeTestPremium, GenerateLibraryImages, AiSmoke, AiProbe, AiPerf, AiBench, AiCost, Logs, MigrateLibraryItemImages, AccountSmoke, OutfitImportSmoke, AiSettings, AiAdminSmoke, AiUsageBackfill, PublishItemImages, CdnCheck, PublicUrls, GoogleAuth, PushTest];

    /// <summary>Commands that create or change test accounts or spend AI credit on a throw-away user: never on prod.</summary>
    public static readonly IReadOnlySet<string> DevOnly = new HashSet<string>(StringComparer.Ordinal) { GrantTestPremium, RevokeTestPremium, AiSmoke, AiProbe, AiPerf, AiBench, AiCost, AccountSmoke, OutfitImportSmoke, AiSettings, AiAdminSmoke, PublicUrls };

    private static readonly IReadOnlyDictionary<string, string[]> AllowedOptions = new Dictionary<string, string[]>(StringComparer.Ordinal)
    {
        [GrantTestPremium] = ["email", "credits", "days"],
        [RevokeTestPremium] = ["email"],
        [GenerateLibraryImages] = ["only", "max-calls", "quality", "price-per-image"],
        [AiSmoke] = ["api-url", "price-per-image"],
        [AiProbe] = [],
        [AiPerf] = ["api-url", "runs", "flows"],
        [AiBench] = ["reps", "efforts", "qualities", "models", "max-calls"],
        [AiCost] = ["days", "reps", "ops", "text-variants", "image-variants", "max-calls", "max-text-calls"],
        [Logs] = ["function", "minutes", "filter", "limit"],
        [AiSettings] = ["apply"],
        [CdnCheck] = ["base"],
        [PublicUrls] = [],
        [GoogleAuth] = ["add-client-id"],
        [PushTest] = ["email"],
        [MigrateLibraryItemImages] = [],
        [AccountSmoke] = ["api-url"],
        [OutfitImportSmoke] = ["api-url"],
        [AiAdminSmoke] = ["api-url"],
        [AiUsageBackfill] = ["days"],
        [PublishItemImages] = [],
    };

    private static readonly IReadOnlyDictionary<string, string[]> AllowedFlags = new Dictionary<string, string[]>(StringComparer.Ordinal)
    {
        [GrantTestPremium] = [],
        [RevokeTestPremium] = [],
        [GenerateLibraryImages] = ["dry-run", "force"],
        [AiSmoke] = ["keep-user", "items-only", "prereq-only"],
        [AiProbe] = [],
        [AiPerf] = ["keep-user", "face"],
        [AiBench] = ["text-only", "image-only"],
        [AiCost] = ["usage-only", "synthetic-only", "text-only", "image-only"],
        [Logs] = [],
        [AiSettings] = [],
        [CdnCheck] = [],
        [PublicUrls] = ["enable", "disable"],
        [GoogleAuth] = [],
        [PushTest] = [],
        [MigrateLibraryItemImages] = ["dry-run"],
        [AccountSmoke] = ["keep-user"],
        [OutfitImportSmoke] = ["keep-user"],
        [AiAdminSmoke] = [],
        [AiUsageBackfill] = ["dry-run"],
        [PublishItemImages] = ["dry-run", "wait", "inline"],
    };

    [GeneratedRegex("^lib-[a-z0-9]+(-[a-z0-9]+)*$")]
    private static partial Regex LibraryIdPattern();

    [GeneratedRegex("^[a-z0-9-]{1,64}$")]
    private static partial Regex FunctionPattern();


    [GeneratedRegex(@"^ops-presets/[a-z0-9-]+\.json$")]
    private static partial Regex AiSettingsPresetPattern();

    public string? Option(string name) => Options.TryGetValue(name, out var value) ? value : null;
    public bool Flag(string name) => Flags.Contains(name);
    public bool DryRun => Flag("dry-run");
    public bool Force => Flag("force");

    public int IntOption(string name, int fallback) => Option(name) is { } raw && int.TryParse(raw, out var value) ? value : fallback;

    public decimal DecimalOption(string name, decimal fallback) =>
        Option(name) is { } raw && decimal.TryParse(raw, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var value) ? value : fallback;

    /// <summary>--only a,b,c → the ids (empty = every item).</summary>
    public IReadOnlyList<string> OnlyIds =>
        (Option("only") ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct(StringComparer.Ordinal).ToList();

    /// <summary>Image-call budget of this run: --max-calls, never above <see cref="MaxImageCallsPerRun"/>.</summary>
    public int MaxImageCalls => Math.Clamp(IntOption("max-calls", MaxImageCallsPerRun), 0, MaxImageCallsPerRun);

    /// <summary>ai-perf flows (default: all).</summary>
    public static readonly IReadOnlyList<string> AllPerfFlows = ["outfit", "week", "pack", "item", "palette", "tryon"];

    public IReadOnlyList<string> PerfFlows =>
        Option("flows") is { } raw ? raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Select(f => f.ToLowerInvariant()).Distinct().ToList() : AllPerfFlows;

    public static (OpsArguments? Arguments, string? Error) Parse(IReadOnlyList<string> args)
    {
        if (args.Count == 0 || args[0].StartsWith("--", StringComparison.Ordinal))
            return (null, "missing command");
        var command = args[0].Trim().ToLowerInvariant();
        if (!Commands.Contains(command))
            return (null, $"unknown command '{args[0]}'");

        var options = new Dictionary<string, string>(StringComparer.Ordinal);
        var flags = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 1; i < args.Count; i++)
        {
            var token = args[i];
            if (!token.StartsWith("--", StringComparison.Ordinal) || token.Length <= 2)
                return (null, $"unexpected argument '{token}'");
            var name = token[2..].ToLowerInvariant();
            string? value = null;
            var eq = name.IndexOf('=', StringComparison.Ordinal);
            if (eq > 0)
            {
                value = token[(2 + eq + 1)..];
                name = name[..eq];
            }
            if (name == "stage" || AllowedOptions[command].Contains(name))
            {
                if (value is null)
                {
                    if (i + 1 >= args.Count || args[i + 1].StartsWith("--", StringComparison.Ordinal))
                        return (null, $"--{name} needs a value");
                    value = args[++i];
                }
                if (!options.TryAdd(name, value))
                    return (null, $"--{name} given twice");
            }
            else if (AllowedFlags[command].Contains(name) && value is null)
                flags.Add(name);
            else
                return (null, $"unknown option --{name} for {command}");
        }

        if (!options.Remove("stage", out var stage) || string.IsNullOrWhiteSpace(stage))
            return (null, "--stage is required (dev | prod)");
        var parsed = new OpsArguments(command, stage.Trim().ToLowerInvariant(), options, flags);
        var error = parsed.Validate();
        return error is null ? (parsed, null) : (null, error);
    }

    /// <summary>Guards that hold before anything touches AWS.</summary>
    public string? Validate()
    {
        if (Stage is not ("dev" or "prod"))
            return $"unknown stage '{Stage}' (dev | prod)";
        if (Stage == "prod" && DevOnly.Contains(Command))
            return $"{Command} is dev only — refused on prod";

        switch (Command)
        {
            case GrantTestPremium or RevokeTestPremium:
                if (Option("email") is not { } email || !email.Contains('@', StringComparison.Ordinal) || email.Length > 254)
                    return "--email is required";
                if (Option("credits") is { } credits && (!int.TryParse(credits, out var c) || c is < 1 or > 500))
                    return "--credits must be 1–500";
                if (Option("days") is { } days && (!int.TryParse(days, out var d) || d is < 1 or > 90))
                    return "--days must be 1–90";
                break;
            case GenerateLibraryImages:
                if (OnlyIds.FirstOrDefault(id => !LibraryIdPattern().IsMatch(id)) is { } bad)
                    return $"--only: '{bad}' is not a library id (lib-…)";
                if (Option("max-calls") is { } max && (!int.TryParse(max, out var m) || m is < 0 or > MaxImageCallsPerRun))
                    return $"--max-calls must be 0–{MaxImageCallsPerRun}";
                if (Option("quality") is { } quality && quality is not ("low" or "medium" or "high" or "auto"))
                    return "--quality must be low | medium | high | auto";
                break;
            case AiPerf:
                if (Option("runs") is { } runs && (!int.TryParse(runs, out var r) || r is < 1 or > MaxPerfRuns))
                    return $"--runs must be 1–{MaxPerfRuns}";
                if (PerfFlows.FirstOrDefault(f => !AllPerfFlows.Contains(f)) is { } flow)
                    return $"--flows: unknown flow '{flow}' ({string.Join(", ", AllPerfFlows)})";
                break;
            case AiBench:
                if (Option("reps") is { } reps && (!int.TryParse(reps, out var rp) || rp is < 1 or > 5))
                    return "--reps must be 1–5";
                if (Option("max-calls") is { } maxCalls && (!int.TryParse(maxCalls, out var mc) || mc is < 0 or > MaxImageCallsPerRun))
                    return $"--max-calls must be 0–{MaxImageCallsPerRun}";
                break;
            case AiCost:
                if (Option("days") is { } days2 && (!int.TryParse(days2, out var dd) || dd is < 1 or > 90))
                    return "--days must be 1–90";
                if (Option("reps") is { } costReps && (!int.TryParse(costReps, out var cr) || cr is < 1 or > 3))
                    return "--reps must be 1–3";
                if (Option("max-calls") is { } costCalls && (!int.TryParse(costCalls, out var cc) || cc is < 0 or > MaxImageCallsPerRun))
                    return $"--max-calls must be 0–{MaxImageCallsPerRun}";
                if (Option("max-text-calls") is { } textCalls && (!int.TryParse(textCalls, out var tc) || tc is < 0 or > MaxTextCallsPerRun))
                    return $"--max-text-calls must be 0–{MaxTextCallsPerRun}";
                if (Option("text-variants") is { } tv && Ops.Commands.CostVariant.ParseError(tv) is { } tvError)
                    return "--text-variants: " + tvError;
                if (Option("image-variants") is { } iv && Ops.Commands.CostVariant.ParseError(iv) is { } ivError)
                    return "--image-variants: " + ivError;
                break;
            case AiUsageBackfill:
                if (Option("days") is { } backfillDays && (!int.TryParse(backfillDays, out var bd) || bd is < 1 or > 7))
                    return "--days must be 1–7 (the job table keeps 7 days)";
                break;
            case PublishItemImages:
                if (Flag("wait") && Flag("inline"))
                    return "--wait and --inline exclude each other (--inline already waits)";
                break;
            case GoogleAuth:
                if (Option("add-client-id") is { } clientId && !Ops.Commands.GoogleAuthCommand.ClientIdPattern().IsMatch(clientId))
                    return "--add-client-id must be an OAuth client id (…apps.googleusercontent.com)";
                break;
            case AiSettings:
                if (Option("apply") is { } preset && !AiSettingsPresetPattern().IsMatch(preset))
                    return "--apply takes a preset from ops-presets/ (e.g. ops-presets/dev-worker-ai.json)";
                break;
            case Logs:
                if (Option("function") is not { } fn || !FunctionPattern().IsMatch(fn))
                    return "--function is required (e.g. stylist, tryon, palette, item-processor, api)";
                if (Option("minutes") is { } minutes && (!int.TryParse(minutes, out var mi) || mi is < 1 or > 1440))
                    return "--minutes must be 1–1440";
                break;
        }
        return null;
    }

    public const string Usage =
        "Usage: Ops <command> --stage dev [options]\n" +
        "  grant-test-premium      --email <e> [--credits N] [--days N]   (dev only)\n" +
        "  revoke-test-premium     --email <e>                            (dev only)\n" +
        "  generate-library-images [--only id,id] [--dry-run] [--force] [--max-calls N<=30] [--quality high]\n" +
        "  ai-smoke                [--api-url URL] [--keep-user] [--items-only | --prereq-only]  (dev only)\n" +
        "  account-smoke           [--api-url URL] [--keep-user]  (dev only; e-mail verification + data export)\n" +
        "  ai-admin-smoke          [--api-url URL]  (dev only; admin AI prompts / trials / publish → a stylist job uses it → rollback; ≤ 4 AI calls)\n" +
        "  outfit-import-smoke     [--api-url URL] [--keep-user]  (dev only; 3 outfit photos → review → commit, then a re-import that matches)\n" +
        "  ai-perf                 [--runs N<=10] [--flows outfit,week,pack,item,palette,tryon] [--face] [--keep-user]  (dev only; p50/p95 per stage)\n" +
        "  ai-bench                [--reps N<=5] [--efforts default,low,minimal] [--qualities default,low,medium] [--text-only | --image-only]  (dev only; direct provider calls)\n" +
        "  ai-cost                 [--days 7] [--usage-only | --synthetic-only] [--reps N<=3] [--ops outfit,week,…] [--text-variants base;low:effort=low] [--image-variants low:quality=low,size=1024x1024]  (dev only; real usage from logs + synthetic cost per call)\n" +
        "  ai-probe                                                        (dev only; one direct text-model call)\n" +
        "  ai-usage-backfill       [--days 7] [--dry-run]                 (no AI call; replays finished jobs into the AI usage counters, idempotent)\n" +
        "  logs                    --function stylist [--minutes 30] [--filter OpenAI] [--limit 200]\n" +
        "  migrate-library-item-images [--dry-run]                         (one-off, idempotent: library pieces → current library image)\n" +
        "  publish-item-images     [--dry-run] [--wait | --inline]       (no AI call; starts the admin Bakım job: cleaned piece images → public/items/ + 256/768 px thumbnails)";
}

/// <summary>Counts image-model calls of one run and refuses the call that would cross the cap.</summary>
internal sealed class ImageCallBudget(int max)
{
    public int Max { get; } = Math.Clamp(max, 0, OpsArguments.MaxImageCallsPerRun);
    public int Used { get; private set; }
    public int Remaining => Max - Used;

    public bool TryTake()
    {
        if (Used >= Max)
            return false;
        Used++;
        return true;
    }
}
