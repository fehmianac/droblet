using Infrastructure;
using Infrastructure.Services.Maintenance;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace InfrastructureTests;

/// <summary>Every singleton the core registers can be built without a worker's own extras (the Api crashed at start-up once).</summary>
public class HostWiringTests
{
    [Fact]
    public void TheCoreAlone_ResolvesTheMaintenanceJob_WithTheStandInThumbnailer()
    {
        Environment.SetEnvironmentVariable("AWS_REGION", "eu-central-1");
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["AWS_REGION"] = "eu-central-1",
        }).Build();
        var services = new ServiceCollection().AddLogging();
        services.AddDrobletCore(configuration);
        using var provider = services.BuildServiceProvider();

        Assert.NotNull(provider.GetRequiredService<PublishItemImagesJob>());
        Assert.IsType<UnavailableImageThumbnailer>(provider.GetRequiredService<Domain.Services.IImageThumbnailer>());
    }
}
