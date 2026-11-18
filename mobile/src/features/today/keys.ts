/** Query keys of the Bugün / plan / calendar slice (E4). Other slices invalidate these after writing a plan day. */
export const planKeys = {
  /** Prefix of every plan-day range query (07) and of the calendar month query (09). */
  planDays: ['tenant', 'plan-day'] as const,
  planRange: (from: string, to: string) => ['tenant', 'plan-day', from, to] as const,
  /** 09: wear logs + plan days + summary of one month. Under the plan-day prefix so "Takvime ekle" refreshes it. */
  calendar: (month: string) => ['tenant', 'plan-day', 'calendar', month] as const,
  wearLogs: ['tenant', 'wear-log'] as const,
  wearMonth: (month: string) => ['tenant', 'wear-log', month] as const,
  wearSummary: (month: string) => ['tenant', 'wear-log', 'summary', month] as const,
  /**
   * Prefix of every weekly-edit DETAIL query (08, `WeeklyEdit`). Under its own `detail` segment: the Keşfet
   * cover (`storeKeys.edit`, a `WeeklyEditSummary`) must never share a key or a prefix with it — `/edit/current`
   * and the Keşfet cover once collided on `['content','edit','current']` and each screen crashed on the
   * other's data (and the edit updaters ran on the summary).
   */
  edits: ['content', 'edit', 'detail'] as const,
  edit: (id: string) => ['content', 'edit', 'detail', id] as const,
  /** The dates a `stylist-week` job was asked to plan (the proposal lists only those). */
  weekRequest: (jobId: string) => ['tenant', 'stylist', 'week-request', jobId] as const,
};

/** Keys of this slice's queued writes (registered in `mutations.ts`). */
export const todayMutationKeys = {
  putPlanDay: ['tenant', 'plan-day', 'put'] as const,
  setLookFavorite: ['tenant', 'look', 'favorite'] as const,
  addToWatchlist: ['tenant', 'watchlist', 'add'] as const,
  saveEditLook: ['tenant', 'look', 'from-edit'] as const,
};
