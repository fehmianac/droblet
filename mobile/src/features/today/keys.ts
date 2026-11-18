/** Query keys of the Bugün / plan / calendar slice (E4). Other slices invalidate these after writing a plan day. */
export const planKeys = {
  /** Prefix of every plan-day range query. */
  planDays: ['tenant', 'plan-day'] as const,
  planRange: (from: string, to: string) => ['tenant', 'plan-day', from, to] as const,
  wearLogs: ['tenant', 'wear-log'] as const,
  wearMonth: (month: string) => ['tenant', 'wear-log', month] as const,
  wearSummary: (month: string) => ['tenant', 'wear-log', 'summary', month] as const,
  edit: (id: string) => ['content', 'edit', id] as const,
};
