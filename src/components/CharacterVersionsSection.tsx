import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { 
  History, GitBranch, GitCompare, Plus, Link as LinkIcon, Upload, RotateCcw, 
  Trash2, Download, Eye, ChevronDown, ChevronUp, Check, 
  X, Search, Sparkles, Book, MessageSquare, AlertCircle,
  Clock, ArrowRight, FileText, CheckCircle2, User, Layers,
  Calendar, ShieldCheck, Compass, Edit3, Pencil
} from 'lucide-react';
import { 
  CharacterCard, CardVersionSnapshot, saveCharacter, 
  getCharacters, deleteCharacter, getCharacter, getCharacterBlob,
  getCharacterThumb, getCharacterCategoryPrefix
} from '../lib/db';
import { getCardTypeBadgeInfo } from '../lib/cardType';
import { injectTavernData, extractTavernData } from '../lib/png';
import { downloadOrShareFile } from '../lib/appBridge';
import { getFallbackAvatar, resolveAvatarUrl } from '../lib/avatar';

interface Props {
  character: CharacterCard;
  onUpdateCharacter: (updated: CharacterCard) => void;
  onRefreshDetail?: () => void;
  avatarUrl?: string;
  isLightMode?: boolean;
}

// Helper to strictly filter out tools, worldbooks, presets, scripts, etc. and keep only actual character cards
function isCharacterCardOnly(c: CharacterCard): boolean {
  if (c.deletedAt) return false;
  if (c.isTool || c.isQR) return false;
  if (getCardTypeBadgeInfo(c) !== null) return false;
  const cat = c.category || getCharacterCategoryPrefix(c);
  if (cat && ["世界书", "预设", "工具区", "美化", "快速回复", "脚本", "聊天记录"].includes(cat)) {
    return false;
  }
  const raw = c.data?.data || c.data || {};
  if (Array.isArray(c.data) || Array.isArray(raw)) return false;
  if (raw.quick_replies || raw.qrList) return false;
  return true;
}

// Standalone lazy-loaded avatar component for candidate cards with viewport-driven loading
const CandidateAvatar = React.memo(function CandidateAvatar({ char }: { char: CharacterCard }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const defaultFallback = useMemo(() => getFallbackAvatar(char.name || char.id), [char.name, char.id]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) {
      setIsInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isInView) return;
    let isMounted = true;
    let objectUrl: string | null = null;

    if (char.localFilePath) {
      import('../lib/appBridge').then(({ getLocalImageUrl }) => {
        if (isMounted) setImgSrc(getLocalImageUrl(char.localFilePath!, char.updatedAt || char.createdAt));
      });
    } else if (char.avatarBlob) {
      objectUrl = URL.createObjectURL(char.avatarBlob);
      if (isMounted) setImgSrc(objectUrl);
    } else if (char.hasBlobsSeparated) {
      getCharacterThumb(char.id).then((thumb) => {
        if (!isMounted) return;
        if (thumb) {
          objectUrl = URL.createObjectURL(thumb);
          setImgSrc(objectUrl);
        } else {
          getCharacterBlob(char.id).then((blobs) => {
            if (blobs?.avatarBlob && isMounted) {
              objectUrl = URL.createObjectURL(blobs.avatarBlob);
              setImgSrc(objectUrl);
            }
          });
        }
      }).catch(() => {
        if (isMounted) setImgSrc(defaultFallback);
      });
    } else {
      setImgSrc(char.avatarUrlFallback || resolveAvatarUrl(undefined, char.name));
    }

    return () => {
      isMounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isInView, char, defaultFallback]);

  return (
    <div
      ref={containerRef}
      className="w-10 h-10 rounded-2xl overflow-hidden shrink-0 soft-pill-inset relative flex items-center justify-center"
    >
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={char.name}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
          onError={(e) => {
            if (e.currentTarget.src !== defaultFallback) {
              e.currentTarget.src = defaultFallback;
            }
          }}
        />
      ) : (
        <User className="w-4 h-4 text-slate-400 opacity-60" />
      )}
    </div>
  );
});

// Standalone component to securely render active character avatar with memory management
function ActiveAvatar({ character, avatarUrl }: { character: CharacterCard; avatarUrl?: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (avatarUrl) {
      setBlobUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    let isCancelled = false;

    if (character.avatarBlob) {
      objectUrl = URL.createObjectURL(character.avatarBlob);
      setBlobUrl(objectUrl);
    } else if (character.hasBlobsSeparated) {
      getCharacterBlob(character.id).then((b) => {
        if (!isCancelled && b?.avatarBlob) {
          objectUrl = URL.createObjectURL(b.avatarBlob);
          setBlobUrl(objectUrl);
        }
      });
    } else {
      setBlobUrl(null);
    }

    return () => {
      isCancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [character.id, character.avatarBlob, character.hasBlobsSeparated, avatarUrl]);

  const finalSrc = avatarUrl || blobUrl || character.avatarUrlFallback || resolveAvatarUrl(undefined, character.name);

  return (
    <img
      src={finalSrc}
      alt={character.name}
      className="w-full h-full object-cover"
      onError={(e) => {
        e.currentTarget.src = getFallbackAvatar(character.name);
      }}
    />
  );
}

// Standalone component to securely render snapshot avatar with memory management
function SnapshotAvatar({ snapshot, fallbackName }: { snapshot: CardVersionSnapshot; fallbackName: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    if (snapshot.avatarBlob) {
      objectUrl = URL.createObjectURL(snapshot.avatarBlob);
      setUrl(objectUrl);
    } else if (snapshot.completeCardPngBlob) {
      objectUrl = URL.createObjectURL(snapshot.completeCardPngBlob);
      setUrl(objectUrl);
    } else if (snapshot.avatarUrlFallback) {
      setUrl(snapshot.avatarUrlFallback);
    } else {
      setUrl(null);
    }

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [snapshot.avatarBlob, snapshot.completeCardPngBlob, snapshot.avatarUrlFallback]);

  if (!url) {
    return (
      <div className="w-full h-full flex items-center justify-center text-xs font-semibold opacity-70">
        {snapshot.versionName?.slice(0, 2) || '旧版'}
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={snapshot.versionName || fallbackName}
      className="w-full h-full object-cover"
      onError={(e) => {
        e.currentTarget.src = getFallbackAvatar(fallbackName);
      }}
    />
  );
}

// Helper to physically resolve all binary assets so the snapshot is 100% self-contained
async function resolveFullCardBinaryAssets(char: CharacterCard): Promise<{
  avatarBlob?: Blob;
  completeCardPngBlob?: Blob;
  avatarHistory?: Blob[];
}> {
  let avatarBlob = char.avatarBlob;

  // 1. If avatarBlob is empty, attempt to read local physical file (Android SAF or filesystem)
  if (!avatarBlob && char.localFilePath) {
    try {
      const { readLocalFileBuffer } = await import('../lib/appBridge');
      const buf = await readLocalFileBuffer(char.localFilePath);
      if (buf && buf.byteLength > 0) {
        avatarBlob = new Blob([buf], { type: 'image/png' });
      }
    } catch (e) {
      console.warn('readLocalFileBuffer failed for character', e);
    }
  }

  // 2. If originalFile is available
  if (!avatarBlob && char.originalFile) {
    avatarBlob = char.originalFile;
  }

  // 3. If fallback URL is present and remote
  if (!avatarBlob && char.avatarUrlFallback && (char.avatarUrlFallback.startsWith('http') || char.avatarUrlFallback.startsWith('blob:'))) {
    try {
      const res = await fetch(char.avatarUrlFallback);
      if (res.ok) {
        avatarBlob = await res.blob();
      }
    } catch (e) {}
  }

  // 4. Generate a 100% self-contained complete PNG card blob with embedded Tavern spec
  let completeCardPngBlob: Blob | undefined = undefined;
  if (avatarBlob) {
    try {
      const arrayBuf = await avatarBlob.arrayBuffer();
      const injected = injectTavernData(arrayBuf, char.data);
      completeCardPngBlob = new Blob([injected], { type: 'image/png' });
    } catch (e) {
      console.warn('injectTavernData failed for completeCardPngBlob', e);
    }
  }

  // 5. Alternate expressions (avatar history)
  let avatarHistory: Blob[] | undefined = undefined;
  if (char.avatarHistory && char.avatarHistory.length > 0) {
    avatarHistory = [...char.avatarHistory];
  }

  return { avatarBlob, completeCardPngBlob, avatarHistory };
}

export function CharacterVersionsSection({ 
  character, 
  onUpdateCharacter, 
  onRefreshDetail, 
  avatarUrl,
  isLightMode = false 
}: Props) {
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);
  const [snapshotName, setSnapshotName] = useState('');
  const [snapshotNote, setSnapshotNote] = useState('');

  // Link existing card modal
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [candidateCards, setCandidateCards] = useState<CharacterCard[]>([]);
  const [linkSearchQuery, setLinkSearchQuery] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<CharacterCard | null>(null);
  const [deleteCandidateAfterLink, setDeleteCandidateAfterLink] = useState(() => {
    const saved = localStorage.getItem('tavern_version_delete_candidate');
    return saved !== null ? saved === 'true' : true;
  });

  // Diff preview expansion
  const [expandedDiffId, setExpandedDiffId] = useState<string | null>(null);

  // Selected active version ID with direct reactive state for instant toggle
  const [activeVersionId, setActiveVersionId] = useState<string>(() => {
    return character.activeVersionId || (character.versionHistory && character.versionHistory.length > 0 ? character.versionHistory[0].id : 'current-live');
  });

  useEffect(() => {
    if (character.activeVersionId) {
      setActiveVersionId(character.activeVersionId);
    } else if (character.versionHistory && character.versionHistory.length > 0) {
      setActiveVersionId(character.versionHistory[0].id);
    } else {
      setActiveVersionId('current-live');
    }
  }, [character.activeVersionId, character.versionHistory]);

  // Rollback feedback message state
  const [rollbackFeedback, setRollbackFeedback] = useState<string | null>(null);

  // Note editing state for snapshots
  const [editingSnapshotId, setEditingSnapshotId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState('');
  const [editingVersionName, setEditingVersionName] = useState('');

  // File input ref for importing file directly as historical version
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper to format word count cleanly (e.g. 31056 -> 3.1万字)
  const formatWordCount = (count: number) => {
    if (count >= 10000) {
      const w = count / 10000;
      return `${count % 10000 >= 1000 ? w.toFixed(1) : w.toFixed(0)}万字`;
    }
    return `${count} 字`;
  };

  // Automated smart difference analyzer (Duplicate card detector style: 开场白+1, 世界书+1, 设定较长)
  const computeVersionDiff = (
    snapData: any,
    currData: any,
    snapAvatarsCount: number,
    currAvatarsCount: number
  ) => {
    const sDesc = (snapData.description || '').trim();
    const cDesc = (currData.description || '').trim();
    const sFirst = (snapData.first_mes || '').trim();
    const cFirst = (currData.first_mes || '').trim();
    const sEntries = snapData.character_book?.entries || [];
    const cEntries = currData.character_book?.entries || [];
    const sBook = sEntries.length;
    const cBook = cEntries.length;
    const sAlt = snapData.alternate_greetings?.length || 0;
    const cAlt = currData.alternate_greetings?.length || 0;
    const sMesEx = (snapData.mes_example || '').trim();
    const cMesEx = (currData.mes_example || '').trim();

    // Total greetings: first_mes (if exists) + alternate greetings
    const sTotalGreetings = (sFirst ? 1 : 0) + sAlt;
    const cTotalGreetings = (cFirst ? 1 : 0) + cAlt;

    const tags: Array<{ text: string; type: 'increase' | 'decrease' | 'change' | 'same' }> = [];
    const bullets: string[] = [];

    if (
      sDesc === cDesc &&
      sFirst === cFirst &&
      sBook === cBook &&
      sAlt === cAlt &&
      sMesEx === cMesEx &&
      snapAvatarsCount === currAvatarsCount
    ) {
      tags.push({ text: '内容完全一致', type: 'same' });
      bullets.push('设定、开场白、世界书与当前完全相同');
    } else {
      // 1. 开场白对比 (Greetings) - user said: "开场白+1"
      if (sTotalGreetings > cTotalGreetings) {
        tags.push({ text: `开场白+${sTotalGreetings - cTotalGreetings}`, type: 'increase' });
        bullets.push(`开场白多出 ${sTotalGreetings - cTotalGreetings} 篇`);
      } else if (sTotalGreetings < cTotalGreetings) {
        tags.push({ text: `开场白-${cTotalGreetings - sTotalGreetings}`, type: 'decrease' });
        bullets.push(`开场白少于当前 ${cTotalGreetings - sTotalGreetings} 篇`);
      }

      if (sFirst !== cFirst) {
        if (sFirst.length > cFirst.length + 30) {
          tags.push({ text: '开场白长', type: 'increase' });
          bullets.push(`主开场白文字较长 (+${sFirst.length - cFirst.length}字)`);
        } else if (sFirst.length < cFirst.length - 30) {
          tags.push({ text: '开场白短', type: 'decrease' });
          bullets.push(`主开场白文字较短 (-${cFirst.length - sFirst.length}字)`);
        } else {
          tags.push({ text: '改开场白', type: 'change' });
          bullets.push('主开场白文本内容有改动');
        }
      }

      // 2. 世界书对比 (World Book) - user said: "世界书+1"
      if (sBook > cBook) {
        tags.push({ text: `世界书+${sBook - cBook}`, type: 'increase' });
        const newItems = sEntries.filter((se: any) => !cEntries.some((ce: any) => (ce.keys?.[0] || ce.comment) === (se.keys?.[0] || se.comment)));
        const names = newItems.slice(0, 2).map((e: any) => `「${e.comment || e.keys?.[0] || '条目'}」`).join('、');
        bullets.push(`世界书新增 ${sBook - cBook} 项${names ? ` (${names})` : ''}`);
      } else if (sBook < cBook) {
        tags.push({ text: `世界书-${cBook - sBook}`, type: 'decrease' });
        bullets.push(`世界书比当前少 ${cBook - sBook} 项条目`);
      } else if (sBook > 0 && JSON.stringify(sEntries) !== JSON.stringify(cEntries)) {
        tags.push({ text: '改世界书', type: 'change' });
        bullets.push('世界书条目数相同，但词条内容有更新');
      }

      // 3. 设定描述对比 (Description) - user said: "或者是设定较长这种"
      if (sDesc !== cDesc) {
        if (sDesc.length > cDesc.length + 50) {
          tags.push({ text: '设定较长', type: 'increase' });
          bullets.push(`人设描述更丰富 (+${sDesc.length - cDesc.length}字)`);
        } else if (sDesc.length < cDesc.length - 50) {
          tags.push({ text: '设定较短', type: 'decrease' });
          bullets.push(`人设描述更精简 (-${cDesc.length - sDesc.length}字)`);
        } else {
          tags.push({ text: '改设定', type: 'change' });
          bullets.push('人设描述字数相当，但细节有修改');
        }
      }

      // 4. 对话示例 (Examples)
      if (sMesEx !== cMesEx) {
        if (sMesEx.length > cMesEx.length + 50) {
          tags.push({ text: '示例较长', type: 'increase' });
        } else if (sMesEx.length < cMesEx.length - 50) {
          tags.push({ text: '示例较短', type: 'decrease' });
        } else {
          tags.push({ text: '改示例对话', type: 'change' });
        }
      }

      // 5. 差分头像 (Avatars)
      if (snapAvatarsCount > currAvatarsCount) {
        tags.push({ text: `差分头像+${snapAvatarsCount - currAvatarsCount}`, type: 'increase' });
        bullets.push(`差分表情头像多出 ${snapAvatarsCount - currAvatarsCount} 张`);
      } else if (snapAvatarsCount < currAvatarsCount) {
        tags.push({ text: `差分头像-${currAvatarsCount - snapAvatarsCount}`, type: 'decrease' });
      }

      if (tags.length === 0) {
        tags.push({ text: '微调细节', type: 'change' });
        bullets.push('卡片基础字段有微调');
      }
    }

    return {
      tags,
      bullets,
      sTotalGreetings,
      cTotalGreetings,
      sBook,
      cBook,
      sDescLen: sDesc.length,
      cDescLen: cDesc.length,
    };
  };

  // Start editing a snapshot's note and name
  const handleStartEditNote = (snapshot: CardVersionSnapshot) => {
    setEditingSnapshotId(snapshot.id);
    setEditingVersionName(snapshot.versionName || '');
    setEditingNote(snapshot.note || '');
  };

  // Save edited note and version name
  const handleSaveSnapshotNote = async (snapshotId: string) => {
    const updatedHistory = (character.versionHistory || []).map(s => {
      if (s.id === snapshotId) {
        return {
          ...s,
          versionName: editingVersionName.trim() || s.versionName || '未命名快照',
          note: editingNote.trim(),
        };
      }
      return s;
    });

    const updatedChar: CharacterCard = {
      ...character,
      versionHistory: updatedHistory,
      updatedAt: Date.now(),
    };

    await saveCharacter(updatedChar);
    onUpdateCharacter(updatedChar);
    setEditingSnapshotId(null);
  };

  // Current card data shortcuts
  const currentData = character.data?.data || character.data || {};
  const currentVersionStr = currentData.character_version || character.data?.character_version || '1.0';
  const currentDescription = currentData.description || '';
  const currentGreetingsCount = 1 + (currentData.alternate_greetings?.length || 0);
  const currentWeatherBookCount = currentData.character_book?.entries?.length || 0;

  // Load candidate cards when Link Modal opens
  useEffect(() => {
    if (!isLinkModalOpen) return;
    let isMounted = true;
    getCharacters(1, 10000, undefined, "", [], "newest_import", false, true).then(res => {
      if (!isMounted) return;
      const available = res.characters.filter(c => c.id !== character.id && isCharacterCardOnly(c));
      setCandidateCards(available);
    });
    return () => { isMounted = false; };
  }, [isLinkModalOpen, character.id]);

  // Progressive rendering for candidate cards to prevent modal opening lag
  const [displayLimit, setDisplayLimit] = useState(40);

  useEffect(() => {
    setDisplayLimit(40);
  }, [linkSearchQuery, isLinkModalOpen]);

  // Sort candidate cards
  const filteredCandidates = useMemo(() => {
    const q = linkSearchQuery.trim().toLowerCase();
    const currName = (character.name || '').trim().toLowerCase();

    let list = candidateCards;
    if (q) {
      list = list.filter(c => 
        (c.name || '').toLowerCase().includes(q) ||
        (c.data?.creator || '').toLowerCase().includes(q) ||
        (c.data?.data?.creator || '').toLowerCase().includes(q)
      );
    }

    return [...list].sort((a, b) => {
      const aName = (a.name || '').trim().toLowerCase();
      const bName = (b.name || '').trim().toLowerCase();
      const aIsExact = aName === currName;
      const bIsExact = bName === currName;
      if (aIsExact && !bIsExact) return -1;
      if (!aIsExact && bIsExact) return 1;

      const aIsSub = aName.includes(currName) || currName.includes(aName);
      const bIsSub = bName.includes(currName) || currName.includes(bName);
      if (aIsSub && !bIsSub) return -1;
      if (!aIsSub && bIsSub) return 1;

      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }, [candidateCards, linkSearchQuery, character.name]);

  const visibleCandidates = useMemo(() => {
    return filteredCandidates.slice(0, displayLimit);
  }, [filteredCandidates, displayLimit]);

  const handleCandidateScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollTop + clientHeight >= scrollHeight - 80) {
      if (displayLimit < filteredCandidates.length) {
        setDisplayLimit(prev => Math.min(prev + 40, filteredCandidates.length));
      }
    }
  };

  // Create snapshot of current version
  const handleCreateSnapshot = async () => {
    const vName = snapshotName.trim() || `v${currentVersionStr}`;
    const { avatarBlob, completeCardPngBlob, avatarHistory } = await resolveFullCardBinaryAssets(character);

    const newSnapshot: CardVersionSnapshot = {
      id: crypto.randomUUID(),
      versionName: vName,
      note: snapshotNote.trim() || '手动保存的版本快照',
      createdAt: Date.now(),
      fileModifiedAt: character.fileModifiedAt || character.updatedAt || character.createdAt,
      data: JSON.parse(JSON.stringify(character.data || {})),
      avatarBlob,
      completeCardPngBlob,
      avatarHistory,
      avatarUrlFallback: character.avatarUrlFallback,
      cardName: character.name,
      tags: character.tags ? [...character.tags] : undefined,
    };

    const updatedHistory = [newSnapshot, ...(character.versionHistory || [])];
    const updatedChar: CharacterCard = {
      ...character,
      versionHistory: updatedHistory,
      activeVersionId: newSnapshot.id,
      updatedAt: Date.now(),
    };

    await saveCharacter(updatedChar);
    onUpdateCharacter(updatedChar);
    setIsCreatingSnapshot(false);
    setSnapshotName('');
    setSnapshotNote('');
  };

  // Link selected candidate card as historical version
  const handleConfirmLink = async () => {
    if (!selectedCandidate) return;

    try {
      const fullOldChar = await getCharacter(selectedCandidate.id);
      if (!fullOldChar) {
        alert('读取旧版卡片数据失败');
        return;
      }

      const oldData = fullOldChar.data?.data || fullOldChar.data || {};
      const oldVer = oldData.character_version || fullOldChar.data?.character_version || '1.0';

      const { avatarBlob, completeCardPngBlob, avatarHistory } = await resolveFullCardBinaryAssets(fullOldChar);
      const clonedData = JSON.parse(JSON.stringify(fullOldChar.data || {}));

      const newSnapshot: CardVersionSnapshot = {
        id: crypto.randomUUID(),
        versionName: `v${oldVer} (${fullOldChar.name})`,
        note: `关联绑定自卡库卡片「${fullOldChar.name}」`,
        createdAt: fullOldChar.createdAt || Date.now(),
        fileModifiedAt: fullOldChar.fileModifiedAt || fullOldChar.updatedAt || fullOldChar.createdAt,
        data: clonedData,
        avatarBlob,
        completeCardPngBlob,
        avatarHistory,
        avatarUrlFallback: fullOldChar.avatarUrlFallback,
        cardName: fullOldChar.name,
        sourceCharId: fullOldChar.id,
        tags: fullOldChar.tags ? [...fullOldChar.tags] : undefined,
      };

      // Ensure current card is saved as a version if history was empty, so both cards are visible in list
      let baseHistory = character.versionHistory ? [...character.versionHistory] : [];
      let activeId = character.activeVersionId;
      if (baseHistory.length === 0) {
        const { avatarBlob: currBlob, completeCardPngBlob: currPng, avatarHistory: currHist } = await resolveFullCardBinaryAssets(character);
        const currSnap: CardVersionSnapshot = {
          id: crypto.randomUUID(),
          versionName: `v${currentVersionStr} (当前版本)`,
          note: '原始初始版本',
          createdAt: character.createdAt || Date.now(),
          fileModifiedAt: character.fileModifiedAt || character.updatedAt || character.createdAt,
          data: JSON.parse(JSON.stringify(character.data || {})),
          avatarBlob: currBlob,
          completeCardPngBlob: currPng,
          avatarHistory: currHist,
          avatarUrlFallback: character.avatarUrlFallback,
          cardName: character.name,
          tags: character.tags ? [...character.tags] : undefined,
        };
        baseHistory = [currSnap];
        activeId = currSnap.id;
        setActiveVersionId(currSnap.id);
      }

      const oldHistory = fullOldChar.versionHistory || [];
      const updatedHistory = [...baseHistory, newSnapshot, ...oldHistory];

      const updatedChar: CharacterCard = {
        ...character,
        versionHistory: updatedHistory,
        activeVersionId: activeId,
        updatedAt: Date.now(),
      };

      await saveCharacter(updatedChar);

      if (deleteCandidateAfterLink) {
        try {
          const { initDB } = await import('../lib/db');
          const db = await initDB();

          const oldChats = await db.getAllFromIndex('chats', 'by-character', fullOldChar.id);
          if (oldChats && oldChats.length > 0) {
            const tx = db.transaction('chats', 'readwrite');
            for (const chat of oldChats) {
              chat.characterId = character.id;
              if (!chat.name.startsWith(`[v${oldVer}]`) && !chat.name.includes(fullOldChar.name)) {
                chat.name = `[v${oldVer}] ${chat.name}`;
              }
              await tx.objectStore('chats').put(chat);
            }
            await tx.done;
          }

          const oldMemos = await db.getAllFromIndex('memos', 'by-character', fullOldChar.id);
          if (oldMemos && oldMemos.length > 0) {
            const tx = db.transaction('memos', 'readwrite');
            for (const memo of oldMemos) {
              memo.characterId = character.id;
              await tx.objectStore('memos').put(memo);
            }
            await tx.done;
          }
        } catch (e) {
          console.warn('Failed to migrate chat logs/memos', e);
        }

        await deleteCharacter(fullOldChar.id);
      }

      onUpdateCharacter(updatedChar);
      setIsLinkModalOpen(false);
      setSelectedCandidate(null);
      alert(`已成功将「${fullOldChar.name}」绑定为历史版本！\n\n已归档至版本列表，点击卡片即可在各版本间即时滑动切换！${deleteCandidateAfterLink ? '\n（原卡已移至回收站以防冗余）' : ''}`);
    } catch (e: any) {
      alert('绑定失败: ' + e.message);
    }
  };

  // Import local file as historical version
  const handleImportFileAsVersion = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      let parsedData: any = null;
      let avatarBlob: Blob | undefined = undefined;

      if (file.name.toLowerCase().endsWith('.png')) {
        const buf = await file.arrayBuffer();
        parsedData = await extractTavernData(buf);
        if (!parsedData) {
          throw new Error('未在 PNG 中解析到有效的酒馆角色卡元数据');
        }
        avatarBlob = file;
      } else if (file.name.toLowerCase().endsWith('.json')) {
        const text = await file.text();
        parsedData = JSON.parse(text);
      } else {
        throw new Error('仅支持导入 .png 或 .json 角色卡文件');
      }

      const innerData = parsedData.data || parsedData;
      const verStr = innerData.character_version || parsedData.character_version || '1.0';
      const parsedName = innerData.name || parsedData.name || file.name.replace(/\.[^/.]+$/, '');

      const { resolveCharacterModifiedTime } = await import('../lib/fileDate');
      let imgBuf: ArrayBuffer | null = null;
      try { imgBuf = await file.arrayBuffer(); } catch(err) {}
      const resolvedTime = resolveCharacterModifiedTime({ data: parsedData, originalFile: file }, imgBuf);

      let completeCardPngBlob: Blob | undefined = undefined;
      if (avatarBlob) {
        completeCardPngBlob = avatarBlob;
      }

      const newSnapshot: CardVersionSnapshot = {
        id: crypto.randomUUID(),
        versionName: `v${verStr} (文件导入)`,
        note: `从本地文件「${file.name}」导入`,
        createdAt: file.lastModified || Date.now(),
        fileModifiedAt: resolvedTime || file.lastModified,
        data: parsedData,
        avatarBlob,
        completeCardPngBlob,
        cardName: parsedName,
      };

      let baseHistory = character.versionHistory ? [...character.versionHistory] : [];
      let activeId = character.activeVersionId;
      if (baseHistory.length === 0) {
        const { avatarBlob: currBlob, completeCardPngBlob: currPng, avatarHistory: currHist } = await resolveFullCardBinaryAssets(character);
        const currSnap: CardVersionSnapshot = {
          id: crypto.randomUUID(),
          versionName: `v${currentVersionStr} (当前版本)`,
          note: '原始初始版本',
          createdAt: character.createdAt || Date.now(),
          fileModifiedAt: character.fileModifiedAt || character.updatedAt || character.createdAt,
          data: JSON.parse(JSON.stringify(character.data || {})),
          avatarBlob: currBlob,
          completeCardPngBlob: currPng,
          avatarHistory: currHist,
          avatarUrlFallback: character.avatarUrlFallback,
          cardName: character.name,
          tags: character.tags ? [...character.tags] : undefined,
        };
        baseHistory = [currSnap];
        activeId = currSnap.id;
        setActiveVersionId(currSnap.id);
      }

      const updatedHistory = [...baseHistory, newSnapshot];
      const updatedChar: CharacterCard = {
        ...character,
        versionHistory: updatedHistory,
        activeVersionId: activeId,
        updatedAt: Date.now(),
      };

      await saveCharacter(updatedChar);
      onUpdateCharacter(updatedChar);
      alert(`已成功将文件「${file.name}」解析并录入为历史版本！`);
    } catch (err: any) {
      alert('导入失败: ' + err.message);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Switch to selected snapshot directly with smooth sliding indicator
  const handleSwitchVersion = async (snapshot: CardVersionSnapshot) => {
    if (snapshot.id === activeVersionId) return;

    // Instantly update active version indicator in local state so sliding indicator moves immediately
    setActiveVersionId(snapshot.id);
    setExpandedDiffId(null);

    // Save previous version's live changes into versionHistory so no work is lost
    let updatedHistory = character.versionHistory ? [...character.versionHistory] : [];
    if (activeVersionId === 'current-live' || !updatedHistory.some(s => s.id === activeVersionId)) {
      const { avatarBlob, completeCardPngBlob, avatarHistory } = await resolveFullCardBinaryAssets(character);
      const prevLiveSnapshot: CardVersionSnapshot = {
        id: crypto.randomUUID(),
        versionName: `v${currentVersionStr} (原版本备份)`,
        note: '切换前自动留存的原始版本',
        createdAt: character.updatedAt || character.createdAt || Date.now(),
        fileModifiedAt: character.fileModifiedAt || character.updatedAt || character.createdAt,
        data: JSON.parse(JSON.stringify(character.data || {})),
        avatarBlob,
        completeCardPngBlob,
        avatarHistory,
        avatarUrlFallback: character.avatarUrlFallback,
        cardName: character.name,
        tags: character.tags ? [...character.tags] : undefined,
      };
      updatedHistory = [prevLiveSnapshot, ...updatedHistory];
    } else {
      updatedHistory = updatedHistory.map(s => {
        if (s.id === activeVersionId) {
          return {
            ...s,
            data: JSON.parse(JSON.stringify(character.data || {})),
            cardName: character.name,
            tags: character.tags ? [...character.tags] : s.tags,
          };
        }
        return s;
      });
    }

    const updatedChar: CharacterCard = {
      ...character,
      data: JSON.parse(JSON.stringify(snapshot.data || {})),
      name: snapshot.cardName || character.name,
      avatarBlob: snapshot.avatarBlob || snapshot.completeCardPngBlob || character.avatarBlob,
      avatarHistory: snapshot.avatarHistory || character.avatarHistory,
      avatarUrlFallback: snapshot.avatarUrlFallback || character.avatarUrlFallback,
      tags: snapshot.tags || character.tags,
      activeVersionId: snapshot.id,
      versionHistory: updatedHistory,
      updatedAt: Date.now(),
    };

    await saveCharacter(updatedChar);
    onUpdateCharacter(updatedChar);

    setRollbackFeedback(`已切换至版本「${snapshot.versionName || snapshot.cardName}」，角色设定已即时生效！`);
    setTimeout(() => {
      setRollbackFeedback(null);
    }, 3500);
  };

  // Export historical version as standalone PNG
  const handleExportSnapshot = async (snapshot: CardVersionSnapshot) => {
    try {
      if (snapshot.completeCardPngBlob) {
        const safeName = (snapshot.cardName || character.name || 'Character').replace(/[\\/:*?"<>|]/g, '_');
        const filename = `${safeName}_${snapshot.versionName || 'snapshot'}.png`;
        await downloadOrShareFile(filename, await snapshot.completeCardPngBlob.arrayBuffer(), 'image/png', false);
        return;
      }

      let baseBlob = snapshot.avatarBlob || character.avatarBlob;
      if (!baseBlob) {
        alert('该快照缺少头像底图，无法导出为 PNG 角色卡');
        return;
      }

      const buffer = await baseBlob.arrayBuffer();
      const injected = injectTavernData(buffer, snapshot.data);
      const safeName = (snapshot.cardName || character.name || 'Character').replace(/[\\/:*?"<>|]/g, '_');
      const filename = `${safeName}_${snapshot.versionName || 'snapshot'}.png`;

      await downloadOrShareFile(filename, injected, 'image/png', false);
    } catch (e: any) {
      alert('导出失败: ' + e.message);
    }
  };

  // Delete a snapshot
  const handleDeleteSnapshot = async (snapshotId: string, versionName?: string) => {
    if (!window.confirm(`确定要删除历史版本「${versionName || '快照'}」吗？`)) return;

    const updatedHistory = (character.versionHistory || []).filter(s => s.id !== snapshotId);
    let nextActiveId = activeVersionId;
    if (activeVersionId === snapshotId) {
      nextActiveId = updatedHistory.length > 0 ? updatedHistory[0].id : 'current-live';
    }

    const updatedChar: CharacterCard = {
      ...character,
      versionHistory: updatedHistory,
      activeVersionId: nextActiveId,
      updatedAt: Date.now(),
    };

    await saveCharacter(updatedChar);
    onUpdateCharacter(updatedChar);
    setActiveVersionId(nextActiveId);
  };

  // Unified display list of version cards (Sorted chronologically: newest at top -> oldest at bottom)
  const displayList: CardVersionSnapshot[] = useMemo(() => {
    const history = character.versionHistory || [];
    if (history.length === 0) return [];

    let list: CardVersionSnapshot[] = [];
    const hasActiveInHistory = history.some(s => s.id === activeVersionId);
    if (hasActiveInHistory) {
      list = [...history];
    } else {
      // If activeVersionId is not in history (e.g. live card), prepend current live card as active version
      const liveSnapshot: CardVersionSnapshot = {
        id: 'current-live',
        versionName: `v${currentVersionStr} (当前版本)`,
        note: '当前正在编辑的角色卡',
        createdAt: character.updatedAt || character.createdAt || Date.now(),
        fileModifiedAt: character.fileModifiedAt || character.updatedAt || character.createdAt,
        data: character.data,
        avatarBlob: character.avatarBlob,
        completeCardPngBlob: character.originalFile,
        avatarHistory: character.avatarHistory,
        avatarUrlFallback: character.avatarUrlFallback,
        cardName: character.name,
        tags: character.tags,
      };
      list = [liveSnapshot, ...history];
    }

    // Strictly sort by timestamp descending: Newest (top) -> Older -> Oldest (bottom)
    return list.sort((a, b) => {
      const timeA = a.createdAt || a.fileModifiedAt || 0;
      const timeB = b.createdAt || b.fileModifiedAt || 0;
      return timeB - timeA;
    });
  }, [character, currentVersionStr, activeVersionId]);

  const currentDateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

  // Format date cleanly as YYYY/M/D HH:mm
  const formatDateTime = (ts?: number) => {
    const validTs = ts || character.updatedAt || character.createdAt || Date.now();
    const d = new Date(validTs);
    if (isNaN(d.getTime())) return '未知时间';
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  };

  return (
    <div className="space-y-6 pb-12">
      {/* 
        ========================================================================
        Top Header Section
        Features clean editorial date, bold title, and clean monochrome rounded controls
        ======================================================================== 
      */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-1 pt-1">
        <div>
          <span className="text-xs font-semibold text-slate-400 tracking-wider">
            {currentDateStr}
          </span>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-100 mt-0.5">
            {character.name || '角色版本'}
          </h2>
        </div>

        {/* Clean Monochrome Header Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          <button
            onClick={() => setIsCreatingSnapshot(prev => !prev)}
            className={`px-3 sm:px-3.5 py-1.5 rounded-full text-xs font-medium flex items-center gap-1 sm:gap-1.5 transition active:scale-95 cursor-pointer shadow-xs focus:outline-none focus:ring-0 ${
              isCreatingSnapshot 
                ? 'bg-blue-600 text-white border border-blue-500 shadow-sm [.light-theme_&]:!border-blue-600' 
                : 'soft-pill'
            }`}
            title="创建当前版本快照"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">创建快照</span>
            <span className="sm:hidden">快照</span>
          </button>

          <button
            onClick={() => setIsLinkModalOpen(true)}
            className="soft-pill px-3 sm:px-3.5 py-1.5 rounded-full text-xs font-medium flex items-center gap-1 sm:gap-1.5 transition active:scale-95 cursor-pointer shadow-xs"
            title="关联卡库已有卡片为历史版本"
          >
            <LinkIcon className="w-3.5 h-3.5 opacity-70" />
            <span className="hidden sm:inline">绑定卡库旧版</span>
            <span className="sm:hidden">绑定旧版</span>
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="soft-pill px-3 sm:px-3.5 py-1.5 rounded-full text-xs font-medium flex items-center gap-1 sm:gap-1.5 transition active:scale-95 cursor-pointer shadow-xs"
            title="导入 PNG 或 JSON 为历史版本"
          >
            <Upload className="w-3.5 h-3.5 opacity-70" />
            <span className="hidden sm:inline">导入文件版本</span>
            <span className="sm:hidden">导入</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.json"
            onChange={handleImportFileAsVersion}
            className="hidden"
          />
        </div>
      </div>

      {/* 
        ========================================================================
        Expandable Snapshot Creation Box
        ======================================================================== 
      */}
      <AnimatePresence>
        {isCreatingSnapshot && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="version-modal-box rounded-2xl p-5 sm:p-6 shadow-xl relative overflow-hidden space-y-4 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-slate-200"
          >
            <div className="flex items-center justify-between relative z-10">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                <h4 className="text-sm font-bold text-slate-100 [.light-theme_&]:!text-slate-900">
                  保存当前卡片为历史版本快照
                </h4>
              </div>
              <button 
                onClick={() => setIsCreatingSnapshot(false)}
                className="w-7 h-7 rounded-full bg-slate-700/60 hover:bg-slate-700 text-slate-200 flex items-center justify-center cursor-pointer transition [.light-theme_&]:!bg-white [.light-theme_&]:!border [.light-theme_&]:!border-slate-200 [.light-theme_&]:!text-slate-600 [.light-theme_&]:hover:!bg-slate-100 [.light-theme_&]:hover:!text-slate-900 [.light-theme_&]:shadow-xs"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 relative z-10">
              <div>
                <label className="block text-[11px] font-semibold text-slate-200 [.light-theme_&]:!text-slate-700 mb-1.5">
                  版本标识 / 版本号
                </label>
                <input
                  type="text"
                  value={snapshotName}
                  onChange={e => setSnapshotName(e.target.value)}
                  placeholder={`例如 v${currentVersionStr} 或 设定初版备份`}
                  className="version-input w-full rounded-xl px-4 py-2.5 text-xs outline-none focus:border-blue-500 transition [.light-theme_&]:!bg-white [.light-theme_&]:!border-slate-300 [.light-theme_&]:!text-slate-900 [.light-theme_&]:placeholder-slate-400"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-200 [.light-theme_&]:!text-slate-700 mb-1.5">
                  修改说明 / 迭代备注
                </label>
                <input
                  type="text"
                  value={snapshotNote}
                  onChange={e => setSnapshotNote(e.target.value)}
                  placeholder="例如：优化人设提示词与第2段开场白"
                  className="version-input w-full rounded-xl px-4 py-2.5 text-xs outline-none focus:border-blue-500 transition [.light-theme_&]:!bg-white [.light-theme_&]:!border-slate-300 [.light-theme_&]:!text-slate-900 [.light-theme_&]:placeholder-slate-400"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-1 relative z-10">
              <button
                onClick={() => setIsCreatingSnapshot(false)}
                className="soft-pill px-4 py-2 rounded-full text-xs font-medium cursor-pointer transition active:scale-95"
              >
                取消
              </button>
              <button
                onClick={handleCreateSnapshot}
                className="px-5 py-2 rounded-full text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 shadow-sm cursor-pointer transition active:scale-95"
              >
                保存快照
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 
        ========================================================================
        Main Soft Tray (Inspired by "Upcoming 12 Cards" in p2)
        Low-contrast soft grey recessed container housing the white floating cards
        ======================================================================== 
      */}
      <div className="soft-tray rounded-[32px] p-4 sm:p-6 space-y-4">
        {/* Tray Subheader */}
        <div className="flex items-center justify-between px-1 pb-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-100">
              版本列表
            </span>
            <span className="text-xs text-slate-400 font-medium">
              共 {displayList.length > 0 ? displayList.length : 1} 个版本
            </span>
          </div>

          <AnimatePresence>
            {rollbackFeedback && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 [.light-theme_&]:!bg-emerald-50 [.light-theme_&]:!text-emerald-800 [.light-theme_&]:!border-emerald-300 text-xs flex items-center gap-1.5 font-medium"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 [.light-theme_&]:!bg-emerald-600 shrink-0" />
                <span>{rollbackFeedback}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 
          ======================================================================
          Unified Chronological Timeline: In-place Cards + Time Dividers
          ====================================================================== 
        */}
        {displayList.length === 0 ? (
          <div className="space-y-3">
            {/* Timeline Divider with Capsule Time Pill (Image 1 style) */}
            <div className="flex items-center gap-2 sm:gap-3 my-2 px-1">
              <div className="timeline-divider-pill flex items-center gap-1.5 px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full text-[11px] sm:text-xs font-mono font-medium shadow-xs shrink-0">
                <Clock className="w-3 sm:w-3.5 h-3 sm:h-3.5 opacity-80 shrink-0" />
                <span>{formatDateTime(character.updatedAt || character.createdAt)}</span>
              </div>
              <div className="timeline-divider-line flex-1 h-[1.5px] rounded-full" />
            </div>

            {/* Single Current Active Card */}
            <div className="relative">
              <div className="soft-card rounded-2xl py-2.5 px-3.5 sm:py-3 sm:px-4 pl-4.5 sm:pl-5 relative overflow-hidden space-y-1.5 sm:space-y-2 border border-white/10">
                <div className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-gradient-to-b from-emerald-400 to-teal-400 opacity-85 [.light-theme_&]:!bg-emerald-600 [.light-theme_&]:opacity-100 shadow-sm" />

                <div className="flex items-center justify-between gap-2 relative z-10">
                  <h4 className="version-card-title text-xs sm:text-sm font-bold tracking-tight flex items-center gap-1.5 min-w-0 truncate">
                    <span className="truncate">{character.name}</span>
                  </h4>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 [.light-theme_&]:!bg-emerald-50 [.light-theme_&]:!text-emerald-800 [.light-theme_&]:!border-emerald-300 px-2 sm:px-2.5 py-0.5 rounded-full text-[10px] sm:text-[11px] font-semibold flex items-center gap-1 shadow-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 [.light-theme_&]:!bg-emerald-600 animate-pulse shrink-0 shadow-xs shadow-emerald-400/50" />
                      <span className="hidden sm:inline">当前生效版本</span>
                      <span className="sm:hidden">当前生效</span>
                    </span>
                  </div>
                </div>

                <div className="relative z-10 space-y-1.5">
                  <p className="version-card-note text-[11px] sm:text-xs leading-snug font-normal line-clamp-1 sm:line-clamp-2">
                    {currentDescription || "当前卡片设定完整生效中，开场白与世界书随时可供溯源。"}
                  </p>

                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    <span className="soft-pill px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-medium tracking-tight whitespace-nowrap">
                      {formatWordCount(currentDescription.length)}
                    </span>
                    <span className="soft-pill px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-medium tracking-tight whitespace-nowrap">
                      <span className="sm:hidden">{currentGreetingsCount} 篇开场</span>
                      <span className="hidden sm:inline">{currentGreetingsCount} 篇开场白</span>
                    </span>
                    {currentWeatherBookCount > 0 && (
                      <span className="soft-pill px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-medium tracking-tight whitespace-nowrap">
                        <span className="sm:hidden">{currentWeatherBookCount} 条世界书</span>
                        <span className="hidden sm:inline">{currentWeatherBookCount} 条世界书</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1.5 sm:pt-2 border-t version-card-divider relative z-10">
                  <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-medium version-card-sub">
                    <Clock className="w-3 h-3 opacity-70 shrink-0" />
                    <span>修改时间: {formatDateTime(character.fileModifiedAt || character.updatedAt || character.createdAt)}</span>
                  </div>

                  <div className="w-6 h-6 sm:w-6.5 sm:h-6.5 rounded-full overflow-hidden shrink-0 soft-pill p-0.5 shadow-xs">
                    <div className="w-full h-full rounded-full overflow-hidden">
                      <ActiveAvatar character={character} avatarUrl={avatarUrl} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="version-empty-card mt-4 p-5 sm:p-6 rounded-2xl text-center space-y-1.5 shadow-xs">
                <GitBranch className="w-6 h-6 mx-auto text-slate-400 [.light-theme_&]:!text-slate-500 opacity-60" />
                <p className="font-semibold text-xs version-card-title">暂无其它历史快照</p>
                <p className="text-[11px] version-card-note max-w-sm mx-auto leading-relaxed">
                  点击顶部的「+ 创建快照」按钮或「绑定卡库旧版」即可归档历史版本，点击卡片即可在各版本间即时滑动切换！
                </p>
              </div>
            </div>
          </div>
        ) : (
          <LayoutGroup id="version-timeline-group">
            <div className="space-y-4">
              {displayList.map((snapshot) => {
                const snapData = snapshot.data?.data || snapshot.data || {};
                const snapDesc = snapData.description || '';
                const snapGreetingsCount = 1 + (snapData.alternate_greetings?.length || 0);
                const snapWbCount = snapData.character_book?.entries?.length || 0;
                const isExpanded = expandedDiffId === snapshot.id;
                const isActive = (snapshot.id === activeVersionId);

                // Automated difference calculation against current active card
                const diffResult = computeVersionDiff(
                  snapData,
                  currentData,
                  snapshot.avatarHistory?.length || 0,
                  character.avatarHistory?.length || 0
                );

                return (
                  <div key={snapshot.id} className="space-y-3">
                    {/* Timeline Divider Line with Capsule Time Pill */}
                    <div className="flex items-center gap-2 sm:gap-3 my-2 px-1">
                      <div className="timeline-divider-pill flex items-center gap-1.5 px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full text-[11px] sm:text-xs font-mono font-medium shadow-xs shrink-0">
                        <Clock className="w-3 sm:w-3.5 h-3 sm:h-3.5 opacity-80 shrink-0" />
                        <span>{formatDateTime(snapshot.createdAt || snapshot.fileModifiedAt)}</span>
                      </div>
                      <div className="timeline-divider-line flex-1 h-[1.5px] rounded-full" />
                    </div>

                    {/* Floating Soft White Card: Clicking switches active version */}
                    <div
                      onClick={() => {
                        if (!isActive) handleSwitchVersion(snapshot);
                      }}
                      className={`soft-card rounded-2xl py-2.5 px-3.5 sm:py-3 sm:px-4 pl-4.5 sm:pl-5 relative overflow-hidden transition-all duration-300 space-y-1.5 sm:space-y-2 cursor-pointer ${
                        isActive 
                          ? 'border border-white/20 shadow-md ring-1 ring-emerald-500/20' 
                          : 'active:scale-[0.99]'
                      }`}
                    >
                      {/* Sliding Left Vertical Accent Bar (Smoothly glides between cards when selected) */}
                      {isActive && (
                        <motion.div 
                          layoutId="version-active-slider-bar"
                          className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-gradient-to-b from-emerald-400 to-teal-400 opacity-85 [.light-theme_&]:!bg-emerald-600 [.light-theme_&]:opacity-100 shadow-sm z-20" 
                          transition={{ type: "spring", stiffness: 350, damping: 28 }}
                        />
                      )}

                      {/* Top Row: Snapshot Title + Status or Actions */}
                      <div className="flex items-center justify-between gap-2 relative z-10 flex-wrap sm:flex-nowrap">
                        <h4 className="version-card-title text-xs sm:text-sm font-bold tracking-tight flex items-center gap-1.5 min-w-0 truncate">
                          <span className="truncate">{snapshot.cardName || character.name || '未命名角色'}</span>
                          {!isActive && (
                            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-normal text-slate-400 bg-white/5 border border-white/10 [.light-theme_&]:bg-slate-100 [.light-theme_&]:text-slate-600 [.light-theme_&]:border-slate-200 shrink-0">
                              旧卡
                            </span>
                          )}
                        </h4>

                        {/* Action buttons */}
                        <div className="flex items-center gap-1 shrink-0">
                          {isActive ? (
                            <span className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 [.light-theme_&]:!bg-emerald-50 [.light-theme_&]:!text-emerald-800 [.light-theme_&]:!border-emerald-300 px-2 sm:px-2.5 py-0.5 rounded-full text-[10px] sm:text-[11px] font-semibold flex items-center gap-1 shadow-xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 [.light-theme_&]:!bg-emerald-600 animate-pulse shrink-0 shadow-xs shadow-emerald-400/50" />
                              <span className="hidden sm:inline">当前生效版本</span>
                              <span className="sm:hidden">当前生效</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSwitchVersion(snapshot);
                              }}
                              className="px-2 sm:px-2.5 py-0.5 rounded-full text-[10px] sm:text-[11px] font-semibold text-slate-300 bg-white/10 hover:bg-white/20 hover:text-white border border-white/15 transition active:scale-95 cursor-pointer shadow-xs flex items-center gap-1 [.light-theme_&]:!bg-slate-100 [.light-theme_&]:!text-slate-700 [.light-theme_&]:!border-slate-200 [.light-theme_&]:hover:!bg-slate-200"
                            >
                              <Check className="w-3 h-3" />
                              <span>切换至此版本</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedDiffId(isExpanded ? null : snapshot.id);
                            }}
                            className={`px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-medium transition flex items-center gap-1 active:scale-95 cursor-pointer ${
                              isExpanded 
                                ? 'bg-blue-500/25 text-blue-200 border border-blue-400/40 [.light-theme_&]:!bg-blue-600 [.light-theme_&]:!text-white shadow-xs' 
                                : 'soft-pill'
                            }`}
                            title="查看与当前生效版本的智能差异对比"
                          >
                            <Eye className="w-3 h-3 opacity-70" />
                            <span className="hidden sm:inline">对比</span>
                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleExportSnapshot(snapshot);
                            }}
                            className="soft-pill w-6 h-6 rounded-full flex items-center justify-center transition active:scale-95 cursor-pointer"
                            title="导出为此历史版本的 PNG 角色卡"
                          >
                            <Download className="w-3 h-3 opacity-70" />
                          </button>

                          {snapshot.id !== 'current-live' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteSnapshot(snapshot.id, snapshot.versionName);
                              }}
                              className="soft-pill w-6 h-6 rounded-full flex items-center justify-center transition active:scale-95 cursor-pointer text-slate-400 hover:text-rose-500 hover:border-rose-300"
                              title="删除该版本快照"
                            >
                              <Trash2 className="w-3 h-3 opacity-70" />
                            </button>
                          )}
                        </div>
                      </div>

                  {/* Middle: Note / Description (Editable inline) & Metrics */}
                  <div className="relative z-10 space-y-1.5">
                    {editingSnapshotId === snapshot.id ? (
                      <div className="version-edit-box space-y-1.5 p-2 rounded-xl" onClick={e => e.stopPropagation()}>
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                          <input
                            type="text"
                            value={editingVersionName}
                            onChange={e => setEditingVersionName(e.target.value)}
                            placeholder="版本标识名称"
                            className="version-input sm:w-1/3 px-2 py-1 text-[11px] rounded-lg outline-none focus:border-blue-500"
                          />
                          <input
                            type="text"
                            value={editingNote}
                            onChange={e => setEditingNote(e.target.value)}
                            placeholder="输入版本备注 / 迭代说明..."
                            className="version-input flex-1 px-2 py-1 text-[11px] rounded-lg outline-none focus:border-blue-500"
                            autoFocus
                          />
                        </div>
                        <div className="flex items-center justify-end gap-2 pt-0.5">
                          <button
                            type="button"
                            onClick={() => setEditingSnapshotId(null)}
                            className="px-2.5 py-0.5 rounded-full text-[11px] text-slate-300 hover:text-slate-100 cursor-pointer"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveSnapshotNote(snapshot.id)}
                            className="px-3 py-0.5 rounded-full text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-500 cursor-pointer shadow-xs"
                          >
                            保存备注
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="group/note flex items-center justify-between gap-2" onClick={e => { e.stopPropagation(); handleStartEditNote(snapshot); }}>
                        <p 
                          className="version-card-note text-[11px] sm:text-xs leading-snug font-normal line-clamp-1 sm:line-clamp-2 cursor-pointer transition hover:opacity-80"
                          title="点击修改版本名称与备注"
                        >
                          {snapshot.note || snapDesc || '（暂无备注，点击修改...）'}
                        </p>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleStartEditNote(snapshot); }}
                          className="p-1 rounded-md text-slate-300 hover:text-white transition shrink-0 cursor-pointer opacity-75 hover:opacity-100 hover:bg-white/10 [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:text-slate-900 [.light-theme_&]:hover:bg-slate-100"
                          title="修改版本名称与备注"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {/* Basic Metric Pills */}
                    <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                      <span className="soft-pill px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-medium tracking-tight whitespace-nowrap">
                        描: {formatWordCount(snapDesc.length)}
                      </span>
                      <span className="soft-pill px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-medium tracking-tight whitespace-nowrap">
                        开场白: {snapGreetingsCount} 篇
                      </span>
                      <span className="soft-pill px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-medium tracking-tight whitespace-nowrap">
                        世界书: {snapWbCount} 项
                      </span>
                    </div>
                  </div>

                  {/* Bottom Row: Modified Time + Avatar */}
                  <div className="flex items-center justify-between gap-2 pt-1.5 sm:pt-2 border-t version-card-divider relative z-10">
                    <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-medium version-card-sub">
                      <Clock className="w-3 h-3 opacity-70 shrink-0" />
                      <span>修改时间: {formatDateTime(snapshot.fileModifiedAt || snapshot.createdAt)}</span>
                    </div>

                    <div className="w-6 h-6 sm:w-6.5 sm:h-6.5 rounded-full overflow-hidden shrink-0 soft-pill p-0.5 shadow-xs">
                      <div className="w-full h-full rounded-full overflow-hidden">
                        <SnapshotAvatar snapshot={snapshot} fallbackName={snapshot.cardName || character.name} />
                      </div>
                    </div>
                  </div>

                  {/* Automated Intelligent Diff Breakdown (Only keep high-contrast clear bullets) */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                        onClick={e => e.stopPropagation()}
                      >
                        <div className="mt-3 pt-3 border-t version-card-divider">
                          <div className="p-3.5 sm:p-4 rounded-2xl version-diff-bullet-box space-y-2.5">
                            <div className="flex items-center justify-between gap-2 pb-2 border-b version-card-divider">
                              <span className="font-bold version-diff-bullet-title flex items-center gap-1.5 text-xs sm:text-sm">
                                <GitCompare className="w-4 h-4 text-blue-500 shrink-0" />
                                变动要点速查：
                              </span>
                              {isActive && (
                                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                                  ● 当前活跃生效基准
                                </span>
                              )}
                            </div>

                            <div className="space-y-2 pt-0.5">
                              {isActive ? (
                                <div className="flex items-center gap-2.5 version-diff-bullet-text text-xs sm:text-[13px] leading-relaxed">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                  <span>当前活跃生效版本，其他所有快照均以此版本为对比基准</span>
                                </div>
                              ) : diffResult.bullets.length > 0 ? (
                                diffResult.bullets.map((point, bIdx) => (
                                  <div key={bIdx} className="flex items-center gap-2.5 version-diff-bullet-text text-xs sm:text-[13px] leading-relaxed">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                                    <span>{point}</span>
                                  </div>
                                ))
                              ) : (
                                <div className="flex items-center gap-2.5 version-diff-bullet-text text-xs sm:text-[13px] leading-relaxed">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                  <span>设定、开场白、世界书与当前完全相同</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            );
          })}
            </div>
          </LayoutGroup>
        )}
      </div>

      {/* 
        ========================================================================
        Link Existing Card Modal (Clean Monochrome & Light Theme Style)
        ======================================================================== 
      */}
      {createPortal(
        <AnimatePresence>
          {isLinkModalOpen && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                className="version-modal-box rounded-2xl sm:rounded-3xl p-4 sm:p-5 w-full max-w-md shadow-2xl flex flex-col max-h-[82vh] relative overflow-hidden"
              >
                <div className="flex items-center justify-between pb-3 border-b version-modal-border relative z-10 shrink-0">
                  <div className="min-w-0 pr-2">
                    <h3 className="text-sm sm:text-base font-bold version-modal-title flex items-center gap-1.5 truncate">
                      <LinkIcon className="w-4 h-4 shrink-0" />
                      关联已有卡片为历史版本
                    </h3>
                    <p className="text-[11px] sm:text-xs version-modal-desc mt-0.5 line-clamp-1 sm:line-clamp-none">
                      将卡库中的旧版本完整归档为当前角色的迭代分支，便于对比和随心回滚
                    </p>
                  </div>
                  <button
                    onClick={() => { setIsLinkModalOpen(false); setSelectedCandidate(null); }}
                    className="w-7 h-7 sm:w-8 sm:h-8 rounded-full version-modal-close-btn flex items-center justify-center cursor-pointer transition shadow-xs shrink-0"
                  >
                    <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </button>
                </div>

                {/* Search input */}
                <div className="pt-2.5 pb-1.5 relative z-10 shrink-0">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 version-modal-search-icon" />
                    <input
                      type="text"
                      placeholder="搜索卡库角色..."
                      value={linkSearchQuery}
                      onChange={e => setLinkSearchQuery(e.target.value)}
                      className="version-input w-full rounded-xl sm:rounded-2xl pl-9 pr-3 py-2 text-xs outline-none focus:border-blue-500 transition"
                    />
                  </div>
                </div>

                {/* Candidate list */}
                <div 
                  onScroll={handleCandidateScroll}
                  className="flex-1 overflow-y-auto space-y-1.5 sm:space-y-2 pr-1 my-1.5 max-h-[38vh] custom-scrollbar relative z-10"
                >
                  {filteredCandidates.length === 0 ? (
                    <div className="py-8 text-center text-xs version-modal-desc">
                      没有找到符合条件的角色卡片
                    </div>
                  ) : (
                    visibleCandidates.map(c => {
                      const isSelected = selectedCandidate?.id === c.id;
                      const cData = c.data?.data || c.data || {};
                      const ver = cData.character_version || c.data?.character_version || '1.0';

                      return (
                        <div
                          key={c.id}
                          onClick={() => setSelectedCandidate(isSelected ? null : c)}
                          className={`p-2.5 sm:p-3 rounded-xl sm:rounded-2xl transition cursor-pointer flex items-center justify-between gap-2.5 border version-candidate-card ${
                            isSelected ? 'is-selected' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <CandidateAvatar char={c} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <h4 className="font-semibold text-xs truncate version-candidate-name">
                                  {c.name}
                                </h4>
                                <span className="text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded-full font-mono version-candidate-badge shrink-0">
                                  v{ver}
                                </span>
                              </div>
                              <p className="text-[10px] truncate mt-0.5 font-normal version-candidate-sub">
                                修改: {new Date(c.fileModifiedAt || c.updatedAt || c.createdAt).toLocaleDateString()} · 描述: {(cData.description || '').length}字
                              </p>
                            </div>
                          </div>

                          <div className={`w-5 h-5 rounded-full flex items-center justify-center transition shrink-0 version-candidate-radio ${
                            isSelected ? 'is-selected' : ''
                          }`}>
                            {isSelected && <Check className="w-3 h-3 stroke-[2.5]" />}
                          </div>
                        </div>
                      );
                    })
                  )}

                  {visibleCandidates.length < filteredCandidates.length && (
                    <div className="py-2 text-center text-[10px] version-modal-desc">
                      下滑查看更多角色卡 ({visibleCandidates.length} / {filteredCandidates.length})...
                    </div>
                  )}
                </div>

                {/* Delete candidate checkbox */}
                <div 
                  onClick={() => {
                    const next = !deleteCandidateAfterLink;
                    setDeleteCandidateAfterLink(next);
                    localStorage.setItem('tavern_version_delete_candidate', String(next));
                  }}
                  className="flex items-start gap-2 p-2 sm:p-2.5 rounded-xl sm:rounded-2xl version-candidate-card select-none my-1.5 cursor-pointer relative z-10 transition shrink-0"
                >
                  <div
                    className={`w-4 h-4 rounded-md flex items-center justify-center transition shrink-0 mt-0.5 version-checkbox-icon ${
                      deleteCandidateAfterLink ? 'is-checked' : ''
                    }`}
                  >
                    {deleteCandidateAfterLink && <Check className="w-2.5 h-2.5 stroke-[2.5]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] sm:text-xs font-semibold version-candidate-name block">
                      绑定后将原独立卡片移至回收站
                    </span>
                    <span className="text-[9px] sm:text-[10px] version-candidate-sub block mt-0.5 leading-tight">
                      推荐勾选，避免在列表中留有重复同名卡片，旧卡所有数据均完整封存在版本历史中
                    </span>
                  </div>
                </div>

                {/* Modal footer */}
                <div className="flex gap-2 pt-2 border-t version-modal-border relative z-10 shrink-0">
                  <button
                    type="button"
                    onClick={() => { setIsLinkModalOpen(false); setSelectedCandidate(null); }}
                    className="soft-pill flex-1 py-2 sm:py-2.5 px-3 rounded-full font-medium text-xs cursor-pointer transition active:scale-95 text-center"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={!selectedCandidate}
                    onClick={handleConfirmLink}
                    className="flex-1 py-2 sm:py-2.5 px-3 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-md shadow-blue-500/20 disabled:opacity-40 flex items-center justify-center gap-1 transition active:scale-95 cursor-pointer whitespace-nowrap"
                  >
                    <LinkIcon className="w-3.5 h-3.5 shrink-0" />
                    关联
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
