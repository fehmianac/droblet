import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { RequirementAction } from '@/features/requirements/logic';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { showToast } from '@/components/ui/toast/store';
import i18n from '@/i18n';

import type { TeenRules } from './rules';
import { TeenLockedState, TeenTryOnExplainer, TeenTryOnLock } from './TeenLocks';

/**
 * What a gated action (canvas 11 `useGate`) does for a teen before the normal requirements flow:
 * - `hidden`: social / contacts — never reachable for a teen; one calm sentence if something still calls it;
 * - `locked`: limited mode (no approval yet) — the "Velinin onayıyla açılır" sheet;
 * - `tryOnLocked`: try-on closed (limited, flag off, parent did not tick it) — the 14b lock card in a sheet;
 * - `explainer`: try-on open but the teen's own consent missing — 22t, then the normal flow;
 * - null: go on as for anyone.
 */
export type TeenGateStop = 'hidden' | 'locked' | 'tryOnLocked' | 'explainer' | null;

export function teenGateStop(action: RequirementAction, rules: TeenRules): TeenGateStop {
  if (!rules.isTeen) return null;
  if (action === 'social' || action === 'contacts') return 'hidden';
  if (action === 'tryOn') {
    if (rules.tryOn !== 'open') return 'tryOnLocked';
    return rules.needsOwnTryOnConsent ? 'explainer' : null;
  }
  return rules.limited ? 'locked' : null;
}

type Open = { stop: 'locked' | 'tryOnLocked' | 'explainer'; onResume: (() => void) | null };

let current: Open | null = null;
const listeners = new Set<() => void>();
function emit(next: Open | null) {
  current = next;
  listeners.forEach((l) => l());
}

export const teenGate = {
  get: () => current,
  close: () => emit(null),
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Applies a stop: shows the sheet / the sentence. Returns true when the action must not go on now. */
  apply(stop: TeenGateStop, onResume: () => void): boolean {
    if (stop === null) return false;
    if (stop === 'hidden') {
      showToast({ message: i18n.t('teen.unavailable') });
      return true;
    }
    emit({ stop, onResume: stop === 'explainer' ? onResume : null });
    return true;
  },
};

/** The sheets of the teen gate; mounted once for a signed-in account. */
export function TeenGateHost() {
  const { t } = useTranslation();
  const open = useSyncExternalStore(teenGate.subscribe, teenGate.get, teenGate.get);
  if (!open) return null;
  if (open.stop === 'explainer') {
    return (
      <TeenTryOnExplainer
        visible
        onClose={teenGate.close}
        onAccepted={() => {
          const resume = open.onResume;
          teenGate.close();
          resume?.();
        }}
      />
    );
  }
  return (
    <BottomSheet visible onClose={teenGate.close}>
      <View testID={`teen.gate.${open.stop}`}>
        {open.stop === 'tryOnLocked' ? (
          <TeenTryOnLock onLeave={teenGate.close} />
        ) : (
          <TeenLockedState compact body={t('teen.locked.stylist')} onLeave={teenGate.close} testID="teen.gate.lockedState" />
        )}
      </View>
    </BottomSheet>
  );
}
