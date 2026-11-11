import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Sparkles, ChevronRight, RefreshCw, Loader2, ArrowLeft, Eye, EyeOff, Tag, Save } from 'lucide-react';
import { CharacterCard, saveCharacter, getCharacter } from '../lib/db';
import { generateSummaryForCharacter } from '../lib/ai';
import {getFallbackAvatar, resolveAvatarUrl, safeCreateObjectURL, isFallbackMiuImage } from '../lib/avatar';
import { useBackHandler } from '../lib/useBackHandler';
import { CharacterRetagModal } from './CharacterRetagModal';
import { isRefusalOrApologySummary } from '../lib/taggerState';

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
  isLightMode,
}: Props) {
  const [showRetagModal, setShowRetagModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingText, setEditingText] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useBackHandler(true, () => {
    if (showRetagModal) {
      setShowRetagModal(false);
      return true;
    }
    if (isEditing) {
      setIsEditing(false);
      return true;
    }
    onClose();
    return true;
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [currentSummary, setCurrentSummary] = useState<string>('');

  const [showSummaryPopup, setShowSummaryPopup] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('miu_show_summary_popup') !== 'false';
  });

  const isLight = isLightMode ?? (typeof document !== 'undefined' && (document.documentElement.classList.contains('light-theme') || document.body.classList.contains('light-theme')));

  const handleToggleSummaryPopup = () => {
    const next = !showSummaryPopup;
    setShowSummaryPopup(next);
    localStorage.setItem('miu_show_summary_popup', next ? 'true' : 'false');
    window.dispatchEvent(new CustomEvent('summaryPopupSettingChanged', { detail: { enabled: next } }));
  };

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
      const created = safeCreateObjectURL(character.avatarBlob);
      if (created) {
        urlToRevoke = created;
        if (isMounted) setAvatarUrl(created);
      } else {
        setAvatarUrl(resolveAvatarUrl(character.avatarUrlFallback, name || character.id));
      }
    } else if (character.hasBlobsSeparated) {
      import('../lib/db').then(({ getCharacterBlob }) => {
        getCharacterBlob(character.id).then(blobs => {
          if (blobs?.avatarBlob && isMounted) {
            const created = safeCreateObjectURL(blobs.avatarBlob);
            if (created) {
              urlToRevoke = created;
              setAvatarUrl(created);
            }
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
        window.dispatchEvent(new CustomEvent('charactersUpdated'));
      }
    } catch (err) {
      console.error('Failed to regenerate summary:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStartEdit = () => {
    setEditingText(currentSummary || '');
    setIsEditing(true);
  };

  const handleSaveEditedSummary = async () => {
    setIsSaving(true);
    try {
      const fullChar = await getCharacter(character.id) || character;
      const trimmed = editingText.trim();
      fullChar.aiSummary = trimmed;
      if (fullChar.data?.data) {
        fullChar.data.data.aiSummary = trimmed;
      } else if (fullChar.data) {
        fullChar.data.aiSummary = trimmed;
      }
      await saveCharacter(fullChar);
      setCurrentSummary(trimmed);
      setIsEditing(false);
      onSummaryUpdated?.();
      window.dispatchEvent(new CustomEvent('charactersUpdated'));
    } catch (err) {
      console.error('Failed to save edited summary:', err);
      alert('保存简介失败，请重试');
    } finally {
      setIsSaving(false);
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
            className={`w-full h-full ${
              isFallbackMiuImage(avatarUrl || defaultFallback)
                ? 'object-cover bg-white opacity-90 filter blur-xs scale-105'
                : 'object-cover object-top opacity-90 filter blur-xs scale-105'
            }`}
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
            <div className={`w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden border-0 shadow-lg shrink-0 ${
              isFallbackMiuImage(avatarUrl || defaultFallback) ? 'bg-white' : 'bg-slate-800'
            }`}>
              <img
                src={avatarUrl || defaultFallback}
                alt={name}
                onError={(e) => {
                  (e.target as HTMLImageElement).src = defaultFallback;
                }}
                className={`w-full h-full ${
                  isFallbackMiuImage(avatarUrl || defaultFallback)
                    ? 'object-contain p-2 bg-white'
                    : 'object-cover'
                }`}
              />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg sm:text-xl font-bold truncate drop-shadow-sm text-white [.light-theme_&]:!text-[#0f172a]">
                {name}
              </h2>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 overflow-hidden max-h-7">
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
                ) : (
                  <span className="text-[10px] sm:text-xs text-white/50 [.light-theme_&]:!text-slate-400">暂无标签</span>
                )}
                <button
                  type="button"
                  onClick={() => setShowRetagModal(true)}
                  className={`px-2.5 py-0.5 rounded-lg text-[10px] sm:text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer active:scale-95 border ${
                    isLight
                      ? 'bg-[#007aff]/10 hover:bg-[#007aff]/15 text-[#007aff] border-[#007aff]/20 shadow-2xs'
                      : 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border-blue-500/30'
                  }`}
                  title="单卡 AI 重新打标"
                >
                  <Tag className={`w-3 h-3 ${isLight ? 'text-[#007aff]' : 'text-blue-300'}`} />
                  <span>AI打标</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Card Body - AI Summary Content matching Detail Card */}
        <div className="p-4 sm:p-6 space-y-3 sm:space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-amber-400 [.light-theme_&]:!text-amber-600">
              <span>角色简介</span>
              {isEditing ? (
                <span className="text-[11px] font-normal text-amber-400/80 [.light-theme_&]:!text-amber-600/80">
                  (编辑中)
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleStartEdit}
                  className="px-2 py-0.5 hover:bg-white/10 [.light-theme_&]:hover:bg-black/5 rounded-lg text-white/60 hover:text-white [.light-theme_&]:!text-slate-500 [.light-theme_&]:hover:!text-[#0f172a] transition cursor-pointer text-xs font-normal"
                  title="手动编辑简介内容"
                >
                  编辑
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!isEditing && (
                <>
                  <button
                    onClick={handleRegenerateSummary}
                    disabled={isGenerating}
                    className="text-xs text-white/50 hover:text-white [.light-theme_&]:!text-slate-500 [.light-theme_&]:hover:!text-[#0f172a] transition-colors cursor-pointer disabled:opacity-40 border-0 outline-none bg-transparent p-0 flex items-center gap-1 hover:underline"
                    title="重新生成总结"
                  >
                    {isGenerating && <Loader2 className="w-3 h-3 animate-spin" />}
                    <span>{isGenerating ? "正在重新总结..." : "重新总结"}</span>
                  </button>

                  <span className="text-white/20 [.light-theme_&]:!text-slate-300 text-xs select-none">·</span>
                </>
              )}

              {/* 简介菜单开关：控制卡库点击卡片时是否优先弹出简介弹窗 */}
              <button
                type="button"
                onClick={handleToggleSummaryPopup}
                className={`text-[11px] sm:text-xs px-2.5 py-1 rounded-full transition-all flex items-center gap-1.5 cursor-pointer border font-medium active:scale-95 ${isLight
                  ? showSummaryPopup
                    ? 'bg-[#eff6ff] hover:bg-[#dbeafe] text-[#2563eb] border-[#bfdbfe]'
                    : 'bg-[#f8fafc] hover:bg-[#f1f5f9] text-[#64748b] border-[#e2e8f0]'
                  : showSummaryPopup
                    ? 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border-blue-500/30'
                    : 'bg-white/5 hover:bg-white/10 text-white/50 border-white/10'
                }`}
                title={showSummaryPopup ? "简介一级菜单：已开启（卡库点击卡片优先展示简介）。点击可关闭全局简介弹窗，直接进入详情页。" : "简介一级菜单：已关闭（卡库点击卡片将直接进入详情页）。点击可重新开启全局简介弹窗。"}
              >
                {showSummaryPopup ? (
                  <>
                    <Eye className="w-3.5 h-3.5" />
                    <span>简介菜单</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="w-3.5 h-3.5 opacity-60" />
                    <span className="line-through opacity-70">简介菜单</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {isEditing ? (
            <div className="space-y-2.5">
              <div className="relative">
                <textarea
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  placeholder="输入或修改角色简介总结..."
                  rows={5}
                  className="w-full p-3.5 text-xs sm:text-sm leading-relaxed rounded-2xl resize-none outline-none transition border bg-black/30 text-white border-white/20 focus:border-amber-400/80 focus:ring-2 focus:ring-amber-400/30 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:focus:!border-amber-500 custom-scrollbar"
                  autoFocus
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-white/45 [.light-theme_&]:!text-slate-500">
                  字数: {editingText.length}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="px-3 py-1.5 rounded-xl text-xs font-medium text-white/70 hover:text-white hover:bg-white/10 [.light-theme_&]:!text-slate-600 [.light-theme_&]:hover:!bg-slate-100 transition cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={handleSaveEditedSummary}
                    className="px-4 py-1.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-xs transition active:scale-95 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    <span>保存简介</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="detail-card p-4 rounded-2xl min-h-[100px] max-h-[220px] overflow-y-auto custom-scrollbar relative">
              {isGenerating ? (
                <div className="flex flex-col items-center justify-center py-6 text-white/50 [.light-theme_&]:!text-slate-500">
                  <Loader2 className="w-6 h-6 animate-spin mb-2" />
                  <p className="text-xs">正在围绕人设与开场白重新总结...</p>
                </div>
              ) : currentSummary ? (
                <div className="space-y-2.5">
                  {isRefusalOrApologySummary(currentSummary) && (
                    <div className="p-2.5 rounded-xl text-xs flex items-center justify-between gap-2 bg-[#007aff]/10 text-blue-300 border border-[#007aff]/25 [.light-theme_&]:!bg-[#eff6ff] [.light-theme_&]:!text-[#1d4ed8] [.light-theme_&]:!border-[#bfdbfe]">
                      <span className="leading-snug flex items-center gap-1.5">
                        <span className="text-xs">💡</span> 上次总结为 AI 拒绝/道歉回复，可重新生成或点击上方“编辑”自行输入。
                      </span>
                      <button
                        type="button"
                        onClick={handleRegenerateSummary}
                        disabled={isGenerating}
                        className="px-2.5 py-1 rounded-lg font-medium shrink-0 bg-[#007aff] text-white hover:bg-[#0066d6] cursor-pointer border-none text-[11px] transition active:scale-95 shadow-xs"
                      >
                        重新生成
                      </button>
                    </div>
                  )}
                  <div className="detail-card-text text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {currentSummary}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <p className="detail-card-text-muted italic text-xs leading-relaxed">
                    暂无简介总结，可点击上方“重新总结”让 AI 生成，或点击上方“编辑”手动编写。
                  </p>
                </div>
              )}
            </div>
          )}
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

      {showRetagModal && (
        <CharacterRetagModal
          character={character}
          onClose={() => setShowRetagModal(false)}
          onTagsUpdated={async () => {
            onSummaryUpdated?.();
          }}
          isLightMode={isLight}
        />
      )}
    </div>
  );
}
