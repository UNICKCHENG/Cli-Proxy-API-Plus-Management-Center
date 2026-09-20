import { useEffect, useRef } from 'react';
import { useIsCurrentPageLayer } from '@/components/common/PageTransitionLayer';

export type HeaderRefreshHandler = () => void | Promise<void>;

let activeHeaderRefreshHandler: HeaderRefreshHandler | null = null;

export const triggerHeaderRefresh = async () => {
  if (!activeHeaderRefreshHandler) return;
  await activeHeaderRefreshHandler();
};

export const useHeaderRefresh = (handler?: HeaderRefreshHandler | null, enabled = true) => {
  const lastHandlerRef = useRef<HeaderRefreshHandler | null>(null);
  // 全局刷新槽位只有一个。隐藏的页面层依然挂载，若不加限制，它们重渲染时会重新注册
  // 并抢占槽位，导致点击刷新实际刷新的是不可见页面。只有可见层可以持有该槽位。
  const isCurrentLayer = useIsCurrentPageLayer();
  const canRegister = enabled && isCurrentLayer;

  useEffect(() => {
    const previousHandler = lastHandlerRef.current;
    lastHandlerRef.current = handler ?? null;

    if (!canRegister || !handler) {
      if (previousHandler && activeHeaderRefreshHandler === previousHandler) {
        activeHeaderRefreshHandler = null;
      }
      return;
    }

    activeHeaderRefreshHandler = handler;

    return () => {
      if (activeHeaderRefreshHandler === handler) {
        activeHeaderRefreshHandler = null;
      }
    };
  }, [canRegister, handler]);
};
