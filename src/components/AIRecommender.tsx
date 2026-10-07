import { getFallbackAvatar, resolveAvatarUrl } from '../lib/avatar';
import { getLocalImageUrl } from '../lib/appBridge';
import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Sparkles, Loader2, AlertCircle, Play, Terminal, Dices } from 'lucide-react';
import { getCharacters, CharacterCard, getCharacter, isActualCharacterCard } from '../lib/db';
import { callAI } from '../lib/ai';
import { motion } from 'framer-motion';
import { useObjectUrl, useManagedObjectUrl } from '../lib/useObjectUrl';

// 单独拆出来的头像组件: 用 useObjectUrl 管理 blob URL 的创建/释放生命周期,
// 避免直接在 results.map() 渲染逻辑里裸调 createObjectURL(每次父组件重渲染
// 都会创建新 URL 却从不释放,是最容易被忽略的一种泄漏)。
function RecommendResultAvatar({ char, name }: { char: CharacterCard; name: string }) {
  const objectUrl = useObjectUrl(char.avatarBlob);
  const fallback = resolveAvatarUrl(char.avatarUrlFallback, char.name || char.id);
  const staticUrl = !char.avatarBlob && char.localFilePath
    ? getLocalImageUrl(char.localFilePath, char.updatedAt || char.createdAt)
    : fallback;
  const url = objectUrl || staticUrl;
  const { url: fallbackUrl, setBlobUrl } = useManagedObjectUrl();

  if (!url && !fallbackUrl) return null;
  return (
    <img
      src={fallbackUrl || url}
      alt={name}
      className="w-full h-full object-cover"
      onError={(e) => {
        import('../lib/db').then((m) =>
          m.getCharacterBlob(char.id).then((b) => {
            if (b && b.avatarBlob) setBlobUrl(b.avatarBlob);
            else {
              if (e.currentTarget.src !== fallback) {
                e.currentTarget.src = fallback;
              }
            }
          })
        ).catch(() => {
          if (e.currentTarget.src !== fallback) {
            e.currentTarget.src = fallback;
          }
        });
      }}
    />
  );
}

export function AIRecommender({ onClose, onSelectChar, onOpenSettings }: { onClose: () => void, onSelectChar: (id: string) => void, onOpenSettings: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<{ char: CharacterCard, reason: string }[]>([]);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);
  const [logs, setLogs] = useState<{time: string, msg: string, type?: 'error' | 'success'}[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const [isGacha, setIsGacha] = useState(false);

  const addLog = (msg: string, type?: 'error' | 'success') => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg, type }]);
  };

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const handleRandomGacha = async () => {
    setIsSearching(true);
    setIsGacha(true);
    setResults([]);
    setLogs([]);
    setApiKeyMissing(false);
    
    try {
      const { getCachedMeta, initDB } = await import('../lib/db');
      const allMeta = (await getCachedMeta()).filter(c => !c.deletedAt && !c.isTool && !c.isQR);
      
      if (allMeta.length === 0) {
        addLog('没有找到角色卡。', 'error');
        return;
      }

      // Randomly shuffle allMeta IDs
      const shuffled = [...allMeta].sort(() => 0.5 - Math.random());
      
      const db = await initDB();
      let randomChar: CharacterCard | null = null;
      
      for (const meta of shuffled) {
        // Quick filter bounds
        const hasBeautifyTag = meta.tags.some(t => t.includes('美化') || t.includes('预设') || t.includes('UI') || t.includes('主题') || t.includes('工具') || t.includes('插件') || t.includes('正则') || t.includes('组件') || t.includes('工作流'));
        if (hasBeautifyTag) continue;

        const char = await db.get('characters', meta.id);
        if (!char) continue;
        
        const rawData = char.data?.data || char.data || {};
        const isPreset = !!(rawData.prompts || rawData.temperature !== undefined || rawData.top_p !== undefined);
        const isStandaloneWorldbook = rawData.entries !== undefined || rawData.data?.entries !== undefined;
        const isTheme = rawData.blur_strength !== undefined || rawData.main_text_color !== undefined || rawData.chat_display !== undefined;
        const tags = char.data?.tags || char.data?.data?.tags || [];
        const isBeautify = tags.some((t: string) => t.includes('美化') || t.includes('预设') || t.includes('UI') || t.includes('主题') || t.includes('工具') || t.includes('插件') || t.includes('正则') || t.includes('组件') || t.includes('工作流'));
        const isQR = Array.isArray(rawData) ? (rawData.length > 0 && rawData[0].label !== undefined && rawData[0].message !== undefined) : ((rawData.quick_replies !== undefined || rawData.qrList !== undefined) && rawData.spec !== "chara_card_v2" && rawData.spec !== "chara_card_v3" && rawData.description === undefined && rawData.first_mes === undefined && rawData.personality === undefined && rawData.mes_example === undefined && rawData.char_name === undefined && rawData.character_name === undefined && rawData.name === undefined && rawData.data?.name === undefined);
        const isScript = rawData.type === 'script' && rawData.content !== undefined && rawData.name !== undefined;
        
        if (!isPreset && !isBeautify && !isStandaloneWorldbook && !isTheme && !isQR && !isScript) {
          randomChar = char;
          break;
        }
      }

      if (!randomChar) {
        addLog('没有找到符合条件的角色卡。', 'error');
        return;
      }
      
      // Add a small artificial delay for the "gacha" feel
      await new Promise(resolve => setTimeout(resolve, 800));
      
      let charWithBlob = randomChar;
      if (charWithBlob.hasBlobsSeparated && !charWithBlob.avatarBlob) {
        const fetched = await getCharacter(charWithBlob.id);
        if (fetched) charWithBlob = fetched;
      }
      
      setResults([{
        char: charWithBlob,
        reason: "命运的指引！今天就决定是你了！"
      }]);
    } catch (e: any) {
      console.error("Gacha error:", e);
    } finally {
      setIsSearching(false);
    }
  };

  const handleRecommend = async () => {
    if (!prompt.trim()) return;
    setIsSearching(true);
    setIsGacha(false);
    setResults([]);
    setApiKeyMissing(false);
    setLogs([]);

    try {
      addLog('开始分析您的需求...');
      const { getCachedMeta } = await import('../lib/db');
      const allowedMeta = (await getCachedMeta()).filter(c => !c.deletedAt && !c.isTool && !c.isQR);
      const allowedIds = new Set(allowedMeta.map(c => c.id));

      const response = await getCharacters(1, 10000, 'all', '', [], 'newest_import', false);
      let allChars = response.characters;

      // 先用 char_meta 的分类标记排除工具/美化/预设/世界书/快捷回复等非角色卡，
      // 避免这些卡因为也带有 name + description + tags 而被下面的角色结构判断漏掉。
      allChars = allChars.filter(c => allowedIds.has(c.id));

      // 过滤掉非角色卡
      allChars = allChars.filter(c => isActualCharacterCard(c.data));

      if (allChars.length === 0) {
        addLog('本地角色库为空或没有符合条件的角色，无法进行推荐。', 'error');
        setIsSearching(false);
        return;
      }
      addLog(`已加载本地角色库，共 ${allChars.length} 个角色。`);

      // 1. Extract keywords from user prompt
      addLog('正在向 AI 请求提取核心关键词...');
      const kwStr = await callAI(`请从以下用户的需求中提取3-5个核心关键词（用于搜索角色卡）。只返回关键词，用空格分隔。\n用户需求：${prompt}`);
      const keywords = kwStr.split(/\s+/).filter(k => k.trim());
      addLog(`提取到关键词: [${keywords.join(', ')}]`, 'success');

      // 2. Score characters based on keywords with priority for tags & AI summary
      const taggedCount = allChars.filter(c => {
        const d = c.data?.data || c.data || {};
        const tags = d.tags || c.tags;
        const summary = c.aiSummary || d.aiSummary;
        return (Array.isArray(tags) && tags.length > 0) || (typeof summary === 'string' && summary.trim().length > 0);
      }).length;

      if (taggedCount > 0) {
        addLog(`检测到 ${taggedCount} 个角色包含标签或 AI 简介，优先极速读取标签与简介匹配（未打标角色扫描完整人设）...`);
      } else {
        addLog('正在本地角色库中匹配相关角色设定...');
      }

      const scored = allChars.map(c => {
        const d = c.data?.data || c.data || {};
        const name = (c.name || d.name || d.char_name || '').toLowerCase();
        const tags = (Array.isArray(d.tags) ? d.tags : Array.isArray(c.tags) ? c.tags : []).join(' ').toLowerCase();
        const summary = (c.aiSummary || d.aiSummary || '').toLowerCase();
        
        let score = 0;
        const hasTagOrSummary = tags.length > 0 || summary.length > 0;
        
        if (hasTagOrSummary) {
          // 优先极速匹配标签与 AI 简介（提炼精华，匹配更快且权重更高）
          keywords.forEach(k => {
            const kLow = k.toLowerCase();
            if (name.includes(kLow)) score += 5;
            if (tags.includes(kLow)) score += 4;
            if (summary.includes(kLow)) score += 3;
          });
        } else {
          // 未打标角色：按原来的扫描完整设定、性格、场景与开场白
          const fullText = `${name} ${d.description || d.char_persona || ''} ${d.personality || ''} ${d.scenario || ''} ${d.first_mes || ''}`.toLowerCase();
          keywords.forEach(k => {
            const kLow = k.toLowerCase();
            if (fullText.includes(kLow)) score += 2;
          });
        }
        
        return { char: c, score };
      }).sort((a, b) => b.score - a.score).slice(0, 30);

      const candidates = scored.length > 0 ? scored.map(s => s.char) : allChars.slice(0, 30);
      addLog(`初步筛选出 ${candidates.length} 个候选角色，正在请求 AI 进行深度评估...`);

      // 3. Ask AI to recommend from the candidates
      const candidateInfo = candidates.map(c => {
        const d = c.data?.data || c.data || {};
        const name = c.name || d.name || d.char_name || '未知角色';
        const tags = (Array.isArray(d.tags) ? d.tags : Array.isArray(c.tags) ? c.tags : []).join(',');
        const summary = c.aiSummary || d.aiSummary;
        const desc = summary ? `简介: ${summary}` : `描述: ${(d.description || d.char_persona || '').substring(0, 200)}`;
        return `ID: ${c.id}\n姓名: ${name}\n${tags ? `标签: ${tags}\n` : ''}${desc}`;
      }).join('\n\n');

      const recPrompt = `你是一个专业的角色扮演推荐助手。
请注意区分以下概念：
- "char" 或 "角色" 指的是候选列表中的角色卡片。
- "user" 或 "我" 指的是用户想要扮演的身份。
例如，如果用户说“我是主播，给我找个榜一大哥”，你需要寻找设定为“榜一大哥”的 char，来配合设定为“主播”的 user。

用户需求：${prompt}

候选角色列表：
${candidateInfo}

请返回一个 JSON 数组，格式如下：
[{"id": "角色的ID", "reason": "推荐理由（结合用户需求和角色设定，说明为什么推荐这个角色，50-100字）"}]
只返回 JSON 数组，不要包含其他内容。`;

      const recJson = await callAI(recPrompt, true);
      addLog('AI 评估完成！正在解析结果...', 'success');
      
      let recs;
      try {
        recs = JSON.parse(recJson);
      } catch (e) {
        throw new Error("AI 返回了无效的 JSON 格式数据");
      }

      // Robust array extraction: if AI returned an object with an array inside
      if (!Array.isArray(recs)) {
        if (typeof recs === 'object' && recs !== null) {
          const possibleArray = Object.values(recs).find(val => Array.isArray(val));
          if (possibleArray) {
            recs = possibleArray;
          } else {
            throw new Error("AI 返回的数据格式不正确（期望数组，但得到了对象）");
          }
        } else {
          throw new Error("AI 返回的数据格式不正确（期望数组）");
        }
      }

      const finalResults = recs.map((r: any) => ({
        char: candidates.find(c => c.id === r.id),
        reason: r.reason || r.推荐理由 || r.description || "符合您的需求"
      })).filter((r: any) => r.char);

      for (const result of finalResults) {
        if (result.char.hasBlobsSeparated && !result.char.avatarBlob) {
          const charWithBlob = await getCharacter(result.char.id);
          if (charWithBlob) {
            result.char = charWithBlob;
          }
        }
      }

      setResults(finalResults);
      addLog(`推荐完成！共为您找到 ${finalResults.length} 个角色。`, 'success');
    } catch (e: any) {
      if (e.message === 'API_KEY_MISSING') {
        setApiKeyMissing(true);
        addLog('未配置 API Key 或配置无效。', 'error');
      } else {
        console.error("Recommendation error:", e);
        addLog(`推荐失败: ${e.message || String(e)}`, 'error');
      }
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0c] [.light-theme_&]:!bg-[#f2f2f7]">
      <header className="recommender-header sticky top-0 px-4 pb-4 pt-[max(1.75rem,env(safe-area-inset-top))] sm:px-6 sm:pb-6 flex items-center gap-4 backdrop-blur-xl z-20">
        <button 
          type="button"
          onClick={onClose} 
          className="p-2 -ml-2 rounded-full hover:bg-white/10 [.light-theme_&]:!bg-transparent [.light-theme_&]:hover:!bg-black/5 [.light-theme_&]:active:!bg-black/10 text-white [.light-theme_&]:!text-[#0f172a] transition active:scale-95 touch-manipulation select-none cursor-pointer"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white [.light-theme_&]:!text-[#0f172a]">
            AI 智能推荐
          </h1>
          <p className="text-xs sm:text-sm text-white/50 [.light-theme_&]:!text-[#8e8e93] mt-1">告诉 AI 你想玩什么剧情，让它为你挑选角色</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-[max(2rem,env(safe-area-inset-bottom))] custom-scrollbar">
        <div className="max-w-4xl mx-auto space-y-6">
          
          {apiKeyMissing && (
            <div className="bg-red-500/10 [.light-theme_&]:!bg-red-50 border border-red-500/20 [.light-theme_&]:!border-red-200 rounded-2xl p-4 sm:p-5 text-red-400 [.light-theme_&]:!text-red-700 flex items-start gap-3 sm:gap-4 shadow-lg shadow-red-500/5">
              <AlertCircle className="w-5 h-5 sm:w-6 sm:h-6 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-base sm:text-lg">未配置 API</h3>
                <p className="text-xs sm:text-sm opacity-85 mt-1 mb-3">使用智能推荐功能需要配置自定义 API (OpenAI 格式接口)。</p>
                <button 
                  type="button"
                  onClick={onOpenSettings}
                  className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 [.light-theme_&]:!bg-red-100 [.light-theme_&]:hover:!bg-red-200 text-red-300 [.light-theme_&]:!text-red-800 rounded-lg text-sm font-medium transition active:scale-95 touch-manipulation select-none cursor-pointer"
                >
                  去配置 API
                </button>
              </div>
            </div>
          )}

          <div className="recommender-card rounded-2xl p-4 sm:p-6 shadow-sm border-none">
            <label className="block text-sm font-semibold text-white/80 [.light-theme_&]:!text-[#1c1c1e] mb-2 sm:mb-3">
              你想玩怎样的剧情或角色？
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="例如：我是主播，给我找个榜一大哥的卡..."
              className="recommender-input w-full rounded-xl p-3 sm:p-4 border-none outline-none focus:outline-none focus:ring-0 resize-none h-28 sm:h-32 text-sm sm:text-base"
            />
            <div className="mt-4 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 sm:gap-4">
              <div className="text-xs sm:text-sm text-white/50 [.light-theme_&]:!text-[#8e8e93] flex items-center gap-1.5 sm:gap-2">
                <Dices className="recommender-dice-icon w-4 h-4 shrink-0" />
                不知道玩什么？试试随机抽卡！(不消耗 API)
              </div>
              <div className="flex items-center gap-2.5 sm:gap-3 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={handleRandomGacha}
                  disabled={isSearching}
                  className="recommender-btn-secondary flex-1 sm:flex-none min-h-[48px] flex items-center justify-center gap-2 px-5 sm:px-6 py-3 rounded-xl font-semibold text-sm sm:text-base transition-all select-none cursor-pointer touch-manipulation active:scale-95 disabled:opacity-50 disabled:pointer-events-none border-none outline-none shadow-none"
                >
                  <Dices className="recommender-dice-icon w-5 h-5 shrink-0" />
                  <span>随机抽卡</span>
                </button>
                <button
                  type="button"
                  onClick={handleRecommend}
                  disabled={isSearching || !prompt.trim()}
                  className={`flex-1 sm:flex-none min-h-[48px] flex items-center justify-center gap-2 px-5 sm:px-6 py-3 rounded-xl font-semibold text-sm sm:text-base transition-all select-none cursor-pointer touch-manipulation active:scale-95 disabled:pointer-events-none border-none outline-none ${
                    isSearching || !prompt.trim()
                      ? 'bg-white/10 text-white/40 border-none outline-none [.light-theme_&]:!bg-[#e5e5ea] [.light-theme_&]:!text-[#8e8e93] cursor-not-allowed'
                      : 'bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white shadow-md shadow-blue-500/20 [.light-theme_&]:!bg-none [.light-theme_&]:!bg-[#70a9ff] [.light-theme_&]:hover:!bg-[#5b9cf6] [.light-theme_&]:!text-white [.light-theme_&]:!shadow-sm'
                  }`}
                >
                  {isSearching ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin shrink-0 text-white" />
                      <span className="text-white font-semibold">处理中...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5 shrink-0 text-white" />
                      <span className="text-white font-semibold">开始推荐</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* AI Thinking Logs */}
          {!isGacha && (logs.length > 0 || isSearching) && (
            <div className="recommender-logs-box rounded-2xl overflow-hidden shadow-sm">
              <div className="recommender-logs-header flex items-center gap-2 px-4 py-2.5 border-b">
                <Terminal className="w-4 h-4 text-white/40 [.light-theme_&]:!text-[#8e8e93]" />
                <span className="text-xs font-mono text-white/40 [.light-theme_&]:!text-[#8e8e93] uppercase tracking-wider font-semibold">AI 思维链 (Chain of Thought)</span>
              </div>
              <div className="p-4 font-mono text-xs sm:text-sm h-48 overflow-y-auto space-y-2">
                {logs.map((log, i) => (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }} 
                    animate={{ opacity: 1, x: 0 }} 
                    key={i} 
                    className={`flex gap-2.5 sm:gap-3 ${log.type === 'error' ? 'text-red-400 [.light-theme_&]:!text-red-600' : log.type === 'success' ? 'text-green-400 [.light-theme_&]:!text-green-600' : 'text-white/70 [.light-theme_&]:!text-[#3a3a3c]'}`}
                  >
                    <span className="text-white/30 [.light-theme_&]:!text-[#8e8e93] shrink-0">[{log.time}]</span>
                    <span>{log.msg}</span>
                  </motion.div>
                ))}
                {isSearching && (
                  <div className="flex gap-2.5 sm:gap-3 text-blue-400 [.light-theme_&]:!text-blue-600 animate-pulse">
                    <span className="text-white/30 [.light-theme_&]:!text-[#8e8e93] shrink-0">[{new Date().toLocaleTimeString()}]</span>
                    <span className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> 正在处理中...</span>
                  </div>
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base sm:text-lg font-bold flex items-center gap-2 text-white [.light-theme_&]:!text-[#1c1c1e]">
                  <Sparkles className="w-5 h-5 text-blue-400 [.light-theme_&]:!text-blue-600 shrink-0" />
                  {isGacha ? '抽卡结果' : `为你推荐了 ${results.length} 个角色`}
                </h2>
                {isGacha && (
                  <button
                    type="button"
                    onClick={handleRandomGacha}
                    disabled={isSearching}
                    className="recommender-btn-secondary flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold active:scale-95 transition touch-manipulation select-none cursor-pointer"
                  >
                    <Dices className="recommender-dice-icon w-4 h-4" />
                    <span>再抽一张</span>
                  </button>
                )}
              </div>
              <div className="grid gap-4">
                {results.map((result, i) => {
                  const char = result.char;
                  const data = char.data?.data || char.data;

                  return (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1 }}
                      key={char.id}
                      className="recommender-card rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row gap-4 transition group"
                    >
                      <div className="w-20 h-20 sm:w-28 sm:h-28 shrink-0 rounded-xl overflow-hidden bg-black/40 [.light-theme_&]:!bg-black/5 ring-1 ring-white/10 [.light-theme_&]:!ring-black/10 shadow-inner">
                        <RecommendResultAvatar char={char} name={data.name} />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-between">
                        <div>
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                            <h3 className="text-lg sm:text-xl font-bold text-white [.light-theme_&]:!text-[#1c1c1e] group-hover:text-blue-400 [.light-theme_&]:group-hover:!text-blue-600 transition-colors truncate">
                              {data.name}
                            </h3>
                            <button
                              type="button"
                              onClick={() => onSelectChar(char.id)}
                              className="hidden sm:inline-flex shrink-0 items-center justify-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 active:scale-95 text-white font-medium rounded-xl text-sm transition touch-manipulation select-none cursor-pointer shadow-sm"
                            >
                              <Play className="w-4 h-4 text-white" />
                              <span>查看角色</span>
                            </button>
                          </div>
                          {data.tags && data.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {data.tags.slice(0, 5).map((tag: string, j: number) => (
                                <span key={j} className="px-2.5 py-0.5 bg-blue-500/15 text-blue-300 [.light-theme_&]:!bg-[#eff6ff] [.light-theme_&]:!text-[#1d4ed8] rounded-md text-xs font-medium border-0 border-none">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="recommender-reason-box mt-3 rounded-xl p-3 text-xs sm:text-sm leading-relaxed">
                          <span className="font-bold text-blue-300 [.light-theme_&]:!text-blue-700 mr-2">推荐理由:</span>
                          {result.reason}
                        </div>

                        {/* Mobile action bar: comfortable thumb reach on Android */}
                        <div className="flex sm:hidden items-center gap-2.5 mt-3.5 pt-1">
                          <button
                            type="button"
                            onClick={() => onSelectChar(char.id)}
                            className="flex-1 min-h-[46px] flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 active:scale-95 text-white font-semibold rounded-xl text-sm transition touch-manipulation select-none cursor-pointer shadow-sm"
                          >
                            <Play className="w-4 h-4 text-white" />
                            <span>查看角色</span>
                          </button>
                          {isGacha && (
                            <button
                              type="button"
                              onClick={handleRandomGacha}
                              disabled={isSearching}
                              className="recommender-btn-secondary flex-1 min-h-[46px] flex items-center justify-center gap-2 px-4 py-2.5 font-semibold rounded-xl text-sm transition touch-manipulation select-none cursor-pointer shadow-xs"
                            >
                              <Dices className="recommender-dice-icon w-4 h-4" />
                              <span>再抽一张</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
