import { Calendar, CircleAlert, MapPin, Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';

import { TRIP_MAX_DAYS, TRIP_TYPES, type City, type TripDetail, type TripType } from '@/api/contracts/trips';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { formatDate, parseLocalDate } from '@/lib/format';
import { useIsOnline } from '@/sync/network';
import { useThemeColors } from '@/theme/useThemeColors';

import { useCitySearch, type TripDraft } from './api';
import { DateRangePicker, todayIso, type DateRange, type RangeField } from './DateRangePicker';
import { CITY_QUERY_MIN, foldForSearch, validateTripDates } from './logic';

type Props = {
  /** Edit mode: the trip being changed. */
  initial?: TripDetail;
  submitLabel: string;
  onSubmit: (draft: TripDraft) => void;
};

function DateField({ label, value, onPress, error }: { label: string; value: string | null; onPress: () => void; error: boolean }) {
  const { t } = useTranslation();
  const text = value ? formatDate(parseLocalDate(value), { day: 'numeric', month: 'short' }) : t('tripNew.pickDate');
  return (
    <View className="flex-1 gap-1.5">
      <Text variant="label">{label}</Text>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t('tripNew.dateFieldLabel', { label, value: text })}
        className={`h-field flex-row items-center gap-2 rounded-field border bg-paper px-3.5 active:opacity-80 ${error ? 'border-danger' : 'border-line'}`}
      >
        <Icon icon={Calendar} size={17} tone="muted" />
        <Text variant="body" tone={value ? 'ink' : 'muted'} numberOfLines={1} className="flex-1">
          {text}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * "Yeni bavul" form (18): city autocomplete, departure / return dates, trip types and the
 * cabin-only option. Used inline on Bavullar and in the `trip/new` modal (create and edit).
 */
export function TripForm({ initial, submitLabel, onSubmit }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const online = useIsOnline();
  const [cityFocused, setCityFocused] = useState(false);
  const [city, setCity] = useState<City | null>(initial ? { id: initial.cityId, name: initial.cityName, region: initial.region } : null);
  const [query, setQuery] = useState(initial?.cityName ?? '');
  const [range, setRange] = useState<DateRange>({ start: initial?.startDate ?? null, end: initial?.endDate ?? null });
  const [types, setTypes] = useState<TripType[]>(initial?.tripTypes ?? []);
  const [cabinOnly, setCabinOnly] = useState(initial?.cabinOnly ?? false);
  const [picker, setPicker] = useState<RangeField | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const searching = city === null && foldForSearch(query).length >= CITY_QUERY_MIN;
  const cities = useCitySearch(searching ? query : '');
  const dateError = validateTripDates(range.start, range.end);
  const cityError = submitted && !city ? t('tripNew.cityRequired') : null;

  const submit = () => {
    setSubmitted(true);
    if (!city || dateError || !range.start || !range.end) return;
    onSubmit({ city, cityId: city.id, startDate: range.start, endDate: range.end, tripTypes: types, cabinOnly });
    if (!initial) {
      setCity(null);
      setQuery('');
      setRange({ start: null, end: null });
      setTypes([]);
      setCabinOnly(false);
      setSubmitted(false);
    }
  };

  return (
    <View className="gap-3">
      <View className="gap-1.5">
        <Text variant="label">{t('tripNew.city')}</Text>
        {/* Canvas 18: pin inside the field, ink border while the city is being typed. */}
        <View
          className={`h-field flex-row items-center gap-2 rounded-field border bg-paper px-3.5 ${
            cityError ? 'border-danger' : cityFocused || searching ? 'border-ink' : 'border-line'
          }`}
        >
          <Icon icon={MapPin} size={17} />
          <TextInput
            accessibilityLabel={t('tripNew.city')}
            accessibilityHint={cityError ?? city?.region}
            accessibilityState={{ expanded: searching }}
            placeholder={t('tripNew.cityPlaceholder')}
            placeholderTextColor={colors.muted}
            selectionColor={colors.accent}
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              if (city && text !== city.name) setCity(null);
            }}
            onFocus={() => setCityFocused(true)}
            onBlur={() => setCityFocused(false)}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="search"
            maxFontSizeMultiplier={1.6}
            className="h-full flex-1 font-sans text-[15px] text-ink"
          />
        </View>
        {cityError ? (
          <View className="flex-row items-center gap-1.5" accessibilityLiveRegion="polite">
            <Icon icon={CircleAlert} size={14} tone="danger" />
            <Text variant="caption" tone="danger" className="flex-1">
              {cityError}
            </Text>
          </View>
        ) : city?.region ? (
          <Text variant="caption" tone="muted">
            {city.region}
          </Text>
        ) : null}
        {searching ? (
          <View className="rounded-menu border border-line bg-paper p-1 shadow-lg" accessibilityRole="menu">
            {cities.data && cities.data.length > 0 ? (
              cities.data.map((c, index) => (
                <Pressable
                  key={c.id}
                  onPress={() => {
                    setCity(c);
                    setQuery(c.name);
                  }}
                  accessibilityRole="menuitem"
                  accessibilityLabel={t('tripNew.cityOption', { name: c.name, region: c.region })}
                  className="h-[52px] justify-center rounded-thumb px-3 active:opacity-70"
                >
                  <Text variant={index === 0 ? 'bodyMedium' : 'body'} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {c.region}
                  </Text>
                </Pressable>
              ))
            ) : cities.data ? (
              <Text variant="caption" tone="muted" className="px-3 py-2.5">
                {t('tripNew.cityNoResults')}
              </Text>
            ) : cities.status === 'error' ? (
              <Text variant="caption" tone="muted" className="px-3 py-2.5">
                {t('tripNew.citySearchFailed')}
              </Text>
            ) : !online || cities.fetchStatus === 'paused' ? (
              <Text variant="caption" tone="muted" className="px-3 py-2.5">
                {t('tripNew.cityOffline')}
              </Text>
            ) : (
              <View className="gap-2 px-3 py-2.5" accessible accessibilityLabel={t('a11y.loading')}>
                <Skeleton className="h-3 w-1/2 rounded-field" />
                <Skeleton className="h-3 w-2/3 rounded-field" />
              </View>
            )}
          </View>
        ) : null}
      </View>

      <View className="gap-1.5">
        <View className="flex-row gap-2.5">
          <DateField
            label={t('tripNew.depart')}
            value={range.start}
            onPress={() => setPicker('start')}
            error={submitted && dateError === 'startRequired'}
          />
          <DateField
            label={t('tripNew.return')}
            value={range.end}
            onPress={() => setPicker(range.start ? 'end' : 'start')}
            error={submitted && dateError !== null && dateError !== 'startRequired'}
          />
        </View>
        {submitted && dateError ? (
          <View className="flex-row items-center gap-1.5" accessibilityLiveRegion="polite">
            <Icon icon={CircleAlert} size={14} tone="danger" />
            <Text variant="caption" tone="danger" className="flex-1">
              {t(`tripNew.errors.${dateError}`, { count: TRIP_MAX_DAYS })}
            </Text>
          </View>
        ) : null}
      </View>

      <View className="gap-1.5">
        <Text variant="label">{t('tripNew.types')}</Text>
        <View className="flex-row flex-wrap gap-1.5">
          {TRIP_TYPES.map((type) => (
            <Chip
              key={type}
              label={t(`tripType.${type}`)}
              selected={types.includes(type)}
              onPress={() => setTypes((prev) => (prev.includes(type) ? prev.filter((x) => x !== type) : [...prev, type]))}
            />
          ))}
          <Chip label={t('tripNew.cabinOnly')} selected={cabinOnly} onPress={() => setCabinOnly((v) => !v)} />
        </View>
      </View>

      <Button label={submitLabel} icon={Sparkles} onPress={submit} testID="trip-submit" />

      <DateRangePicker field={picker} range={range} minDate={todayIso()} onChange={setRange} onClose={() => setPicker(null)} />
    </View>
  );
}
