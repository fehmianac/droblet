using Amazon.Lambda.AspNetCoreServer.Hosting;
using Api.Infrastructure.Extensions;
using Domain.Services;
using Infrastructure;
using Infrastructure.Configuration;
using Serilog;
using Serilog.Formatting.Compact;

namespace Api;

public class Entrypoint
{
    public static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        builder.Configuration.AddDrobletConfiguration();

        builder.Host.UseSerilog((context, logger) => logger
            .ReadFrom.Configuration(context.Configuration)
            .Enrich.FromLogContext()
            .WriteTo.Console(new CompactJsonFormatter()));

        builder.Services.AddAWSLambdaHosting(LambdaEventSource.HttpApi);
        builder.Services.AddApiCore();
        builder.Services.AddAdminAuthorization();
        builder.Services.AddDrobletCore(builder.Configuration);
        builder.Services.AddDrobletApiServices(builder.Configuration);
        builder.Services.AddDrobletAdmin(builder.Configuration);

        var app = builder.Build();

        app.UseExceptionHandler(errorApp => errorApp.Run(async context =>
        {
            var feature = context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>();
            var (status, code) = feature?.Error switch
            {
                ProviderNotConfiguredException => (StatusCodes.Status503ServiceUnavailable, Domain.Constant.ErrorCodes.ProviderNotConfigured),
                BadHttpRequestException => (StatusCodes.Status400BadRequest, Domain.Constant.ErrorCodes.ValidationFailed),
                _ => (StatusCodes.Status500InternalServerError, "internal_error"),
            };
            await ApiResults.Problem(status, code).ExecuteAsync(context);
        }));

        // CORS lives in the Api, not in API Gateway: admin routes answer only the panel origin (docs/api/admin.md).
        // The ANY /{proxy+} route forwards OPTIONS here; preflights end in UseDrobletCors with 204.
        app.UseDrobletCors();

        app.UseAuthentication();
        app.UseAuthorization();
        app.MapEndpointsCore([typeof(Entrypoint).Assembly]);

        app.Run();
    }
}
