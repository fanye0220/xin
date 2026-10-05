import { useState, useEffect, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { Cloud, Download, Upload, Trash2, Github, Loader2, Search, Folder, ChevronRight, MessageSquare, FileText, FolderSync, Copy, CheckCircle2 } from 'lucide-react';
import { listCloudCharacters, deleteCloudCharacter, syncFolderStructureToCloud } from '../lib/cloudDrive';
import { getCardBadgeInfo } from '../lib/cardBadge';
import { normalizeCardBaseName } from '../lib/db';
import { initAuth, googleSignIn, logout, getAccessToken, listBackupsFromDrive, deleteBackupFromDrive, triggerManualBackup, triggerRestore, onSyncStateChange, SyncState, getStoredUserInfo, ensureValidAccessToken } from '../lib/drive';

const formatCloudName = (name: string) => name.replace(/_[a-f0-9-]{36}$/i, "");

export function CloudSyncTab({ isLightMode: propIsLightMode }: { isLightMode?: boolean } = {}) {
  const [detectedLightMode, setDetectedLightMode] = useState(() => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('light-theme') || localStorage.getItem('tavern_theme') === 'light';
  });

  useEffect(() => {
    const check = () => {
      setDetectedLightMode(document.documentElement.classList.contains('light-theme') || localStorage.getItem('tavern_theme') === 'light');
    };
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('storage', check);
    return () => {
      obs.disconnect();
      window.removeEventListener('storage', check);
    };
  }, []);

  const isLight = propIsLightMode !== undefined ? propIsLightMode : detectedLightMode;

  const initialUser = getStoredUserInfo();
  const [user, setUser] = useState<any>(initialUser);
  const [needsAuth, setNeedsAuth] = useState(!initialUser);
  const [token, setToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const getActiveToken = async (): Promise<string | null> => {
    let t = token || await ensureValidAccessToken();
    if (!t && user) {
      try {
        const res = await googleSignIn();
        if (res) {
          setToken(res.accessToken);
          setUser(res.user);
          return res.accessToken;
        }
      } catch (e) {
        console.error("[CloudSync] Automatic token refresh info:", e);
      }
    }
    return t;
  };
  
  const [backups, setBackups] = useState<any[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  
  const [actionFileId, setActionFileId] = useState<string | null>(null);
  const [syncInfo, setSyncInfo] = useState<SyncState>({ isActive: false, taskName: '', message: '', isError: false, completed: false });

    const [activeTab, setActiveTab] = useState<'backup' | 'cloud_drive'>('backup');
  const [cloudChars, setCloudChars] = useState<any[]>([]);
  const [isLoadingCloud, setIsLoadingCloud] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [searchCloudQuery, setSearchCloudQuery] = useState("");
  const [currentCloudPath, setCurrentCloudPath] = useState<string>("");
  const [isDuplicateMode, setIsDuplicateMode] = useState(false);

  const cloudDuplicateGroups = useMemo(() => {
    const map = new Map<string, any[]>();
    cloudChars.forEach(char => {
      const isChat = char.appProperties?.isChat === 'true';
      const baseCharName = char.appProperties?.charName || char.name?.replace(/\.(zip|png|json|webp|jpg)$/i, '') || '';
      const charName = isChat ? (char.name?.replace(/\.(jsonl|json)$/i, '') || baseCharName) : baseCharName;
      const cleanName = normalizeCardBaseName(charName);
      if (!cleanName) return;
      const key = cleanName.toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(char);
    });

    const groups: { key: string; name: string; chars: any[] }[] = [];
    map.forEach((chars, key) => {
      if (chars.length > 1) {
        const sorted = [...chars].sort((a, b) => {
          const timeA = a.createdTime ? new Date(a.createdTime).getTime() : 0;
          const timeB = b.createdTime ? new Date(b.createdTime).getTime() : 0;
          return timeB - timeA;
        });
        const displayName = normalizeCardBaseName(sorted[0].appProperties?.charName || sorted[0].name || '') || sorted[0].name?.replace(/_[a-f0-9-]{36}$/i, '').replace(/\.(zip|png|json|webp|jpg|jsonl)$/i, '') || key;
        groups.push({ key, name: displayName, chars: sorted });
      }
    });

    if (searchCloudQuery.trim()) {
      const q = searchCloudQuery.trim().toLowerCase();
      return groups.filter(g => g.name.toLowerCase().includes(q));
    }

    return groups.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }, [cloudChars, searchCloudQuery]);

  const totalDuplicateCards = useMemo(() => {
    return cloudDuplicateGroups.reduce((acc, g) => acc + g.chars.length, 0);
  }, [cloudDuplicateGroups]);

  const cloudFolders = useMemo(() => {
    if (searchCloudQuery) return [];
    const folders = new Set<string>();
    cloudChars.forEach(char => {
      const charPath = char.appProperties?.folderPath || "";
      if (charPath.startsWith(currentCloudPath ? currentCloudPath + '/' : '') && charPath !== currentCloudPath) {
        const remaining = charPath.substring(currentCloudPath ? currentCloudPath.length + 1 : 0);
        const nextSegment = remaining.split('/')[0];
        if (nextSegment) {
          folders.add(nextSegment);
        }
      }
    });
    return Array.from(folders).sort();
  }, [cloudChars, currentCloudPath, searchCloudQuery]);

  const filteredCloudChars = useMemo(() => {
    return cloudChars.filter(char => {
      if (searchCloudQuery) {
        const charName = char.appProperties?.charName || char.name?.replace(/\.(zip|png|json|webp|jpg)$/i, '') || '';
        return charName.toLowerCase().includes(searchCloudQuery.toLowerCase());
      }
      const charPath = char.appProperties?.folderPath || "";
      return charPath === currentCloudPath;
    });
  }, [cloudChars, searchCloudQuery, currentCloudPath]);


  const loadCloudChars = async (t: string) => {
    setIsLoadingCloud(true);
    try {
        const list = await listCloudCharacters(t);
        setCloudChars(list);
    } catch (err: any) {
        console.error('List cloud chars failed:', err);
    } finally {
        setIsLoadingCloud(false);
    }
  };

  useEffect(() => {
    if (token && activeTab === 'cloud_drive') {
        loadCloudChars(token);
    }
  }, [token, activeTab]);

  
  const handleRestoreCloudFileToApp = async (
    fileId: string,
    rawFileName: string,
    displayCharName: string,
    isChatFile: boolean = false,
    cloudFolderPath?: string
  ) => {
    if (!token) return;
    setDownloadingId(fileId);
    try {
      const { downloadCloudCharacter, resolveAppFolderFromCloudPath } = await import('../lib/cloudDrive');
      const { saveCharacter, saveChat, invalidateCache } = await import('../lib/db');
      
      const res = await downloadCloudCharacter(token, fileId, rawFileName);
      const { jsonData, avatarBlob, studioMeta, avatarHistory, chats, versionHistory, memos } = res;

      const targetData = jsonData?.data ? jsonData.data : jsonData;
      const name = displayCharName || targetData?.name || targetData?.char_name || targetData?.character_name || rawFileName.replace(/\.[^/.]+$/, "") || "未命名角色";

      // 自动从云端 folderPath 路径解析出 App 本地真正的目标用户文件夹 (自动剥离"角色卡"、"工具区"、"聊天记录"等系统大类，并兼容同名卡自动跟随分类)
      const folderPathStr = studioMeta?.folderPath || cloudFolderPath || null;
      const targetFolderId = await resolveAppFolderFromCloudPath(folderPathStr, name);
      
      const charId = crypto.randomUUID();
      const newChar: any = {
        id: charId,
        name,
        folderId: targetFolderId,
        data: jsonData || { name, description: '' },
        avatarBlob: avatarBlob || undefined,
        avatarHistory: avatarHistory && avatarHistory.length > 0 ? avatarHistory : undefined,
        versionHistory: versionHistory && versionHistory.length > 0 ? versionHistory : undefined,
        createdAt: studioMeta?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };

      await saveCharacter(newChar);

      if (chats && chats.length > 0) {
        for (const chat of chats) {
          await saveChat({
            ...chat,
            id: chat.id || crypto.randomUUID(),
            characterId: charId,
          });
        }
      }

      if (memos && memos.length > 0) {
        const { saveMemo } = await import('../lib/db');
        for (const memo of memos) {
          await saveMemo({
            ...memo,
            id: memo.id || crypto.randomUUID(),
            characterId: charId,
          });
        }
      }

      invalidateCache();
      const extraCountNotice = [
        chats && chats.length > 0 ? `${chats.length} 条对话` : null,
        memos && memos.length > 0 ? `${memos.length} 条备忘录/剧场` : null,
      ].filter(Boolean).join('、');
      alert(`🎉 成功将「${name}」复原/导入回 App 中！${extraCountNotice ? `\n(已同步恢复: ${extraCountNotice})` : ''}`);
    } catch (err: any) {
      console.error("恢复导入至 App 失败:", err);
      alert("恢复导入至 App 失败: " + (err.message || String(err)));
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDeleteCloudChar = async (fileId: string, name: string) => {
      if (!token) return;
      if (!window.confirm(`确定要从云盘彻底删除「${name}」吗？`)) return;
      try {
          await deleteCloudCharacter(token, fileId);
          setCloudChars(prev => prev.filter(c => c.id !== fileId));
      } catch (err: any) {
          alert("删除失败: " + err.message);
      }
  };

  useEffect(() => {
    const unsubDrive = initAuth(
      (u, t) => {
        setUser(u);
        setNeedsAuth(false);
        if (t) {
          setToken(t);
          loadBackups(t);
        } else {
          ensureValidAccessToken().then(vt => {
            if (vt) {
              setToken(vt);
              loadBackups(vt);
            }
          });
        }
      },
      () => {
        const cachedUser = getStoredUserInfo();
        if (cachedUser) {
          setUser(cachedUser);
          setNeedsAuth(false);
        } else {
          setNeedsAuth(true);
          setUser(null);
          setToken(null);
          setBackups([]);
        }
      }
    );
    const unsubSync = onSyncStateChange(setSyncInfo);
    return () => {
      unsubDrive();
      unsubSync();
    };
  }, []);

  useEffect(() => {
    // Refresh backups list when manual backup completes successfully
    if (syncInfo.completed && syncInfo.taskName === '手动备份') {
      if (token) loadBackups(token);
    }
  }, [syncInfo.completed, syncInfo.taskName, token]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setToken(result.accessToken);
        setUser(result.user);
        setNeedsAuth(false);
        loadBackups(result.accessToken);
      }
    } catch (err: any) {
      console.error('Login failed:', err);
      alert('登录失败: ' + err.message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
  };

  const loadBackups = async (t: string) => {
    setIsLoadingBackups(true);
    try {
      const list = await listBackupsFromDrive(t);
      setBackups(list);
    } catch (err: any) {
      console.error('List backups failed:', err);
    } finally {
      setIsLoadingBackups(false);
    }
  };


  const [isAutoBackup, setIsAutoBackup] = useState(() => {
    const oldValue = localStorage.getItem('auto_backup_enabled');
    if (oldValue === 'true') {
      localStorage.setItem('miu_auto_backup', '1');
      localStorage.removeItem('auto_backup_enabled');
      return true;
    }
    if (oldValue === 'false') {
      localStorage.setItem('miu_auto_backup', '0');
      localStorage.removeItem('auto_backup_enabled');
      return false;
    }
    return localStorage.getItem('miu_auto_backup') === '1';
  });
  const [oneClickProgress, setOneClickProgress] = useState<{current: number, total: number, message: string} | null>(null);
  const [syncFolderProgress, setSyncFolderProgress] = useState<{ current: number; total: number; message: string } | null>(null);

  const handleSyncFolderStructure = async () => {
    const activeToken = await getActiveToken();
    if (!activeToken) return;
    try {
      setSyncFolderProgress({ current: 0, total: 0, message: '正在比对本地与云端分类...' });
      const res = await syncFolderStructureToCloud(activeToken, (msg, current, total) => {
        setSyncFolderProgress({ current: current || 0, total: total || 0, message: msg });
      });
      setSyncFolderProgress(null);
      alert(`文件夹分类对齐完成！\n已同步移动更新: ${res.moved} 个卡片\n分类一致保持原样: ${res.unchanged} 个`);
      await loadCloudChars(activeToken);
    } catch (err: any) {
      console.error(err);
      setSyncFolderProgress(null);
      alert("同步分类发生错误: " + err.message);
    }
  };

  const handleOneClickCloudSync = async () => {
    const activeToken = await getActiveToken();
    if (!activeToken) return;
    const confirm = window.confirm("确定要将所有本地卡片逐一同步至云端文件夹吗？\n\n如果云端已有相同卡片但分类不同，将自动同步移动到对应的嵌套文件夹中。");
    if (!confirm) return;

    try {
      setOneClickProgress({ current: 0, total: 0, message: '正在准备...' });
      const { getCachedMeta } = await import('../lib/db');
      const { uploadCharacterToCloud } = await import('../lib/cloudDrive');
      const chars = (await getCachedMeta()).filter(c => !c.deletedAt);
      
      setOneClickProgress({ current: 0, total: chars.length, message: '正在同步...' });
      let success = 0;
      let moved = 0;
      let skipped = 0;
      
      const isAndroid = Capacitor.isNativePlatform();
      const CONCURRENCY = isAndroid ? 3 : 5;
      let currentIndex = 0;
      
      const uploadWorker = async () => {
        while (currentIndex < chars.length) {
          const i = currentIndex++;
          try {
             const res = await uploadCharacterToCloud(activeToken, chars[i].id);
             if (res === 'uploaded') success++;
             else if (res === 'moved') moved++;
             else skipped++;
          } catch(e) {
             console.error("Failed", e);
          } finally {
             setOneClickProgress(prev => prev ? { ...prev, current: prev.current + 1, message: '正在同步卡片与目录分类...' } : null);
             await new Promise(r => setTimeout(r, isAndroid ? 200 : 50));
          }
        }
      };

      const workers = [];
      for (let w = 0; w < CONCURRENCY; w++) {
        workers.push(uploadWorker());
      }
      await Promise.all(workers);
      
      setOneClickProgress(null);
      alert(`一键同步完成！\n新上传卡片: ${success}\n更新文件夹嵌套: ${moved}\n内容与分类一致已跳过: ${skipped}`);
      if (activeTab === 'cloud_drive') {
        loadCloudChars(activeToken);
      }
    } catch(err: any) {
       console.error(err);
       setOneClickProgress(null);
       alert("同步发生错误: " + err.message);
    }
  };

  const handleUploadBackup = async () => {
    const activeToken = await getActiveToken();
    if (!activeToken) return;
    try {
      triggerManualBackup(activeToken);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDownloadBackup = async (fileId: string) => {
    const activeToken = await getActiveToken();
    if (!activeToken) return;
    const confirm = window.confirm("确定要恢复该备份吗？\n\n注意：云端备份下载后会直接合并到你当前的数据中，重名卡片会被自动覆盖更新。");
    if (!confirm) return;

    setActionFileId(fileId);
    try {
      triggerRestore(activeToken, fileId);
    } catch (err: any) {
      alert("恢复失败: " + err.message);
      setActionFileId(null);
    }
  };

  const handleDeleteBackup = async (fileId: string) => {
    const activeToken = await getActiveToken();
    if (!activeToken) return;
    if (!window.confirm("确定要永久删除该备份吗？此操作无法恢复！")) return;

    setActionFileId(fileId);
    try {
      await deleteBackupFromDrive(activeToken, fileId);
      await loadBackups(activeToken);
    } catch (err: any) {
      alert("删除失败: " + err.message);
    } finally {
      setActionFileId(null);
    }
  };

  const formatSize = (bytes: string | number) => {
    const b = Number(bytes);
    if (!b || isNaN(b)) return '未知大小';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(2)} MB`;
    return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  if (needsAuth) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center space-y-4">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-2 ${
          isLight ? 'bg-neutral-100 text-black' : 'bg-white/10 text-white'
        }`}>
          <Cloud className="w-8 h-8" />
        </div>
        <h3 className={`text-lg font-bold ${isLight ? 'text-black' : 'text-white'}`}>Google Drive 云端备份</h3>
        <p className={`text-sm max-w-xs ${isLight ? 'text-neutral-500' : 'text-white/60'}`}>
          连接你的 Google 账号，将所有角色卡片、对话记录安全地备份到你的私人网盘中。
        </p>
        <button
          onClick={handleLogin}
          disabled={isLoggingIn}
          className={`gsi-material-button mt-4 px-5 py-2.5 rounded-full flex items-center justify-center gap-3 disabled:opacity-50 transition font-semibold border shadow-xs cursor-pointer ${
            isLight ? 'bg-white text-black border-neutral-300 hover:bg-neutral-50' : 'bg-white text-black hover:bg-neutral-200 border-white'
          }`}
        >
          {isLoggingIn ? <Loader2 className="w-5 h-5 animate-spin" /> : (
            <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-5 h-5">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
              <path fill="none" d="M0 0h48v48H0z"></path>
            </svg>
          )}
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Account Info */}
      <div className="flex items-center justify-between p-4 border rounded-xl bg-white/5 border-white/10 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-black/10 [.light-theme_&]:!shadow-xs">
        <div className="flex items-center gap-3">
          {user?.photoURL ? (
            <img src={user.photoURL} alt="Avatar" className="w-10 h-10 rounded-full" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center border border-white/15 [.light-theme_&]:!bg-black/5 [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-black/10">
              <Cloud className="w-5 h-5 opacity-80" />
            </div>
          )}
          <div>
            <div className="text-sm font-bold text-white [.light-theme_&]:!text-[#0f172a]">{user?.displayName || '已连接账号'}</div>
            <div className="text-xs text-white/60 [.light-theme_&]:!text-slate-600">{user?.email}</div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="text-xs px-3.5 py-1.5 rounded-lg transition font-bold cursor-pointer bg-white/10 text-white hover:bg-white/15 [.light-theme_&]:!bg-black/5 [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:hover:!bg-black/10 border-0 outline-none"
        >
          退出
        </button>
      </div>

      <div className="flex p-1 rounded-2xl mb-6 border bg-white/5 border-white/10 [.light-theme_&]:!bg-black/5 [.light-theme_&]:!border-black/10">
        <button
          onClick={() => setActiveTab('backup')}
          className={`flex-1 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold transition cursor-pointer ${
            activeTab === 'backup' 
              ? 'bg-white text-black shadow-xs [.light-theme_&]:!bg-white [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!shadow-xs' 
              : 'text-white/60 hover:text-white [.light-theme_&]:!text-slate-500 [.light-theme_&]:hover:!text-[#0f172a]'
          }`}
        >
          完整备份库
        </button>
        <button
          onClick={() => setActiveTab('cloud_drive')}
          className={`flex-1 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold transition cursor-pointer ${
            activeTab === 'cloud_drive' 
              ? 'bg-white text-black shadow-xs [.light-theme_&]:!bg-white [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!shadow-xs' 
              : 'text-white/60 hover:text-white [.light-theme_&]:!text-slate-500 [.light-theme_&]:hover:!text-[#0f172a]'
          }`}
        >
          云端卡库
        </button>
      </div>

      {activeTab === 'backup' && (
        <div className="space-y-6">
          
          <div className="space-y-3">
            
            <div className="flex flex-col gap-2.5">
              <button
                onClick={handleOneClickCloudSync}
                disabled={oneClickProgress !== null || syncFolderProgress !== null}
                className="w-full py-3 px-4 rounded-2xl font-bold text-xs sm:text-sm flex justify-center items-center gap-2 transition disabled:opacity-50 min-h-[44px] cursor-pointer bg-white hover:bg-neutral-200 text-black [.light-theme_&]:!bg-black/5 [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:hover:!bg-black/10 [.light-theme_&]:!border-transparent border-0 outline-none"
                title="全量上传本地卡片并同步文件夹结构"
              >
                {oneClickProgress ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin shrink-0 text-black [.light-theme_&]:!text-[#0f172a]" />
                    <span className="truncate text-xs sm:text-sm">同步中 {oneClickProgress.current}/{oneClickProgress.total}</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 shrink-0 stroke-[2.5] text-black [.light-theme_&]:!text-[#0f172a]" />
                    <span>全量同步</span>
                  </>
                )}
              </button>

              <button
                onClick={handleSyncFolderStructure}
                disabled={syncFolderProgress !== null || oneClickProgress !== null}
                className="w-full py-3 px-4 rounded-2xl text-xs sm:text-sm font-bold flex justify-center items-center gap-2 transition disabled:opacity-50 min-h-[44px] cursor-pointer bg-white/5 hover:bg-white/10 text-white border border-white/10 [.light-theme_&]:!bg-black/5 [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:hover:!bg-black/10 [.light-theme_&]:!border-transparent"
                title="仅整理对齐云端卡片的文件夹分类，不重复上传文件（秒级完成）"
              >
                {syncFolderProgress ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin shrink-0 text-white [.light-theme_&]:!text-[#0f172a]" />
                    <span className="truncate text-xs sm:text-sm">{syncFolderProgress.total > 0 ? `${syncFolderProgress.current}/${syncFolderProgress.total}` : '对齐中...'}</span>
                  </>
                ) : (
                  <>
                    <FolderSync className="w-4 h-4 shrink-0 text-white [.light-theme_&]:!text-[#0f172a]" />
                    <span>对齐分类</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] px-1 text-white/50 [.light-theme_&]:!text-slate-600 font-medium">
              <span>全量同步：上传并整理卡片</span>
              <span>对齐分类：仅整理目录结构(秒级)</span>
            </div>

            <label className="flex items-center justify-between p-3.5 sm:p-4 border rounded-2xl cursor-pointer transition bg-white/5 hover:bg-white/10 border-white/10 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-black/10 [.light-theme_&]:!shadow-xs">
              <div>
                <div className="text-sm font-bold text-white [.light-theme_&]:!text-[#0f172a]">挂机自动同步</div>
                <div className="text-xs mt-0.5 text-white/60 [.light-theme_&]:!text-slate-600">
                  网页打开期间每隔30分钟自动静默覆盖备份到云端。
                </div>
              </div>
              <div 
                className="relative inline-flex items-center cursor-pointer shrink-0 ml-3"
                onClick={(e) => {
                  e.preventDefault();
                  const val = !isAutoBackup;
                  setIsAutoBackup(val);
                  localStorage.setItem('miu_auto_backup', val ? '1' : '0');
                }}
              >
                <div className={`w-11 h-6 rounded-full transition-colors duration-200 ease-in-out p-0.5 flex items-center border ${
                  isAutoBackup
                    ? 'bg-blue-600 border-blue-600 [.light-theme_&]:!bg-[#007aff] [.light-theme_&]:!border-[#007aff]'
                    : 'bg-white/10 border-white/20 [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:!border-[#cbd5e1]'
                }`}>
                  <div className={`w-5 h-5 rounded-full transition-transform duration-200 ease-in-out shadow-sm bg-white ${
                    isAutoBackup
                      ? 'translate-x-5'
                      : 'translate-x-0'
                  }`} />
                </div>
              </div>
            </label>

          </div>

          <div className="p-3.5 sm:p-4 border rounded-2xl space-y-3 bg-white/5 border-white/10 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!shadow-xs">

            <div className="flex items-center justify-between">
              <h4 className="text-xs sm:text-sm font-medium text-white/90 [.light-theme_&]:!text-[#64748b]">完整打包备份 (旧版)</h4>

              <button 
                onClick={() => {if(token) loadBackups(token)}} 
                className="text-xs transition px-3 py-1 rounded-full border cursor-pointer font-medium bg-white/10 hover:bg-white/15 text-white/80 border-white/10 [.light-theme_&]:!bg-[#eff6ff] [.light-theme_&]:!border-transparent [.light-theme_&]:!text-[#007aff] [.light-theme_&]:hover:!bg-[#dbeafe]"
              >
                刷新
              </button>
            </div>

            <button
              onClick={handleUploadBackup}
              disabled={syncInfo.isActive}
              className="w-full py-2.5 rounded-xl font-medium flex justify-center items-center gap-2 transition disabled:opacity-50 text-xs sm:text-sm border cursor-pointer bg-white/10 hover:bg-white/15 text-white border-white/10 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#1e293b] [.light-theme_&]:hover:!bg-[#f8fafc] [.light-theme_&]:!shadow-xs"
            >
              {syncInfo.isActive && syncInfo.taskName === '手动备份' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>处理中...</span>
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />
                  <span>创建打包备份</span>
                </>
              )}
            </button>

            
            {isLoadingBackups ? (
              <div className="flex justify-center py-6">
                <Loader2 className={`w-6 h-6 animate-spin ${isLight ? 'text-blue-500' : 'text-white/30'}`} />
              </div>
            ) : backups.length === 0 ? (
              <div className={`text-center py-8 text-sm rounded-xl ${isLight ? 'text-slate-400 bg-[#f8fafc] border border-[#e2e8f0]' : 'text-white/40 bg-black/20'}`}>
                暂无备份记录
              </div>
            ) : (
              <div className="space-y-2">
                {backups.map(b => (
                  <div key={b.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 border rounded-xl group transition gap-3 sm:gap-4 w-full bg-black/40 border-white/5 hover:border-white/10 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:hover:!border-blue-300 [.light-theme_&]:!shadow-xs">
                    <div className="flex-1 min-w-0 flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                         <div className="text-sm font-bold truncate min-w-0 flex-shrink text-white [.light-theme_&]:!text-[#0f172a]" title={b.name}>{b.name}</div>
                         <span className="text-xs flex-shrink-0 font-mono text-white/50 [.light-theme_&]:!text-slate-500">{formatSize(b.size)}</span>
                      </div>
                      <div className="text-xs w-full text-white/50 [.light-theme_&]:!text-slate-500">
                        {new Date(b.createdTime).toLocaleString()}
                      </div>
                    </div>
                    <div className={`flex items-center gap-2 justify-end transition shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 ${
                      isLight ? 'border-[#f1f5f9]' : 'border-white/5'
                    }`}>
                      <button 
                        title="下载并恢复到本应用"
                        disabled={syncInfo.isActive || actionFileId === b.id}
                        onClick={() => handleDownloadBackup(b.id)}
                        className="flex-1 sm:flex-none flex items-center justify-center py-1.5 px-3 rounded-lg transition disabled:opacity-50 cursor-pointer font-medium text-xs shadow-2xs bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/30 [.light-theme_&]:!bg-[#eff6ff] [.light-theme_&]:!text-[#1d4ed8] [.light-theme_&]:!border-[#bfdbfe] [.light-theme_&]:hover:!bg-[#dbeafe]"
                      >
                        {syncInfo.isActive && syncInfo.taskName === '恢复数据' && actionFileId === b.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        <span className="text-xs ml-1">恢复</span>
                      </button>
                      <button 
                        title="删除"
                        disabled={syncInfo.isActive || actionFileId === b.id}
                        onClick={() => handleDeleteBackup(b.id)}
                        className="flex-1 sm:flex-none flex items-center justify-center py-1.5 px-2.5 rounded-lg border transition disabled:opacity-50 cursor-pointer border-white/10 text-white/60 hover:text-red-400 hover:bg-red-500/10 [.light-theme_&]:!border-transparent [.light-theme_&]:!bg-[#fef2f2] [.light-theme_&]:!text-[#ff3b30] [.light-theme_&]:hover:!bg-[#fee2e2] [.light-theme_&]:hover:!text-[#d70015]"
                      >
                        <Trash2 className="w-4 h-4 stroke-[2.2]" />
                        <span className="text-xs ml-1">删除</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'cloud_drive' && (
        <div className="space-y-6">
          
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
            <h3 className="text-base sm:text-lg font-bold text-white [.light-theme_&]:!text-[#0f172a] shrink-0">我的云端角色卡</h3>
            <div className="flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-44 min-w-[110px]">
                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                  <Search className="h-3.5 w-3.5 text-white/40 [.light-theme_&]:!text-slate-400" />
                </div>
                <input
                  type="text"
                  placeholder="搜索卡片..."
                  value={searchCloudQuery}
                  onChange={(e) => setSearchCloudQuery(e.target.value)}
                  className="block w-full pl-8 pr-2.5 py-1.5 border rounded-full text-xs sm:text-sm transition focus:outline-none bg-black/20 border-white/10 text-white placeholder-white/40 focus:border-white/20 focus:bg-black/40 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:placeholder:!text-slate-400 [.light-theme_&]:focus:!border-blue-500 [.light-theme_&]:!shadow-xs"
                />
              </div>

              {/* 查重切换按钮 */}
              <button
                type="button"
                onClick={() => setIsDuplicateMode(!isDuplicateMode)}
                className={`text-xs sm:text-sm px-3 py-1.5 rounded-full transition shrink-0 active:scale-[0.98] border cursor-pointer font-semibold flex items-center gap-1.5 shadow-xs whitespace-nowrap ${
                  isDuplicateMode
                    ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-600 [.light-theme_&]:!bg-[#007aff] [.light-theme_&]:!text-white [.light-theme_&]:!border-[#007aff]'
                    : cloudDuplicateGroups.length > 0
                      ? 'bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border-blue-500/30 [.light-theme_&]:!bg-[#eff6ff] [.light-theme_&]:!text-[#2563eb] [.light-theme_&]:!border-[#bfdbfe]'
                      : 'bg-white/10 hover:bg-white/15 text-white/80 border-white/10 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#e2e8f0]'
                }`}
                title="扫描并展示云端所有同名重复备份"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{isDuplicateMode ? '退出' : `查重${cloudDuplicateGroups.length > 0 ? ` (${cloudDuplicateGroups.length})` : ''}`}</span>
              </button>

              <button
                onClick={() => { if(token) loadCloudChars(token); }}
                className="text-xs sm:text-sm px-3.5 py-1.5 rounded-full transition shrink-0 active:scale-[0.98] border cursor-pointer font-semibold bg-white/10 hover:bg-white/15 text-white/80 border-white/10 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:hover:!bg-[#f8fafc] [.light-theme_&]:!shadow-xs whitespace-nowrap"
              >
                刷新
              </button>
            </div>
          </div>

          <div className="rounded-2xl p-2.5 sm:p-4 border min-h-[300px] bg-black/20 border-white/5 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!border-[#e2e8f0]">
            {isLoadingCloud ? (
              <div className="flex flex-col items-center justify-center py-12 text-white/50 [.light-theme_&]:!text-slate-600">
                <Loader2 className="w-8 h-8 animate-spin mb-4" />
                <p>正在拉取云端卡库...</p>
              </div>
            ) : cloudChars.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-white/40 [.light-theme_&]:!text-slate-500">
                <Cloud className="w-12 h-12 mb-4 opacity-20" />
                <p>云端卡库空空如也</p>
                <p className="text-sm mt-2">在角色列表中勾选卡片即可上传至云盘</p>
              </div>
            ) : isDuplicateMode ? (
              /* 云端同名查重模式 */
              <div className="space-y-3.5">
                {/* 顶部精简查重横幅 */}
                <div className="px-3.5 py-2 sm:py-2.5 rounded-xl border flex items-center justify-between gap-2 bg-blue-500/10 border-blue-500/20 text-blue-200 [.light-theme_&]:!bg-[#f0f7ff] [.light-theme_&]:!border-[#bfdbfe] [.light-theme_&]:!text-[#1e3a8a]">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap sm:flex-nowrap">
                    <Copy className="w-4 h-4 shrink-0 text-blue-400 [.light-theme_&]:!text-[#2563eb]" />
                    <span className="font-bold text-xs sm:text-sm shrink-0 text-white [.light-theme_&]:!text-[#0f172a]">查重模式</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold shrink-0 bg-blue-500/25 text-blue-200 border border-blue-500/30 [.light-theme_&]:!bg-[#dbeafe] [.light-theme_&]:!text-[#1e40af] [.light-theme_&]:!border-[#bfdbfe]">
                      {cloudDuplicateGroups.length} 组 · {totalDuplicateCards} 副本
                    </span>
                    <span className="text-[11px] hidden sm:inline text-blue-300/80 [.light-theme_&]:!text-[#475569] truncate">
                      比对上传时间，清理历史旧卡
                    </span>
                  </div>
                  <button
                    onClick={() => setIsDuplicateMode(false)}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold shrink-0 transition cursor-pointer bg-white/10 hover:bg-white/20 text-white border border-white/10 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:hover:!bg-[#f8fafc] shadow-2xs whitespace-nowrap"
                  >
                    返回全部
                  </button>
                </div>

                {/* 查重结果列表 */}
                {cloudDuplicateGroups.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center mb-2.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 [.light-theme_&]:!bg-emerald-50 [.light-theme_&]:!text-emerald-600 [.light-theme_&]:!border-emerald-200">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <h4 className="font-bold text-sm mb-0.5 text-white [.light-theme_&]:!text-[#0f172a]">
                      云端卡库非常整洁
                    </h4>
                    <p className="text-xs text-white/50 [.light-theme_&]:!text-slate-500">
                      当前云端卡库中没有检测到同名的重复备份
                    </p>
                    <button
                      onClick={() => setIsDuplicateMode(false)}
                      className="mt-3 px-3.5 py-1 rounded-full text-xs font-semibold transition cursor-pointer bg-white/10 hover:bg-white/20 text-white [.light-theme_&]:!bg-slate-100 [.light-theme_&]:hover:!bg-slate-200 [.light-theme_&]:!text-slate-700"
                    >
                      返回全部卡片
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3.5">
                    {cloudDuplicateGroups.map((group) => (
                      <div 
                        key={group.key}
                        className="rounded-2xl p-3 sm:p-4 border bg-slate-900/60 border-white/10 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!shadow-xs"
                      >
                        {/* Group Header */}
                        <div className="flex items-center justify-between gap-2 pb-2.5 mb-3 border-b border-white/10 [.light-theme_&]:!border-[#e2e8f0]">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2 h-2 rounded-full shrink-0 bg-blue-400 [.light-theme_&]:!bg-blue-600" />
                            <h4 className="font-bold text-sm sm:text-base truncate text-white [.light-theme_&]:!text-[#0f172a]">
                              {group.name}
                            </h4>
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0 bg-white/10 text-slate-300 border border-white/10 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#475569] [.light-theme_&]:!border-[#e2e8f0]">
                              {group.chars.length} 个版本
                            </span>
                          </div>
                        </div>

                        {/* Group Cards Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3">
                          {group.chars.map((char, index) => {
                            const isLatest = index === 0;
                            const isChat = char.appProperties?.isChat === 'true';
                            const baseCharName = char.appProperties?.charName || char.name?.replace(/\.(zip|png|json|webp|jpg)$/i, '');
                            const charName = isChat ? (char.name?.replace(/\.(jsonl|json)$/i, '') || baseCharName) : baseCharName;
                            const uploadDate = char.createdTime ? new Date(char.createdTime) : null;

                            return (
                              <div 
                                key={char.id}
                                className={`rounded-xl p-3 border flex flex-col justify-between gap-2.5 transition ${
                                  isLatest 
                                    ? 'bg-slate-900/80 border-blue-500/40 shadow-xs [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!border-[#93c5fd] [.light-theme_&]:!shadow-xs'
                                    : 'bg-slate-900/40 border-white/10 hover:border-white/20 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:hover:!border-[#cbd5e1]'
                                }`}
                              >
                                <div className="flex items-start gap-2.5 sm:gap-3 min-w-0">
                                  {/* Thumbnail */}
                                  <div className="w-13 h-17 sm:w-14 sm:h-18 rounded-lg overflow-hidden shrink-0 relative border bg-black/30 border-white/10 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!border-[#e2e8f0]">
                                    {char.thumbnailLink ? (
                                      <img 
                                        src={char.thumbnailLink} 
                                        alt={charName} 
                                        className="w-full h-full object-cover" 
                                        referrerPolicy="no-referrer" 
                                      />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center text-slate-400">
                                        {isChat ? <MessageSquare className="w-5 h-5" /> : <Cloud className="w-5 h-5" />}
                                      </div>
                                    )}
                                  </div>

                                  {/* Metadata */}
                                  <div className="min-w-0 flex-1 space-y-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      {isLatest ? (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 shrink-0 [.light-theme_&]:!bg-[#ecfdf5] [.light-theme_&]:!text-[#047857] [.light-theme_&]:!border-[#a7f3d0]">
                                          最新上传
                                        </span>
                                      ) : (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-500/15 text-amber-400 border border-amber-500/25 shrink-0 [.light-theme_&]:!bg-[#fffbeb] [.light-theme_&]:!text-[#b45309] [.light-theme_&]:!border-[#fde68a]">
                                          较旧副本
                                        </span>
                                      )}
                                      <span className="text-xs font-semibold truncate text-white [.light-theme_&]:!text-[#0f172a]" title={charName}>
                                        {charName}
                                      </span>
                                    </div>

                                    <div className="text-[11px] space-y-0.5 text-slate-300 [.light-theme_&]:!text-slate-600">
                                      <div className="flex items-center gap-1 text-[11px] font-mono">
                                        <span className={isLatest ? 'text-emerald-400 font-semibold [.light-theme_&]:!text-[#047857]' : 'text-slate-300 [.light-theme_&]:!text-[#475569]'}>
                                          上传：{uploadDate ? uploadDate.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '未知时间'}
                                        </span>
                                      </div>
                                      <div className="truncate text-[10.5px] text-slate-400 [.light-theme_&]:!text-[#64748b]" title={char.appProperties?.folderPath || '云端根目录'}>
                                        路径：{char.appProperties?.folderPath ? formatCloudName(char.appProperties.folderPath) : '云端根目录'}
                                      </div>
                                      <div className="text-[10.5px] text-slate-400 [.light-theme_&]:!text-[#64748b]">
                                        大小：{char.size ? formatSize(char.size) : '未知大小'}
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2 pt-2 border-t border-white/10 [.light-theme_&]:!border-[#f1f5f9]">
                                  <button 
                                    onClick={() => handleRestoreCloudFileToApp(char.id, char.name, charName, isChat, char.appProperties?.folderPath)}
                                    disabled={downloadingId === char.id}
                                    className="flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1 transition disabled:opacity-50 cursor-pointer font-semibold text-xs bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/30 [.light-theme_&]:!bg-[#eff6ff] [.light-theme_&]:!text-[#1d4ed8] [.light-theme_&]:!border-[#bfdbfe] [.light-theme_&]:hover:!bg-[#dbeafe] shadow-2xs"
                                    title="下载此版本并恢复到本地角色库"
                                  >
                                    {downloadingId === char.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                                    <span>下载</span>
                                  </button>
                                  <button 
                                    onClick={() => handleDeleteCloudChar(char.id, `${charName} (${uploadDate ? uploadDate.toLocaleDateString() : '旧版本'})`)}
                                    disabled={downloadingId === char.id}
                                    className="py-1.5 px-3 rounded-lg border flex items-center justify-center gap-1 transition disabled:opacity-50 cursor-pointer font-semibold text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/20 [.light-theme_&]:!bg-[#fef2f2] [.light-theme_&]:!text-[#dc2626] [.light-theme_&]:!border-[#fecaca] [.light-theme_&]:hover:!bg-[#fee2e2]"
                                    title="从云端彻底删除此副本"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>删除</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                {!searchCloudQuery && (
                  <div className="flex items-center gap-2 mb-4 text-sm overflow-x-auto whitespace-nowrap pb-2 text-white/60 [.light-theme_&]:!text-[#64748b] font-normal">
                    <button onClick={() => setCurrentCloudPath("")} className="transition cursor-pointer text-white/70 hover:text-white [.light-theme_&]:!text-[#64748b] font-normal hover:underline">云端根目录</button>
                    {currentCloudPath && currentCloudPath.split('/').map((part, idx, arr) => (
                      <div key={idx} className="flex items-center gap-2 shrink-0">
                        <ChevronRight className="w-4 h-4 opacity-50" />
                        <button 
                          onClick={() => setCurrentCloudPath(arr.slice(0, idx + 1).join('/'))}
                          className="transition cursor-pointer text-white/70 hover:text-white [.light-theme_&]:!text-[#64748b] font-normal hover:underline"
                        >
                          {formatCloudName(part)}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                
                {!searchCloudQuery && cloudFolders.length > 0 && (
                  <div className="flex flex-wrap gap-2.5 sm:gap-3 mb-6">
                    {cloudFolders.map(folderName => {
                      const fullFolderPath = currentCloudPath ? `${currentCloudPath}/${folderName}` : folderName;
                      return (
                      <div key={folderName} className="relative group inline-flex items-center rounded-full transition overflow-hidden shadow-xs max-w-full bg-white/5 hover:bg-white/10 border border-white/10 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:hover:!bg-[#f8fafc] [.light-theme_&]:!border-black/5 [.light-theme_&]:!shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
                        <button
                          onClick={() => setCurrentCloudPath(fullFolderPath)}
                          className="flex items-center gap-2 pl-3.5 pr-1 py-1.5 text-left min-w-0 shrink cursor-pointer"
                        >
                          <Folder className="w-4.5 h-4.5 text-blue-500 [.light-theme_&]:!text-[#007aff] shrink-0 stroke-[1.8]" />
                          <span className="text-xs sm:text-sm font-normal truncate max-w-[130px] sm:max-w-[200px] text-white/90 [.light-theme_&]:!text-[#1e293b]">{formatCloudName(folderName)}</span>
                        </button>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (window.confirm(`确定要删除云端文件夹 "${formatCloudName(folderName)}" 及其包含的所有卡片吗？此操作不可恢复！`)) {
                               const charsToDelete = cloudChars.filter(c => {
                                  const p = c.appProperties?.folderPath || "";
                                  return p === fullFolderPath || p.startsWith(fullFolderPath + '/');
                                });
                               try {
                                  setIsLoadingCloud(true);
                                  for (const c of charsToDelete) {
                                      await deleteCloudCharacter(token!, c.id);
                                  }
                                  setCloudChars(prev => prev.filter(c => !charsToDelete.includes(c)));
                               } catch (err) {
                                  alert("删除部分文件时出错");
                               } finally {
                                  setIsLoadingCloud(false);
                                }
                            }
                          }}
                          className="pr-3 pl-1 text-red-400 hover:text-red-500 transition shrink-0 flex items-center justify-center cursor-pointer [.light-theme_&]:!text-[#ff3b30] [.light-theme_&]:hover:!text-[#d70015]"
                          title="删除文件夹"
                        >
                          <Trash2 className="w-4 h-4 stroke-[1.8]" />
                        </button>
                      </div>
                    )})}

                  </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 sm:gap-4">
                  {filteredCloudChars.map(char => {
                    const isChat = char.appProperties?.isChat === 'true';
                    const baseCharName = char.appProperties?.charName || char.name?.replace(/\.(zip|png|json|webp|jpg)$/i, '');
                    const charName = isChat ? (char.name?.replace(/\.(jsonl|json)$/i, '') || baseCharName) : baseCharName;
                    return (
                      <div key={char.id} className={`relative group rounded-xl overflow-hidden border flex flex-col h-auto ${
                        isLight ? 'bg-[#ffffff] border-[#e2e8f0] shadow-xs' : 'bg-white/5 border-white/10'
                      }`}>
                        <div className={`relative aspect-[3/4] overflow-hidden ${isLight ? 'bg-[#f1f5f9]' : 'bg-black/40'}`}>
                        {char.thumbnailLink ? (
                          
                          <>
                            <img 
                              src={char.thumbnailLink} 
                              alt={charName} 
                              className="w-full h-full object-cover group-hover:scale-105 transition duration-500" 
                              referrerPolicy="no-referrer" 
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                const fallback = e.currentTarget.nextElementSibling;
                                if (fallback) fallback.classList.remove('hidden');
                              }}
                            />
                            <div className={`w-full h-full items-center justify-center hidden ${isLight ? 'bg-[#f1f5f9]' : 'bg-black/40'}`}>
                              {isChat ? <MessageSquare className={`w-8 h-8 ${isLight ? 'text-slate-400' : 'text-white/20'}`} /> : <Cloud className={`w-8 h-8 ${isLight ? 'text-slate-400' : 'text-white/20'}`} />}
                            </div>
                          </>

                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            {isChat ? <MessageSquare className={`w-8 h-8 ${isLight ? 'text-slate-400' : 'text-white/20'}`} /> : <Cloud className={`w-8 h-8 ${isLight ? 'text-slate-400' : 'text-white/20'}`} />}
                          </div>
                        )}
                        
                        {(() => {
                          const badge = getCardBadgeInfo(char);
                          if (!badge) return null;
                          return (
                            <div className="absolute top-2 left-2 z-10 px-2 py-0.5 bg-black/60 backdrop-blur-md rounded-md text-[10px] font-medium text-white/90 border border-white/10 uppercase flex items-center gap-1.5 shadow-sm pointer-events-none select-none">
                              <span className={`w-1.5 h-1.5 rounded-full ${badge.dotColor} shrink-0`} />
                              <span>{badge.label}</span>
                            </div>
                          );
                        })()}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-80 transition pointer-events-none" />
                      </div>
                      
                      <div className={`p-2 sm:p-3 border-t flex flex-col justify-between flex-1 ${
                        isLight ? 'bg-[#ffffff] border-[#f1f5f9]' : 'bg-black/40 border-white/10'
                      }`}>
                        <div>
                           <h4 className={`font-normal text-xs sm:text-sm truncate ${isLight ? 'text-[#1e293b]' : 'text-white/90'}`} title={charName}>{charName}</h4>
                           <p className={`text-[10px] sm:text-xs mt-0.5 truncate ${isLight ? 'text-[#64748b]' : 'text-white/50'}`}>
                              {char.size ? formatSize(char.size) : '未知大小'}
                             {char.createdTime ? ` · ${new Date(char.createdTime).toLocaleDateString()}` : ''}
                           </p>
                        </div>
                        <div className="flex items-center gap-1.5 sm:gap-2 mt-2">
                           <button 
                             onClick={() => handleRestoreCloudFileToApp(char.id, char.name, charName, isChat, char.appProperties?.folderPath)}
                             disabled={downloadingId === char.id}
                             className="flex-1 py-1 sm:py-1.5 rounded-lg flex items-center justify-center gap-1 transition disabled:opacity-50 cursor-pointer font-medium text-xs bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/30 [.light-theme_&]:!bg-[#eff6ff] [.light-theme_&]:!text-[#1d4ed8] [.light-theme_&]:!border-[#bfdbfe] [.light-theme_&]:hover:!bg-[#dbeafe] shadow-2xs"
                             title="下载并解包恢复至 App 角色库"
                           >
                             {downloadingId === char.id ? <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" /> : <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
                             <span className="text-[10px] sm:text-xs font-medium whitespace-nowrap">下载</span>
                           </button>
                           <button 
                             onClick={() => handleDeleteCloudChar(char.id, charName)}
                             disabled={downloadingId === char.id}
                             className="p-1 sm:p-1.5 rounded-lg border flex items-center justify-center transition disabled:opacity-50 shrink-0 cursor-pointer bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/20 [.light-theme_&]:!border-transparent [.light-theme_&]:!bg-[#fef2f2] [.light-theme_&]:!text-[#ff3b30] [.light-theme_&]:hover:!bg-[#fee2e2] [.light-theme_&]:hover:!text-[#d70015]"
                             title="删除"
                           >
                             <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.2]" />
                           </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
