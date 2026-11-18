/**
 * 卡片「来源」链接整理
 * ------------------------------------------------------------------
 * 卡片里存的 source 五花八门：
 *   - https://example.com/page   （标准）
 *   - example.com/page           （没带协议，直接当 href 会被浏览器当成当前页的相对地址）
 *   - ` https://a.b/c 。`        （从聊天/文档里粘过来的，带包裹符号和中文句号）
 *   - 朋友给的 / 无 / null        （根本不是链接）
 * 这里统一整理成「能点的干净链接」；整理不出来就返回空串，由调用方按普通文字处理。
 */

/** 这些协议不给点：要么是脚本、要么是本地文件，点开没意义还有风险 */
const BLOCKED_SCHEME = /^(javascript|data|vbscript|file|blob|about|chrome):/i;
/** 占位词 / 空值写法，一律当"没有来源" */
const PLACEHOLDER = /^(无|无来源|未填写|未填|空|暂无|none|null|undefined|n\/a|na|—|-|\.|……|\.\.\.)$/i;

/** host 像不像一个域名 / IP / localhost */
function looksLikeHost(host: string): boolean {
  if (!host) return false;
  if (/^localhost(:\d+)?$/i.test(host)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host)) return true;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(?::\d+)?$/i.test(host);
}

function safeUrl(candidate: string): string {
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (!u.hostname) return '';
    // 返回原字符串而不是 u.toString()：中文路径不会被转成 %E4%B8%AD 那种乱码，显示更好看
    return candidate;
  } catch {
    return '';
  }
}

/**
 * 把来源字符串整理成能点的链接；整理不出来返回 ''（表示"这不是个链接"）。
 */
export function normalizeSourceUrl(raw?: string | null): string {
  if (raw === null || raw === undefined) return '';
  let s = String(raw);

  // 零宽字符 / 换行 / 制表符：粘贴过来时最常见
  s = s.replace(/[\u200b-\u200f\u2028\u2029\ufeff]/g, '');
  s = s.replace(/[\r\n\t]+/g, ' ').trim();
  if (!s) return '';

  // 去掉包裹用的括号、引号、书名号等
  s = s.replace(/^[<\u3008\u300a\u300c\u300e\u3010\u3014"'`\[({]+/, '');
  s = s.replace(/[>\u3009\u300b\u300d\u300f\u3011\u3015"'`\])}]+$/, '');
  // 中文句末标点经常被一起复制进来
  s = s.replace(/[。，,；;、]+$/, '').trim();
  if (!s) return '';
  if (PLACEHOLDER.test(s)) return '';
  if (BLOCKED_SCHEME.test(s)) return '';

  // mailto: / tel: 这类不是网页链接，来源栏里点了没意义，当普通文字处理
  if (/^(mailto|tel|sms|ftp|magnet|intent):/i.test(s)) return '';

  // 已经写了协议：去掉中间可能混进来的空格/中文标点再校验一次
  if (/^https?:\/\//i.test(s)) {
    const cleaned = s.replace(/\s+/g, '');
    return safeUrl(cleaned);
  }

  // 协议相对写法 //example.com/path
  if (s.startsWith('//')) {
    return safeUrl('https:' + s.replace(/\s+/g, ''));
  }

  // 剩下只有在"看起来像域名"时才自动补 https://，
  // 免得把「朋友给的」这种一句话也拼成 https://朋友给的 变成个假链接
  const noSpace = s.replace(/\s+/g, '');
  const host = noSpace.split(/[/?#]/)[0];
  if (!looksLikeHost(host)) return '';
  return safeUrl('https://' + noSpace);
}

export default normalizeSourceUrl;
