import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

import { SIZES } from '@/api/contracts';
import { PRODUCT_SORTS, type ProductQuery } from '@/api/contracts/store';
import { SectionState } from '@/components/blocks/SectionState';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip, ChipWrap } from '@/components/ui/Chip';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';

import { clearSheetFilters, toggleValue as toggle } from './filters';
import { useBrands, useCatalogColors } from './queries';

type Props = {
  initial: ProductQuery;
  /** The size on the body profile, marked "senin bedenin". */
  profileSize: string | null;
  onApply: (next: ProductQuery) => void;
  onClose: () => void;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text variant="eyebrow">{title}</Text>
      {children}
    </View>
  );
}

/**
 * 21 "Filtrele" — ONE sheet for everything the Marka · Renk · Beden chips and the sort label open:
 * MARKA, RENK, BEDEN and SIRALAMA as chip groups (RENK is the server's list of colours the catalogue comes in), "Temizle" in the title row and "Sonuçları göster"
 * at the foot. Choices are a draft until "Sonuçları göster". Mounted only while open, so the draft
 * starts from the applied filters each time.
 */
export function FilterSheet({ initial, profileSize, onApply, onClose }: Props) {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const brands = useBrands();
  const colors = useCatalogColors();
  const [draft, setDraft] = useState(initial);

  return (
    <BottomSheet visible onClose={onClose}>
      <View className="gap-3.5" testID="filter-sheet">
        <View className="-mt-2 flex-row items-center justify-between">
          <Text variant="h3">{t('shop.filterTitle')}</Text>
          <Pressable
            onPress={() => setDraft(clearSheetFilters)}
            accessibilityRole="button"
            accessibilityLabel={t('shop.filterClear')}
            hitSlop={8}
            className="min-h-icon-btn justify-center active:opacity-70"
          >
            <Text variant="chip" className="underline">
              {t('shop.filterClear')}
            </Text>
          </Pressable>
        </View>

        {/* The four groups scroll when they do not fit (small phones, large text); the action stays in view. */}
        <ScrollView style={{ maxHeight: height * 0.56 }} contentContainerClassName="gap-3.5" showsVerticalScrollIndicator={false}>
          <Section title={t('shop.brandEyebrow')}>
            <SectionState
              query={brands}
              skeleton={<Skeleton className="h-chip w-full rounded-pill" />}
              isEmpty={(list) => list.length === 0}
              emptyText={t('shop.brandsEmpty')}
              inset={false}
            >
              {(list) => (
                <ChipWrap>
                  {list.map((b) => (
                    <Chip
                      key={b.id}
                      label={b.name}
                      selected={draft.brandIds.includes(b.id)}
                      onPress={() => setDraft((d) => ({ ...d, brandIds: toggle(d.brandIds, b.id) }))}
                    />
                  ))}
                </ChipWrap>
              )}
            </SectionState>
          </Section>

          <Section title={t('shop.colorEyebrow')}>
            <SectionState
              query={colors}
              skeleton={<Skeleton className="h-chip w-full rounded-pill" />}
              isEmpty={(list) => list.length === 0}
              emptyText={t('shop.colorsEmpty')}
              inset={false}
            >
              {(list) => (
                <ChipWrap>
                  {list.map((c) => (
                    <Chip
                      key={c.id}
                      label={c.name}
                      swatch={c.hex}
                      selected={draft.colors.includes(c.id)}
                      onPress={() => setDraft((d) => ({ ...d, colors: toggle(d.colors, c.id) }))}
                      testID={`filter.color.${c.id}`}
                    />
                  ))}
                </ChipWrap>
              )}
            </SectionState>
          </Section>

          <Section title={t('shop.sizeEyebrow')}>
            <ChipWrap>
              {SIZES.map((s) => (
                <Chip
                  key={s}
                  label={s === profileSize ? t('shop.yourSize', { size: s }) : s}
                  selected={draft.sizes.includes(s)}
                  onPress={() => setDraft((d) => ({ ...d, sizes: toggle(d.sizes, s) }))}
                />
              ))}
            </ChipWrap>
          </Section>

          <Section title={t('shop.sortEyebrow')}>
            <ChipWrap>
              {PRODUCT_SORTS.map((s) => (
                <Chip key={s} label={t(`shop.sort.${s}`)} selected={draft.sort === s} onPress={() => setDraft((d) => ({ ...d, sort: s }))} />
              ))}
            </ChipWrap>
          </Section>
        </ScrollView>

        <Button label={t('shop.showResults')} onPress={() => onApply(draft)} />
      </View>
    </BottomSheet>
  );
}
