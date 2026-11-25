using System.Diagnostics;
using Domain.Enum;
using Domain.Services.Ai;
using Infrastructure.Ai;
using Microsoft.Extensions.DependencyInjection;
using Ops;
using Ops.Commands;

// Operator tool for dev (BACKEND_ENGINEER.md: data is changed through the same services as the admin API, never by
// hand in the console). Runs in GitHub Actions (.github/workflows/ops-dev.yml) with the deploy keys:
//
//   dotnet run --project tools/Ops -- <command> --stage dev [options]      (see OpsArguments.Usage)
//
// Output: console + ops-output/output.log, Markdown for the job summary in ops-output/summary.md.

var (arguments, error) = OpsArguments.Parse(args);
var output = new OpsOutput(Environment.GetEnvironmentVariable("OPS_OUTPUT_DIR") is { Length: > 0 } dir ? dir : Path.Combine(Directory.GetCurrentDirectory(), "ops-output"));
if (arguments is null)
{
    output.Error(error!);
    output.Error(OpsArguments.Usage);
    output.Summary($"**Ops refused:** {error}");
    output.Flush();
    return 2;
}

using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(50));
var exit = 1;
try
{
    if (arguments.Command == OpsArguments.Logs)
    {
        exit = await LogsCommand.RunAsync(arguments, output, cts.Token);
    }
    else if (arguments.Command == OpsArguments.GoogleAuth)
    {
        exit = await GoogleAuthCommand.RunAsync(arguments, output, cts.Token);
    }
    else if (arguments.Command == OpsArguments.PublicUrls)
    {
        exit = await PublicUrlsCommand.RunAsync(arguments, output, cts.Token);
    }
    else if (arguments.Command == OpsArguments.CdnCheck)
    {
        exit = await CdnCheckCommand.RunAsync(arguments, output, cts.Token);
    }
    else if (arguments.Command == OpsArguments.ImportBrand && arguments.Flag("list"))
    {
        exit = Ops.Commands.BrandImport.ImportBrandCommand.List(output);
    }
    else if (arguments.Command == OpsArguments.AiSettings)
    {
        exit = await AiSettingsCommand.RunAsync(arguments, output, cts.Token);
    }
    else
    {
        await using var services = OpsHost.Build(arguments.Stage, output);
        exit = arguments.Command switch
        {
            OpsArguments.GrantTestPremium => await TestPremiumCommands.GrantAsync(services, arguments, output, cts.Token),
            OpsArguments.RevokeTestPremium => await TestPremiumCommands.RevokeAsync(services, arguments, output, cts.Token),
            OpsArguments.SetRecognitionUsed => await TestPremiumCommands.SetRecognitionUsedAsync(services, arguments, output, cts.Token),
            OpsArguments.GenerateLibraryImages => await LibraryImagesCommand.RunAsync(services, arguments, output, cts.Token),
            OpsArguments.GenerateMarketingImages => await MarketingImagesCommand.RunAsync(services, arguments, output, cts.Token),
            OpsArguments.AiSmoke => await new AiSmokeCommand(services, arguments, output).RunAsync(cts.Token),
            OpsArguments.AiProbe => await ProbeAsync(services, output, cts.Token),
            OpsArguments.AiPerf => await new AiPerfCommand(services, arguments, output).RunAsync(cts.Token),
            OpsArguments.AiBench => await AiBenchCommand.RunAsync(services, arguments, output, cts.Token),
            OpsArguments.AiCost => await new AiCostCommand(services, arguments, output).RunAsync(cts.Token),
            OpsArguments.PushTest => await PushTestCommand.RunAsync(services, arguments, output, cts.Token),
            OpsArguments.SeedFeedPosts => await SeedFeedPostsCommand.RunAsync(services, arguments, output, arguments.Stage, cts.Token),
            OpsArguments.SplitFeedPosts => await SplitFeedPostsCommand.RunAsync(services, arguments, output, cts.Token),
            OpsArguments.ImportBrand or OpsArguments.ImportVakko => await Ops.Commands.BrandImport.ImportBrandCommand.RunAsync(services, arguments, output, cts.Token),
            OpsArguments.ColorFeedPieces => await ColorFeedPiecesCommand.RunAsync(services, arguments, output, cts.Token),
            OpsArguments.SeedWeeklyEdit => await SeedWeeklyEditCommand.RunAsync(services, arguments, output, cts.Token),
            OpsArguments.SegmentFeedPosts => await SegmentFeedPostsCommand.RunAsync(services, arguments, output, cts.Token),
            OpsArguments.NoteFeedPosts => await NoteFeedPostsCommand.RunAsync(services, arguments, output, cts.Token),
            OpsArguments.SeedFeedStories => await SeedFeedStoriesCommand.RunAsync(services, arguments, output, cts.Token),
            OpsArguments.MigrateLibraryItemImages => await MigrateLibraryItemImagesCommand.RunAsync(services, arguments, output, cts.Token),
            OpsArguments.AccountSmoke => await new AccountSmokeCommand(services, arguments, output).RunAsync(cts.Token),
            OpsArguments.AiAdminSmoke => await new AiAdminSmokeCommand(services, arguments, output).RunAsync(cts.Token),
            OpsArguments.AiUsageBackfill => await AiUsageBackfillCommand.RunAsync(services, arguments, output, cts.Token),
            OpsArguments.PublishItemImages => await PublishItemImagesCommand.RunAsync(services, arguments, output, cts.Token),
            OpsArguments.OutfitImportSmoke => await new OutfitImportSmokeCommand(services, arguments, output).RunAsync(cts.Token),
            _ => 2,
        };
    }
}
catch (Exception ex) when (ex is not OperationCanceledException)
{
    output.Error($"{arguments.Command} failed: {ex.GetType().Name}: {ex.Message}");
    output.Summary($"**{arguments.Command} failed:** `{ex.GetType().Name}: {ex.Message}`");
}
finally
{
    output.Flush();
}
return exit;

// One direct text-model call with the workers' stylist prompt and strict schema; a failure prints the API's own body.
static async Task<int> ProbeAsync(IServiceProvider services, OpsOutput output, CancellationToken ct)
{
    var provider = services.GetRequiredService<OpenAiProvider>();
    var input = """
        {"date":"2026-11-19","season":"autumn","occasion":"office","weather":null,"freeText":null,"language":"en","onlyMyWardrobe":true,
         "pinnedItemId":null,"avoidCombinations":[],"count":1,"productCandidates":[],
         "candidates":[{"id":"a","category":"top","colorIds":["white"],"fabric":"cotton","seasons":["autumn"]},
                       {"id":"b","category":"bottom","colorIds":["black"],"fabric":"wool","seasons":["autumn"]},
                       {"id":"c","category":"shoes","colorIds":["black"],"fabric":"leather","seasons":["autumn"]}]}
        """;
    var watch = Stopwatch.StartNew();
    try
    {
        var answer = await provider.GenerateAsync(new StylistPrompt(JobKind.StylistOutfit, input, "en"), ct);
        output.Table(["call", "outcome", "duration", "answer"], [["chat (stylist outfit schema)", "ok", $"{watch.Elapsed.TotalSeconds:0.0}s", answer.Length > 400 ? answer[..400] + "…" : answer]]);
        return 0;
    }
    catch (Exception ex) when (ex is AiProviderException or HttpRequestException)
    {
        output.Table(["call", "outcome", "duration", "error"], [["chat (stylist outfit schema)", "failed", $"{watch.Elapsed.TotalSeconds:0.0}s", ex.Message]]);
        return 1;
    }
}
