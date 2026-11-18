/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CharacterList } from './components/CharacterList';
import { CharacterDetail } from './components/CharacterDetail';
import { SyncWidget } from './components/SyncWidget';
import { checkForAppUpdates, VersionInfo } from './config/version';
import { migrateDatabase, getFolders, getCharacterFast, peekCharacterMeta, CharacterCard } from './lib/db';
import { useTaggerState } from './lib/taggerState';
import { isAndroid } from './lib/appBridge';
import { handleBackRequest } from './lib/useBackHandler';
import { Tag, Loader2, AlertCircle, Pause, X, CheckCircle2 } from 'lucide-react';

const ImportModal = lazy(() => import('./components/ImportModal').then(m => ({ default: m.ImportModal })));
const FolderSidebar = lazy(() => import('./components/FolderSidebar').then(m => ({ default: m.FolderSidebar })));
const TrashBin = lazy(() => import('./components/TrashBin').then(m => ({ default: m.TrashBin })));
const DuplicateDetector = lazy(() => import('./components/DuplicateDetector').then(m => ({ default: m.DuplicateDetector })));
const AutoTagger = lazy(() => import('./components/AutoTagger').then(m => ({ default: m.AutoTagger })));
const AIRecommender = lazy(() => import('./components/AIRecommender').then(m => ({ default: m.AIRecommender })));
const SettingsModal = lazy(() => import('./components/SettingsModal').then(m => ({ default: m.SettingsModal })));
const ChatViewer = lazy(() => import('./components/ChatViewer').then(m => ({ default: m.ChatViewer })));
const UpdateModal = lazy(() => import('./components/UpdateModal').then(m => ({ default: m.UpdateModal })));
const CharacterSummaryModal = lazy(() => import('./components/CharacterSummaryModal').then(m => ({ default: m.CharacterSummaryModal })));
const UserPersonaManager = lazy(() => import('./components/UserPersonaManager').then(m => ({ default: m.UserPersonaManager })));

function LazyViewFallback() {
  return null;
}

function TaggerWidget({ onClick }: { onClick: () => void }) {
  const { isTagging, taggingMode, isPaused, isCompleted, progress, logs } = useTaggerState();
  const [errorToast, setErrorToast] = useState<string | null>(null);

  useEffect(() => {
    import('./lib/taggerState').then(({ taggerState }) => {
      taggerState.setErrorCallback((msg) => {
        setErrorToast(msg);
        setTimeout(() => setErrorToast(null), 5000);
      });
    }).catch((e) => console.error('taggerState 加载失败:', e));
  }, []);

  useEffect(() => {
    if (isCompleted) {
      // 保持完成状态至少 60 秒常驻，让用户切到卡里也能清楚知道已完成；用户也可随时点击 X 提前关闭
      const timer = setTimeout(() => {
        import('./lib/taggerState').then(({ taggerState }) => {
          taggerState.clearCompleted();
        }).catch((e) => console.error('taggerState 加载失败:', e));
      }, 60000);
      return () => clearTimeout(timer);
    }
  }, [isCompleted]);
  
  // Only show if tagging is active, paused, recently completed, or there's a recent error
  const hasError = logs.some(l => l.status === 'failed');
  const shouldShow = isTagging || isPaused || isCompleted || (hasError && progress.current > 0 && progress.current < progress.total);

  const isSummary = taggingMode === 'summary';
  const actionLabel = isSummary ? '总结' : '打标';

  return (
    <>
      <AnimatePresence>
        {errorToast && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            style={{ top: 'max(1.25rem, calc(env(safe-area-inset-top, 0px) + 0.5rem))' }}
            className="fixed left-1/2 z-[610] ios-toast ios-toast-error px-4 py-2.5 rounded-full flex items-center gap-2.5 max-w-[92vw] sm:max-w-md w-auto pointer-events-auto miu-skin shadow-2xl"
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
            style={{
              top: errorToast 
                ? 'max(4.5rem, calc(env(safe-area-inset-top, 0px) + 3.5rem))' 
                : 'max(1.25rem, calc(env(safe-area-inset-top, 0px) + 0.5rem))'
            }}
            className="tagger-floating-pill fixed left-1/2 z-[600] rounded-full px-4 py-2 sm:px-4.5 sm:py-2.5 flex items-center gap-2.5 max-w-[92vw] w-auto cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-all overflow-hidden group select-none shadow-2xl"
            title={`点击打开${actionLabel}面板`}
          >
            {isCompleted ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 [.light-theme_&]:!text-emerald-600" />
            ) : isPaused ? (
              <Pause className="w-4 h-4 text-yellow-400 shrink-0 [.light-theme_&]:!text-amber-500" />
            ) : hasError ? (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 [.light-theme_&]:!text-red-500" />
            ) : (
              <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0 [.light-theme_&]:!text-blue-600" />
            )}
            
            <span className="text-xs sm:text-sm font-medium text-slate-100 whitespace-nowrap tagger-floating-text [.light-theme_&]:!text-[#0f172a]">
              {isCompleted ? `${actionLabel}已完成` : isPaused ? `${actionLabel}已暂停` : hasError ? `${actionLabel}遇到错误` : `自动${actionLabel}中`}
            </span>

            <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full shrink-0 border-0 border-none outline-none ${
              isCompleted
                ? 'text-emerald-300 bg-emerald-500/20 [.light-theme_&]:!text-emerald-700 [.light-theme_&]:!bg-emerald-100'
                : 'text-blue-300 bg-blue-500/20 [.light-theme_&]:!text-blue-600 [.light-theme_&]:!bg-blue-50'
            }`}>
              {isCompleted ? `${progress.success || progress.total}/${progress.total}` : `${progress.current}/${progress.total}`}
            </span>

            <button 
              onClick={(e) => {
                e.stopPropagation();
                import('./lib/taggerState').then(({ taggerState }) => {
                  if (isCompleted) {
                    taggerState.clearCompleted();
                  } else {
                    if (window.confirm(`确定要停止当前的自动${actionLabel}任务吗？`)) {
                      taggerState.stopTagging();
                    }
                  }
                }).catch((e) => console.error('taggerState 加载失败:', e));
              }}
              className="p-1 hover:bg-white/20 rounded-full transition text-white/50 hover:text-white shrink-0 ml-0.5 tagger-floating-close [.light-theme_&]:!text-slate-400 [.light-theme_&]:hover:!text-[#0f172a] [.light-theme_&]:hover:!bg-black/5 cursor-pointer"
              title={isCompleted ? "关闭提示" : `停止${actionLabel}任务`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [selectedCharPreview, setSelectedCharPreview] = useState<CharacterCard | null>(null);
  const [summaryModalChar, setSummaryModalChar] = useState<CharacterCard | null>(null);
  const selectReqIdRef = useRef(0);

  const buildPreviewCard = (id: string): CharacterCard | null => {
    const meta = peekCharacterMeta(id);
    if (!meta) return null;
    return {
      ...meta,
      tokenCount: meta.tokenCount,
      permanentTokens: meta.permanentTokens,
      data: meta.creator ? { creator: meta.creator } : {},
    } as unknown as CharacterCard;
  };

  const handleSelectChar = useCallback(async (id: string | null, skipSummaryModal = false) => {
    const reqId = ++selectReqIdRef.current;
    if (!id) {
      setSelectedCharId(null);
      setSelectedCharPreview(null);
      setSummaryModalChar(null);
      return;
    }
    const showSummaryPopup = localStorage.getItem('miu_show_summary_popup') !== 'false';
    const cachedMeta = peekCharacterMeta(id);
    if (skipSummaryModal || !showSummaryPopup || (cachedMeta && !cachedMeta.aiSummary?.trim())) {
      setSelectedCharPreview(buildPreviewCard(id));
      setSelectedCharId(id);
      setSummaryModalChar(null);
      return;
    }

    try {
      const char = await getCharacterFast(id);
      if (reqId !== selectReqIdRef.current) return;
      if (char) {
        const charData = char.data?.data || char.data || {};
        const summary = char.aiSummary || charData.aiSummary;
        if (summary && summary.trim().length > 0) {
          setSummaryModalChar(char);
          return;
        }
        setSelectedCharPreview(char);
      } else {
        setSelectedCharPreview(buildPreviewCard(id));
      }
    } catch (e) {
      console.error('Error checking character summary:', e);
      setSelectedCharPreview(buildPreviewCard(id));
    }
    if (reqId !== selectReqIdRef.current) return;
    setSelectedCharId(id);
    setSummaryModalChar(null);
  }, []);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [hasOpenedImport, setHasOpenedImport] = useState(false);
  const [importModalInitialFiles, setImportModalInitialFiles] = useState<FileList | File[] | null>(null);
  const handleOpenImportModal = useCallback((files?: FileList | File[]) => {
    setImportModalInitialFiles(files || null);
    setHasOpenedImport(true);
    setIsImportModalOpen(true);
  }, []);
  useEffect(() => {
    if (isImportModalOpen) setHasOpenedImport(true);
  }, [isImportModalOpen]);
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
  const [hasOpenedSettings, setHasOpenedSettings] = useState(false);
  useEffect(() => {
    if (isSettingsOpen) setHasOpenedSettings(true);
  }, [isSettingsOpen]);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'api' | 'st' | 'tt' | 'cloud' | 'wallpaper' | 'about'>('api');
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
  const [hasOpenedUpdate, setHasOpenedUpdate] = useState(false);
  useEffect(() => {
    if (isUpdateModalOpen) setHasOpenedUpdate(true);
  }, [isUpdateModalOpen]);

  useEffect(() => {
    const handleOpenUpdate = (e: any) => {
      if (e.detail) {
        setUpdateInfo(e.detail);
        setIsUpdateModalOpen(true);
      }
    };
    const handleOpenAISettings = () => setIsSettingsOpen(true);
    window.addEventListener('openUpdateModal', handleOpenUpdate);
    window.addEventListener('openAISettings', handleOpenAISettings);
    return () => {
      window.removeEventListener('openUpdateModal', handleOpenUpdate);
      window.removeEventListener('openAISettings', handleOpenAISettings);
    };
  }, []);

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
        } else if (['trash', 'duplicates', 'autotagger', 'recommender', 'chatviewer', 'favorites', 'userpersonas'].includes(state.selectedFolderId)) {
          setSelectedFolderId(null);
        } else {
          getFolders().then(allFolders => {
            const current = allFolders.find(f => f.id === state.selectedFolderId);
            setSelectedFolderId(current?.parentId || null);
          }).catch((e) => console.error('getFolders 失败:', e));
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
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    migrateDatabase((current, total) => {
      setMigrationProgress({ current, total });
    }).then(() => {
      setIsMigrating(false);
      // 延迟到首屏加载和卡片渲染完成之后再静默清理幽灵索引记录，绝不抢占启动期 IndexedDB 带宽
      idleTimer = setTimeout(() => {
        import('./lib/db').then(({ cleanupGhostCards }) => {
          cleanupGhostCards().then(({ cleanedCount }) => {
            if (cleanedCount > 0) {
              console.log(`[Startup] Cleaned ${cleanedCount} ghost card entries from database.`);
            }
          }).catch((e) => console.error('[Startup] cleanupGhostCards 失败:', e));
        }).catch((e) => console.error('[Startup] 维护模块加载失败:', e));
      }, 5000);
    }).catch((err) => {
      console.error('[Startup] 数据库迁移失败:', err);
      setIsMigrating(false);
    });

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
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
              } else if (['trash', 'duplicates', 'autotagger', 'recommender', 'chatviewer', 'favorites', 'userpersonas'].includes(state.selectedFolderId)) {
                setSelectedFolderId(null);
              } else {
                getFolders().then(allFolders => {
                  const current = allFolders.find(f => f.id === state.selectedFolderId);
                  setSelectedFolderId(current?.parentId || null);
                }).catch((e) => console.error('getFolders 失败:', e));
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
      }).catch(() => {});
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
      <Suspense fallback={null}>
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
      </Suspense>

      {/* Main Content */}
      <div id="main-scroll-container" className="flex-1 relative overflow-y-auto flex flex-col w-full h-full">
        <Suspense fallback={<LazyViewFallback />}>
          {selectedFolderId === 'userpersonas' ? (
            <UserPersonaManager onClose={() => setSelectedFolderId(null)} isLightMode={isLightMode} />
          ) : selectedFolderId === 'trash' ? (
            <TrashBin onClose={() => { setSelectedFolderId(null); setRefreshKey(prev => prev + 1); }} />
          ) : selectedFolderId === 'duplicates' ? (
            <DuplicateDetector 
              onClose={() => { setSelectedFolderId(null); setRefreshKey(prev => prev + 1); }} 
              onSelectChar={handleSelectChar}
              refreshTrigger={refreshKey}
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
        </Suspense>

        <Suspense fallback={null}>
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
        </Suspense>

        <AnimatePresence>
          {selectedCharId && (
            <CharacterDetail
              key={selectedCharId}
              id={selectedCharId}
              initialCharacter={selectedCharPreview}
              onBack={handleCloseCharacterDetail}
              onOpenChat={setGlobalChatViewerId}
              onOpenImport={handleOpenImportModal}
              onOpenSettings={() => setIsSettingsOpen(true)}
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
            <Suspense fallback={<LazyViewFallback />}>
              <ChatViewer 
                initialChatId={globalChatViewerId} 
                singleMode={true}
                onClose={() => setGlobalChatViewerId(null)} 
                onOpenImport={handleOpenImportModal}
                refreshKey={refreshKey}
                isLightMode={isLightMode}
              />
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>

      {hasOpenedImport && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}

      {hasOpenedSettings && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={isSettingsOpen}
            initialTab={settingsInitialTab}
            isLightMode={isLightMode}
            onClose={() => { setIsSettingsOpen(false); setRefreshKey(prev => prev + 1); }}
            onImportFiles={(files) => {
              // TT 本地接收：先关掉设置页，再把卡片交给导入弹窗（复用现成的导入流程）
              setIsSettingsOpen(false);
              handleOpenImportModal(files);
            }}
          />
        </Suspense>
      )}

      {hasOpenedUpdate && (
        <Suspense fallback={null}>
          <UpdateModal
            isOpen={isUpdateModalOpen}
            versionInfo={updateInfo}
            isLightMode={isLightMode}
            onClose={() => setIsUpdateModalOpen(false)}
            onIgnoreVersion={(ver) => localStorage.setItem('miu_ignored_version', ver)}
          />
        </Suspense>
      )}

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

      <SyncWidget 
        isLightMode={isLightMode} 
        onOpenSync={() => {
          setSelectedCharId(null);
          setSettingsInitialTab('cloud');
          setIsSettingsOpen(true);
        }}
      />
    </div>
  );
}
