import { useQueryClient } from '@tanstack/react-query';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { STYLIST_SUGGESTION_COUNT, type StylistOutfitRequest, type StylistOutfitResult } from '@/api/contracts/stylist';
import { AiBackgroundAction, AiDropPulse, AiFailure, AiProgressLines, AiSkeletonCards, AiSkeletonRows } from '@/components/ui/ai';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { stylistKeys, stylistWaitLines, useStartStylistOutfit, useStylistJob } from '@/features/stylist/api';
import { SuggestionResult } from '@/features/stylist/SuggestionResult';
import { toIsoDate } from '@/lib/format';

/**
 * 17 Kombin önerisi. While the stylist job runs: the stilist wait (no spinner, no credits). Then the
 * three suggestions, one at a time: pieces (wardrobe / missing store piece → "Look'u tamamla"),
 * "Üzerimde gör" (1 credit, confirmed first; 17c while the image is generated; 17b when the month's
 * credits are gone), ✕ feedback, "Takvime ekle" and the lookbook heart. Nothing is saved without the
 * user's action. The job id is in the route, so reopening resumes the same job.
 */
export default function StylistResultScreen() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const params = useLocalSearchParams<{ jobId: string; title?: string }>();
  const jobId = params.jobId;
  const focused = useIsFocused();

  const stylist = useStylistJob(jobId, { enabled: focused });
  const restart = useStartStylistOutfit();

  const request = client.getQueryData<StylistOutfitRequest>(stylistKeys.request(jobId));
  const result: StylistOutfitResult | null = stylist.result;
  const occasion = result?.request.occasion ?? request?.occasion ?? null;
  const title = params.title || (occasion ? t(`occasion.${occasion}`) : (result?.request.text ?? request?.text)) || t('stylistHome.fallbackTitle');

  const askAgain = () => {
    const pending = restart.restart(jobId);
    if (!pending) {
      router.replace('/stylist');
      return;
    }
    void pending.then(({ jobId: next }) => router.replace({ pathname: '/stylist/[jobId]', params: { jobId: next, title } })).catch(() => undefined);
  };

  // ---------- waiting ----------
  if (stylist.isWorking) {
    const weather = client.getQueryData<{ city: string | null; days: { temperatureC: number; summary?: string | null }[] }>(
      stylistKeys.weather(request?.date ?? toIsoDate(new Date())),
    );
    const lines = stylistWaitLines(t, weather?.days[0] ?? null, STYLIST_SUGGESTION_COUNT, i18n.language);
    return (
      <Screen bottom>
        {/* The board's leading control is the back chevron, named "Vazgeç": leaving does not cancel the job on the server. */}
        <ScreenHeader title={title} leading="back" leadingLabel={t('stylistResult.cancel')} />
        <View className="flex-1 gap-[22px] px-gutter pt-6" accessibilityState={{ busy: true }}>
          <View className="items-center gap-4">
            <AiDropPulse height={61} />
            <View className="w-full">
              <AiProgressLines lines={lines} align="center" />
            </View>
            <Text variant="caption" tone="muted" className="text-center">
              {t('ai.noCreditForText')}
            </Text>
          </View>
          <AiSkeletonCards count={STYLIST_SUGGESTION_COUNT} />
          <AiSkeletonRows />
        </View>
        <View className="px-gutter pb-4">
          <AiBackgroundAction label={t('ai.showWhenReady')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/stylist'))} />
        </View>
      </Screen>
    );
  }

  // ---------- failed / timed out ----------
  if (stylist.isFailed || !result) {
    return (
      <Screen bottom>
        <ScreenHeader title={title} leading="back" />
        {/* Text suggestions never reserve a credit, so there is nothing to refund. */}
        <AiFailure creditRefunded={false} onRetry={askAgain} retrying={restart.isStarting} />
      </Screen>
    );
  }

  return <SuggestionResult jobId={jobId} title={title} result={result} focused={focused} onAskAgain={askAgain} askingAgain={restart.isStarting} />;
}
