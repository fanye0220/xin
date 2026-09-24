import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 统一管理 blob -> object URL 的创建与释放。
 * 创建和清理绑在同一个 useEffect 里, 传入的 blob 变化或组件卸载时
 * 会自动 revoke 上一个 URL, 不会像手写 createObjectURL 那样容易漏掉释放。
 *
 * 用法: const url = useObjectUrl(character.avatarBlob);
 */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [blob]);

  return url;
}

/**
 * 手动控制版本: 适用于 URL 不是直接从一个 blob prop 派生,
 * 而是需要在某个时机(比如异步加载完成、onError 兜底、多个不同来源二选一)
 * 才生成的场景 —— 这类场景没法简单用一个 useEffect 描述, 但仍然要保证
 * "谁创建的 blob URL, 谁负责释放"。
 *
 * - setBlobUrl(blob): 释放上一个由本 hook 创建的 blob URL(如果有), 再创建新的
 * - setRawUrl(url): 直接设置一个不需要释放的 URL(比如安卓本地文件路径),
 *   同样会先释放上一个 blob URL(如果有), 避免遗留
 * - 组件卸载时自动释放最后一个由本 hook 创建的 blob URL
 */
export function useManagedObjectUrl(initial: string | null = null) {
  const [url, setUrlState] = useState<string | null>(initial);
  const trackedBlobUrlRef = useRef<string | null>(null);

  const revokeTracked = () => {
    if (trackedBlobUrlRef.current) {
      URL.revokeObjectURL(trackedBlobUrlRef.current);
      trackedBlobUrlRef.current = null;
    }
  };

  const setBlobUrl = useCallback((blob: Blob) => {
    revokeTracked();
    const objectUrl = URL.createObjectURL(blob);
    trackedBlobUrlRef.current = objectUrl;
    setUrlState(objectUrl);
    return objectUrl;
  }, []);

  const setRawUrl = useCallback((rawUrl: string | null) => {
    revokeTracked();
    setUrlState(rawUrl);
  }, []);

  useEffect(() => {
    return () => {
      revokeTracked();
    };
  }, []);

  return { url, setBlobUrl, setRawUrl } as const;
}
