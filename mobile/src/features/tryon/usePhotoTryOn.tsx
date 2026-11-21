import { router } from 'expo-router';
import { useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { fromSource } from '@/api/dataSource';
import type { TryOnTarget } from '@/api/contracts/tryon';
import { CreditConfirmSheet } from '@/features/credits/CreditConfirmSheet';
import { useSpendConfirm } from '@/features/credits/spendConfirm';
import { openCreditSheetIfExhausted } from '@/features/credits/creditSheetStore';
import { useGate } from '@/features/requirements/useRequirements';
import { uploadItemPhotos } from '@/features/wardrobe/mutations';
import { useIsOnline } from '@/sync/network';

import { ensureTryOnConsent, isConsentDeclined, TRY_ON_CREDIT_COST, useStartTryOn } from './api';

/**
 * Where the outfit photo of "Kombini ayırmadan üzerimde gör" is:
 * - `local`: picked on the stylist hub (16d), uploaded only after the credit confirmation (item upload);
 * - `draft`: the photo already on "Parçaları seç" (12d / 12f), the item draft id — nothing is uploaded again;
 * - `import`: an outfit import photo (31c), session id + photo number.
 * `uri` is the picture on the device (or its signed URL): the result's "Kaynak fotoğraf" and "Parçalara ayır".
 */
export type PhotoTryOnSource =
  | { kind: 'local'; uri: string }
  | { kind: 'draft'; draftId: string; uri?: string | null }
  | { kind: 'import'; sessionId: string; index: number; uri?: string | null };

/** The try-on target of a source; a local photo is uploaded first (fixture mode: its uri stands in for the upload id). */
export async function photoTryOnTarget(source: PhotoTryOnSource): Promise<TryOnTarget> {
  return (await resolvePhotoTryOn(source)).target;
}

/**
 * The target plus the item upload a local photo became: the result screen's "Parçalara ayır ve gardıroba ekle" starts
 * recognition on that same upload (`POST v1/tenant/item-draft { uploadIds }`), so the photo is never sent twice.
 */
export async function resolvePhotoTryOn(source: PhotoTryOnSource): Promise<{ target: TryOnTarget; uploadId: string | null }> {
  const target = await targetOf(source);
  return { target, uploadId: source.kind === 'local' ? target.id : null };
}

async function targetOf(source: PhotoTryOnSource): Promise<TryOnTarget> {
  switch (source.kind) {
    case 'draft':
      return { kind: 'photo', id: source.draftId };
    case 'import':
      return { kind: 'import-photo', id: `${source.sessionId}:${source.index}` };
    default: {
      const uri = source.uri;
      const uploadId = await fromSource<string>(
        'wardrobe',
        () => uri,
        async () => (await uploadItemPhotos([uri]))[0] ?? '',
      );
      return { kind: 'photo', id: uploadId };
    }
  }
}

/**
 * Route params of the result screen for a photo try-on (`mode=photo` switches its copy and actions). `uploadId`: the
 * item upload of a local photo, reused by "Parçalara ayır".
 */
export function photoTryOnParams(jobId: string, target: TryOnTarget, source: PhotoTryOnSource, uploadId: string | null = null) {
  return {
    jobId,
    kind: target.kind,
    id: target.id,
    mode: 'photo',
    ref: source.uri ?? '',
    ...(source.kind === 'draft' ? { draftId: source.draftId } : {}),
    ...(uploadId ? { uploadId } : {}),
  };
}

export type PhotoTryOn = {
  /** "Ayırmadan üzerimde dene": requirements (canvas 11) → consent → credit confirmation (07b) → the job → the result. */
  tryOn: (source: PhotoTryOnSource) => void;
  /** True from the confirmation until the result opens (upload + start). */
  busy: boolean;
  /** "Çevrimdışısın…" / "Başlatılamadı…" after a tap, else null. */
  note: string | null;
  /** The credit confirmation; render it once on the screen. */
  sheet: ReactElement;
};

/**
 * The shared action of the three entry points of an outfit-photo try-on (16c/16d stylist hub, 12d/12f chooser, 31c
 * import review). Same steps as every "Üzerimde gör": whatever is missing (body or face photo, consent, membership,
 * credits) opens the requirements flow and comes back here; then the consent of the photo path, the 1-credit
 * confirmation and the job. A cached image (same photo, same body / face photo) opens at once on the server's answer.
 */
export function usePhotoTryOn({
  feature,
  replace = false,
  onCancel,
}: {
  feature: string;
  replace?: boolean;
  /** The credit confirmation was closed without confirming (12+ goes back to its choice). */
  onCancel?: () => void;
}): PhotoTryOn {
  const { t } = useTranslation();
  const online = useIsOnline();
  const start = useStartTryOn();
  const pending = useRef<PhotoTryOnSource | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState<'offline' | 'failed' | null>(null);

  const confirmed = () => {
    const source = pending.current;
    if (!source) return;
    void (async () => {
      setUploading(true);
      try {
        const { target, uploadId } = await resolvePhotoTryOn(source);
        const { jobId } = await start.start(target);
        setConfirm(false);
        const params = photoTryOnParams(jobId, target, source, uploadId);
        if (replace) router.replace({ pathname: '/tryon/[jobId]', params });
        else router.push({ pathname: '/tryon/[jobId]', params });
      } catch (error) {
        setConfirm(false);
        if (!isConsentDeclined(error) && !openCreditSheetIfExhausted(error, feature)) setNote('failed');
      } finally {
        setUploading(false);
      }
    })();
  };

  // The credit confirmation only when it has something to say (first try-on, low balance); else the photo goes at once.
  const spend = useSpendConfirm();
  const gate = useGate(
    'tryOn',
    () => void ensureTryOnConsent().then((ok) => ok && spend(TRY_ON_CREDIT_COST, { confirm: () => setConfirm(true), start: confirmed })),
    { origin: t('tryOnPhoto.hubTitle') },
  );

  const tryOn = (source: PhotoTryOnSource) => {
    if (!online) {
      setNote('offline');
      return;
    }
    setNote(null);
    pending.current = source;
    gate.run();
  };

  const busy = uploading || start.isStarting;
  return {
    tryOn,
    busy,
    note: note === 'offline' ? t('tryOnPhoto.offline') : note === 'failed' ? t('tryOnPhoto.failed') : null,
    sheet: (
      <CreditConfirmSheet
        visible={confirm}
        onClose={() => {
          setConfirm(false);
          if (!busy) onCancel?.();
        }}
        cost={TRY_ON_CREDIT_COST}
        scope={t('tryOnPhoto.creditScope')}
        onConfirm={confirmed}
        confirming={busy}
      />
    ),
  };
}
