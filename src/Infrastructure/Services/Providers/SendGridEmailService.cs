using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.Mail;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Providers;

/// <summary>
/// SendGrid v3 Mail Send over plain HTTPS (no SDK — third-party SDKs are not added to the stack).
/// The API key lives in SSM SecureString /droblet/{stage}/api/Email → {"SendGrid":{"ApiKey":"…"}}.
/// Click and open tracking are switched off per message: tracking rewrites links, which breaks the
/// password-reset universal link and would send the reset token through a tracking redirect.
/// </summary>
public sealed class SendGridEmailService(HttpClient http, IOptionsMonitor<EmailOptions> options) : IEmailService
{
    public async Task SendAsync(EmailMessage message, CancellationToken ct)
    {
        var email = options.CurrentValue;
        var sendGrid = email.SendGrid;
        if (string.IsNullOrWhiteSpace(sendGrid.ApiKey))
            throw new InvalidOperationException("Email.SendGrid.ApiKey is not configured (SSM /droblet/{stage}/api/Email).");

        var from = new MailAddress(email.From);
        var payload = new
        {
            personalizations = new[] { new { to = new[] { new { email = message.To } } } },
            from = new { email = from.Address, name = string.IsNullOrEmpty(from.DisplayName) ? null : from.DisplayName },
            subject = message.Subject,
            // SendGrid requires text/plain before text/html.
            content = new[]
            {
                new { type = "text/plain", value = message.TextBody },
                new { type = "text/html", value = message.HtmlBody },
            },
            tracking_settings = new
            {
                click_tracking = new { enable = false, enable_text = false },
                open_tracking = new { enable = false },
            },
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(sendGrid.BaseUrl), "/v3/mail/send"))
        {
            Content = JsonContent.Create(payload),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", sendGrid.ApiKey);

        using var response = await http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            // The body names the rejected field; it never echoes the API key. Recipient is not logged here.
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new HttpRequestException($"SendGrid rejected the message: {(int)response.StatusCode} {body}");
        }
    }
}
