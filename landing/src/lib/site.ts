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
export const siteUrl = httpUrl(process.env.NEXT_PUBLIC_SITE_URL) || 'https://droblet.alatech.co';

/** Host shown in the footer ("droblet.alatech.co"). */
export const siteHost = siteUrl.replace(/^https?:\/\//i, '');

/** API origin, no trailing slash. Empty: account deletion and password reset show "unavailable". */
export const apiBaseUrl = httpUrl(process.env.NEXT_PUBLIC_API_BASE_URL);

/**
 * Draft flag of the teen parental-consent page (`/parent-consent/`, docs/api/teen.md §9). Its legal wording is a draft
 * pending lawyer approval: unless the variable is exactly "1", the page renders only "not available yet" and none of
 * the notice / checkbox texts reach the exported HTML or the client.
 */
export const teenParentConsentEnabled = (process.env.NEXT_PUBLIC_TEEN_PARENT_CONSENT ?? '').trim() === '1';

/** Store listings. Empty: the button renders disabled with "Yakında". */
export const appStoreUrl = httpUrl(process.env.NEXT_PUBLIC_APP_STORE_URL);
export const playStoreUrl = httpUrl(process.env.NEXT_PUBLIC_PLAY_STORE_URL);

const email = (process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? '').trim() || 'info@alatech.co';
/** Footer contact address (the company's, unless the build overrides it). */
export const contactEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';

/** Custom URL scheme of the mobile app (mobile/app.config.ts). */
export const appScheme = 'droplet';

/** Where each store lets a user manage subscriptions. */
export const appleSubscriptionsUrl = 'https://apps.apple.com/account/subscriptions';
export const googleSubscriptionsUrl = 'https://play.google.com/store/account/subscriptions';

export function absoluteUrl(path: string): string {
  return `${siteUrl}${path.startsWith('/') ? path : `/${path}`}`;
}
