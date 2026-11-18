import type {
  ClosetVisibility,
  HandleAvailability,
  MyPhotos,
  MyProfile,
  NotificationSettings,
  Palette,
  PaletteMismatch,
  ProfileStats,
  PutNotificationSettingsRequest,
  UpdateProfileRequest,
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
    notifications: { morningReminder: true, morningTimeLocal: '07:30', weeklyEdit: true, friendRatings: false, priceDrop: false, followRequests: false, baseVersion: 1 },
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
    { hex: '#7A4E3A', name: { tr: 'Tarçın', en: 'Cinnamon' }, catalogColor: 'brown' },
    { hex: '#A8763E', name: { tr: 'Karamel', en: 'Caramel' }, catalogColor: 'camel' },
    { hex: '#5E6B4E', name: { tr: 'Zeytin', en: 'Olive' }, catalogColor: 'olive' },
    { hex: '#2F3A4F', name: { tr: 'Gece mavisi', en: 'Midnight blue' }, catalogColor: 'navy' },
    { hex: '#C9B79C', name: { tr: 'Kum', en: 'Sand' }, catalogColor: 'beige' },
    { hex: '#8C3B3B', name: { tr: 'Bordo', en: 'Burgundy' }, catalogColor: 'burgundy' },
    { hex: '#E8DCC6', name: { tr: 'Krem', en: 'Cream' }, catalogColor: 'cream' },
    { hex: '#4A3B33', name: { tr: 'Espresso', en: 'Espresso' }, catalogColor: 'brown' },
  ],
  avoid: [
    { hex: '#E7B8D3', name: { tr: 'Şeker pembesi', en: 'Candy pink' }, catalogColor: null },
    { hex: '#9FD3E8', name: { tr: 'Buz mavisi', en: 'Icy blue' }, catalogColor: null },
    { hex: '#C9C9D6', name: { tr: 'Soğuk gri', en: 'Cool grey' }, catalogColor: null },
    { hex: '#F2F2F2', name: { tr: 'Buz beyazı', en: 'Icy white' }, catalogColor: null },
  ],
  wardrobeMatchPercent: 64,
};

const PALETTE_DURATION_MS = 1500;

export const accountFixtures = {
  profile: (): MyProfile => state.profile,
  stats: (): ProfileStats => ({ itemCount: 86, lookCount: 24, followerCount: 12, followingCount: 18, tripCount: 3 }),
  setVisibility: (closetVisibility: ClosetVisibility): MyProfile => {
    state.profile = { ...state.profile, closetVisibility, baseVersion: state.profile.baseVersion + 1 };
    return state.profile;
  },

  setDisplayName: (displayName: string): MyProfile => {
    state.profile = { ...state.profile, displayName, baseVersion: state.profile.baseVersion + 1 };
    return state.profile;
  },
  /** Fixture rules: reserved words, taken sample handles, the server's format. */
  handleAvailability: (raw: string): HandleAvailability => {
    const handle = raw.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9._]*[a-z0-9])?$/.test(handle) || handle.length < 3 || handle.length > 30 || handle.includes('..'))
      return { handle, available: false, code: 'handle_invalid' };
    if (['admin', 'droblet', 'support', 'help'].includes(handle)) return { handle, available: false, code: 'handle_reserved' };
    if (handle !== state.profile.handle && ['selin', 'elif', 'zeynep', 'ayse', 'deniz'].includes(handle))
      return { handle, available: false, code: 'handle_taken' };
    return { handle, available: true, code: null };
  },
  setHandle: (handle: string): MyProfile => {
    state.profile = { ...state.profile, handle, baseVersion: state.profile.baseVersion + 1 };
    return state.profile;
  },

  setLanguage: (language: MyProfile['language']): MyProfile => {
    state.profile = { ...state.profile, language, baseVersion: state.profile.baseVersion + 1 };
    return state.profile;
  },

  /** Handles other people already have (the social fixtures' people). */
  takenHandles: ['selin', 'elif', 'zeynep', 'ayse', 'deniz', 'ornek_stilist', 'ornek_editor'],
  /** `avatarUrl` stands in for the uploaded photo: the fixture shows the local file the user picked. */
  updateProfile: (request: UpdateProfileRequest, avatarUrl?: string | null): MyProfile => {
    if (request.handle !== state.profile.handle && accountFixtures.takenHandles.includes(request.handle)) {
      throw new ApiError('http', 409, { status: 409, code: 'handle_taken' });
    }
    state.profile = {
      ...state.profile,
      displayName: request.displayName,
      handle: request.handle,
      avatarUrl: avatarUrl === undefined ? state.profile.avatarUrl : avatarUrl,
      baseVersion: state.profile.baseVersion + 1,
    };
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
    if (state.palette === 'none') throw new ApiError('http', 404, { status: 404, code: 'palette_not_found' });
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
      { id: 'item_fuchsia_knit', name: 'Fuşya triko', imageUrl: null, category: 'top', color: 'pink' },
      { id: 'item_icy_shirt', name: 'Buz mavisi gömlek', imageUrl: null, category: 'top', color: 'blue' },
      { id: 'item_grey_coat', name: 'Soğuk gri kaban', imageUrl: null, category: 'outerwear', color: 'grey' },
    ],
  }),
};
