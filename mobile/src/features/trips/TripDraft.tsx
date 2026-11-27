import { Minus, Pencil, Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { itemImageSource } from '@/api/imageSources';
import type { TripDay, TripDetail, TripEdit, TripItem, TripPlan } from '@/api/contracts/trips';
import { ITEM_CATEGORIES } from '@/api/contracts/wardrobe';
import { InfoNote } from '@/components/ui/Bits';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { showToast } from '@/components/ui/toast/store';
import { useLooks } from '@/features/looks/queries';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';
import { useItems } from '@/features/wardrobe/queries';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { formatDate, formatDateRange, formatTemperature, parseLocalDate } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';

import { useTripWrites } from './api';
import { applyTripEdit, groupByCategory } from './logic';
import { TripDayEditSheet, TripItemPicker, TripLookPicker } from './TripEditing';

type Props = {
  trip: TripDetail;
  jobId: string;
  /** The list as the stylist made it. */
  plan: TripPlan;
  online: boolean;
  onRegenerate: () => void;
};

/**
 * 19e: the draft list, changeable before it is accepted — the days' pieces (19d, 19f), pieces onto and off the list
 * (19c, 19f). The changes live on this screen only; "Listeyi onayla" saves the list with them (the acceptance, then
 * each change). No AI call, no credit. Checking rows, "Üzerimde gör" and "Diğer eşyalar" start after the acceptance.
 */
export function TripDraft({ trip, jobId, plan, online, onRegenerate }: Props) {
  const { t } = useTranslation();
  const language = useAppLanguage();
  const writes = useTripWrites();
  const wardrobeData = useItems().data;
  const wardrobe = useMemo(() => wardrobeData ?? [], [wardrobeData]);
  const looks = useLooks().data ?? [];
  const [edits, setEdits] = useState<TripEdit[]>([]);
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState<'pieces' | 'look' | null>(null);
  const [editDay, setEditDay] = useState<TripDay | null>(null);
  const [removing, setRemoving] = useState<TripItem | null>(null);
  const [askRegenerate, setAskRegenerate] = useState(false);

  const byId = useMemo(() => new Map(wardrobe.map((i) => [i.id, i])), [wardrobe]);
  const draft = useMemo(
    () => edits.reduce<TripDetail>((detail, edit) => applyTripEdit(detail, edit, (id) => byId.get(id)), { ...trip, ...plan }),
    [edits, trip, plan, byId],
  );
  const listed = new Set(draft.items.map((i) => i.itemId));
  const rows = groupByCategory(draft.items, ITEM_CATEGORIES).flatMap((group) => group.items);
  const days = draft.days.filter((d) => d.look);
  const wearsOf = (item: TripItem) => draft.days.filter((d) => (d.itemIds ?? []).includes(item.itemId)).length;
  const originalDay = (date: string) => (plan.days.find((d) => d.date === date)?.itemIds ?? []).join(',');
  const push = (edit: TripEdit) => setEdits((prev) => [...prev, edit]);
  const subtitle = `${trip.cityName} · ${formatDateRange(parseLocalDate(trip.startDate), parseLocalDate(trip.endDate))}`;

  const dayMeta = (day: TripDay) => {
    const weather = trip.forecast?.find((f) => f.date === day.date);
    const max = weather ? (weather.maxC ?? weather.temperatureC) : null;
    const min = weather ? (weather.minC ?? weather.temperatureC) : null;
    return {
      date: formatDate(parseLocalDate(day.date), { weekday: 'short', day: 'numeric', month: 'short' }),
      temperature:
        max === null || min === null ? null : max === min ? formatTemperature(max) : t('tripDetail.dayTemp', { max: formatTemperature(max), min: formatTemperature(min) }),
      rain: weather?.rainChance != null ? t('tripDetail.dayRain', { chance: weather.rainChance }) : null,
    };
  };

  const remove = (item: TripItem) => {
    // A piece a day wears leaves that day too: asked first. Otherwise it goes at once, with an undo.
    if (wearsOf(item) > 0) {
      setRemoving(item);
      return;
    }
    const edit: TripEdit = { kind: 'removeItem', itemId: item.itemId };
    push(edit);
    showToast({
      message: t('tripDetail.manual.removed', { name: item.name }),
      action: { label: t('tripDetail.manual.undo'), onPress: () => setEdits((prev) => prev.filter((e) => e !== edit)) },
      testID: 'trip-item-removed',
    });
  };

  const regenerate = () => {
    setAskRegenerate(false);
    setEdits([]);
    onRegenerate();
  };

  return (
    <View className="gap-5" testID="trip-draft">
      <View className="gap-1.5 rounded-card border border-line bg-paper p-3.5">
        <Text variant="eyebrow">{t('tripDetail.draftEyebrow')}</Text>
        <Text variant="h3" testID="trip-draft-summary">
          {t('tripDetail.summary', { pieces: t('trips.pieces', { count: draft.items.length }), looks: t('tripDetail.looks', { count: days.length }) })}
        </Text>
        <Text variant="body" tone="muted">
          {t('tripDetail.manual.draftBody')}
        </Text>
      </View>

      {days.length > 0 ? (
        <View className="gap-2.5">
          <Text variant="h2">{t('tripDetail.manual.days')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-gutter" contentContainerClassName="gap-2.5 px-gutter">
            {days.map((day) => {
              const meta = dayMeta(day);
              const pieces = (day.itemIds ?? []).flatMap((id) => byId.get(id) ?? []);
              const changed = (day.itemIds ?? []).join(',') !== originalDay(day.date);
              return (
                <View key={day.date} className="w-[200px] gap-2.5 rounded-card border border-line bg-paper p-3" testID={`trip-draft-day-${day.date}`}>
                  <View className="flex-row items-start justify-between">
                    <View className="gap-1">
                      <Text variant="eyebrow">{toDisplayUpper(meta.date, language)}</Text>
                      {meta.rain ? (
                        <Text variant="caption" tone="muted">
                          {meta.rain}
                        </Text>
                      ) : null}
                    </View>
                    {meta.temperature ? (
                      <Text variant="bodyMedium" className="text-[14px]">
                        {meta.temperature}
                      </Text>
                    ) : null}
                  </View>
                  <View
                    className="h-[150px] flex-row flex-wrap content-between justify-between"
                    accessible
                    accessibilityLabel={pieces.map((p) => p.name).join(', ')}
                  >
                    {pieces.slice(0, 4).map((item) => (
                      <ItemThumb key={item.id} category={item.category} color={item.color} {...itemImageSource(item, 'thumb')} className="h-[72px] w-[48%] rounded-[10px]" glyphSize={22} />
                    ))}
                  </View>
                  {changed ? (
                    <View className="self-start rounded-tag bg-sand px-[7px] py-1" testID={`trip-draft-day-changed-${day.date}`}>
                      <Text variant="tag">{t('tripDetail.manual.changedByYou')}</Text>
                    </View>
                  ) : null}
                  <Pressable
                    onPress={() => setEditDay(day)}
                    accessibilityRole="button"
                    accessibilityLabel={`${meta.date}: ${t('tripDetail.manual.dayEdit')}`}
                    className="min-h-icon-btn flex-row items-center gap-1.5 active:opacity-70"
                    testID={`trip-draft-day-edit-${day.date}`}
                  >
                    <Icon icon={Pencil} size={16} tone="accent" />
                    <Text variant="label" tone="accent">
                      {t('tripDetail.manual.dayEdit')}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      <View>
        <View className="flex-row items-center justify-between border-b border-line pb-1.5">
          <View>
            <Text variant="h2">{t('tripDetail.listTitle')}</Text>
            <Text variant="caption" tone="muted">
              {t('trips.pieces', { count: draft.items.length })}
            </Text>
          </View>
          <Pressable
            onPress={() => setEditing((on) => !on)}
            accessibilityRole="button"
            accessibilityState={{ selected: editing }}
            className="min-h-icon-btn justify-center pl-3 active:opacity-70"
            testID="trip-draft-edit"
          >
            <Text variant="label" tone="accent">
              {editing ? t('tripDetail.manual.done') : t('tripDetail.manual.edit')}
            </Text>
          </Pressable>
        </View>
        {rows.map((item) => {
          const wears = wearsOf(item);
          return (
            <Pressable
              key={item.itemId}
              onPress={() => remove(item)}
              disabled={!editing}
              accessibilityRole={editing ? 'button' : undefined}
              accessibilityLabel={editing ? t('tripDetail.manual.removeA11y', { name: item.name }) : item.name}
              testID={editing ? `trip-draft-remove-${item.itemId}` : `trip-draft-item-${item.itemId}`}
              className="min-h-icon-btn flex-row items-center gap-3 border-b border-line py-2 active:opacity-70"
            >
              {editing ? (
                <View className="h-7 w-7 items-center justify-center rounded-pill border-[1.5px] border-danger">
                  <Icon icon={Minus} size={16} tone="danger" />
                </View>
              ) : null}
              <ItemThumb category={item.category} color={item.color} {...itemImageSource(item, 'thumb')} className="h-12 w-11 rounded-[8px]" glyphSize={18} />
              <View className="flex-1">
                <Text variant="body" numberOfLines={2}>
                  {item.name}
                </Text>
                {wears > 0 || item.addedByUser ? (
                  <Text variant="caption" tone="muted" className="text-[12px]" testID={`trip-draft-note-${item.itemId}`}>
                    {item.addedByUser && wears === 0 ? t('tripDetail.manual.addedByYou') : t('tripDetail.manual.wornDays', { count: wears })}
                  </Text>
                ) : null}
              </View>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {t(`itemCategory.${item.category}`)}
              </Text>
            </Pressable>
          );
        })}
        {editing ? (
          <>
            <Pressable
              onPress={() => setPicker('pieces')}
              accessibilityRole="button"
              testID="trip-draft-add-items"
              className="min-h-[52px] flex-row items-center gap-2.5 border-b border-line active:opacity-70"
            >
              <Icon icon={Plus} size={18} tone="accent" />
              <Text variant="bodyMedium" tone="accent" className="text-[14.5px]">
                {t('tripDetail.manual.addFromWardrobe')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setPicker('look')}
              accessibilityRole="button"
              testID="trip-draft-add-look"
              className="min-h-[52px] flex-row items-center gap-2.5 border-b border-line active:opacity-70"
            >
              <Icon icon={Plus} size={18} tone="accent" />
              <Text variant="bodyMedium" tone="accent" className="text-[14.5px]">
                {t('tripDetail.manual.addFromLook')}
              </Text>
            </Pressable>
          </>
        ) : null}
      </View>

      {plan.missing.map((m) => (
        <InfoNote key={m.id} text={t('tripDetail.missingNoteLine', { name: m.name, reason: m.reason })} />
      ))}

      <View className="gap-2">
        <Button
          label={t('tripDetail.acceptDraft')}
          onPress={() => writes.acceptPack(trip.id, jobId, plan, { trip, edits, items: wardrobe })}
          testID="pack-accept"
        />
        <Button
          variant="secondary"
          label={t('tripDetail.regenerate')}
          onPress={() => (edits.length > 0 ? setAskRegenerate(true) : onRegenerate())}
          disabled={!online}
          testID="pack-regenerate"
        />
      </View>

      <TripItemPicker
        visible={picker === 'pieces'}
        subtitle={subtitle}
        items={wardrobe}
        listed={listed}
        onClose={() => setPicker(null)}
        onAdd={(itemIds) => push({ kind: 'addItems', itemIds })}
      />
      <TripLookPicker
        visible={picker === 'look'}
        subtitle={subtitle}
        looks={looks}
        items={wardrobe}
        listed={listed}
        onClose={() => setPicker(null)}
        onAdd={(itemIds) => push({ kind: 'addItems', itemIds })}
      />
      <TripDayEditSheet
        day={editDay}
        meta={editDay ? Object.values(dayMeta(editDay)).filter(Boolean).join(' · ') : ''}
        items={wardrobe}
        listed={listed}
        looks={looks}
        onClose={() => setEditDay(null)}
        onSave={(day, itemIds) => {
          push({ kind: 'setDay', date: day.date, itemIds });
          setEditDay(null);
        }}
      />

      <BottomSheet visible={removing !== null} onClose={() => setRemoving(null)} title={removing ? t('tripDetail.manual.removeTitle', { name: removing.name }) : undefined}>
        <View className="gap-3.5">
          <Text variant="body" tone="muted">
            {t('tripDetail.manual.removeBody', { count: removing ? wearsOf(removing) : 0 })}
          </Text>
          <Button
            variant="danger"
            label={t('tripDetail.manual.removeConfirm')}
            onPress={() => {
              if (removing) push({ kind: 'removeItem', itemId: removing.itemId });
              setRemoving(null);
            }}
            testID="trip-draft-remove-confirm"
          />
          <Button variant="secondary" label={t('common.cancel')} onPress={() => setRemoving(null)} />
        </View>
      </BottomSheet>

      <BottomSheet visible={askRegenerate} onClose={() => setAskRegenerate(false)} title={t('tripDetail.manual.regenTitle')}>
        <View className="gap-3.5">
          <Text variant="body" tone="muted">
            {t('tripDetail.manual.regenBody')}
          </Text>
          <Button label={t('tripDetail.regenerate')} onPress={regenerate} testID="pack-regenerate-confirm" />
          <Button variant="secondary" label={t('common.cancel')} onPress={() => setAskRegenerate(false)} />
        </View>
      </BottomSheet>
    </View>
  );
}
