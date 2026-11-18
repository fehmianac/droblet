using Amazon.Extensions.Configuration.SystemsManager;
using Microsoft.Extensions.Configuration;

namespace Infrastructure.Configuration;

public static class SsmConfigurationExtensions
{
    /// <summary>
    /// Loads /droblet/{stage}/{api|worker|notifier} from SSM when SYSTEMS_MANAGER_PATH is set (parameter name =
    /// config section, value = JSON). Lambda env vars (TABLE_NAME, PHOTO_BUCKET, *_QUEUE_URL) are mapped to sections.
    /// Values are re-read every 60 s so kill switches and limits apply without a cold start.
    /// </summary>
    public static IConfigurationBuilder AddDrobletConfiguration(this IConfigurationBuilder builder)
    {
        builder.AddInMemoryCollection(EnvironmentMappings());

        var path = Environment.GetEnvironmentVariable("SYSTEMS_MANAGER_PATH");
        if (!string.IsNullOrWhiteSpace(path))
        {
            builder.AddSystemsManager(source =>
            {
                source.Path = path;
                source.Optional = false;
                source.ParameterProcessor = new JsonOrStringParameterProcessor();
                source.ReloadAfter = TimeSpan.FromSeconds(60);
            });
        }

        return builder;
    }

    private static Dictionary<string, string?> EnvironmentMappings()
    {
        var map = new Dictionary<string, string?>();
        void Map(string env, string key)
        {
            var value = Environment.GetEnvironmentVariable(env);
            if (!string.IsNullOrWhiteSpace(value))
                map[key] = value;
        }

        Map("PHOTO_BUCKET", "Photos:Bucket");
        Map("ITEM_PROCESSOR_REQUEST_QUEUE_URL", "Queues:ItemProcessRequest");
        Map("ITEM_PROCESS_REQUEST_QUEUE_URL", "Queues:ItemProcessRequest");
        Map("STYLIST_REQUEST_QUEUE_URL", "Queues:StylistRequest");
        Map("TRYON_REQUEST_QUEUE_URL", "Queues:TryOnRequest");
        Map("PALETTE_REQUEST_QUEUE_URL", "Queues:PaletteRequest");
        Map("CATALOG_IMAGE_BUCKET", "CatalogImages:Bucket");
        Map("CATALOG_IMAGE_BASE_URL", "CatalogImages:PublicBaseUrl");
        return map;
    }
}
