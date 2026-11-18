import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { SIZES } from '@/api/contracts';
import { CATALOG_COLORS, PRODUCT_SORTS, type ProductQuery } from '@/api/contracts/store';
import { SectionState } from '@/components/blocks/SectionState';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip, ChipWrap } from '@/components/ui/Chip';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';

import { useBrands } from './queries';

export type FilterKind = 'brand' | 'color' | 'size' | 'sort';

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Number of active values for a filter chip ("Marka · 2"). */
export function filterCount(query: ProductQuery, kind: Exclude<FilterKind, 'sort'>): number {
  if (kind === 'brand') return query.brandIds.length;
  if (kind === 'color') return query.colors.length;
  return query.sizes.length;
}

type Props = {
  kind: FilterKind;
  initial: ProductQuery;
  /** The size on the body profile, marked "senin bedenin". */
  profileSize: string | null;
  onApply: (next: ProductQuery) => void;
  onClose: () => void;
};

/**
 * 21 filter sheets — Marka / Renk / Beden / Sıralama. Choices are a draft until "Sonuçları göster";
 * "Temizle" empties the dimension being edited. Mounted only while open, so the draft starts from
 * the applied filters each time.
 */
export function FilterSheet({ kind, initial, profileSize, onApply, onClose }: Props) {
  const { t } = useTranslation();
  const brands = useBrands();
  const [draft, setDraft] = useState(initial);

  const clear = () =>
    setDraft((d) => {
      if (kind === 'brand') return { ...d, brandIds: [] };
      if (kind === 'color') return { ...d, colors: [] };
      if (kind === 'size') return { ...d, sizes: [] };
      return { ...d, sort: 'newest' };
    });

  return (
    <BottomSheet visible onClose={onClose}>
      <View className="gap-5">
        <View className="flex-row items-center justify-between">
          <Text variant="h3">{t('shop.filterTitle')}</Text>
          <Button variant="text" label={t('shop.filterClear')} onPress={clear} />
        </View>

        {kind === 'brand' ? (
          <View className="gap-3">
            <Text variant="eyebrow">{t('shop.brandEyebrow')}</Text>
            <SectionState
              query={brands}
              skeleton={<Skeleton className="h-chip w-full rounded-pill" />}
              isEmpty={(list) => list.length === 0}
              emptyText={t('shop.empty')}
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
          </View>
        ) : null}

        {kind === 'color' ? (
          <View className="gap-3">
            <Text variant="eyebrow">{t('shop.colorEyebrow')}</Text>
            <ChipWrap>
              {CATALOG_COLORS.map((c) => (
                <Chip
                  key={c}
                  label={t(`shop.color.${c}`)}
                  selected={draft.colors.includes(c)}
                  onPress={() => setDraft((d) => ({ ...d, colors: toggle(d.colors, c) }))}
                />
              ))}
            </ChipWrap>
          </View>
        ) : null}

        {kind === 'size' ? (
          <View className="gap-3">
            <Text variant="eyebrow">{t('shop.sizeEyebrow')}</Text>
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
          </View>
        ) : null}

        {kind === 'sort' ? (
          <View className="gap-3">
            <Text variant="eyebrow">{t('shop.sortEyebrow')}</Text>
            <ChipWrap>
              {PRODUCT_SORTS.map((s) => (
                <Chip key={s} label={t(`shop.sort.${s}`)} selected={draft.sort === s} onPress={() => setDraft((d) => ({ ...d, sort: s }))} />
              ))}
            </ChipWrap>
          </View>
        ) : null}

        <Button label={t('shop.showResults')} onPress={() => onApply(draft)} />
      </View>
    </BottomSheet>
  );
}
