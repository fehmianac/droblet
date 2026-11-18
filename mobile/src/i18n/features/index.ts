/**
 * Per-feature translation files. Each file owns its own top-level keys (no key may repeat one in
 * `../tr.json` or in another feature file — enforced by `features.test.ts`), so feature work does not
 * edit the shared `tr.json` / `en.json`. Everything is merged into the default namespace:
 * `t('items.title')` works exactly like `t('common.retry')`.
 */
import aiEn from './ai.en.json';
import aiTr from './ai.tr.json';
import enAccount from './en/account.json';
import enCommerce from './en/commerce.json';
import enSocial from './en/social.json';
import looksEn from './looks.en.json';
import looksTr from './looks.tr.json';
import stylistEn from './stylist.en.json';
import stylistTr from './stylist.tr.json';
import todayEn from './today.en.json';
import todayTr from './today.tr.json';
import trAccount from './tr/account.json';
import trCommerce from './tr/commerce.json';
import trSocial from './tr/social.json';
import wardrobeEn from './wardrobe.en.json';
import wardrobeTr from './wardrobe.tr.json';

export const featureFiles = {
  ai: { tr: aiTr, en: aiEn },
  today: { tr: todayTr, en: todayEn },
  wardrobe: { tr: wardrobeTr, en: wardrobeEn },
  looks: { tr: looksTr, en: looksEn },
  stylist: { tr: stylistTr, en: stylistEn },
  commerce: { tr: trCommerce, en: enCommerce },
  social: { tr: trSocial, en: enSocial },
  account: { tr: trAccount, en: enAccount },
} as const;

export const featuresTr = { ...aiTr, ...todayTr, ...wardrobeTr, ...looksTr, ...stylistTr, ...trCommerce, ...trSocial, ...trAccount };
export const featuresEn = { ...aiEn, ...todayEn, ...wardrobeEn, ...looksEn, ...stylistEn, ...enCommerce, ...enSocial, ...enAccount };
