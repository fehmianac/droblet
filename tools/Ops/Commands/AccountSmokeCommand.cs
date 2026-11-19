using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using Amazon.S3;
using Domain.Entity;
using Domain.Extensions;
using Domain.Manager;
using Microsoft.Extensions.DependencyInjection;

namespace Ops.Commands;

/// <summary>
/// account-smoke (dev only): e-mail verification and "Verilerimi indir" end to end through the public API, as a
/// throw-away user (account-smoke+{ts}@example.com, never a real inbox):
///   register → profile emailVerified false + the verification row exists (hashes only, 24 h) → a wrong code is
///   refused → resend 202 then 429 (one per minute) → a link token the tool plants on the verification row
///   (test-only write, the real token is only in the e-mail) verifies signed out → profile emailVerified true and the
///   address is listed for contact matching → export: POST 202, second POST 409, poll until ready, download the ZIP
///   through the presigned URL and list it, inbox row data_export_ready, wrong download token 404, POST again 429 →
///   DELETE v1/auth/me and the ZIP is gone. What cannot be checked here: that SendGrid delivered the two e-mails.
/// </summary>
internal sealed class AccountSmokeCommand(IServiceProvider services, OpsArguments args, OpsOutput output)
{
    private static readonly TimeSpan ExportTimeout = TimeSpan.FromMinutes(8);

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(60) };
    private readonly List<string[]> _rows = [];
    private string? _token;
    private bool _failed;

    private void Check(string step, bool ok, TimeSpan elapsed, string detail)
    {
        _rows.Add([step, ok ? "ok" : "FAILED", $"{elapsed.TotalSeconds:0.0}s", detail]);
        if (!ok) _failed = true;
        output.Line($"{(ok ? "ok  " : "FAIL")} {step}: {detail}");
    }

    public async Task<int> RunAsync(CancellationToken ct)
    {
        var api = (args.Option("api-url") ?? AiSmokeCommand.DevApiUrl).TrimEnd('/') + "/";
        _http.BaseAddress = new Uri(api);
        var repository = services.GetRequiredService<IRepository>();
        var s3 = services.GetRequiredService<IAmazonS3>();
        var bucket = OpsHost.PhotoBucket(args.Stage);
        var email = $"account-smoke+{DateTime.UtcNow:yyyyMMddHHmmss}@example.com";
        var watch = Stopwatch.StartNew();
        string? userId = null, tenantId = null, exportKey = null;

        try
        {
            // ── e-mail verification ────────────────────────────────────────────────────────────────────────────
            var (status, body) = await CallAsync(HttpMethod.Post, "v1/auth/register",
                new JsonObject { ["name"] = "Account Smoke", ["email"] = email, ["password"] = "Smoke-" + Guid.NewGuid().ToString("N"), ["ageConfirmed"] = true }, ct, "tr");
            Check("POST v1/auth/register", status == 201, watch.Elapsed, $"{status} {email}");
            if (status != 201) return 1;
            _token = body!["accessToken"]!.GetValue<string>();
            userId = body["userId"]!.GetValue<string>();
            tenantId = body["tenantId"]!.GetValue<string>();

            watch.Restart();
            (status, body) = await CallAsync(HttpMethod.Get, "v1/tenant/profile", null, ct);
            Check("GET v1/tenant/profile (new e-mail account)", status == 200 && body?["emailVerified"]?.GetValue<bool>() == false, watch.Elapsed,
                $"emailVerified={body?["emailVerified"]}, emailVerifiedAt={body?["emailVerifiedAt"]?.ToString() ?? "null"}");

            watch.Restart();
            var row = await repository.GetAsync<EmailVerificationEntity>(EmailVerificationEntity.GetPk(), EmailVerificationEntity.GetSk(userId), ct);
            Check("verification row after sign-up (e-mail sent by the Api)", row is not null && row.CodeHash.Length == 64 && row.TokenHash.Length == 64 && row.Email == email,
                watch.Elapsed, row is null ? "missing" : $"hashes only, expires in {(row.ExpiresAt - DateTime.UtcNow).TotalHours:0.0} h, attempts {row.Attempts}");

            watch.Restart();
            (status, body) = await CallAsync(HttpMethod.Post, "v1/auth/email/verify", new JsonObject { ["code"] = "000000" }, ct);
            var codeAfter = await repository.GetAsync<EmailVerificationEntity>(EmailVerificationEntity.GetPk(), EmailVerificationEntity.GetSk(userId), ct);
            // 000000 is the right code once in a million: then it verifies, which is fine too.
            Check("POST v1/auth/email/verify {code: wrong}", status == 400 && Code(body) == "invalid_verification_code" && codeAfter?.Attempts == 1 || status == 200,
                watch.Elapsed, $"{status} {Code(body)}, attempts now {codeAfter?.Attempts}");

            watch.Restart();
            (status, _) = await CallAsync(HttpMethod.Post, "v1/auth/email/resend", new JsonObject(), ct, "en");
            var (again, againBody) = await CallAsync(HttpMethod.Post, "v1/auth/email/resend", new JsonObject(), ct, "en");
            var resent = await repository.GetAsync<EmailVerificationEntity>(EmailVerificationEntity.GetPk(), EmailVerificationEntity.GetSk(userId), ct);
            Check("POST v1/auth/email/resend ×2", status == 202 && again == 429 && resent is not null && resent.TokenHash != row?.TokenHash && resent.Attempts == 0,
                watch.Elapsed, $"{status} then {again} {Code(againBody)}; new code + link replaced the old ones");

            // Test-only: the real token is only in the e-mail. Plant a known one on the open verification (as the
            // e-mail link would carry it) and use it signed out, like the web page / deep link.
            watch.Restart();
            var planted = "smoke-" + Guid.NewGuid().ToString("N");
            resent!.TokenHash = planted.Sha256Hex();
            await repository.SaveAsync(resent, ct);
            await repository.SaveAsync(new EmailVerificationTokenEntity { TokenHash = resent.TokenHash, UserId = userId, ExpiresAt = resent.ExpiresAt }, ct);
            var saved = _token;
            _token = null;
            (status, body) = await CallAsync(HttpMethod.Post, "v1/auth/email/verify", new JsonObject { ["token"] = planted }, ct);
            _token = saved;
            Check("POST v1/auth/email/verify {token} (signed out)", status == 200 && body?["emailVerified"]?.GetValue<bool>() == true, watch.Elapsed, $"{status} {body?.ToJsonString()}");

            watch.Restart();
            (status, body) = await CallAsync(HttpMethod.Get, "v1/tenant/profile", null, ct);
            var listed = await repository.GetAllAsync<ContactDirectoryPointerEntity>(ContactDirectoryPointerEntity.GetPk(tenantId), ct);
            Check("profile verified + contact directory", body?["emailVerified"]?.GetValue<bool>() == true && body?["emailVerifiedAt"] is not null && listed.Count == 1,
                watch.Elapsed, $"emailVerifiedAt={body?["emailVerifiedAt"]}, directory entries {listed.Count}");

            (status, body) = await CallAsync(HttpMethod.Post, "v1/auth/email/resend", new JsonObject(), ct);
            Check("POST v1/auth/email/resend when verified", status == 409 && Code(body) == "email_already_verified", TimeSpan.Zero, $"{status} {Code(body)}");

            // ── data export ────────────────────────────────────────────────────────────────────────────────────
            watch.Restart();
            // Some records to export: a style profile and a consent (with its history row).
            var (styleStatus, _) = await CallAsync(HttpMethod.Put, "v1/tenant/style-profile",
                new JsonObject { ["segment"] = "women", ["styleTags"] = new JsonArray("minimal", "classic", "quietLuxury"), ["budget"] = "mixed", ["baseVersion"] = 0 }, ct);
            var (consentStatus, _) = await CallAsync(HttpMethod.Put, "v1/tenant/consents", new JsonObject
            {
                ["consents"] = new JsonArray(new JsonObject { ["type"] = "contacts", ["granted"] = true, ["version"] = Domain.Options.ConsentOptions.DefaultVersion }),
                ["source"] = "account-smoke",
                ["locale"] = "tr",
            }, ct);
            Check("seed records (style profile, consent)", styleStatus == 200 && consentStatus == 200, watch.Elapsed, $"{styleStatus} / {consentStatus}");
            await s3.PutObjectAsync(new Amazon.S3.Model.PutObjectRequest
            {
                BucketName = bucket, Key = $"tenant/{tenantId}/avatar/smoke.jpg", InputStream = new MemoryStream(Encoding.ASCII.GetBytes("smoke-file")), ContentType = "image/jpeg",
            }, ct);
            (status, body) = await CallAsync(HttpMethod.Post, "v1/tenant/export", new JsonObject(), ct, "tr");
            var (second, secondBody) = await CallAsync(HttpMethod.Post, "v1/tenant/export", new JsonObject(), ct);
            Check("POST v1/tenant/export ×2", status == 202 && body?["export"]?["status"]?.GetValue<string>() == "queued" && second == 409,
                watch.Elapsed, $"{status} {body?["export"]?["status"]}, then {second} {Code(secondBody)}");

            watch.Restart();
            JsonNode? state = null;
            while (watch.Elapsed < ExportTimeout)
            {
                (status, state) = await CallAsync(HttpMethod.Get, "v1/tenant/export", null, ct);
                var s = state?["export"]?["status"]?.GetValue<string>();
                if (s is "ready" or "failed") break;
                await Task.Delay(TimeSpan.FromSeconds(5), ct);
            }
            var export = state?["export"];
            Check("GET v1/tenant/export until ready (worker)", export?["status"]?.GetValue<string>() == "ready" && export["downloadUrl"] is not null,
                watch.Elapsed, $"status {export?["status"]}, {export?["sizeBytes"]} bytes, {export?["fileCount"]} entries, expires {export?["expiresAt"]}, canRequest {state?["canRequest"]}, next {state?["nextRequestAt"]}");

            if (export?["downloadUrl"]?.GetValue<string>() is { } url)
            {
                watch.Restart();
                using var plain = new HttpClient { Timeout = TimeSpan.FromSeconds(120) };
                var zipBytes = await plain.GetByteArrayAsync(url, ct);
                using var zip = new ZipArchive(new MemoryStream(zipBytes), ZipArchiveMode.Read);
                var names = zip.Entries.Select(e => e.FullName).ToList();
                var profileJson = new StreamReader(zip.GetEntry("profile.json")!.Open()).ReadToEnd();
                var ok = names.Contains("README.txt") && names.Contains("profile.json") && names.Contains("data/consent.json") && names.Contains("data/consent-history.json") && names.Contains("data/style-profile.json")
                         && names.Contains("files/avatar/smoke.jpg") && profileJson.Contains(email, StringComparison.Ordinal) && !profileJson.Contains("passwordHash", StringComparison.Ordinal);
                Check("download the ZIP (presigned URL) and read it", ok, watch.Elapsed, $"{zipBytes.Length} bytes: {string.Join(", ", names)}");
                exportKey = $"exports/{tenantId}/{export["id"]!.GetValue<string>()}.zip";
            }

            var inbox = await repository.GetAllAsync<NotificationInboxEntity>(NotificationInboxEntity.GetPk(tenantId), ct);
            Check("inbox row data_export_ready", inbox.Any(n => n.Type == Domain.Enum.NotificationType.DataExportReady), TimeSpan.Zero, $"{inbox.Count} row(s)");

            (status, body) = await CallAsync(HttpMethod.Get, "v1/export/download?token=not-a-real-token", null, ct);
            Check("GET v1/export/download wrong token", status == 404, TimeSpan.Zero, $"{status} {Code(body)}");

            (status, body) = await CallAsync(HttpMethod.Post, "v1/tenant/export", new JsonObject(), ct);
            Check("POST v1/tenant/export again the same day", status == 429 && Code(body) == "export_rate_limited", TimeSpan.Zero, $"{status} {Code(body)} next {body?["nextRequestAt"]}");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Check("run", false, watch.Elapsed, $"{ex.GetType().Name}: {ex.Message}");
        }
        finally
        {
            if (_token is not null && !args.Flag("keep-user"))
            {
                var (status, _) = await CallAsync(HttpMethod.Delete, "v1/auth/me", null, CancellationToken.None);
                var gone = true;
                if (exportKey is not null)
                {
                    try { await s3.GetObjectMetadataAsync(bucket, exportKey); gone = false; }
                    catch (AmazonS3Exception e) when (e.StatusCode == System.Net.HttpStatusCode.NotFound) { gone = true; }
                }
                Check("DELETE v1/auth/me (export file removed)", status == 204 && gone, TimeSpan.Zero, $"{status}, zip gone {gone}");
            }
            output.Table(["step", "result", "time", "detail"], _rows);
            output.Summary($"**account-smoke** {(_failed ? "FAILED" : "passed")} · user {userId} · tenant {tenantId} · e-mail delivery itself is not observable here");
        }
        return _failed ? 1 : 0;
    }

    private async Task<(int Status, JsonNode? Body)> CallAsync(HttpMethod method, string path, JsonNode? body, CancellationToken ct, string language = "tr")
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.AcceptLanguage.ParseAdd(language);
        if (_token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);
        if (body is not null) request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        using var noRedirect = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { BaseAddress = _http.BaseAddress, Timeout = _http.Timeout };
        using var response = await noRedirect.SendAsync(request, ct);
        var text = await response.Content.ReadAsStringAsync(ct);
        JsonNode? json = null;
        try { json = text.Length > 0 ? JsonNode.Parse(text) : null; } catch (System.Text.Json.JsonException) { }
        return ((int)response.StatusCode, json);
    }

    private static string? Code(JsonNode? body) => body?["code"]?.GetValue<string>();
}
