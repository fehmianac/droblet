import { Info, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, View } from 'react-native';

import { useReduceMotion } from '@/hooks/useReduceMotion';

import { Icon } from './Icon';
import { Text } from './Text';

/** Small pill label ("Sonbahar", "Yakında", "Mağaza") — canvas `.badge`: 22 high, Jost 500 11. `accent` = filled espresso. */
export function Badge({ label, tone = 'sand', icon }: { label: string; tone?: 'sand' | 'accent' | 'ink'; icon?: LucideIcon }) {
  const filled = tone !== 'sand';
  return (
    <View
      className={`h-badge flex-row items-center gap-1 self-start rounded-pill px-2 ${
        tone === 'accent' ? 'bg-accent' : tone === 'ink' ? 'bg-ink' : 'bg-sand'
      }`}
    >
      {icon ? <Icon icon={icon} size={12} tone={filled ? 'paper' : 'ink'} /> : null}
      <Text variant="badge" tone={filled ? 'paper' : 'ink'} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Upper-case label sitting on an image ("OFİS", "ÖNİZLEME", "SENİN ÜZERİNDE") — canvas `.tag`: paper at 92 %,
 * radius 6, Jost 500 9.5 with 10 % tracking. The string must already be upper-case (translation file or
 * `toDisplayUpper`). Position it with `className` (the canvas default is `absolute bottom-2 left-2`).
 */
export function ImageTag({ label, className }: { label: string; className?: string }) {
  return (
    <View className={`self-start rounded-tag bg-paper/90 px-[7px] py-1 ${className ?? ''}`}>
      <Text variant="tag" tone="ink" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * "EKSİK PARÇA" marker on a piece the user does not own (canvas `.miss`): espresso, paper text, radius 6,
 * top-right of the image. `short` = "EKSİK" for 56-wide thumbnails. Position it with `className`.
 */
export function MissingTag({ short = false, className }: { short?: boolean; className?: string }) {
  const { t } = useTranslation();
  return (
    <View
      accessible
      accessibilityLabel={t('common.missingPiece')}
      className={`self-start rounded-tag bg-accent ${short ? 'px-1 py-0.5' : 'px-1.5 py-[3px]'} ${className ?? ''}`}
    >
      <Text variant="miss" tone="paper" numberOfLines={1} className={short ? 'text-[8px] leading-[10px]' : ''}>
        {t(short ? 'common.missingTagShort' : 'common.missingTag')}
      </Text>
    </View>
  );
}

/** Sand information box (canvas `.info`): icon + one or two calm sentences. */
export function InfoNote({ text, icon = Info }: { text: string; icon?: LucideIcon }) {
  return (
    <View className="flex-row items-start gap-2.5 rounded-image-lg bg-sand px-3.5 py-3">
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
        className="absolute min-w-[190px] rounded-menu border border-line bg-paper p-1.5 shadow-lg"
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
            className="min-h-icon-btn flex-row items-center gap-2.5 rounded-thumb px-3 active:opacity-70"
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
