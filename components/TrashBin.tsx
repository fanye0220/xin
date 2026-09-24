import { getFallbackAvatar, resolveAvatarUrl } from '../lib/avatar';
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Trash2, RotateCcw, X, AlertTriangle, CheckCircle2, CheckCircle } from 'lucide-react';
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
  onToggleSelect 
}: { 
  key?: React.Key, 
  char: CharacterCard, 
  onRestore: (id: string) => void, 
  onHardDelete: (id: string) => void,
  selectionMode: boolean,
  isSelected: boolean,
  onToggleSelect: (id: string) => void
}) => {
  const defaultFallback = getFallbackAvatar(char.name || char.id, char.tags?.join(',') || (char.isTool ? 'tool' : undefined));
  const [avatarUrl, setAvatarUrl] = useState<string>(resolveAvatarUrl(char.avatarUrlFallback, char.name || char.id));
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);

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

  const handleTouchStart = () => {
    if (selectionMode) return;
    const timer = setTimeout(() => {
      onToggleSelect(char.id);
    }, 500);
    setLongPressTimer(timer);
  };

  const handleTouchEnd = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    if (selectionMode) {
      onToggleSelect(char.id);
    }
  };

  return (
    <div 
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className={`relative flex items-center gap-4 p-4 bg-white/5 border transition-all rounded-2xl group active:scale-[0.98] ${
        selectionMode ? 'cursor-pointer' : ''
      } ${
        isSelected ? 'border-red-500 bg-red-500/10 ring-1 ring-red-500/20' : 'border-white/10 hover:bg-white/10'
      }`}
    >
      {selectionMode && (
        <div className={`absolute top-2 right-2 z-10 p-0.5 rounded-full shadow-md transition-all ${isSelected ? 'bg-red-500 text-white scale-110' : 'bg-white/10 text-white/20'}`}>
          <CheckCircle className="w-5 h-5" />
        </div>
      )}
      <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0 bg-black/50 shadow-lg ring-1 ring-white/10">
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
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-white truncate text-base">{char.name}</h3>
        <p className="text-xs text-red-400/80 mt-1 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{daysLeft} 天后永久删除</span>
        </p>
      </div>
      {!selectionMode && (
        <div className="flex flex-row sm:flex-col gap-2.5 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onRestore(char.id); }}
            className="p-3 bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded-xl transition-all active:scale-90 shadow-sm"
            title="恢复"
          >
            <RotateCcw className="w-5 h-5 sm:w-4.5 sm:h-4.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onHardDelete(char.id); }}
            className="p-3 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-xl transition-all active:scale-90 shadow-sm"
            title="永久删除"
          >
            <Trash2 className="w-5 h-5 sm:w-4.5 sm:h-4.5" />
          </button>
        </div>
      )}
    </div>
  );
};

export function TrashBin({ onClose }: Props) {
  const [trashedCharacters, setTrashedCharacters] = useState<CharacterCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-2 pt-[max(1.75rem,env(safe-area-inset-top))] sm:p-4 sm:pt-[max(1.75rem,env(safe-area-inset-top))] bg-black/60 backdrop-blur-sm"
    >
      <div className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-3xl max-h-[92vh] sm:max-h-[85vh] flex flex-col shadow-2xl overflow-hidden ring-1 ring-white/10">
        <div className="p-5 sm:p-6 border-b border-white/10 flex items-center justify-between bg-white/[0.02] backdrop-blur-md">
          <div className="flex items-center gap-3 min-w-0">
            {selectionMode ? (
              <button 
                onClick={() => { setSelectionMode(false); setSelectedIds(new Set()); }}
                className="p-2 -ml-2 rounded-full hover:bg-white/10 transition shrink-0 active:scale-90"
              >
                <X className="w-6 h-6" />
              </button>
            ) : (
              <div className="p-2 bg-red-500/20 rounded-xl text-red-400 shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-white truncate leading-tight">
                {selectionMode ? `已选择 ${selectedIds.size} 项` : '回收站'}
              </h2>
              <p className="text-xs sm:text-sm text-white/50 truncate">
                {selectionMode ? '请确认对选中项的操作' : '已删除的角色将在此保留7天'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {!loading && trashedCharacters.length > 0 && !selectionMode && (
              <>
                <button
                  onClick={() => setSelectionMode(true)}
                  className="px-4 py-2 bg-white/10 text-white/80 hover:bg-white/20 rounded-xl transition font-bold text-sm"
                >
                  选择
                </button>
                <button
                  onClick={handleEmptyTrash}
                  className="px-4 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-xl transition font-bold text-sm whitespace-nowrap"
                >
                  清空
                </button>
              </>
            )}
            {selectionMode && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleBatchRestore}
                  disabled={selectedIds.size === 0}
                  className="px-4 py-2 bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 rounded-xl text-sm font-bold transition active:scale-95 shadow-lg shadow-green-500/30"
                >
                  恢复
                </button>
                <button
                  onClick={handleBatchHardDelete}
                  disabled={selectedIds.size === 0}
                  className="px-4 py-2 bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 rounded-xl text-sm font-bold transition active:scale-95 shadow-lg shadow-red-500/30"
                >
                  清除
                </button>
              </div>
            )}
            {!selectionMode && (
              <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition text-white/60 hover:text-white active:scale-90">
                <X className="w-6 h-6" />
              </button>
            )}
          </div>
        </div>

        {selectionMode && (
          <div className="px-6 py-2.5 bg-black/20 border-b border-white/5 flex items-center justify-between">
            <button 
              onClick={handleSelectAll}
              className="text-xs font-bold text-red-400 hover:text-red-300 transition"
            >
              {selectedIds.size === trashedCharacters.length ? '取消全选' : '全选所有'}
            </button>
            <span className="text-[10px] text-white/30 uppercase tracking-widest font-black">
              批量管理模式
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full text-white/40">
              <div className="w-8 h-8 border-4 border-red-500 border-t-transparent rounded-full animate-spin mb-4" />
              <p>加载中...</p>
            </div>
          ) : trashedCharacters.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-white/40">
              <CheckCircle2 className="w-16 h-16 mb-4 opacity-50 text-green-400" />
              <p>回收站是空的</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {paginatedChars.map(char => (
                  <TrashedCharacterCard 
                    key={char.id} 
                    char={char} 
                    onRestore={handleRestore} 
                    onHardDelete={handleHardDelete}
                    selectionMode={selectionMode}
                    isSelected={selectedIds.has(char.id)}
                    onToggleSelect={toggleSelect}
                  />
                ))}
              </div>
              
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-4 border-t border-white/10">
                  <button 
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:hover:bg-white/5 rounded-lg text-sm transition"
                  >
                    上一页
                  </button>
                  <span className="text-sm text-white/60">
                    {page} / {totalPages}
                  </span>
                  <button 
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:hover:bg-white/5 rounded-lg text-sm transition"
                  >
                    下一页
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
