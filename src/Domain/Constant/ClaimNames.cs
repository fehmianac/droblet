namespace Domain.Constant;

public static class ClaimNames
{
    public const string Subject = "sub";
    public const string TenantId = "tid";
    public const string TokenId = "jti";
    /// <summary>"admin" on admin panel tokens (docs/api/admin.md). App tokens carry no token_use claim.</summary>
    public const string TokenType = "token_use";
    public const string IssuedAt = "iat";

    public const string TenantUserPolicy = "TenantUserJwt";
    public const string AdminScheme = "AdminBearer";
}
