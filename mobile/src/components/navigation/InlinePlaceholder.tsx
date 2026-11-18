import { useTranslation } from 'react-i18next';

import { StateMessage } from '@/components/ui/StateMessage';

/** Placeholder body for sub-views inside a built shell (Gardırop segments, Keşfet chips). */
export function InlinePlaceholder() {
  const { t } = useTranslation();
  return <StateMessage message={t('states.placeholder')} />;
}
