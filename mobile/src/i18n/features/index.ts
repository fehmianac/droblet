import enAccount from './en/account.json';
import enCommerce from './en/commerce.json';
import enSocial from './en/social.json';
import trAccount from './tr/account.json';
import trCommerce from './tr/commerce.json';
import trSocial from './tr/social.json';

/**
 * Per-feature translation files (Keşfet/mağaza/sepet · sosyal · profil/ayarlar/palet/kredi).
 * Their top-level keys are merged into the default `translation` namespace next to `tr.json` /
 * `en.json`, so screens keep using `t('cart.emptyTitle')`. Top-level keys must stay unique across
 * files (checked in `features.test.ts`).
 */
export const featureResources = {
  tr: { ...trCommerce, ...trSocial, ...trAccount },
  en: { ...enCommerce, ...enSocial, ...enAccount },
} as const;

export const featureFiles = {
  tr: { commerce: trCommerce, social: trSocial, account: trAccount },
  en: { commerce: enCommerce, social: enSocial, account: enAccount },
} as const;

export type FeatureTranslations = typeof trCommerce & typeof trSocial & typeof trAccount;
