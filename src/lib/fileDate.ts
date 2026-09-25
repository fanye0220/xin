/**
 * Utilities for extracting authentic file timestamps (creation and modification dates)
 * from character cards, embedded PNG chunks (tIME, eXIf), EXIF metadata, ZIP entry timestamps,
 * and SillyTavern / CCV2 / CCV3 metadata.
 */

export function parseDateValue(val: any): number | null {
  if (!val) return null;
  if (typeof val === 'number') {
    if (isNaN(val) || val <= 0) return null;
    // Unix timestamp in seconds (e.g. 1734080760 is in Dec 2024 / 2025)
    if (val > 1000000000 && val < 10000000000) {
      return val * 1000;
    }
    // Unix timestamp in ms
    if (val >= 10000000000) {
      return val;
    }
    return null;
  }
  if (typeof val === 'string') {
    const s = val.trim();
    if (!s) return null;
    // Check if numeric string
    if (/^\d{10,13}$/.test(s)) {
      const num = Number(s);
      return parseDateValue(num);
    }
    // Check format like '2025-12-13 17:06:00' or '2025/12/13 17:06:00' or '25-12-13 17:06'
    let norm = s.replace(/\./g, '-').replace(/\//g, '-');
    // If format is like '25-12-13 17:06' (2-digit year)
    if (/^(\d{2})-(\d{2})-(\d{2})/.test(norm)) {
      norm = '20' + norm;
    }
    const parsed = Date.parse(norm);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

export function extractDateFromCardData(data: any): number | null {
  if (!data) return null;
  const candidates = [
    data.modification_date,
    data.data?.modification_date,
    data.create_date,
    data.data?.create_date,
    data.created_at,
    data.data?.created_at,
    data.updated_at,
    data.data?.updated_at,
    data.date,
    data.data?.date,
    data.character_book?.date,
    data.data?.character_book?.date,
    data.extensions?.create_date,
    data.data?.extensions?.create_date,
    data.extensions?.modification_date,
    data.data?.extensions?.modification_date,
  ];

  for (const c of candidates) {
    const parsed = parseDateValue(c);
    if (parsed && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

export function extractImageTimestamp(buffer: ArrayBuffer): number | null {
  if (!buffer || buffer.byteLength < 16) return null;

  try {
    const dataView = new DataView(buffer);
    const uint8 = new Uint8Array(buffer);

    // 1. Check if PNG
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
      let offset = 8;
      let timeChunkDate: number | null = null;
      let exifDate: number | null = null;

      while (offset + 8 <= buffer.byteLength) {
        const length = dataView.getUint32(offset);
        const type = String.fromCharCode(
          uint8[offset + 4],
          uint8[offset + 5],
          uint8[offset + 6],
          uint8[offset + 7]
        );

        const dataOffset = offset + 8;
        if (dataOffset + length > buffer.byteLength) break;

        if (type === 'tIME' && length >= 7) {
          const year = dataView.getUint16(dataOffset);
          const month = dataView.getUint8(dataOffset + 2);
          const day = dataView.getUint8(dataOffset + 3);
          const hour = dataView.getUint8(dataOffset + 4);
          const minute = dataView.getUint8(dataOffset + 5);
          const second = dataView.getUint8(dataOffset + 6);
          // Month is 1-12 in PNG specification
          if (year >= 1990 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            timeChunkDate = Date.UTC(year, month - 1, day, hour, minute, Math.min(second, 59));
          }
        } else if (type === 'eXIf' && length > 14) {
          const exifSlice = uint8.slice(dataOffset, dataOffset + length);
          const str = new TextDecoder('latin1').decode(exifSlice);
          const match = str.match(/\b(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})\b/);
          if (match) {
            const y = parseInt(match[1], 10);
            const m = parseInt(match[2], 10);
            const d = parseInt(match[3], 10);
            const h = parseInt(match[4], 10);
            const min = parseInt(match[5], 10);
            const s = parseInt(match[6], 10);
            const parsed = new Date(y, m - 1, d, h, min, s).getTime();
            if (!isNaN(parsed) && parsed > 0) {
              exifDate = parsed;
            }
          }
        }

        offset += 8 + length + 4;
      }

      if (timeChunkDate) return timeChunkDate;
      if (exifDate) return exifDate;
    }

    // 2. Check if JPEG (starts with 0xFF, 0xD8)
    if (uint8[0] === 0xff && uint8[1] === 0xd8) {
      // Scan the first 64KB for standard EXIF date format
      const scanLimit = Math.min(buffer.byteLength, 65536);
      const str = new TextDecoder('latin1').decode(uint8.slice(0, scanLimit));
      const match = str.match(/\b(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})\b/);
      if (match) {
        const y = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        const d = parseInt(match[3], 10);
        const h = parseInt(match[4], 10);
        const min = parseInt(match[5], 10);
        const s = parseInt(match[6], 10);
        const parsed = new Date(y, m - 1, d, h, min, s).getTime();
        if (!isNaN(parsed) && parsed > 0) {
          return parsed;
        }
      }
    }
  } catch (e) {
    // Ignore buffer inspection errors
  }

  return null;
}

export function resolveCharacterModifiedTime(
  char: any,
  imageBuffer?: ArrayBuffer | null
): number | null {
  if (!char) return null;

  if (char.fileModifiedAt) {
    return char.fileModifiedAt;
  }

  // 1. Embedded card metadata
  const embedded = extractDateFromCardData(char.data);

  // 2. Buffer inspection (PNG tIME / EXIF)
  let imgTime: number | null = null;
  if (imageBuffer) {
    imgTime = extractImageTimestamp(imageBuffer);
  }

  // 3. File object lastModified
  const fileTime = char.originalFile?.lastModified;

  // Determine if fileTime is suspiciously fresh (e.g. Android SAF picker copied the file to cache during import)
  const isSuspicious = fileTime && char.createdAt && Math.abs(fileTime - char.createdAt) < 90000;

  if (imgTime && (!fileTime || isSuspicious || imgTime < fileTime)) {
    return imgTime;
  }

  if (embedded && (!fileTime || isSuspicious || embedded < fileTime)) {
    return embedded;
  }

  if (fileTime && !isSuspicious) {
    return fileTime;
  }

  return embedded || imgTime || fileTime || null;
}
