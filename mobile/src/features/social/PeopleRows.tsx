import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { FollowState, PersonSuggestion } from '@/api/contracts/social';
import { Avatar } from '@/components/blocks/basics';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { formatPercent } from '@/lib/format';

import { useFollow } from './mutations';

/** i18n key of each follow state's label. */
export const FOLLOW_LABEL: Record<FollowState, 'friends.follow' | 'friends.requested' | 'friends.following'> = {
  none: 'friends.follow',
  requested: 'friends.requested',
  following: 'friends.following',
};

/**
 * Follow chip with the three states: Takip et → (public) Takip ediliyor / (others) İstek gönderildi.
 * Tapping a pending request withdraws it; tapping "following" unfollows.
 */
export function FollowChip({ handle, state, testID }: { handle: string; state: FollowState; testID?: string }) {
  const { t } = useTranslation();
  const follow = useFollow();
  return (
    <Chip
      label={t(FOLLOW_LABEL[state])}
      selected={state === 'none'}
      onPress={() => follow(handle, state === 'none')}
      accessibilityHint={state === 'requested' ? t('friends.requestedHint') : state === 'following' ? t('friends.followingHint') : undefined}
      testID={testID ?? `follow.${handle}`}
    />
  );
}

/** One person: avatar + name + a muted line, the whole left side opens the profile; actions on the right. */
export function PersonListRow({ person, subtitle, children }: { person: PersonSuggestion; subtitle?: string; children?: ReactNode }) {
  const { t } = useTranslation();
  const line = subtitle ?? (person.styleMatch > 0 ? t('people.matchPercent', { percent: formatPercent(person.styleMatch) }) : `@${person.handle}`);
  return (
    <View className="flex-row items-center gap-3 px-gutter">
      <Pressable
        onPress={() => router.push({ pathname: '/u/[handle]', params: { handle: person.handle } })}
        accessibilityRole="button"
        accessibilityLabel={`${person.displayName}, ${line}`}
        testID={`person.${person.handle}`}
        className="min-h-14 flex-1 flex-row items-center gap-3 active:opacity-80"
      >
        <Avatar name={person.displayName} uri={person.avatarUrl} size={44} />
        <View className="flex-1">
          <Text variant="bodyMedium" numberOfLines={1}>
            {person.displayName}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {line}
          </Text>
        </View>
      </Pressable>
      {children}
    </View>
  );
}

/** A compact secondary action inside a row (Onayla / Reddet / Çıkar / Engeli kaldır). */
export function RowAction({
  label,
  onPress,
  hint,
  testID,
  primary = false,
}: {
  label: string;
  onPress: () => void;
  /** Says whom the action is for ("Ayşe takip isteğini onayla"). */
  hint: string;
  testID: string;
  primary?: boolean;
}) {
  return (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      label={label}
      onPress={onPress}
      accessibilityHint={hint}
      testID={testID}
      className="h-btn-secondary px-4"
    />
  );
}

export function PeopleSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <View className="gap-3 px-gutter pt-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-card" />
      ))}
    </View>
  );
}
