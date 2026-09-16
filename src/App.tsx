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
import { migrateDatabase } from './lib/db';
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
            initial={{ opacity: 0, y: -50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -50, x: '-50%' }}
            className="fixed top-6 left-1/2 z-[100] bg-red-500 text-white px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3"
          >
            <AlertCircle className="w-5 h-5" />
            <span className="font-medium">{errorToast}</span>
            <button onClick={() => setErrorToast(null)} className="p-1 hover:bg-white/20 rounded-full transition">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {shouldShow && (
          <motion.div
            initial={{ opacity: 0, y: -50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -50, x: '-50%' }}
            onClick={onClick}
            className="fixed top-12 sm:top-20 left-1/2 z-50 bg-slate-800/90 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl p-3 sm:p-4 cursor-pointer hover:bg-slate-700/90 transition-colors w-[90%] max-w-[16rem] sm:w-72"
          >
            <div className="flex items-center gap-3 mb-2">
              {isPaused ? (
                <Pause className="w-5 h-5 text-yellow-400" />
              ) : hasError ? (
                <AlertCircle className="w-5 h-5 text-red-400" />
              ) : (
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
              )}
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-white">
                  {isPaused ? '自动打标已暂停' : hasError ? '自动打标遇到错误' : '正在后台打标...'}
                </h4>
                <p className="text-xs text-white/50">
                  进度: {progress.current} / {progress.total} (成功: {progress.success})
                </p>
              </div>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  import('./lib/taggerState').then(({ taggerState }) => taggerState.dismiss());
                }}
                className="p-1 hover:bg-white/20 rounded-full transition text-white/60 hover:text-white shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="w-full bg-black/40 rounded-full h-1.5 overflow-hidden relative">
              <div 
                className={`h-full transition-all duration-500 relative ${isPaused ? 'bg-yellow-500' : hasError ? 'bg-red-500' : 'bg-gradient-to-r from-purple-500 to-blue-500'}`}
                style={{ width: `${(progress.current / Math.max(1, progress.total)) * 100}%` }}
              >
                <div className="absolute inset-0 bg-white/20 animate-pulse" />
              </div>
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
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importModalInitialFiles, setImportModalInitialFiles] = useState<FileList | File[] | null>(null);
  const handleOpenImportModal = useCallback((files?: FileList | File[]) => {
    setImportModalInitialFiles(files || null);
    setIsImportModalOpen(true);
  }, []);
  const handleCloseCharacterDetail = useCallback(() => {
    setSelectedCharId(null);
    setTimeout(() => setRefreshKey(prev => prev + 1), 400);
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
  const [refreshKey, setRefreshKey] = useState(0);
  const [globalChatViewerId, setGlobalChatViewerId] = useState<string | null>(null);
  
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
        setSelectedCharId(null); closedSomething = true;
      } else if (state.isSidebarOpen) {
        setIsSidebarOpen(false); closedSomething = true;
      } else if (state.selectedFolderId) {
        closedSomething = true;
        if (state.selectedFolderId === 'chatviewer' && chatViewerHasInnerRef.current) {
          setChatViewerBackSignal((v) => v + 1);
        } else if (['trash', 'duplicates', 'autotagger', 'recommender', 'chatviewer'].includes(state.selectedFolderId)) {
          setSelectedFolderId(null);
        } else {
          import('./lib/db').then(({ getFolders }) => {
            getFolders().then(allFolders => {
              const current = allFolders.find(f => f.id === state.selectedFolderId);
              setSelectedFolderId(current?.parentId || null);
            });
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
      import('./lib/db').then(({ cleanupEmptyFolders }) => {
        cleanupEmptyFolders().then(() => {
          setIsMigrating(false);
          // Removed startup background scanning per user request
        });
      });
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
              } else if (['trash', 'duplicates', 'autotagger', 'recommender', 'chatviewer'].includes(state.selectedFolderId)) {
                setSelectedFolderId(null);
              } else {
                import('./lib/db').then(({ getFolders }) => {
                  getFolders().then(allFolders => {
                    const current = allFolders.find(f => f.id === state.selectedFolderId);
                    setSelectedFolderId(current?.parentId || null);
                  });
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
        <div className="w-16 h-16 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-6" />
        <h2 className="text-2xl font-bold mb-2">正在优化数据库...</h2>
        <p className="text-slate-400 mb-6 text-center max-w-md">
          检测到您有大量角色卡，系统正在进行底层存储优化以提升加载速度。这可能需要几分钟时间，请勿关闭页面。
        </p>
        <p className="font-mono text-purple-400 font-bold text-lg mb-2">
          {migrationProgress.current} / {migrationProgress.total}
        </p>
        <div className="w-full max-w-md bg-white/10 rounded-full h-3 overflow-hidden">
          <div 
            className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all duration-300"
            style={{ width: `${(migrationProgress.current / migrationProgress.total) * 100}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="font-sans antialiased text-white bg-slate-900 fixed inset-0 flex overflow-hidden">
      
      {/* Sidebar Drawer */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            />
            
            <FolderSidebar 
              selectedFolderId={selectedFolderId}
              onSelectFolder={(id) => {
                setSelectedFolderId(id);
                setSelectedCharId(null);
              }}
              onClose={() => setIsSidebarOpen(false)}
              onOpenSettings={() => setIsSettingsOpen(true)}
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
            onSelectChar={setSelectedCharId}
          />
        ) : selectedFolderId === 'autotagger' ? (
          <AutoTagger onClose={() => { setSelectedFolderId(null); setRefreshKey(prev => prev + 1); }} onOpenSettings={() => setIsSettingsOpen(true)} />
        ) : selectedFolderId === 'recommender' ? (
          <AIRecommender 
            onClose={() => { setSelectedFolderId(null); setRefreshKey(prev => prev + 1); }} 
            onSelectChar={setSelectedCharId}
            onOpenSettings={() => setIsSettingsOpen(true)} 
          />
        ) : selectedFolderId === 'chatviewer' ? (
          <ChatViewer 
            onClose={() => { setSelectedFolderId(null); setRefreshKey(prev => prev + 1); }} 
            onOpenImport={handleOpenImportModal}
            refreshKey={refreshKey}
            onActiveViewChange={(hasInner) => { chatViewerHasInnerRef.current = hasInner; }}
            backSignal={chatViewerBackSignal}
          />
        ) : (
          <CharacterList
            key={selectedFolderId}
            folderId={selectedFolderId}
            onSelect={setSelectedCharId}
            onImport={() => setIsImportModalOpen(true)}
            onSelectFolder={(id) => {
              setSelectedFolderId(id);
              setSelectedCharId(null);
            }}
            onOpenSidebar={() => setIsSidebarOpen(true)}
            refreshTrigger={refreshKey}
          />
        )}

        <AnimatePresence>
          {selectedCharId && (
            <CharacterDetail
              key={selectedCharId}
              id={selectedCharId}
              onBack={handleCloseCharacterDetail}
              onOpenChat={setGlobalChatViewerId}
              onOpenImport={handleOpenImportModal}
              refreshKey={refreshKey}
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
        folderId={selectedFolderId}
        initialFiles={importModalInitialFiles}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => { setIsSettingsOpen(false); setRefreshKey(prev => prev + 1); }}
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

      <SyncWidget />
    </div>
  );
}
