import { fireEvent, render, screen } from '@testing-library/react-native';

import '@/i18n';
import { sizes } from '@/theme/tokens';

import { TabBarView } from './TabBar';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

describe('tab bar (TasarimSistemi: 86 high, centre Stilist 56 raised 18)', () => {
  it('keeps the design-system measures', () => {
    expect(sizes.tabBar).toBe(86);
    expect(sizes.tabBarCenterButton).toBe(56);
    expect(sizes.tabBarCenterRaise).toBe(18);
  });

  it('shows four labelled tabs around an unlabelled Stilist button', async () => {
    const onPress = jest.fn();
    await render(<TabBarView active="index" onPress={onPress} />);

    for (const label of ['Feed', 'Wardrobe', 'Discover', 'Profile']) expect(screen.getByText(label)).toBeTruthy();
    // The centre button is announced but carries no visible label on the canvas.
    expect(screen.queryByText('Stylist')).toBeNull();
    const stylist = screen.getByLabelText('Stylist');
    expect(stylist.props.style).toEqual(expect.objectContaining({ marginTop: -18 }));

    expect(screen.getByLabelText('Feed').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByLabelText('Wardrobe').props.accessibilityState).toEqual({ selected: false });

    await fireEvent.press(stylist);
    await fireEvent.press(screen.getByLabelText('Discover'));
    expect(onPress.mock.calls.map((c) => c[0])).toEqual(['stylist', 'discover']);
  });

  it('is 86 high without a bottom inset', async () => {
    await render(<TabBarView active={null} onPress={() => undefined} />);
    expect(screen.getByTestId('tab-bar').props.style).toEqual(expect.objectContaining({ height: 86 }));
  });
});
