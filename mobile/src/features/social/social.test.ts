import type { Entitlement } from '@/api/contracts';
import { confirmationMatches, paletteCatalogColors } from '@/features/account/logic';
import { decideAiGate } from '@/features/credits/useAiGate';

import { mapIncomingLink } from './deepLinks';
import { applyRating, lookShareUrl, profileShareUrl } from './feedMath';
import { shareTargetUrl } from './ShareSheet';

describe('deep links', () => {
  it('maps invite links and keeps the code', () => {
    expect(mapIncomingLink('https://droplet.alatech.co/invite/DAMLA24')).toEqual({ path: '/friends/find', inviteCode: 'DAMLA24' });
    expect(mapIncomingLink('droplet://invite/DAMLA24')).toEqual({ path: '/friends/find', inviteCode: 'DAMLA24' });
    expect(mapIncomingLink('/invite/DAMLA24')).toEqual({ path: '/friends/find', inviteCode: 'DAMLA24' });
  });

  it('maps shared looks and profiles, stripping the invite code from the route', () => {
    expect(mapIncomingLink('https://droplet.alatech.co/l/flook_1?invite=DAMLA24')).toEqual({
      path: '/friends/feed?look=flook_1',
      inviteCode: 'DAMLA24',
    });
    expect(mapIncomingLink('droplet://u/selin?invite=DAMLA24')).toEqual({ path: '/u/selin', inviteCode: 'DAMLA24' });
    expect(mapIncomingLink('droplet://today')).toEqual({ path: '/', inviteCode: null });
  });

  it('leaves other links untouched and rejects malformed codes', () => {
    const reset = 'droplet://reset-password?token=abc';
    expect(mapIncomingLink(reset)).toEqual({ path: reset, inviteCode: null });
    expect(mapIncomingLink('exp://192.168.1.5:8081')).toEqual({ path: 'exp://192.168.1.5:8081', inviteCode: null });
    expect(mapIncomingLink('exp://192.168.1.5:8081/--/u/selin').path).toBe('/u/selin');
    expect(mapIncomingLink('droplet://u/selin?invite=<script>').inviteCode).toBeNull();
  });

  it('builds share links that carry the invite code', () => {
    expect(lookShareUrl('droplet.alatech.co', 'flook_1', 'DAMLA24')).toBe('https://droplet.alatech.co/l/flook_1?invite=DAMLA24');
    expect(profileShareUrl('droplet.alatech.co', 'selin', null)).toBe('https://droplet.alatech.co/u/selin');
    expect(shareTargetUrl('whatsapp', 'https://x.y/l/1', 'Bak: https://x.y/l/1')).toBe(
      'https://wa.me/?text=Bak%3A%20https%3A%2F%2Fx.y%2Fl%2F1',
    );
    expect(shareTargetUrl('pinterest', 'https://x.y/l/1', 'm')).toContain('url=https%3A%2F%2Fx.y%2Fl%2F1');
  });
});

describe('look rating', () => {
  it('adds a first rating and overwrites an existing one', () => {
    expect(applyRating({ myRating: null, averageRating: 4.7, ratingCount: 12 }, 5)).toEqual({
      myRating: 5,
      averageRating: 4.7,
      ratingCount: 13,
    });
    expect(applyRating({ myRating: 4, averageRating: 4, ratingCount: 2 }, 2)).toEqual({ myRating: 2, averageRating: 3, ratingCount: 2 });
    expect(applyRating({ myRating: null, averageRating: null, ratingCount: 0 }, 9)).toEqual({ myRating: 5, averageRating: 5, ratingCount: 1 });
  });
});

describe('AI gate', () => {
  const member = (remaining: number): Entitlement => ({
    tier: 'member',
    credits: { monthlyAllowance: 30, remaining, resetsAt: '2026-12-01T00:00:00Z' },
  });

  it('sends non-members to the paywall and members without credits to the credit sheet', () => {
    expect(decideAiGate({ ...member(0), tier: 'free' }, true)).toBe('paywall');
    expect(decideAiGate(member(0), true)).toBe('credits');
    expect(decideAiGate(member(0), false)).toBe('allow');
    expect(decideAiGate(member(12), true)).toBe('allow');
    expect(decideAiGate(undefined, true)).toBe('allow');
  });
});

describe('account logic', () => {
  it('matches the confirmation word in the active language', () => {
    expect(confirmationMatches(' sil ', 'SİL', 'tr-TR')).toBe(true);
    expect(confirmationMatches('SIL', 'SİL', 'tr-TR')).toBe(false);
    expect(confirmationMatches('delete', 'DELETE', 'en-GB')).toBe(true);
  });

  it('collects the palette catalogue colours once each', () => {
    const tone = (catalogColor: 'brown' | 'navy' | null) => ({ hex: '#000000', name: { tr: 'x' }, catalogColor });
    expect(paletteCatalogColors([tone('brown'), tone('navy'), tone('brown'), tone(null)])).toEqual(['brown', 'navy']);
  });
});
