import {StrictMode, Component, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

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