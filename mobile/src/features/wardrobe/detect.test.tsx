import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { ItemDraft } from '@/api/contracts/wardrobe';
import { toItemDraft, toItemDrafts, type ItemDraftWire } from '@/api/wire/wardrobe';
import i18n from '@/i18n';

import {
  boxRevealDelays,
  chooserState,
  defaultSelection,
  detectProgress,
  detectStageIndex,
  placeChips,
  detectedPieces,
  isLowConfidence,
  isReviewable,
  pendingGroups,
  resolveSelection,
  selectAll,
  selectedIds,
  toggle,
} from './detect';
import { DetectChooser, type DetectPhase } from './DetectChooser';
import { toDetectedEditWire } from './mutations';

const GROUP = '01JGROUP0000000000000000AA';

function wire(overrides: Partial<ItemDraftWire>): ItemDraftWire {
  return {
    id: '01JDRAFT0000000000000000AA',
    kind: 'piece',
    status: 'detected',
    jobId: '01JJOB00000000000000000AAA',
    parentDraftId: GROUP,
    imageUrl: 'https://img/crop.jpg',
    originalImageUrl: 'https://img/crop.jpg',
    imageUrlExpiresAt: null,
    name: 'Parça',
    category: 'top',
    colorIds: ['white'],
    fabric: 'cotton',
    seasons: ['summer'],
    flaggedFields: [],
    needsReview: false,
    language: 'tr',
    createdAt: '2026-11-19T00:00:00Z',
    groupId: GROUP,
    confidence: 0.9,
    ...overrides,
  };
}

const groupWire = wire({ id: GROUP, kind: 'outfit', status: 'ready', parentDraftId: null, groupId: GROUP, itemCount: 4, photoWidth: 1024, photoHeight: 1536 });
const pieceWires: ItemDraftWire[] = [
  wire({ id: 'p1', index: 1, name: 'Beyaz tişört', category: 'top', subcategory: 't-shirt', box: { x: 0.05, y: 0.05, width: 0.45, height: 0.35 } }),
  wire({
    id: 'p2',
    index: 2,
    name: 'Altın kolye',
    category: 'accessory',
    subcategory: 'necklace',
    confidence: 0.55,
    needsReview: true,
    flaggedFields: ['category'],
    box: { x: 0.62, y: 0.08, width: 0.1, height: 0.08 },
  }),
  wire({
    id: 'p3',
    index: 3,
    name: 'Siyah çanta',
    category: 'bag',
    subcategory: 'tote',
    colorIds: ['black'],
    box: { x: 0.6, y: 0.4, width: 0.3, height: 0.25 },
  }),
  wire({
    id: 'p4',
    index: 4,
    name: 'Lacivert jean',
    category: 'bottom',
    subcategory: 'jeans',
    colorIds: ['navy'],
    box: { x: 0.1, y: 0.45, width: 0.35, height: 0.5 },
  }),
];

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});

describe('wire → draft group', () => {
  it('maps the group photo, its pieces, boxes and the sub-type name', () => {
    const drafts = toItemDrafts({ drafts: [groupWire, ...pieceWires], total: 1, processed: 1 });
    const group = drafts[0] as ItemDraft;
    expect(group).toMatchObject({ kind: 'group', groupId: GROUP, itemCount: 4, photoSize: { width: 1024, height: 1536 } });
    const necklace = drafts.find((d) => d.id === 'p2') as ItemDraft;
    expect(necklace).toMatchObject({ status: 'detected', kind: 'piece', groupId: GROUP, index: 2, confidence: 0.55, box: { x: 0.62 } });
    expect(necklace.suggestion?.subcategory).toBe('Kolye');
    expect(necklace.lowConfidence).toContain('category');
  });

  it('keeps the "nothing found" failure of a photo', () => {
    const empty = toItemDraft(wire({ id: 'e', kind: 'single', status: 'failed', failure: 'guardRejected', groupId: null, parentDraftId: null }));
    expect(empty).toMatchObject({ status: 'failed', failure: 'guardRejected' });
  });

  it('sends an edited sub-type name back as its id', () => {
    const row = toDetectedEditWire('p2', {
      name: 'Altın kolye',
      category: 'accessory',
      subcategory: 'Kolye',
      brand: null,
      size: null,
      color: 'beige',
      fabric: null,
      seasons: ['summer'],
      useOriginalImage: false,
    });
    expect(row).toMatchObject({ draftId: 'p2', subcategory: 'necklace', colorIds: ['beige'], seasons: ['summer'] });
  });
});

describe('chooser rules', () => {
  const drafts = toItemDrafts({ drafts: [groupWire, ...pieceWires], total: 1, processed: 1 });
  const pieces = detectedPieces(drafts, GROUP);

  it('ticks every confident piece and leaves the low-confidence one unticked', () => {
    expect(isLowConfidence(pieces[1] as ItemDraft)).toBe(true);
    expect([...defaultSelection(pieces)]).toEqual(['p1', 'p3', 'p4']);
  });

  it('select all ticks the doubtful piece too; none clears everything', () => {
    expect(selectAll(pieces, true).size).toBe(4);
    expect(selectAll(pieces, false).size).toBe(0);
    expect(selectedIds(pieces, toggle(defaultSelection(pieces), 'p3'))).toEqual(['p1', 'p4']);
  });

  it('a piece edited in the form counts as chosen, an explicit tap always wins', () => {
    expect([...resolveSelection(pieces, {}, new Set(['p2']))].sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect([...resolveSelection(pieces, { p2: false, p1: false }, new Set(['p2']))].sort()).toEqual(['p3', 'p4']);
  });

  it('opens the chooser for two or more pieces, the form for one, the empty state for none', () => {
    expect(chooserState(drafts, GROUP)).toBe('choose');
    expect(chooserState([toItemDraft(wire({ id: 's', kind: 'single', status: 'ready', groupId: null, parentDraftId: null }))], 's')).toBe('single');
    expect(chooserState([toItemDraft(wire({ id: 'e', kind: 'single', status: 'failed', failure: 'guardRejected', groupId: null }))], 'e')).toBe('empty');
    expect(chooserState([toItemDraft(wire({ id: 'f', kind: 'single', status: 'failed', failure: 'providerError', groupId: null }))], 'f')).toBe('failed');
    expect(chooserState([toItemDraft(wire({ id: 'u', kind: 'single', status: 'uploaded', groupId: null }))], 'u')).toBe('processing');
    expect(chooserState([], GROUP)).toBe('missing');
    // The choice was made: no piece waits any more.
    expect(chooserState([drafts[0] as ItemDraft], GROUP)).toBe('done');
  });

  it('the review list shows neither the group photo nor waiting pieces, but offers the group as a card', () => {
    const kept = toItemDraft(wire({ id: 'k', status: 'processing', selected: true }));
    const all = [...drafts, kept];
    expect(all.filter(isReviewable).map((d) => d.id)).toEqual(['k']);
    expect(pendingGroups(all).map((d) => d.id)).toEqual([GROUP]);
  });
});

function Harness({
  pieces,
  onAdd,
  phase,
  since,
  onRetry,
  onManual,
  onTryOnWhole,
}: {
  pieces: ItemDraft[];
  onAdd: (ids: string[]) => void;
  phase?: DetectPhase;
  since?: number;
  onRetry?: () => void;
  onManual?: () => void;
  onTryOnWhole?: () => void;
}) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const selection = resolveSelection(pieces, overrides, new Set());
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <DetectChooser
        phase={phase}
        since={since}
        onRetry={onRetry}
        onManual={onManual}
        photoUrl="https://img/photo.jpg"
        photoSize={{ width: 1024, height: 1536 }}
        pieces={pieces}
        selection={selection}
        edited={new Set()}
        onToggle={(id) => setOverrides((p) => ({ ...p, [id]: !selection.has(id) }))}
        onSelectAll={(all) => setOverrides(Object.fromEntries(pieces.map((p) => [p.id, all])))}
        onEdit={() => undefined}
        onAdd={() => onAdd(selectedIds(pieces, selection))}
        onDiscard={() => undefined}
        adding={false}
        notice={null}
        onTryOnWhole={onTryOnWhole}
      />
    </SafeAreaProvider>
  );
}

describe('DetectChooser', () => {
  const pieces = detectedPieces(toItemDrafts({ drafts: [groupWire, ...pieceWires], total: 1, processed: 1 }), GROUP);

  it('12d+ / 12f+: "Ayırmadan üzerimde dene" while the photo is scanned and next to the choice, only when offered', async () => {
    const tryOn = jest.fn();
    await render(<Harness pieces={[]} phase="loading" onAdd={() => undefined} onTryOnWhole={tryOn} />);
    expect(screen.getByText('Taramayı beklemeden, kombinin tamamı · 1 kredi')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('detect-tryon-whole'));
    expect(tryOn).toHaveBeenCalledTimes(1);

    await render(<Harness pieces={pieces} onAdd={() => undefined} onTryOnWhole={tryOn} />);
    expect(screen.getByText('Ayırmadan üzerimde dene · 1 kredi')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('detect-tryon-whole'));
    expect(tryOn).toHaveBeenCalledTimes(2);

    await render(<Harness pieces={pieces} onAdd={() => undefined} />);
    expect(screen.queryByTestId('detect-tryon-whole')).toBeNull();
  });

  it('shows "Fotoğrafta N parça bulduk", numbered boxes and the low-confidence badge unticked', async () => {
    await render(<Harness pieces={pieces} onAdd={() => undefined} />);
    expect(screen.getByText('Fotoğrafta 4 parça bulduk')).toBeTruthy();
    expect(screen.getByTestId('detect-box-2')).toBeTruthy();
    expect(screen.getByText('Kontrol et')).toBeTruthy();
    expect(screen.getByTestId('detect-check-2').props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByTestId('detect-check-1').props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByText('3 parçayı ekle')).toBeTruthy();
  });

  it('select all / none and the add button follow the selection', async () => {
    const onAdd = jest.fn();
    await render(<Harness pieces={pieces} onAdd={onAdd} />);
    await fireEvent.press(screen.getByTestId('detect-select-all'));
    expect(screen.getByText('4 parçayı ekle')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('detect-select-all'));
    expect(screen.getByText('Eklemek için parça seç')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('detect-check-2'));
    await fireEvent.press(screen.getByTestId('detect-add'));
    expect(onAdd).toHaveBeenCalledWith(['p2']);
  });
});

describe('the wait and the boxes appearing', () => {
  // The scan line is decorative (hidden from assistive tech): queries must include hidden elements.
  const HIDDEN = { includeHiddenElements: true };
  // Built after the language switch so sub-type names are Turkish ("Kolye").
  let pieces: ItemDraft[] = [];
  beforeAll(() => {
    pieces = detectedPieces(toItemDrafts({ drafts: [groupWire, ...pieceWires], total: 1, processed: 1 }), GROUP);
  });

  function setReduceMotion(value: boolean) {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(value);
  }

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('stage sentences follow the time since the photo was sent; the bar eases toward 90 % and completes on the result', () => {
    expect([0, 3499, 3500, 8000, 14000, 60000].map(detectStageIndex)).toEqual([0, 0, 1, 2, 3, 3]);
    expect(detectProgress(0)).toBe(0);
    expect(detectProgress(6000)).toBeGreaterThan(0.35);
    expect(detectProgress(120000)).toBeLessThan(0.9);
    expect(detectProgress(4000, true)).toBe(1);
  });

  it('boxes come 120 ms apart, all at once with reduce-motion', () => {
    expect(boxRevealDelays(4, true)).toEqual([0, 120, 240, 360]);
    expect(boxRevealDelays(4, false)).toEqual([0, 0, 0, 0]);
  });

  it('a chip that would cover another moves below its box', () => {
    // A shirt and the necklace at its collar: the necklace chip cannot sit on the shirt chip.
    const boxes = [
      { x: 0.3, y: 0.2, width: 0.4, height: 0.3 },
      { x: 0.43, y: 0.21, width: 0.13, height: 0.06 },
    ];
    expect(placeChips(boxes, ['1 · Gömlek', '2 · Kolye'], 300, 400)).toEqual(['inside-top', 'below']);
  });

  it('cycles the stage sentence over the photo with the scan line while the AI looks', async () => {
    jest.useFakeTimers();
    setReduceMotion(false);
    await render(<Harness pieces={[]} onAdd={() => undefined} phase="loading" since={Date.now()} />);
    expect(screen.getByTestId('detect-photo')).toBeTruthy();
    expect(screen.getByTestId('scan-line-sweeping', HIDDEN)).toBeTruthy();
    expect(screen.getByText('Üst ve altlar aranıyor…')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(screen.getByText('Ayakkabı ve çantalar aranıyor…')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByText('Takı ve aksesuarlar aranıyor…')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(30000);
    });
    // The last stage stays until the result; nothing loops.
    expect(screen.getByText('Neredeyse hazır…')).toBeTruthy();
    expect(screen.queryByTestId('detect-box-1')).toBeNull();
  });

  it('starts mid-way when 12 hands over after a few seconds', async () => {
    jest.useFakeTimers();
    setReduceMotion(false);
    await render(<Harness pieces={[]} onAdd={() => undefined} phase="loading" since={Date.now() - 6000} />);
    expect(screen.getByText('Ayakkabı ve çantalar aranıyor…')).toBeTruthy();
  });

  it('draws a labelled box per detected piece on the same photo, then the choice comes in', async () => {
    jest.useFakeTimers();
    setReduceMotion(false);
    const view = await render(<Harness pieces={pieces} onAdd={() => undefined} phase="loading" since={Date.now()} />);
    await view.rerender(<Harness pieces={pieces} onAdd={() => undefined} phase="choose" since={Date.now()} />);
    // Boxes from the backend's x / y / w / h, each with "N · tür".
    for (const n of [1, 2, 3, 4]) expect(screen.getByTestId(`detect-box-${n}`)).toBeTruthy();
    expect(screen.getByText('2 · Kolye')).toBeTruthy();
    expect(screen.getByTestId('detect-box-1').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ left: '5%', top: '5%', width: '45%' })]));
    // The bar completes first, the scan line is off; the list follows.
    expect(screen.getByTestId('detect-processing')).toBeTruthy();
    expect(screen.queryByTestId('scan-line-sweeping', HIDDEN)).toBeNull();
    expect(screen.queryByTestId('detect-add')).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(screen.queryByTestId('detect-processing')).toBeNull();
    expect(screen.getByText('Fotoğrafta 4 parça bulduk')).toBeTruthy();
    expect(screen.getByTestId('detect-add')).toBeTruthy();
  });

  it('with reduce-motion: no scan line, and the boxes and the list arrive at once', async () => {
    jest.useFakeTimers();
    setReduceMotion(true);
    const view = await render(<Harness pieces={pieces} onAdd={() => undefined} phase="loading" since={Date.now()} />);
    await act(async () => {
      jest.advanceTimersByTime(0);
    });
    expect(screen.queryByTestId('scan-line-sweeping', HIDDEN)).toBeNull();
    expect(screen.getByText('Üst ve altlar aranıyor…')).toBeTruthy();
    // The stage sentence still changes, without the fade.
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(screen.getByText('Ayakkabı ve çantalar aranıyor…')).toBeTruthy();
    await view.rerender(<Harness pieces={pieces} onAdd={() => undefined} phase="choose" since={Date.now()} />);
    expect(screen.queryByTestId('detect-processing')).toBeNull();
    expect(screen.getByTestId('detect-box-4')).toBeTruthy();
    expect(screen.getByText('Fotoğrafta 4 parça bulduk')).toBeTruthy();
  });

  it('nothing found keeps the photo, says why and offers retry and manual entry', async () => {
    const onRetry = jest.fn();
    const onManual = jest.fn();
    await render(<Harness pieces={[]} onAdd={() => undefined} phase="empty" onRetry={onRetry} onManual={onManual} />);
    expect(screen.getByTestId('detect-photo')).toBeTruthy();
    expect(screen.getByTestId('detect-photo-status')).toBeTruthy();
    expect(screen.getByText('Bu fotoğrafta parça bulamadık')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('detect-retry'));
    await fireEvent.press(screen.getByTestId('detect-manual'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onManual).toHaveBeenCalledTimes(1);
  });

  it('a failed photo stays on screen with the error and its actions', async () => {
    await render(<Harness pieces={[]} onAdd={() => undefined} phase="failed" onRetry={() => undefined} onManual={() => undefined} />);
    expect(screen.getByTestId('detect-photo')).toBeTruthy();
    expect(screen.getByText('Fotoğraf işlenemedi')).toBeTruthy();
    expect(screen.getByText('İŞLENEMEDİ')).toBeTruthy();
    expect(screen.getByTestId('detect-retry')).toBeTruthy();
    expect(screen.queryByTestId('scan-line-sweeping', HIDDEN)).toBeNull();
  });
});
