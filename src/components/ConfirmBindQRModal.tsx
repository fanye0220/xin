import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Link as LinkIcon, ArrowRight, Sparkles, Check, Trash2 } from "lucide-react";
import { CharacterCard, getCharacterBlob } from "../lib/db";
import { getFallbackAvatar, resolveAvatarUrl } from "../lib/avatar";
import { useBackHandler } from "../lib/useBackHandler";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (deleteSource: boolean) => void;
  qrChar: CharacterCard | null;
  targetChar: CharacterCard | null;
}

function ItemCardPreview({
  char,
  isQR,
}: {
  char: CharacterCard;
  isQR?: boolean;
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
    <div className="flex flex-col items-center text-center p-3.5 rounded-2xl bg-white/5 border border-white/10 flex-1 min-w-0 shadow-lg">
      <div className="w-16 h-16 rounded-2xl overflow-hidden shrink-0 bg-black/40 shadow-inner mb-2.5 border border-white/10">
        <img
          src={url || defaultFallback}
          alt={char.name}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.currentTarget.src = defaultFallback;
          }}
        />
      </div>
      <h4 className="font-semibold text-white text-sm truncate w-full" title={char.name}>
        {char.name}
      </h4>
      <span
        className={`text-[11px] mt-1 px-2.5 py-0.5 rounded-full font-medium ${
          isQR
            ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
            : "bg-blue-500/20 text-blue-300 border border-blue-500/30"
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
}: Props) {
  const [deleteSource, setDeleteSource] = useState(true);

  useBackHandler(isOpen, () => {
    onClose();
    return true;
  });

  useEffect(() => {
    if (isOpen) {
      setDeleteSource(true);
    }
  }, [isOpen, qrChar?.id, targetChar?.id]);

  if (!isOpen || !qrChar || !targetChar) return null;

  return (
    <AnimatePresence>
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 15 }}
          transition={{ type: "spring", duration: 0.3, bounce: 0.1 }}
          className="bg-slate-900 border border-white/15 rounded-3xl p-6 w-full max-w-md shadow-2xl relative overflow-hidden"
        >
          {/* Top background glow */}
          <div className="absolute -top-20 -left-20 w-48 h-48 bg-purple-500/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -top-20 -right-20 w-48 h-48 bg-pink-500/20 rounded-full blur-3xl pointer-events-none" />

          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-white/10 relative z-10">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center text-white shadow-md shadow-purple-500/20">
                <LinkIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white leading-tight">
                  绑定快速回复
                </h3>
                <p className="text-xs text-white/50">拖拽匹配快速绑定</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Cards Connection Visualization */}
          <div className="py-5 relative z-10">
            <div className="flex items-center gap-2">
              <ItemCardPreview char={qrChar} isQR={true} />

              <div className="flex flex-col items-center justify-center shrink-0 px-1">
                <div className="w-8 h-8 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300 shadow-md">
                  <ArrowRight className="w-4 h-4" />
                </div>
                <span className="text-[10px] text-purple-300/80 font-medium mt-1">
                  绑定至
                </span>
              </div>

              <ItemCardPreview char={targetChar} isQR={false} />
            </div>

            <div className="confirm-qr-tip text-xs mt-4 leading-relaxed p-3.5 rounded-2xl border font-medium">
              确定要将快速回复「<span className="confirm-qr-name font-bold">{qrChar.name}</span>」绑定到角色「<span className="confirm-target-name font-bold">{targetChar.name}</span>」吗？
            </div>

            {/* Delete Source Option */}
            <div
              onClick={() => setDeleteSource(!deleteSource)}
              className="flex items-start gap-3 p-3.5 mt-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition cursor-pointer select-none"
            >
              <div
                className={`w-5 h-5 rounded-md flex items-center justify-center border transition shrink-0 mt-0.5 ${
                  deleteSource
                    ? "bg-purple-600 border-purple-500 text-white"
                    : "border-white/30 bg-black/30"
                }`}
              >
                {deleteSource && <Check className="w-3.5 h-3.5" />}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-white block">
                  绑定后将独立 QR 卡片移至回收站
                </span>
                <span className="text-xs text-white/50 block mt-0.5">
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
              className="flex-1 py-3 px-4 rounded-xl bg-white/10 hover:bg-white/15 text-white/80 font-medium transition text-sm active:scale-95"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => onConfirm(deleteSource)}
              className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 hover:opacity-90 text-white font-semibold shadow-lg shadow-purple-500/25 transition text-sm flex items-center justify-center gap-1.5 active:scale-95"
            >
              <LinkIcon className="w-4 h-4" />
              确认绑定
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
