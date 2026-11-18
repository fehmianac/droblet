using System.Text;
using Domain.Constant;
using FluentValidation.Results;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Api.Infrastructure.Extensions;

public static class ValidationExtensions
{
    /// <summary>
    /// 400 body: { title: "validation_failed", code: "validation_failed", errors: { "<camelCaseField>": ["<snake_case_code>"] } }.
    /// Codes are stable; the client translates them (TR/EN).
    /// </summary>
    public static HttpValidationProblemDetails ToProblemDetails(this IEnumerable<ValidationFailure> failures)
    {
        var errors = failures
            .GroupBy(f => CamelCasePath(f.PropertyName))
            .ToDictionary(g => g.Key, g => g.Select(f => ToSnakeCode(f.ErrorCode)).Distinct().ToArray());

        var problem = new HttpValidationProblemDetails(errors)
        {
            Title = ErrorCodes.ValidationFailed,
            Status = StatusCodes.Status400BadRequest,
            Type = "https://droblet.alatech.co/errors/validation_failed",
        };
        problem.Extensions["code"] = ErrorCodes.ValidationFailed;
        return problem;
    }

    public static string ToSnakeCode(string? errorCode)
    {
        if (string.IsNullOrEmpty(errorCode))
            return "invalid";
        if (errorCode.All(c => char.IsLower(c) || char.IsDigit(c) || c == '_'))
            return errorCode;

        var name = errorCode.EndsWith("Validator", StringComparison.Ordinal) ? errorCode[..^"Validator".Length] : errorCode;
        var builder = new StringBuilder();
        for (var i = 0; i < name.Length; i++)
        {
            if (char.IsUpper(name[i]) && i > 0)
                builder.Append('_');
            builder.Append(char.ToLowerInvariant(name[i]));
        }
        return builder.ToString();
    }

    private static string CamelCasePath(string propertyName) =>
        string.Join('.', propertyName.Split('.').Select(p => p.Length == 0 ? p : char.ToLowerInvariant(p[0]) + p[1..]));
}

public static class ApiResults
{
    /// <summary>ProblemDetails with a stable snake_case `code` (also the title).</summary>
    public static ProblemHttpResult Problem(int statusCode, string code) =>
        TypedResults.Problem(new ProblemDetails
        {
            Status = statusCode,
            Title = code,
            Type = $"https://droblet.alatech.co/errors/{code}",
            Extensions = { ["code"] = code },
        });

    /// <summary>
    /// Language of an anonymous request (register, social sign-in, password reset): the first supported language of
    /// Accept-Language (Localization:SupportedLanguages), else the default language.
    /// </summary>
    public static string Language(this HttpContext context) =>
        Domain.Services.Localized.Language(null, context.Request.Headers.AcceptLanguage.ToString());

    public static string? ClientIp(this HttpContext context) => context.Connection.RemoteIpAddress?.ToString();
}
