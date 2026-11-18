import { Check } from 'lucide-react-native';
import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { CONSENT_TYPES, type ConsentRecord, type ConsentType } from '@/api/contracts/consents';
import { SectionState } from '@/components/blocks/SectionState';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useRemovePhoto } from '@/features/account/mutations';
import { useMyPhotos } from '@/features/account/queries';
import { RowCard } from '@/features/account/rows';
import { formatDate } from '@/lib/format';

import { useConsents, useSaveConsents } from './api';
import { consentsPageUrl } from './ConsentSheet';
import { ensureConsents } from './store';

const day = (iso: string) => formatDate(new Date(iso), { day: 'numeric', month: 'long', year: 'numeric' });

/** "19 Kasım 2026 tarihinde verildi" / "… geri alındı" / "Verilmedi" / "Metin güncellendi…". */
function stateLine(record: ConsentRecord, t: TFunction): string {
  if (record.valid && record.grantedAt) return t('consent.grantedOn', { date: day(record.grantedAt) });
  if (record.granted) return t('consent.outdatedState');
  if (record.withdrawnAt) return t('consent.withdrawnOn', { date: day(record.withdrawnAt) });
  return t('consent.neverGiven');
}

function ConsentRow({ record, first, busy, onToggle }: { record: ConsentRecord; first: boolean; busy: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const title = t(`consent.texts.${record.type}.title`);
  const line = stateLine(record, t);
  return (
    <Pressable
      onPress={onToggle}
      disabled={busy}
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityHint={line}
      accessibilityState={{ checked: record.valid, disabled: busy }}
      testID={`consent.row.${record.type}`}
      className={`min-h-[52px] flex-row items-center gap-3 py-2 active:opacity-70 ${first ? '' : 'border-t border-line'} ${busy ? 'opacity-40' : ''}`}
    >
      <View className="flex-1 gap-0.5">
        <Text variant="body" className="text-[14.5px]">
          {title}
        </Text>
        <Text variant="caption" tone="muted" testID={`consent.state.${record.type}`}>
          {line}
        </Text>
      </View>
      <View className={`h-5 w-5 items-center justify-center rounded-[3px] border ${record.valid ? 'border-ink bg-ink' : 'border-muted bg-paper'}`}>
        {record.valid ? <Icon icon={Check} size={15} tone="cream" /> : null}
      </View>
    </Pressable>
  );
}

type Offer = 'body' | 'face' | null;

/**
 * Ayarlar › Gizlilik — AÇIK RIZALARIM: every consent with its state and date. Switching one on shows its
 * text (the same sheet as the just-in-time gates); switching one off records the withdrawal at once.
 * Withdrawing the photo consents then offers to delete the photo and what was made from it.
 */
export function ConsentList() {
  const { t } = useTranslation();
  const consents = useConsents();
  const save = useSaveConsents();
  const photos = useMyPhotos();
  const removePhoto = useRemovePhoto();
  const [offer, setOffer] = useState<Offer>(null);

  const toggle = (record: ConsentRecord) => {
    if (!record.valid) {
      void ensureConsents([record.type], 'settings');
      return;
    }
    save.mutate(
      { decisions: [{ type: record.type, granted: false }], source: 'settings' },
      {
        onSuccess: () => {
          if (record.type === 'bodyPhotoAi' && (photos.data?.body.length ?? 0) > 0) setOffer('body');
          if (record.type === 'facePhotoPalette' && photos.data?.face) setOffer('face');
        },
      },
    );
  };

  const deletePhotos = () => {
    if (offer === 'body') photos.data?.body.forEach((p) => removePhoto('body', p.photoId));
    if (offer === 'face' && photos.data?.face) removePhoto('face', photos.data.face.photoId);
    setOffer(null);
  };

  return (
    <>
      <RowCard>
        <SectionState query={consents} inset={false} errorText={t('consent.listError')} skeleton={<Skeleton className="my-3.5 h-40 rounded-image" />}>
          {(data) => (
            <View testID="consent-list">
              {CONSENT_TYPES.map((type: ConsentType, index) => {
                const record = data.consents.find((c) => c.type === type);
                return record ? <ConsentRow key={type} record={record} first={index === 0} busy={save.isPending} onToggle={() => toggle(record)} /> : null;
              })}
            </View>
          )}
        </SectionState>
      </RowCard>
      <Text variant="caption" tone="muted">
        {t('consent.privacyNote')}
      </Text>
      {save.isError ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {t('consent.failed')}
        </Text>
      ) : null}
      <Button
        variant="text"
        label={t('consent.allTexts')}
        onPress={() => void WebBrowser.openBrowserAsync(consentsPageUrl())}
        className="-ml-2 self-start"
      />
      <BottomSheet
        visible={offer !== null}
        onClose={() => setOffer(null)}
        title={t(offer === 'face' ? 'consent.withdrawFaceTitle' : 'consent.withdrawBodyTitle')}
      >
        <View className="gap-3" testID="consent.withdrawOffer">
          <Text variant="body" tone="muted">
            {t(offer === 'face' ? 'consent.withdrawFaceBody' : 'consent.withdrawBodyBody')}
          </Text>
          <Button variant="danger" label={t('consent.deletePhotos')} onPress={deletePhotos} testID="consent.deletePhotos" />
          <Button variant="secondary" size="lg" label={t('consent.keepPhotos')} onPress={() => setOffer(null)} testID="consent.keepPhotos" />
        </View>
      </BottomSheet>
    </>
  );
}
