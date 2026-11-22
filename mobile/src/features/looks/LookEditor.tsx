import { router } from 'expo-router';
import { CircleAlert, Ellipsis, MirrorRound, Plus, RefreshCw, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Occasion } from '@/api/contracts';
import { LOOK_MIN_PIECES, LOOK_SLOTS, type Look, type LookSlotKind } from '@/api/contracts/looks';
import type { Item } from '@/api/contracts/wardrobe';
import { ImageTag, PopoverMenu } from '@/components/ui/Bits';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { CreditConfirmSheet } from '@/features/credits/CreditConfirmSheet';
import { useSpendConfirm } from '@/features/credits/spendConfirm';
import { useCachedTryOn } from '@/features/tryon/cached';
import { RequirementHint, StepCountBadge } from '@/features/requirements/RequirementHint';
import { useGate } from '@/features/requirements/useRequirements';
import { ensureTryOnConsent, TRY_ON_CREDIT_COST, useStartTryOn } from '@/features/tryon/api';
import { formatMoney } from '@/lib/format';
import { useIsOnline } from '@/sync/network';

import { useLookWrites, type LookDraft } from './api';
import { indexItems, LookCover, SlotThumb } from './LookCover';
import { canSaveLook, filledCount, hasDeletedPiece, LOOK_OCCASIONS, sameSlots, slotList, toSlotInputs, type SlotMap } from './logic';
import { SlotSheet } from './SlotSheet';

type Props = {
  /** The saved look when editing; null when creating. */
  look: Look | null;
  initialSlots: SlotMap;
  /** Pieces from the multi-select that could not be placed (their slot was already taken). */
  skippedCount?: number;
  items: Item[] | undefined;
  /** "Üzerimde gör" failed just before this editor mounted (a new look's try-on, then edit mode). */
  initialTryOnNote?: 'failed' | null;
  /** The occasion a new look starts with ("Kendi parçalarımla kur" on an Akış post); ignored when editing. */
  initialOccasion?: Occasion | null;
};

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/wardrobe/looks');
}

/**
 * 15 Look oluştur — name, occasion, five slots (min 2 pieces to save), slot picker sheet, and
 * "Üzerimde gör" behind the credit confirmation. Also the edit mode of a saved look.
 */
export function LookEditor({ look, initialSlots, skippedCount = 0, items, initialTryOnNote, initialOccasion = null }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const writes = useLookWrites();
  const tryOn = useStartTryOn();

  const [name, setName] = useState(look?.name ?? '');
  const [occasion, setOccasion] = useState<Occasion>(look?.occasion ?? initialOccasion ?? 'office');
  const [slots, setSlots] = useState<SlotMap>(initialSlots);
  const [sheetSlot, setSheetSlot] = useState<LookSlotKind | null>(null);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [tryOnNote, setTryOnNote] = useState<'offline' | 'failed' | null>(initialTryOnNote ?? null);

  // 13d: a saved, unchanged look whose image already exists opens it — no credit sheet, nothing charged.
  const cachedTryOn = useCachedTryOn(look ? { kind: 'look', id: look.id } : null);

  const itemsById = indexItems(items);
  const count = filledCount(slots);
  const savable = canSaveLook(slots);
  const draft: LookDraft = { name: name.trim() || t('lookEditor.defaultName'), occasion, slots };
  const dirty =
    !look || look.name !== draft.name || look.occasion !== occasion || !sameSlots(toSlotInputs(slots), look.slots);

  /** Saves through the queue and returns the look's id. */
  const save = (): string => {
    if (!look) return writes.create(draft);
    if (dirty) writes.update(look, draft);
    return look.id;
  };

  const onSave = () => {
    save();
    leave();
  };

  const onTryOnConfirm = () => {
    void (async () => {
      let savedId: string | null = look?.id ?? null;
      try {
        // The job needs the look on the server: wait for its write before starting.
        if (!look) savedId = await writes.createNow(draft);
        else if (dirty) await writes.updateNow(look, draft);
        const { jobId } = await tryOn.start({ kind: 'look', id: savedId ?? '' });
        setConfirm(false);
        router.replace({ pathname: '/tryon/[jobId]', params: { jobId, title: draft.name } });
      } catch {
        setConfirm(false);
        setTryOnNote('failed');
        // A new look that was saved continues in edit mode; the note travels along (the editor remounts there).
        if (!look && savedId) router.setParams({ id: savedId, tryOn: 'failed' });
      }
    })();
  };

  // Canvas 11a: what "Üzerimde gör" still needs is said under it; tapping opens the flow, which resumes here. Then the
  // credit confirmation only when it has something to say (first try-on, low balance), else the try-on starts.
  const spend = useSpendConfirm();
  const gate = useGate(
    'tryOn',
    () => void ensureTryOnConsent().then((ok) => ok && spend(TRY_ON_CREDIT_COST, { confirm: () => setConfirm(true), start: onTryOnConfirm })),
    { origin: t(look ? 'lookEditor.titleEdit' : 'lookEditor.titleNew') },
  );

  const onTryOnPress = () => {
    if (!online) {
      setTryOnNote('offline');
      return;
    }
    setTryOnNote(null);
    if (look && !dirty && cachedTryOn.cachedJobId) {
      router.replace({ pathname: '/tryon/[jobId]', params: { jobId: cachedTryOn.cachedJobId, title: draft.name } });
      return;
    }
    gate.run();
  };

  const confirmDelete = () => {
    if (!look) return;
    Alert.alert(t('lookEditor.deleteTitle'), t('lookEditor.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('lookEditor.deleteConfirm'),
        style: 'destructive',
        onPress: () => {
          writes.remove(look);
          leave();
        },
      },
    ]);
  };

  return (
    <Screen>
      <ScreenHeader
        title={t(look ? 'lookEditor.titleEdit' : 'lookEditor.titleNew')}
        leading="close"
        leadingVariant="outline"
        onLeadingPress={leave}
        right={look ? <IconButton icon={Ellipsis} variant="plain" onPress={() => setMenu(true)} accessibilityLabel={t('lookEditor.more')} /> : undefined}
      />
      <ScrollView contentContainerClassName="gap-3 px-gutter pb-8 pt-1" keyboardShouldPersistTaps="handled">
        <View className="flex-row gap-3">
          <LookCover
            tryOnImageUrl={dirty ? null : look?.tryOnImageUrl}
            slots={slotList(slots)}
            itemsById={itemsById}
            figureHeight={150}
            className="h-[228px] w-[140px] rounded-image-lg"
          >
            <ImageTag label={t('lookEditor.previewTag')} className="absolute bottom-2 left-2" />
          </LookCover>
          <View className="flex-1 justify-between gap-2.5">
            <TextField
              label={t('lookEditor.name')}
              placeholder={t('lookEditor.namePlaceholder')}
              value={name}
              onChangeText={setName}
              maxLength={60}
              returnKeyType="done"
              testID="look-name"
            />
            <View className="gap-1.5">
              <Text variant="label">{t('lookEditor.occasion')}</Text>
              <View className="flex-row flex-wrap gap-1.5">
                {LOOK_OCCASIONS.map((o) => (
                  <Chip key={o} label={t(`occasion.${o}`)} selected={occasion === o} onPress={() => setOccasion(o)} />
                ))}
              </View>
            </View>
            <View className="gap-1.5">
              <View>
                <Button
                  variant="secondary"
                  icon={MirrorRound}
                  label={t('lookEditor.tryOn')}
                  detail={t('ai.creditCost', { count: TRY_ON_CREDIT_COST })}
                  onPress={onTryOnPress}
                  loading={tryOn.isStarting && !confirm}
                  disabled={!savable}
                  testID="look-try-on"
                />
                {gate.count > 0 ? (
                  <View className="absolute -right-1 -top-1" pointerEvents="none">
                    <StepCountBadge count={gate.count} />
                  </View>
                ) : null}
              </View>
              <RequirementHint hint={savable ? gate.hint : null} onPress={onTryOnPress} testID="look-try-on-hint" />
            </View>
          </View>
        </View>

        {tryOnNote ? (
          <View className="flex-row items-center gap-1.5" accessibilityLiveRegion="polite">
            <Icon icon={CircleAlert} size={14} tone="danger" />
            <Text variant="caption" tone="danger" className="flex-1">
              {t(tryOnNote === 'offline' ? 'lookEditor.tryOnOffline' : 'lookEditor.tryOnFailed')}
            </Text>
          </View>
        ) : null}

        <View className="flex-row items-center justify-between gap-3">
          <Text variant="eyebrow">{t('lookEditor.counterEyebrow', { count, total: LOOK_SLOTS.length })}</Text>
          <Text variant="caption" tone="muted">
            {t('lookEditor.minHint', { count: LOOK_MIN_PIECES })}
          </Text>
        </View>

        {skippedCount > 0 ? (
          <Text variant="caption" tone="muted">
            {t('lookEditor.skipped', { count: skippedCount })}
          </Text>
        ) : null}

        <View className="gap-2">
          {LOOK_SLOTS.map((kind) => {
            const slot = slots[kind];
            const slotLabel = t(`lookSlot.${kind}`);
            if (!slot) {
              return (
                <Pressable
                  key={kind}
                  onPress={() => setSheetSlot(kind)}
                  accessibilityRole="button"
                  accessibilityLabel={t('lookEditor.addSlot', { slot: slotLabel })}
                  accessibilityHint={t('lookEditor.slotEmpty')}
                  testID={`look-slot-${kind}`}
                  className="flex-row items-center gap-3 rounded-menu border-[1.5px] border-dashed border-muted/60 px-2.5 py-2 active:opacity-70"
                >
                  <View className="h-[52px] w-11 items-center justify-center rounded-thumb bg-sand">
                    <Icon icon={Plus} size={18} tone="muted" />
                  </View>
                  <View className="flex-1 gap-0.5">
                    <Text variant="caption" tone="muted" className="text-[11px]">
                      {slotLabel}
                    </Text>
                    <Text variant="body" tone="muted" numberOfLines={1}>
                      {t('lookEditor.slotEmpty')}
                    </Text>
                  </View>
                </Pressable>
              );
            }
            return (
              <View
                key={kind}
                className={`flex-row items-center gap-3 rounded-menu border bg-paper px-2.5 py-2 ${slot.deleted ? 'border-danger' : 'border-line'}`}
              >
                <SlotThumb slot={slot} itemsById={itemsById} className="h-[52px] w-11 rounded-thumb" glyphSize={22} />
                <View className="flex-1 gap-0.5">
                  <Text variant="caption" tone="muted" className="text-[11px]">
                    {slot.source === 'store' ? t('lookEditor.slotFromStore', { slot: slotLabel }) : slotLabel}
                  </Text>
                  <Text variant="bodyMedium" numberOfLines={2}>
                    {slot.name || t('lookEditor.deletedPiece')}
                  </Text>
                  {slot.deleted ? (
                    <View className="flex-row items-center gap-1.5">
                      <Icon icon={CircleAlert} size={14} tone="danger" />
                      <Text variant="caption" tone="danger" className="flex-1">
                        {t('lookEditor.deletedHint')}
                      </Text>
                    </View>
                  ) : slot.price !== null ? (
                    <Text variant="caption" tone="accent">
                      {formatMoney(slot.price)}
                    </Text>
                  ) : null}
                </View>
                <IconButton
                  icon={RefreshCw}
                  variant="plain"
                  iconSize={18}
                  onPress={() => setSheetSlot(kind)}
                  accessibilityLabel={t('lookEditor.changeSlot', { slot: slotLabel })}
                />
              </View>
            );
          })}
        </View>
      </ScrollView>

      <BottomActionBar>
        <View className="flex-row items-center gap-2.5">
          <Text variant="caption" tone="muted" className="flex-1" accessibilityLiveRegion="polite">
            {hasDeletedPiece(slots) ? t('lookEditor.saveHintDeleted') : t('lookEditor.saveHint', { count: LOOK_MIN_PIECES })}
          </Text>
          <Button size="bar" label={t('lookEditor.save')} onPress={onSave} disabled={!savable} className="px-7" testID="look-save" />
        </View>
      </BottomActionBar>

      <SlotSheet
        slot={sheetSlot}
        current={sheetSlot ? slots[sheetSlot] : undefined}
        items={items}
        onClose={() => setSheetSlot(null)}
        onPick={(picked) => {
          setSlots((prev) => ({ ...prev, [picked.slot]: picked }));
          setSheetSlot(null);
        }}
        onRemove={() => {
          if (sheetSlot) {
            setSlots((prev) => {
              const next = { ...prev };
              delete next[sheetSlot];
              return next;
            });
          }
          setSheetSlot(null);
        }}
      />
      <CreditConfirmSheet visible={confirm} onClose={() => setConfirm(false)} cost={TRY_ON_CREDIT_COST} onConfirm={onTryOnConfirm} confirming={tryOn.isStarting} />
      <PopoverMenu
        visible={menu}
        onClose={() => setMenu(false)}
        top={insets.top + 52}
        actions={[{ key: 'delete', label: t('lookEditor.delete'), icon: Trash2, destructive: true, onPress: confirmDelete }]}
      />
    </Screen>
  );
}
