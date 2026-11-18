import React, { useRef, useEffect, useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import { splitHtmlSegments } from '../lib/htmlSegments';
import {
  buildTavernRuntimeScript,
  extractWorldbookEntriesFromCard,
  isRuntimeScriptSafe,
  resolveCombinedStatData,
  WorldbookRuntimeEntry,
} from '../lib/tavernRuntime';

interface AutoResizingIframeProps {
  htmlContent: string;
  sharedHeadTags?: string;
  themeMode?: 'light' | 'dark';
  swipes?: string[];
  characterName?: string;
  statData?: Record<string, any> | null;
  currentMessage?: string;
  currentSwipeId?: number;
  messageId?: number;
  worldbookEntries?: WorldbookRuntimeEntry[];
}

/**
 * 与 JS-Slash-Runner (`src/panel/render/iframe.ts`) 对齐：
 * 将 HTML/CSS/JS 中的 `vh` / `dvh` / `svh` / `lvh` 替换为基于父窗口视口高度的
 * `var(--TH-viewport-height)`，避免自适应高度的 iframe 与视口单位互相撑高导致死循环或错位。
 */
function replaceVhInContent(content: string): string {
  const hasAnyVh = /\d+(?:\.\d+)?(?:d|s|l)?vh\b/i.test(content);
  if (!hasAnyVh) return content;

  const convertVhToVariable = (value: string) =>
    value.replace(/(\d+(?:\.\d+)?)(?:d|s|l)?vh\b/gi, (match, num) => {
      const parsed = parseFloat(num);
      if (!isFinite(parsed)) return match;
      const varExpr = 'var(--TH-viewport-height)';
      if (parsed === 100) return varExpr;
      return `calc(${varExpr} * ${parsed / 100})`;
    });

  // 1) CSS 声明块中的 height / min-height / max-height
  content = content.replace(
    /((?:min-|max-)?height\s*:\s*)([^;{}]*?\d+(?:\.\d+)?(?:d|s|l)?vh)(?=\s*[;}!])/gi,
    (_m, prefix: string, value: string) => `${prefix}${convertVhToVariable(value)}`
  );

  // 2) 行内 style="..."
  content = content.replace(
    /(style\s*=\s*(["']))([\s\S]*?)(\2)/gi,
    (match, prefix: string, _q: string, styleContent: string, suffix: string) => {
      if (!/(?:min-|max-)?height\s*:\s*[^;]*\d+(?:\.\d+)?(?:d|s|l)?vh/i.test(styleContent)) {
        return match;
      }
      const replaced = styleContent.replace(
        /((?:min-|max-)?height\s*:\s*)([^;]*?\d+(?:\.\d+)?(?:d|s|l)?vh)/gi,
        (_m, p1: string, p2: string) => `${p1}${convertVhToVariable(p2)}`
      );
      return `${prefix}${replaced}${suffix}`;
    }
  );

  // 3) JS: element.style.minHeight / height / maxHeight = "...vh"
  content = content.replace(
    /(\.style\.(?:minHeight|maxHeight|height)\s*=\s*(["']))([\s\S]*?)(\2)/gi,
    (match, prefix: string, _q: string, val: string, suffix: string) => {
      if (!/\b\d+(?:\.\d+)?(?:d|s|l)?vh\b/i.test(val)) return match;
      return `${prefix}${convertVhToVariable(val)}${suffix}`;
    }
  );

  // 4) JS: setProperty('min-height' | 'height' | 'max-height', "...vh")
  content = content.replace(
    /(setProperty\s*\(\s*(["'])(?:min-|max-)?height\2\s*,\s*(["']))([\s\S]*?)(\3\s*(?:,[^)]*)?\))/gi,
    (match, prefix: string, _q1: string, _q2: string, val: string, suffix: string) => {
      if (!/\b\d+(?:\.\d+)?(?:d|s|l)?vh\b/i.test(val)) return match;
      return `${prefix}${convertVhToVariable(val)}${suffix}`;
    }
  );

  return content;
}

/** 检测当前段是否仅包含 <style> / <link> / <meta> / <title> / 注释，不含 <script> 与可见 DOM */
function isPureStyleHeadSegment(html: string): boolean {
  if (!html || /<script\b/i.test(html)) return false;
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*>/gi, '')
    .replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, '')
    .trim();
  return stripped.length === 0;
}

export const AutoResizingIframe: React.FC<AutoResizingIframeProps> = React.memo(({
  htmlContent,
  sharedHeadTags = '',
  themeMode = 'dark',
  swipes = [],
  characterName = 'Character',
  statData,
  currentMessage = '',
  currentSwipeId = 0,
  messageId = 0,
  worldbookEntries = [],
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [reportedHeight, setReportedHeight] = useState<number>(120);
  const [hasEnteredViewport, setHasEnteredViewport] = useState<boolean>(() => typeof IntersectionObserver === 'undefined');
  const iframeId = useMemo(() => `th-frame-${Math.random().toString(36).substring(2, 9)}`, []);

  const iframeHeight = reportedHeight;

  useEffect(() => {
    if (hasEnteredViewport) return;
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setHasEnteredViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setHasEnteredViewport(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: '500px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasEnteredViewport]);

  useEffect(() => {
    if (!hasEnteredViewport) return;
    const handleMessage = (event: MessageEvent) => {
      if (
        event.data?.type === 'th_resize' &&
        event.data?.id === iframeId &&
        typeof event.data?.height === 'number'
      ) {
        const nextH = Math.max(24, Math.ceil(event.data.height));
        setReportedHeight((prev) => (Math.abs(prev - nextH) >= 2 ? nextH : prev));
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [iframeId, hasEnteredViewport]);

  useEffect(() => {
    if (iframeRef.current) iframeRef.current.style.height = `${iframeHeight}px`;
  }, [iframeHeight]);

  // Clean and prepare HTML content - unwrap code fences like ```html or ``` and unescape literal \r\n
  const cleanHtml = useMemo(() => {
    let cleaned = htmlContent
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\\r\\n/g, '\n')
      .replace(/\\r/g, '\n')
      .trim();
    cleaned = cleaned.replace(/^(?:`{3,}|~{3,})[^\n]*\n?/i, '').replace(/\n?(?:`{3,}|~{3,})\s*$/i, '');
    if (cleaned.includes('\\n') && !cleaned.includes('\n')) {
      cleaned = cleaned.replace(/\\n/g, '\n');
    }
    return cleaned;
  }, [htmlContent]);

  const swipesKey = useMemo(() => swipes.join('\u0000'), [swipes]);
  const statDataKey = useMemo(() => {
    try {
      return statData ? JSON.stringify(statData) : '';
    } catch {
      return '';
    }
  }, [statData]);
  const worldbookKey = useMemo(() => {
    try {
      return worldbookEntries.length > 0 ? JSON.stringify(worldbookEntries) : '';
    } catch {
      return '';
    }
  }, [worldbookEntries]);

  const isLight = themeMode === 'light';
  const defaultTextColor = isLight ? '#0f172a' : '#f8fafc';
  const cardBg = isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.04)';
  const cardBorder = isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';
  const cardHoverBg = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.09)';

  const finalHtml = useMemo(() => {
    if (!hasEnteredViewport) return '';

    const normalizedHtml = replaceVhInContent(cleanHtml);
    const hasJs = /<script\b|\bon[a-z]+\s*=/i.test(normalizedHtml);
    let runtimeTag = '';
    if (hasJs) {
      const parsedSwipes = swipesKey ? swipesKey.split('\u0000') : [];
      const runtimeScript = buildTavernRuntimeScript({
        statData: statData || {},
        characterName,
        userName: 'User',
        currentMessage: currentMessage || normalizedHtml,
        swipes: parsedSwipes.length > 0 ? parsedSwipes : [currentMessage || normalizedHtml],
        currentSwipeId,
        messageId,
        worldbookEntries,
        frameId: iframeId,
      });
      if (runtimeScript && isRuntimeScriptSafe(runtimeScript)) {
        runtimeTag = `<script>${runtimeScript}</script>`;
      }
    }

    // 按需预注入 JS-Slash-Runner 生态常用内置库（与 src/iframe/third_party_message.html 对齐）
    const hasJquery = /<script\b[^>]*src\s*=\s*["'][^"']*jquery(?:\.min)?\.js["']/i.test(normalizedHtml);
    const hasJqueryUi = /<script\b[^>]*src\s*=\s*["'][^"']*jquery-ui[^"']*["']/i.test(normalizedHtml);
    const hasLodash = /<script\b[^>]*src\s*=\s*["'][^"']*lodash[^"']*["']/i.test(normalizedHtml);
    const hasYaml = /<script\b[^>]*src\s*=\s*["'][^"']*(?:js-yaml|yaml)[^"']*["']/i.test(normalizedHtml);
    const hasVue = /<script\b[^>]*src\s*=\s*["'][^"']*vue(?:\.runtime)?(?:\.global)?(?:\.prod)?(?:\.min)?\.js["']/i.test(normalizedHtml);
    const hasVueRouter = /<script\b[^>]*src\s*=\s*["'][^"']*vue-router[^"']*["']/i.test(normalizedHtml);
    const hasTailwind = /<script\b[^>]*src\s*=\s*["'][^"']*tailwind[^"']*["']/i.test(normalizedHtml);
    const hasFontAwesome = /<link\b[^>]*href\s*=\s*["'][^"']*font-?awesome[^"']*["']/i.test(normalizedHtml);

    const needsJquery = hasJs && !hasJquery && /(?:jQuery|\$\s*\(|\$\.)/.test(normalizedHtml);
    const needsJqueryUi =
      hasJs &&
      !hasJqueryUi &&
      /\.(?:draggable|droppable|resizable|selectable|sortable|accordion|autocomplete|datepicker|dialog|progressbar|slider|spinner|tabs|tooltip)\s*\(|\bui-widget\b/.test(
        normalizedHtml
      );
    const needsLodash = hasJs && !hasLodash && /(?:\b_\.[a-zA-Z]|\blodash\b)/.test(normalizedHtml);
    const needsYaml = hasJs && !hasYaml && /\b(?:YAML|jsyaml)\b/i.test(normalizedHtml);
    const needsVue = hasJs && !hasVue && /\b(?:Vue\.|createApp|v-for|v-if|v-else|v-show|v-model)\b/.test(normalizedHtml);
    const needsVueRouter = hasJs && !hasVueRouter && /\b(?:VueRouter|createRouter)\b/.test(normalizedHtml);
    const needsFontAwesome = !hasFontAwesome && /\bfa[rsbld]?\b|\bfa-/i.test(normalizedHtml);

    const hasCustomTailwindConfig = /\btailwind\.config\b/.test(normalizedHtml);
    const needsTailwind =
      !hasTailwind &&
      (hasCustomTailwindConfig ||
        /<style\b[^>]*type\s*=\s*["']text\/tailwindcss["']/i.test(normalizedHtml) ||
        /\b@(?:apply|theme)\b/.test(normalizedHtml) ||
        /\b(?:class|className|:class)\s*=\s*["'`][^"'`]*(?:\b(?:flex|inline-flex|grid|inline-grid|grid-cols-|col-span-|gap-[xy0-9]|space-[xy]-|items-(?:start|center|end|stretch|baseline)|justify-(?:start|center|end|between|around|evenly)|rounded-(?:none|sm|md|lg|xl|2xl|3xl|full)|bg-(?:black|white|transparent|slate|zinc|gray|neutral|stone|red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)|text-(?:xs|sm|base|lg|xl|2xl|3xl|slate|zinc|gray|white|black|emerald|sky|rose|amber|indigo|violet|purple|cyan|teal)|font-(?:thin|light|normal|medium|semibold|bold|extrabold|mono|serif|sans)|p[xytrbl]?-\d|m[xytrbl]?-\d|w-(?:full|screen|fit|auto|\d+\/\d+)|h-(?:full|screen|fit|auto)|max-w-|min-w-|border-(?:white|black|slate|zinc|gray|t|b|l|r|0|2)|shadow-|backdrop-blur|transition(?:-all|-colors|-opacity|-transform)?|overflow-(?:hidden|auto|x-auto|y-auto)|sm:|md:|lg:|hover:|dark:))/i.test(
          normalizedHtml
        ));

    const libTags = [
      needsTailwind
        ? hasCustomTailwindConfig
          ? '<script src="https://cdn.tailwindcss.com"></script>'
          : '<script src="https://testingcf.jsdelivr.net/npm/@tailwindcss/browser@4" onerror="(function(){var s=document.createElement(\'script\');s.src=\'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4\';document.head.appendChild(s);})()"></script>'
        : '',
      needsJquery || needsJqueryUi
        ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>'
        : '',
      needsJqueryUi
        ? '<link rel="stylesheet" href="https://testingcf.jsdelivr.net/npm/jquery-ui/themes/base/theme.min.css"><script src="https://testingcf.jsdelivr.net/npm/jquery-ui/dist/jquery-ui.min.js"></script><script src="https://testingcf.jsdelivr.net/npm/jquery-ui-touch-punch/jquery.ui.touch-punch.min.js"></script>'
        : '',
      needsLodash ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js"></script>' : '',
      needsYaml
        ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js"></script><script>if(window.jsyaml&&!window.YAML){window.YAML={parse:window.jsyaml.load.bind(window.jsyaml),stringify:window.jsyaml.dump.bind(window.jsyaml)};}</script>'
        : '',
      needsVue ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/vue/3.5.13/vue.global.prod.min.js"></script>' : '',
      needsVueRouter ? '<script src="https://testingcf.jsdelivr.net/npm/vue-router/dist/vue-router.global.prod.min.js"></script>' : '',
    ]
      .filter(Boolean)
      .join('\n    ');

    const fontAwesomeTag = needsFontAwesome
      ? '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">'
      : '';

    // 仅对“完全无自带样式”的纯文本分支选项卡片提供保底样式，避免污染带样式/交互脚本的状态栏选项卡与按钮
    const hasAuthorStyles =
      /<style\b|<link\b[^>]*rel\s*=\s*["']?stylesheet|\bstyle\s*=/i.test(normalizedHtml) ||
      Boolean(sharedHeadTags) ||
      needsTailwind;

    const fallbackChoiceCss = hasAuthorStyles
      ? ''
      : `
      :where(.fate-card, .choice-card, .branch-card, .scenario-card, [data-greeting]) {
        display: block;
        padding: 14px 18px;
        margin: 10px 0;
        border-radius: 12px;
        border: 1px solid ${cardBorder};
        background: ${cardBg};
        color: ${defaultTextColor};
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.22, 1, 0.36, 1);
        text-decoration: none;
      }
      :where(.fate-card, .choice-card, .branch-card, .scenario-card, [data-greeting]):hover {
        background: ${cardHoverBg};
        border-color: #38bdf8;
        transform: translateY(-1px);
      }`;

    const scriptContent = `
    ${runtimeTag}
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${fontAwesomeTag}
    ${libTags}
    <style>
      :root {
        color-scheme: ${isLight ? 'light' : 'dark'};
        --mainFontSize: 15px;
        --fontScale: 1;
        --TH-viewport-height: 720px;
        --SmartThemeBodyColor: ${defaultTextColor};
        --SmartThemeEmColor: ${isLight ? '#475569' : '#cbd5e1'};
        --SmartThemeUnderlineColor: ${isLight ? '#2563eb' : '#60a5fa'};
        --SmartThemeQuoteColor: ${isLight ? '#0284c7' : '#7dd3fc'};
        --SmartThemeShadowColor: ${isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(0, 0, 0, 0.5)'};
        --SmartThemeBorderColor: ${isLight ? 'rgba(0, 0, 0, 0.14)' : 'rgba(255, 255, 255, 0.16)'};
        --SmartThemeBlurTintColor: ${isLight ? 'rgba(255, 255, 255, 0.85)' : 'rgba(18, 20, 28, 0.78)'};
        --SmartThemeChatTintColor: ${isLight ? 'rgba(248, 250, 252, 0.92)' : 'rgba(15, 17, 23, 0.85)'};
        --SmartThemeBotMesBlurTintColor: ${isLight ? 'rgba(241, 245, 249, 0.9)' : 'rgba(24, 27, 36, 0.8)'};
        --SmartThemeUserMesBlurTintColor: ${isLight ? 'rgba(224, 242, 254, 0.9)' : 'rgba(30, 41, 59, 0.8)'};
      }
      :where(*, *::before, *::after) {
        box-sizing: border-box;
      }
      html, body {
        background-color: transparent;
        margin: 0 !important;
        padding: 0;
        width: 100%;
        max-width: 100% !important;
        min-height: 0 !important;
        height: auto !important;
        overflow: hidden !important;
        overflow-anchor: none;
      }
      body {
        color: ${defaultTextColor};
        font-size: 15px;
        line-height: 1.55;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif;
        -webkit-text-size-adjust: 100%;
      }
      summary[style*="list-style: none"]::-webkit-details-marker,
      summary[style*="list-style:none"]::-webkit-details-marker {
        display: none;
      }
      :where(img, video, canvas, svg) {
        max-width: 100%;
      }
      :where(img, video) {
        height: auto;
      }
      ${fallbackChoiceCss}
      ::-webkit-scrollbar {
        width: 4px;
        height: 4px;
      }
      ::-webkit-scrollbar-thumb {
        background: rgba(125, 125, 125, 0.25);
        border-radius: 4px;
      }
    </style>
    ${sharedHeadTags ? replaceVhInContent(sharedHeadTags) : ''}
    <script>
      (function() {
        const frameId = "${iframeId}";
        const cardHasJs = ${hasJs ? 'true' : 'false'};
        let lastHeight = 0;
        let resizeTimer = null;
        let lastFitAvailW = 0;
        let currentZoom = 1;
        let isFitting = false;

        function updateViewportVar() {
          let h = 0;
          try {
            h = window.parent && window.parent !== window ? window.parent.innerHeight : window.innerHeight;
          } catch (e) {
            h = window.innerHeight;
          }
          if (!h || h < 200) h = 720;
          document.documentElement.style.setProperty('--TH-viewport-height', Math.round(h) + 'px');
        }
        updateViewportVar();

        // 仅在明确的开场白跳转链接/属性（或无脚本静态选项卡）上拦截点击，不抢占状态栏内部 tab/按钮事件
        document.addEventListener('click', function(e) {
          const target = e.target.closest('a, button, [data-greeting], [data-index], [data-target], .choice-card, .fate-card, .branch-card, .scenario-card');
          if (!target) return;
          if (target.hasAttribute('onclick') || target.closest('[role="tab"], [role="tablist"], [data-tab], .tabs, .tab-bar, nav')) {
            return;
          }

          const href = target.getAttribute('href') || '';
          const explicitGreeting = target.getAttribute('data-greeting');
          const softTarget = target.getAttribute('data-target') || target.getAttribute('data-index');
          const text = (target.innerText || target.textContent || '').trim();

          let targetIdx = null;

          if (explicitGreeting && !isNaN(parseInt(explicitGreeting))) {
            targetIdx = parseInt(explicitGreeting);
          } else if (href && /#?(?:greeting|branch|swipe|opt)[-_]?(\\d+)/i.test(href)) {
            const m = href.match(/#?(?:greeting|branch|swipe|opt)[-_]?(\\d+)/i);
            if (m) targetIdx = parseInt(m[1]);
          } else if (href && /^#(\\d+)$/.test(href) && !cardHasJs) {
            targetIdx = parseInt(href.substring(1));
          } else if (!cardHasJs && softTarget && !isNaN(parseInt(softTarget))) {
            targetIdx = parseInt(softTarget);
          } else if (!cardHasJs && target.matches('[data-greeting], .fate-card, .choice-card, .branch-card, .scenario-card')) {
            const numMatch = text.match(/(?:^|[^\\d])([1-9]\\d?)[.、\\s]/);
            if (numMatch) {
              targetIdx = parseInt(numMatch[1]);
            }
          }

          if (targetIdx !== null) {
            e.preventDefault();
            e.stopPropagation();
            window.parent.postMessage({ type: 'jump_greeting', targetIndex: targetIdx }, '*');
          }
        }, true);

        // 对固定像素宽度且超出手机容器的卡片做等比适配缩放，避免截断或嵌套元素被强行压扁错位
        function fitOverflowToViewport(forceFit) {
          const docEl = document.documentElement;
          const body = document.body;
          if (!docEl || !body) return 1;
          const availW = docEl.clientWidth || window.innerWidth || 0;
          if (!availW || availW < 120) return 1;
          if (!forceFit && Math.abs(availW - lastFitAvailW) < 2 && currentZoom === 1) {
            // 仅在容器宽度或显式 DOM 变化时重测，但若当前可能新增了宽内容也允许检查
          }
          isFitting = true;
          try {
            lastFitAvailW = availW;
            if (body.style.zoom) body.style.zoom = '';
            docEl.style.removeProperty('overflow-x');
            body.style.removeProperty('overflow-x');

            const naturalW = Math.max(body.scrollWidth || 0, docEl.scrollWidth || 0);
            if (naturalW > availW + 14) {
              const nextZoom = Math.max(0.58, Math.min(1, availW / naturalW));
              if ('zoom' in body.style) {
                body.style.zoom = nextZoom.toFixed(4);
                currentZoom = nextZoom;
                if (naturalW * nextZoom > availW + 8) {
                  docEl.style.setProperty('overflow-x', 'auto', 'important');
                  body.style.setProperty('overflow-x', 'auto', 'important');
                }
                return currentZoom;
              } else {
                docEl.style.setProperty('overflow-x', 'auto', 'important');
                body.style.setProperty('overflow-x', 'auto', 'important');
              }
            }
            currentZoom = 1;
            return 1;
          } catch (e) {
            return 1;
          } finally {
            setTimeout(function() { isFitting = false; }, 32);
          }
        }

        function reportHeight(forceFit) {
          const body = document.body;
          if (!body) return;

          updateViewportVar();
          if (forceFit) {
            currentZoom = fitOverflowToViewport(true);
          }

          let maxBottom = 0;
          const children = body.children;
          for (let i = 0; i < children.length; i++) {
            const el = children[i];
            if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'META' || el.tagName === 'LINK') continue;
            let elPos = '';
            try { elPos = window.getComputedStyle(el).position; } catch (e) {}
            if (elPos === 'fixed') continue;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            const bottom = rect.bottom + window.scrollY;
            if (bottom > maxBottom) {
              maxBottom = bottom;
            }
          }

          const bodyRect = body.getBoundingClientRect();
          const rawScrollH = body.scrollHeight || 0;
          const scaledScrollH = currentZoom < 1 ? rawScrollH * currentZoom : rawScrollH;
          const measured = Math.max(maxBottom, bodyRect.height, scaledScrollH, 0);
          const calculated = Math.min(Math.max(24, Math.ceil(measured + 6)), 30000);

          if (Math.abs(calculated - lastHeight) >= 2) {
            lastHeight = calculated;
            window.parent.postMessage({ type: 'th_resize', id: frameId, height: calculated }, '*');
          }
        }

        document.addEventListener('error', function(e) {
          const el = e && e.target;
          if (!el || el.tagName !== 'IMG') return;
          try {
            if (el.getAttribute('data-miu-broken') === '1') return;
            el.setAttribute('data-miu-broken', '1');
          } catch (err) {}
          try { el.setAttribute('alt', ''); } catch (err) {}
          try {
            el.style.setProperty('visibility', 'hidden', 'important');
            el.style.setProperty('background', 'rgba(127, 127, 127, 0.12)', 'important');
          } catch (err) {}
        }, true);

        document.addEventListener('load', function(e) {
          const el = e && e.target;
          if (!el) return;
          if (el.tagName === 'IMG' || el.tagName === 'LINK') {
            debouncedReport(true);
          }
        }, true);

        function debouncedReport(forceFit) {
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(function() {
            reportHeight(!!forceFit);
          }, 60);
        }

        window.addEventListener('load', function() { reportHeight(true); });
        window.addEventListener('resize', function() { debouncedReport(true); });
        document.addEventListener('DOMContentLoaded', function() { reportHeight(true); });
        document.addEventListener('click', function() { debouncedReport(true); });
        document.addEventListener('transitionend', function() { debouncedReport(false); });
        document.addEventListener('animationend', function() { debouncedReport(false); });
        document.addEventListener('toggle', function() { reportHeight(true); }, true);

        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(function() { debouncedReport(true); });
        }

        if (window.MutationObserver) {
          const obs = new MutationObserver(function() {
            if (isFitting) return;
            debouncedReport(true);
          });
          const obsOpts = {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'open', 'hidden', 'data-active', 'aria-expanded', 'style'],
          };
          if (document.body) {
            obs.observe(document.body, obsOpts);
          } else {
            document.addEventListener('DOMContentLoaded', function() {
              if (document.body) obs.observe(document.body, obsOpts);
            });
          }
        }

        if (window.ResizeObserver) {
          const startRo = function() {
            if (!document.body) return;
            const ro = new ResizeObserver(function() {
              if (isFitting) return;
              debouncedReport(false);
            });
            ro.observe(document.body);
          };
          if (document.body) startRo();
          else document.addEventListener('DOMContentLoaded', startRo);
        }

        setTimeout(function() { reportHeight(true); }, 150);
        setTimeout(function() { reportHeight(true); }, 500);
        setTimeout(function() { reportHeight(true); }, 1100);

        reportHeight(true);
      })();
    </script>
  `;

    let result = normalizedHtml;
    if (/<head[^>]*>/i.test(result)) {
      result = result.replace(/<head[^>]*>/i, (m) => `${m}${scriptContent}`);
    } else if (/<\/head>/i.test(result)) {
      result = result.replace(/<\/head>/i, () => `${scriptContent}</head>`);
    } else if (/<html[^>]*>/i.test(result)) {
      result = result.replace(/<html[^>]*>/i, (m) => `${m}<head>${scriptContent}</head>`);
    } else if (/<body[^>]*>/i.test(result)) {
      result = result.replace(/<body[^>]*>/i, (m) => `<head>${scriptContent}</head>${m}`);
    } else if (/<\/html>/i.test(result)) {
      result = result.replace(/<\/html>/i, () => `${scriptContent}</html>`);
    } else {
      result = `<!DOCTYPE html><html><head>${scriptContent}</head><body>${normalizedHtml}</body></html>`;
    }
    return result;
  }, [
    hasEnteredViewport,
    cleanHtml,
    sharedHeadTags,
    isLight,
    defaultTextColor,
    cardBg,
    cardBorder,
    cardHoverBg,
    statDataKey,
    characterName,
    currentMessage,
    swipesKey,
    currentSwipeId,
    messageId,
    worldbookKey,
    iframeId,
  ]);

  return (
    <div ref={containerRef} className="w-full max-w-full my-1.5 relative overflow-hidden rounded-xl transition-all" style={{ contain: 'layout' }}>
      {hasEnteredViewport ? (
        <iframe
          ref={iframeRef}
          srcDoc={finalHtml}
          loading="lazy"
          className="w-full max-w-full border-0 bg-transparent block"
          style={{ height: `${iframeHeight}px`, minHeight: '24px', width: '100%', maxWidth: '100%', display: 'block' }}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          title="Tavern Widget"
        />
      ) : (
        <div
          className="w-full max-w-full rounded-xl"
          style={{ height: `${iframeHeight}px`, minHeight: '24px' }}
        />
      )}
    </div>
  );
});

interface MessageContentProps {
  content: string;
  themeMode?: 'light' | 'dark';
  swipes?: string[];
  characterName?: string;
  character?: any;
  /** 原始开场白/消息文本：用来解析 MVU 变量初始值，并喂给 getChatMessages(-1)[0].message */
  mvuSourceText?: string;
  extraVariables?: Record<string, any> | null;
  currentSwipeId?: number;
  messageId?: number;
}

export const MessageContent: React.FC<MessageContentProps> = React.memo(({
  content,
  themeMode = 'dark',
  swipes = [],
  characterName = 'Character',
  character,
  mvuSourceText,
  extraVariables,
  currentSwipeId = 0,
  messageId = 0,
}) => {
  const { visibleSegments, sharedHeadTags } = useMemo(() => {
    const rawSegments = splitHtmlSegments(content);
    const headChunks: string[] = [];
    const filtered = rawSegments.filter((seg) => {
      if (seg.type === 'html' && isPureStyleHeadSegment(seg.content)) {
        headChunks.push(seg.content);
        return false;
      }
      return true;
    });
    return {
      visibleSegments: filtered,
      sharedHeadTags: headChunks.join('\n'),
    };
  }, [content]);

  const effectiveSource = mvuSourceText ?? content;
  const statData = useMemo(
    () =>
      resolveCombinedStatData({
        character,
        mvuSourceText: effectiveSource,
        extraVariables,
      }),
    [character, effectiveSource, extraVariables]
  );

  const worldbookEntries = useMemo(
    () => (character ? extractWorldbookEntriesFromCard(character) : []),
    [character]
  );

  return (
    <div className="flex flex-col gap-2.5 w-full max-w-full">
      {visibleSegments.map((seg, index) => {
        if (!seg.content.trim()) return null;

        if (seg.type === 'html') {
          return (
            <AutoResizingIframe
              key={`widget-${index}`}
              htmlContent={seg.content}
              sharedHeadTags={sharedHeadTags}
              themeMode={themeMode}
              swipes={swipes}
              characterName={characterName}
              statData={statData}
              currentMessage={effectiveSource}
              currentSwipeId={currentSwipeId}
              messageId={messageId}
              worldbookEntries={worldbookEntries}
            />
          );
        }

        return (
          <ReactMarkdown
            key={`md-${index}`}
            remarkPlugins={[remarkGfm, remarkBreaks]}
            rehypePlugins={[rehypeRaw]}
          >
            {seg.content}
          </ReactMarkdown>
        );
      })}
    </div>
  );
});
