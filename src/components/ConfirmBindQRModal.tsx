import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Link2, ArrowRight, Check } from "lucide-react";
import { CharacterCard, getCharacterBlob } from "../lib/db";
import { getFallbackAvatar, resolveAvatarUrl, safeCreateObjectURL } from "../lib/avatar";
import { useBackHandler } from "../lib/useBackHandler";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (deleteSource: boolean) => void;
  qrChar: CharacterCard | null;
  targetChar: CharacterCard | null;
  isLightMode?: boolean;
}

function ItemCardPreview({
  char,
  isQR,
  isLightMode,
}: {
  char: CharacterCard;
  isQR?: boolean;
  isLightMode?: boolean;
}) {
  const defaultFallback = getFallbackAvatar(
    char.name || char.id,
    isQR ? "tool" : undefined,
  );
  const [url, setUrl] = useState<string>(
    resolveAvatarUrl(
      char.avatarUrlFallback,
      char.name || char.id,
      isQR ? "快速回复" : undefined,
    ),
  );

  useEffect(() => {
    let objectUrl: string | null = null;
    let isMounted = true;
    if (char.localFilePath) {
      import("../lib/appBridge").then(({ getLocalImageUrl }) => {
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
    } else if (char.hasBlobsSeparated || (char as any).hasBlobsSeparated) {
      getCharacterBlob(char.id).then((blobs) => {
        if (blobs?.avatarBlob && isMounted) {
          objectUrl = safeCreateObjectURL(blobs.avatarBlob);
          if (objectUrl) setUrl(objectUrl);
        }
      });
    }
    return () => {
      isMounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [char]);

  return (
    <div
      className="flex flex-col items-center text-center p-3 sm:p-4 rounded-2xl flex-1 min-w-0 border version-candidate-card transition-all"
    >
      <div className="w-13 h-13 sm:w-16 sm:h-16 rounded-2xl overflow-hidden shrink-0 mb-2">
        <img
          src={url || defaultFallback}
          alt={char.name}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.currentTarget.src = defaultFallback;
          }}
        />
      </div>
      <h4
        className="font-bold text-xs sm:text-sm truncate w-full version-candidate-name px-1"
        title={char.name}
      >
        {char.name}
      </h4>
      <span
        className={`text-[10px] sm:text-[11px] mt-1.5 px-2.5 py-0.5 rounded-full font-medium tracking-tight whitespace-nowrap ${
          isQR
            ? "bg-blue-500/15 text-blue-500 dark:text-blue-400 border border-blue-500/20 font-semibold"
            : "soft-pill font-medium"
        }`}
      >
        {isQR ? "快速回复 (QR)" : "目标角色卡"}
      </span>
    </div>
  );
}

export function ConfirmBindQRModal({
  isOpen,
  onClose,
  onConfirm,
  qrChar,
  targetChar,
  isLightMode: propIsLightMode,
}: Props) {
  const [deleteSource, setDeleteSource] = useState(() => {
    const saved = localStorage.getItem('tavern_bind_qr_delete_source');
    return saved !== null ? saved === 'true' : true;
  });

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

  useEffect(() => {
    if (isOpen) {
      const saved = localStorage.getItem('tavern_bind_qr_delete_source');
      if (saved !== null) {
        setDeleteSource(saved === 'true');
      }
    }
  }, [isOpen, qrChar?.id, targetChar?.id]);

  const handleToggleDeleteSource = () => {
    setDeleteSource((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('tavern_bind_qr_delete_source', String(next));
      } catch (e) {}
      return next;
    });
  };

  const handleConfirm = () => {
    try {
      localStorage.setItem('tavern_bind_qr_delete_source', String(deleteSource));
    } catch (e) {}
    onConfirm(deleteSource);
  };

  if (!isOpen || !qrChar || !targetChar) return null;

  return createPortal(
    <AnimatePresence>
      <div 
        className={`fixed inset-0 z-[120] flex items-center justify-center p-4 backdrop-blur-sm ${
          isLightMode ? 'light-theme bg-black/35' : 'bg-black/80'
        }`}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 15 }}
          transition={{ type: "spring", duration: 0.3, bounce: 0.1 }}
          className="version-modal-box rounded-3xl p-5 sm:p-6 w-[92vw] sm:w-full max-w-lg shadow-2xl relative overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3.5 border-b version-modal-border">
            <div>
              <h3 className="text-base sm:text-lg font-bold leading-tight version-modal-title">
                绑定快速回复
              </h3>
              <p className="text-xs sm:text-sm mt-0.5 font-normal version-modal-desc">
                拖拽匹配角色并绑定
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full version-modal-close-btn flex items-center justify-center transition cursor-pointer"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>

          {/* Cards Connection Visualization */}
          <div className="py-3.5 sm:py-4 relative z-10 space-y-3">
            <div className="flex items-center gap-2">
              <ItemCardPreview char={qrChar} isQR={true} isLightMode={isLightMode} />

              <div className="flex items-center justify-center shrink-0 px-1 sm:px-1.5">
                <ArrowRight className="w-5 h-5 text-blue-500 dark:text-blue-400 stroke-[2.2]" />
              </div>

              <ItemCardPreview char={targetChar} isQR={false} isLightMode={isLightMode} />
            </div>

            <div className="text-xs sm:text-sm leading-relaxed p-3 sm:p-3.5 rounded-2xl border font-medium version-candidate-card flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-lg bg-blue-500/15 text-blue-500 dark:text-blue-400 flex items-center justify-center shrink-0">
                <Link2 className="w-3.5 h-3.5 stroke-[2.2]" />
              </div>
              <div className="min-w-0 flex-1">
                确认将快速回复「<span className="font-bold version-candidate-name">{qrChar.name}</span>」合并存入角色卡「<span className="font-bold version-candidate-name">{targetChar.name}</span>」中？
              </div>
            </div>

            {/* Delete Source Option */}
            <div
              onClick={handleToggleDeleteSource}
              className="flex items-center justify-between gap-2.5 p-2.5 sm:p-3 px-3.5 rounded-2xl border transition cursor-pointer select-none version-candidate-card"
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div
                  className={`w-4.5 h-4.5 rounded-md flex items-center justify-center transition shrink-0 version-checkbox-icon ${
                    deleteSource ? 'is-checked' : ''
                  }`}
                >
                  {deleteSource && <Check className="w-3 h-3 stroke-[2.5]" />}
                </div>
                <span className="text-xs sm:text-sm font-semibold version-candidate-name truncate">
                  绑定后将原独立 QR 卡片移至回收站
                </span>
              </div>
              <span className="text-[11px] version-candidate-sub opacity-60 shrink-0 hidden sm:inline">
                避免重复残留
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2 relative z-10">
            <button
              type="button"
              onClick={onClose}
              className="soft-pill flex-1 py-3 sm:py-3.5 px-4 rounded-2xl font-semibold transition-all text-sm sm:text-base active:scale-95 cursor-pointer text-center"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="flex-1 py-3 sm:py-3.5 px-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white border border-blue-600 [.light-theme_&]:!bg-blue-600 [.light-theme_&]:!border-blue-600 [.light-theme_&]:!text-white font-bold shadow-sm transition-all text-sm sm:text-base flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer"
            >
              <Link2 className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.2]" />
              确认绑定
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}
