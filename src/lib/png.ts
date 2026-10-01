/**
 * Comprehensive Image & Metadata Parser for SillyTavern / TavernHelper / Chub / RisuAI Character Cards
 * Supports PNG (tEXt, zTXt, iTXt), WebP (RIFF/EXIF/XMP/USER), JPEG (APP1/Exif/Comment), and universal stream fallback.
 */

async function decompressBuffer(data: Uint8Array): Promise<Uint8Array | null> {
  if (!data || data.length === 0) return null;

  // 1. Try standard 'deflate' (zlib format with header and checksum)
  try {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    writer.write(data);
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
    return decompressed;
  } catch (e) {
    // 2. Try 'deflate-raw' (raw DEFLATE stream without zlib header)
    try {
      const rawData = data.length > 6 ? data.slice(2, data.length - 4) : data;
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(rawData);
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
      return decompressed;
    } catch (e2) {
      // 3. Try raw stream directly with deflate-raw
      try {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        writer.write(data);
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
        return decompressed;
      } catch (e3) {
        return null;
      }
    }
  }
}

/**
 * Robust JSON & Base64 Payload Parser
 */
export function parsePayload(payload: string): any | null {
  if (!payload || typeof payload !== 'string') return null;
  let trimmed = payload.trim();
  if (!trimmed) return null;

  // Strip Unicode BOM if present
  if (trimmed.charCodeAt(0) === 0xfeff) {
    trimmed = trimmed.slice(1).trim();
  }

  // Remove common prefix if embedded as data-url
  if (trimmed.startsWith('data:application/json;base64,')) {
    trimmed = trimmed.slice('data:application/json;base64,'.length).trim();
  } else if (trimmed.startsWith('data:text/plain;base64,')) {
    trimmed = trimmed.slice('data:text/plain;base64,'.length).trim();
  }

  const isValidCard = (obj: any): boolean => {
    if (!obj || typeof obj !== 'object') return false;
    if (obj.spec === 'chara_card_v2' || obj.spec === 'chara_card_v3' || obj.spec === 'chara_card_v1') return true;
    if (obj.name || obj.char_name || obj.character_name) return true;
    if (obj.data && (obj.data.name || obj.data.char_name || obj.data.character_name || obj.data.first_mes || obj.data.description)) return true;
    if (obj.first_mes || obj.description || obj.scenario || obj.personality || obj.personality_summary) return true;
    return false;
  };

  const tryJsonParse = (str: string): any | null => {
    try {
      const obj = JSON.parse(str);
      if (isValidCard(obj)) return obj;
      if (obj && typeof obj === 'object') return obj;
    } catch (e) {
      // Try fixing trailing commas before } or ]
      try {
        const cleaned = str.replace(/,\s*([\}\]])/g, '$1');
        const obj = JSON.parse(cleaned);
        if (isValidCard(obj)) return obj;
      } catch (e2) {}
    }
    return null;
  };

  // 1. Direct JSON check
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    const res = tryJsonParse(trimmed);
    if (res) return res;
  }

  // 2. Base64 UTF-8 decode
  try {
    let cleanB64 = trimmed.replace(/[\r\n\s]/g, '').replace(/-/g, '+').replace(/_/g, '/');
    // Fix missing padding
    while (cleanB64.length % 4 !== 0) {
      cleanB64 += '=';
    }
    const binString = atob(cleanB64);
    const bytes = Uint8Array.from(binString, (m) => m.codePointAt(0)!);
    const jsonString = new TextDecoder('utf-8').decode(bytes);
    const res = tryJsonParse(jsonString);
    if (res) return res;
  } catch (e) {}

  // 3. Fallback URL encoded or escaped Base64
  try {
    let cleanB64 = trimmed.replace(/[\r\n\s]/g, '').replace(/-/g, '+').replace(/_/g, '/');
    while (cleanB64.length % 4 !== 0) cleanB64 += '=';
    const jsonString = decodeURIComponent(escape(atob(cleanB64)));
    const res = tryJsonParse(jsonString);
    if (res) return res;
  } catch (e2) {}

  // 4. Fallback decodeURIComponent directly
  try {
    const decoded = decodeURIComponent(trimmed);
    const res = tryJsonParse(decoded);
    if (res) return res;
  } catch (e3) {}

  // 5. Embedded JSON search inside string (e.g. if surrounded by other metadata)
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const slice = trimmed.slice(firstBrace, lastBrace + 1);
    const res = tryJsonParse(slice);
    if (res) return res;
  }

  return null;
}

/**
 * Universal Image Metadata Extractor
 * Extracts Character Card data from PNG, WebP, JPEG or fallback stream.
 */
export async function extractTavernData(buffer: ArrayBuffer): Promise<any | null> {
  if (!buffer || buffer.byteLength < 12) return null;

  const uint8 = new Uint8Array(buffer);
  const dataView = new DataView(buffer);

  // -------------------------------------------------------------
  // A. PNG Format Handling (Signature: 89 50 4E 47 0D 0A 1A 0A)
  // -------------------------------------------------------------
  if (
    uint8[0] === 0x89 &&
    uint8[1] === 0x50 &&
    uint8[2] === 0x4e &&
    uint8[3] === 0x47 &&
    uint8[4] === 0x0d &&
    uint8[5] === 0x0a &&
    uint8[6] === 0x1a &&
    uint8[7] === 0x0a
  ) {
    const rawPayloads: Record<string, string> = {};

    const decodeChunkPayload = async (
      type: string,
      data: Uint8Array
    ): Promise<{ keyword: string; payload: string } | null> => {
      const lowerType = type.toLowerCase();
      if (lowerType === 'text') {
        let nullIdx = 0;
        while (nullIdx < data.length && data[nullIdx] !== 0) {
          nullIdx++;
        }
        if (nullIdx >= data.length) return null;
        const keyword = new TextDecoder('utf-8').decode(data.slice(0, nullIdx)).trim().toLowerCase();
        const textData = data.slice(nullIdx + 1);
        const payload = new TextDecoder('utf-8').decode(textData);
        return { keyword, payload };
      } else if (lowerType === 'ztxt') {
        let nullIdx = 0;
        while (nullIdx < data.length && data[nullIdx] !== 0) {
          nullIdx++;
        }
        if (nullIdx >= data.length) return null;
        const keyword = new TextDecoder('utf-8').decode(data.slice(0, nullIdx)).trim().toLowerCase();
        const compressedData = data.slice(nullIdx + 2);
        const decompressed = await decompressBuffer(compressedData);
        if (decompressed) {
          const payload = new TextDecoder('utf-8').decode(decompressed);
          return { keyword, payload };
        }
        return null;
      } else if (lowerType === 'itxt') {
        let nullIdx = 0;
        while (nullIdx < data.length && data[nullIdx] !== 0) {
          nullIdx++;
        }
        if (nullIdx >= data.length) return null;
        const keyword = new TextDecoder('utf-8').decode(data.slice(0, nullIdx)).trim().toLowerCase();
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
        } else {
          const decompressed = await decompressBuffer(textData);
          if (decompressed) {
            return { keyword, payload: new TextDecoder('utf-8').decode(decompressed) };
          }
        }
      }
      return null;
    };

    let offset = 8;
    while (offset < buffer.byteLength - 8) {
      const length = dataView.getUint32(offset);
      const type = String.fromCharCode(
        uint8[offset + 4],
        uint8[offset + 5],
        uint8[offset + 6],
        uint8[offset + 7]
      );

      const dataOffset = offset + 8;
      if (dataOffset + length <= buffer.byteLength) {
        const data = uint8.slice(dataOffset, dataOffset + length);
        const lowerType = type.toLowerCase();
        if (lowerType === 'text' || lowerType === 'itxt' || lowerType === 'ztxt') {
          try {
            const result = await decodeChunkPayload(type, data);
            if (result && result.payload) {
              rawPayloads[result.keyword] = result.payload;
            }
          } catch (e) {}
        }
      }

      offset += 8 + length + 4;
      if (type === 'IEND') break;
    }

    const priorityKeywords = [
      'ccv3',
      'chara',
      'character',
      'sillytavern',
      'tavern',
      'tavernhelper',
      'risuai',
      'risu',
      'chub',
      'description',
      'comment',
    ];

    for (const kw of priorityKeywords) {
      if (rawPayloads[kw]) {
        const parsed = parsePayload(rawPayloads[kw]);
        if (parsed && (parsed.name || parsed.data?.name || parsed.spec || parsed.char_name || parsed.description)) {
          return parsed;
        }
      }
    }

    for (const kw of Object.keys(rawPayloads)) {
      const parsed = parsePayload(rawPayloads[kw]);
      if (parsed && (parsed.name || parsed.data?.name || parsed.spec || parsed.char_name || parsed.description)) {
        return parsed;
      }
    }
  }

  // -------------------------------------------------------------
  // B. WebP Format Handling (RIFF .... WEBP)
  // -------------------------------------------------------------
  if (
    uint8[0] === 0x52 &&
    uint8[1] === 0x49 &&
    uint8[2] === 0x46 &&
    uint8[3] === 0x46 &&
    uint8[8] === 0x57 &&
    uint8[9] === 0x45 &&
    uint8[10] === 0x42 &&
    uint8[11] === 0x50
  ) {
    let offset = 12;
    while (offset < buffer.byteLength - 8) {
      const fourCC = String.fromCharCode(
        uint8[offset],
        uint8[offset + 1],
        uint8[offset + 2],
        uint8[offset + 3]
      );
      const chunkSize = dataView.getUint32(offset + 4, true); // little-endian
      const chunkDataOffset = offset + 8;

      if (chunkDataOffset + chunkSize <= buffer.byteLength) {
        const chunkData = uint8.slice(chunkDataOffset, chunkDataOffset + chunkSize);
        const text = new TextDecoder('utf-8').decode(chunkData);

        // Check if chunk is EXIF, XMP, USER, or TEXT
        if (fourCC.trim() === 'EXIF' || fourCC.trim() === 'XMP' || fourCC.trim() === 'USER' || fourCC.trim() === 'JSON') {
          const parsed = parsePayload(text);
          if (parsed && (parsed.name || parsed.data?.name || parsed.spec || parsed.char_name)) {
            return parsed;
          }
        }

        // Try parsing any chunk that might contain JSON
        if (text.includes('chara_card_') || text.includes('"first_mes"') || text.includes('"personality"') || text.includes('"name"')) {
          const parsed = parsePayload(text);
          if (parsed && (parsed.name || parsed.data?.name || parsed.spec || parsed.char_name)) {
            return parsed;
          }
        }
      }

      // WebP chunks are padded to even 2-byte alignment
      offset += 8 + chunkSize + (chunkSize % 2);
    }
  }

  // -------------------------------------------------------------
  // C. Universal Binary Fallback Scanner
  // Scans for embedded UTF-8 JSON or Base64 sequences in any file buffer
  // -------------------------------------------------------------
  try {
    const fullText = new TextDecoder('utf-8', { fatal: false }).decode(uint8);

    // 1. Search for chara_card_v2 or v3 spec
    const specIdx = fullText.indexOf('chara_card_');
    if (specIdx !== -1) {
      const start = fullText.lastIndexOf('{', specIdx);
      if (start !== -1) {
        const parsed = parsePayload(fullText.slice(start));
        if (parsed) return parsed;
      }
    }

    // 2. Search for "first_mes" or "char_persona"
    const firstMesIdx = fullText.indexOf('"first_mes"');
    if (firstMesIdx !== -1) {
      const start = fullText.lastIndexOf('{', firstMesIdx);
      if (start !== -1) {
        const parsed = parsePayload(fullText.slice(start));
        if (parsed) return parsed;
      }
    }

    // 3. Search for Base64 starting with 'eyJ' (which encodes '{"')
    const b64Regex = /eyJ[A-Za-z0-9+/=_-]{40,}/g;
    let match;
    while ((match = b64Regex.exec(fullText)) !== null) {
      const parsed = parsePayload(match[0]);
      if (parsed && (parsed.name || parsed.data?.name || parsed.spec || parsed.char_name)) {
        return parsed;
      }
    }
  } catch (e) {}

  return null;
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
      const keyword = new TextDecoder('utf-8').decode(dataSlice.slice(0, nullIdx)).toLowerCase();
      
      if (keyword === 'chara' || keyword === 'ccv3') {
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

  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let currentOffset = 0;
  for (const chunk of chunks) {
    result.set(chunk, currentOffset);
    currentOffset += chunk.length;
  }

  return result.buffer;
}

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
