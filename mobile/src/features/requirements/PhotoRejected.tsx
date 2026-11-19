import { useQueryClient } from '@tanstack/react-query';
import { Ban, Lightbulb } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import type { JobError } from '@/api/contracts/jobs';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { accountKeys } from '@/features/account/queries';

import { StepBar } from './steps/StepBar';
import { requirementsFlow } from './store';

type Issue = NonNullable<JobError['photo']>['issue'];

const OTHERS: Issue[] = ['tooDark', 'multiplePeople', 'blurry'];

/**
 * Canvas 11 "Fotoğraf uygun değil": the server's check on the first try-on refused the photo (no full length,
 * too dark, more than one person, blurry, no face). The photo was not kept and no credit was used; the tips for
 * that reason, then straight back to the photo step — the try-on starts again after it (`onRetry`).
 */
export function PhotoRejected({ photo, onRetry }: { photo: NonNullable<JobError['photo']>; onRetry: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  // The server deleted the photo: the requirements read "no photo" from now on.
  useEffect(() => {
    void client.invalidateQueries({ queryKey: accountKeys.photos });
  }, [client]);

  const again = () => requirementsFlow.open({ action: 'tryOn', start: 'steps', path: photo.kind, onResume: onRetry });
  return (
    <View className="flex-1" testID="tryon.photoRejected">
      <ScrollView contentContainerClassName="gap-4 px-6 pb-6 pt-5">
        <View className="flex-row items-start gap-3">
          <View className="h-12 w-12 items-center justify-center rounded-pill bg-sand">
            <Icon icon={Ban} size={22} tone="danger" />
          </View>
          <View className="flex-1 gap-1">
            <Text variant="eyebrow" tone="danger">
              {t(`req.rejected.eyebrow.${photo.issue}`)}
            </Text>
            <Text variant="h2" accessibilityRole="header">
              {t(`req.rejected.title.${photo.issue}`)}
            </Text>
          </View>
        </View>
        <Text variant="body" tone="muted">
          {t('req.rejected.body')}
        </Text>
        <View className="gap-2.5 rounded-card bg-paper p-3.5">
          {(['a', 'b'] as const).map((tip) => (
            <View key={tip} className="flex-row items-start gap-2.5">
              <Icon icon={Lightbulb} size={16} tone="accent" />
              <Text variant="body" className="flex-1 text-[14.5px]">
                {t(`req.rejected.tips.${photo.issue}.${tip}`)}
              </Text>
            </View>
          ))}
        </View>
        {photo.kind === 'body' ? (
          <View className="gap-2">
            <Text variant="caption" tone="muted">
              {t('req.rejected.otherReasons')}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {OTHERS.filter((o) => o !== photo.issue).map((o) => (
                <View key={o} className="h-7 justify-center rounded-pill bg-sand px-2.5">
                  <Text variant="badge">{t(`req.rejected.eyebrow.${o}`)}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
      <StepBar>
        <Button label={t('req.rejected.retake')} onPress={again} testID="tryon.photoRejected.retake" />
        <Button variant="secondary" size="md" label={t('req.rejected.library')} onPress={again} testID="tryon.photoRejected.library" />
      </StepBar>
    </View>
  );
}
