/**
 * 把一条消息拆成「Markdown 文本段」和「HTML 组件段（状态栏/选项卡/前端面板等）」。
 *
 * 按标签配对（深度计数）查找闭合位置，并将相邻的样式/结构/脚本合并进同一个 iframe，
 * 避免 `<div id="app"></div><script>...</script>` 等 Vue / JS-Slash-Runner 面板被拆散或截断。
 */

export interface Segment {
  type: 'md' | 'html';
  content: string;
}

const VOID_TAGS = new Set([
  'br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr',
]);

const WIDGET_BLOCK_TAGS = 'div|section|main|article|table|center|template|body|aside|form|details';

const FENCE_WIDGET_HINT =
  /<(?:!DOCTYPE\s+html|html|body|style|script|div|section|main|article|template|svg|table|center|details)\b/i;

const FENCE_WIDGET_STRONG_HEAD =
  /^(?:<!DOCTYPE\s+html|<html\b|<body\b|<head\b|<style\b|<script\b|<svg\b|<(?:div|section|main|article|aside|form|table|center|template|details)\b[^>]*\b(?:class|style|id)\s*=)/i;

const HTML_FENCE_LANGS = new Set(['html', 'htm', 'hmtl', 'htlm', 'xhtml', 'xml', 'svg', 'html5']);
const NEUTRAL_FENCE_LANGS = new Set(['', 'text', 'txt', 'plaintext']);
const EXPLICIT_CODE_LANGS = new Set([
  'js', 'javascript', 'ts', 'typescript', 'jsx', 'tsx', 'mjs', 'cjs',
  'css', 'scss', 'sass', 'less', 'json', 'jsonc', 'yaml', 'yml', 'toml',
  'md', 'markdown', 'py', 'python', 'bash', 'sh', 'zsh', 'powershell', 'ps1',
  'sql', 'c', 'cpp', 'h', 'hpp', 'java', 'kt', 'swift', 'go', 'rs', 'rust',
  'php', 'rb', 'ruby', 'diff', 'patch', 'ini', 'conf', 'log',
]);

function fenceLooksLikeWidget(inner: string, strict: boolean): boolean {
  if (!strict) return FENCE_WIDGET_HINT.test(inner);
  const head = inner.replace(/^(?:\s|<!--[\s\S]*?-->)*/, '');
  return FENCE_WIDGET_STRONG_HEAD.test(head);
}

/** 找到与 start 处开标签配对的闭标签末尾；找不到返回 -1 */
function balancedEnd(src: string, start: number, tag: string): number {
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
 * 组件结束后，把紧跟着的 <style>/<script>/<link>（以及同级组件元素）一起并进来，
 * 确保「样式 + 挂载点 + DOM 结构 + 脚本」完整落在同一个 iframe 里。
 */
function extendGroup(src: string, end: number, allowWidgetElements: boolean): number {
  let pos = end;
  for (;;) {
    const rest = src.slice(pos);
    const ws = rest.match(/^\s*/)![0].length;
    const at = pos + ws;
    const head = src.slice(at, at + 160);

    let m: RegExpMatchArray | null;
    if ((m = head.match(/^<(style|script)\b/i))) {
      pos = rawTextEnd(src, at, m[1].toLowerCase() as 'style' | 'script');
      continue;
    }
    if ((m = head.match(/^<link\b[^>]*>/i))) {
      pos = at + m[0].length;
      continue;
    }
    if (head.startsWith('<!--')) {
      const e = src.indexOf('-->', at);
      if (e === -1) break;
      pos = e + 3;
      continue;
    }
    if (allowWidgetElements && (m = head.match(/^<([a-zA-Z][\w-]*)\b[^>]*>/)) && !VOID_TAGS.has(m[1].toLowerCase())) {
      const tag = m[1].toLowerCase();
      // 仅合并具结构属性或组件容器标签，防止把后面的普通 Markdown 段落 <span>/<p> 吞进来
      const isWidgetTag = new RegExp(`^(?:${WIDGET_BLOCK_TAGS}|svg)$`, 'i').test(tag);
      const hasAttrs = /\b(?:class|style|id)\s*=/i.test(m[0]);
      if (isWidgetTag || hasAttrs) {
        const e = balancedEnd(src, at, m[1]);
        if (e === -1) break;
        pos = e;
        continue;
      }
    }
    break;
  }
  return pos;
}

/** 处理不含代码围栏的普通文本 */
function splitPlain(text: string, out: Segment[]) {
  const pushMd = (s: string) => {
    const cleaned = s.replace(/^[ \t]*`{3,}[a-zA-Z0-9_-]*[ \t]*$/gm, '').trim();
    if (cleaned) out.push({ type: 'md', content: cleaned });
  };

  const openRe = new RegExp(
    `<(?:!DOCTYPE\\b[^>]*>|(html)\\b[^>]*>|(style)\\b[^>]*>|(script)\\b[^>]*>|(link)\\b[^>]*rel\\s*=\\s*["']?stylesheet[^>]*>|(${WIDGET_BLOCK_TAGS})\\b[^>]*>)`,
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
      // <link rel="stylesheet"> 仅在紧跟组件/脚本时一起合并
      const afterLink = extendGroup(text, s + m[0].length, true);
      if (afterLink === s + m[0].length) continue;
      end = afterLink;
    } else if (m[5]) {
      const tagName = m[5];
      const isDetails = tagName.toLowerCase() === 'details';

      // 内置的 <think> 思维链折叠框保持在 Markdown 流里渲染
      if (
        isDetails &&
        (/\btavern-think-details\b/i.test(m[0]) ||
          /class\s*=\s*["']text-sm (?:bg-\[rgba|rounded-xl p-3 my-3 border)/i.test(m[0]))
      ) {
        const skipEnd = balancedEnd(text, s, tagName);
        if (skipEnd !== -1) openRe.lastIndex = skipEnd;
        continue;
      }

      const e = balancedEnd(text, s, tagName);
      end = e === -1 ? text.length : e;
      const block = text.slice(s, end);
      const hasAttrs = /\b(?:class|style|id)\s*=/i.test(m[0]);
      const hasEmbeddedCode = /<(?:style|script)\b/i.test(block);
      const trailing = text.slice(end, end + 120);
      const followedByStyleOrScript = /^\s*(?:<!--[\s\S]*?-->\s*)*<(?:style|script|link|svg|div|section|main|article|table|details)\b/i.test(trailing);

      if (isDetails) {
        const hasStyledBody = /<(?:style|script|div|table|section)\b/i.test(block) || /\bstyle\s*=/i.test(block);
        if (!hasAttrs && !hasStyledBody && !followedByStyleOrScript) {
          if (e !== -1) openRe.lastIndex = e;
          continue;
        }
      } else if (!hasAttrs && !hasEmbeddedCode) {
        continue;
      }

      // 修复：<div id="app"></div> 仅 19 字符，若紧跟 <script>/<style>，绝不能跳过！
      if (end - s <= 45 && !hasEmbeddedCode && !followedByStyleOrScript) {
        continue;
      }

      end = extendGroup(text, end, true);
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

  let cleanContent = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\r/g, '\n');
  if (cleanContent.includes('\\n') && !cleanContent.includes('\n')) {
    cleanContent = cleanContent.replace(/\\n/g, '\n');
  }

  const out: Segment[] = [];

  // 第一遍：代码围栏。识别 ```html / ```hmtl 等常见标记与含 HTML 结构的围栏（按内容兜底）
  const fenceRe = /(?:^|\n)[ \t]*(`{3,}|~{3,})[ \t]*([^\n]*)\n([\s\S]*?)\n?[ \t]*\1[ \t]*(?=\n|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(cleanContent))) {
    if (m.index > last) splitPlain(cleanContent.slice(last, m.index), out);
    const rawInfo = (m[2] || '').trim();
    const lang = (rawInfo.split(/\s+/)[0] || '').toLowerCase();
    const inner = m[3];
    const isHtmlLang = HTML_FENCE_LANGS.has(lang);
    const isNeutral = NEUTRAL_FENCE_LANGS.has(lang);
    const isCodeLang = EXPLICIT_CODE_LANGS.has(lang);
    if (
      isHtmlLang ||
      (isNeutral && fenceLooksLikeWidget(inner, lang !== '')) ||
      (!isCodeLang && fenceLooksLikeWidget(inner, true))
    ) {
      out.push({ type: 'html', content: inner });
    } else {
      out.push({ type: 'md', content: m[0] });
    }
    last = fenceRe.lastIndex;
  }
  if (last < cleanContent.length) splitPlain(cleanContent.slice(last), out);

  return out.length > 0 ? out : [{ type: 'md', content: cleanContent }];
}
