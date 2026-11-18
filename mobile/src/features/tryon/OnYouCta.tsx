import { router } from 'expo-router';
import { Sparkles } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { TryOnTarget } from '@/api/contracts/tryon';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useMyPhotos } from '@/features/account/queries';
import { CreditConfirmSheet } from '@/features/credits/CreditConfirmSheet';
import { openCreditSheetIfExhausted } from '@/features/credits/creditSheetStore';
import { openCreditTopUp, useAiCredits } from '@/features/credits/useAiCredits';
import { useIsOnline } from '@/sync/network';

import { TRY_ON_CREDIT_COST, useStartTryOn } from './api';

export type OnYouState = 'photo' | 'member' | 'credits' | 'tryOn';

/**
 * Which call to action an "on you" area without a generated image shows:
 * no full-length photo → add one · not a member → become one · no credits left → add credits · else "Üzerimde gör".
 * Unknown values (still loading, offline) never block: the server answers and the write handlers react.
 */
export function decideOnYouState(input: { hasBodyPhoto: boolean | null; isMember: boolean | null; remaining: number | null }): OnYouState {
  if (input.hasBodyPhoto === false) return 'photo';
  if (input.isMember === false) return 'member';
  if (input.remaining !== null && input.remaining < TRY_ON_CREDIT_COST) return 'credits';
  return 'tryOn';
}

function Panel({ text, children, testID }: { text: string | null; children: ReactNode; testID: string }) {
  return (
    <View className={`items-center gap-1.5 ${text ? 'rounded-field bg-paper/95 p-2' : ''}`} testID={testID}>
      {text ? (
        <Text variant="caption" className="text-center" accessibilityLiveRegion="polite">
          {text}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

type Props = {
  /** What "Üzerimde gör" generates. */
  target: TryOnTarget;
  /** Name shown on the try-on screen. */
  title: string;
  /** Analytics name of the place (credit sheet). */
  feature: string;
  /** When the screen already knows (08: `WeeklyEdit.hasBodyPhoto`); otherwise read from the user's photos. */
  hasBodyPhoto?: boolean;
};

/**
 * The action of an "on you" area that has no generated image yet (06, 08, 17) — the designed states,
 * with the strings and destinations the screens already use: "Fotoğraf ekle" → 29 Ayarlar (photos),
 * "Üye ol" → 05 paywall, "Kredi yükle" → the 05b credit sheet, "Üzerimde gör" → the credit confirmation
 * and the shared try-on job.
 */
export function OnYouCta({ target, title, feature, hasBodyPhoto }: Props) {
  const { t } = useTranslation();
  const online = useIsOnline();
  const photos = useMyPhotos();
  const credits = useAiCredits();
  const tryOn = useStartTryOn();
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<'offline' | 'failed' | null>(null);

  const known = credits.remaining !== null;
  const state = decideOnYouState({
    hasBodyPhoto: hasBodyPhoto ?? (photos.data ? photos.data.body.length > 0 : null),
    isMember: known ? credits.isMember : null,
    remaining: credits.remaining,
  });

  if (state === 'photo') {
    return (
      <Panel text={t('productDetail.tryOnNeedsPhoto')} testID="on-you-cta-photo">
        <Button variant="secondary" size="md" label={t('productDetail.tryOnAddPhoto')} onPress={() => router.push('/settings')} className="bg-paper px-4" />
      </Panel>
    );
  }
  if (state === 'member') {
    return (
      <Panel text={t('me.teaserBody')} testID="on-you-cta-member">
        <Button variant="secondary" size="md" label={t('creditConfirm.becomeMember')} onPress={() => openCreditTopUp(false)} className="bg-paper px-4" />
      </Panel>
    );
  }
  if (state === 'credits') {
    return (
      <Panel text={t('stylistResult.noCreditsTitle')} testID="on-you-cta-credits">
        <Button variant="secondary" size="md" label={t('stylistResult.topUp')} onPress={() => openCreditTopUp(true)} className="bg-paper px-4" />
      </Panel>
    );
  }

  const start = () => {
    void (async () => {
      try {
        const { jobId } = await tryOn.start(target);
        setConfirm(false);
        router.push({ pathname: '/tryon/[jobId]', params: { jobId, title, kind: target.kind, id: target.id } });
      } catch (error) {
        setConfirm(false);
        if (!openCreditSheetIfExhausted(error, feature)) setNote('failed');
      }
    })();
  };

  return (
    <Panel text={note === 'offline' ? t('lookEditor.tryOnOffline') : note === 'failed' ? t('lookDetail.tryOnFailed') : null} testID="on-you-cta-try-on">
      <Button
        variant="secondary"
        size="md"
        icon={Sparkles}
        label={t('lookEditor.tryOn')}
        className="bg-paper px-4"
        onPress={() => {
          if (!online) {
            setNote('offline');
            return;
          }
          setNote(null);
          setConfirm(true);
        }}
      />
      <CreditConfirmSheet visible={confirm} onClose={() => setConfirm(false)} cost={TRY_ON_CREDIT_COST} onConfirm={start} confirming={tryOn.isStarting} />
    </Panel>
  );
}
