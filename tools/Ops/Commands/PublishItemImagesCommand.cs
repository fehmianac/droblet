using Domain.Entity;
using Domain.Entity.Base;
using Domain.Manager;
using Domain.Services;
using ItemProcessor.Services;
using Microsoft.Extensions.DependencyInjection;

namespace Ops.Commands;

/// <summary>
/// publish-item-images: idempotent, resumable, no AI, allowed on dev and prod (docs/images.md §Migration). Every tenant
/// (the whole tenant list, paginated by the repository) and every wardrobe piece of it is scanned — single photos, pieces
/// of multi-item photos and outfit-import pieces alike, since all of them keep their cleaned image at
/// tenant/{id}/items/*.webp. For a piece with a cleaned image:
///   1. the private 256 / 768 px renditions are made when missing (SkiaSharp, exactly like the item worker);
///   2. the cleaned image and its renditions are copied to public/items/ under fresh random keys when the piece is not
///      published yet, a public copy is missing, or it was published before its renditions existed;
///   3. the keys are stored with a versioned write (SaveIfVersionAsync: Version + 1, UpdatedAt = now, so other devices
///      sync the new URLs; a concurrent edit is re-read once). Replaced public copies are deleted afterwards.
/// Moderation-hidden pieces are never published. Pieces without a cleaned image are skipped (with the reason) and keep
/// the presigned fallback. Tenants are processed in id order and the last finished tenant is printed as a checkpoint:
/// --after-tenant &lt;id&gt; resumes after it (a re-run from the start is safe too, only slower). --dry-run only counts.
/// </summary>
internal static class PublishItemImagesCommand
{
    public static class SkipReason
    {
        public const string LibraryOrCatalog = "library / catalog piece (global image, already public)";
        public const string OriginalOnly = "no cleaned image (manual photo, cleanup pending or failed): original stays private";
        public const string NoImage = "no image at all";
        public const string NotOwnCleaned = "image key outside the tenant's items/ folder or not a cleaned .webp";
        public const string CleanedMissing = "cleaned image missing in S3";
    }

    public sealed record Result(int Tenants, int Scanned, int RenditionsMade, int Published, int AlreadyPublic, int Hidden, int Failed,
        IReadOnlyDictionary<string, int> Skipped, string? Checkpoint)
    {
        public int SkippedTotal => Skipped.Values.Sum();
    }

    public static Task<int> RunAsync(IServiceProvider services, OpsArguments args, OpsOutput output, CancellationToken ct) =>
        RunAsync(services.GetRequiredService<IRepository>(), services.GetRequiredService<IObjectStorage>(), new SkiaImageThumbnailer(),
            services.GetRequiredService<IItemImagePublisher>(), services.GetRequiredService<TimeProvider>(), args, output, ct);

    public static async Task<int> RunAsync(IRepository repository, IObjectStorage storage, IImageThumbnailer thumbnailer, IItemImagePublisher publisher,
        TimeProvider time, OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        var result = await PublishAsync(repository, storage, thumbnailer, publisher, time, args.DryRun, args.Option("after-tenant"), output, ct);
        output.Summary($"### publish-item-images ({args.Stage}){(args.DryRun ? " — dry run" : "")}\n");
        output.Table(["tenants", "items scanned", args.DryRun ? "would publish" : "published", "already public", "skipped", "hidden (moderation)",
                args.DryRun ? "would make renditions" : "renditions made", "failed", "checkpoint"],
            [[$"{result.Tenants}", $"{result.Scanned}", $"{result.Published}", $"{result.AlreadyPublic}", $"{result.SkippedTotal}", $"{result.Hidden}",
              $"{result.RenditionsMade}", $"{result.Failed}", result.Checkpoint ?? "-"]]);
        if (result.Skipped.Count > 0)
            output.Table(["skipped because", "items"], result.Skipped.OrderByDescending(s => s.Value).Select(s => new[] { s.Key, $"{s.Value}" }).ToList());
        return result.Failed == 0 ? 0 : 1;
    }

    public static async Task<Result> PublishAsync(IRepository repository, IObjectStorage storage, IImageThumbnailer thumbnailer, IItemImagePublisher publisher,
        TimeProvider time, bool dryRun, string? afterTenant, OpsOutput output, CancellationToken ct)
    {
        var tenants = (await repository.GetAllAsync<TenantEntity>(TenantEntity.GetPk(), ct))
            .Where(t => afterTenant is null || string.CompareOrdinal(t.Id, afterTenant) > 0)
            .OrderBy(t => t.Id, StringComparer.Ordinal)
            .ToList();
        int scanned = 0, renditions = 0, published = 0, already = 0, hidden = 0, failed = 0;
        var skipped = new Dictionary<string, int>(StringComparer.Ordinal);
        string? checkpoint = null;
        void Skip(string reason) => skipped[reason] = skipped.GetValueOrDefault(reason) + 1;

        foreach (var tenant in tenants)
        {
            foreach (var item in await repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenant.Id), ct))
            {
                ct.ThrowIfCancellationRequested();
                scanned++;
                if (item.ImageKey is not { } cleaned)
                {
                    Skip(item.OriginalImageKey is not null ? SkipReason.OriginalOnly : item.GlobalImageKey is not null ? SkipReason.LibraryOrCatalog : SkipReason.NoImage);
                    continue;
                }
                if (!cleaned.StartsWith(StorageKeys.ItemsPrefix(tenant.Id), StringComparison.Ordinal) || !cleaned.EndsWith(".webp", StringComparison.Ordinal))
                {
                    Skip(SkipReason.NotOwnCleaned);
                    continue;
                }
                if (item.IsModerationHidden())
                {
                    hidden++;
                    continue;
                }
                if (await storage.HeadAsync(cleaned, ct) is null)
                {
                    Skip(SkipReason.CleanedMissing);
                    output.Error($"tenant {tenant.Id} item {item.Id}: cleaned image missing in S3; skipped");
                    continue;
                }

                // 1. Renditions.
                var missing = 0;
                foreach (var key in ItemImageRenditions.KeysOf(cleaned))
                    if (await storage.HeadAsync(key, ct) is null)
                        missing++;
                var hasRenditions = missing == 0;
                if (!hasRenditions)
                {
                    if (dryRun)
                    {
                        renditions++;
                        hasRenditions = true; // counted as made for the publish decision below
                    }
                    else if (await storage.ReadAsync(cleaned, 15 * 1024 * 1024, ct) is { } data
                             && (await ItemImageRenditions.WriteAsync(storage, thumbnailer, cleaned, data, ct)).Count == ItemImageRenditions.Widths.Count)
                    {
                        renditions++;
                        hasRenditions = true;
                    }
                    else
                    {
                        output.Error($"tenant {tenant.Id} item {item.Id}: the cleaned image could not be resampled; published without thumbnails");
                    }
                }

                // 2. Publication.
                if (!await NeedsPublishAsync(storage, item, hasRenditions, ct))
                {
                    already++;
                    continue;
                }
                if (dryRun)
                {
                    published++;
                    continue;
                }
                if (await PublishOneAsync(repository, publisher, time, item, ct))
                    published++;
                else
                {
                    failed++;
                    output.Error($"tenant {tenant.Id} item {item.Id}: not published (copy failed or changed concurrently twice; run again)");
                }
            }
            checkpoint = tenant.Id;
            if (!dryRun)
                output.Line($"checkpoint: tenant {tenant.Id} done (resume with --after-tenant {tenant.Id})");
        }

        output.Line($"{tenants.Count} tenants · {scanned} items scanned · {(dryRun ? "would publish" : "published")} {published} · already public {already} · " +
                    $"skipped {skipped.Values.Sum()} · hidden {hidden} · renditions {(dryRun ? "to make" : "made")} {renditions} · failed {failed}");
        return new Result(tenants.Count, scanned, renditions, published, already, hidden, failed, skipped, checkpoint);
    }

    private static async Task<bool> NeedsPublishAsync(IObjectStorage storage, ItemEntity item, bool hasRenditions, CancellationToken ct)
    {
        if (item.PublicImageKey is not { } full || !StorageKeys.IsPublicItemKeyOf(full, item.TenantId))
            return true;
        if (hasRenditions && (item.PublicThumbKey is null || item.PublicMediumKey is null))
            return true; // published before its renditions existed
        foreach (var key in item.PublicImageKeys())
            if (await storage.HeadAsync(key, ct) is null)
                return true;
        return false;
    }

    private static async Task<bool> PublishOneAsync(IRepository repository, IItemImagePublisher publisher, TimeProvider time, ItemEntity item, CancellationToken ct)
    {
        var image = await publisher.PublishAsync(item, ct);
        if (image is null)
            return false;
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var previous = item.PublicImageKeys();
            var expected = item.Version;
            item.SetPublicImage(image);
            item.UpdatedAt = time.GetUtcNow().UtcDateTime;
            if (await repository.SaveIfVersionAsync(item, expected, ct))
            {
                await publisher.UnpublishAsync(item.TenantId, previous, ct);
                return true;
            }
            var current = await repository.GetAsync<ItemEntity>(item.Pk, item.Sk, ct);
            if (current is null || current.ImageKey != item.ImageKey || current.IsModerationHidden())
            {
                await publisher.UnpublishAsync(item.TenantId, image.Keys, ct); // deleted, replaced or hidden meanwhile
                return true;
            }
            item = current;
        }
        await publisher.UnpublishAsync(item.TenantId, image.Keys, ct);
        return false;
    }
}
