import { render, screen } from '@testing-library/react-native';

import { ProductRow } from '@/components/ui/ProductRow';
import i18n from '@/i18n';

import { BrandMark } from './BrandMark';

describe('brand names on screen', () => {
  afterAll(async () => {
    await i18n.changeLanguage('tr');
  });

  it.each(['tr', 'en'])('BrandMark shows "Communité" as COMMUNITÉ in %s mode', async (language) => {
    await i18n.changeLanguage(language);
    await render(<BrandMark name="Communité" />);
    expect(screen.getByText('COMMUNITÉ')).toBeTruthy();
    expect(screen.queryByText('COMMUNİTÉ')).toBeNull();
  });

  it('ProductRow uses the same brand casing in Turkish mode', async () => {
    await i18n.changeLanguage('tr');
    await render(<ProductRow brand="Communité" name="Triko Kazak" price={null} />);
    expect(screen.getByText('COMMUNITÉ')).toBeTruthy();
  });
});
