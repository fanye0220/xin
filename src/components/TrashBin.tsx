import { getFallbackAvatar, resolveAvatarUrl } from '../lib/avatar';
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, RotateCcw, X, AlertTriangle, CheckCircle2, CheckCircle, Check, CheckSquare } from 'lucide-react';
import { CharacterCard, getTrashedCharacters, restoreCharacter, deleteCharacter, emptyTrash, cleanupOldTrash } from '../lib/db';

interface Props {
  onClose: () => void;
}

const TrashedCharacterCard = ({ 
  char, 
  onRestore, 
  onHardDelete, 
  selectionMode, 
  isSelected, 
  onToggleSelect,
  index = 0,
}: { 
  key?: React.Key, 
  char: CharacterCard, 
  onRestore: (id: string) => void, 
  onHardDelete: (id: string) => void,
  selectionMode: boolean,
  isSelected: boolean,
  onToggleSelect: (id: string) => void,
  index?: number,
}) => {
  const defaultFallback = getFallbackAvatar(char.name || char.id, char.tags?.join(',') || (char.isTool ? 'tool' : undefined));
  const [avatarUrl, setAvatarUrl] = useState<string>(resolveAvatarUrl(char.avatarUrlFallback, char.name || char.id));

  useEffect(() => {
    let url: string | undefined;
    let isMounted = true;
    
    if (char.localFilePath) {
      import('../lib/appBridge').then(({ getLocalImageUrl }) => {
         if (isMounted) setAvatarUrl(getLocalImageUrl(char.localFilePath!, char.updatedAt || char.createdAt));
      });
    } else if (char.avatarBlob) {
      url = URL.createObjectURL(char.avatarBlob);
      setAvatarUrl(url);
    } else if (char.hasBlobsSeparated) {
      import('../lib/db').then(({ getCharacter }) => {
        getCharacter(char.id).then(fullChar => {
          if (fullChar && fullChar.avatarBlob && isMounted) {
             const objectUrl = URL.createObjectURL(fullChar.avatarBlob);
             setAvatarUrl(objectUrl);
          }
        });
      });
    }
    
    return () => {
      isMounted = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [char.avatarBlob, char.id, char.hasBlobsSeparated, char.localFilePath]);

  const daysLeft = Math.ceil((7 * 24 * 60 * 60 * 1000 - (Date.now() - (char.deletedAt || 0))) / (1000 * 60 * 60 * 24));

  const longPressRef = useRef<{
    timer: NodeJS.Timeout | null;
    startX?: number;
    startY?: number;
    triggered: boolean;
  }>({
    timer: null,
    triggered: false
  });

  const startLongPress = (clientX?: number, clientY?: number) => {
    longPressRef.current.triggered = false;
    longPressRef.current.startX = clientX;
    longPressRef.current.startY = clientY;
    if (longPressRef.current.timer) {
      clearTimeout(longPressRef.current.timer);
    }
    longPressRef.current.timer = setTimeout(() => {
      longPressRef.current.triggered = true;
      onToggleSelect(char.id);
    }, 320);
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
      if (dx > 12 || dy > 12) {
        cancelLongPress();
      }
    }
  };

  return (
    <motion.div 
      onClick={(e) => {
        if (longPressRef.current.triggered) {
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
        if (!selectionMode) {
          startLongPress(e.touches[0].clientX, e.touches[0].clientY);
        }
      }}
      onTouchMove={(e) => {
        if (e.touches && e.touches[0]) {
          checkMove(e.touches[0].clientX, e.touches[0].clientY);
        }
      }}
      onTouchEnd={cancelLongPress}
      onTouchCancel={cancelLongPress}
      onMouseDown={(e) => {
        if (e.button === 0 && !selectionMode) {
          startLongPress(e.clientX, e.clientY);
        }
      }}
      onMouseMove={(e) => {
        checkMove(e.clientX, e.clientY);
      }}
      onMouseUp={cancelLongPress}
      onMouseLeave={cancelLongPress}
      onContextMenu={(e) => {
        e.preventDefault();
        onToggleSelect(char.id);
      }}
      className={`relative flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-2xl transition-all duration-200 group active:scale-[0.98] ${
        selectionMode ? 'cursor-pointer' : ''
      } ${
        isSelected
          ? 'bg-slate-950/90 border border-white/10 [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:!border-[#e2e8f0]'
          : 'bg-white/[0.06] hover:bg-white/[0.09] shadow-xs border border-white/10 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:hover:!bg-[#f8fafc] [.light-theme_&]:!border-[#e2e8f0]'
      } [.light-theme_&]:!shadow-xs`}
    >
      {/* Full-card dark dimming overlay on selection (matching DuplicateDetector) */}
      {isSelected && (
        <div className="absolute inset-0 rounded-2xl z-20 pointer-events-none transition-all bg-black/65 [.light-theme_&]:!bg-slate-900/35" />
      )}

      <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl overflow-hidden shrink-0 bg-black/50 [.light-theme_&]:!bg-[#f1f5f9] shadow-md relative">
        <img 
          src={avatarUrl || undefined} 
          alt={char.name} 
          className="w-full h-full object-cover" 
          referrerPolicy="no-referrer"
          onError={(e) => {
            if (e.currentTarget.src !== defaultFallback) {
              e.currentTarget.src = defaultFallback;
            }
          }}
        />
      </div>
      <div className="flex-1 min-w-0 pr-1">
        <h3 className="font-semibold text-white [.light-theme_&]:!text-[#0f172a] truncate text-sm sm:text-base leading-snug">{char.name}</h3>
        <p className="text-[11px] sm:text-xs text-red-400/90 [.light-theme_&]:!text-[#dc2626] mt-0.5 sm:mt-1 flex items-center gap-1 font-medium">
          <AlertTriangle className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
          <span className="truncate">{daysLeft} 天后永久删除</span>
        </p>
      </div>

      {selectionMode ? (
        <div className="shrink-0 z-30 ml-2">
          {isSelected ? (
            <div className="w-6 h-6 rounded-full bg-white text-slate-950 flex items-center justify-center shadow-md [.light-theme_&]:!bg-[#0f172a] [.light-theme_&]:!text-[#ffffff]">
              <Check className="w-3.5 h-3.5 stroke-[3]" />
            </div>
          ) : (
            <div className="w-6 h-6 rounded-full border-2 border-white/30 group-hover:border-white/60 [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:group-hover:!border-[#94a3b8]" />
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 shrink-0 z-30">
          <button
            onClick={(e) => { e.stopPropagation(); onRestore(char.id); }}
            className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center bg-white/10 hover:bg-white/15 text-slate-300 hover:text-white border border-white/10 rounded-full transition-all active:scale-90 shadow-2xs cursor-pointer [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#334155] [.light-theme_&]:!border-[#cbd5e1]"
            title="恢复"
          >
            <RotateCcw className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-300 group-hover:text-white [.light-theme_&]:!text-[#334155]" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onHardDelete(char.id); }}
            className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center bg-white/[0.06] text-rose-400/80 hover:text-rose-300 hover:bg-rose-500/20 border border-white/10 hover:border-rose-500/30 rounded-full transition-all active:scale-90 shadow-2xs cursor-pointer [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:hover:!bg-[#fef2f2] [.light-theme_&]:!text-[#991b1b]/80 [.light-theme_&]:hover:!text-[#dc2626] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:hover:!border-[#fecaca]"
            title="永久删除"
          >
            <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
        </div>
      )}
    </motion.div>
  );
};

export function TrashBin({ onClose }: Props) {
  const [trashedCharacters, setTrashedCharacters] = useState<CharacterCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLightMode, setIsLightMode] = useState(() => 
    typeof document !== 'undefined' && document.documentElement.classList.contains('light-theme')
  );

  useEffect(() => {
    const checkTheme = () => {
      setIsLightMode(document.documentElement.classList.contains('light-theme'));
    };
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  const pageSize = 20;

  const loadTrash = async () => {
    setLoading(true);
    await cleanupOldTrash();
    const data = await getTrashedCharacters();
    setTrashedCharacters(data);
    setLoading(false);
  };

  useEffect(() => {
    loadTrash();
  }, []);

  const handleRestore = async (id: string) => {
    await restoreCharacter(id);
    loadTrash();
  };

  const handleHardDelete = async (id: string) => {
    if (confirm('确定要永久删除此角色吗？此操作不可恢复。')) {
      await deleteCharacter(id);
      loadTrash();
    }
  };

  const handleEmptyTrash = async () => {
    if (confirm('确定要清空回收站吗？所有角色将被永久删除。')) {
      await emptyTrash();
      loadTrash();
    }
  };

  const toggleSelect = (id: string) => {
    setSelectionMode(true);
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === trashedCharacters.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(trashedCharacters.map(c => c.id)));
    }
  };

  const handleBatchRestore = async () => {
    if (selectedIds.size === 0) return;
    if (confirm(`确定要恢复选中的 ${selectedIds.size} 个角色吗？`)) {
      setLoading(true);
      for (const id of selectedIds) {
        await restoreCharacter(id);
      }
      setSelectedIds(new Set());
      setSelectionMode(false);
      await loadTrash();
    }
  };

  const handleBatchHardDelete = async () => {
    if (selectedIds.size === 0) return;
    if (confirm(`确定要将选中的 ${selectedIds.size} 个角色永久删除吗？此操作不可撤销！`)) {
      setLoading(true);
      // 批量操作保留 miu 这边的批量原生接口(只查一次全部角色、只调一次
      // 原生批量接口, 而不是安卓那边一个个 deleteCharacter(id) 循环删),
      // 但不再"乐观更新": 老实等它真正删完, 用数据库真实结果刷新列表。
      const { deleteCharactersBulk } = await import('../lib/db');
      await deleteCharactersBulk(Array.from(selectedIds));
      setSelectedIds(new Set());
      setSelectionMode(false);
      await loadTrash();
    }
  };

  const totalPages = Math.ceil(trashedCharacters.length / pageSize);
  const paginatedChars = trashedCharacters.slice((page - 1) * pageSize, page * pageSize);

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
              {selectionMode ? '请确认对选中项的操作' : '已删除的角色将在此保留7天'}
            </p>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className={`flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar max-w-5xl w-full mx-auto ${selectionMode ? 'pb-28 sm:pb-32' : 'pb-8 sm:pb-12'}`}>
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 text-white/40 [.light-theme_&]:!text-[#64748b]">
            <div className="w-8 h-8 border-2 border-white/40 border-t-white [.light-theme_&]:!border-slate-300 [.light-theme_&]:!border-t-slate-800 rounded-full animate-spin mb-4" />
            <p className="text-sm font-medium">加载中...</p>
          </div>
        ) : trashedCharacters.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-white/40 [.light-theme_&]:!text-[#64748b]">
            <Trash2 className="w-12 h-12 mb-3 opacity-40" />
            <p className="text-sm font-medium">回收站是空的</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {paginatedChars.map((char, index) => (
                <TrashedCharacterCard 
                  key={char.id} 
                  char={char}
                  index={index}
                  onRestore={handleRestore} 
                  onHardDelete={handleHardDelete}
                  selectionMode={selectionMode}
                  isSelected={selectedIds.has(char.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
            
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-6 border-t border-white/10 [.light-theme_&]:!border-[#e2e8f0]">
                <button 
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:hover:!bg-[#f1f5f9] border border-white/10 [.light-theme_&]:!border-[#cbd5e1] disabled:opacity-40 rounded-full text-xs font-semibold text-white [.light-theme_&]:!text-[#0f172a] transition cursor-pointer shadow-xs"
                >
                  上一页
                </button>
                <span className="text-xs text-white/60 [.light-theme_&]:!text-[#64748b] font-medium">
                  {page} / {totalPages}
                </span>
                <button 
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:hover:!bg-[#f1f5f9] border border-white/10 [.light-theme_&]:!border-[#cbd5e1] disabled:opacity-40 rounded-full text-xs font-semibold text-white [.light-theme_&]:!text-[#0f172a] transition cursor-pointer shadow-xs"
                >
                  下一页
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Action Bar - ONLY shown when selectionMode is active (长按或点击选择后调出，微型低高度纯色底栏) */}
      <AnimatePresence>
        {selectionMode && (
          <motion.div
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="shrink-0 w-full border-t border-white/10 [.light-theme_&]:!border-[#e2e8f0] bg-slate-900/95 [.light-theme_&]:!bg-[#ffffff]/95 backdrop-blur-xl z-30 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl"
          >
            <div className="grid grid-cols-4 w-full divide-x divide-white/5 [.light-theme_&]:!divide-[#e2e8f0]">
              <button
                type="button"
                onClick={handleSelectAll}
                className="flex flex-col items-center justify-center py-1.5 px-1 text-slate-300 hover:text-white [.light-theme_&]:!text-[#0f172a] hover:bg-white/5 [.light-theme_&]:hover:!bg-[#f1f5f9] transition cursor-pointer active:scale-95"
              >
                <CheckCircle2 className="w-4 h-4 mb-1 text-slate-300 [.light-theme_&]:!text-[#0f172a]" />
                <span className="text-[11px] font-medium truncate">
                  {selectedIds.size === trashedCharacters.length ? '取消' : '全选'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleBatchRestore}
                disabled={selectedIds.size === 0}
                className="flex flex-col items-center justify-center py-1.5 px-1 text-slate-300 hover:text-white [.light-theme_&]:!text-[#0f172a] hover:bg-white/5 [.light-theme_&]:hover:!bg-[#f1f5f9] transition cursor-pointer active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
              >
                <RotateCcw className="w-4 h-4 mb-1 text-slate-300 [.light-theme_&]:!text-[#0f172a]" />
                <span className="text-[11px] font-medium truncate">
                  恢复{selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                </span>
              </button>

              <button
                type="button"
                onClick={handleBatchHardDelete}
                disabled={selectedIds.size === 0}
                className="flex flex-col items-center justify-center py-1.5 px-1 text-rose-400 hover:text-rose-300 [.light-theme_&]:!text-[#dc2626] hover:bg-white/5 [.light-theme_&]:hover:!bg-[#fef2f2] transition cursor-pointer active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
              >
                <Trash2 className="w-4 h-4 mb-1 text-rose-400 [.light-theme_&]:!text-[#dc2626]" />
                <span className="text-[11px] font-medium truncate">
                  删除{selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectionMode(false);
                  setSelectedIds(new Set());
                }}
                className="flex flex-col items-center justify-center py-1.5 px-1 text-slate-300 hover:text-white [.light-theme_&]:!text-[#0f172a] hover:bg-white/5 [.light-theme_&]:hover:!bg-[#f1f5f9] transition cursor-pointer active:scale-95"
              >
                <X className="w-4 h-4 mb-1 text-slate-300 [.light-theme_&]:!text-[#0f172a]" />
                <span className="text-[11px] font-medium truncate">退出</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
