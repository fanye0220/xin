import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Database,
  FileText,
  Folder,
  Link as LinkIcon,
  MessageSquarePlus,
  Merge,
  Trash2,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  CharacterCard,
  Folder as FolderType,
  getCharacter,
  saveCharacter,
  deleteCharacter,
  getResourceType,
  getCharacterThumb,
} from '../lib/db';
import {
  getFallbackAvatar,
  isFallbackMiuImage,
  resolveAvatarUrl,
  getBlobFingerprint,
} from '../lib/avatar';
import { getLocalImageUrl } from '../lib/appBridge';
import { peekCachedUrl, putCachedBlobUrl } from '../lib/thumbCache';
import { formatTokenCount, getCharacterTokenBreakdown } from '../lib/tokens';
import { computeCompletenessScore, getCardContentSignature } from './DuplicateDetector';
import { useBackHandler } from '../lib/useBackHandler';

interface CardCompareModalProps {
  pairIds: [string, string] | null;
  folders: FolderType[];
  onClose: () => void;
  onOpenChar: (id: string) => void;
  onMutated: (deletedId?: string) => void;
}

type CompareTab = 'overview' | 'greeting' | 'description' | 'worldbook';

function CompareAvatarImg({ char, className }: { char: CharacterCard; className: string }) {
  const defaultFallback = getFallbackAvatar(
    char.name || char.id,
    char.tags?.join(',') || (char.isTool ? 'tool' : undefined),
  );
  const [url, setUrl] = useState<string | undefined>(() =>
    resolveAvatarUrl(char.avatarUrlFallback, char.name || char.id),
  );

  useEffect(() => {
    let isMounted = true;
    if (char.localFilePath) {
      setUrl(getLocalImageUrl(char.localFilePath, char.updatedAt || char.createdAt));
      return;
    }

    const thumbCacheKey = `${char.id}:${char.updatedAt || 0}`;
    const cached = peekCachedUrl(thumbCacheKey);
    if (cached) {
      setUrl(cached);
      return;
    }

    if (char.avatarBlob) {
      const blobUrl = putCachedBlobUrl(thumbCacheKey, char.avatarBlob);
      if (blobUrl) setUrl(blobUrl);
      return;
    }

    getCharacterThumb(char.id)
      .then((thumbBlob) => {
        if (!isMounted || !thumbBlob) return;
        const blobUrl = putCachedBlobUrl(thumbCacheKey, thumbBlob);
        if (blobUrl) setUrl(blobUrl);
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [char.id, char.updatedAt, char.localFilePath, char.avatarBlob]);

  const isFallback = isFallbackMiuImage(url || defaultFallback);

  return (
    <img
      src={url || defaultFallback}
      alt={char.name}
      className={`${className} ${isFallback ? 'object-contain p-1.5 bg-white' : 'object-cover'}`}
      onError={() => {
        if (url !== defaultFallback) setUrl(defaultFallback);
      }}
    />
  );
}

function getCardFields(char: CharacterCard) {
  const data = char.data?.data || char.data || {};
  const cleanStr = (s: any) => String(s || '').replace(/\r\n/g, '\n').trim();
  const description = cleanStr(data.description || data.char_persona);
  const firstMes = cleanStr(data.first_mes || data.greeting);
  const personality = cleanStr(data.personality);
  const scenario = cleanStr(data.scenario);
  const creatorNotes = cleanStr(data.creator_notes || char.data?.creator_notes);
  const aiSummary = cleanStr(char.aiSummary || data.aiSummary || (char.data as any)?.aiSummary);

  const rawAltGreetings = data.alternate_greetings || data.extensions?.alternate_greetings || [];
  const altGreetings: string[] = (
    Array.isArray(rawAltGreetings) ? rawAltGreetings : Object.values(rawAltGreetings || {})
  )
    .map((g: any) => cleanStr(typeof g === 'string' ? g : g?.content || g?.message || ''))
    .filter(Boolean);

  const rawEntries =
    data.character_book?.entries ||
    data.extensions?.character_book?.entries ||
    data.entries ||
    [];
  const entriesList: any[] = Array.isArray(rawEntries)
    ? rawEntries
    : rawEntries && typeof rawEntries === 'object'
      ? Object.values(rawEntries)
      : [];

  const hasQR = Boolean(
    (data.extensions?.quick_replies && data.extensions.quick_replies.length > 0) ||
      (data.extensions?.tavern_qr_sets && data.extensions.tavern_qr_sets.length > 0) ||
      char.isQR,
  );
  const hasSource = Boolean(data.extensions?.source || data.source);
  const hasNotes = Boolean(creatorNotes);
  const tags = Array.isArray(data.tags) ? data.tags : Array.isArray(char.tags) ? char.tags : [];

  return {
    data,
    description,
    firstMes,
    personality,
    scenario,
    creatorNotes,
    aiSummary,
    altGreetings,
    entriesList,
    hasQR,
    hasSource,
    hasNotes,
    tags,
  };
}

export function CardCompareModal({
  pairIds,
  folders,
  onClose,
  onOpenChar,
  onMutated,
}: CardCompareModalProps) {
  const [cards, setCards] = useState<[CharacterCard, CharacterCard] | null>(null);
  const [loading, setLoading] = useState(false);
  const [workingAction, setWorkingAction] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CompareTab>('overview');

  useBackHandler(!!pairIds, () => {
    onClose();
    return true;
  });

  useEffect(() => {
    if (!pairIds) {
      setCards(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setActiveTab('overview');
    Promise.all([getCharacter(pairIds[0]), getCharacter(pairIds[1])])
      .then(([a, b]) => {
        if (cancelled) return;
        if (a && b) {
          setCards([a, b]);
        } else {
          setCards(null);
        }
      })
      .catch((err) => {
        console.error('加载对比卡片失败:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pairIds?.[0], pairIds?.[1]]);

  const folderMap = useMemo(() => {
    const map = new Map<string, FolderType>();
    for (const f of folders) map.set(f.id, f);
    return map;
  }, [folders]);

  const getFolderPathLabel = (folderId?: string | null) => {
    if (!folderId) return '';
    const parts: string[] = [];
    let curId: string | undefined | null = folderId;
    let safety = 0;
    while (curId && safety < 16) {
      const f = folderMap.get(curId);
      if (!f) break;
      parts.unshift(f.name);
      curId = f.parentId;
      safety += 1;
    }
    return parts.join('/');
  };

  const compareMeta = useMemo(() => {
    if (!cards) return null;
    const [cardA, cardB] = cards;
    const typeA = getResourceType(cardA);
    const typeB = getResourceType(cardB);
    const sameType = typeA === typeB;
    const scoreA = computeCompletenessScore(cardA, typeA);
    const scoreB = computeCompletenessScore(cardB, typeB);
    const tokensA = getCharacterTokenBreakdown(cardA);
    const tokensB = getCharacterTokenBreakdown(cardB);
    const sigA = getCardContentSignature(cardA, typeA);
    const sigB = getCardContentSignature(cardB, typeB);
    const fieldsA = getCardFields(cardA);
    const fieldsB = getCardFields(cardB);

    return {
      sameType,
      typeA,
      typeB,
      isIdentical: sameType && sigA === sigB,
      scores: [scoreA, scoreB] as const,
      tokens: [tokensA, tokensB] as const,
      fields: [fieldsA, fieldsB] as const,
      maxScore: Math.max(scoreA.score, scoreB.score),
    };
  }, [cards]);

  const handleMergeKeep = async (keepIdx: 0 | 1) => {
    if (!cards || !compareMeta) return;
    const keptCard = cards[keepIdx];
    const otherCard = cards[keepIdx === 0 ? 1 : 0];
    const keptType = getResourceType(keptCard);
    const otherType = getResourceType(otherCard);

    if (keptType !== otherType) {
      alert('安全保护：检测到两张卡片属于不同类型（如角色卡与世界书/QR），不可互相合并覆盖。');
      return;
    }

    const folderA = getFolderPathLabel(keptCard.folderId);
    const folderB = getFolderPathLabel(otherCard.folderId);
    const finalFolderPath = folderA || folderB;
    const folderNotice = finalFolderPath ? `\n📁 保留卡片将归类在：「${finalFolderPath}」` : '';

    if (
      !confirm(
        `确定保留「${keptCard.name}」，并将「${otherCard.name}」的头像差分、QR、备注、AI简介、来源、标签、历史版本及聊天记录合并后删除后者吗？${folderNotice}`,
      )
    ) {
      return;
    }

    setWorkingAction(`merge-${keptCard.id}`);
    try {
      const fullKept = (await getCharacter(keptCard.id)) || keptCard;
      const fullOther = (await getCharacter(otherCard.id)) || otherCard;

      const updatedData = JSON.parse(JSON.stringify(fullKept.data || {}));
      const targetData = updatedData.data ? updatedData.data : updatedData;
      if (!targetData.extensions) targetData.extensions = {};

      const mergedQRs = [...(targetData.extensions.quick_replies || [])];
      const mergedQRSets = [...(targetData.extensions.tavern_qr_sets || [])];
      const mergedTags = [...(targetData.tags || [])];
      let mergedSource = targetData.extensions.source || targetData.source || '';
      let mergedQrFilename = targetData.extensions.qr_filename || '';
      let mergedNotes = (targetData.creator_notes || updatedData.creator_notes || '').trim();
      let mergedSummary = (
        fullKept.aiSummary ||
        targetData.aiSummary ||
        updatedData.aiSummary ||
        ''
      ).trim();

      let finalAvatarBlob = fullKept.avatarBlob;
      const mergedHistory: Blob[] = [];
      const seenFingerprints = new Set<string>();

      if (finalAvatarBlob) {
        const fp = await getBlobFingerprint(finalAvatarBlob);
        if (fp) seenFingerprints.add(fp);
      }
      for (const b of fullKept.avatarHistory || []) {
        if (!b) continue;
        const fp = await getBlobFingerprint(b);
        if (fp && !seenFingerprints.has(fp)) {
          seenFingerprints.add(fp);
          mergedHistory.push(b);
        }
      }

      const otherTarget = fullOther.data?.data ? fullOther.data.data : fullOther.data || {};
      if (!finalAvatarBlob && fullOther.avatarBlob) {
        finalAvatarBlob = fullOther.avatarBlob;
        const fp = await getBlobFingerprint(fullOther.avatarBlob);
        if (fp) seenFingerprints.add(fp);
      } else if (fullOther.avatarBlob) {
        const fp = await getBlobFingerprint(fullOther.avatarBlob);
        if (fp && !seenFingerprints.has(fp)) {
          mergedHistory.push(fullOther.avatarBlob);
          seenFingerprints.add(fp);
        }
      }
      for (const b of fullOther.avatarHistory || []) {
        if (!b) continue;
        const fp = await getBlobFingerprint(b);
        if (fp && !seenFingerprints.has(fp)) {
          mergedHistory.push(b);
          seenFingerprints.add(fp);
        }
      }

      const otherNotes = (otherTarget.creator_notes || fullOther.data?.creator_notes || '').trim();
      if (otherNotes) {
        if (!mergedNotes) mergedNotes = otherNotes;
        else if (!mergedNotes.includes(otherNotes)) {
          mergedNotes = `${mergedNotes}\n\n[合并自对比卡片备注]:\n${otherNotes}`;
        }
      }

      const otherSummary = (
        fullOther.aiSummary ||
        otherTarget.aiSummary ||
        (fullOther.data as any)?.aiSummary ||
        ''
      ).trim();
      if (otherSummary && (!mergedSummary || otherSummary.length > mergedSummary.length)) {
        mergedSummary = otherSummary;
      }

      for (const qrSet of otherTarget.extensions?.tavern_qr_sets || []) {
        if (!mergedQRSets.some((s) => s.id === qrSet.id || s.sourceName === qrSet.sourceName)) {
          mergedQRSets.push(qrSet);
        }
      }
      for (const qr of otherTarget.extensions?.quick_replies || []) {
        if (!mergedQRs.some((q) => q.message === qr.message)) {
          mergedQRs.push(qr);
        }
      }
      if (!mergedQrFilename && otherTarget.extensions?.qr_filename) {
        mergedQrFilename = otherTarget.extensions.qr_filename;
      }
      const otherSource = otherTarget.extensions?.source || otherTarget.source;
      if (!mergedSource && otherSource) mergedSource = otherSource;
      for (const tag of otherTarget.tags || fullOther.tags || []) {
        if (!mergedTags.includes(tag)) mergedTags.push(tag);
      }

      const mergedVersionHistory = [...(fullKept.versionHistory || [])];
      const seenVersionIds = new Set(mergedVersionHistory.map((v) => v.id));
      for (const snap of fullOther.versionHistory || []) {
        if (!seenVersionIds.has(snap.id)) {
          mergedVersionHistory.push(snap);
          seenVersionIds.add(snap.id);
        }
      }

      targetData.extensions.quick_replies = mergedQRs;
      targetData.extensions.tavern_qr_sets = mergedQRSets;
      targetData.extensions.source = mergedSource;
      targetData.tags = mergedTags;
      if (mergedQrFilename) targetData.extensions.qr_filename = mergedQrFilename;
      if (mergedNotes) targetData.creator_notes = mergedNotes;
      if (mergedSummary) {
        targetData.aiSummary = mergedSummary;
        if (updatedData.data) updatedData.data.aiSummary = mergedSummary;
        updatedData.aiSummary = mergedSummary;
      }
      if (!updatedData.data) {
        updatedData.source = mergedSource;
        updatedData.tags = mergedTags;
        if (mergedNotes) updatedData.creator_notes = mergedNotes;
      }

      const finalChar: any = {
        ...fullKept,
        folderId: fullKept.folderId || fullOther.folderId,
        data: updatedData,
        avatarBlob: finalAvatarBlob,
        aiSummary: mergedSummary || fullKept.aiSummary,
        avatarHistory: mergedHistory.length > 0 ? mergedHistory : undefined,
        versionHistory: mergedVersionHistory.length > 0 ? mergedVersionHistory : undefined,
        _isExplicitAvatarUpdate: Boolean(finalAvatarBlob),
      };
      await saveCharacter(finalChar);

      const { getChatsForCharacter, saveChat, initDB } = await import('../lib/db');
      const db = await initDB();
      const chats = await getChatsForCharacter(otherCard.id);
      for (const chat of chats) {
        chat.characterId = keptCard.id;
        await saveChat(chat);
      }
      try {
        const oldMemos = await db.getAllFromIndex('memos', 'by-character', otherCard.id);
        if (oldMemos && oldMemos.length > 0) {
          const tx = db.transaction('memos', 'readwrite');
          for (const memo of oldMemos) {
            memo.characterId = keptCard.id;
            await tx.objectStore('memos').put(memo);
          }
          await tx.done;
        }
      } catch {}

      await deleteCharacter(otherCard.id);
      onMutated(otherCard.id);
      onClose();
    } catch (err: any) {
      console.error('对比合并失败:', err);
      alert('合并失败：' + (err?.message || String(err)));
    } finally {
      setWorkingAction(null);
    }
  };

  const handleDeleteOne = async (card: CharacterCard) => {
    if (!confirm(`确定将「${card.name}」移入回收站吗？`)) return;
    setWorkingAction(`delete-${card.id}`);
    try {
      await deleteCharacter(card.id);
      onMutated(card.id);
      onClose();
    } catch (err: any) {
      alert('删除失败：' + (err?.message || String(err)));
    } finally {
      setWorkingAction(null);
    }
  };

  const renderTypeBadge = (resType: string) => {
    switch (resType) {
      case 'qr':
        return { label: '快速回复', dotColor: 'bg-emerald-400' };
      case 'worldbook':
        return { label: '世界书', dotColor: 'bg-purple-400' };
      case 'preset':
        return { label: '预设', dotColor: 'bg-amber-400' };
      case 'script':
        return { label: '脚本', dotColor: 'bg-cyan-400' };
      case 'theme':
        return { label: '美化', dotColor: 'bg-pink-400' };
      default:
        return { label: '角色卡', dotColor: 'bg-blue-400' };
    }
  };

  return (
    <AnimatePresence>
      {pairIds && (
        <div
          key="card-compare-modal"
          className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-4xl max-h-[90vh] bg-[#141418] [.light-theme_&]:!bg-[#f2f2f7] border-t sm:border border-white/10 [.light-theme_&]:!border-[#e2e8f0] rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden shadow-2xl"
          >
            {/* 顶部栏 */}
            <div className="px-4 py-3.5 sm:px-6 border-b border-white/10 [.light-theme_&]:!border-[#e2e8f0] bg-white/[0.02] [.light-theme_&]:!bg-[#ffffff] flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base sm:text-lg font-bold text-white [.light-theme_&]:!text-[#0f172a] truncate">
                      卡片对比
                    </h3>
                    {compareMeta && (
                      compareMeta.isIdentical ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-300 [.light-theme_&]:!bg-emerald-50 [.light-theme_&]:!text-emerald-700">
                          <CheckCircle2 className="w-3 h-3 shrink-0" />
                          <span>内容完全相同</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/15 text-amber-300 [.light-theme_&]:!bg-amber-50 [.light-theme_&]:!text-amber-700">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          <span>存在内容差异</span>
                        </span>
                      )
                    )}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="p-2 -mr-1.5 rounded-full hover:bg-white/10 [.light-theme_&]:hover:!bg-black/5 text-white/60 hover:text-white [.light-theme_&]:!text-[#475569] [.light-theme_&]:hover:!text-[#0f172a] transition cursor-pointer shrink-0"
                title="关闭对比"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 切换维度分段 Tab */}
            {cards && compareMeta && (
              <div className="px-4 sm:px-6 py-2.5 border-b border-white/10 [.light-theme_&]:!border-[#e2e8f0] bg-white/[0.01] [.light-theme_&]:!bg-[#ffffff] flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
                {(
                  [
                    { id: 'overview', label: '参数对比' },
                    { id: 'greeting', label: '开场白' },
                    { id: 'description', label: '设定描述' },
                    { id: 'worldbook', label: '世界书' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer whitespace-nowrap shrink-0 border-0 ${
                      activeTab === tab.id
                        ? 'bg-blue-600 [.light-theme_&]:!bg-[#007aff] text-white shadow-xs'
                        : 'bg-white/5 hover:bg-white/10 text-white/65 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#475569]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            {/* 主体对比内容区 */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] custom-scrollbar">
              {loading ? (
                <div className="py-20 flex flex-col items-center justify-center gap-2 text-white/60 [.light-theme_&]:!text-[#64748b]">
                  <Loader2 className="w-7 h-7 animate-spin text-blue-500" />
                  <span className="text-xs">正在读取卡片完整数据进行对比...</span>
                </div>
              ) : !cards || !compareMeta ? (
                <div className="py-16 text-center text-sm text-white/50 [.light-theme_&]:!text-[#64748b]">
                  未能读取到选中的两张卡片数据
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {cards.map((card, idx) => {
                    const otherIdx = idx === 0 ? 1 : 0;
                    const stat = compareMeta.scores[idx];
                    const otherStat = compareMeta.scores[otherIdx];
                    const token = compareMeta.tokens[idx];
                    const otherToken = compareMeta.tokens[otherIdx];
                    const field = compareMeta.fields[idx];
                    const otherField = compareMeta.fields[otherIdx];
                    const resType = idx === 0 ? compareMeta.typeA : compareMeta.typeB;
                    const badge = renderTypeBadge(resType);
                    const isMostComplete =
                      stat.score > otherStat.score && stat.score === compareMeta.maxScore;
                    const folderPath = card.folderId
                      ? getFolderPathLabel(card.folderId) || '分类文件夹'
                      : '主页 (未分类)';
                    const modifiedTime =
                      card.fileModifiedAt ||
                      card.originalFile?.lastModified ||
                      card.updatedAt ||
                      card.createdAt;
                    const modifiedDate = new Date(modifiedTime);
                    const descLenDiff = field.description.length !== otherField.description.length;
                    const wordDiff = stat.wordCount !== otherStat.wordCount;
                    const tokenDiff = token.totalTokens !== otherToken.totalTokens;
                    const greetWbDiff =
                      stat.greetingsCount !== otherStat.greetingsCount ||
                      stat.worldbookCount !== otherStat.worldbookCount;

                    return (
                      <div
                        key={card.id}
                        className="flex flex-col p-4 rounded-2xl bg-white/[0.06] [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:shadow-xs border border-white/10 [.light-theme_&]:!border-[#e2e8f0]"
                      >
                        {/* 卡片头部：头像 + 名称 + 跳转详情 */}
                        <div className="flex items-start gap-3 mb-3">
                          <div
                            onClick={() => {
                              onClose();
                              onOpenChar(card.id);
                            }}
                            className="w-14 h-14 rounded-2xl overflow-hidden shrink-0 bg-black/25 [.light-theme_&]:!bg-[#f1f5f9] cursor-pointer"
                          >
                            <CompareAvatarImg char={card} className="w-full h-full" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/80 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#334155] font-semibold inline-flex items-center gap-1">
                                <span className={`w-1.5 h-1.5 rounded-full ${badge.dotColor}`} />
                                {badge.label}
                              </span>
                              {isMostComplete && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold inline-flex items-center gap-1 bg-blue-500/20 text-blue-300 [.light-theme_&]:!bg-[#eff6ff] [.light-theme_&]:!text-[#007aff]">
                                  <Database className="w-3 h-3" />
                                  数据最全
                                </span>
                              )}
                            </div>

                            <h4
                              onClick={() => {
                                onClose();
                                onOpenChar(card.id);
                              }}
                              className="font-bold text-base text-white [.light-theme_&]:!text-[#0f172a] truncate mt-1 cursor-pointer hover:underline"
                            >
                              {card.name || '未命名'}
                            </h4>

                            <div className="flex items-center gap-1 text-[11px] text-white/50 [.light-theme_&]:!text-[#64748b] truncate mt-0.5">
                              <Folder className="w-3 h-3 shrink-0 opacity-75" />
                              <span className="truncate">{folderPath}</span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onOpenChar(card.id);
                            }}
                            className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#475569] transition cursor-pointer shrink-0"
                            title="打开卡片详情页"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </button>
                        </div>

                        {/* 分 Tab 内容区 */}
                        {activeTab === 'overview' && (
                          <>
                            <div className="rounded-xl p-3 mb-3 space-y-2 text-xs bg-black/30 [.light-theme_&]:!bg-[#f8fafc] border border-white/5 [.light-theme_&]:!border-[#e2e8f0]">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-white/50 [.light-theme_&]:!text-[#64748b]">修改时间</span>
                                <span className="font-mono font-medium text-white/90 [.light-theme_&]:!text-[#0f172a]">
                                  {modifiedDate.toLocaleString(undefined, {
                                    year: 'numeric',
                                    month: '2-digit',
                                    day: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              </div>

                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-white/50 [.light-theme_&]:!text-[#64748b]">Token 量</span>
                                <span
                                  className={`font-mono font-semibold ${
                                    tokenDiff
                                      ? 'text-amber-300 [.light-theme_&]:!text-amber-700'
                                      : 'text-white/90 [.light-theme_&]:!text-[#0f172a]'
                                  }`}
                                >
                                  {formatTokenCount(token.totalTokens)} T (常驻 {formatTokenCount(token.permanentTokens)})
                                </span>
                              </div>

                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-white/50 [.light-theme_&]:!text-[#64748b]">设定 / 总字数</span>
                                <span
                                  className={`font-mono font-medium ${
                                    descLenDiff || wordDiff
                                      ? 'text-amber-300 [.light-theme_&]:!text-amber-700'
                                      : 'text-white/90 [.light-theme_&]:!text-[#0f172a]'
                                  }`}
                                >
                                  {field.description.length} 字 (总 {stat.wordCount} 字)
                                </span>
                              </div>

                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-white/50 [.light-theme_&]:!text-[#64748b]">开场白 / 世界书</span>
                                <span
                                  className={`font-medium ${
                                    greetWbDiff
                                      ? 'text-amber-300 [.light-theme_&]:!text-amber-700'
                                      : 'text-white/90 [.light-theme_&]:!text-[#0f172a]'
                                  }`}
                                >
                                  {stat.greetingsCount} 条 / {stat.worldbookCount} 项
                                </span>
                              </div>

                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-white/50 [.light-theme_&]:!text-[#64748b]">作者 / 版本</span>
                                <span className="text-white/85 [.light-theme_&]:!text-[#334155] truncate max-w-[180px]">
                                  {field.data.creator || '未知'} · v{field.data.character_version || '1.0'}
                                </span>
                              </div>
                            </div>

                            {/* 标签 & 附件角标 */}
                            <div className="flex flex-wrap items-center gap-1.5 mb-3 text-[11px]">
                              {field.hasQR && (
                                <span className="px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-white/10 text-white/80 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#334155]">
                                  <MessageSquarePlus className="w-3 h-3 text-blue-400 [.light-theme_&]:!text-[#007aff]" />
                                  QR
                                </span>
                              )}
                              {field.hasSource && (
                                <span className="px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-white/10 text-white/80 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#334155]">
                                  <LinkIcon className="w-3 h-3 text-blue-400 [.light-theme_&]:!text-[#007aff]" />
                                  来源
                                </span>
                              )}
                              {field.hasNotes && (
                                <span className="px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-white/10 text-white/80 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#334155]">
                                  <FileText className="w-3 h-3 text-white/60 [.light-theme_&]:!text-[#475569]" />
                                  备注
                                </span>
                              )}
                              {field.tags.slice(0, 5).map((tag: string) => (
                                <span
                                  key={tag}
                                  className="px-2 py-0.5 rounded-full bg-white/5 text-white/65 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#475569]"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </>
                        )}

                        {activeTab === 'greeting' && (
                          <div className="rounded-xl p-3 mb-3 bg-black/30 [.light-theme_&]:!bg-[#f8fafc] border border-white/5 [.light-theme_&]:!border-[#e2e8f0] max-h-64 overflow-y-auto custom-scrollbar space-y-2.5 text-xs leading-relaxed text-white/85 [.light-theme_&]:!text-[#1e293b]">
                            <div>
                              <div className="text-[11px] font-semibold text-blue-400 [.light-theme_&]:!text-[#007aff] mb-1">
                                主开场白 ({field.firstMes.length} 字)
                              </div>
                              <p className="whitespace-pre-wrap break-words">
                                {field.firstMes || '（空）'}
                              </p>
                            </div>
                            {field.altGreetings.length > 0 && (
                              <div className="pt-2 border-t border-white/10 [.light-theme_&]:!border-[#e2e8f0] space-y-2">
                                <div className="text-[11px] font-semibold text-white/60 [.light-theme_&]:!text-[#475569]">
                                  备用开场白 ({field.altGreetings.length} 条)
                                </div>
                                {field.altGreetings.map((g, gi) => (
                                  <div
                                    key={gi}
                                    className="p-2 rounded-lg bg-white/5 [.light-theme_&]:!bg-[#ffffff] border border-white/5 [.light-theme_&]:!border-[#e2e8f0]"
                                  >
                                    <div className="text-[10px] text-white/40 [.light-theme_&]:!text-[#64748b] mb-0.5">
                                      #{gi + 1} · {g.length} 字
                                    </div>
                                    <p className="whitespace-pre-wrap break-words line-clamp-6">
                                      {g}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {activeTab === 'description' && (
                          <div className="rounded-xl p-3 mb-3 bg-black/30 [.light-theme_&]:!bg-[#f8fafc] border border-white/5 [.light-theme_&]:!border-[#e2e8f0] max-h-64 overflow-y-auto custom-scrollbar space-y-2.5 text-xs leading-relaxed text-white/85 [.light-theme_&]:!text-[#1e293b]">
                            <div>
                              <div className="text-[11px] font-semibold text-blue-400 [.light-theme_&]:!text-[#007aff] mb-1">
                                角色设定描述 ({field.description.length} 字)
                              </div>
                              <p className="whitespace-pre-wrap break-words">
                                {field.description || '（无描述）'}
                              </p>
                            </div>
                            {field.creatorNotes && (
                              <div className="pt-2 border-t border-white/10 [.light-theme_&]:!border-[#e2e8f0]">
                                <div className="text-[11px] font-semibold text-white/60 [.light-theme_&]:!text-[#475569] mb-1">
                                  作者备注
                                </div>
                                <p className="whitespace-pre-wrap break-words text-white/75 [.light-theme_&]:!text-[#334155]">
                                  {field.creatorNotes}
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        {activeTab === 'worldbook' && (
                          <div className="rounded-xl p-3 mb-3 bg-black/30 [.light-theme_&]:!bg-[#f8fafc] border border-white/5 [.light-theme_&]:!border-[#e2e8f0] max-h-64 overflow-y-auto custom-scrollbar space-y-2 text-xs text-white/85 [.light-theme_&]:!text-[#1e293b]">
                            {field.entriesList.length === 0 ? (
                              <div className="py-8 text-center text-white/45 [.light-theme_&]:!text-[#64748b]">
                                无内嵌世界书词条
                              </div>
                            ) : (
                              field.entriesList.map((entry: any, ei: number) => {
                                const keys = Array.isArray(entry.keys)
                                  ? entry.keys.join(', ')
                                  : entry.keys || entry.key || `词条 #${ei + 1}`;
                                const content = String(entry.content || entry.text || '').trim();
                                return (
                                  <div
                                    key={ei}
                                    className="p-2 rounded-lg bg-white/5 [.light-theme_&]:!bg-[#ffffff] border border-white/5 [.light-theme_&]:!border-[#e2e8f0]"
                                  >
                                    <div className="text-[11px] font-semibold text-purple-300 [.light-theme_&]:!text-purple-700 truncate">
                                      {entry.comment || keys || `词条 ${ei + 1}`}
                                    </div>
                                    {content && (
                                      <p className="text-[11px] text-white/70 [.light-theme_&]:!text-[#475569] mt-1 whitespace-pre-wrap break-words line-clamp-4">
                                        {content}
                                      </p>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}

                        {/* 底部快捷处置按钮 */}
                        <div className="mt-auto grid grid-cols-2 gap-2 pt-1">
                          <button
                            type="button"
                            disabled={!compareMeta.sameType || workingAction !== null}
                            onClick={() => handleMergeKeep(idx as 0 | 1)}
                            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer border-0 ${
                              !compareMeta.sameType
                                ? 'bg-white/5 text-white/30 cursor-not-allowed [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#94a3b8]'
                                : 'bg-white/10 hover:bg-white/15 text-white [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#0f172a]'
                            }`}
                          >
                            {workingAction === `merge-${card.id}` ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                            ) : (
                              <Merge className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span>合并并保留</span>
                          </button>

                          <button
                            type="button"
                            disabled={workingAction !== null}
                            onClick={() => handleDeleteOne(card)}
                            className="px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer border-0 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 [.light-theme_&]:!bg-rose-50 [.light-theme_&]:hover:!bg-rose-100 [.light-theme_&]:!text-rose-600"
                          >
                            {workingAction === `delete-${card.id}` ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span>删除此卡</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
