import {StrictMode, Component, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// iOS / 老浏览器兼容：crypto.randomUUID 在 iOS 15.4 以下或非 HTTPS 环境不存在，
// 而项目里多处用它生成 id。这里只补一个等价实现；新设备上函数已存在，直接跳过。
function ensureRandomUUID() {
  const g: any = globalThis;
  if (!g.crypto || typeof g.crypto.randomUUID === 'function') return;
  const fn = () => {
    const bytes = new Uint8Array(16);
    if (typeof g.crypto.getRandomValues === 'function') {
      g.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex: string[] = [];
    for (let i = 0; i < 16; i++) hex.push((bytes[i] + 0x100).toString(16).slice(1));
    return (
      hex.slice(0, 4).join('') + '-' +
      hex.slice(4, 6).join('') + '-' +
      hex.slice(6, 8).join('') + '-' +
      hex.slice(8, 10).join('') + '-' +
      hex.slice(10, 16).join('')
    );
  };
  try {
    g.crypto.randomUUID = fn;
  } catch {}
  try {
    if (typeof g.crypto.randomUUID !== 'function' && g.Crypto && g.Crypto.prototype) {
      g.Crypto.prototype.randomUUID = fn;
    }
  } catch {}
}
ensureRandomUUID();

// iOS WebClip（添加到主屏幕）独立模式下跳转保护：防止点击内部链接弹回 Safari 浏览器
if (typeof window !== 'undefined' && (window.navigator as any).standalone) {
  document.addEventListener('click', (e: MouseEvent) => {
    const target = (e.target as HTMLElement)?.closest('a');
    if (target && target.href && target.target !== '_blank') {
      const url = new URL(target.href, window.location.href);
      if (url.origin === window.location.origin) {
        e.preventDefault();
        window.location.href = target.href;
      }
    }
  }, false);
}

// Load theme preference on startup
if (localStorage.getItem('tavern_theme') === 'light') {
  document.documentElement.classList.add('light-theme');
}

// 崩溃兜底：出错时把错误文字直接显示在屏幕上，而不是白屏。
// 只在真出错时出现，正常使用完全看不到；定位完问题可以删掉这一段。
function showCrashInfo(title: string, detail: string) {
  try {
    let box = document.getElementById('miu-crash-info');
    if (!box) {
      box = document.createElement('div');
      box.id = 'miu-crash-info';
      box.style.cssText = 'position:fixed;left:0;right:0;top:0;bottom:0;z-index:2147483647;background:#0b0b0d;color:#ff9b9b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.6;padding:14px;overflow:auto;white-space:pre-wrap;word-break:break-word;-webkit-user-select:text;user-select:text';
      (document.body || document.documentElement).appendChild(box);
    }
    box.textContent = '[MIU 出错信息 · 请把这一段截图发给开发者]\n' + title + '\n\n' + detail;
  } catch {}
}

window.addEventListener('error', (e: any) => {
  const err = e && e.error;
  showCrashInfo(
    'Error: ' + ((e && e.message) || ''),
    ((e && e.filename) || '') + ':' + ((e && e.lineno) || 0) + ':' + ((e && e.colno) || 0) + '\n' + ((err && (err.stack || err.message)) || '')
  );
});

window.addEventListener('unhandledrejection', (e: any) => {
  const r = e && e.reason;
  showCrashInfo('UnhandledRejection: ' + ((r && r.message) || String(r)), (r && r.stack) || '');
});

class CrashBoundary extends Component<{children: ReactNode}, {crashed: boolean}> {
  constructor(props: {children: ReactNode}) {
    super(props);
    this.state = {crashed: false};
  }
  static getDerivedStateFromError() {
    return {crashed: true};
  }
  componentDidCatch(error: any, info: any) {
    showCrashInfo(
      'React 渲染错误: ' + ((error && error.message) || String(error)),
      ((error && error.stack) || '') + '\n\n组件栈:' + ((info && info.componentStack) || '')
    );
  }
  render() {
    if (this.state.crashed) return null;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CrashBoundary>
      <App />
    </CrashBoundary>
  </StrictMode>,
);