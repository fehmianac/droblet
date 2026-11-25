import { Check, Plus, X } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { itemImageSource } from '@/api/imageSources';
import type { TripDay } from '@/api/contracts/trips';
import { ITEM_CATEGORIES, type Item, type ItemCategory } from '@/api/contracts/wardrobe';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { toDisplayUpper } from '@/lib/upper';

import { DAY_BOX_CATEGORIES, DAY_BOXES, dayBoxOf, type DayBox } from './logic';

type GridProps = {
  items: Item[];
  /** Pieces already on the list (19c): dimmed, tagged "Bavulda", not selectable. */
  listed?: ReadonlySet<string>;
  selected: readonly string[];
  onToggle: (id: string) => void;
};

/** The three-column wardrobe grid of 19c, under its category chips. */
function PieceGrid({ items, listed, selected, onToggle }: GridProps) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<ItemCategory | 'all'>('all');
  const categories = ITEM_CATEGORIES.filter((c) => items.some((i) => i.category === c));
  const shown = category === 'all' ? items : items.filter((i) => i.category === category);
  if (items.length === 0) {
    return (
      <Text variant="body" tone="muted" className="py-6 text-center" testID="trip-picker-empty">
        {t('tripDetail.manual.pickerEmpty')}
      </Text>
    );
  }
  return (
    <View className="gap-3.5">
      {categories.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-gutter" contentContainerClassName="gap-1.5 px-gutter">
          <Chip label={t('tripDetail.manual.all')} selected={category === 'all'} onPress={() => setCategory('all')} />
          {categories.map((c) => (
            <Chip key={c} label={t(`itemCategory.${c}`)} selected={category === c} onPress={() => setCategory(c)} />
          ))}
        </ScrollView>
      ) : null}
      <ScrollView className="max-h-[380px]" contentContainerClassName="flex-row flex-wrap -mx-[5px]">
        {shown.map((item) => {
          const onList = listed?.has(item.id) ?? false;
          const picked = selected.includes(item.id);
          return (
            <Pressable
              key={item.id}
              onPress={() => onToggle(item.id)}
              disabled={onList}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: picked, disabled: onList }}
              accessibilityLabel={onList ? t('tripDetail.manual.onListA11y', { name: item.name }) : item.name}
              testID={`trip-pick-${item.id}`}
              className="w-1/3 gap-[5px] px-[5px] pb-2.5 active:opacity-70"
            >
              <View className={onList ? 'opacity-40' : ''}>
                <ItemThumb
                  category={item.category}
                  color={item.color}
                  {...itemImageSource(item, 'thumb')}
                  className={`h-[112px] w-full rounded-image ${picked ? 'border-2 border-ink' : ''}`}
                  glyphSize={30}
                />
              </View>
              {picked ? (
                <View className="absolute right-[11px] top-1.5 h-[22px] w-[22px] items-center justify-center rounded-pill bg-ink">
                  <Icon icon={Check} size={13} tone="cream" />
                </View>
              ) : null}
              {onList ? (
                <View className="absolute bottom-[38px] left-[11px] h-5 justify-center rounded-pill bg-cream px-[7px]">
                  <Text variant="caption" className="text-[10.5px]">
                    {t('tripDetail.manual.onList')}
                  </Text>
                </View>
              ) : null}
              <Text variant="caption" tone={onList ? 'muted' : 'ink'} numberOfLines={2} className="min-h-[30px]">
                {item.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

type PickerProps = {
  visible: boolean;
  /** "Paris · 22 – 24 Eki" under the title. */
  subtitle: string;
  items: Item[];
  listed: ReadonlySet<string>;
  onClose: () => void;
  onAdd: (itemIds: string[]) => void;
};

/** 19c "Gardıroptan ekle": pieces of the wardrobe onto the packing list, several at once. No AI call, no credit. */
export function TripItemPicker({ visible, subtitle, items, listed, onClose, onAdd }: PickerProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>([]);
  const close = () => {
    setSelected([]);
    onClose();
  };
  return (
    <BottomSheet visible={visible} onClose={close} title={t('tripDetail.manual.pickerTitle')}>
      <View className="gap-3.5" testID="trip-picker">
        <Text variant="caption" tone="muted">
          {subtitle}
        </Text>
        <PieceGrid
          items={items}
          listed={listed}
          selected={selected}
          onToggle={(id) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
        />
        <Button
          label={selected.length > 0 ? t('tripDetail.manual.addCount', { count: selected.length }) : t('tripDetail.manual.addNone')}
          disabled={selected.length === 0}
          onPress={() => {
            onAdd(selected);
            close();
          }}
          testID="trip-picker-add"
        />
      </View>
    </BottomSheet>
  );
}

type DayProps = {
  day: TripDay | null;
  /** "CUM 23 EKİ · 15° / 11° · YAĞMUR %80". */
  meta: string;
  items: Item[];
  /** Pieces on the packing list now. */
  listed: ReadonlySet<string>;
  onClose: () => void;
  onSave: (day: TripDay, itemIds: string[]) => void;
};

/** How many pieces a box holds in a day (server `OutfitSlotRules`). */
const BOX_CAPACITY: Record<DayBox, number> = { top: 3, bottom: 1, outerwear: 1, shoes: 1, bag: 1, socks: 1, accessory: 4 };
/** The boxes the editor always shows; socks and accessories appear when the day has them. */
const MAIN_BOXES: readonly DayBox[] = ['top', 'bottom', 'outerwear', 'shoes', 'bag'];

/**
 * 19d "Günün parçaları": the pieces of one trip day, box by box — change one, take one out, fill an empty box. The
 * picker (one piece of the box's kind) opens inside the same sheet. Saving costs nothing; the day's "on you" image
 * follows the pieces, so a changed day has none until the user asks for it again.
 */
export function TripDayEditSheet({ day, meta, items, listed, onClose, onSave }: DayProps) {
  return (
    <BottomSheet visible={day !== null} onClose={onClose}>
      {/* Keyed by the wardrobe too: a sheet opened before the wardrobe arrived starts over with the day's pieces. */}
      {day ? <DayEditor key={`${day.date}:${items.length}`} day={day} meta={meta} items={items} listed={listed} onClose={onClose} onSave={onSave} /> : null}
    </BottomSheet>
  );
}

function DayEditor({ day, meta, items, listed, onSave }: DayProps & { day: TripDay }) {
  const { t } = useTranslation();
  const language = useAppLanguage();
  const byId = new Map(items.map((i) => [i.id, i]));
  const initial = (day.itemIds ?? []).filter((id) => byId.has(id));
  const [ids, setIds] = useState<string[]>(initial);
  const [picking, setPicking] = useState<{ box: DayBox; replace: string | null } | null>(null);

  const pieces = ids.flatMap((id) => byId.get(id) ?? []);
  const inBox = (box: DayBox) => pieces.filter((p) => dayBoxOf(p.category) === box);
  const boxes = DAY_BOXES.filter((box) => MAIN_BOXES.includes(box) || inBox(box).length > 0);
  const joining = pieces.filter((p) => !listed.has(p.id));
  const changed = ids.length !== initial.length || ids.some((id, i) => id !== initial[i]);

  if (picking) {
    const candidates = items.filter((i) => DAY_BOX_CATEGORIES[picking.box].includes(i.category) && (!ids.includes(i.id) || i.id === picking.replace));
    return (
      <View className="gap-3.5" testID="trip-day-pick">
        <View className="flex-row items-center justify-between">
          <Text variant="h2">{t('tripDetail.manual.pickFor', { box: t(`tripDetail.manual.box.${picking.box}`) })}</Text>
          <Pressable onPress={() => setPicking(null)} accessibilityRole="button" accessibilityLabel={t('common.cancel')} className="h-11 w-11 items-center justify-center active:opacity-70">
            <Icon icon={X} size={20} />
          </Pressable>
        </View>
        <PieceGrid
          items={candidates}
          selected={picking.replace ? [picking.replace] : []}
          onToggle={(id) => {
            setIds((prev) => (picking.replace ? prev.map((x) => (x === picking.replace ? id : x)) : [...prev, id]));
            setPicking(null);
          }}
        />
      </View>
    );
  }

  return (
    <View className="gap-3" testID="trip-day-edit">
      <View className="gap-1">
        <Text variant="eyebrow">{toDisplayUpper(meta, language)}</Text>
        <Text variant="h2">{t('tripDetail.manual.dayTitle')}</Text>
      </View>
      <View>
        {boxes.map((box) => {
          const held = inBox(box);
          const label = toDisplayUpper(t(`tripDetail.manual.box.${box}`), language);
          return (
            <View key={box}>
              {held.map((item) => (
                <View key={item.id} className="min-h-[56px] flex-row items-center gap-3 border-b border-line py-2.5">
                  <ItemThumb category={item.category} color={item.color} {...itemImageSource(item, 'thumb')} className="h-12 w-11 rounded-[8px]" glyphSize={18} />
                  <View className="flex-1">
                    <Text variant="eyebrow" className="text-[10px]">
                      {label}
                    </Text>
                    <Text variant="body" numberOfLines={1} className="text-[14.5px]">
                      {item.name}
                    </Text>
                  </View>
                  <Chip label={t('tripDetail.manual.change')} onPress={() => setPicking({ box, replace: item.id })} accessibilityLabel={t('tripDetail.manual.changeA11y', { name: item.name })} testID={`trip-day-change-${item.id}`} />
                  <Pressable
                    onPress={() => setIds((prev) => prev.filter((x) => x !== item.id))}
                    accessibilityRole="button"
                    accessibilityLabel={t('tripDetail.manual.dayRemoveA11y', { name: item.name })}
                    testID={`trip-day-remove-${item.id}`}
                    className="h-11 w-9 items-center justify-center active:opacity-70"
                  >
                    <Icon icon={X} size={18} tone="muted" />
                  </Pressable>
                </View>
              ))}
              {held.length < BOX_CAPACITY[box] && (held.length === 0 || box === 'top' || box === 'accessory') ? (
                <Pressable
                  onPress={() => setPicking({ box, replace: null })}
                  accessibilityRole="button"
                  accessibilityLabel={t('tripDetail.manual.pickFor', { box: t(`tripDetail.manual.box.${box}`) })}
                  testID={`trip-day-add-${box}`}
                  className="min-h-[56px] flex-row items-center gap-3 border-b border-line py-2.5 active:opacity-70"
                >
                  <View className="h-12 w-11 items-center justify-center rounded-[8px] border border-dashed border-accent">
                    <Icon icon={Plus} size={18} tone="accent" />
                  </View>
                  <View className="flex-1">
                    <Text variant="eyebrow" className="text-[10px]">
                      {label}
                    </Text>
                    <Text variant="body" tone="muted" className="text-[14.5px]">
                      {held.length === 0 ? t('tripDetail.manual.empty') : t('tripDetail.manual.addLayer')}
                    </Text>
                  </View>
                  <Text variant="chip" tone="accent">
                    {t('tripDetail.manual.pick')}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
      {joining.length > 0 ? (
        <View className="rounded-field bg-sand px-3 py-2.5" testID="trip-day-joining">
          <Text variant="caption" className="text-[13px]">
            {t('tripDetail.manual.joins', { count: joining.length, name: joining[0]?.name ?? '' })}
          </Text>
        </View>
      ) : null}
      <Text variant="caption" tone="muted">
        {ids.length === 0 ? t('tripDetail.manual.dayNeedsPiece') : t('tripDetail.manual.dayCostNote')}
      </Text>
      <Button label={t('tripDetail.manual.daySave')} disabled={!changed || ids.length === 0} onPress={() => onSave(day, ids)} testID="trip-day-save-edit" />
    </View>
  );
}
