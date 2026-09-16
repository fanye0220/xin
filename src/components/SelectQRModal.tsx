import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Check } from 'lucide-react';
import { CharacterCard, getCharacters, getCharacterCategoryPrefix } from '../lib/db';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (qrChars: CharacterCard[]) => void;
}

export function SelectQRModal({ isOpen, onClose, onSelect }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [characters, setCharacters] = useState<CharacterCard[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen) {
      // Get all characters to find QRs
      getCharacters(1, 99999, undefined, "", [], "newest_import", false, true).then(res => setCharacters(res.characters));
      setSelectedIds(new Set());
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-slate-800/90 backdrop-blur-2xl rounded-3xl w-full max-w-md border border-white/10 shadow-2xl overflow-hidden flex flex-col h-[70vh] sm:h-[60vh] max-h-[600px]"
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
          <h3 className="font-semibold text-white">从库中选择快速回复</h3>
          <button onClick={onClose} className="p-2 -mr-2 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-4 border-b border-white/5 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input 
              type="text" 
              placeholder="搜索快速回复..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-purple-500/50 transition"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-white/10">
          {filteredQRs.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-40 text-center">
               <p className="text-white/50 text-sm">暂无匹配的快速回复</p>
             </div>
          ) : (
            <div className="flex flex-col gap-1">
              {filteredQRs.map(char => {
                const isSelected = selectedIds.has(char.id);
                return (
                  <button
                    key={char.id}
                    onClick={() => toggleSelection(char.id)}
                    className={`flex items-center gap-3 p-2 rounded-xl transition text-left ${isSelected ? 'bg-purple-500/20 shadow-inner' : 'hover:bg-white/5'}`}
                  >
                    <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 border transition ${isSelected ? 'bg-purple-500 border-purple-500 text-white' : 'border-white/20'}`}>
                      {isSelected && <Check className="w-3 h-3" />}
                    </div>
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-white/10 text-white/80">
                      <span className="text-xl">💬</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-white text-sm truncate">{char.name}</h4>
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
             onClick={handleConfirm}
             disabled={selectedIds.size === 0}
             className="flex-1 py-2.5 rounded-xl font-medium text-white bg-purple-500 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
           >
             确认 ({selectedIds.size})
           </button>
        </div>
      </motion.div>
    </div>
  );
}
