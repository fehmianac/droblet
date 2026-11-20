import { useLocalSearchParams } from 'expo-router';
import { Sparkles } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { ImageTag } from '@/components/ui/Bits';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { useAiCredits } from '@/features/credits/useAiCredits';
import { RequirementHint } from '@/features/requirements/RequirementHint';
import { useRequirementHint, useRequirements } from '@/features/requirements/useRequirements';
import { TRY_ON_CREDIT_COST } from '@/features/tryon/api';
import { useOutfitPhotoPicker } from '@/features/tryon/OutfitPhotoPicker';
import { usePhotoTryOn } from '@/features/tryon/usePhotoTryOn';
import { useThemeColors } from '@/theme/useThemeColors';

/** The 270-wide frame of 16d; taller photos are capped at 4:3 portrait, wider ones keep their aspect. */
const FRAME_WIDTH = 270;

function frameHeight(w: number, h: number): number {
  if (!(w > 0) || !(h > 0)) return 360;
  return Math.round(Math.min(FRAME_WIDTH * (h / w), 360));
}

/**
 * 16d "Kombin fotoğrafı" — the outfit photo the user picked on the stylist hub (16c → 29h): what will happen ("Bu kombini
 * senin üzerinde gösterelim", the person's face and body are not used), the cost, and "Üzerimde dene" → requirements →
 * credit confirmation → the try-on screen. "Başka fotoğraf seç" picks again. Params: `uri` (local file), `w`, `h`.
 */
export default function OutfitPhotoScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ uri?: string; w?: string; h?: string }>();
  const uri = params.uri || null;
  const credits = useAiCredits();
  // The result replaces 16d: "Tamam" goes back to the stylist hub.
  const action = usePhotoTryOn({ feature: 'tryon_photo', replace: true });
  const req = useRequirements('tryOn');
  const hint = useRequirementHint(req);
  const picker = useOutfitPhotoPicker({ replace: true });
  const height = frameHeight(Number(params.w), Number(params.h));

  return (
    <Screen bottom={false}>
      <ScreenHeader title={t('tryOnPhoto.previewTitle')} leading="back" />
      <ScrollView contentContainerClassName="gap-4 px-gutter pb-6 pt-1" testID="tryonPhoto.preview">
        <View className="self-center overflow-hidden rounded-card" style={{ width: FRAME_WIDTH, height }}>
          <ImageSlot
            uri={uri}
            className="h-full w-full"
            accessibilityLabel={t('tryOnPhoto.photoA11y')}
            placeholder={{ kind: 'look', pieces: [], seed: uri ?? 'outfit', figureHeight: 200 }}
          />
          <View className="absolute bottom-3 left-3" pointerEvents="none">
            <ImageTag label={t('tryOnPhoto.sourceTag')} />
          </View>
        </View>
        <View className="gap-1.5">
          <Text variant="eyebrow">{t('tryOnPhoto.previewEyebrow')}</Text>
          <Text variant="h2" accessibilityRole="header">
            {t('tryOnPhoto.previewHeading')}
          </Text>
          <Text variant="body" tone="muted">
            {t('tryOnPhoto.previewBody')}
          </Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" accessible={false}>
            <Rect x={6} y={3} width={12} height={15} rx={6} stroke={colors.muted} strokeWidth={1.5} />
          </Svg>
          <Text variant="caption" tone="muted" className="flex-1">
            {credits.remaining !== null
              ? t('tryOn.creditLine', { count: TRY_ON_CREDIT_COST, remaining: credits.remaining })
              : t('tryOn.creditCostOnly', { count: TRY_ON_CREDIT_COST })}
          </Text>
        </View>
        {!uri ? (
          <Text variant="caption" tone="danger">
            {t('tryOnPhoto.noPhoto')}
          </Text>
        ) : null}
      </ScrollView>
      <BottomActionBar actionFill>
        <View className="gap-1">
          <RequirementHint hint={hint} onPress={() => uri && action.tryOn({ kind: 'local', uri })} className="self-center" testID="tryonPhoto.hint" />
          <Button
            icon={Sparkles}
            size="lg"
            label={t('tryOnPhoto.tryOn')}
            onPress={() => uri && action.tryOn({ kind: 'local', uri })}
            disabled={!uri}
            loading={action.busy}
            testID="tryonPhoto.tryOn"
          />
          <Button variant="text" label={t('tryOnPhoto.otherPhoto')} onPress={picker.open} testID="tryonPhoto.other" />
          {action.note ? (
            <Text variant="caption" tone="muted" className="text-center" accessibilityLiveRegion="polite">
              {action.note}
            </Text>
          ) : null}
        </View>
      </BottomActionBar>
      {action.sheet}
      {picker.sheet}
    </Screen>
  );
}
