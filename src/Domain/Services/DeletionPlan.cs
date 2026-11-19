using System.Reflection;
using Domain.Entity;

namespace Domain.Services;

/// <summary>
/// What account deletion and "delete my photos and generated images" remove.
/// Every tenant-scoped entity (static GetPk(string tenantId)) must be listed in TenantScopedEntityTypes —
/// a reflection test fails the build otherwise (SECURITY_ENGINEER.md §Silme listesi).
/// </summary>
public static class DeletionPlan
{
    public static readonly IReadOnlyList<Type> TenantScopedEntityTypes =
    [
        typeof(MutationReceiptEntity),
        typeof(JobEntity),
        typeof(EntitlementEntity),
        typeof(CreditAccountEntity),
        typeof(CreditReservationEntity),
        typeof(CreditLedgerEntryEntity),
        typeof(StorePurchaseEntity),
        typeof(StyleProfileEntity),
        typeof(BodyProfileEntity),
        typeof(DeviceEntity),
        typeof(PhotoEntity),
        typeof(PhotoUploadEntity),
        typeof(TryOnImageEntity),
        typeof(PaletteResultEntity),
        typeof(AffiliateClickEntity),
        typeof(AffiliateConversionEntity),
        // E2–E5 (wardrobe, looks, plan, stylist, trips)
        typeof(ItemEntity),
        typeof(ItemUploadEntity),
        typeof(ItemDraftEntity),
        typeof(ItemRecognitionUsageEntity),
        typeof(LookEntity),
        typeof(PlanDayEntity),
        typeof(WearLogEntity),
        typeof(TripEntity),
        typeof(TripItemEntity),
        typeof(TripDayEntity),
        typeof(StylistFeedbackEntity),
        // E8 / E9 / E11 (store, social, settings). Cross-tenant twins: ICrossTenantCleanup.
        typeof(CartLineEntity),
        typeof(WatchItemEntity),
        typeof(WatchRemovedEntity),
        typeof(FavoriteProductEntity),
        typeof(FollowingEntity),
        typeof(FollowerEntity),
        typeof(FollowRequestEntity),
        typeof(FollowRequestReceivedEntity),
        typeof(ContactSaltEntity),
        typeof(ContactDirectoryPointerEntity),
        typeof(RatingEntity),
        typeof(RatingGivenEntity),
        typeof(LookRatingSummaryEntity),
        typeof(SavedLookEntity),
        typeof(SavedByEntity),
        typeof(ShareEntity),
        typeof(InviteEntity),
        typeof(InviteeEntity),
        typeof(BlockEntity),
        typeof(BlockedByEntity),
        typeof(ReportFiledEntity),
        typeof(ReportReceivedEntity),
        typeof(NotificationPrefEntity),
        typeof(NotificationSentEntity),
        typeof(NotificationInboxEntity),
        // Consent records (current + append-only audit log): kept until the account is deleted (legal: consents §1).
        typeof(ConsentEntity),
        typeof(ConsentHistoryEntity),
        // Profile picture (own prefix tenant/{id}/avatar/, removed with TenantRoot).
        typeof(AvatarEntity),
        typeof(AvatarUploadEntity),
        // "Verilerimi indir" (the ZIP itself lives under exports/{tenantId}/, see AccountS3Prefixes).
        typeof(DataExportEntity),
    ];

    public static IReadOnlyList<string> TenantPartitionKeys(string tenantId) =>
        TenantScopedEntityTypes.Select(t => InvokeGetPk(t, tenantId)).ToList();

    public static IReadOnlyList<string> AccountS3Prefixes(string tenantId) =>
        [StorageKeys.TenantRoot(tenantId), StorageKeys.UploadsRoot(tenantId), StorageKeys.ExportsRoot(tenantId)];

    /// <summary>Photo deletion (screen 29): body + face + all try-on outputs. Item images stay.</summary>
    public static IReadOnlyList<string> PhotoS3Prefixes(string tenantId) =>
    [
        StorageKeys.PhotoPrefix(tenantId, Enum.PhotoKind.Body),
        StorageKeys.PhotoPrefix(tenantId, Enum.PhotoKind.Face),
        StorageKeys.TryOnPrefix(tenantId),
    ];

    /// <summary>
    /// Photo deletion partitions. Palette result is removed too (SECURITY_ENGINEER.md: safe side until owner/legal decide).
    /// </summary>
    public static IReadOnlyList<string> PhotoPartitionKeys(string tenantId) =>
    [
        PhotoEntity.GetPk(tenantId),
        PhotoUploadEntity.GetPk(tenantId),
        TryOnImageEntity.GetPk(tenantId),
        PaletteResultEntity.GetPk(tenantId),
    ];

    public static bool IsTenantScoped(Type type) => FindTenantGetPk(type) is not null;

    private static string InvokeGetPk(Type type, string tenantId) =>
        (string)(FindTenantGetPk(type) ?? throw new InvalidOperationException($"{type.Name} has no GetPk(string tenantId)."))
            .Invoke(null, [tenantId])!;

    private static MethodInfo? FindTenantGetPk(Type type) =>
        type.GetMethods(BindingFlags.Public | BindingFlags.Static)
            .FirstOrDefault(m => m.Name == "GetPk"
                                 && m.ReturnType == typeof(string)
                                 && m.GetParameters() is [{ Name: "tenantId", ParameterType: var p }] && p == typeof(string));
}
