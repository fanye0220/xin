import { getFallbackAvatar, resolveAvatarUrl } from '../lib/avatar';
import { useEffect, useState } from 'react';
import { ArrowLeft, Tag, Play, CheckCircle2, Loader2, AlertCircle, Pause, Square, PlayCircle, RefreshCw, X, ArrowRightLeft, History, ChevronDown, ChevronRight } from 'lucide-react';
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
    <div className="bg-slate-800/80 border border-white/10 rounded-3xl p-5 flex flex-col gap-5 shadow-xl transition-all">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
           <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 shadow-inner ring-1 ring-white/10">
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
           <h4 className="font-bold text-lg text-white truncate">{charName}</h4>
        </div>
        <button
          onClick={() => taggerState.rejectRetag(item.char.id)}
          className="p-2 -mr-2 text-white/40 hover:text-red-400 hover:bg-white/5 rounded-full transition relative group"
          title="忽略此建议"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 flex flex-col gap-5">
        {/* 旧标签对照区 */}
        <div className="flex flex-col gap-2 bg-white/5 border border-white/[0.1] [.light-theme_&]:border-black/5 rounded-xl p-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-white/50 px-1 border-b border-white/[0.1] [.light-theme_&]:border-black/5 pb-1.5">
            <span>旧标签</span>
          </div>
          <div className="flex flex-wrap gap-1.5 min-h-[32px] content-start">
            {item.oldTags.length === 0 ? (
              <span className="text-white/30 text-xs italic mt-1 ml-1">无原始标签</span>
            ) : (
              item.oldTags.map(tag => {
                const isKept = activeTags.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => isKept ? handleRemove(tag) : handleAdd(tag)}
                    className={`px-2 py-1.5 rounded-md text-xs border transition-all flex items-center gap-1.5 ${
                      isKept 
                        ? 'bg-blue-500/30 text-blue-200 border-blue-400/60 shadow-[0_0_8px_rgba(59,130,246,0.3)] font-medium active:scale-95 cursor-pointer' 
                        : 'bg-white/10 hover:bg-white/20 text-white/70 border-white/5 active:scale-95 cursor-pointer'
                    }`}
                  >
                    <span className="truncate max-w-[120px]">{tag}</span>
                    {isKept ? <X className="w-3.5 h-3.5 opacity-80" /> : <span className="opacity-50 font-bold">+</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* 新标签可编辑区 */}
        <div className="flex flex-col gap-2 bg-blue-500/10 border border-blue-500/30 rounded-xl p-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-blue-400 px-1 border-b border-blue-500/20 pb-1.5">
            <span>AI 生成新标签</span>
          </div>
          <div 
            className="focus-within:border-blue-500/50 transition-all cursor-text min-h-[60px] flex content-start flex-wrap gap-2" 
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
                    className={`pl-2.5 pr-1 py-1.5 rounded-lg text-xs flex items-center gap-1.5 group border ${
                      isShared 
                        ? 'bg-blue-500/30 text-blue-200 border-blue-400/60 shadow-[0_0_8px_rgba(59,130,246,0.3)] font-medium' 
                        : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                    }`}
                  >
                    <span className="truncate max-w-[140px]">{tag}</span>
                    <button onClick={(e) => { e.stopPropagation(); handleRemove(tag); }} className={`p-0.5 rounded-md transition pointer-events-auto ${isShared ? 'hover:bg-blue-400/30 text-blue-200' : 'hover:bg-blue-500/20 text-blue-400/70'}`}>
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
              className="bg-transparent border-none outline-none text-sm text-white min-w-[120px] flex-1 py-1"
              placeholder={activeTags.length === 0 ? "输入新标签并回车..." : "添加更多标签..."}
            />
          </div>
        </div>
        
      </div>

      <div className="border-t border-white/5 pt-4 mt-2 flex justify-end gap-2 sm:gap-3">
        <button
          onClick={() => taggerState.rejectRetag(item.char.id)}
          className="flex-1 sm:flex-none justify-center px-2 sm:px-4 py-2.5 sm:py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-xs sm:text-sm font-medium transition active:scale-95 flex items-center gap-1.5 whitespace-nowrap min-w-0"
        >
          <X className="w-3.5 h-3.5 hidden sm:block flex-shrink-0" />
          <span className="truncate">丢弃</span>
        </button>
        <button
          onClick={() => {
            const combined = Array.from(new Set([...item.oldTags, ...activeTags]));
            taggerState.approveRetag(item.char.id, combined);
          }}
          className="flex-1 sm:flex-none justify-center px-2 sm:px-4 py-2.5 sm:py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm font-bold transition active:scale-95 flex items-center gap-1.5 whitespace-nowrap min-w-0"
        >
          <Tag className="w-3.5 h-3.5 hidden sm:block flex-shrink-0" />
          <span className="truncate">合并</span>
        </button>
        <button
          onClick={() => taggerState.approveRetag(item.char.id, activeTags)}
          className="flex-1 sm:flex-none justify-center px-2 sm:px-5 py-2.5 sm:py-2 rounded-lg bg-blue-500 hover:bg-blue-400 text-white text-xs sm:text-sm font-bold transition active:scale-95 flex items-center gap-1.5 whitespace-nowrap min-w-0"
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
    batchSize,
    apiKeyMissing,
    logsExpanded
  } = useTaggerState();

  const [activeTab, setActiveTab] = useState<'untagged' | 'tagged'>(
    taggingMode === 'tagged' ? 'tagged' : 'untagged'
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
          <div className="flex justify-between text-sm">
            <span className="text-white/60">
              进度: {progress.current} / {progress.total}
            </span>
            <div className="flex gap-4">
              <span className="text-green-400">成功: {progress.success}</span>
              <span className="text-red-400">失败: {progress.failed}</span>
            </div>
          </div>
          
          <div className="w-full bg-black/40 rounded-full h-2 overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 ${isPaused ? 'bg-yellow-500' : 'bg-gradient-to-r from-purple-500 to-blue-500'}`}
              style={{ width: `${(progress.current / Math.max(1, progress.total)) * 100}%` }}
            />
          </div>
        </div>

        {logs.length > 0 && (
          <div className="bg-black/40 border border-white/10 rounded-2xl overflow-hidden">
            <button 
              onClick={() => taggerState.setLogsExpanded(!logsExpanded)}
              className="w-full px-6 py-4 border-b border-white/5 flex justify-between items-center bg-white/5 hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-white/90">处理日志</h3>
                {logsExpanded ? <ChevronDown className="w-4 h-4 text-white/50" /> : <ChevronRight className="w-4 h-4 text-white/50" />}
              </div>
              {isPaused && <span className="text-xs font-medium text-yellow-400 bg-yellow-400/10 px-2 py-1 rounded">已暂停 (遇到错误或手动暂停)</span>}
            </button>
            
            <AnimatePresence>
              {logsExpanded && (
                <motion.div 
                  initial={{ height: 0 }}
                  animate={{ height: 'auto' }}
                  exit={{ height: 0 }}
                  className="divide-y divide-white/5 max-h-[500px] overflow-y-auto overflow-hidden"
                >
                  {logs.map((log) => (
                    <motion.div 
                      key={log.id} 
                      className="p-4 flex items-start gap-4 hover:bg-white/5 transition"
                    >
                  <div className="mt-1">
                    {log.status === 'pending' && <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />}
                    {log.status === 'success' && <CheckCircle2 className="w-5 h-5 text-green-400" />}
                    {log.status === 'failed' && <AlertCircle className="w-5 h-5 text-red-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-4">
                      <h4 className="font-medium text-white/90 truncate">{log.name}</h4>
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                        log.status === 'pending' ? 'bg-blue-500/20 text-blue-300' :
                        log.status === 'success' ? 'bg-green-500/20 text-green-300' :
                        'bg-red-500/20 text-red-300'
                      }`}>
                        {log.status === 'pending' ? '处理中' :
                         log.status === 'success' ? '成功' : '失败'}
                      </span>
                    </div>
                    
                    {log.status === 'success' && log.tags && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {log.tags.map(t => (
                          <span key={t} className="px-2 py-0.5 bg-white/10 text-white/80 rounded-md text-xs">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    
                    {log.status === 'failed' && log.errorMsg && (
                      <div className="mt-2 text-sm text-red-400 bg-red-400/10 px-3 py-2 rounded-lg">
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
    <div className="flex flex-col h-full bg-slate-900">
      <header className="sticky top-0 px-4 pb-4 pt-[max(1.75rem,env(safe-area-inset-top))] sm:px-6 sm:pb-6 sm:pt-[max(1.75rem,env(safe-area-inset-top))] flex flex-col gap-4 bg-slate-900/80 backdrop-blur-xl border-b border-white/[0.1] [.light-theme_&]:border-black/5 z-20">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 -ml-2 rounded-full hover:bg-white/10 transition">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              批量自动打标
            </h1>
            <p className="text-sm text-white/50 mt-1">使用 AI 自动识别角色设定并生成标签 (支持后台运行)</p>
          </div>
        </div>
        
        <div className="flex gap-4 border-b border-white/[0.1] [.light-theme_&]:border-black/5 mt-2">
          <button
            onClick={() => setActiveTab('untagged')}
            className={`pb-3 px-2 text-sm font-bold transition-all relative ${activeTab === 'untagged' ? 'text-blue-400' : 'text-white/40 hover:text-white/70'}`}
          >
            未打标 ({untaggedCharacters.length})
            {activeTab === 'untagged' && (
              <motion.div layoutId="taggerTab" className="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-blue-400 rounded-t-full" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('tagged')}
            className={`pb-3 px-2 text-sm font-bold transition-all relative ${activeTab === 'tagged' ? 'text-purple-400' : 'text-white/40 hover:text-white/70'}`}
          >
            重新打标 ({taggedCharacters.length})
            {retagReviewQueue.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px]">
                待确认 {retagReviewQueue.length}
              </span>
            )}
            {activeTab === 'tagged' && (
              <motion.div layoutId="taggerTab" className="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-purple-400 rounded-t-full" />
            )}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          
          {apiKeyMissing && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5 text-red-400 flex items-start gap-4 shadow-lg shadow-red-500/5">
              <AlertCircle className="w-6 h-6 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-lg">未配置 API</h3>
                <p className="text-sm opacity-80 mt-1 mb-3">使用自动打标功能需要配置自定义 API (OpenAI 格式接口)。</p>
                <button 
                  onClick={onOpenSettings}
                  className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg text-sm font-medium transition"
                >
                  去配置 API
                </button>
              </div>
            </div>
          )}

          {activeTab === 'untagged' ? (
            <>
              <div className="bg-white/5 border border-white/[0.1] [.light-theme_&]:border-black/5 rounded-2xl p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                      <Tag className="w-5 h-5 text-purple-400" />
                      待打标角色
                    </h2>
                    <p className="text-sm text-white/50 mt-1">
                      共发现 {untaggedCharacters.length} 个未打标签的角色卡
                    </p>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      value={batchSize}
                      onChange={(e) => taggerState.setBatchSize(Number(e.target.value))}
                      disabled={isTagging}
                      className="bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-purple-500 disabled:opacity-50 flex-1 sm:flex-none min-w-[140px]"
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
                        className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-400 hover:to-blue-400 text-white rounded-xl font-medium transition-all shadow-lg shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        <Play className="w-5 h-5" />
                        开始打标
                      </button>
                    ) : (
                      <div className="flex flex-1 sm:flex-none gap-2">
                        <button
                          onClick={togglePause}
                          className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-all whitespace-nowrap ${
                            isPaused 
                              ? 'bg-blue-500 hover:bg-blue-400 text-white shadow-[0_0_15px_rgba(59,130,246,0.5)]' 
                              : 'bg-white/10 hover:bg-white/20 text-white'
                          }`}
                        >
                          {isPaused ? <PlayCircle className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
                          {isPaused ? '继续' : '暂停'}
                        </button>
                        <button
                          onClick={stopTagging}
                          className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-3 bg-white/5 hover:bg-white/10 text-red-400 hover:text-red-300 rounded-xl font-medium transition-all whitespace-nowrap border border-transparent hover:border-red-500/30"
                        >
                          <Square className="w-5 h-5" />
                          停止
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {taggingMode === 'untagged' && <ProgressAndLogs />}
              </div>
            </>
          ) : (
            <div className="space-y-6">
              <div className="bg-white/5 border border-white/[0.1] [.light-theme_&]:border-black/5 rounded-2xl p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                      <RefreshCw className="w-5 h-5 text-purple-400" />
                      重新打标
                    </h2>
                    <p className="text-sm text-white/50 mt-1">
                      共发现 {taggedCharacters.length} 个已打标签的角色卡。AI扫描后会将更替结果放入待确认卡片区。
                    </p>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      value={batchSize}
                      onChange={(e) => taggerState.setBatchSize(Number(e.target.value))}
                      disabled={isTagging}
                      className="bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-purple-500 disabled:opacity-50 flex-1 sm:flex-none min-w-[140px]"
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
                        className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-400 hover:to-blue-400 text-white rounded-xl font-medium transition-all shadow-lg shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        <RefreshCw className="w-5 h-5" />
                        开始重新打标
                      </button>
                    ) : (
                      <div className="flex flex-1 sm:flex-none gap-2">
                        <button
                          onClick={togglePause}
                          className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-all whitespace-nowrap ${
                            isPaused 
                              ? 'bg-blue-500 hover:bg-blue-400 text-white shadow-[0_0_15px_rgba(59,130,246,0.5)]' 
                              : 'bg-white/10 hover:bg-white/20 text-white'
                          }`}
                        >
                          {isPaused ? <PlayCircle className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
                          {isPaused ? '继续' : '暂停'}
                        </button>
                        <button
                          onClick={stopTagging}
                          className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-3 bg-white/5 hover:bg-white/10 text-red-400 hover:text-red-300 rounded-xl font-medium transition-all whitespace-nowrap border border-transparent hover:border-red-500/30"
                        >
                          <Square className="w-5 h-5" />
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
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between mt-8 mb-4 gap-4">
                    <h3 className="font-bold text-lg text-white flex items-center gap-2">
                       <span className="text-yellow-400">✨</span> 待确认替换标签 / 合并 ({retagReviewQueue.length})
                    </h3>
                    <div className="grid grid-cols-3 sm:flex sm:flex-wrap items-center gap-2">
                       <button
                         onClick={() => taggerState.rejectAllRetags()}
                         className="w-full sm:w-auto justify-center px-2 sm:px-4 py-2.5 sm:py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-xs sm:text-sm font-medium transition active:scale-95 flex items-center gap-1.5 whitespace-nowrap"
                       >
                         <X className="w-3.5 h-3.5 hidden sm:block" /> 全部丢弃
                       </button>
                       <button
                         onClick={() => taggerState.mergeAllRetags()}
                         className="w-full sm:w-auto justify-center px-2 sm:px-4 py-2.5 sm:py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 text-xs sm:text-sm font-medium transition active:scale-95 flex items-center gap-1.5 whitespace-nowrap"
                       >
                         <Tag className="w-3.5 h-3.5 hidden sm:block" /> 全部合并
                       </button>
                       <button
                         onClick={() => taggerState.approveAllRetags()}
                         className="w-full sm:w-auto justify-center px-2 sm:px-4 py-2.5 sm:py-2 rounded-lg bg-blue-500 hover:bg-blue-400 text-white text-xs sm:text-sm font-bold transition active:scale-95 flex items-center gap-1.5 whitespace-nowrap"
                       >
                         <CheckCircle2 className="w-3.5 h-3.5 hidden sm:block" /> 全部替换
                       </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {retagReviewQueue.map((item) => (
                      <RetagReviewCard key={item.char.id} item={item} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
