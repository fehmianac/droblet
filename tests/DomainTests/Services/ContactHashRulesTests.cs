using Domain.Services;

namespace DomainTests.Services;

public class ContactHashRulesTests
{
    [Fact]
    public void BaseHash_IsSha256OfTheNormalisedAddress_KnownVector()
    {
        // SHA-256("abc") — the classic test vector; the app computes exactly this (lowercase hex).
        Assert.Equal("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", ContactHashRules.BaseHash("abc"));
        Assert.Equal(ContactHashRules.BaseHash("ayse@example.com"), ContactHashRules.BaseHash(ContactHashRules.NormalizeEmail("  Ayse@Example.COM ")));
    }

    [Fact]
    public void Salted_DependsOnTheSalt_SoAnUploadIsWorthlessElsewhere()
    {
        var h0 = ContactHashRules.BaseHash("ayse@example.com");
        var a = ContactHashRules.Salted(ContactHashRules.NewSalt(), ContactHashRules.EmailKind, h0);
        var b = ContactHashRules.Salted(ContactHashRules.NewSalt(), ContactHashRules.EmailKind, h0);

        Assert.NotEqual(a, b);
        Assert.Equal(ContactHashRules.Sha256Hex($"s:email:{h0}"), ContactHashRules.Salted("s", "email", h0));
        Assert.True(ContactHashRules.IsValidHash(a));
        Assert.Equal(h0[..3], ContactHashRules.Prefix(h0));
    }

    [Theory]
    [InlineData("a3f", true)]
    [InlineData("A3F", false)]
    [InlineData("a3", false)]
    [InlineData("g00", false)]
    public void IsValidPrefix_ThreeLowercaseHex(string prefix, bool valid) => Assert.Equal(valid, ContactHashRules.IsValidPrefix(prefix));

    [Fact]
    public void NewSalt_Is32RandomBytes_Base64Url()
    {
        var salt = ContactHashRules.NewSalt();
        Assert.Equal(43, salt.Length);
        Assert.DoesNotContain('+', salt);
        Assert.DoesNotContain('/', salt);
        Assert.NotEqual(salt, ContactHashRules.NewSalt());
    }
}
