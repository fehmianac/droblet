import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useTrip, useTripWrites } from '@/features/trips/api';
import { TripForm } from '@/features/trips/TripForm';

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/wardrobe/trips');
}

function FormSkeleton() {
  return (
    <View className="gap-4 px-gutter pt-2">
      <Skeleton className="h-btn-primary w-full rounded-field" />
      <View className="flex-row gap-3">
        <Skeleton className="h-btn-primary flex-1 rounded-field" />
        <Skeleton className="h-btn-primary flex-1 rounded-field" />
      </View>
      <Skeleton className="h-chip w-2/3 rounded-pill" />
    </View>
  );
}

/**
 * 18 — "Yeni bavul" as a modal (entry from Stilist's "Bavul hazırla" shortcut and deep links), and
 * the edit form of an existing trip (`id` param, from the ⋯ menu of 19).
 */
export default function TripNewScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' && params.id ? params.id : null;
  const writes = useTripWrites();
  const trip = useTrip(id ?? '');

  return (
    <Screen bottom>
      <ScreenHeader title={t(id ? 'tripNew.editTitle' : 'tripNew.title')} leading="close" onLeadingPress={leave} />
      {id ? (
        <ScreenState query={trip} skeleton={<FormSkeleton />}>
          {(data) => (
            <ScrollView contentContainerClassName="px-gutter pb-8 pt-2" keyboardShouldPersistTaps="handled">
              <TripForm
                key={data.id}
                initial={data}
                submitLabel={t('tripNew.save')}
                onSubmit={(draft) => {
                  writes.update(data, draft);
                  leave();
                }}
              />
            </ScrollView>
          )}
        </ScreenState>
      ) : (
        <>
          <OfflineBanner />
          <ScrollView contentContainerClassName="px-gutter pb-8 pt-2" keyboardShouldPersistTaps="handled">
            <TripForm
              submitLabel={t('tripNew.submit')}
              onSubmit={(draft) => {
                const newId = writes.create(draft);
                router.replace({ pathname: '/trip/[id]', params: { id: newId } });
              }}
            />
          </ScrollView>
        </>
      )}
    </Screen>
  );
}
