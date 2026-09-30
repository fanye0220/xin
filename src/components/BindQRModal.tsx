import { getFallbackAvatar, resolveAvatarUrl } from '../lib/avatar';
import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search } from 'lucide-react';
import { CharacterCard } from '../lib/db';
import { useBackHandler } from '../lib/useBackHandler';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onBind: (targetCharId: string) => void;
  characters: CharacterCard[];
  qrChar: CharacterCard | null;
}

function CharacterOption({ char, onClick }: { char: CharacterCard, onClick: () => void }) {
  const defaultFallback = getFallbackAvatar(char.name || char.id, char.tags?.join(',') || (char.isTool ? 'tool' : undefined));
  const [url, setUrl] = useState<string>(resolveAvatarUrl(char.avatarUrlFallback, char.name || char.id));

  useEffect(() => {
    let objectUrl: string | null = null;
    let isMounted = true;
    if (char.localFilePath) {
      import('../lib/appBridge').then(({ getLocalImageUrl }) => {
        if(isMounted) setUrl(getLocalImageUrl(char.localFilePath!, char.updatedAt || char.createdAt));
      });
    } else if (char.avatarBlob) {
      objectUrl = URL.createObjectURL(char.avatarBlob);
      if(isMounted) setUrl(objectUrl);
    } else if (char.hasBlobsSeparated) {
      import('../lib/db').then(({ getCharacterBlob }) => {
        getCharacterBlob(char.id).then(blobs => {
          if (blobs?.avatarBlob && isMounted) {
            objectUrl = URL.createObjectURL(blobs.avatarBlob);
            setUrl(objectUrl);
          }
        });
      });
    }
    return () => {
      isMounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [char]);

  return (
    <div
      onClick={onClick}
      className="p-3 rounded-2xl transition cursor-pointer flex items-center justify-between gap-3 border version-candidate-card"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 bg-black/40 border border-white/10 [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10">
          <img src={url || undefined} alt={char.name} className="w-full h-full object-cover" onError={(e) => { if (e.currentTarget.src !== defaultFallback) e.currentTarget.src = defaultFallback; }} />
        </div>
        <div className="min-w-0">
          <h4 className="font-semibold text-xs truncate version-candidate-name">{char.name}</h4>
          {char.data?.creator && <p className="text-[10px] truncate mt-0.5 font-normal version-candidate-sub">by {char.data.creator}</p>}
        </div>
      </div>
    </div>
  );
}

export function BindQRModal({ isOpen, onClose, onBind, characters, qrChar }: Props) {
  const [searchQuery, setSearchQuery] = useState('');

  useBackHandler(isOpen, () => {
    onClose();
    return true;
  });

  const validCharacters = useMemo(() => {
    return characters.filter(c => {
      if (c.id === qrChar?.id) return false;
      const data = c.data || {};
      const isQR = Array.isArray(data) ? data.length > 0 && data[0].label !== undefined : (data.quick_replies !== undefined || data.qrList !== undefined);
      return !isQR;
    });
  }, [characters, qrChar]);

  const filteredCharacters = useMemo(() => {
    if (!searchQuery) return validCharacters;
    const lowerQuery = searchQuery.toLowerCase();
    return validCharacters.filter(c => c.name.toLowerCase().includes(lowerQuery));
  }, [validCharacters, searchQuery]);

  return createPortal(
    <AnimatePresence>
      {isOpen && qrChar && (
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
                将 {qrChar.name} 绑定至...
              </h3>
              <button 
                onClick={onClose} 
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-full version-modal-close-btn flex items-center justify-center cursor-pointer transition shadow-xs shrink-0"
              >
                <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
            </div>
            
            <div className="pt-2.5 pb-1.5 relative z-10 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 version-modal-search-icon" />
                <input 
                  type="text" 
                  placeholder="搜索角色..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="version-input w-full rounded-xl sm:rounded-2xl pl-9 pr-3 py-2 text-xs outline-none focus:border-blue-500 transition"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1.5 sm:space-y-2 pr-1 my-1.5 max-h-[46vh] custom-scrollbar relative z-10">
              {filteredCharacters.length === 0 ? (
                <div className="py-8 text-center text-xs version-modal-desc">
                  暂无匹配的角色
                </div>
              ) : (
                filteredCharacters.map(char => (
                  <CharacterOption
                    key={char.id}
                    char={char}
                    onClick={() => onBind(char.id)}
                  />
                ))
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
