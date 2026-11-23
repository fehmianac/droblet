import { ChevronRight, Image as ImageIcon, Shirt, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { FEED_LOOK_MIN_PIECES, type FeedLookMode, type FeedPost } from '@/api/contracts/feed';
import { DropLoader } from '@/components/brand/DropLoader';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';

import { useSaveFeedPostAsLook } from './mutations';

type RowProps = { icon: LucideIcon; title: string; body: string; busy: boolean; disabled: boolean; busyLabel: string; onPress: () => void; testID: string };

/** One way of saving: icon tile, title + one line, chevron — the drop loader in the chevron's place while it is on its way. */
function Row({ icon, title, body, busy, disabled, busyLabel, onPress, testID }: RowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}`}
      accessibilityState={{ disabled, busy }}
      className={`min-h-[72px] flex-row items-center gap-3.5 rounded-image-lg border border-line bg-paper px-3.5 py-3 active:opacity-80 ${disabled ? 'opacity-40' : ''}`}
      testID={testID}
    >
      <View className="h-11 w-11 items-center justify-center rounded-[12px] bg-sand">
        <Icon icon={icon} size={20} />
      </View>
      <View className="flex-1 gap-[3px]">
        <Text variant="bodyMedium">{title}</Text>
        <Text variant="caption" tone="muted">
          {body}
        </Text>
      </View>
      {busy ? (
        <View testID={`${testID}.busy`}>
          <DropLoader size="inline" tone="ink" accessibilityLabel={busyLabel} />
        </View>
      ) : (
        <Icon icon={ChevronRight} size={18} />
      )}
    </Pressable>
  );
}

type Props = {
  /** The editor post whose "Looklarıma ekle" was tapped; null = closed. */
  post: FeedPost | null;
  onClose: () => void;
};

/**
 * "Looklarıma ekle" on an Akış editor post with pieces (owner decision 2026-11-23): the post's title, then the two ways
 * — "İlham olarak kaydet" (the photograph becomes the look's cover, nothing is added to the wardrobe) and "Parçalarıyla
 * kaydet" (the pieces become wardrobe items and the look is made of them; needs two pieces) — and "Vazgeç". The tapped
 * row shows progress; once the look exists the sheet closes and the toast offers "Gör". A failure keeps the sheet open
 * (the toast, or the paywall, says why).
 */
export function SaveAsLookSheet({ post, onClose }: Props) {
  const { t } = useTranslation();
  const { save, saving } = useSaveFeedPostAsLook();
  const count = post?.pieces.length ?? 0;
  const enough = count >= FEED_LOOK_MIN_PIECES;
  const choose = (mode: FeedLookMode) => {
    if (!post || saving) return;
    void save(post, mode).then((done) => {
      if (done) onClose();
    });
  };
  // While a save is on its way the sheet stays (scrim tap, back and "Vazgeç" wait for the answer).
  const close = () => {
    if (!saving) onClose();
  };

  return (
    <BottomSheet visible={post !== null} onClose={close}>
      {post ? (
        <View className="gap-3.5 pb-1" accessibilityLabel={t('homeFeed.lookSheet.title')} testID="feed.lookSheet">
          <View className="gap-1 pt-1.5">
            <Text variant="h2" accessibilityRole="header">
              {t('homeFeed.lookSheet.title')}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1} testID="feed.lookSheet.subtitle">
              {post.title}
            </Text>
          </View>
          <Row
            icon={ImageIcon}
            title={t('homeFeed.lookSheet.inspiration')}
            body={t('homeFeed.lookSheet.inspirationBody')}
            busy={saving === 'inspiration'}
            disabled={saving === 'pieces'}
            busyLabel={t('homeFeed.lookSheet.saving')}
            onPress={() => choose('inspiration')}
            testID="feed.lookSheet.inspiration"
          />
          <Row
            icon={Shirt}
            title={t('homeFeed.lookSheet.pieces')}
            body={enough ? t('homeFeed.lookSheet.piecesBody', { count }) : t('homeFeed.lookSheet.piecesUnavailable')}
            busy={saving === 'pieces'}
            disabled={!enough || saving === 'inspiration'}
            busyLabel={t('homeFeed.lookSheet.saving')}
            onPress={() => choose('pieces')}
            testID="feed.lookSheet.pieces"
          />
          <Button variant="secondary" label={t('homeFeed.lookSheet.cancel')} onPress={close} disabled={saving !== null} testID="feed.lookSheet.cancel" />
        </View>
      ) : null}
    </BottomSheet>
  );
}
