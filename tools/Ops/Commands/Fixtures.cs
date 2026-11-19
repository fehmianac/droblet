using Amazon.S3;
using Amazon.S3.Model;
using Domain.Services.Ai;
using Infrastructure.Ai;

namespace Ops.Commands;

/// <summary>
/// Synthetic test photos for ai-smoke, generated once with the image model and kept in the private photo bucket under
/// ops-fixtures/ (outside every tenant prefix). They enter the photo flow only through the throw-away test user's own
/// uploads, so deleting that user removes its copies; the fixtures themselves are reused by the next run.
/// </summary>
internal sealed class SmokeFixtures(IAmazonS3 s3, OpenAiProvider provider, string bucket, ImageCallBudget budget, OpsOutput output)
{
    public const string Prefix = "ops-fixtures/";

    public sealed record Fixture(string Name, string Size, string Prompt);

    public static readonly Fixture Body = new("body.jpg", "1024x1536",
        "Photorealistic full-body studio photograph of a fictional adult woman in her thirties (an invented person, not resembling anyone real), " +
        "standing straight and facing the camera in a neutral relaxed pose, arms at her sides, whole body visible from head to feet with space around. " +
        "Fully clothed in a plain fitted light grey crew-neck t-shirt, plain black straight trousers and plain white sneakers. " +
        "Plain seamless light grey studio background, soft even light. No text, no logos, no props.");

    public static readonly Fixture Face = new("face.jpg", "1024x1024",
        "Photorealistic head-and-shoulders portrait of a fictional adult woman (an invented person, not resembling anyone real), " +
        "facing the camera with a neutral expression, natural hair, no makeup look, wearing a plain white crew-neck t-shirt. " +
        "Natural soft daylight, true skin tones, no filters, plain off-white background. Exactly one face. No text, no logos.");

    public static readonly Fixture Garment = new("garment.jpg", "1024x1024",
        "Amateur smartphone photo, taken from above, of a navy blue wool crew-neck sweater lying flat on a light oak wooden floor, " +
        "slightly wrinkled, natural window light, a bit of the floor visible around it. No person, no text, no logos.");

    /// <summary>Multi-item detection: five pieces in one photo, the necklace being the small one that must not be missed.</summary>
    public static readonly Fixture FlatLay = new("flatlay-5.jpg", "1024x1536",
        "Amateur smartphone photo, taken from directly above, of a casual women's outfit laid out flat on a light oak wooden floor with space between the pieces: " +
        "a plain white cotton crew-neck t-shirt at the top left, plain blue straight-leg jeans below it, a pair of white leather sneakers at the bottom right, " +
        "a black leather tote bag at the middle right, and a thin gold chain necklace with a small pendant lying on the floor at the top right, next to the t-shirt. " +
        "Every piece fully visible and not overlapping. Natural window light. No person, no hands, no text, no logos.");

    public async Task<(byte[] Data, bool Generated)> GetAsync(Fixture fixture, CancellationToken ct)
    {
        var key = Prefix + fixture.Name;
        try
        {
            using var existing = await s3.GetObjectAsync(bucket, key, ct);
            using var buffer = new MemoryStream();
            await existing.ResponseStream.CopyToAsync(buffer, ct);
            return (buffer.ToArray(), false);
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            // first run: generate below
        }

        if (!budget.TryTake())
            throw new InvalidOperationException($"image-call cap reached before fixture {fixture.Name}");
        output.Line($"Generating synthetic fixture {fixture.Name} with the image model …");
        var image = await provider.GenerateImageAsync(new ImageGenerationRequest(fixture.Prompt, fixture.Size, "jpeg", 88, "medium"), ct);
        if (image.ContentType != "image/jpeg")
            throw new InvalidOperationException($"fixture {fixture.Name}: the image model returned {image.ContentType}, expected image/jpeg");
        await s3.PutObjectAsync(new PutObjectRequest { BucketName = bucket, Key = key, InputStream = new MemoryStream(image.Data), ContentType = "image/jpeg" }, ct);
        return (image.Data, true);
    }
}
