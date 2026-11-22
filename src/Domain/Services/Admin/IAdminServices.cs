using Domain.Entity;
using Domain.Enum;
using Domain.Services.Ai;

namespace Domain.Services.Admin;

// ── Sign-in ──────────────────────────────────────────────────────────────────────────────────────────────────────

public sealed record AdminMeDto(string Id, string Email, string Name, AdminRole Role, IReadOnlyList<string> Permissions)
{
    public static AdminMeDto From(AdminUserEntity admin) => new(admin.Id, admin.Email, admin.Name, admin.Role, AdminPermissions.Of(admin.Role));
}

public sealed record AdminSessionDto(string AccessToken, DateTime AccessTokenExpiresAt, string RefreshToken, DateTime RefreshTokenExpiresAt, AdminMeDto Admin);

public enum AdminAuthOutcome { Success, InvalidCredentials, TooManyAttempts, InvalidCode, ChallengeExpired, InvalidToken, EmailUnavailable }

public sealed record AdminLoginResult(AdminAuthOutcome Outcome, string? ChallengeId = null, DateTime? ExpiresAt = null);

public sealed record AdminVerifyResult(AdminAuthOutcome Outcome, AdminSessionDto? Session = null, int? AttemptsLeft = null);

public sealed record AdminRequestInfo(string? Ip, string Language);

public interface IAdminTokenService
{
    AccessToken CreateAccessToken(AdminUserEntity admin);
    string CreateOpaqueToken();
}

public interface IAdminAuthService
{
    Task<AdminLoginResult> LoginAsync(string email, string password, AdminRequestInfo request, CancellationToken ct);
    Task<AdminVerifyResult> VerifyAsync(string challengeId, string code, AdminRequestInfo request, CancellationToken ct);
    Task<AdminVerifyResult> RefreshAsync(string refreshToken, CancellationToken ct);
    Task LogoutAsync(AdminUserEntity admin, string? refreshToken, string? ip, CancellationToken ct);
    Task LogoutAllAsync(AdminUserEntity admin, string? ip, CancellationToken ct);
    /// <summary>Always completes quietly (202 whether or not the admin exists). Also runs the bootstrap.</summary>
    Task RequestPasswordResetAsync(string email, AdminRequestInfo request, CancellationToken ct);
    Task<AdminAuthOutcome> ResetPasswordAsync(string token, string newPassword, string? ip, CancellationToken ct);
    Task<AdminAuthOutcome> ChangePasswordAsync(AdminUserEntity admin, string currentPassword, string newPassword, string? ip, CancellationToken ct);
    /// <summary>Creates the configured first super admin (no password) once; idempotent and race-safe.</summary>
    Task EnsureBootstrapAsync(CancellationToken ct);
}

// ── Admin users ──────────────────────────────────────────────────────────────────────────────────────────────────

public sealed record AdminUserDto(
    string Id, string Email, string Name, AdminRole Role, bool Disabled, bool PasswordSet, DateTime? LastLoginAt, DateTime CreatedAt, DateTime UpdatedAt)
{
    public static AdminUserDto From(AdminUserEntity a) => new(a.Id, a.Email, a.Name, a.Role, a.Disabled, a.PasswordSet, a.LastLoginAt, a.CreatedAt, a.UpdatedAt);
}

public enum AdminUserOutcome { Ok, NotFound, EmailTaken, CannotChangeSelf, LastSuperAdmin }

public sealed record AdminUserResult(AdminUserOutcome Outcome, AdminUserDto? Admin = null);

public interface IAdminUserService
{
    Task<IReadOnlyList<AdminUserDto>> ListAsync(CancellationToken ct);
    Task<AdminUserResult> CreateAsync(AdminUserEntity actor, string email, string name, AdminRole role, AdminRequestInfo request, CancellationToken ct);
    Task<AdminUserResult> UpdateAsync(AdminUserEntity actor, string id, string name, AdminRole role, bool disabled, string? ip, CancellationToken ct);
    Task<AdminUserOutcome> InviteAsync(AdminUserEntity actor, string id, AdminRequestInfo request, CancellationToken ct);
    Task<AdminUserOutcome> RevokeSessionsAsync(AdminUserEntity actor, string id, string? ip, CancellationToken ct);
    Task<AdminUserOutcome> DeleteAsync(AdminUserEntity actor, string id, string? ip, CancellationToken ct);
}

// ── Audit ────────────────────────────────────────────────────────────────────────────────────────────────────────

public sealed record AuditEntryDto(
    string Id, DateTime At, string? AdminId, string? AdminEmail, string Action, string? TargetType, string? TargetId, string? Before, string? After, string? Ip);

public sealed record AuditPageDto(IReadOnlyList<AuditEntryDto> Items, string? PageToken);

public sealed record AuditQuery(string? AdminId, string? ActionPrefix, string? TargetType, string? PageToken, int Limit);

public interface IAuditLog
{
    /// <summary>before / after are serialized to a short JSON summary (secrets never passed in).</summary>
    Task WriteAsync(AdminUserEntity? actor, string action, string? targetType, string? targetId, object? before, object? after, string? ip, CancellationToken ct);
    Task<AuditPageDto> QueryAsync(AuditQuery query, CancellationToken ct);
}

// ── Settings (Parameter Store) ───────────────────────────────────────────────────────────────────────────────────

/// <summary>Read / write of SSM String parameters by full name. Tests use an in-memory store.</summary>
public interface ISettingsStore
{
    Task<string?> GetAsync(string name, CancellationToken ct);
    Task PutAsync(string name, string value, CancellationToken ct);
}

public sealed class SettingsUnavailableException(string message, Exception? inner = null) : Exception(message, inner);

public enum SettingWriteOutcome { Ok, NotFound, Invalid }

public sealed record SettingWriteResult(SettingWriteOutcome Outcome, SettingGroupDto? Group = null, IReadOnlyDictionary<string, string[]>? Errors = null);

public interface IAdminSettingsService
{
    Task<IReadOnlyList<SettingGroupDto>> GetAllAsync(CancellationToken ct);
    Task<SettingWriteResult> UpdateAsync(AdminUserEntity actor, string group, IReadOnlyDictionary<string, System.Text.Json.JsonElement> values, string? ip, CancellationToken ct);
}

// ── App users (support / moderation) ─────────────────────────────────────────────────────────────────────────────

/// <param name="AgeBand">Teen badge (docs/api/teen.md §10): adult | teen | null (age not given yet).</param>
public sealed record AdminAppUserSummaryDto(string Id, string TenantId, string? Email, string? DisplayName, string? Handle, DateTime CreatedAt, bool Suspended,
    AgeBand? AgeBand = null);

public sealed record AdminAppUserCounts(int Items, int Looks, int Trips, int Followers, int Following);

public sealed record AdminAppUserEntitlement(Tier Tier, EntitlementSource? Source, DateTime? ExpiresAt, DateTime? TestPremiumExpiresAt);

public sealed record AdminAppUserCredits(int AllowanceTotal, int AllowanceRemaining, int PackBalance);

public sealed record AdminAppUserRecognition(int Used, int Limit, bool Unlimited);

public sealed record AdminAppUserDevice(string DeviceId, string? Platform, DateTime UpdatedAt, bool PushEnabled);

public sealed record AdminAppUserDetailDto(
    string Id, string TenantId, string? Email, string? DisplayName, string? Handle, DateTime CreatedAt, string? Language, ClosetVisibility? ClosetVisibility,
    IReadOnlyList<string> Providers, bool Suspended, DateTime? SuspendedAt, string? SuspendReason,
    AdminAppUserCounts Counts, AdminAppUserEntitlement Entitlement, AdminAppUserCredits Credits, AdminAppUserRecognition ItemRecognition,
    IReadOnlyList<AdminAppUserDevice> Devices,
    // Teen mode (docs/api/teen.md §10): the band, and the parental consent status with its history (null when there never was one).
    AgeBand? AgeBand = null,
    AdminTeenDto? Teen = null);

public sealed record AdminAppUserPageDto(IReadOnlyList<AdminAppUserSummaryDto> Items, string? PageToken);

public interface IAdminAppUserService
{
    Task<AdminAppUserPageDto> SearchAsync(string? query, string? pageToken, int limit, CancellationToken ct);
    Task<AdminAppUserDetailDto?> GetAsync(string userId, CancellationToken ct);
    Task<AdminAppUserDetailDto?> SuspendAsync(AdminUserEntity actor, string userId, string reason, string? ip, CancellationToken ct);
    Task<AdminAppUserDetailDto?> UnsuspendAsync(AdminUserEntity actor, string userId, string? ip, CancellationToken ct);
    Task<bool> DeleteAsync(AdminUserEntity actor, string userId, string? ip, CancellationToken ct);
    Task<AdminAppUserDetailDto?> GrantTestPremiumAsync(AdminUserEntity actor, string userId, int days, string? note, string? ip, CancellationToken ct);
    Task<AdminAppUserDetailDto?> RevokeTestPremiumAsync(AdminUserEntity actor, string userId, string? ip, CancellationToken ct);
    Task<AdminAppUserDetailDto?> AddCreditsAsync(AdminUserEntity actor, string userId, int credits, string? note, string? ip, CancellationToken ct);
    /// <summary>Suspends the owner of a tenant (moderation "block"). False when the tenant has no user.</summary>
    Task<bool> SuspendTenantOwnerAsync(AdminUserEntity actor, string tenantId, string reason, string? ip, CancellationToken ct);
}

// ── Dashboard ────────────────────────────────────────────────────────────────────────────────────────────────────

public sealed record DashboardDto(DashboardUsers Users, DashboardCatalog Catalog, DashboardContent Content, DashboardModeration Moderation);
public sealed record DashboardUsers(int Total, int Last7Days, int Suspended);
public sealed record DashboardCatalog(int Brands, int Products, int ActiveProducts);
public sealed record DashboardContent(int Edits, int PublishedEdits, int Collections, int LibraryItems);
public sealed record DashboardModeration(int OpenReports);

public interface IAdminDashboardService
{
    Task<DashboardDto> GetAsync(CancellationToken ct);
}

// ── Library and catalog images ───────────────────────────────────────────────────────────────────────────────────

public sealed record LibraryItemInput(
    string Id, IReadOnlyDictionary<string, string>? Name, ItemCategory? Category, IReadOnlyList<string>? ColorIds, string? Fabric,
    IReadOnlyList<Season>? Seasons, string? ImageUrl, int SortOrder, bool Retired = false, CatalogSegment? Segment = null);

public sealed record AdminLibraryItemDto(
    string Id, IReadOnlyDictionary<string, string> Name, ItemCategory Category, IReadOnlyList<string> ColorIds, string? Fabric,
    IReadOnlyList<Season> Seasons, string? ImageUrl, int SortOrder, bool Retired, bool Stored,
    CatalogSegment Segment = CatalogSegment.Women, bool NeedsImage = false);

public interface IAdminLibraryService
{
    Task<IReadOnlyList<AdminLibraryItemDto>> ListAsync(CancellationToken ct);
    Task<LibraryItemEntity?> GetAsync(string id, CancellationToken ct);
    /// <summary>Validation errors keyed by field (empty = written).</summary>
    Task<(IReadOnlyDictionary<string, string[]> Errors, AdminLibraryItemDto? Item)> UpsertAsync(LibraryItemInput input, CancellationToken ct);
    Task<bool> RetireAsync(string id, CancellationToken ct);
}

public enum CatalogImagePurpose { Product, Brand, Edit, Collection, Library, Feed }

public sealed record CatalogImageUploadDto(string Url, IReadOnlyDictionary<string, string> Fields, string Key, string PublicUrl, DateTime ExpiresAt, long MaxBytes);

public interface ICatalogImageStorage
{
    /// <summary>Null when the bucket is not configured (503).</summary>
    Task<CatalogImageUploadDto?> CreateUploadAsync(CatalogImagePurpose purpose, string contentType, CancellationToken ct);
}
