using Domain.Domain;
using Domain.Entity;
using Domain.Entity.Base;
using Domain.Enum;
using Domain.Services;
using Infrastructure.Services;
using Infrastructure.Services.Social;
using Microsoft.Extensions.Logging.Abstractions;
using Tests.Shared;

namespace InfrastructureTests;

public class ContentModerationServiceTests
{
    private const string Owner = "owner-1";
    private const string ReportId = "01JREPORT00000000000000001";

    private readonly InMemoryRepository _repository = new();
    private readonly FakeObjectStorage _storage = new();
    private readonly FakeCdnCache _cdn = new();
    private readonly ContentModerationService _service;

    public ContentModerationServiceTests()
    {
        var clock = Fixtures.Clock();
        _service = new ContentModerationService(_repository, new NotificationInboxService(_repository, clock),
            new Infrastructure.Storage.ItemImagePublisher(_storage, _cdn, NullLogger<Infrastructure.Storage.ItemImagePublisher>.Instance),
            clock, NullLogger<ContentModerationService>.Instance);
    }

    private async Task SeedTargetsAsync()
    {
        await _repository.SaveAsync(new TenantEntity { Id = Owner, OwnerUserId = "user-1", DisplayName = "Ayşe Yılmaz", Handle = "ayse", Version = 3 });
        await _repository.SaveAsync(new LookEntity { Id = "look-1", TenantId = Owner, Name = "Ofis", Version = 2 });
        await _repository.SaveAsync(new ItemEntity { Id = "item-1", TenantId = Owner, Name = "Gömlek", Version = 4 });
    }

    private Task SeedReportAsync(ReportTargetKind kind, string? targetId, ReportStatus status = ReportStatus.Resolved,
        ReportResolution? resolution = ReportResolution.ContentRemoved, string id = ReportId) =>
        _repository.SaveAsync(new ReportEntity
        {
            Id = id, Status = status, ReporterTenantId = "reporter-1", TargetTenantId = Owner, TargetKind = kind, TargetId = targetId,
            Reason = ReportReason.Inappropriate, CreatedAt = Fixtures.Now, Resolution = status == ReportStatus.Resolved ? resolution : null,
            ResolvedAt = status == ReportStatus.Resolved ? Fixtures.Now : null, ResolvedByUserId = "admin-1",
        });

    private async Task<IModeratedEntity> TargetAsync(ReportTargetKind kind) => kind switch
    {
        ReportTargetKind.Profile => (await _repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk(Owner)))!,
        ReportTargetKind.Look => (await _repository.GetAsync<LookEntity>(LookEntity.GetPk(Owner), LookEntity.GetSk("look-1")))!,
        _ => (await _repository.GetAsync<ItemEntity>(ItemEntity.GetPk(Owner), ItemEntity.GetSk("item-1")))!,
    };

    private Task<ReportEntity?> ReportAsync(string id = ReportId) =>
        _repository.GetAsync<ReportEntity>(ReportEntity.GetPk(ReportStatus.Resolved), ReportEntity.GetSk(id));

    private Task<List<NotificationInboxEntity>> InboxAsync() => _repository.GetAllAsync<NotificationInboxEntity>(NotificationInboxEntity.GetPk(Owner));

    [Theory]
    [InlineData(ReportTargetKind.Profile, null)]
    [InlineData(ReportTargetKind.Look, "look-1")]
    [InlineData(ReportTargetKind.Item, "item-1")]
    public async Task Remove_HidesTheTargetOnce_NotifiesTheOwner_RestoreClearsIt(ReportTargetKind kind, string? targetId)
    {
        await SeedTargetsAsync();
        await SeedReportAsync(kind, targetId);
        var versionBefore = (await TargetAsync(kind)).Version;

        var removed = await _service.RemoveAsync(ReportId, default);
        var hidden = await TargetAsync(kind);
        var again = await _service.RemoveAsync(ReportId, default);
        var inbox = await InboxAsync();
        var stamped = await ReportAsync();

        Assert.Equal(ContentModerationOutcome.Applied, removed.Outcome);
        Assert.False(removed.Before!.Hidden);
        Assert.True(removed.After!.Hidden);
        Assert.Equal(ReportId, removed.After.ReportId);
        Assert.Equal(Fixtures.Now, hidden.ModerationHiddenAt);
        Assert.Equal(ReportId, hidden.ModerationReportId);
        Assert.Equal(ReportReason.Inappropriate, hidden.ModerationReason);
        Assert.Equal(versionBefore + 1, hidden.Version);                 // versioned: a stale owner edit cannot drop the flag
        Assert.Equal(ContentModerationOutcome.Unchanged, again.Outcome);  // idempotent
        Assert.Equal(Fixtures.Now, stamped!.ContentRemovedAt);

        var row = Assert.Single(inbox);                                   // once per report
        Assert.Equal(NotificationType.ContentRemoved, row.Type);
        Assert.Equal(ReportId, row.Key);
        Assert.Equal(kind.ToString().ToLowerInvariant(), row.Data["targetKind"]);
        Assert.Equal("inappropriate", row.Data["reason"]);
        Assert.Equal(targetId, row.Data.GetValueOrDefault("targetId"));
        Assert.Equal("content_removed", NotificationCodes.Code(row.Type));

        var restored = await _service.RestoreAsync(ReportId, "admin-2", default);
        var visible = await TargetAsync(kind);
        var restoredAgain = await _service.RestoreAsync(ReportId, "admin-3", default);
        var removeAfterRestore = await _service.RemoveAsync(ReportId, default);
        var report = await ReportAsync();

        Assert.Equal(ContentModerationOutcome.Applied, restored.Outcome);
        Assert.True(restored.Before!.Hidden);
        Assert.False(restored.After!.Hidden);
        Assert.Null(visible.ModerationHiddenAt);
        Assert.Null(visible.ModerationReportId);
        Assert.Null(visible.ModerationReason);
        Assert.Equal(ContentModerationOutcome.Unchanged, restoredAgain.Outcome);
        Assert.Equal(ContentModerationOutcome.Unchanged, removeAfterRestore.Outcome);   // never hidden a second time
        Assert.Null((await TargetAsync(kind)).ModerationHiddenAt);
        Assert.Equal(("admin-2", Fixtures.Now), (report!.ContentRestoredByUserId, report.ContentRestoredAt!.Value));
        Assert.Equal(ReportStatus.Resolved, report.Status);
    }

    [Fact]
    public async Task Remove_DeletesThePublicItemImage_AndPurgesIt_RestorePublishesAFreshCopy()
    {
        var cleaned = StorageKeys.ItemImage(Owner, "item-1");
        await _storage.PutAsync(cleaned, [1, 2], "image/webp", default);
        await _storage.PutAsync(StorageKeys.ItemImageRendition(cleaned, 256), [3], "image/webp", default);
        var publisher = new Infrastructure.Storage.ItemImagePublisher(_storage, _cdn, NullLogger<Infrastructure.Storage.ItemImagePublisher>.Instance);
        var item = new ItemEntity { Id = "item-1", TenantId = Owner, Name = "Gömlek", ImageKey = cleaned, Version = 4 };
        var first = (await publisher.PublishAsync(item, default))!;
        item.SetPublicImage(first);
        await _repository.SaveAsync(item);
        await SeedReportAsync(ReportTargetKind.Item, "item-1");

        await _service.RemoveAsync(ReportId, default);
        var hidden = (ItemEntity)await TargetAsync(ReportTargetKind.Item);

        Assert.Null(hidden.PublicImageKey);
        Assert.Null(hidden.PublicThumbKey);
        Assert.All(first.Keys, k => Assert.False(_storage.Objects.ContainsKey(k)));   // gone for everyone
        Assert.Equal(first.Keys.Order(), _cdn.Purged.Order());
        Assert.True(_storage.Objects.ContainsKey(cleaned));                            // the owner keeps the private image

        await _service.RestoreAsync(ReportId, "admin-2", default);
        var visible = (ItemEntity)await TargetAsync(ReportTargetKind.Item);

        Assert.NotNull(visible.PublicImageKey);
        Assert.DoesNotContain(visible.PublicImageKey, first.Keys);                     // new random key: no cache serves the old URL
        Assert.True(_storage.Objects.ContainsKey(visible.PublicImageKey!));
        Assert.NotNull(visible.PublicThumbKey);
        Assert.Null(visible.PublicMediumKey);                                          // no 768 rendition existed
    }

    [Theory]
    [InlineData(ReportTargetKind.Look, "gone")]
    [InlineData(ReportTargetKind.Item, "gone")]
    [InlineData(ReportTargetKind.Look, null)]
    [InlineData(ReportTargetKind.Profile, null)]
    public async Task Remove_TargetMissing_StillSucceeds_WithoutANotification(ReportTargetKind kind, string? targetId)
    {
        await SeedReportAsync(kind, targetId);   // no target rows at all (deleted look / item / account)

        var removed = await _service.RemoveAsync(ReportId, default);
        var restored = await _service.RestoreAsync(ReportId, "admin-1", default);

        Assert.Equal(ContentModerationOutcome.TargetMissing, removed.Outcome);
        Assert.False(removed.After!.Exists);
        Assert.Empty(await InboxAsync());
        Assert.NotNull((await ReportAsync())!.ContentRemovedAt);
        Assert.Equal(ContentModerationOutcome.TargetMissing, restored.Outcome);
    }

    [Fact]
    public async Task Remove_And_Restore_RefuseReportsThatAreNotResolvedAsContentRemoved()
    {
        await SeedTargetsAsync();
        await SeedReportAsync(ReportTargetKind.Look, "look-1", ReportStatus.Open, id: "01JREPORT00000000000000002");
        await SeedReportAsync(ReportTargetKind.Look, "look-1", resolution: ReportResolution.Dismissed, id: "01JREPORT00000000000000003");

        Assert.Equal(ContentModerationOutcome.ReportNotFound, (await _service.RemoveAsync("01JNOPE", default)).Outcome);
        Assert.Equal(ContentModerationOutcome.ReportNotResolved, (await _service.RemoveAsync("01JREPORT00000000000000002", default)).Outcome);
        Assert.Equal(ContentModerationOutcome.NotContentRemoved, (await _service.RemoveAsync("01JREPORT00000000000000003", default)).Outcome);
        Assert.Equal(ContentModerationOutcome.ReportNotFound, (await _service.RestoreAsync("01JNOPE", "a", default)).Outcome);
        Assert.Equal(ContentModerationOutcome.ReportNotResolved, (await _service.RestoreAsync("01JREPORT00000000000000002", "a", default)).Outcome);
        Assert.Equal(ContentModerationOutcome.NotContentRemoved, (await _service.RestoreAsync("01JREPORT00000000000000003", "a", default)).Outcome);
        Assert.Null((await TargetAsync(ReportTargetKind.Look)).ModerationHiddenAt);
        Assert.Empty(await InboxAsync());
    }

    [Fact]
    public async Task Remove_ContentAnEarlierReportRemoved_KeepsTheFirstFlag_AndDoesNotNotifyTwice()
    {
        const string second = "01JREPORT00000000000000009";
        await SeedTargetsAsync();
        await SeedReportAsync(ReportTargetKind.Look, "look-1");
        await SeedReportAsync(ReportTargetKind.Look, "look-1", id: second);

        await _service.RemoveAsync(ReportId, default);
        var duplicate = await _service.RemoveAsync(second, default);

        Assert.Equal(ContentModerationOutcome.Unchanged, duplicate.Outcome);
        Assert.Equal(ReportId, (await TargetAsync(ReportTargetKind.Look)).ModerationReportId);
        Assert.Single(await InboxAsync());
    }

    [Fact]
    public void OwnerDtos_CarryTheReadOnlyModerationField_OnlyWhileHidden()
    {
        var look = new LookEntity { Id = "l", TenantId = Owner };
        var tenant = new TenantEntity { Id = Owner, OwnerUserId = "u" };
        Assert.Null(look.ToDto(new HashSet<string>()).Moderation);
        Assert.Null(tenant.ToDto("a@b.c").Moderation);

        look.ModerationHiddenAt = tenant.ModerationHiddenAt = Fixtures.Now;
        look.ModerationReason = tenant.ModerationReason = ReportReason.Spam;

        Assert.Equal(new ModerationDto(true, ReportReason.Spam), look.ToDto(new HashSet<string>()).Moderation);
        Assert.Equal(new ModerationDto(true, ReportReason.Spam), tenant.ToDto("a@b.c").Moderation);
    }
}
