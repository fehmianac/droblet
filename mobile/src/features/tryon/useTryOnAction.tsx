import { router } from 'expo-router';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { TryOnTarget } from '@/api/contracts/tryon';
import { CreditConfirmSheet } from '@/features/credits/CreditConfirmSheet';
import { useSpendConfirm } from '@/features/credits/spendConfirm';
import { openCreditSheetIfExhausted } from '@/features/credits/creditSheetStore';
import { useGate } from '@/features/requirements/useRequirements';
import { useIsOnline } from '@/sync/network';

import { ensureTryOnConsent, isConsentDeclined, TRY_ON_CREDIT_COST, useStartTryOn } from './api';
import { useCachedTryOn } from './cached';
import { useTryOnInviteFooter, type TryOnInviteProps } from './TryOnInvite';

type Options = {
  /** What "Üzerimde gör" generates. */
  target: TryOnTarget;
  /** Name shown on the try-on screen and in the requirements flow. */
  title: string;
  /** Analytics name of the place (credit sheet). */
  feature: string;
  /**
   * Pseudo job id of an image that already exists for the target on the current photo (13d), when the screen already
   * knows it (`useLookTryOn`). Left out, the existing-image check runs here.
   */
  cachedJobId?: string | null;
};

export type TryOnAction = {
  /** Props of the invitation tile (`TryOnInvite`): what a tap does, and the tap. */
  invite: Pick<TryOnInviteProps, 'footer' | 'ready' | 'onPress'>;
  /** "Çevrimdışısın…" / "Başlatılamadı…" after a tap, else null. */
  note: string | null;
  /** The credit confirmation (07b); render it once next to the tile. */
  sheet: ReactElement;
};

/**
 * "Üzerimde gör" of an "on you" area without a generated image (06, 08): an existing image opens at once (no sheet,
 * no credit); whatever is missing (photo, consent, membership, credits) opens the requirements flow (canvas 11), which
 * comes back here; then the credit confirmation and the shared try-on job → the try-on screen.
 */
export function useTryOnAction({ target, title, feature, cachedJobId }: Options): TryOnAction {
  const { t } = useTranslation();
  const online = useIsOnline();
  const tryOn = useStartTryOn();
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<'offline' | 'failed' | null>(null);
  const checked = useCachedTryOn(target, { enabled: cachedJobId === undefined });
  const cached = cachedJobId === undefined ? checked.cachedJobId : cachedJobId;
  const openResult = (jobId: string) => router.push({ pathname: '/tryon/[jobId]', params: { jobId, title, kind: target.kind, id: target.id } });

  const start = () => {
    void (async () => {
      try {
        const { jobId } = await tryOn.start(target);
        setConfirm(false);
        openResult(jobId);
      } catch (error) {
        setConfirm(false);
        if (!isConsentDeclined(error) && !openCreditSheetIfExhausted(error, feature)) setNote('failed');
      }
    })();
  };

  // Consent of the photo path, then the credit confirmation only when it has something to say (first try-on, low
  // balance) — also the resume of the requirements flow. The tile already carries the cost.
  const spend = useSpendConfirm();
  const gate = useGate(
    'tryOn',
    () => void ensureTryOnConsent().then((ok) => ok && spend(TRY_ON_CREDIT_COST, { confirm: () => setConfirm(true), start })),
    { origin: title },
  );
  const footer = useTryOnInviteFooter(gate.req);

  const onPress = () => {
    if (!online) {
      setNote('offline');
      return;
    }
    setNote(null);
    if (cached) {
      openResult(cached);
      return;
    }
    gate.run();
  };

  return {
    invite: { ...footer, onPress },
    note: note === 'offline' ? t('lookEditor.tryOnOffline') : note === 'failed' ? t('lookDetail.tryOnFailed') : null,
    sheet: <CreditConfirmSheet visible={confirm} onClose={() => setConfirm(false)} cost={TRY_ON_CREDIT_COST} onConfirm={start} confirming={tryOn.isStarting} />,
  };
}
