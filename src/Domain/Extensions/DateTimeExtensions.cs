namespace Domain.Extensions;

public static class DateTimeExtensions
{
    public static long ToUnixTimeSeconds(this DateTime value) =>
        new DateTimeOffset(DateTime.SpecifyKind(value, DateTimeKind.Utc)).ToUnixTimeSeconds();

    public static long ToUnixTimeMilliseconds(this DateTime value) =>
        new DateTimeOffset(DateTime.SpecifyKind(value, DateTimeKind.Utc)).ToUnixTimeMilliseconds();
}
