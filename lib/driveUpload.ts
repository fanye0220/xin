import { Capacitor, CapacitorHttp } from '@capacitor/core';

// ============================================================================
// 这里之前有一个从一开始就错的假设，现在挖出来了：
//
// Google 官方文档明确写了 multipart 上传（uploadType=multipart）里，内容
// 那一部分就是要传"原始字节"，压根没提过它会认 Content-Transfer-Encoding
// 这个 header 并自动帮你把 base64 解回二进制。之前的实现是把文件内容转成
// base64 文本，指望 Google 服务器看到 Content-Transfer-Encoding: base64
// 就自动解码——但大概率 Google 根本不认这个 header，是把这段 base64 文本
// 原封不动当成文件的"原始字节"存下来了。结果就是：云端存的其实是一坨
// base64 文本，不是真正的 PNG/ZIP/JSON——这就是"卡片乱码"的真正原因，
// 不是某一张卡片本身有问题。
//
// 正确做法参考我们已经在推送到酒馆那边验证过、确实好使的思路：
// 自己把 multipart 包拼成"真正的原始字节"（不是 base64 文本），安卓原生端
// 转 base64 只是为了安全跨过 JS-原生桥这一层，真正发出去之前用
// CapacitorHttp 的 dataType:'file' 让原生层解码回真字节再发——这样服务器
// 收到的就是它自己期望的原始二进制，不用指望它认什么 header。
//
// 这个文件已经被"改回老写法"回退过不止一次了——如果你（未来的我，或者
// 另一个 AI）在这里看到有人想改成 Content-Transfer-Encoding + 普通
// fetch(Blob/ArrayBuffer body)，先去确认 Google 是否真的支持那个 header，
// 而不是想当然。
// ============================================================================

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000; // 32KB 分块，避免大文件时调用栈溢出
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

export interface DriveUploadResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
  json: () => Promise<any>;
}

/**
 * Google Drive 的 multipart/related 上传（建文件时带元数据，或者更新已有
 * 文件的内容），把 metadata + 文件内容拼成一份真正的二进制 multipart 包再
 * 发出去。原生端通过 CapacitorHttp 的 dataType:'file' 保证发出去的是真字节，
 * 不是被当成普通字符串/复杂类型处理坏。注意：Google 这个上传方式本身也是
 * 5MB 硬顶——更大的文件需要走 resumable upload，不能靠这个函数。
 */
async function driveMultipartUpload(
  url: string,
  method: 'POST' | 'PATCH',
  accessToken: string,
  metadata: Record<string, any>,
  blob: Blob,
  mimeType: string,
): Promise<DriveUploadResponse> {
  const boundary = `----MiuDriveBoundary${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  const CRLF = '\r\n';
  const encoder = new TextEncoder();

  const metadataPart = encoder.encode(
    `--${boundary}${CRLF}Content-Type: application/json; charset=UTF-8${CRLF}${CRLF}${JSON.stringify(metadata)}${CRLF}--${boundary}${CRLF}Content-Type: ${mimeType}${CRLF}${CRLF}`,
  );
  const fileBytes = new Uint8Array(await blob.arrayBuffer());
  const closingPart = encoder.encode(`${CRLF}--${boundary}--`);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': `multipart/related; boundary=${boundary}`,
    ...(method === 'PATCH' ? { 'X-HTTP-Method-Override': 'PATCH' } : {}),
  };

  if (Capacitor.isNativePlatform()) {
    const combined = new Uint8Array(metadataPart.length + fileBytes.length + closingPart.length);
    combined.set(metadataPart, 0);
    combined.set(fileBytes, metadataPart.length);
    combined.set(closingPart, metadataPart.length + fileBytes.length);
    const base64Data = bufferToBase64(combined.buffer);

    const nativeRes = await CapacitorHttp.request({
      url,
      method: method,
      headers,
      data: base64Data,
      dataType: 'file',
    });
    const rawData = nativeRes.data;
    const asText = typeof rawData === 'string' ? rawData : JSON.stringify(rawData ?? '');
    let errMsg = '';
    if (nativeRes.status < 200 || nativeRes.status >= 300) {
      errMsg = typeof rawData === 'object' ? (rawData?.error?.message || JSON.stringify(rawData)) : String(rawData || `HTTP ${nativeRes.status}`);
    }
    return {
      ok: nativeRes.status >= 200 && nativeRes.status < 300,
      status: nativeRes.status,
      statusText: errMsg,
      text: async () => asText,
      json: async () => (typeof rawData === 'string' ? JSON.parse(rawData) : rawData),
    };
  }

  // Web 没有这个 bug，普通 Blob body 就行
  const body = new Blob([metadataPart, fileBytes, closingPart]);
  const res = await fetch(url, {
    method: method,
    headers,
    body,
  });
  let resText = '';
  if (!res.ok) {
    try {
      resText = await res.text();
      try {
        const parsed = JSON.parse(resText);
        resText = parsed?.error?.message || resText;
      } catch {}
    } catch {}
  }
  return {
    ok: res.ok,
    status: res.status,
    statusText: resText || res.statusText || `HTTP ${res.status}`,
    text: () => (resText ? Promise.resolve(resText) : res.text()),
    json: () => res.json(),
  };
}

/** 断点续传单个分块用的大小，必须是 256KB 的整数倍（Google 要求），最后一块除外。 */
const RESUMABLE_CHUNK_SIZE = 8 * 1024 * 1024; // 8MB

/**
 * Google Drive 的断点续传上传（resumable upload）——没有 5MB 上限（最大到
 * 5TB），而且每次只处理一小块数据，不用把整个大文件一次性转成 base64 塞过
 * 安卓的 JS-原生桥。"一键完整备份"这种可能有几十上百 MB 的场景，必须用
 * 这个，不能用上面那个 multipart（会超限，安卓上还可能因为内存爆掉直接
 * 闪退）。
 */
export async function resumableUploadToDrive(
  accessToken: string,
  metadata: Record<string, any>,
  blob: Blob,
  mimeType: string,
  onProgress?: (uploaded: number, total: number) => void,
): Promise<DriveUploadResponse> {
  // 第一步：开一个上传会话，拿到本次上传专用的地址
  const startRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(blob.size),
    },
    body: JSON.stringify(metadata),
  });

  if (!startRes.ok) {
    return {
      ok: false,
      status: startRes.status,
      statusText: startRes.statusText,
      text: () => startRes.text(),
      json: () => startRes.json(),
    };
  }

  const sessionUrl = startRes.headers.get('Location') || startRes.headers.get('location');
  if (!sessionUrl) {
    return {
      ok: false,
      status: 0,
      statusText: '未拿到断点续传会话地址',
      text: async () => '未拿到断点续传会话地址',
      json: async () => ({ error: '未拿到断点续传会话地址' }),
    };
  }

  const total = blob.size;
  let uploaded = 0;
  let finalResult: DriveUploadResponse | null = null;

  const putChunk = async (chunkBuffer: ArrayBuffer, rangeHeader: string): Promise<{ status: number; data: any; isString: boolean }> => {
    if (Capacitor.isNativePlatform()) {
      const base64Chunk = bufferToBase64(chunkBuffer);
      const nativeRes = await CapacitorHttp.request({
        url: sessionUrl,
        method: 'PUT',
        headers: { 'Content-Range': rangeHeader },
        data: base64Chunk,
        dataType: 'file',
      });
      return { status: nativeRes.status, data: nativeRes.data, isString: typeof nativeRes.data === 'string' };
    }
    const res = await fetch(sessionUrl, {
      method: 'PUT',
      headers: { 'Content-Range': rangeHeader },
      body: chunkBuffer,
    });
    let data: any = null;
    try { data = await res.clone().json(); } catch { try { data = await res.text(); } catch {} }
    return { status: res.status, data, isString: typeof data === 'string' };
  };

  while (uploaded < total) {
    const end = Math.min(uploaded + RESUMABLE_CHUNK_SIZE, total);
    const chunk = blob.slice(uploaded, end);
    const chunkBuffer = await chunk.arrayBuffer();
    const rangeHeader = `bytes ${uploaded}-${end - 1}/${total}`;

    const { status, data, isString } = await putChunk(chunkBuffer, rangeHeader);

    if (status === 308) {
      // 这一块收到了，继续传下一块
      uploaded = end;
      onProgress?.(uploaded, total);
      continue;
    }

    if (status >= 200 && status < 300) {
      // 全部传完了
      const asText = isString ? data : JSON.stringify(data ?? '');
      finalResult = {
        ok: true,
        status,
        statusText: '',
        text: async () => asText,
        json: async () => (isString ? JSON.parse(data) : data),
      };
      uploaded = end;
      onProgress?.(uploaded, total);
      break;
    }

    // 出错了
    const asText = isString ? data : JSON.stringify(data ?? '');
    return {
      ok: false,
      status,
      statusText: '',
      text: async () => asText,
      json: async () => (isString ? JSON.parse(data) : data),
    };
  }

  return finalResult || {
    ok: false,
    status: 0,
    statusText: '上传未完成',
    text: async () => '上传未完成',
    json: async () => ({ error: '上传未完成' }),
  };
}

/** 更新已有 Drive 文件的内容（角色卡云同步单张更新用这个）。 */
export async function uploadBlobToDrive(
  accessToken: string,
  fileId: string,
  blob: Blob,
  mimeType: string,
  metadata: Record<string, any> = {},
): Promise<DriveUploadResponse> {
  return driveMultipartUpload(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`,
    'PATCH',
    accessToken,
    { mimeType, ...metadata },
    blob,
    mimeType,
  );
}

/** 新建一个带内容的 Drive 文件（完整备份等一次性建文件用这个）。 */
export async function createDriveFileWithContent(
  accessToken: string,
  metadata: Record<string, any>,
  blob: Blob,
  mimeType: string,
): Promise<DriveUploadResponse> {
  return driveMultipartUpload(
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`,
    'POST',
    accessToken,
    metadata,
    blob,
    mimeType,
  );
}
