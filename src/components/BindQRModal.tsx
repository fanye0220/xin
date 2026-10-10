import { getFallbackAvatar, resolveAvatarUrl, safeCreateObjectURL } from '../lib/avatar';
import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Link2, ArrowRight } from 'lucide-react';
import { CharacterCard } from '../lib/db';
import { useBackHandler } from '../lib/useBackHandler';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onBind: (targetCharId: string) => void;
  characters: CharacterCard[];
  qrChar: CharacterCard | null;
  isLightMode?: boolean;
}

function CharacterOption({
  char,
  onClick,
  isLightMode,
}: {
  char: CharacterCard;
  onClick: () => void;
  isLightMode?: boolean;
}) {
  const defaultFallback = getFallbackAvatar(
    char.name || char.id,
    char.tags?.join(',') || (char.isTool ? 'tool' : undefined),
  );
  const [url, setUrl] = useState<string>(
    resolveAvatarUrl(char.avatarUrlFallback, char.name || char.id),
  );

  useEffect(() => {
    let objectUrl: string | null = null;
    let isMounted = true;
    if (char.localFilePath) {
      import('../lib/appBridge').then(({ getLocalImageUrl }) => {
        if (isMounted)
          setUrl(
            getLocalImageUrl(
              char.localFilePath!,
              char.updatedAt || char.createdAt,
            ),
          );
      });
    } else if (char.avatarBlob) {
      objectUrl = safeCreateObjectURL(char.avatarBlob);
      if (isMounted && objectUrl) setUrl(objectUrl);
    } else if (char.hasBlobsSeparated) {
      import('../lib/db').then(({ getCharacterBlob }) => {
        getCharacterBlob(char.id).then((blobs) => {
          if (blobs?.avatarBlob && isMounted) {
            objectUrl = safeCreateObjectURL(blobs.avatarBlob);
            if (objectUrl) setUrl(objectUrl);
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
      className="p-3 sm:p-3.5 rounded-2xl transition-all cursor-pointer flex items-center justify-between gap-3.5 border active:scale-[0.99] version-candidate-card"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-12 h-12 rounded-2xl overflow-hidden shrink-0">
          <img
            src={url || defaultFallback}
            alt={char.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              if (e.currentTarget.src !== defaultFallback)
                e.currentTarget.src = defaultFallback;
            }}
          />
        </div>
        <div className="min-w-0">
          <h4 className="font-bold text-sm sm:text-base truncate version-candidate-name">
            {char.name}
          </h4>
          {char.data?.creator && (
            <p className="text-xs truncate mt-0.5 font-normal version-candidate-sub">
              by {char.data.creator}
            </p>
          )}
        </div>
      </div>
      <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border transition soft-pill shadow-xs">
        <ArrowRight className="w-4 h-4 stroke-[2.2]" />
      </div>
    </div>
  );
}

export function BindQRModal({
  isOpen,
  onClose,
  onBind,
  characters,
  qrChar,
  isLightMode: propIsLightMode,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');

  const [isLightMode, setIsLightMode] = useState(() => {
    if (typeof propIsLightMode === 'boolean') return propIsLightMode;
    return (
      document.documentElement.classList.contains('light-theme') ||
      localStorage.getItem('tavern_theme') === 'light'
    );
  });

  useEffect(() => {
    if (typeof propIsLightMode === 'boolean') {
      setIsLightMode(propIsLightMode);
      return;
    }
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
  }, [propIsLightMode]);

  useBackHandler(isOpen, () => {
    onClose();
    return true;
  });

  const validCharacters = useMemo(() => {
    return characters.filter((c) => {
      if (c.id === qrChar?.id) return false;
      const data = c.data || {};
      const isQR = Array.isArray(data)
        ? data.length > 0 && data[0].label !== undefined
        : data.quick_replies !== undefined || data.qrList !== undefined;
      return !isQR;
    });
  }, [characters, qrChar]);

  const filteredCharacters = useMemo(() => {
    if (!searchQuery) return validCharacters;
    const lowerQuery = searchQuery.toLowerCase();
    return validCharacters.filter((c) =>
      c.name.toLowerCase().includes(lowerQuery),
    );
  }, [validCharacters, searchQuery]);

  return createPortal(
    <AnimatePresence>
      {isOpen && qrChar && (
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
            className="version-modal-box rounded-3xl p-5 sm:p-6 w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] relative overflow-hidden"
          >
            <div className="flex items-center justify-between pb-3.5 border-b version-modal-border relative z-10 shrink-0">
              <div className="flex items-center gap-3 min-w-0 pr-2">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl flex items-center justify-center shadow-xs shrink-0 border bg-blue-500/15 border-blue-500/20 text-blue-400 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!border-blue-200/80 [.light-theme_&]:!text-blue-600">
                  <Link2 className="w-5 h-5 stroke-[2.2]" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-bold truncate version-modal-title">
                    将「{qrChar.name}」绑定至
                  </h3>
                  <p className="text-xs sm:text-sm truncate mt-0.5 version-modal-desc">
                    选择目标角色卡以整合其快速回复
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-full version-modal-close-btn flex items-center justify-center cursor-pointer transition shadow-xs shrink-0"
              >
                <X className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>

            <div className="pt-3.5 pb-2 relative z-10 shrink-0">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 version-modal-search-icon" />
                <input
                  type="text"
                  placeholder="搜索角色..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="version-input w-full rounded-2xl pl-10 pr-4 py-2.5 sm:py-3 text-sm sm:text-base outline-none focus:border-blue-500 transition"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 sm:space-y-2.5 pr-1 my-2 max-h-[48vh] custom-scrollbar relative z-10">
              {filteredCharacters.length === 0 ? (
                <div className="py-12 text-center text-sm version-modal-desc">
                  暂无匹配的角色
                </div>
              ) : (
                filteredCharacters.map((char) => (
                  <CharacterOption
                    key={char.id}
                    char={char}
                    isLightMode={isLightMode}
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

