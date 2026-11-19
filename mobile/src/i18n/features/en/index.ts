/**
 * The per-feature locale files of this language. Each file owns its own top-level keys; all of them
 * are merged into the default namespace by the language registry (`src/i18n/languages.ts`).
 * A new language copies this folder (same file names) and translates the JSON files.
 */
import account from './account.json';
import ai from './ai.json';
import commerce from './commerce.json';
import consent from './consent.json';
import detect from './detect.json';
import friends from './friends.json';
import looks from './looks.json';
import purchase from './purchase.json';
import requirements from './requirements.json';
import social from './social.json';
import stylist from './stylist.json';
import today from './today.json';
import wardrobe from './wardrobe.json';

const features = { ai, today, wardrobe, looks, stylist, commerce, social, account, friends, purchase, consent, detect, requirements };

export default features;
