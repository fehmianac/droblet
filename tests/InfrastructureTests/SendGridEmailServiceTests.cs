using System.Net;
using System.Text.Json;
using Domain.Options;
using Domain.Services;
using Infrastructure.Services.Providers;
using Microsoft.Extensions.Options;
using Xunit;

namespace InfrastructureTests;

public class SendGridEmailServiceTests
{
    private sealed class CapturingHandler(HttpStatusCode status, string body = "") : HttpMessageHandler
    {
        public HttpRequestMessage? Request { get; private set; }
        public string? Body { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Request = request;
            Body = await request.Content!.ReadAsStringAsync(ct);
            return new HttpResponseMessage(status) { Content = new StringContent(body) };
        }
    }

    private sealed class StaticOptions(EmailOptions value) : IOptionsMonitor<EmailOptions>
    {
        public EmailOptions CurrentValue => value;
        public EmailOptions Get(string? name) => value;
        public IDisposable? OnChange(Action<EmailOptions, string?> listener) => null;
    }

    private static EmailOptions Options(string? apiKey = "SG.test") => new()
    {
        Provider = "SendGrid",
        From = "Droblet <no-reply@droplet.alatech.co>",
        SendGrid = new EmailOptions.SendGridOptions { ApiKey = apiKey },
    };

    private static readonly EmailMessage Message = new("damla@example.com", "Şifreni sıfırla", "düz metin", "<p>html</p>");

    [Fact]
    public async Task Send_PostsMailSendWithBearerKey_AndTrackingOff()
    {
        var handler = new CapturingHandler(HttpStatusCode.Accepted);
        var service = new SendGridEmailService(new HttpClient(handler), new StaticOptions(Options()));

        await service.SendAsync(Message, CancellationToken.None);

        Assert.Equal(HttpMethod.Post, handler.Request!.Method);
        Assert.Equal("https://api.sendgrid.com/v3/mail/send", handler.Request.RequestUri!.ToString());
        Assert.Equal("Bearer", handler.Request.Headers.Authorization!.Scheme);
        Assert.Equal("SG.test", handler.Request.Headers.Authorization.Parameter);

        using var json = JsonDocument.Parse(handler.Body!);
        var root = json.RootElement;
        Assert.Equal("damla@example.com", root.GetProperty("personalizations")[0].GetProperty("to")[0].GetProperty("email").GetString());
        Assert.Equal("no-reply@droplet.alatech.co", root.GetProperty("from").GetProperty("email").GetString());
        Assert.Equal("Droblet", root.GetProperty("from").GetProperty("name").GetString());
        Assert.Equal("Şifreni sıfırla", root.GetProperty("subject").GetString());
        Assert.Equal("text/plain", root.GetProperty("content")[0].GetProperty("type").GetString());
        Assert.Equal("text/html", root.GetProperty("content")[1].GetProperty("type").GetString());
        // Tracking would rewrite the reset link and route the token through a redirect.
        Assert.False(root.GetProperty("tracking_settings").GetProperty("click_tracking").GetProperty("enable").GetBoolean());
        Assert.False(root.GetProperty("tracking_settings").GetProperty("open_tracking").GetProperty("enable").GetBoolean());
    }

    [Fact]
    public async Task Send_UsesConfiguredRegionalBaseUrl()
    {
        var handler = new CapturingHandler(HttpStatusCode.Accepted);
        var options = Options();
        options.SendGrid.BaseUrl = "https://api.eu.sendgrid.com";
        var service = new SendGridEmailService(new HttpClient(handler), new StaticOptions(options));

        await service.SendAsync(Message, CancellationToken.None);

        Assert.Equal("https://api.eu.sendgrid.com/v3/mail/send", handler.Request!.RequestUri!.ToString());
    }

    [Fact]
    public async Task Send_WithoutApiKey_Throws_AndCallsNothing()
    {
        var handler = new CapturingHandler(HttpStatusCode.Accepted);
        var service = new SendGridEmailService(new HttpClient(handler), new StaticOptions(Options(apiKey: null)));

        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SendAsync(Message, CancellationToken.None));
        Assert.Null(handler.Request);
    }

    [Fact]
    public async Task Send_NonSuccess_Throws()
    {
        var handler = new CapturingHandler(HttpStatusCode.Unauthorized, """{"errors":[{"message":"bad key"}]}""");
        var service = new SendGridEmailService(new HttpClient(handler), new StaticOptions(Options()));

        var ex = await Assert.ThrowsAsync<HttpRequestException>(() => service.SendAsync(Message, CancellationToken.None));
        Assert.Contains("401", ex.Message);
    }
}
