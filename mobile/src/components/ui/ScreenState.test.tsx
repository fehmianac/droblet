import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Shirt } from 'lucide-react-native';
import type { ReactElement } from 'react';
import { Text } from 'react-native';

import '@/i18n';
import { ApiError } from '@/api/errors';

import { ScreenState } from './ScreenState';
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
  it('first load without cache: the drop loader holds the place, named for screen readers and marked busy', async () => {
    await show(
      <ScreenState query={base} loadingLabel="Loading your wardrobe">
        {list}
      </ScreenState>,
    );
    const loading = screen.getByTestId('state-loading');
    expect(loading.props.accessibilityLabel).toBe('Loading your wardrobe');
    expect(loading.props.accessibilityState).toEqual({ busy: true });
    expect(loading.props.accessibilityRole).toBe('progressbar');
  });

  it('empty: headline, one sentence, the action — and the optional second way in', async () => {
    const onAction = jest.fn();
    const onSecondary = jest.fn();
    await show(
      <ScreenState
        query={{ ...base, data: [], status: 'success', fetchStatus: 'idle' }}
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
      <ScreenState query={{ ...base, status: 'error', fetchStatus: 'idle', error: new ApiError('network', 0, null) }} error={{ message: 'Screen sentence.' }}>
        {list}
      </ScreenState>,
    );
    expect(screen.getByText("Couldn't load this")).toBeTruthy();
    expect(screen.getByText("Couldn't connect. Check your internet and try again.")).toBeTruthy();
    expect(screen.queryByText('Screen sentence.')).toBeNull();
  });

  it('not found (404): the screen\'s not-found sentence and its way back, never "Try again"', async () => {
    const onAction = jest.fn();
    const refetch = jest.fn();
    await show(
      <ScreenState
        query={{ ...base, status: 'error', fetchStatus: 'idle', error: new ApiError('http', 404, { code: 'not_found' }), refetch }}
        notFound={{ message: 'This look is no longer in your lookbook.', actionLabel: 'Back to the lookbook', onAction }}
        error={{ title: "Couldn't load this look" }}
      >
        {list}
      </ScreenState>,
    );
    expect(screen.getByTestId('state-not-found')).toBeTruthy();
    expect(screen.queryByTestId('state-error')).toBeNull();
    expect(screen.queryByText('Try again')).toBeNull();
    expect(screen.queryByText("Couldn't load this look")).toBeNull();
    await fireEvent.press(screen.getByLabelText('Back to the lookbook'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(refetch).not.toHaveBeenCalled();
  });

  it('not found without its own copy: the empty state stands in (nothing published yet)', async () => {
    const onAction = jest.fn();
    await show(
      <ScreenState
        query={{ ...base, status: 'error', fetchStatus: 'idle', error: new ApiError('http', 404, null) }}
        isEmpty={(items) => items.length === 0}
        empty={{ message: "This week's edit is being prepared.", actionLabel: 'Browse the store', onAction }}
      >
        {list}
      </ScreenState>,
    );
    expect(screen.getByTestId('state-empty')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Browse the store'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('not found with neither: a generic "no longer here" + back, still no retry', async () => {
    await show(
      <ScreenState query={{ ...base, status: 'error', fetchStatus: 'idle', error: new ApiError('http', 410, null) }}>{list}</ScreenState>,
    );
    expect(screen.getByText('What you were looking for is no longer here.')).toBeTruthy();
    expect(screen.getByLabelText('Go back')).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('a server error (5xx) keeps the error state with "Try again", even with not-found copy given', async () => {
    await show(
      <ScreenState
        query={{ ...base, status: 'error', fetchStatus: 'idle', error: new ApiError('http', 503, null) }}
        notFound={{ message: 'Gone.', actionLabel: 'Back', onAction: jest.fn() }}
      >
        {list}
      </ScreenState>,
    );
    expect(screen.getByTestId('state-error')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.queryByText('Gone.')).toBeNull();
  });

  it('offline with cached data: the list stays and no band pushes it (the root sync pill reports offline)', async () => {
    onlineManager.setOnline(false);
    await show(
      <ScreenState query={{ ...base, data: ['Blazer', 'Jean'], status: 'success', fetchStatus: 'paused' }}>{list}</ScreenState>,
    );
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    expect(screen.getByText('Blazer, Jean')).toBeTruthy();
  });

  it('offline without cached data: explains it', async () => {
    onlineManager.setOnline(false);
    await show(
      <>
        <ScreenState query={{ ...base, fetchStatus: 'paused' }}>
          {list}
        </ScreenState>
      </>,
    );
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
