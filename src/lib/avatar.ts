import { createAvatar } from '@dicebear/core';
import { bottts } from '@dicebear/collection';

export function getFallbackAvatar(seed: string, category?: string): string {
  const cat = (category || '').toLowerCase();
  
  try {
    const avatar = createAvatar(bottts, {
      seed: seed || 'default',
    });
    const svgStr = avatar.toString();
    try {
      const encoded = encodeURIComponent(svgStr).replace(/%([0-9A-F]{2})/g,
          (match, p1) => String.fromCharCode(parseInt(p1, 16))
      );
      const base64 = typeof window !== 'undefined' ? window.btoa(encoded) : (typeof Buffer !== 'undefined' ? Buffer.from(svgStr).toString('base64') : btoa(encoded));
      return `data:image/svg+xml;base64,${base64}`;
    } catch {
      return `data:image/svg+xml;utf8,${encodeURIComponent(svgStr)}`;
    }
  } catch {
    const fallbackRobot = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g-rb" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#6366f1"/><stop offset="100%" stop-color="#4f46e5"/></linearGradient></defs><rect width="100" height="100" rx="24" fill="url(#g-rb)"/><rect x="28" y="32" width="44" height="36" rx="10" fill="#ffffff"/><circle cx="40" cy="48" r="5" fill="#4f46e5"/><circle cx="60" cy="48" r="5" fill="#4f46e5"/><rect x="42" y="58" width="16" height="4" rx="2" fill="#4f46e5"/><rect x="47" y="22" width="6" height="10" rx="3" fill="#ffffff"/><circle cx="50" cy="20" r="4" fill="#ffffff"/></svg>';
    return `data:image/svg+xml;utf8,${encodeURIComponent(fallbackRobot)}`;
  }
}

export function resolveAvatarUrl(avatarFallback: string | undefined | null, seed: string, category?: string): string {
  if (
    avatarFallback &&
    typeof avatarFallback === 'string' &&
    avatarFallback.trim().length > 0 &&
    avatarFallback !== 'undefined' &&
    avatarFallback !== 'null' &&
    !avatarFallback.includes('api.dicebear.com') &&
    (avatarFallback.startsWith('data:image/') ||
     avatarFallback.startsWith('http://') ||
     avatarFallback.startsWith('https://') ||
     avatarFallback.startsWith('blob:'))
  ) {
    return avatarFallback;
  }
  return getFallbackAvatar(seed, category);
}

/**
 * 把一张原图压成一张小缩略图, 专门给列表/卡片这种小尺寸展示场景用,
 * 避免列表里也要解码整张原图(参考卡库的做法: 列表只读小缩略图,
 * 详情页才用原图)。
 *
 * @param blob 原图
 * @param maxSize 缩略图长边最大像素, 默认 200(够卡片列表用了)
 * @param quality JPEG 压缩质量, 默认 0.82
 */
export async function generateThumbnail(
  blob: Blob,
  maxSize: number = 200,
  quality: number = 0.82,
): Promise<Blob> {
  const objectUrl = URL.createObjectURL(blob);
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
