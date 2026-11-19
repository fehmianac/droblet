import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, Share, View } from 'react-native';

import { legalUrls, linkDomain } from '@/api/config';
import { ApiError } from '@/api/errors';
import { recordOf, useConsents, useSaveConsents } from '@/features/consent/api';
import { ConsentBlock } from '@/features/consent/ConsentSheet';
import { Card } from '@/components/blocks/basics';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { StateMessage } from '@/components/ui/StateMessage';
import { Text } from '@/components/ui/Text';
import { requestContactsPermission, useContactMatches, useRunContactMatch } from '@/features/social/contacts';
import { useHandleGate } from '@/features/requirements/useHandleGate';
import { FollowChip, PeopleSkeleton, PersonListRow } from '@/features/social/PeopleRows';
import { useInviteLink } from '@/features/social/queries';
import { useIsOnline } from '@/sync/network';

type Phase = 'consent' | 'denied' | 'run';

function privacyUrl(): string {
  return legalUrls().privacy ?? `https://${linkDomain()}/privacy`;
}

function Bullet({ children }: { children: string }) {
  return (
    <View className="flex-row gap-2">
      <Text variant="body" tone="accent">
        •
      </Text>
      <Text variant="body" className="flex-1">
        {children}
      </Text>
    </View>
  );
}

/**
 * 27 — Rehberinden arkadaş bul (owner decision 13). Explicit consent first (what is sent: salted
 * SHA-256 hashes of normalised e-mail addresses only; nothing stored), only then the system contacts
 * permission. Hashing runs on the phone; the result is shown here and kept in memory only.
 */
export default function ContactsMatchScreen() {
  const { t } = useTranslation();
  const online = useIsOnline();
  const [phase, setPhase] = useState<Phase>('consent');
  const [canAskAgain, setCanAskAgain] = useState(true);
  const run = useRunContactMatch();
  const matches = useContactMatches();
  const invite = useInviteLink();
  const withHandle = useHandleGate();
  const consents = useConsents();
  const saveConsent = useSaveConsents();
  /** Explicit consent 4: an unticked box; a consent recorded earlier shows as given. */
  const given = recordOf(consents.data, 'contacts')?.valid === true;
  const [ticked, setTicked] = useState(false);
  const agreed = given || ticked;

  /** Records consent 4 (`PUT v1/tenant/consents`, source `contacts`), then asks for the system permission. */
  const agree = () => {
    if (!agreed) return;
    if (given) {
      void allow();
      return;
    }
    saveConsent.mutate({ decisions: [{ type: 'contacts', granted: true }], source: 'contacts' }, { onSuccess: () => void allow() });
  };

  const allow = async () => {
    const permission = await requestContactsPermission().catch(() => ({ granted: false, canAskAgain: false }));
    if (!permission.granted) {
      setCanAskAgain(permission.canAskAgain);
      setPhase('denied');
      return;
    }
    setPhase('run');
    run.mutate();
  };

  const shareInviteNow = async () => {
    const link = invite.data ?? (await invite.refetch()).data;
    if (link) await Share.share({ message: t('share.inviteMessage', { url: link.url }) }).catch(() => undefined);
  };
  // The invite link names me: it needs my @handle first.
  const shareInvite = () => withHandle(() => void shareInviteNow());

  const errorText =
    run.error instanceof ApiError && run.error.status === 429 ? t('contacts.tooMany') : t('contacts.error');

  return (
    <Screen bottom>
      <ScreenHeader title={t('contacts.consentTitle')} leading="back" />
      {phase === 'consent' ? (
        <ScrollView contentContainerClassName="gap-5 px-gutter pb-10 pt-2">
          <View className="h-16 w-16 items-center justify-center rounded-pill bg-sand">
            <Icon icon={ShieldCheck} size={26} tone="accent" />
          </View>
          <Text variant="body" tone="muted">
            {t('contacts.consentLead')}
          </Text>
          <Card className="gap-3 p-4">
            <Bullet>{t('contacts.consentWhat')}</Bullet>
            <Bullet>{t('contacts.consentNot')}</Bullet>
            <Bullet>{t('contacts.consentStore')}</Bullet>
            <Bullet>{t('contacts.consentOptional')}</Bullet>
          </Card>
          <ConsentBlock type="contacts" checked={agreed} onToggle={() => !given && setTicked((v) => !v)} />
          {saveConsent.isError ? (
            <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
              {t('consent.failed')}
            </Text>
          ) : null}
          <Button
            variant="text"
            label={t('contacts.privacy')}
            onPress={() => void WebBrowser.openBrowserAsync(privacyUrl())}
            testID="contacts.privacy"
            className="self-start"
          />
          <View className="gap-2">
            <Button
              label={t('contacts.agree')}
              onPress={agree}
              disabled={!online || !agreed}
              loading={saveConsent.isPending}
              testID="contacts.agree"
            />
            <Button variant="secondary" label={t('contacts.notNow')} onPress={() => router.back()} testID="contacts.notNow" />
          </View>
          {!online ? (
            <Text variant="caption" tone="muted">
              {t('states.offlineNoCache')}
            </Text>
          ) : null}
        </ScrollView>
      ) : null}

      {phase === 'denied' ? (
        <View className="flex-1 items-center justify-center gap-4 px-gutter">
          <Text variant="h3" className="text-center">
            {t('contacts.deniedTitle')}
          </Text>
          <Text variant="body" tone="muted" className="text-center">
            {t('contacts.deniedBody')}
          </Text>
          {canAskAgain ? (
            <Button label={t('contacts.agree')} onPress={() => void allow()} testID="contacts.askAgain" />
          ) : (
            <Button label={t('common.openSettings')} onPress={() => void Linking.openSettings()} testID="contacts.openSettings" />
          )}
        </View>
      ) : null}

      {phase === 'run' ? (
        run.isPending ? (
          <View className="gap-4 pt-2" accessible accessibilityLabel={t('contacts.matching')}>
            <Text variant="body" tone="muted" className="px-gutter" accessibilityLiveRegion="polite">
              {t('contacts.matching')}
            </Text>
            <PeopleSkeleton />
          </View>
        ) : run.isError ? (
          <StateMessage message={errorText} actionLabel={t('common.retry')} onAction={() => run.mutate()} />
        ) : matches.data && matches.data.length > 0 ? (
          <ScrollView contentContainerClassName="gap-3 pb-10 pt-2">
            <Text variant="h3" className="px-gutter">
              {t('contacts.resultsTitle', { count: matches.data.length })}
            </Text>
            {matches.data.map((person) => (
              <PersonListRow key={person.handle} person={person}>
                <FollowChip handle={person.handle} state={person.followState} />
              </PersonListRow>
            ))}
          </ScrollView>
        ) : (
          <StateMessage message={t('contacts.resultsEmpty')} actionLabel={t('contacts.inviteAction')} onAction={() => void shareInvite()} />
        )
      ) : null}
    </Screen>
  );
}
