import { getFallbackAvatar, resolveAvatarUrl } from '../lib/avatar';
import { useEffect, useState } from 'react';
import { ArrowLeft, Tag, Play, CheckCircle2, Loader2, AlertCircle, Pause, Square, PlayCircle, RefreshCw, X, ArrowRightLeft, History, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { taggerState, useTaggerState, RetagReviewItem } from '../lib/taggerState';

function RetagReviewCard({ item }: { item: RetagReviewItem }) {
  const [activeTags, setActiveTags] = useState<string[]>([...item.newTags]);
  const [inputValue, setInputValue] = useState('');

  const unusedOldTags = item.oldTags.filter(t => !activeTags.includes(t));

  const handleAdd = (tag: string) => {
    const t = tag.trim().replace(/^,+|,+$/g, '');
    if (t && !activeTags.includes(t)) {
      setActiveTags([...activeTags, t]);
    }
    setInputValue('');
  };

  const handleRemove = (tag: string) => {
    setActiveTags(activeTags.filter(t => t !== tag));
  };

  const charName = item.char.data?.data?.name || item.char.data?.name || '未知角色';
  const defaultFallback = getFallbackAvatar(charName || item.char.id, item.char.tags?.join(',') || (item.char.isTool ? 'tool' : undefined));
  const initialUrl = resolveAvatarUrl(item.char.avatarUrlFallback, item.char.name || item.char.id);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(initialUrl);

  useEffect(() => {
    let url: string | undefined;
    let isMounted = true;

    if (item.char.localFilePath) {
      import('../lib/appBridge').then(({ getLocalImageUrl }) => {
        if(isMounted) setAvatarUrl(getLocalImageUrl(item.char.localFilePath!, item.char.updatedAt || item.char.createdAt));
      });
    } else if (item.char.avatarBlob) {
      url = URL.createObjectURL(item.char.avatarBlob);
      if(isMounted) setAvatarUrl(url);
    } else if (item.char.hasBlobsSeparated) {
      import('../lib/db').then(({ getCharacterBlob }) => {
        getCharacterBlob(item.char.id).then(blobs => {
          if (blobs?.avatarBlob && isMounted) {
            url = URL.createObjectURL(blobs.avatarBlob);
            setAvatarUrl(url);
          }
        });
      });
    }
    
    return () => {
      isMounted = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.char]);

  return (
    <div className="bg-slate-800/80 border-none rounded-2xl sm:rounded-3xl p-4 sm:p-5 flex flex-col gap-3.5 sm:gap-5 shadow-xl transition-all [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!shadow-md">
      <div className="flex items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-3 min-w-0">
           <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 shadow-inner">
             <img 
             src={avatarUrl || undefined} 
             alt={charName} 
             className="w-full h-full object-cover" 
             referrerPolicy="no-referrer"
             onError={(e) => {
               if (e.currentTarget.src !== defaultFallback) {
                 e.currentTarget.src = defaultFallback;
               }
             }}
           />
           </div>
           <h4 className="font-bold text-lg text-white truncate [.light-theme_&]:!text-[#0f172a]">{charName}</h4>
        </div>
        <button
          onClick={() => taggerState.rejectRetag(item.char.id)}
          className="p-2 -mr-2 text-white/40 hover:text-red-400 hover:bg-white/5 rounded-full transition relative group [.light-theme_&]:!text-[#8e8e93] [.light-theme_&]:hover:!text-[#ff3b30] [.light-theme_&]:hover:!bg-black/5"
          title="忽略此建议"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 flex flex-col gap-5">
        {/* 旧标签对照区 */}
        <div className="flex flex-col gap-2 bg-white/5 border-none rounded-xl p-3 [.light-theme_&]:!bg-[#f8fafc]">
          <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-white/50 px-1 pb-1.5 [.light-theme_&]:!text-[#64748b]">
            <span>旧标签</span>
          </div>
          <div className="flex flex-wrap gap-1.5 min-h-[32px] content-start">
            {item.oldTags.length === 0 ? (
              <span className="text-white/30 text-xs sm:text-sm italic mt-1 ml-1 [.light-theme_&]:!text-[#94a3b8]">无原始标签</span>
            ) : (
              item.oldTags.map(tag => {
                const isKept = activeTags.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => isKept ? handleRemove(tag) : handleAdd(tag)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs sm:text-sm border-none transition-all flex items-center gap-1.5 ${
                      isKept 
                        ? 'bg-white/20 text-white font-semibold active:scale-95 cursor-pointer [.light-theme_&]:!bg-[#e0edff] [.light-theme_&]:!text-[#0056b3]' 
                        : 'bg-white/10 hover:bg-white/20 text-white/70 active:scale-95 cursor-pointer [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#64748b]'
                    }`}
                  >
                    <span className="truncate max-w-[140px]">{tag}</span>
                    {isKept ? <X className="w-3.5 h-3.5 opacity-80" /> : <span className="opacity-50 font-bold">+</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* 新标签可编辑区 */}
        <div className="flex flex-col gap-2 bg-white/5 border-none rounded-xl p-3 [.light-theme_&]:!bg-[#f8fafc]">
          <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-white/80 px-1 pb-1.5 [.light-theme_&]:!text-[#0f172a]">
            <span>AI 生成新标签</span>
          </div>
          <div 
            className="transition-all cursor-text min-h-[60px] flex content-start flex-wrap gap-2" 
            onClick={() => document.getElementById(`tag-input-${item.char.id}`)?.focus()}
          >
            <AnimatePresence>
              {activeTags.map(tag => {
                const isShared = item.oldTags.includes(tag);
                return (
                  <motion.span 
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    key={tag} 
                    className={`pl-3 pr-1.5 py-1.5 rounded-lg text-xs sm:text-sm flex items-center gap-1.5 group border-none ${
                      isShared 
                        ? 'bg-white/20 text-white font-semibold [.light-theme_&]:!bg-[#e0edff] [.light-theme_&]:!text-[#0056b3]' 
                        : 'bg-white/10 text-white/90 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:shadow-2xs'
                    }`}
                  >
                    <span className="truncate max-w-[150px]">{tag}</span>
                    <button onClick={(e) => { e.stopPropagation(); handleRemove(tag); }} className="p-0.5 rounded-md transition pointer-events-auto hover:bg-white/20 text-white/70 hover:text-white [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#0f172a] [.light-theme_&]:hover:!bg-black/5">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </motion.span>
                );
              })}
            </AnimatePresence>
            <input 
              id={`tag-input-${item.char.id}`}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  handleAdd(inputValue);
                } else if (e.key === 'Backspace' && inputValue === '' && activeTags.length > 0) {
                  handleRemove(activeTags[activeTags.length - 1]);
                }
              }}
              className="bg-transparent border-none outline-none text-sm sm:text-base text-white placeholder:text-white/30 [.light-theme_&]:placeholder:!text-[#94a3b8] min-w-[120px] flex-1 py-1 [.light-theme_&]:!text-[#0f172a]"
              placeholder={activeTags.length === 0 ? "输入新标签并回车..." : "添加更多标签..."}
            />
          </div>
        </div>
        
      </div>

      <div className="pt-2 mt-1 flex justify-end gap-2 sm:gap-3">
        <button
          onClick={() => taggerState.rejectRetag(item.char.id)}
          className="flex-1 sm:flex-none justify-center px-2 sm:px-4 py-2.5 sm:py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 border-none [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#fee2e2] [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#ef4444] text-xs sm:text-sm font-medium transition active:scale-95 flex items-center gap-1.5 whitespace-nowrap min-w-0 cursor-pointer"
        >
          <X className="w-3.5 h-3.5 hidden sm:block flex-shrink-0" />
          <span className="truncate">丢弃</span>
        </button>
        <button
          onClick={() => {
            const combined = Array.from(new Set([...item.oldTags, ...activeTags]));
            taggerState.approveRetag(item.char.id, combined);
          }}
          className="flex-1 sm:flex-none justify-center px-2 sm:px-4 py-2.5 sm:py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm font-bold transition active:scale-95 flex items-center gap-1.5 whitespace-nowrap min-w-0 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] border-none cursor-pointer"
        >
          <Tag className="w-3.5 h-3.5 hidden sm:block flex-shrink-0" />
          <span className="truncate">合并</span>
        </button>
        <button
          onClick={() => taggerState.approveRetag(item.char.id, activeTags)}
          className="flex-1 sm:flex-none justify-center px-2 sm:px-5 py-2.5 sm:py-2 rounded-xl bg-black hover:bg-neutral-800 text-white border-0 border-none [.light-theme_&]:!bg-[#000000] [.light-theme_&]:hover:!bg-[#1c1c1e] [.light-theme_&]:!text-white text-xs sm:text-sm font-bold transition active:scale-95 flex items-center gap-1.5 whitespace-nowrap min-w-0 shadow-sm cursor-pointer"
        >
          <CheckCircle2 className="w-3.5 h-3.5 hidden sm:block flex-shrink-0" />
          <span className="truncate">替换</span>
        </button>
      </div>
    </div>
  );
}

export function AutoTagger({ onClose, onOpenSettings }: { onClose: () => void, onOpenSettings: () => void }) {
  const {
    isTagging,
    taggingMode,
    isPaused,
    progress,
    logs,
    untaggedCharacters,
    taggedCharacters,
    retagReviewQueue,
    unsummarizedCharacters,
    summarizedCharacters,
    batchSize,
    apiKeyMissing,
    logsExpanded
  } = useTaggerState();

  const [activeTab, setActiveTab] = useState<'untagged' | 'tagged' | 'summary'>(
    taggingMode === 'summary' ? 'summary' : taggingMode === 'tagged' ? 'tagged' : 'untagged'
  );

  useEffect(() => {
    taggerState.loadCharacters();
  }, []);

  const togglePause = () => taggerState.togglePause();
  const stopTagging = () => taggerState.stopTagging();
  const startTagging = () => taggerState.startTagging();

  const ProgressAndLogs = () => {
    if (!isTagging && logs.length === 0) return null;
    
    return (
      <div className="space-y-6">
        <div className="space-y-4">
          <div className="flex justify-between items-center text-sm">
            <span className="text-white/60 font-medium [.light-theme_&]:!text-slate-600">
              进度: {progress.current} / {progress.total}
            </span>
            <div className="flex gap-4">
              <span className="text-green-400 font-medium [.light-theme_&]:!text-[#34C759]">成功: {progress.success}</span>
              <span className="text-red-400 font-medium [.light-theme_&]:!text-[#FF3B30]">失败: {progress.failed}</span>
            </div>
          </div>
          
          <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden [.light-theme_&]:!bg-[#e2e8f0]">
            <div 
              className={`h-full transition-all duration-500 ${isPaused ? 'bg-white/40 [.light-theme_&]:!bg-[#94a3b8]' : 'bg-white [.light-theme_&]:!bg-[#0f172a]'}`}
              style={{ width: `${(progress.current / Math.max(1, progress.total)) * 100}%` }}
            />
          </div>
        </div>

        {logs.length > 0 && (
          <div className="tagger-log-container rounded-2xl overflow-hidden">
            <button 
              onClick={() => taggerState.setLogsExpanded(!logsExpanded)}
              className="tagger-log-header w-full px-4 sm:px-6 py-3 sm:py-4 flex justify-between items-center transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm sm:text-base text-white/90 [.light-theme_&]:!text-[#0f172a]">处理日志</h3>
                {logsExpanded ? <ChevronDown className="w-4 h-4 text-white/50 [.light-theme_&]:!text-slate-500" /> : <ChevronRight className="w-4 h-4 text-white/50 [.light-theme_&]:!text-slate-500" />}
              </div>
              {isPaused && <span className="text-[11px] sm:text-xs font-medium text-white/80 bg-white/10 px-2 py-0.5 sm:py-1 rounded [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!bg-[#e2e8f0]">已暂停</span>}
            </button>
            
            <AnimatePresence>
              {logsExpanded && (
                <motion.div 
                  initial={{ height: 0 }}
                  animate={{ height: 'auto' }}
                  exit={{ height: 0 }}
                  className="max-h-[400px] sm:max-h-[500px] overflow-y-auto overflow-hidden"
                >
                  {logs.map((log) => (
                    <motion.div 
                      key={log.id} 
                      className="tagger-log-item p-3 sm:p-4 flex items-start gap-3 sm:gap-4 transition"
                    >
                      <div className="mt-1">
                        {log.status === 'pending' && <Loader2 className="w-4 sm:w-5 h-4 sm:h-5 text-blue-400 animate-spin [.light-theme_&]:text-blue-500" />}
                        {log.status === 'success' && <CheckCircle2 className="w-4 sm:w-5 h-4 sm:h-5 text-white/80 [.light-theme_&]:!text-[#34C759]" />}
                        {log.status === 'failed' && <AlertCircle className="w-4 sm:w-5 h-4 sm:h-5 text-red-400 [.light-theme_&]:text-red-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 sm:gap-4">
                          <h4 className="font-medium text-xs sm:text-sm text-white/90 truncate [.light-theme_&]:!text-[#0f172a]">{log.name}</h4>
                          <span className={`text-[10px] sm:text-xs font-medium px-2 py-0.5 sm:py-1 rounded-full ${
                            log.status === 'pending' ? 'bg-blue-500/20 text-blue-300 [.light-theme_&]:!bg-[#007AFF]/10 [.light-theme_&]:!text-[#007AFF]' :
                            log.status === 'success' ? 'bg-white/10 text-white/90 [.light-theme_&]:!bg-[#34C759]/10 [.light-theme_&]:!text-[#34C759]' :
                            'bg-red-500/20 text-red-300 [.light-theme_&]:!bg-[#FF3B30]/10 [.light-theme_&]:!text-[#FF3B30]'
                          }`}>
                            {log.status === 'pending' ? '处理中' :
                             log.status === 'success' ? '成功' : '失败'}
                          </span>
                        </div>
                        
                        {log.status === 'success' && log.tags && (
                          <div className="flex flex-wrap gap-1 sm:gap-1.5 mt-2">
                            {log.tags.map(t => (
                              <span key={t} className="px-2 py-0.5 bg-white/10 text-white/80 rounded-md text-[11px] sm:text-xs font-medium [.light-theme_&]:!bg-[#f2f2f7] [.light-theme_&]:!text-[#3a3a3c]">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                        
                        {log.status === 'failed' && log.errorMsg && (
                          <div className="mt-2 text-xs sm:text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded-lg [.light-theme_&]:text-red-400 [.light-theme_&]:bg-red-400/10">
                            {log.errorMsg}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0c] text-white [.light-theme_&]:!bg-[#f0f2f5] [.light-theme_&]:!text-[#0f172a] miu-skin select-none">
      <header className="sticky top-0 px-3.5 pb-0 pt-[max(1.75rem,env(safe-area-inset-top))] sm:px-6 sm:pt-[max(1.75rem,env(safe-area-inset-top))] flex flex-col gap-3 sm:gap-4 bg-slate-900/90 backdrop-blur-xl z-20 [.light-theme_&]:!bg-[#ffffff]/95 shadow-2xs">
        <div className="flex items-center justify-between gap-3 sm:gap-4">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <button onClick={onClose} className="p-2 -ml-2 rounded-full transition text-white/80 hover:text-white hover:bg-white/10 [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!bg-transparent [.light-theme_&]:hover:!bg-black/5 [.light-theme_&]:active:!bg-black/10 cursor-pointer" title="返回">
              <ArrowLeft className="w-5 sm:w-6 h-5 sm:h-6" />
            </button>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-white [.light-theme_&]:!text-[#0f172a] truncate">
                批量自动打标
              </h1>
              <p className="text-xs sm:text-sm text-white/50 mt-0.5 sm:mt-1 truncate [.light-theme_&]:!text-[#64748b]">使用 AI 自动识别角色设定并生成标签 (支持后台运行)</p>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3 sm:gap-6 overflow-x-auto no-scrollbar w-full mt-1 shrink-0">
          <button
            onClick={() => setActiveTab('untagged')}
            className={`pb-2.5 sm:pb-3 pt-1 px-1 sm:px-2 text-xs sm:text-sm font-bold transition-all relative flex items-center justify-center gap-1.5 cursor-pointer border-0 border-none shrink-0 ${
              activeTab === 'untagged'
                ? 'text-white [.light-theme_&]:!text-[#0f172a]'
                : 'text-white/60 hover:text-white [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#0f172a]'
            }`}
          >
            <span className="whitespace-nowrap">未打标 ({untaggedCharacters.length})</span>
            {activeTab === 'untagged' && (
              <motion.div
                layoutId="activeTabUnderline"
                className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-white [.light-theme_&]:!bg-black rounded-full"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
          </button>

          <button
            onClick={() => setActiveTab('tagged')}
            className={`pb-2.5 sm:pb-3 pt-1 px-1 sm:px-2 text-xs sm:text-sm font-bold transition-all relative flex items-center justify-center gap-1.5 cursor-pointer border-0 border-none shrink-0 ${
              activeTab === 'tagged'
                ? 'text-white [.light-theme_&]:!text-[#0f172a]'
                : 'text-white/60 hover:text-white [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#0f172a]'
            }`}
          >
            <span className="whitespace-nowrap">重新打标 ({taggedCharacters.length})</span>
            {retagReviewQueue.length > 0 && (
              <span className="shrink-0 px-2 py-0.5 rounded-full bg-black text-white text-[11px] font-bold [.light-theme_&]:!bg-black [.light-theme_&]:!text-white border border-white/20 [.light-theme_&]:!border-transparent shadow-xs">
                待确认 {retagReviewQueue.length}
              </span>
            )}
            {activeTab === 'tagged' && (
              <motion.div
                layoutId="activeTabUnderline"
                className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-white [.light-theme_&]:!bg-black rounded-full"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
          </button>

          <button
            onClick={() => setActiveTab('summary')}
            className={`pb-2.5 sm:pb-3 pt-1 px-1 sm:px-2 text-xs sm:text-sm font-bold transition-all relative flex items-center justify-center gap-1.5 cursor-pointer border-0 border-none shrink-0 ${
              activeTab === 'summary'
                ? 'text-white [.light-theme_&]:!text-[#0f172a]'
                : 'text-white/60 hover:text-white [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#0f172a]'
            }`}
          >
            <span className="whitespace-nowrap">卡片总结 ({unsummarizedCharacters.length})</span>
            {activeTab === 'summary' && (
              <motion.div
                layoutId="activeTabUnderline"
                className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-white [.light-theme_&]:!bg-black rounded-full"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-3.5 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6">
          
          {apiKeyMissing && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 sm:p-5 text-red-400 flex items-start gap-3 sm:gap-4 shadow-lg shadow-red-500/5 [.light-theme_&]:bg-red-500/10 [.light-theme_&]:border-red-500/20 [.light-theme_&]:text-red-400 [.light-theme_&]:shadow-lg [.light-theme_&]:shadow-red-500/5">
              <AlertCircle className="w-5 sm:w-6 h-5 sm:h-6 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-base sm:text-lg">未配置 API</h3>
                <p className="text-xs sm:text-sm opacity-80 mt-1 mb-3">使用自动打标功能需要配置自定义 API (OpenAI 格式接口)。</p>
                <button 
                  onClick={onOpenSettings}
                  className="px-3.5 sm:px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg text-xs sm:text-sm font-medium transition [.light-theme_&]:bg-red-500/20 [.light-theme_&]:hover:bg-red-500/30 [.light-theme_&]:text-red-300"
                >
                  去配置 API
                </button>
              </div>
            </div>
          )}

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              {activeTab === 'untagged' ? (
            <>
              <div className="auto-tagger-card rounded-2xl p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
                  <div>
                    <h2 className="text-base sm:text-lg font-semibold text-white [.light-theme_&]:!text-[#1c1c1e]">
                      待打标角色
                    </h2>
                    <p className="text-xs sm:text-sm text-white/50 mt-0.5 sm:mt-1 [.light-theme_&]:!text-[#8e8e93]">
                      共发现 {untaggedCharacters.length} 个未打标签的角色卡
                    </p>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
                    <select
                      value={batchSize}
                      onChange={(e) => taggerState.setBatchSize(Number(e.target.value))}
                      disabled={isTagging}
                      className="auto-tagger-select w-full sm:w-auto rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm focus:outline-none disabled:opacity-50 min-w-0 sm:min-w-[140px] shadow-xs"
                    >
                      <option value={10}>每次处理 10 个</option>
                      <option value={20}>每次处理 20 个</option>
                      <option value={50}>每次处理 50 个</option>
                      <option value={0}>处理全部</option>
                    </select>
                    
                    {!isTagging ? (
                      <button
                        onClick={() => taggerState.startTagging()}
                        disabled={untaggedCharacters.length === 0}
                        className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 sm:px-6 py-2.5 sm:py-3 rounded-full font-bold text-xs sm:text-sm bg-black hover:bg-neutral-900 text-white [.light-theme_&]:!bg-[#000000] [.light-theme_&]:hover:!bg-[#1c1c1e] [.light-theme_&]:!text-white transition-all active:scale-[0.98] shadow-sm disabled:opacity-40 disabled:shadow-none whitespace-nowrap cursor-pointer border-0 border-none"
                      >
                        <Play className="w-3.5 sm:w-4 h-3.5 sm:h-4 fill-current" />
                        开始打标
                      </button>
                    ) : (
                      <div className="flex gap-2 w-full sm:w-auto">
                        <button
                          onClick={togglePause}
                          className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 sm:py-3 rounded-xl font-semibold text-xs sm:text-sm transition-all whitespace-nowrap cursor-pointer border-none ${
                            isPaused 
                              ? 'bg-white text-slate-950 [.light-theme_&]:!bg-black [.light-theme_&]:!text-white shadow-md' 
                              : 'bg-white/10 hover:bg-white/20 text-white [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#0f172a]'
                          }`}
                        >
                          {isPaused ? <PlayCircle className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                          {isPaused ? '继续' : '暂停'}
                        </button>
                        <button
                          onClick={stopTagging}
                          className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 sm:py-3 bg-white/5 hover:bg-white/10 text-white/80 hover:text-white rounded-xl font-semibold text-xs sm:text-sm transition-all whitespace-nowrap border-none [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] cursor-pointer"
                        >
                          <Square className="w-4 h-4" />
                          停止
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {taggingMode === 'untagged' && <ProgressAndLogs />}
              </div>
            </>
          ) : activeTab === 'tagged' ? (
            <div className="space-y-4 sm:space-y-6">
              <div className="auto-tagger-card rounded-2xl p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-white [.light-theme_&]:!text-[#0f172a]">
                      重新打标
                    </h2>
                    <p className="text-xs sm:text-sm text-white/50 mt-0.5 sm:mt-1 [.light-theme_&]:!text-[#64748b]">
                      共发现 {taggedCharacters.length} 个已打标签的角色卡。AI扫描后会将更替结果放入待确认卡片区。
                    </p>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
                    <select
                      value={batchSize}
                      onChange={(e) => taggerState.setBatchSize(Number(e.target.value))}
                      disabled={isTagging}
                      className="auto-tagger-select w-full sm:w-auto rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm focus:outline-none disabled:opacity-50 min-w-0 sm:min-w-[140px] shadow-xs"
                    >
                      <option value={10}>每次处理 10 个</option>
                      <option value={20}>每次处理 20 个</option>
                      <option value={50}>每次处理 50 个</option>
                      <option value={0}>处理全部</option>
                    </select>
                    
                    {!isTagging ? (
                      <button
                        onClick={() => taggerState.startRetagging()}
                        disabled={taggedCharacters.length === 0}
                        className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 sm:px-6 py-2.5 sm:py-3 rounded-full font-bold text-xs sm:text-sm bg-black hover:bg-neutral-900 text-white [.light-theme_&]:!bg-[#000000] [.light-theme_&]:hover:!bg-[#1c1c1e] [.light-theme_&]:!text-white transition-all active:scale-[0.98] shadow-sm disabled:opacity-40 disabled:shadow-none whitespace-nowrap cursor-pointer border-0 border-none"
                      >
                        <Play className="w-3.5 sm:w-4 h-3.5 sm:h-4 fill-current" />
                        开始重新打标
                      </button>
                    ) : (
                      <div className="flex gap-2 w-full sm:w-auto">
                        <button
                          onClick={togglePause}
                          className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 sm:py-3 rounded-xl font-semibold text-xs sm:text-sm transition-all whitespace-nowrap cursor-pointer border-none ${
                            isPaused 
                              ? 'bg-white text-slate-950 [.light-theme_&]:!bg-black [.light-theme_&]:!text-white shadow-md' 
                              : 'bg-white/10 hover:bg-white/20 text-white [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#0f172a]'
                          }`}
                        >
                          {isPaused ? <PlayCircle className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                          {isPaused ? '继续' : '暂停'}
                        </button>
                        <button
                          onClick={stopTagging}
                          className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 sm:py-3 bg-white/5 hover:bg-white/10 text-white/80 hover:text-white rounded-xl font-semibold text-xs sm:text-sm transition-all whitespace-nowrap border-none [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] cursor-pointer"
                        >
                          <Square className="w-4 h-4" />
                          停止
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {taggingMode === 'tagged' && <ProgressAndLogs />}
              </div>

              {retagReviewQueue.length > 0 && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between mt-6 sm:mt-8 mb-4 gap-3 sm:gap-4">
                    <h3 className="font-bold text-base sm:text-lg text-white flex items-center gap-2 [.light-theme_&]:!text-[#0f172a]">
                      <span>待确认替换标签 / 合并 ({retagReviewQueue.length})</span>
                    </h3>
                    <div className="grid grid-cols-3 sm:flex sm:flex-wrap items-center gap-2 w-full sm:w-auto">
                       <button
                         onClick={() => taggerState.rejectAllRetags()}
                         className="w-full sm:w-auto justify-center px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 text-xs sm:text-sm font-semibold transition active:scale-95 flex items-center gap-1.5 whitespace-nowrap [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#fee2e2] [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#ef4444] cursor-pointer"
                       >
                         <X className="w-3.5 h-3.5 hidden sm:block" /> 全部丢弃
                       </button>
                       <button
                         onClick={() => taggerState.mergeAllRetags()}
                         className="w-full sm:w-auto justify-center px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm font-semibold transition active:scale-95 flex items-center gap-1.5 whitespace-nowrap border border-white/10 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] cursor-pointer"
                       >
                         <Tag className="w-3.5 h-3.5 hidden sm:block" /> 全部合并
                       </button>
                       <button
                         onClick={() => taggerState.approveAllRetags()}
                         className="w-full sm:w-auto justify-center px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-black hover:bg-neutral-800 text-white border-0 border-none [.light-theme_&]:!bg-[#000000] [.light-theme_&]:hover:!bg-[#1c1c1e] [.light-theme_&]:!text-white text-xs sm:text-sm font-bold transition active:scale-95 flex items-center gap-1.5 whitespace-nowrap shadow-sm cursor-pointer"
                       >
                         <CheckCircle2 className="w-3.5 h-3.5 hidden sm:block" /> 全部替换
                       </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                    {retagReviewQueue.map((item) => (
                      <RetagReviewCard key={item.char.id} item={item} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 sm:space-y-6">
              <div className="auto-tagger-card rounded-2xl p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-white [.light-theme_&]:!text-[#0f172a] flex items-center gap-2">
                      <span>卡片总结</span>
                    </h2>
                    <p className="text-xs sm:text-sm text-white/50 mt-0.5 sm:mt-1 [.light-theme_&]:!text-[#64748b]">
                      优先围绕角色的【人设】、【世界书】与【开场白】，深度精炼出富有人设特色与剧情看点的卡片简介
                    </p>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 w-full sm:w-auto">
                    <select
                      value={batchSize}
                      onChange={(e) => taggerState.setBatchSize(Number(e.target.value))}
                      disabled={isTagging}
                      className="auto-tagger-select w-full sm:w-auto rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm focus:outline-none disabled:opacity-50 min-w-0 sm:min-w-[140px] shadow-xs"
                    >
                      <option value={10}>每次处理 10 个</option>
                      <option value={20}>每次处理 20 个</option>
                      <option value={50}>每次处理 50 个</option>
                      <option value={0}>处理全部</option>
                    </select>
                    
                    {!isTagging ? (
                      <button
                        onClick={() => taggerState.startBatchSummary()}
                        disabled={unsummarizedCharacters.length === 0}
                        className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 sm:px-6 py-2.5 sm:py-3 rounded-full font-bold text-xs sm:text-sm bg-black hover:bg-neutral-900 text-white [.light-theme_&]:!bg-[#000000] [.light-theme_&]:hover:!bg-[#1c1c1e] [.light-theme_&]:!text-white transition-all active:scale-[0.98] shadow-sm disabled:opacity-40 disabled:shadow-none whitespace-nowrap cursor-pointer border-0 outline-none"
                      >
                        <span>开始生成总结</span>
                      </button>
                    ) : (
                      <div className="flex gap-2 w-full sm:w-auto">
                        <button
                          onClick={togglePause}
                          className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 sm:py-3 rounded-xl font-semibold text-xs sm:text-sm transition-all whitespace-nowrap cursor-pointer border-none ${
                            isPaused 
                              ? 'bg-white text-slate-950 [.light-theme_&]:!bg-black [.light-theme_&]:!text-white shadow-md' 
                              : 'bg-white/10 hover:bg-white/20 text-white [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#0f172a]'
                          }`}
                        >
                          {isPaused ? <PlayCircle className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                          {isPaused ? '继续' : '暂停'}
                        </button>
                        <button
                          onClick={stopTagging}
                          className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 sm:py-3 bg-white/5 hover:bg-white/10 text-white/80 hover:text-white rounded-xl font-semibold text-xs sm:text-sm transition-all whitespace-nowrap border-none [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] cursor-pointer"
                        >
                          <Square className="w-4 h-4" />
                          停止
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {taggingMode === 'summary' && <ProgressAndLogs />}
              </div>
            </div>
          )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
