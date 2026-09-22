import { useTranslation } from 'react-i18next';
import { formatAxisCost, formatCost, type CostRow } from '../usage';
import styles from './CostBreakdown.module.scss';

interface CostBreakdownProps {
  title: string;
  rows: CostRow[];
  currency: string;
  emptyLabel: string;
}

/**
 * 横向条形榜：x = 估算消费，y = 模型或供应商。
 * 同一组件复用于两栏，只有数据维度不同。
 */
export function CostBreakdown({ title, rows, currency, emptyLabel }: CostBreakdownProps) {
  const { t } = useTranslation();

  if (rows.length === 0) {
    return (
      <div className={styles.breakdown}>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.empty}>{emptyLabel}</p>
      </div>
    );
  }

  /* 条长相对榜首归一化；后端已按 cost 降序返回，这里再兜一层 */
  const peak = rows.reduce((max, row) => Math.max(max, row.cost), 0);

  return (
    <div className={styles.breakdown}>
      <div className={styles.head}>
        <h3 className={styles.title}>{title}</h3>
        <span className={styles.scale} aria-hidden="true">
          <span>0</span>
          <span>{formatAxisCost(peak)}</span>
        </span>
      </div>
      <ul className={styles.rows}>
        {rows.map((row) => (
          <li key={row.id} className={styles.row}>
            <span className={styles.identity}>
              <span className={styles.name} title={row.label}>
                {row.label}
              </span>
              {row.sublabel ? <span className={styles.sublabel}>{row.sublabel}</span> : null}
            </span>
            <span className={styles.track}>
              <span
                className={styles.bar}
                /* 再小的值也留一小段可见条，避免读成 0 */
                style={{ width: `${peak > 0 ? Math.max(row.share * 100, 1.5) : 0}%` }}
              />
            </span>
            <span className={styles.value}>
              {row.cost > 0 ? formatCost(row.cost, currency) : t('dashboard.usage_unpriced')}
              <span className={styles.requests}>
                {t('dashboard.usage_breakdown_requests', { value: row.requests.toLocaleString() })}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
