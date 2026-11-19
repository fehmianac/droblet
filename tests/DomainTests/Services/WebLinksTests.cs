using Domain.Services;

namespace DomainTests.Services;

public class WebLinksTests
{
    [Theory]
    [InlineData("https://droblet.alatech.co/reset-password", "https://droblet.alatech.co/reset-password/?token=a%2Bb")]
    [InlineData("https://droblet.alatech.co/reset-password/", "https://droblet.alatech.co/reset-password/?token=a%2Bb")]
    [InlineData("https://droblet.alatech.co/en/verify-email", "https://droblet.alatech.co/en/verify-email/?token=a%2Bb")]
    [InlineData("https://example.com/page.html", "https://example.com/page.html?token=a%2Bb")]
    public void PageLinks_GetTheTrailingSlash_SoS3DoesNotDropTheQuery(string page, string expected) =>
        Assert.Equal(expected, WebLinks.WithQuery(page, "token", "a+b"));
}
