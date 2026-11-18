import { useEffect, useSyncExternalStore } from 'react';

/**
 * Lets a tab-root screen take the bottom menu away while a mode of its own owns the bottom edge —
 * 10 Gardırop in multi-select: the canvas draws the selection bar ("N parça seçildi · Look oluştur ·
 * Sezon · Sil") where the menu was (`showTabs: !selecting`). Counted, so two screens never fight over it.
 */
let hiders = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Read by `TabBar`: true while some screen asked for the bottom menu to step aside. */
export function useTabBarHidden(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hiders > 0,
    () => false,
  );
}

/** Hides the bottom menu while `hidden` is true and the calling screen is mounted. */
export function useHideTabBar(hidden: boolean): void {
  useEffect(() => {
    if (!hidden) return;
    hiders += 1;
    emit();
    return () => {
      hiders -= 1;
      emit();
    };
  }, [hidden]);
}
