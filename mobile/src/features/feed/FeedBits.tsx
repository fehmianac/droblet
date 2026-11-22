import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { FeedAuthor } from '@/api/contracts/feed';
import { Avatar } from '@/components/blocks/basics';
import { D_PATH, MARK_VIEWBOX } from '@/components/brand/logoPaths';
import { toDisplayUpper } from '@/lib/upper';
import { useThemeColors } from '@/theme/useThemeColors';

/** The verified mark next to "Droblet Edit" (canvas 06″: accent rosette, paper tick). Announced as "Onaylı hesap". */
export function VerifiedBadge({ label, size = 14 }: { label: string; size?: number }) {
  const colors = useThemeColors();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible accessibilityRole="image" accessibilityLabel={label} testID="feed.verified">
      <Path
        d="M12 2l2.4 2.2 3.2-.4.9 3.1 2.9 1.5-1 3.1 1 3.1-2.9 1.5-.9 3.1-3.2-.4L12 22l-2.4-2.2-3.2.4-.9-3.1-2.9-1.5 1-3.1-1-3.1 2.9-1.5.9-3.1 3.2.4z"
        fill={colors.accent}
      />
      <Path d="M8.5 12.2l2.3 2.3 4.7-4.8" fill="none" stroke={colors.paper} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * Author picture of a post: Droblet Edit = the ink circle with the hanger "D" (no tile, no drop — canvas 06″);
 * a stylist = their photo, or initials. Decorative: the name is next to it.
 */
export function AuthorAvatar({ author, size = 34 }: { author: Pick<FeedAuthor, 'kind' | 'name' | 'imageUrl'>; size?: number }) {
  const colors = useThemeColors();
  if (author.kind === 'edit' && !author.imageUrl) {
    return (
      <View className="items-center justify-center rounded-pill bg-ink" style={{ width: size, height: size }} accessible={false}>
        <Svg width={size / 2} height={size / 2} viewBox={MARK_VIEWBOX} accessible={false}>
          <Path d={D_PATH} fill="none" stroke={colors.cream} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </View>
    );
  }
  return <Avatar name={author.name.replace(/^@/, '')} uri={author.imageUrl} size={size} />;
}

/** Initials of a story author for the 32 cream disc of the viewer ("DE" for "Droblet Edit"). */
export function monogram(name: string, language: string): string {
  const words = name.replace(/^@/, '').split(/[\s_.-]+/).filter(Boolean);
  const letters = words.length >= 2 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : (words[0] ?? '').slice(0, 2);
  return toDisplayUpper(letters, language);
}
