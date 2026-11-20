import { router, useFocusEffect } from 'expo-router';
import { ClipboardPaste, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, AppState, Platform, Pressable, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { showToast } from '@/components/ui/toast/store';
import { useThemeColors } from '@/theme/useThemeColors';

import { clipboardCardDismissal, clipboardHasImage, readClipboardPhoto } from './clipboardPhoto';
import { outfitPhotoParams } from './OutfitPhotoPicker';

/**
 * Whether the clipboard holds an image — checked when the screen gets focus and when the app comes back to the
 * foreground. Only the yes / no is asked (no read, no iOS paste banner).
 */
export function useClipboardHasImage(): boolean {
  // A fresh object per check, so the card re-renders (and re-reads its dismissal) after every check.
  const [state, setState] = useState({ yes: false });
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') return undefined;
      let alive = true;
      const check = () => void clipboardHasImage().then((yes) => alive && setState({ yes }));
      check();
      const sub = AppState.addEventListener('change', (next) => {
        if (next === 'background') clipboardCardDismissal.reset();
        if (next === 'active') check();
      });
      return () => {
        alive = false;
        sub.remove();
      };
    }, []),
  );
  return state.yes;
}

/**
 * 16c+ "Kopyaladığın fotoğrafı üzerimde dene" — on the ✦ hub when the clipboard holds an image. The image is read only
 * on a tap, then 16d opens with it (the explainer the first time, else the credit confirmation over the photo). "×"
 * hides it until the app comes back from the background.
 */
export function ClipboardPhotoCard() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const hasImage = useClipboardHasImage();
  const [, setDismissedAt] = useState(0);
  const [reading, setReading] = useState(false);

  if (!hasImage || clipboardCardDismissal.isDismissed()) return null;

  const open = () => {
    setReading(true);
    void readClipboardPhoto()
      .then((photo) => {
        if (photo) router.push({ pathname: '/tryon/photo', params: outfitPhotoParams(photo) });
        else showToast({ message: t('clipboardPhoto.failed'), tone: 'error' });
      })
      .catch(() => showToast({ message: t('clipboardPhoto.failed'), tone: 'error' }))
      .finally(() => setReading(false));
  };

  return (
    <View className="flex-row items-center gap-3 rounded-[18px] bg-sand py-2 pl-3 pr-1.5" testID="stylist.clipboardPhoto">
      <Pressable
        onPress={open}
        disabled={reading}
        accessibilityRole="button"
        accessibilityLabel={t('clipboardPhoto.title')}
        accessibilityHint={t('clipboardPhoto.body')}
        accessibilityState={{ busy: reading }}
        testID="stylist.clipboardPhoto.open"
        className="min-h-12 min-w-0 flex-1 flex-row items-center gap-3 active:opacity-80"
      >
        <View className="h-10 w-10 items-center justify-center rounded-pill bg-paper">
          {reading ? <ActivityIndicator size="small" color={colors.ink} /> : <Icon icon={ClipboardPaste} size={19} />}
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text variant="bodyMedium" className="text-[14px] leading-[18px]">
            {t('clipboardPhoto.title')}
          </Text>
          <Text variant="caption" tone="muted" className="text-[12px]">
            {t('clipboardPhoto.body')}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={() => {
          clipboardCardDismissal.dismiss();
          setDismissedAt(Date.now());
        }}
        accessibilityRole="button"
        accessibilityLabel={t('clipboardPhoto.dismiss')}
        hitSlop={4}
        testID="stylist.clipboardPhoto.dismiss"
        className="h-icon-btn w-icon-btn items-center justify-center rounded-pill active:opacity-70"
      >
        <Icon icon={X} size={16} />
      </Pressable>
    </View>
  );
}
