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
