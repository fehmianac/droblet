/**
 * Height of the look-tile strip. The whole offer (four benefits and both plan prices) must be readable
 * above the fixed footer without scrolling on a 844 pt iPhone; below 740 pt (iPhone SE: 667) the strip
 * shrinks further and the rest scrolls — the footer is a sibling of the scroll view, never laid over it,
 * so a price can never sit under the CTA.
 */
export function paywallHeroHeight(windowHeight: number): number {
  return windowHeight < 740 ? 136 : 176;
}
