import type { UsageStatsEntry, UsageStatsReport } from '@/services/api';
import { niceCeil, providerLabel } from './utils';

/** Granularity of the series returned by the Management API. */
export type UsageGranularity = 'hour' | 'day';

/** Selectable reporting windows. */
export type UsageRangeKey = '24h' | '7d' | '30d';

interface UsageRangeOption {
  key: UsageRangeKey;
  /** Query sent to the Management API. */
  query: { hours: number } | { days: number };
  /** Granularity the backend reports for this window. */
  granularity: UsageGranularity;
}

/** Ordered as presented: 7 天 / 30 天 / 24 小时. */
export const USAGE_RANGES: readonly UsageRangeOption[] = [
  { key: '7d', query: { days: 7 }, granularity: 'day' },
  { key: '30d', query: { days: 30 }, granularity: 'day' },
  { key: '24h', query: { hours: 24 }, granularity: 'hour' },
];

export const DEFAULT_USAGE_RANGE: UsageRangeKey = '7d';

const FALLBACK_RANGE = USAGE_RANGES[0];

export const usageRangeOption = (key: UsageRangeKey): UsageRangeOption =>
  USAGE_RANGES.find((option) => option.key === key) ?? FALLBACK_RANGE;

/** Cost by model / provider is a ranking, so only the head of the list is charted. */
export const COST_BREAKDOWN_LIMIT = 8;

/** Upper bound on generated buckets, so a wide explicit range cannot hang the chart. */
const MAX_SERIES_BUCKETS = 400;

const HOUR_STEP_MS = 3_600_000;
const DAY_STEP_MS = 86_400_000;

export interface CostPoint {
  key: string;
  label: string;
  cost: number;
  requests: number;
}

export interface CostRow {
  id: string;
  label: string;
  sublabel: string;
  cost: number;
  requests: number;
  unpriced: number;
  /** Bar length relative to the costliest row, 0..1. */
  share: number;
}

const parseBucketKey = (key: string, granularity: UsageGranularity): Date | null => {
  const iso = granularity === 'hour' ? `${key}:00:00Z` : `${key}T00:00:00Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Every bucket in the window, in order, so days (or hours) without traffic
 * render as empty slots instead of collapsing the axis.
 */
const enumerateBuckets = (from: string, to: string, granularity: UsageGranularity): string[] => {
  const start = parseBucketKey(from, granularity);
  const end = parseBucketKey(to, granularity);
  if (!start || !end || start.getTime() > end.getTime()) return [];
  const step = granularity === 'hour' ? HOUR_STEP_MS : DAY_STEP_MS;
  const keys: string[] = [];
  for (let time = start.getTime(); time <= end.getTime(); time += step) {
    const iso = new Date(time).toISOString();
    keys.push(granularity === 'hour' ? iso.slice(0, 13) : iso.slice(0, 10));
    if (keys.length >= MAX_SERIES_BUCKETS) break;
  }
  return keys;
};

/** Buckets are UTC, so labels are rendered in UTC as well to match the data. */
const bucketLabel = (key: string, granularity: UsageGranularity, locale: string): string => {
  if (granularity === 'hour') return `${key.slice(11, 13)}:00`;
  const date = new Date(`${key}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString(locale || 'en', {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'UTC',
  });
};

export const seriesGranularity = (report: UsageStatsReport | null): UsageGranularity =>
  report?.granularity === 'hour' ? 'hour' : 'day';

/** Cost series for the histogram, padded across the whole requested window. */
export const buildCostSeries = (report: UsageStatsReport | null, locale: string): CostPoint[] => {
  if (!report) return [];
  const granularity = seriesGranularity(report);
  const byDate = new Map(report.daily.map((entry) => [entry.date || entry.id, entry]));
  const keys = enumerateBuckets(report.from, report.to, granularity);
  const ordered = keys.length > 0 ? keys : report.daily.map((entry) => entry.date || entry.id);
  return ordered.map((key) => {
    const entry = byDate.get(key);
    return {
      key,
      label: bucketLabel(key, granularity, locale),
      cost: entry?.cost ?? 0,
      requests: entry?.requests ?? 0,
    };
  });
};

/** Index of the costliest bucket, or -1 when nothing is priced. */
export const peakCostIndex = (series: CostPoint[]): number => {
  let index = -1;
  let best = 0;
  series.forEach((point, position) => {
    if (point.cost > best) {
      best = point.cost;
      index = position;
    }
  });
  return index;
};

const costRowLabel = (
  entry: UsageStatsEntry,
  dimension: 'models' | 'providers',
  unknownLabel: string
): string => {
  if (dimension === 'providers') return providerLabel(entry.id || entry.provider, unknownLabel);
  return entry.label || entry.model || entry.id || '—';
};

/**
 * Cost by model/provider is a ranking, but unpriced requests still carry valid
 * token and request counts. Keep them visible so providers without a public
 * price (for example Cursor router models) are not mistaken for missing data.
 */
const hasUsage = (entry: UsageStatsEntry): boolean => entry.requests > 0;

/** Top usage rows for one dimension, retaining rows whose price is unknown. */
export const buildCostRows = (
  report: UsageStatsReport | null,
  dimension: 'models' | 'providers',
  unknownLabel: string,
  limit = COST_BREAKDOWN_LIMIT
): CostRow[] => {
  if (!report) return [];
  const entries = dimension === 'models' ? report.models : report.providers;
  const rows = entries.filter(hasUsage).slice(0, limit);
  const peak = rows.reduce((max, entry) => Math.max(max, entry.cost), 0);
  return rows.map((entry) => ({
    id: entry.id,
    label: costRowLabel(entry, dimension, unknownLabel),
    sublabel: dimension === 'models' ? entry.alias : '',
    cost: entry.cost,
    requests: entry.requests,
    unpriced: entry.unpriced,
    share: peak > 0 ? entry.cost / peak : 0,
  }));
};

/** Sub-cent costs need more decimals than whole-dollar ones. */
const costFractionDigits = (magnitude: number): number => {
  if (magnitude > 0 && magnitude < 0.01) return 6;
  if (magnitude < 1) return 4;
  return 2;
};

export const formatCost = (value: number, currency: string): string => {
  const amount = Number.isFinite(value) ? value : 0;
  const digits = costFractionDigits(Math.abs(amount));
  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${formatted} ${currency || 'USD'}`;
};

/** Axis labels drop the currency unit and compress large magnitudes. */
export const formatAxisCost = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  if (value >= 1) return value.toFixed(value >= 100 ? 0 : 1);
  if (value >= 0.01) return value.toFixed(2);
  return value.toFixed(4);
};

/**
 * Nice cost-axis ceiling.
 *
 * `axisMax` floors its step to 1, which is right for counts but would flatten a
 * sub-cent cost series onto the baseline, so the step stays fractional here.
 */
export const costAxisMax = (peak: number, intervals: number): number => {
  if (!Number.isFinite(peak) || peak <= 0 || intervals <= 0) return 0;
  return niceCeil(peak / intervals) * intervals;
};

/** Share of requests that could not be priced, or null when there are none. */
export const unpricedShare = (entry: UsageStatsEntry): number | null =>
  entry.requests > 0 ? entry.unpriced / entry.requests : null;
