import { getFallbackAvatar, resolveAvatarUrl } from '../lib/avatar';
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Trash2, X, Merge, MessageSquarePlus, 
  Link as LinkIcon, FileText, Folder, Lock, Unlock, ChevronLeft, ChevronRight,
  Sparkles, Filter, ShieldCheck, Info, RotateCcw, History, Check, CheckCircle2,
  Database
} from 'lucide-react';
import { CharacterCard, DuplicateGroup, findDuplicates, deleteCharacter, saveCharacter } from '../lib/db';
import { getLocalImageUrl } from '../lib/appBridge';

// 综合字数、世界书、开场白、拓展条目的完整度评分算法
export function computeCompletenessScore(char: CharacterCard): {
  score: number;
  wordCount: number;
  worldbookCount: number;
  greetingsCount: number;
} {
  const data = char.data?.data || char.data || {};
  
  const desc = (data.description || data.char_persona || '').trim();
  const personality = (data.personality || '').trim();
  const scenario = (data.scenario || '').trim();
  const firstMes = (data.first_mes || data.greeting || '').trim();
  const mesExample = (data.mes_example || '').trim();
  const systemPrompt = (data.system_prompt || '').trim();

  // 1. 核心人设设定字数
  const coreText = desc + personality + scenario + firstMes + mesExample + systemPrompt;
  const wordCount = coreText.length;

  // 2. 世界书条目数与世界书内容总字数
  const entries = data.character_book?.entries || data.extensions?.character_book?.entries || [];
  const worldbookCount = Array.isArray(entries) ? entries.length : 0;
  let worldbookTextLength = 0;
  if (Array.isArray(entries)) {
    entries.forEach((e: any) => {
      worldbookTextLength += (e.content || e.text || e.comment || '').length;
    });
  }

  // 3. 备选开场白数量与总字数
  const altGreetings = data.alternate_greetings || [];
  const greetingsCount = (firstMes ? 1 : 0) + (Array.isArray(altGreetings) ? altGreetings.length : 0);
  let altGreetingsLength = 0;
  if (Array.isArray(altGreetings)) {
    altGreetings.forEach((g: any) => {
      altGreetingsLength += (typeof g === 'string' ? g : '').length;
    });
  }

  const tagsCount = Array.isArray(data.tags) ? data.tags.length : (Array.isArray(char.tags) ? char.tags.length : 0);

  // 4. AI 简介
  const summary = (char.aiSummary || data.aiSummary || (char as any).data?.aiSummary || '').trim();
  const summaryBonus = summary ? 200 + Math.min(summary.length, 300) : 0;

  // 综合权重打分: 字数基础分 + 每条世界书奖励 500 分 + 每个开场白奖励 300 分 + 每个标签 20 分 + AI简介加分
  const score = wordCount 
    + (worldbookCount * 500 + worldbookTextLength) 
    + (greetingsCount * 300 + altGreetingsLength) 
    + (tagsCount * 20)
    + summaryBonus;

  return {
    score,
    wordCount: wordCount + worldbookTextLength + altGreetingsLength,
    worldbookCount,
    greetingsCount
  };
}

// Helper for simple avatar image retrieval with robust fallback
function CharAvatarImg({ char, className }: { char: CharacterCard, className: string }) {
  const defaultFallback = getFallbackAvatar(char.name || char.id, char.tags?.join(',') || (char.isTool ? 'tool' : undefined));
  const [url, setUrl] = useState<string | undefined>(resolveAvatarUrl(char.avatarUrlFallback, char.name || char.id));
  
  useEffect(() => {
    let objectUrl: string | null = null;
    let isMounted = true;
    if (char.localFilePath) {
      setUrl(getLocalImageUrl(char.localFilePath, char.updatedAt || char.createdAt));
    } else if (char.avatarBlob) {
      objectUrl = URL.createObjectURL(char.avatarBlob);
      setUrl(objectUrl);
    } else if (char.hasBlobsSeparated) {
      import('../lib/db').then(({ getCharacter }) => {
        if (!isMounted) return;
        getCharacter(char.id).then(fullChar => {
          if (fullChar && fullChar.avatarBlob && isMounted) {
            objectUrl = URL.createObjectURL(fullChar.avatarBlob);
            setUrl(objectUrl);
          }
        });
      });
    }
    return () => { isMounted = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [char]);

  return (
    <img 
      src={url || undefined} 
      alt={char.name} 
      className={className} 
      referrerPolicy="no-referrer" 
      onError={(e) => { if (e.currentTarget.src !== defaultFallback) e.currentTarget.src = defaultFallback; }} 
    />
  );
}

interface Props {
  onClose: () => void;
  onSelectChar: (id: string) => void;
}

export function DuplicateDetector({ onClose, onSelectChar }: Props) {
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [folderPathMap, setFolderPathMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Check light theme from html class, body class, and localStorage keys ('tavern_theme', 'theme_mode', 'theme')
  const [isLightMode, setIsLightMode] = useState(() => {
    if (typeof document === 'undefined') return false;
    return (
      document.documentElement.classList.contains('light-theme') ||
      document.body.classList.contains('light-theme') ||
      localStorage.getItem('tavern_theme') === 'light' ||
      localStorage.getItem('theme_mode') === 'light' ||
      localStorage.getItem('theme') === 'light'
    );
  });

  useEffect(() => {
    const checkTheme = () => {
      const isLight = 
        document.documentElement.classList.contains('light-theme') ||
        document.body.classList.contains('light-theme') ||
        localStorage.getItem('tavern_theme') === 'light' ||
        localStorage.getItem('theme_mode') === 'light' ||
        localStorage.getItem('theme') === 'light';
      setIsLightMode(!!isLight);
    };
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    if (typeof document !== 'undefined') {
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
      observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    }
    window.addEventListener('storage', checkTheme);
    return () => {
      observer.disconnect();
      window.removeEventListener('storage', checkTheme);
    };
  }, []);

  const [lockedIds, setLockedIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('miu_locked_duplicate_char_ids');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  const pageSize = 10;
  const longPressRef = useRef<{ timer: NodeJS.Timeout | null, triggered: boolean, startX?: number, startY?: number, lastTriggerTime?: number }>({ 
    timer: null, 
    triggered: false,
    lastTriggerTime: 0
  });

  const toggleLock = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setLockedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        if (selectedIds.has(id)) {
          setSelectedIds(s => {
            const updated = new Set(s);
            updated.delete(id);
            return updated;
          });
        }
      }
      localStorage.setItem('miu_locked_duplicate_char_ids', JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const loadDuplicates = async () => {
    setLoading(true);
    const groups = await findDuplicates();
    
    // 过滤掉预设、美化卡和独立世界书
    const filteredGroups = groups.filter(group => {
      if (group.characters.length === 0) return false;
      const c = group.characters[0].char;
      const rawData = c.data;
      const isPreset = !!(rawData.prompts || rawData.temperature !== undefined || rawData.top_p !== undefined);
      const isStandaloneWorldbook = rawData.entries !== undefined;
      const isTheme = rawData.blur_strength !== undefined || rawData.main_text_color !== undefined || rawData.chat_display !== undefined;
      const tags = c.data?.tags || c.data?.data?.tags || [];
      const isBeautify = tags.some((t: string) => t.includes('美化') || t.includes('预设') || t.includes('UI') || t.includes('主题') || t.includes('工具') || t.includes('插件') || t.includes('正则') || t.includes('组件') || t.includes('工作流'));
      const isQR = Array.isArray(rawData) 
        ? (rawData.length > 0 && rawData[0].label !== undefined && rawData[0].message !== undefined) 
        : ((rawData.quick_replies !== undefined || rawData.qrList !== undefined) && rawData.spec !== "chara_card_v2" && rawData.spec !== "chara_card_v3" && rawData.description === undefined && rawData.first_mes === undefined && rawData.personality === undefined && rawData.mes_example === undefined && rawData.char_name === undefined && rawData.character_name === undefined && rawData.name === undefined && rawData.data?.name === undefined);
      const isScript = rawData.type === 'script' && rawData.content !== undefined && rawData.name !== undefined;
      return !isPreset && !isBeautify && !isStandaloneWorldbook && !isTheme && !isQR && !isScript;
    });

    try {
      const { resolveFolderPath } = await import('../lib/db');
      const pathMap: Record<string, string> = {};
      for (const group of filteredGroups) {
        for (const item of group.characters) {
          if (item.char.folderId) {
            pathMap[item.char.id] = await resolveFolderPath(item.char.folderId);
          } else {
            pathMap[item.char.id] = "主页 未分类";
          }
        }
      }
      setFolderPathMap(pathMap);
    } catch (e) {
      console.error("加载文件夹路径出错:", e);
    }

    setDuplicateGroups(filteredGroups);
    setLoading(false);
  };

  useEffect(() => {
    loadDuplicates();
  }, []);

  const handleDelete = async (id: string) => {
    if (lockedIds.has(id)) {
      alert("该卡片已被锁定（免删保护），请先取消锁定后再删除。");
      return;
    }
    if (confirm('确定要删除此重复角色吗？')) {
      await deleteCharacter(id);
      loadDuplicates();
    }
  };

  const mergeAndSave = async (keptChar: CharacterCard, otherChars: CharacterCard[]) => {
    let updatedData = { ...keptChar.data };
    let targetData = updatedData.data ? updatedData.data : updatedData;

    if (!targetData.extensions) targetData.extensions = {};

    let mergedQRs = [...(targetData.extensions.quick_replies || [])];
    let mergedQRSets = [...(targetData.extensions.tavern_qr_sets || [])];
    let mergedSource = targetData.extensions.source || targetData.source || '';
    let mergedTags = [...(targetData.tags || [])];
    let mergedQrFilename = targetData.extensions.qr_filename || '';
    let mergedSummary = (keptChar.aiSummary || targetData.aiSummary || updatedData.aiSummary || '').trim();
    
    let mergedHistory = [...(keptChar.avatarHistory || [])];
    const seenBlobSizes = new Set(mergedHistory.map(b => b.size));
    if (keptChar.avatarBlob) seenBlobSizes.add(keptChar.avatarBlob.size);

    for (const other of otherChars) {
      const otherTarget = other.data.data ? other.data.data : other.data;

      // 合并 AI 简介：若保留卡片没有简介或被合并卡片有更详尽的简介，则保留最佳简介
      const otherSummary = (other.aiSummary || otherTarget.aiSummary || (other.data as any)?.aiSummary || '').trim();
      if (otherSummary) {
        if (!mergedSummary) {
          mergedSummary = otherSummary;
        } else if (otherSummary.length > mergedSummary.length) {
          mergedSummary = otherSummary;
        }
      }
      
      const otherQRSets = otherTarget.extensions?.tavern_qr_sets || [];
      for (const qrSet of otherQRSets) {
        if (!mergedQRSets.some(s => s.id === qrSet.id || s.sourceName === qrSet.sourceName)) {
          mergedQRSets.push(qrSet);
        }
      }

      const otherQRs = otherTarget.extensions?.quick_replies || [];
      for (const qr of otherQRs) {
        if (!mergedQRs.some(q => q.message === qr.message)) {
          mergedQRs.push(qr);
        }
      }

      const otherQrFilename = otherTarget.extensions?.qr_filename;
      if (!mergedQrFilename && otherQrFilename) {
        mergedQrFilename = otherQrFilename;
      }

      const otherSource = otherTarget.extensions?.source || otherTarget.source;
      if (!mergedSource && otherSource) {
        mergedSource = otherSource;
      }

      const otherTags = otherTarget.tags || [];
      for (const tag of otherTags) {
        if (!mergedTags.includes(tag)) {
          mergedTags.push(tag);
        }
      }

      const otherHistory = other.avatarHistory || [];
      for (const blob of otherHistory) {
        if (!seenBlobSizes.has(blob.size)) {
          mergedHistory.push(blob);
          seenBlobSizes.add(blob.size);
        }
      }
    }

    targetData.extensions.quick_replies = mergedQRs;
    targetData.extensions.tavern_qr_sets = mergedQRSets;
    targetData.extensions.source = mergedSource;
    targetData.tags = mergedTags;
    if (mergedQrFilename) {
      targetData.extensions.qr_filename = mergedQrFilename;
    }
    
    if (mergedSummary) {
      targetData.aiSummary = mergedSummary;
      if (updatedData.data) {
        updatedData.data.aiSummary = mergedSummary;
      }
      updatedData.aiSummary = mergedSummary;
    }

    if (!updatedData.data) {
      updatedData.source = mergedSource;
      updatedData.tags = mergedTags;
    }

    let targetFolderId = keptChar.folderId;
    if (!targetFolderId) {
      const folderCandidate = otherChars.find((c) => !!c.folderId);
      if (folderCandidate) {
        targetFolderId = folderCandidate.folderId;
      }
    }

    const finalChar = { 
      ...keptChar, 
      folderId: targetFolderId,
      data: updatedData,
      aiSummary: mergedSummary || keptChar.aiSummary,
      avatarHistory: mergedHistory.length > 0 ? mergedHistory : undefined
    };
    await saveCharacter(finalChar);
  };

  const handleMergeAndKeep = async (keptChar: CharacterCard, group: DuplicateGroup) => {
    let destFolder = keptChar.folderId ? folderPathMap[keptChar.id] : undefined;
    const allOtherChars = group.characters.map(c => c.char).filter(c => c.id !== keptChar.id);
    const otherChars = allOtherChars.filter(c => !lockedIds.has(c.id));
    
    if (otherChars.length === 0) {
      alert("组内其他卡片均已被锁定（免删保护），无可合并删除的卡片。");
      return;
    }

    const lockedCount = allOtherChars.length - otherChars.length;
    const lockNotice = lockedCount > 0 ? `\n\n🔒 已自动跳过 ${lockedCount} 张被锁定的卡片` : '';

    if (!destFolder) {
      const otherWithFolder = otherChars.find(c => !!c.folderId);
      if (otherWithFolder) {
        destFolder = folderPathMap[otherWithFolder.id];
      }
    }
    const folderNotice = destFolder ? `\n📁 卡片将保留并归类在文件夹：「${destFolder}」` : '';

    if (!confirm(`确定要保留此卡，合并其他未锁定卡片的快捷回复(QR)、替换头像、AI简介、来源链接和标签，并删除其他卡片吗？${lockNotice}${folderNotice}`)) return;

    await mergeAndSave(keptChar, otherChars);

    const { deleteCharactersBulk, getChatsForCharacter, saveChat } = await import('../lib/db');
    for (const charToDel of otherChars) {
       const chats = await getChatsForCharacter(charToDel.id);
       for (const chat of chats) {
          chat.characterId = keptChar.id;
          await saveChat(chat);
       }
    }
    await deleteCharactersBulk(otherChars.map(c => c.id));

    loadDuplicates();
  };

  const toggleSelection = (id: string) => {
    if (lockedIds.has(id)) return;
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const handleSelectDuplicates = (keep: 'earliest' | 'newest' | 'most_complete' = 'most_complete') => {
    const newSet = new Set<string>();
    duplicateGroups.forEach(group => {
      const chars = group.characters.map(c => c.char);
      if (chars.length <= 1) return;

      let charToKeep: CharacterCard;
      if (keep === 'most_complete') {
        const sorted = [...chars].sort((a, b) => {
          const scoreA = computeCompletenessScore(a).score;
          const scoreB = computeCompletenessScore(b).score;
          if (scoreB !== scoreA) return scoreB - scoreA;
          return b.createdAt - a.createdAt;
        });
        charToKeep = sorted[0];

        for (let i = 1; i < sorted.length; i++) {
          const c = sorted[i];
          if (!lockedIds.has(c.id)) {
            newSet.add(c.id);
          }
        }
      } else {
        const sorted = [...chars].sort((a, b) => b.createdAt - a.createdAt);
        charToKeep = keep === 'newest' ? sorted[0] : sorted[sorted.length - 1];
        
        for (let i = 0; i < sorted.length; i++) {
          const c = sorted[i];
          if (c.id === charToKeep.id) continue;
          if (lockedIds.has(c.id)) continue;
          
          const cData = c.data?.data || c.data || {};
          const kData = charToKeep.data?.data || charToKeep.data || {};
          
          const sameName = (c.name || cData.name || '').trim() === (charToKeep.name || kData.name || '').trim();
          const sameDesc = (cData.description || '').trim() === (kData.description || '').trim();
          const sameFirst = (cData.first_mes || '').trim() === (kData.first_mes || '').trim();
          const samePersonality = (cData.personality || '').trim() === (kData.personality || '').trim();
          const sameScenario = (cData.scenario || '').trim() === (kData.scenario || '').trim();
          const sameMesExample = (cData.mes_example || '').trim() === (kData.mes_example || '').trim();
          
          const cWorldbook = JSON.stringify(cData.character_book?.entries || cData.extensions?.character_book?.entries || []);
          const kWorldbook = JSON.stringify(kData.character_book?.entries || kData.extensions?.character_book?.entries || []);
          const sameWorldbook = cWorldbook === kWorldbook;
          
          const isExactlySameData = sameName && sameDesc && sameFirst && samePersonality && sameScenario && sameMesExample;
          
          if (isExactlySameData && sameWorldbook) {
             newSet.add(c.id);
          } else {
             // 如果同名且处于同一重复分组，也属于可快捷选中的较旧/较新项
             newSet.add(c.id);
          }
        }
      }
    });
    setSelectedIds(newSet);
    setSelectionMode(true);
  };

  const handleBatchDelete = async () => {
    const validIds = Array.from(selectedIds).filter(id => !lockedIds.has(id));
    if (validIds.length === 0) {
      alert("选中的卡片均已处于锁定保护状态，无法删除。");
      return;
    }
    const validSelectedSet = new Set(validIds);

    if (confirm(`确定要删除选中的 ${validIds.length} 张重复卡片吗？\n（已自动跳过并保护锁定的卡片；删除过程中会自动合并快捷回复(QR)、替换头像、AI简介、来源和标签，并自动保留卡片已归类的嵌套文件夹路径）`)) {
      setLoading(true);

      for (const group of duplicateGroups) {
        const charsToDelete = group.characters.map(c => c.char).filter(c => validSelectedSet.has(c.id));
        const charsToKeep = group.characters.map(c => c.char).filter(c => !validSelectedSet.has(c.id));

        if (charsToDelete.length > 0) {
          let winnerId = charsToKeep.length > 0 ? charsToKeep[0].id : undefined;
          if (charsToKeep.length > 0) {
            const winner = charsToKeep[0];
            await mergeAndSave(winner, charsToDelete);
          }

          const { deleteCharactersBulk, getChatsForCharacter, saveChat } = await import('../lib/db');
          if (winnerId) {
             for (const charToDel of charsToDelete) {
                const chats = await getChatsForCharacter(charToDel.id);
                for (const chat of chats) {
                   chat.characterId = winnerId;
                   await saveChat(chat);
                }
             }
          }
          await deleteCharactersBulk(charsToDelete.map(c => c.id));
        }
      }

      setSelectedIds(new Set());
      setSelectionMode(false);
      await loadDuplicates();
    }
  };

  const totalPages = Math.ceil(duplicateGroups.length / pageSize);
  const paginatedGroups = duplicateGroups.slice((page - 1) * pageSize, page * pageSize);

  const allSelectableIds = React.useMemo(() => {
    const ids: string[] = [];
    duplicateGroups.forEach(g => {
      g.characters.forEach(dupChar => {
        const charId = dupChar.char.id;
        if (!lockedIds.has(charId)) {
          ids.push(charId);
        }
      });
    });
    return ids;
  }, [duplicateGroups, lockedIds]);

  const isAllSelected = allSelectableIds.length > 0 && allSelectableIds.every(id => selectedIds.has(id));

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className={`fixed inset-0 z-50 flex flex-col select-none overflow-hidden font-sans bg-slate-950 text-slate-100 miu-skin [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!text-[#0f172a]`}
    >
      {/* Dynamic Header */}
      <header className={`sticky top-0 px-4 py-3 sm:px-6 sm:py-4 pt-[max(1.75rem,env(safe-area-inset-top))] sm:pt-[max(1.75rem,env(safe-area-inset-top))] flex items-center justify-between border-b backdrop-blur-2xl z-20 shrink-0 border-white/10 bg-slate-900/90 [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!bg-[#ffffff]/95`}>
        <div className="flex items-center gap-3 min-w-0">
          <button 
            onClick={() => {
              if (selectionMode) {
                setSelectionMode(false);
                setSelectedIds(new Set());
              } else {
                onClose();
              }
            }} 
            className={`p-2 rounded-xl transition shrink-0 cursor-pointer active:scale-95 bg-white/5 hover:bg-white/10 text-slate-300 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#0f172a]`} 
            title={selectionMode ? "退出选择" : "返回"}
          >
            <X className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className={`text-base sm:text-lg font-bold truncate leading-tight tracking-tight text-white [.light-theme_&]:!text-[#0f172a]`}>
                {selectionMode ? `已选中 ${selectedIds.size} 项` : '重复卡片检测'}
              </h2>
              {!loading && duplicateGroups.length > 0 && !selectionMode && (
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium bg-white/10 text-slate-200 border border-white/15 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#334155] [.light-theme_&]:!border-[#cbd5e1]`}>
                  {duplicateGroups.length} 组重复
                </span>
              )}
            </div>
            <p className={`text-xs truncate mt-0.5 text-slate-400 [.light-theme_&]:!text-[#64748b]`}>
              {selectionMode ? '选择要清理的旧卡片，删除时将自动合并聊天与配置' : '基于开场白、角色设定与世界书多维智能对比'}
            </p>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className={`flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar max-w-6xl w-full mx-auto space-y-6 ${selectionMode ? 'pb-28 sm:pb-32' : 'pb-8 sm:pb-12'}`}>
        {loading ? (
          <div className={`flex flex-col items-center justify-center h-64 text-slate-400 [.light-theme_&]:!text-[#64748b]`}>
            <div className="w-8 h-8 border-2 border-white/30 border-t-white [.light-theme_&]:!border-slate-300 [.light-theme_&]:!border-t-slate-800 rounded-full animate-spin mb-4" />
            <p className="text-xs font-medium">正在对比扫描重复卡片...</p>
          </div>
        ) : duplicateGroups.length === 0 ? (
          <div className={`flex flex-col items-center justify-center h-80 text-slate-400 [.light-theme_&]:!text-[#64748b]`}>
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4 [.light-theme_&]:!bg-emerald-50 [.light-theme_&]:!border-emerald-200">
              <ShieldCheck className="w-8 h-8 text-emerald-400 [.light-theme_&]:!text-emerald-600" />
            </div>
            <p className={`text-base font-bold mb-1 text-white [.light-theme_&]:!text-[#0f172a]`}>未发现重复角色卡</p>
            <p className="text-xs">您的角色卡库非常整洁，没有需要合并或删除的副本</p>
          </div>
        ) : (
          <div className="space-y-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={page}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.15 }}
                className="flex flex-col"
              >
                {paginatedGroups.map((group, groupIdx) => {
                  return (
                    <div key={group.id} className="w-full">
                      {groupIdx > 0 && (
                        <div className="py-4">
                          <div className="w-full border-t border-white/20 [.light-theme_&]:border-slate-200" />
                        </div>
                      )}

                      {/* Cards Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {group.characters.map(dupChar => {
                          const char = dupChar.char;
                          const reason = dupChar.reason;
                          const targetData = char.data.data ? char.data.data : char.data;
                          const hasQR = targetData.extensions?.quick_replies?.length > 0;
                          const hasSource = !!(targetData.extensions?.source || targetData.source);
                          const hasNotes = !!targetData.creator_notes;
                          const modifiedTime = char.fileModifiedAt || char.originalFile?.lastModified || char.updatedAt || char.createdAt;
                          const modifiedDate = new Date(modifiedTime);

                          const isSelected = selectedIds.has(char.id);
                          const isLocked = lockedIds.has(char.id);
                          const folderPath = folderPathMap[char.id] || (char.folderId ? "分类文件夹" : "主页 (未分类)");

                          const completeness = computeCompletenessScore(char);
                          const maxScoreInGroup = Math.max(...group.characters.map(c => computeCompletenessScore(c.char).score));
                          const isMostComplete = group.characters.length > 1 && completeness.score === maxScoreInGroup;

                          return (
                            <div 
                              key={char.id} 
                              className={`group relative flex flex-col p-4 rounded-2xl border transition-all duration-200 ${
                                isLocked 
                                  ? 'bg-slate-900/80 border-white/10 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!shadow-xs' 
                                  : isSelected
                                    ? 'bg-slate-950/90 border-white/10 [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:!border-[#e2e8f0]'
                                    : 'bg-slate-900/80 border-white/10 hover:border-white/20 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:hover:!border-[#cbd5e1] [.light-theme_&]:!shadow-xs'
                              }`}
                              onTouchStart={(e) => {
                                longPressRef.current.triggered = false;
                                if (e.touches && e.touches[0]) {
                                  longPressRef.current.startX = e.touches[0].clientX;
                                  longPressRef.current.startY = e.touches[0].clientY;
                                }
                                if (longPressRef.current.timer) clearTimeout(longPressRef.current.timer);
                                longPressRef.current.timer = setTimeout(() => {
                                  longPressRef.current.triggered = true;
                                  longPressRef.current.lastTriggerTime = Date.now();
                                  if (!isLocked) {
                                    setSelectionMode(true);
                                    setSelectedIds(prev => new Set(prev).add(char.id));
                                  }
                                }, 320);
                              }}
                              onTouchMove={(e) => {
                                if (longPressRef.current.timer && e.touches && e.touches[0]) {
                                  const dx = Math.abs(e.touches[0].clientX - (longPressRef.current.startX || 0));
                                  const dy = Math.abs(e.touches[0].clientY - (longPressRef.current.startY || 0));
                                  if (dx > 20 || dy > 20) {
                                    clearTimeout(longPressRef.current.timer);
                                    longPressRef.current.timer = null;
                                  }
                                }
                              }}
                              onTouchEnd={() => {
                                if (longPressRef.current.timer) {
                                  clearTimeout(longPressRef.current.timer);
                                  longPressRef.current.timer = null;
                                }
                              }}
                              onTouchCancel={() => {
                                if (longPressRef.current.timer) {
                                  clearTimeout(longPressRef.current.timer);
                                  longPressRef.current.timer = null;
                                }
                              }}
                              onMouseDown={(e) => {
                                if (e.button !== 0) return;
                                longPressRef.current.triggered = false;
                                longPressRef.current.startX = e.clientX;
                                longPressRef.current.startY = e.clientY;
                                if (longPressRef.current.timer) clearTimeout(longPressRef.current.timer);
                                longPressRef.current.timer = setTimeout(() => {
                                  longPressRef.current.triggered = true;
                                  longPressRef.current.lastTriggerTime = Date.now();
                                  if (!isLocked) {
                                    setSelectionMode(true);
                                    setSelectedIds(prev => new Set(prev).add(char.id));
                                  }
                                }, 320);
                              }}
                              onMouseMove={(e) => {
                                if (longPressRef.current.timer) {
                                  const dx = Math.abs(e.clientX - (longPressRef.current.startX || 0));
                                  const dy = Math.abs(e.clientY - (longPressRef.current.startY || 0));
                                  if (dx > 20 || dy > 20) {
                                    clearTimeout(longPressRef.current.timer);
                                    longPressRef.current.timer = null;
                                  }
                                }
                              }}
                              onMouseUp={() => {
                                if (longPressRef.current.timer) {
                                  clearTimeout(longPressRef.current.timer);
                                  longPressRef.current.timer = null;
                                }
                              }}
                              onMouseLeave={() => {
                                if (longPressRef.current.timer) {
                                  clearTimeout(longPressRef.current.timer);
                                  longPressRef.current.timer = null;
                                }
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                if (Date.now() - (longPressRef.current.lastTriggerTime || 0) < 800) return;
                                if (!isLocked) {
                                  setSelectionMode(true);
                                  toggleSelection(char.id);
                                }
                              }}
                              onClick={(e) => {
                                if (longPressRef.current.triggered || Date.now() - (longPressRef.current.lastTriggerTime || 0) < 600) {
                                  longPressRef.current.triggered = false;
                                  e.preventDefault();
                                  e.stopPropagation();
                                  return;
                                }
                                if (selectionMode && !isLocked) {
                                  toggleSelection(char.id);
                                }
                              }}
                            >
                              {/* Simple Dark/Light Dimming Mask & Checkmark Overlay on Selection */}
                              {isSelected && (
                                <>
                                  <div className="absolute inset-0 rounded-2xl z-20 pointer-events-none transition-all bg-black/65 [.light-theme_&]:!bg-slate-900/35" />
                                  <div className="absolute top-3 right-3 z-30 w-6 h-6 rounded-full bg-white text-slate-950 flex items-center justify-center shadow-md [.light-theme_&]:!bg-[#0f172a] [.light-theme_&]:!text-[#ffffff]">
                                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                                  </div>
                                </>
                              )}

                              {/* Header Row: Avatar + Name + Action Icons */}
                              <div className="flex items-start gap-3 mb-3">
                                {/* Avatar */}
                                <div 
                                  className="relative w-12 h-12 rounded-xl overflow-hidden shrink-0 border shadow-xs cursor-pointer z-10 bg-slate-800 border-white/10 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!border-[#e2e8f0]"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (selectionMode) {
                                      if (!isLocked) toggleSelection(char.id);
                                    } else {
                                      onSelectChar(char.id);
                                    }
                                  }}
                                >
                                  <CharAvatarImg char={char} className="w-full h-full object-cover" />
                                </div>

                                {/* Title & Folder */}
                                <div className="flex-1 min-w-0">
                                  <div 
                                    className="cursor-pointer hover:underline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (selectionMode) {
                                        if (!isLocked) toggleSelection(char.id);
                                      } else {
                                        onSelectChar(char.id);
                                      }
                                    }}
                                  >
                                    <h4 className="font-bold text-sm sm:text-base truncate leading-snug text-white [.light-theme_&]:!text-[#0f172a]">
                                      {char.name || '未命名角色'}
                                    </h4>
                                  </div>
                                  <div className="flex items-center gap-1 text-[11px] mt-1 truncate text-slate-400 [.light-theme_&]:!text-[#64748b]">
                                    <Folder className="w-3 h-3 shrink-0 opacity-70" />
                                    <span className="truncate">{folderPath}</span>
                                  </div>
                                </div>

                                {/* Lock Controls */}
                                {!isSelected && (
                                  <div className="flex items-center gap-1.5 shrink-0 z-30">
                                    <button
                                      type="button"
                                      onClick={(e) => toggleLock(char.id, e)}
                                      className={`p-1.5 rounded-lg border text-xs transition cursor-pointer active:scale-95 ${
                                        isLocked
                                          ? 'bg-white/15 text-white border-white/25 hover:bg-white/20 [.light-theme_&]:!bg-[#0f172a] [.light-theme_&]:!text-[#ffffff] [.light-theme_&]:!border-[#0f172a]'
                                          : 'bg-white/5 text-slate-400 hover:text-white border-white/10 hover:bg-white/10 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#0f172a] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:hover:!bg-[#e2e8f0]'
                                      }`}
                                      title={isLocked ? "已锁定免删，点击解锁" : "锁定此卡片，防止误删或被快捷批量选中"}
                                    >
                                      {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                                    </button>
                                  </div>
                                )}
                              </div>

                              {/* Specs & Metadata Area */}
                              <div className="rounded-xl p-2.5 border mb-3 space-y-1.5 text-xs bg-black/30 border-white/5 text-slate-300 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#334155]">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-slate-400 [.light-theme_&]:!text-[#64748b]">修改时间</span>
                                  <span className="font-mono font-medium text-slate-200 [.light-theme_&]:!text-[#0f172a]">{modifiedDate.toLocaleDateString()}</span>
                                </div>
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-slate-400 [.light-theme_&]:!text-[#64748b]">设定 / 总字数</span>
                                  <span className="font-mono font-medium text-slate-200 [.light-theme_&]:!text-[#0f172a]">
                                    {(targetData.description || '').length} 字 (总计 {completeness.wordCount} 字)
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-slate-400 [.light-theme_&]:!text-[#64748b]">备用开场 / 世界书</span>
                                  <span className="font-medium text-slate-200 [.light-theme_&]:!text-[#0f172a]">
                                    {completeness.greetingsCount} 条 / {completeness.worldbookCount} 项
                                  </span>
                                </div>
                              </div>

                              {/* Unboxed Metadata & Indicator Badges */}
                              <div className="flex flex-wrap items-center gap-1.5 mb-4 text-[11px]">
                                {isMostComplete && (
                                  <span className="px-2 py-0.5 rounded-md border font-semibold flex items-center gap-1 bg-emerald-500/15 text-emerald-300 border-emerald-500/25 [.light-theme_&]:!bg-emerald-50 [.light-theme_&]:!text-emerald-700 [.light-theme_&]:!border-emerald-200 shrink-0">
                                    <Database className="w-3 h-3 text-emerald-400 [.light-theme_&]:!text-emerald-600" />
                                    数据最全
                                  </span>
                                )}
                                {isLocked && (
                                  <span className="px-2 py-0.5 rounded-md border font-medium flex items-center gap-1 bg-white/10 text-white border-white/15 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#cbd5e1] shrink-0">
                                    <ShieldCheck className="w-3 h-3 text-emerald-400 [.light-theme_&]:!text-emerald-600" />
                                    免删保护
                                  </span>
                                )}
                                <span className="px-2 py-0.5 rounded-md border font-medium bg-white/5 text-slate-300 border-white/10 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!text-[#334155] [.light-theme_&]:!border-[#e2e8f0] shrink-0">
                                  {reason}
                                </span>
                                {hasQR && (
                                  <span className="px-2 py-0.5 rounded-md border flex items-center gap-1 bg-white/5 text-slate-300 border-white/10 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!text-[#334155] [.light-theme_&]:!border-[#e2e8f0] shrink-0">
                                    <MessageSquarePlus className="w-3 h-3 text-blue-400 [.light-theme_&]:!text-blue-600" /> QR
                                  </span>
                                )}
                                {hasSource && (
                                  <span className="px-2 py-0.5 rounded-md border flex items-center gap-1 bg-white/5 text-slate-300 border-white/10 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!text-[#334155] [.light-theme_&]:!border-[#e2e8f0] shrink-0">
                                    <LinkIcon className="w-3 h-3 text-blue-400 [.light-theme_&]:!text-blue-600" /> 来源
                                  </span>
                                )}
                                {hasNotes && (
                                  <span className="px-2 py-0.5 rounded-md border flex items-center gap-1 bg-white/5 text-slate-300 border-white/10 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!text-[#334155] [.light-theme_&]:!border-[#e2e8f0] shrink-0">
                                    <FileText className="w-3 h-3 text-emerald-400 [.light-theme_&]:!text-emerald-600" /> 备注
                                  </span>
                                )}
                              </div>

                              {/* Action Toolbar */}
                              <div className="mt-auto grid grid-cols-2 gap-2 pt-2 border-t border-white/10 [.light-theme_&]:!border-[#e2e8f0]">
                                <button
                                  type="button"
                                  disabled={selectionMode || isLocked}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMergeAndKeep(char, group);
                                  }}
                                  className={`px-3 py-2 rounded-xl transition text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer border-0 border-none outline-none ${
                                    isLocked
                                      ? 'bg-white/5 text-slate-500 cursor-not-allowed [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#94a3b8] [.light-theme_&]:!border-none'
                                      : 'bg-white/10 hover:bg-white/15 text-slate-200 hover:text-white [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-none'
                                  }`}
                                >
                                  <Merge className={`w-3.5 h-3.5 shrink-0 ${isLocked ? 'text-slate-500 [.light-theme_&]:!text-[#94a3b8]' : 'text-slate-200 [.light-theme_&]:!text-[#0f172a]'}`} />
                                  <span>{isLocked ? "已保护" : "合并并保留"}</span>
                                </button>

                                <button
                                  type="button"
                                  disabled={selectionMode || isLocked}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(char.id);
                                  }}
                                  className={`px-3 py-2 rounded-xl transition text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer border-0 border-none outline-none ${
                                    isLocked
                                      ? 'bg-white/5 text-slate-500 cursor-not-allowed [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#94a3b8] [.light-theme_&]:!border-none'
                                      : 'bg-white/[0.06] hover:bg-rose-500/15 text-[#ff453a] hover:text-[#ff6961] [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#fee2e2] [.light-theme_&]:!text-[#ff3b30] [.light-theme_&]:hover:!text-[#e02e24] [.light-theme_&]:!border-none'
                                  }`}
                                >
                                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                  <span>{isLocked ? "已锁定" : "删除此卡"}</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
              })}
              </motion.div>
            </AnimatePresence>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-4 border-t border-white/10 [.light-theme_&]:!border-[#e2e8f0]">
                <button 
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-2 rounded-xl border text-xs font-medium transition cursor-pointer shadow-xs flex items-center gap-1 bg-white/5 hover:bg-white/10 text-slate-200 border-white/10 disabled:opacity-40 disabled:cursor-not-allowed [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:hover:!bg-[#f1f5f9] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#cbd5e1]"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>上一页</span>
                </button>

                <span className="text-xs font-mono font-medium px-2 text-slate-400 [.light-theme_&]:!text-[#64748b]">
                  {page} / {totalPages}
                </span>

                <button 
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-2 rounded-xl border text-xs font-medium transition cursor-pointer shadow-xs flex items-center gap-1 bg-white/5 hover:bg-white/10 text-slate-200 border-white/10 disabled:opacity-40 disabled:cursor-not-allowed [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:hover:!bg-[#f1f5f9] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#cbd5e1]"
                >
                  <span>下一页</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Action Bar - Floating Pill Dock matching CharacterList */}
      <AnimatePresence>
        {selectionMode && (
          <motion.div
            initial={{ y: 24, opacity: 0, scale: 0.95, x: "-50%" }}
            animate={{ y: 0, opacity: 1, scale: 1, x: "-50%" }}
            exit={{ y: 20, opacity: 0, scale: 0.95, x: "-50%" }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="floating-pill-dock fixed bottom-6 left-1/2 z-50 rounded-full px-2 sm:px-3 py-1.5 transition-all max-w-[calc(100vw-1rem)] sm:max-w-max"
          >
            <div
              className="flex items-center gap-0.5 sm:gap-1.5 px-0.5 overflow-x-auto hide-scrollbar"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              <button
                type="button"
                onClick={() => handleSelectDuplicates('most_complete')}
                className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-2 sm:px-2.5 py-1 rounded-full transition active:scale-90 shrink-0 hover:!text-emerald-400"
                title="保留最全（综合对比：字数、世界书、开场白最多的一张）"
              >
                <Database className="w-4.5 h-4.5 sm:w-5 sm:h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight whitespace-nowrap">选最全</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectDuplicates('newest')}
                className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-2 sm:px-2.5 py-1 rounded-full transition active:scale-90 shrink-0 hover:!text-amber-400"
                title="保留最新"
              >
                <Sparkles className="w-4.5 h-4.5 sm:w-5 sm:h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight whitespace-nowrap">选最新</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectDuplicates('earliest')}
                className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-2 sm:px-2.5 py-1 rounded-full transition active:scale-90 shrink-0 hover:!text-indigo-400"
                title="保留最旧"
              >
                <History className="w-4.5 h-4.5 sm:w-5 sm:h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight whitespace-nowrap">选最旧</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (isAllSelected) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(allSelectableIds));
                  }
                }}
                className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-2 sm:px-2.5 py-1 rounded-full transition active:scale-90 shrink-0"
              >
                <CheckCircle2 className="w-4.5 h-4.5 sm:w-5 sm:h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight whitespace-nowrap">
                  {isAllSelected ? '取消' : '全选'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleBatchDelete}
                disabled={selectedIds.size === 0}
                className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-2 sm:px-2.5 py-1 rounded-full transition active:scale-90 shrink-0 hover:!text-rose-500 disabled:opacity-30 disabled:pointer-events-none"
              >
                <Trash2 className="w-4.5 h-4.5 sm:w-5 sm:h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight whitespace-nowrap">
                  删除{selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectionMode(false);
                  setSelectedIds(new Set());
                }}
                className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-2 sm:px-2.5 py-1 rounded-full transition active:scale-90 shrink-0 hover:!text-slate-400"
              >
                <X className="w-4.5 h-4.5 sm:w-5 sm:h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight whitespace-nowrap">退出</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
