using Api.Contracts;
using Api.Infrastructure.Contract;
using Domain.Constant;
using Domain.Context;
using Domain.Entity;
using Domain.Manager;
using Domain.Services;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Profile;

/// <summary>Live check of the profile edit screen. The claim itself stays PUT v1/tenant/profile/handle (the only authority).</summary>
public sealed record HandleAvailabilityDto(string Handle, bool Available, string? Code);

public class GetHandleAvailability : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? handle,
        [FromServices] IApiContext apiContext,
        [FromServices] IRepository repository,
        CancellationToken cancellationToken)
    {
        var normalized = HandleRules.Normalize(handle ?? "");
        if (!HandleRules.IsValidFormat(normalized))
            return Results.Ok(new HandleAvailabilityDto(normalized, false, "handle_invalid"));
        if (HandleRules.IsReserved(normalized))
            return Results.Ok(new HandleAvailabilityDto(normalized, false, ErrorCodes.HandleReserved));

        var entry = await repository.GetAsync<HandleEntity>(HandleEntity.GetPk(), HandleEntity.GetSk(normalized), cancellationToken);
        var available = entry is null || entry.TenantId == apiContext.TenantId;
        return Results.Ok(new HandleAvailabilityDto(normalized, available, available ? null : ErrorCodes.HandleTaken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/tenant/profile/handle/availability", Handler)
            .Produces<HandleAvailabilityDto>(StatusCodes.Status200OK)
            .Tenant("Tenant Profile", "Check an @handle",
                "Always 200: available true/false with code handle_invalid | handle_reserved | handle_taken. The caller's own handle is available. " +
                "A free handle can still be taken before the PUT — the PUT decides.");
}
