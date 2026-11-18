import { Check, Plus, type LucideIcon } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { ITEM_SEASONS, type Item, type ItemSeason } from '@/api/contracts/wardrobe';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip, ChipWrap } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { Skeleton, SkeletonGrid } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';

import { toggleIn } from './filters';
import { ItemThumb } from './ItemThumb';

/** The picture a piece is shown with: the cleaned image, or the original when the user chose it. */
export function itemImage(item: Pick<Item, 'imageUrl' | 'originalImageUrl' | 'useOriginalImage'>): string | null {
  return item.useOriginalImage ? (item.originalImageUrl ?? item.imageUrl) : item.imageUrl;
}

type PanelProps = {
  icon?: LucideIcon;
  title: string;
  body?: string;
  children?: ReactNode;
};

/** Full-area state inside a screen that is not a list (13 before any photo): the `Durum*` layout — 96 sand circle, headline, one sentence, actions. */
export function StatePanel({ icon, title, body, children }: PanelProps) {
  return (
    <View className="flex-1 items-center justify-center gap-4 px-gutter pb-16 pt-6" accessibilityLiveRegion="polite">
      {icon ? (
        <View className="h-24 w-24 items-center justify-center rounded-pill bg-sand">
          <Icon icon={icon} size={40} />
        </View>
      ) : null}
      <View className="gap-2 px-4">
        <Text variant="h2" className="text-center">
          {title}
        </Text>
        {body ? (
          <Text variant="body" tone="muted" className="text-center">
            {body}
          </Text>
        ) : null}
      </View>
      {children ? <View className="w-full gap-2 px-4">{children}</View> : null}
    </View>
  );
}

/**
 * Loading state of every 3-column piece grid (`DurumYukleniyor`): four chip-shaped boxes (64 · 52 · 52 · 72)
 * and 3 × 3 tiles of 128 with a short line under each.
 */
export function ItemGridSkeleton({ rows = 3, chips = true, tileClassName }: { rows?: number; chips?: boolean; tileClassName?: string }) {
  return (
    <View className="gap-3.5 px-gutter pt-1">
      {chips ? (
        <View className="flex-row gap-2">
          {['w-16', 'w-[52px]', 'w-[52px]', 'w-[72px]'].map((w, i) => (
            <Skeleton key={i} className={`h-chip rounded-pill ${w}`} />
          ))}
        </View>
      ) : null}
      <SkeletonGrid rows={rows} tileClassName={tileClassName} />
    </View>
  );
}

/** Outlined 22-high pill for a filter that is not narrowing the list ("Tüm renkler" on board 10). */
export function OutlineBadge({ label }: { label: string }) {
  return (
    <View className="h-badge justify-center self-start rounded-pill border border-line px-2">
      <Text variant="badge" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

type TileProps = {
  item: Pick<Item, 'name' | 'category' | 'color' | 'imageUrl' | 'originalImageUrl' | 'useOriginalImage'>;
  /** undefined = not in selection mode. */
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  /**
   * `select` — board 10 in multi-select: a 22 dot, ink when chosen. `add` — board 12b: the dot carries a
   * plus, and a check on ink once chosen.
   */
  mark?: 'select' | 'add';
  /** Picture height: 128 on board 10 (default), 96 on board 12b. */
  size?: 'grid' | 'library';
};

/** Grid tile of a piece: picture + name; in selection mode a 2 pt ink ring and the dot in the top-right corner. */
export function ItemTile({ item, selected, onPress, onLongPress, mark = 'select', size = 'grid' }: TileProps) {
  const { t } = useTranslation();
  const selecting = selected !== undefined;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole={selecting ? 'checkbox' : 'button'}
      accessibilityState={selecting ? { checked: selected } : undefined}
      accessibilityLabel={selecting ? t(selected ? 'a11y.itemSelected' : 'a11y.selectItem', { name: item.name }) : item.name}
      accessibilityHint={selecting || !onLongPress ? undefined : t('items.longPressHint')}
      className={`flex-1 active:opacity-80 ${size === 'library' ? 'gap-[5px]' : 'gap-1.5'}`}
    >
      <View>
        <ItemThumb
          category={item.category}
          color={item.color}
          uri={itemImage(item)}
          glyphSize={size === 'library' ? 44 : 48}
          className={`w-full rounded-image border-2 ${size === 'library' ? 'h-24' : 'h-[128px]'} ${selected ? 'border-ink' : 'border-transparent'}`}
        />
        {selecting ? (
          <View
            className={`absolute right-1.5 top-1.5 h-[22px] w-[22px] items-center justify-center rounded-pill ${
              mark === 'add' ? `border border-line ${selected ? 'bg-ink' : 'bg-paper'}` : `border-[1.5px] border-paper ${selected ? 'bg-ink' : 'bg-paper/70'}`
            }`}
          >
            {mark === 'add' ? <Icon icon={selected ? Check : Plus} tone={selected ? 'cream' : 'ink'} size={12} /> : null}
          </View>
        ) : null}
      </View>
      <Text variant="caption" numberOfLines={2} className="leading-4">
        {item.name}
      </Text>
    </Pressable>
  );
}

/** Pads a list so the last row of a 3-column FlatList keeps its column widths. */
export function padToColumns<T>(data: T[], columns = 3): (T | null)[] {
  const rest = data.length % columns;
  return rest === 0 ? data : [...data, ...Array.from({ length: columns - rest }, () => null)];
}

type SeasonChipsProps = { value: ItemSeason[]; onChange: (next: ItemSeason[]) => void };

export function SeasonChips({ value, onChange }: SeasonChipsProps) {
  const { t } = useTranslation();
  return (
    <ChipWrap>
      {ITEM_SEASONS.map((season) => (
        <Chip key={season} label={t(`itemSeason.${season}`)} selected={value.includes(season)} onPress={() => onChange(toggleIn(value, season))} />
      ))}
    </ChipWrap>
  );
}

type SeasonSheetProps = {
  visible: boolean;
  onClose: () => void;
  initial: ItemSeason[];
  onSave: (seasons: ItemSeason[]) => void;
};

/** "Sezonu değiştir" (11 ⋯ menu, 10 multi-select). At least one season must stay selected. */
export function SeasonSheet({ visible, onClose, initial, onSave }: SeasonSheetProps) {
  const { t } = useTranslation();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('items.seasonSheetTitle')}>
      {visible ? <SeasonSheetBody initial={initial} onSave={onSave} /> : null}
    </BottomSheet>
  );
}

function SeasonSheetBody({ initial, onSave }: Pick<SeasonSheetProps, 'initial' | 'onSave'>) {
  const { t } = useTranslation();
  const [seasons, setSeasons] = useState<ItemSeason[]>(initial);
  return (
    <View className="gap-4">
      <SeasonChips value={seasons} onChange={setSeasons} />
      <Text variant="caption" tone={seasons.length === 0 ? 'danger' : 'muted'} accessibilityLiveRegion="polite">
        {t('items.seasonSheetHint')}
      </Text>
      <Button label={t('items.save')} onPress={() => onSave(seasons)} disabled={seasons.length === 0} />
    </View>
  );
}

type ConfirmProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
};

/** Destructive confirmation: says what happens and that it cannot be undone; danger colour + text. */
export function DeleteConfirmSheet({ visible, onClose, title, body, confirmLabel, onConfirm }: ConfirmProps) {
  const { t } = useTranslation();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <View className="gap-5">
        <Text variant="body" tone="muted">
          {body}
        </Text>
        <View className="gap-2">
          <Button variant="danger" label={confirmLabel} onPress={onConfirm} />
          <Button variant="secondary" size="lg" label={t('common.cancel')} onPress={onClose} />
        </View>
      </View>
    </BottomSheet>
  );
}
