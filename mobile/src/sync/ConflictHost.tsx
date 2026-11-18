import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { conflictStore, useConflicts } from './conflicts';

/** Presents queued-write conflicts one at a time; the user decides, nothing is overwritten silently. */
export function ConflictHost() {
  const { t } = useTranslation();
  const conflicts = useConflicts();
  const next = conflicts[0];

  useEffect(() => {
    if (!next) return;
    const done = () => conflictStore.resolve(next.id);
    if (next.kind === 'changed') {
      Alert.alert(t('conflict.changedTitle'), t('conflict.changedBody'), [
        { text: t('conflict.keepOther'), onPress: () => (next.keepTheirs(), done()) },
        ...(next.keepMine ? [{ text: t('conflict.keepThis'), onPress: () => (next.keepMine?.(), done()) }] : []),
      ]);
    } else {
      Alert.alert(t('conflict.deletedTitle'), t('conflict.deletedBody'), [
        { text: t('common.ok'), onPress: () => (next.keepTheirs(), done()) },
        ...(next.keepMine ? [{ text: t('conflict.readd'), onPress: () => (next.keepMine?.(), done()) }] : []),
      ]);
    }
  }, [next, t]);

  return null;
}
