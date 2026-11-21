import type { ReactElement } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import { illustrationTones as c } from '@/theme/tokens';

export type EmptyIllustrationKind = 'wardrobe' | 'looks' | 'trips' | 'watchlist' | 'cart';

/** The flat-lay pieces the drawings share (same paths as the canvas garment glyphs). */
const SHIRT = 'M30 4L42 1Q50 7 58 1L70 4L96 20L86 38L78 33L78 84L22 84L22 33L14 38L4 20Z';
const TROUSERS = 'M4 2H56L59 118H37L30 34L23 118H1Z';
const SHOES = 'M4 20Q4 9 14 9L24 10Q36 13 40 19L40 24H4ZM84 20Q84 9 74 9L64 10Q52 13 48 19L48 24H84Z';

/** 22e · Gardırop: the empty rack, three bare hangers, one shirt. */
function Wardrobe() {
  return (
    <>
      <Path d="M26 28H134" stroke={c.wood} strokeWidth={3} strokeLinecap="round" />
      <Path d="M32 28V102M128 28V102M24 102H40M120 102H136" stroke={c.wood} strokeWidth={3} strokeLinecap="round" />
      <G fill="none" stroke={c.ink} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M56 28q0-6 4-6" />
        <Path d="M56 32L44 42H68Z" />
        <Path d="M80 28q0-6 4-6" />
        <Path d="M80 32L68 42H92Z" />
        <Path d="M104 28q0-6 4-6" />
        <Path d="M104 32L92 42H116Z" />
      </G>
      <G transform="translate(90 40) scale(.29)">
        <Path d={SHIRT} fill={c.cream} stroke={c.ink} strokeWidth={3} strokeLinejoin="round" />
      </G>
    </>
  );
}

/** 22e · Lookbook: a dashed look draft (top, trousers, shoes) and the "+" disc. */
function Looks() {
  return (
    <>
      <G fill="none" stroke={c.dash} strokeWidth={3.4} strokeDasharray="7 6" strokeLinejoin="round">
        <Path transform="translate(24 16) scale(.5)" d={SHIRT} />
        <Path transform="translate(90 26) scale(.5)" d={TROUSERS} />
        <Path transform="translate(26 86) scale(.62)" d={SHOES} />
      </G>
      <Circle cx={126} cy={96} r={13} fill={c.ink} />
      <Path d="M126 90v12M120 96h12" stroke={c.cream} strokeWidth={2} strokeLinecap="round" />
    </>
  );
}

/** 22e · Bavul: the suitcase with folded clothes on top. */
function Trips() {
  return (
    <>
      <Rect x={34} y={52} width={92} height={52} rx={9} fill={c.suitcase} stroke={c.ink} strokeWidth={1.5} />
      <Path d="M66 52V44a4 4 0 0 1 4-4h20a4 4 0 0 1 4 4v8" fill="none" stroke={c.ink} strokeWidth={1.5} />
      <Path d="M58 52V104M102 52V104" stroke={c.ink} strokeWidth={1.2} opacity={0.35} />
      <Rect x={40} y={24} width={40} height={14} rx={3} fill={c.cream} stroke={c.ink} strokeWidth={1.2} />
      <Path d="M54 24l6 5 6-5" fill="none" stroke={c.ink} strokeWidth={1.2} />
      <Rect x={84} y={28} width={38} height={11} rx={3} fill={c.navy} />
      <Rect x={44} y={38} width={76} height={12} rx={3} fill={c.oat} stroke={c.ink} strokeWidth={1.2} />
      <Path d="M126 70l10 4-4 9-10-4z" fill={c.cream} stroke={c.ink} strokeWidth={1.2} />
    </>
  );
}

/** 22e · İzleme listesi: shoes and a ticked price tag on its string. */
function Watchlist() {
  return (
    <>
      <G transform="translate(26 62) scale(.95)">
        <Path d={SHOES} fill={c.wood} stroke={c.ink} strokeWidth={1.4} />
      </G>
      <Path
        d="M92 26h30a6 6 0 0 1 6 6v30l-24 24-24-24V38z"
        fill={c.cream}
        stroke={c.ink}
        strokeWidth={1.5}
        strokeLinejoin="round"
        transform="rotate(12 104 56)"
      />
      <Circle cx={108} cy={40} r={4} fill="none" stroke={c.ink} strokeWidth={1.5} />
      <Path d="M108 36Q96 18 78 24" fill="none" stroke={c.wood} strokeWidth={1.4} />
      <Path d="M99 58l5 5 9-10" fill="none" stroke={c.tick} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

/** 22e · Sepet: a shopping bag with a shirt showing. */
function Cart() {
  return (
    <>
      <G transform="translate(58 24) scale(.44)">
        <Path d={SHIRT} fill={c.cream} stroke={c.ink} strokeWidth={3} strokeLinejoin="round" />
      </G>
      <Path d="M46 50h68l-6 54H52z" fill={c.oat} stroke={c.ink} strokeWidth={1.5} strokeLinejoin="round" />
      <Path d="M64 50v-8a16 16 0 0 1 32 0v8" fill="none" stroke={c.ink} strokeWidth={1.5} />
      <Circle cx={64} cy={58} r={2} fill={c.ink} />
      <Circle cx={96} cy={58} r={2} fill={c.ink} />
    </>
  );
}

const DRAWINGS: Record<EmptyIllustrationKind, () => ReactElement> = { wardrobe: Wardrobe, looks: Looks, trips: Trips, watchlist: Watchlist, cart: Cart };

/**
 * Canvas 22d–22e: the 160 × 120 drawing (sand ground, flat-lay pieces) that replaces the 96 icon circle of an
 * empty list, drawn at 168 × 126 as on the boards. Decorative, like the circle's glyph: the headline under it
 * already says what is empty.
 */
export function EmptyIllustration({ kind }: { kind: EmptyIllustrationKind }) {
  const Drawing = DRAWINGS[kind];
  return (
    <View testID={`empty-illustration-${kind}`} accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width={168} height={126} viewBox="0 0 160 120" accessible={false}>
        <Rect width={160} height={120} rx={24} fill={c.ground} />
        <Drawing />
      </Svg>
    </View>
  );
}
