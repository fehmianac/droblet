using Domain.Enum;

namespace Domain.Services;

public enum AgeOutcome { Adult, Teen, UnderMinimum, NeedsMonth, InvalidYear, InvalidMonth }

/// <param name="AdultFrom">The first day the account is surely 18 (teen only).</param>
public sealed record AgeEvaluation(AgeOutcome Outcome, DateOnly? AdultFrom = null)
{
    public AgeBand? Band => Outcome switch
    {
        AgeOutcome.Adult => AgeBand.Adult,
        AgeOutcome.Teen => AgeBand.Teen,
        _ => null,
    };
}

/// <summary>
/// Age bands from a birth year (and a month only when the year alone is ambiguous) — docs/api/teen.md §3. Nothing finer
/// than the month is ever collected. Conservative: with a month, the birthday counts as reached from the first day of the
/// NEXT month; without one, a year that could mean either side of 16 or 18 asks for the month.
/// </summary>
public static class AgeRules
{
    public const int MinimumAge = 16;
    public const int AdultAge = 18;
    public const int MaxAge = 120;

    public static AgeEvaluation Evaluate(int birthYear, int? birthMonth, DateOnly today)
    {
        if (birthYear > today.Year || birthYear < today.Year - MaxAge)
            return new(AgeOutcome.InvalidYear);
        if (birthMonth is { } m && (m < 1 || m > 12))
            return new(AgeOutcome.InvalidMonth);

        int age;
        if (birthMonth is { } month)
        {
            age = AgeOn(birthYear, month, today);
        }
        else
        {
            // Year only: the age is (today.Year - birthYear) once the birthday passed, one less before.
            var high = today.Year - birthYear;
            var low = high - 1;
            if (low >= AdultAge) return new(AgeOutcome.Adult);
            if (high < MinimumAge) return new(AgeOutcome.UnderMinimum);
            if (low < MinimumAge || high >= AdultAge) return new(AgeOutcome.NeedsMonth);
            age = low; // 16 or 17 either way: teen
        }

        if (age >= AdultAge) return new(AgeOutcome.Adult);
        if (age < MinimumAge) return new(AgeOutcome.UnderMinimum);
        return new(AgeOutcome.Teen, AdultFrom(birthYear, birthMonth));
    }

    /// <summary>Full years on <paramref name="today"/>, the birthday counted from the first day of the month after the birth month.</summary>
    public static int AgeOn(int birthYear, int birthMonth, DateOnly today)
    {
        var age = today.Year - birthYear;
        return today.Month > birthMonth ? age : age - 1;
    }

    /// <summary>
    /// The first day the account is surely 18: the first day of the month after the birth month in the 18th year, or — with
    /// the year only — 1 January of the following year.
    /// </summary>
    public static DateOnly AdultFrom(int birthYear, int? birthMonth) =>
        birthMonth is { } month
            ? new DateOnly(birthYear + AdultAge, month, 1).AddMonths(1)
            : new DateOnly(birthYear + AdultAge + 1, 1, 1);

    public static bool IsAdultOn(int birthYear, int? birthMonth, DateOnly today) => today >= AdultFrom(birthYear, birthMonth);
}
