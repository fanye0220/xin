export async function extractTavernData(buffer: ArrayBuffer): Promise<any | null> {
  const dataView = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);

  // Check PNG signature
  if (
    uint8[0] !== 0x89 ||
    uint8[1] !== 0x50 ||
    uint8[2] !== 0x4e ||
    uint8[3] !== 0x47 ||
    uint8[4] !== 0x0d ||
    uint8[5] !== 0x0a ||
    uint8[6] !== 0x1a ||
    uint8[7] !== 0x0a
  ) {
    return null;
  }

  // A V3 card PNG typically embeds BOTH a legacy 'chara' chunk (v2-compatible
  // fallback, may omit newer fields like tags) AND a 'ccv3' chunk (full v3
  // data). We must scan every chunk and prefer 'ccv3' over 'chara' rather
  // than returning on whichever keyword happens to appear first.
  const rawPayloads: { chara?: string; ccv3?: string } = {};

  const decodeChunkPayload = async (
    type: string,
    data: Uint8Array
  ): Promise<{ keyword: string; payload: string } | null> => {
    if (type === 'tEXt') {
      const text = new TextDecoder('utf-8').decode(data);
      if (text.startsWith('chara\0')) {
        return { keyword: 'chara', payload: text.substring(6) };
      } else if (text.startsWith('ccv3\0')) {
        return { keyword: 'ccv3', payload: text.substring(5) };
      }
      return null;
    } else if (type === 'iTXt') {
      let nullIdx = 0;
      while (nullIdx < data.length && data[nullIdx] !== 0) {
        nullIdx++;
      }
      const keyword = new TextDecoder('utf-8').decode(data.slice(0, nullIdx));

      if (keyword === 'chara' || keyword === 'ccv3') {
        const compressionFlag = data[nullIdx + 1];
        let currentIdx = nullIdx + 3;
        let nullsFound = 0;
        while (currentIdx < data.length && nullsFound < 2) {
          if (data[currentIdx] === 0) nullsFound++;
          currentIdx++;
        }

        const textData = data.slice(currentIdx);

        if (compressionFlag === 0) {
          return { keyword, payload: new TextDecoder('utf-8').decode(textData) };
        } else if (compressionFlag === 1) {
          try {
            const ds = new DecompressionStream('deflate');
            const writer = ds.writable.getWriter();
            writer.write(textData);
            writer.close();

            const reader = ds.readable.getReader();
            const chunks: Uint8Array[] = [];
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) chunks.push(value);
            }

            const totalLength = chunks.reduce((acc, val) => acc + val.length, 0);
            const decompressed = new Uint8Array(totalLength);
            let off = 0;
            for (const chunk of chunks) {
              decompressed.set(chunk, off);
              off += chunk.length;
            }

            return { keyword, payload: new TextDecoder('utf-8').decode(decompressed) };
          } catch (e) {
            console.error('Failed to decompress iTXt chunk', e);
          }
        }
      }
      return null;
    }
    return null;
  };

  let offset = 8;
  while (offset < buffer.byteLength) {
    const length = dataView.getUint32(offset);
    const type = String.fromCharCode(
      uint8[offset + 4],
      uint8[offset + 5],
      uint8[offset + 6],
      uint8[offset + 7]
    );

    const dataOffset = offset + 8;
    const data = uint8.slice(dataOffset, dataOffset + length);

    if (type === 'tEXt' || type === 'iTXt') {
      const result = await decodeChunkPayload(type, data);
      if (result && !rawPayloads[result.keyword as 'chara' | 'ccv3']) {
        rawPayloads[result.keyword as 'chara' | 'ccv3'] = result.payload;
      }
    }

    offset += 8 + length + 4; // length + type + data + crc
  }

  // Prefer the full v3 payload; fall back to the legacy v2-compatible one.
  if (rawPayloads.ccv3) {
    const parsed = parsePayload(rawPayloads.ccv3);
    if (parsed) return parsed;
  }
  if (rawPayloads.chara) {
    return parsePayload(rawPayloads.chara);
  }

  return null;
}

function parsePayload(payload: string): any | null {
  try {
    // Try parsing as base64 first
    const binString = atob(payload);
    const bytes = Uint8Array.from(binString, (m) => m.codePointAt(0)!);
    const jsonString = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(jsonString);
  } catch (e) {
    try {
      // Fallback for older/different encoding
      const jsonString = decodeURIComponent(escape(atob(payload)));
      return JSON.parse(jsonString);
    } catch (e2) {
      try {
        // Fallback: maybe it's not base64 encoded at all
        return JSON.parse(payload);
      } catch (e3) {
        console.error("Failed to parse chara payload", e3);
        return null;
      }
    }
  }
}

// CRC32 implementation for PNG chunks
const crcTable: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crcTable[n] = c;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff ^ 0;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function injectTavernData(originalBuffer: ArrayBuffer, data: any): ArrayBuffer {
  const uint8 = new Uint8Array(originalBuffer);
  
  // Check PNG signature
  if (
    uint8.length < 8 ||
    uint8[0] !== 0x89 ||
    uint8[1] !== 0x50 ||
    uint8[2] !== 0x4e ||
    uint8[3] !== 0x47 ||
    uint8[4] !== 0x0d ||
    uint8[5] !== 0x0a ||
    uint8[6] !== 0x1a ||
    uint8[7] !== 0x0a
  ) {
    throw new Error("Not a valid PNG file");
  }

  const isV3 = data.spec === 'chara_card_v3';

  // For v3 cards we write BOTH chunks: 'ccv3' with the full v3 payload, and
  // a 'chara' fallback so tools that only understand the legacy v2 keyword
  // (still common) don't end up with an unreadable card. The v2 envelope
  // reuses the same inner `data` object — v2 already supports the fields
  // that matter for compatibility (name, description, tags, etc.); any
  // v3-only extras are simply ignored by v2-only readers.
  const buildChunk = (keyword: 'chara' | 'ccv3', payloadObj: any): Uint8Array => {
    const jsonString = JSON.stringify(payloadObj);
    const base64 = btoa(unescape(encodeURIComponent(jsonString)));
    const textData = new TextEncoder().encode(`${keyword}\0${base64}`);

    const chunkLength = textData.length;
    const chunkType = new TextEncoder().encode('tEXt');

    const chunkData = new Uint8Array(4 + chunkLength);
    chunkData.set(chunkType, 0);
    chunkData.set(textData, 4);

    const crc = crc32(chunkData);

    const newChunk = new Uint8Array(4 + 4 + chunkLength + 4);
    const view = new DataView(newChunk.buffer);
    view.setUint32(0, chunkLength);
    newChunk.set(chunkType, 4);
    newChunk.set(textData, 8);
    view.setUint32(8 + chunkLength, crc);
    return newChunk;
  };

  const newChunks: Uint8Array[] = [];
  if (isV3) {
    const v2Envelope = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: data.data,
    };
    newChunks.push(buildChunk('chara', v2Envelope));
    newChunks.push(buildChunk('ccv3', data));
  } else {
    newChunks.push(buildChunk('chara', data));
  }

  // Reconstruct PNG
  const chunks: Uint8Array[] = [];
  chunks.push(uint8.slice(0, 8)); // Signature

  let offset = 8;
  let charaInjected = false;

  while (offset < originalBuffer.byteLength) {
    const length = new DataView(originalBuffer).getUint32(offset);
    const type = String.fromCharCode(
      uint8[offset + 4],
      uint8[offset + 5],
      uint8[offset + 6],
      uint8[offset + 7]
    );

    const chunkEnd = offset + 8 + length + 4;
    
    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      const dataOffset = offset + 8;
      const dataSlice = uint8.slice(dataOffset, dataOffset + length);
      
      let nullIdx = 0;
      while (nullIdx < dataSlice.length && dataSlice[nullIdx] !== 0) {
        nullIdx++;
      }
      const keyword = new TextDecoder('utf-8').decode(dataSlice.slice(0, nullIdx));
      
      if (keyword === 'chara' || keyword === 'ccv3') {
        // Skip existing chara/ccv3 chunk(s), we will inject our own
        offset = chunkEnd;
        continue;
      }
    }

    if (type === 'IEND' && !charaInjected) {
      for (const c of newChunks) chunks.push(c);
      charaInjected = true;
    }

    chunks.push(uint8.slice(offset, chunkEnd));
    offset = chunkEnd;
  }

  // Calculate total length
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let currentOffset = 0;
  for (const chunk of chunks) {
    result.set(chunk, currentOffset);
    currentOffset += chunk.length;
  }

  return result.buffer;
}

// 纯 JSON 导入的角色卡本来就没有底图 —— 推送/写入酒馆需要一张真实 PNG 才能
// 往里面塞数据。这里现场画一张简单的占位图当底图用，而不是直接拒绝推送。
export async function generatePlaceholderAvatarPng(name: string): Promise<ArrayBuffer> {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建占位头像画布');

  const palette = ['#8b5cf6', '#6366f1', '#ec4899', '#0ea5e9', '#14b8a6', '#f59e0b'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  ctx.fillStyle = palette[hash % palette.length];
  ctx.fillRect(0, 0, 512, 512);

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = 'bold 240px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((name || '?').trim().charAt(0) || '?', 256, 276);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('生成占位头像失败'))), 'image/png');
  });
  return blob.arrayBuffer();
}
