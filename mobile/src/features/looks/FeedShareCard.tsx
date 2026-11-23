import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Heart } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { track } from '@/analytics/track';
import type { FeedShareRequest, Look } from '@/api/contracts/looks';
import { useSession } from '@/auth/session';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { toast } from '@/components/ui/toast';
import { useMyProfile } from '@/features/account/queries';
import { useHandleGate } from '@/features/requirements/useHandleGate';
import { useTeenRules } from '@/features/teen/store';
import { formatNumber } from '@/lib/format';
import { newClientMutation } from '@/sync/clientMutation';
import { useThemeColors } from '@/theme/useThemeColors';

import { hasConfirmedFeedShare, markFeedShareConfirmed } from './feedShareConfirm';
import { lookMutationKeys } from './mutations';

type Props = {
  look: Look;
  /** Only the lookbook's copy is known yet: the switch waits for the look's own record. */
  disabled?: boolean;
};

/**
 * "Akışta paylaş" on the look detail (canvas 14b · Akışta paylaş, decision 21): a switch, off by default and
 * independent of the account's visibility. On, the look is live on Akış under the owner's @handle and the card shows
 * what it got there. Turning it on walks the server's rules first, so nothing fails silently: an unverified e-mail
 * leads to the verify screen (the switch stays off), a missing @handle to the handle step, and the first share on
 * this phone to the confirmation sheet. Turning it off is immediate. The write is optimistic and queued offline.
 * Not drawn for teen accounts, for imported looks or for inspiration looks (an Akış post's photograph).
 */
export function FeedShareCard({ look, disabled = false }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const teen = useTeenRules();
  const session = useSession();
  const profile = useMyProfile();
  const withHandle = useHandleGate();
  const write = useMutation<void, unknown, FeedShareRequest>({ mutationKey: lookMutationKeys.feedShare });
  const [confirm, setConfirm] = useState(false);
  const userId = session.status === 'signedIn' ? session.user.id : null;

  if (teen.isTeen || look.imported || look.inspiration) return null;

  const shared = Boolean(look.sharedToFeed);
  const handle = profile.data?.handle ?? null;
  const stats = look.feedStats ?? { likeCount: 0, saveCount: 0 };

  const send = (next: boolean) => write.mutate({ id: look.id, shared: next, clientMutationId: newClientMutation().clientMutationId });

  const shareNow = (first: boolean) => {
    send(true);
    track('feed_share_on', { lookId: look.id, first });
  };

  // After the e-mail and the handle are in place: the sheet the first time, straight through afterwards.
  const confirmOrShare = () => {
    void hasConfirmedFeedShare(userId).then((confirmed) => {
      if (confirmed) shareNow(false);
      else setConfirm(true);
    });
  };

  const toggle = () => {
    if (shared) {
      send(false);
      track('feed_share_off', { lookId: look.id });
      toast.success(t('feedShare.removedToast'), { testID: 'toast-feed-share-off' });
      return;
    }
    if (profile.data?.emailVerified === false) {
      toast.info(t('feedShare.verifyFirst'), { testID: 'toast-feed-share-verify' });
      router.push('/verify-email');
      return;
    }
    withHandle(confirmOrShare, look.name);
  };

  const accept = () => {
    setConfirm(false);
    void markFeedShareConfirmed(userId);
    shareNow(true);
  };

  const points = [
    t('feedShare.sheet.point1'),
    handle ? t('feedShare.sheet.point2', { handle }) : t('feedShare.sheet.point2Plain'),
    t('feedShare.sheet.point3'),
    t('feedShare.sheet.point4'),
  ];
  const hint = shared ? (handle ? t('feedShare.hintOn', { handle }) : t('feedShare.hintOnPlain')) : t('feedShare.hintOff');
  const statsLine = t('feedShare.stats', {
    likes: t('feedShare.likes', { count: stats.likeCount, formatted: formatNumber(stats.likeCount) }),
    saves: t('feedShare.saves', { count: stats.saveCount, formatted: formatNumber(stats.saveCount) }),
  });

  return (
    <View className="gap-2.5 rounded-card border border-line bg-paper p-3.5" testID="look-feed-share">
      <View className="flex-row items-center gap-3">
        <View className="min-w-0 flex-1">
          <Text variant="bodyMedium" className="text-[15px]">
            {t('feedShare.title')}
          </Text>
          <Text variant="caption" tone="muted" accessibilityLiveRegion="polite" testID="look-feed-share-hint">
            {hint}
          </Text>
        </View>
        <Pressable
          onPress={toggle}
          disabled={disabled}
          accessibilityRole="switch"
          accessibilityLabel={t('feedShare.title')}
          accessibilityHint={hint}
          accessibilityState={{ checked: shared, disabled }}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          testID="look-feed-share-switch"
          className={`h-8 w-[52px] flex-row rounded-pill p-[3px] ${shared ? 'justify-end bg-ink' : 'justify-start bg-feed-switch-off'} ${disabled ? 'opacity-50' : ''}`}
        >
          <View
            className="h-[26px] w-[26px] rounded-pill bg-paper"
            style={{ shadowColor: colors.ink, shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 }}
          />
        </Pressable>
      </View>
      {shared ? (
        <View className="flex-row items-center gap-1.5 border-t border-line pt-2" accessible accessibilityLabel={statsLine} testID="look-feed-share-stats">
          <Icon icon={Heart} size={15} />
          <Text variant="caption" tone="ink">
            {statsLine}
          </Text>
        </View>
      ) : null}

      <BottomSheet visible={confirm} onClose={() => setConfirm(false)}>
        <View className="gap-4 px-1 pb-1" accessibilityLabel={t('feedShare.sheet.title')} testID="look-feed-share-sheet">
          <View className="gap-2 pt-1">
            <Text variant="eyebrow" tone="accent">
              {t('feedShare.sheet.eyebrow')}
            </Text>
            <Text variant="h2" accessibilityRole="header">
              {t('feedShare.sheet.title')}
            </Text>
          </View>
          <View className="gap-3">
            {points.map((point) => (
              <View key={point} className="flex-row items-start gap-3">
                <View className="mt-2 h-1.5 w-1.5 rounded-pill bg-accent" accessible={false} />
                <Text variant="body" className="flex-1 text-[14.5px] leading-[21px]">
                  {point}
                </Text>
              </View>
            ))}
          </View>
          <View className="gap-1.5">
            <Button label={t('feedShare.sheet.accept')} onPress={accept} testID="look-feed-share-accept" />
            <Button variant="text" size="md" label={t('feedShare.sheet.cancel')} onPress={() => setConfirm(false)} testID="look-feed-share-cancel" />
          </View>
        </View>
      </BottomSheet>
    </View>
  );
}
