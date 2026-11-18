using Domain.Entity;
using Domain.Manager;
using Domain.Services;
using Microsoft.Extensions.DependencyInjection;

namespace Ops.Commands;

/// <summary>
/// migrate-library-item-images: one-off, idempotent. Wardrobe pieces added from the ready library before its images were
/// generated still carry the seed's placeholder key (GlobalImageKey "library/….webp") — the app shows no picture and
/// try-on had nothing to render. Each such piece gets the library item's current https image (LibraryItemImageRules).
/// Versioned write (SaveIfVersionAsync on the read version, Version + 1, UpdatedAt = now) so other devices sync the
/// change and a concurrent user edit is never overwritten (a conflict is re-read once, then reported). A second run
/// changes nothing. --dry-run lists what would change.
/// </summary>
internal static class MigrateLibraryItemImagesCommand
{
    public sealed record Result(int Tenants, int Items, int Updated, int AlreadyCorrect, int NoImageYet, int Conflicts);

    public static Task<int> RunAsync(IServiceProvider services, OpsArguments args, OpsOutput output, CancellationToken ct) =>
        RunAsync(services.GetRequiredService<IRepository>(), services.GetRequiredService<TimeProvider>(), args, output, ct);

    public static async Task<int> RunAsync(IRepository repository, TimeProvider time, OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        var result = await MigrateAsync(repository, time, args.DryRun, output, ct);
        output.Summary($"### migrate-library-item-images ({args.Stage}){(args.DryRun ? " — dry run" : "")}\n");
        output.Table(["tenants", "library pieces", args.DryRun ? "would update" : "updated", "already correct", "library item has no image yet", "conflicts"],
            [[$"{result.Tenants}", $"{result.Items}", $"{result.Updated}", $"{result.AlreadyCorrect}", $"{result.NoImageYet}", $"{result.Conflicts}"]]);
        return result.Conflicts == 0 ? 0 : 1;
    }

    public static async Task<Result> MigrateAsync(IRepository repository, TimeProvider time, bool dryRun, OpsOutput output, CancellationToken ct)
    {
        // Only stored library rows can hold a generated image (the embedded seed has placeholders only).
        var library = (await repository.GetAllAsync<LibraryItemEntity>(LibraryItemEntity.GetPk(), ct))
            .ToDictionary(i => i.Id, StringComparer.Ordinal);
        var tenants = await repository.GetAllAsync<TenantEntity>(TenantEntity.GetPk(), ct);

        int items = 0, updated = 0, correct = 0, noImage = 0, conflicts = 0;
        foreach (var tenant in tenants)
        {
            ct.ThrowIfCancellationRequested();
            foreach (var item in await repository.GetAllAsync<ItemEntity>(ItemEntity.GetPk(tenant.Id), ct))
            {
                if (string.IsNullOrWhiteSpace(item.LibraryItemId))
                    continue;
                items++;
                if (!LibraryItemImageRules.NeedsLibraryImage(item))
                {
                    correct++;
                    continue;
                }
                var source = library.GetValueOrDefault(item.LibraryItemId);
                if (LibraryItemImageRules.CurrentImageFor(item, source) is not { } image)
                {
                    noImage++;
                    continue;
                }
                if (dryRun)
                {
                    output.Line($"[dry-run] tenant {tenant.Id} item {item.Id} ({item.LibraryItemId}) → {image}");
                    updated++;
                    continue;
                }
                if (await UpdateAsync(repository, time, item, image, ct))
                    updated++;
                else
                {
                    conflicts++;
                    output.Error($"tenant {tenant.Id} item {item.Id}: changed concurrently twice, skipped (run again)");
                }
            }
        }

        output.Line($"{tenants.Count} tenants · {items} library pieces · {(dryRun ? "would update" : "updated")} {updated} · already correct {correct} · " +
                    $"library item without image {noImage} · conflicts {conflicts}");
        return new Result(tenants.Count, items, updated, correct, noImage, conflicts);
    }

    /// <summary>Conditional on the read version; one re-read on a conflict (the user edited the piece meanwhile).</summary>
    private static async Task<bool> UpdateAsync(IRepository repository, TimeProvider time, ItemEntity item, string image, CancellationToken ct)
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var expected = item.Version;
            item.GlobalImageKey = image;
            item.UpdatedAt = time.GetUtcNow().UtcDateTime;
            if (await repository.SaveIfVersionAsync(item, expected, ct))
                return true;
            var current = await repository.GetAsync<ItemEntity>(item.Pk, item.Sk, ct);
            if (current is null || !LibraryItemImageRules.NeedsLibraryImage(current))
                return true; // deleted or fixed meanwhile: nothing left to do
            item = current;
        }
        return false;
    }
}
