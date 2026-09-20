import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible';
import {
  costAxisMax,
  formatAxisCost,
  formatCost,
  peakCostIndex,
  type CostPoint,
  type UsageGranularity,
} from '../usage';
import styles from './CostHistogram.module.scss';

/** 纵轴刻度条数（含 0），即 TICK_COUNT - 1 个间隔 */
const TICK_COUNT = 5;

/** 横轴最多标注的刻度数，避免 30 天窗口把横轴挤满 */
const MAX_X_TICKS = 6;

/** 横轴刻度位置：窗口内均匀取点，首尾必定包含 */
function xTickIndices(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const wanted = Math.min(MAX_X_TICKS, count);
  const positions = new Set<number>();
  for (let step = 0; step < wanted; step += 1) {
    positions.add(Math.round((step * (count - 1)) / (wanted - 1)));
  }
  return [...positions].sort((a, b) => a - b);
}

interface CostHistogramProps {
  series: CostPoint[];
  currency: string;
  granularity: UsageGranularity;
}

/**
 * 消费直方图：x = 时间，y = 估算消费。
 * 单序列，所以柱子统一用强调色，不做堆叠。
 */
export function CostHistogram({ series, currency, granularity }: CostHistogramProps) {
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const totals = useMemo(
    () =>
      series.reduce(
        (acc, point) => ({ cost: acc.cost + point.cost, requests: acc.requests + point.requests }),
        { cost: 0, requests: 0 }
      ),
    [series]
  );

  const peak = useMemo(() => series.reduce((max, point) => Math.max(max, point.cost), 0), [series]);
  /* niceCeil 结果恒 ≥ peak，这里再兜一层，保证柱高不会越界 */
  const scaleMax = useMemo(() => Math.max(costAxisMax(peak, TICK_COUNT - 1), peak), [peak]);
  const peakIndex = useMemo(() => peakCostIndex(series), [series]);

  const ticks = useMemo(
    () =>
      Array.from({ length: TICK_COUNT }, (_, index) => {
        const ratio = 1 - index / (TICK_COUNT - 1);
        return { ratio, value: scaleMax * ratio };
      }),
    [scaleMax]
  );

  const xTicks = useMemo(
    () =>
      xTickIndices(series.length).map((index) => ({
        index,
        label: series[index]?.label ?? '',
      })),
    [series]
  );

  if (totals.cost <= 0 || scaleMax <= 0) {
    return (
      <div className={styles.placeholder}>
        <p className={styles.placeholderTitle}>{t('dashboard.usage_empty_title')}</p>
        <p className={styles.placeholderHint}>{t('dashboard.usage_empty_hint')}</p>
      </div>
    );
  }

  const activePoint = activeIndex === null ? null : series[activeIndex];
  const summary = t('dashboard.usage_histogram_summary', {
    cost: formatCost(totals.cost, currency),
    requests: totals.requests.toLocaleString(),
  });
  const unitLabel = t(
    granularity === 'hour' ? 'dashboard.usage_unit_hour' : 'dashboard.usage_unit_day'
  );

  return (
    <figure className={styles.chart}>
      <figcaption className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatch} aria-hidden="true" />
          {t('dashboard.usage_histogram_legend')}
          <b className={styles.legendValue}>{formatCost(totals.cost, currency)}</b>
        </span>
        <span className={styles.legendMeta}>
          {t('dashboard.usage_histogram_requests', { value: totals.requests.toLocaleString() })}
        </span>
      </figcaption>

      <div className={styles.plot}>
        <div className={styles.yAxis} aria-hidden="true">
          {ticks.map((tick) => (
            <span
              key={tick.ratio}
              className={styles.yTick}
              style={{ top: `${(1 - tick.ratio) * 100}%` }}
            >
              {formatAxisCost(tick.value)}
            </span>
          ))}
        </div>

        <div className={styles.canvas}>
          <div className={styles.gridlines} aria-hidden="true">
            {ticks.map((tick) => (
              <span
                key={tick.ratio}
                className={styles.gridline}
                style={{ top: `${(1 - tick.ratio) * 100}%` }}
              />
            ))}
          </div>

          <div
            className={styles.columns}
            role="img"
            aria-label={summary}
            onMouseLeave={() => setActiveIndex(null)}
          >
            {series.map((point, index) => {
              const height = (point.cost / scaleMax) * 100;
              /* 级差按柱数归一化：不管窗口多长，整波入场都收在 360ms 内 */
              const barDelayMs =
                series.length > 1 ? Math.round((index / (series.length - 1)) * 360) : 0;
              return (
                <div
                  key={point.key}
                  className={`${styles.column} ${activeIndex === index ? styles.columnActive : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => setActiveIndex((current) => (current === index ? null : index))}
                >
                  {index === peakIndex && (
                    <span
                      className={styles.peakLabel}
                      style={{ bottom: `${Math.min(100, height)}%` }}
                    >
                      {formatCost(point.cost, currency)}
                    </span>
                  )}
                  <div
                    className={styles.stack}
                    style={{ '--bar-delay': `${barDelayMs}ms` } as React.CSSProperties}
                  >
                    {point.cost > 0 ? (
                      <span className={styles.bar} style={{ height: `${height}%` }} />
                    ) : (
                      <span className={styles.idleTick} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {activePoint && (
            <div
              className={styles.tooltip}
              style={{
                left: `${((activeIndex! + 0.5) / series.length) * 100}%`,
                transform:
                  activeIndex! < series.length * 0.15
                    ? 'translateX(-12%)'
                    : activeIndex! > series.length * 0.85
                      ? 'translateX(-88%)'
                      : 'translateX(-50%)',
              }}
              role="status"
            >
              <span className={styles.tooltipLabel}>{activePoint.label}</span>
              <span className={styles.tooltipRow}>
                {t('dashboard.usage_column_cost')}
                <b>{formatCost(activePoint.cost, currency)}</b>
              </span>
              <span className={styles.tooltipRow}>
                {t('dashboard.usage_column_requests')}
                <b>{activePoint.requests.toLocaleString()}</b>
              </span>
            </div>
          )}
        </div>
      </div>

      <div className={styles.xAxis} aria-hidden="true">
        {xTicks.map((tick) => (
          <span
            key={tick.index}
            className={styles.xTick}
            style={{ left: `${((tick.index + 0.5) / series.length) * 100}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>

      <Collapsible className={styles.tableToggle} label={t('dashboard.usage_table')}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{unitLabel}</th>
              <th scope="col">{t('dashboard.usage_column_cost')}</th>
              <th scope="col">{t('dashboard.usage_column_requests')}</th>
            </tr>
          </thead>
          <tbody>
            {series.map((point) => (
              <tr key={point.key}>
                <th scope="row">{point.label}</th>
                <td>{formatCost(point.cost, currency)}</td>
                <td>{point.requests.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Collapsible>
    </figure>
  );
}
