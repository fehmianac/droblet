import { ChevronDown, CircleAlert, RotateCcw } from 'lucide-react-native';
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
import { surfaceTones } from '@/theme/tokens';

import { NAME_MAX, toItemFields, validateItemForm, type ItemFormValues } from './form';
import { ColorSwatch, ItemThumb } from './ItemThumb';
import { SeasonChips } from './parts';

/** Warm "check this" badge on a field the model was unsure about (canvas: `.badge` on #F3E3CF, ink text). */
export function CautionBadge({ label }: { label: string }) {
  return (
    <View className="h-badge flex-row items-center gap-1 self-start rounded-pill px-2" style={{ backgroundColor: surfaceTones.caution }}>
      <Icon icon={CircleAlert} size={12} />
      <Text variant="badge" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

type PickerRowProps = { label: string; value: string | null; placeholder: string; error?: string | null; warning?: string | null; onPress: () => void };

/** A field that opens a picker sheet; looks like a text field (canvas `.fld` + `.inp`), announced as a button. */
function PickerRow({ label, value, placeholder, error, warning, onPress }: PickerRowProps) {
  return (
    <View className="gap-1.5">
      <Text variant="label">{label}</Text>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={[label, value ?? placeholder, warning].filter(Boolean).join(', ')}
        accessibilityHint={error ?? undefined}
        className={`h-field flex-row items-center gap-2 rounded-field border bg-paper pl-3.5 pr-3 active:opacity-80 ${error ? 'border-danger' : 'border-line'}`}
      >
        <Text variant="body" tone={value ? 'ink' : 'muted'} className="flex-1 text-[15px]" numberOfLines={1}>
          {value ?? placeholder}
        </Text>
        <Icon icon={ChevronDown} size={18} tone="muted" />
      </Pressable>
      {warning ? <CautionBadge label={warning} /> : null}
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
  /** Manual entry with the user's own, unprocessed photo (kept when the free AI recognition ran out). */
  unprocessedPhoto?: boolean;
  onSubmit: (fields: ItemFields) => void;
};

/**
 * 12c Parça bilgisi — the review / edit form. In draft mode the values are the AI's guess and
 * nothing is saved until "Gardıroba kaydet". Rules: name, category and colour are required and at
 * least one season must be selected (save stays disabled, with the reason, until then).
 */
export function ItemForm({
  mode,
  initial,
  imageUrl,
  originalImageUrl,
  hasOriginalImage = false,
  lowConfidence = [],
  unprocessedPhoto = false,
  onSubmit,
}: Props) {
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
  // The tag says what is on screen: the photo as taken, or the background-removed one.
  const showsOriginal = values.useOriginalImage || (unprocessedPhoto && Boolean(picture));
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
      <ScrollView contentContainerClassName="gap-3 px-gutter pb-8 pt-1" keyboardShouldPersistTaps="handled">
        <View className="flex-row gap-3.5">
          <View>
            <ItemThumb
              category={values.category ?? 'top'}
              color={values.color ?? 'other'}
              uri={picture}
              className="h-[164px] w-[132px] rounded-image-lg"
              glyphSize={72}
              accessibilityLabel={t(showsOriginal ? 'itemForm.imageOriginalA11y' : 'itemForm.imageCleanA11y')}
            />
            {picture ? <ImageTag label={t(showsOriginal ? 'itemForm.originalTag' : 'itemForm.cleanTag')} className="absolute bottom-2 left-2" /> : null}
          </View>
          <View className="flex-1 gap-2">
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
              // Canvas: a chip with the "turn back" arrow, pinned to the bottom of the column.
              <Pressable
                onPress={() => set({ useOriginalImage: !values.useOriginalImage })}
                accessibilityRole="button"
                accessibilityLabel={t(values.useOriginalImage ? 'itemForm.useClean' : 'itemForm.useOriginal')}
                hitSlop={{ top: 4, bottom: 4 }}
                className="mt-auto h-chip flex-row items-center gap-1.5 self-start rounded-pill border border-line px-[15px] active:opacity-80"
                testID="item-form-image-toggle"
              >
                <Icon icon={RotateCcw} size={15} />
                <Text variant="chip" numberOfLines={1}>
                  {t(values.useOriginalImage ? 'itemForm.useClean' : 'itemForm.useOriginal')}
                </Text>
              </Pressable>
            ) : mode === 'manual' ? (
              <Text variant="caption" tone="muted">
                {t(unprocessedPhoto && picture ? 'itemForm.manualPhotoHint' : 'itemForm.manualHint')}
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
        {/* Canvas: Kategori | Marka, Beden | Renk in two columns (10 apart), Kumaş across. */}
        <View className="flex-row gap-2.5">
          <View className="flex-1">
            <PickerRow
              label={t('itemForm.category')}
              value={categoryLabel}
              placeholder={t('itemForm.choose')}
              error={errorText('category')}
              warning={lowConfidence.includes('category') ? t('itemForm.checkCategory') : null}
              onPress={() => setSheet('category')}
            />
          </View>
          <View className="flex-1">
            <TextField label={t('itemForm.brand')} placeholder={t('itemForm.optional')} value={values.brand} onChangeText={(brand) => set({ brand })} autoCorrect={false} />
          </View>
        </View>
        <View className="flex-row gap-2.5">
          <View className="flex-1">
            <TextField label={t('itemForm.size')} placeholder={t('itemForm.optional')} value={values.size} onChangeText={(size) => set({ size })} autoCapitalize="characters" autoCorrect={false} />
          </View>
          <View className="flex-1">
            <PickerRow
              label={t('itemForm.color')}
              value={values.color ? t(`itemColor.${values.color}`) : null}
              placeholder={t('itemForm.choose')}
              error={errorText('color')}
              warning={lowConfidence.includes('color') ? t('itemForm.checkField') : null}
              onPress={() => setSheet('color')}
            />
          </View>
        </View>
        {values.color === 'other' ? (
          <TextField
            label={t('itemForm.colorHex')}
            placeholder={t('itemForm.colorHexPlaceholder')}
            hint={t('itemForm.optional')}
            value={values.colorHex}
            onChangeText={(colorHex) => set({ colorHex })}
            error={errorText('colorHex')}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={7}
            testID="item-form-color-hex"
          />
        ) : null}
        <View className="gap-1.5">
          <TextField
            label={t('itemForm.fabric')}
            placeholder={t('itemForm.optional')}
            value={values.fabric}
            onChangeText={(fabric) => set({ fabric })}
            maxLength={60}
            testID="item-form-fabric"
          />
          {lowConfidence.includes('fabric') ? <CautionBadge label={t('itemForm.checkField')} /> : null}
        </View>

        <View className="gap-2">
          <View className="flex-row flex-wrap items-baseline gap-x-1.5">
            <Text variant="label">{t('itemForm.season')}</Text>
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
          size="lg"
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
            maxLength={40}
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
