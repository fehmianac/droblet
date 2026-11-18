using System.Net;
using Domain.Services;

namespace Infrastructure.Services;

/// <summary>Account e-mails in TR and EN (Accept-Language). Calm, editorial tone; no exclamation marks.</summary>
public static class EmailTemplates
{
    public static EmailMessage PasswordReset(string to, string link, string language, int validMinutes)
    {
        var tr = language.StartsWith("tr", StringComparison.OrdinalIgnoreCase);
        var subject = tr ? "Droblet şifre sıfırlama" : "Reset your Droblet password";
        var intro = tr
            ? "Şifreni sıfırlamak için aşağıdaki bağlantıyı kullan."
            : "Use the link below to reset your password.";
        var expiry = tr
            ? $"Bağlantı {validMinutes} dakika geçerli ve yalnız bir kez kullanılabilir."
            : $"The link is valid for {validMinutes} minutes and can be used once.";
        var ignore = tr
            ? "Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin."
            : "If you did not ask for this, you can ignore this e-mail.";
        var button = tr ? "Şifreyi sıfırla" : "Reset password";

        var text = $"{intro}\n\n{link}\n\n{expiry}\n{ignore}\n";
        var safeLink = WebUtility.HtmlEncode(link);
        var html = $"""
            <!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;color:#1C1A17;background:#FBF9F5;padding:24px">
            <p>{WebUtility.HtmlEncode(intro)}</p>
            <p><a href="{safeLink}" style="color:#6E5640">{WebUtility.HtmlEncode(button)}</a></p>
            <p style="color:#665F56">{WebUtility.HtmlEncode(expiry)}<br>{WebUtility.HtmlEncode(ignore)}</p>
            </body></html>
            """;

        return new EmailMessage(to, subject, text, html);
    }
}
