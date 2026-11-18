/**
 * Droblet symbol, direction A: a drop whose inner space is a hanger hook.
 * Paths copied from the brand sources (mobile/assets/brand/icon.svg, canvas `Logo` / `LogoKullanim`).
 * Usage rules: ink on cream or cream on ink only; never stretched, rotated or recoloured.
 */
type SymbolProps = {
  /** Rendered width in px; the height follows the 36:42 ratio of the artwork. */
  width: number;
  /** Surface the symbol sits on — the hook is drawn in that colour. */
  surface?: 'cream' | 'sand';
  /** Canvas uses a slightly heavier hook at small sizes. */
  strokeWidth?: number;
  className?: string;
};

export function LogoSymbol({ width, surface = 'cream', strokeWidth = 2.4, className }: SymbolProps) {
  const height = Math.round((width * 42) / 36);
  return (
    <svg aria-hidden="true" width={width} height={height} viewBox="8 4 36 42" className={className}>
      <path d="M26 6C26 6 10 24 10 36a16 16 0 0 0 32 0C42 24 26 6 26 6z" className="fill-ink" />
      <path
        d="M23.4 27a2.7 2.7 0 1 1 3.8 2.5c-.8.3-1.2.9-1.2 1.7v1.5M26 32.7 15.8 40.6h20.4z"
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={surface === 'sand' ? 'stroke-sand' : 'stroke-cream'}
      />
    </svg>
  );
}

type WordmarkProps = { size?: 'header' | 'footer' };

/** Horizontal lockup: symbol + "Droblet" in Cormorant Garamond 500. */
export function Wordmark({ size = 'header' }: WordmarkProps) {
  return size === 'header' ? (
    <>
      <LogoSymbol width={24} />
      <span className="font-serif text-[28px] leading-none font-medium">Droblet</span>
    </>
  ) : (
    <>
      <LogoSymbol width={20} strokeWidth={2.6} />
      <span className="font-serif text-[24px] leading-none font-medium">Droblet</span>
    </>
  );
}
