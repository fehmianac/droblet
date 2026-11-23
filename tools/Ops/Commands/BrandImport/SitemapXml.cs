using System.Xml;

namespace Ops.Commands.BrandImport;

/// <summary>One &lt;url&gt; of a sitemap: its location and the image locations listed with it (sitemap-image extension).</summary>
internal sealed record SitemapUrl(string Loc, IReadOnlyList<string> Images);

/// <summary>Sitemap XML → its URLs, for any source that discovers through a sitemap. Pure; throws <see cref="XmlException"/> for a body that is not XML.</summary>
internal static class SitemapXml
{
    public static IReadOnlyList<SitemapUrl> Parse(string xml)
    {
        using var reader = new StringReader(xml);
        return Parse(reader);
    }

    /// <summary>A sitemap index (&lt;sitemapindex&gt;&lt;sitemap&gt;&lt;loc&gt;…) → the sitemaps it names, in its order.</summary>
    public static IReadOnlyList<string> ParseIndex(string xml)
    {
        using var reader = new StringReader(xml);
        return Parse(reader, "sitemap").Select(u => u.Loc).ToList();
    }

    public static IReadOnlyList<SitemapUrl> Parse(TextReader xml) => Parse(xml, "url");

    private static IReadOnlyList<SitemapUrl> Parse(TextReader xml, string entry)
    {
        var urls = new List<SitemapUrl>();
        using var reader = XmlReader.Create(xml, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, IgnoreComments = true, IgnoreWhitespace = true });
        string? loc = null;
        var images = new List<string>();
        while (!reader.EOF)
        {
            if (reader.NodeType == XmlNodeType.Element && reader.LocalName == entry)
            {
                loc = null;
                images = [];
            }
            else if (reader.NodeType == XmlNodeType.Element && reader.LocalName == "loc")
            {
                var isImage = reader.NamespaceURI.Contains("sitemap-image", StringComparison.Ordinal);
                var text = reader.ReadElementContentAsString().Trim();   // moves past </loc>
                if (isImage)
                    images.Add(text);
                else
                    loc = text;
                continue;
            }
            else if (reader.NodeType == XmlNodeType.EndElement && reader.LocalName == entry)
            {
                if (!string.IsNullOrEmpty(loc))
                    urls.Add(new SitemapUrl(loc, images));
                loc = null;
            }
            reader.Read();
        }
        return urls;
    }
}
