/**
 * iOS Style Wallpaper Extension Color Extractor
 * Samples the top edge and top ambient colors from the image
 * to generate a seamless extension gradient for when the wallpaper doesn't reach the top.
 */

export interface ImageTopColors {
  topColor: string; // Color at the very top (RGB)
  topEdgeColor: string; // Color slightly below the edge (RGB)
  gradient: string; // Ready-to-use CSS background gradient
}

// In-memory cache to avoid redundant canvas operations
const colorCache = new Map<string, ImageTopColors>();

export function extractTopImageColors(
  imageUrl: string,
  offsetX: number = 0,
  scale: number = 1
): Promise<ImageTopColors> {
  const cacheKey = `${imageUrl.slice(0, 80)}_${Math.round(offsetX)}_${Math.round(scale * 10)}`;
  if (colorCache.has(cacheKey)) {
    return Promise.resolve(colorCache.get(cacheKey)!);
  }

  return new Promise((resolve) => {
    const fallback: ImageTopColors = {
      topColor: 'rgb(30, 41, 59)',
      topEdgeColor: 'rgb(15, 23, 42)',
      gradient: 'linear-gradient(to bottom, rgb(30, 41, 59) 0%, rgb(15, 23, 42) 100%)',
    };

    if (!imageUrl) return resolve(fallback);

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(fallback);

        const w = 40;
        const h = 20;
        canvas.width = w;
        canvas.height = h;

        // Draw top 15% of the image onto small canvas
        ctx.drawImage(
          img,
          0,
          0,
          img.naturalWidth,
          Math.max(1, img.naturalHeight * 0.15),
          0,
          0,
          w,
          h
        );

        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;

        // Sample row 0 (the top-most pixels of the photo)
        let r0 = 0, g0 = 0, b0 = 0, count0 = 0;
        for (let x = 0; x < w; x++) {
          const idx = (0 * w + x) * 4;
          const a = data[idx + 3];
          if (a > 20) {
            r0 += data[idx];
            g0 += data[idx + 1];
            b0 += data[idx + 2];
            count0++;
          }
        }

        if (count0 > 0) {
          r0 = Math.round(r0 / count0);
          g0 = Math.round(g0 / count0);
          b0 = Math.round(b0 / count0);
        } else {
          r0 = 30; g0 = 41; b0 = 59;
        }

        // Sample rows 2 to 6 (ambient color near the top)
        let r1 = 0, g1 = 0, b1 = 0, count1 = 0;
        for (let y = 2; y < Math.min(8, h); y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const a = data[idx + 3];
            if (a > 20) {
              r1 += data[idx];
              g1 += data[idx + 1];
              b1 += data[idx + 2];
              count1++;
            }
          }
        }

        if (count1 > 0) {
          r1 = Math.round(r1 / count1);
          g1 = Math.round(g1 / count1);
          b1 = Math.round(b1 / count1);
        } else {
          r1 = r0; g1 = g0; b1 = b0;
        }

        const topColor = `rgb(${r0}, ${g0}, ${b0})`;
        const topEdgeColor = `rgb(${r1}, ${g1}, ${b1})`;
        const gradient = `linear-gradient(to bottom, rgb(${r0}, ${g0}, ${b0}) 0%, rgb(${r0}, ${g0}, ${b0}) 45%, rgb(${r1}, ${g1}, ${b1}) 100%)`;

        const result: ImageTopColors = {
          topColor,
          topEdgeColor,
          gradient,
        };

        colorCache.set(cacheKey, result);
        resolve(result);
      } catch (err) {
        console.warn('Color extraction failed:', err);
        resolve(fallback);
      }
    };

    img.onerror = () => resolve(fallback);
    img.src = imageUrl;
  });
}
