using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Amazon.SimpleSystemsManagement;
using Amazon.SimpleSystemsManagement.Model;

namespace Ops.Commands;

/// <summary>
/// google-auth [--add-client-id ID]: shows /droblet/{stage}/api/GoogleAuth and adds an OAuth client id (iOS, Android or
/// web) to ClientIds — the ids accepted as a Google idToken's "aud". Other fields are kept. The id is public, not a secret.
/// </summary>
internal static partial class GoogleAuthCommand
{
    [GeneratedRegex(@"^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$")]
    public static partial Regex ClientIdPattern();

    public static async Task<int> RunAsync(OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        using var ssm = new AmazonSimpleSystemsManagementClient();
        var name = $"/droblet/{args.Stage}/api/GoogleAuth";
        var current = (await ssm.GetParameterAsync(new GetParameterRequest { Name = name }, ct)).Parameter.Value;
        output.Line($"{name} now: {current}");
        if (args.Option("add-client-id") is not { } id)
            return 0;

        var updated = AddClientId(current, id);
        if (updated == current)
        {
            output.Line("already listed");
            return 0;
        }
        await ssm.PutParameterAsync(new PutParameterRequest { Name = name, Value = updated, Type = ParameterType.String, Overwrite = true }, ct);
        output.Line($"{name} set: {updated}");
        output.Summary($"`{name}`\n\nbefore `{current}`\n\nafter `{updated}`");
        return 0;
    }

    public static string AddClientId(string json, string clientId)
    {
        // A value typed by hand in the console can hold a raw line break inside a string (invalid JSON): drop control
        // characters first, and trim every id, so the parameter is repaired as well as extended.
        var cleaned = Regex.Replace(json, @"[\r\n\t]", "");
        var root = JsonNode.Parse(cleaned)?.AsObject() ?? new JsonObject();
        var ids = (root["ClientIds"] as JsonArray ?? []).Select(n => n?.GetValue<string>()?.Trim()).Where(s => !string.IsNullOrEmpty(s)).ToList();
        if (!ids.Contains(clientId))
            ids.Add(clientId);
        root["ClientIds"] = new JsonArray(ids.Select(s => (JsonNode?)JsonValue.Create(s)).ToArray());
        var result = root.ToJsonString();
        return result == json ? json : result;
    }
}
