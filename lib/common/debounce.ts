/**
 * 生产可用的防抖函数封装。
 * - 每次调用都会重置计时器，最后一次调用后等待 `wait` 毫秒才执行；
 * - 返回的函数附带 `cancel()`（取消未执行调用）与 `flush()`（立即执行最后一次）；
 * - 通过泛型保留参数类型，保证调用方类型安全。
 *
 * 在 React 中请务必在组件卸载时调用 `cancel()`，避免卸载后仍触发回调。
 */

type Debounced<A extends unknown[]> = {
  (...args: A): void;
  cancel: () => void;
  flush: () => void;
};

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait = 300
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: A | undefined;

  const debounced = ((...args: A) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, wait);
  }) as Debounced<A>;

  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    lastArgs = undefined;
  };

  debounced.flush = () => {
    if (timer && lastArgs) {
      clearTimeout(timer);
      timer = undefined;
      fn(...lastArgs);
    }
  };

  return debounced;
}
