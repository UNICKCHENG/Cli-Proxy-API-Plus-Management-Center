import { useTranslation } from 'react-i18next';
import { USAGE_RANGES, type UsageRangeKey } from '../usage';
import styles from './UsageRangeSwitch.module.scss';

interface UsageRangeSwitchProps {
  value: UsageRangeKey;
  disabled?: boolean;
  onChange: (value: UsageRangeKey) => void;
}

/** 用量区块右上角的窗口切换：7 天 / 30 天 / 24 小时。 */
export function UsageRangeSwitch({ value, disabled = false, onChange }: UsageRangeSwitchProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.segmented} role="group" aria-label={t('dashboard.usage_range_label')}>
      {USAGE_RANGES.map((option) => {
        const active = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            className={active ? `${styles.segment} ${styles.segmentActive}` : styles.segment}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(option.key)}
          >
            {t(`dashboard.usage_range_${option.key}`)}
          </button>
        );
      })}
    </div>
  );
}
