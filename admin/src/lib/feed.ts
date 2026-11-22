/** Akış post / story status in the panel: retired · draft · scheduled (published, start not reached) · live / ended. */
export function postStatus(p: { retired: boolean; published: boolean; publishAt: string }, now = Date.now()): 'retired' | 'draft' | 'scheduled' | 'live' {
  if (p.retired) return 'retired';
  if (!p.published) return 'draft';
  return new Date(p.publishAt).getTime() > now ? 'scheduled' : 'live';
}

export function storyStatus(
  s: { retired: boolean; published: boolean; publishAt: string; expiresAt: string | null },
  now = Date.now(),
): 'retired' | 'draft' | 'scheduled' | 'live' | 'expired' {
  const status = postStatus(s, now);
  if (status === 'live' && s.expiresAt && new Date(s.expiresAt).getTime() <= now) return 'expired';
  return status;
}
