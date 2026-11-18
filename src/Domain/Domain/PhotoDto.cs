using Domain.Enum;
using Domain.Services;

namespace Domain.Domain;

public record PhotoDto(string Id, PhotoKind Kind, string ContentType, long SizeBytes, DateTime CreatedAt, string Url, DateTime UrlExpiresAt);

public record PhotosDto(PhotoDto? Body, PhotoDto? Face);

public record PhotoUploadDto(string UploadId, PhotoKind Kind, string Url, IReadOnlyDictionary<string, string> Fields, DateTime ExpiresAt, long MaxBytes);

public static class PhotoDtoMapper
{
    public static PhotoDto ToDto(this PhotoView view) =>
        new(view.Id, view.Kind, view.ContentType, view.SizeBytes, view.CreatedAt, view.Url, view.UrlExpiresAt);

    public static PhotosDto ToDto(this IReadOnlyList<PhotoView> views) => new(
        views.FirstOrDefault(v => v.Kind == PhotoKind.Body)?.ToDto(),
        views.FirstOrDefault(v => v.Kind == PhotoKind.Face)?.ToDto());
}
