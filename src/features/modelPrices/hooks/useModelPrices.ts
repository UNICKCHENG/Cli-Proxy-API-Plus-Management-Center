import { useCallback, useEffect, useRef, useState } from 'react';
import { modelPricesApi, type ModelPricesReport } from '@/services/api';
import { useAuthStore } from '@/stores';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';

/** HTTP status from an ApiError, when the failure came from the API layer. */
const readStatus = (err: unknown): number | undefined => {
  if (typeof err !== 'object' || err === null || !('status' in err)) return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
};

export interface ModelPricesParams {
  /** Committed search text (not the raw input value). */
  query: string;
  page: number;
  pageSize: number;
}

/**
 * Outcome of the most recent on-demand refresh.
 *
 * Kept separate from the load `error` so a failed refresh leaves the table on
 * screen: only the sync result changes, the catalog stays readable.
 */
export type ModelPriceSyncState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; entries: number }
  | { kind: 'failed'; message: string; status?: number };

/**
 * Loads one page of the price catalog.
 *
 * The endpoint only exists on newer server builds, so a 404 is surfaced as
 * `errorStatus` for the caller to explain, rather than as a raw axios string.
 */
export function useModelPrices({ query, page, pageSize }: ModelPricesParams) {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const connected = connectionStatus === 'connected';

  const [report, setReport] = useState<ModelPricesReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorStatus, setErrorStatus] = useState<number | undefined>(undefined);
  const [syncState, setSyncState] = useState<ModelPriceSyncState>({ kind: 'idle' });
  const requestRef = useRef(0);
  const syncingRef = useRef(false);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!connected) {
      setReport(null);
      setLoading(false);
      setError('');
      setErrorStatus(undefined);
      return;
    }

    const isCurrent = () => requestId === requestRef.current;
    setLoading(true);
    setError('');
    setErrorStatus(undefined);
    try {
      const response = await modelPricesApi.getModelPrices({ q: query, page, pageSize });
      if (!isCurrent()) return;
      setReport(response);
    } catch (err: unknown) {
      if (!isCurrent()) return;
      setError(err instanceof Error ? err.message : String(err));
      setErrorStatus(readStatus(err));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [connected, page, pageSize, query]);

  useHeaderRefresh(load);

  // A sync can outlive several page switches, so the post-sync reload must go
  // through the latest loader instead of the one captured on click.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    void load();
    return () => {
      // Invalidate in-flight responses across page switches and unmount.
      requestRef.current += 1;
    };
  }, [load]);

  /**
   * Downloads the upstream cost map now. A failure is reported but never clears
   * the table, because the prices already loaded stay valid.
   */
  const sync = useCallback(async () => {
    if (!connected || syncingRef.current) return;
    syncingRef.current = true;
    setSyncState({ kind: 'busy' });
    try {
      const result = await modelPricesApi.syncModelPrices();
      // Refresh the header from the sync payload first, so the counters move even
      // if the follow-up page load fails.
      setReport((prev) => (prev ? { ...prev, pricing: result.pricing } : prev));
      setSyncState({ kind: 'done', entries: result.pricing.entryCount });
      await loadRef.current();
    } catch (err: unknown) {
      setSyncState({
        kind: 'failed',
        message: err instanceof Error ? err.message : String(err),
        status: readStatus(err),
      });
    } finally {
      syncingRef.current = false;
    }
  }, [connected]);

  return {
    report,
    loading,
    error,
    errorStatus,
    connected,
    syncState,
    sync,
    reload: load,
  };
}
