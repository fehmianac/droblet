import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Mail, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { useSession } from '@/auth/session';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';

import { useMyProfile } from './queries';

const dismissedKey = (userId: string) => `droblet.verifyEmailBanner.${userId}`;

/**
 * Whether Bugün shows the "E-postanı doğrula" banner (unverified e-mail sign-up, not hidden on this device), and the
 * × that hides it. One owner (the screen) so the "Profilini tamamla" card can leave out its e-mail row while the
 * banner carries it (canvas "06 Bugün · e-posta doğrula + profilini tamamla").
 */
export function useVerifyEmailBanner(): { visible: boolean; dismiss: () => void } {
  const session = useSession();
  const profile = useMyProfile();
  const userId = session.status === 'signedIn' ? session.user.id : null;
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    if (!userId) return;
    AsyncStorage.getItem(dismissedKey(userId))
      .then((v) => alive && setDismissed(v === '1'))
      .catch(() => alive && setDismissed(false));
    return () => {
      alive = false;
    };
  }, [userId]);

  const dismiss = () => {
    setDismissed(true);
    if (userId) void AsyncStorage.setItem(dismissedKey(userId), '1').catch(() => undefined);
  };
  return { visible: profile.data?.emailVerified === false && dismissed === false, dismiss };
}

/**
 * "E-postanı doğrula" on Bugün while an e-mail sign-up's address is unverified. Never blocks; × hides it on this
 * device (the "Profilini tamamla" item comes back then, until the address is verified).
 */
export function VerifyEmailBanner({ banner, testID = 'verifyEmail.banner' }: { banner: { visible: boolean; dismiss: () => void }; testID?: string }) {
  const { t } = useTranslation();
  if (!banner.visible) return null;
  const { dismiss } = banner;

  return (
    <View className="flex-row items-center gap-3 rounded-card border border-line bg-paper py-2 pl-3.5 pr-1.5" testID={testID}>
      <Pressable
        onPress={() => router.push('/verify-email')}
        accessibilityRole="button"
        accessibilityLabel={`${t('verifyEmail.bannerTitle')}. ${t('verifyEmail.bannerBody')}`}
        className="flex-1 flex-row items-center gap-3 active:opacity-70"
        testID={`${testID}.open`}
      >
        <View className="h-9 w-9 items-center justify-center rounded-pill bg-sand">
          <Icon icon={Mail} size={18} />
        </View>
        <View className="flex-1">
          <Text variant="bodyMedium">{t('verifyEmail.bannerTitle')}</Text>
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {t('verifyEmail.bannerBody')}
          </Text>
        </View>
      </Pressable>
      <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel={t('verifyEmail.bannerHide')} hitSlop={8} className="h-icon-btn w-icon-btn items-center justify-center" testID={`${testID}.hide`}>
        <Icon icon={X} size={16} tone="muted" />
      </Pressable>
    </View>
  );
}
