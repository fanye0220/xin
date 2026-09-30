/**
 * 把一条消息拆成「Markdown 文本段」和「HTML 组件段（状态栏/选项卡等）」。
 *
 * 旧实现用一个懒惰正则 `<style>…</style>\s*<tag>[\s\S]*?</任意标签>` 来切，
 * 遇到嵌套的 <div> 会在第一个 `</span>` / `</div>` 处截断，
 * 剩下的半截 HTML 被丢给 Markdown，状态栏就「漏」了。
 * 这里改成按标签配对（深度计数）来找结束位置。
 */

export interface Segment {
  type: 'md' | 'html';
  content: string;
}

const VOID_TAGS = new Set([
  'br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr',
]);

// 只有带 class/style/id 的这些块级标签才当作"组件"处理
const WIDGET_BLOCK_TAGS = 'div|section|main|article|table|center|template|body|aside|form';

const FENCE_WIDGET_HINT =
  /<(?:!DOCTYPE\s+html|html|body|style|script|div|section|main|article|template|svg|table|center)\b/i;

/** 找到与 start 处开标签配对的闭标签末尾；找不到返回 -1 */
function balancedEnd(src: string, start: number, tag: string): number {
  // script/style/注释整体跳过，避免里面的字符串 "<div>" 干扰计数
  const re = new RegExp(
    `<!--[\\s\\S]*?-->|<(script|style)\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>|<(\\/?)${tag}\\b[^>]*?(\\/?)>`,
    'gi'
  );
  re.lastIndex = start;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[0].startsWith('<!--') || m[1]) continue;
    if (m[2]) depth--;
    else if (!m[3]) depth++;
    if (depth === 0) return re.lastIndex;
  }
  return -1;
}

/** 从 start 开始，跳过 <style>/<script>，返回结束位置；没闭合就到文本末尾 */
function rawTextEnd(src: string, start: number, tag: 'style' | 'script'): number {
  const re = new RegExp(`<\\/${tag}\\s*>`, 'i');
  const m = re.exec(src.slice(start));
  return m ? start + m.index + m[0].length : src.length;
}

/**
 * 组件结束后，把紧跟着的 <style>/<script>（以及可选的后续 HTML 元素）一起并进来，
 * 这样「样式 + 结构 + 脚本」会落在同一个 iframe 里。
 */
function extendGroup(src: string, end: number, allowElements: boolean): number {
  let pos = end;
  for (;;) {
    const rest = src.slice(pos);
    const ws = rest.match(/^\s*/)![0].length;
    const at = pos + ws;
    const head = src.slice(at, at + 40);

    let m: RegExpMatchArray | null;
    if ((m = head.match(/^<(style|script)\b/i))) {
      pos = rawTextEnd(src, at, m[1].toLowerCase() as 'style' | 'script');
      continue;
    }
    if (allowElements && (m = head.match(/^<([a-zA-Z][\w-]*)\b/)) && !VOID_TAGS.has(m[1].toLowerCase())) {
      const e = balancedEnd(src, at, m[1]);
      if (e === -1) break;
      pos = e;
      continue;
    }
    if (allowElements && head.startsWith('<!--')) {
      const e = src.indexOf('-->', at);
      if (e === -1) break;
      pos = e + 3;
      continue;
    }
    break;
  }
  return pos;
}

/** 处理不含代码围栏的普通文本 */
function splitPlain(text: string, out: Segment[]) {
  const pushMd = (s: string) => {
    if (s.trim()) out.push({ type: 'md', content: s });
  };

  const openRe = new RegExp(
    `<(?:!DOCTYPE\\b[^>]*>|(html)\\b[^>]*>|(style)\\b[^>]*>|(script)\\b[^>]*>|(${WIDGET_BLOCK_TAGS})\\b[^>]*>)`,
    'gi'
  );

  let mdStart = 0;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(text))) {
    const s = m.index;

    // 行内反引号里的标签（`<div class=..>`）不算
    const lineStart = text.lastIndexOf('\n', s - 1) + 1;
    const backticks = (text.slice(lineStart, s).match(/`/g) || []).length;
    if (backticks % 2 === 1) continue;

    let end: number;
    if (m[2]) {
      end = extendGroup(text, rawTextEnd(text, s, 'style'), true);
    } else if (m[3]) {
      end = extendGroup(text, rawTextEnd(text, s, 'script'), true);
    } else if (m[4]) {
      // 普通块级标签：必须带 class/style/id 且有一定长度才当组件
      if (!/\b(?:class|style|id)\s*=/i.test(m[0])) continue;
      const e = balancedEnd(text, s, m[4]);
      end = e === -1 ? text.length : e;
      if (end - s <= 50) continue;
      end = extendGroup(text, end, false);
    } else {
      // <!DOCTYPE> / <html>
      const cm = /<\/html\s*>/i.exec(text.slice(s));
      end = cm ? s + cm.index + cm[0].length : text.length;
    }

    pushMd(text.slice(mdStart, s));
    out.push({ type: 'html', content: text.slice(s, end) });
    mdStart = end;
    openRe.lastIndex = end;
  }
  pushMd(text.slice(mdStart));
}

export function splitHtmlSegments(content: string): Segment[] {
  if (!content) return [];
  const out: Segment[] = [];

  // 第一遍：代码围栏。```html 里含组件标记的 → iframe；其它围栏保持为 Markdown 代码块
  const fenceRe = /^[ \t]*(`{3,}|~{3,})[ \t]*([\w-]*)[ \t]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gm;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(content))) {
    if (m.index > last) splitPlain(content.slice(last, m.index), out);
    const lang = (m[2] || '').toLowerCase();
    const inner = m[3];
    if (['', 'html', 'htm', 'xml'].includes(lang) && FENCE_WIDGET_HINT.test(inner)) {
      out.push({ type: 'html', content: inner });
    } else {
      out.push({ type: 'md', content: m[0] });
    }
    last = fenceRe.lastIndex;
  }
  if (last < content.length) splitPlain(content.slice(last), out);

  return out.length > 0 ? out : [{ type: 'md', content }];
}
