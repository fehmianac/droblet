import { Check, Lock } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';

import type { PhotoPath, Requirements, RequirementStep } from './logic';

/** A step row of the sheet: number in a ring, title + one line; the next one is outlined with "Sıradaki". */
type Row = { key: string; title: string; body: string; next: boolean; children?: React.ReactNode };

function StepRow({ row, index }: { row: Row; index: number }) {
  const { t } = useTranslation();
  return (
    <View
      className={`flex-row items-start gap-3 rounded-card p-3 ${row.next ? 'border border-ink bg-cream' : ''}`}
      accessibilityState={row.next ? { selected: true } : undefined}
      testID={`requirements.sheet.row.${row.key}`}
    >
      <View className={`h-6 w-6 items-center justify-center rounded-pill border-[1.5px] ${row.next ? 'border-ink' : 'border-muted'}`}>
        <Text variant="badge" tone={row.next ? 'ink' : 'muted'}>
          {String(index + 1)}
        </Text>
      </View>
      <View className="flex-1 gap-1">
        <View className="flex-row items-center justify-between gap-2">
          <Text variant="bodyMedium" className="flex-1">
            {row.title}
          </Text>
          {row.next ? <Badge tone="accent" label={t('req.sheet.next')} /> : null}
        </View>
        <Text variant="caption" tone="muted" className="leading-[18px]">
          {row.body}
        </Text>
        {row.children}
      </View>
    </View>
  );
}

function PathOption({ selected, title, note, badge, onPress, testID }: { selected: boolean; title: string; note: string; badge?: string; onPress: () => void; testID: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${title}. ${note}`}
      testID={testID}
      className={`min-h-[56px] flex-row items-center gap-3 rounded-[14px] p-3 active:opacity-80 ${selected ? 'border border-ink bg-paper' : 'border border-line'}`}
    >
      <View className={`h-5 w-5 items-center justify-center rounded-pill border-[1.5px] ${selected ? 'border-ink' : 'border-muted'}`}>
        {selected ? <View className="h-2.5 w-2.5 rounded-pill bg-ink" /> : null}
      </View>
      <View className="flex-1">
        <Text variant="bodyMedium">{title}</Text>
        <Text variant="caption" tone="muted" className="leading-[17px]">
          {note}
        </Text>
      </View>
      {badge ? <Badge label={badge} /> : null}
    </Pressable>
  );
}

type Props = {
  req: Requirements;
  creditsRemaining: number | null;
  onPath: (path: PhotoPath) => void;
  onStart: () => void;
  onClose: () => void;
};

/**
 * Canvas 11b "Üzerimde gör, gereken adımlar": the action eyebrow, "N adım kaldı", the numbered steps (the next
 * one outlined), the two-choice photo step (body photo · face photo + body type), the credit line, the privacy
 * note, "Başla" and "Şimdi değil".
 */
export function RequirementsSheet({ req, creditsRemaining, onPath, onStart, onClose }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const photoKinds: RequirementStep['kind'][] = ['bodyPhoto', 'facePhoto', 'bodyType'];
  const rows: Row[] = [];
  let photoRowAdded = false;
  for (const step of req.steps) {
    if (req.choosePath && photoKinds.includes(step.kind)) {
      if (photoRowAdded) continue;
      photoRowAdded = true;
      rows.push({
        key: 'photo',
        title: t('req.step.photo.title'),
        body: t('req.step.photo.body'),
        next: false,
        children: (
          <View className="mt-2 gap-2" accessibilityRole="radiogroup" accessibilityLabel={t('req.sheet.pathLegend')}>
            <PathOption
              selected={req.path === 'body'}
              title={t('req.path.body')}
              note={t('req.path.bodyNote')}
              badge={t('req.sheet.recommended')}
              onPress={() => onPath('body')}
              testID="requirements.path.body"
            />
            <PathOption selected={req.path === 'face'} title={t('req.path.face')} note={t('req.path.faceNote')} onPress={() => onPath('face')} testID="requirements.path.face" />
          </View>
        ),
      });
      continue;
    }
    rows.push({
      key: step.kind,
      title: step.kind === 'consent' ? t('req.step.consent.title', { count: step.consents?.length ?? 1 }) : t(`req.step.${step.kind}.title`),
      body: t(`req.step.${step.kind}.body`),
      next: false,
    });
  }
  if (rows[0]) rows[0].next = true;
  const showCredit = req.action === 'tryOn' && !req.steps.some((s) => s.kind === 'credits' || s.kind === 'premium');

  return (
    <View className="max-h-[92%] rounded-t-[28px] bg-paper" testID="requirements.sheet" accessibilityViewIsModal>
      <View className="items-center pt-2.5">
        <View className="h-[5px] w-10 rounded-pill bg-line" />
      </View>
      <ScrollView contentContainerClassName="gap-4 px-5 pb-2 pt-3">
        <View className="gap-1">
          <Text variant="eyebrow">{t(`req.action.${req.action}`)}</Text>
          <Text variant="h2" accessibilityRole="header" testID="requirements.sheet.title">
            {t(`req.sheet.title.${req.action}`, { count: req.count })}
          </Text>
          <Text variant="caption" tone="muted" className="text-[13px] leading-[19px]">
            {t('req.sheet.lead')}
          </Text>
        </View>
        <View className="gap-2">
          {rows.map((row, index) => (
            <StepRow key={row.key} row={row} index={index} />
          ))}
          {showCredit ? (
            <View className="min-h-11 flex-row items-center gap-3 px-3">
              <View className="h-6 w-6 items-center justify-center rounded-pill bg-ink">
                <Icon icon={Check} size={14} tone="cream" />
              </View>
              <View className="flex-1">
                <Text variant="bodyMedium" tone="muted">
                  {t('req.step.credits.title')}
                </Text>
                <Text variant="caption" tone="muted">
                  {creditsRemaining !== null ? t('req.sheet.credits', { count: creditsRemaining }) : t('req.sheet.creditsUnknown')}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
        {req.action === 'tryOn' || req.action === 'palette' ? (
          <View className="flex-row items-start gap-2.5 rounded-card bg-sand p-3">
            <Icon icon={Lock} size={18} />
            <Text variant="caption" className="flex-1 leading-[18px]">
              {t('req.sheet.privacy')}
            </Text>
          </View>
        ) : null}
      </ScrollView>
      <View className="gap-1 px-5 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 24) }}>
        <Button label={t('req.sheet.start')} onPress={onStart} testID="requirements.sheet.start" />
        <Button variant="text" label={t('req.sheet.notNow')} onPress={onClose} testID="requirements.sheet.notNow" />
      </View>
    </View>
  );
}
