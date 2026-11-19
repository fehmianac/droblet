import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ImageTag } from './Bits';
import { ImageSlot, type SlotPlaceholder } from './ImageSlot';

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
  /** What stands in while there is no generated image (e.g. the look's piece collage). Defaults to the figure. */
  placeholder?: SlotPlaceholder;
  onLoad?: () => void;
  onError?: () => void;
  testID?: string;
  /** Replaces the kind's label in the image tag (e.g. "YÜZÜN · VÜCUT TİPİN" on a face-path try-on): one tag, never two. */
  tagLabel?: string;
};

/**
 * An AI-generated image. When there is one, the label is part of the component and cannot be turned off:
 * AI output is always marked (BRIEF §3 Görseller). It sits bottom-left, 8 in, as on 06 / 08 / 17 / 22.
 * Without an image nothing was generated, so there is no AI marker — only the placeholder.
 */
export function AiImage({ kind, uri, className, accessibilityLabel, placeholder, onLoad, onError, testID, tagLabel }: AiImageProps) {
  return (
    <View className={className}>
      <ImageSlot fit="contain" uri={uri} className="h-full w-full rounded-image-lg" accessibilityLabel={accessibilityLabel} placeholder={placeholder} onLoad={onLoad} onError={onError} testID={testID} />
      {uri ? (
        <View className="absolute bottom-2 left-2" pointerEvents="none" testID="ai-image-tag">
          {tagLabel ? <ImageTag label={tagLabel} /> : <AiBadge kind={kind} />}
        </View>
      ) : null}
    </View>
  );
}
