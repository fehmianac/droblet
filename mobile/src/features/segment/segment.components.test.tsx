import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ImageSlot } from '@/components/ui/ImageSlot';
import { Silhouette } from '@/components/ui/Silhouette';
import { resetFixtureDb } from '@/fixtures/db';
import i18n from '@/i18n';
import { StepBodyType } from '@/features/requirements/steps/StepBodyType';
import { TryOnInvite } from '@/features/tryon/TryOnInvite';
import { EMPTY_FORM } from '@/features/wardrobe/form';
import { ItemForm } from '@/features/wardrobe/ItemForm';

import { segmentStore } from './store';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SafeAreaProvider>
  );
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
beforeEach(() => resetFixtureDb());
afterEach(() => segmentStore.reset());

describe('placeholder figures follow the segment (canvas 17 "Yer tutucular")', () => {
  it('Silhouette: women by default, men for a men account, and an explicit variant wins', async () => {
    const view = await render(<Silhouette height={100} />);
    expect(screen.getByTestId('silhouette-women')).toBeTruthy();
    await act(async () => segmentStore.set('men'));
    await view.rerender(<Silhouette height={100} />);
    expect(screen.getByTestId('silhouette-men')).toBeTruthy();
    await view.rerender(<Silhouette height={100} variant="women" />);
    expect(screen.getByTestId('silhouette-women')).toBeTruthy();
  });

  it('ImageSlot figure placeholder and the try-on invitation draw the men figure', async () => {
    segmentStore.set('men');
    await render(
      <>
        <ImageSlot className="h-40 w-32" placeholder={{ kind: 'figure', figureHeight: 100 }} />
        <TryOnInvite footer="Try on me" ready onPress={() => undefined} />
      </>,
    );
    expect(screen.getByTestId('image-slot-figure')).toBeTruthy();
    expect(screen.getByTestId('silhouette-men')).toBeTruthy();
    expect(screen.getByTestId('try-on-invite-figure-men')).toBeTruthy();
  });
});

describe('11e body type step per segment', () => {
  it('women: hourglass, pear, apple, rectangle, inverted triangle, not sure', async () => {
    await render(wrap(<StepBodyType onDone={() => undefined} />));
    await waitFor(() => expect(screen.getByTestId('requirements.bodyType.set.women')).toBeTruthy());
    for (const id of ['hourglass', 'pear', 'apple', 'rectangle', 'inverted_triangle', 'unsure']) expect(screen.getByTestId(`requirements.bodyType.${id}`)).toBeTruthy();
    expect(screen.queryByTestId('requirements.bodyType.trapezoid')).toBeNull();
    await fireEvent.press(screen.getByTestId('requirements.bodyType.inverted_triangle'));
    expect(screen.getByTestId('requirements.bodyType.desc')).toHaveTextContent(/Inverted triangle/);
  });

  it("men: rectangle, inverted triangle, triangle, oval, trapezoid, not sure — with the men's descriptions", async () => {
    segmentStore.set('men');
    await render(wrap(<StepBodyType onDone={() => undefined} />));
    await waitFor(() => expect(screen.getByTestId('requirements.bodyType.set.men')).toBeTruthy());
    for (const id of ['rectangle', 'inverted_triangle', 'triangle', 'oval', 'trapezoid', 'unsure']) expect(screen.getByTestId(`requirements.bodyType.${id}`)).toBeTruthy();
    for (const id of ['hourglass', 'pear', 'apple']) expect(screen.queryByTestId(`requirements.bodyType.${id}`)).toBeNull();
    await fireEvent.press(screen.getByTestId('requirements.bodyType.trapezoid'));
    expect(screen.getByTestId('requirements.bodyType.desc')).toHaveTextContent('Trapezoid · Shoulders a little wider than the hips, a balanced waist.');
    await fireEvent.press(screen.getByTestId('requirements.bodyType.inverted_triangle'));
    expect(screen.getByTestId('requirements.bodyType.desc')).toHaveTextContent(/Clearly broad shoulders/);
  });
});

describe('12c item form: category list and "Type" suggestions follow the segment', () => {
  const renderForm = (category: 'accessory' | 'bottom' | null) =>
    render(wrap(<ItemForm mode="manual" initial={{ ...EMPTY_FORM, category }} imageUrl={null} originalImageUrl={null} onSubmit={() => undefined} />));

  it('women: dress in the list, jewellery and skirts suggested', async () => {
    await renderForm('accessory');
    await fireEvent.press(screen.getByText('Category'));
    expect(screen.getByTestId('item-form-category.dress')).toBeTruthy();
    expect(screen.getByTestId('item-form-type-suggestions.women')).toBeTruthy();
    expect(screen.getByTestId('item-form-type.necklace')).toBeTruthy();
    expect(screen.queryByTestId('item-form-type.tie')).toBeNull();
  });

  it('men: no dress, watch / tie / belt suggested; a chip fills the type field', async () => {
    segmentStore.set('men');
    await renderForm('accessory');
    await fireEvent.press(screen.getByText('Category'));
    expect(screen.queryByTestId('item-form-category.dress')).toBeNull();
    expect(screen.getByTestId('item-form-type-suggestions.men')).toBeTruthy();
    expect(screen.getByTestId('item-form-type.watch')).toBeTruthy();
    expect(screen.queryByTestId('item-form-type.necklace')).toBeNull();
    await fireEvent.press(screen.getByTestId('item-form-type.tie'));
    expect(screen.getByTestId('item-form-type.tie').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByDisplayValue('Tie')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('item-form-category.bottom'));
    expect(screen.getByTestId('item-form-type.chinos')).toBeTruthy();
    expect(screen.queryByTestId('item-form-type.skirt')).toBeNull();
  });
});
