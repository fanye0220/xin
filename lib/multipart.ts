import { Capacitor, CapacitorHttp } from '@capacitor/core';

// CapacitorHttp (native fetch/XHR bridge, enabled for the tavern-pull CORS
// fix) is broken for binary request bodies on native Android/iOS — this has
// bitten us twice now: FormData bodies get mangled ("Malformed part header"
// on the SillyTavern/busboy side), and even a hand-built Blob body gets
// silently truncated ("Unexpected end of form"). Both go through the same
// patched global fetch(), which is the actual buggy part.
//
// Capacitor's own docs describe the correct way to send binary on native:
// don't use the patched fetch/XHR at all for this — call the CapacitorHttp
// plugin's own request() API directly, base64-encode the body yourself, and
// set dataType: 'file' so the *native* Java/Swift layer base64-decodes it
// back into real bytes before it ever hits the wire. That decode step is
// what fetch()'s auto-patching never does correctly for Blob/FormData.
//
// On web there's no such bug (this whole plugin no-ops there), so we just
// use a normal fetch() with a Blob body.

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000; // 32KB chunks — avoids call-stack overflow on large files
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

export interface MultipartResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<any>;
}

/**
 * POST a multipart/form-data request (fields + one file) reliably on both
 * web and native Android/iOS. Use this instead of fetch()+FormData/Blob for
 * any multipart upload — that combination is not reliable once CapacitorHttp
 * is enabled.
 */
export async function multipartPost(
  url: string,
  fields: { name: string; value: string }[],
  fileField: { name: string; blob: Blob; filename: string },
  headers: Record<string, string> = {},
): Promise<MultipartResponse> {
  const boundary = `----MiuFormBoundary${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  const CRLF = '\r\n';

  if (Capacitor.isNativePlatform()) {
    // 原生端: 自己把整个 multipart body 拼成真正的字节数组, 转 base64 交给
    // CapacitorHttp 原生层解码后再发出去 —— 这是文档里写明支持二进制的方式,
    // 不会再被 fetch() 那层自动补丁搞坏。
    const encoder = new TextEncoder();
    const partsBytes: Uint8Array[] = [];

    for (const f of fields) {
      partsBytes.push(
        encoder.encode(
          `--${boundary}${CRLF}Content-Disposition: form-data; name="${f.name}"${CRLF}${CRLF}${f.value}${CRLF}`,
        ),
      );
    }

    partsBytes.push(
      encoder.encode(
        `--${boundary}${CRLF}Content-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"${CRLF}Content-Type: ${fileField.blob.type || 'application/octet-stream'}${CRLF}${CRLF}`,
      ),
    );
    const fileBytes = new Uint8Array(await fileField.blob.arrayBuffer());
    partsBytes.push(fileBytes);
    partsBytes.push(encoder.encode(`${CRLF}--${boundary}--${CRLF}`));

    const totalLength = partsBytes.reduce((acc, p) => acc + p.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const p of partsBytes) {
      combined.set(p, offset);
      offset += p.length;
    }

    const base64Data = arrayBufferToBase64(combined.buffer);

    const nativeRes = await CapacitorHttp.request({
      url,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      data: base64Data,
      dataType: 'file', // 告诉原生层: 这是 base64, 解码成原始字节再发
    });

    const status = nativeRes.status;
    const rawData = nativeRes.data;
    const asText = typeof rawData === 'string' ? rawData : JSON.stringify(rawData ?? '');
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => asText,
      json: async () => (typeof rawData === 'string' ? JSON.parse(rawData) : rawData),
    };
  }

  // Web: 没有这个 bug, 普通 fetch + Blob body 就行
  const parts: BlobPart[] = [];
  for (const f of fields) {
    parts.push(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="${f.name}"${CRLF}${CRLF}${f.value}${CRLF}`,
    );
  }
  parts.push(
    `--${boundary}${CRLF}Content-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"${CRLF}Content-Type: ${fileField.blob.type || 'application/octet-stream'}${CRLF}${CRLF}`,
  );
  parts.push(fileField.blob);
  parts.push(`${CRLF}--${boundary}--${CRLF}`);

  const body = new Blob(parts);
  const res = await fetch(url, {
    method: 'POST',
    body,
    headers: {
      ...headers,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
  });
  return {
    ok: res.ok,
    status: res.status,
    text: () => res.text(),
    json: () => res.json(),
  };
}
