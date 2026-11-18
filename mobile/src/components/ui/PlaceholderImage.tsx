import { ImageSlot, type SlotPlaceholder } from './ImageSlot';

type Props = {
  uri?: string | null;
  className?: string;
  accessibilityLabel?: string;
  /** What stands in while there is no picture — see `ImageSlot`. Defaults to the canvas figure placeholder. */
  placeholder?: SlotPlaceholder;
};

/**
 * Image slot. Kept as the short name most screens use; it is `ImageSlot` — a missing or failed picture
 * is never an empty box. Size, aspect ratio and radius come from `className`.
 */
export function PlaceholderImage({ uri, className, accessibilityLabel, placeholder }: Props) {
  return <ImageSlot uri={uri} className={className} accessibilityLabel={accessibilityLabel} placeholder={placeholder} />;
}
