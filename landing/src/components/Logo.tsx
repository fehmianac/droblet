/**
 * Droblet symbol, direction B ("askı monogramı"): a "D" drawn from a hanger curve, a small drop in its
 * counter, in a rounded square. Geometry copied 1:1 from the canvas board `Logo.dc.html` (column B) —
 * the same paths as mobile/src/components/brand/logoPaths.ts.
 * Usage rules: ink tile on light surfaces, cream tile on ink; never stretched, rotated or recoloured.
 */
type SymbolProps = {
  /** Rendered width (= height) in px. */
  width: number;
  /** 'ink' = ink tile, cream D, light espresso drop (light surfaces, default); 'cream' = reversed, for ink surfaces. */
  tone?: 'ink' | 'cream';
  className?: string;
};

export function LogoSymbol({ width, tone = 'ink', className }: SymbolProps) {
  const ink = tone === 'ink';
  return (
    <svg aria-hidden="true" width={width} height={width} viewBox="6 10 44 44" className={className}>
      <rect x="6" y="10" width="44" height="44" rx="12" className={ink ? 'fill-ink' : 'fill-cream'} />
      <path
        d="M20 22v20h6.5a10 10 0 0 0 0-20H20M20 22c0-3 1.6-5 4-5.4"
        fill="none"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={ink ? 'stroke-cream' : 'stroke-ink'}
      />
      <path d="M27 27c0 0-3.2 3.6-3.2 6a3.2 3.2 0 0 0 6.4 0c0-2.4-3.2-6-3.2-6z" fill={ink ? '#B49A80' : '#6E5640'} />
    </svg>
  );
}

type WordmarkProps = { size?: 'header' | 'footer' };

/** Horizontal lockup: symbol + "Droblet" in Cormorant Garamond 500 (canvas proportions: mark 1.1 × the type size). */
export function Wordmark({ size = 'header' }: WordmarkProps) {
  return size === 'header' ? (
    <>
      <LogoSymbol width={31} />
      <span className="font-serif text-[28px] leading-none font-medium">Droblet</span>
    </>
  ) : (
    <>
      <LogoSymbol width={26} />
      <span className="font-serif text-[24px] leading-none font-medium">Droblet</span>
    </>
  );
}
