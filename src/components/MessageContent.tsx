import React, { useRef, useEffect, useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import { splitHtmlSegments } from '../lib/htmlSegments';

interface AutoResizingIframeProps {
  htmlContent: string;
  themeMode?: 'light' | 'dark';
  swipes?: string[];
  characterName?: string;
}

export const AutoResizingIframe: React.FC<AutoResizingIframeProps> = ({ 
  htmlContent,
  themeMode = 'dark',
  swipes = [],
  characterName = 'Character'
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState<number>(200);
  const iframeId = useMemo(() => `th-frame-${Math.random().toString(36).substring(2, 9)}`, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (
        event.data?.type === 'th_resize' &&
        event.data?.id === iframeId &&
        typeof event.data?.height === 'number'
      ) {
        const h = Math.max(60, Math.ceil(event.data.height));
        setIframeHeight(h);
        if (iframeRef.current) {
          iframeRef.current.style.height = `${h}px`;
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [iframeId]);

  // Clean and prepare HTML content - unwrap code fences like ```html or ``` and unescape literal \r\n
  let cleanHtml = htmlContent
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .trim();
  cleanHtml = cleanHtml.replace(/^```[a-zA-Z0-9_-]*\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  if (cleanHtml.includes('\\n') && !cleanHtml.includes('\n')) {
    cleanHtml = cleanHtml.replace(/\\n/g, '\n');
  }

  const isLight = themeMode === 'light';
  const defaultTextColor = isLight ? '#0f172a' : '#f8fafc';
  const cardBg = isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.04)';
  const cardBorder = isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';
  const cardHoverBg = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.09)';

  // 这段内容会被塞进 iframe 的内联 <script> 里，必须把 "<" 转义成 \u003c：
  // 否则卡片正文里只要出现 </script>，就会提前闭合我们注入的脚本，
  // 后面那一大段 JSON 会被浏览器当成正文渲染出来（就是「开场白渲染不出来」的根因）。
  const safeForInlineScript = (json: string) =>
    json.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

  const swipesJson = safeForInlineScript(JSON.stringify(swipes || []));

  const scriptContent = `
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>
    <style>
      :root {
        color-scheme: ${isLight ? 'light' : 'dark'};
      }
      html {
        background: transparent !important;
        margin: 0 !important;
        padding: 0 !important;
        width: 100% !important;
        overflow-x: hidden !important;
        overflow-anchor: none !important;
      }
      body {
        background: transparent !important;
        margin: 0 !important;
        padding: 4px 0 16px 0 !important;
        box-sizing: border-box !important;
        width: 100% !important;
        overflow-x: hidden !important;
        overflow-anchor: none !important;
        color: ${defaultTextColor};
        font-size: 16px !important;
        line-height: 1.65 !important;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif;
      }

      /* Prevent min-height: 100vh / height: 100vh in card HTML templates from forcing vertical centering or huge scroll offset */
      html, body, .opening-selector-body, .card-container-sayo, [class*="card-container"], [class*="story-card"] {
        min-height: 0 !important;
        height: auto !important;
      }
      .card-container-sayo, [class*="card-container"], [class*="story-card"] {
        align-items: flex-start !important;
      }
      
      /* SillyTavern / TavernHelper Choice & Branching Card Defaults */
      .fate-card, .choice-card, .menu-item, .option-card, .branch-card, .scenario-card, [data-greeting], [data-target], [data-index] {
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
      .fate-card:hover, .choice-card:hover, .menu-item:hover, .option-card:hover, .branch-card:hover, .scenario-card:hover, [data-greeting]:hover, [data-target]:hover, [data-index]:hover {
        background: ${cardHoverBg};
        border-color: #38bdf8;
        transform: translateY(-2px);
      }
      .fate-card:active, .choice-card:active, .menu-item:active, .scenario-card:active, [data-target]:active {
        transform: scale(0.99);
      }

      /* Prevent iframe internal scrollbars */
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
        const charSwipes = ${swipesJson};
        const cName = ${safeForInlineScript(JSON.stringify(characterName))};
        let lastHeight = 0;
        let resizeTimer = null;
        let lastViewportH = 0;
        let lastMeasured = -1;
        // 卡片内容跟着 iframe 视口一起缩放（vh / 百分比写的高度）时锁死高度，
        // 否则「改高度 → 视口变 → 内容变 → 再改高度」会一路涨到几千 px。
        let vpLocked = false;

        // Local variable store for TavernHelper / STscript
        const varStoreKey = 'tavern_vars_' + encodeURIComponent(cName || 'default');
        let storedVars = {};
        try {
          storedVars = JSON.parse(localStorage.getItem(varStoreKey) || '{}');
        } catch(e) {}

        const saveVars = function() {
          try {
            localStorage.setItem(varStoreKey, JSON.stringify(storedVars));
          } catch(e) {}
        };

        // Mock complete SillyTavern & TavernHelper Environment for interactive character cards
        window.getChatMessages = async function(msgId, options) {
          return [
            {
              message_id: 0,
              swipe_id: 0,
              swipes: charSwipes.length > 0 ? charSwipes : [""],
              mes: charSwipes[0] || ""
            }
          ];
        };

        window.setChatMessage = async function(content, msgId, options) {
          let swipeId = 0;
          if (options && typeof options.swipe_id === 'number') {
            swipeId = options.swipe_id;
          } else if (typeof msgId === 'number') {
            swipeId = msgId;
          }
          window.parent.postMessage({ type: 'jump_greeting', targetIndex: swipeId }, '*');
        };

        window.TavernHelper = {
          getVariable: function(key, def) {
            return storedVars[key] !== undefined ? storedVars[key] : def;
          },
          setVariable: function(key, val) {
            storedVars[key] = val;
            saveVars();
            return val;
          },
          getGlobalVariable: function(key, def) {
            return window.TavernHelper.getVariable(key, def);
          },
          setGlobalVariable: function(key, val) {
            return window.TavernHelper.setVariable(key, val);
          },
          getVariables: function() {
            return { ...storedVars };
          },
          setVariables: function(obj) {
            Object.assign(storedVars, obj);
            saveVars();
          },
          executeSlashCommand: function(cmd) {
            window.triggerSlash(cmd);
          },
          getChatMessages: window.getChatMessages,
          setChatMessages: async function(updates) {
            if (Array.isArray(updates) && updates[0] && typeof updates[0].swipe_id === 'number') {
              window.parent.postMessage({ type: 'jump_greeting', targetIndex: updates[0].swipe_id }, '*');
            }
          },
          setGreeting: function(index) {
            window.parent.postMessage({ type: 'jump_greeting', targetIndex: parseInt(index) }, '*');
          },
          swipe: function(index) {
            window.parent.postMessage({ type: 'jump_greeting', targetIndex: parseInt(index) }, '*');
          },
          trigger: function(event, ...args) {},
          eventOn: function(event, fn) {}
        };

        window.SillyTavern = {
          ...window.TavernHelper,
          getContext: function() {
            return {
              characterId: 0,
              name1: 'User',
              name2: cName,
              chat: [
                {
                  message_id: 0,
                  swipe_id: 0,
                  swipes: charSwipes.length > 0 ? charSwipes : [""],
                  mes: charSwipes[0] || ""
                }
              ],
              characters: [{ name: cName }],
              eventSource: { makeEvent: function() {}, on: function() {} }
            };
          },
          chat: [
            {
              message_id: 0,
              swipe_id: 0,
              swipes: charSwipes.length > 0 ? charSwipes : [""],
              mes: charSwipes[0] || ""
            }
          ],
          saveChat: async function() {},
          reloadCurrentChat: async function() {}
        };

        window.setGreeting = window.TavernHelper.setGreeting;
        window.selectGreeting = window.TavernHelper.setGreeting;
        window.swipe = window.TavernHelper.swipe;
        window.triggerSlash = function(cmd) {
          const match = (cmd || '').match(/(?:\\/swipe|\\/greeting|\\/branch)\\s+(\\d+)/i);
          if (match) {
            window.parent.postMessage({ type: 'jump_greeting', targetIndex: parseInt(match[1]) }, '*');
          }
        };

        window.eventOn = function() {};
        window.tavern_events = {
          USER_MESSAGE_RENDERED: 'user_msg_rendered',
          CHARACTER_MESSAGE_RENDERED: 'char_msg_rendered',
          MESSAGE_UPDATED: 'msg_updated',
          CHAT_CHANGED: 'chat_changed',
          CHAT_LOADED: 'chat_loaded'
        };
        window.errorCatched = function(fn) { return fn; };
        window.retrieveDisplayedMessage = function() { return null; };

        // Global click listener for branching choice cards
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
          } else {
            // Check text prefix like "1. 庄家的邀请" or "「常规」 1. 庄家的邀请"
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

        function reportHeight(force) {
          if (!document.body) return;

          const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;

          let maxBottom = 0;
          const children = document.body.children;
          for (let i = 0; i < children.length; i++) {
            const el = children[i];
            if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'META') continue;
            // fixed 元素贴的是 iframe 视口底，不代表文档内容高度，会把高度一直顶大
            let elPos = '';
            try { elPos = window.getComputedStyle(el).position; } catch (e) {}
            if (elPos === 'fixed') continue;
            const rect = el.getBoundingClientRect();
            const bottom = rect.bottom + window.scrollY;
            if (bottom > maxBottom) {
              maxBottom = bottom;
            }
          }

          // 只量「正文自身高度」。
          // 不能用 documentElement.scrollHeight / offsetHeight：标准模式下它们至少等于 iframe 视口高度，
          // 于是内容不足一屏时永远缩不回去，底部留一大片空白（短状态栏最明显）。
          const bodyRect = document.body.getBoundingClientRect();
          const contentH = Math.max(bodyRect.height, document.body.scrollHeight || 0);
          const measured = Math.max(maxBottom, contentH, 0);

          // force：这次测量是内容真的变了（DOM 变更、点击展开、加载完成）触发的，
          // 不是我们自己改高度把视口带偏后的回响，这种才允许解锁重算。
          if (force) vpLocked = false;

          // 视口一变、measured 就按同一比例跟着变 → 内容是 vh / 百分比撑出来的（例如 height:100vh）。
          // 这种情况必须锁死：改高度 → 视口变 → 内容变 → 再改高度，会一路涨到几千 px。
          if (!vpLocked && lastViewportH > 0 && viewportH !== lastViewportH && lastMeasured > 0) {
            const ratioBefore = lastMeasured / lastViewportH;
            const ratioNow = measured / viewportH;
            if (Math.abs(ratioBefore - ratioNow) <= 0.02) vpLocked = true;
          }
          lastViewportH = viewportH;
          lastMeasured = measured;

          if (vpLocked) return;

          // 内容和视口几乎一样高：多半是 vh 撑出来的，维持现状，别再互相追着变。
          // 阈值要把 body 上下 padding 算进去（bodyRect 是 border-box，含 padding）。
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

        // force=true 表示源头是内容变化；resize / 定时器只是我们改完高度后的回响，不能解锁。
        function debouncedReport(force) {
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(function() { reportHeight(force); }, 30);
        }

        window.addEventListener('load', function() { reportHeight(true); });
        window.addEventListener('resize', function() { debouncedReport(false); });
        document.addEventListener('DOMContentLoaded', function() { reportHeight(true); });
        document.addEventListener('click', function() { debouncedReport(true); });
        document.addEventListener('transitionend', function() { debouncedReport(true); });
        document.addEventListener('animationend', function() { debouncedReport(true); });
        document.addEventListener('toggle', function() { reportHeight(true); }, true);

        if (window.MutationObserver) {
          const obs = new MutationObserver(function() { debouncedReport(true); });
          if (document.body) {
            obs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
          } else {
            document.addEventListener('DOMContentLoaded', () => {
              obs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
            });
          }
        }

        if (window.ResizeObserver && document.body) {
          const ro = new ResizeObserver(function() { debouncedReport(false); });
          ro.observe(document.body);
        }

        // Periodic check for dynamic async rendering
        let checks = 0;
        const interval = setInterval(() => {
          reportHeight(false);
          checks++;
          if (checks > 20) clearInterval(interval);
        }, 150);

        reportHeight(true);
      })();
    </script>
  `;

  let finalHtml = cleanHtml;
  if (/<\/head>/i.test(finalHtml)) {
    finalHtml = finalHtml.replace(/<\/head>/i, `${scriptContent}</head>`);
  } else if (/<head[^>]*>/i.test(finalHtml)) {
    finalHtml = finalHtml.replace(/<head[^>]*>/i, `$&${scriptContent}`);
  } else if (/<\/body>/i.test(finalHtml)) {
    finalHtml = finalHtml.replace(/<\/body>/i, `${scriptContent}</body>`);
  } else if (/<\/html>/i.test(finalHtml)) {
    finalHtml = finalHtml.replace(/<\/html>/i, `${scriptContent}</html>`);
  } else {
    finalHtml = `${scriptContent}\n${finalHtml}`;
  }

  return (
    <div className="w-full my-2 relative overflow-hidden rounded-2xl transition-all">
      <iframe
        ref={iframeRef}
        srcDoc={finalHtml}
        className="w-full border-0 rounded-2xl overflow-hidden bg-transparent block"
        style={{ 
          height: `${iframeHeight}px`, 
          minHeight: '80px', 
          width: '100%', 
          display: 'block' 
        }}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        title="Tavern Widget"
      />
    </div>
  );
};

interface MessageContentProps {
  content: string;
  themeMode?: 'light' | 'dark';
  swipes?: string[];
  characterName?: string;
}

export const MessageContent: React.FC<MessageContentProps> = ({ 
  content, 
  themeMode = 'dark',
  swipes = [],
  characterName = 'Character'
}) => {
  // 按标签配对拆成 Markdown 段 / HTML 组件段（状态栏、选项卡等）
  const segments = useMemo(() => splitHtmlSegments(content), [content]);

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
};
