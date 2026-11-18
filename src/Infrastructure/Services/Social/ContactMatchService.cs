using Domain.Entity;
using Domain.Extensions;
using Domain.Manager;
using Domain.Options;
using Domain.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Infrastructure.Services.Social;

/// <summary>
/// Decision 13: contact matching with per-request salts (<see cref="ContactHashRules"/>). The upload lives only in this
/// request's memory: no row, no log line, no metric carries a hash. Results go through <see cref="ISocialService.CardsForAsync"/>,
/// so visibility and blocks apply exactly as in search.
/// </summary>
public sealed class ContactMatchService(
    IRepository repository,
    ISocialService social,
    IRateLimiter rateLimiter,
    IOptionsMonitor<SocialOptions> options,
    TimeProvider timeProvider,
    ILogger<ContactMatchService> logger) : IContactMatchService
{
    private const int BucketParallelism = 8;

    private DateTime Now => timeProvider.GetUtcNow().UtcDateTime;

    public async Task<ContactSaltDto> IssueSaltAsync(string tenantId, CancellationToken ct)
    {
        var now = Now;
        var salt = new ContactSaltEntity
        {
            TenantId = tenantId,
            SaltId = Ulid.New(now),
            Salt = ContactHashRules.NewSalt(),
            ExpiresAt = now.Add(ContactHashRules.SaltLifetime),
        };
        await repository.SaveAsync(salt, ct);
        return new ContactSaltDto(salt.SaltId, salt.Salt, ContactHashRules.PrefixLength, MaxHashes, salt.ExpiresAt);
    }

    private int MaxHashes => Math.Clamp(options.CurrentValue.ContactMatchMaxHashes, 1, 5000);

    public async Task<(ContactMatchOutcome Outcome, ContactMatchesDto? Result)> MatchAsync(
        string tenantId, string saltId, IReadOnlyList<ContactHashInput> hashes, CancellationToken ct)
    {
        var salt = await repository.GetAsync<ContactSaltEntity>(ContactSaltEntity.GetPk(tenantId), ContactSaltEntity.GetSk(saltId), ct);
        if (salt is null || salt.ExpiresAt <= Now)
            return (ContactMatchOutcome.SaltNotFound, null);
        // Single use: whoever deletes it first may use it.
        if (!(await repository.TransactWriteAsync([TransactWriteOperation.DeleteExisting(salt.Pk, salt.Sk)], ct)).Applied)
            return (ContactMatchOutcome.SaltNotFound, null);
        if (!await rateLimiter.TryAcquireAsync("contact-match", tenantId, options.CurrentValue.ContactMatchesPerDay, TimeSpan.FromDays(1), ct))
            return (ContactMatchOutcome.RateLimited, null);

        var wanted = hashes.Select(h => h.H).ToHashSet(StringComparer.Ordinal);
        var prefixes = hashes.Select(h => h.P).Distinct(StringComparer.Ordinal).ToList();

        var matched = new HashSet<string>(StringComparer.Ordinal);
        foreach (var chunk in prefixes.Chunk(BucketParallelism))
        {
            var buckets = await Task.WhenAll(chunk.Select(p => repository.GetAllAsync<ContactDirectoryEntity>(ContactDirectoryEntity.GetPk(p), ct)));
            foreach (var member in buckets.SelectMany(b => b))
            {
                if (member.TenantId != tenantId && wanted.Contains(ContactHashRules.Salted(salt.Salt, ContactHashRules.EmailKind, member.Hash)))
                    matched.Add(member.TenantId);
            }
        }

        var cards = matched.Count == 0 ? [] : await social.CardsForAsync(tenantId, matched.Order(StringComparer.Ordinal).ToList(), ct);
        // Counts only — never a hash or an id of the contacts.
        logger.LogInformation("Contact match for tenant {TenantId}: {Hashes} hashes, {Matches} matches", tenantId, hashes.Count, cards.Count);
        return (ContactMatchOutcome.Ok, new ContactMatchesDto(cards));
    }
}

/// <summary>Members' verified e-mail addresses in the hashed directory (Apple / Google verified, or proven by a password reset).</summary>
public sealed class ContactDirectory(IRepository repository, TimeProvider timeProvider) : IContactDirectory
{
    public async Task ListVerifiedEmailAsync(string tenantId, string email, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(email))
            return;
        var hash = ContactHashRules.BaseHash(ContactHashRules.NormalizeEmail(email));
        var prefix = ContactHashRules.Prefix(hash);
        if (await repository.GetAsync<ContactDirectoryPointerEntity>(ContactDirectoryPointerEntity.GetPk(tenantId), ContactDirectoryPointerEntity.GetSk(hash), ct) is not null)
            return;
        await repository.TransactWriteAsync(
        [
            TransactWriteOperation.Put(new ContactDirectoryEntity { Prefix = prefix, TenantId = tenantId, Hash = hash, CreatedAt = timeProvider.GetUtcNow().UtcDateTime }),
            TransactWriteOperation.Put(new ContactDirectoryPointerEntity { TenantId = tenantId, Hash = hash, Prefix = prefix }),
        ], ct);
    }
}
