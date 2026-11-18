import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { useTrip, useTripWrites } from '@/features/trips/api';
import { TripForm } from '@/features/trips/TripForm';

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/wardrobe/trips');
}

/**
 * No dedicated board — derived from 18: the same paper card and form, under a modal header with ✕.
 * "Yeni bavul" as a modal (entry from Stilist's "Bavul hazırla" shortcut and deep links), and
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
      <ScreenHeader title={t(id ? 'tripNew.editTitle' : 'tripNew.title')} leading="close" leadingVariant="outline" onLeadingPress={leave} />
      {id ? (
        <ScreenState query={trip}>
          {(data) => (
            <ScrollView contentContainerClassName="px-gutter pb-8 pt-1" keyboardShouldPersistTaps="handled">
              <View className="rounded-card border border-line bg-paper p-4">
                <TripForm
                  key={data.id}
                  initial={data}
                  submitLabel={t('tripNew.save')}
                  onSubmit={(draft) => {
                    writes.update(data, draft);
                    leave();
                  }}
                />
              </View>
            </ScrollView>
          )}
        </ScreenState>
      ) : (
        <>
          <ScrollView contentContainerClassName="px-gutter pb-8 pt-1" keyboardShouldPersistTaps="handled">
            <View className="rounded-card border border-line bg-paper p-4">
              <TripForm
                submitLabel={t('tripNew.submit')}
                onSubmit={(draft) => {
                  const newId = writes.create(draft);
                  router.replace({ pathname: '/trip/[id]', params: { id: newId } });
                }}
              />
            </View>
          </ScrollView>
        </>
      )}
    </Screen>
  );
}
