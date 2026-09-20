import { useCallback, useEffect, useRef, useState } from 'react';
import { usageStatsApi, type UsageStatsReport } from '@/services/api';
import { useAuthStore } from '@/stores';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { usageRangeOption, type UsageRangeKey } from '../usage';

/** HTTP status from an ApiError, when the failure came from the API layer. */
const readStatus = (err: unknown): number | undefined => {
  if (typeof err !== 'object' || err === null || !('status' in err)) return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
};

/**
 * Loads the cost report for one window.
 *
 * The endpoint only exists on newer server builds, so a 404 is surfaced as
 * `errorStatus` for the caller to explain, rather than as a raw axios string.
 */
export function useUsageStats(range: UsageRangeKey) {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const connected = connectionStatus === 'connected';

  const [report, setReport] = useState<UsageStatsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorStatus, setErrorStatus] = useState<number | undefined>(undefined);
  const requestRef = useRef(0);

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
      const response = await usageStatsApi.getUsageStats(usageRangeOption(range).query);
      if (!isCurrent()) return;
      setReport(response);
    } catch (err: unknown) {
      if (!isCurrent()) return;
      setError(err instanceof Error ? err.message : String(err));
      setErrorStatus(readStatus(err));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [connected, range]);

  useHeaderRefresh(load);

  useEffect(() => {
    void load();
    return () => {
      // Invalidate in-flight responses across range switches and unmount.
      requestRef.current += 1;
    };
  }, [load]);

  return { report, loading, error, errorStatus, connected, reload: load };
}
