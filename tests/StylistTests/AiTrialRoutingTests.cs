using Domain.Enum;
using Domain.Events;
using Infrastructure.Serialization;

namespace StylistTests;

/// <summary>The stylist queue also carries admin AI trials; they are told apart by kind and never reach the job service.</summary>
public class AiTrialRoutingTests
{
    [Fact]
    public void TrialMessage_IsRecognised_StylistJobsAreNot()
    {
        Assert.Equal("01TRIAL", Stylist.Entrypoint.TrialId(MessageSerializer.Serialize(new AiTrialRequestedEvent("01TRIAL"))));
        Assert.Null(Stylist.Entrypoint.TrialId(MessageSerializer.Serialize(new StylistRequestedEvent("t", "j", JobKind.StylistOutfit))));
        Assert.Null(Stylist.Entrypoint.TrialId("not json"));
        Assert.Null(Stylist.Entrypoint.TrialId("""{"kind":"AiTrial"}"""));
    }

    [Fact]
    public void TrialEvent_RoutesToTheStylistQueue()
    {
        var queues = new Domain.Options.QueueOptions { StylistRequest = "stylist-url", ItemProcessRequest = "item-url" };
        Assert.Equal("stylist-url", queues.UrlFor(new AiTrialRequestedEvent("x").Kind));
    }
}
