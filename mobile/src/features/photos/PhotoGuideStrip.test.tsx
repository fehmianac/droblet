import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { StepPhoto } from '@/features/requirements/steps/StepPhoto';
import { segmentStore } from '@/features/segment/store';
import i18n from '@/i18n';

import { PhotoGuideStrip } from './PhotoGuideStrip';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SafeAreaProvider>
  );
}

const LABELS = {
  en: ['Right: full length, in front of a plain wall, in good light', 'Wrong: too dark', 'Wrong: upper body only'],
  tr: ['Doğru örnek: tam boy, düz duvar önünde, iyi ışıkta', 'Yanlış örnek: çok karanlık', 'Yanlış örnek: yalnız üst beden'],
};

afterEach(async () => {
  segmentStore.reset();
  await i18n.changeLanguage('en');
});

describe('PhotoGuideStrip (canvas 22c)', () => {
  it('shows three labelled examples, right first, in both languages', async () => {
    await i18n.changeLanguage('en');
    const view = await render(wrap(<PhotoGuideStrip />));
    expect(screen.getByText('A good full-length photo')).toBeTruthy();
    expect(screen.getByLabelText('Full-length photo examples')).toBeTruthy();
    for (const label of LABELS.en) expect(screen.getByLabelText(label)).toBeTruthy();
    expect(screen.getByText('Full length, plain wall, daylight')).toBeTruthy();
    expect(screen.getByText('Dark or blurry')).toBeTruthy();
    expect(screen.getByText('Half length or selfie')).toBeTruthy();

    await act(async () => {
      await i18n.changeLanguage('tr');
    });
    await view.rerender(wrap(<PhotoGuideStrip />));
    expect(screen.getByText('İyi bir boy fotoğrafı')).toBeTruthy();
    for (const label of LABELS.tr) expect(screen.getByLabelText(label)).toBeTruthy();
  });

  it('derives all three examples from one photo per segment: women by default, men for a men account', async () => {
    const view = await render(wrap(<PhotoGuideStrip />));
    expect(screen.getAllByTestId('photoGuide.photo.women')).toHaveLength(3);
    await act(async () => segmentStore.set('men'));
    await view.rerender(wrap(<PhotoGuideStrip />));
    expect(screen.getAllByTestId('photoGuide.photo.men')).toHaveLength(3);
    expect(screen.queryByTestId('photoGuide.photo.women')).toBeNull();
  });

  it('is the same strip on the 11d full-length photo step, not on the face step', async () => {
    const view = await render(wrap(<StepPhoto kind="body" onDone={() => undefined} onLeave={() => undefined} />));
    expect(screen.getByTestId('photoGuide.strip')).toBeTruthy();
    for (const label of LABELS.en) expect(screen.getByLabelText(label)).toBeTruthy();
    await view.rerender(wrap(<StepPhoto kind="face" onDone={() => undefined} onLeave={() => undefined} />));
    expect(screen.queryByTestId('photoGuide.strip')).toBeNull();
  });
});
