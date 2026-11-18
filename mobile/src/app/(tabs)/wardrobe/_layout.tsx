import { Slot } from 'expo-router';

import { Screen } from '@/components/ui/Screen';

/**
 * Gardırop: one tab, three sub-views (Parçalar / Looklar / Bavullar) — not separate tabs.
 * Each view renders `WardrobeHeader` (logo row, count headline, segment switch) with its own actions.
 */
export default function WardrobeLayout() {
  return (
    <Screen>
      <Slot />
    </Screen>
  );
}
