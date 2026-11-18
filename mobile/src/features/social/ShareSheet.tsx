import { Link2, MessageCircle, Pin, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, Share, View } from 'react-native';

import { track } from '@/analytics/track';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';

export type ShareChannel = 'whatsapp' | 'pinterest' | 'link';

/** The outgoing URL for each channel. Pure. */
export function shareTargetUrl(channel: Exclude<ShareChannel, 'link'>, url: string, message: string): string {
  if (channel === 'whatsapp') return `https://wa.me/?text=${encodeURIComponent(message)}`;
  return `https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&description=${encodeURIComponent(message)}`;
}

type Props = {
  visible: boolean;
  onClose: () => void;
  /** The link to share (already carrying the invite code); null while it cannot be built. */
  url: string | null;
  /** Full message including the link, in the app language. */
  message: string;
  /** What is shared, for analytics. */
  kind: 'look' | 'profile' | 'invite';
};

function Option({ icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="min-h-20 flex-1 items-center justify-center gap-2 rounded-card border border-line bg-paper p-3 active:opacity-70"
    >
      <Icon icon={icon} size={22} />
      <Text variant="caption" className="text-center" numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * "Look'u paylaş" — WhatsApp, Pinterest or the system share sheet for the link. Every link carries
 * the sharer's invite code; when the app is not installed the link leads to the store page.
 */
export function ShareSheet({ visible, onClose, url, message, kind }: Props) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  const share = async (channel: ShareChannel) => {
    if (!url) return;
    setFailed(false);
    try {
      if (channel === 'link') await Share.share({ message });
      else await Linking.openURL(shareTargetUrl(channel, url, message));
      track('look_shared', { channel, kind });
      onClose();
    } catch {
      setFailed(true);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('share.title')}>
      <View className="gap-4">
        <Text variant="body" tone="muted">
          {t('share.body')}
        </Text>
        {url ? (
          <View className="flex-row gap-3">
            <Option icon={MessageCircle} label={t('share.whatsapp')} onPress={() => void share('whatsapp')} />
            <Option icon={Pin} label={t('share.pinterest')} onPress={() => void share('pinterest')} />
            <Option icon={Link2} label={t('share.link')} onPress={() => void share('link')} />
          </View>
        ) : (
          <Text variant="body" tone="danger" accessibilityLiveRegion="polite">
            {t('share.linkUnavailable')}
          </Text>
        )}
        {failed ? (
          <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
            {t('share.failed')}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}
