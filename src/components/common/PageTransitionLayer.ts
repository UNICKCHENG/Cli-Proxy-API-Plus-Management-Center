import { createContext, useContext } from 'react';

export type LayerStatus = 'current' | 'exiting' | 'stacked';

export type PageTransitionLayerContextValue = {
  status: LayerStatus;
  isCurrentLayer: boolean;
  isAnimating: boolean;
};

export const PageTransitionLayerContext = createContext<PageTransitionLayerContextValue | null>(
  null
);

export const PAGE_TRANSITION_LAYER_CONTEXT_VALUES: Record<
  LayerStatus,
  PageTransitionLayerContextValue
> = {
  current: { status: 'current', isCurrentLayer: true, isAnimating: false },
  stacked: { status: 'stacked', isCurrentLayer: false, isAnimating: false },
  exiting: { status: 'exiting', isCurrentLayer: false, isAnimating: false },
};

export function usePageTransitionLayer() {
  return useContext(PageTransitionLayerContext);
}

/**
 * 当前组件是否位于“可见”的页面层。
 *
 * 页面层栈会把已经离开的页面保留挂载（`display: none` / `inert`）以便回退时零闪烁，
 * 因此这些隐藏页面的 effect、定时器与轮询仍在运行。所有后台轮询都应以此为依据
 * 暂停，避免不可见页面持续占用网络与主线程。
 *
 * 不在页面层内渲染（例如登录页、独立浮层）时返回 `true`。
 */
export function useIsCurrentPageLayer(): boolean {
  const layer = usePageTransitionLayer();
  return layer === null || layer.status === 'current';
}
