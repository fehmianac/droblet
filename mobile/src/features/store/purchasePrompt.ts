import type { PurchasePrompt } from '@/api/contracts/store';

/** Prompts shown (answered or put off with "Sonra") in this app session — each is offered once per session. */
export const shownPurchasePrompts = new Set<string>();

/** The prompt to offer now: the oldest pending one not offered in this session yet. */
export function nextPurchasePrompt(prompts: readonly PurchasePrompt[] | undefined, shown: ReadonlySet<string>): PurchasePrompt | null {
  if (!prompts || prompts.length === 0) return null;
  const open = prompts.filter((p) => !shown.has(p.id) && p.products.length > 0);
  if (open.length === 0) return null;
  return [...open].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[0] ?? null;
}
