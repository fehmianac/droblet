import { palettes, type ColorPalette } from './tokens';

/**
 * Raw colour values for props that cannot take a className (icon colours, spinners, native buttons).
 * Phase 1 is light-only; when a dark palette exists this hook picks it by colour scheme.
 */
export function useThemeColors(): ColorPalette {
  return palettes.light;
}
