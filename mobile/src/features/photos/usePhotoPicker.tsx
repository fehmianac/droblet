import * as ImagePicker from 'expo-image-picker';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';

import { preparePhoto, type PreparedPhoto } from './preparePhoto';

type SheetState =
  | { kind: 'none' }
  | { kind: 'cameraRationale'; onAllow: () => void }
  | { kind: 'cameraDenied'; fallback: () => void }
  | { kind: 'libraryDenied'; fallback: () => void };

type Options = {
  onPicked: (photos: PreparedPhoto[]) => void;
  onError: () => void;
};

/**
 * Camera / library picking with our own rationale before the system dialog and a clear next step
 * when denied ("Ayarlar'a git" + the other source). The system photo picker (PHPicker / Android
 * Photo Picker) needs no library permission; if the platform still reports a denial we explain it.
 */
export function usePhotoPicker({ onPicked, onError }: Options): {
  takePhoto: () => void;
  chooseFromLibrary: (limit: number) => void;
  sheet: ReactNode;
} {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<SheetState>({ kind: 'none' });
  const close = () => setSheet({ kind: 'none' });

  const handleResult = async (result: ImagePicker.ImagePickerResult) => {
    if (result.canceled) return;
    try {
      const prepared = await Promise.all(result.assets.map((a) => preparePhoto(a.uri, a.width, a.height)));
      onPicked(prepared);
    } catch {
      onError();
    }
  };

  const chooseFromLibrary = (limit: number) => {
    void (async () => {
      try {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: limit > 1,
          selectionLimit: limit,
          exif: false,
          quality: 1,
        });
        await handleResult(result);
      } catch {
        const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
        if (!perm.granted) setSheet({ kind: 'libraryDenied', fallback: takePhoto });
        else onError();
      }
    })();
  };

  const launchCamera = async () => {
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], exif: false, quality: 1 });
    await handleResult(result);
  };

  function takePhoto() {
    void (async () => {
      const perm = await ImagePicker.getCameraPermissionsAsync();
      if (perm.granted) {
        await launchCamera();
        return;
      }
      if (perm.canAskAgain) {
        setSheet({
          kind: 'cameraRationale',
          onAllow: () => {
            close();
            void ImagePicker.requestCameraPermissionsAsync().then(async (res) => {
              if (res.granted) await launchCamera();
              else setSheet({ kind: 'cameraDenied', fallback: () => chooseFromLibrary(1) });
            });
          },
        });
        return;
      }
      setSheet({ kind: 'cameraDenied', fallback: () => chooseFromLibrary(1) });
    })();
  }

  let content: ReactNode = null;
  if (sheet.kind === 'cameraRationale') {
    content = (
      <>
        <Text variant="body" tone="muted">
          {t('permission.cameraBody')}
        </Text>
        <View className="mt-6 gap-2">
          <Button label={t('permission.allow')} onPress={sheet.onAllow} />
          <Button variant="text" label={t('permission.notNow')} onPress={close} />
        </View>
      </>
    );
  } else if (sheet.kind === 'cameraDenied' || sheet.kind === 'libraryDenied') {
    const fallback = sheet.fallback;
    content = (
      <>
        <Text variant="body" tone="muted">
          {t(sheet.kind === 'cameraDenied' ? 'permission.cameraDeniedBody' : 'permission.photosDeniedBody')}
        </Text>
        <View className="mt-6 gap-2">
          <Button
            label={t('common.openSettings')}
            onPress={() => {
              close();
              void Linking.openSettings();
            }}
          />
          <Button
            variant="secondary"
            label={t(sheet.kind === 'cameraDenied' ? 'permission.useGallery' : 'permission.useCamera')}
            onPress={() => {
              close();
              fallback();
            }}
          />
        </View>
      </>
    );
  }

  const title =
    sheet.kind === 'cameraRationale'
      ? t('permission.cameraTitle')
      : sheet.kind === 'cameraDenied'
        ? t('permission.cameraDeniedTitle')
        : sheet.kind === 'libraryDenied'
          ? t('permission.photosDeniedTitle')
          : undefined;

  return {
    takePhoto,
    chooseFromLibrary,
    sheet: (
      <BottomSheet visible={sheet.kind !== 'none'} onClose={close} title={title}>
        {content}
      </BottomSheet>
    ),
  };
}
