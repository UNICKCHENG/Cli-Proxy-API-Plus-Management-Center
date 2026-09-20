import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction, UIEvent } from 'react';
import { createRafCoalescedCallback } from '@/utils/raf';
import type { LogState } from './logTypes';

const LOAD_MORE_LINES = 200;
const LOAD_MORE_THRESHOLD_PX = 72;

export const isNearBottom = (node: HTMLDivElement | null) => {
  if (!node) return true;
  const threshold = 24;
  return node.scrollHeight - node.scrollTop - node.clientHeight <= threshold;
};

interface UseLogScrollerOptions {
  logState: LogState;
  setLogState: Dispatch<SetStateAction<LogState>>;
  loading: boolean;
  isSearching: boolean;
  filteredLineCount: number;
  hasStructuredFilters: boolean;
  showRawLogs: boolean;
}

interface UseLogScrollerReturn {
  logViewerRef: RefObject<HTMLDivElement | null>;
  canLoadMore: boolean;
  handleLogScroll: (e: UIEvent<HTMLDivElement>) => void;
  scrollToBottom: () => void;
  requestScrollToBottom: () => void;
}

export function useLogScroller(options: UseLogScrollerOptions): UseLogScrollerReturn {
  const {
    logState,
    setLogState,
    loading,
    isSearching,
    filteredLineCount,
    hasStructuredFilters,
    showRawLogs,
  } = options;

  const logViewerRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToBottomRef = useRef(false);
  const pendingPrependScrollRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);

  const canLoadMore = !isSearching && logState.visibleFrom > 0;

  const scrollToBottom = useCallback(() => {
    const node = logViewerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, []);

  const requestScrollToBottom = useCallback(() => {
    pendingScrollToBottomRef.current = true;
  }, []);

  const prependVisibleLines = useCallback(() => {
    const node = logViewerRef.current;
    if (!node) return;
    if (pendingPrependScrollRef.current) return;
    if (isSearching) return;

    setLogState((prev) => {
      if (prev.visibleFrom <= 0) {
        return prev;
      }

      pendingPrependScrollRef.current = {
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop,
      };

      return {
        ...prev,
        visibleFrom: Math.max(prev.visibleFrom - LOAD_MORE_LINES, 0),
      };
    });
  }, [isSearching, setLogState]);

  const handleLogScroll = useCallback(
    (_e: UIEvent<HTMLDivElement>) => {
      const node = logViewerRef.current;
      if (!node) return;
      if (isSearching) return;
      if (!canLoadMore) return;
      if (pendingPrependScrollRef.current) return;
      if (node.scrollTop > LOAD_MORE_THRESHOLD_PX) return;

      prependVisibleLines();
    },
    [canLoadMore, isSearching, prependVisibleLines]
  );

  useLayoutEffect(() => {
    const node = logViewerRef.current;
    const pending = pendingPrependScrollRef.current;
    if (!node || !pending) return;

    const delta = node.scrollHeight - pending.scrollHeight;
    node.scrollTop = pending.scrollTop + delta;
    pendingPrependScrollRef.current = null;
  }, [logState.visibleFrom]);

  const tryAutoLoadMoreUntilScrollable = useCallback(() => {
    const node = logViewerRef.current;
    if (!node) return;
    if (!canLoadMore) return;
    if (isSearching) return;
    if (pendingPrependScrollRef.current) return;

    const hasVerticalOverflow = node.scrollHeight > node.clientHeight + 1;
    if (hasVerticalOverflow) return;

    prependVisibleLines();
  }, [canLoadMore, isSearching, prependVisibleLines]);

  useEffect(() => {
    if (loading) return;
    const node = logViewerRef.current;
    if (!node) return;

    const raf = window.requestAnimationFrame(() => {
      tryAutoLoadMoreUntilScrollable();
    });
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [
    filteredLineCount,
    hasStructuredFilters,
    loading,
    logState.visibleFrom,
    showRawLogs,
    tryAutoLoadMoreUntilScrollable,
  ]);

  useEffect(() => {
    // 每次 resize 都无条件排队一个 rAF 会在拖拽窗口时堆叠多个回调，各自触发一次
    // 布局读取。合并器保证每帧最多执行一次。
    const coalesced = createRafCoalescedCallback(tryAutoLoadMoreUntilScrollable);
    window.addEventListener('resize', coalesced.schedule);
    return () => {
      window.removeEventListener('resize', coalesced.schedule);
      coalesced.cancel();
    };
  }, [tryAutoLoadMoreUntilScrollable]);

  useEffect(() => {
    if (!pendingScrollToBottomRef.current) return;
    if (loading) return;
    if (!logViewerRef.current) return;

    scrollToBottom();
    pendingScrollToBottomRef.current = false;
  }, [loading, logState.buffer, logState.visibleFrom, scrollToBottom]);

  return {
    logViewerRef,
    canLoadMore,
    handleLogScroll,
    scrollToBottom,
    requestScrollToBottom,
  };
}
