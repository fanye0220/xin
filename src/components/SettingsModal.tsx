import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Key, ExternalLink, Save, Globe, CheckCircle2, AlertCircle, Loader2, RefreshCw, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { AISettings, CustomEndpoint, getAISettings, saveAISettings, testConnection, fetchCustomModels } from '../lib/ai';
import { CloudSyncTab } from './CloudSyncTab';

export function SettingsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [settings, setSettings] = useState<AISettings>(getAISettings());
  const [activeTab, setActiveTab] = useState<'api' | 'st' | 'cloud'>('api');
  const [isStSetupOpen, setIsStSetupOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMsg, setTestMsg] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [apiStatus, setApiStatus] = useState<'idle' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (isOpen) {
      setSettings(getAISettings());
      setTestStatus('idle');
      setTestMsg('');
      setApiStatus('idle');
      setAvailableModels([]);
    }
  }, [isOpen]);

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
      customEndpoints: [...prev.customEndpoints, { id: newId, name: `新接口 ${prev.customEndpoints.length + 1}`, url: '', key: '', model: '' }],
      activeCustomId: newId
    }));
    setApiStatus('idle');
    setTestStatus('idle');
  };

  const handleDeleteEndpoint = () => {
    if (settings.customEndpoints.length <= 1) return;
    setSettings(prev => {
      const newEndpoints = prev.customEndpoints.filter(e => e.id !== prev.activeCustomId);
      return {
        ...prev,
        customEndpoints: newEndpoints,
        activeCustomId: newEndpoints[0].id
      };
    });
    setApiStatus('idle');
    setTestStatus('idle');
  };

  const handleSave = () => {
    saveAISettings(settings);
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
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
        >
          <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/5 shrink-0">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Key className="w-5 h-5 text-purple-400" />
              设置
            </h2>
            <button onClick={onClose} className="p-1 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex px-6 pt-2 border-b border-white/10 shrink-0 gap-6">
            <button 
              onClick={() => setActiveTab('api')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'api' ? 'border-blue-500 text-blue-400' : 'border-transparent text-white/50 hover:text-white/80'}`}
            >
              API 设置
            </button>
            <button 
              onClick={() => setActiveTab('st')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'st' ? 'border-blue-500 text-blue-400' : 'border-transparent text-white/50 hover:text-white/80'}`}
            >
              酒馆联动
            </button>
            <button 
              onClick={() => setActiveTab('cloud')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'cloud' ? 'border-blue-500 text-blue-400' : 'border-transparent text-white/50 hover:text-white/80'}`}
            >
              云端同步
            </button>
          </div>
          
          <div className="p-6 space-y-6 overflow-y-auto">
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
                  className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors text-sm appearance-none"
                >
                  {settings.customEndpoints.map(e => (
                    <option key={e.id} value={e.id} className="bg-slate-900">{e.name}</option>
                  ))}
                </select>
                <button onClick={handleAddEndpoint} className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-white/70 hover:text-white transition" title="添加新接口">
                  <Plus className="w-4 h-4" />
                </button>
                {settings.customEndpoints.length > 1 && (
                  <button onClick={handleDeleteEndpoint} className="p-2 bg-red-500/10 hover:bg-red-500/20 rounded-xl text-red-400 hover:text-red-300 transition" title="删除当前接口">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

                <div>
                  <label className="block text-sm font-medium text-white/80 mb-2">
                    接口名称 (备注)
                  </label>
                  <input
                    type="text"
                    value={activeEndpoint.name}
                    onChange={(e) => updateActiveEndpoint({ name: e.target.value })}
                    placeholder="例如：DeepSeek、本地Ollama"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500 transition-colors text-sm"
                  />
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <label className="block text-sm font-medium text-white/80">
                      API 地址 (Base URL)
                    </label>
                    {apiStatus === 'success' && <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]" title="已连接" />}
                    {apiStatus === 'error' && <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" title="连接失败" />}
                  </div>
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                    <input
                      type="text"
                      value={activeEndpoint.url}
                      onChange={(e) => updateActiveEndpoint({ url: e.target.value })}
                      placeholder="https://api.openai.com/v1"
                      className="w-full bg-black/40 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500 transition-colors text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-white/80 mb-2">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={activeEndpoint.key}
                    onChange={(e) => updateActiveEndpoint({ key: e.target.value })}
                    placeholder="sk-..."
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500 transition-colors text-sm"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-white/80">
                      模型名称 (Model)
                    </label>
                    <button 
                      onClick={handleFetchModels}
                      disabled={isFetchingModels}
                      className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors disabled:opacity-50"
                    >
                      {isFetchingModels ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      拉取模型
                    </button>
                  </div>
                  {availableModels.length > 0 ? (
                    <select
                      value={activeEndpoint.model}
                      onChange={(e) => updateActiveEndpoint({ model: e.target.value })}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors text-sm appearance-none"
                    >
                      {availableModels.map(m => (
                        <option key={m} value={m} className="bg-slate-900">{m}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={activeEndpoint.model}
                      onChange={(e) => updateActiveEndpoint({ model: e.target.value })}
                      placeholder="gpt-3.5-turbo"
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500 transition-colors text-sm"
                    />
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'st' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="space-y-4">
                <p className="text-xs text-white/50">用于一键发送角色卡至本地的 SillyTavern。如果发送失败，请确保酒馆已开启「API操作」并允许跨域请求 (CORS)。</p>
                
                {/* Collapsible Setup Instructions */}
                <div className="bg-white/5 rounded-xl overflow-hidden border border-white/5">
                  <button 
                    onClick={() => setIsStSetupOpen(!isStSetupOpen)}
                    className="w-full flex items-center justify-between p-3 text-sm font-medium text-white/80 hover:bg-white/10 transition-colors"
                  >
                    <span>配置教程 (需要修改的地方)</span>
                    {isStSetupOpen ? <ChevronUp className="w-4 h-4 text-white/50" /> : <ChevronDown className="w-4 h-4 text-white/50" />}
                  </button>
                  <AnimatePresence>
                    {isStSetupOpen && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }} 
                        animate={{ height: 'auto', opacity: 1 }} 
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="p-4 pt-0 text-xs text-white/60 space-y-4 border-t border-white/5 mt-2">
                          <p className="text-white/80 font-medium">请在酒馆目录的 <code>config.yaml</code> 文件里修改：</p>
                          
                          <div className="space-y-1">
                            <p className="font-medium text-white/70">1. 关闭 CSRF 拦截：</p>
                            <p>找到 <code className="text-white/80">disableCsrfProtection: false</code> 这一行，把它改成 <code className="text-white/80">true</code>：</p>
                            <div className="bg-black/40 p-2 rounded border border-white/5 font-mono text-white/70">
                              disableCsrfProtection: true
                            </div>
                          </div>

                          <div className="space-y-1">
                            <p className="font-medium text-white/70">2. 添加跨域允许 (CORS)：</p>
                            <p>在 <code className="text-white/80">disableCsrfProtection: true</code> 的下面直接另起一行加上：</p>
                            <div 
                              className="bg-black/40 p-2 rounded border border-white/5 font-mono text-white/70 relative group cursor-pointer hover:bg-black/60 transition-colors"
                              onClick={() => {
                                navigator.clipboard.writeText('# corsAllowedOrigins:\n#   - "*"');
                                setIsCopied(true);
                                setTimeout(() => setIsCopied(false), 2000);
                              }}
                              title="点击复制"
                            >
                              <pre><code>{`# corsAllowedOrigins:\n#   - "*"`}</code></pre>
                              <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] bg-white/10 px-1.5 py-0.5 rounded">
                                {isCopied ? '已复制' : '点击复制'}
                              </div>
                            </div>
                            <p className="text-[10px] text-white/40 mt-1">（*号内可替换本站网址）</p>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  
          </AnimatePresence>
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/80 mb-2">
                    酒馆 API 地址
                  </label>
                  <input
                    type="text"
                    value={settings.sillyTavernUrl || ''}
                    onChange={(e) => setSettings({ ...settings, sillyTavernUrl: e.target.value })}
                    placeholder="例如: http://127.0.0.1:8000"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500 transition-colors text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/80 mb-2">
                    Username (账号)
                  </label>
                  <input
                    type="text"
                    value={settings.sillyTavernUsername || ''}
                    onChange={(e) => setSettings({ ...settings, sillyTavernUsername: e.target.value })}
                    placeholder="如果你在酒馆设置了基础认证账号"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500 transition-colors text-sm"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-white/80 mb-2">
                    Password (密码)
                  </label>
                  <input
                    type="password"
                    value={settings.sillyTavernPassword || ''}
                    onChange={(e) => setSettings({ ...settings, sillyTavernPassword: e.target.value })}
                    placeholder="如果你在酒馆设置了基础认证密码"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500 transition-colors text-sm"
                  />
                </div>
              </motion.div>
            )}

            {activeTab === 'cloud' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <CloudSyncTab />
              </motion.div>
            )}

            {/* Test Connection Result */}
            {testStatus !== 'idle' && activeTab === 'api' && (
              <div className={`p-3 rounded-xl flex items-start gap-2 text-sm ${
                testStatus === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 
                testStatus === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 
                'bg-white/5 text-white/60 border border-white/10'
              }`}>
                {testStatus === 'testing' && <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-0.5" />}
                {testStatus === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />}
                {testStatus === 'error' && <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                <span className="flex-1 break-all">{testMsg || '正在测试连接...'}</span>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-white/10 bg-white/5 flex justify-between gap-3 shrink-0">
            {activeTab === 'api' ? (
              <button
                onClick={handleTest}
                disabled={testStatus === 'testing'}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-white/5 hover:bg-white/10 text-white transition disabled:opacity-50"
              >
                测试连接
              </button>
            ) : (
              <div></div>
            )}
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white/70 hover:text-white hover:bg-white/10 transition"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition flex items-center gap-2 bg-blue-500 hover:bg-blue-600"
              >
                <Save className="w-4 h-4" />
                保存设置
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    
          </AnimatePresence>
  );
}
