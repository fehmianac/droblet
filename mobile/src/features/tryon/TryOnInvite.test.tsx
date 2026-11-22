import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import type { MyPhotos } from '@/api/contracts/account';
import { accountKeys } from '@/features/account/queries';
import { ImportPhotoCollage } from '@/features/outfitImport/parts';
import { segmentStore } from '@/features/segment/store';
import i18n from '@/i18n';

import { TryOnInvite } from './TryOnInvite';

const mockTeen = { isTeen: false };
jest.mock('@/features/teen/store', () => ({
  ...jest.requireActual('@/features/teen/store'),
  useTeenRules: () => ({ isTeen: mockTeen.isTeen }),
}));

const OWN_URL = 'https://signed.example.com/body.jpg?sig=1';

/** A client whose photo list is already answered (never refetched in the test). */
function withPhotos(photos: MyPhotos | undefined, children: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  if (photos) client.setQueryData(accountKeys.photos, photos);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const photosWith = (url: string | null): MyPhotos => ({ body: url === null ? [] : [{ photoId: 'p1', url }], face: null, generatedImageCount: null });

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  mockTeen.isTeen = false;
  segmentStore.reset();
});

describe('try-on invitation photo (Görseller v3)', () => {
  it('ready with an active body photo: the own photo, blurred, from the private source — no tag, no sample', async () => {
    await render(withPhotos(photosWith(OWN_URL), <TryOnInvite footer="Try it on me · 1 credit" ready onPress={() => undefined} />));
    const own = screen.getByTestId('try-on-invite-own-photo');
    expect(own).toHaveProp('source', [{ uri: OWN_URL, cacheKey: 'photo:p1' }]);
    expect(own).toHaveProp('blurRadius', 3);
    expect(own).toHaveProp('accessible', false);
    expect(screen.queryByText('EXAMPLE')).toBeNull();
    expect(screen.queryByTestId('try-on-invite-sample-women')).toBeNull();
    expect(screen.queryByTestId('try-on-invite-figure-women')).toBeNull();
    expect(screen.getByText('How would this look sit on you?')).toBeTruthy();
  });

  it('ready, but the own photo does not load: the sample with its tag', async () => {
    await render(withPhotos(photosWith(OWN_URL), <TryOnInvite footer="Try it on me · 1 credit" ready onPress={() => undefined} />));
    await fireEvent(screen.getByTestId('try-on-invite-own-photo'), 'error', { nativeEvent: { error: 'expired' } });
    await waitFor(() => expect(screen.getByTestId('try-on-invite-sample-women')).toBeTruthy());
    expect(screen.getByText('EXAMPLE')).toBeTruthy();
    expect(screen.queryByTestId('try-on-invite-own-photo')).toBeNull();
  });

  it('ready without a photo in the list: the sample with its tag', async () => {
    await render(withPhotos(photosWith(null), <TryOnInvite footer="Try it on me · 1 credit" ready onPress={() => undefined} />));
    expect(screen.getByTestId('try-on-invite-sample-women')).toBeTruthy();
    expect(screen.getByText('EXAMPLE')).toBeTruthy();
  });

  it('not ready (no photo / membership): the sample of the segment tagged "EXAMPLE", never the own photo', async () => {
    const onPress = jest.fn();
    await render(withPhotos(photosWith(OWN_URL), <TryOnInvite footer="Add your photo first" ready={false} onPress={onPress} />));
    expect(screen.getByTestId('try-on-invite-sample-women')).toBeTruthy();
    expect(screen.getByText('EXAMPLE')).toBeTruthy();
    expect(screen.queryByTestId('try-on-invite-own-photo')).toBeNull();
    expect(screen.getByRole('button')).toHaveProp('accessibilityLabel', 'Try it on me. How would this look sit on you? Add your photo first');
    await fireEvent.press(screen.getByTestId('try-on-invite'));
    expect(onPress).toHaveBeenCalledTimes(1);

    await act(async () => segmentStore.set('men'));
    expect(screen.getByTestId('try-on-invite-sample-men')).toBeTruthy();
  });

  it('Turkish tag: "ÖRNEK"', async () => {
    await i18n.changeLanguage('tr');
    await render(withPhotos(undefined, <TryOnInvite footer="Üyelikle açılır" ready={false} onPress={() => undefined} />));
    expect(screen.getByText('ÖRNEK')).toBeTruthy();
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('teen account: the dashed figure — no sample photo, no own photo, no tag', async () => {
    mockTeen.isTeen = true;
    await render(withPhotos(photosWith(OWN_URL), <TryOnInvite footer="Try it on me · 1 credit" ready onPress={() => undefined} />));
    expect(screen.getByTestId('try-on-invite-figure-women')).toBeTruthy();
    expect(screen.queryByTestId('try-on-invite-own-photo')).toBeNull();
    expect(screen.queryByTestId('try-on-invite-sample-women')).toBeNull();
    expect(screen.queryByText('EXAMPLE')).toBeNull();
    expect(screen.getByTestId('try-on-invite-footer')).toHaveTextContent('Try it on me · 1 credit');

    await render(withPhotos(undefined, <TryOnInvite footer="Add your photo first" ready={false} onPress={() => undefined} testID="teen-invite" />));
    expect(screen.queryByTestId('teen-invite-sample-women')).toBeNull();
  });
});

describe('31 import intro pictures (Görseller v3)', () => {
  it("draws the segment's three example photos in order, hidden from assistive tech", async () => {
    await render(<ImportPhotoCollage />);
    const women = [1, 2, 3].map((n) => screen.getByTestId(`import.example.women.${n}`, { includeHiddenElements: true }));
    expect(new Set(women.map((img) => JSON.stringify(img.props.source))).size).toBe(3);
    expect(screen.getByTestId('import.collage', { includeHiddenElements: true })).toHaveProp('accessibilityElementsHidden', true);
    expect(screen.queryByTestId('image-slot-figure', { includeHiddenElements: true })).toBeNull();

    await act(async () => segmentStore.set('men'));
    for (const n of [1, 2, 3]) expect(screen.getByTestId(`import.example.men.${n}`, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('import.example.women.1', { includeHiddenElements: true })).toBeNull();
  });
});
