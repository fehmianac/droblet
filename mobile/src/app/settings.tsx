import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Plus, Trash2, X } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { logout } from '@/api/auth';
import { CLOSET_VISIBILITIES, type MyPhotos, type NotificationSettings } from '@/api/contracts/account';
import { useEnqueuePhotoUpload } from '@/api/photos';
import { Card, DangerButton } from '@/components/blocks/basics';
import { ConfirmDialog, MenuRow, RadioRow, ToggleRow } from '@/components/blocks/rows';
import { SectionState } from '@/components/blocks/SectionState';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip, ChipWrap } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import {
  useDeleteAllPhotos,
  useRemovePhoto,
  useSaveNotificationSettings,
  useSetVisibility,
} from '@/features/account/mutations';
import { accountKeys, useMyPhotos, useMyProfile, useNotificationSettings, usePalette } from '@/features/account/queries';
import type { PreparedPhoto } from '@/features/photos/preparePhoto';
import { usePhotoPicker } from '@/features/photos/usePhotoPicker';
import { currentLanguage, LANGUAGES, SUPPORTED_LANGUAGES, type AppLanguage } from '@/i18n';
import { setAppLanguage } from '@/i18n/preference';
import { localToUtcTime, REMINDER_TIMES, utcToLocalTime } from '@/notify/time';
import { mutationKeys } from '@/sync/queryKeys';

const MAX_BODY_PHOTOS = 3;

function PhotoThumb({ uri, tag, removeLabel, onRemove }: { uri: string | null; tag: string; removeLabel?: string; onRemove?: () => void }) {
  return (
    <View>
      <PlaceholderImage uri={uri} className="h-24 w-[76px] rounded-image" accessibilityLabel={tag} />
      <View className="absolute bottom-1.5 left-1.5 rounded-pill bg-paper/90 px-2 py-0.5" pointerEvents="none">
        <Text variant="eyebrow" tone="ink">
          {tag}
        </Text>
      </View>
      {onRemove && removeLabel ? (
        <View className="absolute -right-3 -top-3">
          <IconButton icon={X} variant="inverse" onPress={onRemove} accessibilityLabel={removeLabel} />
        </View>
      ) : null}
    </View>
  );
}

/** FOTOĞRAFLARIM — the user's own photos: remove one, add one, or delete everything (29b). */
function PhotosSection({ onDeleteAll }: { onDeleteAll: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const photos = useMyPhotos();
  const removePhoto = useRemovePhoto();
  const enqueueUpload = useEnqueuePhotoUpload();
  const uploading = useIsMutating({ mutationKey: mutationKeys.uploadPhoto });
  const [addOpen, setAddOpen] = useState(false);
  const [queued, setQueued] = useState<{ kind: 'body' | 'face'; photo: PreparedPhoto }[]>([]);
  const [failed, setFailed] = useState(false);

  // When the upload queue drains, the server list is the truth again (render-time adjustment).
  const [wasUploading, setWasUploading] = useState(0);
  if (uploading !== wasUploading) {
    setWasUploading(uploading);
    if (uploading === 0 && queued.length > 0) {
      setQueued([]);
      void client.invalidateQueries({ queryKey: accountKeys.photos });
    }
  }

  const picked = (kind: 'body' | 'face') => (list: PreparedPhoto[]) => {
    setFailed(false);
    const photo = list[0];
    if (!photo) return;
    enqueueUpload({ uploadId: photo.uploadId, kind, localUri: photo.localUri });
    setQueued((prev) => [...prev.filter((q) => kind === 'body' || q.kind !== 'face'), { kind, photo }]);
  };
  const bodyPicker = usePhotoPicker({ onPicked: picked('body'), onError: () => setFailed(true) });
  const facePicker = usePhotoPicker({ onPicked: picked('face'), onError: () => setFailed(true) });

  const bodyCount = (data: MyPhotos) => data.body.length + queued.filter((q) => q.kind === 'body').length;

  return (
    <Card className="gap-3 p-4">
      <SectionState
        query={photos}
        inset={false}
        errorText={t('settings.photosError')}
        skeleton={
          <View className="flex-row gap-4">
            <Skeleton className="h-24 w-[76px] rounded-image" />
            <Skeleton className="h-24 w-[76px] rounded-image" />
          </View>
        }
      >
        {(data) => (
          <>
            <View className="flex-row flex-wrap gap-4 pt-2">
              {data.body.map((p) => (
                <PhotoThumb
                  key={p.photoId}
                  uri={p.url}
                  tag={t('settings.bodyTag')}
                  removeLabel={t('settings.removeBody')}
                  onRemove={() => removePhoto('body', p.photoId)}
                />
              ))}
              {data.face && !queued.some((q) => q.kind === 'face') ? (
                <PhotoThumb
                  uri={data.face.url}
                  tag={t('settings.faceTag')}
                  removeLabel={t('settings.removeFace')}
                  onRemove={() => data.face && removePhoto('face', data.face.photoId)}
                />
              ) : null}
              {queued.map((q) => (
                <PhotoThumb key={q.photo.uploadId} uri={q.photo.localUri} tag={t(q.kind === 'body' ? 'settings.bodyTag' : 'settings.faceTag')} />
              ))}
              <Pressable
                onPress={() => setAddOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.addPhoto')}
                className="h-24 w-[76px] items-center justify-center rounded-image border border-dashed border-line active:opacity-70"
              >
                <Icon icon={Plus} tone="muted" />
              </Pressable>
            </View>
            {queued.length > 0 ? (
              <Text variant="caption" tone="accent" accessibilityLiveRegion="polite">
                {t('settings.uploadQueued')}
              </Text>
            ) : null}
            {failed ? (
              <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
                {t('settings.photoFailed')}
              </Text>
            ) : null}
            <BottomSheet visible={addOpen} onClose={() => setAddOpen(false)} title={t('settings.addTitle')}>
              <View className="gap-2">
                <Button
                  label={t('settings.addBody')}
                  disabled={bodyCount(data) >= MAX_BODY_PHOTOS}
                  onPress={() => {
                    setAddOpen(false);
                    bodyPicker.takePhoto();
                  }}
                />
                <Button
                  variant="secondary"
                  label={t('settings.addFace')}
                  onPress={() => {
                    setAddOpen(false);
                    facePicker.chooseFromLibrary(1);
                  }}
                />
              </View>
            </BottomSheet>
          </>
        )}
      </SectionState>
      <Text variant="caption" tone="muted">
        {t('settings.photosNote')}
      </Text>
      <Pressable
        onPress={onDeleteAll}
        accessibilityRole="button"
        accessibilityLabel={t('settings.deletePhotos')}
        className="min-h-icon-btn flex-row items-center gap-2 border-t border-line pt-3 active:opacity-70"
      >
        <Icon icon={Trash2} size={18} tone="danger" />
        <Text variant="bodyMedium" tone="danger" className="flex-1">
          {t('settings.deletePhotos')}
        </Text>
      </Pressable>
      {bodyPicker.sheet}
      {facePicker.sheet}
    </Card>
  );
}

/** 29b — what exactly is deleted, that it cannot be undone, and what stays. */
function DeletePhotosDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const photos = useMyPhotos();
  const palette = usePalette();
  const deleteAll = useDeleteAllPhotos();

  const lines: string[] = [];
  if (photos.data && photos.data.body.length > 0) lines.push(t('photoDelete.bodyPhotos', { count: photos.data.body.length }));
  if (photos.data?.face) lines.push(t('photoDelete.facePhoto'));
  const generated = photos.data?.generatedImageCount ?? null;
  lines.push(generated !== null && generated > 0 ? t('photoDelete.generated', { count: generated }) : t('photoDelete.generatedAll'));
  if (palette.data) lines.push(t('photoDelete.palette'));

  return (
    <ConfirmDialog
      visible={visible}
      onCancel={onClose}
      title={t('photoDelete.title')}
      actions={
        <>
          <DangerButton
            label={t('photoDelete.confirm')}
            onPress={() => {
              deleteAll();
              onClose();
            }}
          />
          <Button variant="secondary" label={t('common.cancel')} onPress={onClose} />
        </>
      }
    >
      <View className="gap-2">
        <Text variant="body">{t('photoDelete.listTitle')}</Text>
        {lines.map((line) => (
          <View key={line} className="flex-row gap-2">
            <Text variant="caption" tone="muted">
              •
            </Text>
            <Text variant="caption" tone="muted" className="flex-1">
              {line}
            </Text>
          </View>
        ))}
        <Text variant="bodyMedium" tone="danger">
          {t('photoDelete.irreversible')}
        </Text>
        <Text variant="caption" tone="muted">
          {t('photoDelete.keeps')}
        </Text>
      </View>
    </ConfirmDialog>
  );
}

function NotificationsSection() {
  const { t } = useTranslation();
  const settings = useNotificationSettings();
  const save = useSaveNotificationSettings();
  const [timeOpen, setTimeOpen] = useState(false);

  return (
    <Card>
      <SectionState
        query={settings}
        inset={false}
        errorText={t('settings.notificationsError')}
        skeleton={<Skeleton className="m-4 h-28 rounded-image" />}
      >
        {(data) => {
          const change = (patch: Partial<NotificationSettings>) => save({ ...data, ...patch });
          const localTime = utcToLocalTime(data.morningTimeUtc);
          return (
            <>
              <ToggleRow first label={t('settings.morning')} value={data.morningReminder} onChange={(v) => change({ morningReminder: v })} />
              {data.morningReminder ? (
                <MenuRow label={t('settings.morningTime')} value={localTime} onPress={() => setTimeOpen(true)} />
              ) : null}
              <ToggleRow label={t('settings.weeklyEdit')} value={data.weeklyEdit} onChange={(v) => change({ weeklyEdit: v })} />
              <ToggleRow label={t('settings.friendRatings')} value={data.friendRatings} onChange={(v) => change({ friendRatings: v })} />
              <BottomSheet visible={timeOpen} onClose={() => setTimeOpen(false)} title={t('settings.timeTitle')}>
                <ChipWrap>
                  {REMINDER_TIMES.map((time) => (
                    <Chip
                      key={time}
                      label={time}
                      selected={time === localTime}
                      onPress={() => {
                        // Shown in local time, stored as UTC HH:mm.
                        change({ morningTimeUtc: localToUtcTime(time) });
                        setTimeOpen(false);
                      }}
                    />
                  ))}
                </ChipWrap>
              </BottomSheet>
            </>
          );
        }}
      </SectionState>
    </Card>
  );
}

/**
 * 29 Gizlilik ve ayarlar — closet visibility, photos (add / remove / 29b delete everything),
 * notification toggles + morning time, the TR / EN language switch (applies at once, is remembered
 * on the device and saved to the profile), sign out and the way to 29c account deletion.
 */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const profile = useMyProfile();
  const setVisibility = useSetVisibility();
  const [deletePhotos, setDeletePhotos] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const language = currentLanguage();

  const switchLanguage = (next: AppLanguage) => {
    if (next === language) return;
    // Applies at once and is remembered on this device; `LanguageSyncHost` writes it to the profile (queued).
    void setAppLanguage(next);
  };

  return (
    <Screen bottom>
      <ScreenHeader title={t('screens.settings')} leading="back" />
      <OfflineBanner />
      <ScrollView contentContainerClassName="gap-3 px-gutter pb-10">
        <Text variant="eyebrow" className="pt-2">
          {t('settings.visibilityEyebrow')}
        </Text>
        <Card>
          <SectionState query={profile} inset={false} skeleton={<Skeleton className="m-4 h-28 rounded-image" />}>
            {(data) => (
              <View accessibilityRole="radiogroup" accessibilityLabel={t('settings.visibilityLabel')}>
                {CLOSET_VISIBILITIES.map((v, index) => (
                  <RadioRow
                    key={v}
                    first={index === 0}
                    label={t(`settings.visibility.${v}`)}
                    selected={data.closetVisibility === v}
                    onPress={() => {
                      if (data.closetVisibility !== v) setVisibility(v, data.baseVersion);
                    }}
                  />
                ))}
              </View>
            )}
          </SectionState>
        </Card>

        <Text variant="eyebrow" className="pt-4">
          {t('settings.photosEyebrow')}
        </Text>
        <PhotosSection onDeleteAll={() => setDeletePhotos(true)} />

        <Text variant="eyebrow" className="pt-4">
          {t('settings.notificationsEyebrow')}
        </Text>
        <NotificationsSection />

        <View className="flex-row flex-wrap items-center justify-between gap-3 pt-4">
          <Text variant="eyebrow">{t('settings.languageEyebrow')}</Text>
          <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup" accessibilityLabel={t('settings.languageLabel')}>
            {SUPPORTED_LANGUAGES.map((l) => (
              <Chip key={l} label={LANGUAGES[l].name} selected={language === l} onPress={() => switchLanguage(l)} />
            ))}
          </View>
        </View>

        <View className="flex-row flex-wrap items-center justify-between gap-2 pt-4">
          <Button
            variant="secondary"
            label={t('settings.logout')}
            loading={signingOut}
            onPress={() => {
              setSigningOut(true);
              void logout().finally(() => setSigningOut(false));
            }}
          />
          <Pressable
            onPress={() => router.push('/delete-account')}
            accessibilityRole="button"
            accessibilityLabel={t('settings.deleteAccount')}
            className="min-h-btn-secondary justify-center px-2 active:opacity-70"
          >
            <Text variant="button" tone="danger">
              {t('settings.deleteAccount')}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <DeletePhotosDialog visible={deletePhotos} onClose={() => setDeletePhotos(false)} />
    </Screen>
  );
}
