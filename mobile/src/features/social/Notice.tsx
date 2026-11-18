import { Check, CircleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';

export type NoticeState = { text: string; tone: 'done' | 'problem' } | null;

/** How long a confirmation stays on screen. */
export const NOTICE_MS = 3200;

/**
 * A short confirmation that goes away by itself ("Link kopyalandı", "Şikayetin alındı"). The canvas
 * closes the sheet / menu without drawing one; this keeps the action from being silent. It is also
 * read out by the screen reader.
 */
export function useNotice(): { notice: NoticeState; show: (text: string, tone?: 'done' | 'problem') => void } {
  const [notice, setNotice] = useState<NoticeState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const show = useCallback((text: string, tone: 'done' | 'problem' = 'done') => {
    if (timer.current) clearTimeout(timer.current);
    setNotice({ text, tone });
    AccessibilityInfo.announceForAccessibility(text);
    timer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  return { notice, show };
}

/** Ink pill at the bottom of the screen (above the bottom menu when there is one). Icon + text, never colour alone. */
export function Notice({ notice }: { notice: NoticeState }) {
  if (!notice) return null;
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={notice.text}
      className="mx-gutter mb-2 min-h-icon-btn flex-row items-center gap-2.5 rounded-pill bg-ink px-4 py-2.5"
    >
      <Icon icon={notice.tone === 'done' ? Check : CircleAlert} size={18} tone="cream" />
      <Text variant="chip" tone="cream" className="flex-1">
        {notice.text}
      </Text>
    </View>
  );
}
