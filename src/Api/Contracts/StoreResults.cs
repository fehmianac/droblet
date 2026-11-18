using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Contracts;

public record PostbackResponse(PostbackOutcome Outcome);

public record ReportCreatedResponse(string ReportId);

/// <summary>Service outcome → HTTP result, shared by the store and social endpoints so codes stay consistent.</summary>
public static class StoreResults
{
    public static IResult BadQuery() => ApiResults.Problem(StatusCodes.Status400BadRequest, ErrorCodes.ValidationFailed);

    public static IResult NotFound(string code = ErrorCodes.NotFound) => ApiResults.Problem(StatusCodes.Status404NotFound, code);

    public static IResult Checkout(CheckoutResult result) => result.Outcome switch
    {
        CheckoutOutcome.Ok => Results.Ok(result.Checkout),
        CheckoutOutcome.CartEmpty => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, StoreSocialErrorCodes.CartEmpty),
        CheckoutOutcome.BrandNotFound => NotFound(StoreSocialErrorCodes.BrandNotFound),
        CheckoutOutcome.ProductNotFound => NotFound(StoreSocialErrorCodes.ProductNotFound),
        CheckoutOutcome.ProductRetired => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, StoreSocialErrorCodes.ProductRetired),
        _ => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, StoreSocialErrorCodes.AffiliateLinkMissing),
    };

    public static IResult? CartError(CartOutcome outcome) => outcome switch
    {
        CartOutcome.Ok => null,
        CartOutcome.ProductNotFound => NotFound(StoreSocialErrorCodes.ProductNotFound),
        CartOutcome.ProductRetired => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, StoreSocialErrorCodes.ProductRetired),
        CartOutcome.SizeNotAvailable => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, StoreSocialErrorCodes.SizeNotAvailable),
        CartOutcome.CartFull => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, StoreSocialErrorCodes.CartFull),
        CartOutcome.WatchListFull => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, StoreSocialErrorCodes.WatchListFull),
        CartOutcome.FavoriteListFull => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, StoreSocialErrorCodes.FavoriteListFull),
        _ => NotFound(),
    };

    /// <summary>Null = success. A refused cross-tenant read or write is a plain 404 — never "forbidden".</summary>
    public static IResult? SocialError(SocialOutcome outcome) => outcome switch
    {
        SocialOutcome.Ok => null,
        SocialOutcome.Self => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, StoreSocialErrorCodes.CannotTargetSelf),
        SocialOutcome.LimitReached => ApiResults.Problem(StatusCodes.Status422UnprocessableEntity, StoreSocialErrorCodes.FollowLimitReached),
        SocialOutcome.RateLimited => ApiResults.Problem(StatusCodes.Status429TooManyRequests, ErrorCodes.TooManyAttempts),
        _ => NotFound(),
    };

    /// <summary>422 product_not_found with the unknown ids in "productIds".</summary>
    public static IResult MissingProducts(IReadOnlyList<string> productIds) => TypedResults.Problem(new ProblemDetails
    {
        Status = StatusCodes.Status422UnprocessableEntity,
        Title = StoreSocialErrorCodes.ProductNotFound,
        Type = $"https://droblet.alatech.co/errors/{StoreSocialErrorCodes.ProductNotFound}",
        Extensions = { ["code"] = StoreSocialErrorCodes.ProductNotFound, ["productIds"] = productIds },
    });
}
