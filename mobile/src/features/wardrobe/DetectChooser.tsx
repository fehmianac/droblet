import { Image } from 'expo-image';
import { Check, CircleAlert, Pencil } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import type { ItemDraft } from '@/api/contracts/wardrobe';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { placeholderTones } from '@/theme/tokens';

import { isLowConfidence } from './detect';
import { CautionBadge } from './ItemForm';
import { ItemThumb } from './ItemThumb';

type Props = {
  /** The group photo (the boxes are drawn on it) and its pixel size. */
  photoUrl: string | null;
  photoSize: { width: number; height: number } | null;
  /** The detected pieces, by their number. */
  pieces: ItemDraft[];
  selection: Set<string>;
  /** Pieces the user already edited in 12c. */
  edited: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: (all: boolean) => void;
  onEdit: (id: string) => void;
  onAdd: () => void;
  onDiscard: () => void;
  adding: boolean;
  notice: string | null;
};

function pieceName(piece: ItemDraft, fallback: string): string {
  return piece.suggestion?.name?.trim() || fallback;
}

/** The photo with a numbered outline per piece: ticked pieces solid ink, unticked ones faded. */
function PhotoWithBoxes({ photoUrl, photoSize, pieces, selection }: Pick<Props, 'photoUrl' | 'photoSize' | 'pieces' | 'selection'>) {
  const { t } = useTranslation();
  const ratio = photoSize ? photoSize.width / photoSize.height : 3 / 4;
  return (
    <View
      className="w-full max-w-[300px] self-center overflow-hidden rounded-image-lg"
      style={{ aspectRatio: ratio, backgroundColor: placeholderTones.stage }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('itemDetect.photoA11y', { count: pieces.length })}
      testID="detect-photo"
    >
      {photoUrl ? <Image source={{ uri: photoUrl }} contentFit="cover" style={{ width: '100%', height: '100%' }} /> : null}
      {pieces.map((piece) =>
        piece.box ? (
          <View
            key={piece.id}
            pointerEvents="none"
            testID={`detect-box-${piece.index ?? 0}`}
            className={`absolute rounded-[6px] border-2 ${selection.has(piece.id) ? 'border-ink' : 'border-paper opacity-70'}`}
            style={{
              left: `${piece.box.x * 100}%`,
              top: `${piece.box.y * 100}%`,
              width: `${piece.box.width * 100}%`,
              height: `${piece.box.height * 100}%`,
            }}
          >
            <View
              className={`absolute -left-0.5 -top-0.5 h-5 min-w-5 items-center justify-center rounded-[5px] px-1 ${selection.has(piece.id) ? 'bg-ink' : 'bg-paper'}`}
            >
              <Text variant="caption" tone={selection.has(piece.id) ? 'cream' : 'ink'} className="text-[11px]">
                {piece.index}
              </Text>
            </View>
          </View>
        ) : null,
      )}
    </View>
  );
}

function PieceRow({
  piece,
  checked,
  edited,
  onToggle,
  onEdit,
}: {
  piece: ItemDraft;
  checked: boolean;
  edited: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const s = piece.suggestion;
  const name = pieceName(piece, t('itemDetect.pieceFallback', { n: piece.index ?? 0 }));
  const meta = [s?.subcategory || (s?.category ? t(`itemCategory.${s.category}`) : null), s?.color ? t(`itemColor.${s.color}`) : null]
    .filter(Boolean)
    .join(' · ');
  const low = isLowConfidence(piece);
  return (
    <View className="flex-row items-center gap-3 rounded-menu border border-line bg-paper p-2.5" testID={`detect-piece-${piece.index ?? 0}`}>
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={t('itemDetect.editA11y', { name })}
        accessibilityHint={low ? t('itemDetect.checkHint') : undefined}
        className="min-h-icon-btn flex-1 flex-row items-center gap-3 active:opacity-80"
      >
        <View>
          <ItemThumb
            category={s?.category ?? 'accessory'}
            color={s?.color ?? 'other'}
            uri={piece.imageUrl}
            className="h-[62px] w-[52px] rounded-thumb"
            glyphSize={28}
          />
          <View className="absolute -left-1 -top-1 h-5 min-w-5 items-center justify-center rounded-[5px] bg-ink px-1">
            <Text variant="caption" tone="cream" className="text-[11px]">
              {piece.index}
            </Text>
          </View>
        </View>
        <View className="flex-1 gap-0.5">
          <Text variant="bodyMedium" numberOfLines={1}>
            {name}
          </Text>
          {meta ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
          <View className="flex-row flex-wrap gap-1.5 pt-1">
            {low && !edited ? <CautionBadge label={t('itemDetect.check')} /> : null}
            {edited ? (
              <View className="flex-row items-center gap-1">
                <Icon icon={Pencil} size={12} tone="muted" />
                <Text variant="caption" tone="muted">
                  {t('itemDetect.edited')}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
      <Pressable
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityLabel={t('itemDetect.checkboxA11y', { name })}
        accessibilityState={{ checked }}
        hitSlop={10}
        className="h-icon-btn w-8 items-center justify-center"
        testID={`detect-check-${piece.index ?? 0}`}
      >
        <View className={`h-[22px] w-[22px] items-center justify-center rounded-[5px] border ${checked ? 'border-ink bg-ink' : 'border-muted bg-paper'}`}>
          {checked ? <Icon icon={Check} size={15} tone="cream" /> : null}
        </View>
      </Pressable>
    </View>
  );
}

/**
 * "Fotoğrafta N parça bulduk" — the photo with numbered outlines, then one row per piece (plain crop,
 * name, category · colour, "Kontrol et" when the AI was unsure) with its checkbox. Doubtful pieces start
 * unticked; "Tümünü seç / Hiçbirini" flips all; a row opens 12c to edit the piece before it is added.
 * Static layout: nothing animates, so reduced motion needs no special case.
 */
export function DetectChooser({ photoUrl, photoSize, pieces, selection, edited, onToggle, onSelectAll, onEdit, onAdd, onDiscard, adding, notice }: Props) {
  const { t } = useTranslation();
  const count = pieces.filter((p) => selection.has(p.id)).length;
  const allSelected = count === pieces.length;
  return (
    <>
      <ScrollView contentContainerClassName="gap-4 px-gutter pb-8 pt-1" testID="detect-chooser">
        <PhotoWithBoxes photoUrl={photoUrl} photoSize={photoSize} pieces={pieces} selection={selection} />
        <View className="gap-1.5" accessibilityLiveRegion="polite">
          <Text variant="h2" accessibilityRole="header">
            {t('itemDetect.found', { count: pieces.length })}
          </Text>
          <Text variant="body" tone="muted">
            {t('itemDetect.foundBody')}
          </Text>
        </View>
        <View className="flex-row items-center justify-end gap-2">
          <Button
            variant="text"
            label={t(allSelected ? 'itemDetect.selectNone' : 'itemDetect.selectAll')}
            onPress={() => onSelectAll(!allSelected)}
            testID="detect-select-all"
          />
        </View>
        {notice ? (
          <View
            className="flex-row items-start gap-2 rounded-image-lg bg-sand p-3"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            testID="detect-notice"
          >
            <Icon icon={CircleAlert} size={16} tone="danger" />
            <Text variant="caption" className="flex-1">
              {notice}
            </Text>
          </View>
        ) : null}
        <View className="gap-2">
          {pieces.map((piece) => (
            <PieceRow
              key={piece.id}
              piece={piece}
              checked={selection.has(piece.id)}
              edited={edited.has(piece.id)}
              onToggle={() => onToggle(piece.id)}
              onEdit={() => onEdit(piece.id)}
            />
          ))}
        </View>
        <Button variant="text" label={t('itemDetect.discard')} onPress={onDiscard} testID="detect-discard" />
      </ScrollView>
      <BottomActionBar>
        <Button
          size="lg"
          label={count > 0 ? t('itemDetect.add', { count }) : t('itemDetect.addNone')}
          disabled={count === 0}
          loading={adding}
          onPress={onAdd}
          testID="detect-add"
        />
      </BottomActionBar>
    </>
  );
}
