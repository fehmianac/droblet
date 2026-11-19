import { useTranslation } from 'react-i18next';

import { toAppLanguage, type AppLanguage } from './index';

/**
 * The app language for components: re-renders on every switch (29). Never call `currentLanguage()`
 * in a component body — the React Compiler caches that call once per mount (it has no reactive
 * input), which is how the language switch stopped working after its first use.
 */
export function useAppLanguage(): AppLanguage {
  const { i18n } = useTranslation();
  return toAppLanguage(i18n.language);
}
