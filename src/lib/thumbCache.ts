/**
 * 参考卡库的做法: 缩略图 URL 用一个"有上限"的 LRU 缓存管理,
 * 不管库里有多少张卡, 内存里同时挂着的 blob URL 数量永远有天花板,
 * 超过上限就把最久没用到的挤出去并释放。
 *
 * 另外用一个小队列限制"同时进行中的缩略图读取/解码"数量,
 * 快速滚动时不会一下子涌进来一堆解码任务同时抢 CPU。
 */

const MAX_CACHED_URLS = 120;

interface CacheEntry {
  url: string;
  isBlobUrl: boolean; // data:/http(s):/file: 这类不需要 revoke
}

const cache = new Map<string, CacheEntry>(); // Map 天然按插入/访问顺序排列,用来做 LRU

function touch(key: string, entry: CacheEntry) {
  cache.delete(key);
  cache.set(key, entry);
}

function evictIfNeeded() {
  while (cache.size > MAX_CACHED_URLS) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    const entry = cache.get(oldestKey);
    cache.delete(oldestKey);
    if (entry?.isBlobUrl) {
      URL.revokeObjectURL(entry.url);
    }
  }
}

/** 已经有缓存的话直接返回(并刷新它的 LRU 位置), 没有就返回 undefined */
export function peekCachedUrl(key: string): string | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  touch(key, entry);
  return entry.url;
}

/** 写入一个新的 blob URL(会被 revoke 管理), 超出上限会自动淘汰最久未用的 */
export function putCachedBlobUrl(key: string, blob: Blob): string {
  const prev = cache.get(key);
  if (prev?.isBlobUrl) URL.revokeObjectURL(prev.url);
  const url = URL.createObjectURL(blob);
  const entry: CacheEntry = { url, isBlobUrl: true };
  touch(key, entry);
  evictIfNeeded();
  return url;
}

/** 写入一个不需要 revoke 的静态 URL(data:/http/本地文件路径这类) */
export function putCachedStaticUrl(key: string, url: string): string {
  const prev = cache.get(key);
  if (prev?.isBlobUrl) URL.revokeObjectURL(prev.url);
  const entry: CacheEntry = { url, isBlobUrl: false };
  touch(key, entry);
  evictIfNeeded();
  return url;
}

/** 主动移除某一项(比如角色被删除时), 不等 LRU 自然淘汰 */
export function releaseCachedUrl(key: string) {
  const entry = cache.get(key);
  if (entry) {
    cache.delete(key);
    if (entry.isBlobUrl) URL.revokeObjectURL(entry.url);
  }
}

// ---- 并发限流队列: 同时最多几个缩略图读取任务在跑 ----
const MAX_CONCURRENT_READS = 3;
let activeReads = 0;
const readQueue: (() => void)[] = [];

function acquireReadSlot(): Promise<void> {
  if (activeReads < MAX_CONCURRENT_READS) {
    activeReads++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    readQueue.push(() => {
      activeReads++;
      resolve();
    });
  });
}

function releaseReadSlot() {
  activeReads--;
  const next = readQueue.shift();
  if (next) next();
}

/** 排队执行一个"读取/解码"任务, 保证同一时刻最多 MAX_CONCURRENT_READS 个在跑 */
export async function withReadSlot<T>(task: () => Promise<T>): Promise<T> {
  await acquireReadSlot();
  try {
    return await task();
  } finally {
    releaseReadSlot();
  }
}
