function stringToHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

const PALETTES = [
  { name: 'Violet Dusk', start: '#6366f1', end: '#a855f7' },
  { name: 'Slate Graphite', start: '#475569', end: '#1e293b' },
  { name: 'Cobalt Sky', start: '#0284c7', end: '#2563eb' },
  { name: 'Emerald Jade', start: '#059669', end: '#0f766e' },
  { name: 'Amber Flare', start: '#d97706', end: '#ea580c' },
  { name: 'Crimson Rose', start: '#e11d48', end: '#9f1239' },
  { name: 'Royal Indigo', start: '#4f46e5', end: '#3730a3' },
  { name: 'Obsidian Dark', start: '#27272a', end: '#09090b' },
  { name: 'Aether Teal', start: '#0d9488', end: '#115e59' },
  { name: 'Orchid Purple', start: '#9333ea', end: '#581c87' },
  { name: 'Midnight Cyan', start: '#0891b2', end: '#155e75' },
  { name: 'Champagne Taupe', start: '#78716c', end: '#44403c' },
];

export function isFallbackMiuImage(url: string | undefined | null): boolean {
  if (!url || typeof url !== 'string') return true;
  const lower = url.toLowerCase();
  return (
    lower.includes('miu') ||
    lower.includes('dicebear') ||
    lower.includes('bottts') ||
    lower.startsWith('data:image/svg')
  );
}

export function getFallbackAvatar(seed?: string, category?: string): string {
  // 使用用户最新指定的圆润可爱版 miu 官方图案
  return '/assets/aistudio/_______miu__5866e70e.png';
}

export function resolveAvatarUrl(avatarFallback: string | undefined | null, seed?: string, category?: string): string {
  if (
    avatarFallback &&
    typeof avatarFallback === 'string' &&
    avatarFallback.trim().length > 0 &&
    avatarFallback !== 'undefined' &&
    avatarFallback !== 'null'
  ) {
    const lower = avatarFallback.toLowerCase();
    // 只要包含任何老版本/占位符标志（miu, bottts, dicebear, svg）, 统一归一化返回最新的 5866e70e miu 官方图
    if (
      lower.includes('miu') ||
      lower.includes('bottts') ||
      lower.includes('dicebear') ||
      lower.startsWith('data:image/svg')
    ) {
      return getFallbackAvatar(seed, category);
    }
    // 只有真正的 HTTP(S)/Blob/Data(PNG/JPG) 照片才原样返回
    if (
      avatarFallback.startsWith('http://') || 
      avatarFallback.startsWith('https://') || 
      avatarFallback.startsWith('blob:') ||
      avatarFallback.startsWith('data:image/')
    ) {
      return avatarFallback;
    }
  }
  return getFallbackAvatar(seed, category);
}

/**
 * 安全创建 Object URL，防止传入非 Blob/File 对象时导致 URL.createObjectURL 抛出 TypeError Overload resolution failed 崩溃。
 */
export function safeCreateObjectURL(blob: any): string | null {
  if (!blob) return null;
  
  // 如果本身就是合法的 URL 字符串(如 data: 或 blob: 或 http 或 本地路径), 直接返回
  if (typeof blob === 'string') {
    const trimmed = blob.trim();
    if (
      trimmed.startsWith('blob:') ||
      trimmed.startsWith('data:') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('/') ||
      trimmed.startsWith('file:')
    ) {
      return trimmed;
    }
    return null;
  }

  try {
    if (blob instanceof Blob || blob instanceof File) {
      return URL.createObjectURL(blob);
    }
    if (blob instanceof ArrayBuffer) {
      return URL.createObjectURL(new Blob([blob]));
    }
    if (ArrayBuffer.isView(blob)) {
      const view = blob as any;
      if (view.buffer && view.buffer instanceof ArrayBuffer) {
        const sliced = view.buffer.slice(view.byteOffset || 0, (view.byteOffset || 0) + (view.byteLength || 0));
        return URL.createObjectURL(new Blob([sliced]));
      }
      return URL.createObjectURL(new Blob([blob as any]));
    }
    if (typeof blob === 'object') {
      if (blob.buffer && blob.buffer instanceof ArrayBuffer) {
        const offset = blob.byteOffset || 0;
        const length = blob.byteLength || blob.buffer.byteLength;
        return URL.createObjectURL(new Blob([blob.buffer.slice(offset, offset + length)]));
      }
      if (Array.isArray(blob.data)) {
        return URL.createObjectURL(new Blob([new Uint8Array(blob.data)]));
      }
      if (blob._data || blob.data) {
        const d = blob._data || blob.data;
        if (d instanceof ArrayBuffer || ArrayBuffer.isView(d)) {
          return safeCreateObjectURL(d);
        }
        if (Array.isArray(d)) {
          return URL.createObjectURL(new Blob([new Uint8Array(d)]));
        }
      }
      // 尝试原生 createObjectURL (例如 Worker/Polyfill 或跨 frame 传过来的 Blob)
      try {
        return URL.createObjectURL(blob);
      } catch {
        // 如果原生失败，尝试包装进 Blob
        return URL.createObjectURL(new Blob([blob]));
      }
    }
  } catch (err) {
    console.warn('safeCreateObjectURL handled error:', err);
  }
  return null;
}

/**
 * 把一张原图压成高清缩略图, 专门给列表/卡片展示场景用,
 * 既保证 2K/3K 视网膜屏极致清澈无损画质，又避免列表解码多张大尺寸原图 (仅 ~30-50KB)。
 *
 * @param blob 原图
 * @param maxSize 缩略图长边最大像素, 默认 800(高分屏/瀑布流超高清)
 * @param quality JPEG 压缩质量, 默认 0.90
 */
export async function generateThumbnail(
  blob: Blob,
  maxSize: number = 800,
  quality: number = 0.90,
): Promise<Blob> {
  const objectUrl = safeCreateObjectURL(blob);
  if (!objectUrl) return blob;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = (e) => reject(e);
      el.src = objectUrl;
    });

    let { width, height } = img;
    if (width <= maxSize && height <= maxSize) {
      return blob;
    }
    if (width > height) {
      height = Math.round((height * maxSize) / width);
      width = maxSize;
    } else {
      width = Math.round((width * maxSize) / height);
      height = maxSize;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(img, 0, 0, width, height);

    const thumbBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
    });
    return thumbBlob || blob;
  } catch {
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
