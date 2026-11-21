using Domain.Entity;
using Domain.Manager;
using Domain.Services;
using Domain.Services.Ai;
using Infrastructure.Telemetry;
using Microsoft.Extensions.Logging;

namespace Infrastructure.Ai;

/// <summary>
/// Runs one admin trial in the Stylist worker (the only place besides the jobs that holds the provider key):
///  - prompt: the draft is used for exactly one call through the production path (OpenAiProvider + PromptDryRun),
///    the raw answer and whether it parses into the DTO the code reads are stored;
///  - model: one tiny chat call with the chosen model / effort / tier (image models: an access check, no image);
///  - models: GET /v1/models → the model allow-list (AiModelListEntity).
/// A trial runs at most once (Queued → Running is the claim; an SQS redelivery finds it Running and stops), so a
/// retry never costs a second call. Every failure is stored on the trial; nothing is thrown back to SQS.
/// Its calls go to the AI usage counters under the "admin" tenant (never a user), once per trial.
/// </summary>
public sealed class AiTrialRunner(IRepository repository, OpenAiProvider provider, IAiUsageRecorder usage, TimeProvider time, ILogger<AiTrialRunner> logger)
{
    public const long MaxImageBytes = 10 * 1024 * 1024;

    private static readonly HttpClient Download = new() { Timeout = TimeSpan.FromSeconds(15) };

    public async Task RunAsync(string trialId, CancellationToken ct)
    {
        var trial = await repository.GetAsync<AiTrialEntity>(AiTrialEntity.GetPk(), AiTrialEntity.GetSk(trialId), ct);
        if (trial is null || trial.Status != AiTrialStatus.Queued)
            return;
        trial.Status = AiTrialStatus.Running;
        await repository.SaveAsync(trial, ct);

        // Trials run outside a job run: their own telemetry, so the provider's calls (model, tokens, cost) are seen.
        var ownRun = AiTelemetry.Current is null;
        var timings = ownRun ? AiTelemetry.Begin() : AiTelemetry.Current!;
        try
        {
            switch (trial.Type)
            {
                case AiTrialType.Models:
                    var ids = await provider.ListModelsAsync(ct);
                    await repository.SaveAsync(new AiModelListEntity { Ids = [.. ids], FetchedAt = time.GetUtcNow().UtcDateTime }, ct);
                    trial.Output = string.Join('\n', ids);
                    trial.Parsed = true;
                    break;
                case AiTrialType.Model:
                    var probe = trial.ModelKind == "image"
                        ? await provider.ProbeModelAccessAsync(trial.Model!, ct)
                        : await provider.ProbeTextModelAsync(trial.Model!, trial.Effort, trial.ServiceTier, ct);
                    trial.Output = probe.Output;
                    trial.Parsed = true;
                    trial.LatencyMs = probe.LatencyMs;
                    trial.UsedModel = probe.Model;
                    trial.InputTokens = probe.Usage?.Input;
                    trial.CachedTokens = probe.Usage?.Cached;
                    trial.OutputTokens = probe.Usage?.Output;
                    break;
                default:
                    await PromptAsync(trial, ct);
                    break;
            }
            trial.Status = trial.Error is null ? AiTrialStatus.Succeeded : AiTrialStatus.Failed;
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            // Our own messages only ("OpenAI outfit returned 404 (model_not_found)"), never a provider body.
            trial.Status = AiTrialStatus.Failed;
            trial.Error = ex is AiProviderException or HttpRequestException or InvalidOperationException ? ex.Message : ex.GetType().Name;
            logger.LogWarning("AI trial {TrialId} ({Type}) failed: {Error}", trial.Id, trial.Type, trial.Error);
        }
        finally
        {
            trial.Output = Cut(trial.Output);
            trial.FinishedAt = time.GetUtcNow().UtcDateTime;
            await repository.SaveAsync(trial, CancellationToken.None);
            await usage.RecordAsync(new AiUsageRecord(AiUsageEntity.AdminTenant, $"trial#{trial.Id}", Domain.Enum.JobKind.AiTrial,
                trial.Status == AiTrialStatus.Succeeded ? AiUsageOutcome.Completed : AiUsageOutcome.Failed,
                timings.TakeUncountedCalls().Select(c => c.ToUsage()).ToList(), trial.FinishedAt.Value), CancellationToken.None);
            if (ownRun)
                AiTelemetry.End();
        }
    }

    private async Task PromptAsync(AiTrialEntity trial, CancellationToken ct)
    {
        var definition = PromptCatalog.Find(trial.Key ?? "") ?? throw new InvalidOperationException("Unknown prompt key.");
        var images = new List<ImageInput>();
        foreach (var url in trial.ImageUrls)
            images.Add(await DownloadAsync(url, ct));
        var language = PromptCatalog.SampleLanguage(trial.Input);
        var segment = PromptCatalog.SampleSegment(definition, trial.Input);

        using var run = PromptDryRun.Begin(new Dictionary<string, string>(StringComparer.Ordinal) { [definition.Key] = trial.Text! });
        try
        {
            switch (definition.Trial)
            {
                case PromptTrialTarget.StylistOutfit or PromptTrialTarget.StylistWeek or PromptTrialTarget.StylistPack:
                    var kind = PromptCatalog.StylistKind(definition.Trial)!.Value;
                    var content = await provider.GenerateAsync(new StylistPrompt(kind, trial.Input!, language, Segment: segment, Teen: definition.Key == PromptCatalog.StylistTeen), ct);
                    trial.Parsed = OpenAiProvider.StylistAnswerParses(kind, content);
                    if (trial.Parsed == false)
                        trial.ParseError = "The answer does not deserialize into the stylist DTO.";
                    break;
                case PromptTrialTarget.ItemDescribe:
                    await provider.DescribeAsync(images[0], language, ct);
                    trial.Parsed = true;
                    break;
                case PromptTrialTarget.ItemDetect:
                    await provider.DetectItemsAsync(images[0], language, false, segment, ct);
                    trial.Parsed = true;
                    break;
                case PromptTrialTarget.ItemMatch:
                    await provider.MatchAsync(images[0], images.Skip(1).ToList(), null, false, ct);
                    trial.Parsed = true;
                    break;
                case PromptTrialTarget.Palette:
                    await provider.AnalyzeAsync(images[0], ct);
                    trial.Parsed = true;
                    break;
                case PromptTrialTarget.PhotoCheckReference:
                    await provider.InspectReferenceAsync(images[0], ct);
                    trial.Parsed = true;
                    break;
                case PromptTrialTarget.PhotoCheckBody or PromptTrialTarget.PhotoCheckFace:
                    await provider.InspectAsync(images[0], definition.Trial == PromptTrialTarget.PhotoCheckBody ? Domain.Enum.PhotoKind.Body : Domain.Enum.PhotoKind.Face, ct);
                    trial.Parsed = true;
                    break;
                default:
                    throw new InvalidOperationException("This prompt has no dry-run.");
            }
        }
        catch (AiProviderException ex) when (run.RawOutput is not null)
        {
            // The call succeeded; its answer did not parse.
            trial.Parsed = false;
            trial.ParseError = ex.Message;
        }
        catch (AiProviderException ex) when (ex.Message.Contains("refused", StringComparison.Ordinal) || ex.Message.Contains("cut off", StringComparison.Ordinal))
        {
            trial.Parsed = false;
            trial.ParseError = ex.Message;
        }
        finally
        {
            trial.Output = run.RawOutput;
            trial.SystemPrompt = run.SystemPrompt;
            trial.UserPrompt = run.UserPrompt;
            trial.UsedModel = run.UsedModel;
            trial.LatencyMs = run.DurationMs is { } ms ? (long)ms : null;
            trial.InputTokens = run.Usage?.Input;
            trial.CachedTokens = run.Usage?.Cached;
            trial.OutputTokens = run.Usage?.Output;
        }
    }

    /// <summary>An https image (the Api accepts only URLs on the catalog image host), at most 10 MB, jpeg / png / webp.</summary>
    private static async Task<ImageInput> DownloadAsync(string url, CancellationToken ct)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
            throw new InvalidOperationException("Image URL must be https.");
        using var response = await Download.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"Image download returned {(int)response.StatusCode}.");
        if (response.Content.Headers.ContentLength is > MaxImageBytes)
            throw new InvalidOperationException("Image is larger than 10 MB.");
        var contentType = response.Content.Headers.ContentType?.MediaType ?? "";
        if (contentType is not ("image/jpeg" or "image/png" or "image/webp"))
            throw new InvalidOperationException("Image must be jpeg, png or webp.");
        var data = await response.Content.ReadAsByteArrayAsync(ct);
        if (data.Length > MaxImageBytes)
            throw new InvalidOperationException("Image is larger than 10 MB.");
        return new ImageInput(data, contentType);
    }

    private static string? Cut(string? text) =>
        text is { Length: > AiTrialEntity.MaxOutputLength } ? text[..AiTrialEntity.MaxOutputLength] + "…" : text;
}
