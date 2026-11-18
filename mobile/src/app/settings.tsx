import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Ban, Pencil, Plus, Trash2, X } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { logout } from '@/api/auth';
import { CLOSET_VISIBILITIES, type MyPhotos } from '@/api/contracts/account';
import { useEnqueuePhotoUpload } from '@/api/photos';
import { SectionState } from '@/components/blocks/SectionState';
import { ImageTag } from '@/components/ui/Bits';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { photoDeleteLines } from '@/features/account/logic';
import { useDeleteAllPhotos, useRemovePhoto, useSetVisibility } from '@/features/account/mutations';
import { NotificationPrefsCard } from '@/features/account/NotificationPrefsCard';
import { accountKeys, useMyPhotos, useMyProfile, usePalette } from '@/features/account/queries';
import { ChoiceRow, ProfileMenuRow, RowCard } from '@/features/account/rows';
import type { PreparedPhoto } from '@/features/photos/preparePhoto';
import { usePhotoPicker } from '@/features/photos/usePhotoPicker';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { currentLanguage, LANGUAGES, SUPPORTED_LANGUAGES, type AppLanguage } from '@/i18n';
import { setAppLanguage } from '@/i18n/preference';
import { mutationKeys } from '@/sync/queryKeys';

const MAX_BODY_PHOTOS = 3;

type ThumbProps = {
  uri: string | null;
  kind: 'body' | 'face';
  tag: string;
  removeLabel?: string;
  onRemove?: () => void;
};

/** 52 × 66 thumbnail as on 29: the kind tag bottom-left, a 22 pt paper "remove" button top-right (44 pt target). */
function PhotoThumb({ uri, kind, tag, removeLabel, onRemove }: ThumbProps) {
  return (
    <View className="h-[66px] w-[52px]">
      {uri || kind === 'body' ? (
        <ImageSlot
          uri={uri}
          className="h-full w-full rounded-thumb"
          accessibilityLabel={tag}
          placeholder={{ kind: 'figure', tone: 'stage', figureHeight: 44 }}
        />
      ) : (
        <View
          className="h-full w-full items-center justify-center overflow-hidden rounded-thumb bg-sand"
          accessible
          accessibilityRole="image"
          accessibilityLabel={tag}
        >
          <View className="h-[34px] w-[26px] rounded-pill border-[1.5px] border-dashed border-muted" />
        </View>
      )}
      <ImageTag label={tag} className="absolute bottom-1 left-1 px-1 py-0.5" />
      {onRemove && removeLabel ? (
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={removeLabel}
          hitSlop={11}
          className="absolute right-0.5 top-0.5 h-[22px] w-[22px] items-center justify-center rounded-pill bg-paper active:opacity-70"
        >
          <Icon icon={X} size={12} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** FOTOĞRAFLARIM — the user's own photos: remove one, add / replace one, or delete everything (29b). */
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
    <View className="gap-2.5 rounded-card border border-line bg-paper px-3.5 py-3">
      <SectionState
        query={photos}
        inset={false}
        errorText={t('settings.photosError')}
        skeleton={
          <View className="flex-row gap-2">
            <Skeleton className="h-[66px] w-[52px] rounded-thumb" />
            <Skeleton className="h-[66px] w-[52px] rounded-thumb" />
          </View>
        }
      >
        {(data) => (
          <>
            <View className="flex-row items-center gap-2">
              <View className="flex-shrink flex-row flex-wrap gap-2">
                {data.body.map((p) => (
                  <PhotoThumb
                    key={p.photoId}
                    kind="body"
                    uri={p.url}
                    tag={t('settings.bodyTag')}
                    removeLabel={t('settings.removeBody')}
                    onRemove={() => removePhoto('body', p.photoId)}
                  />
                ))}
                {data.face && !queued.some((q) => q.kind === 'face') ? (
                  <PhotoThumb
                    kind="face"
                    uri={data.face.url}
                    tag={t('settings.faceTag')}
                    removeLabel={t('settings.removeFace')}
                    onRemove={() => data.face && removePhoto('face', data.face.photoId)}
                  />
                ) : null}
                {queued.map((q) => (
                  <PhotoThumb
                    key={q.photo.uploadId}
                    kind={q.kind}
                    uri={q.photo.localUri}
                    tag={t(q.kind === 'body' ? 'settings.bodyTag' : 'settings.faceTag')}
                  />
                ))}
                <Pressable
                  onPress={() => setAddOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.addPhoto')}
                  className="h-[66px] w-[52px] items-center justify-center rounded-thumb border-[1.5px] border-dashed border-muted active:opacity-70"
                >
                  <Icon icon={Plus} size={18} />
                </Pressable>
              </View>
              <Text variant="caption" tone="muted" className="min-w-[96px] flex-1 text-[11.5px] leading-4">
                {t('settings.photosNote')}
              </Text>
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
                  size="lg"
                  label={t(data.face ? 'settings.replaceFace' : 'settings.addFace')}
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
      <Pressable
        onPress={onDeleteAll}
        accessibilityRole="button"
        accessibilityLabel={t('settings.deletePhotos')}
        className="min-h-icon-btn flex-row items-center gap-2 active:opacity-70"
      >
        <Icon icon={Trash2} size={17} tone="danger" />
        <Text variant="bodyMedium" tone="danger" className="flex-1">
          {t('settings.deletePhotos')}
        </Text>
      </Pressable>
      {bodyPicker.sheet}
      {facePicker.sheet}
    </View>
  );
}

/**
 * 29b Silme onayı · fotoğraflar — centred alert as drawn: danger mark, what exactly is deleted, that it
 * cannot be undone, what stays; "Kalıcı olarak sil" over "Vazgeç". The scrim cancels.
 */
function DeletePhotosDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const photos = useMyPhotos();
  const palette = usePalette();
  const deleteAll = useDeleteAllPhotos();

  const lines = photoDeleteLines(photos.data, palette.data != null).map((line) =>
    'count' in line ? t(`photoDelete.${line.key}`, { count: line.count }) : t(`photoDelete.${line.key}`),
  );

  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 items-center justify-center px-6">
        <Pressable className="absolute inset-0 bg-scrim" onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.cancel')} />
        <View accessibilityViewIsModal accessibilityRole="alert" className="w-full gap-3.5 rounded-3xl bg-paper p-6 shadow-lg" testID="delete-photos-dialog">
          <View className="h-12 w-12 items-center justify-center rounded-pill bg-danger/10" accessible={false}>
            <Icon icon={Trash2} size={22} tone="danger" />
          </View>
          <Text variant="h2" accessibilityRole="header">
            {t('photoDelete.title')}
          </Text>
          <View className="gap-1.5">
            <Text variant="body" tone="muted">
              {t('photoDelete.listTitle')}
            </Text>
            <View>
              {lines.map((line) => (
                <Text key={line} variant="caption" className="leading-5">
                  {t('photoDelete.bullet', { line })}
                </Text>
              ))}
            </View>
            <Text variant="segment" tone="danger">
              {t('photoDelete.irreversible')}
            </Text>
            <Text variant="caption" tone="muted">
              {t('photoDelete.keeps')}
            </Text>
          </View>
          <View className="mt-1 gap-2">
            <Button
              variant="danger"
              label={t('photoDelete.confirm')}
              onPress={() => {
                deleteAll();
                onClose();
              }}
            />
            <Button variant="secondary" size="lg" label={t('common.cancel')} onPress={onClose} className="border-line" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * 29 Gizlilik ve ayarlar — closet visibility (radios), photos (BOY / YÜZ thumbnails, add / replace /
 * remove, 29b delete everything), notification types (check boxes) + the morning reminder time, the
 * Türkçe / English switch (applies at once, is remembered on the device and saved to the profile),
 * "Çıkış yap" and the way to 29c account deletion. Detail screen: no bottom menu.
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
      <ScrollView contentContainerClassName="gap-2.5 px-gutter pb-10 pt-0.5">
        <Text variant="eyebrow">{t('settings.visibilityEyebrow')}</Text>
        <RowCard>
          <SectionState query={profile} inset={false} skeleton={<Skeleton className="my-3.5 h-28 rounded-image" />}>
            {(data) => (
              <View accessibilityRole="radiogroup" accessibilityLabel={t('settings.visibilityLabel')}>
                {CLOSET_VISIBILITIES.map((v, index) => (
                  <ChoiceRow
                    key={v}
                    kind="radio"
                    first={index === 0}
                    label={t(`settings.visibility.${v}`)}
                    checked={data.closetVisibility === v}
                    onPress={() => {
                      if (data.closetVisibility !== v) setVisibility(v, data.baseVersion);
                    }}
                  />
                ))}
              </View>
            )}
          </SectionState>
        </RowCard>
        <RowCard>
          <ProfileMenuRow first icon={Pencil} label={t('friends.menuEditProfile')} onPress={() => router.push('/edit-profile')} />
          <ProfileMenuRow icon={Ban} label={t('friends.menuBlocked')} onPress={() => router.push('/friends/blocked')} />
        </RowCard>

        <Text variant="eyebrow">{t('settings.photosEyebrow')}</Text>
        <PhotosSection onDeleteAll={() => setDeletePhotos(true)} />

        <Text variant="eyebrow">{t('settings.notificationsEyebrow')}</Text>
        {/* Every notification switch, the morning time and the push permission prompt (main's prefs card). */}
        <NotificationPrefsCard />

        <View className="flex-row flex-wrap items-center justify-between gap-3">
          <Text variant="eyebrow">{t('settings.languageEyebrow')}</Text>
          <View
            className="flex-row gap-[3px] rounded-pill bg-sand p-[3px]"
            accessibilityRole="radiogroup"
            accessibilityLabel={t('settings.languageLabel')}
          >
            {SUPPORTED_LANGUAGES.map((l) => {
              const selected = language === l;
              return (
                <Pressable
                  key={l}
                  onPress={() => switchLanguage(l)}
                  accessibilityRole="radio"
                  accessibilityLabel={LANGUAGES[l].name}
                  accessibilityState={{ checked: selected }}
                  hitSlop={{ top: 4, bottom: 4 }}
                  className={`h-chip items-center justify-center rounded-pill px-[15px] ${selected ? 'bg-paper shadow-sm' : ''}`}
                >
                  <Text variant="chip">{LANGUAGES[l].name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <Pressable
            testID="settings.logout"
            onPress={() => {
              if (signingOut) return;
              setSigningOut(true);
              void logout().finally(() => setSigningOut(false));
            }}
            accessibilityRole="button"
            accessibilityLabel={t('settings.logout')}
            accessibilityState={{ busy: signingOut }}
            className={`min-h-icon-btn justify-center active:opacity-70 ${signingOut ? 'opacity-40' : ''}`}
          >
            <Text variant="body">{t('settings.logout')}</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/delete-account')}
            accessibilityRole="button"
            accessibilityLabel={t('settings.deleteAccount')}
            testID="settings.deleteAccount"
            className="min-h-icon-btn justify-center active:opacity-70"
          >
            <Text variant="body" tone="danger">
              {t('settings.deleteAccount')}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <DeletePhotosDialog visible={deletePhotos} onClose={() => setDeletePhotos(false)} />
    </Screen>
  );
}
