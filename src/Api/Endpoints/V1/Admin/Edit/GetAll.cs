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

namespace Api.Endpoints.V1.Admin.Edit;

public class GetAll : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IContentService content,
        CancellationToken cancellationToken)
    {

        return Results.Ok((await content.ListEditsAsync(cancellationToken)).Select(e => e.ToAdminDto()).ToList());
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/admin/edit", Handler)
            .Produces<List<AdminEditDto>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization(AdminOptions.Policy)
            .WithSummary("Weekly edits (admin)")
            .WithDescription("Every edit, newest week first, drafts and retired included.")
            .WithTags("Admin Content");
    }
}
