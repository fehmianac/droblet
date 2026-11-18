import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Shirt } from 'lucide-react-native';
import type { ReactElement } from 'react';
import { Text } from 'react-native';

import '@/i18n';
import { ApiError } from '@/api/errors';

import { OfflineBanner } from './OfflineBanner';
import { ScreenState } from './ScreenState';
import { SkeletonGrid } from './Skeleton';
import { StateMessage } from './StateMessage';

type Query = Parameters<typeof ScreenState<string[]>>[0]['query'];

const base: Query = { data: undefined, status: 'pending', fetchStatus: 'fetching', error: null, isRefetching: false, refetch: jest.fn() };
const client = new QueryClient();
const show = (ui: ReactElement) => render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
const list = (items: string[]) => <Text>{items.join(', ')}</Text>;

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('the five list states (canvas `Durum*` boards)', () => {
  it('loading: the skeleton shaped like the content, named for screen readers and marked busy', async () => {
    await show(
      <ScreenState query={base} skeleton={<SkeletonGrid />} loadingLabel="Loading your wardrobe">
        {list}
      </ScreenState>,
    );
    const loading = screen.getByTestId('state-loading');
    expect(loading.props.accessibilityLabel).toBe('Loading your wardrobe');
    expect(loading.props.accessibilityState).toEqual({ busy: true });
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });

  it('empty: headline, one sentence, the action — and the optional second way in', async () => {
    const onAction = jest.fn();
    const onSecondary = jest.fn();
    await show(
      <ScreenState
        query={{ ...base, data: [], status: 'success', fetchStatus: 'idle' }}
        skeleton={null}
        isEmpty={(items) => items.length === 0}
        empty={{
          icon: Shirt,
          title: 'Your wardrobe is empty',
          message: 'Add your first piece.',
          actionLabel: 'Add your first piece',
          onAction,
          secondaryActionLabel: 'Choose from the library',
          onSecondaryAction: onSecondary,
        }}
      >
        {list}
      </ScreenState>,
    );
    expect(screen.getByTestId('state-empty')).toBeTruthy();
    expect(screen.getByText('Your wardrobe is empty')).toBeTruthy();
    expect(screen.getByText('Add your first piece.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Add your first piece'));
    await fireEvent.press(screen.getByLabelText('Choose from the library'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it('empty stays one sentence + one action for screens that pass only those (older call sites)', async () => {
    const onAction = jest.fn();
    await show(
      <ScreenState
        query={{ ...base, data: [], status: 'success', fetchStatus: 'idle' }}
        skeleton={null}
        isEmpty={(items) => items.length === 0}
        empty={{ message: 'Nothing saved yet.', actionLabel: 'Explore', onAction }}
      >
        {list}
      </ScreenState>,
    );
    expect(screen.getByText('Nothing saved yet.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Explore'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('error: an alert with the screen headline, its sentence and "Try again"', async () => {
    const refetch = jest.fn();
    await show(
      <ScreenState
        query={{ ...base, status: 'error', fetchStatus: 'idle', error: new Error('boom'), refetch }}
        skeleton={null}
        error={{ title: "Couldn't load your wardrobe", message: 'Your pieces are safe; try again shortly.' }}
      >
        {list}
      </ScreenState>,
    );
    expect(screen.getByTestId('state-error').props.accessibilityRole).toBe('alert');
    expect(screen.getByText("Couldn't load your wardrobe")).toBeTruthy();
    expect(screen.getByText('Your pieces are safe; try again shortly.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Try again'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('error: a known cause keeps its own sentence, and the default headline is used without one', async () => {
    await show(
      <ScreenState query={{ ...base, status: 'error', fetchStatus: 'idle', error: new ApiError('network', 0, null) }} skeleton={null} error={{ message: 'Screen sentence.' }}>
        {list}
      </ScreenState>,
    );
    expect(screen.getByText("Couldn't load this")).toBeTruthy();
    expect(screen.getByText("Couldn't connect. Check your internet and try again.")).toBeTruthy();
    expect(screen.queryByText('Screen sentence.')).toBeNull();
  });

  it('offline with cached data: the list stays, under the top band with the screen text', async () => {
    onlineManager.setOnline(false);
    await show(
      <ScreenState query={{ ...base, data: ['Blazer', 'Jean'], status: 'success', fetchStatus: 'paused' }} skeleton={null} offlineMessage="You're offline · showing your saved wardrobe">
        {list}
      </ScreenState>,
    );
    expect(screen.getByTestId('offline-banner')).toBeTruthy();
    expect(screen.getByText("You're offline · showing your saved wardrobe")).toBeTruthy();
    expect(screen.getByText('Blazer, Jean')).toBeTruthy();
  });

  it('offline without cached data: explains it, and the screen can draw the band itself (`banner={false}`)', async () => {
    onlineManager.setOnline(false);
    await show(
      <>
        <OfflineBanner />
        <ScreenState query={{ ...base, fetchStatus: 'paused' }} skeleton={null} banner={false}>
          {list}
        </ScreenState>
      </>,
    );
    expect(screen.getAllByTestId('offline-banner')).toHaveLength(1);
    expect(screen.getByText("You're offline · showing what was last saved")).toBeTruthy();
    expect(screen.getByTestId('state-offline')).toBeTruthy();
    expect(screen.getByText("You're offline")).toBeTruthy();
  });
});

describe('StateMessage', () => {
  it('keeps the plain sentence + action when no board props are given', async () => {
    const onAction = jest.fn();
    await render(<StateMessage message="This piece is gone." actionLabel="Back" onAction={onAction} />);
    expect(screen.getByText('This piece is gone.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
