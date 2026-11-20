import { Image } from "expo-image";
import { Sparkles, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import type { ImageRefresh } from "@/lib/images";

import { Badge, ImageTag } from "../Bits";
import { Icon } from "../Icon";
import { Text } from "../Text";

/** One picture of the viewer. */
export type ViewerImage = {
  /** Full size (`itemImageSource(item, 'full')` for a wardrobe piece). */
  uri: string;
  /** Stable expo-image cache key (`${imageCacheKey}:full`, `tryon:{id}`, `photo:{id}`). */
  cacheKey?: string | null;
  /** Called once when the picture fails to load (expired presigned URL); may answer a fresh URL. */
  onExpired?: ImageRefresh;
  /** A smaller variant already in the cache (the tile's thumb), shown while the full one loads. */
  preview?: { uri: string; cacheKey?: string | null } | null;
  /** What a screen reader says for it ("Lacivert yün blazer"). */
  label?: string;
  /** A short caption bottom-left for a non-AI picture (the piece's name on the 16b pager). */
  caption?: string;
  /**
   * An AI-generated picture: "AI önizleme" + its own tag ("SENİN ÜZERİNDE", "YÜZÜN · VÜCUT TİPİN") stay pinned to
   * the bottom of the screen — they never zoom away (BRIEF §3: AI output is always labelled).
   */
  ai?: { tag: string } | null;
};

/** The tile the viewer grows from, in window coordinates. */
export type ViewerOrigin = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
export const DOUBLE_TAP_SCALE = 2;
/** A drag down this far (or a fling) dismisses at 1×. */
export const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;
const PAGE_VELOCITY = 500;
const OPEN_MS = 280;
const SPRING = { damping: 22, stiffness: 220, mass: 0.9 };

function clamp(value: number, min: number, max: number) {
  "worklet";
  return Math.min(Math.max(value, min), max);
}

/** How far a picture of `aspect` (w / h), contained in `width × height` and scaled by `scale`, can travel from the centre. */
export function panBounds(
  width: number,
  height: number,
  aspect: number,
  scale: number,
): { x: number; y: number } {
  "worklet";
  const fitW = Math.min(width, height * aspect);
  const fitH = fitW / aspect;
  return {
    x: Math.max(0, (fitW * scale - width) / 2),
    y: Math.max(0, (fitH * scale - height) / 2),
  };
}

/** Translation that keeps the screen point `focal` (relative to the centre) still while going from (`t0`, `s0`) to `s`. */
export function zoomAround(
  focal: number,
  t0: number,
  s0: number,
  s: number,
): number {
  "worklet";
  return focal - (s * (focal - t0)) / s0;
}

type Props = {
  visible: boolean;
  images: ViewerImage[];
  /** The picture to open on. */
  initialIndex?: number;
  /** The tile it opens from (shared-element-like zoom); without one it fades and scales in. */
  origin?: ViewerOrigin | null;
  onClose: () => void;
  onIndexChange?: (index: number) => void;
  testID?: string;
};

/**
 * Canvas 13a — the full-screen picture viewer, one component for every place a user expects to zoom.
 *
 * - opens by growing from the tapped tile (280 ms); without a measured tile it fades + scales 92 → 100 %;
 * - pinch 1–4× around the fingers, double tap toggles 2× at the tap point, one finger pans while zoomed;
 * - at 1×: a sideways swipe turns the page ("2 / 4" + dots), a drag down dismisses with the backdrop fading;
 * - the × (44 pt) closes; the status bar is hidden; AI labels stay pinned to the bottom of the screen;
 * - screen readers: a modal with "Kapat" (and the escape gesture), the pager is an adjustable element;
 * - reduce motion: no zoom / slide animation — it appears and closes at once.
 */
export function ImageViewer({
  visible,
  images,
  initialIndex = 0,
  origin = null,
  onClose,
  onIndexChange,
  testID = "image-viewer",
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
      supportedOrientations={["portrait"]}
    >
      {visible && images.length > 0 ? (
        <ViewerBody
          images={images}
          initialIndex={Math.min(Math.max(initialIndex, 0), images.length - 1)}
          origin={origin}
          onClose={onClose}
          onIndexChange={onIndexChange}
          testID={testID}
        />
      ) : null}
    </Modal>
  );
}

function ViewerBody({
  images,
  initialIndex,
  origin,
  onClose,
  onIndexChange,
  testID,
}: Omit<Props, "visible"> & { initialIndex: number }) {
  // The gesture callbacks run as worklets on the UI thread. The React Compiler's memoisation of this component broke one of
  // them on device (an exception thrown inside a gesture worklet aborts the app — TestFlight build 18, pinch on the try-on
  // result), so the compiler leaves this component alone.
  "use no memo";
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const { width: W, height: H } = useWindowDimensions();
  const count = images.length;

  const [index, setIndex] = useState(initialIndex);
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const aspectOf = (i: number) => aspects[images[i]?.uri ?? ""] ?? 3 / 4;
  const aspect = aspectOf(index);

  // 0 → 1 open; the zoom state of the page in view; the pager position (in pages) and the dismiss drag.
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const page = useSharedValue(initialIndex);
  const dragX = useSharedValue(0);
  const dismissY = useSharedValue(0);
  // Gesture start values.
  const start = useSharedValue({ s: 1, x: 0, y: 0, fx: 0, fy: 0 });
  const mode = useSharedValue<"none" | "zoom" | "page" | "dismiss">("none");
  const aspectSv = useSharedValue(aspect);
  useEffect(() => {
    aspectSv.set(aspect);
  }, [aspect, aspectSv]);

  useEffect(() => {
    if (!reduceMotion) progress.set(withTiming(1, { duration: OPEN_MS }));
    else progress.set(1);
  }, [progress, reduceMotion]);

  const settleIndex = (next: number) => {
    setIndex(next);
    onIndexChange?.(next);
  };

  const resetZoom = (animated: boolean) => {
    "worklet";
    if (animated) {
      scale.set(withSpring(1, SPRING));
      tx.set(withSpring(0, SPRING));
      ty.set(withSpring(0, SPRING));
    } else {
      scale.set(1);
      tx.set(0);
      ty.set(0);
    }
  };

  /** Close: back into the tile when it is the picture that was tapped, else a fade; immediate with reduce motion. */
  const close = () => {
    if (reduceMotion) {
      onClose();
      return;
    }
    resetZoom(true);
    progress.set(
      withTiming(0, { duration: 220 }, (finished) => {
        if (finished) runOnJS(onClose)();
      }),
    );
  };

  const goTo = (next: number) => {
    if (next < 0 || next >= count || next === index) return;
    resetZoom(false);
    if (reduceMotion) page.set(next);
    else page.set(withSpring(next, SPRING));
    settleIndex(next);
  };

  // ---- gestures ----
  const pinch = Gesture.Pinch()
    .onStart((e) => {
      "worklet";
      try {
        mode.set("zoom");
        start.set({
          s: scale.get(),
          x: tx.get(),
          y: ty.get(),
          fx: e.focalX - W / 2,
          fy: e.focalY - H / 2,
        });
      } catch {
        mode.set("none");
        scale.set(1);
        tx.set(0);
        ty.set(0);
      }
    })
    .onUpdate((e) => {
      "worklet";
      try {
        const s0 = start.get();
        const s = clamp(s0.s * e.scale, MIN_SCALE * 0.8, MAX_SCALE * 1.15);
        const fx = e.focalX - W / 2;
        const fy = e.focalY - H / 2;
        // The point under the fingers at the start stays under them (and follows them as they move).
        tx.set(fx - (s * (s0.fx - s0.x)) / s0.s);
        ty.set(fy - (s * (s0.fy - s0.y)) / s0.s);
        scale.set(s);
      } catch {
        mode.set("none");
        scale.set(1);
        tx.set(0);
        ty.set(0);
      }
    })
    .onEnd(() => {
      "worklet";
      try {
        const s = clamp(scale.get(), MIN_SCALE, MAX_SCALE);
        if (s <= 1.01) {
          resetZoom(!reduceMotion);
        } else {
          const b = panBounds(W, H, aspectSv.get(), s);
          const nx = clamp(tx.get(), -b.x, b.x);
          const ny = clamp(ty.get(), -b.y, b.y);
          scale.set(reduceMotion ? s : withSpring(s, SPRING));
          tx.set(reduceMotion ? nx : withSpring(nx, SPRING));
          ty.set(reduceMotion ? ny : withSpring(ny, SPRING));
        }
        mode.set("none");
      } catch {
        mode.set("none");
        scale.set(1);
        tx.set(0);
        ty.set(0);
      }
    });

  const pan = Gesture.Pan()
    .maxPointers(1)
    .onStart(() => {
      "worklet";
      try {
        start.set({ s: scale.get(), x: tx.get(), y: ty.get(), fx: 0, fy: 0 });
        mode.set(scale.get() > 1.01 ? "zoom" : "none");
      } catch {
        mode.set("none");
        scale.set(1);
        tx.set(0);
        ty.set(0);
      }
    })
    .onUpdate((e) => {
      "worklet";
      try {
        let m = mode.get();
        if (m === "none") {
          m =
            Math.abs(e.translationX) > Math.abs(e.translationY)
              ? "page"
              : "dismiss";
          mode.set(m);
        }
        if (m === "zoom") {
          const s0 = start.get();
          const b = panBounds(W, H, aspectSv.get(), scale.get());
          const rubber = (v: number, limit: number) =>
            Math.abs(v) <= limit
              ? v
              : Math.sign(v) * (limit + (Math.abs(v) - limit) * 0.3);
          tx.set(rubber(s0.x + e.translationX, b.x));
          ty.set(rubber(s0.y + e.translationY, b.y));
        } else if (m === "page") {
          const at = page.get();
          const edge =
            (at <= 0 && e.translationX > 0) ||
            (at >= count - 1 && e.translationX < 0);
          dragX.set(edge ? e.translationX * 0.3 : e.translationX);
        } else {
          dismissY.set(e.translationY);
        }
      } catch {
        mode.set("none");
        scale.set(1);
        tx.set(0);
        ty.set(0);
      }
    })
    .onEnd((e) => {
      "worklet";
      try {
        const m = mode.get();
        if (m === "zoom") {
          const b = panBounds(W, H, aspectSv.get(), scale.get());
          tx.set(
            withSpring(clamp(tx.get() + e.velocityX * 0.05, -b.x, b.x), SPRING),
          );
          ty.set(
            withSpring(clamp(ty.get() + e.velocityY * 0.05, -b.y, b.y), SPRING),
          );
        } else if (m === "page") {
          const from = Math.round(page.get());
          let next = from;
          if (
            (dragX.get() < -W / 4 || e.velocityX < -PAGE_VELOCITY) &&
            from < count - 1
          )
            next = from + 1;
          else if (
            (dragX.get() > W / 4 || e.velocityX > PAGE_VELOCITY) &&
            from > 0
          )
            next = from - 1;
          // Fold the drag into the page position, then settle on the target.
          page.set(from - dragX.get() / W);
          dragX.set(0);
          page.set(reduceMotion ? next : withSpring(next, SPRING));
          if (next !== from) runOnJS(settleIndex)(next);
        } else if (m === "dismiss") {
          if (
            Math.abs(dismissY.get()) > DISMISS_DISTANCE ||
            Math.abs(e.velocityY) > DISMISS_VELOCITY
          ) {
            const target = (dismissY.get() >= 0 ? 1 : -1) * H;
            if (reduceMotion) runOnJS(onClose)();
            else
              dismissY.set(
                withTiming(target, { duration: 180 }, (finished) => {
                  if (finished) runOnJS(onClose)();
                }),
              );
          } else {
            dismissY.set(reduceMotion ? 0 : withSpring(0, SPRING));
          }
        }
        mode.set("none");
      } catch {
        mode.set("none");
        scale.set(1);
        tx.set(0);
        ty.set(0);
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd((e, success) => {
      "worklet";
      try {
        if (!success) return;
        if (scale.get() > 1.01) {
          resetZoom(!reduceMotion);
          return;
        }
        const s = DOUBLE_TAP_SCALE;
        const b = panBounds(W, H, aspectSv.get(), s);
        const nx = clamp(zoomAround(e.x - W / 2, 0, 1, s), -b.x, b.x);
        const ny = clamp(zoomAround(e.y - H / 2, 0, 1, s), -b.y, b.y);
        scale.set(reduceMotion ? s : withSpring(s, SPRING));
        tx.set(reduceMotion ? nx : withSpring(nx, SPRING));
        ty.set(reduceMotion ? ny : withSpring(ny, SPRING));
      } catch {
        mode.set("none");
        scale.set(1);
        tx.set(0);
        ty.set(0);
      }
    });

  const gesture = Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));

  // ---- styles ----
  const backdrop = useAnimatedStyle(() => ({
    opacity:
      progress.get() *
      (1 - Math.min(Math.abs(dismissY.get()) / (H * 0.6), 0.85)),
  }));
  const chrome = useAnimatedStyle(() => ({
    opacity: progress.get() * (1 - Math.min(Math.abs(dismissY.get()) / 200, 1)),
  }));
  const strip = useAnimatedStyle(() => ({
    transform: [{ translateX: -page.get() * W + dragX.get() }],
  }));

  // The open / close zoom: from the tile when it is the picture that was tapped, else a fade + 92 % scale.
  const fromTile = Boolean(origin) && index === initialIndex;
  const fit = (() => {
    const fitW = Math.min(W, H * aspect);
    return { w: fitW, h: fitW / aspect };
  })();
  const o = origin ?? { x: W / 2, y: H / 2, width: W, height: H };
  const startScale = fromTile
    ? Math.max(o.width / fit.w, o.height / fit.h)
    : 0.92;
  const startX = fromTile ? o.x + o.width / 2 - W / 2 : 0;
  const startY = fromTile ? o.y + o.height / 2 - H / 2 : 0;
  const pageStyle = useAnimatedStyle(() => {
    const p = progress.get();
    const s0 = startScale + (1 - startScale) * p;
    return {
      opacity: fromTile ? 1 : p,
      transform: [
        { translateX: startX * (1 - p) + tx.get() },
        { translateY: startY * (1 - p) + ty.get() + dismissY.get() },
        { scale: s0 * scale.get() },
      ],
    };
  });

  const current = images[index];
  return (
    <GestureHandlerRootView style={styles.fill}>
      <StatusBar hidden animated />
      <View
        style={styles.fill}
        accessibilityViewIsModal
        onAccessibilityEscape={close}
        testID={testID}
      >
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.backdrop, backdrop]}
          testID={`${testID}.backdrop`}
        />
        <GestureDetector gesture={gesture}>
          <View
            style={styles.fill}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={current?.label ?? t("viewer.imageA11y")}
            accessibilityValue={{
              text: t("viewer.position", { current: index + 1, total: count }),
            }}
            accessibilityHint={count > 1 ? t("viewer.pagerHint") : undefined}
            accessibilityActions={[
              { name: "increment", label: t("viewer.next") },
              { name: "decrement", label: t("viewer.previous") },
              { name: "escape", label: t("common.close") },
            ]}
            onAccessibilityAction={(e) => {
              const name = e.nativeEvent.actionName;
              if (name === "escape") close();
              else goTo(index + (name === "decrement" ? -1 : 1));
            }}
            testID={`${testID}.pager`}
          >
            <Animated.View
              style={[
                { width: W * count, height: H, flexDirection: "row" },
                strip,
              ]}
            >
              {images.map((img, i) => (
                <View
                  key={`${img.uri}-${i}`}
                  style={{
                    width: W,
                    height: H,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Page
                    uri={img.uri}
                    cacheKey={img.cacheKey ?? null}
                    onExpired={img.onExpired}
                    preview={img.preview ?? null}
                    active={i === index}
                    style={pageStyle}
                    size={{
                      w: Math.min(W, H * aspectOf(i)),
                      h: Math.min(W, H * aspectOf(i)) / aspectOf(i),
                    }}
                    onAspect={(a) =>
                      setAspects((prev) =>
                        prev[img.uri] === a ? prev : { ...prev, [img.uri]: a },
                      )
                    }
                    testID={`${testID}.image.${i}`}
                  />
                </View>
              ))}
            </Animated.View>
          </View>
        </GestureDetector>

        {/* Chrome: the counter, ×, the AI labels / caption and the dots. */}
        <Animated.View
          style={[StyleSheet.absoluteFill, chrome]}
          pointerEvents="box-none"
        >
          {count > 1 ? (
            <View
              pointerEvents="none"
              style={[styles.counter, { top: insets.top + 14 }]}
            >
              <View className="rounded-pill bg-cream/15 px-3 py-1">
                <Text
                  variant="bodyMedium"
                  tone="cream"
                  className="text-[13px]"
                  testID={`${testID}.counter`}
                >
                  {t("viewer.position", { current: index + 1, total: count })}
                </Text>
              </View>
            </View>
          ) : null}
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
            hitSlop={8}
            style={[styles.close, { top: insets.top + 4 }]}
            testID={`${testID}.close`}
          >
            <Icon icon={X} size={20} tone="cream" />
          </Pressable>
          <View
            pointerEvents="none"
            style={[
              styles.bottom,
              { bottom: Math.max(insets.bottom, 16) + 18 },
            ]}
          >
            {current?.ai ? (
              <View
                className="flex-row items-center gap-2"
                testID={`${testID}.aiTag`}
              >
                <Badge
                  tone="sand"
                  icon={Sparkles}
                  label={t("ai.previewBadge")}
                />
                <ImageTag label={current.ai.tag} />
              </View>
            ) : current?.caption ? (
              <Text
                variant="body"
                tone="cream"
                className="text-[13px]"
                numberOfLines={1}
                testID={`${testID}.caption`}
              >
                {current.caption}
              </Text>
            ) : (
              <View />
            )}
            {count > 1 ? (
              <View className="flex-row gap-1" testID={`${testID}.dots`}>
                {images.map((img, i) => (
                  <View
                    key={`${img.uri}-dot-${i}`}
                    className={`h-1.5 rounded-[3px] ${i === index ? "w-4 bg-cream" : "w-1.5 bg-cream/35"}`}
                  />
                ))}
              </View>
            ) : null}
          </View>
        </Animated.View>
      </View>
    </GestureHandlerRootView>
  );
}

function Page({
  uri,
  cacheKey,
  onExpired,
  preview,
  active,
  style,
  size,
  onAspect,
  testID,
}: {
  uri: string;
  cacheKey: string | null;
  onExpired?: ImageRefresh;
  preview: { uri: string; cacheKey?: string | null } | null;
  active: boolean;
  style: ReturnType<typeof useAnimatedStyle>;
  size: { w: number; h: number };
  onAspect: (aspect: number) => void;
  testID: string;
}) {
  // A fresh URL answered by `onExpired` (once per page) for the `uri` it replaced.
  const [fresh, setFresh] = useState<{ from: string; uri: string } | null>(
    null,
  );
  const refreshed = useRef(false);
  const current = fresh?.from === uri ? fresh.uri : uri;
  return (
    <Animated.View
      style={[{ width: size.w, height: size.h }, active ? style : null]}
    >
      <Image
        source={cacheKey ? { uri: current, cacheKey } : { uri: current }}
        recyclingKey={cacheKey ?? current}
        placeholder={
          preview
            ? preview.cacheKey
              ? { uri: preview.uri, cacheKey: preview.cacheKey }
              : { uri: preview.uri }
            : undefined
        }
        placeholderContentFit="contain"
        onError={() => {
          if (!onExpired || refreshed.current) return;
          refreshed.current = true;
          const from = uri;
          Promise.resolve()
            .then(onExpired)
            .then((next) => {
              if (typeof next === "string" && next)
                setFresh({ from, uri: next });
            })
            .catch(() => undefined);
        }}
        contentFit="contain"
        style={styles.fill}
        cachePolicy="memory-disk"
        transition={0}
        onLoad={(e) => {
          const { width, height } = e.source;
          if (width > 0 && height > 0) onAspect(width / height);
        }}
        accessible={false}
        testID={testID}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { backgroundColor: "rgb(14, 13, 12)" },
  counter: {
    position: "absolute",
    alignSelf: "center",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  close: {
    position: "absolute",
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(244, 241, 236, 0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  bottom: {
    position: "absolute",
    left: 16,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
