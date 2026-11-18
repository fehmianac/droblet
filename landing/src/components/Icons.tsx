/** Inline line icons, 1.5 stroke on a 24 grid — the same drawing rules as the app. Decorative: always aria-hidden. */
type IconName = 'download' | 'lock' | 'trash' | 'visibility' | 'check' | 'open' | 'alert';

const paths: Record<IconName, React.ReactNode> = {
  download: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />,
  visibility: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  open: <path d="M14 5h5v5M19 5l-8 8M11 6H6v12h12v-5" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.2v.3" />
    </>
  ),
};

type IconProps = { name: IconName; size?: number; className?: string };

export function Icon({ name, size = 20, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {paths[name]}
    </svg>
  );
}
