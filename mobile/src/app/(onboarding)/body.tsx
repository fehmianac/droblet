import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { CameraOff, CircleAlert, Lock, Plus, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { track } from '@/analytics/track';
import { SIZES, type Size } from '@/api/contracts';
import { CONSENTS_FOR } from '@/api/contracts/consents';
import { recordOf, useConsents } from '@/features/consent/api';
import { ensureConsents } from '@/features/consent/store';
import { useEnqueuePhotoUpload } from '@/api/photos';
import { useBodyProfile, useSaveBodyProfile } from '@/api/profile';
import { StepHeader } from '@/components/auth/StepHeader';
import { InfoNote } from '@/components/ui/Bits';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip, ChipWrap } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { deleteLocalPhoto, type PreparedPhoto } from '@/features/photos/preparePhoto';
import { usePhotoPicker } from '@/features/photos/usePhotoPicker';

const MAX_BODY_PHOTOS = 3;
const BODY_SLOTS = [0, 1, 2] as const;

function parseNumber(value: string): number | null {
  const n = Number(value.replace(',', '.').trim());
  return value.trim() === '' || Number.isNaN(n) ? null : n;
}

/** True when the camera permission was refused for good (the system will not ask again). */
async function isCameraBlocked(): Promise<boolean> {
  try {
    const permission = await ImagePicker.getCameraPermissionsAsync();
    return !permission.granted && !permission.canAskAgain;
  } catch {
    return false;
  }
}

/** A chosen photo in its 104-high slot, with a remove button on the corner. */
function PhotoTile({ photo, label, removeLabel, onRemove }: { photo: PreparedPhoto; label: string; removeLabel: string; onRemove: () => void }) {
  return (
    <View className="h-[104px] flex-1">
      <PlaceholderImage uri={photo.localUri} className="h-full w-full rounded-image" accessibilityLabel={label} />
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={removeLabel}
        hitSlop={10}
        className="absolute right-1 top-1 h-6 w-6 items-center justify-center rounded-pill bg-paper/90 active:opacity-70"
      >
        <Icon icon={X} size={14} />
      </Pressable>
    </View>
  );
}

/**
 * 04 Beden ve fotoğraf (2/3). Height, optional weight and size in one row; four photo slots (three
 * full-length, one face). Photos stay on the device until "Devam et", then go into the persisted upload
 * queue. When the camera permission is blocked the board's inline card offers Settings or the library.
 * The privacy note is always visible. "Atla" skips everything.
 */
export default function BodyScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const existing = useBodyProfile();
  const save = useSaveBodyProfile();
  const enqueueUpload = useEnqueuePhotoUpload();
  const consents = useConsents();
  /** Weight is optional and needs its own explicit consent (3); without it the field stays disabled. */
  const weightAllowed = recordOf(consents.data, 'weight')?.valid === true;

  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [size, setSize] = useState<Size | null>(null);
  const [sizeSheet, setSizeSheet] = useState(false);
  const [bodyPhotos, setBodyPhotos] = useState<PreparedPhoto[]>([]);
  const [facePhoto, setFacePhoto] = useState<PreparedPhoto | null>(null);
  const [errors, setErrors] = useState<{ height?: string; weight?: string; size?: string; photo?: string }>({});
  const [prefilled, setPrefilled] = useState(false);
  const [cameraBlocked, setCameraBlocked] = useState(false);

  // Prefill once from the server profile (render-time state adjustment, no effect).
  if (existing.data && !prefilled) {
    setPrefilled(true);
    setHeight(String(existing.data.heightCm));
    setWeight(existing.data.weightKg != null ? String(existing.data.weightKg) : '');
    setSize(existing.data.size);
  }

  const refreshCameraPermission = useCallback(() => {
    void isCameraBlocked().then(setCameraBlocked);
  }, []);

  // The permission can change in Settings while the app is in the background.
  useEffect(() => {
    refreshCameraPermission();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshCameraPermission();
    });
    return () => subscription.remove();
  }, [refreshCameraPermission]);

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

  const chooseBodyFromLibrary = () => bodyPicker.chooseFromLibrary(MAX_BODY_PHOTOS - bodyPhotos.length);

  const addBodyPhoto = async () => {
    // Explicit consents 1 + 6 before the first body photo (their own sheet); "Şimdi değil" leaves the slot empty.
    if (!(await ensureConsents(CONSENTS_FOR.bodyPhoto, 'onboarding'))) return;
    void isCameraBlocked().then((blocked) => {
      setCameraBlocked(blocked);
      // Blocked: the inline card explains why; the slot still works through the library.
      if (blocked) chooseBodyFromLibrary();
      else bodyPicker.takePhoto();
    });
  };

  const removeBodyPhoto = (photo: PreparedPhoto) => {
    deleteLocalPhoto(photo.localUri);
    setBodyPhotos((prev) => prev.filter((p) => p.uploadId !== photo.uploadId));
  };

  const submit = () => {
    const h = parseNumber(height);
    const w = parseNumber(weight);
    const next: typeof errors = {};
    if (h === null || h < 120 || h > 220) next.height = t('body.heightInvalid');
    if (weightAllowed && weight.trim() !== '' && (w === null || w < 30 || w > 250)) next.weight = t('body.weightInvalid');
    if (!size) next.size = t('body.sizeRequired');
    setErrors(next);
    if (Object.keys(next).length > 0 || h === null || !size) return;

    save.save({
      heightCm: Math.round(h),
      // Without the weight consent nothing is stored (the server refuses a weight then: 403 consent_required).
      weightKg: !weightAllowed || w === null ? null : Math.round(w),
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

  const fieldError = errors.height ?? errors.weight ?? errors.size;

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <StepHeader step={3} total={4} onSkip={skip} skipTestID="body.skip" />
        <ScrollView className="flex-1" contentContainerClassName="gap-4 px-6 pb-6 pt-[18px]" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          <View className="gap-2">
            <Text variant="display" className="text-[32px] leading-[34px]">
              {t('body.title')}
            </Text>
            <Text variant="body" tone="muted">
              {t('body.body')}
            </Text>
          </View>

          <View className="gap-1.5">
            <View className="flex-row gap-2.5">
              <View className="flex-1">
                <TextField
                  testID="body.height"
                  label={t('body.height')}
                  value={height}
                  onChangeText={(v) => {
                    setHeight(v);
                    setErrors((e) => ({ ...e, height: undefined }));
                  }}
                  keyboardType="number-pad"
                  maxLength={3}
                />
              </View>
              <View className="flex-1">
                <TextField
                  testID="body.weight"
                  label={t('body.weight')}
                  value={weight}
                  onChangeText={(v) => {
                    setWeight(v);
                    setErrors((e) => ({ ...e, weight: undefined }));
                  }}
                  keyboardType="number-pad"
                  maxLength={3}
                  placeholder={t('body.weightPlaceholder')}
                  editable={weightAllowed}
                  accessibilityState={{ disabled: !weightAllowed }}
                />
              </View>
              <View className="flex-1 gap-1.5">
                <Text variant="label">{t('body.size')}</Text>
                <Pressable
                  onPress={() => setSizeSheet(true)}
                  accessibilityRole="button"
                  accessibilityLabel={size ? t('body.sizeA11y', { size }) : t('body.sizeEmptyA11y')}
                  className={`h-field justify-center rounded-field border bg-paper px-3.5 active:opacity-70 ${
                    errors.size ? 'border-danger' : 'border-line'
                  }`}
                  testID="body.size"
                >
                  <Text variant="body" tone={size ? 'ink' : 'muted'} className="text-[15px]" numberOfLines={1}>
                    {size ?? t('body.sizeChoose')}
                  </Text>
                </Pressable>
              </View>
            </View>
            {consents.data && !weightAllowed ? (
              <View className="flex-row flex-wrap items-center gap-x-2" testID="body.weightConsent">
                <Text variant="caption" tone="muted" className="flex-shrink">
                  {t('consent.weightDisabled')}
                </Text>
                <Button
                  variant="text"
                  size="md"
                  label={t('consent.weightGive')}
                  onPress={() => void ensureConsents(CONSENTS_FOR.weight, 'weight')}
                  className="-ml-2"
                  testID="body.weightGive"
                />
              </View>
            ) : null}
            {fieldError ? (
              <View className="flex-row items-center gap-1.5" accessibilityLiveRegion="polite" accessibilityRole="alert">
                <Icon icon={CircleAlert} size={14} tone="danger" />
                <Text variant="caption" tone="danger" className="flex-1">
                  {fieldError}
                </Text>
              </View>
            ) : null}
          </View>

          <View className="gap-2">
            <View className="flex-row items-center justify-between gap-3">
              <Text variant="bodyMedium" className="flex-1">
                {t('body.bodyPhoto')}{' '}
                <Text variant="caption" tone="muted">
                  {t('body.bodyPhotoHint')}
                </Text>
              </Text>
              <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
                {t('body.bodyPhotoCount', { count: bodyPhotos.length })}
              </Text>
            </View>
            <View className="flex-row gap-2">
              {BODY_SLOTS.map((slot) => {
                const photo = bodyPhotos[slot];
                return photo ? (
                  <PhotoTile
                    key={photo.uploadId}
                    photo={photo}
                    label={t('body.bodyPhotoA11y', { index: slot + 1 })}
                    removeLabel={t('a11y.removePhoto')}
                    onRemove={() => removeBodyPhoto(photo)}
                  />
                ) : (
                  <Pressable
                    key={`empty${slot}`}
                    onPress={() => void addBodyPhoto()}
                    accessibilityRole="button"
                    accessibilityLabel={t('body.addBodyPhoto')}
                    className="h-[104px] flex-1 items-center justify-center rounded-image border-[1.5px] border-dashed border-muted/60 active:opacity-70"
                  >
                    <Icon icon={Plus} size={20} />
                  </Pressable>
                );
              })}
              {facePhoto ? (
                <PhotoTile
                  photo={facePhoto}
                  label={t('body.facePhoto')}
                  removeLabel={t('a11y.removePhoto')}
                  onRemove={() => {
                    deleteLocalPhoto(facePhoto.localUri);
                    setFacePhoto(null);
                  }}
                />
              ) : (
                <Pressable
                  onPress={() =>
                    void ensureConsents(CONSENTS_FOR.facePhoto, 'onboarding').then((ok) => ok && facePicker.chooseFromLibrary(1))
                  }
                  accessibilityRole="button"
                  accessibilityLabel={t('body.addFacePhoto')}
                  accessibilityHint={t('body.facePhotoHint')}
                  className="h-[104px] flex-1 items-center justify-center gap-1.5 rounded-image bg-sand active:opacity-70"
                >
                  <View className="h-[50px] w-10 rounded-pill border-[1.5px] border-dashed border-muted" />
                  <Text variant="tab" className="font-sans-medium">
                    {t('body.faceShort')}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>

          {cameraBlocked ? (
            <View className="gap-2 rounded-card border border-danger bg-paper px-3.5 py-3" accessibilityRole="alert">
              <View className="flex-row items-start gap-2.5">
                <Icon icon={CameraOff} size={18} tone="danger" />
                <Text variant="caption" className="flex-1 leading-[17.5px]">
                  {t('body.cameraOff')}
                </Text>
              </View>
              <View className="flex-row flex-wrap gap-2">
                <Chip label={t('common.openSettings')} onPress={() => void Linking.openSettings()} />
                <Chip
                  label={t('permission.useGallery')}
                  onPress={() => void ensureConsents(CONSENTS_FOR.bodyPhoto, 'onboarding').then((ok) => ok && chooseBodyFromLibrary())}
                />
              </View>
            </View>
          ) : null}

          {errors.photo ? (
            <Text variant="caption" tone="danger" accessibilityRole="alert">
              {errors.photo}
            </Text>
          ) : null}

          <InfoNote icon={Lock} text={t('body.privacy')} />
        </ScrollView>

        <View className="px-6 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}>
          <Button testID="body.continue" label={t('common.continue')} onPress={submit} />
        </View>
      </KeyboardAvoidingView>

      <BottomSheet visible={sizeSheet} onClose={() => setSizeSheet(false)} title={t('body.sizeSheetTitle')}>
        <ChipWrap>
          {SIZES.map((s) => (
            <Chip
              key={s}
              testID={`body.size.${s}`}
              label={s}
              selected={size === s}
              onPress={() => {
                setSize(s);
                setErrors((e) => ({ ...e, size: undefined }));
                setSizeSheet(false);
              }}
            />
          ))}
        </ChipWrap>
      </BottomSheet>

      {bodyPicker.sheet}
      {facePicker.sheet}
    </Screen>
  );
}
