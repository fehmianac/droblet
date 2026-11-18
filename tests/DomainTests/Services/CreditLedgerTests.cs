using Domain.Constant;
using Domain.Enum;
using Domain.Services;

namespace DomainTests.Services;

public class CreditLedgerTests
{
    private static readonly DateTime May = new(2026, 5, 10, 8, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime June = new(2026, 6, 10, 8, 0, 0, DateTimeKind.Utc);
    private static readonly CreditContext MayPremium = new(May, June, 30);
    private static readonly CreditContext JunePremium = new(June, June.AddMonths(1), 30);

    [Fact]
    public void Balance_WhenPremiumAndNothingUsed_Returns30AndResetDate()
    {
        var balance = CreditLedger.Balance(CreditState.Empty, MayPremium);

        Assert.Equal(30, balance.MonthlyAllowance);
        Assert.Equal(30, balance.AllowanceRemaining);
        Assert.Equal(0, balance.PackRemaining);
        Assert.Equal(30, balance.TotalRemaining);
        Assert.Equal(June, balance.ResetsAt);
    }

    [Fact]
    public void Balance_WhenFree_HasNoAllowanceButKeepsPackCredits()
    {
        var balance = CreditLedger.Balance(new CreditState(null, 0, 5), CreditContext.NoAllowance);

        Assert.Equal(0, balance.MonthlyAllowance);
        Assert.Equal(0, balance.AllowanceRemaining);
        Assert.Equal(5, balance.PackRemaining);
        Assert.Null(balance.ResetsAt);
    }

    [Fact]
    public void Balance_WhenNewSubscriptionMonth_UnusedAllowanceDoesNotRollOver()
    {
        var usedTen = new CreditState(May, 10, 0);

        var balance = CreditLedger.Balance(usedTen, JunePremium);

        Assert.Equal(30, balance.AllowanceRemaining); // reset to 30, not 50
    }

    [Fact]
    public void Reserve_WhenAllowanceLeft_ChargesOneAllowanceCredit()
    {
        var decision = CreditLedger.Reserve(new CreditState(May, 3, 4), MayPremium, 1, null);

        Assert.Equal(ReserveOutcome.Reserved, decision.Outcome);
        Assert.Equal(1, decision.FromAllowance);
        Assert.Equal(0, decision.FromPack);
        Assert.Equal(4, decision.State.AllowanceUsed);
        Assert.Equal(4, decision.State.PackBalance);
    }

    [Fact]
    public void Reserve_WhenAllowanceExhausted_UsesPackCredits()
    {
        var decision = CreditLedger.Reserve(new CreditState(May, 30, 4), MayPremium, 1, null);

        Assert.Equal(ReserveOutcome.Reserved, decision.Outcome);
        Assert.Equal(0, decision.FromAllowance);
        Assert.Equal(1, decision.FromPack);
        Assert.Equal(3, decision.State.PackBalance);
    }

    [Fact]
    public void Reserve_WhenNothingLeft_IsInsufficientWithCreditsExhausted()
    {
        var decision = CreditLedger.Reserve(new CreditState(May, 30, 0), MayPremium, 1, null);

        Assert.Equal(ReserveOutcome.Insufficient, decision.Outcome);
        Assert.Equal(ErrorCodes.CreditsExhausted, decision.Reason);
        Assert.False(decision.Charged);
    }

    [Fact]
    public void Reserve_ThirtyOneTimesInOneMonth_ThirtyFirstFails()
    {
        var state = CreditState.Empty;
        for (var i = 0; i < 30; i++)
        {
            var d = CreditLedger.Reserve(state, MayPremium, 1, null);
            Assert.Equal(ReserveOutcome.Reserved, d.Outcome);
            state = d.State;
        }

        Assert.Equal(ReserveOutcome.Insufficient, CreditLedger.Reserve(state, MayPremium, 1, null).Outcome);
    }

    [Fact]
    public void Reserve_WhenSameIdempotencyKeyAlreadyReserved_DoesNotChargeAgain()
    {
        var state = new CreditState(May, 5, 0);
        var existing = new ReservationSnapshot(CreditReservationStatus.Committed, 1, 0, May);

        var decision = CreditLedger.Reserve(state, MayPremium, 1, existing);

        Assert.Equal(ReserveOutcome.AlreadyReserved, decision.Outcome);
        Assert.False(decision.Charged);
        Assert.Equal(state, decision.State);
    }

    [Fact]
    public void Reserve_WhenNewMonthStarts_ResetsUsageBeforeCharging()
    {
        var decision = CreditLedger.Reserve(new CreditState(May, 30, 0), JunePremium, 1, null);

        Assert.Equal(ReserveOutcome.Reserved, decision.Outcome);
        Assert.Equal(June, decision.State.PeriodStart);
        Assert.Equal(1, decision.State.AllowanceUsed);
    }

    [Fact]
    public void Reserve_WhenFreeWithPackCredits_SpendsPack()
    {
        var decision = CreditLedger.Reserve(new CreditState(null, 0, 2), CreditContext.NoAllowance, 1, null);

        Assert.Equal(ReserveOutcome.Reserved, decision.Outcome);
        Assert.Equal(1, decision.FromPack);
    }

    [Fact]
    public void Reserve_WhenCostIsNotPositive_Throws()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => CreditLedger.Reserve(CreditState.Empty, MayPremium, 0, null));
    }

    [Fact]
    public void Refund_WhenSamePeriod_ReturnsAllowanceAndPack()
    {
        var reserved = new ReservationSnapshot(CreditReservationStatus.Reserved, 1, 0, May);

        var decision = CreditLedger.Refund(new CreditState(May, 7, 0), MayPremium, reserved);

        Assert.Equal(RefundOutcome.Refunded, decision.Outcome);
        Assert.Equal(6, decision.State.AllowanceUsed);
        Assert.Equal(1, decision.AllowanceReturned);
    }

    [Fact]
    public void Refund_WhenPackWasUsed_ReturnsPackCredit()
    {
        var reserved = new ReservationSnapshot(CreditReservationStatus.Reserved, 0, 1, May);

        var decision = CreditLedger.Refund(new CreditState(May, 30, 2), MayPremium, reserved);

        Assert.Equal(3, decision.State.PackBalance);
        Assert.Equal(1, decision.PackReturned);
    }

    [Fact]
    public void Refund_WhenMonthRolledOver_DoesNotInflateNewMonthButReturnsPack()
    {
        var reserved = new ReservationSnapshot(CreditReservationStatus.Reserved, 1, 1, May);

        var decision = CreditLedger.Refund(new CreditState(June, 0, 0), JunePremium, reserved);

        Assert.Equal(0, decision.AllowanceReturned);
        Assert.Equal(0, decision.State.AllowanceUsed);
        Assert.Equal(1, decision.State.PackBalance);
    }

    [Fact]
    public void Refund_WhenAlreadyCommitted_ChangesNothing()
    {
        var state = new CreditState(May, 4, 1);
        var committed = new ReservationSnapshot(CreditReservationStatus.Committed, 1, 0, May);

        var decision = CreditLedger.Refund(state, MayPremium, committed);

        Assert.Equal(RefundOutcome.AlreadyCommitted, decision.Outcome);
        Assert.Equal(state, decision.State);
    }

    [Fact]
    public void AddPack_AddsCreditsOnTop()
    {
        Assert.Equal(25, CreditLedger.AddPack(new CreditState(May, 30, 5), 20).PackBalance);
        Assert.Throws<ArgumentOutOfRangeException>(() => CreditLedger.AddPack(CreditState.Empty, 0));
    }

    [Fact]
    public void TryOnIdempotencyKey_SameOutfitAndBodyPhoto_IsStable_ChangesWithVersion()
    {
        var a = CreditLedger.TryOnIdempotencyKey("photo1", TryOnTargetKind.Look, "look1", 3);
        var b = CreditLedger.TryOnIdempotencyKey("photo1", TryOnTargetKind.Look, "look1", 3);
        var edited = CreditLedger.TryOnIdempotencyKey("photo1", TryOnTargetKind.Look, "look1", 4);
        var newPhoto = CreditLedger.TryOnIdempotencyKey("photo2", TryOnTargetKind.Look, "look1", 3);

        Assert.Equal(a, b);
        Assert.NotEqual(a, edited);
        Assert.NotEqual(a, newPhoto);
    }
}
