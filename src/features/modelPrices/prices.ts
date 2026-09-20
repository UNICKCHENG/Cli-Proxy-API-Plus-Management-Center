/**
 * 模型价格目录的纯逻辑。
 *
 * 后端以「每 token 美元」存储单价，界面统一换算成「每百万 token 美元」展示，
 * 与各家模型定价页的口径一致。单价为 0 表示该档价格未公布（不是免费），
 * 因此与「未公布」共用同一个占位符。
 */

import type { ModelPriceEntry } from '@/services/api';

export const PER_MILLION = 1_000_000;

/** 每 token 单价 → 每百万 token 单价。 */
export const toPerMillion = (perToken: number): number =>
  Number.isFinite(perToken) ? perToken * PER_MILLION : 0;

/** 0 或负值表示该档价格未公布。 */
export const hasRate = (perToken: number): boolean => Number.isFinite(perToken) && perToken > 0;

/** 任一档价格可用，即认为该模型有报价。 */
export const entryHasPrice = (entry: ModelPriceEntry): boolean =>
  hasRate(entry.input) ||
  hasRate(entry.output) ||
  hasRate(entry.cacheRead) ||
  hasRate(entry.cacheWrite) ||
  hasRate(entry.reasoning);

const fractionDigitsFor = (value: number): number => {
  const abs = Math.abs(value);
  if (abs >= 1) return 2;
  if (abs >= 0.01) return 3;
  if (abs >= 0.0001) return 4;
  return 6;
};

/** 格式化每百万 token 单价；未公布时返回占位符。 */
export const formatPerMillion = (perToken: number, placeholder = '—'): string => {
  if (!hasRate(perToken)) return placeholder;
  const value = toPerMillion(perToken);
  const digits = fractionDigitsFor(value);
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
};

/** 总页数；无数据时返回 1，避免界面出现「第 1 / 0 页」。 */
export const totalPages = (total: number, pageSize: number): number => {
  if (!Number.isFinite(total) || total <= 0) return 1;
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
};

/** 把页码收敛到有效区间内。 */
export const clampPage = (page: number, total: number, pageSize: number): number => {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), totalPages(total, pageSize));
};
