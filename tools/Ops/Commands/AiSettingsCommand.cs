using System.Text.Json;
using Amazon.SimpleSystemsManagement;
using Amazon.SimpleSystemsManagement.Model;
using Domain.Options;
using Microsoft.Extensions.Configuration;

namespace Ops.Commands;

/// <summary>
/// ai-settings [--apply ops-presets/dev-worker-ai.json]: shows the dev stage's owner-managed AI settings
/// (/droblet/dev/worker/Ai), and with --apply replaces them with a preset kept in the repo. Dev only: prod's AI
/// settings are the owner's. The preset must be one JSON object that binds to <see cref="AiOptions"/> with the
/// provider, both model ids and Enabled set; the ApiKey and Pricing child parameters are never touched.
/// </summary>
internal static class AiSettingsCommand
{
    public static string ParameterName(string stage) => $"/droblet/{stage}/worker/Ai";

    public static async Task<int> RunAsync(OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        using var ssm = new AmazonSimpleSystemsManagementClient();
        var name = ParameterName(args.Stage);
        var current = (await ssm.GetParameterAsync(new GetParameterRequest { Name = name }, ct)).Parameter.Value;
        output.Line($"{name} now: {current}");

        if (args.Option("apply") is not { } path)
        {
            output.Summary($"### ai-settings ({args.Stage})\n\n```json\n{current}\n```");
            return 0;
        }

        var preset = (await File.ReadAllTextAsync(path, ct)).Trim();
        if (Validate(preset) is { } error)
        {
            output.Error($"preset {path} refused: {error}");
            return 1;
        }

        await ssm.PutParameterAsync(new PutParameterRequest { Name = name, Value = preset, Type = ParameterType.String, Overwrite = true }, ct);
        output.Line($"{name} set from {path}: {preset}");
        output.Summary($"### ai-settings ({args.Stage}) applied `{path}`\n\nbefore\n```json\n{current}\n```\nafter\n```json\n{preset}\n```\n" +
                       "Workers pick it up on their next SSM reload (cold start or reload interval).");
        return 0;
    }

    /// <summary>Null when the preset is safe to write.</summary>
    public static string? Validate(string json)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(json);
        }
        catch (JsonException ex)
        {
            return $"not JSON ({ex.Message})";
        }
        using (document)
        {
            if (document.RootElement.ValueKind != JsonValueKind.Object)
                return "not a JSON object";
            foreach (var required in new[] { "Enabled", "Provider", "TextModel", "ImageModel" })
                if (!document.RootElement.TryGetProperty(required, out _))
                    return $"{required} is missing";
            if (document.RootElement.TryGetProperty("ApiKey", out _))
                return "ApiKey is a separate SecureString parameter, never part of a preset";
        }

        var options = new ConfigurationBuilder()
            .AddJsonStream(new MemoryStream(System.Text.Encoding.UTF8.GetBytes($"{{\"Ai\":{json}}}")))
            .Build().GetSection("Ai").Get<AiOptions>();
        return options is null ? "does not bind to AiOptions" : null;
    }
}
