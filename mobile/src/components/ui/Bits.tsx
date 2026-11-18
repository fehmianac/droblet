import { Info, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, View } from 'react-native';

import { useReduceMotion } from '@/hooks/useReduceMotion';

import { Icon } from './Icon';
import { Text } from './Text';

/** Small pill label ("Sonbahar", "Yakında", "Öneri: A"). `accent` = filled espresso. */
export function Badge({ label, tone = 'sand', icon }: { label: string; tone?: 'sand' | 'accent' | 'ink'; icon?: LucideIcon }) {
  const filled = tone !== 'sand';
  return (
    <View
      className={`h-7 flex-row items-center gap-1 self-start rounded-pill px-2.5 ${
        tone === 'accent' ? 'bg-accent' : tone === 'ink' ? 'bg-ink' : 'bg-sand'
      }`}
    >
      {icon ? <Icon icon={icon} size={13} tone={filled ? 'paper' : 'ink'} /> : null}
      <Text variant="caption" tone={filled ? 'paper' : 'ink'} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Upper-case label sitting on an image ("OFİS", "ÖNİZLEME", "ARKA PLAN YOK"). The string must already
 * be upper-case (translation file or `toDisplayUpper`). Position it with `className` (absolute …).
 */
export function ImageTag({ label, className }: { label: string; className?: string }) {
  return (
    <View className={`self-start rounded-pill bg-paper/90 px-2.5 py-1 ${className ?? ''}`}>
      <Text variant="eyebrow" tone="ink" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Sand information box: icon + one or two calm sentences. */
export function InfoNote({ text, icon = Info }: { text: string; icon?: LucideIcon }) {
  return (
    <View className="flex-row items-start gap-2.5 rounded-image-lg bg-sand p-3">
      <Icon icon={icon} size={18} />
      <Text variant="caption" className="flex-1">
        {text}
      </Text>
    </View>
  );
}

export type MenuAction = {
  key: string;
  label: string;
  icon?: LucideIcon;
  /** Destructive actions are danger-coloured and still carry their text + icon. */
  destructive?: boolean;
  onPress: () => void;
};

type MenuProps = {
  visible: boolean;
  onClose: () => void;
  actions: MenuAction[];
  /** Distance from the top / right edge of the screen to the menu (place it under its ⋯ button). */
  top: number;
  right?: number;
};

/** The ⋯ "more" menu: a small paper card under its trigger; tap outside closes it. */
export function PopoverMenu({ visible, onClose, actions, top, right = 20 }: MenuProps) {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onClose} statusBarTranslucent>
      <Pressable className="absolute inset-0" onPress={onClose} accessibilityRole="button" accessibilityLabel={t('a11y.close')} />
      <View
        accessibilityRole="menu"
        accessibilityViewIsModal
        className="absolute min-w-52 rounded-image-lg border border-line bg-paper py-1 shadow-sm"
        style={{ top, right }}
      >
        {actions.map((action) => (
          <Pressable
            key={action.key}
            accessibilityRole="menuitem"
            accessibilityLabel={action.label}
            onPress={() => {
              onClose();
              action.onPress();
            }}
            className="min-h-icon-btn flex-row items-center gap-3 px-4 active:opacity-70"
          >
            {action.icon ? <Icon icon={action.icon} size={18} tone={action.destructive ? 'danger' : 'ink'} /> : null}
            <Text variant="body" tone={action.destructive ? 'danger' : 'ink'} numberOfLines={1}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}
