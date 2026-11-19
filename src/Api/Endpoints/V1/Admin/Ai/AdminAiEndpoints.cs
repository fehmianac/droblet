using Api.Contracts;
using Api.Infrastructure.Contract;
using Api.Infrastructure.Extensions;
using Domain.Constant;
using Domain.Services.Admin;
using Microsoft.AspNetCore.Mvc;

namespace Api.Endpoints.V1.Admin.Ai;

// AI prompts and models (ai.manage). docs/api/admin.md §5b. Lambdas apply a publish / rollback within ~60 s
// (prompt cache) and a model change within ~60 s (SSM reload); nothing needs a deploy.

internal static class AiResults
{
    public static IResult Prompt(AiPromptResult result) => result.Outcome switch
    {
        AiPromptOutcome.Ok => Results.Ok(result.Prompt),
        AiPromptOutcome.Invalid => AdminResults.ValidationErrors(result.Errors!),
        AiPromptOutcome.NoDraft => ApiResults.Problem(StatusCodes.Status409Conflict, ErrorCodes.NoDraft),
        AiPromptOutcome.Conflict => ApiResults.Problem(StatusCodes.Status409Conflict, ErrorCodes.VersionConflict),
        AiPromptOutcome.AlreadyLive => ApiResults.Problem(StatusCodes.Status409Conflict, ErrorCodes.AlreadyLive),
        AiPromptOutcome.VersionNotFound => ApiResults.Problem(StatusCodes.Status404NotFound, ErrorCodes.VersionNotFound),
        _ => ApiResults.Problem(StatusCodes.Status404NotFound, ErrorCodes.NotFound),
    };

    public static RouteHandlerBuilder PromptWrite(this RouteHandlerBuilder builder) => builder
        .Produces<AiPromptDetailDto>(StatusCodes.Status200OK)
        .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
        .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
        .Produces<ProblemDetails>(StatusCodes.Status409Conflict)
        .RequireAdmin(AdminPermissions.AiManage)
        .WithTags("Admin AI");
}

public class GetPrompts : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IAdminAiService ai, CancellationToken ct) => Results.Ok(await ai.ListPromptsAsync(ct));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/admin/ai/prompt", Handler)
            .Produces<AiPromptListDto>(StatusCodes.Status200OK)
            .RequireAdmin(AdminPermissions.AiManage)
            .WithSummary("Every AI prompt by key")
            .WithDescription("Live version, last publisher, draft state and an automatic fallback (banner) per key. Schema keys are view only.")
            .WithTags("Admin AI");
}

public class GetPrompt : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string key, [FromServices] IAdminAiService ai, CancellationToken ct) =>
        await ai.GetPromptAsync(key, ct) is { } prompt ? Results.Ok(prompt) : ApiResults.Problem(StatusCodes.Status404NotFound, ErrorCodes.NotFound);

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/admin/ai/prompt/{key}", Handler)
            .Produces<AiPromptDetailDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .RequireAdmin(AdminPermissions.AiManage)
            .WithSummary("One prompt: code default, live text, draft, variables, schema, history")
            .WithTags("Admin AI");
}

public class PutPromptDraft : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string key, [FromBody] AdminAiDraftRequest request, [FromServices] IAdminAiService ai,
        [FromServices] IAdminContext admin, CancellationToken ct) =>
        AiResults.Prompt(await ai.SaveDraftAsync(admin.Admin, key, request.Text, ct));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPut("v1/admin/ai/prompt/{key}/draft", Handler)
            .PromptWrite()
            .WithSummary("Save the draft of a prompt")
            .WithDescription("Validated: text empty / too_long / malformed_placeholder / read_only; placeholders.{name} missing (required) / unknown. The draft is not live.");
}

public class DeletePromptDraft : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string key, [FromServices] IAdminAiService ai, [FromServices] IAdminContext admin, CancellationToken ct) =>
        AiResults.Prompt(await ai.DiscardDraftAsync(admin.Admin, key, ct));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapDelete("v1/admin/ai/prompt/{key}/draft", Handler)
            .PromptWrite()
            .WithSummary("Discard the draft of a prompt");
}

public class PostPromptPublish : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string key, [FromBody] AdminAiPublishRequest request, [FromServices] IAdminAiService ai,
        [FromServices] IAdminContext admin, CancellationToken ct) =>
        AiResults.Prompt(await ai.PublishAsync(admin.Admin, key, request.Note, request.ExpectedVersion, admin.Ip, ct));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/admin/ai/prompt/{key}/publish", Handler)
            .PromptWrite()
            .WithSummary("Publish the draft as a new version")
            .WithDescription("409 no_draft, version_conflict (expectedVersion is not the live version), already_live. Audited (ai.prompt.publish) with before / after. Lambdas use it within ~60 s.");
}

public class PostPromptRollback : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string key, [FromBody] AdminAiRollbackRequest request, [FromServices] IAdminAiService ai,
        [FromServices] IAdminContext admin, CancellationToken ct) =>
        AiResults.Prompt(await ai.RollbackAsync(admin.Admin, key, request.Version, request.Note, admin.Ip, ct));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/admin/ai/prompt/{key}/rollback", Handler)
            .PromptWrite()
            .WithSummary("Make an earlier version (or 0 = the code default) live again")
            .WithDescription("Adds a new history entry with that text. 404 version_not_found, 409 already_live. Audited (ai.prompt.rollback) with before / after.");
}

public class PostPromptAcknowledge : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string key, [FromServices] IAdminAiService ai, [FromServices] IAdminContext admin, CancellationToken ct) =>
        AiResults.Prompt(await ai.AcknowledgeFallbackAsync(admin.Admin, key, ct));

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/admin/ai/prompt/{key}/acknowledge", Handler)
            .PromptWrite()
            .WithSummary("Hide the banner of an automatic fallback");
}

public class PostTrial : IEndpoint
{
    private static async Task<IResult> Handler([FromBody] AdminAiTrialRequest request, [FromServices] IAdminAiService ai, [FromServices] IAdminContext admin,
        CancellationToken ct)
    {
        var result = await ai.StartTrialAsync(admin.Admin, new AiTrialRequest(request.Type, request.Key, request.Text, request.Input, request.ImageUrls,
            request.Model, request.ModelKind, request.Effort, request.ServiceTier), admin.Ip, ct);
        return result.Outcome switch
        {
            AiTrialOutcome.Ok => result.Trial!.Status is Domain.Entity.AiTrialStatus.Queued ? Results.Json(result.Trial, statusCode: StatusCodes.Status202Accepted) : Results.Ok(result.Trial),
            AiTrialOutcome.Invalid => AdminResults.ValidationErrors(result.Errors!),
            AiTrialOutcome.RateLimited => ApiResults.Problem(StatusCodes.Status429TooManyRequests, ErrorCodes.TooManyRequests),
            _ => ApiResults.Problem(StatusCodes.Status404NotFound, ErrorCodes.NotFound),
        };
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost("v1/admin/ai/trial", Handler)
            .Produces<AiTrialDto>(StatusCodes.Status202Accepted)
            .Produces<AiTrialDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .RequireAdmin(AdminPermissions.AiManage)
            .WithSummary("Dry-run a prompt draft, test a model, or refresh the model list")
            .WithDescription("202 queued: run by the Stylist worker (one AI call; poll GET v1/admin/ai/trial/{id}). Image prompts answer 200 at once with the rendered preview (no call). 30 per admin per hour (429).")
            .WithTags("Admin AI");
}

public class GetTrial : IEndpoint
{
    private static async Task<IResult> Handler([FromRoute] string id, [FromServices] IAdminAiService ai, CancellationToken ct) =>
        await ai.GetTrialAsync(id, ct) is { } trial ? Results.Ok(trial) : ApiResults.Problem(StatusCodes.Status404NotFound, ErrorCodes.NotFound);

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/admin/ai/trial/{id}", Handler)
            .Produces<AiTrialDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound)
            .RequireAdmin(AdminPermissions.AiManage)
            .WithSummary("A trial's status and result")
            .WithTags("Admin AI");
}

public class GetModels : IEndpoint
{
    private static async Task<IResult> Handler([FromServices] IAdminAiService ai, CancellationToken ct)
    {
        try
        {
            return Results.Ok(await ai.GetModelSettingsAsync(ct));
        }
        catch (SettingsUnavailableException)
        {
            return ApiResults.Problem(StatusCodes.Status503ServiceUnavailable, ErrorCodes.SettingsUnavailable);
        }
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet("v1/admin/ai/model", Handler)
            .Produces<AiModelSettingsDto>(StatusCodes.Status200OK)
            .RequireAdmin(AdminPermissions.AiManage)
            .WithSummary("AI model settings (worker/Ai) and the model allow-list")
            .WithTags("Admin AI");
}

public class PutLimits : IEndpoint
{
    private static async Task<IResult> Handler([FromBody] AdminSettingUpdateRequest request, [FromServices] IAdminAiService ai, [FromServices] IAdminContext admin,
        CancellationToken ct)
    {
        try
        {
            var result = await ai.UpdateLimitsAsync(admin.Admin, request.Values ?? [], admin.Ip, ct);
            return result.Outcome == SettingWriteOutcome.Ok ? Results.Ok(result.Group) : AdminResults.ValidationErrors(result.Errors!);
        }
        catch (SettingsUnavailableException)
        {
            return ApiResults.Problem(StatusCodes.Status503ServiceUnavailable, ErrorCodes.SettingsUnavailable);
        }
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPut("v1/admin/ai/limits", Handler)
            .Produces<SettingGroupDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .RequireAdmin(AdminPermissions.AiManage)
            .WithSummary("Change the per-tenant daily caps of AI work without credits (api/AiLimits)")
            .WithDescription("0 = no cap. The Api applies it within ~60 s. Audited (ai.limits.update) with before / after.")
            .WithTags("Admin AI");
}

public class PutModels : IEndpoint
{
    private static async Task<IResult> Handler([FromBody] AdminSettingUpdateRequest request, [FromServices] IAdminAiService ai, [FromServices] IAdminContext admin,
        CancellationToken ct)
    {
        try
        {
            var result = await ai.UpdateModelSettingsAsync(admin.Admin, request.Values ?? [], admin.Ip, ct);
            return result.Outcome == SettingWriteOutcome.Ok ? Results.Ok(result.Group) : AdminResults.ValidationErrors(result.Errors!);
        }
        catch (SettingsUnavailableException)
        {
            return ApiResults.Problem(StatusCodes.Status503ServiceUnavailable, ErrorCodes.SettingsUnavailable);
        }
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPut("v1/admin/ai/model", Handler)
            .Produces<SettingGroupDto>(StatusCodes.Status200OK)
            .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest)
            .RequireAdmin(AdminPermissions.AiManage)
            .WithSummary("Change AI models, reasoning effort, service tier, image quality / size, prompt safety")
            .WithDescription("Model ids must be in the allow-list (models_unknown: refresh it first; not_available). null clears an optional key. Workers apply it within ~60 s. Audited (ai.models.update) with before / after.")
            .WithTags("Admin AI");
}
