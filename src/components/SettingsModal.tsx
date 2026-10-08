import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Globe, CheckCircle2, AlertCircle, Loader2, RefreshCw, Plus, Trash2, ChevronDown, ChevronUp, Save } from 'lucide-react';
import { AISettings, CustomEndpoint, getAISettings, saveAISettings, testConnection, fetchCustomModels } from '../lib/ai';
import { CloudSyncTab } from './CloudSyncTab';
import { SidebarWallpaperTab } from './SidebarWallpaperTab';
import { useSidebarWallpaper, saveSidebarWallpaperConfig } from '../lib/sidebarWallpaper';
import { useBackHandler } from '../lib/useBackHandler';
import { CURRENT_APP_VERSION } from '../config/version';
import { openExternalUrl } from '../lib/appBridge';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'api' | 'st' | 'cloud' | 'wallpaper' | 'about';
  isLightMode?: boolean;
}

export function SettingsModal({ isOpen, onClose, initialTab = 'api', isLightMode: propIsLightMode }: Props) {
  const [isLightMode, setIsLightMode] = useState(() => {
    if (typeof propIsLightMode === 'boolean') return propIsLightMode;
    return (
      document.documentElement.classList.contains('light-theme') ||
      localStorage.getItem('tavern_theme') === 'light'
    );
  });

  useEffect(() => {
    if (typeof propIsLightMode === 'boolean') {
      setIsLightMode(propIsLightMode);
      return;
    }
    const checkTheme = () => {
      setIsLightMode(
        document.documentElement.classList.contains('light-theme') ||
        localStorage.getItem('tavern_theme') === 'light'
      );
    };
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    window.addEventListener('storage', checkTheme);
    return () => {
      observer.disconnect();
      window.removeEventListener('storage', checkTheme);
    };
  }, [propIsLightMode]);

  const [settings, setSettings] = useState<AISettings>(getAISettings());
  const [activeTab, setActiveTab] = useState<'api' | 'st' | 'cloud' | 'wallpaper' | 'about'>(initialTab);
  const [wallpaperConfig, setWallpaperConfig] = useSidebarWallpaper();
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<{ msg: string; isError?: boolean; downloadUrl?: string; versionInfo?: any } | null>(null);
  const [isStSetupOpen, setIsStSetupOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMsg, setTestMsg] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [apiStatus, setApiStatus] = useState<'idle' | 'success' | 'error'>('idle');

  useBackHandler(isOpen, () => {
    onClose();
    return true;
  });

  useEffect(() => {
    if (isOpen) {
      setSettings(getAISettings());
      setActiveTab(initialTab);
      setTestStatus('idle');
      setTestMsg('');
      setApiStatus('idle');
      setAvailableModels([]);
    }
  }, [isOpen, initialTab]);

  const activeEndpoint = settings.customEndpoints.find(e => e.id === settings.activeCustomId) || settings.customEndpoints[0];

  const updateActiveEndpoint = (updates: Partial<CustomEndpoint>) => {
    setSettings(prev => ({
      ...prev,
      customEndpoints: prev.customEndpoints.map(e => e.id === prev.activeCustomId ? { ...e, ...updates } : e)
    }));
  };

  const handleAddEndpoint = () => {
    const newId = Date.now().toString();
    setSettings(prev => ({
      ...prev,
      customEndpoints: [
        ...prev.customEndpoints,
        {
          id: newId,
          name: `新接口 ${prev.customEndpoints.length + 1}`,
          url: '',
          key: '',
          model: ''
        }
      ],
      activeCustomId: newId
    }));
    setApiStatus('idle');
    setTestStatus('idle');
  };

  const handleDeleteEndpoint = () => {
    if (settings.customEndpoints.length <= 1) return;
    setSettings(prev => {
      const nextEndpoints = prev.customEndpoints.filter(e => e.id !== prev.activeCustomId);
      return {
        ...prev,
        customEndpoints: nextEndpoints,
        activeCustomId: nextEndpoints[0].id
      };
    });
    setApiStatus('idle');
    setTestStatus('idle');
  };

  const handleSave = () => {
    saveAISettings(settings);
    saveSidebarWallpaperConfig(wallpaperConfig);
    onClose();
  };

  const handleTest = async () => {
    setTestStatus('testing');
    setTestMsg('');
    const res = await testConnection(settings);
    if (res.success) {
      setTestStatus('success');
      setTestMsg(res.message || '连接成功');
      if (settings.type === 'custom') setApiStatus('success');
    } else {
      setTestStatus('error');
      setTestMsg(res.message || '连接失败');
      if (settings.type === 'custom') setApiStatus('error');
    }
  };

  const handleFetchModels = async () => {
    if (!activeEndpoint.url || !activeEndpoint.key) {
      setTestStatus('error');
      setTestMsg('请先填写 API 地址和 Key');
      setApiStatus('error');
      return;
    }
    setIsFetchingModels(true);
    setTestStatus('testing');
    setTestMsg('正在获取模型列表...');
    try {
      const models = await fetchCustomModels(activeEndpoint.url, activeEndpoint.key);
      setAvailableModels(models);
      if (models.length > 0 && !models.includes(activeEndpoint.model)) {
        updateActiveEndpoint({ model: models[0] });
      }
      setTestStatus('success');
      setTestMsg(`成功获取 ${models.length} 个模型`);
      setApiStatus('success');
    } catch (e: any) {
      setTestStatus('error');
      setTestMsg(`获取模型失败: ${e.message}`);
      setApiStatus('error');
    } finally {
      setIsFetchingModels(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={`fixed inset-0 z-[100] flex flex-col sm:items-center sm:justify-center sm:p-4 select-none ${
          isLightMode ? 'light-theme bg-black/35' : 'bg-slate-950 sm:bg-black/70 backdrop-blur-sm'
        }`}
      >
        <motion.div
          initial={{ scale: 0.98, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.98, opacity: 0 }}
          className={`w-full h-[100dvh] sm:h-auto sm:max-h-[90vh] ${
            activeTab === 'cloud' || activeTab === 'wallpaper' ? 'sm:max-w-4xl' : 'sm:max-w-lg'
          } sm:rounded-3xl overflow-hidden shadow-2xl flex flex-col transition-all duration-200 bg-slate-900 [.light-theme_&]:!bg-[#ffffff] text-slate-100 [.light-theme_&]:!text-[#0f172a] sm:border sm:border-white/10 [.light-theme_&]:sm:!border-[#e2e8f0]`}
        >
          {/* Top Header */}
          <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:py-3.5 border-b border-white/10 [.light-theme_&]:!border-[#e2e8f0] bg-slate-900/90 [.light-theme_&]:!bg-[#ffffff] shrink-0">
            <h2 className="text-base sm:text-lg font-bold text-slate-100 [.light-theme_&]:!text-[#0f172a]">
              设置
            </h2>
            <button 
              onClick={onClose} 
              className="p-2 -mr-1 rounded-full transition cursor-pointer active:scale-95 text-slate-400 hover:text-slate-100 hover:bg-white/10 [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#0f172a] [.light-theme_&]:hover:!bg-black/5"
              title="关闭"
            >
              <X className="w-5 h-5 sm:w-4 sm:h-4" />
            </button>
          </div>

          {/* Navigation Tab Bar */}
          <div className="flex px-4 pt-1.5 border-b border-white/10 [.light-theme_&]:!border-[#e2e8f0] shrink-0 gap-3 sm:gap-6 overflow-x-auto hide-scrollbar bg-slate-900/60 [.light-theme_&]:!bg-[#ffffff]">
            {[
              { id: 'api', label: 'API 设置' },
              { id: 'st', label: '酒馆联动' },
              { id: 'cloud', label: '云端同步' },
              { id: 'wallpaper', label: '侧栏壁纸' },
              { id: 'about', label: '关于与更新' },
            ].map(tab => (
              <button 
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`pb-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer flex items-center justify-center ${
                  activeTab === tab.id
                    ? 'border-white text-white [.light-theme_&]:!border-[#0f172a] [.light-theme_&]:!text-[#0f172a]'
                    : 'border-transparent text-white/50 hover:text-white [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#0f172a]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          
          <div className="flex-1 p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto custom-scrollbar">
            {activeTab === 'api' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                
                {/* Profile Selector */}
                <div className="flex items-center gap-2">
                  <select
                    value={settings.activeCustomId}
                    onChange={(e) => {
                      setSettings({ ...settings, activeCustomId: e.target.value });
                      setApiStatus('idle');
                      setTestStatus('idle');
                      setTestMsg('');
                    }}
                    className="flex-1 rounded-xl px-3.5 py-2.5 text-sm appearance-none transition focus:outline-none bg-black/40 border border-white/10 text-white [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a]"
                  >
                    {settings.customEndpoints.map(e => (
                      <option key={e.id} value={e.id} className="bg-slate-900 text-slate-100 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!text-[#0f172a]">
                        {e.name}
                      </option>
                    ))}
                  </select>
                  <button 
                    onClick={handleAddEndpoint} 
                    className="p-2.5 rounded-xl border transition cursor-pointer bg-white/5 border-white/10 text-white/70 hover:text-white hover:bg-white/10 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:hover:!bg-[#e2e8f0]"
                    title="添加新接口"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  {settings.customEndpoints.length > 1 && (
                    <button 
                      onClick={handleDeleteEndpoint} 
                      className="p-2.5 rounded-xl border transition cursor-pointer bg-white/5 border-white/10 text-white/50 hover:text-rose-400 hover:bg-white/10 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-rose-600 [.light-theme_&]:hover:!bg-rose-50"
                      title="删除当前接口"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 text-white/80 [.light-theme_&]:!text-[#0f172a]">
                    接口名称 (备注)
                  </label>
                  <input
                    type="text"
                    value={activeEndpoint.name}
                    onChange={(e) => updateActiveEndpoint({ name: e.target.value })}
                    placeholder="例如：DeepSeek、本地Ollama"
                    className="w-full rounded-xl px-4 py-2.5 text-sm transition focus:outline-none bg-black/40 border border-white/10 text-white placeholder:text-white/20 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:placeholder:!text-[#94a3b8]"
                  />
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <label className="block text-sm font-medium text-white/80 [.light-theme_&]:!text-[#0f172a]">
                      API 地址 (Base URL)
                    </label>
                    {apiStatus === 'success' && <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-xs" title="已连接" />}
                    {apiStatus === 'error' && <div className="w-2.5 h-2.5 rounded-full bg-rose-500" title="连接失败" />}
                  </div>
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 [.light-theme_&]:!text-[#94a3b8]" />
                    <input
                      type="text"
                      value={activeEndpoint.url}
                      onChange={(e) => updateActiveEndpoint({ url: e.target.value })}
                      placeholder="https://api.openai.com/v1"
                      className="w-full rounded-xl pl-10 pr-4 py-2.5 text-sm transition focus:outline-none bg-black/40 border border-white/10 text-white placeholder:text-white/20 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:placeholder:!text-[#94a3b8]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 text-white/80 [.light-theme_&]:!text-[#0f172a]">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={activeEndpoint.key}
                    onChange={(e) => updateActiveEndpoint({ key: e.target.value })}
                    placeholder="sk-..."
                    className="w-full rounded-xl px-4 py-2.5 text-sm transition focus:outline-none bg-black/40 border border-white/10 text-white placeholder:text-white/20 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:placeholder:!text-[#94a3b8]"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-white/80 [.light-theme_&]:!text-[#0f172a]">
                      模型名称 (Model)
                    </label>
                    <button 
                      onClick={handleFetchModels}
                      disabled={isFetchingModels}
                      className="text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer text-white/70 hover:text-white [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#0f172a]"
                    >
                      {isFetchingModels ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      拉取模型
                    </button>
                  </div>
                  {availableModels.length > 0 ? (
                    <select
                      value={activeEndpoint.model}
                      onChange={(e) => updateActiveEndpoint({ model: e.target.value })}
                      className="w-full rounded-xl px-4 py-2.5 text-sm transition focus:outline-none appearance-none bg-black/40 border border-white/10 text-white [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a]"
                    >
                      {availableModels.map(m => (
                        <option key={m} value={m} className="bg-slate-900 text-slate-100 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!text-[#0f172a]">
                          {m}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={activeEndpoint.model}
                      onChange={(e) => updateActiveEndpoint({ model: e.target.value })}
                      placeholder="gpt-3.5-turbo"
                      className="w-full rounded-xl px-4 py-2.5 text-sm transition focus:outline-none bg-black/40 border border-white/10 text-white placeholder:text-white/20 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:placeholder:!text-[#94a3b8]"
                    />
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'st' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="space-y-4">
                <p className="text-xs text-white/50 [.light-theme_&]:!text-[#64748b]">
                  用于一键发送角色卡至本地的 SillyTavern。如果发送失败，请确保酒馆已开启「API操作」并允许跨域请求 (CORS)。
                </p>
                
                {/* Collapsible Setup Instructions */}
                <div className="rounded-xl overflow-hidden border bg-white/5 border-white/5 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!border-[#e2e8f0]">
                  <button 
                    onClick={() => setIsStSetupOpen(!isStSetupOpen)}
                    className="w-full flex items-center justify-between p-3 text-sm font-medium transition-colors cursor-pointer text-white/80 hover:bg-white/10 [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:hover:!bg-[#f1f5f9]"
                  >
                    <span>配置教程 (需要修改的地方)</span>
                    {isStSetupOpen ? (
                      <ChevronUp className="w-4 h-4 text-white/50 [.light-theme_&]:!text-[#64748b]" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-white/50 [.light-theme_&]:!text-[#64748b]" />
                    )}
                  </button>
                  <AnimatePresence>
                    {isStSetupOpen && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }} 
                        animate={{ height: 'auto', opacity: 1 }} 
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="p-4 pt-0 text-xs space-y-4 border-t mt-2 text-white/60 border-white/5 [.light-theme_&]:!text-[#64748b] [.light-theme_&]:!border-[#e2e8f0]">
                          <p className="font-medium text-white/80 [.light-theme_&]:!text-[#0f172a]">
                            请在酒馆目录的 <code>config.yaml</code> 文件里修改：
                          </p>
                          
                          <div className="space-y-1">
                            <p className="font-medium text-white/70 [.light-theme_&]:!text-[#0f172a]">1. 关闭 CSRF 拦截：</p>
                            <p>找到 <code>disableCsrfProtection: false</code> 这一行，把它改成 <code>true</code>：</p>
                            <div className="p-2 rounded border font-mono bg-black/40 border-white/5 text-white/70 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a]">
                              disableCsrfProtection: true
                            </div>
                          </div>

                          <div className="space-y-1">
                            <p className="font-medium text-white/70 [.light-theme_&]:!text-[#0f172a]">2. 添加跨域允许 (CORS)：</p>
                            <p>在 <code>disableCsrfProtection: true</code> 的下面直接另起一行加上：</p>
                            <div 
                              className="p-2 rounded border font-mono relative group cursor-pointer transition-colors bg-black/40 border-white/5 text-white/70 hover:bg-black/60 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a]"
                              onClick={() => {
                                navigator.clipboard.writeText('# corsAllowedOrigins:\n#   - "*"');
                                setIsCopied(true);
                                setTimeout(() => setIsCopied(false), 2000);
                              }}
                              title="点击复制"
                            >
                              <pre><code>{`# corsAllowedOrigins:\n#   - "*"`}</code></pre>
                              <div className="absolute right-2 top-2 text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-white/10 text-white [.light-theme_&]:!bg-black/10 [.light-theme_&]:!text-[#0f172a]">
                                {isCopied ? '已复制' : '点击复制'}
                              </div>
                            </div>
                            <p className="text-[10px] mt-1 text-white/40 [.light-theme_&]:!text-[#94a3b8]">（*号内可替换本站网址）</p>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 text-white/80 [.light-theme_&]:!text-[#0f172a]">
                    酒馆 API 地址
                  </label>
                  <input
                    type="text"
                    value={settings.sillyTavernUrl || ''}
                    onChange={(e) => setSettings({ ...settings, sillyTavernUrl: e.target.value })}
                    placeholder="例如: http://127.0.0.1:8000"
                    className="w-full rounded-xl px-4 py-2.5 text-sm transition focus:outline-none bg-black/40 border border-white/10 text-white placeholder:text-white/20 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:placeholder:!text-[#94a3b8]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 text-white/80 [.light-theme_&]:!text-[#0f172a]">
                    Username (账号)
                  </label>
                  <input
                    type="text"
                    value={settings.sillyTavernUsername || ''}
                    onChange={(e) => setSettings({ ...settings, sillyTavernUsername: e.target.value })}
                    placeholder="如果你在酒馆设置了基础认证账号"
                    className="w-full rounded-xl px-4 py-2.5 text-sm transition focus:outline-none bg-black/40 border border-white/10 text-white placeholder:text-white/20 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:placeholder:!text-[#94a3b8]"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2 text-white/80 [.light-theme_&]:!text-[#0f172a]">
                    Password (密码)
                  </label>
                  <input
                    type="password"
                    value={settings.sillyTavernPassword || ''}
                    onChange={(e) => setSettings({ ...settings, sillyTavernPassword: e.target.value })}
                    placeholder="如果你在酒馆设置了基础认证密码"
                    className="w-full rounded-xl px-4 py-2.5 text-sm transition focus:outline-none bg-black/40 border border-white/10 text-white placeholder:text-white/20 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:placeholder:!text-[#94a3b8]"
                  />
                </div>
              </motion.div>
            )}

            {activeTab === 'cloud' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <CloudSyncTab isLightMode={isLightMode} />
              </motion.div>
            )}

            {activeTab === 'wallpaper' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <SidebarWallpaperTab 
                  config={wallpaperConfig} 
                  onChange={(cfg) => setWallpaperConfig(cfg)} 
                />
              </motion.div>
            )}

            {activeTab === 'about' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
                <div className="flex flex-col items-center justify-center py-6 text-center border rounded-2xl p-6 bg-white/5 border-white/10 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!border-[#e2e8f0]">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-black text-2xl mb-3 shadow-md select-none tracking-tight bg-white text-black [.light-theme_&]:!bg-[#0f172a] [.light-theme_&]:!text-white">
                    MIU
                  </div>
                  <h3 className="text-lg font-bold flex items-center gap-2 text-white [.light-theme_&]:!text-[#0f172a]">
                    MIU 角色管理器
                  </h3>
                  <div className="inline-flex items-center gap-2 px-3 py-0.5 border rounded-full text-xs font-medium mt-2 bg-white/10 border-white/15 text-white/80 [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:!text-[#0f172a]">
                    当前版本 v{CURRENT_APP_VERSION}
                  </div>
                  <p className="text-xs max-w-xs mt-2.5 leading-relaxed text-white/50 [.light-theme_&]:!text-[#64748b]">
                    专为酒馆与 AI 角色卡打造的高效角色与资源管理工具。
                  </p>
                </div>

                <div className="border rounded-2xl p-4 space-y-3 bg-white/5 border-white/10 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!border-[#e2e8f0]">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-medium text-white [.light-theme_&]:!text-[#0f172a]">版本自动检查</h4>
                      <p className="text-xs text-white/50 [.light-theme_&]:!text-[#64748b]">随时检测远端发布的新版本</p>
                    </div>
                    <button
                      onClick={async () => {
                        setCheckingUpdate(true);
                        setUpdateResult(null);
                        try {
                          const { checkForAppUpdates } = await import('../config/version');
                          const res = await checkForAppUpdates();
                          if (res.hasUpdate && res.latestVersion) {
                            setUpdateResult({
                              msg: `发现新版本 v${res.latestVersion.version}！`,
                              downloadUrl: res.latestVersion.downloadUrl,
                              versionInfo: res.latestVersion,
                            });
                            window.dispatchEvent(new CustomEvent('openUpdateModal', { detail: res.latestVersion }));
                          } else if (res.error) {
                            setUpdateResult({ msg: `检查失败: ${res.error}`, isError: true });
                          } else {
                            setUpdateResult({ msg: `目前已是最新版本 (v${CURRENT_APP_VERSION}) 🎉` });
                          }
                        } catch (e: any) {
                          setUpdateResult({ msg: '检查出错: ' + e.message, isError: true });
                        } finally {
                          setCheckingUpdate(false);
                        }
                      }}
                      disabled={checkingUpdate}
                      className="px-3.5 py-1.5 active:scale-95 text-xs font-semibold transition disabled:opacity-50 flex items-center gap-1.5 shrink-0 shadow-sm cursor-pointer rounded-full bg-white text-black hover:bg-white/90 [.light-theme_&]:!bg-[#0f172a] [.light-theme_&]:!text-white [.light-theme_&]:hover:!bg-[#1e293b]"
                    >
                      {checkingUpdate && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>检查更新</span>
                    </button>
                  </div>

                  {updateResult && (
                    <div className={`p-3 rounded-xl text-xs flex items-center justify-between gap-2 border ${
                      updateResult.isError 
                        ? 'bg-rose-500/10 text-rose-300 border-rose-500/30' 
                        : 'bg-white/5 text-white/90 border-white/15 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#e2e8f0]'
                    }`}>
                      <span className="truncate">{updateResult.msg}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {updateResult.versionInfo && (
                          <button
                            type="button"
                            onClick={() => window.dispatchEvent(new CustomEvent('openUpdateModal', { detail: updateResult.versionInfo }))}
                            className="px-2.5 py-1 text-xs font-semibold rounded-full transition shrink-0 bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-blue-600 [.light-theme_&]:hover:!bg-blue-100 cursor-pointer"
                          >
                            查看详情
                          </button>
                        )}
                        {updateResult.downloadUrl && (
                          <a
                            href={updateResult.downloadUrl}
                            onClick={(e) => { e.preventDefault(); openExternalUrl(updateResult.downloadUrl!); }}
                            rel="noreferrer"
                            className="px-3 py-1 text-xs font-semibold rounded-full transition shrink-0 bg-white text-black hover:bg-white/90 [.light-theme_&]:!bg-[#0f172a] [.light-theme_&]:!text-white"
                          >
                            下载
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* Test Connection Result */}
            {testStatus !== 'idle' && activeTab === 'api' && (
              <div className={`p-3 rounded-xl flex items-start gap-2.5 text-xs sm:text-sm border transition-all ${
                testStatus === 'success' 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/40 [.light-theme_&]:!bg-emerald-50 [.light-theme_&]:!text-emerald-800 [.light-theme_&]:!border-emerald-200' 
                  : testStatus === 'error' 
                    ? 'bg-rose-500/10 text-rose-300 border-rose-500/40 [.light-theme_&]:!bg-rose-50 [.light-theme_&]:!text-rose-800 [.light-theme_&]:!border-rose-200' 
                    : 'bg-white/5 text-white/70 border-white/10 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#e2e8f0]'
              }`}>
                {testStatus === 'testing' && <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-0.5 text-white/60 [.light-theme_&]:!text-[#64748b]" />}
                {testStatus === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400 [.light-theme_&]:!text-emerald-600" />}
                {testStatus === 'error' && <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400 [.light-theme_&]:!text-rose-600" />}
                <span className="flex-1 break-all">{testMsg || '正在测试连接...'}</span>
              </div>
            )}
          </div>

          {/* Bottom Footer Controls */}
          <div className="p-3.5 sm:p-4 border-t border-white/10 [.light-theme_&]:!border-[#e2e8f0] bg-slate-900/95 [.light-theme_&]:!bg-[#ffffff] flex justify-between items-center gap-3 shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4">
            {activeTab === 'api' ? (
              <button
                onClick={handleTest}
                disabled={testStatus === 'testing'}
                className="px-4 py-2 rounded-full text-xs sm:text-sm font-medium border transition disabled:opacity-50 cursor-pointer bg-white/5 hover:bg-white/10 text-white/80 hover:text-white border-white/10 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#e2e8f0]"
              >
                测试连接
              </button>
            ) : (
              <div></div>
            )}
            <div className="flex gap-2.5">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-full text-xs sm:text-sm font-medium transition cursor-pointer text-white/60 hover:text-white hover:bg-white/10 [.light-theme_&]:!bg-transparent [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#0f172a] [.light-theme_&]:hover:!bg-black/5"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                className="px-5 py-2 rounded-full text-xs sm:text-sm font-bold active:scale-95 transition flex items-center gap-1.5 shadow-sm cursor-pointer border-0 outline-none bg-white text-black hover:bg-neutral-200 [.light-theme_&]:!bg-[#9dc4f8] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:hover:!bg-[#8bb5ec]"
              >
                <Save className="w-3.5 h-3.5 stroke-[2.5]" />
                保存设置
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
