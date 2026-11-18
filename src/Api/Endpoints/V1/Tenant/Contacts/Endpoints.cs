using Domain.Enum;
using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Contacts;

// Decision 13 — "Rehberden arkadaş bul". docs/privacy/contacts-matching.md describes what is sent and kept (nothing).

public class PostSalt : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IApiContext apiContext, [FromServices] IContactMatchService contacts, CancellationToken cancellationToken) =>
        Results.Ok(await contacts.IssueSaltAsync(apiContext.TenantId, cancellationToken));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/tenant/contacts/salt", Handler)
            .RequireConsent(ConsentRules.Contacts)
            .Produces<ContactSaltDto>(StatusCodes.Status200OK)
            .Tenant("Tenant Social", "Get a contact-matching salt",
                "Single-use salt for one matching request (10 minutes). The app hashes e-mail addresses on the device with it; raw contacts never leave the device.");
}

public sealed record ContactMatchRequest(string SaltId, IReadOnlyList<ContactHashInput>? Hashes);

public class ContactMatchRequestValidator : AbstractValidator<ContactMatchRequest>
{
    public ContactMatchRequestValidator(Microsoft.Extensions.Options.IOptionsMonitor<Domain.Options.SocialOptions> options)
    {
        RuleFor(x => x.SaltId).NotEmpty().WithErrorCode(StoreSocialErrorCodes.ContactSaltNotFound);
        RuleFor(x => x.Hashes).Must(h => h is { Count: > 0 } && h.Count <= Math.Clamp(options.CurrentValue.ContactMatchMaxHashes, 1, 5000))
            .WithErrorCode(StoreSocialErrorCodes.HashesOutOfRange);
        RuleForEach(x => x.Hashes).Must(h => h is not null && ContactHashRules.IsValidPrefix(h.P) && ContactHashRules.IsValidHash(h.H))
            .WithErrorCode(StoreSocialErrorCodes.HashInvalid);
    }
}

public class PostMatch : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] ContactMatchRequest request,
        [FromServices] IValidator<ContactMatchRequest> validator,
        [FromServices] IApiContext apiContext,
        [FromServices] IContactMatchService contacts,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        var (outcome, result) = await contacts.MatchAsync(apiContext.TenantId, request.SaltId, request.Hashes!, cancellationToken);
        return outcome switch
        {
            ContactMatchOutcome.Ok => Results.Ok(result),
            ContactMatchOutcome.RateLimited => ApiResults.Problem(StatusCodes.Status429TooManyRequests, ErrorCodes.TooManyAttempts),
            _ => ApiResults.Problem(StatusCodes.Status404NotFound, StoreSocialErrorCodes.ContactSaltNotFound),
        };
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/tenant/contacts/match", Handler)
            .RequireConsent(ConsentRules.Contacts)
            .Produces<ContactMatchesDto>(StatusCodes.Status200OK)
            .Validated()
            .Problems(StatusCodes.Status404NotFound, StatusCodes.Status429TooManyRequests)
            .Tenant("Tenant Social", "Find friends from contacts",
                "Salted SHA-256 hashes of normalised e-mail addresses (1–1000) are compared with members' verified e-mails; returns the profile cards the caller may see " +
                "(visibility and blocks apply). Nothing of the upload is stored or logged. 404 contact_salt_not_found (unknown, used or expired salt), 429 too_many_attempts.");
}
