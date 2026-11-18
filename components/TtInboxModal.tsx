import { isFallbackMiuImage } from "../lib/avatar";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, Check, Inbox, Loader2, Search, Trash2, UserRound, X } from 'lucide-react';
import {
  listPendingCards,
  pullCardById,
  dropCardById,
  getPendingCardThumb,
  type QueueCardInfo,
} from '../lib/localLink';
import { useInView } from '../lib/useInView';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** 读取完成后交给 App 走正常导入流程 */
  onImportFiles: (files: File[]) => void;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(ts: number): string {
  if (!ts) return '';
  const date = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 待接收卡的随卡小头像：酒馆推卡时就顺手带了一张 112px 小图，
 * 这里只是划进视口才读一次，不会再去拉整张卡。
 */
function InboxAvatar({ id, hasThumb }: { id: string; hasThumb?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!inView) return;
    const ready = getPendingCardThumb(id);
    if (ready) {
      setUrl(ready);
      return;
    }
    // 最多问 20 次（约 10 秒）就收工：原生那边生成失败会一直返回空，
    // 不收手的话这个定时器会跟着页面在后台一直转。
    let tries = 0;
    const interval = window.setInterval(() => {
      const next = getPendingCardThumb(id);
      if (next) {
        setUrl(next);
        window.clearInterval(interval);
        return;
      }
      tries += 1;
      if (tries >= 20) window.clearInterval(interval);
    }, 500);
    return () => window.clearInterval(interval);
  }, [inView, hasThumb, id]);

  return (
    <div
      ref={ref}
      className="w-11 h-11 rounded-xl overflow-hidden shrink-0 bg-white/5 [.light-theme_&]:!bg-[#f1f5f9] flex items-center justify-center"
    >
      {url ? (
        <img src={url} alt="" className={`w-full h-full ${isFallbackMiuImage(url) ? "object-contain p-1 bg-white" : "object-cover"}`} decoding="async" />
      ) : (
        <UserRound className="w-4 h-4 text-white/25 [.light-theme_&]:!text-slate-300" />
      )}
    </div>
  );
}

export function TtInboxModal({ isOpen, onClose, onImportFiles }: Props) {
  const [cards, setCards] = useState<QueueCardInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<'none' | 'pull' | 'drop'>('none');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const refresh = React.useCallback(() => {
    const list = listPendingCards();
    setCards(list);
    setSelected(new Set(list.map((card) => card.id)));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setError('');
    setProgress('');
    setBusy('none');
    refresh();
  }, [isOpen, refresh]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return cards;
    return cards.filter((card) => card.name.toLowerCase().includes(keyword));
  }, [cards, query]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleImport = async () => {
    const targets = filtered.filter((card) => selected.has(card.id));
    if (targets.length === 0 || busy !== 'none') return;

    setBusy('pull');
    setError('');
    const files: File[] = [];

    for (let index = 0; index < targets.length; index++) {
      const card = targets[index];
      setProgress(`正在读取 ${index + 1} / ${targets.length}：${card.name}`);
      const file = await pullCardById(card.id, index + 1);
      if (file) files.push(file);
    }

    setProgress('');
    setBusy('none');
    refresh();

    if (files.length === 0) {
      setError('没有取到可导入的卡片（内容可能已损坏）。');
      return;
    }
    onImportFiles(files);
    onClose();
  };

  const handleDrop = () => {
    const targets = filtered.filter((card) => selected.has(card.id));
    if (targets.length === 0 || busy !== 'none') return;
    setBusy('drop');
    targets.forEach((card) => dropCardById(card.id));
    refresh();
    setBusy('none');
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm bg-black/75 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="version-modal-box rounded-3xl p-5 sm:p-6 w-[92vw] sm:w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] relative overflow-hidden"
        >
          <div className="flex items-center justify-between pb-3.5 border-b version-modal-border relative z-10">
            <div>
              <h3 className="text-base sm:text-lg font-bold version-modal-title flex items-center gap-2">
                <Inbox className="w-5 h-5 opacity-80 text-blue-500" />
                待接收的卡（来自酒馆）
              </h3>
              <p className="text-xs sm:text-sm version-modal-desc mt-0.5">
                勾选你想入库的卡，未勾选的会留在待接收列表里
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full version-modal-close-btn flex items-center justify-center cursor-pointer transition shadow-xs"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>

          {cards.length > 0 && (
            <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2.5 mt-3 relative z-10">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40 [.light-theme_&]:!text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索卡名"
                  className="w-full pl-9 pr-3 py-2.5 rounded-2xl text-xs sm:text-sm outline-none border bg-white/5 border-white/10 text-white placeholder:text-white/30 [.light-theme_&]:!bg-white [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a]"
                />
              </div>
              <div className="flex items-center gap-2 shrink-0 justify-between sm:justify-end">
                <span className="text-xs font-semibold text-white/60 [.light-theme_&]:!text-slate-600">
                  已选中 <strong className="text-blue-400 [.light-theme_&]:!text-blue-600 font-bold">{selected.size}</strong> / {cards.length} 项
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelected(new Set(filtered.map((card) => card.id)))}
                    className="text-xs px-3 py-1.5 min-h-[36px] rounded-xl transition cursor-pointer active:scale-[0.98] font-semibold bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-blue-600 [.light-theme_&]:hover:!bg-blue-100"
                  >
                    全选 ({filtered.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="text-xs px-3 py-1.5 min-h-[36px] rounded-xl transition cursor-pointer active:scale-[0.98] font-semibold bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-blue-600 [.light-theme_&]:hover:!bg-blue-100"
                  >
                    清空
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto space-y-2 sm:space-y-2.5 pr-1 my-3 max-h-[50vh] custom-scrollbar relative z-10">
            {cards.length === 0 ? (
              <div className="py-12 text-center text-sm version-modal-desc">
                暂无待接收的卡，去酒馆扩展里点「推送当前角色」吧
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-sm version-modal-desc">
                没有符合「{query}」的卡
              </div>
            ) : (
              filtered.map((card) => {
                const isSelected = selected.has(card.id);
                return (
                  <div
                    key={card.id}
                    onClick={() => toggle(card.id)}
                    className={`p-3.5 rounded-2xl transition cursor-pointer flex items-center justify-between gap-3 border version-candidate-card select-none outline-none focus:outline-none ${isSelected ? 'is-selected' : ''}`}
                  >
                    <InboxAvatar id={card.id} hasThumb={card.hasThumb} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm sm:text-base truncate version-candidate-name">
                          {card.name || '未命名卡片'}
                        </h4>
                        <span className="text-xs px-2 py-0.5 rounded-full font-mono font-semibold version-candidate-badge shrink-0">
                          {formatBytes(card.bytes)}
                        </span>
                      </div>
                      <p className="text-xs truncate mt-1 font-normal version-candidate-sub">
                        {formatTime(card.ts)}
                      </p>
                    </div>
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center transition shrink-0 version-candidate-radio ${isSelected ? 'is-selected' : ''}`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {(progress || error) && (
            <div className="mb-2 text-xs relative z-10 flex items-center gap-2 text-white/70 [.light-theme_&]:!text-[#334155]">
              {progress ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span className="truncate">{progress}</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                  <span className="truncate">{error}</span>
                </>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-3 border-t version-modal-border relative z-10">
            <button
              type="button"
              disabled={selected.size === 0 || busy !== 'none'}
              onClick={handleDrop}
              className="flex-1 py-3 px-4 rounded-2xl font-semibold text-xs sm:text-sm cursor-pointer transition active:scale-95 text-center disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 [.light-theme_&]:!bg-rose-50 [.light-theme_&]:!text-rose-600 [.light-theme_&]:hover:!bg-rose-100"
            >
              <Trash2 className="w-4 h-4" />
              丢弃
            </button>
            <button
              type="button"
              disabled={selected.size === 0 || busy !== 'none'}
              onClick={handleImport}
              className="flex-1 py-3 px-4 rounded-2xl bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-blue-600 [.light-theme_&]:hover:!bg-blue-100 font-bold text-xs sm:text-sm disabled:opacity-40 flex items-center justify-center gap-2 transition active:scale-95 cursor-pointer"
            >
              {busy === 'pull' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Inbox className="w-4 h-4" />}
              导入 ({selected.size})
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}
