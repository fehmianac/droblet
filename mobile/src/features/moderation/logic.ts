import type { ContentModeration } from '@/api/contracts/wardrobe';

/**
 * A moderator hiding or restoring a look / piece moves its version on, so the owner's next edit answers 409 even
 * though nobody touched the owner's fields. When the 409's current record has `moderation` switched compared with what
 * the app had, the version change is taken to be the moderator's: the app takes the new moderation state and resends
 * the edit on the current version instead of asking "changed elsewhere".
 */
export function isModerationOnlyChange(
  mine: { moderation?: ContentModeration | null } | null | undefined,
  current: { moderation?: ContentModeration | null } | null | undefined,
): boolean {
  if (!mine || !current) return false;
  return Boolean(mine.moderation?.hidden) !== Boolean(current.moderation?.hidden);
}
