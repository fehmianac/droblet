/**
 * Height of the look-tile strip. The whole offer (four benefits and both plan prices) must be readable
 * above the fixed footer without scrolling on a 844 pt iPhone; below 740 pt (iPhone SE: 667) the strip
 * shrinks further and the rest scrolls — the footer is a sibling of the scroll view, never laid over it,
 * so a price can never sit under the CTA.
 */
export function paywallHeroHeight(windowHeight: number, availableHeight: number = windowHeight): number {
  if (paywallCompact(windowHeight)) return 76;
  const base = windowHeight < 740 ? 136 : 176;
  // Opened as a page sheet (Profil › Üyelik, Ayarlar, requirement steps) the screen is shorter than the window by
  // the sheet's top gap: the strip gives that height back so both plans stay above the footer, as in the board.
  const lost = Math.max(0, windowHeight - availableHeight);
  return Math.max(76, Math.floor((base - lost) / 4) * 4);
}

/**
 * Below 700 pt (iPhone SE 3rd gen: 667) the plans still fell under the fixed footer — a price is only visible after
 * scrolling. Compact mode: the 76 pt strip, a 26 pt tagline, tighter gaps and the benefit titles without their second line, so the
 * benefits and both plans fit above the footer (checked on the SE simulator, Release build).
 */
export function paywallCompact(windowHeight: number): boolean {
  return windowHeight < 700;
}
