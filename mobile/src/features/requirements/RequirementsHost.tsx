import { Check, CircleCheck, CircleAlert, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useAiCredits } from '@/features/credits/useAiCredits';
import { useReduceMotion } from '@/hooks/useReduceMotion';

import type { RequirementStep, StepKind } from './logic';
import { RequirementsSheet } from './RequirementsSheet';
import { StepBodyType } from './steps/StepBodyType';
import { StepConsent } from './steps/StepConsent';
import { StepAge, StepCity, StepCredits, StepHandle, StepPremium } from './steps/StepMisc';
import { StepPhoto } from './steps/StepPhoto';
import { requirementsFlow, useRequirementsFlow, type FlowRequest } from './store';
import { useRequirements } from './useRequirements';

/** How long "Hazır" stays before the original action resumes (canvas 11f). */
export const READY_HOLD_MS = 1800;

type Phase = 'sheet' | 'steps' | 'done';

function StepView({ step, onDone, onLeave }: { step: RequirementStep; onDone: () => void; onLeave: () => void }) {
  switch (step.kind) {
    case 'consent':
      return <StepConsent types={step.consents ?? []} onDone={onDone} />;
    case 'bodyPhoto':
      return <StepPhoto kind="body" onDone={onDone} onLeave={onLeave} />;
    case 'facePhoto':
      return <StepPhoto kind="face" onDone={onDone} onLeave={onLeave} />;
    case 'bodyType':
      return <StepBodyType onDone={onDone} />;
    case 'premium':
      return <StepPremium onDone={onDone} />;
    case 'credits':
      return <StepCredits />;
    case 'city':
      return <StepCity onDone={onDone} />;
    case 'handle':
      return <StepHandle onDone={onDone} />;
    case 'age':
      return <StepAge onDone={onDone} />;
  }
}

/** "1 / 2", the segmented progress line and the step names under it (canvas 11c–11e header). */
function StepperHeader({ title, labels, current, onClose }: { title: string; labels: StepKind[]; current: number; onClose: () => void }) {
  const { t } = useTranslation();
  const total = labels.length;
  const name = t(`req.stepper.label.${labels[current] ?? labels[total - 1] ?? 'consent'}`);
  return (
    <View>
      <View className="h-12 flex-row items-center justify-between px-5">
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('req.stepper.close')} hitSlop={8} testID="requirements.stepper.close" className="-ml-2.5 h-11 w-11 items-center justify-center">
          <Icon icon={X} size={20} />
        </Pressable>
        <Text variant="title" className="absolute left-[70px] right-[70px] text-center" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="label" testID="requirements.stepper.count">
          {t('common.stepOf', { current: Math.min(current + 1, total), total })}
        </Text>
      </View>
      <View className="gap-1.5 px-5" accessible accessibilityRole="progressbar" accessibilityLabel={t('req.stepper.progressA11y', { current: current + 1, total, name })}>
        <View className="flex-row gap-1">
          {labels.map((kind, i) => (
            <View key={`${kind}-${i}`} className={`h-1 flex-1 rounded-[2px] ${i <= current ? 'bg-ink' : 'bg-line'}`} />
          ))}
        </View>
        <View className="flex-row justify-between">
          {labels.map((kind, i) => (
            <View key={`${kind}-l-${i}`} className="flex-row items-center gap-1">
              {i < current ? <Icon icon={Check} size={12} tone="muted" /> : null}
              <Text variant="caption" tone={i === current ? 'ink' : 'muted'} className={`text-[11px] ${i === current ? 'font-sans-medium' : ''}`} numberOfLines={1}>
                {t(`req.stepper.label.${kind}`)}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

/** Canvas 11j: leaving mid-flow — what is saved, what is next, how the hint will read. */
function ExitConfirm({ completed, next, hint, onContinue, onLeave }: { completed: StepKind[]; next: StepKind | null; hint: string; onContinue: () => void; onLeave: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View className="absolute inset-0 justify-end">
      <Pressable className="absolute inset-0 bg-scrim" onPress={onContinue} accessibilityRole="button" accessibilityLabel={t('req.exit.continue')} />
      <View className="gap-4 rounded-t-[28px] bg-paper px-5 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 24) }} testID="requirements.exit" accessibilityViewIsModal>
        <View className="items-center">
          <View className="h-[5px] w-10 rounded-pill bg-line" />
        </View>
        <View className="gap-1.5">
          <Text variant="h2" accessibilityRole="header">
            {t('req.exit.title')}
          </Text>
          <Text variant="body" tone="muted">
            {t('req.exit.body')}
          </Text>
        </View>
        <View className="gap-2">
          {completed.map((kind) => (
            <View key={kind} className="flex-row items-center gap-2.5">
              <View className="h-6 w-6 items-center justify-center rounded-pill bg-ink">
                <Icon icon={Check} size={14} tone="cream" />
              </View>
              <Text variant="body">{t(`req.done.item.${kind}`)}</Text>
            </View>
          ))}
          {next ? (
            <View className="flex-row items-center gap-2.5">
              <View className="h-6 w-6 items-center justify-center rounded-pill border-[1.5px] border-ink">
                <Text variant="badge">{String(completed.length + 1)}</Text>
              </View>
              <Text variant="body">{t('req.exit.next', { name: t(`req.stepper.label.${next}`) })}</Text>
            </View>
          ) : null}
        </View>
        <View className="gap-1.5 rounded-card bg-cream p-3">
          <Text variant="caption" tone="muted">
            {t('req.exit.preview')}
          </Text>
          <View className="flex-row items-center gap-1">
            <Icon icon={CircleAlert} size={12} tone="accent" />
            <Text variant="caption" tone="accent" className="font-sans-medium">
              {hint}
            </Text>
          </View>
        </View>
        <View className="gap-1">
          <Button label={t('req.exit.continue')} onPress={onContinue} testID="requirements.exit.continue" />
          <Button variant="text" label={t('req.exit.leave')} onPress={onLeave} testID="requirements.exit.leave" />
        </View>
      </View>
    </View>
  );
}

/** Canvas 11f "Hazır": what was done, then back to the original action on its own. */
function Ready({ completed, origin }: { completed: StepKind[]; origin: string | null }) {
  const { t } = useTranslation();
  useEffect(() => {
    const timer = setTimeout(() => requirementsFlow.finish(), READY_HOLD_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <View className="flex-1 justify-center gap-6 px-6" accessibilityLiveRegion="polite" testID="requirements.ready">
      <View className="h-16 w-16 items-center justify-center rounded-pill bg-ink">
        <Icon icon={Check} size={30} tone="cream" />
      </View>
      <View className="gap-2">
        <Text variant="eyebrow">{t('req.done.eyebrow')}</Text>
        <Text variant="display">{t('req.done.title')}</Text>
        <Text variant="body" tone="muted">
          {t('req.done.body')}
        </Text>
      </View>
      <View className="gap-2.5">
        {completed.map((kind) => (
          <View key={kind} className="flex-row items-center gap-2.5">
            <Icon icon={CircleCheck} size={18} />
            <Text variant="body">{t(`req.done.item.${kind}`)}</Text>
          </View>
        ))}
        <View className="flex-row items-center gap-2.5">
          <Icon icon={CircleCheck} size={18} />
          <Text variant="body">{t('req.done.saved')}</Text>
        </View>
      </View>
      <Text variant="caption" tone="muted">
        {origin ? t('req.done.returning', { origin }) : t('req.done.returningPlain')}
      </Text>
    </View>
  );
}

function Flow({ request }: { request: FlowRequest }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const credits = useAiCredits();
  const req = useRequirements(request.action, null, request.only);
  const [chosenPhase, setPhase] = useState<Phase>(request.start === 'steps' ? 'steps' : 'sheet');
  const [completed, setCompleted] = useState<StepKind[]>([]);
  const [labels, setLabels] = useState<StepKind[] | null>(request.start === 'steps' ? req.steps.map((s) => s.kind) : null);
  const [exiting, setExiting] = useState(false);

  const remaining = req.steps.filter((s) => !completed.includes(s.kind));
  const current = remaining[0] ?? null;

  // Nothing left (the last step finished, or the data says so): "Hazır".
  const phase: Phase = chosenPhase === 'steps' && current === null ? 'done' : chosenPhase;

  useEffect(() => {
    if (current) requirementsFlow.noteStep(request.action, current.kind);
  }, [current, request.action]);

  if (phase === 'sheet') {
    // Opened while nothing is missing (data arrived meanwhile): run at once.
    if (req.ready) {
      return <ReadyNow />;
    }
    return (
      <View className="flex-1 justify-end">
        <Pressable className="absolute inset-0 bg-scrim" onPress={() => requirementsFlow.close()} accessibilityRole="button" accessibilityLabel={t('a11y.close')} testID="requirements.scrim" />
        <RequirementsSheet
          req={req}
          creditsRemaining={credits.remaining}
          onPath={(path) => requirementsFlow.choosePath(request.action, path)}
          onClose={() => requirementsFlow.close()}
          onStart={() => {
            setLabels(req.steps.map((s) => s.kind));
            setPhase('steps');
          }}
        />
      </View>
    );
  }

  if (phase === 'done') {
    return (
      <View className="flex-1 bg-cream" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <Ready completed={completed} origin={request.origin ?? null} />
      </View>
    );
  }

  // The bar keeps the shape the flow started with; a step that appeared later (path switch) is appended.
  const bar = [...(labels ?? []), ...remaining.map((s) => s.kind).filter((k) => !(labels ?? []).includes(k))];
  const index = current ? Math.max(0, bar.indexOf(current.kind)) : bar.length - 1;
  const next = () => {
    if (current) setCompleted((prev) => [...prev, current.kind]);
  };
  const leave = () => {
    setExiting(false);
    requirementsFlow.close();
  };
  const hintLeft = t('req.hint.format', { what: t(`req.hint.${current?.kind ?? req.hint ?? 'consent'}`), steps: t('req.hint.left', { count: Math.max(1, remaining.length) }) });

  return (
    <View className="flex-1 bg-cream" style={{ paddingTop: insets.top }} testID="requirements.stepper">
      <StepperHeader title={t(`req.actionName.${request.action}`)} labels={bar} current={index} onClose={() => (current ? setExiting(true) : leave())} />
      {current ? <StepView key={current.kind} step={current} onDone={next} onLeave={leave} /> : null}
      {exiting ? <ExitConfirm completed={completed} next={current?.kind ?? null} hint={hintLeft} onContinue={() => setExiting(false)} onLeave={leave} /> : null}
    </View>
  );
}

/** The flow was opened although nothing is missing any more: hand straight back to the action. */
function ReadyNow() {
  useEffect(() => {
    requirementsFlow.finish();
  }, []);
  return null;
}

/**
 * Canvas 11 host: the requirements sheet, the stepper and "Hazır" for the action `requirementsFlow` was opened
 * for. Mounted once in `AppHosts`; the screen under it stays mounted, so the original action resumes in place.
 */
export function RequirementsHost() {
  const flow = useRequirementsFlow();
  const reduceMotion = useReduceMotion();
  const request = flow.request;
  return (
    <Modal visible={request !== null} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={() => requirementsFlow.close()} statusBarTranslucent>
      {request ? <Flow key={flow.serial} request={request} /> : null}
    </Modal>
  );
}
