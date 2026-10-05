import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, 
  Sparkles, 
  Check, 
  ArrowRight, 
  ExternalLink, 
  RefreshCw, 
  Plus, 
  Layers, 
  MessageSquare, 
  BookOpen, 
  FileText, 
  ShieldCheck,
  Loader2,
  Copy
} from 'lucide-react';
import { CharacterCard } from '../lib/db';
import { CardUpdateResult, applyCardUpdate } from '../lib/cardUpdater';
import { resolveAvatarUrl, getFallbackAvatar } from '../lib/avatar';
import { useBackHandler } from '../lib/useBackHandler';

interface Props {
  isOpen: boolean;
  character: CharacterCard;
  updateResult: CardUpdateResult;
  onClose: () => void;
  onUpdated: (newCard: CharacterCard) => void;
  isLightMode?: boolean;
}

export function CardUpdateDiffModal({
  isOpen,
  character,
  updateResult,
  onClose,
  onUpdated,
  isLightMode = false
}: Props) {
  useBackHandler(isOpen, () => {
    onClose();
    return true;
  });

  const [isApplying, setIsApplying] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'greetings' | 'worldbook' | 'raw'>('summary');
  const [copiedUrl, setCopiedUrl] = useState(false);

  if (!isOpen) return null;

  const localTarget = character.data?.data || character.data || {};
  const remoteTarget = updateResult.remoteData?.data || updateResult.remoteData || {};

  const localAvatarUrl = character.avatarBlob 
    ? URL.createObjectURL(character.avatarBlob) 
    : resolveAvatarUrl(character.avatarUrlFallback, character.name);

  const remoteAvatarUrl = updateResult.remoteAvatarBlob
    ? URL.createObjectURL(updateResult.remoteAvatarBlob)
    : localAvatarUrl;

  const handleApply = async (mode: 'upgrade' | 'save_as_new') => {
    setIsApplying(true);
    try {
      const updated = await applyCardUpdate(character, updateResult, mode);
      onUpdated(updated);
      onClose();
    } catch (err: any) {
      console.error('Failed to apply update:', err);
      alert(`应用更新失败: ${err.message || '未知错误'}`);
    } finally {
      setIsApplying(false);
    }
  };

  const handleCopyUrl = () => {
    if (updateResult.sourceUrl) {
      navigator.clipboard.writeText(updateResult.sourceUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  };

  const localGreetings: string[] = Array.isArray(localTarget.alternate_greetings) ? localTarget.alternate_greetings : [];
  const remoteGreetings: string[] = Array.isArray(remoteTarget.alternate_greetings) ? remoteTarget.alternate_greetings : [];

  const localEntries: any[] = localTarget.character_book?.entries || localTarget.lorebook?.entries || [];
  const remoteEntries: any[] = remoteTarget.character_book?.entries || remoteTarget.lorebook?.entries || [];

  return (
    <AnimatePresence>
      <div 
        className="fixed inset-0 z-[130] flex items-center justify-center p-3 sm:p-5 bg-black/65 backdrop-blur-sm select-none"
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
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-500 border border-amber-500/30 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>发现新版本</span>
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-lg border font-mono font-medium ${
                  isLightMode ? 'bg-white border-[#cbd5e1] text-[#334155]' : 'bg-white/10 border-white/15 text-slate-300'
                }`}>
                  {updateResult.currentVersion || 'v1.0'} <ArrowRight className="inline w-3 h-3 mx-0.5 text-blue-500" /> <b className="text-blue-500">{updateResult.remoteVersion || '新版'}</b>
                </span>
              </div>
              <h3 className={`text-base sm:text-lg font-bold truncate mt-1.5 ${
                isLightMode ? 'text-[#0f172a]' : 'text-white'
              }`}>
                {character.name} {updateResult.remoteName && updateResult.remoteName !== character.name && (
                  <span className="text-xs font-normal text-slate-400"> (远程: {updateResult.remoteName})</span>
                )}
              </h3>
            </div>

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

          {/* Source Link Bar */}
          {updateResult.sourceUrl && (
            <div className={`px-4 sm:px-5 py-2 text-xs border-b flex items-center justify-between gap-2 ${
              isLightMode ? 'bg-[#f1f5f9]/70 border-[#e2e8f0]' : 'bg-black/20 border-white/5'
            }`}>
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className={`shrink-0 font-medium ${isLightMode ? 'text-[#64748b]' : 'text-white/40'}`}>
                  更新源:
                </span>
                <span className={`truncate font-mono ${isLightMode ? 'text-[#3b82f6]' : 'text-blue-400'}`}>
                  {updateResult.sourceUrl}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className={`p-1 rounded-md text-[11px] font-medium transition cursor-pointer flex items-center gap-1 ${
                    isLightMode ? 'hover:bg-black/5 text-[#64748b]' : 'hover:bg-white/10 text-white/60'
                  }`}
                  title="复制链接"
                >
                  <Copy className="w-3 h-3" />
                  <span>{copiedUrl ? '已复制' : '复制'}</span>
                </button>
                <a
                  href={updateResult.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`p-1 rounded-md text-[11px] font-medium transition flex items-center gap-1 ${
                    isLightMode ? 'hover:bg-black/5 text-[#3b82f6]' : 'hover:bg-white/10 text-blue-400'
                  }`}
                  title="打开原始链接"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>打开</span>
                </a>
              </div>
            </div>
          )}

          {/* Navigation Tabs */}
          <div className={`px-4 sm:px-5 pt-2 border-b flex items-center gap-2 shrink-0 ${
            isLightMode ? 'border-[#e2e8f0]' : 'border-white/10'
          }`}>
            <button
              onClick={() => setActiveTab('summary')}
              className={`pb-2 text-xs sm:text-sm font-semibold border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'summary'
                  ? isLightMode ? 'border-[#2563eb] text-[#2563eb]' : 'border-blue-400 text-blue-400'
                  : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>更新概览 ({updateResult.changesSummary.length})</span>
            </button>

            {remoteGreetings.length > 0 && (
              <button
                onClick={() => setActiveTab('greetings')}
                className={`pb-2 text-xs sm:text-sm font-semibold border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'greetings'
                    ? isLightMode ? 'border-[#2563eb] text-[#2563eb]' : 'border-blue-400 text-blue-400'
                    : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-white'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>开场白 ({remoteGreetings.length})</span>
              </button>
            )}

            {remoteEntries.length > 0 && (
              <button
                onClick={() => setActiveTab('worldbook')}
                className={`pb-2 text-xs sm:text-sm font-semibold border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
                  activeTab === 'worldbook'
                    ? isLightMode ? 'border-[#2563eb] text-[#2563eb]' : 'border-blue-400 text-blue-400'
                    : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-white'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>世界书 ({remoteEntries.length})</span>
              </button>
            )}
          </div>

          {/* Scrollable Diff Content */}
          <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 custom-scrollbar">
            {activeTab === 'summary' && (
              <div className="space-y-4">
                {/* Visual Avatar Comparison */}
                <div className={`p-4 rounded-2xl border flex items-center justify-around gap-4 ${
                  isLightMode ? 'bg-[#f8fafc] border-[#e2e8f0]' : 'bg-white/5 border-white/10'
                }`}>
                  <div className="flex flex-col items-center gap-1.5">
                    <span className={`text-[11px] font-medium ${isLightMode ? 'text-[#64748b]' : 'text-white/40'}`}>当前头像</span>
                    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden border shadow-sm bg-slate-800">
                      <img src={localAvatarUrl} alt="当前头像" className="w-full h-full object-cover" />
                    </div>
                  </div>

                  <div className="flex flex-col items-center justify-center">
                    <ArrowRight className="w-6 h-6 text-blue-500 animate-pulse" />
                  </div>

                  <div className="flex flex-col items-center gap-1.5">
                    <span className={`text-[11px] font-medium ${isLightMode ? 'text-[#2563eb]' : 'text-blue-400'}`}>远程最新头像</span>
                    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden border-2 border-blue-500 shadow-md bg-slate-800">
                      <img src={remoteAvatarUrl} alt="新头像" className="w-full h-full object-cover" />
                    </div>
                  </div>
                </div>

                {/* Changes List */}
                <div className="space-y-2">
                  <h4 className={`text-xs font-bold uppercase tracking-wider ${
                    isLightMode ? 'text-[#475569]' : 'text-white/60'
                  }`}>
                    变动明细
                  </h4>
                  <div className="space-y-1.5">
                    {updateResult.changesSummary.map((change, idx) => (
                      <div 
                        key={idx}
                        className={`px-3.5 py-2.5 rounded-xl border flex items-center gap-2.5 text-xs sm:text-sm font-medium ${
                          isLightMode 
                            ? 'bg-[#eff6ff] text-[#1e40af] border-[#bfdbfe]' 
                            : 'bg-blue-500/10 text-blue-300 border-blue-500/20'
                        }`}
                      >
                        <Check className="w-4 h-4 text-blue-500 shrink-0 stroke-[2.5]" />
                        <span>{change}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Description Preview */}
                {remoteTarget.description && (
                  <div className="space-y-1.5">
                    <h4 className={`text-xs font-bold uppercase tracking-wider ${
                      isLightMode ? 'text-[#475569]' : 'text-white/60'
                    }`}>
                      最新角色描述预览
                    </h4>
                    <div className={`p-3.5 rounded-2xl text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words max-h-40 overflow-y-auto custom-scrollbar border ${
                      isLightMode ? 'bg-[#f8fafc] border-[#e2e8f0] text-[#0f172a]' : 'bg-black/30 border-white/10 text-slate-200'
                    }`}>
                      {remoteTarget.description}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'greetings' && (
              <div className="space-y-3">
                <div className="text-xs font-medium text-slate-400">
                  远程版本包含 {remoteGreetings.length} 条备用开场白：
                </div>
                {remoteGreetings.map((g, idx) => (
                  <div 
                    key={idx}
                    className={`p-3.5 rounded-2xl border text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words space-y-1 ${
                      isLightMode ? 'bg-[#f8fafc] border-[#e2e8f0] text-[#0f172a]' : 'bg-black/30 border-white/10 text-slate-200'
                    }`}
                  >
                    <div className="text-[11px] font-bold text-blue-500">备用开场白 #{idx + 1}</div>
                    <div>{g}</div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'worldbook' && (
              <div className="space-y-3">
                <div className="text-xs font-medium text-slate-400">
                  远程版本包含 {remoteEntries.length} 条世界书设定：
                </div>
                {remoteEntries.map((entry, idx) => (
                  <div 
                    key={idx}
                    className={`p-3.5 rounded-2xl border text-xs sm:text-sm space-y-1.5 ${
                      isLightMode ? 'bg-[#f8fafc] border-[#e2e8f0] text-[#0f172a]' : 'bg-black/30 border-white/10 text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-blue-500">
                        {entry.comment || entry.name || `条目 #${idx + 1}`}
                      </span>
                      {Array.isArray(entry.keys) && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
                          {entry.keys.join(', ')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs leading-relaxed whitespace-pre-wrap break-words text-slate-300 dark:text-slate-200">
                      {entry.content}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className={`p-4 sm:p-5 border-t flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0 ${
            isLightMode ? 'bg-[#f8fafc] border-[#e2e8f0]' : 'bg-[#161822] border-white/10'
          }`}>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <ShieldCheck className="w-4 h-4 text-green-500 shrink-0" />
              <span>升级将自动生成当前版本快照，支持在历史记录中随时无损还原。</span>
            </div>

            <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => handleApply('save_as_new')}
                disabled={isApplying}
                className={`flex-1 sm:flex-initial px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-semibold transition cursor-pointer active:scale-95 border ${
                  isLightMode 
                    ? 'bg-white hover:bg-[#f1f5f9] text-[#334155] border-[#cbd5e1]' 
                    : 'bg-white/5 hover:bg-white/10 text-slate-200 border-white/10'
                }`}
              >
                另存为新卡
              </button>

              <button
                type="button"
                onClick={() => handleApply('upgrade')}
                disabled={isApplying}
                className={`flex-1 sm:flex-initial px-5 py-2.5 rounded-2xl text-xs sm:text-sm font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-md active:scale-95 ${
                  isLightMode 
                    ? 'bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow-blue-500/20' 
                    : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/30'
                }`}
              >
                {isApplying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>正在应用...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>一键升级至新版</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
