import { router, useLocalSearchParams } from 'expo-router';
import { CalendarCheck, ChevronRight, CircleAlert, Ellipsis, Heart, History, MirrorRound, Pencil, Share as ShareIcon, Star, Trash2 } from 'lucide-react-native';
import { useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Look, LookSlot } from '@/api/contracts/looks';
import { useWearToday } from '@/api/today';
import { PopoverMenu } from '@/components/ui/Bits';
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
import { indexItems, SlotThumb, type ItemsById } from '@/features/looks/LookCover';
import { LookHero, useLookTryOn, type LookTryOn } from '@/features/looks/LookHero';
import { lookPieceNames, missingPieceCount } from '@/features/looks/logic';
import { useLook } from '@/features/looks/queries';
import { ModeratedNote } from '@/features/moderation/ModeratedNote';
import { ensureTryOnConsent, isConsentDeclined, TRY_ON_CREDIT_COST, useStartTryOn } from '@/features/tryon/api';
import { RequirementHint, StepCountBadge } from '@/features/requirements/RequirementHint';
import { useHandleGate } from '@/features/requirements/useHandleGate';
import { useGate } from '@/features/requirements/useRequirements';
import { useTryOnInviteFooter } from '@/features/tryon/TryOnInvite';
import { useItems } from '@/features/wardrobe/queries';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { formatMoney, formatNumber } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';
import { useIsOnline } from '@/sync/network';
import { useTeenRules } from '@/features/teen/store';
import { TeenTryOnLock } from '@/features/teen/TeenLocks';

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/wardrobe/looks');
}

/** One piece of the look, as the piece rows of 17: 40 × 48 thumb, name, where it comes from. */
function PieceRow({ slot, itemsById }: { slot: LookSlot; itemsById: ItemsById }) {
  const { t } = useTranslation();
  const hideCommerce = useTeenRules().hide.commerce;
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
      ? hideCommerce
        ? undefined
        : () => router.push({ pathname: '/shop/product/[id]', params: { id: slot.refId } })
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

type BodyProps = { look: Look; itemsById: ItemsById; note: string | null; tryOn: LookTryOn; invite: ComponentProps<typeof LookHero>['invite'] };

function LookBody({ look, itemsById, note, tryOn, invite }: BodyProps) {
  const language = useAppLanguage();
  const { t } = useTranslation();
  const occasion = t(`occasion.${look.occasion}`);
  // Canvas 18: friends' ratings are social — not shown to a teen.
  const teen = useTeenRules();
  const hideSocial = teen.hide.social;
  const teenTryOnLocked = teen.isTeen && teen.tryOn !== 'open';
  const rating = look.rating !== null ? formatNumber(look.rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : null;
  const missing = missingPieceCount(look);
  return (
    <ScrollView contentContainerClassName="gap-3 px-gutter pb-6 pt-1">
      {/* Canvas 18 · 14b: a teen whose try-on is closed sees the calm lock card in place of the hero. */}
      {teenTryOnLocked ? (
        <TeenTryOnLock className="h-[420px]" />
      ) : (
        <LookHero name={look.name} slots={look.slots} itemsById={itemsById} tryOn={tryOn} invite={invite} />
      )}

      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text variant="eyebrow">
            {toDisplayUpper(t('lookDetail.eyebrow', { occasion, pieces: t('trips.pieces', { count: look.slots.length }) }), language)}
          </Text>
          <Text variant="h2">{look.name}</Text>
        </View>
        {rating && !hideSocial ? (
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

      <ModeratedNote moderation={look.moderation} kind="look" />

      {rating || hideSocial ? null : (
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
  const withHandle = useHandleGate();
  // 14b hero: the image on the CURRENT photo, the run of this session, or none. 13d: an existing image opens
  // without the credit sheet.
  const lookTryOn = useLookTryOn(id, { enabled: Boolean(look) });
  // The invitation names what a tap leads to: a missing photo or membership first, otherwise the cost (a consent or
  // credit step is said by the hint under the button; the tap opens the requirements flow either way).
  const inviteFooter = useTryOnInviteFooter(gate.req);

  if (deleted) {
    return (
      <Screen bottom>
        <ScreenHeader leading="back" onLeadingPress={leave} />
        <StateMessage message={t('lookDetail.deleted')} actionLabel={t('lookDetail.backToLooks')} onAction={() => router.replace('/wardrobe/looks')} />
      </Screen>
    );
  }

  const edit = () => router.push({ pathname: '/look/new', params: { id } });

  const shareNow = () => {
    if (!look) return;
    const pieces = lookPieceNames(look)
      .map((name) => t('lookDetail.shareLine', { name }))
      .join('\n');
    void Share.share({ message: t('lookDetail.shareMessage', { name: look.name, occasion: t(`occasion.${look.occasion}`), pieces }) }).catch(() => undefined);
  };
  // Sharing needs an @handle: without one the handle step comes first, then the share sheet opens.
  const share = () => withHandle(shareNow, look?.name ?? null);

  const onTryOnPress = () => {
    if (!online) {
      setNotice('tryOnOffline');
      return;
    }
    setNotice(null);
    if (lookTryOn.state === 'generating') return;
    if (look && lookTryOn.cachedJobId) {
      router.push({ pathname: '/tryon/[jobId]', params: { jobId: lookTryOn.cachedJobId, title: look.name, kind: 'look', id: look.id } });
      return;
    }
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

  const invite ={ ...inviteFooter, onPress: onTryOnPress };
  const hasImage = lookTryOn.state === 'image';
  const generating = lookTryOn.state === 'generating';

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
        {(data) => <LookBody look={data} itemsById={itemsById} note={noteText} tryOn={lookTryOn} invite={invite} />}
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
              <Button
                size="bar"
                icon={MirrorRound}
                label={generating ? t('lookDetail.tryOnPreparing') : t('lookEditor.tryOn')}
                onPress={onTryOnPress}
                disabled={generating}
                testID="look-try-on"
              />
              {gate.count > 0 && !hasImage && !generating ? (
                <View className="absolute -right-1 -top-1" pointerEvents="none">
                  <StepCountBadge count={gate.count} />
                </View>
              ) : null}
            </View>
            <IconButton icon={Pencil} onPress={edit} accessibilityLabel={t('lookDetail.edit')} testID="look-edit" />
          </View>
          {hasImage ? (
            // The image exists on this photo: "Üzerimde gör" opens it, and nothing is charged (13d).
            <View className="mt-1.5 min-h-[28px] flex-row items-center justify-center gap-1.5" testID="look-try-on-ready">
              <Icon icon={History} size={14} tone="accent" />
              <Text variant="caption" tone="accent" className="font-sans-medium">
                {t('lookDetail.heroReadyNote')}
              </Text>
            </View>
          ) : generating ? (
            <Text variant="caption" tone="muted" className="mt-1.5 min-h-[28px] text-center leading-[28px]" testID="look-try-on-preparing">
              {t('lookDetail.heroPreparingNote')}
            </Text>
          ) : (
            <RequirementHint hint={gate.hint} onPress={gate.run} className="mt-1.5" testID="look-try-on-hint" />
          )}
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
