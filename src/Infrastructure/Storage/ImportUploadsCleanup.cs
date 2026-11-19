using System.Net;
using Amazon.S3;
using Domain.Services;
using Microsoft.Extensions.Logging;

namespace Infrastructure.Storage;

/// <summary>
/// Deletes a prefix under uploads/import/. Deploy order: the template (which grants the Api role uploads/import/*) goes
/// before this code; should the code run first, the Api can neither list nor write that prefix — so nothing can be
/// there — and an AccessDenied must not fail account deletion or a discard. Any other error is thrown.
/// </summary>
public static class ImportUploadsCleanup
{
    public static async Task DeletePrefixAsync(IObjectStorage storage, string prefix, ILogger logger, CancellationToken ct)
    {
        try
        {
            await storage.DeletePrefixAsync(prefix, ct);
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == HttpStatusCode.Forbidden)
        {
            logger.LogWarning("uploads/import/ is not accessible yet (template not deployed); nothing can be stored there, skipped");
        }
    }
}
