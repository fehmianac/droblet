using System.Net;
using Domain.Entity;
using Domain.Services;

namespace Infrastructure.Services.Admin;

/// <summary>Admin panel e-mails in TR and EN (the panel's Accept-Language). Plain, no tracking, no exclamation marks.</summary>
public static class AdminEmailTemplates
{
    private static bool Turkish(string language) => language.StartsWith("tr", StringComparison.OrdinalIgnoreCase);

    public static EmailMessage SignInCode(string to, string code, string language, int validMinutes)
    {
        var tr = Turkish(language);
        var subject = tr ? $"Droblet yönetim paneli giriş kodu: {code}" : $"Droblet admin sign-in code: {code}";
        var intro = tr ? "Yönetim paneline giriş kodun:" : "Your admin panel sign-in code:";
        var expiry = tr
            ? $"Kod {validMinutes} dakika geçerli ve yalnız bir kez kullanılabilir."
            : $"The code is valid for {validMinutes} minutes and can be used once.";
        var ignore = tr
            ? "Bu girişi sen yapmadıysan şifreni hemen değiştir."
            : "If this was not you, change your password now.";
        var text = $"{intro}\n\n{code}\n\n{expiry}\n{ignore}\n";
        var html = Html($"""
            <p>{WebUtility.HtmlEncode(intro)}</p>
            <p style="font-size:28px;letter-spacing:6px;font-weight:600">{WebUtility.HtmlEncode(code)}</p>
            <p style="color:#665F56">{WebUtility.HtmlEncode(expiry)}<br>{WebUtility.HtmlEncode(ignore)}</p>
            """);
        return new EmailMessage(to, subject, text, html);
    }

    public static EmailMessage PasswordLink(string to, string link, AdminPasswordTokenPurpose purpose, string language, TimeSpan validFor)
    {
        var tr = Turkish(language);
        var invite = purpose == AdminPasswordTokenPurpose.Invite;
        var subject = invite
            ? tr ? "Droblet yönetim paneline davet" : "Invitation to the Droblet admin panel"
            : tr ? "Droblet yönetim paneli şifre belirleme" : "Set your Droblet admin password";
        var intro = invite
            ? tr ? "Droblet yönetim paneline eklendin. Şifreni belirlemek için aşağıdaki bağlantıyı kullan." : "You were added to the Droblet admin panel. Use the link below to set your password."
            : tr ? "Yönetim paneli şifreni belirlemek için aşağıdaki bağlantıyı kullan." : "Use the link below to set your admin panel password.";
        var duration = validFor.TotalHours >= 1
            ? tr ? $"{(int)validFor.TotalHours} saat" : $"{(int)validFor.TotalHours} hours"
            : tr ? $"{(int)validFor.TotalMinutes} dakika" : $"{(int)validFor.TotalMinutes} minutes";
        var expiry = tr ? $"Bağlantı {duration} geçerli ve yalnız bir kez kullanılabilir." : $"The link is valid for {duration} and can be used once.";
        var ignore = tr ? "Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin." : "If you did not ask for this, you can ignore this e-mail.";
        var button = tr ? "Şifreyi belirle" : "Set password";

        var text = $"{intro}\n\n{link}\n\n{expiry}\n{ignore}\n";
        var html = Html($"""
            <p>{WebUtility.HtmlEncode(intro)}</p>
            <p><a href="{WebUtility.HtmlEncode(link)}" style="color:#6E5640">{WebUtility.HtmlEncode(button)}</a></p>
            <p style="color:#665F56">{WebUtility.HtmlEncode(expiry)}<br>{WebUtility.HtmlEncode(ignore)}</p>
            """);
        return new EmailMessage(to, subject, text, html);
    }

    private static string Html(string body) =>
        $"""<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;color:#1C1A17;background:#FBF9F5;padding:24px">{body}</body></html>""";
}
