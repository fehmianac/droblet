using Ops;
using Ops.Commands;

namespace OpsTests;

public class AiPerfTests
{
    [Fact]
    public void Percentile_IsNearestRank()
    {
        double[] values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        Assert.Equal(5, AiPerfCommand.Percentile(values, 50));
        Assert.Equal(10, AiPerfCommand.Percentile(values, 95));
        Assert.Equal(7, AiPerfCommand.Percentile([7], 95));
        Assert.Equal("-", AiPerfCommand.Pct([]));
        Assert.Equal("2.00 / 3.00", AiPerfCommand.Pct([3000, 1000, 2000]));
    }

    [Theory]
    [InlineData(26_000, 35_000, 27_000)] // the brief's example: a 26 s job was noticed at 35 s
    [InlineData(3_500, 7_000, 4_500)]
    [InlineData(700, 1_000, 750)]
    public void PollSchedule_ReplaysOldAndNew(double completedMs, double oldNoticed, double newNoticed)
    {
        Assert.Equal(oldNoticed, PollSchedule.NoticedAt(completedMs, PollSchedule.Old));
        Assert.Equal(newNoticed, PollSchedule.NoticedAt(completedMs, PollSchedule.New));
    }

    [Fact]
    public void Arguments_AiPerfAndAiBench_AreDevOnly_AndBounded()
    {
        Assert.NotNull(OpsArguments.Parse(["ai-perf", "--stage", "dev", "--runs", "3", "--flows", "week,tryon", "--face"]).Arguments);
        Assert.Contains("dev only", OpsArguments.Parse(["ai-perf", "--stage", "prod"]).Error);
        Assert.Contains("--runs", OpsArguments.Parse(["ai-perf", "--stage", "dev", "--runs", "50"]).Error);
        Assert.Contains("unknown flow", OpsArguments.Parse(["ai-perf", "--stage", "dev", "--flows", "week,dance"]).Error);
        Assert.NotNull(OpsArguments.Parse(["ai-bench", "--stage", "dev", "--reps", "2", "--efforts", "default,low", "--text-only"]).Arguments);
        Assert.Contains("dev only", OpsArguments.Parse(["ai-bench", "--stage", "prod"]).Error);
        Assert.Contains("--max-calls", OpsArguments.Parse(["ai-bench", "--stage", "dev", "--max-calls", "99"]).Error);
    }
}
