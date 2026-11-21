/** Query keys. The whole cache is already scoped per user (one persisted client per user id). */
export const queryKeys = {
  styleProfile: ['tenant', 'style-profile'] as const,
  bodyProfile: ['tenant', 'body-profile'] as const,
  entitlement: ['tenant', 'entitlement'] as const,
  today: ['tenant', 'today'] as const,
  library: ['catalog', 'library'] as const,
  /** The ready-made library of one segment (canvas 17: the men's set is its own list). */
  libraryFor: (segment: 'women' | 'men') => ['catalog', 'library', segment] as const,
  storeProducts: ['store', 'products'] as const,
};

/** Mutation keys — every queued write has one so it can resume after an app restart. */
export const mutationKeys = {
  putStyleProfile: ['tenant', 'style-profile', 'put'] as const,
  putBodyProfile: ['tenant', 'body-profile', 'put'] as const,
  uploadPhoto: ['tenant', 'photo', 'upload'] as const,
  createWearLog: ['tenant', 'wear-log', 'create'] as const,
};

/** All tenant writes share one scope, so the queue is sent strictly in order. */
export const TENANT_WRITE_SCOPE = { id: 'tenant-writes' };
