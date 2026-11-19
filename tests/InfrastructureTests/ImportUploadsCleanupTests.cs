using System.Net;
using Amazon.S3;
using Domain.Services;
using Infrastructure.Storage;
using Microsoft.Extensions.Logging.Abstractions;

namespace InfrastructureTests;

/// <summary>Code deployed before the template: the Api cannot reach uploads/import/ (so nothing is there) and deletion goes on.</summary>
public class ImportUploadsCleanupTests
{
    private sealed class Denying(HttpStatusCode status) : IObjectStorage
    {
        public Task DeletePrefixAsync(string prefix, CancellationToken ct) => throw new AmazonS3Exception("denied") { StatusCode = status };
        public Task<PresignedUpload> CreateUploadAsync(string key, string contentType, long maxBytes, TimeSpan ttl, CancellationToken ct) => throw new NotSupportedException();
        public Task<string> CreateReadUrlAsync(string key, TimeSpan ttl, CancellationToken ct) => throw new NotSupportedException();
        public Task<StoredObjectInfo?> HeadAsync(string key, CancellationToken ct) => throw new NotSupportedException();
        public Task<byte[]?> ReadAsync(string key, long maxBytes, CancellationToken ct) => throw new NotSupportedException();
        public Task PutAsync(string key, byte[] data, string contentType, CancellationToken ct) => throw new NotSupportedException();
        public Task DeleteAsync(string key, CancellationToken ct) => throw new NotSupportedException();
        public Task<IReadOnlyList<string>> ListKeysAsync(string prefix, CancellationToken ct) => throw new NotSupportedException();
        public Task<Stream?> OpenReadAsync(string key, CancellationToken ct) => throw new NotSupportedException();
        public Task PutFileAsync(string key, string filePath, string contentType, CancellationToken ct) => throw new NotSupportedException();
        public Task<string> CreateDownloadUrlAsync(string key, string fileName, TimeSpan ttl, CancellationToken ct) => throw new NotSupportedException();
    }

    [Fact]
    public async Task AccessDenied_IsSkipped_OtherErrorsAreNot()
    {
        await ImportUploadsCleanup.DeletePrefixAsync(new Denying(HttpStatusCode.Forbidden), "uploads/import/t/", NullLogger.Instance, default);
        await Assert.ThrowsAsync<AmazonS3Exception>(() =>
            ImportUploadsCleanup.DeletePrefixAsync(new Denying(HttpStatusCode.InternalServerError), "uploads/import/t/", NullLogger.Instance, default));
    }
}
