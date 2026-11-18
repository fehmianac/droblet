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

public class GetNetwork : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? clickId,
        [FromQuery] string? orderId,
        [FromQuery] long? amountMinor,
        [FromQuery] string? currency,
        [FromQuery] string? status,
        [FromQuery] string? key,
        [FromServices] IAffiliateService affiliate,
        [FromServices] IValidator<PostbackRequest> validator,
        [FromServices] IOptionsMonitor<AffiliatePostbackOptions> options,
        CancellationToken cancellationToken)
    {

        if (!QueryParsing.TryEnum<AffiliateConversionStatus>(status, out var parsedStatus) || clickId is null || orderId is null || amountMinor is null)
            return StoreResults.BadQuery();

        var request = new PostbackRequest(clickId, orderId, amountMinor.Value, currency, parsedStatus ?? AffiliateConversionStatus.Pending);
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var secret = options.CurrentValue.NetworkSecret;
        if (string.IsNullOrEmpty(secret))
            return ApiResults.Problem(StatusCodes.Status503ServiceUnavailable, ErrorCodes.ProviderNotConfigured);
        if (!PostbackSignature.VerifySharedKey(secret, key))
            return ApiResults.Problem(StatusCodes.Status401Unauthorized, StoreSocialErrorCodes.InvalidSignature);

        var outcome = await affiliate.RecordConversionAsync(AffiliateSource.Network, request.ToInput(), cancellationToken);
        return outcome == PostbackOutcome.ClickNotFound
            ? StoreResults.NotFound(StoreSocialErrorCodes.ClickNotFound)
            : Results.Ok(new PostbackResponse(outcome));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/affiliate/postback/network", Handler)
            .Produces<PostbackResponse>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status401Unauthorized)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .Produces<ProblemDetails>(StatusCodes.Status503ServiceUnavailable)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .AllowAnonymous()
            .WithSummary("Conversion postback (network, GET variant)")
            .WithDescription("For affiliate networks that can only call a URL: ?clickId=&orderId=&amountMinor=&currency=&status=&key=<shared secret>. Same idempotency as the POST variant.")
            .WithTags("Affiliate");
    }
}
