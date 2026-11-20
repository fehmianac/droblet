import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { MissingTag } from '@/components/ui/Bits';
import { Text } from '@/components/ui/Text';

/**
 * The right column of the 06 / 08 / 14b hero: every piece up to 4; with more, 3 + a "+N" tile (the piece rows below
 * list them all). A missing (store) piece is never the one cut off — it takes the last shown tile.
 */
export function heroTiles<T>(items: T[], isMissing: (item: T) => boolean = () => false): { shown: T[]; more: number } {
  if (items.length <= 4) return { shown: items, more: 0 };
  const head = items.slice(0, 3);
  const missing = items.find(isMissing);
  const shown = !missing || head.includes(missing) ? head : [...items.filter((i) => !isMissing(i)).slice(0, 2), missing];
  return { shown, more: items.length - 3 };
}

export type HeroPiece = {
  key: string;
  /** Store piece: dashed accent frame + "EKSİK PARÇA". */
  missing: boolean;
  /** The thumbnail, filling the tile (an image slot, optionally inside a `Zoomable`). */
  content: ReactNode;
};

type Props = {
  pieces: HeroPiece[];
  /** Pieces not shown ("+N" tile). */
  more?: number;
  className?: string;
  testID?: string;
  moreTestID?: string;
  /**
   * Whether screen readers read the tiles. Off where rows below name every piece (08, 14b); on where the tiles are the
   * only place the pieces are named (06).
   */
  readable?: boolean;
};

/** The stacked piece tiles beside the "senin üzerinde" area (canvas 06, 08, 14b). */
export function HeroPieceColumn({ pieces, more = 0, className = 'flex-[12] gap-1 p-1', testID = 'hero-pieces', moreTestID = `${testID}-more`, readable = false }: Props) {
  const { t } = useTranslation();
  // Four piece tiles are short: "EKSİK" instead of "EKSİK PARÇA".
  const short = pieces.length > 3;
  return (
    <View className={className} accessible={false} importantForAccessibility={readable ? 'auto' : 'no-hide-descendants'} testID={testID}>
      {pieces.map((piece) => (
        <View key={piece.key} className={`flex-1 overflow-hidden rounded-thumb ${piece.missing ? 'border-[1.5px] border-dashed border-accent' : ''}`}>
          {piece.content}
          {piece.missing ? <MissingTag short={short} className="absolute right-1.5 top-1.5" /> : null}
        </View>
      ))}
      {more > 0 ? (
        <View className="flex-1 items-center justify-center rounded-thumb bg-sand" testID={moreTestID}>
          <Text variant="bodyMedium">{t('lookDetail.heroMore', { count: more })}</Text>
        </View>
      ) : null}
    </View>
  );
}
