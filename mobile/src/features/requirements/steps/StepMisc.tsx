import { useQueryClient } from '@tanstack/react-query';
import { Check, MapPin, Search } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { useSession } from '@/auth/session';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useClaimHandle, useSaveProfileCity } from '@/features/account/mutations';
import { useCitySearch, useHandleAvailability, useMyProfile } from '@/features/account/queries';
import { AgeCheckbox } from '@/features/consent/AgeCheckbox';
import { useConfirmAge } from '@/features/consent/age';
import { creditSheetStore } from '@/features/credits/creditSheetStore';
import { aiCreditsKey } from '@/features/credits/useAiCredits';
import { useSelfPremium } from '@/entitlement/selfPremium';
import { useEntitlement } from '@/entitlement/useEntitlement';
import { useThemeColors } from '@/theme/useThemeColors';

import { requirementsFlow } from '../store';
import { StepBar, type StepProps } from './StepBar';
import { openPaywall } from '@/features/teen/TeenLocks';

function Heading({ title, body }: { title: string; body: string }) {
  return (
    <View className="gap-2">
      <Text variant="display" className="text-[30px] leading-[34px]" accessibilityRole="header">
        {title}
      </Text>
      <Text variant="body" tone="muted">
        {body}
      </Text>
    </View>
  );
}

/** Membership: the paywall, or — while the server switch is on — "Şimdilik ücretsiz etkinleştir" right here. */
export function StepPremium({ onDone }: StepProps) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const entitlement = useEntitlement();
  const self = useSelfPremium();
  const selfServe = entitlement.data?.selfServePremium?.enabled === true;
  return (
    <View className="flex-1" testID="requirements.step.premium">
      <ScrollView contentContainerClassName="gap-4 px-6 pb-6 pt-5">
        <Heading title={t('req.premium.title')} body={t('req.premium.body')} />
        {selfServe ? (
          <Text variant="caption" tone="muted">
            {t('req.premium.selfServeNote')}
          </Text>
        ) : null}
        {self.isError ? (
          <Text variant="caption" tone="danger" accessibilityRole="alert">
            {t('req.premium.selfServeFailed')}
          </Text>
        ) : null}
      </ScrollView>
      <StepBar>
        <Button
          label={t('req.premium.plans')}
          onPress={() => {
            requirementsFlow.close();
            openPaywall({ from: 'requirements' });
          }}
          testID="requirements.premium.plans"
        />
        {selfServe ? (
          <Button
            variant="secondary"
            size="md"
            label={t('req.premium.selfServe')}
            loading={self.isPending}
            onPress={() =>
              self.mutate(true, {
                onSuccess: () => {
                  void client.invalidateQueries({ queryKey: aiCreditsKey });
                  onDone();
                },
              })
            }
            testID="requirements.premium.selfServe"
          />
        ) : null}
      </StepBar>
    </View>
  );
}

/** No AI image left: the 05b credit sheet. */
export function StepCredits() {
  const { t } = useTranslation();
  return (
    <View className="flex-1" testID="requirements.step.credits">
      <ScrollView contentContainerClassName="gap-4 px-6 pb-6 pt-5">
        <Heading title={t('req.credits.title')} body={t('req.credits.body')} />
      </ScrollView>
      <StepBar>
        <Button
          label={t('req.credits.topUp')}
          onPress={() => {
            requirementsFlow.close();
            creditSheetStore.open('topUp');
          }}
          testID="requirements.credits.topUp"
        />
      </StepBar>
    </View>
  );
}

/** Profile city (canvas "Şehir · hava durumu"): inline search, or "Şehirsiz devam et". */
export function StepCity({ onDone }: StepProps) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const profile = useMyProfile();
  const saveCity = useSaveProfileCity();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null);
  const cities = useCitySearch(query);
  const searching = query.trim().length >= 2;
  return (
    <View className="flex-1" testID="requirements.step.city">
      <ScrollView contentContainerClassName="gap-4 px-6 pb-6 pt-5" keyboardShouldPersistTaps="handled">
        <Heading title={t('req.city.title')} body={t('req.city.body')} />
        <View className="gap-1.5">
          <Text variant="label">{t('req.city.label')}</Text>
          <View className="h-12 flex-row items-center gap-2 rounded-field border border-line bg-paper px-3">
            <Icon icon={Search} size={16} tone="muted" />
            <TextInput
              value={query}
              onChangeText={(v) => {
                setQuery(v);
                setChosen(null);
              }}
              placeholder={t('req.city.placeholder')}
              placeholderTextColor={colors.muted}
              autoCorrect={false}
              autoCapitalize="words"
              accessibilityLabel={t('req.city.label')}
              className="flex-1 font-sans text-body text-ink"
              testID="requirements.city.search"
            />
          </View>
        </View>
        {searching && cities.data ? (
          cities.data.length === 0 ? (
            <Text variant="caption" tone="muted">
              {t('req.city.none')}
            </Text>
          ) : (
            <View accessibilityRole="list">
              {cities.data.slice(0, 4).map((c) => {
                const selected = chosen?.id === c.id;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => setChosen({ id: c.id, name: c.name })}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={[c.name, c.region].filter(Boolean).join(', ')}
                    testID={`requirements.city.${c.id}`}
                    className="min-h-[48px] flex-row items-center gap-2 border-b border-line active:opacity-70"
                  >
                    <Icon icon={MapPin} size={16} tone="muted" />
                    <Text variant="bodyMedium">{c.name}</Text>
                    <Text variant="caption" tone="muted" className="flex-1" numberOfLines={1}>
                      {c.region ?? ''}
                    </Text>
                    {selected ? <Icon icon={Check} size={16} /> : null}
                  </Pressable>
                );
              })}
            </View>
          )
        ) : null}
      </ScrollView>
      <StepBar>
        <Button
          label={t('req.city.save')}
          disabled={!chosen || !profile.data}
          onPress={() => {
            if (!chosen || !profile.data) return;
            saveCity(chosen.id, profile.data.baseVersion);
            onDone();
          }}
          testID="requirements.city.save"
        />
        <Button
          variant="text"
          label={t('req.city.skip')}
          onPress={() => {
            requirementsFlow.declineCity();
            onDone();
          }}
          testID="requirements.city.skip"
        />
        <Text variant="caption" tone="muted" className="text-center text-[11.5px]">
          {t('req.city.skipNote')}
        </Text>
      </StepBar>
    </View>
  );
}

const AT = '@';

/** The backend handle rule: 3–30 characters, lowercase letters, digits, dot, underscore. */
export const HANDLE_RULE = /^[a-z0-9._]{3,30}$/;

export function normalizeHandle(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase();
}

/** Up to three handle ideas from the display name ("damla.k", "damlastil", "damla_dolap"). */
export function handleSuggestions(displayName: string): string[] {
  const base = displayName
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .split(/\s+/)
    .filter(Boolean);
  const first = (base[0] ?? '').replace(/[^a-z0-9]/g, '');
  if (first.length < 2) return [];
  const initial = (base[1] ?? '').replace(/[^a-z0-9]/g, '').slice(0, 1);
  return [initial ? `${first}.${initial}` : `${first}.style`, `${first}stil`, `${first}_dolap`].filter((h) => HANDLE_RULE.test(h));
}

/** @kullanıcı adı with the live availability check (`GET v1/tenant/profile/handle/availability`). */
export function StepHandle({ onDone }: StepProps) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const session = useSession();
  const claim = useClaimHandle();
  const [value, setValue] = useState('');
  const [debounced, setDebounced] = useState('');
  const handle = normalizeHandle(value);
  const valid = HANDLE_RULE.test(handle);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(handle), 350);
    return () => clearTimeout(timer);
  }, [handle]);
  const availability = useHandleAvailability(valid ? debounced : '');
  const checked = valid && debounced === handle && availability.data?.handle?.toLowerCase() === handle;
  const status: 'empty' | 'invalid' | 'checking' | 'taken' | 'reserved' | 'ok' =
    handle.length === 0
      ? 'empty'
      : !valid
        ? 'invalid'
        : !checked
          ? 'checking'
          : availability.data?.available
            ? 'ok'
            : availability.data?.code === 'handle_reserved'
              ? 'reserved'
              : availability.data?.code === 'handle_invalid'
                ? 'invalid'
                : 'taken';
  const message = status === 'ok' ? t('req.handle.available', { handle }) : t(`req.handle.${status}`);
  const name = session.status === 'signedIn' ? session.user.name : '';
  const ideas = handleSuggestions(name);

  return (
    <View className="flex-1" testID="requirements.step.handle">
      <ScrollView contentContainerClassName="gap-4 px-6 pb-6 pt-5" keyboardShouldPersistTaps="handled">
        <Heading title={t('req.handle.title')} body={t('req.handle.body')} />
        <View className="gap-1.5">
          <Text variant="label">{t('req.handle.label')}</Text>
          <View className={`h-12 flex-row items-center rounded-field border bg-paper px-3 ${status === 'taken' || status === 'invalid' || status === 'reserved' ? 'border-danger' : 'border-line'}`}>
            <Text variant="body" tone="muted">
              {AT}
            </Text>
            <TextInput
              value={value}
              onChangeText={setValue}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={31}
              accessibilityLabel={t('req.handle.label')}
              accessibilityHint={message}
              placeholderTextColor={colors.muted}
              className="flex-1 font-sans text-body text-ink"
              testID="requirements.handle.input"
            />
          </View>
          <Text variant="caption" tone={status === 'ok' ? 'ink' : status === 'checking' || status === 'empty' ? 'muted' : 'danger'} accessibilityLiveRegion="polite" testID="requirements.handle.status">
            {message}
          </Text>
        </View>
        {ideas.length > 0 ? (
          <View className="gap-2">
            <Text variant="label">{t('req.handle.suggestions')}</Text>
            <View className="flex-row flex-wrap gap-2">
              {ideas.map((idea) => (
                <Pressable
                  key={idea}
                  onPress={() => setValue(idea)}
                  accessibilityRole="button"
                  testID={`requirements.handle.idea.${idea}`}
                  className="h-chip justify-center rounded-pill border border-line px-[15px] active:opacity-70"
                >
                  <Text variant="chip">{idea}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        <Text variant="caption" tone="muted">
          {t('req.handle.rule')}
        </Text>
        {claim.isError ? (
          <Text variant="caption" tone="danger" accessibilityRole="alert">
            {t('req.handle.failed')}
          </Text>
        ) : null}
      </ScrollView>
      <StepBar>
        <Button
          label={t('req.handle.save')}
          disabled={status !== 'ok'}
          loading={claim.isPending}
          onPress={() => claim.mutate(handle, { onSuccess: onDone })}
          testID="requirements.handle.save"
        />
      </StepBar>
    </View>
  );
}

/** 18+ for an Apple / Google account that never confirmed (normally the app-level screen comes first). */
export function StepAge({ onDone }: StepProps) {
  const { t } = useTranslation();
  const confirm = useConfirmAge();
  const [checked, setChecked] = useState(false);
  return (
    <View className="flex-1" testID="requirements.step.age">
      <ScrollView contentContainerClassName="gap-4 px-6 pb-6 pt-5">
        <Heading title={t('req.step.age.title')} body={t('req.step.age.body')} />
        <AgeCheckbox checked={checked} onToggle={() => setChecked((c) => !c)} />
        {confirm.isError ? (
          <Text variant="caption" tone="danger" accessibilityRole="alert">
            {t('req.age.failed')}
          </Text>
        ) : null}
      </ScrollView>
      <StepBar>
        <Button label={t('req.age.confirm')} disabled={!checked} loading={confirm.isPending} onPress={() => confirm.mutate(undefined, { onSuccess: onDone })} testID="requirements.age.confirm" />
      </StepBar>
    </View>
  );
}
