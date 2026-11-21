namespace Domain.Options;

/// <summary>
/// Which user segments are open (SSM api/Segments and worker/Segments — the same value on both). Values are segment names
/// ("women", "men"), case-insensitive; unknown names are ignored. Teen is never open whatever the list says (a separate
/// legal decision). The code default is women only (phase 1); dev opens men, prod waits for the owner.
/// </summary>
public sealed class SegmentOptions
{
    public const string Section = "Segments";
    public List<string> Available { get; set; } = ["women"];
}
