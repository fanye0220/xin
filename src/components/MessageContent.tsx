import React, { useRef, useEffect, useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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

  // Clean and prepare HTML content - unwrap code fences like ```html or ```
  let cleanHtml = htmlContent.trim();
  cleanHtml = cleanHtml.replace(/^```[a-zA-Z0-9_-]*\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  const isLight = themeMode === 'light';
  const defaultTextColor = isLight ? '#0f172a' : '#f8fafc';
  const cardBg = isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.04)';
  const cardBorder = isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';
  const cardHoverBg = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.09)';

  const swipesJson = JSON.stringify(swipes || []);

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
      }
      body {
        background: transparent !important;
        margin: 0 !important;
        padding: 4px 0 16px 0 !important;
        box-sizing: border-box !important;
        width: 100% !important;
        overflow-x: hidden !important;
        color: ${defaultTextColor};
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif;
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
        const cName = ${JSON.stringify(characterName)};
        let lastHeight = 0;
        let resizeTimer = null;

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

        function reportHeight() {
          if (!document.body) return;
          
          let maxBottom = 0;
          const children = document.body.children;
          for (let i = 0; i < children.length; i++) {
            const el = children[i];
            if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'META') continue;
            const rect = el.getBoundingClientRect();
            const bottom = rect.bottom + window.scrollY;
            if (bottom > maxBottom) {
              maxBottom = bottom;
            }
          }
          
          const scrollH = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
          const offsetH = document.documentElement.offsetHeight || document.body.offsetHeight || 0;
          let calculated = Math.max(maxBottom > 0 ? maxBottom + 20 : 0, scrollH, offsetH);
          calculated = Math.ceil(calculated);

          if (calculated > 20 && Math.abs(calculated - lastHeight) >= 2) {
            lastHeight = calculated;
            window.parent.postMessage({ type: 'th_resize', id: frameId, height: calculated }, '*');
          }
        }

        function debouncedReport() {
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(reportHeight, 30);
        }

        window.addEventListener('load', reportHeight);
        window.addEventListener('resize', debouncedReport);
        document.addEventListener('DOMContentLoaded', reportHeight);
        document.addEventListener('click', debouncedReport);
        document.addEventListener('transitionend', debouncedReport);
        document.addEventListener('animationend', debouncedReport);
        document.addEventListener('toggle', reportHeight, true);

        if (window.MutationObserver) {
          const obs = new MutationObserver(debouncedReport);
          if (document.body) {
            obs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
          } else {
            document.addEventListener('DOMContentLoaded', () => {
              obs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
            });
          }
        }

        if (window.ResizeObserver && document.body) {
          const ro = new ResizeObserver(debouncedReport);
          ro.observe(document.body);
        }

        // Periodic check for dynamic async rendering
        let checks = 0;
        const interval = setInterval(() => {
          reportHeight();
          checks++;
          if (checks > 20) clearInterval(interval);
        }, 150);

        reportHeight();
      })();
    </script>
  `;

  let finalHtml = cleanHtml;
  if (/<head[^>]*>/i.test(finalHtml)) {
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
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
          >
            {seg.content}
          </ReactMarkdown>
        );
      })}
    </div>
  );
};
