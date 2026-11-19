import * as Haptics from 'expo-haptics';
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Canvas 13b "Toast deseni": one line, at most one action, gone by itself. A write that changes something
 * the user keeps (a plan day, a saved look, the watch list…) always says so — no silent success.
 *
 * - `success`: light success haptic, 4 s (6 s with an action);
 * - `info`: no haptic, 4 s;
 * - `error`: warning haptic, 8 s, usually with "Tekrar dene".
 *
 * One toast at a time: a new one replaces the one on screen.
 */
export type ToastTone = 'success' | 'info' | 'error';
export type ToastIcon = 'check' | 'heart' | 'heartFilled' | 'info' | 'alert';

export type ToastAction = { label: string; onPress: () => void };

export type ToastInput = {
  message: string;
  tone?: ToastTone;
  icon?: ToastIcon;
  action?: ToastAction;
  /** Overrides the tone's default duration (ms). */
  durationMs?: number;
  testID?: string;
};

export type Toast = Required<Pick<ToastInput, 'message' | 'tone' | 'icon'>> & {
  id: number;
  action: ToastAction | null;
  durationMs: number;
  testID: string;
};

const DEFAULT_ICON: Record<ToastTone, ToastIcon> = { success: 'check', info: 'info', error: 'alert' };

export function toastDuration(tone: ToastTone, hasAction: boolean): number {
  if (tone === 'error') return 8000;
  if (tone === 'success' && hasAction) return 6000;
  return 4000;
}

let current: Toast | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function haptic(tone: ToastTone) {
  // A missing haptic engine (simulator, web, Jest) is never an error worth surfacing.
  try {
    if (tone === 'success') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    else if (tone === 'error') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
  } catch {
    // ignore
  }
}

/** Shows a toast (replacing the one on screen) and returns its id. */
export function showToast(input: ToastInput): number {
  const tone = input.tone ?? 'success';
  const toast: Toast = {
    id: nextId++,
    message: input.message,
    tone,
    icon: input.icon ?? DEFAULT_ICON[tone],
    action: input.action ?? null,
    durationMs: input.durationMs ?? toastDuration(tone, Boolean(input.action)),
    testID: input.testID ?? 'toast',
  };
  current = toast;
  haptic(tone);
  // VoiceOver / TalkBack read it even when focus is elsewhere.
  AccessibilityInfo.announceForAccessibility?.(toast.action ? `${toast.message}. ${toast.action.label}` : toast.message);
  emit();
  return toast.id;
}

/** Hides the toast `id` (or whichever is on screen). */
export function hideToast(id?: number): void {
  if (!current || (id !== undefined && current.id !== id)) return;
  current = null;
  emit();
}

export function currentToast(): Toast | null {
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useToast(): Toast | null {
  return useSyncExternalStore(subscribe, currentToast, currentToast);
}

/** Shorthands. */
export const toast = {
  success: (message: string, extra: Omit<ToastInput, 'message' | 'tone'> = {}) => showToast({ ...extra, message, tone: 'success' }),
  info: (message: string, extra: Omit<ToastInput, 'message' | 'tone'> = {}) => showToast({ ...extra, message, tone: 'info' }),
  error: (message: string, extra: Omit<ToastInput, 'message' | 'tone'> = {}) => showToast({ ...extra, message, tone: 'error' }),
  hide: hideToast,
};
