import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Folder as FolderIcon, Plus, MoreVertical, Edit2, Trash2, Home, X, Check, Copy, Trash, ChevronRight, Tag, Settings, Sparkles, MessageSquare } from 'lucide-react';
import { Folder, getFolders, saveFolder, deleteFolder } from '../lib/db';

interface Props {
  selectedFolderId: string | null;
  onSelectFolder: (id: string | null) => void;
  onClose: () => void;
  onOpenSettings: () => void;
  onFolderChanged?: () => void;
}

export function FolderSidebar({ selectedFolderId, onSelectFolder, onClose, onOpenSettings, onFolderChanged }: Props) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [creatingParentId, setCreatingParentId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [foldersSectionExpanded, setFoldersSectionExpanded] = useState(() => localStorage.getItem('tavern_sidebarFoldersExpanded') !== 'false');

  const loadFolders = async () => {
    const data = await getFolders();
    setFolders(data.sort((a, b) => b.createdAt - a.createdAt));
  };

  useEffect(() => {
    loadFolders();
  }, []);

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateFolder = async () => {
    if (!editName.trim()) {
      setIsCreating(false);
      setCreatingParentId(null);
      return;
    }
    const newFolder: Folder = {
      id: crypto.randomUUID(),
      name: editName.trim(),
      createdAt: Date.now(),
      parentId: creatingParentId
    };
    await saveFolder(newFolder);
    setEditName('');
    setIsCreating(false);
    setCreatingParentId(null);
    if (creatingParentId) {
      setExpandedFolders(prev => new Set(prev).add(creatingParentId));
    }
    loadFolders();
    onFolderChanged?.();
  };

  const handleUpdateFolder = async (folder: Folder) => {
    if (!editName.trim()) {
      setEditingFolderId(null);
      return;
    }
    await saveFolder({ ...folder, name: editName.trim() });
    setEditingFolderId(null);
    setEditName('');
    loadFolders();
    onFolderChanged?.();
  };

  const handleDeleteFolder = async (id: string, name: string) => {
    if (confirm(`确定要删除文件夹 "${name}" 吗？\n文件夹将被直接删除，其内的所有角色都将被移至回收站。`)) {
      await deleteFolder(id);
      if (selectedFolderId === id) {
        onSelectFolder(null);
      }
      loadFolders();
      onFolderChanged?.();
    }
  };

  const renderFolderTree = (parentId: string | null = null, depth = 0) => {
    const childFolders = folders.filter(f => (f.parentId || null) === parentId);
    if (childFolders.length === 0 && !isCreating) return null;

    return (
      <div className="space-y-1">
        {childFolders.map((folder) => {
          const isSelected = selectedFolderId === folder.id;
          const isExpanded = expandedFolders.has(folder.id);
          const hasChildren = folders.some(f => f.parentId === folder.id);

          return (
            <div key={folder.id} className="relative group flex flex-col">
              <div 
                className={`flex items-center justify-between pr-2 py-2 rounded-xl transition-all w-full ${
                  isSelected
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' 
                    : 'text-white/80 hover:bg-white/5 hover:text-white border border-transparent'
                }`}
              >
                <div className="flex items-center gap-1 flex-1 min-w-0" style={{ paddingLeft: '0.5rem' }}>
                  <button 
                    onClick={(e) => toggleExpand(folder.id, e)}
                    className={`p-1 rounded hover:bg-white/10 transition-colors ${hasChildren ? 'opacity-100' : 'opacity-0 cursor-default'}`}
                    disabled={!hasChildren}
                  >
                    <div className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                      <ChevronRight className="w-4 h-4 text-white/50" />
                    </div>
                  </button>
                  
                  <button
                    onClick={() => {
                      onSelectFolder(folder.id);
                      onClose();
                    }}
                    className="flex-1 flex items-center gap-2 text-left truncate"
                  >
                    <FolderIcon className={`w-4 h-4 shrink-0 ${isSelected ? 'text-blue-400' : 'text-white/50'}`} />
                    {editingFolderId === folder.id ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onBlur={() => handleUpdateFolder(folder)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleUpdateFolder(folder);
                          if (e.key === 'Escape') setEditingFolderId(null);
                        }}
                        onClick={e => e.stopPropagation()}
                        className="bg-black/50 border border-blue-500/50 rounded px-2 py-0.5 text-sm w-full focus:outline-none focus:border-blue-400"
                        autoFocus
                      />
                    ) : (
                      <span className="font-medium truncate text-sm">{folder.name}</span>
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setCreatingParentId(folder.id);
                      setIsCreating(true);
                      setEditName('');
                      setExpandedFolders(prev => new Set(prev).add(folder.id));
                    }}
                    className="p-1.5 text-white/40 hover:text-green-400 hover:bg-white/10 rounded-lg transition"
                    title="新建子文件夹"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingFolderId(folder.id);
                      setEditName(folder.name);
                    }}
                    className="p-1.5 text-white/40 hover:text-blue-400 hover:bg-white/10 rounded-lg transition"
                    title="重命名"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFolder(folder.id, folder.name);
                    }}
                    className="p-1.5 text-white/40 hover:text-red-400 hover:bg-white/10 rounded-lg transition"
                    title="删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              
              {isExpanded && (
                <div className="mt-1">
                  {renderFolderTree(folder.id, depth + 1)}
                </div>
              )}
            </div>
          );
        })}
        
        {isCreating && creatingParentId === parentId && (
          <div 
            className="flex items-center gap-2 pr-2 py-2 rounded-xl bg-white/5 w-full"
          >
            <div className="flex items-center gap-1 flex-1 min-w-0" style={{ paddingLeft: '0.5rem' }}>
              <div className="p-1 w-6 h-6" /> {/* Spacer for chevron */}
              <FolderIcon className="w-4 h-4 text-white/50 shrink-0 mx-1" />
              <input
                type="text"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onBlur={handleCreateFolder}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') {
                    setIsCreating(false);
                    setCreatingParentId(null);
                  }
                }}
                placeholder="新文件夹名称..."
                className="bg-transparent border-none outline-none text-sm text-white w-full"
                autoFocus
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <motion.div
      initial={{ x: '-100%' }}
      animate={{ x: 0 }}
      exit={{ x: '-100%' }}
      transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
      className="fixed top-0 left-0 bottom-0 w-72 bg-slate-900/95 border-r border-white/10 flex flex-col backdrop-blur-xl z-50 shadow-2xl"
    >
      <div className="pt-[max(1.75rem,env(safe-area-inset-top))] pb-6 px-6 flex items-center justify-between border-b border-white/5">
        <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
          文件夹管理
        </h1>
        <button 
          onClick={onClose}
          className="p-2 -mr-2 rounded-full hover:bg-white/10 transition text-white/60 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Tools Section */}
        <div>
          <div className="flex items-center justify-between px-4 mb-2">
            <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider">工具</h2>
          </div>
          <div className="space-y-1">
            <button
              onClick={() => {
                onSelectFolder('autotagger');
                onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${selectedFolderId === 'autotagger' ? 'bg-blue-500/20 text-blue-400 font-medium' : 'text-white/70 hover:bg-white/5 hover:text-white'}`}
            >
              <Tag className="w-5 h-5" />
              <span>自动打标</span>
            </button>
            <button
              onClick={() => {
                onSelectFolder('recommender');
                onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${selectedFolderId === 'recommender' ? 'bg-emerald-500/20 text-emerald-400 font-medium' : 'text-white/70 hover:bg-white/5 hover:text-white'}`}
            >
              <Sparkles className="w-5 h-5" />
              <span>AI 智能推荐</span>
            </button>
            <button
              onClick={() => {
                onSelectFolder('duplicates');
                onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${selectedFolderId === 'duplicates' ? 'bg-purple-500/20 text-purple-400 font-medium' : 'text-white/70 hover:bg-white/5 hover:text-white'}`}
            >
              <Copy className="w-5 h-5" />
              <span>重复卡检测</span>
            </button>
            <button
              onClick={() => {
                onSelectFolder('chatviewer');
                onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${selectedFolderId === 'chatviewer' ? 'bg-cyan-500/20 text-cyan-400 font-medium' : 'text-white/70 hover:bg-white/5 hover:text-white'}`}
            >
              <MessageSquare className="w-5 h-5" />
              <span>查看聊天记录</span>
            </button>
            <button
              onClick={() => {
                onSelectFolder('trash');
                onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition ${selectedFolderId === 'trash' ? 'bg-red-500/20 text-red-400 font-medium' : 'text-white/70 hover:bg-white/5 hover:text-white'}`}
            >
              <Trash className="w-5 h-5" />
              <span>回收站</span>
            </button>
            <button
              onClick={() => {
                onOpenSettings();
                onClose();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition text-white/70 hover:bg-white/5 hover:text-white"
            >
              <Settings className="w-5 h-5" />
              <span>API 设置</span>
            </button>
            <button
              onClick={() => {
                const html = document.documentElement;
                if (html.classList.contains('light-theme')) {
                  html.classList.remove('light-theme');
                  localStorage.setItem('tavern_theme', 'dark');
                } else {
                  html.classList.add('light-theme');
                  localStorage.setItem('tavern_theme', 'light');
                }
              }}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition text-white/70 hover:bg-white/5 hover:text-white"
            >
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>
                <span>明/暗主题</span>
              </div>
            </button>
          </div>
        </div>

        {/* Folders Section */}
        <div>
          <div 
            className="flex items-center justify-between px-4 mb-2 cursor-pointer group"
            onClick={() => {
              const current = localStorage.getItem('tavern_sidebarFoldersExpanded') !== 'false';
              localStorage.setItem('tavern_sidebarFoldersExpanded', (!current).toString());
              // We need to trigger a re-render. Since we are inside the component we should use state.
              setFoldersSectionExpanded(!current);
            }}
          >
            <div className="flex items-center gap-1 group-hover:text-white transition text-white/40">
              <div className={`transition-transform ${foldersSectionExpanded ? 'rotate-90' : ''}`}>
                <ChevronRight className="w-4 h-4" />
              </div>
              <h2 className="text-xs font-semibold uppercase tracking-wider">文件夹</h2>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setCreatingParentId(null);
                setIsCreating(true);
                setEditName('');
                setFoldersSectionExpanded(true);
              }}
              className="p-1 text-white/40 hover:text-white hover:bg-white/10 rounded transition"
              title="新建根文件夹"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <AnimatePresence>
            {foldersSectionExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden space-y-1"
              >
                {renderFolderTree()}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}