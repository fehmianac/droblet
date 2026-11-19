namespace Infrastructure.Ai;

/// <summary>
/// The background flow a provider call runs in (AsyncLocal), so per-flow settings (Ai:ServiceTiers:{flow}) apply to
/// calls that share their operation with an interactive flow — e.g. item_detection of an outfit import (background,
/// may wait) vs. of a single item photo (the user is waiting). Outside a scope: null.
/// </summary>
public static class AiCallContext
{
    public const string OutfitImport = "outfit_import";

    private static readonly AsyncLocal<string?> Flow = new();

    public static string? Current => Flow.Value;

    public static IDisposable Use(string flow)
    {
        var previous = Flow.Value;
        Flow.Value = flow;
        return new Scope(previous);
    }

    private sealed class Scope(string? previous) : IDisposable
    {
        public void Dispose() => Flow.Value = previous;
    }
}
