import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Sparkles, RefreshCw, Loader2, ArrowLeft, Check, AlertCircle, Plus, Tag } from 'lucide-react';
import { CharacterCard, saveCharacter, getCharacter } from '../lib/db';
import { generateTagsForCharacters } from '../lib/ai';
import {getFallbackAvatar, resolveAvatarUrl, safeCreateObjectURL, isFallbackMiuImage } from '../lib/avatar';
import { useBackHandler } from '../lib/useBackHandler';

interface Props {
  character: CharacterCard;
  onClose: () => void;
  onTagsUpdated?: (newTags: string[]) => void;
  onOpenSettings?: () => void;
  isLightMode?: boolean;
}

export function CharacterRetagModal({
  character,
  onClose,
  onTagsUpdated,
  onOpenSettings,
  isLightMode: propIsLightMode,
}: Props) {
  useBackHandler(true, () => {
    onClose();
    return true;
  });

  const isLight = propIsLightMode ?? (typeof document !== 'undefined' && (
    document.documentElement.classList.contains('light-theme') || 
    document.body.classList.contains('light-theme') ||
    localStorage.getItem('tavern_theme') === 'light'
  ));

  const [isGenerating, setIsGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [generatedTags, setGeneratedTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [customTagInput, setCustomTagInput] = useState('');
  const [showAddCustom, setShowAddCustom] = useState(false);

  const charData = character.data?.data || character.data || {};
  const name = character.name || charData.name || charData.char_name || '未命名角色';
  const existingTags: string[] = (Array.isArray(charData.tags) ? charData.tags : character.tags) || [];

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

  const runGenerateTags = async () => {
    setIsGenerating(true);
    setErrorMsg(null);
    try {
      const fullChar = await getCharacter(character.id) || character;
      const [tags] = await generateTagsForCharacters([fullChar]);
      if (tags && tags.length > 0) {
        setGeneratedTags(tags);
        setSelectedTags(new Set(tags));
        setHasGenerated(true);
      } else {
        setErrorMsg('AI 未能提取到有效标签，请重试');
      }
    } catch (err: any) {
      console.error('Failed to generate tags for single card:', err);
      if (err.message === 'API_KEY_MISSING') {
        setErrorMsg('未配置自定义 API，请先前往设置配置 API 接口');
      } else {
        setErrorMsg(err.message || '生成标签失败，请检查网络或 API 配置');
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleTagSelection = (tag: string) => {
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  const handleAddCustomTag = (inputOverride?: string | React.MouseEvent | React.KeyboardEvent) => {
    const raw = (typeof inputOverride === 'string' ? inputOverride : customTagInput).trim();
    if (!raw) return;
    const newItems = Array.from(new Set(
      raw.split(/[,，/|\\;；\n]/).map(t => t.trim()).filter(Boolean)
    ));
    if (newItems.length > 0) {
      setGeneratedTags(prev => Array.from(new Set([...prev, ...newItems])));
      setSelectedTags(prev => {
        const next = new Set(prev);
        newItems.forEach(t => next.add(t));
        return next;
      });
    }
    setCustomTagInput('');
    setShowAddCustom(false);
    setHasGenerated(true);
  };

  const handleApply = async (mode: 'replace' | 'merge') => {
    setIsSaving(true);
    try {
      const selectedList = Array.from(selectedTags);
      const finalTags = mode === 'merge'
        ? Array.from(new Set([...existingTags, ...selectedList]))
        : selectedList;

      const fullChar = await getCharacter(character.id) || character;
      let updatedData = typeof fullChar.data === 'object' && fullChar.data !== null ? { ...fullChar.data } : fullChar.data;
      if (updatedData && typeof updatedData === 'object') {
        if (updatedData.data) {
          updatedData.data = { ...updatedData.data, tags: finalTags };
        } else if (!Array.isArray(updatedData)) {
          updatedData.tags = finalTags;
        }
      }

      const updatedChar: CharacterCard = {
        ...fullChar,
        tags: finalTags,
        data: updatedData,
        updatedAt: Date.now(),
      };

      await saveCharacter(updatedChar);
      window.dispatchEvent(new CustomEvent('charactersUpdated'));
      onTagsUpdated?.(finalTags);
      onClose();
    } catch (err) {
      console.error('Failed to save character tags:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={`fixed inset-0 z-[120] flex items-center justify-center p-4 sm:p-6 overflow-y-auto select-none ${isLight ? 'light-theme' : ''}`}>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className={`fixed inset-0 backdrop-blur-sm ${isLight ? 'bg-black/35' : 'bg-black/60'}`}
      />

      {/* Card Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 10 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className={`relative z-10 w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl border-0 outline-none flex flex-col my-auto transition-colors duration-200 select-none ${
          isLight ? 'bg-[#ffffff] text-[#0f172a]' : 'bg-[#1c1c1e] text-white'
        }`}
      >
        {/* Header Image / Hero Avatar Banner */}
        <div className="relative w-full h-44 sm:h-50 overflow-hidden bg-black/40">
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
          <div className={`absolute inset-0 bg-gradient-to-t ${
            isLight
              ? 'from-[#ffffff] via-[#ffffff]/70 to-transparent'
              : 'from-[#1c1c1e] via-[#1c1c1e]/60 to-transparent'
          }`} />

          {/* Close Button */}
          <button
            onClick={onClose}
            className={`absolute top-3 right-3 p-2 rounded-full backdrop-blur-md transition cursor-pointer z-20 active:scale-95 border-0 ${
              isLight
                ? 'bg-black/10 hover:bg-black/15 text-[#0f172a]'
                : 'bg-black/40 hover:bg-black/60 text-white'
            }`}
            title="关闭"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Avatar & Title Over Overlay */}
          <div className="absolute bottom-3 left-4 right-4 flex items-end gap-3 sm:gap-4 z-10">
            <div className={`w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden border-0 shadow-lg shrink-0 ${
              isFallbackMiuImage(avatarUrl || defaultFallback)
                ? 'bg-white'
                : isLight ? 'bg-slate-100' : 'bg-slate-800'
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
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold mb-1 ${
                isLight ? 'bg-[#007aff]/10 text-[#007aff]' : 'bg-blue-500/20 text-blue-300'
              }`}>
                <Tag className="w-3 h-3" />
                <span>单卡 AI 打标</span>
              </div>
              <h2 className={`text-lg sm:text-xl font-bold truncate drop-shadow-sm ${
                isLight ? 'text-[#0f172a]' : 'text-white'
              }`}>
                {name}
              </h2>
            </div>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 space-y-4 sm:space-y-5">
          {/* Section: Current Tags */}
          <div className="space-y-2">
            <div className={`flex items-center justify-between text-xs sm:text-sm font-semibold ${
              isLight ? 'text-slate-600' : 'text-white/70'
            }`}>
              <span>当前已有标签</span>
              <span className={`text-xs font-normal ${isLight ? 'text-slate-400' : 'text-white/40'}`}>
                {existingTags.length} 个
              </span>
            </div>
            <div className={`p-3.5 rounded-2xl border min-h-[50px] flex flex-wrap items-center gap-1.5 transition-colors ${
              isLight 
                ? 'bg-[#f8fafc] border-[#e2e8f0]' 
                : 'bg-white/5 border-white/10'
            }`}>
              {existingTags.length > 0 ? (
                existingTags.map((tag, idx) => (
                  <span
                    key={idx}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                      isLight
                        ? 'bg-[#007aff]/10 text-[#007aff]'
                        : 'bg-blue-500/20 text-blue-300'
                    }`}
                  >
                    {tag}
                  </span>
                ))
              ) : (
                <span className={`text-xs italic ${isLight ? 'text-slate-400' : 'text-white/40'}`}>
                  当前角色暂无标签
                </span>
              )}
            </div>
          </div>

          {/* Section: AI Suggested Tags */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className={`flex items-center gap-1.5 text-xs sm:text-sm font-bold ${
                isLight ? 'text-amber-600' : 'text-amber-400'
              }`}>
                <Sparkles className="w-4 h-4" />
                <span>AI 推荐标签</span>
              </div>
              
              {hasGenerated && (
                <button
                  type="button"
                  onClick={runGenerateTags}
                  disabled={isGenerating}
                  className={`text-xs transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1 p-0 bg-transparent border-0 outline-none ${
                    isLight ? 'text-slate-500 hover:text-[#0f172a]' : 'text-white/60 hover:text-white'
                  }`}
                  title="重新生成标签"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
                  <span>{isGenerating ? '正在打标...' : '重新生成'}</span>
                </button>
              )}
            </div>

            <div className={`p-4 rounded-2xl border min-h-[120px] flex flex-col justify-center transition-colors ${
              isLight ? 'bg-[#f8fafc] border-[#e2e8f0]' : 'bg-white/5 border-white/10'
            }`}>
              {isGenerating ? (
                <div className="flex flex-col items-center justify-center py-6 text-center gap-2.5">
                  <Loader2 className="w-6 h-6 animate-spin text-[#007aff]" />
                  <p className={`text-xs ${isLight ? 'text-slate-600' : 'text-white/60'}`}>
                    正在分析人设与开场白，提取核心标签...
                  </p>
                </div>
              ) : errorMsg ? (
                <div className="flex flex-col items-center justify-center py-4 text-center gap-2">
                  <div className="flex items-center gap-1.5 text-xs text-red-500">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                  {errorMsg.includes('未配置') ? (
                    <button
                      onClick={() => {
                        onClose();
                        if (onOpenSettings) onOpenSettings();
                        else window.dispatchEvent(new CustomEvent('openAISettings'));
                      }}
                      className="mt-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/15 text-red-600 hover:bg-red-500/25 transition cursor-pointer"
                    >
                      去配置 API
                    </button>
                  ) : (
                    <button
                      onClick={runGenerateTags}
                      className={`mt-1 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        isLight
                          ? 'bg-slate-200 hover:bg-slate-300 text-slate-800'
                          : 'bg-white/10 hover:bg-white/15 text-white/90'
                      }`}
                    >
                      重试
                    </button>
                  )}
                </div>
              ) : !hasGenerated ? (
                /* 默认不自动生成，让用户主动点击生成 */
                <div className="flex flex-col items-center justify-center py-5 text-center gap-2.5">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    isLight ? 'bg-amber-100/60 text-amber-600' : 'bg-amber-500/20 text-amber-400'
                  }`}>
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div className="space-y-0.5">
                    <p className={`text-xs sm:text-sm font-semibold ${isLight ? 'text-slate-800' : 'text-white/90'}`}>
                      点击开始 AI 重新打标
                    </p>
                    <p className={`text-[11px] sm:text-xs ${isLight ? 'text-slate-500' : 'text-white/50'}`}>
                      AI 将结合人设外貌、性格设定与剧情开场白生成专属标签
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={runGenerateTags}
                    className="mt-1.5 px-5 py-2 rounded-full font-bold text-xs sm:text-sm transition-all flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95 bg-[#007aff] hover:bg-[#0066d6] text-white"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>生成推荐标签</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className={`text-[11px] ${isLight ? 'text-slate-500' : 'text-white/50'}`}>
                    点击标签可切换勾选状态（蓝色表示采用）：
                  </p>
                  <div className="flex flex-wrap gap-2 items-center">
                    {generatedTags.map((tag) => {
                      const isSelected = selectedTags.has(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleTagSelection(tag)}
                          className={`px-3 py-1.5 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-1.5 cursor-pointer border active:scale-95 ${
                            isSelected
                              ? 'bg-[#007aff] text-white border-[#007aff] shadow-xs'
                              : isLight
                                ? 'bg-white text-slate-600 border-slate-200 hover:text-slate-900 hover:border-slate-300 shadow-2xs'
                                : 'bg-white/5 text-white/50 border-white/10 hover:text-white/80 hover:bg-white/10'
                          }`}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                          <span>{tag}</span>
                        </button>
                      );
                    })}

                    {showAddCustom ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={customTagInput}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (/[/|\\;；,，\n]/.test(val)) {
                              handleAddCustomTag(val);
                            } else {
                              setCustomTagInput(val);
                            }
                          }}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddCustomTag()}
                          placeholder="新标签（支持 / | ， ；）"
                          autoFocus
                          className={`w-32 px-2 py-1 rounded-lg text-xs outline-none ${
                            isLight
                              ? 'bg-white text-slate-800 border border-slate-300 focus:border-[#007aff]'
                              : 'bg-black/60 border border-white/20 text-white focus:border-blue-400'
                          }`}
                        />
                        <button
                          onClick={handleAddCustomTag}
                          className="p-1 rounded-lg bg-[#007aff] text-white hover:bg-blue-600 cursor-pointer text-xs"
                          title="确定添加"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => { setShowAddCustom(false); setCustomTagInput(''); }}
                          className={`p-1 rounded-lg cursor-pointer text-xs ${
                            isLight ? 'bg-slate-200 text-slate-600 hover:text-slate-900' : 'bg-white/10 text-white/60 hover:text-white'
                          }`}
                          title="取消"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowAddCustom(true)}
                        className={`px-2.5 py-1.5 rounded-xl text-xs font-medium border border-dashed transition flex items-center gap-1 cursor-pointer ${
                          isLight
                            ? 'bg-white text-slate-500 hover:text-slate-800 border-slate-300 hover:border-slate-400 shadow-2xs'
                            : 'bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/90 border-white/20'
                        }`}
                        title="自定义加标签"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>自定义</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action Footer */}
        <div className="p-4 sm:p-6 pt-0 flex flex-col sm:flex-row gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={onClose}
            className={`w-full sm:w-auto px-5 py-2.5 sm:py-3 rounded-full font-medium text-xs sm:text-sm transition-all cursor-pointer active:scale-[0.98] border-0 outline-none flex items-center justify-center gap-1.5 ${
              isLight
                ? 'bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#334155]'
                : 'bg-white/10 hover:bg-white/15 text-white/80'
            }`}
          >
            <ArrowLeft className="w-4 h-4" />
            <span>取消</span>
          </button>

          <button
            type="button"
            onClick={() => handleApply('merge')}
            disabled={isGenerating || selectedTags.size === 0 || isSaving}
            className={`flex-1 py-2.5 sm:py-3 rounded-full font-bold text-xs sm:text-sm transition-all cursor-pointer active:scale-[0.98] border outline-none flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none ${
              isLight
                ? 'bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#0f172a] border-[#cbd5e1]'
                : 'bg-white/15 hover:bg-white/20 text-white border-white/10'
            }`}
            title="合并已有标签与所选标签"
          >
            <Tag className="w-4 h-4" />
            <span>合并追加 ({selectedTags.size})</span>
          </button>

          <button
            type="button"
            onClick={() => handleApply('replace')}
            disabled={isGenerating || selectedTags.size === 0 || isSaving}
            className={`flex-1 py-2.5 sm:py-3 rounded-full font-bold text-xs sm:text-sm transition-all cursor-pointer active:scale-[0.98] border-0 outline-none flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:pointer-events-none shadow-sm ${
              isLight
                ? 'bg-black hover:bg-neutral-800 text-white'
                : 'bg-white hover:bg-neutral-200 text-black'
            }`}
            title="仅保留所选标签，替换已有标签"
          >
            <Check className="w-4 h-4" />
            <span>全部替换 ({selectedTags.size})</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
