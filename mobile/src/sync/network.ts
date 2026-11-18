import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, useIsMutating, useMutationState } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

let wired = false;

/** Connects TanStack Query to device connectivity and app foregrounding. Call once at startup. */
export function wireNetworkAndFocus(): void {
  if (wired) return;
  wired = true;
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(state.isConnected !== false && state.isInternetReachable !== false);
    }),
  );
  AppState.addEventListener('change', (status: AppStateStatus) => {
    focusManager.setFocused(status === 'active');
  });
}

export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
}

/** "Senkronize ediliyor (N)" — queued + in-flight writes (photo uploads included). */
export function usePendingWrites(): number {
  const running = useIsMutating();
  const paused = useMutationState({ filters: { predicate: (m) => m.state.isPaused } }).length;
  return Math.max(running, paused);
}
