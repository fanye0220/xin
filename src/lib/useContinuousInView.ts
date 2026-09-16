import { useEffect, useState, type RefObject } from 'react';

/**
 * 和 useInView.ts 里那个一次性的不一样, 这个会持续监听——划进视口范围
 * 变 true, 划出去(超过 rootMargin)变回 false, 用于"划出屏幕就卸载图片"
 * 这种需要感知离开事件的场景。
 *
 * rootMargin 给得比 useInView 大一些(比如上下各留一屏), 避免用户来回
 * 小幅度滚动的时候图片被频繁卸载/重新加载。
 */
let sharedObserver: IntersectionObserver | null = null;
const listeners = new WeakMap<Element, (inView: boolean) => void>();

function getSharedObserver() {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const cb = listeners.get(entry.target);
          if (cb) cb(entry.isIntersecting);
        });
      },
      { rootMargin: '800px 0px', threshold: 0 },
    );
  }
  return sharedObserver;
}

export function useContinuousInView(ref: RefObject<Element>): boolean {
  const [inView, setInView] = useState(true); // 默认true,首次渲染前不误卸载

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    listeners.set(el, setInView);
    getSharedObserver().observe(el);
    return () => {
      listeners.delete(el);
      sharedObserver?.unobserve(el);
    };
  }, [ref]);

  return inView;
}
