import { router } from 'expo-router';
import { useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { fromSource } from '@/api/dataSource';
import type { TryOnTarget } from '@/api/contracts/tryon';
import { CreditConfirmSheet } from '@/features/credits/CreditConfirmSheet';
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

/** Route params of the result screen for a photo try-on (`mode=photo` switches its copy and actions). */
export function photoTryOnParams(jobId: string, target: TryOnTarget, source: PhotoTryOnSource) {
  return { jobId, kind: target.kind, id: target.id, mode: 'photo', ref: source.uri ?? '', ...(source.kind === 'draft' ? { draftId: source.draftId } : {}) };
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
export function usePhotoTryOn({ feature, replace = false }: { feature: string; replace?: boolean }): PhotoTryOn {
  const { t } = useTranslation();
  const online = useIsOnline();
  const start = useStartTryOn();
  const pending = useRef<PhotoTryOnSource | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState<'offline' | 'failed' | null>(null);

  const gate = useGate('tryOn', () => void ensureTryOnConsent().then((ok) => ok && setConfirm(true)), { origin: t('tryOnPhoto.hubTitle') });

  const tryOn = (source: PhotoTryOnSource) => {
    if (!online) {
      setNote('offline');
      return;
    }
    setNote(null);
    pending.current = source;
    gate.run();
  };

  const confirmed = () => {
    const source = pending.current;
    if (!source) return;
    void (async () => {
      setUploading(true);
      try {
        const target = await photoTryOnTarget(source);
        const { jobId } = await start.start(target);
        setConfirm(false);
        const params = photoTryOnParams(jobId, target, source);
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

  const busy = uploading || start.isStarting;
  return {
    tryOn,
    busy,
    note: note === 'offline' ? t('tryOnPhoto.offline') : note === 'failed' ? t('tryOnPhoto.failed') : null,
    sheet: <CreditConfirmSheet visible={confirm} onClose={() => setConfirm(false)} cost={TRY_ON_CREDIT_COST} onConfirm={confirmed} confirming={busy} />,
  };
}
