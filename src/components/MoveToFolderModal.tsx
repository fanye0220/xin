import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Folder as FolderIcon, 
  FolderPlus, 
  X, 
  Search, 
  Check, 
  ChevronRight, 
  CornerDownRight, 
  Home,
  Plus,
  Edit2,
  Trash2
} from 'lucide-react';
import { getFolders, saveFolder, deleteFolder, Folder } from '../lib/db';
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
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  
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

  // Folder Creation Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingParentFolder, setCreatingParentFolder] = useState<Folder | null>(null);
  const [newFolderName, setNewFolderName] = useState('');

  // Folder Rename Modal State
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<Folder | null>(null);
  const [renameValue, setRenameValue] = useState('');

  useBackHandler(isOpen, () => {
    if (showRenameModal) {
      setShowRenameModal(false);
      return true;
    }
    if (showCreateModal) {
      setShowCreateModal(false);
      return true;
    }
    onClose();
    return true;
  });

  const loadFolders = () => {
    getFolders().then(f => {
      const sorted = f.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      setFolders(sorted);
      // Auto expand folders by default so sub-levels are clearly visible
      setExpandedFolders(new Set(sorted.map(item => item.id)));
    });
  };

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setShowCreateModal(false);
      setShowRenameModal(false);
      setCreatingParentFolder(null);
      setRenamingFolder(null);
      setNewFolderName('');
      setRenameValue('');
      loadFolders();
    }
  }, [isOpen]);

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleOpenCreateModal = (parentFolder: Folder | null, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setCreatingParentFolder(parentFolder);
    setNewFolderName('');
    setShowCreateModal(true);
  };

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    try {
      const newFolder: Folder = {
        id: 'folder_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        name: trimmed,
        createdAt: Date.now(),
        parentId: creatingParentFolder ? creatingParentFolder.id : null,
      };
      await saveFolder(newFolder);
      
      if (creatingParentFolder) {
        setExpandedFolders(prev => new Set(prev).add(creatingParentFolder.id));
      }
      
      setShowCreateModal(false);
      setNewFolderName('');
      setCreatingParentFolder(null);
      
      // Move directly into this newly created folder!
      onMove(newFolder.id);
    } catch (err) {
      console.error('Failed to create folder:', err);
    }
  };

  const handleOpenRenameModal = (folder: Folder, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setRenamingFolder(folder);
    setRenameValue(folder.name);
    setShowRenameModal(true);
  };

  const handleRenameFolder = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || !renamingFolder) return;
    try {
      await saveFolder({ ...renamingFolder, name: trimmed });
      setShowRenameModal(false);
      setRenamingFolder(null);
      setRenameValue('');
      loadFolders();
    } catch (err) {
      console.error('Failed to rename folder:', err);
    }
  };

  const handleDeleteFolder = async (folder: Folder, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`确定要删除文件夹 "${folder.name}" 吗？\n文件夹将被直接删除，其内的所有角色都将被移至回收站。`)) {
      try {
        await deleteFolder(folder.id);
        loadFolders();
      } catch (err) {
        console.error('Failed to delete folder:', err);
      }
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
    if (childFolders.length === 0) return null;

    return (
      <div className="space-y-0.5">
        {childFolders.map(folder => {
          const hasChildren = folders.some(f => f.parentId === folder.id);
          const isExpanded = expandedFolders.has(folder.id);
          const childrenCount = folders.filter(f => f.parentId === folder.id).length;

          return (
            <div key={folder.id} className="flex flex-col">
              {/* Clean Streamlined Folder Row */}
              <div 
                onClick={() => onMove(folder.id)}
                className={`group relative flex items-center justify-between py-2 px-2.5 rounded-xl transition cursor-pointer active:scale-[0.99] ${
                  isLightMode 
                    ? 'hover:bg-[#f1f5f9] text-[#0f172a]' 
                    : 'hover:bg-white/8 text-white'
                }`}
                style={{ paddingLeft: `${depth * 1.25 + 0.6}rem` }}
              >
                {/* Left: Expand Arrow (if has subfolders) + Inline Minimal Icon + Name */}
                <div className="flex items-center gap-1.5 min-w-0 flex-1 pr-2">
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={(e) => toggleExpand(folder.id, e)}
                      className={`p-1 rounded-md transition-transform duration-150 shrink-0 ${
                        isLightMode 
                          ? 'hover:bg-black/10 text-slate-500 hover:text-[#0f172a]' 
                          : 'hover:bg-white/10 text-white/50 hover:text-white'
                      }`}
                    >
                      <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} />
                    </button>
                  ) : depth > 0 ? (
                    <CornerDownRight className={`w-3.5 h-3.5 shrink-0 ml-0.5 ${
                      isLightMode ? 'text-slate-300' : 'text-white/25'
                    }`} />
                  ) : (
                    <div className="w-4.5 shrink-0" />
                  )}

                  <FolderIcon className={`w-4 h-4 shrink-0 stroke-[2] ${
                    isLightMode ? 'text-[#3b82f6]' : 'text-blue-400'
                  }`} />
                  
                  <span className={`font-medium text-sm truncate leading-tight ${
                    isLightMode ? 'text-[#0f172a]' : 'text-white'
                  }`}>
                    {folder.name}
                  </span>

                  {hasChildren && (
                    <span className={`text-[10.5px] px-1.5 py-0.2 rounded-full font-medium shrink-0 border ${
                      isLightMode 
                        ? 'bg-[#eff6ff] text-[#2563eb] border-[#dbeafe]' 
                        : 'bg-white/10 text-slate-300 border-white/15'
                    }`}>
                      {childrenCount}
                    </span>
                  )}
                </div>

                {/* Right Action Icons: Add Subfolder (+), Rename (Edit), Delete (Trash) */}
                <div className="flex items-center gap-0.5 shrink-0">
                  {/* 新建子分类 */}
                  <button
                    type="button"
                    onClick={(e) => handleOpenCreateModal(folder, e)}
                    className={`p-1.5 rounded-lg transition cursor-pointer active:scale-90 ${
                      isLightMode 
                        ? 'text-slate-400 hover:text-[#2563eb] hover:bg-[#eff6ff]' 
                        : 'text-slate-400 hover:text-blue-300 hover:bg-blue-500/15'
                    }`}
                    title={`在「${folder.name}」下新建子分类`}
                  >
                    <Plus className="w-3.5 h-3.5 stroke-[2.2]" />
                  </button>

                  {/* 重命名 */}
                  <button
                    type="button"
                    onClick={(e) => handleOpenRenameModal(folder, e)}
                    className={`p-1.5 rounded-lg transition cursor-pointer active:scale-90 ${
                      isLightMode 
                        ? 'text-slate-400 hover:text-[#0f172a] hover:bg-[#f1f5f9]' 
                        : 'text-slate-400 hover:text-white hover:bg-white/10'
                    }`}
                    title="重命名"
                  >
                    <Edit2 className="w-3.5 h-3.5 stroke-[2]" />
                  </button>

                  {/* 删除 */}
                  <button
                    type="button"
                    onClick={(e) => handleDeleteFolder(folder, e)}
                    className={`p-1.5 rounded-lg transition cursor-pointer active:scale-90 ${
                      isLightMode 
                        ? 'text-slate-400 hover:text-[#dc2626] hover:bg-[#fef2f2]' 
                        : 'text-slate-400 hover:text-red-400 hover:bg-red-500/15'
                    }`}
                    title="删除分类"
                  >
                    <Trash2 className="w-3.5 h-3.5 stroke-[2]" />
                  </button>
                </div>
              </div>

              {/* Subfolders Recursive Container */}
              {hasChildren && isExpanded && (
                <div className={`relative pl-1 border-l ml-4 my-0.5 ${
                  isLightMode ? 'border-slate-200' : 'border-white/10'
                }`}>
                  {renderFolderOptions(folder.id, depth + 1)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-3 sm:p-4"
        onClick={onClose}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        <motion.div
          initial={{ scale: 0.95, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className={`rounded-3xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[85vh] transition-colors ${
            isLightMode
              ? 'bg-white border border-[#e2e8f0] text-[#0f172a] shadow-xl'
              : 'bg-[#11141c] border border-white/12 text-white'
          }`}
        >
          {/* Header */}
          <div className={`p-4 pb-3 flex items-center justify-between border-b ${
            isLightMode ? 'border-[#e2e8f0]' : 'border-white/10'
          }`}>
            <div className="flex items-center gap-2">
              <h3 className={`text-base sm:text-lg font-bold ${
                isLightMode ? 'text-[#0f172a]' : 'text-white'
              }`}>
                移动到文件夹
              </h3>
              {folders.length > 0 && (
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium border ${
                  isLightMode 
                    ? 'bg-[#f1f5f9] text-[#475569] border-[#e2e8f0]' 
                    : 'bg-white/10 text-slate-300 border-white/10'
                }`}>
                  {folders.length} 个分类
                </span>
              )}
            </div>
            <button 
              onClick={onClose} 
              className={`w-8 h-8 rounded-full flex items-center justify-center transition cursor-pointer border ${
                isLightMode 
                  ? 'bg-white hover:bg-[#f1f5f9] text-[#64748b] hover:text-[#0f172a] border-[#e2e8f0] shadow-2xs' 
                  : 'bg-white/10 hover:bg-white/15 text-white/60 hover:text-white border-transparent'
              }`}
            >
              <X className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
            </button>
          </div>

          {/* Search Bar */}
          {folders.length > 3 && (
            <div className="px-3 pt-3 pb-1">
              <div className="relative">
                <Search className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 ${
                  isLightMode ? 'text-[#94a3b8]' : 'text-slate-500'
                }`} />
                <input
                  type="text"
                  placeholder="搜索目标分类或子路径..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={`w-full rounded-2xl pl-10 pr-4 py-2 text-xs sm:text-sm font-medium outline-none transition ${
                    isLightMode 
                      ? 'bg-[#f8fafc] border border-[#cbd5e1] text-[#0f172a] placeholder:text-[#94a3b8] focus:bg-white focus:border-[#3b82f6] focus:ring-4 focus:ring-blue-500/10' 
                      : 'bg-black/30 border border-white/10 text-white placeholder:text-slate-500 focus:bg-white/5 focus:border-blue-500/60 focus:ring-4 focus:ring-blue-500/20'
                  }`}
                />
              </div>
            </div>
          )}
          
          {/* Scrollable Folder Area */}
          <div className="overflow-y-auto p-2.5 space-y-1 flex-1 custom-scrollbar">
            {/* Top Primary Actions: 新建根分类 & 移动到主页 */}
            {!search && (
              <div className={`grid grid-cols-2 gap-2 pb-2 mb-2 border-b ${
                isLightMode ? 'border-[#e2e8f0]' : 'border-white/10'
              }`}>
                <button
                  type="button"
                  onClick={() => handleOpenCreateModal(null)}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border font-semibold text-xs transition active:scale-95 cursor-pointer shadow-xs ${
                    isLightMode 
                      ? 'bg-[#eff6ff] hover:bg-[#dbeafe] text-[#2563eb] border-[#bfdbfe]' 
                      : 'bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border-blue-500/25'
                  }`}
                >
                  <FolderPlus className="w-4 h-4 shrink-0" />
                  <span>新建根分类</span>
                </button>

                <button
                  type="button"
                  onClick={() => onMove(null)}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border font-semibold text-xs transition active:scale-95 cursor-pointer shadow-xs ${
                    isLightMode 
                      ? 'bg-[#f8fafc] hover:bg-[#f1f5f9] text-[#334155] border-[#cbd5e1]' 
                      : 'bg-white/5 hover:bg-white/10 text-slate-200 border-white/10'
                  }`}
                  title="移出所有文件夹，放置于卡库主页"
                >
                  <Home className="w-4 h-4 shrink-0 opacity-70" />
                  <span>主页 (根目录)</span>
                </button>
              </div>
            )}

            {/* Folders List / Hierarchical Tree */}
            {filteredFolders ? (
              filteredFolders.length > 0 ? (
                <div className="space-y-1">
                  {filteredFolders.map(folder => (
                    <div
                      key={folder.id}
                      onClick={() => onMove(folder.id)}
                      className={`group flex items-center justify-between p-2.5 rounded-xl transition cursor-pointer active:scale-[0.99] ${
                        isLightMode 
                          ? 'hover:bg-[#f1f5f9] text-[#0f172a]' 
                          : 'hover:bg-white/8 text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                        <FolderIcon className={`w-4 h-4 shrink-0 stroke-[2] ${
                          isLightMode ? 'text-[#3b82f6]' : 'text-blue-400'
                        }`} />
                        <div className="min-w-0">
                          <div className={`font-medium text-sm truncate ${
                            isLightMode ? 'text-[#0f172a]' : 'text-white'
                          }`}>
                            {folder.name}
                          </div>
                          {folderPathMap[folder.id] && folderPathMap[folder.id] !== folder.name && (
                            <div className={`text-[11px] truncate flex items-center gap-1 mt-0.5 ${
                              isLightMode ? 'text-slate-400' : 'text-white/40'
                            }`}>
                              <span>{folderPathMap[folder.id]}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5 shrink-0">
                        {/* 新建子分类 */}
                        <button
                          type="button"
                          onClick={(e) => handleOpenCreateModal(folder, e)}
                          className={`p-1.5 rounded-lg transition cursor-pointer active:scale-90 ${
                            isLightMode 
                              ? 'text-slate-400 hover:text-[#2563eb] hover:bg-[#eff6ff]' 
                              : 'text-slate-400 hover:text-blue-300 hover:bg-blue-500/15'
                          }`}
                          title={`在「${folder.name}」下新建子分类`}
                        >
                          <Plus className="w-3.5 h-3.5 stroke-[2.2]" />
                        </button>

                        {/* 重命名 */}
                        <button
                          type="button"
                          onClick={(e) => handleOpenRenameModal(folder, e)}
                          className={`p-1.5 rounded-lg transition cursor-pointer active:scale-90 ${
                            isLightMode 
                              ? 'text-slate-400 hover:text-[#0f172a] hover:bg-[#f1f5f9]' 
                              : 'text-slate-400 hover:text-white hover:bg-white/10'
                          }`}
                          title="重命名"
                        >
                          <Edit2 className="w-3.5 h-3.5 stroke-[2]" />
                        </button>

                        {/* 删除 */}
                        <button
                          type="button"
                          onClick={(e) => handleDeleteFolder(folder, e)}
                          className={`p-1.5 rounded-lg transition cursor-pointer active:scale-90 ${
                            isLightMode 
                              ? 'text-slate-400 hover:text-[#dc2626] hover:bg-[#fef2f2]' 
                              : 'text-slate-400 hover:text-red-400 hover:bg-red-500/15'
                          }`}
                          title="删除分类"
                        >
                          <Trash2 className="w-3.5 h-3.5 stroke-[2]" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={`py-12 text-center text-xs ${
                  isLightMode ? 'text-slate-400' : 'text-white/40'
                }`}>
                  未找到匹配的文件夹
                </div>
              )
            ) : folders.length === 0 ? (
              <div className={`py-10 text-center text-xs ${
                isLightMode ? 'text-slate-400' : 'text-white/40'
              }`}>
                暂无分类文件夹，点击上方「新建根分类」即可创建
              </div>
            ) : (
              renderFolderOptions(null, 0)
            )}
          </div>
        </motion.div>

        {/* 统一规范的「新建根文件夹 / 子文件夹」弹窗 */}
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
                {/* Header: Title + Target Context */}
                <div className="flex flex-col items-center text-center mb-5">
                  <h3
                    className={`text-base sm:text-lg font-bold ${
                      isLightMode ? "text-[#0f172a]" : "text-white"
                    }`}
                  >
                    {creatingParentFolder ? '新建子文件夹' : '新建根文件夹'}
                  </h3>
                  
                  {creatingParentFolder ? (
                    <div className={`mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                      isLightMode 
                        ? 'bg-[#eff6ff] text-[#2563eb] border-[#bfdbfe]' 
                        : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                    }`}>
                      <CornerDownRight className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate max-w-[200px]">归属于: {creatingParentFolder.name}</span>
                    </div>
                  ) : (
                    <p
                      className={`text-xs mt-1.5 ${
                        isLightMode ? "text-[#64748b]" : "text-[#94a3b8]"
                      }`}
                    >
                      创建新根分类以便更好地归类整理角色卡
                    </p>
                  )}
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
                    placeholder={creatingParentFolder ? `输入「${creatingParentFolder.name}」的子分类名称...` : "输入文件夹名称..."}
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
                    <span>创建并移动</span>
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* 统一规范的「重命名文件夹」弹窗 */}
        <AnimatePresence>
          {showRenameModal && renamingFolder && (
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
                {/* Header: Title */}
                <div className="flex flex-col items-center text-center mb-5">
                  <h3
                    className={`text-base sm:text-lg font-bold ${
                      isLightMode ? "text-[#0f172a]" : "text-white"
                    }`}
                  >
                    重命名文件夹
                  </h3>
                  <p
                    className={`text-xs mt-1.5 ${
                      isLightMode ? "text-[#64748b]" : "text-[#94a3b8]"
                    }`}
                  >
                    修改「{renamingFolder.name}」的显示名称
                  </p>
                </div>

                {/* Input */}
                <div className="relative mb-5">
                  <div
                    className={`absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none ${
                      isLightMode ? "text-[#94a3b8]" : "text-[#64748b]"
                    }`}
                  >
                    <Edit2 className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    placeholder="输入新的文件夹名称..."
                    className={`w-full pl-10 pr-4 py-2.5 sm:py-3 rounded-2xl text-sm font-medium outline-none transition ${
                      isLightMode
                        ? "bg-[#f8fafc] border border-[#cbd5e1] text-[#0f172a] placeholder:text-[#94a3b8] focus:bg-white focus:border-[#3b82f6] focus:ring-4 focus:ring-blue-500/15"
                        : "bg-white/5 border border-white/10 text-white placeholder:text-[#64748b] focus:bg-white/10 focus:border-blue-500/60 focus:ring-4 focus:ring-blue-500/20"
                    }`}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleRenameFolder();
                      }
                      if (e.key === "Escape") {
                        setShowRenameModal(false);
                      }
                    }}
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowRenameModal(false)}
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
                    onClick={handleRenameFolder}
                    disabled={!renameValue.trim() || renameValue.trim() === renamingFolder.name}
                    className="flex-1 py-2.5 sm:py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:pointer-events-none text-white text-xs sm:text-sm font-semibold transition active:scale-95 cursor-pointer shadow-md shadow-blue-500/25 flex items-center justify-center gap-1.5"
                  >
                    <Check className="w-4 h-4 stroke-[2.2]" />
                    <span>保存</span>
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
