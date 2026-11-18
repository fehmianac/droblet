using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Context;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Notification;

// The in-app notification inbox (Bildirimler). Filled by the Notifier from the same events it pushes; kept 90 days.

public class GetAll : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? pageToken,
        [FromQuery] int? limit,
        [FromServices] IApiContext apiContext,
        [FromServices] INotificationInbox inbox,
        CancellationToken cancellationToken) =>
        Results.Ok(await inbox.GetPageAsync(apiContext.TenantId, pageToken, limit ?? 0, cancellationToken));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/tenant/notification", Handler)
            .Produces<InboxPageDto>(StatusCodes.Status200OK)
            .Tenant("Tenant Notification", "My notifications",
                "Newest first, 90 days. limit 1–100 (default 30); pageToken = the previous page's pageToken (null = last page). " +
                "type = morning_outfit | weekly_edit | friend_ratings | price_drop | follow_request; data holds ids only (day, editId, productId, handle) — " +
                "the app writes the sentence. unreadCount covers the whole inbox (the bell badge).");
}

public sealed record MarkNotificationsReadRequest(IReadOnlyList<string>? Ids);

public class MarkNotificationsReadRequestValidator : AbstractValidator<MarkNotificationsReadRequest>
{
    public MarkNotificationsReadRequestValidator()
    {
        RuleFor(x => x.Ids).Must(ids => ids is null || ids.Count is > 0 and <= 100).WithErrorCode("ids_out_of_range");
        RuleForEach(x => x.Ids).Must(Domain.Extensions.Ulid.IsValid).WithErrorCode("id_invalid");
    }
}

public class PostRead : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] MarkNotificationsReadRequest request,
        [FromServices] IValidator<MarkNotificationsReadRequest> validator,
        [FromServices] IApiContext apiContext,
        [FromServices] INotificationInbox inbox,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());
        return Results.Ok(await inbox.MarkReadAsync(apiContext.TenantId, request.Ids, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/tenant/notification/read", Handler)
            .Produces<InboxReadResultDto>(StatusCodes.Status200OK)
            .Validated()
            .Tenant("Tenant Notification", "Mark notifications read",
                "ids = up to 100 notification ids; null marks everything read. Idempotent; unknown ids are ignored. Returns the unread count left.");
}
