import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, 
  Search, 
  RefreshCw, 
  Sparkles, 
  ExternalLink, 
  Check, 
  AlertCircle, 
  Link2, 
  Loader2, 
  ArrowRight,
  ShieldCheck,
  Edit3,
  CheckCircle2,
  Clock,
  Radio
} from 'lucide-react';
import { CharacterCard, getAllCharacters, saveCharacter } from '../lib/db';
import { checkForCardUpdate, CardUpdateResult } from '../lib/cardUpdater';
import { resolveAvatarUrl, getFallbackAvatar } from '../lib/avatar';
import { CardUpdateDiffModal } from './CardUpdateDiffModal';
import { useBackHandler } from '../lib/useBackHandler';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCardsUpdated: () => void;
  isLightMode?: boolean;
}

export function CardSubscriptionCenterModal({
  isOpen,
  onClose,
  onCardsUpdated,
  isLightMode = false
}: Props) {
  useBackHandler(isOpen, () => {
    if (diffModalResult && diffModalChar) {
      setDiffModalResult(null);
      setDiffModalChar(null);
      return true;
    }
    onClose();
    return true;
  });

  const [cards, setCards] = useState<CharacterCard[]>([]);
  const [search, setSearch] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'has_update' | 'subscribed' | 'unbound'>('all');
  
  // Checking status
  const [isCheckingAll, setIsCheckingAll] = useState(false);
  const [checkingProgress, setCheckingProgress] = useState<{ current: number; total: number; cardName: string } | null>(null);
  const [checkingCardId, setCheckingCardId] = useState<string | null>(null);

  // Editing URL state
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editingUrlValue, setEditingUrlValue] = useState('');

  // Diff Modal State
  const [diffModalChar, setDiffModalChar] = useState<CharacterCard | null>(null);
  const [diffModalResult, setDiffModalResult] = useState<CardUpdateResult | null>(null);

  const loadCards = async () => {
    const list = await getAllCharacters();
    // Filter actual character cards (exclude tools if any)
    const valid = list.filter(c => !c.deletedAt && !c.isTool && !c.isQR);
    setCards(valid);
  };

  useEffect(() => {
    if (isOpen) {
      loadCards();
      setSearch('');
      setEditingCardId(null);
    }
  }, [isOpen]);

  const cardsWithUrl = useMemo(() => {
    return cards.map(c => {
      const url = c.updateUrl || c.sourceUrl || c.data?.extensions?.source || c.data?.source || '';
      return { card: c, url };
    });
  }, [cards]);

  const filteredItems = useMemo(() => {
    let list = cardsWithUrl;
    const q = search.trim().toLowerCase();

    if (filterTab === 'has_update') {
      list = list.filter(item => item.card.lastCheckResult === 'has_update');
    } else if (filterTab === 'subscribed') {
      list = list.filter(item => Boolean(item.url));
    } else if (filterTab === 'unbound') {
      list = list.filter(item => !item.url);
    }

    if (q) {
      list = list.filter(item => 
        item.card.name.toLowerCase().includes(q) ||
        item.url.toLowerCase().includes(q)
      );
    }

    return list;
  }, [cardsWithUrl, filterTab, search]);

  const updateCount = useMemo(() => {
    return cards.filter(c => c.lastCheckResult === 'has_update').length;
  }, [cards]);

  const subscribedCount = useMemo(() => {
    return cardsWithUrl.filter(i => Boolean(i.url)).length;
  }, [cardsWithUrl]);

  const handleCheckSingle = async (char: CharacterCard, customUrl?: string) => {
    setCheckingCardId(char.id);
    try {
      const result = await checkForCardUpdate(char, customUrl);
      await loadCards();
      if (result.hasUpdate) {
        setDiffModalChar(char);
        setDiffModalResult(result);
      }
    } finally {
      setCheckingCardId(null);
    }
  };

  const handleCheckAll = async () => {
    const targets = cardsWithUrl.filter(i => Boolean(i.url));
    if (targets.length === 0) {
      alert('暂无可检测的订阅卡片，请先为卡片绑定更新网址。');
      return;
    }

    setIsCheckingAll(true);
    let checked = 0;
    const total = targets.length;

    for (const item of targets) {
      setCheckingProgress({
        current: checked + 1,
        total,
        cardName: item.card.name
      });
      try {
        await checkForCardUpdate(item.card);
      } catch (e) {
        // continue
      }
      checked++;
    }

    setIsCheckingAll(false);
    setCheckingProgress(null);
    await loadCards();
    onCardsUpdated();
  };

  const handleSaveUrl = async (char: CharacterCard) => {
    const trimmed = editingUrlValue.trim();
    const updated: CharacterCard = {
      ...char,
      sourceUrl: trimmed,
      updateUrl: trimmed,
      lastCheckResult: undefined,
      lastCheckChanges: []
    };
    await saveCharacter(updated);
    setEditingCardId(null);
    setEditingUrlValue('');
    await loadCards();
    onCardsUpdated();

    if (trimmed) {
      // Auto check after setting URL
      handleCheckSingle(updated, trimmed);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div 
        className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-5 bg-black/65 backdrop-blur-sm select-none"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => e.stopPropagation()}
          className={`w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[88vh] border ${
            isLightMode 
              ? 'bg-white border-[#e2e8f0] text-[#0f172a]' 
              : 'bg-[#151720] border-white/10 text-white'
          }`}
        >
          {/* Header */}
          <div className={`p-4 sm:p-5 pb-3 border-b flex items-center justify-between gap-3 ${
            isLightMode ? 'border-[#e2e8f0] bg-[#f8fafc]' : 'border-white/10 bg-white/5'
          }`}>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-500 shrink-0">
                <Radio className="w-4 h-4" />
              </div>
              <div>
                <h3 className={`text-base sm:text-lg font-bold ${
                  isLightMode ? 'text-[#0f172a]' : 'text-white'
                }`}>
                  卡片更新与订阅中心
                </h3>
                <p className={`text-xs ${
                  isLightMode ? 'text-slate-400' : 'text-white/40'
                }`}>
                  已订阅 {subscribedCount} 张卡片 {updateCount > 0 && <span className="text-amber-500 font-bold"> · {updateCount} 张发现更新</span>}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isCheckingAll || subscribedCount === 0}
                onClick={handleCheckAll}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95 disabled:opacity-40 disabled:pointer-events-none ${
                  isLightMode
                    ? 'bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow-blue-500/20'
                    : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/30'
                }`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isCheckingAll ? 'animate-spin' : ''}`} />
                <span>{isCheckingAll ? '检测中...' : '检测全部更新'}</span>
              </button>

              <button
                onClick={onClose}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition cursor-pointer border ${
                  isLightMode 
                    ? 'bg-white hover:bg-[#f1f5f9] text-[#64748b] hover:text-[#0f172a] border-[#e2e8f0]' 
                    : 'bg-white/10 hover:bg-white/15 text-white/60 hover:text-white border-transparent'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Progress Bar during Batch Check */}
          {isCheckingAll && checkingProgress && (
            <div className={`px-4 sm:px-5 py-2.5 border-b text-xs flex items-center justify-between gap-3 ${
              isLightMode ? 'bg-blue-50/80 border-blue-100 text-blue-800' : 'bg-blue-500/10 border-blue-500/20 text-blue-300'
            }`}>
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-blue-500" />
                <span className="truncate">正在检测: <b>{checkingProgress.cardName}</b></span>
              </div>
              <span className="font-mono font-bold shrink-0">
                {checkingProgress.current} / {checkingProgress.total}
              </span>
            </div>
          )}

          {/* Search & Filter Tabs */}
          <div className={`p-3 sm:px-5 sm:py-3 border-b space-y-2.5 ${
            isLightMode ? 'border-[#e2e8f0]' : 'border-white/10'
          }`}>
            <div className="relative">
              <Search className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${
                isLightMode ? 'text-slate-400' : 'text-white/40'
              }`} />
              <input
                type="text"
                placeholder="搜索角色名或订阅网址..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`w-full rounded-2xl pl-10 pr-4 py-2 text-xs sm:text-sm outline-none transition font-medium ${
                  isLightMode 
                    ? 'bg-[#f8fafc] border border-[#cbd5e1] text-[#0f172a] placeholder:text-slate-400 focus:bg-white focus:border-[#3b82f6]' 
                    : 'bg-black/30 border border-white/10 text-white placeholder:text-white/30 focus:border-blue-500/60'
                }`}
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 custom-scrollbar">
              <button
                type="button"
                onClick={() => setFilterTab('all')}
                className={`px-3 py-1 rounded-xl text-xs font-semibold transition cursor-pointer shrink-0 border ${
                  filterTab === 'all'
                    ? isLightMode ? 'bg-[#eff6ff] text-[#2563eb] border-[#bfdbfe]' : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                    : isLightMode ? 'bg-transparent text-slate-500 border-transparent hover:bg-slate-100' : 'bg-transparent text-white/50 border-transparent hover:bg-white/5'
                }`}
              >
                全部 ({cards.length})
              </button>

              <button
                type="button"
                onClick={() => setFilterTab('has_update')}
                className={`px-3 py-1 rounded-xl text-xs font-semibold transition cursor-pointer shrink-0 border flex items-center gap-1 ${
                  filterTab === 'has_update'
                    ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
                    : isLightMode ? 'bg-transparent text-slate-500 border-transparent hover:bg-slate-100' : 'bg-transparent text-white/50 border-transparent hover:bg-white/5'
                }`}
              >
                <Sparkles className="w-3 h-3" />
                <span>有更新 ({updateCount})</span>
              </button>

              <button
                type="button"
                onClick={() => setFilterTab('subscribed')}
                className={`px-3 py-1 rounded-xl text-xs font-semibold transition cursor-pointer shrink-0 border ${
                  filterTab === 'subscribed'
                    ? isLightMode ? 'bg-[#eff6ff] text-[#2563eb] border-[#bfdbfe]' : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                    : isLightMode ? 'bg-transparent text-slate-500 border-transparent hover:bg-slate-100' : 'bg-transparent text-white/50 border-transparent hover:bg-white/5'
                }`}
              >
                已绑定网址 ({subscribedCount})
              </button>

              <button
                type="button"
                onClick={() => setFilterTab('unbound')}
                className={`px-3 py-1 rounded-xl text-xs font-semibold transition cursor-pointer shrink-0 border ${
                  filterTab === 'unbound'
                    ? isLightMode ? 'bg-slate-200 text-slate-700 border-slate-300' : 'bg-white/15 text-white border-white/20'
                    : isLightMode ? 'bg-transparent text-slate-500 border-transparent hover:bg-slate-100' : 'bg-transparent text-white/50 border-transparent hover:bg-white/5'
                }`}
              >
                未绑定 ({cards.length - subscribedCount})
              </button>
            </div>
          </div>

          {/* Cards List */}
          <div className="p-3 sm:p-5 overflow-y-auto space-y-2.5 flex-1 custom-scrollbar">
            {filteredItems.length === 0 ? (
              <div className={`py-12 text-center text-xs ${
                isLightMode ? 'text-slate-400' : 'text-white/40'
              }`}>
                未找到相关卡片
              </div>
            ) : (
              filteredItems.map(({ card, url }) => {
                const isChecking = checkingCardId === card.id;
                const isEditing = editingCardId === card.id;
                const hasUpdate = card.lastCheckResult === 'has_update';
                const isLatest = card.lastCheckResult === 'latest';
                const isError = card.lastCheckResult === 'error';

                const avatarUrl = card.avatarBlob 
                  ? URL.createObjectURL(card.avatarBlob)
                  : resolveAvatarUrl(card.avatarUrlFallback, card.name);

                return (
                  <div
                    key={card.id}
                    className={`p-3 sm:p-3.5 rounded-2xl border transition-all ${
                      hasUpdate
                        ? isLightMode 
                          ? 'bg-amber-50/50 border-amber-200 shadow-2xs' 
                          : 'bg-amber-500/10 border-amber-500/25'
                        : isLightMode 
                          ? 'bg-[#f8fafc] hover:bg-white border-[#e2e8f0]' 
                          : 'bg-white/5 hover:bg-white/8 border-white/10'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl overflow-hidden border shrink-0 bg-slate-800 shadow-2xs">
                        <img src={avatarUrl} alt={card.name} className="w-full h-full object-cover" />
                      </div>

                      {/* Info & URL */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 min-w-0">
                            <h4 className={`font-bold text-xs sm:text-sm truncate ${
                              isLightMode ? 'text-[#0f172a]' : 'text-white'
                            }`}>
                              {card.name}
                            </h4>
                            <span className="text-[10.5px] font-mono px-1.5 py-0.2 rounded-md bg-black/5 dark:bg-white/10 text-slate-500 dark:text-slate-400">
                              v{card.data?.data?.character_version || card.data?.character_version || '1.0'}
                            </span>
                          </div>

                          {/* Status Badge */}
                          <div>
                            {hasUpdate && (
                              <button
                                type="button"
                                onClick={() => handleCheckSingle(card)}
                                className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500 text-white flex items-center gap-1 shadow-xs active:scale-95 cursor-pointer"
                              >
                                <Sparkles className="w-3 h-3" />
                                <span>发现更新 {card.lastCheckVersion ? `(v${card.lastCheckVersion})` : ''}</span>
                              </button>
                            )}
                            {isLatest && !hasUpdate && (
                              <span className="text-[11px] font-medium text-green-500 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>已是最新</span>
                              </span>
                            )}
                            {isError && (
                              <span className="text-[11px] font-medium text-red-400 flex items-center gap-1" title={card.lastCheckError}>
                                <AlertCircle className="w-3 h-3" />
                                <span>检测失败</span>
                              </span>
                            )}
                          </div>
                        </div>

                        {/* URL Row */}
                        <div className="mt-1.5">
                          {isEditing ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                placeholder="输入 DC 附件/Chub/Rentry/直接卡片下载网址..."
                                value={editingUrlValue}
                                onChange={(e) => setEditingUrlValue(e.target.value)}
                                autoFocus
                                onKeyDown={(e) => e.key === 'Enter' && handleSaveUrl(card)}
                                className={`flex-1 min-w-0 px-2.5 py-1 rounded-xl text-xs font-mono outline-none border ${
                                  isLightMode ? 'bg-white border-[#3b82f6] text-[#0f172a]' : 'bg-black/50 border-blue-500 text-white'
                                }`}
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveUrl(card)}
                                className="p-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition cursor-pointer active:scale-90"
                                title="保存网址"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingCardId(null)}
                                className="p-1.5 rounded-lg bg-slate-200 dark:bg-white/10 text-slate-500 dark:text-slate-300 transition cursor-pointer active:scale-90"
                                title="取消"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between gap-2">
                              {url ? (
                                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                  <Link2 className="w-3 h-3 text-blue-500 shrink-0" />
                                  <span className={`text-[11px] font-mono truncate ${
                                    isLightMode ? 'text-slate-500' : 'text-slate-400'
                                  }`}>
                                    {url}
                                  </span>
                                </div>
                              ) : (
                                <span className={`text-[11px] italic ${
                                  isLightMode ? 'text-slate-400' : 'text-white/30'
                                }`}>
                                  未绑定更新源网址
                                </span>
                              )}

                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingCardId(card.id);
                                    setEditingUrlValue(url);
                                  }}
                                  className={`p-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                                    isLightMode ? 'text-slate-400 hover:text-slate-700 hover:bg-black/5' : 'text-white/40 hover:text-white hover:bg-white/10'
                                  }`}
                                  title="修改网址"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>

                                {url && (
                                  <button
                                    type="button"
                                    disabled={isChecking}
                                    onClick={() => handleCheckSingle(card)}
                                    className={`px-2 py-0.5 rounded-lg text-xs font-medium transition flex items-center gap-1 cursor-pointer active:scale-95 ${
                                      isLightMode 
                                        ? 'bg-[#eff6ff] hover:bg-[#dbeafe] text-[#2563eb]' 
                                        : 'bg-blue-500/15 hover:bg-blue-500/25 text-blue-300'
                                    }`}
                                    title="立即检测此卡更新"
                                  >
                                    <RefreshCw className={`w-3 h-3 ${isChecking ? 'animate-spin' : ''}`} />
                                    <span>{isChecking ? '检测中' : '检测'}</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      </div>

      {/* Diff & Apply Modal */}
      {diffModalChar && diffModalResult && (
        <CardUpdateDiffModal
          isOpen={true}
          character={diffModalChar}
          updateResult={diffModalResult}
          onClose={() => {
            setDiffModalChar(null);
            setDiffModalResult(null);
          }}
          onUpdated={(updated) => {
            loadCards();
            onCardsUpdated();
          }}
          isLightMode={isLightMode}
        />
      )}
    </AnimatePresence>
  );
}
