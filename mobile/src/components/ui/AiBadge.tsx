import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { PlaceholderImage } from './PlaceholderImage';
import { Text } from './Text';

export type AiBadgeKind = 'onYou' | 'preview';

/** "SENİN ÜZERİNDE" / "AI ÖNİZLEME" — the AI marker. */
export function AiBadge({ kind }: { kind: AiBadgeKind }) {
  const { t } = useTranslation();
  return (
    <View className="self-start rounded-pill bg-accent px-2.5 py-1">
      <Text variant="eyebrow" tone="paper">
        {t(kind === 'onYou' ? 'aiBadge.onYou' : 'aiBadge.preview')}
      </Text>
    </View>
  );
}

type AiImageProps = {
  kind: AiBadgeKind;
  uri: string | null;
  className?: string;
  accessibilityLabel?: string;
};

/**
 * An AI-generated image. The label is part of the component and cannot be turned off:
 * AI output is always marked (BRIEF §3 Görseller).
 */
export function AiImage({ kind, uri, className, accessibilityLabel }: AiImageProps) {
  return (
    <View className={className}>
      <PlaceholderImage uri={uri} className="h-full w-full rounded-image-lg" accessibilityLabel={accessibilityLabel} />
      <View className="absolute left-3 top-3" pointerEvents="none">
        <AiBadge kind={kind} />
      </View>
    </View>
  );
}
