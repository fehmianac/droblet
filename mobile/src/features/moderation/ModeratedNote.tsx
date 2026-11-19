import { EyeOff } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { ContentModeration } from '@/api/contracts/wardrobe';
import { InfoNote } from '@/components/ui/Bits';

/**
 * The owner's note on content a moderator removed from everybody else (canvas 14b / 11 · "yalnızca sana görünüyor"):
 * the sand info note with the eye-off glyph. Nothing when the content is not hidden.
 */
export function ModeratedNote({ moderation, kind }: { moderation: ContentModeration | null | undefined; kind: 'look' | 'item' | 'profile' }) {
  const { t } = useTranslation();
  if (!moderation?.hidden) return null;
  return (
    <View testID={`moderated-note-${kind}`} accessibilityLiveRegion="polite">
      <InfoNote icon={EyeOff} text={t(`moderation.hiddenNote.${kind}`)} />
    </View>
  );
}
