/**
 * TauriTavern (TT酒馆) 增强 API 封装与类型声明库
 * 专为与 TT酒馆 Rust 后端深度互联（CJS/Bigram快速全文搜索、零开销 KV JSON 数据存储、极速消息定位）提供统一接口。
 */

export interface TauriTavernSearchFilters {
  role?: 'user' | 'assistant' | 'system';
  startIndex?: number;
  endIndex?: number;
  scanLimit?: number;
}

export interface TauriTavernSearchHit {
  index: number;
  score: number;
  snippet: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
}

export interface TauriTavernLocateOptions {
  role?: 'user' | 'assistant' | 'system';
  hasExtraKeys?: string[];
  scanLimit?: number;
}

export interface TauriTavernLocatedMessage {
  index: number;
  message: any;
}

export interface TauriTavernChatHandle {
  locate: {
    findLastMessage(opts: TauriTavernLocateOptions): Promise<TauriTavernLocatedMessage | null>;
  };
  searchMessages(opts: {
    query: string;
    limit?: number;
    filters?: TauriTavernSearchFilters;
  }): Promise<TauriTavernSearchHit[]>;
  store: {
    setJson(params: { namespace: string; key: string; value: any }): Promise<void>;
    getJson<T = any>(params: { namespace: string; key: string }): Promise<T | null>;
    listKeys(params: { namespace: string }): Promise<string[]>;
    deleteJson(params: { namespace: string; key: string }): Promise<void>;
  };
  metadata: {
    get(): Promise<any>;
    setExtension(params: { namespace: string; value: any }): Promise<void>;
  };
}

export interface TauriTavernAPI {
  chat: {
    current: {
      handle(): TauriTavernChatHandle;
    };
  };
}

export interface TauriTavernGlobal {
  ready?: Promise<void>;
  api: TauriTavernAPI;
}

declare global {
  interface Window {
    __TAURITAVERN__?: TauriTavernGlobal;
    __TAURITAVERN_MAIN_READY__?: Promise<void>;
  }
}

/**
 * 寻找当前宿主环境中的 TauriTavern 全局对象（支持当前窗口、iframe 父窗口、opener 弹出窗口）
 */
function findTauriTavernGlobal(): TauriTavernGlobal | null {
  if (typeof window === 'undefined') return null;
  if (window.__TAURITAVERN__) return window.__TAURITAVERN__;
  try {
    if (window.parent && window.parent !== window && window.parent.__TAURITAVERN__) {
      return window.parent.__TAURITAVERN__;
    }
  } catch (e) {}
  try {
    if (window.opener && window.opener.__TAURITAVERN__) {
      return window.opener.__TAURITAVERN__;
    }
  } catch (e) {}
  return null;
}

/**
 * 判断当前是否处于 TT酒馆 (TauriTavern) 环境或扩展通道中
 */
export function isTauriTavernEnvironment(): boolean {
  return Boolean(findTauriTavernGlobal());
}

/**
 * 异步获取 TauriTavern 的当前 Chat Handle，等待 Rust 后端 API 初始化完成
 */
export async function getTauriTavernChatHandle(): Promise<TauriTavernChatHandle | null> {
  const tt = findTauriTavernGlobal();
  if (!tt) return null;

  try {
    const readyPromise = tt.ready ?? (typeof window !== 'undefined' ? window.__TAURITAVERN_MAIN_READY__ : undefined);
    if (readyPromise) {
      await readyPromise;
    }
    return tt.api?.chat?.current?.handle() ?? null;
  } catch (err) {
    console.error("Failed to acquire TauriTavern chat handle:", err);
    return null;
  }
}

/**
 * 使用 TT酒馆 Rust 高级分词与片段检索，在当前聊天记录中全文搜寻消息
 */
export async function searchTauriTavernMessages(
  query: string,
  limit: number = 20,
  filters?: TauriTavernSearchFilters
): Promise<TauriTavernSearchHit[]> {
  const handle = await getTauriTavernChatHandle();
  if (!handle) return [];

  try {
    return await handle.searchMessages({ query, limit, filters });
  } catch (err) {
    console.error("TauriTavern searchMessages call failed:", err);
    return [];
  }
}

/**
 * 使用 TT酒馆 Rust 极速定位算法，找到最后一条满足特定 extra 键或 role 的消息
 */
export async function findLastTauriTavernMessage(
  opts: TauriTavernLocateOptions
): Promise<TauriTavernLocatedMessage | null> {
  const handle = await getTauriTavernChatHandle();
  if (!handle) return null;

  try {
    return await handle.locate.findLastMessage(opts);
  } catch (err) {
    console.error("TauriTavern findLastMessage call failed:", err);
    return null;
  }
}

/**
 * 写入数据到 TT酒馆独立的 KV 存储区（独立解耦，不膨胀主聊天 JSON）
 */
export async function setTauriTavernStore<T = any>(
  key: string,
  value: T,
  namespace: string = 'miu-app'
): Promise<boolean> {
  const handle = await getTauriTavernChatHandle();
  if (!handle) return false;

  try {
    await handle.store.setJson({ namespace, key, value });
    return true;
  } catch (err) {
    console.error(`TauriTavern store.setJson failed for key '${key}':`, err);
    return false;
  }
}

/**
 * 从 TT酒馆独立的 KV 存储区中读取数据
 */
export async function getTauriTavernStore<T = any>(
  key: string,
  namespace: string = 'miu-app'
): Promise<T | null> {
  const handle = await getTauriTavernChatHandle();
  if (!handle) return null;

  try {
    return await handle.store.getJson<T>({ namespace, key });
  } catch (err) {
    console.error(`TauriTavern store.getJson failed for key '${key}':`, err);
    return null;
  }
}

/**
 * 设置聊天元数据扩展区（轻量级状态、进度与小配置）
 */
export async function setTauriTavernExtensionMetadata<T = any>(
  value: T | null,
  namespace: string = 'miu-app'
): Promise<boolean> {
  const handle = await getTauriTavernChatHandle();
  if (!handle) return false;

  try {
    await handle.metadata.setExtension({ namespace, value });
    return true;
  } catch (err) {
    console.error(`TauriTavern metadata.setExtension failed:`, err);
    return false;
  }
}
