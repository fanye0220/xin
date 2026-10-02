import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, Link2, ArrowRight, Check } from "lucide-react";
import { CharacterCard, getCharacterBlob } from "../lib/db";
import { getFallbackAvatar, resolveAvatarUrl } from "../lib/avatar";
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
      objectUrl = URL.createObjectURL(char.avatarBlob);
      if (isMounted) setUrl(objectUrl);
    } else if (char.hasBlobsSeparated || (char as any).hasBlobsSeparated) {
      getCharacterBlob(char.id).then((blobs) => {
        if (blobs?.avatarBlob && isMounted) {
          objectUrl = URL.createObjectURL(blobs.avatarBlob);
          setUrl(objectUrl);
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
      className={`flex flex-col items-center text-center p-3 sm:p-3.5 rounded-2xl flex-1 min-w-0 border ${
        isLightMode
          ? "bg-slate-900/50 border-slate-700/20"
          : "bg-white/[0.04] border-white/10"
      }`}
    >
      <div
        className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden shrink-0 mb-2.5 border ${
          isLightMode
            ? "bg-slate-700/10 border-slate-700/20"
            : "bg-black/40 border-white/10"
        }`}
      >
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
        className={`font-bold text-xs sm:text-sm truncate w-full ${
          isLightMode ? "text-slate-100" : "text-white"
        }`}
        title={char.name}
      >
        {char.name}
      </h4>
      <span
        className={`text-[10px] sm:text-[11px] mt-1.5 px-2.5 py-0.5 rounded-full font-medium border ${
          isQR
            ? isLightMode
              ? "bg-blue-50 text-blue-600 border-blue-200/80"
              : "bg-blue-500/15 text-blue-300 border-blue-500/30"
            : isLightMode
              ? "bg-slate-200/70 text-slate-700 border-slate-300/80"
              : "bg-white/10 text-white/80 border-white/15"
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
          className={`rounded-3xl p-5 sm:p-6 w-[92vw] sm:w-full max-w-lg shadow-2xl relative overflow-hidden border ${
            isLightMode
              ? "bg-slate-800 text-slate-100 border-none"
              : "bg-[#1c1c1e] text-white border-white/10"
          }`}
        >
          {/* Header */}
          <div
            className={`flex items-center justify-between pb-3.5 border-b ${
              isLightMode ? "border-slate-100" : "border-white/10"
            }`}
          >
            <div>
              <h3
                className={`text-base sm:text-lg font-bold leading-tight ${
                  isLightMode ? "text-slate-100" : "text-white"
                }`}
              >
                绑定快速回复
              </h3>
              <p
                className={`text-xs sm:text-sm mt-0.5 font-normal ${
                  isLightMode ? "text-slate-600" : "text-white/60"
                }`}
              >
                拖拽匹配角色并绑定
              </p>
            </div>
            <button
              onClick={onClose}
              className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition cursor-pointer ${
                isLightMode
                  ? "bg-slate-700/10 hover:bg-slate-700/20 text-slate-600 hover:text-slate-100"
                  : "bg-white/10 hover:bg-white/15 text-white/60 hover:text-white"
              }`}
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>

          {/* Cards Connection Visualization */}
          <div className="py-4 sm:py-5 relative z-10">
            <div className="flex items-center gap-2">
              <ItemCardPreview char={qrChar} isQR={true} isLightMode={isLightMode} />

              <div className="flex flex-col items-center justify-center shrink-0 px-1">
                <div
                  className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full border flex items-center justify-center ${
                    isLightMode
                      ? "bg-blue-50 border-blue-200/80 text-blue-600"
                      : "bg-blue-500/15 border-blue-500/25 text-blue-400"
                  }`}
                >
                  <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.2]" />
                </div>
                <span
                  className={`text-xs font-bold mt-1 ${
                    isLightMode ? "text-blue-600" : "text-blue-400"
                  }`}
                >
                  绑定至
                </span>
              </div>

              <ItemCardPreview char={targetChar} isQR={false} isLightMode={isLightMode} />
            </div>

            <div
              className={`text-sm sm:text-base mt-4 leading-relaxed p-4 rounded-2xl border font-medium ${
                isLightMode
                  ? "bg-slate-900/50 border-slate-700/20 text-slate-100"
                  : "bg-white/[0.04] border-white/10 text-white/90"
              }`}
            >
              确定要将快速回复「
              <span
                className={`font-bold ${
                  isLightMode ? "text-blue-600" : "text-blue-400"
                }`}
              >
                {qrChar.name}
              </span>
              」绑定到角色「
              <span
                className={`font-bold ${
                  isLightMode ? "text-blue-600" : "text-blue-400"
                }`}
              >
                {targetChar.name}
              </span>
              」吗？
            </div>

            {/* Delete Source Option */}
            <div
              onClick={handleToggleDeleteSource}
              className={`flex items-start gap-3 p-4 mt-3 rounded-2xl border transition cursor-pointer select-none ${
                isLightMode
                  ? "bg-slate-50 border-slate-200/80 hover:bg-slate-100/70"
                  : "bg-white/[0.04] border-white/10 hover:bg-white/[0.07]"
              }`}
            >
              <div
                className={`w-5 h-5 rounded-lg flex items-center justify-center border transition shrink-0 mt-0.5 ${
                  deleteSource
                    ? "bg-blue-600 border-blue-600 text-white shadow-sm shadow-blue-500/30"
                    : isLightMode
                      ? "border-slate-700 bg-slate-800"
                      : "border-white/30 bg-black/30"
                }`}
              >
                {deleteSource && <Check className="w-3.5 h-3.5 text-white stroke-[2.5]" />}
              </div>
              <div className="flex-1 min-w-0">
                <span
                  className={`text-sm font-bold block ${
                    isLightMode ? "text-slate-100" : "text-white"
                  }`}
                >
                  绑定后将独立 QR 卡片移至回收站
                </span>
                <span
                  className={`text-xs sm:text-sm block mt-0.5 leading-relaxed ${
                    isLightMode ? "text-slate-100/60" : "text-white/50"
                  }`}
                >
                  推荐勾选，避免在列表中残留重复冗余的独立快速回复卡
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2 relative z-10">
            <button
              type="button"
              onClick={onClose}
              className={`flex-1 py-3 sm:py-3.5 px-4 rounded-2xl font-semibold transition-all text-sm sm:text-base active:scale-95 cursor-pointer ${
                isLightMode
                  ? "bg-slate-700/10 hover:bg-slate-700/20 text-slate-100 font-bold"
                  : "bg-[#2c2c2e] hover:bg-[#3a3a3c] text-white"
              }`}
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="flex-1 py-3 sm:py-3.5 px-4 rounded-2xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold shadow-md shadow-blue-600/20 transition-all text-sm sm:text-base flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer"
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
