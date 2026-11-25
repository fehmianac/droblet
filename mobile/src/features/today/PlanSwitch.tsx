import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { SegmentedControl } from '@/components/ui/SegmentedControl';

/**
 * 09′ "Hafta | Ay": the weekly plan (07) and the month (09) are two views of one plan. The other view replaces this
 * one, so "back" leaves the plan instead of flipping between the two.
 */
export function PlanSwitch({ value }: { value: 'week' | 'month' }) {
  const { t } = useTranslation();
  return (
    <SegmentedControl
      segments={[
        { value: 'week', label: t('calendarScreen.viewWeek') },
        { value: 'month', label: t('calendarScreen.viewMonth') },
      ]}
      value={value}
      onChange={(next) => {
        if (next !== value) router.replace(next === 'week' ? '/plan/week' : '/calendar');
      }}
      accessibilityLabel={t('calendarScreen.viewA11y')}
      testID="plan-view"
    />
  );
}
