using System.Text.Json.Serialization;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Services;
using Domain.Validation;
using Microsoft.Extensions.DependencyInjection;

namespace Ops.Commands;

/// <summary>One day of an edit file: the editor post whose first image is the look, and the look's own texts.</summary>
internal sealed record WeeklyEditDay(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("titleTr")] string TitleTr,
    [property: JsonPropertyName("titleEn")] string TitleEn,
    [property: JsonPropertyName("noteTr")] string NoteTr,
    [property: JsonPropertyName("noteEn")] string NoteEn);

/// <summary>
/// seed-weekly-edit --segment women|men --file ops-presets/….json: this week's edit of a segment from seven existing
/// editor posts, Monday to Sunday in the order of the file. Each look takes the post's first image and the file's title
/// and style note (both languages); it has no product (a photo look: nothing to buy or try on). Edit
/// "edit-{segment}-{monday}", published; the first image is the cover. Idempotent (the same week is written again).
/// Dev only; no AI call.
/// </summary>
internal static class SeedWeeklyEditCommand
{
    public const int MaxTitleLength = 120;
    public const int MaxNoteLength = 600;
    private static readonly Dictionary<string, string> EditTitle = new() { ["tr"] = "Haftanın Editi", ["en"] = "This Week's Edit" };

    /// <summary>The Monday of the week <paramref name="today"/> is in.</summary>
    public static DateOnly WeekStartOf(DateOnly today) => today.AddDays(-(((int)today.DayOfWeek + 6) % 7));

    public static string EditId(Segment segment, DateOnly weekStart) => $"edit-{segment.ToString().ToLowerInvariant()}-{WeeklyEditRules.Format(weekStart)}";

    /// <summary>The seven days of a file; null when it is not seven valid entries (post ids unique, every text given and within its limit).</summary>
    public static IReadOnlyList<WeeklyEditDay>? Parse(string json)
    {
        List<WeeklyEditDay>? days;
        try
        {
            days = System.Text.Json.JsonSerializer.Deserialize<List<WeeklyEditDay>>(json);
        }
        catch (System.Text.Json.JsonException)
        {
            return null;
        }
        if (days is not { Count: WeeklyEditRules.LooksPerEdit } || days.Select(d => d?.Id).Distinct(StringComparer.Ordinal).Count() != days.Count)
            return null;
        static bool Text(string? value, int max) => value?.Trim() is { Length: > 0 } text && text.Length <= max;
        return days.All(d => d is not null && FeedInputRules.IsId(d.Id) && Text(d.TitleTr, MaxTitleLength) && Text(d.TitleEn, MaxTitleLength)
                             && Text(d.NoteTr, MaxNoteLength) && Text(d.NoteEn, MaxNoteLength))
            ? days
            : null;
    }

    /// <summary>The edit of the days, or the reason it cannot be made.</summary>
    public static (WeeklyEditInput? Edit, string? Problem) EditOf(Segment segment, DateOnly weekStart, IReadOnlyList<WeeklyEditDay> days, IReadOnlyList<FeedPostEntity?> posts)
    {
        var looks = new List<EditLookInput>();
        for (var i = 0; i < days.Count; i++)
        {
            var (day, post) = (days[i], posts[i]);
            if (post is null || post.Retired || !post.Published)
                return (null, $"{day.Id}: post not found, retired or not published");
            if (post.Segment is { } other && other != segment)
                return (null, $"{day.Id}: the post is for {other}, not {segment}");
            var image = post.ImageUrls.FirstOrDefault()?.Trim();
            if (string.IsNullOrEmpty(image))
                return (null, $"{day.Id}: the post has no image");
            looks.Add(new EditLookInput(null, i + 1,
                new Dictionary<string, string> { ["tr"] = day.TitleTr.Trim(), ["en"] = day.TitleEn.Trim() },
                new Dictionary<string, string> { ["tr"] = day.NoteTr.Trim(), ["en"] = day.NoteEn.Trim() }, image, []));
        }
        return (new WeeklyEditInput(EditId(segment, weekStart), segment, WeeklyEditRules.Format(weekStart), EditTitle, null, looks[0].ImageUrl, looks, null, null, Published: true, Retired: false), null);
    }

    public static async Task<int> RunAsync(IServiceProvider services, OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        var file = args.Option("file")!;
        if (!File.Exists(file) || Parse(await File.ReadAllTextAsync(file, ct)) is not { } days)
        {
            output.Error($"{file}: missing, or not a list of exactly {WeeklyEditRules.LooksPerEdit} {{ id, titleTr, titleEn, noteTr, noteEn }} with unique post ids, titles of 1–{MaxTitleLength} and notes of 1–{MaxNoteLength} characters.");
            return 2;
        }
        return await SeedAsync(services.GetRequiredService<IRepository>(), services.GetRequiredService<IContentService>(), args.FeedSegment!.Value, days, args.DryRun,
            DateOnly.FromDateTime(DateTime.UtcNow), output, ct);
    }

    public static async Task<int> SeedAsync(IRepository repository, IContentService content, Segment segment, IReadOnlyList<WeeklyEditDay> days, bool dryRun, DateOnly today, OpsOutput output, CancellationToken ct)
    {
        var posts = new List<FeedPostEntity?>();
        foreach (var day in days)
            posts.Add(await repository.GetAsync<FeedPostEntity>(FeedPostEntity.GetPk(), FeedPostEntity.GetSk(day.Id), ct));

        var (edit, problem) = EditOf(segment, WeekStartOf(today), days, posts);
        if (edit is null)
        {
            output.Summary($"### seed-weekly-edit\n\nNothing written: {problem}.\n");
            return 1;
        }
        var outcome = dryRun ? "would be written" : (await content.UpsertEditAsync(edit, ct)).Outcome.ToString();
        output.Table(["day", "post id", "title (tr)"], days.Select((d, i) => (IReadOnlyList<string>)[(i + 1).ToString(), d.Id, d.TitleTr.Trim()]).ToList());
        output.Summary($"### seed-weekly-edit{(dryRun ? " (dry run)" : "")}\n\nEdit **{edit.Id}** ({segment}, week of {edit.WeekStart}), 7 photo looks: {outcome}. No AI call.\n");
        return dryRun || outcome is nameof(CatalogWriteOutcome.Created) or nameof(CatalogWriteOutcome.Updated) ? 0 : 1;
    }
}
