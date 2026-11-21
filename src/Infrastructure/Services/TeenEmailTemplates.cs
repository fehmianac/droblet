using System.Net;
using Domain.Services;

namespace Infrastructure.Services;

/// <summary>
/// Parental consent e-mails (docs/api/teen.md §5), TR / EN. DRAFT wording — [HUKUK ONAYI] pending (docs/legal/teen/);
/// only sent where Teen:Enabled lets teens sign up (dev). The page behind the link holds the full notice.
/// </summary>
public static class TeenEmailTemplates
{
    private static bool Tr(string language) => language.StartsWith("tr", StringComparison.OrdinalIgnoreCase);

    private static string Html(IEnumerable<string> paragraphs, string link, string button, string footer) =>
        $"""
        <!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;color:#1C1A17;background:#FBF9F5;padding:24px">
        {string.Concat(paragraphs.Select(p => $"<p>{WebUtility.HtmlEncode(p)}</p>"))}
        <p><a href="{WebUtility.HtmlEncode(link)}" style="color:#6E5640">{WebUtility.HtmlEncode(button)}</a></p>
        <p style="color:#665F56">{WebUtility.HtmlEncode(footer)}</p>
        </body></html>
        """;

    /// <summary>The approval request: who asked, what Droblet is, the link (valid <paramref name="validDays"/> days).</summary>
    public static EmailMessage ConsentRequest(string to, string? teenName, string link, string language, int validDays)
    {
        var tr = Tr(language);
        var who = string.IsNullOrWhiteSpace(teenName) ? (tr ? "Çocuğunuz" : "Your child") : teenName.Trim();
        var subject = tr ? "Droblet: veli onayınız isteniyor" : "Droblet: your approval as a parent is requested";
        string[] paragraphs = tr
            ?
            [
                $"{who}, Droblet uygulamasını kullanmak için sizin onayınızı istedi. Droblet, kişisel gardırobu düzenleyen ve kombin öneren bir stil uygulamasıdır.",
                "16–17 yaşındaki kullanıcılar için sosyal özellikler, mağaza bağlantıları, satın almalar, pazarlama bildirimleri ve analitik kapalıdır. Fotoğraf ve yapay zekâ özellikleri ancak siz onaylarsanız açılır.",
                "Bağlantıda neyin işlendiğini ve çocuğunuzun neleri yapıp yapamayacağını okuyabilir, onaylayabilir ya da reddedebilirsiniz.",
            ]
            :
            [
                $"{who} asked for your approval to use the Droblet app. Droblet is a style app that organises a personal wardrobe and suggests outfits.",
                "For users aged 16–17, social features, store links, purchases, marketing notifications and analytics are off. Photo and AI features open only if you approve.",
                "The link explains what is processed and what your child can and cannot do; you can approve or decline there.",
            ];
        var button = tr ? "Bilgileri oku ve karar ver" : "Read the details and decide";
        var footer = tr
            ? $"Bağlantı {validDays} gün geçerli. Bu isteği beklemiyorsanız e-postayı yok sayabilirsiniz; onay vermezseniz hesap kısıtlı kalır."
            : $"The link is valid for {validDays} days. If you did not expect this, you can ignore the e-mail; without your approval the account stays limited.";
        var text = $"{string.Join("\n\n", paragraphs)}\n\n{link}\n\n{footer}\n";
        return new EmailMessage(to, subject, text, Html(paragraphs, link, button, footer));
    }

    /// <summary>After an approval: what was approved and the withdrawal link (valid until the teen turns 18).</summary>
    public static EmailMessage ConsentConfirmation(string to, string? teenName, string manageLink, string language, bool tryOnAllowed)
    {
        var tr = Tr(language);
        var who = string.IsNullOrWhiteSpace(teenName) ? (tr ? "Çocuğunuz" : "Your child") : teenName.Trim();
        var subject = tr ? "Droblet: onayınız kaydedildi" : "Droblet: your approval is recorded";
        string[] paragraphs = tr
            ?
            [
                $"{who} için verdiğiniz veli onayı kaydedildi.",
                tryOnAllowed ? "Sanal deneme (try-on) için de onay verdiniz." : "Sanal deneme (try-on) için onay vermediniz; bu özellik kapalı kalır.",
                "Onayınızı istediğiniz zaman aşağıdaki bağlantıdan geri alabilirsiniz. Geri aldığınızda fotoğraf özellikleri kapanır ve çocuğunuzun kişisel fotoğrafları silinir.",
            ]
            :
            [
                $"Your parental approval for {who} has been recorded.",
                tryOnAllowed ? "You also approved virtual try-on." : "You did not approve virtual try-on; it stays off.",
                "You can withdraw your approval at any time with the link below. Withdrawing turns photo features off and deletes your child's personal photos.",
            ];
        var button = tr ? "Onayı yönet veya geri al" : "Manage or withdraw approval";
        var footer = tr ? "Bu e-postayı saklayın: bağlantı çocuğunuz 18 yaşına girene kadar geçerli." : "Keep this e-mail: the link works until your child turns 18.";
        var text = $"{string.Join("\n\n", paragraphs)}\n\n{manageLink}\n\n{footer}\n";
        return new EmailMessage(to, subject, text, Html(paragraphs, manageLink, button, footer));
    }
}
