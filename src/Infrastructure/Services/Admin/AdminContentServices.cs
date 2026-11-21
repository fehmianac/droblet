using System.Text.RegularExpressions;
using Amazon.S3;
using Amazon.S3.Model;
using Domain.Entity;
using Domain.Enum;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Services.Admin;
using Domain.Validation;
using Infrastructure.Services.Integration;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Admin;

/// <summary>
/// Ready-made library CRUD (screen 12b / onboarding 04b content). Until the first write the embedded seed is served;
/// the first admin write copies the seed into the library#item partition so nothing disappears from the app.
/// Ids are never reused: DELETE retires.
/// </summary>
public sealed partial class AdminLibraryService(
    IRepository repository,
    IOptionsMonitor<LocalizationOptions> localization,
    IOptionsMonitor<WardrobeOptions> wardrobe) : IAdminLibraryService
{
    [GeneratedRegex("^lib-[a-z0-9]+(-[a-z0-9]+)*$")]
    private static partial Regex IdPattern();

    public async Task<IReadOnlyList<AdminLibraryItemDto>> ListAsync(CancellationToken ct)
    {
        var stored = await repository.GetAllAsync<LibraryItemEntity>(LibraryItemEntity.GetPk(), ct);
        var storedIds = stored.Select(i => i.Id).ToHashSet(StringComparer.Ordinal);
        return LibraryCatalog.WithSeed(stored).OrderBy(i => i.SortOrder).ThenBy(i => i.Id, StringComparer.Ordinal)
            .Select(i => ToDto(i, storedIds.Contains(i.Id))).ToList();
    }

    public async Task<LibraryItemEntity?> GetAsync(string id, CancellationToken ct) =>
        await repository.GetAsync<LibraryItemEntity>(LibraryItemEntity.GetPk(), LibraryItemEntity.GetSk(id), ct)
        ?? LibraryCatalog.Seed.FirstOrDefault(i => i.Id == id);

    public async Task<(IReadOnlyDictionary<string, string[]> Errors, AdminLibraryItemDto? Item)> UpsertAsync(LibraryItemInput input, CancellationToken ct)
    {
        var errors = Validate(input, localization.CurrentValue);
        if (errors.Count > 0)
            return (errors, null);

        await MaterializeSeedAsync(ct);
        var entity = new LibraryItemEntity
        {
            Id = input.Id,
            Name = LocalizedText.Normalize(input.Name),
            Category = input.Category!.Value,
            ColorIds = input.ColorIds!.Distinct(StringComparer.Ordinal).ToList(),
            Fabric = string.IsNullOrWhiteSpace(input.Fabric) ? null : input.Fabric,
            Seasons = input.Seasons!.Distinct().ToList(),
            ImageKey = string.IsNullOrWhiteSpace(input.ImageUrl) ? null : input.ImageUrl.Trim(),
            SortOrder = input.SortOrder,
            Retired = input.Retired,
            Segment = input.Segment ?? CatalogSegment.Women,
        };
        await repository.SaveAsync(entity, ct);
        return (errors, ToDto(entity, true));
    }

    public async Task<bool> RetireAsync(string id, CancellationToken ct)
    {
        if (await GetAsync(id, ct) is null)
            return false;
        await MaterializeSeedAsync(ct);
        // A seed piece added after the partition was written (not stored yet) is stored on its first retire.
        var entity = await repository.GetAsync<LibraryItemEntity>(LibraryItemEntity.GetPk(), LibraryItemEntity.GetSk(id), ct)
                     ?? LibraryCatalog.Seed.FirstOrDefault(i => i.Id == id);
        if (entity is null)
            return false;
        entity.Retired = true;
        await repository.SaveAsync(entity, ct);
        return true;
    }

    private async Task MaterializeSeedAsync(CancellationToken ct)
    {
        if ((await repository.GetKeysAsync(LibraryItemEntity.GetPk(), ct)).Count > 0)
            return;
        await repository.BatchWriteAsync(LibraryCatalog.Seed.Cast<Domain.Entity.Base.IEntity>().ToList(), ct);
    }

    private AdminLibraryItemDto ToDto(LibraryItemEntity i, bool stored) => new(
        i.Id, i.Name, i.Category, i.ColorIds, i.Fabric, i.Seasons, GlobalAssets.PublicUrl(i.ImageKey, wardrobe.CurrentValue.PublicAssetBaseUrl),
        i.SortOrder, i.Retired, stored, i.Segment, LibraryItemImageRules.NeedsImage(i));

    public static Dictionary<string, string[]> Validate(LibraryItemInput input, LocalizationOptions languages)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        if (input.Id is not { Length: <= 64 } || !IdPattern().IsMatch(input.Id))
            errors["id"] = ["id_invalid"];
        if (!LocalizedText.IsValid(input.Name, required: true, 120, languages.Languages, languages.DefaultLanguage))
            errors["name"] = ["name_invalid"];
        if (input.Category is not { } category || !System.Enum.IsDefined(category))
            errors["category"] = ["category_invalid"];
        if (input.ColorIds is not { Count: > 0 and <= 8 } || input.ColorIds.Any(c => !ColorCatalog.IsKnown(c)))
            errors["colorIds"] = ["colors_invalid"];
        if (!string.IsNullOrWhiteSpace(input.Fabric) && !FabricCatalog.IsKnown(input.Fabric))
            errors["fabric"] = ["fabric_invalid"];
        if (input.Seasons is not { Count: > 0 } || input.Seasons.Any(s => !System.Enum.IsDefined(s)))
            errors["seasons"] = ["seasons_invalid"];
        if (!StoreInputRules.IsOptionalHttps(input.ImageUrl))
            errors["imageUrl"] = ["image_url_invalid"];
        if (input.SortOrder is < 0 or > 100_000)
            errors["sortOrder"] = ["sort_order_invalid"];
        if (input.Segment is { } segment && !System.Enum.IsDefined(segment))
            errors["segment"] = ["segment_invalid"];
        return errors;
    }
}

/// <summary>Counters for the dashboard tiles. Small partitions (admin-managed catalog, users list) are read whole.</summary>
public sealed class AdminDashboardService(
    IRepository repository,
    ICatalogService catalog,
    IContentService content,
    IAdminLibraryService library,
    TimeProvider timeProvider) : IAdminDashboardService
{
    public async Task<DashboardDto> GetAsync(CancellationToken ct)
    {
        var now = timeProvider.GetUtcNow().UtcDateTime;
        var users = await repository.GetAllAsync<UserEntity>(UserEntity.GetPk(), ct);
        var brands = await catalog.GetBrandsAsync(ct);
        var products = await catalog.GetProductsAsync(ct);
        var edits = await content.ListEditsAsync(ct);
        var collections = 0;
        foreach (var kind in System.Enum.GetValues<ContentCollectionKind>())
            collections += (await content.ListCollectionsAsync(kind, ct)).Count(c => !c.Retired);
        var libraryItems = (await library.ListAsync(ct)).Count(i => !i.Retired);
        var openReports = (await repository.GetKeysAsync(ReportEntity.GetPk(ReportStatus.Open), ct)).Count;

        return new DashboardDto(
            new DashboardUsers(users.Count, users.Count(u => u.CreatedAt >= now.AddDays(-7)), users.Count(u => u.SuspendedAt is not null)),
            new DashboardCatalog(brands.Count(b => !b.Retired), products.Count, products.Count(p => !p.Retired)),
            new DashboardContent(edits.Count(e => !e.Retired), edits.Count(e => e is { Published: true, Retired: false }), collections, libraryItems),
            new DashboardModeration(openReports));
    }
}

/// <summary>
/// Presigned POST into the public catalog image bucket (CatalogImageBucket): exact key, exact content type, size cap.
/// The returned publicUrl is https on the bucket host, reachable by the app and by the try-on worker.
/// </summary>
public sealed class S3CatalogImageStorage(IAmazonS3 s3, IOptionsMonitor<CatalogImageOptions> options, TimeProvider timeProvider) : ICatalogImageStorage
{
    public async Task<CatalogImageUploadDto?> CreateUploadAsync(CatalogImagePurpose purpose, string contentType, CancellationToken ct)
    {
        var settings = options.CurrentValue;
        if (string.IsNullOrEmpty(settings.Bucket) || settings.PublicHost is null)
            return null;

        var now = timeProvider.GetUtcNow().UtcDateTime;
        var expires = now.AddSeconds(settings.UploadUrlTtlSeconds);
        var extension = contentType switch { "image/png" => "png", "image/webp" => "webp", _ => "jpg" };
        var key = $"catalog/{purpose.ToString().ToLowerInvariant()}/{Ulid.New(now).ToLowerInvariant()}.{extension}";
        var response = await s3.CreatePresignedPostAsync(new CreatePresignedPostRequest
        {
            BucketName = settings.Bucket,
            Key = key,
            Expires = expires,
            Fields = new Dictionary<string, string> { ["Content-Type"] = contentType, ["Cache-Control"] = "public, max-age=31536000, immutable" },
            Conditions =
            [
                S3PostCondition.ExactMatch("Content-Type", contentType),
                S3PostCondition.ExactMatch("Cache-Control", "public, max-age=31536000, immutable"),
                S3PostCondition.ContentLengthRange(1, settings.MaxUploadBytes),
            ],
        });
        return new CatalogImageUploadDto(response.Url, response.Fields, key, $"{settings.PublicBaseUrl.TrimEnd('/')}/{key}", expires, settings.MaxUploadBytes);
    }
}
