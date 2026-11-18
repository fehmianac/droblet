import { Sparkles } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { StylistPiece, StylistSuggestion } from '@/api/contracts/stylist';
import { AiDropPulse, AiFailure, AiProgressLines, AiShimmerImage } from '@/components/ui/ai';
import { Badge, MissingTag } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { OnYouImage } from '@/features/today/OnYouImage';
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
};

/**
 * The pieces shown as tiles: in outfit order, but a missing (store) piece is never cut off — it takes
 * the last tile, as on the board, so "EKSİK PARÇA" is visible without reading the rows.
 */
export function tilePieces(pieces: StylistPiece[], count: number): StylistPiece[] {
  const missing = pieces.filter((p) => p.source === 'store').slice(0, count);
  const owned = pieces.filter((p) => p.source !== 'store').slice(0, count - missing.length);
  return [...owned, ...missing];
}

/** A piece tile next to the "on you" slot. A missing (store) piece: dashed espresso frame + "EKSİK PARÇA" top-right. */
function PieceTile({ piece, className, glyphSize = 32 }: { piece: StylistPiece; className: string; glyphSize?: number }) {
  const { t } = useTranslation();
  const missing = piece.source === 'store';
  return (
    <View className={`overflow-hidden rounded-image ${missing ? 'border-[1.5px] border-dashed border-accent' : ''} ${className}`}>
      <ItemThumb
        category={piece.category}
        color={piece.color ?? undefined}
        uri={piece.imageUrl}
        className="h-full w-full"
        glyphSize={glyphSize}
        accessibilityLabel={missing ? t('stylistResult.missingPieceA11y', { name: piece.name, detail: '' }).trim() : piece.name}
      />
      {missing ? <MissingTag className="absolute right-1.5 top-1.5" /> : null}
    </View>
  );
}

/**
 * Top of a suggestion (17): the "on you" slot (200 × 264 on the board) + three piece tiles. States:
 * idle (the piece collage with "Üzerimde gör", 1 credit, on top), working (17c — shimmer, breathing drop,
 * rotating lines), done (AI image: "AI önizleme" top-left, "SENİN ÜZERİNDE" bottom-left — only when an
 * image came back, otherwise the collage), failed (the same slot says the credit came back and offers
 * "Tekrar dene") and 17b no credits (the piece collage; see `NoCreditsCard`).
 */
export function SuggestionMedia({ suggestion, mode, imageUrl, creditLine, onTryOn, tryOnDisabled, creditRefunded, onRetry, retrying }: Props) {
  const { t } = useTranslation();

  if (mode === 'noCredits') {
    const pieces = tilePieces(suggestion.pieces, 4);
    return (
      <View className="rounded-[16px] border border-line bg-paper p-2.5">
        <View className="flex-row flex-wrap gap-2">
          {pieces.map((p, i) => (
            <PieceTile key={`${p.slot}${p.refId}`} piece={p} glyphSize={i < 2 ? 56 : 44} className={`grow basis-[46%] ${i < 2 ? 'h-[150px]' : 'h-[110px]'}`} />
          ))}
        </View>
        <View className="absolute left-[18px] top-[18px] h-badge justify-center rounded-pill border border-line bg-paper px-2">
          <Text variant="badge" numberOfLines={1}>
            {t('stylistResult.collageBadge')}
          </Text>
        </View>
      </View>
    );
  }

  const lines = [t('ai.tryOnLines.pieces'), t('ai.tryOnLines.colors'), t('ai.tryOnLines.placing'), t('ai.tryOnLines.finishing')];
  const tiles = tilePieces(suggestion.pieces, 3);
  const collage = tilePieces(suggestion.pieces, 4).map((p) => ({ category: p.category, color: p.color, imageUrl: p.imageUrl, missing: p.source === 'store' }));

  return (
    <View className="flex-row gap-2.5">
      {/* 200 : 140 of the 350-wide board row. */}
      <View className="aspect-[200/264] flex-[10]">
        {mode === 'done' ? (
          <View className="h-full w-full">
            {/* The AI markers only sit on a generated image; a finished job without one falls back to the piece collage. */}
            <OnYouImage
              uri={imageUrl}
              className="h-full w-full rounded-image-lg"
              pieces={collage}
              silhouetteHeight={168}
              accessibilityLabel={t('tryOn.imageA11yNamed', { name: suggestion.name })}
              collageLabel={t('aiBadge.collageA11y', { name: suggestion.name })}
            />
            {imageUrl ? (
              <View className="absolute left-2.5 top-2.5" pointerEvents="none">
                <Badge tone="ink" icon={Sparkles} label={t('ai.previewBadge')} />
              </View>
            ) : null}
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
        ) : mode === 'failed' ? (
          <View className="h-full w-full items-center justify-center rounded-image-lg bg-sand px-3">
            <AiFailure layout="inline" creditRefunded={creditRefunded} onRetry={onRetry} retrying={retrying} />
          </View>
        ) : (
          // Nothing generated yet: the outfit as its piece collage, with "Üzerimde gör" and what it costs on top.
          <OnYouImage
            uri={null}
            className="h-full w-full rounded-image-lg"
            pieces={collage}
            silhouetteHeight={168}
            collageLabel={t('aiBadge.collageA11y', { name: suggestion.name })}
          >
            <View className="items-center gap-1.5 rounded-field bg-paper/95 p-2">
              <Button variant="secondary" size="md" icon={Sparkles} label={t('stylistResult.tryOn')} onPress={onTryOn} disabled={tryOnDisabled} className="px-4" />
              <Text variant="caption" tone="muted" className="text-center">
                {creditLine}
              </Text>
            </View>
          </OnYouImage>
        )}
      </View>
      <View className="flex-[7] gap-2">
        {tiles.map((p) => (
          <PieceTile key={`${p.slot}${p.refId}`} piece={p} className="flex-1" />
        ))}
      </View>
    </View>
  );
}

/** 17b — the card under the title when the month's AI images are used up: one sentence, one action ("Kredi yükle", 48 high). */
export function NoCreditsCard({ body, onTopUp }: { body: string; onTopUp: () => void }) {
  const { t } = useTranslation();
  return (
    <View className="gap-2.5 rounded-card border border-line bg-paper p-4" accessibilityLiveRegion="polite">
      <View className="flex-row items-center gap-2.5">
        <Icon icon={Sparkles} size={20} tone="accent" />
        <Text variant="bodyMedium" className="flex-1 text-[15px]">
          {t('stylistResult.noCreditsTitle')}
        </Text>
      </View>
      <Text variant="caption" tone="muted" className="leading-[18px]">
        {body}
      </Text>
      <Button size="bar" label={t('stylistResult.topUp')} onPress={onTopUp} />
    </View>
  );
}
