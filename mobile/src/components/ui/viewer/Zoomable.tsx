import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View, type StyleProp, type ViewInstance, type ViewStyle } from 'react-native';

import { ImageViewer, type ViewerImage, type ViewerOrigin } from './ImageViewer';

type Props = {
  /** Every picture of the context (the suggestion's try-on + its piece photos, a look's images…). */
  images: ViewerImage[];
  /** Which of `images` this tile shows. */
  index?: number;
  /** Nothing to enlarge (a placeholder, a glyph): the children render as they are, not tappable. */
  disabled?: boolean;
  /** The tile's accessible name ("Gece Laciverti senin üzerinde"); without one the inner image's label is read. The hint "Büyüt" is added. */
  accessibilityLabel?: string;
  className?: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  testID?: string;
};

/**
 * A tile that opens the full-screen viewer (canvas 13a) on tap, growing from where it sits. Wrap any image
 * slot with it; pass every picture of the context so the viewer can page between them.
 */
export function Zoomable({ images, index = 0, disabled = false, accessibilityLabel, className, style, children, testID }: Props) {
  const { t } = useTranslation();
  const ref = useRef<ViewInstance>(null);
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<ViewerOrigin | null>(null);
  const usable = !disabled && images.length > 0 && index >= 0 && index < images.length;

  if (!usable) {
    return (
      <View className={className} style={style} testID={testID}>
        {children}
      </View>
    );
  }

  const openViewer = () => {
    const node = ref.current;
    if (!node || typeof node.measureInWindow !== 'function') {
      setOrigin(null);
      setOpen(true);
      return;
    }
    node.measureInWindow((x: number, y: number, width: number, height: number) => {
      setOrigin(width > 0 && height > 0 ? { x, y, width, height } : null);
      setOpen(true);
    });
  };

  return (
    <>
      <Pressable
        ref={ref}
        onPress={openViewer}
        accessibilityRole="imagebutton"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={t('viewer.enlargeHint')}
        className={className}
        style={style}
        testID={testID}
      >
        {children}
      </Pressable>
      <ImageViewer visible={open} images={images} initialIndex={index} origin={origin} onClose={() => setOpen(false)} />
    </>
  );
}
