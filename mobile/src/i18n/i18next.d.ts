import 'i18next';

import type { LANGUAGES } from './languages';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    /** Keys are typed from the default language (Turkish); the parity test keeps the others identical. */
    resources: { translation: (typeof LANGUAGES)['tr']['resources'] };
    returnNull: false;
  }
}
