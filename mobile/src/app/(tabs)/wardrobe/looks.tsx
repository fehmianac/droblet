import { useTranslation } from 'react-i18next';

import { InlinePlaceholder } from '@/components/navigation/InlinePlaceholder';
import { WardrobeHeader } from '@/features/wardrobe/WardrobeHeader';

/** Gardırop › Looks — placeholder until 14 lands. */
export default function WardrobeLooksScreen() {
  const { t } = useTranslation();
  return (
    <>
      <WardrobeHeader current="looks" eyebrow={t('brand.wordmark')} title={t('wardrobe.title')} />
      <InlinePlaceholder />
    </>
  );
}
