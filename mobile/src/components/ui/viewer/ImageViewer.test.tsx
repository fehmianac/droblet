import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import i18n from '@/i18n';

import { ImageViewer, panBounds, zoomAround, type ViewerImage } from './ImageViewer';
import { Zoomable } from './Zoomable';

const images: ViewerImage[] = [
  { uri: 'https://img.test/tryon.jpg', label: 'Gece Laciverti on you', ai: { tag: 'ON YOU' } },
  { uri: 'https://img.test/blazer.jpg', label: 'Navy wool blazer', caption: 'Navy wool blazer' },
  { uri: 'https://img.test/dress.jpg', label: 'Black midi dress', caption: 'Black midi dress' },
];

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const render = async (ui: ReactElement) => rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('13a ImageViewer', () => {
  it('opens from a tile with the "Enlarge" hint and closes with ×', async () => {
    jest.useFakeTimers();
    await render(
      <Zoomable images={images} index={0} accessibilityLabel="Gece Laciverti on you" testID="tile">
        <Text>tile</Text>
      </Zoomable>,
    );
    const tile = screen.getByTestId('tile');
    expect(tile.props.accessibilityHint).toBe('Enlarge');
    expect(tile.props.accessibilityRole).toBe('imagebutton');
    expect(screen.queryByTestId('image-viewer')).toBeNull();

    await fireEvent.press(tile);
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(screen.getByTestId('image-viewer')).toBeTruthy();
    expect(screen.getByTestId('image-viewer.close').props.accessibilityLabel).toBe('Close');

    await fireEvent.press(screen.getByTestId('image-viewer.close'));
    expect(screen.queryByTestId('image-viewer')).toBeNull();
    jest.useRealTimers();
  });

  it('keeps the AI label on an AI image and shows the caption on a photo', async () => {
    await render(<ImageViewer visible images={images} initialIndex={0} onClose={jest.fn()} />);
    expect(screen.getByTestId('image-viewer.aiTag')).toBeTruthy();
    expect(screen.getByText('AI preview')).toBeTruthy();
    expect(screen.getByText('ON YOU')).toBeTruthy();
    expect(screen.queryByTestId('image-viewer.caption')).toBeNull();
  });

  it('pages between the images with the page indicator (adjustable: increment / decrement)', async () => {
    const onIndexChange = jest.fn();
    await render(<ImageViewer visible images={images} initialIndex={0} onClose={jest.fn()} onIndexChange={onIndexChange} />);
    const pager = screen.getByTestId('image-viewer.pager');
    expect(screen.getByTestId('image-viewer.counter').props.children).toBe('1 of 3');
    expect(pager.props.accessibilityLabel).toBe('Gece Laciverti on you');

    await fireEvent(pager, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
    expect(screen.getByTestId('image-viewer.counter').props.children).toBe('2 of 3');
    // A photo: its caption, no AI label.
    expect(screen.getByTestId('image-viewer.caption').props.children).toBe('Navy wool blazer');
    expect(screen.queryByTestId('image-viewer.aiTag')).toBeNull();

    await fireEvent(screen.getByTestId('image-viewer.pager'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    await fireEvent(screen.getByTestId('image-viewer.pager'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    // Past the last image: stays on it.
    expect(screen.getByTestId('image-viewer.counter').props.children).toBe('3 of 3');

    await fireEvent(screen.getByTestId('image-viewer.pager'), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(screen.getByTestId('image-viewer.counter').props.children).toBe('2 of 3');
  });

  it('closes on the escape gesture and hides the counter for a single image', async () => {
    const onClose = jest.fn();
    await render(<ImageViewer visible images={[images[0] as ViewerImage]} onClose={onClose} />);
    expect(screen.queryByTestId('image-viewer.counter')).toBeNull();
    expect(screen.queryByTestId('image-viewer.dots')).toBeNull();
    await fireEvent(screen.getByTestId('image-viewer.pager'), 'accessibilityAction', { nativeEvent: { actionName: 'escape' } });
    expect(onClose).toHaveBeenCalled();
  });

  it('a placeholder (no picture) is not tappable', async () => {
    await render(
      <Zoomable images={[]} testID="tile">
        <Text>glyph</Text>
      </Zoomable>,
    );
    expect(screen.getByTestId('tile').props.accessibilityHint).toBeUndefined();
  });
});

describe('viewer geometry', () => {
  it('bounds panning to the overflow of the scaled picture', async () => {
    // 3:4 picture in a 390 × 844 screen: fills the width (390 × 520).
    expect(panBounds(390, 844, 0.75, 1)).toEqual({ x: 0, y: 0 });
    const b = panBounds(390, 844, 0.75, 2);
    expect(b.x).toBeCloseTo(195);
    expect(b.y).toBeCloseTo(98);
  });

  it('keeps the tapped point still when zooming', async () => {
    // Tap 100 pt right of centre at 1× → 2×: the picture moves 100 pt left.
    expect(zoomAround(100, 0, 1, 2)).toBe(-100);
    expect(zoomAround(0, 0, 1, 4)).toBe(0);
  });
});
