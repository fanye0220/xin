import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Link2, ArrowRight, Check, Trash2, Loader2, Sparkles } from "lucide-react";
import { CharacterCard } from "../lib/db";
import { getFallbackAvatar, resolveAvatarUrl } from "../lib/avatar";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  qrChar: CharacterCard | null;
  targetChar: CharacterCard | null;
  onConfirm: (options: { deleteOriginal: boolean }) => Promise<void>;
}

function CardPreview({
  char,
  label,
  isQR,
  subtitle,
}: {
  char: CharacterCard;
  label: string;
  isQR?: boolean;
  subtitle?: string;
}) {
  const defaultFallback = getFallbackAvatar(
    char.name || char.id,
    char.tags?.join(",") || (isQR ? "quick_reply" : char.isTool ? "tool" : undefined)
  );
  const [url, setUrl] = useState<string>(
    resolveAvatarUrl(char.avatarUrlFallback, char.name || char.id, isQR ? "快速回复" : undefined)
  );

  useEffect(() => {
    let objectUrl: string | null = null;
    let isMounted = true;
    if (char.localFilePath) {
      import("../lib/appBridge").then(({ getLocalImageUrl }) => {
        if (isMounted) setUrl(getLocalImageUrl(char.localFilePath!, char.updatedAt || char.createdAt));
      });
    } else if (char.avatarBlob) {
      objectUrl = URL.createObjectURL(char.avatarBlob);
      if (isMounted) setUrl(objectUrl);
    } else if (char.hasBlobsSeparated) {
      import("../lib/db").then(({ getCharacterBlob }) => {
        getCharacterBlob(char.id).then((blobs) => {
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
    <div className="flex-1 bg-black/40 border border-white/10 rounded-2xl p-3 flex flex-col items-center text-center relative overflow-hidden group">
      <div className="absolute top-2 left-2">
        <span
          className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
            isQR
              ? "bg-purple-500/20 text-purple-300 border-purple-500/30"
              : "bg-blue-500/20 text-blue-300 border-blue-500/30"
          }`}
        >
          {label}
        </span>
      </div>
      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden mt-6 mb-2 border border-white/15 bg-black/40 shadow-inner shrink-0">
        <img
          src={url || undefined}
          alt={char.name}
          className="w-full h-full object-cover"
          onError={(e) => {
            if (e.currentTarget.src !== defaultFallback) e.currentTarget.src = defaultFallback;
          }}
        />
      </div>
      <h4 className="font-semibold text-white text-sm truncate w-full px-1" title={char.name}>
        {char.name}
      </h4>
      {subtitle && <p className="text-xs text-white/50 truncate w-full mt-0.5">{subtitle}</p>}
    </div>
  );
}

export function DragQRBindModal({
  isOpen,
  onClose,
  qrChar,
  targetChar,
  onConfirm,
}: Props) {
  const [deleteOriginal, setDeleteOriginal] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const qrReplyCount = useMemo(() => {
    if (!qrChar) return 0;
    const data = qrChar.data || {};
    if (Array.isArray(data)) return data.length;
    if (Array.isArray(data.qrList)) return data.qrList.length;
    if (Array.isArray(data.quick_replies)) return data.quick_replies.length;
    if (Array.isArray(data.tavern_qr_sets))
      return data.tavern_qr_sets.flatMap((s: any) => s.replies || []).length;
    if (data.data) {
      const inner = data.data;
      if (Array.isArray(inner)) return inner.length;
      if (Array.isArray(inner.qrList)) return inner.qrList.length;
      if (Array.isArray(inner.quick_replies)) return inner.quick_replies.length;
      if (Array.isArray(inner.tavern_qr_sets))
        return inner.tavern_qr_sets.flatMap((s: any) => s.replies || []).length;
    }
    return 0;
  }, [qrChar]);

  const targetExistingSetsCount = useMemo(() => {
    if (!targetChar) return 0;
    const data = targetChar.data?.data || targetChar.data || {};
    const sets = data.extensions?.tavern_qr_sets;
    return Array.isArray(sets) ? sets.length : 0;
  }, [targetChar]);

  if (!isOpen || !qrChar || !targetChar) return null;

  const handleConfirm = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onConfirm({ deleteOriginal });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="bg-slate-900/95 backdrop-blur-2xl rounded-3xl w-full max-w-md border border-purple-500/30 shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0 bg-gradient-to-r from-purple-500/10 to-transparent">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300">
              <Link2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-base">快捷回复绑定确认</h3>
              <p className="text-xs text-white/50">拖拽绑定快捷回复到角色卡</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-2 -mr-1 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition disabled:opacity-30"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-5 flex flex-col gap-4">
          {/* Card comparison */}
          <div className="flex items-center gap-2">
            <CardPreview
              char={qrChar}
              label="快捷回复"
              isQR={true}
              subtitle={qrReplyCount > 0 ? `${qrReplyCount} 条回复` : undefined}
            />

            <div className="shrink-0 flex flex-col items-center justify-center px-1">
              <div className="w-8 h-8 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 shadow-lg shadow-purple-500/20">
                <ArrowRight className="w-4 h-4" />
              </div>
            </div>

            <CardPreview
              char={targetChar}
              label="目标角色"
              isQR={false}
              subtitle={
                targetExistingSetsCount > 0
                  ? `已有 ${targetExistingSetsCount} 组QR`
                  : "暂无QR"
              }
            />
          </div>

          {/* Details message */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-3.5 text-xs text-white/80 space-y-1.5 leading-relaxed">
            <div className="flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
              <p>
                确认将快捷回复 <span className="text-purple-300 font-semibold">【{qrChar.name}】</span> 绑定到角色卡 <span className="text-blue-300 font-semibold">【{targetChar.name}】</span> 上吗？
              </p>
            </div>
            <p className="text-white/50 pl-6">
              绑定后，可在该角色卡的聊天界面直接使用这套快捷回复。
            </p>
          </div>

          {/* Delete original checkbox */}
          <label className="flex items-center gap-3 p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl cursor-pointer transition select-none">
            <input
              type="checkbox"
              checked={deleteOriginal}
              onChange={(e) => setDeleteOriginal(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-black/40 text-purple-600 focus:ring-purple-500/50 focus:ring-offset-0 cursor-pointer"
            />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-white block">
                绑定成功后将原快捷回复卡移至回收站
              </span>
              <span className="text-xs text-white/40 block">
                推荐勾选，避免在文件夹中残留独立的未绑定卡片
              </span>
            </div>
          </label>
        </div>

        {/* Footer actions */}
        <div className="p-4 border-t border-white/10 flex items-center justify-end gap-2.5 bg-black/20">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 rounded-xl text-sm font-medium text-white/70 hover:text-white hover:bg-white/10 transition disabled:opacity-30"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="px-5 py-2 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg shadow-purple-600/30 flex items-center gap-2 transition active:scale-95 disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>正在绑定...</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>确认绑定</span>
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
