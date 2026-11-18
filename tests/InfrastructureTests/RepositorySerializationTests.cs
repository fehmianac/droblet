using Domain.Entity;
using Domain.Enum;
using Infrastructure;

namespace InfrastructureTests;

public class RepositorySerializationTests
{
    [Fact]
    public void ToItem_WritesKeysEnumsByNameAndTtl()
    {
        var job = new JobEntity { Id = "j1", TenantId = "t1", Kind = JobKind.TryOn, Status = JobStatus.Queued, CreatedAt = Fixtures.Now, UpdatedAt = Fixtures.Now };

        var item = Repository.ToItem(job);

        Assert.Equal("tenant#t1#job", item["pk"].S);
        Assert.Equal("j1", item["sk"].S);
        Assert.Equal("TryOn", item["kind"].S);
        Assert.Equal("Queued", item["status"].S);
        Assert.False(string.IsNullOrEmpty(item["ttl"].N));
        Assert.False(item.ContainsKey("failure")); // nulls are not written
    }

    [Fact]
    public void Retention_UnconvertedClick13Months_ConvertedKept_ResolvedReport2Years_OpenReportKept()
    {
        var click = new AffiliateClickEntity { ClickId = "c1", TenantId = "t1", BrandId = "b1", CreatedAt = Fixtures.Now };
        var index = new AffiliateClickIndexEntity { ClickId = "c1", TenantId = "t1", CreatedAt = Fixtures.Now };
        var open = new ReportEntity { Id = "r1", Status = ReportStatus.Open, TargetTenantId = "t2", CreatedAt = Fixtures.Now };
        var resolved = new ReportEntity { Id = "r1", Status = ReportStatus.Resolved, TargetTenantId = "t2", CreatedAt = Fixtures.Now, ResolvedAt = Fixtures.Now.AddDays(3) };
        var pointer = new ReportReceivedEntity { TenantId = "t2", ReportId = "r1", CreatedAt = Fixtures.Now, ResolvedAt = resolved.ResolvedAt };

        Assert.Equal(Domain.Extensions.DateTimeExtensions.ToUnixTimeSeconds(Fixtures.Now.AddMonths(13)).ToString(System.Globalization.CultureInfo.InvariantCulture), Repository.ToItem(click)["ttl"].N);
        Assert.Equal(Repository.ToItem(click)["ttl"].N, Repository.ToItem(index)["ttl"].N);
        click.ConvertedAt = index.ConvertedAt = Fixtures.Now.AddDays(1);
        Assert.False(Repository.ToItem(click).ContainsKey("ttl"));
        Assert.False(Repository.ToItem(index).ContainsKey("ttl"));

        Assert.False(Repository.ToItem(open).ContainsKey("ttl"));
        var expires = Domain.Extensions.DateTimeExtensions.ToUnixTimeSeconds(Fixtures.Now.AddDays(3).AddYears(2)).ToString(System.Globalization.CultureInfo.InvariantCulture);
        Assert.Equal(expires, Repository.ToItem(resolved)["ttl"].N);
        Assert.Equal(expires, Repository.ToItem(pointer)["ttl"].N);
        Assert.False(Repository.ToItem(new ReportFiledEntity { TenantId = "t1", ReportId = "r1", CreatedAt = Fixtures.Now }).ContainsKey("ttl"));
    }

    [Fact]
    public void RoundTrip_PreservesVersionedEntity()
    {
        var style = new StyleProfileEntity
        {
            TenantId = "t1",
            Segment = Segment.Women,
            StyleTags = [StyleTag.Minimal, StyleTag.Classic, StyleTag.QuietLuxury],
            Budget = Budget.Mixed,
            UpdatedAt = Fixtures.Now,
            Version = 4,
        };

        var back = Repository.FromItem<StyleProfileEntity>(Repository.ToItem(style));

        Assert.Equal(style.StyleTags, back.StyleTags);
        Assert.Equal(4, back.Version);
        Assert.Equal(Budget.Mixed, back.Budget);
        Assert.Equal(Fixtures.Now, back.UpdatedAt.ToUniversalTime());
    }

    [Fact]
    public void RoundTrip_DecimalWeightAndNullableFields()
    {
        var body = new BodyProfileEntity { TenantId = "t1", HeightCm = 168, WeightKg = 58.5m, Size = ClothingSize.M, Version = 1 };

        var back = Repository.FromItem<BodyProfileEntity>(Repository.ToItem(body));

        Assert.Equal(58.5m, back.WeightKg);
        Assert.Equal(ClothingSize.M, back.Size);
    }
}
