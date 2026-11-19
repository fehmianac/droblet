import { useSyncExternalStore } from 'react';

import type { PhotoPath, RequirementAction, StepKind } from './logic';

/**
 * The one requirements flow at a time (canvas 11): the sheet, the stepper and "Hazır". Opened from a gated
 * button (`useGate`) or from a server answer that names a missing prerequisite (`openForError`); rendered by
 * `RequirementsHost`. `onResume` is the original action — run after the last step ("kaldığın yere dön").
 *
 * What the user already did is data (consent records, photos, profile), so progress survives closing the flow;
 * this store only remembers the session's choices: the photo path, "Şehirsiz devam et", started actions.
 */
export type FlowStart = 'sheet' | 'steps';

export type FlowRequest = {
  action: RequirementAction;
  onResume?: () => void;
  /** 'steps' skips the sheet (a rejected photo: straight back to the photo step). */
  start?: FlowStart;
  /** Pre-chosen photo path (try-on). */
  path?: PhotoPath;
  /** Shown under the sheet title / on "Hazır" ("Look oluştur'a dönülüyor"). */
  origin?: string | null;
};

type State = {
  request: FlowRequest | null;
  /** Bumps on every open: the host keys its local state by it. */
  serial: number;
  paths: Partial<Record<RequirementAction, PhotoPath>>;
  cityDeclined: boolean;
  started: Partial<Record<RequirementAction, boolean>>;
  /** A step the user saw but has not finished (exit confirmation): the hint says "kaldı". */
  lastStep: Partial<Record<RequirementAction, StepKind>>;
};

let state: State = { request: null, serial: 0, paths: {}, cityDeclined: false, started: {}, lastStep: {} };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

export const requirementsFlow = {
  open(request: FlowRequest) {
    set({ request, serial: state.serial + 1, started: { ...state.started, [request.action]: true }, ...(request.path ? { paths: { ...state.paths, [request.action]: request.path } } : {}) });
  },
  close() {
    if (state.request) set({ request: null });
  },
  /** Closes and runs the original action (after "Hazır"). */
  finish() {
    const resume = state.request?.onResume;
    set({ request: null });
    resume?.();
  },
  choosePath(action: RequirementAction, path: PhotoPath) {
    set({ paths: { ...state.paths, [action]: path } });
  },
  declineCity() {
    set({ cityDeclined: true });
  },
  noteStep(action: RequirementAction, step: StepKind) {
    set({ lastStep: { ...state.lastStep, [action]: step } });
  },
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Tests: forget everything. */
  reset() {
    state = { request: null, serial: 0, paths: {}, cityDeclined: false, started: {}, lastStep: {} };
    listeners.forEach((l) => l());
  },
};

export function useRequirementsFlow(): State {
  return useSyncExternalStore(requirementsFlow.subscribe, requirementsFlow.get, requirementsFlow.get);
}
