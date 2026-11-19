import { router } from 'expo-router';
import { Check, CircleAlert, ImageOff, WifiOff } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Text } from '@/components/ui/Text';
import { openRecognitionPaywall } from "@/features/wardrobe/recognition";
import { surfaceTones } from "@/theme/tokens";

/** "Gardırobunda var" (light, ✓) / "Yeni" (ink) — told apart by lightness, not hue (31, 31c). */
export function PieceTag({ kind }: { kind: 'match' | 'new' }) {
  const { t } = useTranslation();
  if (kind === 'new') {
    return (
      <View className="self-start rounded-[10px] bg-ink px-2 py-0.5">
        <Text variant="badge" tone="cream">
          {t('outfitImport.review.new')}
        </Text>
      </View>
    );
  }
  return (
    <View className="flex-row items-center gap-[3px] self-start rounded-[10px] border border-line bg-paper px-2 py-0.5">
      <Icon icon={Check} size={10} />
      <Text variant="badge">{t('outfitImport.review.owned')}</Text>
    </View>
  );
}

/** 31 header picture: three outfit photos with their tags (decorative). */
export function ImportPhotoCollage() {
  return (
    <View className="h-[176px] flex-row gap-2" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View className="flex-[1.15]">
        <ImageSlot uri={null} className="h-full w-full rounded-image-lg" placeholder={{ kind: 'look', pieces: [], seed: 'import-a', figureHeight: 130 }} />
        <View className="absolute left-2 top-2.5 gap-1.5">
          <PieceTag kind="match" />
          <PieceTag kind="new" />
        </View>
      </View>
      <View className="flex-1 pt-[18px]">
        <ImageSlot uri={null} className="h-full w-full rounded-image-lg" placeholder={{ kind: 'look', pieces: [], seed: 'import-b', figureHeight: 110 }} />
        <View className="absolute left-2 top-7">
          <PieceTag kind="new" />
        </View>
      </View>
      <View className="flex-1 pb-[18px]">
        <ImageSlot uri={null} className="h-full w-full rounded-image-lg" placeholder={{ kind: 'look', pieces: [], seed: 'import-c', figureHeight: 110 }} />
        <View className="absolute left-2 top-2.5">
          <PieceTag kind="match" />
        </View>
      </View>
    </View>
  );
}

/** A one-line problem with an optional retry (31e D). */
export function ImportNotice({ text, onRetry, tone = 'sand' }: { text: string; onRetry?: () => void; tone?: 'sand' | 'warm' }) {
  const { t } = useTranslation();
  return (
    <View className="gap-2 rounded-card bg-sand p-3.5" style={tone === "warm" ? { backgroundColor: surfaceTones.caution } : undefined} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <View className="flex-row items-start gap-2.5">
        <Icon icon={CircleAlert} size={16} tone="danger" />
        <Text variant="caption" className="flex-1">
          {text}
        </Text>
      </View>
      {onRetry ? <Button variant="secondary" label={t('outfitImport.states.retry')} onPress={onRetry} /> : null}
    </View>
  );
}

/** 31e B — the free recognitions are used up: membership, or not now. */
export function QuotaExhausted({ max }: { max: number | null }) {
  const { t } = useTranslation();
  return (
    <View className="flex-1">
      <View className="flex-1 gap-3.5 px-gutter pt-2">
        <Text variant="display" className="mt-2 text-[28px] leading-[31px]" accessibilityRole="header">
          {t('outfitImport.intro.heading')}
        </Text>
        <View className="gap-2 rounded-card p-3.5" style={{ backgroundColor: surfaceTones.caution }} accessibilityRole="alert" testID="import.quotaExhausted">
          <Text variant="bodyMedium">{t('outfitImport.states.quotaTitle')}</Text>
          <Text variant="caption">{t('outfitImport.states.quotaBody', { max: max ?? '' })}</Text>
        </View>
        <Text variant="caption" tone="muted">
          {t('outfitImport.states.quotaFooter')}
        </Text>
      </View>
      <View className="gap-2 px-gutter pb-6 pt-3">
        <Button label={t('outfitImport.states.member')} onPress={openRecognitionPaywall} />
        <Button variant="secondary" size="lg" label={t('outfitImport.states.notNow')} onPress={() => router.back()} />
      </View>
    </View>
  );
}

/** 31e A — no photo gave a piece: choose others, or give up. */
export function NoPiecesFound({ onPickOther, onCancel, busy }: { onPickOther: () => void; onCancel: () => void; busy: boolean }) {
  const { t } = useTranslation();
  return (
    <View className="flex-1">
      <View className="flex-1 items-center justify-center gap-4 px-gutter" accessibilityLiveRegion="polite" testID="import.noPieces">
        <View className="h-14 w-14 items-center justify-center rounded-pill bg-sand">
          <Icon icon={ImageOff} size={26} />
        </View>
        <Text variant="h2" className="text-center" accessibilityRole="header">
          {t('outfitImport.states.noneTitle')}
        </Text>
        <Text variant="body" tone="muted" className="text-center">
          {t('outfitImport.states.noneBody')}
        </Text>
      </View>
      <View className="gap-2 px-gutter pb-6 pt-3">
        <Button label={t('outfitImport.states.pickOther')} onPress={onPickOther} loading={busy} />
        <Button variant="secondary" size="lg" label={t('outfitImport.states.cancel')} onPress={onCancel} disabled={busy} />
      </View>
    </View>
  );
}

/** 31e C — uploads paused offline: the counts, what continues, and the offline badge. */
export function UploadsPaused({ done, total }: { done: number; total: number }) {
  const { t } = useTranslation();
  return (
    <View className="gap-3">
      <View className="gap-2.5 rounded-card border border-line bg-paper p-3.5" accessibilityRole="text" accessibilityLiveRegion="polite" testID="import.paused">
        <View className="flex-row items-baseline justify-between gap-3">
          <Text variant="bodyMedium" className="flex-1">
            {t('outfitImport.states.pausedTitle')}
          </Text>
          <Text variant="caption" tone="muted">
            {t('outfitImport.states.pausedCount', { done, total })}
          </Text>
        </View>
        <View className="h-1 rounded-[2px] bg-sand">
          <View className="h-1 rounded-[2px] bg-muted" style={{ width: `${total === 0 ? 0 : Math.round((done / total) * 100)}%` }} />
        </View>
        <Text variant="caption" tone="muted">
          {t('outfitImport.states.pausedBody', { left: total - done, done })}
        </Text>
      </View>
      <View className="flex-row items-center gap-2 rounded-image-lg bg-sand px-3 py-2.5">
        <Icon icon={WifiOff} size={16} />
        <Text variant="caption">{t('outfitImport.states.offline')}</Text>
      </View>
    </View>
  );
}
