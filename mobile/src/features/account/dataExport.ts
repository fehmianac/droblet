import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/api/client';
import { fromSource } from '@/api/dataSource';
import { ApiError } from '@/api/errors';
import { accountFixtures } from '@/fixtures/account';

/**
 * "Verilerimi indir" (docs/api/verification-export.md §2): `POST v1/tenant/export` starts a ZIP of everything stored
 * about the account; `GET v1/tenant/export` reports it. When ready an inbox row and an e-mail carry the link; here the
 * state holds a short-lived download URL. One export at a time, one per day.
 */
export type DataExportStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'expired';

export type DataExport = {
  id: string;
  status: DataExportStatus;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  sizeBytes: number | null;
  downloadUrl: string | null;
};

export type DataExportState = { export: DataExport | null; canRequest: boolean; nextRequestAt: string | null };

type DataExportWire = {
  id: string;
  status: string;
  createdAt: string;
  completedAt?: string | null;
  expiresAt?: string | null;
  sizeBytes?: number | null;
  downloadUrl?: string | null;
};
export type DataExportStateWire = { export: DataExportWire | null; canRequest: boolean; nextRequestAt?: string | null };

const STATUSES: readonly DataExportStatus[] = ['queued', 'processing', 'ready', 'failed', 'expired'];

export function toDataExportState(wire: DataExportStateWire): DataExportState {
  const e = wire.export;
  return {
    export: e
      ? {
          id: e.id,
          status: (STATUSES as readonly string[]).includes(e.status) ? (e.status as DataExportStatus) : 'failed',
          createdAt: e.createdAt,
          completedAt: e.completedAt ?? null,
          expiresAt: e.expiresAt ?? null,
          sizeBytes: e.sizeBytes ?? null,
          downloadUrl: e.downloadUrl ?? null,
        }
      : null,
    canRequest: wire.canRequest,
    nextRequestAt: wire.nextRequestAt ?? null,
  };
}

export const dataExportKey = ['tenant', 'export'] as const;

/** While preparing, the state is polled every few seconds (it usually takes a minute or two). */
export const DATA_EXPORT_POLL_MS = 5000;

export function isPreparing(state: DataExportState | undefined): boolean {
  return state?.export?.status === 'queued' || state?.export?.status === 'processing';
}

export function useDataExport(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: dataExportKey,
    enabled: options.enabled ?? true,
    queryFn: () =>
      fromSource<DataExportState>('account', () => accountFixtures.dataExport(), async () => toDataExportState(await apiRequest<DataExportStateWire>('v1/tenant/export'))),
    refetchInterval: (q) => (isPreparing(q.state.data) ? DATA_EXPORT_POLL_MS : false),
    // The download URL is presigned and short-lived: never from the persisted cache.
    meta: { persist: false },
    staleTime: 0,
  });
}

/** Starts an export. 409 (one is running) / 429 (one per day) answer with nothing new: the state is read again. */
export function useStartDataExport() {
  const client = useQueryClient();
  return useMutation<DataExportState, unknown, void>({
    mutationFn: () =>
      fromSource<DataExportState>('account', () => accountFixtures.startDataExport(), async () =>
        toDataExportState(await apiRequest<DataExportStateWire>('v1/tenant/export', { method: 'POST' })),
      ),
    onSuccess: (state) => client.setQueryData(dataExportKey, state),
    onError: (error) => {
      if (error instanceof ApiError && (error.status === 409 || error.status === 429)) void client.invalidateQueries({ queryKey: dataExportKey });
    },
  });
}

/** "18,2 MB" / "640 KB" in the app language's number format. */
export function formatBytes(bytes: number, locale: string): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(mb)} MB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.max(1, bytes / 1024))} KB`;
}
