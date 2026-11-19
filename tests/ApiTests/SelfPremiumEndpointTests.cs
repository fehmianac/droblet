using System.Net;
using System.Net.Http.Json;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace ApiTests;

/// <summary>The Api as on dev: Entitlements:SelfServePremium:Enabled = true.</summary>
public sealed class SelfPremiumApiFactory : ApiFactory
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Entitlements:SelfServePremium:Enabled", "true");
    }
}

public class SelfPremiumEndpointTests(SelfPremiumApiFactory factory) : IClassFixture<SelfPremiumApiFactory>
{
    private const string Url = "v1/tenant/entitlement/self-premium";

    private static async Task<EntitlementDto> Dto(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<EntitlementDto>(ApiFactory.Json))!;

    [Fact]
    public async Task Get_ShowsTheSwitch_AndThatTheAccountDoesNotHoldIt()
    {
        var (client, _) = await factory.RegisterAsync();

        var dto = (await client.GetFromJsonAsync<EntitlementDto>("v1/tenant/entitlement", ApiFactory.Json))!;

        Assert.Equal(Tier.Free, dto.Tier);
        Assert.Equal(new SelfServePremiumDto(true, false), dto.SelfServePremium);
    }

    [Fact]
    public async Task Grant_GivesPremiumAnd30Credits_IsIdempotent_Audited_ThenRevokeMakesItFreeAgain()
    {
        var (client, auth) = await factory.RegisterAsync();

        var granted = await client.PostAsync(Url, null);
        Assert.Equal(HttpStatusCode.OK, granted.StatusCode);
        var dto = await Dto(granted);
        Assert.Equal(Tier.Premium, dto.Tier);
        Assert.Equal("self_test", dto.ProductId);
        Assert.Equal(30, dto.Credits.MonthlyAllowance);
        Assert.Equal(30, dto.Credits.TotalRemaining);
        Assert.NotNull(dto.Credits.ResetsAt);
        Assert.Null(dto.ItemRecognition.Limit);   // members: unlimited recognitions
        Assert.Equal(new SelfServePremiumDto(true, true), dto.SelfServePremium);

        // The same grant as the admin test premium: an admin entitlement row, marked self_test, one month.
        var row = await factory.Repository.GetAsync<EntitlementEntity>(EntitlementEntity.GetPk(auth.TenantId), EntitlementEntity.GetSk(EntitlementSource.Admin, "self_test"));
        Assert.NotNull(row);
        Assert.Equal((Tier.Premium, "self_test"), (row!.Tier, row.ProductId));
        Assert.Equal(row.StartsAt.AddMonths(1), row.ExpiresAt);

        // A credit used, then a second tap: the month is not restarted.
        var credits = factory.Services.GetRequiredService<ICreditService>();
        await credits.ReserveAsync(auth.TenantId, "k1", "j1", default);
        var again = await Dto(await client.PostAsync(Url, null));
        Assert.Equal(29, again.Credits.AllowanceRemaining);
        Assert.Equal(row.StartsAt, (await factory.Repository.GetAsync<EntitlementEntity>(row.Pk, row.Sk))!.StartsAt);

        var audit = await factory.Repository.GetAllAsync<AdminAuditEntity>(AdminAuditEntity.GetPk());
        Assert.Single(audit, a => a.Action == "user.self_premium_grant" && a.TargetId == auth.UserId && a.AdminId == null);

        var revoked = await client.DeleteAsync(Url);
        Assert.Equal(HttpStatusCode.OK, revoked.StatusCode);
        var free = await Dto(revoked);
        Assert.Equal(Tier.Free, free.Tier);
        Assert.Equal(new SelfServePremiumDto(true, false), free.SelfServePremium);
        Assert.Contains(await factory.Repository.GetAllAsync<AdminAuditEntity>(AdminAuditEntity.GetPk()),
            a => a.Action == "user.self_premium_revoke" && a.TargetId == auth.UserId);
    }

    [Fact]
    public async Task StoreSubscription_TakesPrecedence_IsNeverReplaced_AndRevokeNeverTouchesIt()
    {
        var (client, auth) = await factory.RegisterAsync();
        var anchor = DateTime.UtcNow.AddDays(-3);
        var store = new EntitlementEntity
        {
            Id = "tx-store", TenantId = auth.TenantId, Tier = Tier.Premium, Source = EntitlementSource.Store, Platform = StorePlatform.Apple,
            ProductId = "com.alatech.droplet.premium.monthly", StartsAt = anchor, ExpiresAt = anchor.AddMonths(1), PeriodAnchor = anchor,
            State = StoreSubscriptionState.Active,
        };
        await factory.Repository.SaveAsync(store);

        var granted = await client.PostAsync(Url, null);
        Assert.Equal(HttpStatusCode.Conflict, granted.StatusCode);
        Assert.Equal("store_subscription_active", await granted.CodeAsync());

        var revoked = await Dto(await client.DeleteAsync(Url));
        Assert.Equal(Tier.Premium, revoked.Tier);
        Assert.Equal("com.alatech.droplet.premium.monthly", revoked.ProductId);
        Assert.NotNull(await factory.Repository.GetAsync<EntitlementEntity>(store.Pk, store.Sk));
    }

    [Fact]
    public async Task SelfGrantMadeBeforeAStorePurchase_TheStoreSubscriptionIsTheOneReported()
    {
        var (client, auth) = await factory.RegisterAsync();
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync(Url, null)).StatusCode);
        var anchor = DateTime.UtcNow.AddDays(-1);
        // Expires before the self grant would: the store row still wins at the same tier.
        await factory.Repository.SaveAsync(new EntitlementEntity
        {
            Id = "tx-later", TenantId = auth.TenantId, Tier = Tier.Premium, Source = EntitlementSource.Store, Platform = StorePlatform.Google,
            ProductId = "com.alatech.droplet.premium.monthly", StartsAt = anchor, ExpiresAt = anchor.AddDays(7), PeriodAnchor = anchor,
            State = StoreSubscriptionState.Active,
        });

        var dto = (await client.GetFromJsonAsync<EntitlementDto>("v1/tenant/entitlement", ApiFactory.Json))!;

        Assert.Equal(("com.alatech.droplet.premium.monthly", StorePlatform.Google), (dto.ProductId, dto.Platform));
        Assert.True(dto.SelfServePremium!.Active);
    }
}

public class SelfPremiumDisabledEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task SwitchedOff_BothEndpointsAre403_AndGetSaysDisabled()
    {
        var (client, auth) = await factory.RegisterAsync();

        var grant = await client.PostAsync("v1/tenant/entitlement/self-premium", null);
        var revoke = await client.DeleteAsync("v1/tenant/entitlement/self-premium");
        var dto = (await client.GetFromJsonAsync<EntitlementDto>("v1/tenant/entitlement", ApiFactory.Json))!;

        Assert.Equal(HttpStatusCode.Forbidden, grant.StatusCode);
        Assert.Equal("self_premium_disabled", await grant.CodeAsync());
        Assert.Equal(HttpStatusCode.Forbidden, revoke.StatusCode);
        Assert.Equal("self_premium_disabled", await revoke.CodeAsync());
        Assert.Equal(Tier.Free, dto.Tier);
        Assert.Equal(new SelfServePremiumDto(false, false), dto.SelfServePremium);
        Assert.Empty(await factory.Repository.GetAllAsync<EntitlementEntity>(EntitlementEntity.GetPk(auth.TenantId)));
    }
}
