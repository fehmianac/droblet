import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ImageTag } from './Bits';
import { PlaceholderImage } from './PlaceholderImage';

export type AiBadgeKind = 'onYou' | 'preview';

/**
 * "SENİN ÜZERİNDE" / "AI ÖNİZLEME" — the AI marker. Drawn as the canvas image tag (`.tag`):
 * paper at 92 %, ink text, 9.5 with 10 % tracking, radius 6.
 */
export function AiBadge({ kind }: { kind: AiBadgeKind }) {
  const { t } = useTranslation();
  return <ImageTag label={t(kind === 'onYou' ? 'aiBadge.onYou' : 'aiBadge.preview')} />;
}

type AiImageProps = {
  kind: AiBadgeKind;
  uri: string | null;
  className?: string;
  accessibilityLabel?: string;
};

/**
 * An AI-generated image. The label is part of the component and cannot be turned off:
 * AI output is always marked (BRIEF §3 Görseller). It sits bottom-left, 8 in, as on 06 / 08 / 17 / 22.
 */
export function AiImage({ kind, uri, className, accessibilityLabel }: AiImageProps) {
  return (
    <View className={className}>
      <PlaceholderImage uri={uri} className="h-full w-full rounded-image-lg" accessibilityLabel={accessibilityLabel} />
      <View className="absolute bottom-2 left-2" pointerEvents="none">
        <AiBadge kind={kind} />
      </View>
    </View>
  );
}
