import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check } from 'lucide-react';

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl w-full max-w-md overflow-hidden flex flex-col shadow-2xl"
      >
        <div className="p-4 border-b border-white/10 flex items-center justify-between shrink-0">
          <h3 className="text-lg font-semibold text-white">选择要导出的快速回复集</h3>
          <button onClick={onClose} className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-xl transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 max-h-[60vh] overflow-y-auto custom-scrollbar flex-1">
          {qrSets.length === 0 ? (
             <div className="text-center py-8 text-white/50">没找到可导出的项</div>
          ) : (
            <div className="flex flex-col gap-2">
              {qrSets.map(set => {
                const isSelected = selectedIds.has(set.id);
                return (
                  <button
                    key={set.id}
                    onClick={() => toggleSelection(set.id)}
                    className={`flex items-center gap-3 p-3 rounded-xl transition text-left ${isSelected ? 'bg-purple-500/20 shadow-inner border border-purple-500/30' : 'bg-white/5 hover:bg-white/10 border border-transparent'}`}
                  >
                    <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 border transition ${isSelected ? 'bg-purple-500 border-purple-500 text-white' : 'border-white/20 text-transparent'}`}>
                      <Check className="w-3 h-3" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-white text-sm truncate">{set.sourceName}</h4>
                      <div className="text-white/50 text-xs mt-1">{set.replies.length} 个回复项</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/10 shrink-0 flex gap-3">
           <button 
             onClick={onClose}
             className="flex-1 py-2.5 rounded-xl font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 transition"
           >
             取消
           </button>
           <button 
              onClick={() => handleConfirm()}
             disabled={selectedIds.size === 0}
             className="flex-1 py-2.5 rounded-xl font-medium text-white bg-purple-500 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
           >
             导出 ({selectedIds.size})
           </button>
        </div>
      </motion.div>
    </div>
  );
}
