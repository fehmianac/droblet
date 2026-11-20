using Domain.Entity;
using Domain.Services;
using Infrastructure.Telemetry;

namespace Tests.Shared;

/// <summary>
/// AI usage counters in worker tests: a worker run (AiTelemetry) with one simulated provider call — what OpenAiProvider
/// records for a real call — and the counter rows that the job's completion wrote.
/// </summary>
public static class AiUsageProbe
{
    /// <summary>Starts a run and records one priced call into it, as the provider does. Dispose ends the run.</summary>
    public static IDisposable Run(string operation, string model = "gpt-6-astra", decimal costUsd = 0.03m, long input = 1200, long output = 400, long cached = 100)
    {
        var timings = AiTelemetry.Begin();
        timings.AddCall(new AiCallRecord(operation, model, 900, 200, input, output, cached, 0, CostUsd: costUsd));
        return new End();
    }

    private sealed class End : IDisposable
    {
        public void Dispose() => AiTelemetry.End();
    }

    public static async Task<IReadOnlyDictionary<string, long>> DayAsync(InMemoryRepository repository, string tenantId, DateTime at) =>
        (await repository.GetAsync<AiUsageEntity>(AiUsageEntity.GetPk(tenantId), AiUsageEntity.DaySk(DateOnly.FromDateTime(at))))?.Counters
        ?? new Dictionary<string, long>();

    public static async Task<IReadOnlyDictionary<string, long>> AllDayAsync(InMemoryRepository repository, DateTime at) =>
        (await repository.GetAsync<AiUsageEntity>(AiUsageEntity.AllPk, AiUsageEntity.DaySk(DateOnly.FromDateTime(at))))?.Counters
        ?? new Dictionary<string, long>();

    public static long Op(IReadOnlyDictionary<string, long> counters, string operation, string metric) =>
        counters.GetValueOrDefault(AiUsageCounters.Op(operation, metric));
}
