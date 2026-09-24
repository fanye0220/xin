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
        reason: "🎲 命运的指引！今天就决定是你了！"
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

      // 2. Score characters based on keywords
      addLog('正在本地角色库中匹配相关角色...');
      const scored = allChars.map(c => {
        const text = `${c.data?.name || c.data?.data?.name} ${c.data?.description || c.data?.data?.description} ${(c.data?.tags || c.data?.data?.tags || []).join(' ')}`.toLowerCase();
        let score = 0;
        keywords.forEach(k => { if (text.includes(k.toLowerCase())) score++; });
        return { char: c, score };
      }).sort((a, b) => b.score - a.score).slice(0, 30);

      const candidates = scored.length > 0 ? scored.map(s => s.char) : allChars.slice(0, 30);
      addLog(`初步筛选出 ${candidates.length} 个候选角色，正在请求 AI 进行深度评估...`);

      // 3. Ask AI to recommend from the candidates
      const candidateInfo = candidates.map(c => `ID: ${c.id}\n姓名: ${c.data?.name || c.data?.data?.name}\n描述: ${(c.data?.description || c.data?.data?.description || '').substring(0, 150)}\n标签: ${(c.data?.tags || c.data?.data?.tags || []).join(',')}`).join('\n\n');

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
    <div className="flex flex-col h-full bg-slate-900">
      <header className="sticky top-0 px-4 pb-4 pt-[max(1.75rem,env(safe-area-inset-top))] sm:px-6 sm:pb-6 sm:pt-[max(1.75rem,env(safe-area-inset-top))] flex items-center gap-4 bg-slate-900/80 backdrop-blur-xl border-b border-white/10 z-20">
        <button onClick={onClose} className="p-2 -ml-2 rounded-full hover:bg-white/10 transition">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-blue-400" />
            AI 智能推荐
          </h1>
          <p className="text-sm text-white/50 mt-1">告诉 AI 你想玩什么剧情，让它为你挑选角色</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          
          {apiKeyMissing && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5 text-red-400 flex items-start gap-4 shadow-lg shadow-red-500/5">
              <AlertCircle className="w-6 h-6 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-lg">未配置 API</h3>
                <p className="text-sm opacity-80 mt-1 mb-3">使用智能推荐功能需要配置自定义 API (OpenAI 格式接口)。</p>
                <button 
                  onClick={onOpenSettings}
                  className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg text-sm font-medium transition"
                >
                  去配置 API
                </button>
              </div>
            </div>
          )}

          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <label className="block text-sm font-medium text-white/80 mb-3">
              你想玩怎样的剧情或角色？
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="例如：我是主播，给我找个榜一大哥的卡..."
              className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500 transition-colors resize-none h-32"
            />
            <div className="mt-4 flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="text-sm text-white/40 flex items-center gap-2">
                <Dices className="w-4 h-4" />
                不知道玩什么？试试随机抽卡！(不消耗 API)
              </div>
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <button
                  onClick={handleRandomGacha}
                  disabled={isSearching}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-medium bg-white/10 hover:bg-white/20 text-white transition-all disabled:opacity-50"
                >
                  <Dices className="w-5 h-5" />
                  随机抽卡
                </button>
                <button
                  onClick={handleRecommend}
                  disabled={isSearching || !prompt.trim()}
                  className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-medium transition-all ${
                    isSearching || !prompt.trim()
                      ? 'bg-white/10 text-white/40 cursor-not-allowed'
                      : 'bg-gradient-to-r from-blue-500 to-emerald-500 hover:from-blue-400 hover:to-emerald-400 text-white shadow-lg shadow-blue-500/25'
                  }`}
                >
                  {isSearching ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      处理中...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      开始推荐
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* AI Thinking Logs */}
          {!isGacha && (logs.length > 0 || isSearching) && (
            <div className="bg-black/60 border border-white/10 rounded-2xl overflow-hidden shadow-inner">
              <div className="flex items-center gap-2 px-4 py-2 bg-white/5 border-b border-white/5">
                <Terminal className="w-4 h-4 text-white/40" />
                <span className="text-xs font-mono text-white/40 uppercase tracking-wider">AI 思维链 (Chain of Thought)</span>
              </div>
              <div className="p-4 font-mono text-sm h-48 overflow-y-auto space-y-2">
                {logs.map((log, i) => (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }} 
                    animate={{ opacity: 1, x: 0 }} 
                    key={i} 
                    className={`flex gap-3 ${log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-green-400' : 'text-white/70'}`}
                  >
                    <span className="text-white/30 shrink-0">[{log.time}]</span>
                    <span>{log.msg}</span>
                  </motion.div>
                ))}
                {isSearching && (
                  <div className="flex gap-3 text-blue-400 animate-pulse">
                    <span className="text-white/30 shrink-0">[{new Date().toLocaleTimeString()}]</span>
                    <span className="flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> 正在处理中...</span>
                  </div>
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-blue-400" />
                为你推荐了 {results.length} 个角色
              </h2>
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
                      className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col sm:flex-row gap-4 hover:bg-white/10 transition group"
                    >
                      <div className="w-24 h-24 sm:w-32 sm:h-32 shrink-0 rounded-xl overflow-hidden bg-black/40">
                        <RecommendResultAvatar char={char} name={data.name} />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-xl font-bold text-white group-hover:text-blue-400 transition-colors">
                              {data.name}
                            </h3>
                            {data.tags && data.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {data.tags.slice(0, 5).map((tag: string, j: number) => (
                                  <span key={j} className="px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded text-xs border border-blue-500/30">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => onSelectChar(char.id)}
                            className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-white/10 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition"
                          >
                            <Play className="w-4 h-4" />
                            查看角色
                          </button>
                        </div>
                        <div className="mt-4 bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-sm text-blue-100/80 leading-relaxed">
                          <span className="font-semibold text-blue-300 mr-2">推荐理由:</span>
                          {result.reason}
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
