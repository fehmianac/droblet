using System.Globalization;
using Domain.Enum;

namespace Domain.Services;

/// <summary>
/// "Üzerimde gör" path rules (canvas 11, owner decision 4). The body photo is always preferred; without one the face photo
/// + body type + height / size build the figure ("yüz yolu"). Each path has its own consents, and its own cache subject so
/// a figure built with another body type, height or size is a different image.
/// </summary>
public static class TryOnRules
{
    /// <summary>Body photo first; the face path only when there is no body photo. null = no photo to render on.</summary>
    public static TryOnSource? PathFor(bool hasBodyPhoto, bool hasFacePhoto) =>
        hasBodyPhoto ? TryOnSource.Body : hasFacePhoto ? TryOnSource.Face : null;

    /// <summary>Consents the path needs. Without any photo the body path's consents are asked for (the preferred path).</summary>
    public static IReadOnlyList<ConsentType> ConsentsFor(TryOnSource? path) =>
        path == TryOnSource.Face ? ConsentRules.FaceTryOn : ConsentRules.BodyPhoto;

    /// <summary>
    /// Cache / credit subject of the face path: the face photo plus everything that shapes the figure. Lower-case, no '#'
    /// (it is part of the try-on image sort key). A body type that was never chosen counts as unsure.
    /// </summary>
    public static string FaceSubjectKey(string facePhotoId, BodyType? bodyType, int? heightCm, ClothingSize? size) =>
        string.Join('-', "face", facePhotoId, (bodyType ?? BodyType.Unsure).ToString(),
                heightCm?.ToString(CultureInfo.InvariantCulture) ?? "na", size?.ToString() ?? "na")
            .ToLowerInvariant();

    /// <summary>
    /// The photo check's verdict → the issue shown to the user (null = the photo is fine). One issue only, in the order the
    /// user can fix it: who is in the photo, then framing, light, sharpness.
    /// </summary>
    public static PhotoIssue? IssueOf(PhotoKind kind, PhotoInspection inspection)
    {
        if (kind == PhotoKind.Face)
        {
            if (inspection.People > 1) return PhotoIssue.MultiplePeople;
            if (inspection.People == 0 || !inspection.FaceVisible) return PhotoIssue.NoFace;
        }
        else
        {
            if (inspection.People > 1) return PhotoIssue.MultiplePeople;
            if (inspection.People == 0 || !inspection.FullBody) return PhotoIssue.NotFullBody;
        }

        if (inspection.TooDark) return PhotoIssue.TooDark;
        if (inspection.Blurry) return PhotoIssue.Blurry;
        return null;
    }
}

/// <summary>What the server-side photo check saw (vision model, no identification). AppearsMinor rejects the job outright.</summary>
public sealed record PhotoInspection(int People, bool FullBody, bool FaceVisible, bool TooDark, bool Blurry, bool AppearsMinor);

/// <summary>Shape of the figure the face path asks the image model for.</summary>
public sealed record TryOnFigure(BodyType BodyType, int? HeightCm, ClothingSize? Size);
