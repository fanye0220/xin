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
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="version-modal-box rounded-3xl p-5 sm:p-6 w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] relative overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3.5 border-b version-modal-border relative z-10">
            <div>
              <h3 className="text-base font-bold version-modal-title flex items-center gap-2">
                <Download className="w-4 h-4 opacity-70" />
                选择要导出的快速回复集
              </h3>
              <p className="text-xs version-modal-desc mt-0.5">
                勾选需要导出的快速回复集合
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full version-modal-close-btn flex items-center justify-center cursor-pointer transition shadow-xs"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 my-3 max-h-[50vh] custom-scrollbar relative z-10">
            {qrSets.length === 0 ? (
              <div className="py-8 text-center text-xs version-modal-desc">
                暂无已关联的快速回复集
              </div>
            ) : (
              qrSets.map(set => {
                const isSelected = selectedIds.has(set.id);
                return (
                  <div
                    key={set.id}
                    onClick={() => toggleSelection(set.id)}
                    className={`p-3 rounded-2xl transition cursor-pointer flex items-center justify-between gap-3 border version-candidate-card ${
                      isSelected ? 'is-selected' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-xs truncate version-candidate-name">
                          {set.sourceName}
                        </h4>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-mono version-candidate-badge shrink-0">
                          {set.replies.length} 条回复
                        </span>
                      </div>
                      <p className="text-[10px] truncate mt-0.5 font-normal version-candidate-sub">
                        包含 {set.replies.length} 条快捷气泡回复选项
                      </p>
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

          {/* Footer */}
          <div className="flex gap-2.5 pt-3 border-t version-modal-border relative z-10">
            <button
              type="button"
              onClick={onClose}
              className="soft-pill flex-1 py-2.5 px-4 rounded-full font-medium text-xs cursor-pointer transition active:scale-95 text-center"
            >
              取消
            </button>
            <button
              type="button"
              disabled={selectedIds.size === 0}
              onClick={() => handleConfirm()}
              className="flex-1 py-2.5 px-4 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-md shadow-blue-500/20 disabled:opacity-40 flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer"
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
