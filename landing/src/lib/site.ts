/**
 * Build-time configuration. Everything comes from NEXT_PUBLIC_* variables (inlined by Next at build);
 * no URL is written in a component. An empty variable is a supported state, not an error.
 */

function clean(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

function httpUrl(value: string | undefined): string {
  const url = clean(value);
  return /^https?:\/\//i.test(url) ? url : '';
}

/** Public origin, no trailing slash. The fallback is the domain the deploy workflow publishes to. */
export const siteUrl = httpUrl(process.env.NEXT_PUBLIC_SITE_URL) || 'https://droplet.alatech.co';

/** Host shown in the footer ("droplet.alatech.co"). */
export const siteHost = siteUrl.replace(/^https?:\/\//i, '');

/** API origin, no trailing slash. Empty: account deletion and password reset show "unavailable". */
export const apiBaseUrl = httpUrl(process.env.NEXT_PUBLIC_API_BASE_URL);

/** Store listings. Empty: the button renders disabled with "Yakında". */
export const appStoreUrl = httpUrl(process.env.NEXT_PUBLIC_APP_STORE_URL);
export const playStoreUrl = httpUrl(process.env.NEXT_PUBLIC_PLAY_STORE_URL);

const email = (process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? '').trim();
/** Footer contact address. Empty: the link is not rendered. */
export const contactEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';

/** Custom URL scheme of the mobile app (mobile/app.config.ts). */
export const appScheme = 'droplet';

/** Where each store lets a user manage subscriptions. */
export const appleSubscriptionsUrl = 'https://apps.apple.com/account/subscriptions';
export const googleSubscriptionsUrl = 'https://play.google.com/store/account/subscriptions';

export function absoluteUrl(path: string): string {
  return `${siteUrl}${path.startsWith('/') ? path : `/${path}`}`;
}
