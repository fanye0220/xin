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
          className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            className="version-modal-box rounded-2xl sm:rounded-3xl p-4 sm:p-5 w-full max-w-md shadow-2xl flex flex-col max-h-[82vh] relative overflow-hidden"
          >
            <div className="flex items-center justify-between pb-3 border-b version-modal-border relative z-10 shrink-0">
              <h3 className="text-sm sm:text-base font-bold version-modal-title flex items-center gap-1.5 truncate">
                从库中选择快速回复
              </h3>
              <button 
                onClick={onClose} 
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-full version-modal-close-btn flex items-center justify-center cursor-pointer transition shadow-xs shrink-0"
              >
                <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
            </div>
            
            {/* Search input */}
            <div className="pt-2.5 pb-1.5 relative z-10 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 version-modal-search-icon" />
                <input 
                  type="text" 
                  placeholder="搜索快速回复..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="version-input w-full rounded-xl sm:rounded-2xl pl-9 pr-3 py-2 text-xs outline-none focus:border-blue-500 transition"
                />
              </div>
            </div>

            {/* Candidate list */}
            <div className="flex-1 overflow-y-auto space-y-1.5 sm:space-y-2 pr-1 my-1.5 max-h-[42vh] custom-scrollbar relative z-10">
              {filteredQRs.length === 0 ? (
                <div className="py-8 text-center text-xs version-modal-desc">
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
                      className={`p-2.5 sm:p-3 rounded-xl sm:rounded-2xl transition cursor-pointer flex items-center justify-between gap-2.5 border version-candidate-card ${
                        isSelected ? 'is-selected' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h4 className="font-semibold text-xs truncate version-candidate-name">
                              {char.name}
                            </h4>
                            {replyCount !== null && (
                              <span className="text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded-full font-mono version-candidate-badge shrink-0">
                                {replyCount}条
                              </span>
                            )}
                          </div>
                          {(dateStr || char.data?.creator) && (
                            <p className="text-[10px] truncate mt-0.5 font-normal version-candidate-sub">
                              {dateStr ? `修改: ${dateStr}` : ''}
                              {char.data?.creator ? ` · 作者: ${char.data.creator}` : ''}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className={`w-5 h-5 rounded-full flex items-center justify-center transition shrink-0 version-candidate-radio ${
                        isSelected ? 'is-selected' : ''
                      }`}>
                        {isSelected && <Check className="w-3 h-3 stroke-[2.5]" />}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal footer */}
            <div className="flex gap-2 pt-2 border-t version-modal-border relative z-10 shrink-0">
              <button 
                type="button"
                onClick={onClose}
                className="soft-pill flex-1 py-2 sm:py-2.5 px-3 rounded-full font-medium text-xs cursor-pointer transition active:scale-95 text-center"
              >
                取消
              </button>
              <button 
                type="button"
                onClick={handleConfirm}
                disabled={selectedIds.size === 0}
                className="flex-1 py-2 sm:py-2.5 px-3 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-md shadow-blue-500/20 disabled:opacity-40 flex items-center justify-center gap-1 transition active:scale-95 cursor-pointer whitespace-nowrap"
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
