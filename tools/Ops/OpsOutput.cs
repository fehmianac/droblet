using System.Text;

namespace Ops;

/// <summary>
/// Everything the tool reports: console lines (also kept in ops-output/output.log) and the Markdown that the workflow
/// appends to the job summary (ops-output/summary.md). Callers never pass secrets; <see cref="Redact"/> is a last net.
/// </summary>
internal sealed class OpsOutput(string directory)
{
    private readonly StringBuilder _log = new();
    private readonly StringBuilder _summary = new();

    public string Directory { get; } = directory;

    public void Line(string text)
    {
        var safe = Redact(text);
        Console.WriteLine(safe);
        _log.AppendLine(safe);
    }

    public void Error(string text)
    {
        var safe = Redact(text);
        Console.Error.WriteLine(safe);
        _log.AppendLine("ERROR " + safe);
    }

    public void Summary(string markdown) => _summary.AppendLine(Redact(markdown));

    public void Table(IReadOnlyList<string> header, IEnumerable<IReadOnlyList<string>> rows)
    {
        Summary(MarkdownTable(header, rows));
        Line(MarkdownTable(header, rows));
    }

    public static string MarkdownTable(IReadOnlyList<string> header, IEnumerable<IReadOnlyList<string>> rows)
    {
        static string Cell(string? value) => (value ?? "").Replace("|", "\\|", StringComparison.Ordinal).Replace("\n", " ", StringComparison.Ordinal);
        var sb = new StringBuilder();
        sb.AppendLine("| " + string.Join(" | ", header.Select(Cell)) + " |");
        sb.AppendLine("|" + string.Concat(header.Select(_ => "---|")));
        foreach (var row in rows)
            sb.AppendLine("| " + string.Join(" | ", row.Select(Cell)) + " |");
        return sb.ToString();
    }

    public string SaveFile(string relativePath, byte[] data)
    {
        var path = Path.Combine(Directory, relativePath);
        System.IO.Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, data);
        return path;
    }

    public void Flush()
    {
        System.IO.Directory.CreateDirectory(Directory);
        File.WriteAllText(Path.Combine(Directory, "output.log"), _log.ToString());
        File.WriteAllText(Path.Combine(Directory, "summary.md"), _summary.ToString());
    }

    /// <summary>Bearer tokens and OpenAI-style keys never reach the output, whatever an error message contains.</summary>
    public static string Redact(string text) =>
        System.Text.RegularExpressions.Regex.Replace(
            System.Text.RegularExpressions.Regex.Replace(text, @"sk-[A-Za-z0-9_\-]{8,}", "sk-***"),
            @"(?i)(bearer\s+)[A-Za-z0-9._\-]{10,}", "$1***");
}
