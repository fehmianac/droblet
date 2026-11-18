import { Check, type LucideIcon } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { ITEM_SEASONS, type Item, type ItemSeason } from '@/api/contracts/wardrobe';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip, ChipWrap } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
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

/** Full-area state (empty / error / offline) as drawn on the `Durum*` boards: icon, headline, one sentence, actions. */
export function StatePanel({ icon, title, body, children }: PanelProps) {
  return (
    <View className="flex-1 items-center justify-center gap-4 px-gutter py-10" accessibilityLiveRegion="polite">
      {icon ? (
        <View className="h-16 w-16 items-center justify-center rounded-pill bg-sand">
          <Icon icon={icon} size={28} tone="muted" />
        </View>
      ) : null}
      <View className="gap-2">
        <Text variant="h2" className="text-center">
          {title}
        </Text>
        {body ? (
          <Text variant="body" tone="muted" className="text-center">
            {body}
          </Text>
        ) : null}
      </View>
      {children ? <View className="w-full gap-2 pt-2">{children}</View> : null}
    </View>
  );
}

/** Loading state of every 3-column piece grid: skeleton tiles shaped like the content. */
export function ItemGridSkeleton({ rows = 3, chips = true }: { rows?: number; chips?: boolean }) {
  return (
    <View className="gap-4 px-gutter pt-1">
      {chips ? (
        <View className="flex-row gap-2">
          {['w-16', 'w-14', 'w-14', 'w-20'].map((w, i) => (
            <Skeleton key={i} className={`h-chip rounded-pill ${w}`} />
          ))}
        </View>
      ) : null}
      {Array.from({ length: rows }, (_, row) => (
        <View key={row} className="flex-row gap-3">
          {[0, 1, 2].map((col) => (
            <View key={col} className="flex-1 gap-2">
              <Skeleton className="aspect-[4/5] w-full rounded-image" />
              <Skeleton className="h-2.5 w-4/5 rounded-[5px]" />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

type TileProps = {
  item: Pick<Item, 'name' | 'category' | 'color' | 'imageUrl' | 'originalImageUrl' | 'useOriginalImage'>;
  /** undefined = not in selection mode. */
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
};

/** Grid tile of a piece: picture + one-line name; in selection mode a ring and a check dot. */
export function ItemTile({ item, selected, onPress, onLongPress }: TileProps) {
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
      className="flex-1 gap-1.5 active:opacity-80"
    >
      <View>
        <ItemThumb
          category={item.category}
          color={item.color}
          uri={itemImage(item)}
          className={`aspect-[4/5] w-full rounded-image border-2 ${selected ? 'border-ink' : 'border-transparent'}`}
        />
        {selecting ? (
          <View
            className={`absolute right-2 top-2 h-6 w-6 items-center justify-center rounded-pill ${selected ? 'bg-ink' : 'border border-line bg-paper/70'}`}
          >
            {selected ? <Icon icon={Check} tone="paper" size={14} /> : null}
          </View>
        ) : null}
      </View>
      <Text variant="caption" numberOfLines={1}>
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
          <Pressable
            onPress={onConfirm}
            accessibilityRole="button"
            accessibilityLabel={confirmLabel}
            className="h-btn-primary items-center justify-center rounded-pill bg-danger px-6 active:opacity-80"
          >
            <Text variant="button" tone="paper" numberOfLines={1}>
              {confirmLabel}
            </Text>
          </Pressable>
          <Button variant="secondary" label={t('common.cancel')} onPress={onClose} />
        </View>
      </View>
    </BottomSheet>
  );
}
