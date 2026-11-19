import {
  markCleanRevealed,
  markProcessing,
  overallProgress,
  processingPreview,
  rememberLocalPreviews,
  resetBulkRows,
  rowProgress,
  seenSince,
  shouldRevealClean,
  SIMULATED_CAP,
  simulatedProgress,
} from './bulkRows';

beforeEach(() => resetBulkRows());

describe('13 bulk rows: simulated progress', () => {
  it('starts at 0, eases toward 90 % and never completes on its own', () => {
    expect(simulatedProgress(0)).toBe(0);
    const samples = [1_000, 5_000, 12_000, 30_000, 120_000, 3_600_000].map(simulatedProgress);
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThan(samples[i - 1] ?? 0);
    // Fast at first, slower and slower: the first 5 s move more than 5 s later on.
    expect(simulatedProgress(5_000)).toBeGreaterThan(simulatedProgress(30_000) - simulatedProgress(25_000));
    expect(Math.max(...samples)).toBeLessThanOrEqual(SIMULATED_CAP);
    expect(simulatedProgress(-500)).toBe(0);
  });

  it('a processing row eases from when it was first seen; the real result completes it', () => {
    const t0 = 1_000_000;
    seenSince('d1', () => t0);
    expect(rowProgress({ id: 'd1', status: 'processing' }, t0)).toBe(0);
    const mid = rowProgress({ id: 'd1', status: 'processing' }, t0 + 12_000);
    expect(mid).toBeGreaterThan(0.5);
    expect(mid).toBeLessThan(SIMULATED_CAP);
    expect(rowProgress({ id: 'd1', status: 'ready' }, t0 + 12_000)).toBe(1);
    expect(rowProgress({ id: 'd1', status: 'failed' }, t0 + 12_000)).toBe(1);
  });

  it('the header bar is the average of the rows, so it agrees with them', () => {
    const t0 = 2_000_000;
    seenSince('a', () => t0);
    seenSince('b', () => t0);
    const now = t0 + 24_000;
    const rows = [
      { id: 'a', status: 'processing' as const },
      { id: 'b', status: 'processing' as const },
      { id: 'c', status: 'ready' as const },
    ];
    const each = rows.map((r) => rowProgress(r, now));
    expect(overallProgress(rows, now)).toBeCloseTo((each[0]! + each[1]! + each[2]!) / 3);
    // Rows at ~78 % with nothing finished: the header is no longer an empty bar.
    expect(overallProgress(rows.slice(0, 2), now)).toBeGreaterThan(0.7);
    expect(overallProgress([], now)).toBe(0);
  });
});

describe('13 bulk rows: pictures', () => {
  it('shows the local pick of a draft, else the uploaded original (a piece crop), else the image', () => {
    rememberLocalPreviews(['d1', 'd2'], ['file://a.jpg', 'file://b.jpg']);
    expect(processingPreview({ id: 'd2', imageUrl: 'https://x/clean.png', originalImageUrl: 'https://x/orig.jpg' })).toBe('file://b.jpg');
    expect(processingPreview({ id: 'p1', imageUrl: 'https://x/crop.jpg', originalImageUrl: 'https://x/orig.jpg' })).toBe('https://x/orig.jpg');
    expect(processingPreview({ id: 'p2', imageUrl: 'https://x/crop.jpg', originalImageUrl: null })).toBe('https://x/crop.jpg');
    expect(processingPreview({ id: 'p3', imageUrl: null, originalImageUrl: null })).toBeNull();
  });

  it('does not guess a pairing when the server answered a different number of drafts', () => {
    rememberLocalPreviews(['g1'], ['file://a.jpg', 'file://b.jpg']);
    expect(processingPreview({ id: 'g1', imageUrl: null, originalImageUrl: null })).toBeNull();
  });

  it('the cleaned image fades in once, only for a draft watched while processing', () => {
    expect(shouldRevealClean('d1')).toBe(false);
    markProcessing('d1');
    expect(shouldRevealClean('d1')).toBe(true);
    markCleanRevealed('d1');
    expect(shouldRevealClean('d1')).toBe(false);
  });
});
