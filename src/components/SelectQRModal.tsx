import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Check } from 'lucide-react';
import { CharacterCard, getCharacters, getCharacterCategoryPrefix } from '../lib/db';
import { useBackHandler } from '../lib/useBackHandler';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (qrChars: CharacterCard[]) => void;
}

function getReplyCount(c: CharacterCard): number | null {
  const d = c.data;
  if (!d) return null;
  if (Array.isArray(d)) return d.length;
  if (Array.isArray(d.qrList)) return d.qrList.length;
  if (Array.isArray(d.quick_replies)) return d.quick_replies.length;
  const ext = d.extensions || d.data?.extensions;
  if (Array.isArray(ext?.quick_replies)) return ext.quick_replies.length;
  if (Array.isArray(ext?.tavern_qr_sets)) {
    return ext.tavern_qr_sets.reduce((sum: number, s: any) => sum + (Array.isArray(s?.replies) ? s.replies.length : 0), 0);
  }
  return null;
}

export function SelectQRModal({ isOpen, onClose, onSelect }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [characters, setCharacters] = useState<CharacterCard[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [isLightMode, setIsLightMode] = useState(() => {
    return (
      document.documentElement.classList.contains('light-theme') ||
      localStorage.getItem('tavern_theme') === 'light'
    );
  });

  useEffect(() => {
    const checkTheme = () => {
      setIsLightMode(
        document.documentElement.classList.contains('light-theme') ||
        localStorage.getItem('tavern_theme') === 'light'
      );
    };
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    window.addEventListener('storage', checkTheme);
    return () => {
      observer.disconnect();
      window.removeEventListener('storage', checkTheme);
    };
  }, []);

  useBackHandler(isOpen, () => {
    onClose();
    return true;
  });

  useEffect(() => {
    if (isOpen) {
      // Get all characters to find QRs
      getCharacters(1, 99999, undefined, "", [], "newest_import", false, true).then(res => setCharacters(res.characters));
      setSelectedIds(new Set());
      setSearchQuery('');
    }
  }, [isOpen]);

  const validQRs = useMemo(() => {
    return characters.filter(c => getCharacterCategoryPrefix(c) === '快速回复');
  }, [characters]);

  const filteredQRs = useMemo(() => {
    if (!searchQuery) return validQRs;
    const lowerQuery = searchQuery.toLowerCase();
    return validQRs.filter(c => c.name.toLowerCase().includes(lowerQuery));
  }, [validQRs, searchQuery]);

  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleConfirm = () => {
    const selectedChars = validQRs.filter(c => selectedIds.has(c.id));
    onSelect(selectedChars);
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div 
          className={`fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] ${
            isLightMode ? 'bg-black/35' : 'bg-black/75'
          }`}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            className={`rounded-3xl p-5 sm:p-6 w-[92vw] sm:w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] relative overflow-hidden border ${
              isLightMode
                ? 'bg-slate-800 text-slate-100 border-none'
                : 'bg-[#1c1c1e] text-white border-white/10'
            }`}
          >
            <div className={`flex items-center justify-between pb-3.5 border-b relative z-10 shrink-0 ${
              isLightMode ? 'border-slate-100' : 'border-white/10'
            }`}>
              <h3 className={`text-base sm:text-lg font-bold flex items-center gap-2 truncate ${
                isLightMode ? 'text-slate-100' : 'text-white'
              }`}>
                从库中选择快速回复
              </h3>
              <button 
                onClick={onClose} 
                className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center cursor-pointer transition shadow-xs shrink-0 ${
                  isLightMode
                    ? 'bg-slate-700/10 hover:bg-slate-700/20 text-slate-600 hover:text-slate-100'
                    : 'bg-white/10 hover:bg-white/15 text-white/60 hover:text-white'
                }`}
              >
                <X className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
            
            {/* Search input */}
            <div className="pt-3.5 pb-2 relative z-10 shrink-0">
              <div className="relative">
                <Search className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${
                  isLightMode ? 'text-slate-400' : 'text-white/40'
                }`} />
                <input 
                  type="text" 
                  placeholder="搜索快速回复..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`w-full rounded-2xl pl-10 pr-4 py-2.5 sm:py-3 text-sm sm:text-base outline-none transition border ${
                    isLightMode
                      ? 'bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-500'
                      : 'bg-white/5 border-white/10 text-white placeholder:text-white/40 focus:border-blue-400'
                  }`}
                />
              </div>
            </div>

            {/* Candidate list */}
            <div className="flex-1 overflow-y-auto space-y-2 sm:space-y-2.5 pr-1 my-2 max-h-[46vh] custom-scrollbar relative z-10">
              {filteredQRs.length === 0 ? (
                <div className={`py-12 text-center text-sm ${
                  isLightMode ? 'text-slate-400' : 'text-white/50'
                }`}>
                  暂无匹配的快速回复
                </div>
              ) : (
                filteredQRs.map(char => {
                  const isSelected = selectedIds.has(char.id);
                  const replyCount = getReplyCount(char);
                  const dateStr = char.fileModifiedAt || char.updatedAt || char.createdAt
                    ? new Date(char.fileModifiedAt || char.updatedAt || char.createdAt).toLocaleDateString()
                    : '';

                  return (
                    <div
                      key={char.id}
                      onClick={() => toggleSelection(char.id)}
                      className={`p-3.5 rounded-2xl transition cursor-pointer flex items-center justify-between gap-3 border ${
                        isSelected
                          ? isLightMode
                            ? 'bg-blue-50/90 border-blue-500/50 shadow-sm'
                            : 'bg-blue-500/15 border-blue-500/40 shadow-sm'
                          : isLightMode
                            ? 'bg-slate-50 hover:bg-slate-100/90 border-slate-200/80'
                            : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className={`font-bold text-sm sm:text-base truncate ${
                              isLightMode ? 'text-slate-100' : 'text-white'
                            }`}>
                              {char.name}
                            </h4>
                            {replyCount !== null && (
                              <span className={`text-xs px-2 py-0.5 rounded-full font-mono font-semibold shrink-0 ${
                                isLightMode
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-blue-500/20 text-blue-300'
                              }`}>
                                {replyCount}条
                              </span>
                            )}
                          </div>
                          {(dateStr || char.data?.creator) && (
                            <p className={`text-xs truncate mt-1 font-normal ${
                              isLightMode ? 'text-slate-600' : 'text-white/50'
                            }`}>
                              {dateStr ? `修改: ${dateStr}` : ''}
                              {char.data?.creator ? ` · 作者: ${char.data.creator}` : ''}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className={`w-6 h-6 rounded-full flex items-center justify-center transition shrink-0 border ${
                        isSelected
                          ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                          : isLightMode
                            ? 'border-slate-300 bg-white'
                            : 'border-white/30 bg-black/20'
                      }`}>
                        {isSelected && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal footer */}
            <div className={`flex gap-3 pt-3 border-t relative z-10 shrink-0 ${
              isLightMode ? 'border-slate-100' : 'border-white/10'
            }`}>
              <button 
                type="button"
                onClick={onClose}
                className={`flex-1 py-3 sm:py-3.5 px-4 rounded-2xl font-semibold text-sm sm:text-base cursor-pointer transition active:scale-95 text-center ${
                  isLightMode
                    ? 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                    : 'bg-white/10 hover:bg-white/15 text-white'
                }`}
              >
                取消
              </button>
              <button 
                type="button"
                onClick={handleConfirm}
                disabled={selectedIds.size === 0}
                className="flex-1 py-3 sm:py-3.5 px-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm sm:text-base shadow-md shadow-blue-500/20 disabled:opacity-40 flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer whitespace-nowrap"
              >
                确认 ({selectedIds.size})
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
