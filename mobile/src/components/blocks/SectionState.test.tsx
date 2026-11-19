import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Text } from 'react-native';

import '@/i18n';
import { ApiError } from '@/api/errors';

import { SectionState } from './SectionState';

type Query = Parameters<typeof SectionState<string[]>>[0]['query'];

const failed = (error: unknown): Query => ({ data: undefined, status: 'error', fetchStatus: 'idle', error, refetch: jest.fn() });
const client = new QueryClient();
const show = (ui: ReactElement) => render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
const list = (items: string[]) => <Text>{items.join(', ')}</Text>;

describe('SectionState and a 404', () => {
  it('shows the empty sentence for a 404, without "Try again"', async () => {
    await show(
      <SectionState query={failed(new ApiError('http', 404, { code: 'not_found' }))} skeleton={null} emptyText="Nothing here yet.">
        {list}
      </SectionState>,
    );
    expect(screen.getByText('Nothing here yet.')).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('keeps the error sentence and "Try again" for a server error', async () => {
    await show(
      <SectionState query={failed(new ApiError('http', 500, null))} skeleton={null} emptyText="Nothing here yet.">
        {list}
      </SectionState>,
    );
    expect(screen.queryByText('Nothing here yet.')).toBeNull();
    expect(screen.getByText('Try again')).toBeTruthy();
  });
});
