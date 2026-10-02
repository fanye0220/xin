import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Download } from 'lucide-react';

interface QRSet {
  id: string;
  sourceName: string;
  replies: any[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  qrSets: QRSet[];
  onExport: (selectedSets: QRSet[], share?: boolean) => void;
}

export function ExportQRModal({ isOpen, onClose, qrSets, onExport }: Props) {
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

  useEffect(() => {
    if (isOpen) {
      setSelectedIds(new Set(qrSets.map(s => s.id)));
    }
  }, [isOpen, qrSets]);

  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleConfirm = (share: boolean = false) => {
    const selectedSets = qrSets.filter(s => selectedIds.has(s.id));
    onExport(selectedSets, share);
    onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <div className={`fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] ${
        isLightMode ? 'bg-black/35' : 'bg-black/75'
      }`}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="version-modal-box rounded-3xl p-5 sm:p-6 w-[92vw] sm:w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] relative overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3.5 border-b version-modal-border relative z-10">
            <div>
              <h3 className="text-base sm:text-lg font-bold version-modal-title flex items-center gap-2">
                <Download className="w-5 h-5 opacity-80 text-blue-500" />
                选择要导出的快速回复集
              </h3>
              <p className="text-xs sm:text-sm version-modal-desc mt-0.5">
                勾选需要导出的快速回复集合
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full version-modal-close-btn flex items-center justify-center cursor-pointer transition shadow-xs"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto space-y-2 sm:space-y-2.5 pr-1 my-3 max-h-[50vh] custom-scrollbar relative z-10">
            {qrSets.length === 0 ? (
              <div className="py-12 text-center text-sm version-modal-desc">
                暂无已关联的快速回复集
              </div>
            ) : (
              qrSets.map(set => {
                const isSelected = selectedIds.has(set.id);
                return (
                  <div
                    key={set.id}
                    onClick={() => toggleSelection(set.id)}
                    className={`p-3.5 rounded-2xl transition cursor-pointer flex items-center justify-between gap-3 border version-candidate-card ${
                      isSelected ? 'is-selected' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm sm:text-base truncate version-candidate-name">
                          {set.sourceName}
                        </h4>
                        <span className="text-xs px-2 py-0.5 rounded-full font-mono font-semibold version-candidate-badge shrink-0">
                          {set.replies.length} 条回复
                        </span>
                      </div>
                      <p className="text-xs truncate mt-1 font-normal version-candidate-sub">
                        包含 {set.replies.length} 条快捷气泡回复选项
                      </p>
                    </div>

                    <div className={`w-6 h-6 rounded-full flex items-center justify-center transition shrink-0 version-candidate-radio ${
                      isSelected ? 'is-selected' : ''
                    }`}>
                      {isSelected && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-3 pt-3 border-t version-modal-border relative z-10">
            <button
              type="button"
              onClick={onClose}
              className="soft-pill flex-1 py-3 sm:py-3.5 px-4 rounded-2xl font-semibold text-sm sm:text-base cursor-pointer transition active:scale-95 text-center"
            >
              取消
            </button>
            <button
              type="button"
              disabled={selectedIds.size === 0}
              onClick={() => handleConfirm()}
              className="flex-1 py-3 sm:py-3.5 px-4 rounded-2xl bg-white hover:bg-neutral-200 text-black border border-white [.light-theme_&]:!bg-black [.light-theme_&]:!border-black [.light-theme_&]:!text-white font-bold text-sm sm:text-base shadow-sm disabled:opacity-40 flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer"
            >
              导出 ({selectedIds.size})
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}
