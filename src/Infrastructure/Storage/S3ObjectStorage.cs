using System.Net;
using Amazon.S3;
using Amazon.S3.Model;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Options;

namespace Infrastructure.Storage;

/// <summary>
/// Photo bucket access: presigned POST/GET. Everything is private except public/items/ (cleaned piece images, read
/// through Cloudflare — docs/images.md); this class never builds a public URL itself.
/// </summary>
public sealed class S3ObjectStorage(IAmazonS3 s3, IOptionsMonitor<PhotoOptions> options, TimeProvider timeProvider) : IObjectStorage
{
    private string Bucket => options.CurrentValue.Bucket is { Length: > 0 } bucket
        ? bucket
        : throw new InvalidOperationException("Photos.Bucket (PHOTO_BUCKET) is not configured.");

    public async Task<PresignedUpload> CreateUploadAsync(string key, string contentType, long maxBytes, TimeSpan ttl, CancellationToken ct)
    {
        var expires = timeProvider.GetUtcNow().UtcDateTime.Add(ttl);
        var response = await s3.CreatePresignedPostAsync(new CreatePresignedPostRequest
        {
            BucketName = Bucket,
            Key = key,
            Expires = expires,
            Fields = new Dictionary<string, string> { ["Content-Type"] = contentType },
            Conditions =
            [
                S3PostCondition.ExactMatch("Content-Type", contentType),
                S3PostCondition.ContentLengthRange(1, maxBytes),
            ],
        });
        return new PresignedUpload(response.Url, response.Fields, expires);
    }

    public Task<string> CreateReadUrlAsync(string key, TimeSpan ttl, CancellationToken ct) =>
        s3.GetPreSignedURLAsync(new GetPreSignedUrlRequest
        {
            BucketName = Bucket,
            Key = key,
            Verb = HttpVerb.GET,
            Expires = timeProvider.GetUtcNow().UtcDateTime.Add(ttl),
        });

    public async Task<StoredObjectInfo?> HeadAsync(string key, CancellationToken ct)
    {
        try
        {
            var response = await s3.GetObjectMetadataAsync(Bucket, key, ct);
            return new StoredObjectInfo(response.ContentLength, response.Headers.ContentType);
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task<byte[]?> ReadAsync(string key, long maxBytes, CancellationToken ct)
    {
        try
        {
            using var response = await s3.GetObjectAsync(Bucket, key, ct);
            if (response.ContentLength > maxBytes)
                return null;
            using var buffer = new MemoryStream((int)Math.Max(0, response.ContentLength));
            await response.ResponseStream.CopyToAsync(buffer, ct);
            return buffer.Length > maxBytes ? null : buffer.ToArray();
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task PutAsync(string key, byte[] data, string contentType, CancellationToken ct)
    {
        using var stream = new MemoryStream(data);
        await s3.PutObjectAsync(new PutObjectRequest
        {
            BucketName = Bucket,
            Key = key,
            InputStream = stream,
            ContentType = contentType,
            ServerSideEncryptionMethod = ServerSideEncryptionMethod.AES256,
        }, ct);
    }

    public async Task<bool> CopyAsync(string sourceKey, string destinationKey, string contentType, string? cacheControl, CancellationToken ct)
    {
        try
        {
            var request = new CopyObjectRequest
            {
                SourceBucket = Bucket,
                SourceKey = sourceKey,
                DestinationBucket = Bucket,
                DestinationKey = destinationKey,
                ContentType = contentType,
                MetadataDirective = S3MetadataDirective.REPLACE,
                ServerSideEncryptionMethod = ServerSideEncryptionMethod.AES256,
            };
            if (cacheControl is not null)
                request.Headers.CacheControl = cacheControl;
            await s3.CopyObjectAsync(request, ct);
            return true;
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return false;
        }
    }

    public Task DeleteAsync(string key, CancellationToken ct) => s3.DeleteObjectAsync(Bucket, key, ct);

    public async Task<IReadOnlyList<string>> ListKeysAsync(string prefix, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(prefix) || !prefix.EndsWith('/'))
            throw new ArgumentException("Prefix must be a non-empty folder prefix.", nameof(prefix));
        var keys = new List<string>();
        var request = new ListObjectsV2Request { BucketName = Bucket, Prefix = prefix };
        ListObjectsV2Response response;
        do
        {
            response = await s3.ListObjectsV2Async(request, ct);
            keys.AddRange((response.S3Objects ?? []).Select(o => o.Key));
            request.ContinuationToken = response.NextContinuationToken;
        } while (response.IsTruncated == true);
        return keys;
    }

    public async Task<Stream?> OpenReadAsync(string key, CancellationToken ct)
    {
        try
        {
            var response = await s3.GetObjectAsync(Bucket, key, ct);
            return response.ResponseStream;
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task PutFileAsync(string key, string filePath, string contentType, CancellationToken ct)
    {
        using var transfer = new Amazon.S3.Transfer.TransferUtility(s3);
        await transfer.UploadAsync(new Amazon.S3.Transfer.TransferUtilityUploadRequest
        {
            BucketName = Bucket,
            Key = key,
            FilePath = filePath,
            ContentType = contentType,
            ServerSideEncryptionMethod = ServerSideEncryptionMethod.AES256,
        }, ct);
    }

    public Task<string> CreateDownloadUrlAsync(string key, string fileName, TimeSpan ttl, CancellationToken ct) =>
        s3.GetPreSignedURLAsync(new GetPreSignedUrlRequest
        {
            BucketName = Bucket,
            Key = key,
            Verb = HttpVerb.GET,
            Expires = timeProvider.GetUtcNow().UtcDateTime.Add(ttl),
            ResponseHeaderOverrides = new ResponseHeaderOverrides { ContentDisposition = $"attachment; filename=\"{fileName}\"" },
        });

    public async Task DeletePrefixAsync(string prefix, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(prefix) || !prefix.EndsWith('/'))
            throw new ArgumentException("Prefix must be a non-empty folder prefix.", nameof(prefix));

        var request = new ListObjectsV2Request { BucketName = Bucket, Prefix = prefix };
        ListObjectsV2Response response;
        do
        {
            response = await s3.ListObjectsV2Async(request, ct);
            var objects = response.S3Objects ?? [];
            if (objects.Count > 0)
            {
                await s3.DeleteObjectsAsync(new DeleteObjectsRequest
                {
                    BucketName = Bucket,
                    Objects = objects.Select(o => new KeyVersion { Key = o.Key }).ToList(),
                    Quiet = true,
                }, ct);
            }
            request.ContinuationToken = response.NextContinuationToken;
        } while (response.IsTruncated == true);
    }
}
