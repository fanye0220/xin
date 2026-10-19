import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Inbox,
  Loader2,
  Plug,
  Power,
  RefreshCw,
  Send,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import {
  isLocalLinkSupported,
  startLocalReceiver,
  stopLocalReceiver,
  clearLocalReceiver,
  getLocalReceiverStatus,
  listOutboxCards,
  removeOutboxCard,
  clearOutbox,
  type LocalReceiverStatus,
  type QueueCardInfo,
} from '../lib/localLink';
import { TtInboxModal } from './TtInboxModal';
import { TtPullModal } from './TtPullModal';

interface Props {
  /** 把接收到的卡片交给 App 走正常导入流程 */
  onImportFiles: (files: File[]) => void;
}

const cardClass =
  'rounded-2xl border bg-white/5 border-white/5 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!border-[#e2e8f0]';
const primaryButtonClass =
  'flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-xs sm:text-sm font-bold transition cursor-pointer active:scale-[0.98] bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-blue-600 [.light-theme_&]:hover:!bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed';
const ghostButtonClass =
  'flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-xs sm:text-sm font-semibold transition cursor-pointer active:scale-[0.98] bg-white/10 hover:bg-white/20 text-white/90 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:hover:!bg-[#e2e8f0] disabled:opacity-40 disabled:cursor-not-allowed';

/** 按钮在手机和大屏保持与主页/详情页标准按钮等大与对齐 */
const actionButtonClass = 'w-full sm:w-auto flex-1 justify-center';

const ttExtRepoUrl = 'https://github.com/fanye0220/TT-tui';

/** 复制文本：先试 Clipboard API，不行退回老办法（安卓 WebView 里更稳） */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到下面的兜底
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** 点一下复制的地址条 */
function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    []
  );

  const handleCopy = async () => {
    const ok = await copyText(text);
    setCopied(ok);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="点一下复制"
      className="w-full min-h-[44px] px-4 flex items-center justify-between gap-2 rounded-2xl text-left transition cursor-pointer active:scale-[0.99] bg-black/25 hover:bg-black/35 border border-white/5 [.light-theme_&]:!bg-white [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:hover:!bg-[#f1f5f9]"
    >
      <code className="min-w-0 truncate text-xs text-blue-400 font-mono [.light-theme_&]:!text-blue-600">
        {text}
      </code>
      <span className="shrink-0 flex items-center gap-1 text-xs font-semibold text-white/60 [.light-theme_&]:!text-[#64748b]">
        {copied ? <Check className="w-4 h-4 text-emerald-400 [.light-theme_&]:!text-emerald-600" /> : <Copy className="w-4 h-4" />}
        {copied ? '已复制' : '复制'}
      </span>
    </button>
  );
}

export function TtLinkTab({ onImportFiles }: Props) {
  const supported = isLocalLinkSupported();

  const [status, setStatus] = useState<LocalReceiverStatus>(() => getLocalReceiverStatus());
  const [busy, setBusy] = useState<'none' | 'start' | 'stop' | 'pull' | 'clear'>('none');
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isInboxOpen, setIsInboxOpen] = useState(false);
  const [isPullOpen, setIsPullOpen] = useState(false);
  const [outboxCards, setOutboxCards] = useState<QueueCardInfo[]>([]);
  const pullAbortRef = useRef(false);

  const refresh = useCallback(() => {
    setStatus(getLocalReceiverStatus());
    setOutboxCards(listOutboxCards());
  }, []);

  // 页面打开期间轮询状态，酒馆推过来时能立刻看到数量变化
  useEffect(() => {
    if (!supported) return;
    refresh();
    // 退到后台就跳过后面的轮询：WebView 的定时器在后台照样跑，白耗电。
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      refresh();
    }, 2500);
    return () => {
      pullAbortRef.current = true;
      window.clearInterval(timer);
    };
  }, [supported, refresh]);

  const handleToggle = async () => {
    if (!supported) return;
    setNotice(null);
    if (status.running) {
      setBusy('stop');
      stopLocalReceiver();
      refresh();
      setBusy('none');
      return;
    }
    setBusy('start');
    const port = startLocalReceiver();
    refresh();
    setBusy('none');
    if (port > 0) {
      setNotice({ type: 'ok', text: `接收服务已开启，正在监听 127.0.0.1:${port}（酒馆里点「连接 MIU」就能自动找到它）` });
    } else {
      setNotice({ type: 'error', text: '开启失败：8791-8795 端口都被占用了，请关掉其他占用端口的 App 再试。' });
    }
  };

  const handleOpenInbox = () => {
    if (!supported || status.pending === 0) return;
    setNotice(null);
    setIsInboxOpen(true);
  };

  const handleRemoveOutboxCard = (id: string) => {
    removeOutboxCard(id);
    refresh();
  };

  const handleClearOutbox = () => {
    if (outboxCards.length === 0) return;
    const cleared = clearOutbox();
    refresh();
    setNotice({ type: 'ok', text: `已清空待发送列表（${cleared} 张）。` });
  };

  const handleClear = () => {
    if (!supported || status.pending === 0) return;
    clearLocalReceiver();
    refresh();
    setNotice({ type: 'ok', text: '已清空待接收列表。' });
  };

  const pendingLabel = status.pending > 0 ? `${status.pending} 张` : '暂无';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="space-y-4"
    >
      <p className="text-xs text-white/50 [.light-theme_&]:!text-[#64748b] leading-relaxed">
        TauriTavern（TT 酒馆）和 MIU 之间双向搬卡，只走本机端口，不登录、不上云。
      </p>

      {!supported && (
        <div className={`${cardClass} p-4 flex items-start gap-3`}>
          <Smartphone className="w-5 h-5 shrink-0 mt-0.5 text-amber-400 [.light-theme_&]:!text-amber-600" />
          <div className="text-xs space-y-1.5">
            <p className="font-semibold text-white/85 [.light-theme_&]:!text-[#0f172a]">
              当前不是安卓 App 环境，本地接收不可用
            </p>
            <p className="text-white/55 [.light-theme_&]:!text-[#64748b] leading-relaxed">
              网页版没有本机端口能力，请用 <span className="text-blue-400 [.light-theme_&]:!text-blue-600">安卓 App（APK）</span> 打开本页。
            </p>
          </div>
        </div>
      )}

      {supported && (
        <>
          {/* 状态卡 */}
          <div className={`${cardClass} p-4`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    status.running
                      ? 'bg-emerald-500/15 text-emerald-400 [.light-theme_&]:!bg-emerald-50 [.light-theme_&]:!text-emerald-600'
                      : 'bg-white/8 text-white/40 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#94a3b8]'
                  }`}
                >
                  <Plug className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white/90 [.light-theme_&]:!text-[#0f172a]">
                    {status.running ? `接收服务运行中 · 端口 ${status.port}` : '接收服务未开启'}
                  </p>
                  <p className="text-xs mt-0.5 text-white/50 [.light-theme_&]:!text-[#64748b]">
                    待接收 {pendingLabel} · 累计接收 {status.total} 张
                  </p>
                </div>
              </div>

              <button
                onClick={refresh}
                className={`${ghostButtonClass} shrink-0 justify-center min-w-[44px] min-h-[44px]`}
                title="刷新状态"
              >
                <RefreshCw className="w-4 h-4" />
                <span className="hidden sm:inline">刷新</span>
              </button>
            </div>

            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2.5 mt-4">
              <button
                onClick={handleToggle}
                disabled={busy === 'start' || busy === 'stop' || busy === 'pull'}
                className={`${status.running ? ghostButtonClass : primaryButtonClass} ${actionButtonClass}`}
              >
                {busy === 'start' || busy === 'stop' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Power className="w-4 h-4" />
                )}
                <span>{status.running ? '关闭接收服务' : '开启接收服务'}</span>
              </button>

              <button
                onClick={() => setIsPullOpen(true)}
                disabled={!status.running}
                className={`${primaryButtonClass} ${actionButtonClass}`}
              >
                <Download className="w-4 h-4" />
                <span>拉取 TauriTavern</span>
              </button>

              <button
                onClick={handleOpenInbox}
                disabled={!status.running || status.pending === 0 || busy !== 'none'}
                className={`${status.pending > 0 ? primaryButtonClass : ghostButtonClass} ${actionButtonClass}`}
              >
                <Inbox className="w-4 h-4" />
                <span>选择要导入的卡{status.pending > 0 ? ` (${status.pending})` : ''}</span>
              </button>

              <button
                onClick={handleClear}
                disabled={status.pending === 0 || busy === 'pull'}
                className={`${ghostButtonClass} ${actionButtonClass}`}
              >
                <Trash2 className="w-4 h-4" />
                <span>清空待接收</span>
              </button>
            </div>
          </div>

          {notice && (
            <div
              className={`${cardClass} p-3 flex items-start gap-2.5 text-xs ${
                notice.type === 'ok'
                  ? 'text-emerald-400 [.light-theme_&]:!text-emerald-600'
                  : 'text-rose-400 [.light-theme_&]:!text-rose-600'
              }`}
            >
              {notice.type === 'ok' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span className="leading-relaxed">{notice.text}</span>
            </div>
          )}

          {/* 待发送到酒馆（MIU -> TT） */}
          <div className={`${cardClass} p-4`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    outboxCards.length > 0
                      ? 'bg-blue-500/15 text-blue-400 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-blue-600'
                      : 'bg-white/8 text-white/40 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#94a3b8]'
                  }`}
                >
                  <Send className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white/90 [.light-theme_&]:!text-[#0f172a]">
                    待发送到酒馆
                  </p>
                  <p className="text-xs mt-0.5 text-white/50 [.light-theme_&]:!text-[#64748b]">
                    {outboxCards.length > 0
                      ? `已排队 ${outboxCards.length} 张 · 去酒馆扩展面板点「接收 MIU 推送」`
                      : '还没有排队中的卡'}
                  </p>
                </div>
              </div>

              {outboxCards.length > 0 && (
                <button
                  onClick={handleClearOutbox}
                  className={`${ghostButtonClass} shrink-0 justify-center min-w-[44px] min-h-[44px]`}
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="hidden sm:inline">清空</span>
                </button>
              )}
            </div>

            {outboxCards.length > 0 && (
              <div className="mt-3 space-y-1.5 max-h-44 overflow-y-auto custom-scrollbar">
                {outboxCards.map((card) => (
                  <div
                    key={card.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-black/20 [.light-theme_&]:!bg-[#f1f5f9]"
                  >
                    <span className="text-xs truncate text-white/80 [.light-theme_&]:!text-[#334155]">
                      {card.name}
                    </span>
                    <button
                      onClick={() => handleRemoveOutboxCard(card.id)}
                      className="text-white/40 hover:text-rose-400 transition cursor-pointer shrink-0"
                      title="从队列移除"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs mt-3 text-white/45 [.light-theme_&]:!text-[#94a3b8] leading-relaxed">
              详情页点「发送到酒馆」→ 选「发送到酒馆（TT 联动）」入队；酒馆里点「接收 MIU 推送」导入。
            </p>
          </div>

          {/* 使用步骤 */}
          <div className={`${cardClass} overflow-hidden`}>
            <button
              onClick={() => setIsGuideOpen(!isGuideOpen)}
              className="w-full flex items-center justify-between p-3 text-sm font-medium transition-colors cursor-pointer text-white/80 hover:bg-white/10 [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:hover:!bg-[#f1f5f9]"
            >
              <span>使用步骤</span>
              {isGuideOpen ? (
                <ChevronUp className="w-4 h-4 text-white/50 [.light-theme_&]:!text-[#64748b]" />
              ) : (
                <ChevronDown className="w-4 h-4 text-white/50 [.light-theme_&]:!text-[#64748b]" />
              )}
            </button>
            <AnimatePresence>
              {isGuideOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="p-4 pt-0 text-xs space-y-2.5 border-t mt-2 text-white/60 border-white/5 [.light-theme_&]:!text-[#64748b] [.light-theme_&]:!border-[#e2e8f0]">
                    <div className="space-y-1.5">
                      <p>1. 酒馆 → 扩展面板 → 安装扩展 → 填这个地址（只填仓库地址）：</p>
                      <CopyChip text={ttExtRepoUrl} />
                    </div>
                    <p>2. MIU 本页点「开启接收服务」（端口默认 8791）。</p>
                    <p>3. 酒馆 → 扩展面板 → MIU 联动 → 点「连接 MIU」。</p>
                    <p>4. 点「推送当前角色」或「推送全部角色卡」。</p>
                    <p>5. 回 MIU 点「选择要导入的卡」→ 勾选 → 导入。</p>
                    <p>想直接在 MIU 里挑 TauriTavern 的卡：点「拉取 TauriTavern」→ 勾选 → 拉取选中。</p>
                    <p>反向：详情页「发送到酒馆」→ 选「发送到酒馆（TT 联动）」→ 酒馆点「接收 MIU 推送」。</p>
                    <p className="text-amber-400/80 [.light-theme_&]:!text-amber-600">
                      一次别推太多（几百张内），推完尽快切回 MIU 导入。
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <TtInboxModal
            isOpen={isInboxOpen}
            onClose={() => setIsInboxOpen(false)}
            onImportFiles={onImportFiles}
          />

          <TtPullModal
            isOpen={isPullOpen}
            onClose={() => setIsPullOpen(false)}
            onImportFiles={onImportFiles}
          />
        </>
      )}
    </motion.div>
  );
}
