import { MapPin } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { CLOSET_VISIBILITIES, type MyProfile } from '@/api/contracts/account';
import { apiErrorCode } from '@/api/errors';
import { Card } from '@/components/blocks/basics';
import { RadioRow } from '@/components/blocks/rows';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { useClaimHandle, useSaveDisplayName, useSaveProfileCity, useSetVisibility } from '@/features/account/mutations';
import { handleStatus, normaliseHandle } from '@/features/account/profileEdit';
import { useAccountSettings, useCitySearch, useHandleAvailability, useMyProfile } from '@/features/account/queries';
import { useIsOnline } from '@/sync/network';

/** @handle with a live (debounced) availability check; saving is online and interactive. */
function HandleSection({ profile }: { profile: MyProfile }) {
  const { t } = useTranslation();
  const online = useIsOnline();
  const [text, setText] = useState(profile.handle ?? '');
  const [checked, setChecked] = useState(normaliseHandle(profile.handle ?? ''));
  const claim = useClaimHandle();

  useEffect(() => {
    const timer = setTimeout(() => setChecked(normaliseHandle(text)), 400);
    return () => clearTimeout(timer);
  }, [text]);

  const value = normaliseHandle(text);
  const availability = useHandleAvailability(checked);
  const status = handleStatus({
    value,
    current: profile.handle,
    checked,
    availability: availability.data,
    checking: availability.isFetching || checked !== value,
    failed: availability.isError,
    saveError: apiErrorCode(claim.error),
  });

  const message: Record<typeof status.kind, string | null> = {
    idle: t('profileEdit.handleHint'),
    current: t('profileEdit.current'),
    checking: t('profileEdit.checking'),
    available: t('profileEdit.available', { handle: value }),
    taken: t('profileEdit.taken'),
    reserved: t('profileEdit.reserved'),
    invalid: t('profileEdit.invalid'),
    unknown: t('profileEdit.checkFailed'),
  };
  const isError = status.kind === 'taken' || status.kind === 'reserved' || status.kind === 'invalid';

  return (
    <View className="gap-2">
      <TextField
        label={t('profileEdit.handleLabel')}
        value={text}
        onChangeText={(next) => {
          claim.reset();
          setText(next.replace(/\s/g, ''));
        }}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={31}
        error={isError ? message[status.kind] : null}
        hint={isError ? undefined : (message[status.kind] ?? undefined)}
        testID="profileEdit.handle"
      />
      {claim.isSuccess && profile.handle === value ? (
        <Text variant="caption" tone="accent" accessibilityLiveRegion="polite">
          {t('profileEdit.handleSaved')}
        </Text>
      ) : null}
      <Button
        variant="secondary"
        label={t('profileEdit.saveHandle')}
        disabled={!online || !status.canSave}
        loading={claim.isPending}
        onPress={() => claim.mutate(value)}
        testID="profileEdit.saveHandle"
        className="self-start"
      />
    </View>
  );
}

function NameSection({ profile }: { profile: MyProfile }) {
  const { t } = useTranslation();
  const save = useSaveDisplayName();
  const [name, setName] = useState(profile.displayName);
  const [saved, setSaved] = useState(false);
  const trimmed = name.trim();

  return (
    <View className="gap-2">
      <TextField
        label={t('profileEdit.nameLabel')}
        value={name}
        onChangeText={(next) => {
          setSaved(false);
          setName(next);
        }}
        maxLength={60}
        autoCapitalize="words"
        error={trimmed === '' ? t('profileEdit.nameRequired') : null}
        testID="profileEdit.name"
      />
      {saved ? (
        <Text variant="caption" tone="accent" accessibilityLiveRegion="polite">
          {t('profileEdit.nameSaved')}
        </Text>
      ) : null}
      <Button
        variant="secondary"
        label={t('profileEdit.saveName')}
        disabled={trimmed === '' || trimmed === profile.displayName}
        onPress={() => {
          save(trimmed, profile.baseVersion);
          setSaved(true);
        }}
        testID="profileEdit.saveName"
        className="self-start"
      />
    </View>
  );
}

/** City for the weather on Bugün and the stylist: search `GET v1/weather/city`, pick, or remove. */
function CitySection({ profile }: { profile: MyProfile }) {
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
      <Text variant="bodyMedium">{t('profileEdit.cityLabel')}</Text>
      <View className="flex-row items-center gap-2">
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
          <Card>
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
                className={`min-h-icon-btn flex-row items-center gap-2 px-4 py-2 active:opacity-70 ${index === 0 ? '' : 'border-t border-line'}`}
              >
                <Text variant="bodyMedium" numberOfLines={1}>
                  {c.name}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1} className="flex-1">
                  {[c.region, c.country].filter(Boolean).join(', ')}
                </Text>
              </Pressable>
            ))}
          </Card>
        )
      ) : null}
    </View>
  );
}

function VisibilitySection({ profile }: { profile: MyProfile }) {
  const { t } = useTranslation();
  const setVisibility = useSetVisibility();
  return (
    <View className="gap-2">
      <Text variant="eyebrow">{t('profileEdit.visibilityLabel')}</Text>
      <Card>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('settings.visibilityLabel')}>
          {CLOSET_VISIBILITIES.map((v, index) => (
            <RadioRow
              key={v}
              first={index === 0}
              label={t(`settings.visibility.${v}`)}
              selected={profile.closetVisibility === v}
              onPress={() => {
                if (profile.closetVisibility !== v) setVisibility(v, profile.baseVersion);
              }}
            />
          ))}
        </View>
      </Card>
      <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
        {t(`profileEdit.visibilityNote.${profile.closetVisibility}`)}
      </Text>
    </View>
  );
}

/**
 * Profili düzenle (from Profil, and the one-time nudge after onboarding) — @handle with a live
 * availability check, display name, city (weather) and closet visibility.
 */
export default function ProfileEditScreen() {
  const { t } = useTranslation();
  const profile = useMyProfile();

  return (
    <Screen bottom>
      <ScreenHeader title={t('profileEdit.title')} leading="back" />
      <ScreenState
        query={profile}
        skeleton={
          <View className="gap-4 px-gutter pt-2">
            <Skeleton className="h-20 w-full rounded-field" />
            <Skeleton className="h-20 w-full rounded-field" />
            <Skeleton className="h-28 w-full rounded-card" />
          </View>
        }
      >
        {(data) => (
          <ScrollView contentContainerClassName="gap-7 px-gutter pb-10 pt-2" keyboardShouldPersistTaps="handled">
            <HandleSection profile={data} />
            <NameSection profile={data} />
            <CitySection profile={data} />
            <VisibilitySection profile={data} />
          </ScrollView>
        )}
      </ScreenState>
    </Screen>
  );
}
