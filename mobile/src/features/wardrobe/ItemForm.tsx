import { ChevronDown, CircleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { ITEM_CATEGORIES, ITEM_COLORS, type DraftField, type ItemFields } from '@/api/contracts/wardrobe';
import { Badge, ImageTag } from '@/components/ui/Bits';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip, ChipWrap } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';

import { NAME_MAX, toItemFields, validateItemForm, type ItemFormValues } from './form';
import { ColorSwatch, ItemThumb } from './ItemThumb';
import { SeasonChips } from './parts';

type PickerRowProps = { label: string; value: string | null; placeholder: string; error?: string | null; warning?: string | null; onPress: () => void };

/** A field that opens a picker sheet; looks like a text field, announced as a button. */
function PickerRow({ label, value, placeholder, error, warning, onPress }: PickerRowProps) {
  return (
    <View className="gap-1.5">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text variant="bodyMedium">{label}</Text>
        {warning ? <Badge label={warning} tone="accent" icon={CircleAlert} /> : null}
      </View>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={[label, value ?? placeholder, warning].filter(Boolean).join(', ')}
        accessibilityHint={error ?? undefined}
        className={`h-btn-primary flex-row items-center gap-2 rounded-field border bg-paper px-4 active:opacity-80 ${error ? 'border-danger' : 'border-line'}`}
      >
        <Text variant="body" tone={value ? 'ink' : 'muted'} className="flex-1" numberOfLines={1}>
          {value ?? placeholder}
        </Text>
        <Icon icon={ChevronDown} size={18} tone="muted" />
      </Pressable>
      {error ? <FieldError message={error} /> : null}
    </View>
  );
}

function FieldError({ message }: { message: string }) {
  return (
    <View className="flex-row items-center gap-1.5" accessibilityLiveRegion="polite">
      <Icon icon={CircleAlert} size={14} tone="danger" />
      <Text variant="caption" tone="danger" className="flex-1">
        {message}
      </Text>
    </View>
  );
}

type Props = {
  mode: 'draft' | 'edit' | 'manual';
  initial: ItemFormValues;
  /** Background-removed picture and the photo as taken; either may be missing. */
  imageUrl: string | null;
  originalImageUrl: string | null;
  /**
   * Edit mode on the API: the server keeps the photo as taken but sends one image URL (the one in
   * use), so "Orijinale dön" / "Temizlenmişi kullan" is offered without a second preview.
   */
  hasOriginalImage?: boolean;
  /** Draft mode: fields the model was unsure about. */
  lowConfidence?: DraftField[];
  onSubmit: (fields: ItemFields) => void;
};

/**
 * 12c Parça bilgisi — the review / edit form. In draft mode the values are the AI's guess and
 * nothing is saved until "Gardıroba kaydet". Rules: name, category and colour are required and at
 * least one season must be selected (save stays disabled, with the reason, until then).
 */
export function ItemForm({ mode, initial, imageUrl, originalImageUrl, hasOriginalImage = false, lowConfidence = [], onSubmit }: Props) {
  const { t } = useTranslation();
  const [values, setValues] = useState<ItemFormValues>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [sheet, setSheet] = useState<'none' | 'category' | 'color'>('none');
  const set = (patch: Partial<ItemFormValues>) => setValues((v) => ({ ...v, ...patch }));

  const errors = validateItemForm(values);
  const shown = submitted ? errors : {};
  const errorText = (key: keyof typeof errors) => (shown[key] ? t(`itemForm.errors.${shown[key]}`) : null);
  const noSeason = values.seasons.length === 0;

  const canToggleImage = Boolean(imageUrl && originalImageUrl && imageUrl !== originalImageUrl) || (hasOriginalImage && Boolean(imageUrl));
  const picture = values.useOriginalImage ? (originalImageUrl ?? imageUrl) : (imageUrl ?? originalImageUrl);
  const categoryLabel = values.category
    ? values.subcategory.trim()
      ? t('itemForm.categoryWithType', { category: t(`itemCategory.${values.category}`), type: values.subcategory.trim() })
      : t(`itemCategory.${values.category}`)
    : null;

  const suggestionBadges =
    mode === 'draft'
      ? [initial.subcategory || (initial.category ? t(`itemCategory.${initial.category}`) : ''), initial.color ? t(`itemColor.${initial.color}`) : '', initial.fabric].filter(Boolean)
      : [];

  const submit = () => {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    onSubmit(toItemFields(values));
  };

  return (
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerClassName="gap-5 px-gutter pb-8 pt-1" keyboardShouldPersistTaps="handled">
        <View className="flex-row gap-4">
          <View>
            <ItemThumb
              category={values.category ?? 'top'}
              color={values.color ?? 'other'}
              uri={picture}
              className="h-[150px] w-[120px] rounded-image-lg"
              glyphSize={56}
              accessibilityLabel={t(values.useOriginalImage ? 'itemForm.imageOriginalA11y' : 'itemForm.imageCleanA11y')}
            />
            {picture ? <ImageTag label={t(values.useOriginalImage ? 'itemForm.originalTag' : 'itemForm.cleanTag')} className="absolute bottom-2 left-2" /> : null}
          </View>
          <View className="flex-1 justify-center gap-2.5">
            {mode === 'draft' ? (
              <>
                <Text variant="eyebrow">{t('itemForm.aiEyebrow')}</Text>
                <View className="flex-row flex-wrap gap-1.5">
                  {suggestionBadges.map((label, i) => (
                    <Badge key={`${label}${i}`} label={label} />
                  ))}
                </View>
              </>
            ) : null}
            {canToggleImage ? (
              <View className="flex-row">
                <Chip
                  label={t(values.useOriginalImage ? 'itemForm.useClean' : 'itemForm.useOriginal')}
                  onPress={() => set({ useOriginalImage: !values.useOriginalImage })}
                />
              </View>
            ) : mode === 'manual' ? (
              <Text variant="caption" tone="muted">
                {t('itemForm.manualHint')}
              </Text>
            ) : null}
          </View>
        </View>

        <TextField
          label={t('itemForm.name')}
          value={values.name}
          onChangeText={(name) => set({ name })}
          error={errorText('name')}
          maxLength={NAME_MAX + 20}
          autoCapitalize="sentences"
          returnKeyType="next"
        />
        <PickerRow
          label={t('itemForm.category')}
          value={categoryLabel}
          placeholder={t('itemForm.choose')}
          error={errorText('category')}
          warning={lowConfidence.includes('category') ? t('itemForm.checkCategory') : null}
          onPress={() => setSheet('category')}
        />
        <TextField label={t('itemForm.brand')} placeholder={t('itemForm.optional')} value={values.brand} onChangeText={(brand) => set({ brand })} autoCorrect={false} />
        <TextField label={t('itemForm.size')} placeholder={t('itemForm.optional')} value={values.size} onChangeText={(size) => set({ size })} autoCapitalize="characters" autoCorrect={false} />
        <PickerRow
          label={t('itemForm.color')}
          value={values.color ? t(`itemColor.${values.color}`) : null}
          placeholder={t('itemForm.choose')}
          error={errorText('color')}
          warning={lowConfidence.includes('color') ? t('itemForm.checkField') : null}
          onPress={() => setSheet('color')}
        />
        <TextField label={t('itemForm.fabric')} placeholder={t('itemForm.optional')} value={values.fabric} onChangeText={(fabric) => set({ fabric })} />

        <View className="gap-2">
          <View className="flex-row flex-wrap items-baseline gap-x-1.5">
            <Text variant="bodyMedium">{t('itemForm.season')}</Text>
            <Text variant="caption" tone="muted">
              {t('itemForm.seasonHint')}
            </Text>
          </View>
          <SeasonChips value={values.seasons} onChange={(seasons) => set({ seasons })} />
          {noSeason ? <FieldError message={t('itemForm.errors.seasonRequired')} /> : null}
        </View>
      </ScrollView>

      <BottomActionBar>
        <Button
          label={t(mode === 'edit' ? 'itemForm.saveEdit' : 'itemForm.save')}
          onPress={submit}
          disabled={noSeason}
          accessibilityHint={noSeason ? t('itemForm.errors.seasonRequired') : undefined}
          testID="item-form-save"
        />
      </BottomActionBar>

      <BottomSheet visible={sheet === 'category'} onClose={() => setSheet('none')} title={t('itemForm.pickCategory')}>
        <View className="gap-4">
          <ChipWrap>
            {ITEM_CATEGORIES.map((c) => (
              <Chip key={c} label={t(`itemCategory.${c}`)} selected={values.category === c} onPress={() => set({ category: c })} />
            ))}
          </ChipWrap>
          <TextField
            label={t('itemForm.type')}
            placeholder={t('itemForm.typePlaceholder')}
            value={values.subcategory}
            onChangeText={(subcategory) => set({ subcategory })}
            hint={t('itemForm.optional')}
          />
          <Button label={t('common.ok')} onPress={() => setSheet('none')} />
        </View>
      </BottomSheet>

      <BottomSheet visible={sheet === 'color'} onClose={() => setSheet('none')} title={t('itemForm.pickColor')}>
        <View className="flex-row flex-wrap gap-y-2">
          {ITEM_COLORS.map((c) => {
            const selected = values.color === c;
            return (
              <Pressable
                key={c}
                onPress={() => {
                  set({ color: c });
                  setSheet('none');
                }}
                accessibilityRole="radio"
                accessibilityLabel={t(`itemColor.${c}`)}
                accessibilityState={{ selected }}
                className="min-h-icon-btn w-1/4 items-center gap-1 px-1 py-1"
              >
                <View className={`rounded-pill border-2 p-0.5 ${selected ? 'border-ink' : 'border-transparent'}`}>
                  <ColorSwatch color={c} size={32} />
                </View>
                <Text variant="caption" tone={selected ? 'ink' : 'muted'} numberOfLines={1}>
                  {t(`itemColor.${c}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>
    </KeyboardAvoidingView>
  );
}
