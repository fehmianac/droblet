import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { ItemDraft } from '@/api/contracts/wardrobe';
import { toItemDraft, toItemDrafts, type ItemDraftWire } from '@/api/wire/wardrobe';
import i18n from '@/i18n';

import {
  chooserState,
  defaultSelection,
  detectedPieces,
  isLowConfidence,
  isReviewable,
  pendingGroups,
  resolveSelection,
  selectAll,
  selectedIds,
  toggle,
} from './detect';
import { DetectChooser } from './DetectChooser';
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

function Harness({ pieces, onAdd }: { pieces: ItemDraft[]; onAdd: (ids: string[]) => void }) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const selection = resolveSelection(pieces, overrides, new Set());
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <DetectChooser
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
      />
    </SafeAreaProvider>
  );
}

describe('DetectChooser', () => {
  const pieces = detectedPieces(toItemDrafts({ drafts: [groupWire, ...pieceWires], total: 1, processed: 1 }), GROUP);

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
