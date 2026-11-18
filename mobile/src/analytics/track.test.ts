import type { EventBatchRequest } from '@/api/contracts/analytics';

import { bindAnalyticsSink, flushAnalytics, pendingAnalyticsCount, resetAnalytics, track } from './track';

describe('analytics batching', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetAnalytics();
  });
  afterEach(() => jest.useRealTimers());

  it('buffers events until a sink is bound, then flushes them', () => {
    track('signup_step', { step: 'welcome' });
    track('paywall_viewed', { from: 'onboarding' });
    expect(pendingAnalyticsCount()).toBe(2);

    const batches: EventBatchRequest[] = [];
    bindAnalyticsSink((b) => batches.push(b));
    expect(batches).toHaveLength(1);
    expect(batches[0]?.events.map((e) => e.name)).toEqual(['signup_step', 'paywall_viewed']);
    expect(batches[0]?.clientMutationId).toHaveLength(26);
    expect(pendingAnalyticsCount()).toBe(0);
  });

  it('never sends more than 50 events in one batch', () => {
    for (let i = 0; i < 120; i++) track('cart_added', { i });
    const batches: EventBatchRequest[] = [];
    bindAnalyticsSink((b) => batches.push(b));
    expect(batches.map((b) => b.events.length)).toEqual([50, 50, 20]);
    expect(batches.flatMap((b) => b.events.map((e) => e.params.i))).toEqual(Array.from({ length: 120 }, (_, i) => i));
  });

  it('flushes after a quiet period and at once when a batch is full', () => {
    const batches: EventBatchRequest[] = [];
    bindAnalyticsSink((b) => batches.push(b));
    track('look_shared', { channel: 'link' });
    expect(batches).toHaveLength(0);
    jest.advanceTimersByTime(5000);
    expect(batches).toHaveLength(1);

    for (let i = 0; i < 50; i++) track('cart_added', { i });
    expect(batches).toHaveLength(2);
    expect(batches[1]?.events).toHaveLength(50);
  });

  it('drops names that are not on the allow-list and caps the buffer while no sink is bound', () => {
    // @ts-expect-error — not an allow-listed event
    track('made_up_event');
    expect(pendingAnalyticsCount()).toBe(0);
    for (let i = 0; i < 260; i++) track('cart_added', { i });
    expect(pendingAnalyticsCount()).toBe(200);
    flushAnalytics();
    expect(pendingAnalyticsCount()).toBe(200);
  });
});
