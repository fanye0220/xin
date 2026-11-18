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
  themeMode?: 'light' | 'dark';
  swipes?: string[];
  characterName?: string;
  statData?: Record<string, any> | null;
  currentMessage?: string;
  currentSwipeId?: number;
  messageId?: number;
  worldbookEntries?: WorldbookRuntimeEntry[];
}

export const AutoResizingIframe: React.FC<AutoResizingIframeProps> = React.memo(({
  htmlContent,
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
  const [reportedHeight, setReportedHeight] = useState<number>(200);
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
        const nextH = Math.max(60, Math.ceil(event.data.height));
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

    const hasJs = /<script\b|\bon[a-z]+\s*=/i.test(cleanHtml);
    let runtimeTag = '';
    if (hasJs) {
      const parsedSwipes = swipesKey ? swipesKey.split('\u0000') : [];
      const runtimeScript = buildTavernRuntimeScript({
        statData: statData || {},
        characterName,
        userName: 'User',
        currentMessage: currentMessage || cleanHtml,
        swipes: parsedSwipes.length > 0 ? parsedSwipes : [currentMessage || cleanHtml],
        currentSwipeId,
        messageId,
        worldbookEntries,
        frameId: iframeId,
      });
      if (runtimeScript && isRuntimeScriptSafe(runtimeScript)) {
        runtimeTag = `<script>${runtimeScript}</script>`;
      }
    }

    // 按需预注入 JS-Slash-Runner 生态常用内置库（静态无脚本组件不触发任何外链请求）
    const hasJquery = /<script\b[^>]*src\s*=\s*["'][^"']*jquery[^"']*["']/i.test(cleanHtml);
    const hasLodash = /<script\b[^>]*src\s*=\s*["'][^"']*lodash[^"']*["']/i.test(cleanHtml);
    const hasYaml = /<script\b[^>]*src\s*=\s*["'][^"']*(?:js-yaml|yaml)[^"']*["']/i.test(cleanHtml);
    const hasVue = /<script\b[^>]*src\s*=\s*["'][^"']*vue[^"']*["']/i.test(cleanHtml);

    const needsJquery = hasJs && !hasJquery && /(?:jQuery|\$\s*\(|\$\.)/.test(cleanHtml);
    const needsLodash = hasJs && !hasLodash && /(?:\b_\.[a-zA-Z]|\blodash\b)/.test(cleanHtml);
    const needsYaml = hasJs && !hasYaml && /\b(?:YAML|jsyaml)\b/i.test(cleanHtml);
    const needsVue = hasJs && !hasVue && /\b(?:Vue\.|createApp|v-for|v-if|v-else|v-show|v-model)\b/.test(cleanHtml);
    const needsFontAwesome = /\bfa[rsbld]?\b|\bfa-/i.test(cleanHtml);

    const libTags = [
      needsJquery ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>' : '',
      needsLodash ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.21/lodash.min.js"></script>' : '',
      needsYaml
        ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js"></script><script>if(window.jsyaml&&!window.YAML){window.YAML={parse:window.jsyaml.load.bind(window.jsyaml),stringify:window.jsyaml.dump.bind(window.jsyaml)};}</script>'
        : '',
      needsVue
        ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/vue/3.5.13/vue.global.prod.min.js"></script>'
        : '',
    ]
      .filter(Boolean)
      .join('\n    ');

    const fontAwesomeTag = needsFontAwesome
      ? '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">'
      : '';

    const scriptContent = `
    ${runtimeTag}
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, shrink-to-fit=no">
    ${fontAwesomeTag}
    ${libTags}
    <style>
      :root {
        color-scheme: ${isLight ? 'light' : 'dark'};
      }
      :where(*, *::before, *::after) {
        box-sizing: border-box;
      }
      html {
        background-color: transparent;
        margin: 0;
        padding: 0;
        width: 100%;
        max-width: 100%;
        overflow-x: hidden;
        overflow-anchor: none;
      }
      body {
        background-color: transparent;
        margin: 0;
        padding: 4px 0 12px 0;
        width: 100%;
        max-width: 100%;
        overflow-x: hidden;
        overflow-anchor: none;
        color: ${defaultTextColor};
        font-size: 16px;
        line-height: 1.65;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif;
      }

      html, body {
        min-height: 0 !important;
        height: auto !important;
      }

      :where(body > div, body > section, body > main, body > article, body > form, body > table, body > details) {
        max-width: 100%;
      }
      /* 状态栏卡片常见写法：内部写死 360 / 392 / 480 / 520px。
         手机气泡通常只有 300 多 px，超出部分会被 iframe 裁掉，看起来像「突出来」。
         这里只限制最大宽度，不动文字大小和图片比例。 */
      :where(body div, body section, body main, body article, body aside, body form,
             body table, body details, body header, body footer, body nav,
             body pre, body blockquote, body figure, body figcaption) {
        max-width: 100% !important;
      }
      summary[style*="list-style: none"]::-webkit-details-marker,
      summary[style*="list-style:none"]::-webkit-details-marker {
        display: none;
      }

      :where(img, video) {
        max-width: 100%;
        height: auto;
      }
      :where(canvas, svg, table) {
        max-width: 100%;
      }

      /* 针对陆戾等角色状态栏（学生证、折叠菜单、淘宝/百度模块）自适应酒馆显示 */
      .cosmos-id-wrapper {
        width: 100% !important;
        max-width: 400px !important;
        margin: 12px auto !important;
        box-sizing: border-box !important;
      }
      .cosmos-id-card,
      .cosmos-details,
      .cosmos-summary,
      .cosmos-content-box {
        width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
      }
      .cosmos-id-body {
        max-width: 100% !important;
        box-sizing: border-box !important;
      }
      .cosmos-info-area {
        min-width: 0 !important;
        box-sizing: border-box !important;
      }
      .cosmos-info-row {
        word-break: break-all !important;
      }

      @media (max-width: 440px) {
        .cosmos-id-wrapper {
          max-width: 100% !important;
          margin: 8px auto !important;
        }
        .cosmos-id-card {
          padding: 12px 10px !important;
        }
        .cosmos-id-body {
          gap: 10px !important;
        }
        .cosmos-photo-area {
          width: 78px !important;
        }
        .cosmos-photo {
          width: 78px !important;
          height: 104px !important;
        }
        .cosmos-summary {
          padding: 8px 12px !important;
          font-size: 12px !important;
        }
        .cosmos-content-box {
          padding: 10px 12px !important;
          font-size: 12px !important;
        }
      }

      /* SillyTavern / TavernHelper Choice & Branching Card Defaults (0 specificity via :where) */
      :where(.fate-card, .choice-card, .menu-item, .option-card, .branch-card, .scenario-card, [data-greeting], [data-target], [data-index]) {
        display: block;
        padding: 16px 20px;
        margin: 12px 0;
        border-radius: 12px;
        border: 1px solid ${cardBorder};
        background: ${cardBg};
        color: ${defaultTextColor};
        cursor: pointer;
        transition: all 0.25s cubic-bezier(0.22, 1, 0.36, 1);
        text-decoration: none;
      }
      :where(.fate-card, .choice-card, .menu-item, .option-card, .branch-card, .scenario-card, [data-greeting], [data-target], [data-index]):hover {
        background: ${cardHoverBg};
        border-color: #38bdf8;
        transform: translateY(-2px);
      }
      :where(.fate-card, .choice-card, .menu-item, .scenario-card, [data-target]):active {
        transform: scale(0.99);
      }

      ::-webkit-scrollbar {
        width: 4px;
        height: 4px;
      }
      ::-webkit-scrollbar-thumb {
        background: rgba(125, 125, 125, 0.2);
        border-radius: 4px;
      }
    </style>
    <script>
      (function() {
        const frameId = "${iframeId}";
        let lastHeight = 0;
        let resizeTimer = null;
        let lastViewportH = 0;
        let lastMeasured = -1;
        let vpLocked = false;

        // Global click listener for branching choice cards (swipe/greeting navigation)
        document.addEventListener('click', function(e) {
          const target = e.target.closest('a, button, [data-index], [data-greeting], [data-target], .choice-card, .fate-card, .menu-item, .option-card, .branch-card, .scenario-card');
          if (!target) return;

          const href = target.getAttribute('href') || '';
          const dataTarget = target.getAttribute('data-target') || target.getAttribute('data-index') || target.getAttribute('data-greeting');
          const text = (target.innerText || target.textContent || '').trim();

          let targetIdx = null;

          if (dataTarget && !isNaN(parseInt(dataTarget))) {
            targetIdx = parseInt(dataTarget);
          } else if (href && /#?(?:greeting|branch|swipe|opt)[-_]?(\\d+)/i.test(href)) {
            const m = href.match(/#?(?:greeting|branch|swipe|opt)[-_]?(\\d+)/i);
            if (m) targetIdx = parseInt(m[1]);
          } else if (href && /^#(\\d+)$/.test(href)) {
            targetIdx = parseInt(href.substring(1));
          } else if (target.matches('[data-greeting], .fate-card, .choice-card, .branch-card, .scenario-card')) {
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

        const VIEWPORT_UNIT_RE = /([0-9.]+)\s*(?:vh|dvh|svh|lvh)/i;

        function oneScreenPx() {
          let h = 0;
          try { h = window.parent && window.parent !== window ? window.parent.innerHeight : 0; } catch (e) { h = 0; }
          if (!h || h < 200) h = 720;
          return Math.round(h);
        }

        function ruleName(rule) {
          try { return (rule.constructor && rule.constructor.name) || ''; } catch (e) { return ''; }
        }

        function ruleAppliesNow(rule) {
          try {
            const name = ruleName(rule);
            if (name === 'CSSMediaRule' || (rule.media && rule.conditionText)) {
              return window.matchMedia(rule.conditionText).matches;
            }
            if (name === 'CSSSupportsRule') {
              return window.CSS && window.CSS.supports ? window.CSS.supports(rule.conditionText) : true;
            }
          } catch (e) { return false; }
          return true;
        }

        function collectSizingRules(rules, out, depth) {
          if (!rules || depth > 4) return;
          for (let r = 0; r < rules.length; r++) {
            let rule = null;
            try { rule = rules[r]; } catch (e) { continue; }
            if (!rule) continue;
            if (!rule.selectorText && rule.cssRules && rule.cssRules.length) {
              if (!ruleAppliesNow(rule)) continue;
              collectSizingRules(rule.cssRules, out, depth + 1);
              continue;
            }
            if (!rule.selectorText || !rule.style) continue;
            const h = rule.style.height || '';
            const mn = rule.style.minHeight || '';
            const mx = rule.style.maxHeight || '';
            if (h || mn || mx) {
              out.push({
                sel: rule.selectorText,
                h: h,
                hImp: rule.style.getPropertyPriority('height') === 'important',
                mn: mn,
                mnImp: rule.style.getPropertyPriority('min-height') === 'important',
                mx: mx,
                mxImp: rule.style.getPropertyPriority('max-height') === 'important',
              });
            }
          }
        }

        function vpToPx(val) {
          const m = String(val || '').match(VIEWPORT_UNIT_RE);
          if (!m) return null;
          const pct = parseFloat(m[1]);
          if (!isFinite(pct) || pct <= 0) return null;
          return Math.max(80, Math.round(oneScreenPx() * (pct / 100)));
        }

        function hasAbsoluteFillChild(el) {
          try {
            const kids = el.querySelectorAll('*');
            for (let i = 0; i < kids.length && i < 40; i++) {
              const pos = window.getComputedStyle(kids[i]).position;
              if (pos === 'absolute') return true;
            }
          } catch (e) {}
          return false;
        }

        let lastRelaxAt = 0;
        let isRelaxing = false;
        function relaxViewportSizedBoxes() {
          isRelaxing = true;
          try {
            if (!document.body) return;
            const nowAt = Date.now();
            if (nowAt - lastRelaxAt < 200) return;
            lastRelaxAt = nowAt;

            const rules = [];
            for (let s = 0; s < document.styleSheets.length; s++) {
              let cssRules = null;
              try { cssRules = document.styleSheets[s].cssRules; } catch (e) { continue; }
              collectSizingRules(cssRules, rules, 0);
            }

            const descendants = document.body.querySelectorAll('*');
            for (let i = 0; i < descendants.length; i++) {
              const el = descendants[i];
              const tag = el.tagName;
              if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META') continue;

              // Find winning height/minHeight/maxHeight in active stylesheets (respecting @media overrides)
              let winH = '', winHImp = false;
              let winMn = '', winMnImp = false;
              let winMx = '', winMxImp = false;
              for (let r = 0; r < rules.length; r++) {
                const rule = rules[r];
                let matched = false;
                try { matched = el.matches(rule.sel); } catch (e) { matched = false; }
                if (!matched) continue;
                if (rule.h && (!winHImp || rule.hImp)) { winH = rule.h; winHImp = rule.hImp; }
                if (rule.mn && (!winMnImp || rule.mnImp)) { winMn = rule.mn; winMnImp = rule.mnImp; }
                if (rule.mx && (!winMxImp || rule.mxImp)) { winMx = rule.mx; winMxImp = rule.mxImp; }
              }

              // Inline styles written by the card itself (ignore values previously written by MIU)
              if (!el.hasAttribute('data-miu-vp-h') && el.style.height) winH = el.style.height;
              if (!el.hasAttribute('data-miu-vp-mn') && el.style.minHeight) winMn = el.style.minHeight;
              if (!el.hasAttribute('data-miu-vp-mx') && el.style.maxHeight) winMx = el.style.maxHeight;

              const hPx = VIEWPORT_UNIT_RE.test(winH) ? vpToPx(winH) : null;
              const mnPx = VIEWPORT_UNIT_RE.test(winMn) ? vpToPx(winMn) : null;
              const mxPx = VIEWPORT_UNIT_RE.test(winMx) ? vpToPx(winMx) : null;

              if (hPx !== null) {
                const m = winH.match(VIEWPORT_UNIT_RE);
                const pct = m ? parseFloat(m[1]) : 100;
                const cs = window.getComputedStyle(el);
                const isShell = cs.overflowY !== 'visible' || pct < 98 || hasAbsoluteFillChild(el);
                // 整屏高度的卡片（100vh / 85vh）在消息里会变成一块比气泡高很多的大块，
                // 按宽度比例收一收（约 9:19.5），超出部分让卡片自己滚动。
                const cardCap = Math.round(Math.max(320, Math.min(oneScreenPx(), (window.innerWidth || 360) * 1.95)));
                const fittedH = hPx > cardCap ? cardCap : hPx;
                const targetH = isShell ? (fittedH + 'px') : 'auto';
                if (el.style.height !== targetH) {
                  el.setAttribute('data-miu-vp-h', '1');
                  el.style.setProperty('height', targetH, 'important');
                }
                if (hPx > cardCap) {
                  el.style.setProperty('overflow-y', 'auto', 'important');
                }
                if (!isShell && mnPx === null) {
                  el.setAttribute('data-miu-vp-mn', '1');
                  el.style.setProperty('min-height', fittedH + 'px', 'important');
                }
              }

              if (mnPx !== null && hPx === null) {
                const cs = window.getComputedStyle(el);
                const needsMin = cs.overflowY !== 'visible' || hasAbsoluteFillChild(el);
                const mnCap = Math.round(Math.max(320, Math.min(oneScreenPx(), (window.innerWidth || 360) * 1.95)));
                const targetMn = needsMin ? (Math.min(mnPx, mnCap) + 'px') : '0px';
                if (el.style.minHeight !== targetMn) {
                  el.setAttribute('data-miu-vp-mn', '1');
                  el.style.setProperty('min-height', targetMn, 'important');
                }
              }

              if (mxPx !== null) {
                const targetMx = mxPx + 'px';
                if (el.style.maxHeight !== targetMx) {
                  el.setAttribute('data-miu-vp-mx', '1');
                  el.style.setProperty('max-height', targetMx, 'important');
                }
              }
            }
          } catch (e) {} finally {
            setTimeout(function() { isRelaxing = false; }, 0);
          }
        }

        function reportHeight(force) {
          if (!document.body) return;

          const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;

          if (force || viewportH !== lastViewportH) relaxViewportSizedBoxes();

          let maxBottom = 0;
          const children = document.body.children;
          for (let i = 0; i < children.length; i++) {
            const el = children[i];
            if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'META') continue;
            let elPos = '';
            try { elPos = window.getComputedStyle(el).position; } catch (e) {}
            if (elPos === 'fixed') continue;
            const rect = el.getBoundingClientRect();
            const bottom = rect.bottom + window.scrollY;
            if (bottom > maxBottom) {
              maxBottom = bottom;
            }
          }

          const bodyRect = document.body.getBoundingClientRect();
          const contentH = Math.max(bodyRect.height, document.body.scrollHeight || 0);
          const measured = Math.max(maxBottom, contentH, 0);

          if (force) vpLocked = false;

          if (!vpLocked && lastViewportH > 0 && viewportH !== lastViewportH && lastMeasured > 0) {
            const ratioBefore = lastMeasured / lastViewportH;
            const ratioNow = measured / viewportH;
            if (Math.abs(ratioBefore - ratioNow) <= 0.02) vpLocked = true;
          }
          lastViewportH = viewportH;
          lastMeasured = measured;

          if (vpLocked) return;

          let padV = 0;
          try {
            const bodyStyle = window.getComputedStyle(document.body);
            padV = (parseFloat(bodyStyle.paddingTop) || 0) + (parseFloat(bodyStyle.paddingBottom) || 0);
          } catch (e) {}
          if (!force && viewportH > 0 && Math.abs(measured - viewportH) <= padV + 4) return;

          const calculated = Math.min(Math.ceil(measured + 16), 30000);

          if (calculated > 20 && Math.abs(calculated - lastHeight) >= 2) {
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

        function debouncedReport(force) {
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(function() {
            reportHeight(force);
          }, 80);
        }

        window.addEventListener('load', function() { reportHeight(true); });
        window.addEventListener('resize', function() { debouncedReport(false); });
        document.addEventListener('DOMContentLoaded', function() { reportHeight(true); });
        document.addEventListener('click', function() { debouncedReport(true); });
        document.addEventListener('transitionend', function() { debouncedReport(false); });
        document.addEventListener('animationend', function() { debouncedReport(false); });
        document.addEventListener('toggle', function() { reportHeight(true); }, true);

        if (window.MutationObserver) {
          const obs = new MutationObserver(function() {
            if (isRelaxing) return;
            debouncedReport(false);
          });
          const obsOpts = {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'open', 'hidden', 'data-active', 'aria-expanded'],
          };
          if (document.body) {
            obs.observe(document.body, obsOpts);
          } else {
            document.addEventListener('DOMContentLoaded', () => {
              if (document.body) obs.observe(document.body, obsOpts);
            });
          }
        }

        if (window.ResizeObserver && document.body) {
          const ro = new ResizeObserver(function() { debouncedReport(false); });
          ro.observe(document.body);
        }

        setTimeout(function() { reportHeight(false); }, 160);
        setTimeout(function() { reportHeight(false); }, 600);

        reportHeight(true);
      })();
    </script>
  `;

    let result = cleanHtml;
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
      result = `<!DOCTYPE html><html><head>${scriptContent}</head><body>${cleanHtml}</body></html>`;
    }
    return result;
  }, [
    hasEnteredViewport,
    cleanHtml,
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
    <div ref={containerRef} className="w-full max-w-full my-2 relative overflow-hidden rounded-2xl transition-all" style={{ contain: 'layout' }}>
      {hasEnteredViewport ? (
        <iframe
          ref={iframeRef}
          srcDoc={finalHtml}
          loading="lazy"
          className="w-full max-w-full border-0 rounded-2xl overflow-hidden bg-transparent block"
          style={{ height: `${iframeHeight}px`, minHeight: '80px', width: '100%', maxWidth: '100%', display: 'block' }}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          title="Tavern Widget"
        />
      ) : (
        <div
          className="w-full max-w-full rounded-2xl"
          style={{ height: `${iframeHeight}px`, minHeight: '80px' }}
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
  const segments = useMemo(() => splitHtmlSegments(content), [content]);

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
      {segments.map((seg, index) => {
        if (!seg.content.trim()) return null;

        if (seg.type === 'html') {
          return (
            <AutoResizingIframe
              key={`widget-${index}`}
              htmlContent={seg.content}
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
