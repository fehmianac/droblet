import { useQueryClient } from '@tanstack/react-query';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Sparkles } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Rect } from 'react-native-svg';

import type { TryOnTarget } from '@/api/contracts/tryon';
import { AiBackgroundAction, AiFailure, AiProgressLines, AiTryOnStage } from '@/components/ui/ai';
import { AiImage } from '@/components/ui/AiBadge';
import { Badge } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { aiCreditsKey, useAiCredits } from '@/features/credits/useAiCredits';
import { isTryOnTargetKind, TRY_ON_CREDIT_COST, useStartTryOn, useTryOnJob } from '@/features/tryon/api';
import { useThemeColors } from '@/theme/useThemeColors';

/** "AI önizleme" on the stage: the ink badge at its 28-high size (`AiYukleniyor`). */
function StageBadge({ label }: { label: string }) {
  return (
    <View className="h-7 flex-row items-center gap-1 rounded-pill bg-ink px-2.5">
      <Icon icon={Sparkles} size={12} tone="cream" />
      <Text variant="badge" tone="cream" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** The credit glyph of the board (a 12 × 15 capsule, 1.5 stroke) in front of "1 kredi · kalan 11". */
function CreditGlyph({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" accessible={false}>
      <Rect x={6} y={3} width={12} height={15} rx={6} stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * "Üzerimde gör" — the full-screen wait of a try-on job (`AiYukleniyor`), its result and its failure.
 * Params: `jobId`; optional `title` (what is being tried on), `kind` + `id` (the target, so "Tekrar
 * dene" can start a fresh job). Leaving keeps the job running on the server; polling stops while
 * the screen is not focused.
 */
export default function TryOnScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const client = useQueryClient();
  const params = useLocalSearchParams<{ jobId: string; title?: string; kind?: string; id?: string }>();
  const focused = useIsFocused();
  const job = useTryOnJob(params.jobId, { enabled: focused });
  const credits = useAiCredits();
  const start = useStartTryOn();
  const title = params.title || null;

  const settled = job.isDone || job.isFailed;
  useEffect(() => {
    if (settled) void client.invalidateQueries({ queryKey: aiCreditsKey });
  }, [client, settled]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (job.isFailed) {
    const target: TryOnTarget | null = isTryOnTargetKind(params.kind) && params.id ? { kind: params.kind, id: params.id } : null;
    const retry = () => {
      if (!target) {
        job.refetch();
        return;
      }
      void start
        .start(target)
        .then(({ jobId }) => router.replace({ pathname: '/tryon/[jobId]', params: { jobId, title: title ?? '', kind: target.kind, id: target.id } }))
        .catch(() => undefined);
    };
    // The wait stops where it was: the stage stands still and its text area says what happened (canvas note, 60 s).
    return (
      <Screen top={false} bottom>
        <View>
          <AiTryOnStage className="h-[470px] w-full" active={false} tag={null} />
          <View className="absolute left-gutter right-gutter flex-row items-center justify-between" style={{ top: insets.top + 6 }}>
            <IconButton icon={ChevronLeft} variant="inverse" onPress={close} accessibilityLabel={t('a11y.back')} />
          </View>
        </View>
        <View className="flex-1 gap-3.5 px-6 pt-[22px]">
          <Text variant="eyebrow">{t('ai.tryOnEyebrow')}</Text>
          <AiFailure layout="inline" creditRefunded={job.creditRefunded} onRetry={retry} retrying={start.isStarting} />
        </View>
      </Screen>
    );
  }

  if (job.isDone) {
    const remaining = job.result?.creditsRemaining ?? credits.remaining;
    return (
      <Screen bottom>
        <ScreenHeader title={t('screens.tryon')} leading="close" onLeadingPress={close} />
        <ScrollView contentContainerClassName="gap-4 px-gutter pb-4">
          <View>
            <AiImage
              kind="onYou"
              uri={job.result?.imageUrl ?? null}
              className="aspect-[4/5] w-full"
              accessibilityLabel={title ? t('tryOn.imageA11yNamed', { name: title }) : t('tryOn.imageA11y')}
            />
            {job.result?.imageUrl ? (
              <View className="absolute left-2.5 top-2.5" pointerEvents="none">
                <Badge tone="ink" icon={Sparkles} label={t('ai.previewBadge')} />
              </View>
            ) : null}
          </View>
          <View className="gap-1.5" accessibilityLiveRegion="polite">
            <Text variant="eyebrow">{t('tryOn.readyEyebrow')}</Text>
            <Text variant="h2">{title ? t('tryOn.readyTitleNamed', { name: title }) : t('tryOn.readyTitle')}</Text>
            <Text variant="body" tone="muted">
              {t('tryOn.readyBody')}
            </Text>
            {remaining !== null && remaining !== undefined ? (
              <Text variant="caption" tone="muted">
                {t('tryOn.remaining', { count: remaining })}
              </Text>
            ) : null}
          </View>
        </ScrollView>
        <View className="px-gutter pb-4">
          <Button label={t('tryOn.done')} onPress={close} />
        </View>
      </Screen>
    );
  }

  const lines = [t('ai.tryOnLines.pieces'), t('ai.tryOnLines.colors'), t('ai.tryOnLines.placing'), t('ai.tryOnLines.finishing')];
  const cost = TRY_ON_CREDIT_COST;
  return (
    <Screen top={false} bottom>
      <View>
        <AiTryOnStage className="h-[470px] w-full" />
        <View className="absolute left-gutter right-gutter flex-row items-center justify-between" style={{ top: insets.top + 6 }}>
          <IconButton icon={ChevronLeft} variant="inverse" onPress={close} accessibilityLabel={t('a11y.back')} />
          <StageBadge label={t('ai.previewBadge')} />
        </View>
      </View>
      <View className="flex-1 gap-3.5 px-6 pt-[22px]">
        <Text variant="eyebrow">{t('ai.tryOnEyebrow')}</Text>
        <AiProgressLines lines={lines} />
        <Text variant="body" tone="muted">
          {title ? t('ai.tryOnBody', { name: title }) : t('ai.usuallyTakes')}
        </Text>
        <View className="flex-row items-center gap-1.5">
          <CreditGlyph color={colors.muted} />
          <Text variant="caption" tone="muted" className="flex-1">
            {credits.remaining !== null
              ? t('tryOn.creditLine', { count: cost, remaining: credits.remaining })
              : t('tryOn.creditCostOnly', { count: cost })}
          </Text>
        </View>
      </View>
      <View className="px-6 pb-4">
        <AiBackgroundAction onPress={close} />
      </View>
    </Screen>
  );
}
