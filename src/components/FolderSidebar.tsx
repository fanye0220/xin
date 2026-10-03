import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Folder as FolderIcon, Plus, Edit2, Trash2, X, ChevronRight, Tag, Settings, Sparkles, MessageSquare, Copy, Trash, Loader2, Moon, Sun, Smartphone, Heart } from 'lucide-react';
import { Folder, getFolders, saveFolder, deleteFolder, getFavoriteCharacterCount } from '../lib/db';
import { initAuth, googleSignIn, logout } from '../lib/drive';
import { useSidebarWallpaper } from '../lib/sidebarWallpaper';

interface Props {
  selectedFolderId: string | null;
  onSelectFolder: (id: string | null) => void;
  onClose: () => void;
  onOpenSettings: (tab?: 'api' | 'st' | 'cloud' | 'wallpaper' | 'about') => void;
  onFolderChanged?: () => void;
}

function GoogleGIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.97 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      />
    </svg>
  );
}

export function FolderSidebar({ selectedFolderId, onSelectFolder, onClose, onOpenSettings, onFolderChanged }: Props) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [favoriteCount, setFavoriteCount] = useState(0);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [creatingParentId, setCreatingParentId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [foldersSectionExpanded, setFoldersSectionExpanded] = useState(() => localStorage.getItem('tavern_sidebarFoldersExpanded') !== 'false');

  // Wallpaper state
  const [wallpaperConfig] = useSidebarWallpaper();
  const isWallpaperActive = wallpaperConfig.enabled && wallpaperConfig.mode !== 'none' && Boolean(wallpaperConfig.url);
  const isFullWallpaper = isWallpaperActive && wallpaperConfig.mode === 'full';

  // Real Google User state
  const [user, setUser] = useState<any>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState(() => !document.documentElement.classList.contains('light-theme'));

  const getMenuItemClass = (isSelected: boolean) => {
    if (isFullWallpaper) {
      if (isDarkTheme) {
        return isSelected
          ? 'bg-white/20 !text-[#ffffff] font-bold backdrop-blur-sm drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]'
          : '!text-[#ffffff] hover:bg-white/10 hover:!text-[#ffffff] drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]';
      } else {
        return isSelected
          ? 'bg-black/10 !text-[#1c1c1e] font-bold backdrop-blur-sm'
          : '!text-[#1c1c1e] hover:bg-black/5';
      }
    }
    return isSelected 
      ? 'bg-slate-800 text-slate-100 font-bold border border-slate-700/60 shadow-sm [.light-theme_&]:!bg-[#f0f1f4] [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:!border-[#cfd9de] [.light-theme_&]:!shadow-2xs' 
      : 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100 [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:hover:!bg-[#f7f9f9] [.light-theme_&]:border [.light-theme_&]:border-transparent';
  };

  useEffect(() => {
    const unsub = initAuth(
      (u) => {
        setUser(u);
      },
      () => {
        setUser(null);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (wallpaperConfig.enabled && wallpaperConfig.url && !wallpaperConfig.topGradient) {
      import('../lib/imageColorExtractor').then(({ extractTopImageColors }) => {
        extractTopImageColors(wallpaperConfig.url).then((colors) => {
          import('../lib/sidebarWallpaper').then(({ saveSidebarWallpaperConfig }) => {
            saveSidebarWallpaperConfig({
              ...wallpaperConfig,
              topColor: colors.topColor,
              topGradient: colors.gradient,
            });
          });
        });
      });
    }
  }, [wallpaperConfig.enabled, wallpaperConfig.url, wallpaperConfig.topGradient]);

  useEffect(() => {
    const updateTheme = () => {
      setIsDarkTheme(!document.documentElement.classList.contains('light-theme'));
    };
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('storage', updateTheme);
    return () => {
      observer.disconnect();
      window.removeEventListener('storage', updateTheme);
    };
  }, []);

  const handleLogin = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsLoggingIn(true);
    try {
      const res = await googleSignIn();
      if (res) setUser(res.user);
    } catch (err: any) {
      console.error('Google login failed:', err);
      alert('登录失败: ' + (err.message || String(err)));
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSwitchAccount = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsLoggingIn(true);
    try {
      await logout();
      setUser(null);
      const res = await googleSignIn();
      if (res) setUser(res.user);
    } catch (err: any) {
      console.error('Switch account failed:', err);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const loadFolders = async () => {
    const data = await getFolders();
    setFolders(data.sort((a, b) => b.createdAt - a.createdAt));
    try {
      const { getFolderItemCounts, getFavoriteCharacterCount } = await import('../lib/db');
      const counts = await getFolderItemCounts(data.map(f => f.id));
      setItemCounts(counts);
      const favCount = await getFavoriteCharacterCount();
      setFavoriteCount(favCount);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadFolders();
  }, []);

  const toggleTheme = () => {
    const html = document.documentElement;
    if (html.classList.contains('light-theme')) {
      html.classList.remove('light-theme');
      localStorage.setItem('tavern_theme', 'dark');
      setIsDarkTheme(true);
    } else {
      html.classList.add('light-theme');
      localStorage.setItem('tavern_theme', 'light');
      setIsDarkTheme(false);
    }
  };

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
                  isFullWallpaper
                    ? (isDarkTheme
                        ? (isSelected
                            ? 'bg-white/20 !text-[#ffffff] font-semibold backdrop-blur-sm drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]'
                            : '!text-[#ffffff] hover:bg-white/10 hover:!text-[#ffffff] drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] border border-transparent')
                        : (isSelected
                            ? 'bg-black/10 !text-[#1c1c1e] font-semibold backdrop-blur-sm'
                            : '!text-[#1c1c1e] hover:bg-black/5 border border-transparent'))
                    : (isSelected
                        ? 'bg-slate-800 text-slate-100 font-semibold border border-slate-700/60 shadow-sm [.light-theme_&]:!bg-[#f0f1f4] [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:!border-[#cfd9de]' 
                        : 'text-slate-300 hover:bg-slate-800/50 hover:text-slate-100 border border-transparent [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:hover:!bg-[#f7f9f9]')
                }`}
              >
                <div className="flex items-center gap-1 flex-1 min-w-0" style={{ paddingLeft: `${depth * 0.75 + 0.5}rem` }}>
                  <button 
                    onClick={(e) => toggleExpand(folder.id, e)}
                    className={`p-1 rounded hover:bg-slate-700/40 [.light-theme_&]:hover:bg-black/5 transition-colors ${hasChildren ? 'opacity-100' : 'opacity-0 cursor-default'}`}
                    disabled={!hasChildren}
                  >
                    <div className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                      <ChevronRight className={`w-3.5 h-3.5 ${isFullWallpaper ? (isDarkTheme ? '!text-[rgba(255,255,255,0.7)]' : '!text-[#1c1c1e]') : 'text-slate-400 [.light-theme_&]:!text-[#1c1c1e]'}`} />
                    </div>
                  </button>
                  
                  <button
                    onClick={() => {
                      onSelectFolder(folder.id);
                      onClose();
                    }}
                    className="flex-1 flex items-center gap-2 text-left truncate"
                  >
                    <FolderIcon className={`w-4 h-4 shrink-0 ${isFullWallpaper ? (isDarkTheme ? '!text-[rgba(255,255,255,0.85)]' : '!text-[#1c1c1e]') : (isSelected ? 'text-slate-100 [.light-theme_&]:!text-[#1c1c1e]' : 'text-slate-400 [.light-theme_&]:!text-[#1c1c1e]')}`} />
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
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-sm w-full focus:outline-none focus:border-blue-500 text-slate-100 [.light-theme_&]:bg-slate-800 [.light-theme_&]:border-slate-700 [.light-theme_&]:!text-slate-100"
                        autoFocus
                      />
                    ) : (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-medium truncate text-sm">{folder.name}</span>
                        {itemCounts[folder.id] !== undefined && itemCounts[folder.id] > 0 && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 border ${
                            isFullWallpaper 
                              ? (isDarkTheme ? '!text-[rgba(255,255,255,0.85)] bg-white/15 border-white/20' : '!text-[#1c1c1e] bg-black/5 border-black/10') 
                              : 'text-slate-400 bg-slate-700/50 border-slate-600/30 [.light-theme_&]:bg-black/5 [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:border-black/10'
                          }`}>
                            {itemCounts[folder.id]}
                          </span>
                        )}
                      </div>
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
                    className={`p-1.5 rounded-lg transition ${isFullWallpaper ? (isDarkTheme ? '!text-[rgba(255,255,255,0.7)] hover:!text-[#ffffff] hover:bg-white/15' : '!text-[#1c1c1e] hover:bg-black/10') : 'text-slate-400 hover:text-slate-100 hover:bg-slate-700/40 [.light-theme_&]:!text-[#1c1c1e]'}`}
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
                    className={`p-1.5 rounded-lg transition ${isFullWallpaper ? (isDarkTheme ? '!text-[rgba(255,255,255,0.7)] hover:!text-[#ffffff] hover:bg-white/15' : '!text-[#1c1c1e] hover:bg-black/10') : 'text-slate-400 hover:text-slate-100 hover:bg-slate-700/40 [.light-theme_&]:!text-[#1c1c1e]'}`}
                    title="重命名"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFolder(folder.id, folder.name);
                    }}
                    className={`p-1.5 rounded-lg transition ${isFullWallpaper ? (isDarkTheme ? '!text-[rgba(255,255,255,0.7)] hover:!text-red-300 hover:bg-white/15' : '!text-[#1c1c1e] hover:!text-red-600 hover:bg-black/10') : 'text-slate-400 hover:text-red-400 hover:bg-slate-700/40 [.light-theme_&]:!text-[#1c1c1e]'}`}
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
            className="flex items-center gap-2 pr-2 py-2 rounded-xl bg-slate-800/60 border border-slate-700/40 w-full"
            style={{ paddingLeft: `${depth * 0.75 + 0.5}rem` }}
          >
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <div className="p-1 w-5 h-5" />
              <FolderIcon className="w-4 h-4 text-slate-400 shrink-0 mx-1" />
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
                className="bg-transparent border-none outline-none text-sm text-slate-100 w-full placeholder:text-slate-500"
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
      className={`fixed top-0 left-0 bottom-0 w-80 max-w-[88vw] border-r flex flex-col z-50 shadow-2xl select-none overflow-hidden ${
        isFullWallpaper 
          ? (isDarkTheme ? 'border-white/10 bg-slate-950 text-white' : 'border-stone-200 bg-[#f8f9fa] text-slate-900') 
          : 'border-slate-700/60 backdrop-blur-2xl bg-slate-900/98 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-[#e5e5ea]'
      }`}
    >
      {/* Full Wallpaper Background Layer with Opacity, Scale & Offset */}
      {isFullWallpaper && (
        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
          <div 
            className="w-full h-full bg-cover bg-center transition-opacity duration-200"
            style={{
              backgroundImage: `url(${wallpaperConfig.url})`,
              opacity: wallpaperConfig.opacity !== undefined ? wallpaperConfig.opacity : 0.85,
              transform: `translate3d(${wallpaperConfig.offsetX ?? 0}%, ${wallpaperConfig.offsetY ?? 0}%, 0) scale(${wallpaperConfig.scale ?? 1})`,
              transformOrigin: 'center center',
            }}
          />
        </div>
      )}

      {/* Full Wallpaper Dimming & Blur Overlay (Only dim in dark theme; never dim in light theme) */}
      {isFullWallpaper && (
        <div 
          className="absolute inset-0 pointer-events-none transition-all duration-300 z-0"
          style={{
            backgroundColor: isDarkTheme 
              ? `rgba(0, 0, 0, ${wallpaperConfig.darkness ?? 0.20})` 
              : 'transparent',
            backdropFilter: (wallpaperConfig.blur ?? 0) > 0 ? `blur(${wallpaperConfig.blur}px)` : undefined,
            WebkitBackdropFilter: (wallpaperConfig.blur ?? 0) > 0 ? `blur(${wallpaperConfig.blur}px)` : undefined,
          }}
        />
      )}

      {/* Top Header / Safe Area */}
      <div className="pt-[max(1.75rem,env(safe-area-inset-top))] sm:pt-[max(1.75rem,env(safe-area-inset-top))] px-4 pb-2 flex items-center justify-between relative z-10 shrink-0">
        <span className={`text-xs font-semibold tracking-wider uppercase ${
          isFullWallpaper 
            ? (isDarkTheme 
                ? '!text-[rgba(255,255,255,0.85)] drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]' 
                : '!text-[#1c1c1e]') 
            : 'text-slate-400 [.light-theme_&]:!text-[#1c1c1e]'
        }`}>MIU PROFILE</span>
        <button 
          onClick={onClose}
          className={`p-1.5 -mr-1 rounded-full transition cursor-pointer ${
            isFullWallpaper 
              ? (isDarkTheme ? '!text-[#ffffff] hover:bg-white/15' : '!text-[#1c1c1e] hover:bg-black/10') 
              : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 [.light-theme_&]:!text-[#1c1c1e]'
          }`}
          title="关闭"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3.5 pb-6 space-y-4 custom-scrollbar relative z-10">
        {/* Google Account Profile Card (Matching image.png exactly in light theme) */}
        {user ? (
          <div 
            className={
              isFullWallpaper
                ? `rounded-2xl p-4 shadow-sm relative overflow-hidden transition-all border ${isDarkTheme ? '!text-[#ffffff]' : '!text-[#1c1c1e]'}`
                : 'bg-slate-800 border border-slate-700/60 rounded-2xl p-4 shadow-sm relative overflow-hidden transition-all [.light-theme_&]:bg-[#f6f7f9] [.light-theme_&]:border-black/[0.04] [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:shadow-none'
            }
            style={
              isFullWallpaper
                ? {
                    backgroundColor: (wallpaperConfig.cardOpacity ?? 0.08) > 0.005
                      ? `rgba(255, 255, 255, ${wallpaperConfig.cardOpacity ?? 0.08})`
                      : 'transparent',
                    borderColor: (wallpaperConfig.cardOpacity ?? 0.08) > 0.01 
                      ? (isDarkTheme 
                          ? `rgba(255, 255, 255, ${Math.min(0.35, (wallpaperConfig.cardOpacity ?? 0.08) * 2 + 0.06)})` 
                          : `rgba(0, 0, 0, ${Math.min(0.15, (wallpaperConfig.cardOpacity ?? 0.08) * 1.5)})`)
                      : 'transparent',
                    borderWidth: (wallpaperConfig.cardOpacity ?? 0.08) > 0.01 ? '1px' : '0px',
                    backdropFilter: (wallpaperConfig.cardOpacity ?? 0.08) > 0.005 
                      ? `blur(${Math.round((wallpaperConfig.cardOpacity ?? 0.08) * 35 + 4)}px)` 
                      : undefined,
                    WebkitBackdropFilter: (wallpaperConfig.cardOpacity ?? 0.08) > 0.005 
                      ? `blur(${Math.round((wallpaperConfig.cardOpacity ?? 0.08) * 35 + 4)}px)` 
                      : undefined,
                  }
                : undefined
            }
          >
            <div className="flex items-center gap-3.5">
              {/* Circular Avatar */}
              <div 
                onClick={() => onOpenSettings('cloud')}
                className={`relative w-14 h-14 rounded-full overflow-hidden bg-slate-700/30 shrink-0 cursor-pointer transition shadow-sm [.light-theme_&]:bg-transparent [.light-theme_&]:ring-0 [.light-theme_&]:border-0 [.light-theme_&]:shadow-none ${
                  isFullWallpaper 
                    ? (isDarkTheme ? 'ring-2 ring-white/40 hover:ring-white/80' : 'ring-2 ring-black/10 hover:ring-black/25') 
                    : 'ring-2 ring-slate-700/60 hover:ring-slate-500/80'
                }`}
                title="Google 账号资料（点击管理）"
              >
                {user.photoURL ? (
                  <img 
                    src={user.photoURL} 
                    alt={user.displayName || 'Google 用户'} 
                    className="w-full h-full object-cover rounded-full" 
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold text-lg select-none [.light-theme_&]:bg-stone-100 [.light-theme_&]:text-stone-700">
                    {(user.displayName || user.email || 'G').charAt(0).toUpperCase()}
                  </div>
                )}
              </div>

              {/* Profile Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1.5">
                  <h3 
                    className={`text-base font-semibold tracking-wide truncate ${isFullWallpaper ? (isDarkTheme ? '!text-[#ffffff] drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]' : '!text-[#1c1c1e]') : 'text-slate-100 [.light-theme_&]:!text-[#1c1c1e]'}`}
                    title={user.displayName || user.email || 'Google 用户'}
                  >
                    {user.displayName || user.email || 'Google 用户'}
                  </h3>

                  {/* Account Switch Badge / Button */}
                  <button
                    onClick={handleSwitchAccount}
                    disabled={isLoggingIn}
                    className={`active:scale-95 text-[11px] px-2.5 py-0.5 rounded-full border transition flex items-center gap-1 shrink-0 font-normal shadow-sm ${
                      isFullWallpaper
                        ? (isDarkTheme ? 'bg-white/20 hover:bg-white/30 !text-[#ffffff] border-white/30' : 'bg-black/5 hover:bg-black/10 !text-[#1c1c1e] border-black/10')
                        : 'bg-slate-700/60 hover:bg-slate-700 text-slate-200 border-slate-600/40 [.light-theme_&]:bg-[#f0f1f4] [.light-theme_&]:hover:bg-stone-200 [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:border-stone-300/80 [.light-theme_&]:shadow-none'
                    }`}
                    title="切换 Google 账号"
                  >
                    {isLoggingIn ? <Loader2 className="w-3 h-3 animate-spin text-slate-400 [.light-theme_&]:!text-[#1c1c1e]" /> : null}
                    <span>切换账号</span>
                  </button>
                </div>

                {/* Google Email Address */}
                <p 
                  className={`text-xs mt-1 truncate font-normal ${isFullWallpaper ? (isDarkTheme ? '!text-[rgba(255,255,255,0.8)] drop-shadow-xs' : '!text-[#3a3a3c]') : 'text-slate-400 [.light-theme_&]:!text-[#3a3a3c]'}`} 
                  title={user.email || ''}
                >
                  {user.email || '已连接 Google 云端硬盘'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* Unlogged in state: Sleek Google Sign-In Card */
          <div 
            onClick={handleLogin}
            className={`rounded-2xl p-4 shadow-sm relative overflow-hidden cursor-pointer group transition-all border ${
              isFullWallpaper
                ? (isDarkTheme ? '!text-[#ffffff]' : '!text-[#1c1c1e]')
                : 'bg-slate-800 border-slate-700/60 hover:border-slate-600/80 [.light-theme_&]:bg-[#f6f7f9] [.light-theme_&]:border-black/[0.04] [.light-theme_&]:hover:border-black/[0.08] [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:shadow-none'
            }`}
            style={
              isFullWallpaper
                ? {
                    backgroundColor: (wallpaperConfig.cardOpacity ?? 0.08) > 0.005
                      ? `rgba(255, 255, 255, ${wallpaperConfig.cardOpacity ?? 0.08})`
                      : 'transparent',
                    borderColor: (wallpaperConfig.cardOpacity ?? 0.08) > 0.01 
                      ? (isDarkTheme 
                          ? `rgba(255, 255, 255, ${Math.min(0.35, (wallpaperConfig.cardOpacity ?? 0.08) * 2 + 0.06)})` 
                          : `rgba(0, 0, 0, ${Math.min(0.15, (wallpaperConfig.cardOpacity ?? 0.08) * 1.5)})`)
                      : 'transparent',
                    borderWidth: (wallpaperConfig.cardOpacity ?? 0.08) > 0.01 ? '1px' : '0px',
                    backdropFilter: (wallpaperConfig.cardOpacity ?? 0.08) > 0.005 
                      ? `blur(${Math.round((wallpaperConfig.cardOpacity ?? 0.08) * 35 + 4)}px)` 
                      : undefined,
                    WebkitBackdropFilter: (wallpaperConfig.cardOpacity ?? 0.08) > 0.005 
                      ? `blur(${Math.round((wallpaperConfig.cardOpacity ?? 0.08) * 35 + 4)}px)` 
                      : undefined,
                  }
                : undefined
            }
          >
            <div className="flex items-center gap-3.5">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 transition shadow-sm ${
                isFullWallpaper
                  ? (isDarkTheme ? 'bg-white/20 border border-white/30' : 'bg-stone-100 border border-black/10')
                  : 'bg-slate-700/40 border border-slate-700/60 group-hover:bg-slate-700/70 [.light-theme_&]:bg-stone-100 [.light-theme_&]:border-0 [.light-theme_&]:ring-0 [.light-theme_&]:shadow-none'
              }`}>
                <GoogleGIcon className="w-7 h-7" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1.5">
                  <h3 className={`text-base font-semibold tracking-wide truncate ${isFullWallpaper ? (isDarkTheme ? '!text-[#ffffff] drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]' : '!text-[#1c1c1e]') : 'text-slate-100 [.light-theme_&]:!text-[#1c1c1e]'}`}>
                    登录 Google 账号
                  </h3>

                  <button
                    onClick={handleLogin}
                    disabled={isLoggingIn}
                    className={`active:scale-95 text-[11px] px-2.5 py-0.5 rounded-full border transition flex items-center gap-1 shrink-0 font-medium shadow-sm ${
                      isFullWallpaper
                        ? (isDarkTheme ? 'bg-white/20 hover:bg-white/30 !text-[#ffffff] border-white/30' : 'bg-black/5 hover:bg-black/10 !text-[#1c1c1e] border-black/10')
                        : 'bg-slate-700/60 group-hover:bg-slate-700 text-slate-100 border-slate-600/40 [.light-theme_&]:bg-[#f0f1f4] [.light-theme_&]:group-hover:bg-stone-200 [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:border-stone-300/80 [.light-theme_&]:shadow-none'
                    }`}
                  >
                    {isLoggingIn ? <Loader2 className="w-3 h-3 animate-spin text-slate-400 [.light-theme_&]:!text-[#1c1c1e]" /> : null}
                    <span>{isLoggingIn ? '登录中...' : '点击登录'}</span>
                  </button>
                </div>

                <p className={`text-xs mt-1 leading-tight font-normal ${isFullWallpaper ? (isDarkTheme ? '!text-[rgba(255,255,255,0.8)] drop-shadow-xs' : '!text-[#3a3a3c]') : 'text-slate-400 [.light-theme_&]:!text-[#3a3a3c]'}`}>
                  连接云端备份与角色数据同步
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Primary Menu Rows */}
        <div className="space-y-0.5">
          {/* 我的收藏 (有收藏角色或当前处于收藏夹时自动展示) */}
          {(favoriteCount > 0 || selectedFolderId === 'favorites') && (
            <button
              onClick={() => {
                onSelectFolder('favorites');
                onClose();
              }}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition active:scale-[0.98] cursor-pointer ${getMenuItemClass(selectedFolderId === 'favorites')}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Heart className="w-4.5 h-4.5 text-current stroke-[1.7] shrink-0" />
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="sidebar-menu-text text-sm font-medium truncate">我的收藏</span>
                  {favoriteCount > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 border ${
                      isFullWallpaper 
                        ? (isDarkTheme ? '!text-[rgba(255,255,255,0.85)] bg-white/15 border-white/20' : '!text-[#1c1c1e] bg-black/5 border-black/10') 
                        : 'text-slate-400 bg-slate-700/50 border-slate-600/30 [.light-theme_&]:bg-black/5 [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:border-black/10'
                    }`}>
                      {favoriteCount}
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight className={`w-4 h-4 shrink-0 ${isFullWallpaper ? (isDarkTheme ? '!text-[rgba(255,255,255,0.65)]' : '!text-[#1c1c1e]') : 'text-slate-400 [.light-theme_&]:!text-[#1c1c1e]'}`} />
            </button>
          )}

          {/* 聊天记录 */}
          <button
            onClick={() => {
              onSelectFolder('chatviewer');
              onClose();
            }}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition active:scale-[0.98] cursor-pointer ${getMenuItemClass(selectedFolderId === 'chatviewer')}`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <MessageSquare className="w-4.5 h-4.5 text-current stroke-[1.7] shrink-0" />
              <span className="sidebar-menu-text text-sm font-medium truncate">聊天记录</span>
            </div>
            <ChevronRight className={`w-4 h-4 shrink-0 ${isFullWallpaper ? (isDarkTheme ? '!text-[rgba(255,255,255,0.65)]' : '!text-[#1c1c1e]') : 'text-slate-400 [.light-theme_&]:!text-[#1c1c1e]'}`} />
          </button>

          {/* 自动打标 */}
          <button
            onClick={() => {
              onSelectFolder('autotagger');
              onClose();
            }}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition active:scale-[0.98] cursor-pointer ${getMenuItemClass(selectedFolderId === 'autotagger')}`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Tag className="w-4.5 h-4.5 text-current stroke-[1.7] shrink-0" />
              <span className="sidebar-menu-text text-sm font-medium truncate">自动打标</span>
            </div>
            <ChevronRight className={`w-4 h-4 shrink-0 ${isFullWallpaper ? (isDarkTheme ? '!text-[rgba(255,255,255,0.65)]' : '!text-[#1c1c1e]') : 'text-slate-400 [.light-theme_&]:!text-[#1c1c1e]'}`} />
          </button>

          {/* AI 智能推荐 */}
          <button
            onClick={() => {
              onSelectFolder('recommender');
              onClose();
            }}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition active:scale-[0.98] cursor-pointer ${getMenuItemClass(selectedFolderId === 'recommender')}`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Sparkles className="w-4.5 h-4.5 text-current stroke-[1.7] shrink-0" />
              <span className="sidebar-menu-text text-sm font-medium truncate">智能推荐</span>
            </div>
            <ChevronRight className={`w-4 h-4 shrink-0 ${isFullWallpaper ? (isDarkTheme ? '!text-[rgba(255,255,255,0.65)]' : '!text-[#1c1c1e]') : 'text-slate-400 [.light-theme_&]:!text-[#1c1c1e]'}`} />
          </button>

          {/* 重复卡检测 */}
          <button
            onClick={() => {
              onSelectFolder('duplicates');
              onClose();
            }}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition active:scale-[0.98] cursor-pointer ${getMenuItemClass(selectedFolderId === 'duplicates')}`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Copy className="w-4.5 h-4.5 text-current stroke-[1.7] shrink-0" />
              <span className="sidebar-menu-text text-sm font-medium truncate">重复卡检测</span>
            </div>
            <ChevronRight className={`w-4 h-4 shrink-0 ${isFullWallpaper ? (isDarkTheme ? '!text-[rgba(255,255,255,0.65)]' : '!text-[#1c1c1e]') : 'text-slate-400 [.light-theme_&]:!text-[#1c1c1e]'}`} />
          </button>

          {/* 回收站 */}
          <button
            onClick={() => {
              onSelectFolder('trash');
              onClose();
            }}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition active:scale-[0.98] cursor-pointer ${getMenuItemClass(selectedFolderId === 'trash')}`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Trash className="w-4.5 h-4.5 text-current stroke-[1.7] shrink-0" />
              <span className="sidebar-menu-text text-sm font-medium truncate">回收站</span>
            </div>
            <ChevronRight className={`w-4 h-4 shrink-0 ${isFullWallpaper ? (isDarkTheme ? '!text-[rgba(255,255,255,0.65)]' : '!text-[#1c1c1e]') : 'text-slate-400 [.light-theme_&]:!text-[#1c1c1e]'}`} />
          </button>
        </div>

        {/* Folders Section */}
        <div className={`pt-2 ${isFullWallpaper ? '' : 'border-t border-slate-700/60'}`}>
          <div 
            className={`flex items-center justify-between px-3.5 py-2.5 cursor-pointer group rounded-xl transition ${
              isFullWallpaper 
                ? (isDarkTheme ? 'hover:bg-white/10 !text-[#ffffff]' : 'hover:bg-black/5 !text-[#1c1c1e]') 
                : 'hover:bg-slate-800/60 [.light-theme_&]:hover:bg-black/5'
            }`}
            onClick={() => {
              const current = localStorage.getItem('tavern_sidebarFoldersExpanded') !== 'false';
              localStorage.setItem('tavern_sidebarFoldersExpanded', (!current).toString());
              setFoldersSectionExpanded(!current);
            }}
          >
            <div className={`flex items-center gap-3 min-w-0 transition ${
              isFullWallpaper 
                ? (isDarkTheme ? '!text-[#ffffff] drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]' : '!text-[#1c1c1e]') 
                : 'text-slate-300 group-hover:text-slate-100 [.light-theme_&]:!text-[#1c1c1e]'
            }`}>
              <div className={`transition-transform duration-200 shrink-0 ${foldersSectionExpanded ? 'rotate-90' : ''}`}>
                <ChevronRight className={`w-4 h-4 ${isFullWallpaper ? (isDarkTheme ? '!text-[rgba(255,255,255,0.7)]' : '!text-[#1c1c1e]') : 'text-slate-400 [.light-theme_&]:!text-[#1c1c1e]'}`} />
              </div>
              <FolderIcon className={`w-4.5 h-4.5 stroke-[1.7] shrink-0 ${isFullWallpaper ? (isDarkTheme ? '!text-[rgba(255,255,255,0.85)]' : '!text-[#1c1c1e]') : 'text-slate-400 [.light-theme_&]:!text-[#1c1c1e]'}`} />
              <h2 className="sidebar-category-text text-sm font-medium truncate">文件夹分类</h2>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setCreatingParentId(null);
                setIsCreating(true);
                setEditName('');
                setFoldersSectionExpanded(true);
              }}
              className={`p-1 rounded transition shrink-0 ${
                isFullWallpaper 
                  ? (isDarkTheme ? '!text-[rgba(255,255,255,0.85)] hover:!text-[#ffffff] hover:bg-white/20' : '!text-[#1c1c1e] hover:bg-black/10') 
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-700/50 [.light-theme_&]:!text-[#1c1c1e]'
              }`}
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
                className="overflow-hidden mt-1 px-1"
              >
                {renderFolderTree()}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Bottom Area: Settings and Theme Toggle */}
      <div 
        className="p-3 space-y-0.5 relative z-10 transition-colors"
        style={
          isFullWallpaper
            ? {
                backgroundColor: (wallpaperConfig.bottomOpacity ?? 0.08) > 0.005
                  ? `rgba(255, 255, 255, ${wallpaperConfig.bottomOpacity ?? 0.08})`
                  : 'transparent',
                borderColor: (wallpaperConfig.bottomOpacity ?? 0.08) > 0.01 
                  ? (isDarkTheme 
                      ? `rgba(255, 255, 255, ${Math.min(0.35, (wallpaperConfig.bottomOpacity ?? 0.08) * 2 + 0.06)})` 
                      : `rgba(0, 0, 0, ${Math.min(0.15, (wallpaperConfig.bottomOpacity ?? 0.08) * 1.5)})`)
                  : 'transparent',
                borderTopWidth: (wallpaperConfig.bottomOpacity ?? 0.08) > 0.01 ? '1px' : '0px',
                backdropFilter: (wallpaperConfig.bottomOpacity ?? 0.08) > 0.005 
                  ? `blur(${Math.round((wallpaperConfig.bottomOpacity ?? 0.08) * 35 + 4)}px)` 
                  : undefined,
                WebkitBackdropFilter: (wallpaperConfig.bottomOpacity ?? 0.08) > 0.005 
                  ? `blur(${Math.round((wallpaperConfig.bottomOpacity ?? 0.08) * 35 + 4)}px)` 
                  : undefined,
              }
            : undefined
        }
      >
        <button
          onClick={() => {
            onOpenSettings();
            onClose();
          }}
          className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition cursor-pointer ${
            isFullWallpaper
              ? (isDarkTheme ? '!text-[#ffffff] hover:bg-white/10 hover:!text-[#ffffff] drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]' : '!text-[#1c1c1e] hover:bg-black/5')
              : 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100 [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:hover:!bg-black/5'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <Settings className={`w-4.5 h-4.5 stroke-[1.7] shrink-0 ${isFullWallpaper ? (isDarkTheme ? '!text-[rgba(255,255,255,0.85)]' : '!text-[#1c1c1e]') : 'text-slate-400 [.light-theme_&]:!text-[#1c1c1e]'}`} />
            <span className="sidebar-setting-text text-sm font-medium truncate">设置</span>
          </div>
          <ChevronRight className={`w-4 h-4 shrink-0 ${isFullWallpaper ? (isDarkTheme ? '!text-[rgba(255,255,255,0.6)]' : '!text-[#1c1c1e]') : 'text-slate-400 [.light-theme_&]:!text-[#1c1c1e]'}`} />
        </button>

        <button
          onClick={toggleTheme}
          className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl transition cursor-pointer ${
            isFullWallpaper
              ? (isDarkTheme ? '!text-[#ffffff] hover:bg-white/10 hover:!text-[#ffffff] drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]' : '!text-[#1c1c1e] hover:bg-black/5')
              : 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100 [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:hover:!bg-black/5'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            {isDarkTheme ? (
              <Moon className="w-4.5 h-4.5 stroke-[1.7] shrink-0 !text-white" />
            ) : (
              <Sun className="w-4.5 h-4.5 stroke-[1.7] shrink-0 !text-[#1c1c1e]" />
            )}
            <span className="sidebar-theme-text text-sm font-medium truncate">{isDarkTheme ? '深色夜间模式' : '明亮浅色模式'}</span>
          </div>
          <span className={`text-[11px] px-2 py-0.5 rounded-full border font-normal shrink-0 ${
            isFullWallpaper
              ? (isDarkTheme ? '!text-[rgba(255,255,255,0.9)] bg-white/15 border-white/20' : '!text-[#1c1c1e] bg-black/5 border-black/10')
              : 'text-slate-400 bg-slate-800/80 border-slate-700/60 [.light-theme_&]:!bg-black/5 [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:!border-black/10'
          }`}>
            点击切换
          </span>
        </button>
      </div>
    </motion.div>
  );
}