import { useTranslation } from 'react-i18next';

import { InlinePlaceholder } from '@/components/navigation/InlinePlaceholder';
import { WardrobeHeader } from '@/features/wardrobe/WardrobeHeader';

/** Gardırop › Items — placeholder until 10 lands. */
export default function WardrobeItemsScreen() {
  const { t } = useTranslation();
  return (
    <>
      <WardrobeHeader current="items" eyebrow={t('brand.wordmark')} title={t('wardrobe.title')} />
      <InlinePlaceholder />
    </>
  );
}
