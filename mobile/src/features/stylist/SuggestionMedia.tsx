import { Sparkles } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { StylistPiece, StylistSuggestion } from '@/api/contracts/stylist';
import { AiDropPulse, AiFailure, AiProgressLines, AiShimmerImage } from '@/components/ui/ai';
import { AiImage } from '@/components/ui/AiBadge';
import { Badge, ImageTag } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';

export type MediaMode = 'idle' | 'working' | 'done' | 'failed' | 'noCredits';

type Props = {
  suggestion: StylistSuggestion;
  mode: MediaMode;
  imageUrl: string | null;
  /** "1 kredi · kalan 11" (or just the cost while the balance is unknown). */
  creditLine: string;
  onTryOn: () => void;
  tryOnDisabled: boolean;
  /** Failed try-on. */
  creditRefunded: boolean;
  onRetry: () => void;
  retrying: boolean;
  /** 17b. */
  noCreditsBody: string;
  onTopUp: () => void;
};

function PieceTile({ piece, className }: { piece: StylistPiece; className: string }) {
  const { t } = useTranslation();
  const missing = piece.source === 'store';
  return (
    <View className={`overflow-hidden rounded-image ${missing ? 'border border-dashed border-accent' : ''} ${className}`}>
      <ItemThumb
        category={piece.category}
        color={piece.color ?? undefined}
        uri={piece.imageUrl}
        className="h-full w-full"
        accessibilityLabel={missing ? t('stylistResult.missingPieceA11y', { name: piece.name }) : piece.name}
      />
      {missing ? <ImageTag label={t('stylistResult.missingTag')} className="absolute bottom-1.5 left-1.5 max-w-[92%] px-1.5" /> : null}
    </View>
  );
}

/**
 * Top of a suggestion: the "on you" slot + piece tiles. States: idle ("Üzerimde gör", 1 credit),
 * working (17c — shimmer, breathing drop, rotating lines), done (AI image, always labelled),
 * failed (credit refunded + retry) and 17b no credits (piece collage + "Kredi yükle").
 */
export function SuggestionMedia({
  suggestion,
  mode,
  imageUrl,
  creditLine,
  onTryOn,
  tryOnDisabled,
  creditRefunded,
  onRetry,
  retrying,
  noCreditsBody,
  onTopUp,
}: Props) {
  const { t } = useTranslation();

  if (mode === 'noCredits') {
    return (
      <View className="gap-3">
        <View>
          <View className="flex-row flex-wrap gap-2">
            {suggestion.pieces.slice(0, 4).map((p) => (
              <PieceTile key={`${p.slot}${p.refId}`} piece={p} className="aspect-[4/5] grow basis-[46%]" />
            ))}
          </View>
          <View className="absolute left-3 top-3">
            <Badge label={t('stylistResult.collageBadge')} />
          </View>
        </View>
        <View className="gap-2.5 rounded-card border border-line bg-paper p-4" accessibilityLiveRegion="polite">
          <View className="flex-row items-center gap-2">
            <Icon icon={Sparkles} size={18} tone="accent" />
            <Text variant="bodyMedium" className="flex-1">
              {t('stylistResult.noCreditsTitle')}
            </Text>
          </View>
          <Text variant="caption" tone="muted">
            {noCreditsBody}
          </Text>
          <Button label={t('stylistResult.topUp')} onPress={onTopUp} />
        </View>
      </View>
    );
  }

  const lines = [t('ai.tryOnLines.pieces'), t('ai.tryOnLines.colors'), t('ai.tryOnLines.placing'), t('ai.tryOnLines.finishing')];
  const tiles = suggestion.pieces.slice(0, 3);

  return (
    <View className="gap-3">
      <View className="flex-row gap-2.5">
        <View className="aspect-[200/264] flex-[1.7]">
          {mode === 'done' ? (
            <View className="h-full w-full">
              <AiImage kind="onYou" uri={imageUrl} className="h-full w-full" accessibilityLabel={t('tryOn.imageA11yNamed', { name: suggestion.name })} />
              <View className="absolute bottom-3 left-3" pointerEvents="none">
                <Badge tone="ink" icon={Sparkles} label={t('ai.previewBadge')} />
              </View>
            </View>
          ) : mode === 'working' ? (
            <AiShimmerImage className="h-full w-full gap-3 rounded-image-lg p-4">
              <AiDropPulse height={31} hookTone="sand" />
              <View className="w-full">
                <AiProgressLines lines={lines} size="compact" align="center" />
              </View>
              <Text variant="caption" tone="muted" className="text-center">
                {creditLine}
              </Text>
            </AiShimmerImage>
          ) : (
            <View className="h-full w-full items-center justify-center gap-2.5 rounded-image-lg bg-sand p-3">
              {mode === 'idle' ? (
                <>
                  <Button variant="secondary" icon={Sparkles} label={t('stylistResult.tryOn')} onPress={onTryOn} disabled={tryOnDisabled} />
                  <Text variant="caption" tone="muted" className="text-center">
                    {creditLine}
                  </Text>
                </>
              ) : null}
            </View>
          )}
        </View>
        <View className="flex-1 gap-2">
          {tiles.map((p) => (
            <PieceTile key={`${p.slot}${p.refId}`} piece={p} className="flex-1" />
          ))}
        </View>
      </View>
      {mode === 'failed' ? <AiFailure layout="inline" creditRefunded={creditRefunded} onRetry={onRetry} retrying={retrying} /> : null}
    </View>
  );
}
