import 'i18next';

import type { featuresTr } from './features';
import type tr from './tr.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof tr & typeof featuresTr };
    returnNull: false;
  }
}
