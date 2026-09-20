/**
 * requestAnimationFrame 合并器
 *
 * resize / scroll 这类高频事件在拖拽窗口时每秒可触发上百次。若处理器内部需要读取
 * 布局（offsetHeight / getBoundingClientRect / getComputedStyle），每次事件都会强制
 * 一次样式重算 + 布局重排，直接造成掉帧。
 *
 * 该合并器把一帧内的多次调用折叠成一次：只有“最新”的那次会真正执行，因此最终布局
 * 状态与逐次调用完全一致（处理器本身是幂等的测量 + 写入），只是不再重复计算。
 */
export function createRafCoalescedCallback(callback: () => void) {
  let frame: number | null = null;

  const run = () => {
    frame = null;
    callback();
  };

  /** 请求在下一帧执行；同一帧内的重复请求会被忽略。 */
  const schedule = () => {
    if (frame !== null) return;
    frame = window.requestAnimationFrame(run);
  };

  /** 取消尚未执行的请求（用于 effect 清理）。 */
  const cancel = () => {
    if (frame === null) return;
    window.cancelAnimationFrame(frame);
    frame = null;
  };

  return { schedule, cancel };
}
