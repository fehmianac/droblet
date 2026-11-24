import type { TFunction } from "i18next";
import { router, useLocalSearchParams } from "expo-router";
import {
  Bookmark,
  Check,
  CircleAlert,
  Cloud,
  CloudRain,
  Ellipsis,
  MirrorRound,
  Pencil,
  Share as ShareIcon,
  Snowflake,
  Sun,
  Trash2,
  type LucideIcon,
} from "lucide-react-native";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Share, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type {
  TripDay,
  TripDetail,
  TripMissingPiece,
  WeatherCondition,
} from "@/api/contracts/trips";
import { ITEM_CATEGORIES } from "@/api/contracts/wardrobe";
import { PopoverMenu } from "@/components/ui/Bits";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { ScreenState } from "@/components/ui/ScreenState";
import { Text } from "@/components/ui/Text";
import { CreditConfirmSheet } from "@/features/credits/CreditConfirmSheet";
import { useSpendConfirm } from "@/features/credits/spendConfirm";
import { indexItems } from "@/features/looks/LookCover";
import { useTrip, useTripWrites } from "@/features/trips/api";
import {
  forecastNotice,
  groupByCategory,
  rainyDayCount,
  readiness,
  temperatureRange,
  tripLengthDays,
  tripShareText,
  weatherNotes,
} from "@/features/trips/logic";
import { TripDaySheet } from "@/features/trips/TripDaySheet";
import { TripPacking } from "@/features/trips/TripPacking";
import { RequirementHint } from "@/features/requirements/RequirementHint";
import { useGate } from "@/features/requirements/useRequirements";
import { useCachedTryOnImages } from "@/features/tryon/cached";
import { TryOnResultImage } from "@/features/tryon/TryOnResultImage";
import {
  GapFillBanner,
  useAddSuggestedPieces,
} from "@/features/stylist/gapFill";
import { ensureTryOnConsent, useStartTryOn } from "@/features/tryon/api";
import { itemImageSource } from "@/api/imageSources";
import { ItemThumb } from "@/features/wardrobe/ItemThumb";
import { useItems } from "@/features/wardrobe/queries";
import { useAppLanguage } from "@/i18n/useAppLanguage";
import {
  formatDate,
  formatDateRange,
  formatTemperature,
  parseLocalDate,
  weekdayShort,
} from "@/lib/format";
import { toDisplayUpper } from "@/lib/upper";
import { useIsOnline } from "@/sync/network";
import { placeholderTones } from "@/theme/tokens";
import { useTeenRules } from "@/features/teen/store";

const WEATHER_ICON: Record<WeatherCondition, LucideIcon> = {
  sun: Sun,
  cloud: Cloud,
  rain: CloudRain,
  snow: Snowflake,
};

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace("/wardrobe/trips");
}

const NOTICE_TEXT = {
  partial: "tripDetail.forecastPartial",
  notYet: "tripDetail.forecastNotYet",
  noLocation: "tripDetail.forecastNoLocation",
  unavailable: "tripDetail.forecastUnavailable",
} as const;

/** Why the forecast is missing or partial (one muted line); nothing when every day is known. */
function ForecastNote({ trip }: { trip: TripDetail }) {
  const { t } = useTranslation();
  const notice = forecastNotice(trip);
  return notice ? (
    <Text variant="caption" tone="muted" testID={`trip-forecast-${notice}`}>
      {t(NOTICE_TEXT[notice])}
    </Text>
  ) : null;
}

/** "9° / 4°" (high / low); a single figure when the day has only one temperature. */
function dayTemperature(
  t: TFunction,
  weather: { temperatureC: number; minC?: number | null; maxC?: number | null },
) {
  const max = weather.maxC ?? weather.temperatureC;
  const min = weather.minC ?? weather.temperatureC;
  return max === min
    ? formatTemperature(max)
    : t("tripDetail.dayTemp", {
        max: formatTemperature(max),
        min: formatTemperature(min),
      });
}

type DayImage =
  | { jobId: string; tryOnId: string; imageUrl: string | null }
  | null
  | undefined;

/**
 * 19 "Günler": one card per planned day, scrolled sideways — date, weather, the day's pieces (2 × 2) and beside them
 * the look on the user. That image is never made on its own (owner rule: no speculative AI spend): an existing one is
 * shown, otherwise the slot invites and "Üzerimde gör · 1 kredi" starts it.
 */
function DayCards({
  trip,
  images,
  onTryOn,
  onOpenImage,
  onOpenDay,
  onSaveAsLook,
}: {
  trip: TripDetail;
  images: Record<string, DayImage>;
  onTryOn: (day: TripDay) => void;
  onOpenImage: (jobId: string) => void;
  onOpenDay: (day: TripDay) => void;
  onSaveAsLook: (day: TripDay) => void;
}) {
  const language = useAppLanguage();
  const { t } = useTranslation();
  const items = useItems();
  const itemsById = indexItems(items.data);
  const planned = trip.days.filter((d) => d.look);
  if (planned.length === 0) return null;
  const weatherOf = (date: string) =>
    trip.forecast?.find((f) => f.date === date) ?? null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={t("tripDetail.dailyLooks")}
      className="-mx-gutter"
      contentContainerClassName="gap-2.5 px-gutter"
    >
      {planned.map((day) => {
        const ref = day.look;
        if (!ref) return null;
        const date = parseLocalDate(day.date);
        const weekday = weekdayShort(date);
        const weather = weatherOf(day.date);
        const image = images[`${trip.id}:${day.date}`];
        const pieces = (day.itemIds ?? []).flatMap((id) => {
          const item = itemsById.get(id);
          return item ? [item] : [];
        });
        const shown = pieces.slice(0, 4);
        return (
          <View
            key={day.date}
            className="w-[286px] gap-2.5 rounded-card border border-line bg-paper p-3"
            testID={`trip-day-card-${day.date}`}
          >
            <View className="flex-row items-start justify-between">
              <View className="gap-1">
                <Text variant="eyebrow">
                  {toDisplayUpper(
                    formatDate(date, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    }),
                    language,
                  )}
                </Text>
                {weather ? (
                  <View
                    className="flex-row items-center gap-1.5"
                    accessible
                    accessibilityLabel={[
                      t(`tripDetail.condition.${weather.condition}`),
                      weather.rainChance !== null &&
                      weather.rainChance !== undefined
                        ? t("tripDetail.dayRain", {
                            chance: weather.rainChance,
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  >
                    <Icon
                      icon={WEATHER_ICON[weather.condition]}
                      size={15}
                      tone="muted"
                    />
                    {weather.rainChance !== null &&
                    weather.rainChance !== undefined ? (
                      <Text variant="caption" tone="muted">
                        {t("tripDetail.dayRain", {
                          chance: weather.rainChance,
                        })}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
              {weather ? (
                <Text variant="bodyMedium" className="text-[15px]">
                  {dayTemperature(t, weather)}
                </Text>
              ) : null}
            </View>

            <View className="h-[204px] flex-row gap-2">
              {shown.length > 0 ? (
                <Pressable
                  onPress={() => onOpenDay(day)}
                  accessibilityRole="button"
                  accessibilityLabel={t("tripDetail.dayLook", {
                    weekday,
                    name: ref.name,
                  })}
                  accessibilityHint={t("tripDetail.dayPieces", {
                    count: pieces.length,
                  })}
                  className="flex-1 flex-row flex-wrap content-between justify-between active:opacity-80"
                  testID={`trip-day-${day.date}`}
                >
                  {shown.map((item) => (
                    <ItemThumb
                      key={item.id}
                      category={item.category}
                      color={item.color}
                      {...itemImageSource(item, "thumb")}
                      className="h-[98px] w-[48%] rounded-thumb"
                      glyphSize={20}
                    />
                  ))}
                </Pressable>
              ) : null}
              <View className="flex-1 overflow-hidden rounded-field bg-sand">
                {image ? (
                  <Pressable
                    onPress={() => onOpenImage(image.jobId)}
                    accessibilityRole="button"
                    accessibilityLabel={t("tripDetail.dayOpenImage")}
                    className="flex-1 active:opacity-80"
                    testID={`trip-day-image-${day.date}`}
                  >
                    <TryOnResultImage
                      tryOnId={image.tryOnId}
                      url={image.imageUrl}
                      className="h-full w-full"
                      accessibilityLabel={t("tryOn.imageA11yNamed", {
                        name: ref.name || trip.cityName,
                      })}
                    />
                  </Pressable>
                ) : (
                  <View className="flex-1 items-center justify-center gap-2 px-2.5">
                    <Icon icon={MirrorRound} size={26} tone="muted" />
                    <Text
                      variant="caption"
                      tone="muted"
                      className="text-center"
                    >
                      {t("tripDetail.dayInvite")}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {image ? (
              <Button
                variant="secondary"
                size="md"
                label={t("tripDetail.dayOpenImage")}
                onPress={() => onOpenImage(image.jobId)}
                testID={`trip-day-open-${day.date}`}
              />
            ) : (
              <Button
                variant="secondary"
                size="md"
                label={t("tripDetail.dayTryOnCost")}
                onPress={() => onTryOn(day)}
                testID={`trip-day-tryon-${day.date}`}
              />
            )}
            <Pressable
              onPress={() => onSaveAsLook(day)}
              accessibilityRole="button"
              accessibilityLabel={t("tripDetail.daySaveLook")}
              className="min-h-icon-btn flex-row items-center justify-center gap-1.5 active:opacity-70"
              testID={`trip-day-save-${day.date}`}
            >
              <Icon icon={Bookmark} size={16} />
              <Text variant="label">{t("tripDetail.daySaveLook")}</Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

/** Square check mark of the canvas checklists (accent-colour ink when on). */
function CheckBox({ checked, size }: { checked: boolean; size: 18 | 20 }) {
  return (
    <View
      className={`items-center justify-center rounded-[4px] border ${checked ? "border-ink bg-ink" : "border-muted bg-paper"}`}
      style={{ width: size, height: size }}
    >
      {checked ? <Icon icon={Check} size={size - 6} tone="paper" /> : null}
    </View>
  );
}

function MissingCard({ piece }: { piece: TripMissingPiece }) {
  const { t } = useTranslation();
  const hideCommerce = useTeenRules().hide.commerce;
  const suggested = useAddSuggestedPieces();
  const productId = piece.productId;
  const libraryItemId = piece.libraryItemId ?? null;
  if (libraryItemId) {
    const added = suggested.isAdded(libraryItemId);
    return (
      <View
        className="flex-row items-center gap-2.5 rounded-card border border-accent bg-paper px-3 py-2.5"
        testID={`trip-suggested-${libraryItemId}`}
      >
        <View
          className="overflow-hidden rounded-[8px] border-[1.5px] border-dashed"
          style={{ borderColor: placeholderTones.camel }}
        >
          <ItemThumb
            category={piece.category ?? "accessory"}
            color="black"
            className="h-[41px] w-[37px]"
            glyphSize={20}
          />
        </View>
        <View className="flex-1 gap-0.5">
          <Text variant="eyebrow" tone="accent">
            {t("req.gapFill.library")}
          </Text>
          <Text variant="body" className="text-[13.5px]">
            {piece.name}
          </Text>
        </View>
        {added ? (
          <Icon icon={Check} size={18} />
        ) : (
          <Button
            variant="secondary"
            size="md"
            label={t("req.gapFill.add")}
            onPress={() =>
              void suggested.add([libraryItemId]).catch(() => undefined)
            }
            className="px-3"
            testID={`trip-suggested-add-${libraryItemId}`}
          />
        )}
      </View>
    );
  }
  // A catalog pick (gap filling from the store): the same "Önerilen · Mağaza" + "Gör" as the stylist results.
  // Canvas 18: no store picks for a teen (the server fills gaps from the library only).
  if (productId && !hideCommerce) {
    const open = () =>
      router.push({
        pathname: "/shop/product/[id]",
        params: { id: productId },
      });
    return (
      <View
        className="flex-row items-center gap-2.5 rounded-card border border-accent bg-paper px-3 py-2.5"
        testID={`trip-store-${productId}`}
      >
        <View
          className="overflow-hidden rounded-[8px] border-[1.5px] border-dashed"
          style={{ borderColor: placeholderTones.camel }}
        >
          <ItemThumb
            category={piece.category ?? "accessory"}
            color="black"
            className="h-[41px] w-[37px]"
            glyphSize={20}
          />
        </View>
        <View
          className="flex-1 gap-0.5"
          accessible
          accessibilityLabel={`${t("req.gapFill.store")}: ${piece.name}`}
        >
          <Text variant="eyebrow" tone="accent">
            {t("req.gapFill.store")}
          </Text>
          <Text variant="body" className="text-[13.5px]" numberOfLines={2}>
            {piece.name}
          </Text>
        </View>
        <Pressable
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={`${t("req.gapFill.see")}: ${piece.name}`}
          hitSlop={{ top: 4, bottom: 4 }}
          testID={`trip-store-see-${productId}`}
          className="h-chip items-center justify-center rounded-pill border border-accent px-[15px] active:opacity-80"
        >
          <Text variant="chip" tone="accent" numberOfLines={1}>
            {t("req.gapFill.see")}
          </Text>
        </Pressable>
      </View>
    );
  }
  const line = t("tripDetail.missingLine", {
    name: piece.name,
    reason: piece.reason,
  });
  return (
    <Pressable
      onPress={
        productId && !hideCommerce
          ? () =>
              router.push({
                pathname: "/shop/product/[id]",
                params: { id: productId },
              })
          : undefined
      }
      disabled={!productId || hideCommerce}
      accessibilityRole={productId && !hideCommerce ? "button" : undefined}
      accessibilityLabel={t("tripDetail.missingNoteLine", {
        name: piece.name,
        reason: piece.reason,
      })}
      accessibilityHint={
        productId ? t("tripDetail.missingOpenHint") : undefined
      }
      className="flex-row items-center gap-2.5 rounded-card border border-accent bg-paper px-3 py-2.5 active:opacity-80"
    >
      <View
        className="overflow-hidden rounded-[8px] border-[1.5px] border-dashed"
        style={{ borderColor: placeholderTones.camel }}
      >
        <ItemThumb
          category={piece.category ?? "accessory"}
          color="black"
          className="h-[41px] w-[37px]"
          glyphSize={20}
        />
      </View>
      <View className="flex-1 gap-0.5">
        <Text variant="eyebrow" tone="accent">
          {t("tripDetail.missingEyebrow")}
        </Text>
        <Text variant="body" className="text-[13.5px]">
          {line}
        </Text>
      </View>
    </Pressable>
  );
}

function PackedTrip({
  trip,
  onDelete,
}: {
  trip: TripDetail;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const hideCommerce = useTeenRules().hide.commerce;
  const online = useIsOnline();
  const writes = useTripWrites();
  const tryOn = useStartTryOn();
  const items = useItems();
  // "all" = every day of the trip; a date = that day only (from the day sheet).
  const [confirm, setConfirm] = useState<"all" | string | null>(null);
  const [openDay, setOpenDay] = useState<TripDay | null>(null);
  const [tryOnNote, setTryOnNote] = useState<"offline" | "failed" | null>(null);
  const pendingScope = useRef<"all" | string>("all");

  const ready = readiness(trip.items);
  const lookDays = trip.days.filter((d) => d.look);
  const rows = groupByCategory(trip.items, ITEM_CATEGORIES).flatMap(
    (group) => group.items,
  );

  // 13d: days whose image already exists cost nothing — they are never counted on the sheet nor started again.
  const dayTarget = (d: TripDay) => ({
    kind: "trip-day" as const,
    id: `${trip.id}:${d.date}`,
  });
  const dayImages = useCachedTryOnImages(lookDays.map(dayTarget));
  const cachedJobOf = (d: TripDay) => dayImages[dayTarget(d).id]?.jobId ?? null;
  const daysToStart = (scope: "all" | string) =>
    (scope === "all"
      ? lookDays
      : lookDays.filter((d) => d.date === scope)
    ).filter((d) => !cachedJobOf(d));
  const confirmDays = confirm === null ? [] : daysToStart(confirm);

  const startTryOn = (scope: "all" | string) => {
    void (async () => {
      try {
        // Target `tripDay` (`{tripId}/{date}` on the wire): the common job and cache, 1 credit per new image.
        const jobs = await tryOn.startMany(daysToStart(scope).map(dayTarget));
        setConfirm(null);
        const first = jobs[0];
        if (first)
          router.push({
            pathname: "/tryon/[jobId]",
            params: { jobId: first.jobId, title: trip.cityName },
          });
      } catch {
        setConfirm(null);
        setTryOnNote("failed");
      }
    })();
  };

  // After the requirements and consent: the credit confirmation for several days, the first try-on or a low balance;
  // a single day otherwise starts at once.
  const spend = useSpendConfirm();
  const tryOnGate = useGate(
    "tryOn",
    () =>
      void ensureTryOnConsent().then((ok) => {
        if (!ok) return;
        const scope = pendingScope.current;
        spend(daysToStart(scope).length, {
          confirm: () => setConfirm(scope),
          start: () => startTryOn(scope),
        });
      }),
    { origin: trip.cityName },
  );

  const askTryOn = (scope: "all" | string) => {
    if (!online) {
      setTryOnNote("offline");
      return;
    }
    setTryOnNote(null);
    const scoped =
      scope === "all" ? lookDays : lookDays.filter((d) => d.date === scope);
    const firstCached = scoped
      .map(cachedJobOf)
      .find((j): j is string => Boolean(j));
    if (
      scoped.length > 0 &&
      scoped.every((d) => cachedJobOf(d)) &&
      firstCached
    ) {
      // Everything already exists: straight to the image, no sheet, no credit.
      router.push({
        pathname: "/tryon/[jobId]",
        params: { jobId: firstCached, title: trip.cityName },
      });
      return;
    }
    // What is missing first (requirements flow, canvas 11), then consent and the credit confirmation.
    pendingScope.current = scope;
    tryOnGate.run();
  };

  const rainy = rainyDayCount(trip.forecast);
  const notes = weatherNotes(trip.forecast);
  const saveAsLook = (day: TripDay) =>
    router.push({
      pathname: "/look/new",
      params: { itemIds: (day.itemIds ?? []).join(",") },
    });
  const stats = [
    {
      key: "pieces",
      value: String(trip.items.length),
      label: t("tripDetail.statPieces"),
    },
    {
      key: "looks",
      value: String(lookDays.length),
      label: t("tripDetail.statLooks"),
    },
    {
      key: "rainy",
      value: rainy === null ? "–" : String(rainy),
      label: t("tripDetail.statRainy"),
    },
  ];

  return (
    <>
      <View
        className="flex-row border-y border-line"
        accessible
        accessibilityLabel={t("tripDetail.summary", {
          pieces: t("trips.pieces", { count: trip.items.length }),
          looks: t("tripDetail.looks", { count: lookDays.length }),
        })}
        testID="trip-stats"
      >
        {stats.map((stat, i) => (
          <View
            key={stat.key}
            className={`flex-1 items-center gap-1.5 py-3.5 ${i === 1 ? "border-x border-line" : ""}`}
            testID={`trip-stat-${stat.key}`}
          >
            <Text variant="h2" className="text-[28px] leading-[30px]">
              {stat.value}
            </Text>
            <Text variant="eyebrow" className="text-[10px]" numberOfLines={1}>
              {stat.label}
            </Text>
          </View>
        ))}
      </View>
      {trip.minWearsPerItem ? (
        <Text variant="caption" tone="muted">
          {t("tripDetail.minWears", { count: trip.minWearsPerItem })}
        </Text>
      ) : null}

      {lookDays.length > 0 ? (
        <View className="gap-2.5">
          <View className="flex-row flex-wrap items-center justify-between gap-x-3">
            <Text variant="h2">{t("tripDetail.daysTitle")}</Text>
            <Pressable
              onPress={() => askTryOn("all")}
              accessibilityRole="button"
              accessibilityLabel={t("tripDetail.tryOnLooks")}
              testID="trip-tryon-all"
              className="min-h-icon-btn flex-row items-center gap-1 active:opacity-70"
            >
              <Icon icon={MirrorRound} size={15} />
              <Text variant="label">{t("tripDetail.tryOnLooks")}</Text>
            </Pressable>
          </View>
          <ForecastNote trip={trip} />
          <RequirementHint
            hint={tryOnGate.hint}
            onPress={tryOnGate.run}
            className="self-start"
            testID="trip-try-on-hint"
          />
          {tryOnNote ? (
            <View
              className="flex-row items-center gap-1.5"
              accessibilityLiveRegion="polite"
            >
              <Icon icon={CircleAlert} size={14} tone="danger" />
              <Text variant="caption" tone="danger" className="flex-1">
                {t(
                  tryOnNote === "offline"
                    ? "tripDetail.tryOnOffline"
                    : "tripDetail.tryOnFailed",
                )}
              </Text>
            </View>
          ) : null}
          <DayCards
            trip={trip}
            images={dayImages}
            onTryOn={(day) => askTryOn(day.date)}
            onOpenImage={(jobId) =>
              router.push({
                pathname: "/tryon/[jobId]",
                params: { jobId, title: trip.cityName },
              })
            }
            onOpenDay={setOpenDay}
            onSaveAsLook={saveAsLook}
          />
        </View>
      ) : (
        <ForecastNote trip={trip} />
      )}

      <View>
        <View className="flex-row items-baseline justify-between border-b border-line pb-1.5">
          <Text variant="h2">{t("tripDetail.listTitle")}</Text>
          <Text
            variant="caption"
            tone="muted"
            accessibilityLabel={t("tripDetail.readinessLabel", ready)}
            testID="trip-packed-count"
          >
            {t("tripDetail.packedCount", ready)}
          </Text>
        </View>
        {rows.map((item) => (
          <Pressable
            key={item.itemId}
            onPress={() => writes.setPacked(trip.id, item.itemId, !item.packed)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.packed }}
            accessibilityLabel={item.name}
            accessibilityHint={t(`itemCategory.${item.category}`)}
            className="min-h-icon-btn flex-row items-center gap-3 border-b border-line py-2 active:opacity-70"
          >
            <CheckBox checked={item.packed} size={20} />
            <View className={item.packed ? "opacity-50" : ""}>
              <ItemThumb
                category={item.category}
                color={item.color}
                {...itemImageSource(item, "thumb")}
                className="h-12 w-11 rounded-[8px]"
                glyphSize={18}
              />
            </View>
            <Text
              variant="body"
              tone={item.packed ? "muted" : "ink"}
              numberOfLines={2}
              className={`flex-1 ${item.packed ? "line-through" : ""}`}
            >
              {item.name}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {t(`itemCategory.${item.category}`)}
            </Text>
          </Pressable>
        ))}
        {notes.rainyDays > 0 || notes.coldNightC !== null ? (
          <View className="gap-1.5 pt-3.5" testID="trip-weather-notes">
            {notes.rainyDays > 0 ? (
              <Text variant="caption" tone="muted" className="text-[13px]">
                {t("tripDetail.noteRain", { count: notes.rainyDays })}
              </Text>
            ) : null}
            {notes.coldNightC !== null ? (
              <Text variant="caption" tone="muted" className="text-[13px]">
                {t("tripDetail.noteCold", {
                  temperature: formatTemperature(notes.coldNightC),
                })}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <View className="gap-2.5">
        <Text variant="h2">{t("tripDetail.missingTitle")}</Text>
        {trip.gapFilled ? (
          <GapFillBanner
            libraryItemIds={trip.missing
              .map((m) => m.libraryItemId)
              .filter((id): id is string => Boolean(id))}
            testID="trip-gapfill"
          />
        ) : null}
        {trip.missing.length === 0 ? (
          <Text variant="caption" tone="muted" testID="trip-missing-none">
            {t("tripDetail.missingNone")}
          </Text>
        ) : (
          <>
            {trip.missing.map((piece) => (
              <MissingCard key={piece.id} piece={piece} />
            ))}
            {hideCommerce ? null : (
              <Button
                variant="secondary"
                label={t("tripDetail.completeMissing")}
                onPress={() =>
                  router.push({
                    pathname: "/shop",
                    params: { tripId: trip.id },
                  })
                }
                testID="trip-complete-missing"
              />
            )}
          </>
        )}
      </View>

      <Pressable
        onPress={() => writes.setCabinOnly(trip, !trip.cabinOnly)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: trip.cabinOnly }}
        accessibilityLabel={t("tripDetail.cabinOnly")}
        accessibilityHint={t("tripDetail.cabinOnlyHint")}
        testID="trip-cabin-only"
        className="min-h-icon-btn flex-row items-center gap-3 rounded-card border border-line bg-paper px-3.5 py-3 active:opacity-70"
      >
        <CheckBox checked={trip.cabinOnly} size={20} />
        <View className="flex-1">
          <Text variant="bodyMedium" className="text-[14.5px]">
            {t("tripDetail.cabinOnly")}
          </Text>
          <Text variant="caption" tone="muted">
            {t("tripDetail.cabinOnlyHint")}
          </Text>
        </View>
      </Pressable>

      <Pressable
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel={t("tripDetail.deleteTrip")}
        testID="trip-delete"
        className="mt-2 h-icon-btn items-center justify-center self-start rounded-pill border border-danger px-[15px] active:opacity-70"
      >
        <Text variant="chip" tone="danger">
          {t("tripDetail.deleteTrip")}
        </Text>
      </Pressable>

      <TripDaySheet
        day={openDay}
        itemsById={indexItems(items.data)}
        onClose={() => setOpenDay(null)}
        onTryOn={(day) => {
          setOpenDay(null);
          askTryOn(day.date);
        }}
        onSaveAsLook={(day) => {
          setOpenDay(null);
          saveAsLook(day);
        }}
      />

      <CreditConfirmSheet
        visible={confirm !== null}
        onClose={() => setConfirm(null)}
        cost={confirmDays.length}
        scope={confirm === "all" ? t("tripDetail.tryOnScopeTag") : undefined}
        onConfirm={() => confirm !== null && startTryOn(confirm)}
        confirming={tryOn.isStarting}
      />
    </>
  );
}

/**
 * 16w Bavul detayı · genç (hazırlama kapalı): the forecast as plain weather cards and the weather notes around the
 * calm lock card — no pieces, no looks, no try-on, no AI call. "Seyahati sil" closes the screen as on 19.
 */
function TeenWeatherCards({ trip }: { trip: TripDetail }) {
  const language = useAppLanguage();
  const { t } = useTranslation();
  const forecast = trip.forecast ?? [];
  if (forecast.length === 0) return null;
  return (
    <View className="gap-2.5">
      <Text variant="h2">{t("tripDetail.daysTitle")}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="-mx-gutter"
        contentContainerClassName="gap-2.5 px-gutter"
        testID="trip-teen-weather"
      >
        {forecast.map((weather) => (
          <View
            key={weather.date}
            className="w-[132px] gap-2 rounded-card border border-line bg-paper p-3"
            accessible
            accessibilityLabel={[
              formatDate(parseLocalDate(weather.date), {
                weekday: "long",
                day: "numeric",
                month: "long",
              }),
              t(`tripDetail.condition.${weather.condition}`),
              dayTemperature(t, weather),
              weather.rainChance !== null && weather.rainChance !== undefined
                ? t("tripDetail.dayRain", { chance: weather.rainChance })
                : null,
            ]
              .filter(Boolean)
              .join(", ")}
            testID={`trip-teen-day-${weather.date}`}
          >
            <Text variant="eyebrow" className="text-[10px]">
              {toDisplayUpper(
                formatDate(parseLocalDate(weather.date), {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                }),
                language,
              )}
            </Text>
            <Icon icon={WEATHER_ICON[weather.condition]} size={22} />
            <Text variant="bodyMedium" className="text-[15px]">
              {dayTemperature(t, weather)}
            </Text>
            {weather.rainChance !== null && weather.rainChance !== undefined ? (
              <Text variant="caption" tone="muted">
                {t("tripDetail.dayRain", { chance: weather.rainChance })}
              </Text>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function TeenTripFooter({
  trip,
  onDelete,
}: {
  trip: TripDetail;
  onDelete: () => void;
}) {
  const language = useAppLanguage();
  const { t } = useTranslation();
  const notes = weatherNotes(trip.forecast);
  return (
    <>
      {notes.rainyDays > 0 || notes.coldNightC !== null ? (
        <View className="gap-2" testID="trip-weather-notes">
          <Text variant="eyebrow">
            {toDisplayUpper(t("tripDetail.notesTitle"), language)}
          </Text>
          {notes.rainyDays > 0 ? (
            <Text variant="caption" tone="muted" className="text-[13px]">
              {t("tripDetail.noteRain", { count: notes.rainyDays })}
            </Text>
          ) : null}
          {notes.coldNightC !== null ? (
            <Text variant="caption" tone="muted" className="text-[13px]">
              {t("tripDetail.noteCold", {
                temperature: formatTemperature(notes.coldNightC),
              })}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Pressable
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel={t("tripDetail.deleteTrip")}
        testID="trip-delete"
        className="h-icon-btn items-center justify-center self-start rounded-pill border border-danger px-[15px] active:opacity-70"
      >
        <Text variant="chip" tone="danger">
          {t("tripDetail.deleteTrip")}
        </Text>
      </Pressable>
    </>
  );
}

/**
 * 19 Bavul detayı (redrawn 2026-11-24 from the owner's reference video) — one long screen: the city in capitals, three
 * numbers (pieces, looks, rainy days), the day cards, the checklist with piece pictures (checked = struck through),
 * weather notes, missing pieces, single-cabin-bag mode and "Seyahati sil".
 * A trip without an accepted list shows the AI packing wait / draft instead.
 */
export default function TripDetailScreen() {
  const language = useAppLanguage();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useTrip(id);
  const writes = useTripWrites();
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const data = trip.data;
  const packed = data?.status === "packed";
  // 16w: an approved teen whose packing is off (or used this week) sees the weather around the lock card.
  const teenStylist = useTeenRules().stylist;
  const teenPackLocked = teenStylist !== null && teenStylist.pack !== "open";

  const share = () => {
    if (!data) return;
    const range = formatDateRange(
      parseLocalDate(data.startDate),
      parseLocalDate(data.endDate),
      { day: "numeric", month: "long" },
    );
    const message = tripShareText(data, {
      title: t("tripDetail.shareTitle", {
        city: data.cityName,
        range,
        days: t("trips.days", {
          count: tripLengthDays(data.startDate, data.endDate),
        }),
      }),
      listHeader: t("tripDetail.listTitle"),
      item: (name, isPacked) =>
        t(isPacked ? "tripDetail.shareItemPacked" : "tripDetail.shareItem", {
          name,
        }),
      looksHeader: t("tripDetail.dailyLooks"),
      look: (date, name) =>
        t("tripDetail.dayLook", {
          weekday: weekdayShort(parseLocalDate(date)),
          name,
        }),
      missingHeader: t("common.missingPiece"),
      missing: (name, reason) => t("tripDetail.missingLine", { name, reason }),
      footer: t("tripDetail.shareFooter"),
    });
    void Share.share({ message }).catch(() => undefined);
  };

  return (
    <Screen>
      <ScreenHeader
        leading="back"
        onLeadingPress={leave}
        right={
          data ? (
            <>
              {packed ? (
                <IconButton
                  icon={ShareIcon}
                  onPress={share}
                  accessibilityLabel={t("tripDetail.share")}
                  testID="trip-share"
                />
              ) : null}
              <IconButton
                icon={Ellipsis}
                variant="plain"
                onPress={() => setMenu(true)}
                accessibilityLabel={t("tripDetail.more")}
              />
            </>
          ) : undefined
        }
      />
      <ScreenState
        query={trip}
        notFound={{
          message: t("tripDetail.notFound"),
          actionLabel: t("tripDetail.backToTrips"),
          onAction: () => router.replace("/wardrobe/trips"),
        }}
      >
        {(detail) => {
          const range = formatDateRange(
            parseLocalDate(detail.startDate),
            parseLocalDate(detail.endDate),
            { day: "numeric", month: "short", year: "numeric" },
          );
          const days = t("trips.days", {
            count: tripLengthDays(detail.startDate, detail.endDate),
          });
          const temps = temperatureRange(detail.forecast);
          const meta = [
            range,
            days,
            temps
              ? t("tripDetail.tempRange", {
                  min: formatTemperature(temps.min),
                  max: formatTemperature(temps.max),
                })
              : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <ScrollView contentContainerClassName="gap-5 px-gutter pb-10">
              <View className="gap-2">
                <Text variant="eyebrow">
                  {toDisplayUpper(t("tripDetail.eyebrow"), language)}
                </Text>
                <Text
                  variant="display"
                  numberOfLines={2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                  className="text-[44px] leading-[46px] tracking-[2.6px]"
                  accessibilityLabel={detail.cityName}
                  testID="trip-city"
                >
                  {toDisplayUpper(detail.cityName, language)}
                </Text>
                <Text
                  variant="caption"
                  tone="muted"
                  className="text-[13px]"
                  testID="trip-meta"
                >
                  {meta}
                </Text>
              </View>
              {detail.status === "packed" ? (
                <PackedTrip trip={detail} onDelete={() => setDeleting(true)} />
              ) : (
                <>
                  <ForecastNote trip={detail} />
                  {teenPackLocked && !detail.packJobId ? (
                    <TeenWeatherCards trip={detail} />
                  ) : null}
                  <TripPacking trip={detail} />
                  {teenPackLocked && !detail.packJobId ? (
                    <TeenTripFooter
                      trip={detail}
                      onDelete={() => setDeleting(true)}
                    />
                  ) : null}
                </>
              )}
            </ScrollView>
          );
        }}
      </ScreenState>

      <PopoverMenu
        visible={menu}
        onClose={() => setMenu(false)}
        top={insets.top + 52}
        actions={[
          {
            key: "edit",
            label: t("tripDetail.edit"),
            icon: Pencil,
            onPress: () =>
              router.push({ pathname: "/trip/new", params: { id } }),
          },
          {
            key: "delete",
            label: t("tripDetail.delete"),
            icon: Trash2,
            destructive: true,
            onPress: () => setDeleting(true),
          },
        ]}
      />

      <BottomSheet
        visible={deleting}
        onClose={() => setDeleting(false)}
        title={t("tripDetail.deleteTitle")}
      >
        <View className="gap-3.5">
          <Text variant="body" tone="muted">
            {t("tripDetail.deleteBody")}
          </Text>
          <Button
            variant="danger"
            label={t("tripDetail.delete")}
            testID="trip-delete-confirm"
            onPress={() => {
              setDeleting(false);
              writes.remove(id);
              leave();
            }}
          />
          <Button
            variant="secondary"
            size="lg"
            label={t("common.cancel")}
            onPress={() => setDeleting(false)}
          />
        </View>
      </BottomSheet>
    </Screen>
  );
}
