using System.Text.Json;
using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Entity;
using Domain.Enum;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Domain.Validation;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Api.Endpoints.V1.Affiliate.Postback;

public class Post : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string source,
        HttpContext httpContext,
        [FromServices] IAffiliateService affiliate,
        [FromServices] IValidator<PostbackRequest> validator,
        [FromServices] IOptionsMonitor<AffiliatePostbackOptions> options,
        [FromServices] IOptions<Microsoft.AspNetCore.Http.Json.JsonOptions> jsonOptions,
        CancellationToken cancellationToken)
    {

        if (!QueryParsing.TryEnum<AffiliateSource>(source, out var parsedSource) || parsedSource is not { } affiliateSource)
            return StoreResults.NotFound();
        if (httpContext.Request.ContentLength is > PostbackLimits.MaxBodyBytes)
            return StoreResults.BadQuery();

        // The signature covers the exact bytes received, so the body is read raw.
        using var buffer = new MemoryStream();
        await httpContext.Request.Body.CopyToAsync(buffer, cancellationToken);
        if (buffer.Length is 0 or > PostbackLimits.MaxBodyBytes)
            return StoreResults.BadQuery();
        var bytes = buffer.ToArray();

        PostbackRequest? request;
        try
        {
            request = JsonSerializer.Deserialize<PostbackRequest>(bytes, jsonOptions.Value.SerializerOptions);
        }
        catch (JsonException)
        {
            return StoreResults.BadQuery();
        }
        if (request is null)
            return StoreResults.BadQuery();
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var brandId = affiliateSource == AffiliateSource.Direct ? await affiliate.BrandOfClickAsync(request.ClickId, cancellationToken) : null;
        var secret = PostbackSignature.SecretFor(options.CurrentValue, affiliateSource, brandId);
        if (string.IsNullOrEmpty(secret))
            return ApiResults.Problem(StatusCodes.Status503ServiceUnavailable, ErrorCodes.ProviderNotConfigured);
        if (!PostbackSignature.Verify(secret, bytes, httpContext.Request.Headers[PostbackSignature.Header].ToString()))
            return ApiResults.Problem(StatusCodes.Status401Unauthorized, StoreSocialErrorCodes.InvalidSignature);

        var outcome = await affiliate.RecordConversionAsync(affiliateSource, request.ToInput(), cancellationToken);
        return outcome == PostbackOutcome.ClickNotFound
            ? StoreResults.NotFound(StoreSocialErrorCodes.ClickNotFound)
            : Results.Ok(new PostbackResponse(outcome));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/affiliate/postback/{source}", Handler)
            .Produces<PostbackResponse>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status401Unauthorized)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status503ServiceUnavailable)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .AllowAnonymous()
            .WithSummary("Conversion postback (network or direct brand)")
            .WithDescription("source = network | direct. Header X-Droblet-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>. Idempotent by (source, orderId): a repeat is \"duplicate\", a new status or amount is \"updated\". Records amount + commission against the click (user, look).")
            .WithTags("Affiliate");
    }
}

public static class PostbackLimits
{
    public const int MaxBodyBytes = 16 * 1024;
}
