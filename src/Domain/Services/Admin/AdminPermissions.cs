using Domain.Enum;

namespace Domain.Services.Admin;

/// <summary>
/// Role → permission matrix of the admin panel (owner decision 2). The server checks one permission per admin route;
/// the panel only hides what the role cannot use. docs/api/admin.md §2 mirrors this table.
/// </summary>
public static class AdminPermissions
{
    public const string DashboardView = "dashboard.view";
    public const string AnalyticsView = "analytics.view";
    public const string CatalogManage = "catalog.manage";
    public const string ContentManage = "content.manage";
    public const string UsersRead = "users.read";
    public const string UsersSuspend = "users.suspend";
    public const string UsersDelete = "users.delete";
    public const string UsersGrant = "users.grant";
    public const string ModerationManage = "moderation.manage";
    public const string SettingsManage = "settings.manage";
    public const string AdminsManage = "admins.manage";
    public const string AuditView = "audit.view";

    /// <summary>Uploading an image: catalog or content editors.</summary>
    public const string ImageUpload = "image.upload";

    public static readonly IReadOnlyList<string> All =
    [
        DashboardView, AnalyticsView, CatalogManage, ContentManage, UsersRead, UsersSuspend, UsersDelete, UsersGrant,
        ModerationManage, SettingsManage, AdminsManage, AuditView, ImageUpload,
    ];

    private static readonly IReadOnlyDictionary<AdminRole, HashSet<string>> Matrix = new Dictionary<AdminRole, HashSet<string>>
    {
        [AdminRole.SuperAdmin] = [.. All],
        [AdminRole.ContentEditor] = [DashboardView, AnalyticsView, CatalogManage, ContentManage, ImageUpload],
        [AdminRole.Moderator] = [DashboardView, UsersRead, UsersSuspend, ModerationManage],
    };

    public static bool Has(AdminRole role, string permission) =>
        Matrix.TryGetValue(role, out var permissions) && permissions.Contains(permission);

    public static IReadOnlyList<string> Of(AdminRole role) =>
        Matrix.TryGetValue(role, out var permissions) ? All.Where(permissions.Contains).ToList() : [];
}
