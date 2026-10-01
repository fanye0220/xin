import React, { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

interface AutoResizingIframeProps {
  htmlContent: string;
}

const AutoResizingIframe: React.FC<AutoResizingIframeProps> = ({ htmlContent }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (
        event.source === iframeRef.current?.contentWindow &&
        event.data?.type === 'resize' &&
        event.data?.height
      ) {
        if (iframeRef.current) {
          iframeRef.current.style.height = `${event.data.height}px`;
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  let injectedHtml = htmlContent;
  const scriptContent = `
    <style>
      body { margin: 0 !important; padding: 0 !important; padding-bottom: 20px !important; box-sizing: border-box !important; }
    </style>
    <script>
      let lastHeight = 0;
      function reportHeight() {
        if (!document.body) return;
        let maxBottom = 0;
        const children = document.body.children;
        for (let i = 0; i < children.length; i++) {
          if (children[i].tagName === 'SCRIPT' || children[i].tagName === 'STYLE') continue;
          const rect = children[i].getBoundingClientRect();
          const bottom = rect.bottom + window.scrollY;
          if (bottom > maxBottom) {
            maxBottom = bottom;
          }
        }
        const scrollHeight = document.documentElement.scrollHeight;
        let newHeight = maxBottom > 0 ? Math.ceil(maxBottom) + 20 : scrollHeight;
        
        if (newHeight !== lastHeight) {
          lastHeight = newHeight;
          window.parent.postMessage({ type: 'resize', height: newHeight }, '*');
        }
      }
      window.addEventListener('load', reportHeight);
      window.addEventListener('resize', reportHeight);
      const observer = new MutationObserver(reportHeight);
      if (document.body) {
         observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
         if (window.ResizeObserver) {
           const resizeObserver = new ResizeObserver(reportHeight);
           resizeObserver.observe(document.body);
         }
      }
      document.body.addEventListener('toggle', reportHeight, true);
      reportHeight();
    </script>
  `;

  if (/<\/body>/i.test(injectedHtml)) {
    injectedHtml = injectedHtml.replace(/<\/body>/i, `${scriptContent}</body>`);
  } else if (/<\/html>/i.test(injectedHtml)) {
    injectedHtml = injectedHtml.replace(/<\/html>/i, `${scriptContent}</html>`);
  } else {
    injectedHtml += scriptContent;
  }

  return (
    <iframe
      ref={iframeRef}
      srcDoc={injectedHtml}
      className="w-full border-0 rounded-lg overflow-hidden bg-transparent"
      style={{ minHeight: '150px', width: '100%', display: 'block' }}
      sandbox="allow-scripts allow-same-origin allow-popups"
    />
  );
};

interface MessageContentProps {
  content: string;
}

export const MessageContent: React.FC<MessageContentProps> = ({ content }) => {
  // Regex to match a complete HTML document, optionally wrapped in markdown fencing
  const htmlRegex = /(?:^\s*\`\`\`(?:html)?\s*)?(<(?:!DOCTYPE html|html)[\s\S]*?<\/html>)(?:\s*\`\`\`\s*$)?/im;
  
  const fragments = content.split(htmlRegex);

  return (
    <div className="flex flex-col gap-2 w-full max-w-full">
      {fragments.map((fragment, index) => {
        if (!fragment) return null;
        if (/^<(?:!DOCTYPE html|html|style)/i.test(fragment.trim()) && /<\/html>$/i.test(fragment.trim())) {
          return <AutoResizingIframe key={index} htmlContent={fragment} />;
        } else if (fragment.trim()) {
           return (
            <ReactMarkdown key={index} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
               {fragment}
            </ReactMarkdown>
          );
        }
        return null;
      })}
    </div>
  );
};
