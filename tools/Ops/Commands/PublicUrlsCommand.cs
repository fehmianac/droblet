using Amazon.SimpleSystemsManagement;
using Amazon.SimpleSystemsManagement.Model;

namespace Ops.Commands;

/// <summary>
/// public-urls [--enable | --disable]: shows or switches /droblet/{stage}/api/Photos/PublicUrlsEnabled — whether item DTOs
/// carry the public (CDN or direct S3) addresses of cleaned piece images or presigned ones. Dev only.
/// </summary>
internal static class PublicUrlsCommand
{
    public static async Task<int> RunAsync(OpsArguments args, OpsOutput output, CancellationToken ct)
    {
        using var ssm = new AmazonSimpleSystemsManagementClient();
        var name = $"/droblet/{args.Stage}/api/Photos/PublicUrlsEnabled";
        var current = (await ssm.GetParameterAsync(new GetParameterRequest { Name = name }, ct)).Parameter.Value;
        output.Line($"{name} = {current}");
        var target = args.Flag("enable") ? "true" : args.Flag("disable") ? "false" : null;
        if (target is null || target == current)
            return 0;
        await ssm.PutParameterAsync(new PutParameterRequest { Name = name, Value = target, Type = ParameterType.String, Overwrite = true }, ct);
        output.Line($"{name} set to {target} (the Api reloads SSM within about a minute)");
        output.Summary($"`{name}`: {current} → {target}");
        return 0;
    }
}
