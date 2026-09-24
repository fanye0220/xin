import { getFallbackAvatar, resolveAvatarUrl } from '../lib/avatar';
import React, { useState, useEffect, useMemo } from 'react';
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
    <button
      onClick={onClick}
      className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition text-left"
    >
      <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-black/40">
        <img src={url || undefined} alt={char.name} className="w-full h-full object-cover" onError={(e) => { if (e.currentTarget.src !== defaultFallback) e.currentTarget.src = defaultFallback; }} />
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="font-medium text-white text-sm truncate">{char.name}</h4>
        {char.data?.creator && <p className="text-[10px] text-white/40 truncate">by {char.data.creator}</p>}
      </div>
    </button>
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

  if (!isOpen || !qrChar) return null;

  return (
    <div 
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-slate-800/90 backdrop-blur-2xl rounded-3xl w-full max-w-md border border-white/10 shadow-2xl overflow-hidden flex flex-col h-[70vh] sm:h-[60vh] max-h-[600px]"
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
          <h3 className="font-semibold text-white">将 {qrChar.name} 绑定至...</h3>
          <button onClick={onClose} className="p-2 -mr-2 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-4 border-b border-white/5 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input 
              type="text" 
              placeholder="搜索角色..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-purple-500/50 transition"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-white/10">
          {filteredCharacters.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-40 text-center">
               <p className="text-white/50 text-sm">暂无匹配的角色</p>
             </div>
          ) : (
            <div className="flex flex-col gap-1">
              {filteredCharacters.map(char => (
                <CharacterOption
                  key={char.id}
                  char={char}
                  onClick={() => onBind(char.id)}
                />
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
