import { useState, useEffect, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { Cloud, Download, Upload, Trash2, Github, Loader2, Search, Folder, ChevronRight, MessageSquare, FileText, FolderSync } from 'lucide-react';
import { listCloudCharacters, deleteCloudCharacter, syncFolderStructureToCloud } from '../lib/cloudDrive';
import { getCardBadgeInfo } from '../lib/cardBadge';
import { initAuth, googleSignIn, logout, getAccessToken, listBackupsFromDrive, deleteBackupFromDrive, triggerManualBackup, triggerRestore, onSyncStateChange, SyncState } from '../lib/drive';

const formatCloudName = (name: string) => name.replace(/_[a-f0-9-]{36}$/i, "");

export function CloudSyncTab() {
  const [needsAuth, setNeedsAuth] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
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
        setToken(t);
        setNeedsAuth(false);
        loadBackups(t);
      },
      () => {
        setNeedsAuth(true);
        setUser(null);
        setToken(null);
        setBackups([]);
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
    if (!token) return;
    try {
      setSyncFolderProgress({ current: 0, total: 0, message: '正在比对本地与云端分类...' });
      const res = await syncFolderStructureToCloud(token, (msg, current, total) => {
        setSyncFolderProgress({ current: current || 0, total: total || 0, message: msg });
      });
      setSyncFolderProgress(null);
      alert(`文件夹分类对齐完成！\n已同步移动更新: ${res.moved} 个卡片\n分类一致保持原样: ${res.unchanged} 个`);
      await loadCloudChars(token);
    } catch (err: any) {
      console.error(err);
      setSyncFolderProgress(null);
      alert("同步分类发生错误: " + err.message);
    }
  };

  const handleOneClickCloudSync = async () => {
    if (!token) return;
    const confirm = window.confirm("确定要将所有本地卡片逐一同步至云端文件夹吗？\n\n如果云端已有相同卡片但分类不同，将自动同步移动到对应的嵌套文件夹中。");
    if (!confirm) return;

    try {
      setOneClickProgress({ current: 0, total: 0, message: '正在准备...' });
      const { getCachedMeta } = await import('../lib/db');
      const { uploadCharacterToCloud } = await import('../lib/cloudDrive');
      const chars = await getCachedMeta();
      
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
             const res = await uploadCharacterToCloud(token, chars[i].id);
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
        loadCloudChars(token);
      }
    } catch(err: any) {
       console.error(err);
       setOneClickProgress(null);
       alert("同步发生错误: " + err.message);
    }
  };

  const handleUploadBackup = () => {
    if (!token) return;
    try {
      triggerManualBackup(token);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDownloadBackup = (fileId: string) => {
    if (!token) return;
    const confirm = window.confirm("确定要恢复该备份吗？\n\n注意：云端备份下载后会直接合并到你当前的数据中，重名卡片会被自动覆盖更新。");
    if (!confirm) return;

    setActionFileId(fileId);
    try {
      triggerRestore(token, fileId);
    } catch (err: any) {
      alert("恢复失败: " + err.message);
      setActionFileId(null);
    }
  };

  const handleDeleteBackup = async (fileId: string) => {
    if (!token) return;
    if (!window.confirm("确定要永久删除该备份吗？此操作无法恢复！")) return;

    setActionFileId(fileId);
    try {
      await deleteBackupFromDrive(token, fileId);
      await loadBackups(token);
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
        <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mb-2">
          <Cloud className="w-8 h-8 text-blue-400" />
        </div>
        <h3 className="text-lg font-medium text-white">Google Drive 云端备份</h3>
        <p className="text-sm text-white/50 max-w-xs">
          连接你的 Google 账号，将所有角色卡片、对话记录安全地备份到你的私人网盘中。
        </p>
        <button
          onClick={handleLogin}
          disabled={isLoggingIn}
          className="gsi-material-button mt-4 bg-white text-black px-4 py-2 rounded-xl flex items-center justify-center gap-3 disabled:opacity-50 transition hover:bg-gray-100 font-medium"
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
      <div className="flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-xl">
        <div className="flex items-center gap-3">
          {user?.photoURL ? (
            <img src={user.photoURL} alt="Avatar" className="w-10 h-10 rounded-full" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
              <Cloud className="w-5 h-5 text-blue-400" />
            </div>
          )}
          <div>
            <div className="text-sm font-medium text-white">{user?.displayName || '已连接账号'}</div>
            <div className="text-xs text-white/50">{user?.email}</div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 transition"
        >
          退出
        </button>
      </div>

      <div className="flex bg-black/20 p-1 rounded-xl mb-6">
        <button
          onClick={() => setActiveTab('backup')}
          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition ${activeTab === 'backup' ? 'bg-white/10 text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}`}
        >
          完整备份库
        </button>
        <button
          onClick={() => setActiveTab('cloud_drive')}
          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition ${activeTab === 'cloud_drive' ? 'bg-white/10 text-white shadow-sm' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}`}
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
                className="w-full py-3 px-4 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-medium text-xs sm:text-sm flex justify-center items-center gap-2 transition disabled:opacity-50 shadow-sm active:scale-[0.99] min-h-[44px]"
                title="全量上传本地卡片并同步文件夹结构"
              >
                {oneClickProgress ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span className="truncate text-xs sm:text-sm">同步中 {oneClickProgress.current}/{oneClickProgress.total}</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 shrink-0" />
                    <span>全量同步</span>
                  </>
                )}
              </button>

              <button
                onClick={handleSyncFolderStructure}
                disabled={syncFolderProgress !== null || oneClickProgress !== null}
                className="w-full py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/90 text-xs sm:text-sm font-medium flex justify-center items-center gap-2 transition disabled:opacity-50 active:scale-[0.99] min-h-[44px]"
                title="仅整理对齐云端卡片的文件夹分类，不重复上传文件（秒级完成）"
              >
                {syncFolderProgress ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-blue-400 shrink-0" />
                    <span className="truncate text-xs sm:text-sm">{syncFolderProgress.total > 0 ? `${syncFolderProgress.current}/${syncFolderProgress.total}` : '对齐中...'}</span>
                  </>
                ) : (
                  <>
                    <FolderSync className="w-4 h-4 text-blue-400 shrink-0" />
                    <span>对齐分类</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-white/40 px-1">
              <span>全量同步：上传并整理卡片</span>
              <span>对齐分类：仅整理目录结构(秒级)</span>
            </div>

            <label className="flex items-center justify-between p-3.5 sm:p-4 bg-white/5 border border-white/10 rounded-xl cursor-pointer hover:bg-white/10 transition">
              <div>
                <div className="text-sm font-medium text-white">挂机自动同步</div>
                <div className="text-xs text-white/50 mt-0.5">
                  网页打开期间每隔30分钟自动静默覆盖备份到云端。
                </div>
              </div>
              <div className="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
                <input 
                  type="checkbox" 
                  className="sr-only peer" 
                  checked={isAutoBackup}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setIsAutoBackup(val);
                    localStorage.setItem('miu_auto_backup', val ? '1' : '0');
                  }}
                />
                <div className="w-11 h-6 bg-black/40 border border-white/20 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white/80 peer-checked:after:bg-white after:border-gray-300/20 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500 peer-checked:border-blue-500 shadow-inner"></div>
              </div>
            </label>

          </div>

          <div className="p-3.5 sm:p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">

            <div className="flex items-center justify-between">
              <h4 className="text-xs sm:text-sm font-medium text-white/70">完整打包备份 (旧版)</h4>

              <button onClick={() => {if(token) loadBackups(token)}} className="text-xs text-blue-400 hover:text-blue-300 transition px-2 py-0.5 bg-blue-500/10 rounded-md">
                刷新
              </button>
            </div>

            <button
              onClick={handleUploadBackup}
              disabled={syncInfo.isActive}
              className="w-full py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 font-medium flex justify-center items-center gap-2 transition disabled:opacity-50 text-xs sm:text-sm border border-white/10"
            >
              {syncInfo.isActive && syncInfo.taskName === '手动备份' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>处理中...</span>
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />
                  创建打包备份
                </>
              )}
            </button>

            
            {isLoadingBackups ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-6 h-6 animate-spin text-white/30" />
              </div>
            ) : backups.length === 0 ? (
              <div className="text-center py-8 text-sm text-white/40 bg-black/20 rounded-lg">
                暂无备份记录
              </div>
            ) : (
              <div className="space-y-2">
                {backups.map(b => (
                  <div key={b.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-black/40 border border-white/5 rounded-xl group hover:border-white/10 transition gap-3 sm:gap-4 w-full">
                    <div className="flex-1 min-w-0 flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2">
                         <div className="text-sm text-white font-medium truncate min-w-0 flex-shrink" title={b.name}>{b.name}</div>
                         <span className="text-xs text-white/40 flex-shrink-0">{formatSize(b.size)}</span>
                      </div>
                      <div className="text-xs text-white/50 w-full">
                        {new Date(b.createdTime).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 justify-end transition shrink-0 border-t sm:border-t-0 border-white/5 pt-2 sm:pt-0">
                      <button 
                        title="下载并恢复到本应用"
                        disabled={syncInfo.isActive || actionFileId === b.id}
                        onClick={() => handleDownloadBackup(b.id)}
                        className="flex-1 sm:flex-none flex items-center justify-center py-1.5 px-3 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 hover:text-blue-400 text-blue-400/80 transition disabled:opacity-50"
                      >
                        {syncInfo.isActive && syncInfo.taskName === '恢复数据' && actionFileId === b.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        <span className="text-xs ml-1 sm:hidden">恢复</span>
                      </button>
                      <button 
                        title="删除"
                        disabled={syncInfo.isActive || actionFileId === b.id}
                        onClick={() => handleDeleteBackup(b.id)}
                        className="flex-1 sm:flex-none flex items-center justify-center py-1.5 px-3 rounded-lg bg-red-500/10 hover:bg-red-500/20 hover:text-red-400 text-red-400/80 transition disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span className="text-xs ml-1 sm:hidden">删除</span>
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
          
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <h3 className="text-base sm:text-lg font-semibold text-white/90">我的云端角色卡</h3>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-48">
                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                  <Search className="h-3.5 w-3.5 text-white/40" />
                </div>
                <input
                  type="text"
                  placeholder="搜索卡片..."
                  value={searchCloudQuery}
                  onChange={(e) => setSearchCloudQuery(e.target.value)}
                  className="block w-full pl-8 pr-2.5 py-1.5 border border-white/10 rounded-full bg-black/20 text-xs sm:text-sm text-white placeholder-white/40 focus:outline-none focus:border-white/20 focus:bg-black/40 transition"
                />
              </div>
              <button
                onClick={() => { if(token) loadCloudChars(token); }}
                className="text-xs sm:text-sm px-3.5 sm:px-4 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-white/70 transition shrink-0 active:scale-[0.98]"
              >
                刷新
              </button>
            </div>
          </div>

          
          <div className="bg-black/20 rounded-2xl p-2.5 sm:p-4 border border-white/5 min-h-[300px]">
            {isLoadingCloud ? (
              <div className="flex flex-col items-center justify-center py-12 text-white/50">
                <Loader2 className="w-8 h-8 animate-spin mb-4" />
                <p>正在拉取云端卡库...</p>
              </div>
            ) : cloudChars.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-white/40">
                <Cloud className="w-12 h-12 mb-4 opacity-20" />
                <p>云端卡库空空如也</p>
                <p className="text-sm mt-2">在角色列表中勾选卡片即可上传至云盘</p>
              </div>
            ) : (
              <>
                {!searchCloudQuery && (
                  <div className="flex items-center gap-2 mb-4 text-sm text-white/60 overflow-x-auto whitespace-nowrap pb-2">
                    <button onClick={() => setCurrentCloudPath("")} className="hover:text-white transition">云端根目录</button>
                    {currentCloudPath && currentCloudPath.split('/').map((part, idx, arr) => (
                      <div key={idx} className="flex items-center gap-2 shrink-0">
                        <ChevronRight className="w-4 h-4 opacity-50" />
                        <button 
                          onClick={() => setCurrentCloudPath(arr.slice(0, idx + 1).join('/'))}
                          className="hover:text-white transition"
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
                      <div key={folderName} className="relative group inline-flex items-stretch bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition overflow-hidden shadow-sm max-w-full">
                        <button
                          onClick={() => setCurrentCloudPath(fullFolderPath)}
                          className="flex items-center gap-2 sm:gap-2.5 pl-3.5 pr-2 py-2 sm:py-2.5 sm:pl-4 sm:pr-3 text-left min-w-0 shrink"
                        >
                          <Folder className="w-5 h-5 text-blue-400 shrink-0" />
                          <span className="text-[14px] font-medium text-white/90 truncate max-w-[130px] sm:max-w-[200px]">{formatCloudName(folderName)}</span>
                        </button>
                        <div className="w-[1px] bg-white/10 my-2"></div>
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
                          className="px-3 sm:px-3.5 text-red-400/80 hover:text-red-400 hover:bg-red-500/20 active:bg-red-500/30 transition shrink-0 flex items-center justify-center"
                          title="删除文件夹"
                        >
                          <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
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
                      <div key={char.id} className="relative group rounded-xl overflow-hidden bg-white/5 border border-white/10 flex flex-col h-auto">
                        <div className="relative aspect-[3/4] overflow-hidden bg-black/40">
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
                            <div className="w-full h-full items-center justify-center hidden bg-black/40">
                              {isChat ? <MessageSquare className="w-8 h-8 text-white/20" /> : <Cloud className="w-8 h-8 text-white/20" />}
                            </div>
                          </>

                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            {isChat ? <MessageSquare className="w-8 h-8 text-white/20" /> : <Cloud className="w-8 h-8 text-white/20" />}
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
                      
                      <div className="p-2 sm:p-3 bg-black/40 border-t border-white/10 flex flex-col justify-between flex-1">
                        <div>
                           <h4 className="font-medium text-xs sm:text-sm text-white/90 truncate" title={charName}>{charName}</h4>
                           <p className="text-[10px] sm:text-xs text-white/50 mt-0.5 truncate">
                              {char.size ? formatSize(char.size) : '未知大小'}
                             {char.createdTime ? ` · ${new Date(char.createdTime).toLocaleDateString()}` : ''}
                           </p>
                        </div>
                        <div className="flex items-center gap-1.5 sm:gap-2 mt-2">
                           <button 
                             onClick={() => handleRestoreCloudFileToApp(char.id, char.name, charName, isChat, char.appProperties?.folderPath)}
                             disabled={downloadingId === char.id}
                             className="flex-1 py-1 sm:py-1.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-500/30 flex items-center justify-center gap-1 active:bg-blue-500/40 transition disabled:opacity-50"
                             title="下载并解包恢复至 App 角色库"
                           >
                             {downloadingId === char.id ? <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" /> : <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
                             <span className="text-[10px] sm:text-xs font-medium whitespace-nowrap">下载</span>
                           </button>
                           <button 
                             onClick={() => handleDeleteCloudChar(char.id, charName)}
                             disabled={downloadingId === char.id}
                             className="p-1 sm:p-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 flex items-center justify-center active:bg-red-500/40 transition disabled:opacity-50 shrink-0"
                             title="删除"
                           >
                             <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
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
