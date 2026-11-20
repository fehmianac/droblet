import { ChevronRight, ScanSearch, Sparkles, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';

import { choiceOrder, highlightedChoice, type TryFirstChoice, type TryFirstEntry } from './tryFirst';

const ICONS: Record<TryFirstChoice, LucideIcon> = { tryOn: Sparkles, split: ScanSearch };

/** One option row (canvas `.opt`): 44 icon disc, title + one line, chevron; the highlighted one has the ink edge. */
function Option({ choice, highlighted, disabled, onPress }: { choice: TryFirstChoice; highlighted: boolean; disabled?: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={t(`tryFirst.${choice}`)}
      accessibilityHint={t(`tryFirst.${choice}Body`)}
      accessibilityState={{ disabled }}
      testID={`tryFirst.${choice}`}
      className={`min-h-[72px] flex-row items-center gap-3.5 rounded-[18px] bg-paper p-3.5 active:opacity-80 ${
        highlighted ? 'border-[1.5px] border-ink' : 'border border-line'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <View className={`h-11 w-11 items-center justify-center rounded-pill ${highlighted ? 'bg-ink' : 'bg-sand'}`}>
        <Icon icon={ICONS[choice]} size={20} tone={highlighted ? 'cream' : 'ink'} />
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <Text variant="bodyMedium" className="text-[15px]">
          {t(`tryFirst.${choice}`)}
        </Text>
        <Text variant="caption" tone="muted">
          {t(`tryFirst.${choice}Body`)}
        </Text>
      </View>
      <Icon icon={ChevronRight} size={18} tone="muted" />
    </Pressable>
  );
}

/** The two options of 12+ / 16g, highlighted one first. */
export function TryFirstOptions({ entry, onChoose, disabled }: { entry: TryFirstEntry; onChoose: (choice: TryFirstChoice) => void; disabled?: boolean }) {
  const highlighted = highlightedChoice(entry);
  return (
    <View className="gap-2.5" testID="tryFirst.options">
      {choiceOrder(entry).map((choice) => (
        <Option key={choice} choice={choice} highlighted={choice === highlighted} disabled={disabled} onPress={() => onChoose(choice)} />
      ))}
    </View>
  );
}

/**
 * 12+ "Bu fotoğrafla ne yapalım?" — over the picked photo on 12 Parça ekle: "Önce üzerimde dene" or "Parçalarına ayır",
 * one tap each (try-on then only asks for the credit). Nothing has been uploaded or recognised yet. "Vazgeç" goes back
 * to the viewfinder.
 */
export function TryFirstSheet({
  visible,
  entry,
  onChoose,
  onCancel,
}: {
  visible: boolean;
  entry: TryFirstEntry;
  onChoose: (choice: TryFirstChoice) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <BottomSheet visible={visible} onClose={onCancel}>
      <View className="gap-4 px-1 pb-1" testID="tryFirst.sheet">
        <View className="gap-1.5">
          <Text variant="eyebrow">{t('tryFirst.eyebrow')}</Text>
          <Text variant="h2" accessibilityRole="header">
            {t('tryFirst.title')}
          </Text>
          <Text variant="caption" tone="muted" className="leading-[18px]">
            {t('tryFirst.privacy')}
          </Text>
        </View>
        <TryFirstOptions entry={entry} onChoose={onChoose} />
        <Text variant="caption" tone="muted" className="text-[12px] leading-[17px]">
          {t('tryFirst.later')}
        </Text>
        <Button variant="text" label={t('common.cancel')} onPress={onCancel} testID="tryFirst.cancel" />
      </View>
    </BottomSheet>
  );
}
