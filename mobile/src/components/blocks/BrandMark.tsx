import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';

import { Text, type TextTone } from '@/components/ui/Text';
import { currentLanguage } from '@/i18n';
import { toDisplayUpper } from '@/lib/upper';

type Props = {
  name: string;
  /** The brand's official logo from the catalogue. Empty until the brand supplies one. */
  logoUrl?: string | null;
  tone?: TextTone;
  className?: string;
};

/**
 * A brand as it appears next to a product: its official logo when the catalogue provides one,
 * otherwise the brand name in the upper-case brand text style. The app never ships or draws a
 * brand's logo itself.
 */
export function BrandMark({ name, logoUrl, tone = 'muted', className }: Props) {
  useTranslation(); // re-render on language change (casing depends on it)
  if (logoUrl) {
    return (
      <Image
        source={{ uri: logoUrl }}
        contentFit="contain"
        contentPosition="left"
        accessible
        accessibilityRole="image"
        accessibilityLabel={name}
        className={`h-4 w-24 ${className ?? ''}`}
      />
    );
  }
  return (
    <Text variant="brand" tone={tone} numberOfLines={1} className={className}>
      {toDisplayUpper(name, currentLanguage())}
    </Text>
  );
}
