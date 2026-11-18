using System.Net;
using System.Net.Mail;
using System.Net.Mime;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Providers;

/// <summary>SMTP fallback (Email.Provider = Smtp) when SendGrid is unavailable.</summary>
public sealed class SmtpEmailService(IOptionsMonitor<EmailOptions> options) : IEmailService
{
    public async Task SendAsync(EmailMessage message, CancellationToken ct)
    {
        var email = options.CurrentValue;
        var smtp = email.Smtp;
        if (string.IsNullOrWhiteSpace(smtp.Host))
            throw new InvalidOperationException("Email.Smtp.Host is not configured.");

        using var mail = new MailMessage { From = new MailAddress(email.From), Subject = message.Subject, Body = message.TextBody };
        mail.To.Add(message.To);
        mail.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(message.HtmlBody, null, MediaTypeNames.Text.Html));

        using var client = new SmtpClient(smtp.Host, smtp.Port)
        {
            EnableSsl = true,
            Credentials = new NetworkCredential(smtp.Username, smtp.Password),
        };
        await client.SendMailAsync(mail, ct);
    }
}
