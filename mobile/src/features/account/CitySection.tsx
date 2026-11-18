import { MapPin } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { MyProfile } from '@/api/contracts/account';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';

import { useSaveProfileCity } from './mutations';
import { useAccountSettings, useCitySearch } from './queries';
import { RowCard } from './rows';

/**
 * The profile city (weather on Bugün, the stylist) on "Profili düzenle": search `GET v1/weather/city`,
 * pick, or remove. Saved at once as a partial, queued `PUT v1/tenant/profile { cityId }` (`""` clears).
 */
export function CitySection({ profile }: { profile: MyProfile }) {
  const { t } = useTranslation();
  const settings = useAccountSettings();
  const saveCity = useSaveProfileCity();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const cities = useCitySearch(query);
  const current = chosen ?? (profile.cityId ? (settings.data?.city?.name ?? null) : null);
  const searching = query.trim().length >= 2;

  return (
    <View className="gap-2">
      <Text variant="label">{t('profileEdit.cityLabel')}</Text>
      <View className="min-h-icon-btn flex-row items-center gap-2">
        <Icon icon={MapPin} size={16} tone="muted" />
        <Text variant="body" tone={current ? 'ink' : 'muted'} className="flex-1" numberOfLines={1}>
          {current ?? t('profileEdit.cityNone')}
        </Text>
        {profile.cityId ? (
          <Button
            variant="text"
            label={t('profileEdit.cityClear')}
            onPress={() => {
              setChosen(null);
              saveCity('', profile.baseVersion);
            }}
            testID="profileEdit.cityClear"
          />
        ) : null}
      </View>
      <TextField
        label={t('profileEdit.citySearch')}
        value={query}
        onChangeText={setQuery}
        hint={t('profileEdit.cityHint')}
        autoCorrect={false}
        autoCapitalize="words"
        returnKeyType="search"
        testID="profileEdit.citySearch"
      />
      {searching ? (
        cities.isError ? (
          <View className="items-start">
            <Text variant="caption" tone="muted">
              {t('profileEdit.cityError')}
            </Text>
            <Button variant="text" label={t('common.retry')} onPress={() => void cities.refetch()} className="-ml-2" />
          </View>
        ) : cities.data === undefined ? (
          <Skeleton className="h-12 w-full rounded-field" />
        ) : cities.data.length === 0 ? (
          <Text variant="caption" tone="muted">
            {t('profileEdit.cityEmpty')}
          </Text>
        ) : (
          <RowCard>
            {cities.data.map((c, index) => (
              <Pressable
                key={c.id}
                onPress={() => {
                  setChosen(c.name);
                  setQuery('');
                  saveCity(c.id, profile.baseVersion);
                }}
                accessibilityRole="button"
                accessibilityLabel={[c.name, c.region, c.country].filter(Boolean).join(', ')}
                testID={`profileEdit.city.${c.id}`}
                className={`min-h-icon-btn flex-row items-center gap-2 py-2 active:opacity-70 ${index === 0 ? '' : 'border-t border-line'}`}
              >
                <Text variant="bodyMedium" numberOfLines={1}>
                  {c.name}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1} className="flex-1">
                  {[c.region, c.country].filter(Boolean).join(', ')}
                </Text>
              </Pressable>
            ))}
          </RowCard>
        )
      ) : null}
    </View>
  );
}
