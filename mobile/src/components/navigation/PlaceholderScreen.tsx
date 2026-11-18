import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { StateMessage } from '@/components/ui/StateMessage';
import type tr from '@/i18n/tr.json';

export type ScreenTitleKey = keyof (typeof tr)['screens'];

type Props = {
  titleKey: ScreenTitleKey;
  /** Tab roots have no back button and no extra header chrome. */
  inTabs?: boolean;
  leading?: 'back' | 'close' | 'none';
};

/** Titled ScreenState placeholder for routes that are not built in this slice, so navigation is complete. */
export function PlaceholderScreen({ titleKey, inTabs = false, leading }: Props) {
  const { t } = useTranslation();
  return (
    <Screen bottom={!inTabs}>
      <ScreenHeader title={t(`screens.${titleKey}`)} leading={inTabs ? 'none' : leading} />
      <StateMessage
        message={t('states.placeholder')}
        actionLabel={inTabs ? undefined : t('states.placeholderAction')}
        onAction={inTabs ? undefined : () => router.dismissTo('/')}
      />
    </Screen>
  );
}
