import { useTranslation } from 'react-i18next';

import { InlinePlaceholder } from '@/components/navigation/InlinePlaceholder';
import { WardrobeHeader } from '@/features/wardrobe/WardrobeHeader';

/** Gardırop › Trips — placeholder until 18 lands. */
export default function WardrobeTripsScreen() {
  const { t } = useTranslation();
  return (
    <>
      <WardrobeHeader current="trips" eyebrow={t('brand.wordmark')} title={t('wardrobe.title')} />
      <InlinePlaceholder />
    </>
  );
}
