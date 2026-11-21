import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Camera, Check, Frame, MoveVertical, Sun, WifiOff } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import type { PhotoKind } from '@/api/contracts';
import { DropLoader } from '@/components/brand/DropLoader';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { accountKeys } from '@/features/account/queries';
import { PhotoGuideStrip } from '@/features/photos/PhotoGuideStrip';
import type { PreparedPhoto } from '@/features/photos/preparePhoto';
import { usePhotoPicker } from '@/features/photos/usePhotoPicker';
import { newClientMutation } from '@/sync/clientMutation';
import { useIsOnline } from '@/sync/network';
import type { UploadPhotoVariables } from '@/sync/photoUpload';
import { mutationKeys } from '@/sync/queryKeys';

import { StepBar, type StepProps } from './StepBar';

type Phase = 'guide' | 'uploading' | 'offline' | 'ready';

function Tip({ icon, title, body }: { icon: typeof Sun; title: string; body?: string }) {
  return (
    <View className="flex-row items-start gap-3">
      <View className="h-9 w-9 items-center justify-center rounded-pill bg-sand">
        <Icon icon={icon} size={18} />
      </View>
      <View className="flex-1">
        <Text variant="bodyMedium">{title}</Text>
        {body ? (
          <Text variant="caption" tone="muted">
            {body}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Canvas 11d / 11e photo step — guide (the 22c example strip + tips), upload, "Fotoğraf hazır". The upload is the queued,
 * persisted photo upload: offline, the photo waits on the phone ("Fotoğrafın telefonda bekliyor") and goes up
 * when the connection is back. The step is done when the user continues from "Fotoğraf hazır".
 */
export function StepPhoto({ kind, onDone, onLeave }: StepProps & { kind: PhotoKind; onLeave: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const online = useIsOnline();
  const upload = useMutation<void, unknown, UploadPhotoVariables>({ mutationKey: mutationKeys.uploadPhoto });
  const [phase, setPhase] = useState<Phase>('guide');
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [pickError, setPickError] = useState(false);

  const send = (picked: PreparedPhoto) => {
    setPhoto(picked);
    setPickError(false);
    setPhase(online ? 'uploading' : 'offline');
    upload.mutate(
      { uploadId: picked.uploadId, kind, localUri: picked.localUri, ...newClientMutation() },
      {
        onSuccess: () => {
          void client.invalidateQueries({ queryKey: accountKeys.photos });
          setPhase('ready');
        },
        onError: () => setPhase('offline'),
      },
    );
  };

  const picker = usePhotoPicker({
    onPicked: (photos) => {
      if (photos[0]) send(photos[0]);
    },
    onError: () => setPickError(true),
  });

  const face = kind === 'face';
  let body: ReactNode;
  let bar: ReactNode;
  if (phase === 'guide') {
    body = (
      <ScrollView contentContainerClassName="gap-4 px-6 pb-6 pt-5">
        <View className="gap-2">
          <Text variant="display" className="text-[32px] leading-[36px]" accessibilityRole="header">
            {t(face ? 'req.photo.faceTitle' : 'req.photo.bodyTitle')}
          </Text>
          <Text variant="body" tone="muted">
            {t(face ? 'req.photo.faceLead' : 'req.photo.bodyLead')}
          </Text>
        </View>
        {face ? (
          <View className="gap-3">
            <Tip icon={Sun} title={t('req.photo.faceTipLight')} />
            <Tip icon={Frame} title={t('req.photo.faceTipGlasses')} />
            <Text variant="caption" tone="muted">
              {t('req.photo.faceTipIdentity')}
            </Text>
          </View>
        ) : (
          <>
            <PhotoGuideStrip />
            <View className="gap-3">
              <Tip icon={Frame} title={t('req.photo.tipBackground')} body={t('req.photo.tipBackgroundBody')} />
              <Tip icon={MoveVertical} title={t('req.photo.tipFrame')} body={t('req.photo.tipFrameBody')} />
              <Tip icon={Sun} title={t('req.photo.tipLight')} body={t('req.photo.tipLightBody')} />
            </View>
          </>
        )}
        {pickError ? (
          <Text variant="caption" tone="danger" accessibilityRole="alert">
            {t('req.photo.pickFailed')}
          </Text>
        ) : null}
      </ScrollView>
    );
    bar = (
      <StepBar>
        <Button icon={Camera} label={t(face ? 'req.photo.takeSelfie' : 'req.photo.take')} onPress={picker.takePhoto} testID="requirements.photo.take" />
        <Button variant="secondary" size="md" label={t('req.photo.library')} onPress={() => picker.chooseFromLibrary(1)} testID="requirements.photo.library" />
      </StepBar>
    );
  } else if (phase === 'offline') {
    body = (
      <ScrollView contentContainerClassName="gap-4 px-6 pb-6 pt-5" testID="requirements.photo.offline">
        <View className="flex-row items-center gap-2 self-start rounded-pill bg-ink px-3 py-1.5" accessibilityRole="alert">
          <Icon icon={WifiOff} size={14} tone="cream" />
          <Text variant="badge" tone="cream">
            {t('req.photo.offlineBanner')}
          </Text>
        </View>
        <View className="h-72 items-center justify-center overflow-hidden rounded-[20px] bg-sand">
          {photo ? <Image source={{ uri: photo.localUri }} style={{ width: '100%', height: '100%', opacity: 0.6 }} contentFit="cover" accessible={false} /> : null}
          <View className="absolute">
            <DropLoader size="inline" still />
          </View>
        </View>
        <Text variant="h2">{t('req.photo.offlineTitle')}</Text>
        <Text variant="body" tone="muted">
          {t('req.photo.offlineBody')}
        </Text>
      </ScrollView>
    );
    bar = (
      <StepBar>
        <Button
          label={t('req.photo.retry')}
          onPress={() => {
            if (photo) send(photo);
          }}
          testID="requirements.photo.retry"
        />
        <Button variant="secondary" size="md" label={t('req.photo.back')} onPress={onLeave} testID="requirements.photo.back" />
      </StepBar>
    );
  } else if (phase === 'uploading') {
    body = (
      <View className="flex-1 gap-4 px-6 pt-5" accessibilityLiveRegion="polite" testID="requirements.photo.uploading">
        <View className="h-96 items-center justify-center overflow-hidden rounded-[20px] bg-sand">
          {photo ? <Image source={{ uri: photo.localUri }} style={{ width: '100%', height: '100%', opacity: 0.45 }} contentFit="cover" accessible={false} /> : null}
          <View className="absolute">
            <DropLoader size="screen" overlay accessibilityLabel={t('req.photo.uploading')} />
          </View>
        </View>
        <Text variant="bodyMedium">{t('req.photo.uploading')}</Text>
        <Text variant="caption" tone="muted">
          {t('req.photo.checking')}
        </Text>
      </View>
    );
    bar = (
      <StepBar>
        <Button variant="secondary" size="md" label={t('req.photo.cancel')} onPress={() => setPhase('guide')} testID="requirements.photo.cancel" />
      </StepBar>
    );
  } else {
    body = (
      <View className="flex-1 gap-4 px-6 pt-5" testID="requirements.photo.ready">
        <View className="h-96 overflow-hidden rounded-[20px] bg-sand">
          {photo ? <Image source={{ uri: photo.localUri }} style={{ width: '100%', height: '100%' }} contentFit="cover" accessible={false} /> : null}
          <View className="absolute left-3 top-3 h-7 flex-row items-center gap-1.5 rounded-pill bg-ink px-2.5">
            <Icon icon={Check} size={13} tone="cream" />
            <Text variant="badge" tone="cream">
              {t('req.photo.ready')}
            </Text>
          </View>
          <View className="absolute bottom-3 left-3 rounded-[4px] bg-paper/90 px-2 py-1">
            <Text variant="tag">{t('req.photo.privateTag')}</Text>
          </View>
        </View>
        <Text variant="h2" accessibilityLiveRegion="polite">
          {t('req.photo.ready')}
        </Text>
      </View>
    );
    bar = (
      <StepBar>
        <Button label={t('req.photo.continue')} onPress={onDone} testID="requirements.photo.continue" />
        <Button variant="text" label={t('req.photo.another')} onPress={() => setPhase('guide')} testID="requirements.photo.another" />
      </StepBar>
    );
  }

  return (
    <View className="flex-1" testID={`requirements.step.${face ? 'facePhoto' : 'bodyPhoto'}`}>
      {body}
      {bar}
      {picker.sheet}
    </View>
  );
}
