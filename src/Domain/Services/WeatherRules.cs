using System.Globalization;
using Domain.Enum;

namespace Domain.Services;

public static class WeatherRules
{
    /// <summary>WMO weather interpretation codes (Open-Meteo "weather_code") → the app's condition set.</summary>
    public static WeatherCondition ConditionFromWmo(int code) => code switch
    {
        0 => WeatherCondition.Clear,
        1 or 2 => WeatherCondition.PartlyCloudy,
        3 => WeatherCondition.Cloudy,
        45 or 48 => WeatherCondition.Fog,
        >= 51 and <= 57 => WeatherCondition.Drizzle,
        >= 61 and <= 67 => WeatherCondition.Rain,
        >= 71 and <= 77 => WeatherCondition.Snow,
        >= 80 and <= 82 => WeatherCondition.Showers,
        85 or 86 => WeatherCondition.Snow,
        >= 95 and <= 99 => WeatherCondition.Thunderstorm,
        _ => WeatherCondition.Unknown,
    };

    /// <summary>Rain, snow or storm: an outer layer is wanted whatever the temperature.</summary>
    public static bool IsWet(WeatherCondition condition) => condition is WeatherCondition.Drizzle or WeatherCondition.Rain
        or WeatherCondition.Showers or WeatherCondition.Snow or WeatherCondition.Thunderstorm;

    /// <summary>Whole degrees for the app (provider values carry one decimal).</summary>
    public static int WholeDegrees(double celsius) => (int)Math.Round(celsius, MidpointRounding.AwayFromZero);

    public static bool IsValidCoordinate(double latitude, double longitude) =>
        latitude is >= -90 and <= 90 && longitude is >= -180 and <= 180;

    /// <summary>0.1° ≈ 11 km: enough for a forecast, too coarse to locate a person.</summary>
    public static double RoundCoordinate(double value) => Math.Round(value, 1, MidpointRounding.AwayFromZero);

    public static string CityKey(string cityId) => $"city:{cityId}";

    public static string LocationKey(double latitude, double longitude) => string.Create(CultureInfo.InvariantCulture,
        $"geo:{RoundCoordinate(latitude):0.0}:{RoundCoordinate(longitude):0.0}");

    public static int ClampDays(int? days) => Math.Clamp(days ?? IWeatherService.MaxDays, 1, IWeatherService.MaxDays);
}
