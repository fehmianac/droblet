import { Check, CircleHelp } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { BODY_TYPES, SIZES, type BodyType, type Size } from '@/api/contracts';
import { useBodyProfile, useSaveBodyProfile } from '@/api/profile';
import { Button } from '@/components/ui/Button';
import { Chip, ChipWrap } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useThemeColors } from '@/theme/useThemeColors';

import { StepBar, type StepProps } from './StepBar';

/** Outline figures of the board (60 × 100 view box, head circle + body path). */
const FIGURES: Record<Exclude<BodyType, 'unsure'>, string> = {
  hourglass: 'M27 21C27 25 17 25 17 29C17 38 22 42 22 50C22 55 17 57 17 63L21 96H28.5L30 70L31.5 96H39L43 63C43 57 38 55 38 50C38 42 43 38 43 29C43 25 33 25 33 21',
  pear: 'M27 21C27 25 20 25 20 29C20 38 21.5 42 21.5 50C21.5 55 16 57 16 63L20 96H28.5L30 70L31.5 96H40L44 63C44 57 38.5 55 38.5 50C38.5 42 40 38 40 29C40 25 33 25 33 21',
  apple: 'M27 21C27 25 18 25 18 29C18 38 17 42 17 50C17 55 18 57 18 63L22 96H28.5L30 70L31.5 96H38L42 63C42 57 43 55 43 50C43 42 42 38 42 29C42 25 33 25 33 21',
  rectangle: 'M27 21C27 25 18 25 18 29C18 38 19 42 19 50C19 55 18 57 18 63L22 96H28.5L30 70L31.5 96H38L42 63C42 57 41 55 41 50C41 42 42 38 42 29C42 25 33 25 33 21',
  inverted_triangle: 'M27 21C27 25 15 25 15 29C15 38 20 42 20 50C20 55 19.5 57 19.5 63L23.5 96H28.5L30 70L31.5 96H36.5L40.5 63C40.5 57 40 55 40 50C40 42 45 38 45 29C45 25 33 25 33 21',
};

function Figure({ type, color }: { type: BodyType; color: string }) {
  if (type === 'unsure') {
    return (
      <View className="h-[74px] w-11 items-center justify-center">
        <Icon icon={CircleHelp} size={30} />
      </View>
    );
  }
  return (
    <Svg width={44} height={74} viewBox="0 0 60 100" fill="none" stroke={color} strokeWidth={1.3} strokeLinejoin="round" strokeLinecap="round">
      <Circle cx={30} cy={12} r={7} />
      <Path d={FIGURES[type]} />
    </Svg>
  );
}

/**
 * Canvas 11e "Vücut tipi" — six choices (Emin değilim included), the description of the chosen one, height and
 * size from the profile (asked here when there is no body profile yet), saved once to the body profile.
 */
export function StepBodyType({ onDone }: StepProps) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const profile = useBodyProfile();
  const save = useSaveBodyProfile();
  const existing = profile.data ?? null;
  // Never pre-selected: a neutral choice the user makes ("Emin değilim" included). Only a saved body type is shown ticked.
  const [type, setType] = useState<BodyType | null>(existing?.bodyType ?? null);
  const [height, setHeight] = useState(existing ? String(existing.heightCm) : '');
  const [size, setSize] = useState<Size>(existing?.size ?? 'M');
  const [touched, setTouched] = useState(false);

  // Prefill once the profile arrives (render-time adjustment).
  const [prefilled, setPrefilled] = useState(existing !== null);
  if (!prefilled && existing) {
    setPrefilled(true);
    if (!touched) {
      setHeight(String(existing.heightCm));
      setSize(existing.size);
      if (existing.bodyType) setType(existing.bodyType);
    }
  }

  const descLine = type ? ` · ${t(`req.bodyType.desc.${type}`)}` : '';
  const heightCm = Number.parseInt(height, 10);
  const heightOk = Number.isFinite(heightCm) && heightCm >= 100 && heightCm <= 230;

  const submit = () => {
    setTouched(true);
    if (!heightOk || type === null) return;
    save.save({ heightCm, weightKg: existing?.weightKg ?? null, size, bodyType: type, baseVersion: existing?.baseVersion ?? 0 });
    onDone();
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1" testID="requirements.step.bodyType">
      {/* Taps outside a field close the keyboard ("handled"); dragging the list closes it too. */}
      <ScrollView contentContainerClassName="gap-4 px-6 pb-6 pt-5" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <View className="gap-2">
          <Text variant="display" className="text-[30px] leading-[34px]" accessibilityRole="header">
            {t('req.bodyType.title')}
          </Text>
          <Text variant="body" tone="muted">
            {t('req.bodyType.lead')}
          </Text>
        </View>
        <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup" accessibilityLabel={t('req.bodyType.groupLabel')}>
          {BODY_TYPES.map((id) => {
            const selected = id === type;
            return (
              <Pressable
                key={id}
                onPress={() => {
                  setTouched(true);
                  setType(id);
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={t(`req.bodyType.types.${id}`)}
                testID={`requirements.bodyType.${id}`}
                className={`h-[124px] w-[31.5%] items-center justify-center gap-1.5 rounded-card px-1 py-2 active:opacity-80 ${
                  selected ? 'border-[1.5px] border-ink bg-paper' : id === 'unsure' ? 'border-[1.5px] border-dashed border-muted' : 'border border-line'
                }`}
              >
                <Figure type={id} color={colors.ink} />
                <Text variant="bodyMedium" className="text-center text-[13px]" numberOfLines={1}>
                  {t(`req.bodyType.types.${id}`)}
                </Text>
                {selected ? (
                  <View className="absolute right-2 top-2 h-5 w-5 items-center justify-center rounded-pill bg-ink">
                    <Icon icon={Check} size={12} tone="cream" />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        <Text variant="caption" tone={type ? 'ink' : 'muted'} className="min-h-9 leading-[18px]" accessibilityLiveRegion="polite" testID="requirements.bodyType.desc">
          {type ? (
            <Text variant="caption" className="font-sans-medium">
              {t(`req.bodyType.types.${type}`)}
            </Text>
          ) : (
            t('req.bodyType.choose')
          )}
          {descLine}
        </Text>
        <TextField
          label={existing ? `${t('req.bodyType.height')} · ${t('req.bodyType.fromProfile')}` : t('req.bodyType.height')}
          value={height}
          onChangeText={(v) => {
            setTouched(true);
            setHeight(v.replace(/[^0-9]/g, '').slice(0, 3));
          }}
          keyboardType="number-pad"
          error={touched && !heightOk ? t('req.bodyType.heightError') : null}
          testID="requirements.bodyType.height"
        />
        <View className="gap-2">
          <Text variant="label">{existing ? `${t('req.bodyType.size')} · ${t('req.bodyType.fromProfile')}` : t('req.bodyType.size')}</Text>
          <ChipWrap>
            {SIZES.map((s) => (
              <Chip
                key={s}
                label={s}
                selected={s === size}
                onPress={() => {
                  setTouched(true);
                  setSize(s);
                }}
                testID={`requirements.bodyType.size.${s}`}
              />
            ))}
          </ChipWrap>
        </View>
        <Text variant="caption" tone="muted">
          {t('req.bodyType.note')}
        </Text>
      </ScrollView>
      <StepBar>
        <Button label={t('req.bodyType.save')} onPress={submit} disabled={type === null} testID="requirements.bodyType.save" />
      </StepBar>
    </KeyboardAvoidingView>
  );
}
