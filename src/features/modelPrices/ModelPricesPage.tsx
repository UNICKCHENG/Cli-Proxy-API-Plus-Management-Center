/**
 * 模型价格目录：只读查询页。
 *
 * 补齐「查」的缺口 —— 后端同步了数千条模型单价，但界面此前没有任何单价入口，
 * 配置 `model-price-overrides` 只能靠猜。这里按模型 key 展示每百万 token 单价，
 * 并标出哪些来自运维覆盖，同时也可用于排查「为什么这次请求未计价」。
 *
 * 契约：
 * - 服务端分页 + 服务端搜索（目录可达数千行，不整表下发）；
 * - 搜索走表单提交（Enter / 按钮），不做输入节流；
 * - 单价统一换算为「每百万 token 美元」；0 视为「未公布」而非免费；
 * - 上游只在服务进程启动时拉取一次，之后靠页面上的「同步」主动触发，
 *   因此失败时保留已有价格、不重试。
 */

import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { formatDateTimeValue } from '@/utils/format';
import { useModelPrices } from './hooks/useModelPrices';
import { clampPage, formatPerMillion, totalPages } from './prices';
import styles from './ModelPricesPage.module.scss';

const PAGE_SIZE = 50;

/* 加载态占位行数：填满首屏面板即可，多点少点都不影响布局。 */
const SKELETON_ROWS = [0, 1, 2, 3, 4, 5, 6, 7];

const RATE_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'] as const;
type RateKey = (typeof RATE_KEYS)[number];

const RATE_LABEL_KEYS: Record<RateKey, string> = {
  input: 'model_prices.col_input',
  output: 'model_prices.col_output',
  cacheRead: 'model_prices.col_cache_read',
  cacheWrite: 'model_prices.col_cache_write',
  reasoning: 'model_prices.col_reasoning',
};

export function ModelPricesPage() {
  const { t, i18n } = useTranslation();
  const [inputValue, setInputValue] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const {
    report,
    loading,
    error,
    errorStatus,
    connected,
    syncState,
    sync,
    reload,
  } = useModelPrices({
    query,
    page,
    pageSize: PAGE_SIZE,
  });

  const pageSize = report?.pageSize || PAGE_SIZE;
  const total = report?.total ?? 0;
  const entries = useMemo(() => report?.entries ?? [], [report]);
  const currentPage = clampPage(page, total, pageSize);
  const lastPage = totalPages(total, pageSize);

  const pricing = report?.pricing;
  const searching = query.length > 0;
  const updatedAt = pricing ? formatDateTimeValue(pricing.updatedAt, i18n.language) : '';
  const showRefreshing = loading && report !== null;
  const placeholder = t('model_prices.not_published');
  const syncing = syncState.kind === 'busy';

  /* 同步失败的文案：服务端版本偏旧时端点不存在，优先解释这一种。 */
  const syncMessage = (() => {
    switch (syncState.kind) {
      case 'busy':
        return t('model_prices.sync_busy');
      case 'done':
        return t('model_prices.sync_done', { count: syncState.entries });
      case 'failed':
        return syncState.status === 404
          ? t('model_prices.error_unsupported')
          : t('model_prices.sync_failed', { message: syncState.message });
      default:
        return '';
    }
  })();

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setQuery(inputValue.trim());
  };

  const clearSearch = () => {
    setInputValue('');
    setPage(1);
    setQuery('');
  };

  const goToPage = (next: number) => {
    setPage(clampPage(next, total, pageSize));
  };

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <p className={styles.eyebrow}>{t('model_prices.eyebrow')}</p>
          <h1 className={styles.title}>{t('model_prices.title')}</h1>
          <p className={styles.description}>{t('model_prices.description')}</p>
        </div>
        {pricing && (
          <dl className={styles.meta}>
            <div className={styles.metaItem}>
              <dt>{t('model_prices.meta_entries')}</dt>
              <dd>{pricing.entryCount.toLocaleString('en-US')}</dd>
            </div>
            <div className={styles.metaItem}>
              <dt>{t('model_prices.meta_overrides')}</dt>
              <dd>{pricing.overrideCount.toLocaleString('en-US')}</dd>
            </div>
            <div className={styles.metaItem}>
              <dt>{t('model_prices.meta_updated')}</dt>
              <dd>{updatedAt || t('model_prices.meta_updated_unknown')}</dd>
            </div>
          </dl>
        )}
      </header>

      <section className={styles.panel}>
        <div className={styles.toolbar}>
          <form className={styles.searchForm} onSubmit={submitSearch} role="search">
            <Input
              type="search"
              label={t('model_prices.search_label')}
              placeholder={t('model_prices.search_placeholder')}
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" variant="secondary" size="sm">
              {t('model_prices.search_action')}
            </Button>
          </form>
          <div className={styles.toolbarActions}>
            <p className={styles.resultCount} aria-live="polite">
              {searching
                ? t('model_prices.result_filtered', { count: total, query })
                : t('model_prices.result_total', { count: total })}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void sync()}
              loading={syncing}
              disabled={!connected}
            >
              {t('model_prices.sync_action')}
            </Button>
          </div>
        </div>

        <p className={styles.syncHint}>{t('model_prices.sync_hint')}</p>

        {syncState.kind !== 'idle' && (
          <p
            className={[styles.syncStatus, syncState.kind === 'failed' ? styles.syncFail : '']
              .filter(Boolean)
              .join(' ')}
            role={syncState.kind === 'failed' ? 'alert' : 'status'}
          >
            {syncMessage}
          </p>
        )}

        {error ? (
          <div className={styles.error} role="alert">
            <p className={styles.errorText}>
              {errorStatus === 404 ? t('model_prices.error_unsupported') : error}
            </p>
            <Button variant="secondary" size="sm" onClick={() => void reload()}>
              {t('model_prices.retry')}
            </Button>
          </div>
        ) : !connected ? (
          <EmptyState
            title={t('model_prices.disconnected_title')}
            description={t('model_prices.disconnected_hint')}
          />
        ) : loading && report === null ? (
          <div className={styles.loading}>
            {/* 骨架屏沿用真实表头与列宽，加载完成时行不会跳动。 */}
            <Table aria-hidden="true">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('model_prices.col_model')}</TableHead>
                  {RATE_KEYS.map((key) => (
                    <TableHead key={key} alignRight>
                      {t(RATE_LABEL_KEYS[key])}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {SKELETON_ROWS.map((row) => (
                  <TableRow key={row}>
                    <TableCell>
                      <Skeleton className={styles.skeletonModel} />
                    </TableCell>
                    {RATE_KEYS.map((key) => (
                      <TableCell key={key} alignRight>
                        <Skeleton className={styles.skeletonRate} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className={styles.loadingNote} role="status">
              {t('model_prices.loading')}
            </p>
          </div>
        ) : entries.length === 0 ? (
          searching ? (
            <EmptyState
              title={t('model_prices.no_match_title', { query })}
              description={t('model_prices.no_match_hint')}
              action={
                <Button variant="secondary" size="sm" onClick={clearSearch}>
                  {t('model_prices.clear_search')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              title={t('model_prices.empty_title')}
              description={t('model_prices.empty_hint')}
            />
          )
        ) : (
          <>
            <div
              className={[styles.results, showRefreshing ? styles.refreshing : '']
                .filter(Boolean)
                .join(' ')}
              aria-busy={showRefreshing || undefined}
            >
              <Table aria-label={t('model_prices.table_label')}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('model_prices.col_model')}</TableHead>
                    {RATE_KEYS.map((key) => (
                      <TableHead key={key} alignRight>
                        {t(RATE_LABEL_KEYS[key])}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.model}>
                      <TableCell>
                        <div className={styles.modelCell}>
                          <code className={styles.modelKey}>{entry.model}</code>
                          {entry.override && (
                            <span className={styles.overrideBadge}>
                              {t('model_prices.badge_override')}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      {RATE_KEYS.map((key) => (
                        <TableCell key={key} alignRight>
                          <span className={styles.rate}>
                            {formatPerMillion(entry[key], placeholder)}
                          </span>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className={styles.unitNote}>{t('model_prices.unit_per_million')}</p>
            </div>

            {lastPage > 1 && (
              <div className={styles.pagination}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                >
                  {t('model_prices.pagination_prev')}
                </Button>
                <div className={styles.pageInfo}>
                  {t('model_prices.pagination_info', {
                    current: currentPage,
                    total: lastPage,
                    count: total,
                  })}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= lastPage}
                >
                  {t('model_prices.pagination_next')}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
