/**
 * 全局唯一的「默认占位图」来源。
 *
 * 以前「没图的卡长什么样」是各处自己判断的, 判断方式是看 URL 字符串里有没有
 * miu / dicebear / bottts / svg。可是从库里取出来的可能是 blob: 或安卓本地 file:
 * 路径, 字符串里根本看不出是占位图 —— 于是被当成真图画成 object-cover,
 * 就会出现"被拉满裁切、又大又丑的 miu"。
 *
 * 现在统一成: 谁没图 → getPlaceholderUrl()。而且这张图可以在设置里替换,
 * 换一次全app生效(列表 / 详情 / 文件夹封面 / TT 拉取 / 云端卡库 / 回收站 / 查重)。
 */

/** 内置默认占位图(打进包里, 删不掉) */
export const BUILTIN_PLACEHOLDER_URL = '/assets/aistudio/_______miu__5866e70e.png';

/** 用户自己换的默认图键名 (已废弃并自动清理) */
const LS_KEY = 'miu_default_placeholder_data';
try {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(LS_KEY);
  }
} catch {}

/**
 * 历史遗留占位图的字节数: 旧版 miu(1536x1024, 约 988KB)。
 * 命中这个体积基本可以断定「这张卡的图就是当年那个占位图」——
 * 因为老数据里有把占位图当成头像存下来的卡。只用来快速排除, 不会误伤真图。
 */
const LEGACY_PLACEHOLDER_SIZES = [1011746];

/** 当前生效的默认占位图(直接使用内置统一占位图) */
export function getPlaceholderUrl(): string {
  return BUILTIN_PLACEHOLDER_URL;
}

/**
 * 存下来的那个值是不是「默认占位图」本身（而不是卡片自己的真图）。
 */
export function isStoredPlaceholderCopy(value: string | undefined | null): boolean {
  if (!value || typeof value !== 'string') return false;
  if (value === BUILTIN_PLACEHOLDER_URL) return true;
  return value.startsWith('data:image/');
}

/** 用户有没有换过默认图 (已废弃并固定为 false) */
export function hasCustomPlaceholder(): boolean {
  return false;
}

export function subscribePlaceholder(_cb: () => void): () => void {
  return () => {};
}

/* ---------------- React 用 ---------------- */

/** 获取占位图 URL (直接返回内置占位图) */
export function usePlaceholderUrl(): string {
  return BUILTIN_PLACEHOLDER_URL;
}

/** 保持向后兼容：换图功能已下线，统一使用内置占位图 */
export async function setCustomPlaceholder(_blob: Blob): Promise<void> {}

/** 保持向后兼容：恢复内置占位图 */
export function resetCustomPlaceholder(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {}
}

/* ---------------- 占位图内容指纹: 判断「某个 blob 就是占位图本身」 ---------------- */

type Fingerprint = { size: number; hash: string | null };

let builtinFpPromise: Promise<Fingerprint | null> | null = null;

export function resetFingerprints(): void {
  builtinFpPromise = null;
}

function hashBlob(blob: Blob): Promise<string | null> {
  return (async () => {
    try {
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      return null;
    }
  })();
}

async function fingerprintOf(blob: Blob | null): Promise<Fingerprint | null> {
  if (!blob) return null;
  return { size: blob.size, hash: await hashBlob(blob) };
}

/** 当前默认占位图的指纹(内置那张要 fetch 一次, 之后走缓存) */
export function getPlaceholderFingerprint(): Promise<Fingerprint | null> {
  if (!builtinFpPromise) {
    builtinFpPromise = (async () => {
      try {
        const res = await fetch(BUILTIN_PLACEHOLDER_URL, { cache: 'force-cache' });
        if (!res.ok) return null;
        return await fingerprintOf(await res.blob());
      } catch {
        return null;
      }
    })();
  }
  return builtinFpPromise;
}

/**
 * 这张图是不是「占位图本身」。先用体积快速排除, 体积撞上了才真去算 sha256,
 * 所以对正常卡片来说开销≈0。
 */
export async function isPlaceholderImageBlob(blob?: Blob | null): Promise<boolean> {
  if (!blob) return true;
  try {
    if (LEGACY_PLACEHOLDER_SIZES.includes(blob.size)) return true;
    const fp = await getPlaceholderFingerprint();
    if (!fp) return false;
    if (fp.size !== blob.size) return false;
    if (!fp.hash) return true;
    const h = await hashBlob(blob);
    return !!h && h === fp.hash;
  } catch {
    return false;
  }
}
