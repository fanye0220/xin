import { useEffect, useState } from 'react';

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

/** 用户自己换的默认图存这里(data URL, 跟着浏览器数据走) */
const LS_KEY = 'miu_default_placeholder_data';

/**
 * 历史遗留占位图的字节数: 旧版 miu(1536x1024, 约 988KB)。
 * 命中这个体积基本可以断定「这张卡的图就是当年那个占位图」——
 * 因为老数据里有把占位图当成头像存下来的卡。只用来快速排除, 不会误伤真图。
 */
const LEGACY_PLACEHOLDER_SIZES = [1011746];

let cachedUrl: string | null = null;
const listeners = new Set<() => void>();

function readStored(): string | null {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v && v.startsWith('data:image/') ? v : null;
  } catch {
    return null;
  }
}

/** 当前生效的默认占位图(同步, 渲染里直接用) */
export function getPlaceholderUrl(): string {
  if (cachedUrl === null) cachedUrl = readStored() || BUILTIN_PLACEHOLDER_URL;
  return cachedUrl;
}

/** 用户有没有换过默认图 */
export function hasCustomPlaceholder(): boolean {
  return !!readStored();
}

function notify() {
  for (const cb of Array.from(listeners)) {
    try {
      cb();
    } catch {}
  }
}

export function subscribePlaceholder(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/* ---------------- React 用 ---------------- */

/** 想在界面里跟着"换默认图"实时更新, 用这个 */
export function usePlaceholderUrl(): string {
  const [url, setUrl] = useState(getPlaceholderUrl);
  useEffect(() => subscribePlaceholder(() => setUrl(getPlaceholderUrl())), []);
  return url;
}

/* ---------------- 读写 ---------------- */

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

/** 压到 maxDim 以内再存, 免得一张 4K 图把存储撑爆 */
async function compressForPlaceholder(blob: Blob, maxDim = 640): Promise<Blob> {
  try {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });
      const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
      const width = Math.max(1, Math.round((img.width || 1) * scale));
      const height = Math.max(1, Math.round((img.height || 1) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return blob;
      // 先铺白底: 占位图多是白底/透明底, 透明区域直接画上去在深色主题下会发黑
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      const out = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png'),
      );
      return out || blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return blob;
  }
}

/** 换掉默认占位图(用户上传的那张) */
export async function setCustomPlaceholder(blob: Blob): Promise<void> {
  const compressed = await compressForPlaceholder(blob);
  const dataUrl = await blobToDataUrl(compressed);
  localStorage.setItem(LS_KEY, dataUrl);
  cachedUrl = dataUrl;
  resetFingerprints();
  notify();
}

/** 恢复成内置的那张 miu */
export function resetCustomPlaceholder(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {}
  cachedUrl = BUILTIN_PLACEHOLDER_URL;
  resetFingerprints();
  notify();
}

/* ---------------- 占位图内容指纹: 判断「某个 blob 就是占位图本身」 ---------------- */

type Fingerprint = { size: number; hash: string | null };

let builtinFpPromise: Promise<Fingerprint | null> | null = null;
let customFpPromise: Promise<Fingerprint | null> | null = null;

export function resetFingerprints(): void {
  builtinFpPromise = null;
  customFpPromise = null;
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

function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const head = dataUrl.slice(0, dataUrl.indexOf(','));
    const body = dataUrl.slice(dataUrl.indexOf(',') + 1);
    if (!body) return null;
    const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/png';
    if (head.includes(';base64')) {
      const bin = atob(body);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(body)], { type: mime });
  } catch {
    return null;
  }
}

async function fingerprintOf(blob: Blob | null): Promise<Fingerprint | null> {
  if (!blob) return null;
  return { size: blob.size, hash: await hashBlob(blob) };
}

/** 当前默认占位图的指纹(内置那张要 fetch 一次, 之后走缓存) */
export function getPlaceholderFingerprint(): Promise<Fingerprint | null> {
  const custom = readStored();
  if (custom) {
    if (!customFpPromise) customFpPromise = fingerprintOf(dataUrlToBlob(custom));
    return customFpPromise;
  }
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
