/**
 * 文本解码工具（统一入口）
 *
 * 背景：项目里多处需要把"文件/zip 压缩包条目里的原始字节"解码成字符串
 * （角色卡导入、聊天记录导入、聊天记录查看内的导入等）。
 * 之前这些地方各自写了一份几乎一样但不完全一致的解码代码，
 * 容易出现"这里改了、那里没改"导致同样是导入 json/jsonl，
 * 主页导入正常但在别的入口却乱码的问题。
 *
 * 这里统一收口：所有需要把字节转成文本的地方都调用这两个函数，
 * 只维护一份实现，避免行为分叉。
 *
 * 解码策略：优先按严格 UTF-8 解码；如果不是合法 UTF-8
 * （常见于旧版酒馆在 Windows 上用 GBK/ANSI 编码导出的中文聊天记录/角色卡），
 * 回退到 GBK 解码。
 */

/** 将原始字节解码为字符串：UTF-8 优先，失败回退 GBK。 */
export function decodeTextBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (e) {
    return new TextDecoder("gbk").decode(bytes);
  }
}

/** 读取一个 File/Blob 对象的文本内容：UTF-8 优先，失败回退 GBK。 */
export async function readFileTextWithFallback(
  file: File | Blob,
): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  return decodeTextBytes(buf);
}

/** 读取一个 JSZip 条目（zipEntry）的文本内容：UTF-8 优先，失败回退 GBK。 */
export async function readZipEntryTextWithFallback(zipEntry: {
  async: (type: "arraybuffer") => Promise<ArrayBuffer>;
}): Promise<string> {
  const buf = new Uint8Array(await zipEntry.async("arraybuffer"));
  return decodeTextBytes(buf);
}

/**
 * JSZip 的 decodeFileName 回调专用：解码 zip 内文件名（标题）。
 * 用法：JSZip.loadAsync(f, { decodeFileName: decodeZipEntryFileName })
 */
export function decodeZipEntryFileName(bytes: any): string {
  return decodeTextBytes(new Uint8Array(bytes));
}
