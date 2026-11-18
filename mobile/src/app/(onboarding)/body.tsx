import { router } from 'expo-router';
import { Camera, ImagePlus, ShieldCheck, X } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { track } from '@/analytics/track';
import { SIZES, type Size } from '@/api/contracts';
import { useEnqueuePhotoUpload } from '@/api/photos';
import { useBodyProfile, useSaveBodyProfile } from '@/api/profile';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Chip, ChipWrap } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { deleteLocalPhoto, type PreparedPhoto } from '@/features/photos/preparePhoto';
import { usePhotoPicker } from '@/features/photos/usePhotoPicker';

const MAX_BODY_PHOTOS = 3;

function parseNumber(value: string): number | null {
  const n = Number(value.replace(',', '.').trim());
  return value.trim() === '' || Number.isNaN(n) ? null : n;
}

function PhotoThumb({ photo, onRemove, label }: { photo: PreparedPhoto; onRemove: () => void; label: string }) {
  return (
    <View>
      <PlaceholderImage uri={photo.localUri} className="h-24 w-[76px] rounded-image" />
      <View className="absolute -right-3 -top-3">
        <IconButton icon={X} variant="inverse" onPress={onRemove} accessibilityLabel={label} />
      </View>
    </View>
  );
}

/**
 * 04 Beden ve fotoğraf (2/3). Height, optional weight, size; 1–3 full-length photos (camera) and a
 * face photo (library). Photos stay on the device until "Devam et", then go into the persisted upload
 * queue. The privacy note is always visible. "Atla" skips everything.
 */
export default function BodyScreen() {
  const { t } = useTranslation();
  const existing = useBodyProfile();
  const save = useSaveBodyProfile();
  const enqueueUpload = useEnqueuePhotoUpload();

  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [size, setSize] = useState<Size | null>(null);
  const [bodyPhotos, setBodyPhotos] = useState<PreparedPhoto[]>([]);
  const [facePhoto, setFacePhoto] = useState<PreparedPhoto | null>(null);
  const [errors, setErrors] = useState<{ height?: string; weight?: string; size?: string; photo?: string }>({});
  const [prefilled, setPrefilled] = useState(false);

  // Prefill once from the server profile (render-time state adjustment, no effect).
  if (existing.data && !prefilled) {
    setPrefilled(true);
    setHeight(String(existing.data.heightCm));
    setWeight(existing.data.weightKg != null ? String(existing.data.weightKg) : '');
    setSize(existing.data.size);
  }

  const onPhotoError = () => setErrors((e) => ({ ...e, photo: t('body.photoFailed') }));

  const bodyPicker = usePhotoPicker({
    onPicked: (photos) => {
      setErrors((e) => ({ ...e, photo: undefined }));
      setBodyPhotos((prev) => [...prev, ...photos].slice(0, MAX_BODY_PHOTOS));
    },
    onError: onPhotoError,
  });
  const facePicker = usePhotoPicker({
    onPicked: (photos) => {
      setErrors((e) => ({ ...e, photo: undefined }));
      const next = photos[0];
      if (!next) return;
      setFacePhoto((prev) => {
        if (prev) deleteLocalPhoto(prev.localUri);
        return next;
      });
    },
    onError: onPhotoError,
  });

  const removeBodyPhoto = (photo: PreparedPhoto) => {
    deleteLocalPhoto(photo.localUri);
    setBodyPhotos((prev) => prev.filter((p) => p.uploadId !== photo.uploadId));
  };

  const submit = () => {
    const h = parseNumber(height);
    const w = parseNumber(weight);
    const next: typeof errors = {};
    if (h === null || h < 120 || h > 220) next.height = t('body.heightInvalid');
    if (weight.trim() !== '' && (w === null || w < 30 || w > 250)) next.weight = t('body.weightInvalid');
    if (!size) next.size = t('body.sizeRequired');
    setErrors(next);
    if (Object.keys(next).length > 0 || h === null || !size) return;

    save.save({
      heightCm: Math.round(h),
      weightKg: w === null ? null : Math.round(w),
      size,
      baseVersion: existing.data?.baseVersion ?? 0,
    });
    bodyPhotos.forEach((p) => enqueueUpload({ uploadId: p.uploadId, kind: 'body', localUri: p.localUri }));
    if (facePhoto) enqueueUpload({ uploadId: facePhoto.uploadId, kind: 'face', localUri: facePhoto.localUri });
    track('signup_step', { step: 'body_profile', bodyPhotos: bodyPhotos.length, facePhoto: facePhoto !== null });
    router.push('/first-items');
  };

  const skip = () => {
    bodyPhotos.forEach((p) => deleteLocalPhoto(p.localUri));
    if (facePhoto) deleteLocalPhoto(facePhoto.localUri);
    track('signup_step', { step: 'body_profile', skipped: true });
    router.push('/first-items');
  };

  return (
    <Screen>
      <OfflineBanner />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScreenHeader leading="back" right={<Button variant="text" label={t('common.skip')} onPress={skip} testID="body.skip" />} />
        <ScrollView contentContainerClassName="gap-8 px-gutter pb-10" keyboardShouldPersistTaps="handled">
          <View className="gap-2">
            <Text variant="eyebrow">
              {t('common.eyebrowWithStep', { label: t('body.eyebrow'), step: t('common.stepOf', { current: 2, total: 3 }) })}
            </Text>
            <Text variant="display">{t('body.title')}</Text>
            <Text variant="body" tone="muted">
              {t('body.body')}
            </Text>
          </View>

          <View className="gap-4">
            <View className="flex-row gap-3">
              <View className="flex-1">
                <TextField
                  label={t('body.height')}
                  value={height}
                  onChangeText={(v) => {
                    setHeight(v);
                    setErrors((e) => ({ ...e, height: undefined }));
                  }}
                  keyboardType="number-pad"
                  maxLength={3}
                  testID="body.height"
                  error={errors.height}
                />
              </View>
              <View className="flex-1">
                <TextField
                  label={t('body.weight')}
                  value={weight}
                  onChangeText={(v) => {
                    setWeight(v);
                    setErrors((e) => ({ ...e, weight: undefined }));
                  }}
                  keyboardType="number-pad"
                  maxLength={3}
                  testID="body.weight"
                  hint={t('body.weightOptional')}
                  error={errors.weight}
                />
              </View>
            </View>
            <View className="gap-2">
              <Text variant="bodyMedium">{t('body.size')}</Text>
              <ChipWrap>
                {SIZES.map((s) => (
                  <Chip
                    key={s}
                    label={s}
                    selected={size === s}
                    testID={`body.size.${s}`}
                    onPress={() => {
                      setSize(s);
                      setErrors((e) => ({ ...e, size: undefined }));
                    }}
                  />
                ))}
              </ChipWrap>
              {errors.size ? (
                <Text variant="caption" tone="danger">
                  {errors.size}
                </Text>
              ) : null}
            </View>
          </View>

          <View className="gap-3 rounded-card border border-line bg-paper p-4">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1 gap-0.5">
                <Text variant="h3">{t('body.bodyPhoto')}</Text>
                <Text variant="caption" tone="muted">
                  {t('body.bodyPhotoHint')}
                </Text>
              </View>
              <Text variant="bodyMedium" tone="accent">
                {t('body.bodyPhotoCount', { count: bodyPhotos.length })}
              </Text>
            </View>
            <View className="flex-row flex-wrap items-center gap-4 pt-2">
              {bodyPhotos.map((p) => (
                <PhotoThumb key={p.uploadId} photo={p} onRemove={() => removeBodyPhoto(p)} label={t('a11y.removePhoto')} />
              ))}
            </View>
            {bodyPhotos.length < MAX_BODY_PHOTOS ? (
              <View className="items-start">
                <Button variant="secondary" icon={Camera} label={t('body.capture')} onPress={bodyPicker.takePhoto} />
              </View>
            ) : null}
          </View>

          <View className="gap-3 rounded-card border border-line bg-paper p-4">
            <View className="gap-0.5">
              <Text variant="h3">{t('body.facePhoto')}</Text>
              <Text variant="caption" tone="muted">
                {t('body.facePhotoHint')}
              </Text>
            </View>
            {facePhoto ? (
              <View className="pt-2">
                <PhotoThumb
                  photo={facePhoto}
                  label={t('a11y.removePhoto')}
                  onRemove={() => {
                    deleteLocalPhoto(facePhoto.localUri);
                    setFacePhoto(null);
                  }}
                />
              </View>
            ) : null}
            <View className="items-start">
              <Button
                variant="secondary"
                icon={ImagePlus}
                label={t(facePhoto ? 'body.replace' : 'body.upload')}
                onPress={() => facePicker.chooseFromLibrary(1)}
              />
            </View>
          </View>

          {errors.photo ? (
            <Text variant="caption" tone="danger" accessibilityRole="alert">
              {errors.photo}
            </Text>
          ) : null}

          <View className="flex-row gap-3 rounded-card bg-sand p-4">
            <Icon icon={ShieldCheck} tone="accent" />
            <Text variant="body" className="flex-1">
              {t('body.privacy')}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <BottomActionBar>
        <Button label={t('common.continue')} onPress={submit} testID="body.continue" />
      </BottomActionBar>

      {bodyPicker.sheet}
      {facePicker.sheet}
    </Screen>
  );
}
