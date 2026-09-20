import { apiClient } from './client';
import { normalizeModelPriceStatus, type ModelPriceStatus } from './modelPrices';
import { isRecord } from '@/utils/helpers';

const USAGE_STATS_TIMEOUT_MS = 20 * 1000;

/** Token counters for one aggregation row. */
export interface UsageStatsTokenTotals {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  unclassified: number;
  total: number;
}

/**
 * One aggregated row: a model, a provider, a channel, or a single day.
 * `date` is only populated for daily rows.
 */
export interface UsageStatsEntry {
  id: string;
  label: string;
  provider: string;
  authType: string;
  authIndex: string;
  baseUrl: string;
  model: string;
  alias: string;
  date: string;
  requests: number;
  failed: number;
  /** Requests whose tokens matched a known price. */
  priced: number;
  /** Requests with no matching price; they contribute no cost. */
  unpriced: number;
  cost: number;
  tokens: UsageStatsTokenTotals;
}

export type UsageStatsPricing = ModelPriceStatus;

export interface UsageStatsReport {
  generatedAt: string;
  currency: string;
  /** `hour` or `day`: how to read `date` on daily rows. */
  granularity: string;
  days: number;
  /** Set only for hourly windows. */
  hours: number;
  from: string;
  to: string;
  totals: UsageStatsEntry;
  models: UsageStatsEntry[];
  providers: UsageStatsEntry[];
  channels: UsageStatsEntry[];
  daily: UsageStatsEntry[];
  pricing: UsageStatsPricing;
}

const readString = (value: unknown): string => (typeof value === 'string' ? value : '');

const readNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeTokenTotals = (raw: unknown): UsageStatsTokenTotals => {
  const source: Record<string, unknown> = isRecord(raw) ? raw : {};
  return {
    input: readNumber(source.input),
    output: readNumber(source.output),
    reasoning: readNumber(source.reasoning),
    cacheRead: readNumber(source.cache_read),
    cacheWrite: readNumber(source.cache_write),
    unclassified: readNumber(source.unclassified),
    total: readNumber(source.total),
  };
};

const normalizeEntry = (raw: unknown): UsageStatsEntry => {
  const source: Record<string, unknown> = isRecord(raw) ? raw : {};
  return {
    id: readString(source.id),
    label: readString(source.label),
    provider: readString(source.provider),
    authType: readString(source.auth_type),
    authIndex: readString(source.auth_index),
    baseUrl: readString(source.base_url),
    model: readString(source.model),
    alias: readString(source.alias),
    date: readString(source.date),
    requests: readNumber(source.requests),
    failed: readNumber(source.failed),
    priced: readNumber(source.priced),
    unpriced: readNumber(source.unpriced),
    cost: readNumber(source.cost),
    tokens: normalizeTokenTotals(source.tokens),
  };
};

/** Array rows must be objects; junk elements are dropped rather than zeroed. */
const normalizeEntries = (raw: unknown): UsageStatsEntry[] =>
  Array.isArray(raw)
    ? raw.flatMap((item) => (isRecord(item) ? [normalizeEntry(item)] : []))
    : [];

/** Normalizes the Management API payload; unknown shapes degrade to empty rows. */
export const normalizeUsageStatsResponse = (raw: unknown): UsageStatsReport => {
  const source: Record<string, unknown> = isRecord(raw) ? raw : {};
  return {
    generatedAt: readString(source.generated_at),
    currency: readString(source.currency) || 'USD',
    granularity: readString(source.granularity) || 'day',
    days: readNumber(source.days),
    hours: readNumber(source.hours),
    from: readString(source.from),
    to: readString(source.to),
    totals: normalizeEntry(source.totals),
    models: normalizeEntries(source.models),
    providers: normalizeEntries(source.providers),
    channels: normalizeEntries(source.channels),
    daily: normalizeEntries(source.daily),
    pricing: normalizeModelPriceStatus(source.pricing),
  };
};

export interface UsageStatsQuery {
  /** Trailing window length in days. Ignored when `from`/`to` are both set. */
  days?: number;
  /**
   * Trailing window length in hours, reported at hourly granularity. Wins over
   * `days`; `from`/`to` still win over both.
   */
  hours?: number;
  /** Inclusive `YYYY-MM-DD` range start. */
  from?: string;
  /** Inclusive `YYYY-MM-DD` range end. */
  to?: string;
}

export const usageStatsApi = {
  getUsageStats: async (query: UsageStatsQuery = {}): Promise<UsageStatsReport> => {
    const params: Record<string, string> = {};
    if (query.from && query.to) {
      params.from = query.from;
      params.to = query.to;
    } else if (typeof query.hours === 'number') {
      params.hours = String(query.hours);
    } else if (typeof query.days === 'number') {
      params.days = String(query.days);
    }
    const raw = await apiClient.get<unknown>('/usage-stats', {
      params,
      timeout: USAGE_STATS_TIMEOUT_MS,
    });
    return normalizeUsageStatsResponse(raw);
  },
};
