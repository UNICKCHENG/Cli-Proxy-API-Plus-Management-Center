import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';

const MODEL_PRICES_TIMEOUT_MS = 20 * 1000;

/**
 * A sync waits on a remote download, so it gets a longer budget than a read.
 * It stays above the server's own sync timeout so an unreachable upstream still
 * comes back as a readable error instead of a client-side abort.
 */
const MODEL_PRICES_SYNC_TIMEOUT_MS = 75 * 1000;

/** Page size used when the caller does not pick one. */
export const MODEL_PRICES_PAGE_SIZE = 50;

/** Upper bound the backend accepts, mirrored so the UI cannot ask for more. */
export const MODEL_PRICES_MAX_PAGE_SIZE = 200;

/** Status of the model price table backing cost estimation. */
export interface ModelPriceStatus {
  entryCount: number;
  /** Number of operator-provided overrides currently in effect. */
  overrideCount: number;
  source: string;
  updatedAt: string;
  syncEnabled: boolean;
  syncUrl: string;
}

/**
 * Per-token USD rates for one model key.
 *
 * `model` is the literal lookup key the estimator matches against, not a
 * prettified display name, so this doubles as a debugging view.
 */
export interface ModelPriceEntry {
  model: string;
  /** True when an operator override shadows the synced price. */
  override: boolean;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
}

export interface ModelPricesReport {
  generatedAt: string;
  pricing: ModelPriceStatus;
  query: string;
  page: number;
  pageSize: number;
  total: number;
  entries: ModelPriceEntry[];
}

const readString = (value: unknown): string => (typeof value === 'string' ? value : '');

const readNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const readBoolean = (value: unknown): boolean => value === true;

/**
 * Normalizes the `pricing` status block, which is shared between the price
 * catalog and the usage-stats payload.
 */
export const normalizeModelPriceStatus = (raw: unknown): ModelPriceStatus => {
  const source: Record<string, unknown> = isRecord(raw) ? raw : {};
  return {
    entryCount: readNumber(source.entry_count),
    overrideCount: readNumber(source.override_count),
    source: readString(source.source),
    updatedAt: readString(source.updated_at),
    syncEnabled: readBoolean(source.sync_enabled),
    syncUrl: readString(source.sync_url),
  };
};

/** A price row is only usable when at least one rate is published. */
const normalizeModelPriceEntry = (raw: unknown): ModelPriceEntry => {
  const source: Record<string, unknown> = isRecord(raw) ? raw : {};
  return {
    model: readString(source.model),
    override: readBoolean(source.override),
    input: readNumber(source.input_per_token),
    output: readNumber(source.output_per_token),
    cacheRead: readNumber(source.cache_read_per_token),
    cacheWrite: readNumber(source.cache_write_per_token),
    reasoning: readNumber(source.reasoning_per_token),
  };
};

/** Normalizes the Management API payload; unknown shapes degrade to empty rows. */
export const normalizeModelPricesResponse = (raw: unknown): ModelPricesReport => {
  const source: Record<string, unknown> = isRecord(raw) ? raw : {};
  const entries = Array.isArray(source.entries)
    ? source.entries.flatMap((item) => (isRecord(item) ? [normalizeModelPriceEntry(item)] : []))
    : [];
  return {
    generatedAt: readString(source.generated_at),
    pricing: normalizeModelPriceStatus(source.pricing),
    query: readString(source.query),
    page: readNumber(source.page) || 1,
    pageSize: readNumber(source.page_size) || MODEL_PRICES_PAGE_SIZE,
    // Falling back to the row count keeps paging usable if `total` is absent.
    total: readNumber(source.total) || entries.length,
    entries,
  };
};

export interface ModelPricesQuery {
  /** Case-insensitive substring filter on the model key. */
  q?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Result of an on-demand refresh.
 *
 * `pricing` mirrors the block returned by the catalog read, so the header can be
 * updated without a second request.
 */
export interface ModelPriceSyncResult {
  generatedAt: string;
  pricing: ModelPriceStatus;
}

/** Normalizes the sync payload; unknown shapes degrade to an empty status. */
export const normalizeModelPriceSyncResponse = (raw: unknown): ModelPriceSyncResult => {
  const source: Record<string, unknown> = isRecord(raw) ? raw : {};
  return {
    generatedAt: readString(source.generated_at),
    pricing: normalizeModelPriceStatus(source.pricing),
  };
};

export const modelPricesApi = {
  getModelPrices: async (query: ModelPricesQuery = {}): Promise<ModelPricesReport> => {
    const params: Record<string, string> = {};
    const trimmed = (query.q ?? '').trim();
    if (trimmed) params.q = trimmed;
    if (typeof query.page === 'number') params.page = String(query.page);
    if (typeof query.pageSize === 'number') params.page_size = String(query.pageSize);
    const raw = await apiClient.get<unknown>('/model-prices', {
      params,
      timeout: MODEL_PRICES_TIMEOUT_MS,
    });
    return normalizeModelPricesResponse(raw);
  },

  /**
   * Downloads the upstream cost map now. The catalog is otherwise only fetched
   * once per server start, so this is the only way to pick up changed prices
   * without restarting the backend.
   */
  syncModelPrices: async (): Promise<ModelPriceSyncResult> => {
    const raw = await apiClient.post<unknown>('/model-prices/sync', undefined, {
      timeout: MODEL_PRICES_SYNC_TIMEOUT_MS,
    });
    return normalizeModelPriceSyncResponse(raw);
  },
};
