import { getFallbackAvatar, resolveAvatarUrl } from '../lib/avatar';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, RotateCcw, X, AlertTriangle, CheckCircle2, Check } from 'lucide-react';
import { 
  CharacterCard, 
  getTrashedCharacters, 
  restoreCharacter, 
  deleteCharactersBulk, 
  cleanupOldTrash, 
  getCharacterThumb 
} from '../lib/db';
import { peekCachedUrl, putCachedBlobUrl } from '../lib/thumbCache';
import { getLocalImageUrl } from '../lib/appBridge';

interface Props {
  onClose: () => void;
}

const TrashedCharacterCard = ({ 
  char, 
  selectionMode, 
  isSelected, 
  onToggleSelect,
}: { 
  key?: React.Key, 
  char: CharacterCard, 
  selectionMode: boolean,
  isSelected: boolean,
  onToggleSelect: (id: string) => void,
}) => {
  const defaultFallback = getFallbackAvatar(char.name || char.id, char.tags?.join(',') || (char.isTool ? 'tool' : undefined));
  const [avatarUrl, setAvatarUrl] = useState<string>(() => resolveAvatarUrl(char.avatarUrlFallback, char.name || char.id));

  // 高性能轻量缩略图加载：对接 LRU 缓存与 10KB 缩略图库，杜绝拉取全量大卡片造成爆内存
  useEffect(() => {
    let isMounted = true;
    
    if (char.localFilePath) {
      setAvatarUrl(getLocalImageUrl(char.localFilePath, char.updatedAt || char.createdAt));
      return;
    }

    const thumbCacheKey = `${char.id}:${char.updatedAt || 0}`;
    const cached = peekCachedUrl(thumbCacheKey);
    if (cached) {
      setAvatarUrl(cached);
      return;
    }

    if (char.avatarBlob) {
      const blobUrl = putCachedBlobUrl(thumbCacheKey, char.avatarBlob);
      if (blobUrl) setAvatarUrl(blobUrl);
      return;
    }

    // 走 10KB 缩略图库加载
    getCharacterThumb(char.id).then((thumbBlob) => {
      if (!isMounted) return;
      if (thumbBlob) {
        setAvatarUrl(putCachedBlobUrl(thumbCacheKey, thumbBlob));
      }
    }).catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [char.id, char.updatedAt, char.localFilePath, char.avatarBlob]);

  const daysLeft = Math.max(1, Math.ceil((7 * 24 * 60 * 60 * 1000 - (Date.now() - (char.deletedAt || 0))) / (1000 * 60 * 60 * 24)));

  const longPressRef = useRef<{
    timer: NodeJS.Timeout | null;
    startX?: number;
    startY?: number;
    triggered: boolean;
    lastTriggerTime?: number;
  }>({
    timer: null,
    triggered: false,
    lastTriggerTime: 0
  });

  const touchHandledRef = useRef(false);

  const startLongPress = (clientX?: number, clientY?: number) => {
    longPressRef.current.triggered = false;
    longPressRef.current.startX = clientX;
    longPressRef.current.startY = clientY;
    if (longPressRef.current.timer) {
      clearTimeout(longPressRef.current.timer);
    }
    longPressRef.current.timer = setTimeout(() => {
      longPressRef.current.triggered = true;
      longPressRef.current.lastTriggerTime = Date.now();
      onToggleSelect(char.id);
    }, 550);
  };

  const cancelLongPress = () => {
    if (longPressRef.current.timer) {
      clearTimeout(longPressRef.current.timer);
      longPressRef.current.timer = null;
    }
  };

  const checkMove = (clientX: number, clientY: number) => {
    if (longPressRef.current.timer) {
      const dx = Math.abs(clientX - (longPressRef.current.startX || 0));
      const dy = Math.abs(clientY - (longPressRef.current.startY || 0));
      if (dx > 10 || dy > 10) {
        cancelLongPress();
      }
    }
  };

  return (
    <motion.div 
      layout
      style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none", touchAction: "pan-y" }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      onClick={(e) => {
        if (longPressRef.current.triggered || Date.now() - (longPressRef.current.lastTriggerTime || 0) < 600) {
          e.preventDefault();
          e.stopPropagation();
          longPressRef.current.triggered = false;
          return;
        }
        if (selectionMode) {
          onToggleSelect(char.id);
        }
      }}
      onTouchStart={(e) => {
        touchHandledRef.current = true;
        if (!selectionMode && e.touches && e.touches[0]) {
          startLongPress(e.touches[0].clientX, e.touches[0].clientY);
        }
      }}
      onTouchMove={(e) => {
        if (e.touches && e.touches[0]) {
          checkMove(e.touches[0].clientX, e.touches[0].clientY);
        }
      }}
      onTouchEnd={() => {
        cancelLongPress();
        setTimeout(() => { touchHandledRef.current = false; }, 300);
      }}
      onTouchCancel={() => {
        cancelLongPress();
        setTimeout(() => { touchHandledRef.current = false; }, 300);
      }}
      onMouseDown={(e) => {
        if (touchHandledRef.current || e.button !== 0 || selectionMode) return;
        startLongPress(e.clientX, e.clientY);
      }}
      onMouseMove={(e) => {
        checkMove(e.clientX, e.clientY);
      }}
      onMouseUp={cancelLongPress}
      onMouseLeave={cancelLongPress}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        cancelLongPress();
        if (Date.now() - (longPressRef.current.lastTriggerTime || 0) < 800) return;
        longPressRef.current.triggered = true;
        longPressRef.current.lastTriggerTime = Date.now();
        onToggleSelect(char.id);
      }}
      className={`relative flex items-center gap-3 sm:gap-4 p-3 sm:p-3.5 rounded-2xl transition-all duration-150 group select-none border-none outline-none ${
        selectionMode ? 'cursor-pointer active:scale-[0.98]' : 'cursor-default'
      } ${
        isSelected
          ? 'bg-white/20 [.light-theme_&]:!bg-[#e2e8f0]'
          : 'bg-white/[0.08] hover:bg-white/[0.12] [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:hover:!bg-[#f8fafc]'
      } [.light-theme_&]:!shadow-[0_1px_4px_rgba(0,0,0,0.03)]`}
    >
      {/* Full-card dark dimming overlay on selection */}
      {isSelected && (
        <div className="absolute inset-0 rounded-2xl z-20 pointer-events-none transition-all bg-black/60 [.light-theme_&]:!bg-slate-900/35" />
      )}

      {/* 头像 */}
      <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl overflow-hidden shrink-0 bg-black/30 [.light-theme_&]:!bg-[#f1f5f9] border-none shadow-none relative">
        <img 
          src={avatarUrl || defaultFallback} 
          alt={char.name} 
          className="w-full h-full object-cover pointer-events-none" 
          referrerPolicy="no-referrer"
          onError={(e) => {
            if (e.currentTarget.src !== defaultFallback) {
              e.currentTarget.src = defaultFallback;
            }
          }}
        />
      </div>

      {/* 卡片信息 */}
      <div className="flex-1 min-w-0 pr-1">
        <h3 className="font-semibold text-white [.light-theme_&]:!text-[#0f172a] truncate text-sm sm:text-base leading-snug">
          {char.name}
        </h3>
        <p className="text-[11px] sm:text-xs text-red-400/90 [.light-theme_&]:!text-[#dc2626] mt-0.5 sm:mt-1 flex items-center gap-1 font-medium">
          <AlertTriangle className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
          <span className="truncate">{daysLeft} 天后永久删除</span>
        </p>
      </div>

      {/* 选择模式单选框 */}
      {selectionMode && (
        <div className="shrink-0 z-30 ml-2">
          {isSelected ? (
            <div className="w-6 h-6 rounded-full bg-white text-slate-950 flex items-center justify-center shadow-md [.light-theme_&]:!bg-[#0f172a] [.light-theme_&]:!text-[#ffffff]">
              <Check className="w-3.5 h-3.5 stroke-[3]" />
            </div>
          ) : (
            <div className="w-6 h-6 rounded-full border-2 border-white/30 group-hover:border-white/60 [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:group-hover:!border-[#94a3b8]" />
          )}
        </div>
      )}
    </motion.div>
  );
};

export function TrashBin({ onClose }: Props) {
  const [trashedCharacters, setTrashedCharacters] = useState<CharacterCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [displayLimit, setDisplayLimit] = useState(30);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 极速加载：使用元数据快照，0ms 响应，告别卡死与转圈
  const loadTrash = useCallback(async (showSpinner: boolean = true) => {
    if (showSpinner) setLoading(true);
    try {
      await cleanupOldTrash();
      const data = await getTrashedCharacters(false);
      setTrashedCharacters(data);
    } catch (e) {
      console.error("加载回收站失败:", e);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrash(true);
  }, [loadTrash]);

  // 实时响应核心：乐观直接清除，0秒延迟、不转圈！
  const removeCardsOptimistically = useCallback((idsToRemove: string | string[]) => {
    const removeSet = new Set(Array.isArray(idsToRemove) ? idsToRemove : [idsToRemove]);
    if (removeSet.size === 0) return;

    setTrashedCharacters(prev => prev.filter(c => !removeSet.has(c.id)));
    setSelectedIds(prev => {
      const next = new Set(prev);
      removeSet.forEach(id => next.delete(id));
      if (next.size === 0) {
        setSelectionMode(false);
      }
      return next;
    });
  }, []);

  // 实时响应：监听外部删除/恢复事件
  useEffect(() => {
    const handleCharacterChange = () => {
      // 外部有变动时后台静默刷新
      loadTrash(false);
    };

    window.addEventListener('characterRestored', handleCharacterChange);
    window.addEventListener('charactersUpdated', handleCharacterChange);
    return () => {
      window.removeEventListener('characterRestored', handleCharacterChange);
      window.removeEventListener('charactersUpdated', handleCharacterChange);
    };
  }, [loadTrash]);

  // 选择切换
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) {
        setSelectionMode(false);
      } else {
        setSelectionMode(true);
      }
      return next;
    });
  };

  // 全选/取消全选
  const handleSelectAll = () => {
    if (selectedIds.size === trashedCharacters.length) {
      setSelectedIds(new Set());
      setSelectionMode(false);
    } else {
      setSelectedIds(new Set(trashedCharacters.map(c => c.id)));
      setSelectionMode(true);
    }
  };

  // 批量恢复：实时响应，立即剔除选中的卡片，后台异步执行
  const handleBatchRestore = async () => {
    if (selectedIds.size === 0) return;
    const targetIds = Array.from(selectedIds);
    if (confirm(`确定要恢复选中的 ${targetIds.length} 个角色吗？`)) {
      removeCardsOptimistically(targetIds);
      setSelectionMode(false);
      setSelectedIds(new Set());

      (async () => {
        try {
          for (const id of targetIds) {
            await restoreCharacter(id);
          }
        } catch (e) {
          console.error("批量恢复角色出错:", e);
          loadTrash(false);
        }
      })();
    }
  };

  // 批量永久删除：实时响应，立即剔除选中的卡片，后台异步执行
  const handleBatchHardDelete = async () => {
    if (selectedIds.size === 0) return;
    const targetIds = Array.from(selectedIds);
    if (confirm(`确定要将选中的 ${targetIds.length} 个角色永久删除吗？此操作不可撤销！`)) {
      removeCardsOptimistically(targetIds);
      setSelectionMode(false);
      setSelectedIds(new Set());

      (async () => {
        try {
          await deleteCharactersBulk(targetIds);
        } catch (e) {
          console.error("批量彻底删除出错:", e);
          loadTrash(false);
        }
      })();
    }
  };

  const visibleChars = trashedCharacters.slice(0, displayLimit);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0c] [.light-theme_&]:!bg-[#f7f7f9] text-white [.light-theme_&]:!text-[#0f172a] select-none overflow-hidden"
    >
      {/* Top Header - Safe Area aware */}
      <header className="sticky top-0 p-4 pt-[max(1.75rem,env(safe-area-inset-top))] sm:pt-[max(1.75rem,env(safe-area-inset-top))] flex items-center justify-between border-b border-white/10 [.light-theme_&]:!border-[#e2e8f0] bg-slate-900/90 [.light-theme_&]:!bg-[#ffffff]/95 backdrop-blur-xl z-20 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button 
            onClick={() => {
              if (selectionMode) {
                setSelectionMode(false);
                setSelectedIds(new Set());
              } else {
                onClose();
              }
            }} 
            className="p-2 rounded-full hover:bg-white/10 [.light-theme_&]:hover:!bg-[#f1f5f9] text-white/80 hover:text-white [.light-theme_&]:!text-[#0f172a] transition shrink-0 cursor-pointer" 
            title={selectionMode ? "退出选择" : "返回"}
          >
            <X className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-white [.light-theme_&]:!text-[#0f172a] truncate leading-tight">
              {selectionMode ? `已选择 ${selectedIds.size} 项` : '回收站'}
            </h2>
            <p className="text-xs text-white/50 [.light-theme_&]:!text-[#64748b] truncate">
              {selectionMode ? '请确认对选中项的操作' : `共 ${trashedCharacters.length} 个角色 · 保留7天后彻底清除`}
            </p>
          </div>
        </div>
      </header>

      {/* Main Content Area - 流畅自然滚动，杜绝生硬分页按钮 */}
      <div 
        onScroll={(e) => {
          const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
          if (scrollHeight - scrollTop - clientHeight < 120) {
            setDisplayLimit(prev => Math.min(trashedCharacters.length, prev + 30));
          }
        }}
        className={`flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar max-w-5xl w-full mx-auto ${selectionMode ? 'pb-28 sm:pb-32' : 'pb-8 sm:pb-12'}`}
      >
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 text-white/40 [.light-theme_&]:!text-[#64748b]">
            <div className="w-8 h-8 border-2 border-white/40 border-t-white [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:!border-t-[#0f172a] rounded-full animate-spin mb-4" />
            <p className="text-sm font-medium">加载中...</p>
          </div>
        ) : trashedCharacters.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-white/40 [.light-theme_&]:!text-[#64748b]">
            <Trash2 className="w-12 h-12 mb-3 opacity-40" />
            <p className="text-sm font-medium">回收站是空的</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {visibleChars.map((char) => (
                <TrashedCharacterCard 
                  key={char.id} 
                  char={char}
                  selectionMode={selectionMode}
                  isSelected={selectedIds.has(char.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
            
            {visibleChars.length < trashedCharacters.length && (
              <div className="py-4 text-center text-xs text-white/40 [.light-theme_&]:!text-slate-400 font-medium">
                向下滚动显示更多 ({visibleChars.length} / {trashedCharacters.length})
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Action Bar - Floating Pill Dock matching CharacterList */}
      <AnimatePresence>
        {selectionMode && (
          <motion.div
            initial={{ y: 24, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 20, opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="floating-pill-dock fixed bottom-6 inset-x-0 mx-auto w-fit z-[70] rounded-full px-2 sm:px-3 py-1.5 transition-all shadow-2xl max-w-[calc(100vw-1rem)] sm:max-w-max"
          >
            <div
              className="flex items-center gap-0.5 sm:gap-1.5 px-0.5 overflow-x-auto hide-scrollbar"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              <button
                type="button"
                onClick={handleSelectAll}
                className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-full transition active:scale-90 shrink-0 cursor-pointer"
              >
                <CheckCircle2 className="w-5 h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight whitespace-nowrap">
                  {selectedIds.size === trashedCharacters.length ? '取消' : '全选'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleBatchRestore}
                disabled={selectedIds.size === 0}
                className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-full transition active:scale-90 shrink-0 hover:!text-blue-500 disabled:opacity-35 disabled:pointer-events-none cursor-pointer"
              >
                <RotateCcw className="w-5 h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight whitespace-nowrap">
                  恢复{selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                </span>
              </button>

              <button
                type="button"
                onClick={handleBatchHardDelete}
                disabled={selectedIds.size === 0}
                className="floating-pill-item is-danger flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-full transition active:scale-90 shrink-0 disabled:opacity-35 disabled:pointer-events-none cursor-pointer"
              >
                <Trash2 className="w-5 h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight whitespace-nowrap">
                  彻底删除{selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectionMode(false);
                  setSelectedIds(new Set());
                }}
                className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-full transition active:scale-90 shrink-0 hover:!text-slate-400 cursor-pointer"
              >
                <X className="w-5 h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight whitespace-nowrap">退出</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
