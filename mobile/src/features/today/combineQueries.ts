type QueryLike<T> = {
  data: T | undefined;
  status: 'pending' | 'error' | 'success';
  fetchStatus: 'fetching' | 'paused' | 'idle';
  error: unknown;
  isRefetching: boolean;
  refetch: () => unknown;
};

/** Presents two queries as one to `ScreenState`: data only when both have it; an error or pause of either shows. */
export function combineQueries<A, B>(a: QueryLike<A>, b: QueryLike<B>): QueryLike<{ a: A; b: B }> & { refetch: () => void } {
  const data = a.data !== undefined && b.data !== undefined ? { a: a.data, b: b.data } : undefined;
  return {
    data,
    status: a.status === 'error' || b.status === 'error' ? 'error' : data !== undefined ? 'success' : 'pending',
    fetchStatus: a.fetchStatus === 'paused' || b.fetchStatus === 'paused' ? 'paused' : a.fetchStatus === 'fetching' || b.fetchStatus === 'fetching' ? 'fetching' : 'idle',
    error: a.error ?? b.error,
    isRefetching: a.isRefetching || b.isRefetching,
    refetch: () => {
      void a.refetch();
      void b.refetch();
    },
  };
}
