import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Sparkles, ChevronRight, RefreshCw, Loader2, ArrowLeft } from 'lucide-react';
import { CharacterCard, saveCharacter, getCharacter } from '../lib/db';
import { generateSummaryForCharacter } from '../lib/ai';
import { getFallbackAvatar, resolveAvatarUrl } from '../lib/avatar';
import { useBackHandler } from '../lib/useBackHandler';

interface Props {
  character: CharacterCard;
  onClose: () => void;
  onOpenDetail: (id: string) => void;
  onOpenChat?: (id: string) => void;
  onSummaryUpdated?: () => void;
  isLightMode?: boolean;
}

export function CharacterSummaryModal({
  character,
  onClose,
  onOpenDetail,
  onSummaryUpdated,
}: Props) {
  useBackHandler(true, () => {
    onClose();
    return true;
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [currentSummary, setCurrentSummary] = useState<string>('');

  const charData = character.data?.data || character.data || {};
  const name = character.name || charData.name || charData.char_name || '未命名角色';
  const tags = (Array.isArray(charData.tags) ? charData.tags : character.tags) || [];
  
  const defaultFallback = getFallbackAvatar(name || character.id, character.tags?.join(',') || (character.isTool ? 'tool' : undefined));
  const initialUrl = resolveAvatarUrl(character.avatarUrlFallback, name || character.id);
  const [avatarUrl, setAvatarUrl] = useState<string>(initialUrl);

  useEffect(() => {
    let urlToRevoke: string | undefined;
    let isMounted = true;

    if (character.localFilePath) {
      import('../lib/appBridge').then(({ getLocalImageUrl }) => {
        if (isMounted) {
          setAvatarUrl(getLocalImageUrl(character.localFilePath!, character.updatedAt || character.createdAt));
        }
      });
    } else if (character.avatarBlob) {
      urlToRevoke = URL.createObjectURL(character.avatarBlob);
      if (isMounted) setAvatarUrl(urlToRevoke);
    } else if (character.hasBlobsSeparated) {
      import('../lib/db').then(({ getCharacterBlob }) => {
        getCharacterBlob(character.id).then(blobs => {
          if (blobs?.avatarBlob && isMounted) {
            urlToRevoke = URL.createObjectURL(blobs.avatarBlob);
            setAvatarUrl(urlToRevoke);
          }
        });
      });
    } else {
      setAvatarUrl(resolveAvatarUrl(character.avatarUrlFallback, name || character.id));
    }

    return () => {
      isMounted = false;
      if (urlToRevoke) URL.revokeObjectURL(urlToRevoke);
    };
  }, [character, name]);

  useEffect(() => {
    const sum = character.aiSummary || charData.aiSummary || '';
    setCurrentSummary(sum);
  }, [character, charData.aiSummary]);

  const handleRegenerateSummary = async () => {
    setIsGenerating(true);
    try {
      const fullChar = await getCharacter(character.id) || character;
      const newSummary = await generateSummaryForCharacter(fullChar);
      if (newSummary) {
        fullChar.aiSummary = newSummary;
        if (fullChar.data?.data) {
          fullChar.data.data.aiSummary = newSummary;
        } else if (fullChar.data) {
          fullChar.data.aiSummary = newSummary;
        }
        await saveCharacter(fullChar);
        setCurrentSummary(newSummary);
        onSummaryUpdated?.();
      }
    } catch (err) {
      console.error('Failed to regenerate summary:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 sm:p-6 overflow-y-auto select-none">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 [.light-theme_&]:bg-black/40 backdrop-blur-sm"
      />

      {/* Card Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 10 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl border-0 outline-none flex flex-col my-auto transition-colors duration-200 bg-[#1c1c1e] [.light-theme_&]:!bg-[#ffffff] text-white [.light-theme_&]:!text-[#0f172a] select-none"
      >
        {/* Header Image / Hero Avatar Banner */}
        <div className="relative w-full h-48 sm:h-56 overflow-hidden bg-black/40">
          <img
            src={avatarUrl || defaultFallback}
            alt={name}
            onError={(e) => {
              (e.target as HTMLImageElement).src = defaultFallback;
            }}
            className="w-full h-full object-cover object-top opacity-90 filter blur-xs scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#1c1c1e] via-[#1c1c1e]/60 to-transparent [.light-theme_&]:!from-[#ffffff] [.light-theme_&]:!via-[#ffffff]/60" />

          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white backdrop-blur-md transition cursor-pointer z-20 active:scale-95 border-0 [.light-theme_&]:!bg-black/10 [.light-theme_&]:!text-[#0f172a]"
            title="关闭"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Avatar & Title Over Overlay */}
          <div className="absolute bottom-3 left-4 right-4 flex items-end gap-3 sm:gap-4 z-10">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden border-0 shadow-lg shrink-0 bg-slate-800">
              <img
                src={avatarUrl || defaultFallback}
                alt={name}
                onError={(e) => {
                  (e.target as HTMLImageElement).src = defaultFallback;
                }}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg sm:text-xl font-bold truncate drop-shadow-sm text-white [.light-theme_&]:!text-[#0f172a]">
                {name}
              </h2>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5 overflow-hidden max-h-7">
                  {tags.slice(0, 4).map((tag, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-0.5 rounded-lg text-[10px] sm:text-xs font-semibold border-0 outline-none bg-[#007aff]/10 text-[#007aff] [.light-theme_&]:!bg-[#007aff]/10 [.light-theme_&]:!text-[#007aff]"
                    >
                      {tag}
                    </span>
                  ))}
                  {tags.length > 4 && (
                    <span className="text-[10px] sm:text-xs font-semibold text-[#007aff] [.light-theme_&]:!text-[#007aff] self-center ml-0.5">
                      +{tags.length - 4}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Card Body - AI Summary Content matching Detail Card */}
        <div className="p-4 sm:p-6 space-y-3 sm:space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-amber-400 [.light-theme_&]:!text-amber-600">
              <span>角色简介</span>
            </div>
            <button
              onClick={handleRegenerateSummary}
              disabled={isGenerating}
              className="text-xs text-white/50 hover:text-white flex items-center gap-1 transition cursor-pointer disabled:opacity-50 [.light-theme_&]:!text-slate-500 [.light-theme_&]:hover:!text-[#0f172a]"
              title="重新生成总结"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
              <span>重新总结</span>
            </button>
          </div>

          <div className="detail-card p-4 rounded-2xl min-h-[100px] max-h-[220px] overflow-y-auto custom-scrollbar relative">
            {isGenerating ? (
              <div className="flex flex-col items-center justify-center py-6 text-white/50 [.light-theme_&]:!text-slate-500">
                <Loader2 className="w-6 h-6 animate-spin mb-2" />
                <p className="text-xs">正在围绕人设与开场白重新总结...</p>
              </div>
            ) : currentSummary ? (
              <div className="detail-card-text text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words">
                {currentSummary}
              </div>
            ) : (
              <p className="detail-card-text-muted italic text-xs">
                暂无简介总结，点击上方“重新总结”即可生成 1-300 字简介。
              </p>
            )}
          </div>
        </div>

        {/* Action Footer */}
        <div className="p-4 sm:p-6 pt-0 flex gap-3">
          <button
            onClick={onClose}
            className="w-full py-2.5 sm:py-3 rounded-full font-medium text-sm transition-all cursor-pointer active:scale-[0.98] border-0 outline-none flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 active:bg-white/5 text-white/90 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:active:!bg-[#cbd5e1] [.light-theme_&]:!text-[#334155]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回</span>
          </button>

          <button
            onClick={() => {
              onClose();
              onOpenDetail(character.id);
            }}
            className="w-full py-2.5 sm:py-3 rounded-full font-bold text-sm transition-all cursor-pointer active:scale-[0.98] border-0 outline-none flex items-center justify-center gap-2 bg-white text-black hover:bg-neutral-200 [.light-theme_&]:!bg-black [.light-theme_&]:hover:!bg-neutral-800 [.light-theme_&]:!text-white shadow-sm"
          >
            <span>进入详情页</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
