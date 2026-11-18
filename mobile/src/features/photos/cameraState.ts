/**
 * What the in-app viewfinder (12 Parça ekle) can show:
 * `checking` — the permission has not been read yet;
 * `ask` — never asked: our reason + "Kamerayı aç", then the system dialog;
 * `denied` — explained, with the way to Settings (gallery, library and manual entry keep working);
 * `live` — the camera;
 * `unavailable` — no camera on this device (simulator, web): the shutter opens the system picker instead.
 */
export type CameraState = 'checking' | 'ask' | 'denied' | 'live' | 'unavailable';

export function cameraStateOf(permission: { granted: boolean; canAskAgain: boolean } | null, unavailable: boolean): CameraState {
  if (unavailable) return 'unavailable';
  if (!permission) return 'checking';
  if (permission.granted) return 'live';
  return permission.canAskAgain ? 'ask' : 'denied';
}
