import type {
  ClosetVisibility,
  MyPhotos,
  MyProfile,
  NotificationSettings,
  Palette,
  PaletteMismatch,
  ProfileStats,
  PutNotificationSettingsRequest,
} from '@/api/contracts/account';
import { ApiError } from '@/api/errors';

/**
 * Typed fixtures for Profil (28), Gizlilik ve ayarlar (29) and Renk paletim (30). Values are the
 * design's sample data. Palette colours are analysis output (data), not design tokens.
 */

type State = {
  profile: MyProfile;
  photos: MyPhotos;
  notifications: NotificationSettings;
  palette: 'ready' | 'none' | { pendingUntil: number };
};

function initialState(): State {
  return {
    profile: {
      handle: 'damla',
      displayName: 'Damla',
      avatarUrl: null,
      styleTags: ['minimal', 'quiet_luxury', 'office_chic'],
      closetVisibility: 'followers',
      language: null,
      baseVersion: 1,
    },
    photos: {
      body: [{ photoId: 'photo_body_1', url: null }],
      face: { photoId: 'photo_face_1', url: null },
      generatedImageCount: 48,
    },
    notifications: { morningReminder: true, morningTimeUtc: '04:30', weeklyEdit: true, friendRatings: false, baseVersion: 1 },
    palette: 'ready',
  };
}

let state = initialState();

/** Test helper: back to the seeded state (optionally without a palette / face photo). */
export function resetAccountFixtures(overrides: { palette?: 'ready' | 'none'; facePhoto?: boolean } = {}): void {
  state = initialState();
  if (overrides.palette) state.palette = overrides.palette;
  if (overrides.facePhoto === false) state.photos = { ...state.photos, face: null };
}

const readyPalette: Palette = {
  status: 'ready',
  seasonType: 'warm_autumn',
  tones: [
    { hex: '#A0522D', name: { tr: 'Tarçın', en: 'Cinnamon' }, catalogColor: 'brown' },
    { hex: '#C68E4E', name: { tr: 'Karamel', en: 'Caramel' }, catalogColor: 'camel' },
    { hex: '#6B6B3A', name: { tr: 'Zeytin', en: 'Olive' }, catalogColor: 'olive' },
    { hex: '#1F2A44', name: { tr: 'Gece mavisi', en: 'Midnight blue' }, catalogColor: 'navy' },
    { hex: '#D8C3A5', name: { tr: 'Kum', en: 'Sand' }, catalogColor: 'beige' },
    { hex: '#6D1F2A', name: { tr: 'Bordo', en: 'Burgundy' }, catalogColor: 'burgundy' },
    { hex: '#F1E7D3', name: { tr: 'Krem', en: 'Cream' }, catalogColor: 'cream' },
    { hex: '#3B2A20', name: { tr: 'Espresso', en: 'Espresso' }, catalogColor: 'brown' },
  ],
  avoid: [
    { hex: '#F2F4F7', name: { tr: 'Buz beyazı', en: 'Icy white' }, catalogColor: null },
    { hex: '#E83E8C', name: { tr: 'Fuşya', en: 'Fuchsia' }, catalogColor: null },
    { hex: '#8FB8DE', name: { tr: 'Buz mavisi', en: 'Icy blue' }, catalogColor: null },
    { hex: '#B7B9BD', name: { tr: 'Soğuk gri', en: 'Cool grey' }, catalogColor: null },
  ],
  wardrobeMatchPercent: 64,
};

const PALETTE_DURATION_MS = 1500;

export const accountFixtures = {
  profile: (): MyProfile => state.profile,
  stats: (): ProfileStats => ({ itemCount: 86, lookCount: 24, followerCount: 12, tripCount: 3 }),
  setVisibility: (closetVisibility: ClosetVisibility): MyProfile => {
    state.profile = { ...state.profile, closetVisibility, baseVersion: state.profile.baseVersion + 1 };
    return state.profile;
  },

  setLanguage: (language: MyProfile['language']): MyProfile => {
    state.profile = { ...state.profile, language, baseVersion: state.profile.baseVersion + 1 };
    return state.profile;
  },

  photos: (): MyPhotos => state.photos,
  removePhoto: (kind: 'body' | 'face', photoId: string): void => {
    state.photos =
      kind === 'face'
        ? { ...state.photos, face: null }
        : { ...state.photos, body: state.photos.body.filter((p) => p.photoId !== photoId) };
  },
  deleteAllPhotos: (): void => {
    state.photos = { body: [], face: null, generatedImageCount: 0 };
    state.palette = 'none';
  },

  notifications: (): NotificationSettings => state.notifications,
  setNotifications: (request: PutNotificationSettingsRequest): NotificationSettings => {
    const { clientMutationId: _id, ...settings } = request;
    void _id;
    state.notifications = { ...settings, baseVersion: state.notifications.baseVersion + 1 };
    return state.notifications;
  },

  palette: (): Palette => {
    if (state.palette === 'none') throw new ApiError('http', 404, { status: 404, code: 'not_found' });
    if (state.palette === 'ready') return readyPalette;
    if (Date.now() >= state.palette.pendingUntil) {
      state.palette = 'ready';
      return readyPalette;
    }
    return { status: 'pending' };
  },
  analyzePalette: (): void => {
    if (!state.photos.face) throw new ApiError('http', 422, { status: 422, code: 'face_photo_required' });
    if (state.palette === 'none') state.palette = { pendingUntil: Date.now() + PALETTE_DURATION_MS };
  },
  mismatch: (): PaletteMismatch => ({
    items: [
      { id: 'item_fuchsia_knit', name: 'Fuşya triko', imageUrl: null },
      { id: 'item_icy_shirt', name: 'Buz mavisi gömlek', imageUrl: null },
      { id: 'item_grey_coat', name: 'Soğuk gri kaban', imageUrl: null },
    ],
  }),
};
