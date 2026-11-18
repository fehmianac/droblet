using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Context;
using Domain.Domain;
using Domain.Enum;
using Domain.Services;
using FluentValidation;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Tenant.Item;

public class PostUploadUrl : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] ItemUploadsCommand request,
        [FromServices] IApiContext apiContext,
        [FromServices] IWardrobeService wardrobe,
        [FromServices] IValidator<ItemUploadsCommand> validator,
        CancellationToken cancellationToken)
    {
        var validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
            return Results.BadRequest(validation.Errors.ToProblemDetails());

        return Results.Ok(await wardrobe.CreateUploadsAsync(apiContext.TenantId, request, cancellationToken));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/item/upload-url", Handler)
            .Produces<ItemUploadsDto>(StatusCodes.Status200OK)
            .Validated()
            .Tenant("Tenant Item", "Get presigned uploads for garment photos", "count presigned POSTs (multipart form: all fields first, then file) into the private bucket; exact Content-Type and max size enforced by S3. Then call POST v1/tenant/item-draft with the uploadIds.");
    }
}
