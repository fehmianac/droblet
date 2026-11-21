using Domain.Entity;
using Domain.Enum;
using Domain.Services;
using Infrastructure.Services;
using Microsoft.Extensions.DependencyInjection;
using Tests.Shared;

namespace NotifierTests;

/// <summary>The daily teen run (docs/api/teen.md §7–§8): turning 18, photo retention after inactivity, request expiry.</summary>
public class TeenMaintenanceTests
{
    private static readonly DateTime Now = WorkerTestHost.Now;   // 2026-11-18

    private static WorkerTestHost Host() => new(s =>
    {
        s.AddSingleton<IPhotoService, PhotoService>();
        s.AddSingleton<ITeenMaintenance, TeenMaintenance>();
    });

    private static async Task<UserEntity> TeenAsync(WorkerTestHost host, string id, int birthYear, int? birthMonth, DateTime lastActive,
        ParentalConsentEntity? consent = null)
    {
        var user = new UserEntity { Id = $"u{id}", TenantId = $"t{id}", AgeBand = AgeBand.Teen, BirthYear = birthYear, BirthMonth = birthMonth, CreatedAt = Now.AddYears(-1) };
        await host.Repository.SaveAsync(user);
        await host.Repository.SaveAsync(new TenantEntity { Id = user.TenantId, OwnerUserId = user.Id, AgeBand = AgeBand.Teen, ClosetVisibility = ClosetVisibility.Private, Version = 1 });
        await host.Repository.SaveAsync(new TeenAccountIndexEntity
        {
            TenantId = user.TenantId, UserId = user.Id, AdultFrom = AgeRules.AdultFrom(birthYear, birthMonth).ToString("yyyy-MM-dd"), LastActiveAt = lastActive, CreatedAt = Now.AddYears(-1),
        });
        await host.Repository.SaveAsync(consent ?? new ParentalConsentEntity { TenantId = user.TenantId, UserId = user.Id, Status = ParentalConsentStatus.Active });
        return user;
    }

    [Fact]
    public async Task TurningEighteen_ConvertsToAdult_EndsTheParentalLink_Notifies()
    {
        var host = Host();
        // Born October 2008: 18 from 1 November 2026.
        var user = await TeenAsync(host, "1", 2008, 10, Now, new ParentalConsentEntity
        {
            TenantId = "t1", UserId = "u1", Status = ParentalConsentStatus.Active, ParentEmail = "parent@example.com", ParentAllowedTryOn = true, TokenHashes = ["h1"],
        });
        await host.Repository.SaveAsync(new ParentalConsentTokenEntity { TokenHash = "h1", Kind = ParentalTokenKind.Manage, TenantId = "t1", UserId = "u1", ExpiresAt = Now.AddDays(10) });
        // Born 2009 (year only): still a teen until 1 January 2028.
        await TeenAsync(host, "2", 2009, null, Now);

        var result = await host.Get<ITeenMaintenance>().RunAsync(Now, default);

        Assert.Equal((2, 1), (result.Teens, result.BecameAdult));
        var adult = (await host.Repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk(user.Id)))!;
        Assert.Equal(AgeBand.Adult, adult.AgeBand);
        Assert.Null(adult.BirthYear);   // no longer needed
        Assert.Equal(AgeBand.Adult, (await host.Repository.GetAsync<TenantEntity>(TenantEntity.GetPk(), TenantEntity.GetSk("t1")))!.AgeBand);
        Assert.Null(await host.Repository.GetAsync<TeenAccountIndexEntity>(TeenAccountIndexEntity.GetPk(), TeenAccountIndexEntity.GetSk("t1")));
        Assert.Null(await host.Repository.GetAsync<ParentalConsentTokenEntity>(ParentalConsentTokenEntity.GetPk(), ParentalConsentTokenEntity.GetSk("h1")));
        var consent = (await host.Repository.GetAsync<ParentalConsentEntity>(ParentalConsentEntity.GetPk("t1"), ParentalConsentEntity.GetSk()))!;
        Assert.Null(consent.ParentEmail);
        Assert.False(consent.ParentAllowedTryOn);
        Assert.Contains(await host.Repository.GetAllAsync<ParentalConsentEventEntity>(ParentalConsentEventEntity.GetPk("t1")), e => e.Event == ParentalConsentEvent.Ended);
        Assert.Contains(await host.Repository.GetAllAsync<NotificationInboxEntity>(NotificationInboxEntity.GetPk("t1")), n => n.Type == NotificationType.TeenBecameAdult);
        Assert.Equal(AgeBand.Teen, (await host.Repository.GetAsync<UserEntity>(UserEntity.GetPk(), UserEntity.GetSk("u2")))!.AgeBand);
    }

    [Fact]
    public async Task Retention_DeletesThePersonalPhotos_AfterNinetyInactiveDays_OncePerInactiveSpell()
    {
        var host = Host();
        await TeenAsync(host, "3", 2009, null, Now.AddDays(-91));
        await TeenAsync(host, "4", 2009, null, Now.AddDays(-30));
        var stale = await host.AddPhotoAsync("t3", PhotoKind.Body);
        var active = await host.AddPhotoAsync("t4", PhotoKind.Face);

        var first = await host.Get<ITeenMaintenance>().RunAsync(Now, default);
        var second = await host.Get<ITeenMaintenance>().RunAsync(Now.AddDays(1), default);

        Assert.Equal(1, first.PhotosPurged);
        Assert.Equal(0, second.PhotosPurged);
        Assert.Empty(await host.Repository.GetAllAsync<PhotoEntity>(PhotoEntity.GetPk("t3")));
        Assert.Single(await host.Repository.GetAllAsync<PhotoEntity>(PhotoEntity.GetPk("t4")));
        Assert.Contains(host.Storage.DeletedPrefixes, p => p.StartsWith("tenant/t3/", StringComparison.Ordinal));
        Assert.NotNull((await host.Repository.GetAsync<TeenAccountIndexEntity>(TeenAccountIndexEntity.GetPk(), TeenAccountIndexEntity.GetSk("t3")))!.PhotosPurgedAt);
        Assert.NotNull(stale);
        Assert.NotNull(active);
    }

    [Fact]
    public async Task ExpiredRequest_IsRecordedOnce()
    {
        var host = Host();
        await TeenAsync(host, "5", 2009, null, Now, new ParentalConsentEntity
        {
            TenantId = "t5", UserId = "u5", Status = ParentalConsentStatus.PendingParentalConsent, RequestId = "r1",
            RequestSentAt = Now.AddDays(-8), RequestExpiresAt = Now.AddDays(-1),
        });

        Assert.Equal(1, (await host.Get<ITeenMaintenance>().RunAsync(Now, default)).RequestsExpired);
        Assert.Equal(0, (await host.Get<ITeenMaintenance>().RunAsync(Now.AddDays(1), default)).RequestsExpired);
        Assert.Single(await host.Repository.GetAllAsync<ParentalConsentEventEntity>(ParentalConsentEventEntity.GetPk("t5")), e => e.Event == ParentalConsentEvent.Expired);
    }
}
