import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MyProfile } from '@/api/contracts/account';
import { ApiError, extractApiError } from '@/api/errors';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Silhouette } from '@/components/ui/Silhouette';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { HANDLE_MAX, HANDLE_MIN, NAME_MAX, normalizeHandle, validateProfile } from '@/features/account/logic';
import { useUpdateProfile } from '@/features/account/mutations';
import { useMyProfile } from '@/features/account/queries';
import type { PreparedPhoto } from '@/features/photos/preparePhoto';
import { usePhotoPicker } from '@/features/photos/usePhotoPicker';
import { useIsOnline } from '@/sync/network';
import { placeholderTones } from '@/theme/tokens';

/** keep = the saved photo, new = a file picked on this screen, removed = no photo after saving. */
type AvatarDraft = { kind: 'keep' } | { kind: 'new'; photo: PreparedPhoto } | { kind: 'removed' };

function FormSkeleton() {
  return (
    <View className="items-center gap-5 px-gutter pt-4">
      <Skeleton className="h-[88px] w-[88px] rounded-pill" />
      <Skeleton className="h-field w-full rounded-field" />
      <Skeleton className="h-field w-full rounded-field" />
    </View>
  );
}

function Form({ profile }: { profile: MyProfile }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const save = useUpdateProfile();
  const [name, setName] = useState(profile.displayName);
  const [handle, setHandle] = useState(profile.handle ?? '');
  const [avatar, setAvatar] = useState<AvatarDraft>({ kind: 'keep' });
  const [submitted, setSubmitted] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  /** The handle the server refused as taken — the error stays until the user types another one. */
  const [takenHandle, setTakenHandle] = useState<string | null>(null);

  const picker = usePhotoPicker({
    onPicked: (list) => {
      const photo = list[0];
      if (!photo) return;
      setPhotoFailed(false);
      setAvatar({ kind: 'new', photo });
    },
    onError: () => setPhotoFailed(true),
  });

  const cleanHandle = normalizeHandle(handle);
  const errors = validateProfile({ displayName: name, handle });
  const valid = !errors.displayName && !errors.handle;
  const dirty = name.trim() !== profile.displayName || cleanHandle !== (profile.handle ?? '') || avatar.kind !== 'keep';
  const avatarUri = avatar.kind === 'new' ? avatar.photo.localUri : avatar.kind === 'removed' ? null : profile.avatarUrl;

  const fieldError = (code: (typeof errors)['displayName']) =>
    code ? t(`profileEdit.errors.${code}`, { min: HANDLE_MIN, max: code === 'nameTooLong' ? NAME_MAX : HANDLE_MAX }) : null;
  const handleError = takenHandle !== null && takenHandle === cleanHandle ? t('profileEdit.errors.handleTaken') : submitted ? fieldError(errors.handle) : null;
  const saveError =
    save.isError && !(save.error instanceof ApiError && save.error.code === 'handle_taken') ? t(`errors.${extractApiError(save.error)}`) : null;

  const submit = () => {
    setSubmitted(true);
    if (!valid || !online) return;
    save.mutate(
      {
        displayName: name.trim(),
        handle: cleanHandle,
        avatar: avatar.kind === 'new' ? { localUri: avatar.photo.localUri } : avatar.kind === 'removed' ? null : undefined,
        baseVersion: profile.baseVersion,
      },
      {
        onSuccess: () => router.back(),
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'handle_taken') setTakenHandle(cleanHandle);
        },
      },
    );
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
      <ScrollView contentContainerClassName="gap-5 px-gutter pb-6 pt-2" keyboardShouldPersistTaps="handled">
        <View className="items-center gap-1">
          {avatarUri ? (
            <PlaceholderImage uri={avatarUri} className="h-[88px] w-[88px] rounded-pill" accessibilityLabel={t('me.avatar')} />
          ) : (
            <View
              className="h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-pill"
              style={{ backgroundColor: placeholderTones.stage }}
              accessible
              accessibilityRole="image"
              accessibilityLabel={t('profileEdit.noPhoto')}
            >
              <Silhouette height={68} />
            </View>
          )}
          <Button variant="text" label={t(avatarUri ? 'profileEdit.changePhoto' : 'profileEdit.addPhoto')} onPress={() => setPhotoOpen(true)} />
          {photoFailed ? (
            <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
              {t('settings.photoFailed')}
            </Text>
          ) : null}
        </View>

        <TextField
          label={t('profileEdit.name')}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoComplete="name"
          maxLength={NAME_MAX + 10}
          returnKeyType="next"
          error={submitted ? fieldError(errors.displayName) : null}
        />
        <TextField
          label={t('profileEdit.handle')}
          value={handle}
          onChangeText={setHandle}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          maxLength={HANDLE_MAX + 10}
          returnKeyType="done"
          onSubmitEditing={submit}
          error={handleError}
          hint={cleanHandle ? t('profileEdit.handleHint', { handle: cleanHandle }) : t('profileEdit.handleRules', { min: HANDLE_MIN, max: HANDLE_MAX })}
        />
      </ScrollView>

      <View className="gap-2 px-gutter pt-2" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
        {!online || saveError ? (
          <Text variant="caption" tone="danger" className="text-center" accessibilityLiveRegion="polite">
            {!online ? t('profileEdit.offline') : saveError}
          </Text>
        ) : null}
        <Button label={t('profileEdit.save')} onPress={submit} disabled={!dirty || !online} loading={save.isPending} testID="profile-save" />
      </View>

      <BottomSheet visible={photoOpen} onClose={() => setPhotoOpen(false)} title={t('profileEdit.photoTitle')}>
        <View className="gap-2">
          <Button
            label={t('profileEdit.takePhoto')}
            onPress={() => {
              setPhotoOpen(false);
              picker.takePhoto();
            }}
          />
          <Button
            variant="secondary"
            size="lg"
            label={t('profileEdit.choosePhoto')}
            onPress={() => {
              setPhotoOpen(false);
              picker.chooseFromLibrary(1);
            }}
          />
          {avatarUri ? (
            <Button
              variant="text"
              label={t('profileEdit.removePhoto')}
              onPress={() => {
                setPhotoOpen(false);
                setAvatar({ kind: 'removed' });
              }}
            />
          ) : null}
        </View>
      </BottomSheet>
      {picker.sheet}
    </KeyboardAvoidingView>
  );
}

/**
 * "Profili düzenle" — the pencil on 28 Profil. No board exists; derived from the canvas vocabulary
 * (29c form: centred header, 48 pt fields with 12 pt labels, one primary action at the bottom):
 * profile photo, name and @handle. Saved online only — the server decides whether the handle is free.
 */
export default function EditProfileScreen() {
  const { t } = useTranslation();
  const profile = useMyProfile();
  return (
    <Screen>
      <ScreenHeader title={t('profileEdit.title')} leading="back" />
      <ScreenState query={profile} skeleton={<FormSkeleton />}>
        {(data) => <Form profile={data} />}
      </ScreenState>
    </Screen>
  );
}
