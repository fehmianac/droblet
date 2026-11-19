import { ImageOff } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { requestTryOnImage } from '@/api/wire/tryon';
import { AiImage } from '@/components/ui/AiBadge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';

type Props = {
  /** The try-on image id (`GET v1/tenant/tryon/{id}` gives a fresh presigned URL). */
  tryOnId: string | null;
  url: string | null;
  className?: string;
  accessibilityLabel: string;
  /** The image tag's text when it is not the default "SENİN ÜZERİNDE" (face path). */
  tagLabel?: string;
};

/**
 * The generated "Üzerimde gör" image: skeleton → fade-in (ImageSlot). Its URL is a short-lived presigned GET, so a
 * failed load first asks the server for a fresh URL once (an expired link after a while on the screen, a restored
 * cache); only when that fails too does it show the error with "Tekrar dene".
 */
export function TryOnResultImage({ tryOnId, url, className, accessibilityLabel, tagLabel }: Props) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<string | null>(url);
  const [seenUrl, setSeenUrl] = useState<string | null>(url);
  const [refreshed, setRefreshed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  // A new URL from the job / query (render-time adjustment): start over with it.
  if (url !== seenUrl) {
    setSeenUrl(url);
    setCurrent(url);
    setRefreshed(false);
    setFailed(false);
  }

  const refresh = async () => {
    if (!tryOnId) {
      setFailed(true);
      return;
    }
    setBusy(true);
    try {
      const fresh = await requestTryOnImage(tryOnId);
      setCurrent(fresh.imageUrl);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const onError = () => {
    if (!refreshed) {
      setRefreshed(true);
      void refresh();
    } else {
      setFailed(true);
    }
  };

  if (failed) {
    return (
      <View className={`items-center justify-center gap-3 rounded-image-lg bg-sand px-6 ${className ?? ''}`} testID="tryon.imageFailed" accessibilityLiveRegion="polite">
        <Icon icon={ImageOff} size={28} tone="muted" />
        <Text variant="body" tone="muted" className="text-center">
          {t('tryOn.imageFailed')}
        </Text>
        <Button
          variant="secondary"
          size="md"
          label={t('common.retry')}
          loading={busy}
          onPress={() => {
            setRefreshed(true);
            void refresh();
          }}
          testID="tryon.imageRetry"
        />
      </View>
    );
  }

  return <AiImage kind="onYou" uri={current} className={className} accessibilityLabel={accessibilityLabel} onError={onError} testID="tryon.image" tagLabel={tagLabel} />;
}
