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

    public static EmailMessage EmailVerification(string to, string code, string link, string language, int validHours)
    {
        var tr = language.StartsWith("tr", StringComparison.OrdinalIgnoreCase);
        var subject = tr ? $"Droblet doğrulama kodun: {code}" : $"Your Droblet verification code: {code}";
        var intro = tr
            ? "E-posta adresini doğrulamak için bu kodu uygulamaya gir:"
            : "Enter this code in the app to verify your e-mail address:";
        var orLink = tr ? "Ya da bu bağlantıyı aç:" : "Or open this link:";
        var expiry = tr
            ? $"Kod ve bağlantı {validHours} saat geçerli."
            : $"The code and the link are valid for {validHours} hours.";
        var ignore = tr
            ? "Droblet hesabını sen açmadıysan bu e-postayı yok sayabilirsin."
            : "If you did not create a Droblet account, you can ignore this e-mail.";
        var button = tr ? "E-postamı doğrula" : "Verify my e-mail";

        var text = $"{intro}\n\n{code}\n\n{orLink}\n{link}\n\n{expiry}\n{ignore}\n";
        var safeLink = WebUtility.HtmlEncode(link);
        var html = $"""
            <!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;color:#1C1A17;background:#FBF9F5;padding:24px">
            <p>{WebUtility.HtmlEncode(intro)}</p>
            <p style="font-size:28px;letter-spacing:6px;font-weight:600;margin:16px 0">{WebUtility.HtmlEncode(code)}</p>
            <p>{WebUtility.HtmlEncode(orLink)} <a href="{safeLink}" style="color:#6E5640">{WebUtility.HtmlEncode(button)}</a></p>
            <p style="color:#665F56">{WebUtility.HtmlEncode(expiry)}<br>{WebUtility.HtmlEncode(ignore)}</p>
            </body></html>
            """;

        return new EmailMessage(to, subject, text, html);
    }

    public static EmailMessage DataExportReady(string to, string link, string language, DateTime expiresAt)
    {
        var tr = language.StartsWith("tr", StringComparison.OrdinalIgnoreCase);
        var date = expiresAt.ToString("d MMMM yyyy", System.Globalization.CultureInfo.GetCultureInfo(tr ? "tr-TR" : "en-GB"));
        var subject = tr ? "Droblet verilerin hazır" : "Your Droblet data is ready";
        var intro = tr
            ? "İstediğin veri kopyası hazır. Profilin, gardırobun, kombinlerin, rızaların ve fotoğrafların tek bir ZIP dosyasında."
            : "The copy of your data you asked for is ready: your profile, wardrobe, looks, consents and photos in one ZIP file.";
        var expiry = tr
            ? $"Bağlantı {date} tarihine kadar geçerli. Sonra dosya silinir; istersen yeni bir kopya isteyebilirsin."
            : $"The link works until {date}. The file is deleted after that; you can ask for a new copy.";
        var ignore = tr
            ? "Bu isteği sen yapmadıysan bize yaz ve şifreni değiştir."
            : "If you did not ask for this, write to us and change your password.";
        var button = tr ? "Verilerimi indir" : "Download my data";

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
