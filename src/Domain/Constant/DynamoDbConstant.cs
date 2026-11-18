namespace Domain.Constant;

public static class DynamoDbConstant
{
    public static string TableName =>
        Environment.GetEnvironmentVariable("TABLE_NAME") is { Length: > 0 } name ? name : "droblet-dev-table";

    public sealed record IndexDefinition(string IndexName, string PkAttribute, string? SkAttribute);
}
