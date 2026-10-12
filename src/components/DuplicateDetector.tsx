import { getFallbackAvatar, resolveAvatarUrl, safeCreateObjectURL } from '../lib/avatar';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Trash2, X, Merge, MessageSquarePlus, ArrowLeft,
  Link as LinkIcon, FileText, Folder, Lock, Unlock, ChevronLeft, ChevronRight,
  Sparkles, Filter, ShieldCheck, Info, RotateCcw, History, Check, CheckCircle2,
  Database, Archive, ArchiveRestore, BookmarkCheck, ArrowRightLeft, Layers
} from 'lucide-react';
import { CharacterCard, DuplicateGroup, ResourceType, findDuplicates, deleteCharacter, saveCharacter, getResourceType } from '../lib/db';
import { getLocalImageUrl } from '../lib/appBridge';

// 便宜的"数据变更指纹"：只读轻量的 char_meta 索引（不含卡片正文），
// 用来判断这次刷新到底有没有必要重跑昂贵的全量查重扫描。
async function computeMetaSignature(): Promise<string> {
  try {
    const { getCachedMeta } = await import('../lib/db');
    const meta = await getCachedMeta();
    let deletedCount = 0;
    let newestUpdatedAt = 0;
    for (const m of meta) {
      if (m.deletedAt) deletedCount += 1;
      const u = m.updatedAt || 0;
      if (u > newestUpdatedAt) newestUpdatedAt = u;
    }
    return `${meta.length}|${deletedCount}|${newestUpdatedAt}`;
  } catch {
    // 失败时返回一个不可能相等的值，保证该扫的时候一定会扫
    return `unknown-${Date.now()}`;
  }
}

// 综合字数、世界书、开场白、拓展条目的完整度评分算法（支持角色卡、世界书、QR等独立类型评分）
export function computeCompletenessScore(char: CharacterCard, resType: ResourceType = 'character'): {
  score: number;
  wordCount: number;
  worldbookCount: number;
  greetingsCount: number;
} {
  const data = char.data?.data || char.data || {};
  const tagsCount = Array.isArray(data.tags) ? data.tags.length : (Array.isArray(char.tags) ? char.tags.length : 0);

  // 1. 快速回复 (QR): 根据动作按钮数量与提示词字数打分
  if (resType === 'qr') {
    const qrList = Array.isArray(data.qrList) ? data.qrList : (Array.isArray(data) ? data : (data.buttons || data.quick_replies || []));
    const count = Array.isArray(qrList) ? qrList.length : 0;
    let textLen = 0;
    if (Array.isArray(qrList)) {
      qrList.forEach((q: any) => {
        textLen += String(q.message || q.label || q.text || q.content || '').length;
      });
    }
    const score = count * 1000 + textLen + tagsCount * 20;
    return {
      score,
      wordCount: textLen,
      worldbookCount: 0,
      greetingsCount: count
    };
  }

  // 2. 世界书 (Worldbook): 根据条目数与条目详细字数打分
  if (resType === 'worldbook') {
    const entries = data.entries || data.character_book?.entries || (Array.isArray(data) ? data : []);
    const entList = Array.isArray(entries) ? entries : Object.values(entries || {});
    let textLen = 0;
    entList.forEach((e: any) => {
      textLen += String(e.content || e.text || e.comment || '').length;
    });
    const score = entList.length * 1000 + textLen + tagsCount * 20;
    return {
      score,
      wordCount: textLen,
      worldbookCount: entList.length,
      greetingsCount: 0
    };
  }

  // 3. 预设 (Preset): 根据提示词条目数打分
  if (resType === 'preset') {
    const prompts = Array.isArray(data.prompts) ? data.prompts : [];
    let pLen = 0;
    prompts.forEach((p: any) => {
      pLen += String(p.content || p.text || '').length;
    });
    const score = prompts.length * 1000 + pLen;
    return {
      score,
      wordCount: pLen,
      worldbookCount: 0,
      greetingsCount: prompts.length
    };
  }

  // 4. 普通角色卡 (Character)
  const desc = (data.description || data.char_persona || '').trim();
  const personality = (data.personality || '').trim();
  const scenario = (data.scenario || '').trim();
  const firstMes = (data.first_mes || data.greeting || '').trim();
  const mesExample = (data.mes_example || '').trim();
  const systemPrompt = (data.system_prompt || '').trim();

  // 核心人设设定或预设/工具提示词字数
  let extraContent = '';
  if (data.prompts && Array.isArray(data.prompts)) {
    extraContent = data.prompts.map((p: any) => p.content || p.text || '').join('');
  } else if (data.content && typeof data.content === 'string') {
    extraContent = data.content;
  }
  const coreText = desc + personality + scenario + firstMes + mesExample + systemPrompt + extraContent;
  const wordCount = coreText.length;

  // 世界书条目数与世界书内容总字数
  const entries = data.character_book?.entries || data.extensions?.character_book?.entries || (Array.isArray(data.entries) ? data.entries : []);
  const worldbookCount = Array.isArray(entries) ? entries.length : 0;
  let worldbookTextLength = 0;
  if (Array.isArray(entries)) {
    entries.forEach((e: any) => {
      worldbookTextLength += (e.content || e.text || e.comment || '').length;
    });
  }

  // 备选开场白数量与总字数
  const altGreetings = data.alternate_greetings || [];
  const greetingsCount = (firstMes ? 1 : 0) + (Array.isArray(altGreetings) ? altGreetings.length : 0);
  let altGreetingsLength = 0;
  if (Array.isArray(altGreetings)) {
    altGreetings.forEach((g: any) => {
      altGreetingsLength += (typeof g === 'string' ? g : '').length;
    });
  }

  // AI 简介
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

/**
 * 提取卡片的核心内容指纹（用于判断是否为实质完全相同的同一版本）
 * 角色卡对比：设定、开场白、人格、场景、示例、世界书条目等核心字段
 * 世界书对比：全部条目内容
 * QR/快速回复对比：全部动作按钮与消息内容
 */
export function getCardContentSignature(char: CharacterCard, resType?: ResourceType): string {
  const data = char.data?.data || char.data || {};
  const effectiveType = resType || getResourceType(char);
  const cleanStr = (s: any) => String(s || '').replace(/\r\n/g, '\n').trim();

  if (effectiveType === 'qr' || char.isQR) {
    const list = Array.isArray(data.qrList) ? data.qrList : (Array.isArray(data) ? data : (data.buttons || data.quick_replies || []));
    const items = (Array.isArray(list) ? list : []).map((q: any) => 
      `${cleanStr(q.message || q.label || q.text)}::${cleanStr(q.execute)}`
    ).sort().join(';;');
    return `qr:${items || JSON.stringify(list)}`;
  }

  if (effectiveType === 'worldbook') {
    const entries = data.entries || data.character_book?.entries || (Array.isArray(data) ? data : {});
    const entList = Array.isArray(entries) ? entries : Object.values(entries || {});
    const items = entList.map((e: any) => 
      `${Array.isArray(e.keys) ? e.keys.map(cleanStr).join(',') : cleanStr(e.keys || e.key)}::${cleanStr(e.content || e.text || e.comment)}`
    ).sort().join(';;');
    return `wb:${items || JSON.stringify(entries)}`;
  }

  if (effectiveType === 'preset') {
    const prompts = data.prompts || [];
    const pStr = Array.isArray(prompts) ? prompts.map((p: any) => cleanStr(p.content || p.text)).join(';;') : '';
    return `preset:${pStr}|${data.temperature || ''}|${data.top_p || ''}`;
  }

  // 角色卡 (Character card)
  const desc = cleanStr(data.description);
  const first = cleanStr(data.first_mes);
  const personality = cleanStr(data.personality);
  const scenario = cleanStr(data.scenario);
  const mesExample = cleanStr(data.mes_example);
  const systemPrompt = cleanStr(data.system_prompt);
  const creatorNotes = cleanStr(data.creator_notes);

  const altGreetings = Array.isArray(data.alternate_greetings) 
    ? data.alternate_greetings.map(cleanStr).sort().join(';;') 
    : '';

  const entries = data.character_book?.entries || data.extensions?.character_book?.entries || [];
  const entList = Array.isArray(entries) ? entries : Object.values(entries || {});
  const wbStr = entList.map((e: any) => 
    `${Array.isArray(e.keys) ? e.keys.map(cleanStr).join(',') : cleanStr(e.keys || e.key)}::${cleanStr(e.content || e.text)}`
  ).sort().join(';;');

  return `char:${desc}###${first}###${personality}###${scenario}###${mesExample}###${systemPrompt}###${creatorNotes}###${altGreetings}###${wbStr}`;
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
      objectUrl = safeCreateObjectURL(char.avatarBlob);
      if (objectUrl) setUrl(objectUrl);
    } else if (char.hasBlobsSeparated) {
      import('../lib/db').then(({ getCharacter }) => {
        if (!isMounted) return;
        getCharacter(char.id).then(fullChar => {
          if (fullChar && fullChar.avatarBlob && isMounted) {
            objectUrl = safeCreateObjectURL(fullChar.avatarBlob);
            if (objectUrl) setUrl(objectUrl);
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
  refreshTrigger?: number;
}

export function DuplicateDetector({ onClose, onSelectChar, refreshTrigger }: Props) {
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

  const [activeTab, setActiveTab] = useState<'pending' | 'stashed'>('pending');
  const [stashedGroupSignatures, setStashedGroupSignatures] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('miu_stashed_duplicate_groups');
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

  const getGroupSignature = (group: DuplicateGroup) => {
    return group.characters.map(c => c.char.id).sort().join('::');
  };

  const toggleStashGroup = (group: DuplicateGroup, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const sig = getGroupSignature(group);
    setStashedGroupSignatures(prev => {
      const next = new Set(prev);
      if (next.has(sig)) {
        next.delete(sig);
        // 移出收纳共存时，自动解除这组卡片的锁定状态
        setLockedIds(prevLocked => {
          const nextLocked = new Set(prevLocked);
          group.characters.forEach(c => nextLocked.delete(c.char.id));
          localStorage.setItem('miu_locked_duplicate_char_ids', JSON.stringify(Array.from(nextLocked)));
          return nextLocked;
        });
      } else {
        next.add(sig);
        // 移入收纳共存时，自动将该组所有卡片设为免删锁定，防止被批量误删
        setLockedIds(prevLocked => {
          const nextLocked = new Set(prevLocked);
          group.characters.forEach(c => nextLocked.add(c.char.id));
          localStorage.setItem('miu_locked_duplicate_char_ids', JSON.stringify(Array.from(nextLocked)));
          return nextLocked;
        });
      }
      localStorage.setItem('miu_stashed_duplicate_groups', JSON.stringify(Array.from(next)));
      return next;
    });
  };

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

  // 记录最近一次扫描开始的时刻，避免"面板内部操作已经立即扫过一遍"之后又被
  // refreshTrigger 触发一次重复的全量扫描（大卡库下这个扫描开销不小）。
  const lastScanAtRef = useRef(0);
  const refreshTriggerRef = useRef(refreshTrigger);
  const lastSignatureRef = useRef<string | null>(null);

  const loadDuplicates = useCallback(async (showSpinner: boolean = true) => {
    if (showSpinner) setLoading(true);
    lastScanAtRef.current = Date.now();
    try {
      const signature = await computeMetaSignature();
      const groups = await findDuplicates();

      // 包含普通角色卡以及工具区预设、世界书、脚本等所有资源
      const filteredGroups = groups.filter(group => group.characters.length > 0);

      lastSignatureRef.current = signature;
      setDuplicateGroups(filteredGroups);
      setLoading(false);

      // 文件夹路径只是展示用的附加信息, 放到列表渲染之后再补, 不要拖着首屏转圈。
      try {
        const { resolveFolderPath } = await import('../lib/db');
        const pathCache = new Map<string, string>();
        const pathMap: Record<string, string> = {};
        for (const group of filteredGroups) {
          for (const item of group.characters) {
            const folderId = item.char.folderId;
            if (!folderId) {
              pathMap[item.char.id] = "主页 未分类";
              continue;
            }
            let path = pathCache.get(folderId);
            if (path === undefined) {
              path = await resolveFolderPath(folderId);
              pathCache.set(folderId, path);
            }
            pathMap[item.char.id] = path;
          }
        }
        setFolderPathMap(pathMap);
      } catch (e) {
        console.error("加载文件夹路径出错:", e);
      }
    } catch (e) {
      // 扫描失败也必须收起加载态, 否则面板会永远停在"转圈"上。
      console.error("查重扫描失败:", e);
      lastSignatureRef.current = null;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDuplicates();
  }, [loadDuplicates]);

  // App 里的 refreshKey 会在"卡片数据变化 / 详情页关闭"时变化。查重面板在详情页
  // 打开时不会卸载，所以这里必须跟着重新扫描一次；否则刚被移进回收站或归档成历史
  // 版本的卡片会一直留在重复卡列表里（看起来像"已经放进回收站却还在 app 里"）。
  useEffect(() => {
    if (refreshTrigger === undefined || refreshTriggerRef.current === refreshTrigger) return;
    refreshTriggerRef.current = refreshTrigger;
    const timer = setTimeout(async () => {
      // 面板自己的删除 / 合并已经立即重新扫过一遍了，这里不再重复扫
      if (Date.now() - lastScanAtRef.current < 600) return;
      // 卡片数据其实没变（例如只是关掉详情页、切了下文件夹）就直接跳过，
      // 一次扫描都不跑，大卡库下也不会反复卡顿。
      if ((await computeMetaSignature()) === lastSignatureRef.current) return;
      loadDuplicates(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [refreshTrigger, loadDuplicates]);

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

    // 跨类型安全防护：严禁将世界书/QR等工具与角色卡相互合并覆盖
    const targetType = group.resourceType || getResourceType(keptChar);
    for (const other of otherChars) {
      const otherType = getResourceType(other);
      if (otherType !== targetType) {
        alert("安全保护：检测到跨类别数据！角色卡、世界书、快捷回复(QR)互不相同，严禁相互合并或删除工具。操作已中止。");
        return;
      }
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

  const handleSelectDuplicates = (mode: 'most_complete' | 'newest' | 'earliest' = 'most_complete') => {
    const newSet = new Set<string>();

    duplicateGroups.forEach(group => {
      const chars = group.characters.map(c => c.char);
      if (chars.length <= 1) return;

      // 按卡片实际内容指纹聚类（区分 1 和 2 等互不相同的内容版本）
      const versionBuckets = new Map<string, CharacterCard[]>();
      chars.forEach(c => {
        const sig = getCardContentSignature(c, group.resourceType);
        const list = versionBuckets.get(sig) || [];
        list.push(c);
        versionBuckets.set(sig, list);
      });

      // 规则：
      // 1. 如果组内各个版本都只有 1 张（例如只有 1 和 2，没有 11 或 22），则不触发自动勾选，保留供用户自己筛选！
      // 2. 如果存在相同内容的副本（例如 112、122、1122），则对该版本内部按最全/最新/最旧保留 1 张，其余多余副本标记删除！
      versionBuckets.forEach(bucketChars => {
        if (bucketChars.length > 1) {
          const sortedBucket = [...bucketChars].sort((a, b) => {
            if (lockedIds.has(a.id) && !lockedIds.has(b.id)) return -1;
            if (!lockedIds.has(a.id) && lockedIds.has(b.id)) return 1;
            if (a.folderId && !b.folderId) return -1;
            if (!a.folderId && b.folderId) return 1;

            if (mode === 'most_complete') {
              const scoreA = computeCompletenessScore(a, group.resourceType).score;
              const scoreB = computeCompletenessScore(b, group.resourceType).score;
              if (scoreB !== scoreA) return scoreB - scoreA;
              return b.createdAt - a.createdAt;
            } else if (mode === 'newest') {
              return b.createdAt - a.createdAt;
            } else {
              return a.createdAt - b.createdAt;
            }
          });

          // sortedBucket[0] 保留为主版本，其余副版本选入待删除
          for (let i = 1; i < sortedBucket.length; i++) {
            const toDel = sortedBucket[i];
            if (!lockedIds.has(toDel.id)) {
              newSet.add(toDel.id);
            }
          }
        }
        // 如果 bucketChars.length === 1（该版本只有 1 张，如 12 中的 1 或 2），不触发删除，安全保留！
      });
    });

    if (newSet.size === 0) {
      alert("智能对比提示：当前卡片均为互不相同的版本（如 1 与 2），未发现完全相同的多余副本。\n\n各不同版本均已完整保留，供您自行查看与筛选。");
      return;
    }

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

    if (confirm(`确定要删除选中的 ${validIds.length} 张重复副本吗？\n（已自动跳过并保护锁定的卡片；相同副本的聊天与拓展配置将自动合并至其对应的保留卡片）`)) {
      setLoading(true);

      for (const group of duplicateGroups) {
        const charsToDelete = group.characters.map(c => c.char).filter(c => validSelectedSet.has(c.id));
        const charsToKeep = group.characters.map(c => c.char).filter(c => !validSelectedSet.has(c.id));

        if (charsToDelete.length > 0) {
          const { deleteCharactersBulk, getChatsForCharacter, saveChat } = await import('../lib/db');

          if (charsToKeep.length > 0) {
            // 对待删除卡片进行智能归属匹配：
            // 如果有多张卡片被保留（例如新版本 1A 和旧版本 2A 同时被保留）：
            // 待删副本 1B 归并至 1A；待删副本 2B 归并至 2A！
            // 聊天记录和元数据对应迁移，互不混淆！
            const deleteBuckets = new Map<string, CharacterCard[]>();
            for (const delChar of charsToDelete) {
              const delSig = getCardContentSignature(delChar, group.resourceType);
              let matchedKept = charsToKeep.find(k => getCardContentSignature(k, group.resourceType) === delSig);
              if (!matchedKept) {
                matchedKept = charsToKeep[0];
              }
              const list = deleteBuckets.get(matchedKept.id) || [];
              list.push(delChar);
              deleteBuckets.set(matchedKept.id, list);
            }

            for (const [keptId, bucketDelChars] of deleteBuckets.entries()) {
              const keptChar = charsToKeep.find(k => k.id === keptId);
              if (keptChar) {
                await mergeAndSave(keptChar, bucketDelChars);
              }
              for (const delChar of bucketDelChars) {
                const chats = await getChatsForCharacter(delChar.id);
                for (const chat of chats) {
                  chat.characterId = keptId;
                  await saveChat(chat);
                }
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

  const { pendingGroups, stashedGroups } = React.useMemo(() => {
    const pending: DuplicateGroup[] = [];
    const stashed: DuplicateGroup[] = [];
    duplicateGroups.forEach(g => {
      const sig = getGroupSignature(g);
      if (stashedGroupSignatures.has(sig)) {
        stashed.push(g);
      } else {
        pending.push(g);
      }
    });
    return { pendingGroups: pending, stashedGroups: stashed };
  }, [duplicateGroups, stashedGroupSignatures]);

  const [typeFilter, setTypeFilter] = useState<'all' | 'character' | 'qr' | 'worldbook' | 'tools'>('all');

  const currentTabGroups = activeTab === 'pending' ? pendingGroups : stashedGroups;

  const typeCounts = React.useMemo(() => {
    let char = 0, qr = 0, wb = 0, tool = 0;
    currentTabGroups.forEach(g => {
      if (g.resourceType === 'character') char++;
      else if (g.resourceType === 'qr') qr++;
      else if (g.resourceType === 'worldbook') wb++;
      else tool++;
    });
    return { char, qr, wb, tool, all: currentTabGroups.length };
  }, [currentTabGroups]);

  const currentGroups = React.useMemo(() => {
    if (typeFilter === 'all') return currentTabGroups;
    if (typeFilter === 'character') return currentTabGroups.filter(g => g.resourceType === 'character');
    if (typeFilter === 'qr') return currentTabGroups.filter(g => g.resourceType === 'qr');
    if (typeFilter === 'worldbook') return currentTabGroups.filter(g => g.resourceType === 'worldbook');
    if (typeFilter === 'tools') return currentTabGroups.filter(g => g.resourceType !== 'character' && g.resourceType !== 'qr' && g.resourceType !== 'worldbook');
    return currentTabGroups;
  }, [currentTabGroups, typeFilter]);

  const totalPages = Math.ceil(currentGroups.length / pageSize) || 1;
  const paginatedGroups = React.useMemo(
    () => currentGroups.slice((page - 1) * pageSize, page * pageSize),
    [currentGroups, page]
  );

  // 每张卡的内容指纹 / 完整度评分原本是在 render 里现算的, 组内还算了一次
  // Math.max(...map(score)) —— 一个几百张卡的重复组就是近十万次全文扫描, 每敲一个
  // 字都会重跑一遍, 表现出来就是"一直在转圈"。这里按当前页数据只算一次, 渲染查表。
  const cardStats = React.useMemo(() => {
    const map = new Map<string, {
      sig: string;
      completeness: ReturnType<typeof computeCompletenessScore>;
      hasQR: boolean;
      hasSource: boolean;
      hasNotes: boolean;
    }>();
    for (const group of paginatedGroups) {
      for (const dupChar of group.characters) {
        const char = dupChar.char;
        if (map.has(char.id)) continue;
        const targetData: any = char.data?.data ? char.data.data : char.data;
        map.set(char.id, {
          sig: getCardContentSignature(char, group.resourceType),
          completeness: computeCompletenessScore(char, group.resourceType),
          hasQR: (targetData?.extensions?.quick_replies?.length || 0) > 0,
          hasSource: !!(targetData?.extensions?.source || targetData?.source),
          hasNotes: !!targetData?.creator_notes,
        });
      }
    }
    return map;
  }, [paginatedGroups]);

  const groupStats = React.useMemo(() => {
    const perGroup = new Map<string, { maxScore: number; buckets: Map<string, CharacterCard[]> }>();
    for (const group of paginatedGroups) {
      const buckets = new Map<string, CharacterCard[]>();
      let maxScore = -Infinity;
      for (const dupChar of group.characters) {
        const stat = cardStats.get(dupChar.char.id);
        if (!stat) continue;
        if (stat.completeness.score > maxScore) maxScore = stat.completeness.score;
        const list = buckets.get(stat.sig) || [];
        list.push(dupChar.char);
        buckets.set(stat.sig, list);
      }
      perGroup.set(group.id, { maxScore, buckets });
    }
    return perGroup;
  }, [paginatedGroups, cardStats]);

  const allSelectableIds = React.useMemo(() => {
    const ids: string[] = [];
    currentGroups.forEach(g => {
      g.characters.forEach(dupChar => {
        const charId = dupChar.char.id;
        if (!lockedIds.has(charId)) {
          ids.push(charId);
        }
      });
    });
    return ids;
  }, [currentGroups, lockedIds]);

  const isAllSelected = allSelectableIds.length > 0 && allSelectableIds.every(id => selectedIds.has(id));

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className={`fixed inset-0 z-50 flex flex-col select-none overflow-hidden font-sans bg-slate-950 text-slate-100 miu-skin [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!text-[#0f172a]`}
    >
      {/* Dynamic Header matching AutoTagger */}
      <header className="sticky top-0 px-3.5 pb-0 pt-[max(1.75rem,env(safe-area-inset-top))] sm:px-6 sm:pt-[max(1.75rem,env(safe-area-inset-top))] flex flex-col gap-3 sm:gap-4 bg-slate-900/90 backdrop-blur-xl border-b border-white/10 z-20 [.light-theme_&]:!bg-[#ffffff]/95 [.light-theme_&]:!border-[#e2e8f0] shadow-2xs">
        <div className="flex items-center justify-between gap-3 sm:gap-4">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <button 
              onClick={() => {
                if (selectionMode) {
                  setSelectionMode(false);
                  setSelectedIds(new Set());
                } else {
                  onClose();
                }
              }} 
              className="p-2 -ml-2 rounded-full transition text-white/80 hover:text-white hover:bg-white/10 [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!bg-transparent [.light-theme_&]:hover:!bg-black/5 [.light-theme_&]:active:!bg-black/10 cursor-pointer" 
              title={selectionMode ? "退出选择" : "返回"}
            >
              <ArrowLeft className="w-5 sm:w-6 h-5 sm:h-6" />
            </button>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-white [.light-theme_&]:!text-[#0f172a] truncate">
                {selectionMode ? `已选中 ${selectedIds.size} 项` : '重复卡片检测'}
              </h1>
              <p className="text-xs sm:text-sm text-white/50 mt-0.5 sm:mt-1 truncate [.light-theme_&]:!text-[#64748b]">
                {selectionMode ? '仅标记完全相同的多余副本，新旧等各独立版本均已安全保留' : '基于开场白、角色设定与世界书多维智能对比'}
              </p>
            </div>
          </div>

          {selectionMode && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setSelectionMode(false);
                  setSelectedIds(new Set());
                }}
                className="px-3 py-1.5 rounded-full text-xs font-semibold text-slate-300 hover:text-white bg-white/10 hover:bg-white/15 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#334155] border-none transition cursor-pointer"
              >
                取消选择
              </button>
            </div>
          )}
        </div>

        {/* Sliding Tabs matching AutoTagger exactly */}
        <div className="flex items-center gap-3 sm:gap-6 overflow-x-auto no-scrollbar w-full mt-1 shrink-0">
          <button
            onClick={() => { setActiveTab('pending'); setPage(1); }}
            className={`pb-2.5 sm:pb-3 pt-1 px-1 sm:px-2 text-xs sm:text-sm font-bold transition-all relative flex items-center justify-center gap-1.5 cursor-pointer border-0 border-none shrink-0 ${
              activeTab === 'pending'
                ? 'text-white [.light-theme_&]:!text-[#0f172a]'
                : 'text-white/60 hover:text-white [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#0f172a]'
            }`}
          >
            <span className="whitespace-nowrap">待处理 ({pendingGroups.length})</span>
            {activeTab === 'pending' && (
              <motion.div
                layoutId="activeDuplicateTabUnderline"
                className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-white [.light-theme_&]:!bg-black rounded-full"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
          </button>

          <button
            onClick={() => { setActiveTab('stashed'); setPage(1); }}
            className={`pb-2.5 sm:pb-3 pt-1 px-1 sm:px-2 text-xs sm:text-sm font-bold transition-all relative flex items-center justify-center gap-1.5 cursor-pointer border-0 border-none shrink-0 ${
              activeTab === 'stashed'
                ? 'text-white [.light-theme_&]:!text-[#0f172a]'
                : 'text-white/60 hover:text-white [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#0f172a]'
            }`}
          >
            <span className="whitespace-nowrap">已收纳共存 ({stashedGroups.length})</span>
            {activeTab === 'stashed' && (
              <motion.div
                layoutId="activeDuplicateTabUnderline"
                className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-white [.light-theme_&]:!bg-black rounded-full"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
          </button>
        </div>

        {/* 资源类别快捷筛选栏（快速回复、世界书、角色卡严格区分，统一雅致不花哨） */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-2 -mx-1 px-1 shrink-0 border-t border-white/5 [.light-theme_&]:!border-black/5">
          <button
            type="button"
            onClick={() => { setTypeFilter('all'); setPage(1); }}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition active:scale-95 cursor-pointer border-none shrink-0 flex items-center gap-1.5 ${
              typeFilter === 'all'
                ? 'bg-white text-slate-950 [.light-theme_&]:!bg-[#0f172a] [.light-theme_&]:!text-white shadow-xs'
                : 'bg-white/10 text-slate-300 hover:text-white [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#64748b]'
            }`}
          >
            <span>全部 ({typeCounts.all})</span>
          </button>
          <button
            type="button"
            onClick={() => { setTypeFilter('character'); setPage(1); }}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition active:scale-95 cursor-pointer border-none shrink-0 flex items-center gap-1.5 ${
              typeFilter === 'character'
                ? 'bg-white text-slate-950 [.light-theme_&]:!bg-[#0f172a] [.light-theme_&]:!text-white shadow-xs'
                : 'bg-white/10 text-slate-300 hover:text-white [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#64748b]'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
            <span>角色卡 ({typeCounts.char})</span>
          </button>
          <button
            type="button"
            onClick={() => { setTypeFilter('qr'); setPage(1); }}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition active:scale-95 cursor-pointer border-none shrink-0 flex items-center gap-1.5 ${
              typeFilter === 'qr'
                ? 'bg-white text-slate-950 [.light-theme_&]:!bg-[#0f172a] [.light-theme_&]:!text-white shadow-xs'
                : 'bg-white/10 text-slate-300 hover:text-white [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#64748b]'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
            <span>快速回复 ({typeCounts.qr})</span>
          </button>
          <button
            type="button"
            onClick={() => { setTypeFilter('worldbook'); setPage(1); }}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition active:scale-95 cursor-pointer border-none shrink-0 flex items-center gap-1.5 ${
              typeFilter === 'worldbook'
                ? 'bg-white text-slate-950 [.light-theme_&]:!bg-[#0f172a] [.light-theme_&]:!text-white shadow-xs'
                : 'bg-white/10 text-slate-300 hover:text-white [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#64748b]'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
            <span>世界书 ({typeCounts.wb})</span>
          </button>
          {typeCounts.tool > 0 && (
            <button
              type="button"
              onClick={() => { setTypeFilter('tools'); setPage(1); }}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition active:scale-95 cursor-pointer border-none shrink-0 flex items-center gap-1.5 ${
                typeFilter === 'tools'
                  ? 'bg-white text-slate-950 [.light-theme_&]:!bg-[#0f172a] [.light-theme_&]:!text-white shadow-xs'
                  : 'bg-white/10 text-slate-300 hover:text-white [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#64748b]'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
              <span>预设/工具 ({typeCounts.tool})</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <div className={`flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar max-w-6xl w-full mx-auto space-y-6 ${selectionMode ? 'pb-28 sm:pb-32' : 'pb-8 sm:pb-12'}`}>
        {loading ? (
          <div className={`flex flex-col items-center justify-center h-64 text-slate-400 [.light-theme_&]:!text-[#64748b]`}>
            <div className="w-8 h-8 border-2 border-white/30 border-t-white [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:!border-t-[#0f172a] rounded-full animate-spin mb-4" />
            <p className="text-xs font-medium">正在对比扫描重复卡片...</p>
          </div>
        ) : currentGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 [.light-theme_&]:!text-[#64748b]">
            <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center mb-3.5 [.light-theme_&]:!bg-[#f1f5f9] border-none">
              {activeTab === 'stashed' ? (
                <Archive className="w-7 h-7 text-white/50 [.light-theme_&]:!text-[#64748b] stroke-[1.6]" />
              ) : (
                <ShieldCheck className="w-7 h-7 text-white/50 [.light-theme_&]:!text-[#64748b] stroke-[1.6]" />
              )}
            </div>
            <p className="text-base font-bold mb-1 text-white [.light-theme_&]:!text-[#0f172a]">
              {activeTab === 'stashed' ? '暂无收纳的共存卡' : '没有待处理的重复角色卡'}
            </p>
            <p className="text-xs text-white/40 [.light-theme_&]:!text-[#64748b] text-center max-w-sm leading-relaxed">
              {activeTab === 'stashed'
                ? '在待处理列表中点击「收纳并存」，可将想同时保留的多版本卡片归纳到此处，避免重复打扰'
                : stashedGroups.length > 0 
                  ? `已将 ${stashedGroups.length} 组多版本卡收纳到「已收纳共存」中，有需要时可切换查看`
                  : '您的角色卡库非常整洁，没有需要合并或删除的副本'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${activeTab}-${page}`}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.15 }}
                className="flex flex-col space-y-6"
              >
                {paginatedGroups.map((group, groupIdx) => {
                  const sig = getGroupSignature(group);
                  const isStashed = stashedGroupSignatures.has(sig);

                  const sigBuckets = groupStats.get(group.id)?.buckets || new Map<string, CharacterCard[]>();
                  let groupRedundantCount = 0;
                  sigBuckets.forEach(b => {
                    if (b.length > 1) groupRedundantCount += (b.length - 1);
                  });

                  return (
                    <div key={group.id} className="w-full">
                      {groupIdx > 0 && (
                        <div className="py-2.5">
                          <div className="w-full h-px bg-white/5 [.light-theme_&]:!bg-[#e2e8f0]" />
                        </div>
                      )}

                      {/* Group Header Bar */}
                      <div className="flex items-center justify-between gap-3 mb-2.5 px-0.5">
                        <div className="flex items-center gap-2 min-w-0">
                          {(() => {
                            const badgeInfo = (() => {
                              switch (group.resourceType) {
                                case 'qr':
                                  return { label: '快速回复 (QR)', dotColor: 'bg-emerald-400' };
                                case 'worldbook':
                                  return { label: '世界书', dotColor: 'bg-purple-400' };
                                case 'preset':
                                  return { label: '预设', dotColor: 'bg-amber-400' };
                                case 'script':
                                  return { label: '脚本', dotColor: 'bg-cyan-400' };
                                case 'theme':
                                  return { label: '美化', dotColor: 'bg-pink-400' };
                                default:
                                  return { label: '角色卡', dotColor: 'bg-indigo-400' };
                              }
                            })();
                            return (
                              <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 text-slate-200 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#334155] font-semibold shrink-0 flex items-center gap-1.5 select-none">
                                <span className={`w-1.5 h-1.5 rounded-full ${badgeInfo.dotColor} shrink-0`} />
                                <span>{badgeInfo.label}</span>
                              </span>
                            );
                          })()}
                          <h3 className="font-semibold text-sm sm:text-base text-slate-100 [.light-theme_&]:!text-[#0f172a] truncate">
                            {group.characters[0]?.char.name || '同名资源组'}
                          </h3>
                          <span className="text-xs text-slate-400 [.light-theme_&]:!text-[#64748b] shrink-0 font-normal">
                            ({group.characters.length} 个版本)
                          </span>
                          {isStashed && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 text-slate-300 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#475569] border-none shrink-0 font-medium flex items-center gap-1">
                              <BookmarkCheck className="w-3 h-3 text-emerald-400 [.light-theme_&]:!text-emerald-600" />
                              已收纳共存
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={selectionMode}
                            onClick={(e) => toggleStashGroup(group, e)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all duration-150 active:scale-95 cursor-pointer select-none border-none outline-none ${
                              isStashed
                                ? 'bg-white/15 hover:bg-white/20 text-slate-200 [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:hover:!bg-[#d5dce6] [.light-theme_&]:!text-[#0f172a]'
                                : 'bg-white/[0.08] hover:bg-white/[0.14] text-slate-300 hover:text-white [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#0f172a]'
                            }`}
                            title={isStashed ? "取消收纳，移回待处理列表" : "标记这组卡为多版本共存并收纳（自动免删锁定），不影响待处理视图"}
                          >
                            {isStashed ? (
                              <ArchiveRestore className="w-3.5 h-3.5 opacity-75 shrink-0" />
                            ) : (
                              <Archive className="w-3.5 h-3.5 opacity-75 shrink-0" />
                            )}
                            <span>{isStashed ? "移回待处理" : "收纳并存"}</span>
                          </button>
                        </div>
                      </div>

                      {/* Cards Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {group.characters.map(dupChar => {
                          const char = dupChar.char;
                          const reason = dupChar.reason;
                          const stat = cardStats.get(char.id);
                          const cardSig = stat?.sig || "";
                          const sameSigCards = sigBuckets.get(cardSig) || [];
                          const isDeputyVersion = sameSigCards.length > 1 && sameSigCards[0].id !== char.id;
                          const targetData = char.data.data ? char.data.data : char.data;
                          const hasQR = stat?.hasQR || false;
                          const hasSource = stat?.hasSource || false;
                          const hasNotes = stat?.hasNotes || false;
                          const modifiedTime = char.fileModifiedAt || char.originalFile?.lastModified || char.updatedAt || char.createdAt;
                          const modifiedDate = new Date(modifiedTime);

                          const isSelected = selectedIds.has(char.id);
                          const isLocked = lockedIds.has(char.id);
                          const folderPath = folderPathMap[char.id] || (char.folderId ? "分类文件夹" : "主页 (未分类)");

                          const completeness = stat?.completeness ?? computeCompletenessScore(char, group.resourceType);
                          const maxScoreInGroup = groupStats.get(group.id)?.maxScore ?? -Infinity;
                          const isMostComplete = group.characters.length > 1 && completeness.score === maxScoreInGroup;

                          return (
                            <div 
                              key={char.id} 
                              className={`group relative flex flex-col p-4 rounded-2xl transition-all duration-200 border-none ${
                                isLocked 
                                  ? 'bg-white/[0.09] [.light-theme_&]:!bg-white [.light-theme_&]:!shadow-[0_2px_12px_rgba(0,0,0,0.04)]' 
                                  : isSelected
                                    ? 'bg-white/20 [.light-theme_&]:!bg-[#e2e8f0]'
                                    : 'bg-white/[0.09] [.light-theme_&]:!bg-white [.light-theme_&]:!shadow-[0_2px_12px_rgba(0,0,0,0.04)]'
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
                              {/* Clear Non-Occluding Dimming Mask & Checkmark Overlay on Selection */}
                              {isSelected && (
                                <>
                                  <div className="absolute inset-0 rounded-2xl z-20 pointer-events-none transition-all bg-black/40 [.light-theme_&]:!bg-slate-900/25 ring-2 ring-indigo-500/80 ring-inset" />
                                  <div className="absolute top-2.5 right-2.5 z-30 w-5.5 h-5.5 rounded-full bg-white text-slate-950 flex items-center justify-center shadow-md [.light-theme_&]:!bg-[#0f172a] [.light-theme_&]:!text-[#ffffff] [.light-theme_&]:!hidden">
                                    <Check className="w-3 h-3 stroke-[3]" />
                                  </div>
                                </>
                              )}

                              {/* Header Row: Avatar + Name + Action Icons */}
                              <div className="flex items-start gap-3 mb-3">
                                {/* Avatar */}
                                <div 
                                  className="relative w-12 h-12 rounded-xl overflow-hidden shrink-0 shadow-xs cursor-pointer z-10 bg-slate-800 border-none [.light-theme_&]:!bg-[#f1f5f9]"
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
                                      {char.name || '未命名'}
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
                                      className={`p-1.5 rounded-full transition-all duration-150 cursor-pointer active:scale-90 border-none ${
                                        isLocked
                                          ? 'bg-amber-400/20 text-amber-300 hover:bg-amber-400/30 [.light-theme_&]:!bg-amber-100/90 [.light-theme_&]:!text-amber-800'
                                          : 'bg-transparent text-slate-400 hover:text-white hover:bg-white/10 [.light-theme_&]:!bg-transparent [.light-theme_&]:hover:!bg-[#f1f5f9] [.light-theme_&]:!text-slate-400 [.light-theme_&]:hover:!text-[#334155]'
                                      }`}
                                      title={isLocked ? "已锁定免删，点击解锁" : "锁定此卡片，防止误删或被快捷批量选中"}
                                    >
                                      {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5 opacity-60 hover:opacity-100" />}
                                    </button>
                                  </div>
                                )}
                              </div>

                              {/* Specs & Metadata Area (类型定制化信息显示) */}
                              <div className="rounded-xl p-2.5 mb-3 space-y-1.5 text-xs bg-black/40 text-slate-200 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!text-[#334155] border-none">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-slate-400 [.light-theme_&]:!text-[#64748b]">修改时间</span>
                                  <span className="font-mono font-medium text-slate-200 [.light-theme_&]:!text-[#0f172a]">{modifiedDate.toLocaleDateString()}</span>
                                </div>
                                {group.resourceType === 'qr' ? (
                                  <>
                                    <div className="flex items-center justify-between text-[11px]">
                                      <span className="text-slate-400 [.light-theme_&]:!text-[#64748b]">动作按钮数</span>
                                      <span className="font-mono font-medium text-slate-200 [.light-theme_&]:!text-[#0f172a]">
                                        {completeness.greetingsCount} 项动作
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px]">
                                      <span className="text-slate-400 [.light-theme_&]:!text-[#64748b]">快捷回复字数</span>
                                      <span className="font-mono font-medium text-slate-200 [.light-theme_&]:!text-[#0f172a]">
                                        {completeness.wordCount} 字
                                      </span>
                                    </div>
                                  </>
                                ) : group.resourceType === 'worldbook' ? (
                                  <>
                                    <div className="flex items-center justify-between text-[11px]">
                                      <span className="text-slate-400 [.light-theme_&]:!text-[#64748b]">世界书词条</span>
                                      <span className="font-mono font-medium text-slate-200 [.light-theme_&]:!text-[#0f172a]">
                                        {completeness.worldbookCount} 个条目
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px]">
                                      <span className="text-slate-400 [.light-theme_&]:!text-[#64748b]">词条总字数</span>
                                      <span className="font-mono font-medium text-slate-200 [.light-theme_&]:!text-[#0f172a]">
                                        {completeness.wordCount} 字
                                      </span>
                                    </div>
                                  </>
                                ) : group.resourceType === 'preset' ? (
                                  <>
                                    <div className="flex items-center justify-between text-[11px]">
                                      <span className="text-slate-400 [.light-theme_&]:!text-[#64748b]">提示词条目</span>
                                      <span className="font-mono font-medium text-slate-200 [.light-theme_&]:!text-[#0f172a]">
                                        {completeness.greetingsCount} 条提示词
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px]">
                                      <span className="text-slate-400 [.light-theme_&]:!text-[#64748b]">预设总字数</span>
                                      <span className="font-mono font-medium text-slate-200 [.light-theme_&]:!text-[#0f172a]">
                                        {completeness.wordCount} 字
                                      </span>
                                    </div>
                                  </>
                                ) : (
                                  <>
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
                                  </>
                                )}
                              </div>

                              {/* Unboxed Metadata & Indicator Badges (iOS borderless color blocks) */}
                              <div className="flex flex-wrap items-center gap-1.5 mb-3 text-[11px]">
                                {isMostComplete && (
                                  <span className="px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 bg-blue-500/20 text-blue-300 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-blue-600 border-none shrink-0">
                                    <Database className="w-3 h-3 text-blue-300 [.light-theme_&]:!text-blue-600" />
                                    数据最全
                                  </span>
                                )}
                                {isLocked && (
                                  <span className="px-2 py-0.5 rounded-full font-medium flex items-center gap-1 bg-amber-500/20 text-amber-300 [.light-theme_&]:!bg-amber-100/90 [.light-theme_&]:!text-amber-800 border-none shrink-0">
                                    <ShieldCheck className="w-3 h-3 text-amber-300 [.light-theme_&]:!text-amber-600" />
                                    免删保护
                                  </span>
                                )}
                                <span className="px-2.5 py-0.5 rounded-full font-medium bg-white/10 text-slate-200 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#475569] border-none shrink-0">
                                  {reason}
                                </span>
                                {hasQR && group.resourceType !== 'qr' && (
                                  <span className="px-2.5 py-0.5 rounded-full flex items-center gap-1 bg-white/10 text-slate-200 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#475569] border-none shrink-0">
                                    <MessageSquarePlus className="w-3 h-3 text-blue-300 [.light-theme_&]:!text-blue-600" /> QR
                                  </span>
                                )}
                                {hasSource && (
                                  <span className="px-2.5 py-0.5 rounded-full flex items-center gap-1 bg-white/10 text-slate-200 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#475569] border-none shrink-0">
                                    <LinkIcon className="w-3 h-3 text-blue-300 [.light-theme_&]:!text-blue-600" /> 来源
                                  </span>
                                )}
                                {hasNotes && (
                                  <span className="px-2.5 py-0.5 rounded-full flex items-center gap-1 bg-white/10 text-slate-200 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#475569] border-none shrink-0">
                                    <FileText className="w-3 h-3 text-slate-300 [.light-theme_&]:!text-slate-600" /> 备注
                                  </span>
                                )}
                              </div>

                              {/* Action Toolbar - Pure borderless color blocks with enhanced brightness */}
                              <div className="mt-auto grid grid-cols-2 gap-2 pt-1 border-none">
                                <button
                                  type="button"
                                  disabled={selectionMode || isLocked}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMergeAndKeep(char, group);
                                  }}
                                  className={`px-3 py-2 rounded-xl transition text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer border-none outline-none ${
                                    isLocked
                                      ? 'bg-white/5 text-slate-500 cursor-not-allowed [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#94a3b8] [.light-theme_&]:!border-none'
                                      : 'bg-white/[0.07] hover:bg-white/12 text-slate-300 hover:text-white [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-none'
                                  }`}
                                >
                                  <Merge className={`w-3.5 h-3.5 shrink-0 ${isLocked ? 'text-slate-500 [.light-theme_&]:!text-[#94a3b8]' : 'text-slate-300 [.light-theme_&]:!text-[#0f172a]'}`} />
                                  <span>{isLocked ? "已保护" : "合并并保留"}</span>
                                </button>

                                <button
                                  type="button"
                                  disabled={selectionMode || isLocked}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(char.id);
                                  }}
                                  className={`px-3 py-2 rounded-xl transition text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer border-none outline-none ${
                                    isLocked
                                      ? 'bg-white/5 text-slate-500 cursor-not-allowed [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#94a3b8] [.light-theme_&]:!border-none'
                                      : 'bg-rose-500/25 hover:bg-rose-500/35 text-rose-300 hover:text-rose-200 [.light-theme_&]:!bg-rose-50 [.light-theme_&]:hover:!bg-rose-100 [.light-theme_&]:!text-rose-600 [.light-theme_&]:hover:!text-rose-700 [.light-theme_&]:!border-none'
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
              <div className="flex items-center justify-center gap-3 pt-4 border-none">
                <button 
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-2 rounded-xl text-xs font-medium transition cursor-pointer flex items-center gap-1 bg-white/10 hover:bg-white/15 text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] border-none"
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
                  className="p-2 rounded-xl text-xs font-medium transition cursor-pointer flex items-center gap-1 bg-white/10 hover:bg-white/15 text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] border-none"
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
                title="保留最全（自动去重相同副本，保留各独立版本）"
              >
                <Database className="w-4.5 h-4.5 sm:w-5 sm:h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight whitespace-nowrap">选最全</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectDuplicates('newest')}
                className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-2 sm:px-2.5 py-1 rounded-full transition active:scale-90 shrink-0 hover:!text-amber-400"
                title="保留最新（自动去重相同副本，保留各独立版本）"
              >
                <Sparkles className="w-4.5 h-4.5 sm:w-5 sm:h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight whitespace-nowrap">选最新</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectDuplicates('earliest')}
                className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-2 sm:px-2.5 py-1 rounded-full transition active:scale-90 shrink-0 hover:!text-indigo-400"
                title="保留最旧（自动去重相同副本，保留各独立版本）"
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
                className="floating-pill-item is-danger flex flex-col items-center justify-center gap-0.5 px-2 sm:px-2.5 py-1 rounded-full transition active:scale-90 shrink-0 cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
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
