import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export const isAndroid = () => {
  if (typeof window === 'undefined') return false;
  if ((window as any).Android) return true;
  try {
    if (Capacitor && Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') return true;
  } catch (e) {}
  return false;
};

// Get image URL for <img> tags. Capacitor handles this magically if used, otherwise custom bridge
export function getLocalImageUrl(filePath: string, cacheBuster?: number | string): string {
  if (isAndroid()) {
    try {
      if (Capacitor && Capacitor.isNativePlatform()) {
         let url = Capacitor.convertFileSrc(filePath);
         if (cacheBuster) url += (url.includes('?') ? '&' : '?') + `t=${cacheBuster}`;
         return url;
      }
    } catch(e) {}
    // Standard Android WebViewAssetLoader format used by the user's APK
    if (filePath) {
        let url = `https://appassets.androidplatform.net/localfile?path=${encodeURIComponent(filePath)}`;
        if (cacheBuster) url += `&t=${cacheBuster}`;
        return url;
    }
  }
  return '';
}

export async function shareFileOnAndroid(filename: string, buffer: ArrayBuffer, mimeType?: string): Promise<boolean> {
  if (!isAndroid()) return false;
  try {
    // 分块写入应用 Cache 目录（避免大文件一次性转 base64 占用过多内存/卡顿），
    // 再交给 Capacitor 的系统分享面板。不落地到 Downloads/MIU，
    // 也就不会被原生扫描（listAllTavernFiles）误当成新角色卡再次导入。
    const chunkSize = 256 * 1024; // 256KB 分块
    const totalChunks = Math.ceil(buffer.byteLength / chunkSize);
    let fileUri = '';

    for (let i = 0; i < totalChunks; i++) {
       const chunkBlob = new Blob([buffer.slice(i * chunkSize, (i + 1) * chunkSize)]);
       const b64Chunk = await new Promise<string>((resolve, reject) => {
           const reader = new FileReader();
           reader.onload = () => {
               const dataUrl = reader.result as string;
               resolve(dataUrl.split(',')[1]);
           };
           reader.onerror = () => reject(reader.error);
           reader.readAsDataURL(chunkBlob);
       });

       if (i === 0) {
           const result = await Filesystem.writeFile({
               path: filename,
               data: b64Chunk,
               directory: Directory.Cache
           });
           fileUri = result.uri;
       } else {
           await Filesystem.appendFile({
               path: filename,
               data: b64Chunk,
               directory: Directory.Cache
           });
       await new Promise(r => setTimeout(r, 0));
       }
    }

    if (totalChunks === 0) {
        const result = await Filesystem.writeFile({
            path: filename,
            data: "",
            directory: Directory.Cache
        });
        fileUri = result.uri;
    }

    try {
      await Share.share({
        title: '分享文件',
        url: fileUri,
        dialogTitle: '分享文件',
      });
    } catch (shareErr) {
      console.log('Share canceled or failed', shareErr);
    }
    return true;
  } catch (e) {
    console.error("Share failed", e);
    return false;
  }
}


export async function readLocalFileBuffer(path: string): Promise<ArrayBuffer | null> {
  if (!isAndroid()) return null;
  try {
     const url = getLocalImageUrl(path);
     if (!url) return null;
     const res = await fetch(url);
     if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
     return await res.arrayBuffer();
  } catch (e) {
     console.error("Android bridge read via fetch failed:", e);
     // Fallback to old base64 method if fetch fails (e.g. CORS or not a capacitor path)
     try {
       const b64 = await (window as any).Android.readTavernFile(path);
       if (!b64) return null;
       const binaryString = atob(b64);
       const bytes = new Uint8Array(binaryString.length);
       for (let i = 0; i < binaryString.length; i++) {
           bytes[i] = binaryString.charCodeAt(i);
       }
       return bytes.buffer;
     } catch(fallbackError) {
       console.error("Fallback Android bridge read failed:", fallbackError);
       return null;
     }
  }
}

// 直接用底层原语写 .nomedia,不走 saveToGallery(避免和它互相等待造成死锁)。
async function _writeNomediaMarker(): Promise<void> {
   if (!isAndroid()) return;
   const tempFilename = "temp_" + Date.now() + "_.nomedia";
   const started = await startAndroidTempFile(tempFilename);
   if (!started) throw new Error('startAndroidTempFile failed for .nomedia');
   const finished = await finishAndroidTempFile(tempFilename);
   if (!finished) throw new Error('finishAndroidTempFile failed for .nomedia');
   const renamed = await renameLocalGalleryFile(`Temp/${tempFilename}`, '.nomedia');
   if (!renamed) throw new Error('renameLocalGalleryFile failed for .nomedia');
}

// 保证 .nomedia 标记文件一定先于任何其他文件写入完成,
// 避免"图片/文件先落地、.nomedia 标记后写入"的竞态导致文件被系统相册扫描进去。
// 用一个模块级 Promise 缓存结果,多次调用只会真正写入一次。
let nomediaEnsuredPromise: Promise<void> | null = null;
function ensureNomediaWritten(): Promise<void> {
   if (!nomediaEnsuredPromise) {
      nomediaEnsuredPromise = _writeNomediaMarker().catch((e) => {
         console.error('写入 .nomedia 失败,后续保存的图片可能会被系统相册扫描到:', e);
         // 失败了下次调用时重试,而不是永久放弃
         nomediaEnsuredPromise = null;
      });
   }
   return nomediaEnsuredPromise;
}

export async function saveToGallery(filename: string, buffer: ArrayBuffer): Promise<string | null> {
   if (!isAndroid()) return null;
   // .nomedia 本身除外,否则会死循环等待自己
   if (filename !== '.nomedia') {
      await ensureNomediaWritten();
   }
   try {
      if ((window as any).Android && (window as any).Android.startZip) {
          const dummyPath = filename + "_dummy.zip";
          if (await (window as any).Android.startZip(dummyPath)) {
              const absPath = await (window as any).Android.finishZip(dummyPath);
              if (absPath) {
                  await (window as any).Android.deleteFile(absPath);
              }
          }
      }
      
      const tempFilename = "temp_" + Date.now() + "_" + filename.replace(/\//g, "_");
      const started = await startAndroidTempFile(tempFilename);
      if (!started) return null;
      
      const chunkSize = 384 * 1024; // 384KB chunks
      const totalChunks = Math.ceil(buffer.byteLength / chunkSize);
      
      for (let i = 0; i < totalChunks; i++) {
         const chunk = buffer.slice(i * chunkSize, (i + 1) * chunkSize);
         const success = await appendAndroidTempFile(tempFilename, chunk);
         if (!success) {
            console.error("Failed to append chunk", i);
            return null;
         }
         await new Promise(r => setTimeout(r, 0));
      }
      
      const tempPath = await finishAndroidTempFile(tempFilename);
      if (!tempPath) return null;
      
      const renamed = await renameLocalGalleryFile(`Temp/${tempFilename}`, filename);
      if (renamed) {
         return tempPath.replace(`Temp/${tempFilename}`, filename);
      } else {
         return null;
      }
   } catch (e) {
      console.error("Android bridge save failed:", e);
      return null;
   }
}

export async function saveStringToGallery(filename: string, content: string): Promise<string | null> {
   if (!isAndroid()) return null;
   try {
      const b64 = btoa(unescape(encodeURIComponent(content)));
      return await (window as any).Android.saveTavernFile(filename, b64);
   } catch (e) {
      console.error("Android bridge save string failed:", e);
      return null;
   }
}

export async function startAndroidZip(filename: string): Promise<boolean> {
  if (!isAndroid() || !(window as any).Android.startZip) return false;
  return await (window as any).Android.startZip(filename);
}

export async function addAndroidZipEntry(zipFilename: string, entryName: string, buffer: ArrayBuffer): Promise<boolean> {
  if (!isAndroid() || !(window as any).Android.addZipEntry) return false;
  try {
     const blob = new Blob([buffer]);
     const b64 = await new Promise<string>((resolve, reject) => {
         const reader = new FileReader();
         reader.onload = () => resolve((reader.result as string).split(',')[1]);
         reader.onerror = () => reject(reader.error);
         reader.readAsDataURL(blob);
     });
     return await (window as any).Android.addZipEntry(zipFilename, entryName, b64);
  } catch (e) {
     return false;
  }
}

export async function addAndroidLocalZipEntry(zipFilename: string, entryName: string, localFilePath: string): Promise<boolean> {
  if (!isAndroid() || !(window as any).Android.addLocalFileToZip) return false;
  return await (window as any).Android.addLocalFileToZip(zipFilename, entryName, localFilePath);
}

export async function finishAndroidZip(zipFilename: string): Promise<string | null> {
  if (!isAndroid() || !(window as any).Android.finishZip) return null;
  return await (window as any).Android.finishZip(zipFilename);
}

export async function deleteLocalGalleryFile(path: string): Promise<boolean> {
  if (!isAndroid()) return false;
  try {
    return await (window as any).Android.deleteFile(path);
  } catch (e) {
    return false;
  }
}

/**
 * 批量删除版本: 一次调用把整批路径传给原生, 原生自己循环处理,
 * 不用 JS 这边循环调用单个删除接口(每次调用都是一次桥接开销,
 * 批量小卡片能省下大量重复开销)。
 * 如果装的是还没更新到这个新接口的老 APK, 自动退回逐个删除,
 * 保证不会因为原生接口缺失而直接失败。
 */
export async function deleteLocalGalleryFiles(paths: string[]): Promise<boolean> {
  if (!isAndroid()) return false;
  if (paths.length === 0) return true;
  try {
    const android = (window as any).Android;
    if (android && typeof android.deleteFiles === "function") {
      return await android.deleteFiles(JSON.stringify(paths));
    }
    // 兼容还没有 deleteFiles 接口的旧安装包
    let allOk = true;
    for (const p of paths) {
      const ok = await deleteLocalGalleryFile(p);
      if (!ok) allOk = false;
    }
    return allOk;
  } catch (e) {
    return false;
  }
}

export async function renameLocalGalleryFile(oldPath: string, newPath: string): Promise<boolean> {
  if (!isAndroid() || !(window as any).Android.renameFile) return false;
  try {
    return await (window as any).Android.renameFile(oldPath, newPath);
  } catch (e) {
    return false;
  }
}

/**
 * 批量重命名/移动版本: 一次调用把整批 {oldPath,newPath} 传给原生,
 * 原生自己循环处理, 只需要一次跨桥调用。返回值和传入顺序一一对应,
 * 方便调用方知道具体哪几对失败了(失败的那部分可以自行决定要不要兜底重试)。
 * 老版本 APK 没有这个批量接口的话, 自动退回逐个调用。
 */
export async function renameLocalGalleryFiles(
  pairs: { oldPath: string; newPath: string }[],
): Promise<boolean[]> {
  if (!isAndroid()) return pairs.map(() => false);
  if (pairs.length === 0) return [];
  try {
    const android = (window as any).Android;
    if (android && typeof android.moveFiles === "function") {
      const resultJson = await android.moveFiles(JSON.stringify(pairs));
      try {
        const parsed = JSON.parse(resultJson);
        if (Array.isArray(parsed) && parsed.length === pairs.length) {
          return parsed.map((v) => !!v);
        }
      } catch (e) {
        // 解析失败就退回逐个调用兜底
      }
    }
    // 兼容还没有 moveFiles 接口的旧安装包
    const results: boolean[] = [];
    for (const p of pairs) {
      results.push(await renameLocalGalleryFile(p.oldPath, p.newPath));
    }
    return results;
  } catch (e) {
    return pairs.map(() => false);
  }
}

export async function pickAndroidFiles(): Promise<string[]> {
  if (!isAndroid()) return [];
  try {
    if ((window as any).Android && (window as any).Android.pickFiles) {
      const jsonStr = await (window as any).Android.pickFiles();
      return JSON.parse(jsonStr || "[]") as string[];
    }
    
    // Fallback for Capacitor if the native bridge is missing
    if (Capacitor && Capacitor.isNativePlatform()) {
      const allFiles: string[] = [];
      const scanDir = async (path: string) => {
        try {
          // Use ExternalStorage and Download/MIU folder
          const result = await Filesystem.readdir({ directory: Directory.ExternalStorage, path });
          for (let i = 0; i < result.files.length; i++) {
            const file = result.files[i];
            const innerPath = path ? `${path}/${file.name}` : file.name;
            if (file.type === 'directory') {
              await scanDir(innerPath);
            } else if (file.name.toLowerCase().endsWith('.png') || file.name.toLowerCase().endsWith('.json')) {
              const fileUri = await Filesystem.getUri({ directory: Directory.ExternalStorage, path: innerPath });
              allFiles.push(fileUri.uri);
            }
            if (i % 20 === 0) await new Promise(r => setTimeout(r, 1)); // Yield every 20 files
          }
        } catch(e) {}
      };
      await scanDir('Download/MIU'); // Check inside MIU folder in Download
      return allFiles;
    }

    return [];
  } catch (e) {
    console.error("Android bridge pick files failed:", e);
    return [];
  }
}

export async function startAndroidTempFile(filename: string): Promise<boolean> {
  if (!isAndroid() || !(window as any).Android.startTempFile) return false;
  return await (window as any).Android.startTempFile(filename);
}

export async function appendAndroidTempFile(filename: string, buffer: ArrayBuffer): Promise<boolean> {
  if (!isAndroid() || !(window as any).Android.appendTempFile) return false;
  try {
     const blob = new Blob([buffer]);
     const b64 = await new Promise<string>((resolve, reject) => {
         const reader = new FileReader();
         reader.onload = () => resolve((reader.result as string).split(',')[1]);
         reader.onerror = () => reject(reader.error);
         reader.readAsDataURL(blob);
     });
     return await (window as any).Android.appendTempFile(filename, b64);
  } catch (e) {
     return false;
  }
}

export async function finishAndroidTempFile(filename: string): Promise<string | null> {
  if (!isAndroid() || !(window as any).Android.finishTempFile) return null;
  return await (window as any).Android.finishTempFile(filename);
}

export async function unzipAndroidTempFile(filename: string, targetFolderName: string = "MIU_Import"): Promise<string[]> {
  if (!isAndroid() || !(window as any).Android.unzipTempFile) return [];
  try {
    const jsonStr = await (window as any).Android.unzipTempFile(filename, targetFolderName);
    return JSON.parse(jsonStr || "[]") as string[];
  } catch (e) {
    console.error("Android bridge unzipTempFile failed:", e);
    return [];
  }
}

/**
 * 委托 Android 原生解压 ZIP 文件。
 * 相比于 JS 层的 JSZip，原生解压不会占用 V8 内存、不卡主线程，且直接落盘文件结构。
 * @param zipFilePath 需要解压的本地 ZIP 绝对路径
 * @param targetFolderName 解压至 Download/MIU/<targetFolderName> 文件夹。不填则为根目录
 * @returns 解压出的所有文件绝对路径列表
 */
export async function unzipOnAndroid(zipFilePath: string, targetFolderName: string = "Extracted"): Promise<string[]> {
  if (!isAndroid() || !(window as any).Android.unzipFile) return [];
  try {
    const jsonStr = await (window as any).Android.unzipFile(zipFilePath, targetFolderName);
    return JSON.parse(jsonStr || "[]") as string[];
  } catch (e) {
    console.error("Android bridge unzip failed:", e);
    return [];
  }
}

/**
 * 将文件分块写入 Download/MIU/Export/<filename>，写完后调起系统分享面板。
 *
 * 与 shareFileOnAndroid 的区别：
 *   - 文件永久落地到 MIU/Export/ 而非应用 Cache；
 *   - MT管理器等 App 通过"定位所在位置"拿到的是真实外部存储路径，
 *     不会被复制到 CleanOnExit 临时目录。
 *   - scanDirForTavernFiles 已跳过 Export 子目录，不会被误当成新角色卡导入。
 *
 * @param filename  文件名（不含路径），例如 "筱原冬弥.png"
 * @param buffer    文件内容
 * @param mimeType  MIME 类型，默认 "*\/*"
 * @param share     是否在写完后弹出分享面板，默认 true
 * @returns         落盘的绝对路径，失败返回 null
 */
export async function exportFileToMIU(
  filename: string,
  buffer: ArrayBuffer,
  mimeType?: string,
  share: boolean = true
): Promise<string | null> {
  if (!isAndroid()) return null;

  const android = (window as any).Android;
  if (!android?.startExportFile || !android?.appendExportFile || !android?.finishExportFile) {
    // 老版本 APK 没有这几个方法，回退到原来的分享流程
    console.warn("exportFileToMIU: native methods not found, falling back to shareFileOnAndroid");
    await shareFileOnAndroid(filename, buffer, mimeType);
    return null;
  }

  try {
    const started: boolean = await android.startExportFile(filename);
    if (!started) throw new Error("startExportFile returned false");

    // 每块 384KB 二进制 ≈ 512KB base64，安全低于 Binder 1MB 限制
    const CHUNK = 384 * 1024;
    const totalChunks = Math.max(1, Math.ceil(buffer.byteLength / CHUNK));

    for (let i = 0; i < totalChunks; i++) {
      const chunk = buffer.slice(i * CHUNK, (i + 1) * CHUNK);
      const b64: string = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(new Blob([chunk]));
      });
      const ok: boolean = await android.appendExportFile(filename, b64);
      if (!ok) throw new Error(`appendExportFile failed at chunk ${i}`);
      await new Promise(r => setTimeout(r, 0));
    }

    const absolutePath: string | null = await android.finishExportFile(
      filename,
      share,
      mimeType ?? '*/*'
    );
    return absolutePath;
  } catch (e) {
    console.error("exportFileToMIU failed:", e);
    return null;
  }
}

export async function shareLocalFileOnAndroid(absolutePath: string, mimeType: string = "*/*"): Promise<boolean> {
  if (!isAndroid() || !(window as any).Android.shareLocalFile) return false;
  try {
    await (window as any).Android.shareLocalFile(absolutePath, mimeType);
    return true;
  } catch (e) {
    return false;
  }
}
