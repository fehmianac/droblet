import { ChevronRight, Images, Plus, X, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Text } from '@/components/ui/Text';

import { useImportLimits } from './api';

function Option({ icon, title, body, onPress, testID }: { icon: LucideIcon; title: string; body: string; onPress: () => void; testID: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}`}
      className="min-h-[72px] flex-row items-center gap-3.5 rounded-image-lg border border-line bg-paper px-3.5 py-3 active:opacity-80"
      testID={testID}
    >
      <View className="h-11 w-11 items-center justify-center rounded-[12px] bg-sand">
        <Icon icon={icon} size={20} />
      </View>
      <View className="flex-1 gap-[3px]">
        <Text variant="bodyMedium">{title}</Text>
        <Text variant="caption" tone="muted">
          {body}
        </Text>
      </View>
      <Icon icon={ChevronRight} size={18} />
    </Pressable>
  );
}

/** 14a Looklar "+" — "Look oluştur" or "Kombinlerini içe aktar" (the photo limit is the plan's, from the server). */
export function LooksAddSheet({ visible, onClose, onCreate, onImport }: { visible: boolean; onClose: () => void; onCreate: () => void; onImport: () => void }) {
  const { t } = useTranslation();
  const limits = useImportLimits();
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View className="gap-3.5" testID="looks.addSheet">
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1 gap-2 pt-1.5">
            <Text variant="eyebrow">{t('outfitImport.menu.eyebrow')}</Text>
            <Text variant="h2" accessibilityRole="header">
              {t('outfitImport.menu.title')}
            </Text>
          </View>
          <IconButton icon={X} variant="plain" onPress={onClose} accessibilityLabel={t('a11y.close')} className="-mr-2.5" />
        </View>
        <Option icon={Plus} title={t('outfitImport.menu.create')} body={t('outfitImport.menu.createBody')} onPress={onCreate} testID="looks.addSheet.create" />
        <Option
          icon={Images}
          title={t('outfitImport.menu.import')}
          body={limits.maxPhotos ? t('outfitImport.menu.importBody', { max: limits.maxPhotos }) : t('outfitImport.menu.importBodyNoMax')}
          onPress={onImport}
          testID="looks.addSheet.import"
        />
      </View>
    </BottomSheet>
  );
}
