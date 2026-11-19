import { router, useLocalSearchParams } from 'expo-router';
import { CalendarCheck, ChevronRight, CircleAlert, Ellipsis, Heart, MirrorRound, Pencil, Share as ShareIcon, Star, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Look, LookSlot } from '@/api/contracts/looks';
import { useWearToday } from '@/api/today';
import { ImageTag, MissingTag, PopoverMenu } from '@/components/ui/Bits';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { StateMessage } from '@/components/ui/StateMessage';
import { Text } from '@/components/ui/Text';
import { CreditConfirmSheet } from '@/features/credits/CreditConfirmSheet';
import { useLookWrites } from '@/features/looks/api';
import { indexItems, LookCover, SlotThumb, type ItemsById } from '@/features/looks/LookCover';
import { lookPieceNames, missingPieceCount } from '@/features/looks/logic';
import { useLook } from '@/features/looks/queries';
import { ensureTryOnConsent, isConsentDeclined, TRY_ON_CREDIT_COST, useStartTryOn } from '@/features/tryon/api';
import { RequirementHint, StepCountBadge } from '@/features/requirements/RequirementHint';
import { useGate } from '@/features/requirements/useRequirements';
import { useItems } from '@/features/wardrobe/queries';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { formatMoney, formatNumber } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';
import { useIsOnline } from '@/sync/network';

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/wardrobe/looks');
}

/** One piece of the look, as the piece rows of 17: 40 × 48 thumb, name, where it comes from. */
function PieceRow({ slot, itemsById }: { slot: LookSlot; itemsById: ItemsById }) {
  const { t } = useTranslation();
  const missing = slot.source === 'store';
  const slotLabel = t(`lookSlot.${slot.slot}`);
  const name = slot.name || t('lookEditor.deletedPiece');
  const caption = slot.deleted
    ? t('lookDetail.pieceDeleted', { slot: slotLabel })
    : missing
      ? slot.price !== null
        ? t('lookDetail.pieceStorePrice', { price: formatMoney(slot.price) })
        : t('lookDetail.pieceStore')
      : t('lookDetail.pieceWardrobe', { slot: slotLabel });
  const open = slot.deleted
    ? undefined
    : missing
      ? () => router.push({ pathname: '/shop/product/[id]', params: { id: slot.refId } })
      : () => router.push({ pathname: '/item/[id]', params: { id: slot.refId } });

  const body = (
    <>
      <View className={`overflow-hidden rounded-[8px] ${missing ? 'border-[1.5px] border-dashed border-accent' : ''}`}>
        <SlotThumb slot={slot} itemsById={itemsById} className="h-12 w-10" glyphSize={20} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text variant="body" numberOfLines={1}>
          {name}
        </Text>
        <Text variant="caption" tone={slot.deleted ? 'danger' : missing ? 'accent' : 'muted'} numberOfLines={1} className={missing ? 'font-sans-medium' : ''}>
          {caption}
        </Text>
      </View>
    </>
  );

  if (missing && open) {
    // Canvas 17: the missing piece carries the accent "Look'u tamamla" chip instead of the chevron.
    return (
      <View className="min-h-[62px] flex-row items-center gap-3 border-b border-line py-[7px]">
        <View className="flex-1 flex-row items-center gap-3" accessible accessibilityLabel={t('lookDetail.pieceA11y', { name, detail: caption })}>
          {body}
        </View>
        <Pressable
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={t('lookDetail.completeLookA11y', { name })}
          hitSlop={{ top: 4, bottom: 4 }}
          className="h-chip items-center justify-center rounded-pill border border-accent px-[15px] active:opacity-80"
        >
          <Text variant="chip" tone="accent" numberOfLines={1}>
            {t('lookDetail.completeLook')}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      onPress={open}
      disabled={!open}
      accessibilityRole={open ? 'button' : undefined}
      accessibilityLabel={t('lookDetail.pieceA11y', { name, detail: caption })}
      className="min-h-[62px] flex-row items-center gap-3 border-b border-line py-[7px] active:opacity-70"
    >
      {body}
      {slot.deleted ? <Icon icon={CircleAlert} size={18} tone="danger" /> : <Icon icon={ChevronRight} size={18} tone="muted" />}
    </Pressable>
  );
}

function LookBody({ look, itemsById, note }: { look: Look; itemsById: ItemsById; note: string | null }) {
  const language = useAppLanguage();
  const { t } = useTranslation();
  const occasion = t(`occasion.${look.occasion}`);
  const rating = look.rating !== null ? formatNumber(look.rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : null;
  const side = look.slots.slice(0, 3);
  const missing = missingPieceCount(look);
  return (
    <ScrollView contentContainerClassName="gap-3 px-gutter pb-6 pt-1">
      <View className="flex-row gap-2.5">
        <LookCover
          seed={look.id}
          figureHeight={170}
          tryOnImageUrl={look.tryOnImageUrl}
          slots={look.slots}
          itemsById={itemsById}
          className="h-[264px] w-[200px] rounded-image-lg"
        >
          <ImageTag
            label={look.tryOnImageUrl ? t('aiBadge.onYou') : toDisplayUpper(occasion, language)}
            className="absolute bottom-2 left-2"
          />
        </LookCover>
        <View className="flex-1 gap-2">
          {side.map((slot) => {
            const store = slot.source === 'store';
            return (
              <View
                key={slot.slot}
                className={`h-[82px] overflow-hidden rounded-field ${store ? 'border-[1.5px] border-dashed border-accent' : ''}`}
                accessible={false}
                importantForAccessibility="no-hide-descendants"
              >
                <SlotThumb slot={slot} itemsById={itemsById} className="h-full w-full" glyphSize={30} />
                {store ? <MissingTag className="absolute right-1.5 top-1.5" /> : null}
              </View>
            );
          })}
        </View>
      </View>

      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text variant="eyebrow">
            {toDisplayUpper(t('lookDetail.eyebrow', { occasion, pieces: t('trips.pieces', { count: look.slots.length }) }), language)}
          </Text>
          <Text variant="h2">{look.name}</Text>
        </View>
        {rating ? (
          <View
            className="flex-row items-center gap-1 pt-1.5"
            accessible
            accessibilityLabel={t('lookDetail.ratingA11y', { rating, count: look.ratingCount })}
          >
            <Icon icon={Star} size={15} />
            <Text variant="bodyMedium">{rating}</Text>
            <Text variant="caption" tone="muted">
              {t('lookDetail.ratingCount', { count: look.ratingCount })}
            </Text>
          </View>
        ) : null}
      </View>

      {rating ? null : (
        <Text variant="caption" tone="muted">
          {t('lookDetail.noRating')}
        </Text>
      )}

      {note ? (
        <View className="flex-row items-center gap-1.5" accessibilityLiveRegion="polite">
          <Text variant="caption" tone="muted" className="flex-1">
            {note}
          </Text>
        </View>
      ) : null}

      <View>
        {look.slots.map((slot) => (
          <PieceRow key={slot.slot} slot={slot} itemsById={itemsById} />
        ))}
      </View>

      {missing > 0 ? (
        <Text variant="caption" tone="muted">
          {t('lookDetail.missingNote', { count: missing })}
        </Text>
      ) : null}
    </ScrollView>
  );
}

type Notice = 'tryOnOffline' | 'tryOnFailed' | 'worn' | null;

/**
 * Look detail — no dedicated board; derived from 17 Kombin önerisi (the board a look card of 14 opens):
 * cover + piece column, occasion eyebrow and name, friends' rating, piece rows, and a bottom action bar
 * (favourite · "Üzerimde gör" · edit). Share and the ⋯ menu (wear today, edit, delete) sit in the header.
 */
export default function LookScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const online = useIsOnline();
  const query = useLook(id);
  const items = useItems();
  const writes = useLookWrites();
  const tryOn = useStartTryOn();
  const wear = useWearToday();
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const look = query.data;
  const itemsById = indexItems(items.data);
  // Consent of the photo path first (normally already given), then the credit confirmation.
  const gate = useGate('tryOn', () => void ensureTryOnConsent().then((ok) => ok && setConfirm(true)), { origin: look?.name ?? null });

  if (deleted) {
    return (
      <Screen bottom>
        <ScreenHeader leading="back" onLeadingPress={leave} />
        <StateMessage message={t('lookDetail.deleted')} actionLabel={t('lookDetail.backToLooks')} onAction={() => router.replace('/wardrobe/looks')} />
      </Screen>
    );
  }

  const edit = () => router.push({ pathname: '/look/new', params: { id } });

  const share = () => {
    if (!look) return;
    const pieces = lookPieceNames(look)
      .map((name) => t('lookDetail.shareLine', { name }))
      .join('\n');
    void Share.share({ message: t('lookDetail.shareMessage', { name: look.name, occasion: t(`occasion.${look.occasion}`), pieces }) }).catch(() => undefined);
  };

  const onTryOnPress = () => {
    if (!online) {
      setNotice('tryOnOffline');
      return;
    }
    setNotice(null);
    // What is missing (photo, consent, membership…) opens the requirements flow, which comes back here (canvas 11).
    gate.run();
  };

  const startTryOn = () => {
    if (!look) return;
    void (async () => {
      try {
        const { jobId } = await tryOn.start({ kind: 'look', id: look.id });
        setConfirm(false);
        router.push({ pathname: '/tryon/[jobId]', params: { jobId, title: look.name, kind: 'look', id: look.id } });
      } catch (error) {
        setConfirm(false);
        if (!isConsentDeclined(error)) setNotice('tryOnFailed');
      }
    })();
  };

  const noteText =
    notice === 'tryOnOffline'
      ? t('lookEditor.tryOnOffline')
      : notice === 'tryOnFailed'
        ? t('lookDetail.tryOnFailed')
        : notice === 'worn'
          ? t('lookDetail.wornNotice')
          : null;

  return (
    <Screen bottom={!look}>
      <ScreenHeader
        title={look ? t(`occasion.${look.occasion}`) : undefined}
        leading="back"
        onLeadingPress={leave}
        right={
          look ? (
            <>
              <IconButton icon={ShareIcon} onPress={share} accessibilityLabel={t('lookDetail.share')} testID="look-share" />
              <IconButton icon={Ellipsis} variant="plain" onPress={() => setMenu(true)} accessibilityLabel={t('lookEditor.more')} />
            </>
          ) : undefined
        }
      />
      <ScreenState
        query={query}
        notFound={{ message: t('lookDetail.notFound'), actionLabel: t('lookDetail.backToLooks'), onAction: () => router.replace('/wardrobe/looks') }}
      >
        {(data) => <LookBody look={data} itemsById={itemsById} note={noteText} />}
      </ScreenState>

      {look ? (
        <BottomActionBar>
          <View className="flex-row items-center gap-2.5">
            <IconButton
              icon={Heart}
              active={look.isFavorite}
              onPress={() => writes.toggleFavorite(look)}
              accessibilityLabel={t(look.isFavorite ? 'looks.favoriteRemove' : 'looks.favoriteAdd', { name: look.name })}
            />
            <View className="flex-1">
              <Button size="bar" icon={MirrorRound} label={t('lookEditor.tryOn')} onPress={onTryOnPress} testID="look-try-on" />
              {gate.count > 0 ? (
                <View className="absolute -right-1 -top-1" pointerEvents="none">
                  <StepCountBadge count={gate.count} />
                </View>
              ) : null}
            </View>
            <IconButton icon={Pencil} onPress={edit} accessibilityLabel={t('lookDetail.edit')} testID="look-edit" />
          </View>
          <RequirementHint hint={gate.hint} onPress={gate.run} className="mt-1.5" testID="look-try-on-hint" />
        </BottomActionBar>
      ) : null}

      <PopoverMenu
        visible={menu}
        onClose={() => setMenu(false)}
        top={insets.top + 52}
        actions={[
          {
            key: 'wear',
            label: t('lookDetail.wearToday'),
            icon: CalendarCheck,
            onPress: () => {
              if (!look) return;
              wear.wear(look.id);
              setNotice('worn');
            },
          },
          { key: 'edit', label: t('lookDetail.edit'), icon: Pencil, onPress: edit },
          { key: 'delete', label: t('lookEditor.delete'), icon: Trash2, destructive: true, onPress: () => setDeleting(true) },
        ]}
      />

      <CreditConfirmSheet visible={confirm} onClose={() => setConfirm(false)} cost={TRY_ON_CREDIT_COST} onConfirm={startTryOn} confirming={tryOn.isStarting} />

      <BottomSheet visible={deleting} onClose={() => setDeleting(false)} title={t('lookEditor.deleteTitle')}>
        <View className="gap-3.5">
          <Text variant="body" tone="muted">
            {t('lookEditor.deleteBody')}
          </Text>
          <Button
            variant="danger"
            label={t('lookEditor.delete')}
            testID="look-delete-confirm"
            onPress={() => {
              if (!look) return;
              setDeleting(false);
              setDeleted(true);
              writes.remove(look);
              if (router.canGoBack()) router.back();
            }}
          />
          <Button variant="secondary" size="lg" label={t('common.cancel')} onPress={() => setDeleting(false)} />
        </View>
      </BottomSheet>
    </Screen>
  );
}
