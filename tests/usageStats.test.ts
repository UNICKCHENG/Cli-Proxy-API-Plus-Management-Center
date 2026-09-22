import { describe, expect, test } from 'bun:test';
import { normalizeUsageStatsResponse } from '@/services/api';
import type { UsageStatsEntry, UsageStatsReport } from '@/services/api';
import {
  COST_BREAKDOWN_LIMIT,
  DEFAULT_USAGE_RANGE,
  USAGE_RANGES,
  buildCostRows,
  buildCostSeries,
  costAxisMax,
  formatAxisCost,
  formatCost,
  peakCostIndex,
  seriesGranularity,
  unpricedShare,
  usageRangeOption,
  type UsageRangeKey,
} from '@/features/dashboard/usage';

const makeEntry = (overrides: Partial<UsageStatsEntry> = {}): UsageStatsEntry => ({
  id: '',
  label: '',
  provider: '',
  authType: '',
  authIndex: '',
  baseUrl: '',
  model: '',
  alias: '',
  date: '',
  requests: 0,
  failed: 0,
  priced: 0,
  unpriced: 0,
  cost: 0,
  tokens: {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    unclassified: 0,
    total: 0,
  },
  ...overrides,
});

/** 后端响应 → 报告对象；测试只关心被断言到的字段。 */
const makeReport = (raw: Record<string, unknown>): UsageStatsReport =>
  normalizeUsageStatsResponse(raw);

describe('normalizeUsageStatsResponse', () => {
  test('maps snake_case backend fields onto camelCase', () => {
    const report = normalizeUsageStatsResponse({
      generated_at: '2026-09-19T00:00:00Z',
      currency: 'EUR',
      granularity: 'hour',
      hours: 24,
      days: 30,
      from: '2026-08-21',
      to: '2026-09-19',
      totals: { requests: 5, cost: 0.5 },
      models: [
        {
          id: 'gpt-4o',
          label: 'GPT-4o',
          auth_type: 'oauth',
          auth_index: '3',
          base_url: 'https://api.example.com',
          unpriced: 1,
          tokens: { input: 10, output: 20, cache_read: 3, cache_write: 4, total: 37 },
        },
      ],
      pricing: {
        entry_count: 4318,
        source: 'litellm',
        updated_at: '2026-09-19T10:00:00Z',
        sync_enabled: true,
        sync_url: 'https://example.com/prices.json',
      },
    });

    expect(report.generatedAt).toBe('2026-09-19T00:00:00Z');
    expect(report.currency).toBe('EUR');
    expect(report.from).toBe('2026-08-21');
    expect(report.totals.requests).toBe(5);
    expect(report.totals.cost).toBe(0.5);

    const model = report.models[0];
    expect(model.label).toBe('GPT-4o');
    expect(model.authType).toBe('oauth');
    expect(model.authIndex).toBe('3');
    expect(model.baseUrl).toBe('https://api.example.com');
    expect(model.unpriced).toBe(1);
    expect(model.tokens.cacheRead).toBe(3);
    expect(model.tokens.cacheWrite).toBe(4);
    expect(model.tokens.total).toBe(37);

    expect(report.pricing.entryCount).toBe(4318);
    expect(report.pricing.updatedAt).toBe('2026-09-19T10:00:00Z');
    expect(report.pricing.syncEnabled).toBe(true);
  });

  test('defaults currency to USD when absent or blank', () => {
    expect(normalizeUsageStatsResponse({}).currency).toBe('USD');
    expect(normalizeUsageStatsResponse({ currency: '' }).currency).toBe('USD');
    expect(normalizeUsageStatsResponse({ currency: 42 }).currency).toBe('USD');
  });

  test('defaults granularity to day and hours to zero', () => {
    const blank = normalizeUsageStatsResponse({});
    expect(blank.granularity).toBe('day');
    expect(blank.hours).toBe(0);
    expect(normalizeUsageStatsResponse({ granularity: 'hour', hours: '24' }).hours).toBe(24);
  });

  test('degrades non-object payloads to empty rows instead of throwing', () => {
    for (const raw of [null, undefined, 'nope', 7, []]) {
      const report = normalizeUsageStatsResponse(raw);
      expect(report.models).toEqual([]);
      expect(report.channels).toEqual([]);
      expect(report.daily).toEqual([]);
      expect(report.totals.requests).toBe(0);
      expect(report.pricing.entryCount).toBe(0);
    }
  });

  test('drops malformed rows and entries that are not arrays', () => {
    const report = normalizeUsageStatsResponse({
      models: [null, 'x', { id: 'ok' }],
      providers: 'not-an-array',
    });
    expect(report.models).toHaveLength(1);
    expect(report.models[0].id).toBe('ok');
    expect(report.providers).toEqual([]);
  });

  test('coerces numeric strings and rejects non-finite counters', () => {
    const report = normalizeUsageStatsResponse({
      totals: { requests: '12', failed: 'oops', cost: null },
    });
    expect(report.totals.requests).toBe(12);
    expect(report.totals.failed).toBe(0);
    expect(report.totals.cost).toBe(0);
  });

  test('only a literal true enables syncEnabled', () => {
    expect(normalizeUsageStatsResponse({ pricing: { sync_enabled: 'true' } }).pricing.syncEnabled)
      .toBe(false);
    expect(normalizeUsageStatsResponse({ pricing: { sync_enabled: true } }).pricing.syncEnabled)
      .toBe(true);
  });
});

describe('USAGE_RANGES', () => {
  test('is ordered 7d / 30d / 24h and defaults to 7d', () => {
    expect(USAGE_RANGES.map((option) => option.key)).toEqual(['7d', '30d', '24h']);
    expect(USAGE_RANGES.map((option) => option.key)).toContain(DEFAULT_USAGE_RANGE);
    expect(DEFAULT_USAGE_RANGE).toBe('7d');
  });

  test('maps each range onto its query and granularity', () => {
    expect(usageRangeOption('7d').query).toEqual({ days: 7 });
    expect(usageRangeOption('30d').query).toEqual({ days: 30 });
    expect(usageRangeOption('24h').query).toEqual({ hours: 24 });
    expect(usageRangeOption('24h').granularity).toBe('hour');
    expect(usageRangeOption('30d').granularity).toBe('day');
  });

  test('falls back to the first range for an unknown key', () => {
    expect(usageRangeOption('bogus' as UsageRangeKey).key).toBe('7d');
  });
});

describe('seriesGranularity', () => {
  test('reads hour only from an explicit hourly report', () => {
    expect(seriesGranularity(null)).toBe('day');
    expect(seriesGranularity(makeReport({ granularity: 'hour' }))).toBe('hour');
    expect(seriesGranularity(makeReport({ granularity: 'day' }))).toBe('day');
    expect(seriesGranularity(makeReport({ granularity: 'week' }))).toBe('day');
  });
});

describe('buildCostSeries', () => {
  test('returns nothing without a report', () => {
    expect(buildCostSeries(null, 'en-US')).toEqual([]);
  });

  test('pads every day in the window, including empty ones', () => {
    const series = buildCostSeries(
      makeReport({
        granularity: 'day',
        from: '2026-09-17',
        to: '2026-09-19',
        daily: [{ date: '2026-09-18', cost: 1.5, requests: 3 }],
      }),
      'en-US'
    );

    expect(series.map((point) => point.key)).toEqual(['2026-09-17', '2026-09-18', '2026-09-19']);
    expect(series.map((point) => point.label)).toEqual(['9/17', '9/18', '9/19']);
    expect(series.map((point) => point.cost)).toEqual([0, 1.5, 0]);
    expect(series.map((point) => point.requests)).toEqual([0, 3, 0]);
  });

  test('labels hourly buckets as hh:00', () => {
    const series = buildCostSeries(
      makeReport({
        granularity: 'hour',
        from: '2026-09-19T08',
        to: '2026-09-19T10',
        daily: [{ date: '2026-09-19T09', cost: 0.25, requests: 2 }],
      }),
      'en-US'
    );

    expect(series.map((point) => point.key)).toEqual([
      '2026-09-19T08',
      '2026-09-19T09',
      '2026-09-19T10',
    ]);
    expect(series.map((point) => point.label)).toEqual(['08:00', '09:00', '10:00']);
    expect(series.map((point) => point.cost)).toEqual([0, 0.25, 0]);
  });

  test('drops daily rows that fall outside the window', () => {
    const series = buildCostSeries(
      makeReport({
        granularity: 'day',
        from: '2026-09-18',
        to: '2026-09-19',
        daily: [{ date: '2026-01-01', cost: 99, requests: 1 }],
      }),
      'en-US'
    );

    expect(series.map((point) => point.key)).toEqual(['2026-09-18', '2026-09-19']);
    expect(series.every((point) => point.cost === 0)).toBe(true);
  });

  test('falls back to the raw daily rows when the window is unusable', () => {
    const series = buildCostSeries(
      makeReport({
        granularity: 'day',
        daily: [
          { date: '2026-09-18', cost: 1, requests: 1 },
          { date: '2026-09-19', cost: 2, requests: 4 },
        ],
      }),
      'en-US'
    );

    expect(series.map((point) => point.cost)).toEqual([1, 2]);
  });

  test('caps a wide window instead of generating thousands of buckets', () => {
    const series = buildCostSeries(
      makeReport({ granularity: 'day', from: '1900-01-01', to: '2100-01-01' }),
      'en-US'
    );
    expect(series.length).toBe(400);
  });
});

describe('peakCostIndex', () => {
  test('is -1 when nothing is priced', () => {
    expect(peakCostIndex([])).toBe(-1);
    expect(peakCostIndex([{ key: 'a', label: 'a', cost: 0, requests: 3 }])).toBe(-1);
  });

  test('points at the costliest bucket, keeping the first on a tie', () => {
    const point = (key: string, cost: number) => ({ key, label: key, cost, requests: 1 });
    expect(peakCostIndex([point('a', 1), point('b', 5), point('c', 3)])).toBe(1);
    expect(peakCostIndex([point('a', 5), point('b', 5)])).toBe(0);
  });
});

describe('buildCostRows', () => {
  test('returns nothing without a report', () => {
    expect(buildCostRows(null, 'models', 'Unknown')).toEqual([]);
  });

  test('keeps unpriced rows so token requests remain visible', () => {
    const rows = buildCostRows(
      makeReport({
        models: [
          { id: 'paid', label: 'Paid', cost: 2, requests: 1 },
          { id: 'cursor-auto', label: 'Cursor Auto', cost: 0, requests: 4, unpriced: 4 },
        ],
      }),
      'models',
      'Unknown'
    );

    expect(rows.map((row) => row.id)).toEqual(['paid', 'cursor-auto']);
    expect(rows[1].requests).toBe(4);
    expect(rows[1].unpriced).toBe(4);
  });

  test('scales share against the peak row and keeps the alias as sublabel', () => {
    const rows = buildCostRows(
      makeReport({
        models: [
          { id: 'a', label: 'A', alias: 'Alfa', cost: 4, requests: 8 },
          { id: 'b', label: 'B', cost: 1, requests: 2, unpriced: 1 },
        ],
      }),
      'models',
      'Unknown'
    );

    expect(rows.map((row) => row.share)).toEqual([1, 0.25]);
    expect(rows[0].sublabel).toBe('Alfa');
    expect(rows[1].unpriced).toBe(1);
    expect(rows[1].requests).toBe(2);
  });

  test('uses the provider display name for the provider dimension', () => {
    const rows = buildCostRows(
      makeReport({ providers: [{ id: 'openai', cost: 1, requests: 1 }] }),
      'providers',
      'Unknown'
    );

    expect(rows[0].label).toBe('OpenAI Compatible');
    expect(rows[0].sublabel).toBe('');
  });

  test('resolves the unknown provider label for a blank id', () => {
    const rows = buildCostRows(
      makeReport({ providers: [{ id: 'unknown', cost: 1, requests: 1 }] }),
      'providers',
      '未知供应商'
    );

    expect(rows[0].label).toBe('未知供应商');
  });

  test('falls back through model, id, then a dash for the model dimension', () => {
    const label = (entry: Record<string, unknown>) =>
      buildCostRows(makeReport({ models: [{ cost: 1, requests: 1, ...entry }] }), 'models', 'U')[0]
        .label;

    expect(label({ label: 'L', model: 'M', id: 'I' })).toBe('L');
    expect(label({ model: 'M', id: 'I' })).toBe('M');
    expect(label({ id: 'I' })).toBe('I');
    expect(label({})).toBe('—');
  });

  test('caps the ranking at the default limit', () => {
    const models = Array.from({ length: 12 }, (_, index) => ({
      id: `m${index}`,
      cost: 12 - index,
      requests: 1,
    }));

    expect(buildCostRows(makeReport({ models }), 'models', 'U')).toHaveLength(
      COST_BREAKDOWN_LIMIT
    );
    expect(COST_BREAKDOWN_LIMIT).toBe(8);
    expect(buildCostRows(makeReport({ models }), 'models', 'U', 3)).toHaveLength(3);
  });
});

describe('formatCost', () => {
  test('scales precision with magnitude', () => {
    expect(formatCost(0.000123, 'USD')).toBe('0.000123 USD');
    expect(formatCost(0.5, 'USD')).toBe('0.5000 USD');
    expect(formatCost(12.5, 'USD')).toBe('12.50 USD');
    expect(formatCost(1234.5, 'USD')).toBe('1,234.50 USD');
  });

  test('treats zero and non-finite values as zero cost', () => {
    expect(formatCost(0, 'USD')).toBe('0.0000 USD');
    expect(formatCost(Number.NaN, 'USD')).toBe('0.0000 USD');
    expect(formatCost(Number.POSITIVE_INFINITY, 'USD')).toBe('0.0000 USD');
  });

  test('falls back to USD for a blank currency', () => {
    expect(formatCost(12.5, '')).toBe('12.50 USD');
  });
});

describe('formatAxisCost', () => {
  test('renders zero for non-positive and non-finite values', () => {
    expect(formatAxisCost(0)).toBe('0');
    expect(formatAxisCost(-2)).toBe('0');
    expect(formatAxisCost(Number.NaN)).toBe('0');
  });

  test('keeps sub-cent precision instead of collapsing to 0', () => {
    expect(formatAxisCost(0.005)).toBe('0.0050');
    expect(formatAxisCost(0.5)).toBe('0.50');
  });

  test('compresses thousands and millions', () => {
    expect(formatAxisCost(1)).toBe('1.0');
    expect(formatAxisCost(123)).toBe('123');
    expect(formatAxisCost(1500)).toBe('1.5K');
    expect(formatAxisCost(50000)).toBe('50K');
    expect(formatAxisCost(2_500_000)).toBe('2.5M');
  });
});

describe('costAxisMax', () => {
  test('is 0 for a non-positive peak or a non-positive interval count', () => {
    expect(costAxisMax(0, 4)).toBe(0);
    expect(costAxisMax(-1, 4)).toBe(0);
    expect(costAxisMax(Number.NaN, 4)).toBe(0);
    expect(costAxisMax(10, 0)).toBe(0);
  });

  test('rounds up to a readable step times the interval count', () => {
    expect(costAxisMax(4, 4)).toBe(4);
    expect(costAxisMax(5, 4)).toBe(6);
  });

  test('keeps a fractional step so sub-cent series are not flattened', () => {
    /* axisMax 会把步长抬到 1，这里必须保持小数 */
    expect(costAxisMax(0.0004, 4)).toBeCloseTo(0.0004, 10);
    expect(costAxisMax(0.0004, 4)).toBeLessThan(1);
  });

  test('never returns a ceiling below the peak', () => {
    for (const peak of [0.000123, 0.5, 1, 4, 5, 99.5, 1234.5, 987_654]) {
      for (const intervals of [1, 4, 8]) {
        expect(costAxisMax(peak, intervals)).toBeGreaterThanOrEqual(peak - 1e-9);
      }
    }
  });
});

describe('unpricedShare', () => {
  test('is null when nothing was requested', () => {
    expect(unpricedShare(makeEntry())).toBeNull();
  });

  test('reports the unpriced fraction of requests', () => {
    expect(unpricedShare(makeEntry({ requests: 4, unpriced: 1 }))).toBe(0.25);
  });
});
