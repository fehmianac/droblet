import 'i18next';

import type { FeatureTranslations } from './features';
import type tr from './tr.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof tr & FeatureTranslations };
    returnNull: false;
  }
}
