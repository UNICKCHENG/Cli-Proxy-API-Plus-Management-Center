import { describe, expect, test } from 'bun:test';
import {
  MODEL_PRICES_PAGE_SIZE,
  normalizeModelPriceStatus,
  normalizeModelPriceSyncResponse,
  normalizeModelPricesResponse,
} from '@/services/api';
import type { ModelPriceEntry, ModelPricesReport } from '@/services/api';
import {
  clampPage,
  entryHasPrice,
  formatPerMillion,
  hasRate,
  toPerMillion,
  totalPages,
} from '@/features/modelPrices/prices';

const makeEntry = (overrides: Partial<ModelPriceEntry> = {}): ModelPriceEntry => ({
  model: '',
  override: false,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  ...overrides,
});

/** 后端响应 → 报告对象；测试只关心被断言到的字段。 */
const makeReport = (raw: unknown): ModelPricesReport => normalizeModelPricesResponse(raw);

describe('normalizeModelPricesResponse', () => {
  test('maps snake_case backend fields onto camelCase', () => {
    const report = makeReport({
      generated_at: '2026-09-19T10:00:00Z',
      pricing: {
        entry_count: 4247,
        override_count: 3,
        source: 'litellm',
        updated_at: '2026-09-19T09:00:00Z',
        sync_enabled: true,
        sync_url: 'https://example.com/prices.json',
      },
      query: 'gemini',
      page: 2,
      page_size: 25,
      total: 120,
      entries: [
        {
          model: 'gemini-2.5-pro',
          override: true,
          input_per_token: 1.25e-6,
          output_per_token: 1e-5,
          cache_read_per_token: 3.1e-7,
          cache_write_per_token: 1.25e-6,
          reasoning_per_token: 1e-5,
        },
      ],
    });

    expect(report.generatedAt).toBe('2026-09-19T10:00:00Z');
    expect(report.query).toBe('gemini');
    expect(report.page).toBe(2);
    expect(report.pageSize).toBe(25);
    expect(report.total).toBe(120);

    expect(report.pricing.entryCount).toBe(4247);
    expect(report.pricing.overrideCount).toBe(3);
    expect(report.pricing.source).toBe('litellm');
    expect(report.pricing.updatedAt).toBe('2026-09-19T09:00:00Z');
    expect(report.pricing.syncEnabled).toBe(true);
    expect(report.pricing.syncUrl).toBe('https://example.com/prices.json');

    expect(report.entries).toHaveLength(1);
    const entry = report.entries[0];
    expect(entry.model).toBe('gemini-2.5-pro');
    expect(entry.override).toBe(true);
    expect(entry.input).toBe(1.25e-6);
    expect(entry.output).toBe(1e-5);
    expect(entry.cacheRead).toBe(3.1e-7);
    expect(entry.cacheWrite).toBe(1.25e-6);
    expect(entry.reasoning).toBe(1e-5);
  });

  test('drops junk rows from the entries array instead of failing', () => {
    const report = makeReport({
      entries: [null, 42, 'nope', [], true, { model: 'ok', input_per_token: 1e-6 }],
    });
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].model).toBe('ok');
    expect(report.entries[0].input).toBe(1e-6);
    expect(report.entries[0].output).toBe(0);
  });

  test('treats a non-true override flag as false', () => {
    const report = makeReport({
      entries: [{ model: 'a', override: 'yes' }, { model: 'b', override: 1 }, { model: 'c' }],
    });
    expect(report.entries.map((entry) => entry.override)).toEqual([false, false, false]);
  });

  test('falls back to page 1 and the default page size', () => {
    const report = makeReport({ entries: [{ model: 'a' }] });
    expect(report.page).toBe(1);
    expect(report.pageSize).toBe(MODEL_PRICES_PAGE_SIZE);
    // total 缺失时退化为行数，保证分页仍可用
    expect(report.total).toBe(1);
  });

  test('coerces a zero page back to 1', () => {
    expect(makeReport({ page: 0, page_size: 0 }).page).toBe(1);
    expect(makeReport({ page: 0, page_size: 0 }).pageSize).toBe(MODEL_PRICES_PAGE_SIZE);
  });

  test('degrades non-object payloads to an empty report', () => {
    for (const raw of [null, undefined, 42, 'str', true, []]) {
      const report = makeReport(raw);
      expect(report.entries).toEqual([]);
      expect(report.total).toBe(0);
      expect(report.page).toBe(1);
      expect(report.pageSize).toBe(MODEL_PRICES_PAGE_SIZE);
      expect(report.query).toBe('');
      expect(report.generatedAt).toBe('');
      expect(report.pricing.entryCount).toBe(0);
    }
  });

  test('treats a non-array entries field as empty', () => {
    expect(makeReport({ entries: { model: 'a' } }).entries).toEqual([]);
    expect(makeReport({ entries: 'a,b' }).entries).toEqual([]);
  });

  test('coerces numeric strings and rejects unparseable numbers as 0', () => {
    const report = makeReport({
      page: '3',
      page_size: '25',
      total: '99',
      entries: [{ model: 'a', input_per_token: '0.000002', output_per_token: 'abc' }],
    });
    expect([report.page, report.pageSize, report.total]).toEqual([3, 25, 99]);
    expect(report.entries[0].input).toBe(0.000002);
    expect(report.entries[0].output).toBe(0);
  });
});

describe('normalizeModelPriceStatus', () => {
  test('reads the override count the catalog header shows', () => {
    expect(normalizeModelPriceStatus({ override_count: 7 }).overrideCount).toBe(7);
  });

  test('defaults missing fields to 0 / empty / false', () => {
    const status = normalizeModelPriceStatus({});
    expect(status).toEqual({
      entryCount: 0,
      overrideCount: 0,
      source: '',
      updatedAt: '',
      syncEnabled: false,
      syncUrl: '',
    });
  });

  test('degrades non-object input to the default status', () => {
    for (const raw of [null, undefined, 1, 'x', []]) {
      expect(normalizeModelPriceStatus(raw).entryCount).toBe(0);
      expect(normalizeModelPriceStatus(raw).syncEnabled).toBe(false);
    }
  });
});

describe('normalizeModelPriceSyncResponse', () => {
  const pricing = {
    entry_count: 4247,
    override_count: 2,
    source: 'litellm',
    updated_at: '2026-09-19T10:00:00Z',
    sync_enabled: false,
    sync_url: 'https://example.test/cost-map.json',
  };

  test('reads the pricing block the catalog header renders', () => {
    const result = normalizeModelPriceSyncResponse({
      generated_at: '2026-09-19T10:00:05Z',
      pricing,
    });

    expect(result.generatedAt).toBe('2026-09-19T10:00:05Z');
    expect(result.pricing.entryCount).toBe(4247);
    expect(result.pricing.overrideCount).toBe(2);
    expect(result.pricing.source).toBe('litellm');
  });

  test('a payload without a pricing block degrades to an empty status', () => {
    const result = normalizeModelPriceSyncResponse({});

    expect(result.generatedAt).toBe('');
    expect(result.pricing.entryCount).toBe(0);
    expect(result.pricing.overrideCount).toBe(0);
    expect(result.pricing.source).toBe('');
  });

  test('non-object payloads do not throw', () => {
    for (const raw of [null, undefined, 'nope', 42, ['pricing']]) {
      const result = normalizeModelPriceSyncResponse(raw);
      expect(result.generatedAt).toBe('');
      expect(result.pricing.entryCount).toBe(0);
    }
  });

  test('sync_enabled is carried through even though the runtime reports false', () => {
    const result = normalizeModelPriceSyncResponse({ pricing });
    expect(result.pricing.syncEnabled).toBe(false);
    expect(result.pricing.syncUrl).toBe('https://example.test/cost-map.json');
  });
});

describe('toPerMillion', () => {
  test('scales per-token rates to per-million rates', () => {
    expect(toPerMillion(3e-6)).toBe(3);
    expect(toPerMillion(1e-6)).toBe(1);
    expect(toPerMillion(0)).toBe(0);
  });

  test('treats non-finite input as 0', () => {
    expect(toPerMillion(NaN)).toBe(0);
    expect(toPerMillion(Infinity)).toBe(0);
    expect(toPerMillion(-Infinity)).toBe(0);
  });
});

describe('hasRate', () => {
  test('only positive finite rates count as published', () => {
    expect(hasRate(3e-6)).toBe(true);
    expect(hasRate(1e-9)).toBe(true);
    expect(hasRate(0)).toBe(false);
    expect(hasRate(-1)).toBe(false);
    expect(hasRate(NaN)).toBe(false);
    expect(hasRate(Infinity)).toBe(false);
  });
});

describe('entryHasPrice', () => {
  test('is false only when every rate is unpublished', () => {
    expect(entryHasPrice(makeEntry())).toBe(false);
    expect(entryHasPrice(makeEntry({ input: 1e-6 }))).toBe(true);
    expect(entryHasPrice(makeEntry({ output: 1e-5 }))).toBe(true);
    expect(entryHasPrice(makeEntry({ cacheRead: 1e-7 }))).toBe(true);
    expect(entryHasPrice(makeEntry({ cacheWrite: 1e-6 }))).toBe(true);
    expect(entryHasPrice(makeEntry({ reasoning: 1e-5 }))).toBe(true);
    expect(entryHasPrice(makeEntry({ input: NaN, output: 0 }))).toBe(false);
  });
});

describe('formatPerMillion', () => {
  test('renders a per-million dollar rate', () => {
    expect(formatPerMillion(3e-6)).toBe('$3.00');
    expect(formatPerMillion(15e-6)).toBe('$15.00');
    expect(formatPerMillion(1.5e-6)).toBe('$1.50');
  });

  test('adds thousands separators for expensive models', () => {
    expect(formatPerMillion(2.5e-3)).toBe('$2,500.00');
  });

  test('scales precision so sub-cent rates stay meaningful', () => {
    expect(formatPerMillion(1e-7)).toBe('$0.100');
    expect(formatPerMillion(1e-8)).toBe('$0.010');
    expect(formatPerMillion(1e-9)).toBe('$0.0010');
    expect(formatPerMillion(1e-10)).toBe('$0.0001');
    expect(formatPerMillion(1e-11)).toBe('$0.000010');
    expect(formatPerMillion(1e-12)).toBe('$0.000001');
  });

  test('shows the placeholder when the rate is unpublished', () => {
    // 0 表示「未公布」，不是免费，因此不能显示成 $0.00
    expect(formatPerMillion(0)).toBe('—');
    expect(formatPerMillion(-1)).toBe('—');
    expect(formatPerMillion(NaN)).toBe('—');
    expect(formatPerMillion(Infinity)).toBe('—');
  });

  test('accepts a custom placeholder but not for published rates', () => {
    expect(formatPerMillion(0, 'n/a')).toBe('n/a');
    expect(formatPerMillion(3e-6, 'n/a')).toBe('$3.00');
  });
});

describe('totalPages', () => {
  test('rounds partial pages up', () => {
    expect(totalPages(50, 50)).toBe(1);
    expect(totalPages(51, 50)).toBe(2);
    expect(totalPages(4247, 50)).toBe(85);
    expect(totalPages(100, 200)).toBe(1);
  });

  test('never reports zero pages', () => {
    expect(totalPages(0, 50)).toBe(1);
    expect(totalPages(-5, 50)).toBe(1);
    expect(totalPages(10, 0)).toBe(1);
    expect(totalPages(10, NaN)).toBe(1);
    expect(totalPages(NaN, 50)).toBe(1);
    expect(totalPages(Infinity, 50)).toBe(1);
  });
});

describe('clampPage', () => {
  test('keeps the page inside the valid range', () => {
    expect(clampPage(5, 100, 50)).toBe(2);
    expect(clampPage(2, 100, 50)).toBe(2);
    expect(clampPage(1.9, 100, 50)).toBe(1);
  });

  test('falls back to page 1 for unusable input', () => {
    expect(clampPage(0, 100, 50)).toBe(1);
    expect(clampPage(-1, 100, 50)).toBe(1);
    expect(clampPage(NaN, 100, 50)).toBe(1);
    expect(clampPage(3, 0, 50)).toBe(1);
  });
});
