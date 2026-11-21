import { BellOff, Cake, Camera, ChevronLeft, Mail, ShieldCheck, Sprout, X, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';

/** The 48-high header of 02h–02j: back (or close) at the left, the eyebrow centred. */
export function EyebrowHeader({ eyebrow, onBack, close = false }: { eyebrow: string; onBack: () => void; close?: boolean }) {
  const { t } = useTranslation();
  return (
    <View className="h-12 flex-row items-center justify-between px-gutter">
      <IconButton
        icon={close ? X : ChevronLeft}
        variant="plain"
        iconSize={close ? 20 : 22}
        onPress={onBack}
        accessibilityLabel={t(close ? 'a11y.close' : 'a11y.back')}
        className="-ml-2.5"
        testID="teen.header.back"
      />
      <Text variant="eyebrow">{eyebrow}</Text>
      <View className="w-11" />
    </View>
  );
}

function Point({ icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <View className="flex-row items-start gap-3.5" accessible accessibilityLabel={`${title}. ${body}`}>
      <View className="h-9 w-9 items-center justify-center rounded-pill bg-sand">
        <Icon icon={icon} size={18} />
      </View>
      <View className="flex-1">
        <Text variant="bodyMedium">{title}</Text>
        <Text variant="caption" tone="muted" className="mt-0.5 text-[13px] leading-[19px]">
          {body}
        </Text>
      </View>
    </View>
  );
}

/**
 * 02h Genç hesap · neler değişir — shown before a 16–17 year old's account is created (e-mail) or confirmed
 * (Apple / Google). "Anladım, devam et" goes on; "Doğum yılımı düzelt" returns to the year.
 */
export function TeenIntro({
  onContinue,
  onFix,
  loading = false,
  error,
}: {
  onContinue: () => void;
  onFix: () => void;
  loading?: boolean;
  error?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <Screen bottom>
      <EyebrowHeader eyebrow={t('teen.intro.eyebrow')} onBack={onFix} />
      <ScrollView contentContainerClassName="flex-grow gap-[22px] px-6 pb-10 pt-4" testID="teen.intro">
        <View className="gap-2.5">
          <Text variant="display" accessibilityRole="header">
            {t('teen.intro.title')}
          </Text>
          <Text variant="body" tone="muted">
            {t('teen.intro.body')}
          </Text>
        </View>
        <View className="gap-4">
          <Point icon={Mail} title={t('teen.intro.parentTitle')} body={t('teen.intro.parentBody')} />
          <Point icon={Camera} title={t('teen.intro.photosTitle')} body={t('teen.intro.photosBody')} />
          <Point icon={ShieldCheck} title={t('teen.intro.socialTitle')} body={t('teen.intro.socialBody')} />
          <Point icon={BellOff} title={t('teen.intro.adsTitle')} body={t('teen.intro.adsBody')} />
          <Point icon={Cake} title={t('teen.intro.adultTitle')} body={t('teen.intro.adultBody')} />
        </View>
        <View className="flex-1" />
        {error ? (
          <Text variant="caption" tone="danger" accessibilityRole="alert" testID="teen.intro.error">
            {error}
          </Text>
        ) : null}
        <View className="gap-1.5">
          <Button label={t('teen.intro.continue')} onPress={onContinue} loading={loading} testID="teen.intro.continue" />
          <Button variant="text" label={t('teen.intro.fix')} onPress={onFix} disabled={loading} testID="teen.intro.fix" />
        </View>
      </ScrollView>
    </Screen>
  );
}

export type UnderAgeVariant = 'email' | 'social' | 'closed';

/**
 * 02g — kind and clear: under 16 (nothing kept; Apple / Google: the account was deleted) or teen sign-up closed on
 * this server (`teen_not_available`). Never a dead end: the primary button leaves, "yanlış seçtim" goes back.
 */
export function UnderAge({
  variant,
  onPrimary,
  onFix,
  busy = false,
}: {
  variant: UnderAgeVariant;
  onPrimary: () => void;
  onFix?: () => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const title = variant === 'closed' ? t('teen.under.closedTitle') : t('teen.under.title');
  const body = variant === 'closed' ? t('teen.under.closedBody') : variant === 'social' ? t('teen.under.bodySocial') : t('teen.under.body');
  return (
    <Screen bottom>
      <View className="flex-1 items-center gap-[22px] px-7 pt-[72px]" testID={`teen.under.${variant}`}>
        <View className="h-[88px] w-[88px] items-center justify-center rounded-pill bg-sand">
          <Icon icon={Sprout} size={40} />
        </View>
        <View className="items-center gap-3">
          <Text variant="eyebrow">{t('teen.under.eyebrow')}</Text>
          <Text variant="display" className="text-center" accessibilityRole="header">
            {title}
          </Text>
          <Text variant="body" tone="muted" className="text-center">
            {body}
          </Text>
        </View>
      </View>
      <View className="gap-1.5 px-6 pb-10">
        <Button
          label={variant === 'social' ? t('teen.under.signOut') : t('teen.under.ok')}
          onPress={onPrimary}
          loading={busy}
          testID="teen.under.primary"
        />
        {onFix ? <Button variant="text" label={t('teen.under.fix')} onPress={onFix} disabled={busy} testID="teen.under.fix" /> : null}
      </View>
    </Screen>
  );
}
