/**
 * Runs at most one instance of `task` at a time; concurrent callers share the same promise.
 * Refresh tokens rotate, so two parallel refreshes would invalidate each other and sign the user out.
 */
export function singleFlight<T>(task: () => Promise<T>): () => Promise<T> {
  let inflight: Promise<T> | null = null;
  return () => {
    if (!inflight) {
      inflight = task().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  };
}
