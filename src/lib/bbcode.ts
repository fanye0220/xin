/**
 * Comprehensive BBCode & Link Parser for SillyTavern / TavernAI Character Cards
 * Converts BBCode syntax, Markdown links, and autolinks into structured tokens or safe HTML.
 */

export interface BBCodeOptions {
  charName?: string;
  userName?: string;
  isPreview?: boolean;
}

/**
 * Sanitizes and validates a URL to prevent javascript: or unsafe schemes
 */
export function sanitizeUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  const trimmed = rawUrl.trim();
  const clean = trimmed.replace(/^["'<(]+|[>"')]+$/g, '');
  if (/^(https?:\/\/|mailto:|tel:|\/|#|\.?\/|data:image\/)/i.test(clean)) {
    return clean;
  }
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/.*)?$/i.test(clean)) {
    return `https://${clean}`;
  }
  return clean;
}

/**
 * Validates CSS color strings
 */
export function sanitizeColor(colorStr?: string): string | undefined {
  if (!colorStr) return undefined;
  const c = colorStr.trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) return c;
  if (/^(rgb|rgba|hsl|hsla)\([0-9\s,%./]+\)$/i.test(c)) return c;
  const validNamed = [
    'red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'gray', 'grey',
    'white', 'black', 'cyan', 'magenta', 'lime', 'teal', 'indigo', 'violet',
    'gold', 'silver', 'crimson', 'coral', 'khaki', 'plum', 'salmon', 'turquoise',
    'navy', 'maroon', 'olive', 'aqua', 'fuchsia', 'skyblue', 'deepskyblue',
    'violet', 'amber', 'emerald', 'rose', 'slate', 'zinc'
  ];
  if (validNamed.includes(c)) return c;
  return undefined;
}

/**
 * Validates CSS font size strings
 */
export function sanitizeSize(sizeStr?: string): string | undefined {
  if (!sizeStr) return undefined;
  const s = sizeStr.trim().toLowerCase();
  if (/^\d{1,2}(px|pt|em|rem|%)?$/.test(s)) {
    return /^\d+$/.test(s) ? `${s}px` : s;
  }
  const sizeMap: Record<string, string> = {
    '1': '10px',
    '2': '12px',
    '3': '14px',
    '4': '16px',
    '5': '18px',
    '6': '24px',
    '7': '32px',
    'xx-small': '9px',
    'x-small': '10px',
    'small': '12px',
    'medium': '14px',
    'large': '18px',
    'x-large': '24px',
    'xx-large': '32px',
    'smallish': '13px',
  };
  return sizeMap[s] || undefined;
}

/**
 * Extracts a human-readable text preview for card preview / snippet list
 * Strips code wrappers, <style>, <script>, and HTML markup safely.
 */
export function cleanPreviewSnippet(rawText: string, options: BBCodeOptions = {}): string {
  if (!rawText) return '';
  let text = rawText;

  // 1. Strip hidden reasoning / think tags / comments
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  text = text.replace(/\{\{reasoning\}\}[\s\S]*?\{\{\/reasoning\}\}/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // 2. Strip <style> and <script> blocks completely
  text = text.replace(/<style[\s\S]*?<\/style\s*>/gi, ' ');
  text = text.replace(/<script[\s\S]*?<\/script\s*>/gi, ' ');

  // 3. Unwrap code fences like ```html ... ```
  text = text.replace(/^```[a-zA-Z0-9_-]*\s*\n?/gi, '');
  text = text.replace(/\n?```\s*$/g, '');
  text = text.replace(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```/g, '$1');

  // 4. Replace macros with natural names
  const cName = options.charName || '角色';
  const uName = options.userName || '你';
  text = text.replace(/\{\{char\}\}|<BOT>|<CHAR>/gi, cName);
  text = text.replace(/\{\{user\}\}|<USER>/gi, uName);

  // 5. Convert BBCode links & formatting to plain text
  text = text.replace(/\[url=(.*?)\]([\s\S]*?)\[\/url\]/gi, '$2');
  text = text.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '$1');
  text = text.replace(/\[link=(.*?)\]([\s\S]*?)\[\/link\]/gi, '$2');
  text = text.replace(/\[link\]([\s\S]*?)\[\/link\]/gi, '$1');
  text = text.replace(/\[([^\]]+)\]\((?:https?:\/\/|\/)[^\s\)]+\)/gi, '$1');
  text = text.replace(/\[(?:b|i|u|s|del|strike|sub|sup|center|right|code|quote|spoiler|hr)(?:=[^\]]*)?\]/gi, '');
  text = text.replace(/\[\/(?:b|i|u|s|del|strike|sub|sup|center|right|code|quote|spoiler|hr|color|size|bg|align)\]/gi, '');
  text = text.replace(/\[(?:color|size|bg|align|img)(?:=[^\]]*)?\]/gi, '');

  // 6. Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // 7. Unescape HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');

  // 8. Normalize multiple newlines and spaces
  text = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

  if (!text) {
    return rawText.includes('<') || rawText.includes('```') ? '[HTML 富媒体组件 / 交互卡片]' : '暂无文字内容';
  }

  return text;
}

/**
 * Transforms raw card text with BBCode and Markdown syntax into sanitized HTML
 */
export function bbcodeToHtml(rawText: string, options: BBCodeOptions = {}): string {
  if (!rawText) return '';

  let text = rawText;

  // 1. Unwrap outer code fence if it's wrapping an HTML block
  if (/^```(?:html|xml)?\s*\n<[\s\S]*\n```$/i.test(text.trim())) {
    text = text.trim().replace(/^```[a-zA-Z0-9_-]*\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  }

  // 2. Macro substitution with natural human readable names
  const cName = options.charName;
  const uName = options.userName;
  if (cName) {
    text = text.replace(/\{\{char\}\}|<BOT>|<CHAR>/gi, cName);
  }
  if (uName) {
    text = text.replace(/\{\{user\}\}|<USER>/gi, uName);
  }

  // 3. Convert BBCode links: [url=https://...]Text[/url] or [url]https://...[/url]
  text = text.replace(/\[url=(.*?)\]([\s\S]*?)\[\/url\]/gi, (match, url, label) => {
    const cleanUrl = sanitizeUrl(url);
    if (!cleanUrl) return label || '';
    return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="bbcode-link" data-bbcode="link">${label || cleanUrl}</a>`;
  });

  text = text.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (match, url) => {
    const cleanUrl = sanitizeUrl(url);
    if (!cleanUrl) return url || '';
    return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="bbcode-link" data-bbcode="link">${cleanUrl}</a>`;
  });

  text = text.replace(/\[link=(.*?)\]([\s\S]*?)\[\/link\]/gi, (match, url, label) => {
    const cleanUrl = sanitizeUrl(url);
    if (!cleanUrl) return label || '';
    return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="bbcode-link" data-bbcode="link">${label || cleanUrl}</a>`;
  });

  text = text.replace(/\[link\]([\s\S]*?)\[\/link\]/gi, (match, url) => {
    const cleanUrl = sanitizeUrl(url);
    if (!cleanUrl) return url || '';
    return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="bbcode-link" data-bbcode="link">${cleanUrl}</a>`;
  });

  // 4. Markdown links: [Label](https://...)
  text = text.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s\)]+)\)/gi, (match, label, url) => {
    const cleanUrl = sanitizeUrl(url);
    if (!cleanUrl) return label;
    return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="bbcode-link" data-bbcode="link">${label}</a>`;
  });

  // 5. Formatting tags: [b], [i], [u], [s], [del], [strike], [sub], [sup]
  text = text.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong class="font-semibold text-white/95">$1</strong>');
  text = text.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em class="italic">$1</em>');
  text = text.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u class="underline underline-offset-2">$1</u>');
  text = text.replace(/\[(?:s|strike|del)\]([\s\S]*?)\[\/(?:s|strike|del)\]/gi, '<del class="line-through opacity-70">$1</del>');
  text = text.replace(/\[sub\]([\s\S]*?)\[\/sub\]/gi, '<sub class="text-xs opacity-80">$1</sub>');
  text = text.replace(/\[sup\]([\s\S]*?)\[\/sup\]/gi, '<sup class="text-xs opacity-80">$1</sup>');

  // 6. Color & Background: [color=#hex]...[/color], [bg=#hex]...[/bg]
  text = text.replace(/\[color=(.*?)\]([\s\S]*?)\[\/color\]/gi, (match, color, content) => {
    const validColor = sanitizeColor(color);
    if (validColor) {
      return `<span style="color: ${validColor}">${content}</span>`;
    }
    return content;
  });

  text = text.replace(/\[bg=(.*?)\]([\s\S]*?)\[\/bg\]/gi, (match, bg, content) => {
    const validBg = sanitizeColor(bg);
    if (validBg) {
      return `<span style="background-color: ${validBg}" class="px-1 py-0.5 rounded">${content}</span>`;
    }
    return content;
  });

  // 7. Size: [size=14px]...[/size]
  text = text.replace(/\[size=(.*?)\]([\s\S]*?)\[\/size\]/gi, (match, size, content) => {
    const validSize = sanitizeSize(size);
    if (validSize) {
      return `<span style="font-size: ${validSize}">${content}</span>`;
    }
    return content;
  });

  // 8. Alignment: [center]...[/center], [right]...[/right], [align=center]...[/align]
  text = text.replace(/\[center\]([\s\S]*?)\[\/center\]/gi, '<div class="text-center w-full">$1</div>');
  text = text.replace(/\[right\]([\s\S]*?)\[\/right\]/gi, '<div class="text-right w-full">$1</div>');
  text = text.replace(/\[align=(left|center|right|justify)\]([\s\S]*?)\[\/align\]/gi, (match, align, content) => {
    return `<div style="text-align: ${align}" class="w-full">${content}</div>`;
  });

  // 9. Images: [img]https://...[/img] or [img=widthxheight]https://...[/img]
  text = text.replace(/\[img(?:=(?:(\d+)x(\d+)|(\d+)))?\]([\s\S]*?)\[\/img\]/gi, (match, w, h, size, url) => {
    const cleanUrl = sanitizeUrl(url);
    if (!cleanUrl) return '';
    const styleAttr = (w && h) ? `style="width:${w}px;height:${h}px"` : size ? `style="max-width:${size}px"` : '';
    return `<img src="${cleanUrl}" alt="" class="max-w-full rounded-lg my-2 object-contain shadow-md" ${styleAttr} loading="lazy" />`;
  });

  // 10. Quote: [quote]...[/quote] or [quote=Author]...[/quote]
  text = text.replace(/\[quote(?:=(.*?))?\]([\s\S]*?)\[\/quote\]/gi, (match, author, content) => {
    const authorHeader = author ? `<div class="text-xs font-semibold text-purple-400 mb-1">${author}:</div>` : '';
    return `<blockquote class="border-l-4 border-purple-500/50 bg-white/5 pl-3 pr-2 py-2 my-2 rounded-r-lg italic text-white/80">${authorHeader}${content}</blockquote>`;
  });

  // 11. Spoiler: [spoiler]...[/spoiler] or [spoiler=Title]...[/spoiler]
  text = text.replace(/\[spoiler(?:=(.*?))?\]([\s\S]*?)\[\/spoiler\]/gi, (match, title, content) => {
    const spoilerTitle = title || '剧透 / Spoiler (点击展开)';
    return `<details class="group bg-white/5 border border-white/10 rounded-xl my-2 overflow-hidden transition-all"><summary class="px-3 py-2 cursor-pointer font-medium text-xs text-purple-300 hover:text-purple-200 select-none bg-white/[0.02] flex items-center justify-between">${spoilerTitle}</summary><div class="px-3 py-2.5 text-sm text-white/90 border-t border-white/5">${content}</div></details>`;
  });

  // 12. Code block: [code]...[/code]
  text = text.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, '<pre class="bg-black/40 border border-white/10 rounded-lg p-2.5 my-2 font-mono text-xs overflow-x-auto text-purple-200 custom-scrollbar"><code>$1</code></pre>');

  // 13. Horizontal Rule: [hr]
  text = text.replace(/\[hr\]/gi, '<hr class="my-3 border-white/10" />');

  return text;
}
