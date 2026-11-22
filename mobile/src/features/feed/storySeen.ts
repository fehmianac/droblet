import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

/**
 * Which editor stories were opened on this phone (the ring turns from accent to line). Kept on the device only —
 * nothing is sent; the newest `MAX_SEEN` ids are remembered.
 */
export const STORY_SEEN_KEY = 'droblet.feed.storySeen';
const MAX_SEEN = 200;

let seen: ReadonlySet<string> = new Set();
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function load(): Promise<void> {
  if (loaded) return Promise.resolve();
  loading ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORY_SEEN_KEY);
      const ids = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(ids)) seen = new Set([...ids.filter((v): v is string => typeof v === 'string'), ...seen]);
    } catch {
      // Without storage every ring simply looks new.
    }
    loaded = true;
    emit();
  })();
  return loading;
}

export const storySeenStore = {
  has: (id: string) => seen.has(id),
  async markSeen(id: string): Promise<void> {
    if (seen.has(id)) return;
    seen = new Set([...seen, id]);
    emit();
    await load();
    try {
      await AsyncStorage.setItem(STORY_SEEN_KEY, JSON.stringify([...seen].slice(-MAX_SEEN)));
    } catch {
      // The ring shows as new again after a restart; nothing else is lost.
    }
  },
  /** Test helper. */
  reset() {
    seen = new Set();
    loaded = false;
    loading = null;
    emit();
  },
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The ids of the stories opened on this phone. */
export function useSeenStories(): ReadonlySet<string> {
  useEffect(() => {
    void load();
  }, []);
  return useSyncExternalStore(subscribe, () => seen);
}
