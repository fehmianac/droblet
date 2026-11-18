import * as Clipboard from 'expo-clipboard';
import { Link, MessageCircle } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Linking, Pressable, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { track } from '@/analytics/track';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { sizes } from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

export type ShareChannel = 'whatsapp' | 'pinterest' | 'link';

/** The outgoing URL for each channel. Pure. */
export function shareTargetUrl(channel: Exclude<ShareChannel, 'link'>, url: string, message: string): string {
  if (channel === 'whatsapp') return `https://wa.me/?text=${encodeURIComponent(message)}`;
  return `https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&description=${encodeURIComponent(message)}`;
}

/** Puts a link on the clipboard. `false` when the system refused — the caller says so calmly. */
export async function copyLink(url: string): Promise<boolean> {
  try {
    return await Clipboard.setStringAsync(url);
  } catch {
    return false;
  }
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
  /** Called after the link was copied and the sheet closed, with the confirmation text to show. */
  onCopied?: (confirmation: string) => void;
};

/** The circled "P" the canvas draws for Pinterest (25 share sheet). */
function PinterestGlyph() {
  const colors = useThemeColors();
  const stroke = {
    stroke: colors.ink,
    strokeWidth: sizes.iconStroke,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    fill: 'none',
  } as const;
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" accessible={false}>
      <Circle cx={12} cy={12} r={9} {...stroke} />
      <Path d="M11 8h2.5a2.5 2.5 0 0 1 0 5H11M11 8l-2 12" {...stroke} />
    </Svg>
  );
}

function Option({ glyph, label, onPress, testID }: { glyph: ReactNode; label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-[84px] flex-1 items-center justify-center gap-1.5 rounded-card border border-line bg-paper px-1 active:opacity-70"
    >
      {glyph}
      <Text variant="chip" className="text-center" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * "Look'u paylaş" (25) — three tiles as drawn: WhatsApp, Pinterest, "Link kopyala". Every link
 * carries the sharer's invite code; when the app is not installed the link leads to the store page.
 * WhatsApp and Pinterest open through their web links (no app query, so no extra native config);
 * if nothing can open them the sheet stays open and says so.
 */
export function ShareSheet({ visible, onClose, url, message, kind, onCopied }: Props) {
  const { t } = useTranslation();
  const [problem, setProblem] = useState<'open' | 'copy' | null>(null);

  const close = () => {
    setProblem(null);
    onClose();
  };

  const share = async (channel: ShareChannel) => {
    if (!url) return;
    setProblem(null);
    if (channel === 'link') {
      if (!(await copyLink(url))) {
        setProblem('copy');
        return;
      }
      const confirmation = t('share.copied');
      track('look_shared', { channel, kind });
      close();
      if (onCopied) onCopied(confirmation);
      else AccessibilityInfo.announceForAccessibility(confirmation);
      return;
    }
    try {
      await Linking.openURL(shareTargetUrl(channel, url, message));
      track('look_shared', { channel, kind });
      close();
    } catch {
      setProblem('open');
    }
  };

  return (
    <BottomSheet visible={visible} onClose={close} title={t('share.title')}>
      <View className="gap-3.5 pb-3.5">
        <Text variant="caption" tone="muted">
          {t('share.body')}
        </Text>
        {url ? (
          <View className="flex-row gap-2.5">
            <Option
              testID="share-whatsapp"
              glyph={<Icon icon={MessageCircle} size={22} />}
              label={t('share.whatsapp')}
              onPress={() => void share('whatsapp')}
            />
            <Option
              testID="share-pinterest"
              glyph={<PinterestGlyph />}
              label={t('share.pinterest')}
              onPress={() => void share('pinterest')}
            />
            <Option testID="share-link" glyph={<Icon icon={Link} size={22} />} label={t('share.link')} onPress={() => void share('link')} />
          </View>
        ) : (
          <Text variant="body" tone="danger" accessibilityLiveRegion="polite">
            {t('share.linkUnavailable')}
          </Text>
        )}
        {problem ? (
          <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
            {t(problem === 'copy' ? 'share.copyFailed' : 'share.failed')}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}
