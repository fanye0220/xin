import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Folder as FolderIcon, FolderPlus, X, Search, Check } from 'lucide-react';
import { getFolders, saveFolder, Folder } from '../lib/db';
import { useBackHandler } from '../lib/useBackHandler';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onMove: (folderId: string | null) => void;
  isLightMode?: boolean;
}

export function MoveToFolderModal({ isOpen, onClose, onMove, isLightMode: propIsLightMode }: Props) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [search, setSearch] = useState('');
  
  const [isLightMode, setIsLightMode] = useState(() => {
    if (typeof propIsLightMode === 'boolean') return propIsLightMode;
    return (
      typeof document !== 'undefined' && (
        document.documentElement.classList.contains('light-theme') ||
        document.body.classList.contains('light-theme') ||
        localStorage.getItem('tavern_theme') === 'light'
      )
    );
  });

  useEffect(() => {
    if (typeof propIsLightMode === 'boolean') {
      setIsLightMode(propIsLightMode);
      return;
    }
    const checkTheme = () => {
      const isLight =
        typeof document !== 'undefined' && (
          document.documentElement.classList.contains('light-theme') ||
          document.body.classList.contains('light-theme') ||
          localStorage.getItem('tavern_theme') === 'light'
        );
      setIsLightMode(Boolean(isLight));
    };
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    if (typeof document !== 'undefined') {
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      window.addEventListener('storage', checkTheme);
    }
    return () => {
      observer.disconnect();
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', checkTheme);
      }
    };
  }, [propIsLightMode]);

  // Standard Folder Creation Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  useBackHandler(isOpen, () => {
    if (showCreateModal) {
      setShowCreateModal(false);
      return true;
    }
    onClose();
    return true;
  });

  const loadFolders = () => {
    getFolders().then(f => setFolders(f.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))));
  };

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setShowCreateModal(false);
      setNewFolderName('');
      loadFolders();
    }
  }, [isOpen]);

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    try {
      const newFolder: Folder = {
        id: 'folder_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        name: trimmed,
        createdAt: Date.now(),
      };
      await saveFolder(newFolder);
      setShowCreateModal(false);
      setNewFolderName('');
      // Move directly into this newly created folder!
      onMove(newFolder.id);
    } catch (err) {
      console.error('Failed to create folder:', err);
    }
  };

  const folderPathMap = useMemo(() => {
    const fMap = new Map<string, Folder>();
    folders.forEach(f => fMap.set(f.id, f));
    const pathMap: Record<string, string> = {};
    for (const f of folders) {
      const parts: string[] = [];
      let curr: Folder | undefined = f;
      const visited = new Set<string>();
      while (curr && !visited.has(curr.id)) {
        visited.add(curr.id);
        parts.unshift(curr.name);
        curr = curr.parentId ? fMap.get(curr.parentId) : undefined;
      }
      pathMap[f.id] = parts.join(' / ');
    }
    return pathMap;
  }, [folders]);

  const filteredFolders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return folders.filter(f => 
      f.name.toLowerCase().includes(q) || 
      (folderPathMap[f.id] || '').toLowerCase().includes(q)
    );
  }, [folders, search, folderPathMap]);

  if (!isOpen) return null;

  const renderFolderOptions = (parentId: string | null = null, depth = 0) => {
    const childFolders = folders.filter(f => (f.parentId || null) === parentId);
    return childFolders.map(folder => (
      <React.Fragment key={folder.id}>
        <button
          onClick={() => onMove(folder.id)}
          className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 [.light-theme_&]:hover:!bg-black/5 transition text-left cursor-pointer"
          style={{ paddingLeft: `${depth * 1.5 + 0.75}rem` }}
        >
          <div className="w-10 h-10 rounded-xl bg-white/10 text-white/90 [.light-theme_&]:!bg-black/5 [.light-theme_&]:!text-[#0f172a] flex items-center justify-center shrink-0">
            <FolderIcon className="w-5 h-5 stroke-[2] text-white/80 [.light-theme_&]:!text-[#0f172a]" />
          </div>
          <span className="font-medium text-white [.light-theme_&]:!text-[#0f172a] truncate">{folder.name}</span>
        </button>
        {renderFolderOptions(folder.id, depth + 1)}
      </React.Fragment>
    ));
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
        onClick={onClose}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        <motion.div
          initial={{ scale: 0.95, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-slate-900 [.light-theme_&]:!bg-[#ffffff] border border-white/10 [.light-theme_&]:!border-black/5 rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
        >
          <div className="p-4 pb-2 flex items-center justify-between">
            <h3 className="text-lg font-bold text-white [.light-theme_&]:!text-[#0f172a]">移动到文件夹</h3>
            <button onClick={onClose} className="p-1 text-white/50 hover:text-white [.light-theme_&]:!text-slate-500 [.light-theme_&]:hover:!text-[#0f172a] rounded-lg transition cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>

          {folders.length > 5 && (
            <div className="px-3 pb-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 [.light-theme_&]:!text-slate-400" />
                <input
                  type="text"
                  placeholder="搜索目标文件夹..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-1.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-blue-500/50 transition [.light-theme_&]:!bg-black/5 [.light-theme_&]:!border-transparent [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:placeholder:!text-slate-400"
                />
              </div>
            </div>
          )}
          
          <div className="overflow-y-auto p-2">
            {/* Top Action Item: 新建文件夹 */}
            <button
              onClick={() => {
                setNewFolderName('');
                setShowCreateModal(true);
              }}
              className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 [.light-theme_&]:hover:!bg-black/5 transition text-left cursor-pointer"
            >
              <div className="w-10 h-10 rounded-lg bg-blue-500/15 text-blue-400 [.light-theme_&]:!bg-[#007aff]/10 [.light-theme_&]:!text-[#007aff] flex items-center justify-center shrink-0">
                <FolderPlus className="w-5 h-5" />
              </div>
              <span className="font-semibold text-blue-400 [.light-theme_&]:!text-[#007aff] text-sm">
                + 新建文件夹
              </span>
            </button>

            {!search && (
              <button
                onClick={() => onMove(null)}
                className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 [.light-theme_&]:hover:!bg-black/5 transition text-left cursor-pointer"
              >
                <div className="w-10 h-10 rounded-xl bg-white/10 text-white/90 [.light-theme_&]:!bg-black/5 [.light-theme_&]:!text-[#0f172a] flex items-center justify-center shrink-0">
                  <FolderIcon className="w-5 h-5 stroke-[2] text-white/80 [.light-theme_&]:!text-[#0f172a]" />
                </div>
                <span className="font-medium text-white [.light-theme_&]:!text-[#0f172a]">主页 (移除文件夹)</span>
              </button>
            )}
            
            {filteredFolders ? (
              filteredFolders.length > 0 ? (
                filteredFolders.map(folder => (
                  <button
                    key={folder.id}
                    onClick={() => onMove(folder.id)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 [.light-theme_&]:hover:!bg-black/5 transition text-left cursor-pointer"
                  >
                    <div className="w-10 h-10 rounded-xl bg-white/10 text-white/90 [.light-theme_&]:!bg-black/5 [.light-theme_&]:!text-[#0f172a] flex items-center justify-center shrink-0">
                      <FolderIcon className="w-5 h-5 stroke-[2] text-white/80 [.light-theme_&]:!text-[#0f172a]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-white [.light-theme_&]:!text-[#0f172a] truncate">{folder.name}</div>
                      {folderPathMap[folder.id] && folderPathMap[folder.id] !== folder.name && (
                        <div className="text-xs text-white/40 [.light-theme_&]:!text-slate-500 truncate">{folderPathMap[folder.id]}</div>
                      )}
                    </div>
                  </button>
                ))
              ) : (
                <div className="p-8 text-center text-white/40 [.light-theme_&]:!text-slate-400 text-sm">
                  未找到匹配的文件夹
                </div>
              )
            ) : (
              renderFolderOptions()
            )}
          </div>
        </motion.div>

        {/* 统一标准的「新建文件夹」弹窗模版 (Exact Homepage Folder Modal Template) */}
        <AnimatePresence>
          {showCreateModal && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={(e) => e.stopPropagation()}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                transition={{ type: "spring", duration: 0.28, bounce: 0.12 }}
                onClick={(e) => e.stopPropagation()}
                className={`w-full max-w-[340px] sm:max-w-[360px] rounded-3xl p-6 shadow-2xl backdrop-blur-2xl select-none transition-colors ${
                  isLightMode
                    ? "bg-white text-[#0f172a] border border-[#e2e8f0] shadow-xl"
                    : "bg-[#16181f]/95 text-white border border-white/10"
                }`}
              >
                {/* Header: Title + Subtitle (without the top icon badge) */}
                <div className="flex flex-col items-center text-center mb-5">
                  <h3
                    className={`text-base sm:text-lg font-bold ${
                      isLightMode ? "text-[#0f172a]" : "text-white"
                    }`}
                  >
                    新建文件夹
                  </h3>
                  <p
                    className={`text-xs mt-1.5 ${
                      isLightMode ? "text-[#64748b]" : "text-[#94a3b8]"
                    }`}
                  >
                    创建新分类以便更好地归类整理角色卡
                  </p>
                </div>

                {/* Input with inner folder icon */}
                <div className="relative mb-5">
                  <div
                    className={`absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none ${
                      isLightMode ? "text-[#94a3b8]" : "text-[#64748b]"
                    }`}
                  >
                    <FolderIcon className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="输入文件夹名称..."
                    className={`w-full pl-10 pr-4 py-2.5 sm:py-3 rounded-2xl text-sm font-medium outline-none transition ${
                      isLightMode
                        ? "bg-[#f8fafc] border border-[#cbd5e1] text-[#0f172a] placeholder:text-[#94a3b8] focus:bg-white focus:border-[#3b82f6] focus:ring-4 focus:ring-blue-500/15"
                        : "bg-white/5 border border-white/10 text-white placeholder:text-[#64748b] focus:bg-white/10 focus:border-blue-500/60 focus:ring-4 focus:ring-blue-500/20"
                    }`}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleCreateFolder();
                      }
                      if (e.key === "Escape") {
                        setShowCreateModal(false);
                      }
                    }}
                  />
                </div>

                {/* Actions: Side-by-side Cancel & Submit */}
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className={`flex-1 py-2.5 sm:py-3 rounded-2xl text-xs sm:text-sm font-medium transition cursor-pointer active:scale-95 ${
                      isLightMode
                        ? "bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#334155]"
                        : "bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10"
                    }`}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateFolder}
                    disabled={!newFolderName.trim()}
                    className="flex-1 py-2.5 sm:py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:pointer-events-none text-white text-xs sm:text-sm font-semibold transition active:scale-95 cursor-pointer shadow-md shadow-blue-500/25 flex items-center justify-center gap-1.5"
                  >
                    <Check className="w-4 h-4 stroke-[2.2]" />
                    <span>创建</span>
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
