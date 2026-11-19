using System.Text.Json;
using System.Text.Json.Nodes;
using Domain.Enum;

namespace Domain.Services.Styling;

/// <summary>
/// Compact stylist prompt (Stylist:CompactPrompt). A wardrobe id is a 26-character ULID — about 14 tokens, sent once per
/// candidate and written back by the model once per slot (output tokens cost 5× input). Compact mode gives every
/// candidate a short alias (i1, i2 …) and one descriptor string "i1|top|white,navy|cotton|spring,autumn" instead of a
/// JSON object; the answer's ids are mapped back before the guard sees them, so the guard, results and accept endpoints
/// never see an alias. Off = the original JSON objects and real ids (identity mapping).
/// </summary>
public sealed class CandidateAliases
{
    /// <summary>Answer fields that hold candidate ids (ModelSlots, ModelPackOutput.ItemIds).</summary>
    private static readonly HashSet<string> SlotFields = new(StringComparer.Ordinal) { "top", "bottom", "outerwear", "shoes", "bagAccessory" };
    private const string IdListField = "itemIds";

    private readonly Dictionary<string, string> _toAlias;
    private readonly Dictionary<string, string> _toId;

    private CandidateAliases(bool compact, Dictionary<string, string> toAlias)
    {
        Compact = compact;
        _toAlias = toAlias;
        _toId = toAlias.ToDictionary(kv => kv.Value, kv => kv.Key, StringComparer.Ordinal);
    }

    public bool Compact { get; }

    public static CandidateAliases For(IEnumerable<CandidateItem> candidates, bool compact)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        if (compact)
            foreach (var item in candidates)
                map.TryAdd(item.Id, $"i{map.Count + 1}");
        return new CandidateAliases(compact, map);
    }

    public string Alias(string id) => _toAlias.GetValueOrDefault(id, id);

    public string? AliasOrNull(string? id) => id is null ? null : Alias(id);

    /// <summary>Disliked combinations in alias form; in compact mode a combination with a piece that is no candidate is dropped (it cannot recur).</summary>
    public IReadOnlyList<IReadOnlyList<string>> Combinations(IEnumerable<IReadOnlyList<string>> combinations) =>
        Compact
            ? combinations.Where(c => c.All(_toAlias.ContainsKey)).Select(c => (IReadOnlyList<string>)c.Select(Alias).ToList()).ToList()
            : combinations.ToList();

    /// <summary>What the model sees of one candidate.</summary>
    public object Describe(CandidateItem item) =>
        Compact
            ? string.Join('|', Alias(item.Id), Name(item.Category), item.ColorIds.Count == 0 ? "-" : string.Join(',', item.ColorIds),
                string.IsNullOrWhiteSpace(item.Fabric) ? "-" : item.Fabric, item.Seasons.Count == 0 ? "-" : string.Join(',', item.Seasons.Select(Name)))
            : new { item.Id, item.Category, item.ColorIds, item.Fabric, item.Seasons };

    /// <summary>The model's answer with every alias in an id field replaced by the real id (unknown values are kept: the guard rejects them).</summary>
    public string Restore(string answer)
    {
        if (!Compact || string.IsNullOrWhiteSpace(answer))
            return answer;
        JsonNode? root;
        try
        {
            root = JsonNode.Parse(answer);
        }
        catch (JsonException)
        {
            return answer;
        }
        if (root is null)
            return answer;
        Walk(root);
        return root.ToJsonString();
    }

    private void Walk(JsonNode node)
    {
        switch (node)
        {
            case JsonObject obj:
                foreach (var (name, value) in obj.ToList())
                {
                    if (value is JsonValue v && SlotFields.Contains(name) && v.GetValueKind() == JsonValueKind.String && _toId.TryGetValue(v.GetValue<string>(), out var id))
                        obj[name] = id;
                    else if (value is JsonArray list && name == IdListField)
                    {
                        for (var i = 0; i < list.Count; i++)
                            if (list[i] is JsonValue e && e.GetValueKind() == JsonValueKind.String && _toId.TryGetValue(e.GetValue<string>(), out var listId))
                                list[i] = listId;
                    }
                    else if (value is not null)
                        Walk(value);
                }
                break;
            case JsonArray array:
                foreach (var child in array)
                    if (child is not null)
                        Walk(child);
                break;
        }
    }

    private static string Name<T>(T value) where T : struct, System.Enum => JsonNamingPolicy.CamelCase.ConvertName(value.ToString());
}
