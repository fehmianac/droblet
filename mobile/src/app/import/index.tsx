import { Redirect, router } from 'expo-router';
import { Image as ImageIcon, Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { isRecognitionLimitReached, openRecognitionPaywall } from '@/features/wardrobe/recognition';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { useImportLimits, useOpenImports, useStartImport } from '@/features/outfitImport/api';
import { ImportNotice, ImportPhotoCollage, QuotaExhausted } from '@/features/outfitImport/parts';
import { IMPORT_MAX_EDGE } from '@/features/outfitImport/logic';
import type { PreparedPhoto } from '@/features/photos/preparePhoto';
import { usePhotoPicker } from '@/features/photos/usePhotoPicker';
import { useIsOnline } from '@/sync/network';

type Notice = { kind: 'none' } | { kind: 'startFailed' | 'photoFailed' | 'offline' };

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View className="flex-row items-start gap-3">
      <View className="h-[26px] w-[26px] items-center justify-center rounded-pill border border-ink">
        <Text variant="label">{n}</Text>
      </View>
      <Text variant="body" className="flex-1">
        {text}
      </Text>
    </View>
  );
}

/**
 * 31 Kombinlerini içe aktar — what happens, the plan's photo limit and (non-members) the recognitions left, then the
 * gallery picker (at most min(limit, left) photos). An import already running opens instead (31b / 31c). After the
 * pick the session is created and the uploads continue in the background (31b).
 */
export default function ImportIntroScreen() {
  const { t } = useTranslation();
  const online = useIsOnline();
  const open = useOpenImports();
  const limits = useImportLimits();
  const start = useStartImport();
  const [notice, setNotice] = useState<Notice>({ kind: 'none' });
  const [picked, setPicked] = useState<PreparedPhoto[]>([]);
  const [exhausted, setExhausted] = useState(false);

  const begin = (photos: PreparedPhoto[]) => {
    setPicked(photos);
    setNotice({ kind: 'none' });
    const over = limits.limit > 0 && photos.length > limits.limit ? photos.length - limits.limit : 0;
    const take = over > 0 ? photos.slice(0, limits.limit) : photos;
    start
      .mutateAsync(take.map((p) => p.localUri))
      .then((created) =>
        router.replace({
          pathname: '/import/[id]',
          params: { id: created.session.id, over: String(over), skipped: String(created.skipped), max: String(created.maxPhotos) },
        }),
      )
      .catch((error: unknown) => {
        if (isRecognitionLimitReached(error)) {
          setExhausted(true);
          void limits.refetch();
          return;
        }
        setNotice({ kind: 'startFailed' });
      });
  };
  const picker = usePhotoPicker({ onPicked: begin, onError: () => setNotice({ kind: 'photoFailed' }), maxEdge: IMPORT_MAX_EDGE });

  // An import that is still open is resumed (the rule of 14: re-entering opens the running session).
  const running = open.data?.[0];
  if (running) return <Redirect href={{ pathname: '/import/[id]', params: { id: running.id } }} />;

  const pick = () => {
    if (!online) {
      setNotice({ kind: 'offline' });
      return;
    }
    if (limits.limit <= 0) return;
    picker.chooseFromLibrary(limits.limit);
  };

  if (exhausted || (limits.remaining !== null && limits.remaining <= 0)) {
    return (
      <Screen>
        <ScreenHeader title={t('outfitImport.title')} leading="back" />
        <QuotaExhausted max={limits.maxPhotos} />
      </Screen>
    );
  }

  const max = limits.maxPhotos;
  const free = limits.remaining !== null;
  return (
    <Screen>
      <ScreenHeader title={t('outfitImport.title')} leading="back" />
      <ScrollView className="flex-1" contentContainerClassName="gap-[18px] px-gutter pb-6 pt-1.5">
        <ImportPhotoCollage />
        <View className="gap-1.5">
          <Text variant="eyebrow">{t('outfitImport.intro.eyebrow')}</Text>
          <Text variant="display" className="text-[30px] leading-[33px]" accessibilityRole="header">
            {t('outfitImport.intro.heading')}
          </Text>
        </View>
        <View className="gap-3">
          <Step n={1} text={max ? t('outfitImport.intro.step1', { max }) : t('outfitImport.intro.step1NoMax')} />
          <Step n={2} text={t('outfitImport.intro.step2')} />
          <Step n={3} text={t('outfitImport.intro.step3')} />
        </View>
        {free && limits.remaining !== null ? (
          <View className="flex-row items-start gap-2.5 rounded-card bg-sand p-3.5" accessibilityRole="text" testID="import.quota">
            <Icon icon={Sparkles} size={18} />
            <View className="flex-1 gap-1.5">
              <Text variant="body">
                <Text variant="bodyMedium">{t('outfitImport.intro.quota', { count: limits.remaining })}</Text> {t('outfitImport.intro.quotaBody')}
              </Text>
              <Pressable onPress={openRecognitionPaywall} accessibilityRole="link" hitSlop={10}>
                <Text variant="caption" className="underline">
                  {t('outfitImport.intro.quotaLink')}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        <Text variant="caption" tone="muted">
          {t('outfitImport.intro.privacy')}
        </Text>
        {notice.kind !== 'none' ? (
          <ImportNotice text={t(`outfitImport.states.${notice.kind === 'offline' ? 'offline' : notice.kind}`)} onRetry={notice.kind === 'startFailed' && picked.length > 0 ? () => begin(picked) : undefined} />
        ) : null}
      </ScrollView>
      <BottomActionBar actionFill>
        <View className="flex-1 gap-1">
          <Button
            label={t('outfitImport.intro.pick')}
            icon={ImageIcon}
            onPress={pick}
            loading={start.isPending}
            loadingLabel={t('outfitImport.intro.preparing')}
            disabled={limits.isLoading || limits.limit <= 0}
            testID="import.pick"
          />
          {limits.limit > 0 ? (
            <Text variant="caption" tone="muted" className="text-center">
              {t(free ? 'outfitImport.intro.pickLimitFree' : 'outfitImport.intro.pickLimit', { count: limits.limit })}
            </Text>
          ) : null}
        </View>
      </BottomActionBar>
      {picker.sheet}
    </Screen>
  );
}
