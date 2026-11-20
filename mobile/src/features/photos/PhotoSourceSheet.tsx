import { Camera, Image as ImageIcon, X } from 'lucide-react-native';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Text } from '@/components/ui/Text';

export type PhotoSourceGroup = {
  /** body | face — also the testID stem: `photoSource.<id>.camera` / `.library`. */
  id: 'body' | 'face' | 'outfit';
  /** Group heading ("Boy fotoğrafı"); omitted when the sheet holds one group (its title says it). */
  title?: string;
  /** Right of the heading ("1 / 3"). */
  meta?: string;
  caption: string;
  cameraLabel: string;
  /** Undefined hides the camera (blocked camera: the screen explains why; the library still works). */
  onCamera?: () => void;
  onLibrary: () => void;
  /** Ink camera button (the group the sheet is mostly for); otherwise both are outlined. */
  primary?: boolean;
  disabled?: boolean;
  /** Shown instead of the buttons' purpose when disabled ("Üç boy fotoğrafın var…"). */
  disabledNote?: string;
};

/**
 * 29h Fotoğraf ekle / 04c Fotoğraf kaynağı — every photo entry offers both sources, as the requirement photo step
 * does: "Fotoğraf çek" (or "Selfie çek") and "Galeriden seç". Several groups (Ayarlar › FOTOĞRAFLARIM: body and
 * face) stand side by side in a row each, split by a line; one group (onboarding 04's slots) stacks the two
 * buttons full width. The caller closes the sheet and runs its consent gate before the picker.
 */
export function PhotoSourceSheet({
  visible,
  onClose,
  eyebrow,
  title,
  groups,
  footnote,
}: {
  visible: boolean;
  onClose: () => void;
  eyebrow: string;
  title: string;
  groups: PhotoSourceGroup[];
  footnote?: string;
}) {
  const { t } = useTranslation();
  const single = groups.length === 1;
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View className="gap-4" testID="photoSource.sheet">
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1 gap-2">
            <Text variant="eyebrow">{eyebrow}</Text>
            <Text variant="h2" accessibilityRole="header">
              {title}
            </Text>
          </View>
          <IconButton icon={X} variant="plain" onPress={onClose} accessibilityLabel={t('a11y.close')} className="-mr-2.5 -mt-1.5" testID="photoSource.close" />
        </View>
        {groups.map((group, index) => (
          <Fragment key={group.id}>
            {index > 0 ? <View className="h-px bg-line" accessible={false} /> : null}
            <View className="gap-2" testID={`photoSource.${group.id}`}>
              {group.title ? (
                <View className="flex-row items-center justify-between gap-2">
                  <Text variant="bodyMedium" accessibilityRole="header">
                    {group.title}
                  </Text>
                  {group.meta ? (
                    <Text variant="caption" tone="muted">
                      {group.meta}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              <Text variant="caption" tone={group.disabled && group.disabledNote ? 'danger' : 'muted'} className="leading-[18px]">
                {group.disabled && group.disabledNote ? group.disabledNote : group.caption}
              </Text>
              <View className={single ? 'gap-2' : 'flex-row gap-2'}>
                {group.onCamera ? (
                  <Button
                    icon={Camera}
                    variant={group.primary ? 'primary' : 'secondary'}
                    size={single ? (group.primary ? 'lg' : 'md') : 'bar'}
                    label={group.cameraLabel}
                    onPress={group.onCamera}
                    disabled={group.disabled}
                    className={single ? undefined : 'flex-1 px-2.5'}
                    testID={`photoSource.${group.id}.camera`}
                  />
                ) : null}
                <Button
                  icon={ImageIcon}
                  variant="secondary"
                  size={single ? 'md' : 'bar'}
                  label={t('photoSource.library')}
                  onPress={group.onLibrary}
                  disabled={group.disabled}
                  className={single ? undefined : 'flex-1 px-2.5'}
                  testID={`photoSource.${group.id}.library`}
                />
              </View>
            </View>
          </Fragment>
        ))}
        {footnote ? (
          <Text variant="caption" tone="muted" className="text-[11.5px] leading-4">
            {footnote}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}
