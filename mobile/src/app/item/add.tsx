import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { router, useIsFocused } from 'expo-router';
import { CircleAlert, Copy, Image as ImageIcon, LayoutGrid, Sparkles, X, type LucideIcon } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AiDropPulse } from '@/components/ui/ai';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { cameraStateOf } from '@/features/photos/cameraState';
import { deleteLocalPhoto, preparePhoto, type PreparedPhoto } from '@/features/photos/preparePhoto';
import { usePhotoPicker } from '@/features/photos/usePhotoPicker';
import { GarmentGlyph } from '@/features/wardrobe/ItemThumb';
import { useStartItemDrafts } from '@/features/wardrobe/mutations';
import { useItemDrafts } from '@/features/wardrobe/queries';
import { isRecognitionLimitReached, openRecognitionPaywall, useItemRecognition } from '@/features/wardrobe/recognition';
import { useManualEntry } from '@/features/wardrobe/useManualEntry';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useIsOnline } from '@/sync/network';
import { placeholderTones, surfaceTones } from '@/theme/tokens';

type Notice = 'none' | 'offline' | 'photoFailed' | 'startFailed' | 'recognitionLimit';

/** How long "Gömlek algılandı · Beyaz · Pamuk" stays before the review form opens. */
const DETECTED_MS = 1400;
/** A slower recognition is not waited for here: the form (12c) has its own loading state. */
const RECOGNITION_WAIT_MS = 6000;

function Shortcut({ icon, label, a11y, onPress, disabled, testID }: { icon: LucideIcon; label: string; a11y: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      testID={testID}
      className={`min-h-icon-btn w-20 items-center gap-1.5 active:opacity-70 ${disabled ? 'opacity-40' : ''}`}
    >
      <View className="h-btn-primary w-btn-primary items-center justify-center rounded-image border border-cream/35">
        <Icon icon={icon} tone="cream" size={22} />
      </View>
      <Text variant="caption" tone="cream" className="text-center text-[11.5px] opacity-90" numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Cream pill button inside the frame (permission states). */
function FrameAction({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      className="h-btn-secondary items-center justify-center rounded-pill bg-cream px-5 active:opacity-80"
    >
      <Text variant="button" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * 12 Parça ekle — the live camera on the dark ground of the board: the framed viewfinder with its four
 * corners, the shutter, and the shortcuts to the gallery, the ready-made library and bulk add. A shot is
 * downscaled and stripped of EXIF on the device, sent for AI recognition, and the pill under the frame
 * says what was found ("Gömlek algılandı · Beyaz · Pamuk") before the review form (12c) opens.
 *
 * Camera permission: asked from the frame with our reason first; when denied the frame explains and links
 * to Settings while gallery / library / "Elle gir" keep working. Without a camera (simulator, web) the
 * shutter opens the system picker. When the free recognition quota is used up (402) the paywall opens and
 * the photo that was taken travels into the manual form.
 */
export default function ItemAddScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const focused = useIsFocused();
  const reduceMotion = useReduceMotion();
  const startDrafts = useStartItemDrafts();
  const recognition = useItemRecognition();

  const [permission, requestPermission] = useCameraPermissions();
  const [unavailable, setUnavailable] = useState(Platform.OS === 'web');
  const camera = useRef<CameraView>(null);
  const cameraState = cameraStateOf(permission, unavailable);

  const [notice, setNotice] = useState<Notice>('none');
  const [phase, setPhase] = useState<'idle' | 'capturing' | 'sending'>('idle');
  /** The last shot (or gallery pick): shown in the frame, and carried into the manual form if AI is not available. */
  const [captured, setCaptured] = useState<PreparedPhoto | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);

  const drafts = useItemDrafts({ enabled: draftId !== null && focused });
  const draft = draftId ? drafts.data?.find((d) => d.id === draftId) : undefined;
  const detected = draft?.status === 'ready';
  const failed = draft?.status === 'failed';
  const busy = phase !== 'idle' || draftId !== null;

  // Recognised → show the pill for a moment, then the review form. Failed or slow → the form takes over.
  useEffect(() => {
    if (!draftId) return;
    const open = () => router.replace({ pathname: '/item/form', params: { draftId } });
    if (failed) {
      open();
      return;
    }
    const timer = setTimeout(open, detected ? DETECTED_MS : RECOGNITION_WAIT_MS);
    return () => clearTimeout(timer);
  }, [draftId, detected, failed]);

  // Free AI recognition used up: the paywall opens; this screen stays underneath with "Elle gir".
  const limitReached = () => {
    setNotice('recognitionLimit');
    void recognition.refresh();
    openRecognitionPaywall();
  };
  // "Elle gir" — always there: a piece can be saved without AI (12c with empty fields). A photo refused by the
  // recognition allowance is already a manual draft; otherwise the shot in the frame travels with it.
  const manual = useManualEntry({ onError: () => setNotice('photoFailed') });
  const enterManually = () => manual.enter(captured && !draftId ? captured.localUri : null);

  const send = (photo: PreparedPhoto) => {
    setCaptured(photo);
    if (recognition.exhausted) {
      setPhase('idle');
      limitReached();
      return;
    }
    setPhase('sending');
    setNotice('none');
    startDrafts
      .start([photo.localUri])
      .then((res) => {
        const id = res.draftIds[0];
        if (id) setDraftId(id);
        else setNotice('startFailed');
      })
      .catch((error: unknown) => {
        manual.adopt(error);
        if (isRecognitionLimitReached(error)) limitReached();
        else setNotice('startFailed');
      })
      .finally(() => setPhase('idle'));
  };

  const picker = usePhotoPicker({
    onPicked: (photos) => {
      const photo = photos[0];
      if (photo) send(photo);
    },
    onError: () => setNotice('photoFailed'),
  });

  const retake = () => {
    if (captured) {
      try {
        deleteLocalPhoto(captured.localUri);
      } catch {
        // The file is already gone: nothing to clean up.
      }
    }
    setCaptured(null);
    setNotice('none');
  };

  const capture = async () => {
    setPhase('capturing');
    setNotice('none');
    try {
      const picture = await camera.current?.takePictureAsync({ quality: 1, exif: false });
      if (!picture) throw new Error('camera not ready');
      send(await preparePhoto(picture.uri, picture.width, picture.height));
    } catch {
      // No usable camera after all (simulator): from now on the shutter opens the system picker.
      setUnavailable(true);
      setPhase('idle');
      setNotice('photoFailed');
    }
  };

  // AI processing needs a connection: say so instead of taking a photo that cannot be analysed.
  const blocked = () => {
    if (busy) return true;
    if (!online) {
      setNotice('offline');
      return true;
    }
    return false;
  };

  const onShutter = () => {
    if (blocked()) return;
    // A shot that could not be sent is still in the frame: the first press goes back to the viewfinder.
    if (captured) retake();
    else if (cameraState === 'live') void capture();
    else if (cameraState === 'ask') void requestPermission();
    // Denied / no camera / still checking: the system picker (it explains a denial and offers the gallery).
    else picker.takePhoto();
  };

  const onGallery = () => {
    if (!blocked()) picker.chooseFromLibrary(1);
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/wardrobe'));

  const suggestion = draft?.suggestion;
  const detectedLine = detected
    ? [
        t('itemAdd.detected', { type: suggestion?.subcategory?.trim() || (suggestion?.category ? t(`itemCategory.${suggestion.category}`) : t('itemAdd.detectedPiece')) }),
        suggestion?.color ? t(`itemColor.${suggestion.color}`) : null,
        suggestion?.fabric?.trim() || null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  const pill = detectedLine ?? (draftId ? t('itemAdd.recognising') : phase === 'sending' ? t('itemAdd.sending') : null);

  let frame;
  if (captured) {
    frame = <Image source={{ uri: captured.localUri }} contentFit="cover" style={StyleSheet.absoluteFill} accessibilityLabel={t('itemAdd.capturedA11y')} />;
  } else if (cameraState === 'live' && focused) {
    frame = (
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="back"
        mode="picture"
        animateShutter={!reduceMotion}
        onMountError={() => setUnavailable(true)}
        testID="item-add-camera"
      />
    );
  } else if (cameraState === 'ask' || cameraState === 'denied') {
    frame = (
      <View className="items-center gap-4 px-6" accessibilityLiveRegion="polite">
        <GarmentGlyph category="top" size={64} tone="cream" />
        <Text variant="body" tone="cream" className="text-center">
          {t(cameraState === 'ask' ? 'itemAdd.cameraAskBody' : 'itemAdd.cameraDeniedBody')}
        </Text>
        {cameraState === 'ask' ? (
          <FrameAction label={t('itemAdd.cameraAllow')} onPress={() => void requestPermission()} testID="item-add-allow-camera" />
        ) : (
          <FrameAction label={t('common.openSettings')} onPress={() => void Linking.openSettings()} testID="item-add-open-settings" />
        )}
      </View>
    );
  } else {
    frame = <GarmentGlyph category="top" size={150} tone="cream" />;
  }

  return (
    <View className="flex-1" style={{ backgroundColor: surfaceTones.camera, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }}>
      <View className="h-12 flex-row items-center justify-between px-gutter">
        <Pressable
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.close')}
          className="h-icon-btn w-icon-btn items-center justify-center rounded-pill border border-cream/30 active:opacity-70"
        >
          <Icon icon={X} tone="cream" size={20} />
        </Pressable>
        <View className="absolute left-[70px] right-[70px] items-center" pointerEvents="none">
          <Text variant="title" tone="cream" numberOfLines={1} accessibilityRole="header">
            {t('itemAdd.title')}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/item/bulk')}
          accessibilityRole="button"
          accessibilityLabel={t('itemAdd.bulkA11y')}
          className="h-icon-btn flex-row items-center gap-1.5 rounded-pill border border-cream/45 px-[15px] active:opacity-70"
          testID="item-add-bulk"
        >
          <Icon icon={Copy} tone="cream" size={16} />
          <Text variant="chip" tone="cream" numberOfLines={1}>
            {t('itemAdd.bulk')}
          </Text>
        </Pressable>
      </View>

      <View className="flex-1 items-center justify-center px-gutter">
        {/* The viewfinder: 290 × 370, radius 24, four 28 pt corners 2 outside it, the pill 18 below its edge. */}
        <View className="aspect-[29/37] w-full max-w-[290px]">
          <View
            className="flex-1 items-center justify-center overflow-hidden rounded-[24px]"
            style={{ backgroundColor: placeholderTones.dark }}
            testID={`item-add-frame-${captured ? 'photo' : cameraState}`}
          >
            {frame}
          </View>
          <View pointerEvents="none" className="absolute -left-0.5 -top-0.5 h-7 w-7 rounded-tl-[12px] border-l-[3px] border-t-[3px] border-cream" />
          <View pointerEvents="none" className="absolute -right-0.5 -top-0.5 h-7 w-7 rounded-tr-[12px] border-r-[3px] border-t-[3px] border-cream" />
          <View pointerEvents="none" className="absolute -bottom-0.5 -left-0.5 h-7 w-7 rounded-bl-[12px] border-b-[3px] border-l-[3px] border-cream" />
          <View pointerEvents="none" className="absolute -bottom-0.5 -right-0.5 h-7 w-7 rounded-br-[12px] border-b-[3px] border-r-[3px] border-cream" />
          {pill ? (
            <View className="absolute -bottom-[18px] left-0 right-0 items-center">
              <View
                className="max-w-full flex-row items-center gap-1.5 rounded-[18px] bg-cream px-3.5 py-2"
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel={pill}
                testID="item-add-pill"
              >
                {detectedLine ? <Icon icon={Sparkles} size={14} /> : <AiDropPulse height={16} />}
                <Text variant="bodyMedium" className="shrink text-[12.5px]" numberOfLines={1}>
                  {pill}
                </Text>
              </View>
            </View>
          ) : captured && !busy ? (
            <View className="absolute -bottom-[18px] left-0 right-0 items-center">
              <Pressable
                onPress={retake}
                accessibilityRole="button"
                accessibilityLabel={t('itemAdd.retake')}
                hitSlop={6}
                className="h-9 items-center justify-center rounded-[18px] bg-cream px-3.5 active:opacity-80"
                testID="item-add-retake"
              >
                <Text variant="bodyMedium" className="text-[12.5px]" numberOfLines={1}>
                  {t('itemAdd.retake')}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>

      <View className="min-h-12 items-center justify-center gap-2 px-gutter pb-[18px] pt-7">
        {notice === 'none' ? (
          <Text variant="body" tone="cream" className="text-center text-[13px] opacity-90">
            {t('itemAdd.hint')}
          </Text>
        ) : (
          <View className="flex-row items-start gap-2 rounded-image-lg bg-cream px-3 py-2.5" accessibilityLiveRegion="polite" accessibilityRole="alert">
            <Icon icon={CircleAlert} size={16} tone="danger" />
            <Text variant="caption" className="flex-1">
              {t(`itemAdd.${notice === 'recognitionLimit' && captured ? 'recognitionLimitPhoto' : notice}`)}
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
          <Text variant="chip" tone="cream">
            {t('itemAdd.manual')}
          </Text>
        </Pressable>
      </View>

      <View className="flex-row items-start justify-around px-[18px] pb-6">
        <Shortcut
          icon={ImageIcon}
          label={t('itemAdd.gallery')}
          a11y={t('itemAdd.galleryA11y')}
          onPress={onGallery}
          disabled={busy}
          testID="item-add-gallery"
        />
        <Pressable
          onPress={onShutter}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t(captured && !busy ? 'itemAdd.retake' : 'itemAdd.shutter')}
          accessibilityState={{ disabled: busy, busy }}
          className={`h-[78px] w-[78px] rounded-pill border-4 border-cream p-[5px] active:opacity-80 ${busy ? 'opacity-40' : ''}`}
          testID="item-add-shutter"
        >
          <View className="flex-1 rounded-pill bg-cream" />
        </Pressable>
        <Shortcut icon={LayoutGrid} label={t('itemAdd.library')} a11y={t('itemAdd.libraryA11y')} onPress={() => router.push('/item/library')} testID="item-add-library" />
      </View>
      {picker.sheet}
      {manual.sheet}
    </View>
  );
}
