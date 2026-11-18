import { router } from 'expo-router';
import { CircleAlert, Ellipsis, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react-native';
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
import { Chip, ChipWrap } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { CreditConfirmSheet } from '@/features/credits/CreditConfirmSheet';
import { useStartTryOn } from '@/features/tryon/api';
import { formatTry } from '@/lib/format';
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
};

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/wardrobe/looks');
}

/**
 * 15 Look oluştur — name, occasion, five slots (min 2 pieces to save), slot picker sheet, and
 * "Üzerimde gör" behind the credit confirmation. Also the edit mode of a saved look.
 */
export function LookEditor({ look, initialSlots, skippedCount = 0, items }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const writes = useLookWrites();
  const tryOn = useStartTryOn();

  const [name, setName] = useState(look?.name ?? '');
  const [occasion, setOccasion] = useState<Occasion>(look?.occasion ?? 'office');
  const [slots, setSlots] = useState<SlotMap>(initialSlots);
  const [sheetSlot, setSheetSlot] = useState<LookSlotKind | null>(null);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [tryOnNote, setTryOnNote] = useState<'offline' | 'failed' | null>(null);

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

  const onTryOnPress = () => {
    if (!online) {
      setTryOnNote('offline');
      return;
    }
    setTryOnNote(null);
    setConfirm(true);
  };

  const onTryOnConfirm = () => {
    void (async () => {
      const id = save();
      try {
        const { jobId } = await tryOn.start({ kind: 'look', id });
        setConfirm(false);
        router.replace({ pathname: '/tryon/[jobId]', params: { jobId, title: draft.name } });
      } catch {
        setConfirm(false);
        setTryOnNote('failed');
        // The look itself is saved (or queued): continue in edit mode.
        if (!look) router.setParams({ id });
      }
    })();
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
        onLeadingPress={leave}
        right={look ? <IconButton icon={Ellipsis} variant="plain" onPress={() => setMenu(true)} accessibilityLabel={t('lookEditor.more')} /> : undefined}
      />
      <OfflineBanner />
      <ScrollView contentContainerClassName="gap-5 px-gutter pb-8 pt-1" keyboardShouldPersistTaps="handled">
        <View className="flex-row gap-4">
          <LookCover
            tryOnImageUrl={dirty ? null : look?.tryOnImageUrl}
            slots={slotList(slots)}
            itemsById={itemsById}
            className="aspect-[4/5] w-[42%] rounded-image-lg"
          >
            <ImageTag label={t('lookEditor.previewTag')} className="absolute bottom-2 left-2" />
          </LookCover>
          <View className="flex-1 justify-center gap-2">
            <Text variant="eyebrow">{t('lookEditor.counterEyebrow', { count, total: LOOK_SLOTS.length })}</Text>
            <Text variant="caption" tone="muted">
              {t('lookEditor.minHint', { count: LOOK_MIN_PIECES })}
            </Text>
            {count === 0 ? (
              <Text variant="caption" tone="muted">
                {t('lookEditor.previewEmpty')}
              </Text>
            ) : null}
          </View>
        </View>

        <TextField
          label={t('lookEditor.name')}
          placeholder={t('lookEditor.namePlaceholder')}
          value={name}
          onChangeText={setName}
          maxLength={60}
          returnKeyType="done"
        />

        <View className="gap-2">
          <Text variant="bodyMedium">{t('lookEditor.occasion')}</Text>
          <ChipWrap>
            {LOOK_OCCASIONS.map((o) => (
              <Chip key={o} label={t(`occasion.${o}`)} selected={occasion === o} onPress={() => setOccasion(o)} />
            ))}
          </ChipWrap>
        </View>

        <View className="gap-2">
          <Button variant="secondary" icon={Sparkles} label={t('lookEditor.tryOn')} onPress={onTryOnPress} disabled={!savable} />
          {tryOnNote ? (
            <View className="flex-row items-center gap-1.5" accessibilityLiveRegion="polite">
              <Icon icon={CircleAlert} size={14} tone="danger" />
              <Text variant="caption" tone="danger" className="flex-1">
                {t(tryOnNote === 'offline' ? 'lookEditor.tryOnOffline' : 'lookEditor.tryOnFailed')}
              </Text>
            </View>
          ) : null}
        </View>

        {skippedCount > 0 ? (
          <Text variant="caption" tone="muted">
            {t('lookEditor.skipped', { count: skippedCount })}
          </Text>
        ) : null}

        <View className="gap-2.5">
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
                  className="min-h-[76px] flex-row items-center gap-3 rounded-card border border-dashed border-line p-3 active:opacity-70"
                >
                  <View className="h-14 w-12 items-center justify-center rounded-[8px] bg-sand">
                    <Icon icon={Plus} tone="muted" />
                  </View>
                  <View className="flex-1 gap-0.5">
                    <Text variant="caption" tone="muted">
                      {slotLabel}
                    </Text>
                    <Text variant="body" tone="muted">
                      {t('lookEditor.slotEmpty')}
                    </Text>
                  </View>
                </Pressable>
              );
            }
            return (
              <View
                key={kind}
                className={`min-h-[76px] flex-row items-center gap-3 rounded-card border bg-paper p-3 ${slot.deleted ? 'border-danger' : 'border-line'}`}
              >
                <SlotThumb slot={slot} itemsById={itemsById} className="h-14 w-12 rounded-[8px]" glyphSize={22} />
                <View className="flex-1 gap-0.5">
                  <Text variant="caption" tone="muted">
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
                      {formatTry(slot.price)}
                    </Text>
                  ) : null}
                </View>
                <IconButton icon={RefreshCw} onPress={() => setSheetSlot(kind)} accessibilityLabel={t('lookEditor.changeSlot', { slot: slotLabel })} />
              </View>
            );
          })}
        </View>
      </ScrollView>

      <BottomActionBar>
        <View className="gap-2">
          {savable ? null : (
            <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
              {hasDeletedPiece(slots) ? t('lookEditor.saveHintDeleted') : t('lookEditor.saveHint', { count: LOOK_MIN_PIECES })}
            </Text>
          )}
          <Button label={t('lookEditor.save')} onPress={onSave} disabled={!savable} testID="look-save" />
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
      <CreditConfirmSheet visible={confirm} onClose={() => setConfirm(false)} cost={1} onConfirm={onTryOnConfirm} confirming={tryOn.isStarting} />
      <PopoverMenu
        visible={menu}
        onClose={() => setMenu(false)}
        top={insets.top + 52}
        actions={[{ key: 'delete', label: t('lookEditor.delete'), icon: Trash2, destructive: true, onPress: confirmDelete }]}
      />
    </Screen>
  );
}
