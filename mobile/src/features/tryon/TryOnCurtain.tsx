import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import type { TryOnPiece } from '@/api/contracts/tryon';
import { Text } from '@/components/ui/Text';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { curtainTones } from '@/theme/tokens';

import { isWornPiece } from './pieces';

/** Canvas 21e "Deneme kabini perdesi": linen tones, independent of the theme (the stage is a photo-like surface). */
const CURTAIN = {
  ...curtainTones,
  stripes: [
    { w: 10, c: curtainTones.stripeA },
    { w: 12, c: curtainTones.stripeB },
    { w: 8, c: curtainTones.stripeC },
    { w: 10, c: curtainTones.stripeD },
  ],
  plate: 'rgba(251,249,245,0.95)',
};

/** At most this many rows; the rest is "ve N parça daha". */
export const CURTAIN_MAX_ROWS = 4;
/** Hold on the all-✓ "Hazır" card before the curtain opens (canvas n_ux1 B: "Hazır" + opening ~1.2 s in all). */
const READY_HOLD_MS = 400;
const OPEN_MS = 800;
/** Hold on the open curtain before the result screen takes over. */
const OPEN_HOLD_MS = 0;
const CARD_FADE_MS = 200;
const REDUCED_OPEN_MS = 300;

/** From "Hazır" to `onRevealed` (exported for tests): ~1.2 s, shorter with reduce motion (the curtain fades). */
export function curtainRevealMs(reduceMotion: boolean): number {
  return READY_HOLD_MS + (reduceMotion ? REDUCED_OPEN_MS : OPEN_MS) + OPEN_HOLD_MS;
}

/**
 * How long each piece is "being put on": the pieces share ~24 s (the usual try-on takes 20–40 s), 3–7 s each.
 * The last piece stays "…iyor" until the result arrives.
 */
export function curtainStepMs(count: number): number {
  return Math.min(7000, Math.max(3000, Math.round(24000 / Math.max(1, count))));
}

export type CurtainRow = {
  key: string;
  name: string;
  worn: boolean;
  state: 'pending' | 'active' | 'done';
};

/** The rows of the card at `elapsedMs` (exported for tests). No pieces → one "Kombin" row. */
export function curtainRows(
  pieces: TryOnPiece[],
  elapsedMs: number,
  done: boolean,
  fallbackName: (piece: TryOnPiece) => string,
  outfitName: string,
): CurtainRow[] {
  const list = pieces.length > 0 ? pieces : [{ name: outfitName, category: 'top' as const }];
  const shown = list.slice(0, CURTAIN_MAX_ROWS);
  const active = Math.min(Math.floor(Math.max(0, elapsedMs) / curtainStepMs(shown.length)), shown.length - 1);
  return shown.map((piece, index) => ({
    key: `${index}`,
    name: piece.name ?? fallbackName(piece),
    worn: isWornPiece(piece.category),
    state: done || index < active ? 'done' : index === active ? 'active' : 'pending',
  }));
}

type Props = {
  pieces: TryOnPiece[];
  /** When the wait started (ms epoch); the rows advance from here. */
  startedAt: number;
  /** The result is ready: every row ✓, "Hazır", then the curtain opens over `revealImage`. */
  reveal?: boolean;
  /** What is behind the curtain once it opens (the result image). */
  revealImage?: ReactNode;
  /** Called once the curtain has opened and held — or at once when the curtain is tapped during the reveal. */
  onRevealed?: () => void;
  /** The wait stopped (error): the curtain stands still, no card. */
  stopped?: boolean;
  className?: string;
};

/**
 * "Üzerimde gör" wait (canvas 21e): a closed linen curtain on a rail; the card in the middle says "Hazırlanıyor…" and
 * puts the outfit's pieces on one by one by their own names ("Lacivert blazer giyiliyor…" → "… giyildi"). When the
 * result is in, the card reads "Hazır", fades, and the curtain draws to both sides over the image. Nothing behind the
 * curtain shows while it is closed. A tap anywhere during the reveal skips straight to the result. Reduce motion: no
 * sway or pulse; the curtain fades instead of drawing.
 */
export function TryOnCurtain({ pieces, startedAt, reveal = false, revealImage, onRevealed, stopped = false, className }: Props) {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const { width } = useWindowDimensions();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (reveal || stopped) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [reveal, stopped]);

  const rows = useMemo(
    () => curtainRows(pieces, now - startedAt, reveal, (p) => t(`itemCategory.${p.category}`), t('ai.tryOnCurtain.outfit')),
    [pieces, now, startedAt, reveal, t],
  );
  const extra = Math.max(0, pieces.length - CURTAIN_MAX_ROWS);

  // Sway of the folds (both panels, opposite phase).
  const sway = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion || stopped || reveal) {
      cancelAnimation(sway);
      return;
    }
    sway.value = withRepeat(withTiming(1, { duration: 4000, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(sway);
  }, [reduceMotion, stopped, reveal, sway]);

  // Card fade + curtain opening.
  const open = useSharedValue(0);
  const card = useSharedValue(1);
  // `onRevealed` runs once per reveal: after the sequence, or on a tap that skips it.
  const revealed = useRef(false);
  const finish = () => {
    if (revealed.current) return;
    revealed.current = true;
    onRevealed?.();
  };
  useEffect(() => {
    if (!reveal) {
      revealed.current = false;
      open.value = 0;
      card.value = 1;
      return;
    }
    card.value = withDelay(READY_HOLD_MS, withTiming(0, { duration: CARD_FADE_MS }));
    open.value = withDelay(
      READY_HOLD_MS,
      withTiming(1, {
        duration: reduceMotion ? REDUCED_OPEN_MS : OPEN_MS,
        easing: Easing.bezier(0.6, 0, 0.3, 1),
      }),
    );
    const id = setTimeout(finish, curtainRevealMs(reduceMotion));
    return () => clearTimeout(id);
    // onRevealed is a callback of the screen; the sequence runs once per reveal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal, reduceMotion]);

  const leftStyle = useAnimatedStyle(() => (reduceMotion ? { opacity: 1 - open.value } : { transform: [{ scaleX: 1 - 0.84 * open.value }] }));
  const rightStyle = useAnimatedStyle(() => (reduceMotion ? { opacity: 1 - open.value } : { transform: [{ scaleX: 1 - 0.84 * open.value }] }));
  const leftFolds = useAnimatedStyle(() => ({
    transform: [{ translateX: sway.value * 6 }],
  }));
  const rightFolds = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - sway.value) * 6 }],
  }));
  const cardStyle = useAnimatedStyle(() => ({ opacity: card.value }));

  const plateWidth = Math.min(300, width - 48);
  const status = rows.find((r) => r.state === 'active');
  const statusLabel = reveal
    ? t('ai.tryOnCurtain.ready')
    : status
      ? t(status.worn ? 'ai.tryOnCurtain.wearing' : 'ai.tryOnCurtain.adding', {
          name: status.name,
        })
      : t('ai.tryOnCurtain.preparing');

  return (
    <View
      className={`overflow-hidden ${className ?? ''}`}
      style={{ backgroundColor: CURTAIN.ground }}
      accessibilityState={{ busy: !reveal && !stopped }}
    >
      {revealImage ? <View style={StyleSheet.absoluteFill}>{revealImage}</View> : null}

      <Animated.View style={[styles.panel, styles.left, leftStyle]} pointerEvents="none" testID="tryon.curtain.left">
        <Folds style={leftFolds} seam="right" />
      </Animated.View>
      <Animated.View style={[styles.panel, styles.right, rightStyle]} pointerEvents="none" testID="tryon.curtain.right">
        <Folds style={rightFolds} seam="left" />
      </Animated.View>
      <View style={styles.rail} pointerEvents="none" />

      {stopped ? null : (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="box-none">
          <Animated.View
            style={[styles.plate, { width: plateWidth }, cardStyle]}
            accessible
            accessibilityRole="text"
            accessibilityLiveRegion="polite"
            accessibilityLabel={statusLabel}
            testID="tryon.curtain.card"
          >
            <View className="flex-row items-center gap-1.5" style={{ height: 30 }}>
              <Text variant="h2" style={{ color: CURTAIN.ink, fontSize: 26, lineHeight: 30 }} maxFontSizeMultiplier={1.2}>
                {reveal ? t('ai.tryOnCurtain.ready') : t('ai.tryOnCurtain.preparing')}
              </Text>
              {reveal ? null : <Dots paused={reduceMotion} />}
            </View>
            <View style={{ gap: 6 }}>
              {rows.map((row) => (
                <Row key={`${row.key}-${row.state}`} row={row} pulse={!reduceMotion} />
              ))}
              {extra > 0 ? (
                <Text variant="caption" style={{ color: CURTAIN.muted, paddingLeft: 25 }} testID="tryon.curtain.more">
                  {t('ai.tryOnCurtain.more', { count: extra })}
                </Text>
              ) : null}
            </View>
          </Animated.View>
        </View>
      )}

      {reveal && onRevealed ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={finish}
          accessibilityRole="button"
          accessibilityLabel={t('ai.tryOnCurtain.skip')}
          testID="tryon.curtain.skip"
        />
      ) : null}
    </View>
  );
}

function Folds({ style, seam }: { style: object; seam: 'left' | 'right' }) {
  const stripes = useMemo(() => {
    const out: { w: number; c: string }[] = [];
    let total = 0;
    while (total < 280) {
      for (const s of CURTAIN.stripes) {
        out.push(s);
        total += s.w;
      }
    }
    return out;
  }, []);
  return (
    <>
      <Animated.View style={[styles.folds, style]}>
        {stripes.map((s, i) => (
          <View key={i} style={{ width: s.w, backgroundColor: s.c }} />
        ))}
      </Animated.View>
      <LinearGradient
        colors={['rgba(28,26,23,0.10)', 'rgba(28,26,23,0)', 'rgba(28,26,23,0)', 'rgba(28,26,23,0.14)']}
        locations={[0, 0.22, 0.78, 1]}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={seam === 'right' ? ['rgba(28,26,23,0)', 'rgba(28,26,23,0.28)'] : ['rgba(28,26,23,0.28)', 'rgba(28,26,23,0)']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[styles.seamShade, seam === 'right' ? { right: 0 } : { left: 0 }]}
      />
    </>
  );
}

function Dots({ paused }: { paused: boolean }) {
  return (
    <View className="flex-row gap-1" style={{ marginTop: 8 }} aria-hidden>
      {[0, 200, 400].map((delay) => (
        <Dot key={delay} delay={delay} paused={paused} />
      ))}
    </View>
  );
}

function Dot({ delay, paused }: { delay: number; paused: boolean }) {
  const o = useSharedValue(paused ? 1 : 0.2);
  useEffect(() => {
    if (paused) {
      cancelAnimation(o);
      o.value = 1;
      return;
    }
    o.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 480 }), withTiming(0.2, { duration: 720 })), -1, false));
    return () => cancelAnimation(o);
  }, [delay, paused, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: 4, height: 4, borderRadius: 2, backgroundColor: CURTAIN.ink }, style]} />;
}

function Row({ row, pulse }: { row: CurtainRow; pulse: boolean }) {
  const { t } = useTranslation();
  // Each state is its own mount (keyed by state): it fades in when a piece moves on.
  const shown = useSharedValue(pulse ? 0 : 1);
  useEffect(() => {
    shown.value = withTiming(1, { duration: 250 });
  }, [shown]);
  const fade = useAnimatedStyle(() => ({ opacity: shown.value }));
  const label =
    row.state === 'active'
      ? t(row.worn ? 'ai.tryOnCurtain.wearing' : 'ai.tryOnCurtain.adding', {
          name: row.name,
        })
      : row.state === 'done'
        ? t(row.worn ? 'ai.tryOnCurtain.worn' : 'ai.tryOnCurtain.added', {
            name: row.name,
          })
        : row.name;
  return (
    <Animated.View className="flex-row items-center" style={[{ height: 22, gap: 9 }, fade]}
      testID={`tryon.curtain.row.${row.state}`}
    >
      <View
        style={{
          width: 16,
          height: 16,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {row.state === 'done' ? (
          <View
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: CURTAIN.ink,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Svg width={9} height={9} viewBox="0 0 24 24" fill="none">
              <Path d="M5 12.5l4.5 4.5L19 7" stroke={CURTAIN.cream} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </View>
        ) : row.state === 'active' ? (
          <Pulse enabled={pulse} />
        ) : (
          <View
            style={{
              width: 12,
              height: 12,
              borderRadius: 6,
              borderWidth: 1.5,
              borderColor: CURTAIN.ring,
            }}
          />
        )}
      </View>
      <Text
        numberOfLines={1}
        className="flex-1"
        maxFontSizeMultiplier={1.2}
        style={{
          fontSize: 14,
          color: row.state === 'pending' ? CURTAIN.muted : CURTAIN.ink,
          fontWeight: row.state === 'active' ? '500' : '400',
        }}
      >
        {label}
      </Text>
    </Animated.View>
  );
}

function Pulse({ enabled }: { enabled: boolean }) {
  const s = useSharedValue(1);
  useEffect(() => {
    if (!enabled) return;
    s.value = withRepeat(withTiming(0.7, { duration: 1000, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(s);
  }, [enabled, s]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: s.value }],
    opacity: 0.6 + 0.4 * s.value,
  }));
  return (
    <Animated.View
      style={[
        {
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: CURTAIN.accent,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '50%',
    overflow: 'hidden',
  },
  left: { left: 0, transformOrigin: 'left top' },
  right: { right: 0, transformOrigin: 'right top' },
  folds: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: -12,
    right: -12,
    flexDirection: 'row',
  },
  seamShade: { position: 'absolute', top: 0, bottom: 0, width: 18 },
  rail: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 8,
    height: 4,
    borderRadius: 2,
    backgroundColor: CURTAIN.rail,
  },
  center: { alignItems: 'center', justifyContent: 'center', paddingTop: 24 },
  plate: {
    paddingTop: 16,
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderRadius: 16,
    backgroundColor: CURTAIN.plate,
    gap: 10,
    shadowColor: curtainTones.ink,
    shadowOpacity: 0.18,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
});
