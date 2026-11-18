import { router } from 'expo-router';
import { CircleAlert, Images, LayoutGrid, Layers, Shirt, X, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AiDropPulse } from '@/components/ui/ai';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import type { PreparedPhoto } from '@/features/photos/preparePhoto';
import { usePhotoPicker } from '@/features/photos/usePhotoPicker';
import { useStartItemDrafts } from '@/features/wardrobe/mutations';
import { isRecognitionLimitReached, openRecognitionPaywall, useItemRecognition } from '@/features/wardrobe/recognition';
import { useIsOnline } from '@/sync/network';
import { placeholderTones } from '@/theme/tokens';

type Notice = 'none' | 'offline' | 'photoFailed' | 'startFailed' | 'recognitionLimit';

function Shortcut({ icon, label, a11y, onPress, disabled }: { icon: LucideIcon; label: string; a11y: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      className={`min-h-icon-btn w-24 items-center gap-1.5 active:opacity-70 ${disabled ? 'opacity-40' : ''}`}
    >
      <View className="h-btn-primary w-btn-primary items-center justify-center rounded-image border border-cream/35">
        <Icon icon={icon} tone="cream" />
      </View>
      <Text variant="caption" tone="paper" className="text-center" numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * 12 Parça ekle — camera-first, on the dark ground of the board. The shutter opens the system camera
 * (permission rationale + denial handling live in `usePhotoPicker`); the photo is downscaled and
 * stripped of EXIF on the device, then sent for AI processing and the user lands on 12c to review
 * the draft. Shortcuts: gallery, ready-made library, bulk add.
 */
export default function ItemAddScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const startDrafts = useStartItemDrafts();
  const [notice, setNotice] = useState<Notice>('none');
  const [busy, setBusy] = useState(false);
  const recognition = useItemRecognition();

  // Free AI recognition used up: the paywall opens; this screen stays underneath with "Elle gir".
  const limitReached = () => {
    setNotice('recognitionLimit');
    void recognition.refresh();
    openRecognitionPaywall();
  };
  const enterManually = () => router.push('/item/form');

  const onPicked = (photos: PreparedPhoto[]) => {
    const photo = photos[0];
    if (!photo) return;
    setBusy(true);
    setNotice('none');
    startDrafts
      .start([photo.localUri])
      .then((res) => {
        const draftId = res.draftIds[0];
        if (draftId) router.replace({ pathname: '/item/form', params: { draftId } });
        else setNotice('startFailed');
      })
      .catch((error: unknown) => (isRecognitionLimitReached(error) ? limitReached() : setNotice('startFailed')))
      .finally(() => setBusy(false));
  };

  const picker = usePhotoPicker({ onPicked, onError: () => setNotice('photoFailed') });

  // AI processing needs a connection: say so instead of queueing a photo that cannot be analysed.
  const guarded = (action: () => void) => () => {
    if (!online) {
      setNotice('offline');
      return;
    }
    if (recognition.exhausted) {
      limitReached();
      return;
    }
    setNotice('none');
    action();
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/wardrobe'));

  return (
    <View className="flex-1 bg-ink" style={{ paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }}>
      <View className="h-12 flex-row items-center justify-between px-gutter">
        <Pressable
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.close')}
          className="h-icon-btn w-icon-btn items-center justify-center rounded-pill border border-cream/30 active:opacity-70"
        >
          <Icon icon={X} tone="cream" size={20} />
        </Pressable>
        <Text variant="bodyMedium" tone="paper" className="flex-1 text-center text-[15px]" numberOfLines={1} accessibilityRole="header">
          {t('itemAdd.title')}
        </Text>
        <Pressable
          onPress={() => router.push('/item/bulk')}
          accessibilityRole="button"
          accessibilityLabel={t('itemAdd.bulkA11y')}
          className="h-icon-btn flex-row items-center gap-1.5 rounded-pill border border-cream/45 px-3.5 active:opacity-70"
        >
          <Icon icon={Layers} tone="cream" size={16} />
          <Text variant="bodyMedium" tone="paper" numberOfLines={1}>
            {t('itemAdd.bulk')}
          </Text>
        </Pressable>
      </View>

      <View className="flex-1 items-center justify-center px-gutter">
        <View
          className="aspect-[29/37] w-full max-w-[290px] items-center justify-center rounded-[24px]"
          style={{ backgroundColor: placeholderTones.dark }}
          accessible={false}
        >
          <View className="opacity-50">
            <Icon icon={Shirt} tone="cream" size={150} />
          </View>
          <View className="absolute -left-0.5 -top-0.5 h-7 w-7 rounded-tl-[12px] border-l-[3px] border-t-[3px] border-cream" />
          <View className="absolute -right-0.5 -top-0.5 h-7 w-7 rounded-tr-[12px] border-r-[3px] border-t-[3px] border-cream" />
          <View className="absolute -bottom-0.5 -left-0.5 h-7 w-7 rounded-bl-[12px] border-b-[3px] border-l-[3px] border-cream" />
          <View className="absolute -bottom-0.5 -right-0.5 h-7 w-7 rounded-br-[12px] border-b-[3px] border-r-[3px] border-cream" />
          {busy ? (
            <View
              className="absolute -bottom-[18px] flex-row items-center gap-2 rounded-[18px] bg-cream px-3.5 py-2"
              accessible
              accessibilityLiveRegion="polite"
              accessibilityLabel={t('itemAdd.sending')}
            >
              <AiDropPulse height={18} />
              <Text variant="bodyMedium" className="text-[12.5px]" numberOfLines={1}>
                {t('itemAdd.sending')}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <View className="min-h-12 items-center justify-center gap-2 px-gutter pb-4 pt-6">
        {notice === 'none' ? (
          <Text variant="body" tone="paper" className="text-center text-[13px]">
            {t('itemAdd.hint')}
          </Text>
        ) : (
          <View className="flex-row items-start gap-2 rounded-image-lg bg-cream px-3 py-2.5" accessibilityLiveRegion="polite" accessibilityRole="alert">
            <Icon icon={CircleAlert} size={16} tone="danger" />
            <Text variant="caption" className="flex-1">
              {t(`itemAdd.${notice}`)}
            </Text>
          </View>
        )}
        {/* Always there: a piece can be saved without AI (12c with empty fields). */}
        <Pressable
          onPress={enterManually}
          accessibilityRole="button"
          accessibilityLabel={t('itemAdd.manualA11y')}
          className="min-h-icon-btn items-center justify-center rounded-pill border border-cream/45 px-4 active:opacity-70"
          testID="item-add-manual"
        >
          <Text variant="bodyMedium" tone="paper">
            {t('itemAdd.manual')}
          </Text>
        </Pressable>
      </View>

      <View className="flex-row items-start justify-around px-4 pb-4">
        <Shortcut icon={Images} label={t('itemAdd.gallery')} a11y={t('itemAdd.galleryA11y')} onPress={guarded(() => picker.chooseFromLibrary(1))} disabled={busy} />
        <Pressable
          onPress={guarded(picker.takePhoto)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('itemAdd.shutter')}
          accessibilityState={{ disabled: busy, busy }}
          className={`h-[78px] w-[78px] rounded-pill border-4 border-cream p-[5px] active:opacity-80 ${busy ? 'opacity-40' : ''}`}
          testID="item-add-shutter"
        >
          <View className="flex-1 rounded-pill bg-cream" />
        </Pressable>
        <Shortcut icon={LayoutGrid} label={t('itemAdd.library')} a11y={t('itemAdd.libraryA11y')} onPress={() => router.push('/item/library')} />
      </View>
      {picker.sheet}
    </View>
  );
}
