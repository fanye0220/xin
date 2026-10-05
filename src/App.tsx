/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CharacterList } from './components/CharacterList';
import { CharacterDetail } from './components/CharacterDetail';
import { ImportModal } from './components/ImportModal';
import { FolderSidebar } from './components/FolderSidebar';
import { TrashBin } from './components/TrashBin';
import { DuplicateDetector } from './components/DuplicateDetector';
import { AutoTagger } from './components/AutoTagger';
import { AIRecommender } from './components/AIRecommender';
import { SettingsModal } from './components/SettingsModal';
import { ChatViewer } from './components/ChatViewer';
import { SyncWidget } from './components/SyncWidget';
import { UpdateModal } from './components/UpdateModal';
import { CharacterSummaryModal } from './components/CharacterSummaryModal';
import { checkForAppUpdates, VersionInfo } from './config/version';
import { migrateDatabase, getFolders, getCharacter, CharacterCard } from './lib/db';
import { useTaggerState } from './lib/taggerState';
import { isAndroid } from './lib/appBridge';
import { handleBackRequest } from './lib/useBackHandler';
import { syncWithAndroidLocalDirectory } from './lib/androidSync';
import { Tag, Loader2, AlertCircle, Pause, X } from 'lucide-react';

function TaggerWidget({ onClick }: { onClick: () => void }) {
  const { isTagging, isPaused, progress, logs } = useTaggerState();
  const [errorToast, setErrorToast] = useState<string | null>(null);

  useEffect(() => {
    import('./lib/taggerState').then(({ taggerState }) => {
      taggerState.setErrorCallback((msg) => {
        setErrorToast(msg);
        setTimeout(() => setErrorToast(null), 5000);
      });
    });
  }, []);
  
  // Only show if tagging is active, paused, or there's a recent error
  const hasError = logs.some(l => l.status === 'failed');
  const shouldShow = isTagging || isPaused || (hasError && progress.current > 0 && progress.current < progress.total);

  return (
    <>
      <AnimatePresence>
        {errorToast && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            className="fixed top-5 left-1/2 z-[100] ios-toast ios-toast-error px-4 py-2.5 rounded-full flex items-center gap-2.5 max-w-[92vw] sm:max-w-md w-auto pointer-events-auto miu-skin"
            role="alert"
            aria-live="assertive"
          >
            <AlertCircle className="w-4 h-4 text-red-400 ios-toast-icon-error shrink-0" />
            <span className="font-medium text-xs sm:text-sm truncate flex-1">
              {errorToast}
            </span>
            <button 
              onClick={() => setErrorToast(null)} 
              className="p-1 hover:bg-white/10 text-slate-400 hover:text-white ios-toast-close rounded-full transition shrink-0 cursor-pointer ml-1"
              title="关闭"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {shouldShow && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            onClick={onClick}
            className={`tagger-floating-pill fixed ${errorToast ? 'top-16' : 'top-5'} left-1/2 z-50 rounded-full px-4 py-2 sm:px-4.5 sm:py-2 flex items-center gap-2.5 max-w-[92vw] w-auto cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-all overflow-hidden group select-none`}
            title="点击打开打标面板"
          >
            {isPaused ? (
              <Pause className="w-4 h-4 text-yellow-400 shrink-0 [.light-theme_&]:!text-amber-500" />
            ) : hasError ? (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 [.light-theme_&]:!text-red-500" />
            ) : (
              <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0 [.light-theme_&]:!text-blue-600" />
            )}
            
            <span className="text-xs sm:text-sm font-medium text-slate-100 whitespace-nowrap tagger-floating-text [.light-theme_&]:!text-[#0f172a]">
              {isPaused ? '打标已暂停' : hasError ? '打标遇到错误' : '自动打标中'}
            </span>

            <span className="text-[11px] font-semibold text-blue-300 bg-blue-500/20 px-2.5 py-0.5 rounded-full shrink-0 [.light-theme_&]:!text-blue-600 [.light-theme_&]:!bg-blue-50 border-0 border-none outline-none">
              {progress.current}/{progress.total}
            </span>

            <button 
              onClick={(e) => {
                e.stopPropagation();
                import('./lib/taggerState').then(({ taggerState }) => taggerState.dismiss());
              }}
              className="p-1 hover:bg-white/20 rounded-full transition text-white/50 hover:text-white shrink-0 ml-0.5 tagger-floating-close [.light-theme_&]:!text-slate-400 [.light-theme_&]:hover:!text-slate-800 [.light-theme_&]:hover:!bg-black/5 cursor-pointer"
              title="隐藏悬浮窗"
            >
              <X className="w-3.5 h-3.5" />
            </button>

            {/* 微型内置进度条 */}
            <div className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-transparent overflow-hidden pointer-events-none">
              <div 
                className={`h-full transition-all duration-300 ${isPaused ? 'bg-amber-500' : hasError ? 'bg-red-500' : 'bg-gradient-to-r from-[#a855f7] via-[#ec4899] to-[#a855f7] [.light-theme_&]:!from-blue-500 [.light-theme_&]:!to-indigo-500'}`}
                style={{ width: `${(progress.current / Math.max(1, progress.total)) * 100}%` }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// 全量扫描很重(遍历安卓存储目录 + 读取全部角色/聊天记录做比对),
// 不应该每次切回 App 都跑一遍。用一个节流窗口限制频率。
const FULL_SYNC_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5分钟
let lastFullSyncAt = 0;
let fullSyncInFlight: Promise<boolean | void> | null = null;

function throttledFullSync(force = false): Promise<boolean | void> {
  // 注意: .nomedia 的写入顺序保证已经下沉到 appBridge.ts 的 saveToGallery 内部,
  // 这里不需要再关心顺序问题, syncWithAndroidLocalDirectory 内部任何一次
  // saveToGallery 调用都会自动先确保 .nomedia 已经写完。
  const now = Date.now();
  if (!force && now - lastFullSyncAt < FULL_SYNC_MIN_INTERVAL_MS) {
    return Promise.resolve();
  }
  if (fullSyncInFlight) {
    // 已经有一次扫描在跑,不重复触发
    return fullSyncInFlight;
  }
  lastFullSyncAt = now;
  fullSyncInFlight = syncWithAndroidLocalDirectory()
    .catch(console.error)
    .finally(() => {
      fullSyncInFlight = null;
    });
  return fullSyncInFlight;
}

export default function App() {
  useEffect(() => {
    if (isAndroid()) {
      // 启动时强制跑一次,保证数据是最新的
      throttledFullSync(true);
      
      // 切回 App 时只在超过节流窗口时才重新全量扫描,
      // 避免频繁切换 App 时反复扫描目录 + 读取整个数据库
      const onFocus = () => {
        throttledFullSync(false);
      };
      window.addEventListener('focus', onFocus);
      return () => {
        window.removeEventListener('focus', onFocus);
      };
    }
  }, []);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [summaryModalChar, setSummaryModalChar] = useState<CharacterCard | null>(null);

  const handleSelectChar = useCallback(async (id: string | null, skipSummaryModal = false) => {
    if (!id) {
      setSelectedCharId(null);
      setSummaryModalChar(null);
      return;
    }
    const showSummaryPopup = localStorage.getItem('miu_show_summary_popup') !== 'false';
    if (skipSummaryModal || !showSummaryPopup) {
      setSelectedCharId(id);
      setSummaryModalChar(null);
      return;
    }
    try {
      const char = await getCharacter(id);
      if (char) {
        const charData = char.data?.data || char.data || {};
        const summary = char.aiSummary || charData.aiSummary;
        if (summary && summary.trim().length > 0) {
          setSummaryModalChar(char);
          return;
        }
      }
    } catch (e) {
      console.error('Error checking character summary:', e);
    }
    setSelectedCharId(id);
    setSummaryModalChar(null);
  }, []);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importModalInitialFiles, setImportModalInitialFiles] = useState<FileList | File[] | null>(null);
  const handleOpenImportModal = useCallback((files?: FileList | File[]) => {
    setImportModalInitialFiles(files || null);
    setIsImportModalOpen(true);
  }, []);
  const handleCloseCharacterDetail = useCallback(() => {
    setSelectedCharId(null);
    setRefreshKey(prev => prev + 1);
  }, []);
  useEffect(() => {
    const handleTriggerImport = (e: any) => {
      if (e.detail && e.detail.files) {
        handleOpenImportModal(e.detail.files);
      }
    };
    window.addEventListener('openImportModal', handleTriggerImport);
    return () => window.removeEventListener('openImportModal', handleTriggerImport);
  }, [handleOpenImportModal]);
  useEffect(() => {
    const handleCharactersUpdated = () => {
      setRefreshKey(prev => prev + 1);
    };
    window.addEventListener('charactersUpdated', handleCharactersUpdated);
    return () => window.removeEventListener('charactersUpdated', handleCharactersUpdated);
  }, []);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'api' | 'st' | 'cloud' | 'wallpaper' | 'about'>('api');
  const [refreshKey, setRefreshKey] = useState(0);
  const [isLightMode, setIsLightMode] = useState(() => document.documentElement.classList.contains('light-theme'));

  useEffect(() => {
    const checkTheme = () => {
      const isLight = document.documentElement.classList.contains('light-theme') || localStorage.getItem('tavern_theme') === 'light';
      setIsLightMode(isLight);
      if (isLight) {
        document.body.classList.add('light-theme');
        document.body.style.backgroundColor = '#eef4fe';
        document.documentElement.style.backgroundColor = '#eef4fe';
      } else {
        document.body.classList.remove('light-theme');
        document.body.style.backgroundColor = '#0a0a0c';
        document.documentElement.style.backgroundColor = '#0a0a0c';
      }
    };
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  const [globalChatViewerId, setGlobalChatViewerId] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<VersionInfo | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);

  useEffect(() => {
    // 启动 3 秒后静默检测远端版本更新
    const timer = setTimeout(async () => {
      const ignoredVer = localStorage.getItem('miu_ignored_version');
      const res = await checkForAppUpdates();
      if (res.hasUpdate && res.latestVersion) {
        if (ignoredVer !== res.latestVersion.version) {
          setUpdateInfo(res.latestVersion);
          setIsUpdateModalOpen(true);
        }
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, []);
  
  const [isMigrating, setIsMigrating] = useState(true);
  const [migrationProgress, setMigrationProgress] = useState({ current: 0, total: 0 });
  const [chatViewerBackSignal, setChatViewerBackSignal] = useState(0);
  const chatViewerHasInnerRef = useRef(false);

  // Refs for back button handling
  const stateRefs = useRef({
    isImportModalOpen,
    isSettingsOpen,
    globalChatViewerId,
    selectedCharId,
    isSidebarOpen,
    selectedFolderId
  });
  
  useEffect(() => {
    stateRefs.current = {
      isImportModalOpen,
      isSettingsOpen,
      globalChatViewerId,
      selectedCharId,
      isSidebarOpen,
      selectedFolderId
    };
  }, [isImportModalOpen, isSettingsOpen, globalChatViewerId, selectedCharId, isSidebarOpen, selectedFolderId]);

  useEffect(() => {
    if (!window.history.state?.isAppRoot) {
      window.history.replaceState({ isAppRoot: true }, '');
      window.history.pushState({ isAppForward: true }, '');
    }

    const handlePopState = (e: PopStateEvent) => {
      const state = stateRefs.current;
      let closedSomething = false;

      if (handleBackRequest()) {
        closedSomething = true;
      } else if (state.isImportModalOpen) {
        setIsImportModalOpen(false); closedSomething = true;
      } else if (state.isSettingsOpen) {
        setIsSettingsOpen(false); closedSomething = true;
      } else if (state.globalChatViewerId) {
        setGlobalChatViewerId(null); closedSomething = true;
      } else if (state.selectedCharId) {
        setSelectedCharId(null); 
        closedSomething = true;
        setRefreshKey(prev => prev + 1);
      } else if (state.isSidebarOpen) {
        setIsSidebarOpen(false); closedSomething = true;
      } else if (state.selectedFolderId) {
        closedSomething = true;
        if (state.selectedFolderId === 'chatviewer' && chatViewerHasInnerRef.current) {
          setChatViewerBackSignal((v) => v + 1);
        } else if (['trash', 'duplicates', 'autotagger', 'recommender', 'chatviewer', 'favorites'].includes(state.selectedFolderId)) {
          setSelectedFolderId(null);
        } else {
          getFolders().then(allFolders => {
            const current = allFolders.find(f => f.id === state.selectedFolderId);
            setSelectedFolderId(current?.parentId || null);
          });
        }
      }

      if (closedSomething) {
        window.history.pushState({ isAppForward: true }, '');
      } else {
        // Nothing to close, user wants to exit
        // On Android WebView, navigating back from root will exit the app
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    // 尽早触发 .nomedia 写入(具体的顺序保证在 appBridge.ts 里)
    import('./lib/appBridge').then(({ isAndroid, saveToGallery }) => {
      if (isAndroid()) {
        saveToGallery('.nomedia', new ArrayBuffer(0)).catch((e) => {
          console.error('写入 .nomedia 失败:', e);
        });
      }
    });

    let cleanupVisibility: (() => void) | null = null;
    let cleanupFocus: (() => void) | null = null;

    migrateDatabase((current, total) => {
      setMigrationProgress({ current, total });
    }).then(() => {
      setIsMigrating(false);
      // Run background maintenance asynchronously without blocking app startup
      setTimeout(() => {
        import('./lib/db').then(({ cleanupEmptyFolders, cleanupGhostCards }) => {
          cleanupEmptyFolders();
          cleanupGhostCards().then(({ cleanedCount }) => {
            if (cleanedCount > 0) {
              console.log(`[Startup] Cleaned ${cleanedCount} ghost card entries from database.`);
            }
          });
        });
      }, 500);
    });

    return () => {
    };
  }, []);

  // Back button handling for Capacitor Android (Swipe Back / Hardware Back)
  useEffect(() => {
    let listenerPromise: Promise<any> | null = null;
    import('@capacitor/app').then(({ App: CapacitorApp }) => {
      import('@capacitor/core').then(({ Capacitor }) => {
        if (Capacitor.isNativePlatform()) {
          listenerPromise = CapacitorApp.addListener('backButton', ({ canGoBack }) => {
            const state = stateRefs.current;
            let closedSomething = false;

            if (handleBackRequest()) {
              closedSomething = true;
            } else if (state.isImportModalOpen) {
              setIsImportModalOpen(false); closedSomething = true;
            } else if (state.isSettingsOpen) {
              setIsSettingsOpen(false); closedSomething = true;
            } else if (state.globalChatViewerId) {
              setGlobalChatViewerId(null); closedSomething = true;
            } else if (state.selectedCharId) {
              setSelectedCharId(null); closedSomething = true;
            } else if (state.isSidebarOpen) {
              setIsSidebarOpen(false); closedSomething = true;
            } else if (state.selectedFolderId) {
              closedSomething = true;
              if (state.selectedFolderId === 'chatviewer' && chatViewerHasInnerRef.current) {
                setChatViewerBackSignal((v) => v + 1);
              } else if (['trash', 'duplicates', 'autotagger', 'recommender', 'chatviewer', 'favorites'].includes(state.selectedFolderId)) {
                setSelectedFolderId(null);
              } else {
                getFolders().then(allFolders => {
                  const current = allFolders.find(f => f.id === state.selectedFolderId);
                  setSelectedFolderId(current?.parentId || null);
                });
              }
            }

            if (!closedSomething) {
              if (canGoBack) {
                window.history.back();
              } else {
                CapacitorApp.exitApp();
              }
            }
          });
        }
      });
    }).catch(() => {});
    
    return () => {
      if (listenerPromise) listenerPromise.then(l => l.remove());
    };
  }, []);

  if (isMigrating && migrationProgress.total > 0) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white p-6">
        <div className="w-16 h-16 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-6" />
        <h2 className="text-2xl font-bold mb-2">正在优化数据库...</h2>
        <p className="text-slate-400 mb-6 text-center max-w-md">
          检测到您有大量角色卡，系统正在进行底层存储优化以提升加载速度。这可能需要几分钟时间，请勿关闭页面。
        </p>
        <p className="font-mono text-blue-400 font-bold text-lg mb-2">
          {migrationProgress.current} / {migrationProgress.total}
        </p>
        <div className="w-full max-w-md bg-white/10 rounded-full h-3 overflow-hidden">
          <div 
            className="bg-gradient-to-r from-blue-500 to-pink-500 h-full transition-all duration-300"
            style={{ width: `${(migrationProgress.current / migrationProgress.total) * 100}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`font-sans antialiased fixed inset-0 flex overflow-hidden transition-colors duration-200 ${
      isLightMode ? 'light-theme bg-[#eef4fe] text-[#1c1c1e]' : 'bg-[#0a0a0c] text-white'
    }`}>
      
      {/* Sidebar Drawer */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className={`fixed inset-0 backdrop-blur-sm z-40 transition-colors ${
                isLightMode ? 'bg-black/25' : 'bg-black/60'
              }`}
            />
            
            <FolderSidebar 
              selectedFolderId={selectedFolderId}
              onSelectFolder={(id) => {
                setSelectedFolderId(id);
                setSelectedCharId(null);
              }}
              onClose={() => setIsSidebarOpen(false)}
              onOpenSettings={(tab) => {
                setSettingsInitialTab(tab || 'api');
                setIsSettingsOpen(true);
              }}
              onFolderChanged={() => setRefreshKey(prev => prev + 1)}
            />
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div id="main-scroll-container" className="flex-1 relative overflow-y-auto flex flex-col w-full h-full">
        {selectedFolderId === 'trash' ? (
          <TrashBin onClose={() => { setSelectedFolderId(null); setRefreshKey(prev => prev + 1); }} />
        ) : selectedFolderId === 'duplicates' ? (
          <DuplicateDetector 
            onClose={() => { setSelectedFolderId(null); setRefreshKey(prev => prev + 1); }} 
            onSelectChar={handleSelectChar}
          />
        ) : selectedFolderId === 'autotagger' ? (
          <AutoTagger onClose={() => { setSelectedFolderId(null); setRefreshKey(prev => prev + 1); }} onOpenSettings={() => setIsSettingsOpen(true)} />
        ) : selectedFolderId === 'recommender' ? (
          <AIRecommender 
            onClose={() => { setSelectedFolderId(null); setRefreshKey(prev => prev + 1); }} 
            onSelectChar={handleSelectChar}
            onOpenSettings={() => setIsSettingsOpen(true)} 
          />
        ) : selectedFolderId === 'chatviewer' ? (
          <ChatViewer 
            onClose={() => { setSelectedFolderId(null); setRefreshKey(prev => prev + 1); }} 
            onOpenImport={handleOpenImportModal}
            refreshKey={refreshKey}
            onActiveViewChange={(hasInner) => { chatViewerHasInnerRef.current = hasInner; }}
            backSignal={chatViewerBackSignal}
            isLightMode={isLightMode}
          />
        ) : (
          <CharacterList
            key={selectedFolderId}
            folderId={selectedFolderId}
            onSelect={handleSelectChar}
            onImport={() => setIsImportModalOpen(true)}
            onSelectFolder={(id) => {
              setSelectedFolderId(id);
              setSelectedCharId(null);
            }}
            onOpenSidebar={() => setIsSidebarOpen(true)}
            refreshTrigger={refreshKey}
            isDetailOpen={!!selectedCharId}
            isLightMode={isLightMode}
          />
        )}

        <AnimatePresence>
          {summaryModalChar && (
            <CharacterSummaryModal
              character={summaryModalChar}
              onClose={() => setSummaryModalChar(null)}
              onOpenDetail={(id) => handleSelectChar(id, true)}
              onOpenChat={(id) => {
                setSummaryModalChar(null);
                setGlobalChatViewerId(id);
              }}
              onSummaryUpdated={() => setRefreshKey(prev => prev + 1)}
              isLightMode={isLightMode}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {selectedCharId && (
            <CharacterDetail
              key={selectedCharId}
              id={selectedCharId}
              onBack={handleCloseCharacterDetail}
              onOpenChat={setGlobalChatViewerId}
              onOpenImport={handleOpenImportModal}
              refreshKey={refreshKey}
              isLightMode={isLightMode}
            />
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {globalChatViewerId && (
          <motion.div 
             className="fixed inset-0 z-[60] bg-slate-900 flex flex-col"
             initial={{ opacity: 0, scale: 0.95 }}
             animate={{ opacity: 1, scale: 1 }}
             exit={{ opacity: 0, scale: 0.95 }}
             transition={{ duration: 0.2 }}
          >
            <ChatViewer 
              initialChatId={globalChatViewerId} 
              singleMode={true}
              onClose={() => setGlobalChatViewerId(null)} 
              onOpenImport={handleOpenImportModal}
              refreshKey={refreshKey}
              isLightMode={isLightMode}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => {
          setIsImportModalOpen(false);
          setImportModalInitialFiles(null);
        }}
        onImported={() => setRefreshKey(prev => prev + 1)}
        onNavigateFolder={(id) => {
          setSelectedFolderId(id);
          setSelectedCharId(null);
        }}
        folderId={selectedFolderId}
        initialFiles={importModalInitialFiles}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        initialTab={settingsInitialTab}
        isLightMode={isLightMode}
        onClose={() => { setIsSettingsOpen(false); setRefreshKey(prev => prev + 1); }}
      />

      <UpdateModal
        isOpen={isUpdateModalOpen}
        versionInfo={updateInfo}
        isLightMode={isLightMode}
        onClose={() => setIsUpdateModalOpen(false)}
        onIgnoreVersion={(ver) => localStorage.setItem('miu_ignored_version', ver)}
      />

      <AnimatePresence>
        {selectedFolderId !== 'autotagger' && (
          <TaggerWidget onClick={() => {
            setSelectedCharId(null);
            setIsSidebarOpen(false);
            setIsImportModalOpen(false);
            setIsSettingsOpen(false);
            setSelectedFolderId('autotagger');
          }} />
        )}
      </AnimatePresence>

      <SyncWidget isLightMode={isLightMode} />
    </div>
  );
}
