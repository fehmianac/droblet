namespace Domain.Context;

public interface IApiContext
{
    public string TenantId { get; }
    public string UserId { get; }
}
