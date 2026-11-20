import { useLocalSearchParams } from 'expo-router';
import { Sparkles } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { useSession } from '@/auth/session';
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
import { markPhotoExplainerSeen, usePhotoExplainerSeen } from '@/features/tryon/photoExplainer';
import { usePhotoTryOn } from '@/features/tryon/usePhotoTryOn';
import { useThemeColors } from '@/theme/useThemeColors';

/** The 270-wide frame of 16d; taller photos are capped at 4:3 portrait, wider ones keep their aspect. */
const FRAME_WIDTH = 270;

function frameHeight(w: number, h: number): number {
  if (!(w > 0) || !(h > 0)) return 360;
  return Math.round(Math.min(FRAME_WIDTH * (h / w), 360));
}

/**
 * 16d "Kombin fotoğrafı" — the outfit photo picked on the stylist hub (16c → 29h), copied (16c+) or chosen on 12 / a
 * share (12+, 16g). Two modes, latched when the screen opens:
 * - **explainer** (the user's first outfit-photo try-on): what will happen ("Bu kombini senin üzerinde gösterelim", the
 *   person's face and body are not used), the cost, and "Üzerimde dene" → requirements → credit confirmation. Opening
 *   it marks the explainer as seen for this user (stored on the phone).
 * - **direct** (16d′, every time after): the photo with the requirements / credit confirmation opened over it at once;
 *   "Vazgeç" leaves the photo with "Üzerimde dene" and "Başka fotoğraf seç".
 * Params: `uri` (local file), `w`, `h`.
 */
export default function OutfitPhotoScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ uri?: string; w?: string; h?: string }>();
  const uri = params.uri || null;
  const credits = useAiCredits();
  // The result replaces 16d: "Tamam" goes back to where the photo was picked.
  const action = usePhotoTryOn({ feature: 'tryon_photo', replace: true });
  const req = useRequirements('tryOn');
  const hint = useRequirementHint(req);
  const picker = useOutfitPhotoPicker({ replace: true });
  const height = frameHeight(Number(params.w), Number(params.h));

  const session = useSession();
  const userId = session.status === 'signedIn' ? session.user.id : null;
  const seen = usePhotoExplainerSeen();
  // Latched on the first known value: marking the explainer as seen must not flip this screen to the direct mode.
  const [mode, setMode] = useState<'explainer' | 'direct' | null>(null);
  if (mode === null && seen !== null) setMode(seen ? 'direct' : 'explainer');
  useEffect(() => {
    if (mode === 'explainer' && userId) void markPhotoExplainerSeen(userId);
  }, [mode, userId]);

  const tryOn = () => uri && action.tryOn({ kind: 'local', uri });
  // 16d′: the requirements / credit confirmation open over the photo once, as the screen appears.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (mode !== 'direct' || !uri || autoStarted.current) return;
    autoStarted.current = true;
    action.tryOn({ kind: 'local', uri });
  }, [mode, uri, action]);

  const explainer = mode === 'explainer';

  return (
    <Screen bottom={false}>
      <ScreenHeader title={t('tryOnPhoto.previewTitle')} leading="back" />
      <ScrollView contentContainerClassName="gap-4 px-gutter pb-6 pt-1" testID={explainer ? 'tryonPhoto.preview' : 'tryonPhoto.direct'}>
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
        {explainer ? (
          <View className="gap-1.5">
            <Text variant="eyebrow">{t('tryOnPhoto.previewEyebrow')}</Text>
            <Text variant="h2" accessibilityRole="header">
              {t('tryOnPhoto.previewHeading')}
            </Text>
            <Text variant="body" tone="muted">
              {t('tryOnPhoto.previewBody')}
            </Text>
          </View>
        ) : null}
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
          <RequirementHint hint={hint} onPress={tryOn} className="self-center" testID="tryonPhoto.hint" />
          <Button
            icon={Sparkles}
            size="lg"
            label={t('tryOnPhoto.tryOn')}
            onPress={tryOn}
            disabled={!uri || mode === null}
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
