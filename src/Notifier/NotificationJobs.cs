using Microsoft.Extensions.Logging;

namespace Notifier;

public enum NotificationJob { Reminder, WeeklyEdit, FriendRatings, Lifecycle }

public sealed record NotificationRunResult(NotificationJob Job, DateTime ScheduledAt, int Candidates, int Sent);

public interface INotificationJobs
{
    Task<NotificationRunResult> RunAsync(NotificationJob job, DateTime scheduledAtUtc, CancellationToken ct);
}

/// <summary>
/// Scheduled notification jobs. Device registration, notification preferences and reminder slots (ReminderSlotEntity)
/// are not built yet, so there is nobody to notify: each run reports zero candidates and sends nothing.
/// The rule set (ReminderRules, quiet hours, daily cap) and FCM provider plug in here.
/// </summary>
public sealed class NotificationJobs(ILogger<NotificationJobs> logger) : INotificationJobs
{
    public Task<NotificationRunResult> RunAsync(NotificationJob job, DateTime scheduledAtUtc, CancellationToken ct)
    {
        var result = new NotificationRunResult(job, scheduledAtUtc, Candidates: 0, Sent: 0);
        logger.LogInformation("Notifier {Job} at {ScheduledAt:o}: {Candidates} candidates, {Sent} sent", job, scheduledAtUtc, result.Candidates, result.Sent);
        return Task.FromResult(result);
    }
}
