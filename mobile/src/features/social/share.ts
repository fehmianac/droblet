import { apiRequest } from '@/api/client';
import type { ShareTarget } from '@/api/contracts/social';
import { fromSource } from '@/api/dataSource';
import type { ShareChannelWire, ShareRequestWire, ShareResponseWire } from '@/api/wire/social';
import { ulid } from '@/lib/ids';

/**
 * `POST v1/tenant/share` — records the share (the server counts it; the app does not send a `share`
 * analytics event) and answers with the link to send: `{base}/{inviteCode}` for the app itself,
 * otherwise `{base}/{inviteCode}?t={targetKind}&id={targetId}&u={ownerHandle}`.
 *
 * Interactive and online. Resolves to `null` when the link cannot be fetched (offline, fixtures) —
 * the caller then shares the link it built on the device, which carries the invite code too.
 */
export async function requestShareUrl(target: ShareTarget, channel: ShareChannelWire): Promise<string | null> {
  try {
    return await fromSource<string | null>(
      'social',
      () => null,
      async () => {
        const body: ShareRequestWire = { clientMutationId: ulid(), channel, targetKind: target.targetKind };
        if ('targetId' in target) body.targetId = target.targetId;
        if ('ownerHandle' in target && target.ownerHandle) body.ownerHandle = target.ownerHandle;
        const res = await apiRequest<ShareResponseWire>('v1/tenant/share', { method: 'POST', body });
        return res.url || null;
      },
    );
  } catch {
    return null;
  }
}

/** `message` with the device-built link replaced by the server's share link (when there is one). */
export function withShareUrl(message: string, localUrl: string, serverUrl: string | null): { url: string; message: string } {
  if (!serverUrl || serverUrl === localUrl) return { url: localUrl, message };
  return { url: serverUrl, message: message.split(localUrl).join(serverUrl) };
}
