import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  History, GitBranch, Plus, Link, Upload, RotateCcw, 
  Trash2, Download, Eye, ChevronDown, ChevronUp, Check, 
  X, Search, Sparkles, Book, MessageSquare, AlertCircle,
  Clock, ArrowRight, FileText, CheckCircle2, User
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
      className="w-10 h-10 rounded-xl overflow-hidden shrink-0 bg-black/40 border border-white/10 relative flex items-center justify-center [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10"
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
        <User className="w-4 h-4 text-white/30 [.light-theme_&]:text-black/30" />
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
      <div className="w-full h-full flex items-center justify-center bg-white/10 text-white/80 font-bold text-xs">
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

export function CharacterVersionsSection({ character, onUpdateCharacter, onRefreshDetail, avatarUrl }: Props) {
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

  // File input ref for importing file directly as historical version
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      // Filter out self and non-character cards (tools, worldbooks, presets, scripts, themes, etc.)
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

  // Sort candidate cards: put same-name or similar-name cards first
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
      // Fetch full card with blobs from IndexedDB
      const fullOldChar = await getCharacter(selectedCandidate.id);
      if (!fullOldChar) {
        alert('读取旧版卡片数据失败');
        return;
      }

      const oldData = fullOldChar.data?.data || fullOldChar.data || {};
      const oldVer = oldData.character_version || fullOldChar.data?.character_version || '1.0';

      // 1. Physically resolve all binary assets so the snapshot is 100% self-contained
      const { avatarBlob, completeCardPngBlob, avatarHistory } = await resolveFullCardBinaryAssets(fullOldChar);

      // 2. Deep-clone the complete Tavern metadata tree (character_book, alternate_greetings, extensions, etc.)
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

      // Also merge any existing version history from the old card if it had any
      const oldHistory = fullOldChar.versionHistory || [];
      const updatedHistory = [newSnapshot, ...oldHistory, ...(character.versionHistory || [])];

      const updatedChar: CharacterCard = {
        ...character,
        versionHistory: updatedHistory,
        updatedAt: Date.now(),
      };

      await saveCharacter(updatedChar);

      // 3. If user opted to move old card to trash, also safely migrate its chats and memos to the new character!
      if (deleteCandidateAfterLink) {
        try {
          const { initDB } = await import('../lib/db');
          const db = await initDB();

          // Migrate chat histories so they are safely preserved under the new card
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

          // Migrate memos
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
      alert(`已成功将「${fullOldChar.name}」绑定为历史版本！\n\n数据保障：旧版的全部设定、世界书、差分头像、二进制 PNG 角色卡已完整独立封存，且聊天记录已自动合并继承。${deleteCandidateAfterLink ? '\n（原卡已移至回收站以防冗余）' : ''}`);
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

      const updatedHistory = [newSnapshot, ...(character.versionHistory || [])];
      const updatedChar: CharacterCard = {
        ...character,
        versionHistory: updatedHistory,
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

  // Rollback to a historical snapshot
  const handleRollback = async (snapshot: CardVersionSnapshot) => {
    const confirm = window.confirm(
      `确定要将当前卡片回滚恢复到历史版本「${snapshot.versionName || '未命名版本'}」吗？\n\n注意：当前正在使用的卡片状态将自动保存为一个新的快照，确保数据万无一失。`
    );
    if (!confirm) return;

    // 1. Take snapshot of current state before rollback
    const { avatarBlob, completeCardPngBlob, avatarHistory } = await resolveFullCardBinaryAssets(character);
    const autoBackup: CardVersionSnapshot = {
      id: crypto.randomUUID(),
      versionName: `v${currentVersionStr} (回滚前自动备份)`,
      note: `于 ${new Date().toLocaleString()} 回滚到 ${snapshot.versionName} 前自动备份`,
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

    // 2. Set snapshot's data as active
    const nextHistory = [autoBackup, ...(character.versionHistory || []).filter(s => s.id !== snapshot.id)];

    const updatedChar: CharacterCard = {
      ...character,
      data: JSON.parse(JSON.stringify(snapshot.data || {})),
      name: snapshot.cardName || character.name,
      avatarBlob: snapshot.avatarBlob || snapshot.completeCardPngBlob || character.avatarBlob,
      avatarHistory: snapshot.avatarHistory || character.avatarHistory,
      avatarUrlFallback: snapshot.avatarUrlFallback || character.avatarUrlFallback,
      versionHistory: nextHistory,
      tags: snapshot.tags || character.tags,
      updatedAt: Date.now(),
    };

    await saveCharacter(updatedChar);
    onUpdateCharacter(updatedChar);
    onRefreshDetail?.();
    alert(`已成功回滚到历史版本「${snapshot.versionName}」！\n当前状态已安全备份至版本历史中。`);
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
    const updatedChar: CharacterCard = {
      ...character,
      versionHistory: updatedHistory,
      updatedAt: Date.now(),
    };

    await saveCharacter(updatedChar);
    onUpdateCharacter(updatedChar);
  };

  const historyList = character.versionHistory || [];

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Top Banner & Action Header */}
      <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 sm:gap-4 p-4 sm:p-5 rounded-3xl bg-white/[0.06] backdrop-blur-2xl border border-white/20 shadow-xl overflow-hidden [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:backdrop-blur-none [.light-theme_&]:!border-black/10 [.light-theme_&]:!shadow-sm">
        <div className="relative z-10">
          <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
            <h3 className="text-base sm:text-lg font-bold text-white tracking-tight [.light-theme_&]:!text-[#1c1c1e]">
              <span>版本迭代</span><span className="hidden sm:inline">与溯源</span>
            </h3>
            <span className="text-xs px-3 py-1 rounded-full bg-white/10 text-white/90 font-medium border border-white/20 backdrop-blur-md whitespace-nowrap shadow-xs [.light-theme_&]:!bg-black/[0.04] [.light-theme_&]:!border-black/10 [.light-theme_&]:!text-[#1c1c1e]">
              {historyList.length > 0 ? (
                <>共 {historyList.length + 1} 个版本</>
              ) : (
                <>当前为单版本</>
              )}
            </span>
          </div>
          <p className="text-xs text-white/60 mt-1 line-clamp-2 sm:line-clamp-none [.light-theme_&]:!text-[#1c1c1e]/60">
            记录新旧版本的演变轨迹，支持历史快照对比、一键回滚以及关联绑定卡库中的旧版本。
          </p>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 relative z-10 w-full sm:w-auto">
          <button
            onClick={() => setIsCreatingSnapshot(true)}
            className="flex-1 sm:flex-none justify-center items-center gap-1 sm:gap-1.5 px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-full bg-white/10 hover:bg-white/15 text-white/90 border border-white/20 text-[11px] sm:text-xs font-medium backdrop-blur-md transition active:scale-95 shadow-sm cursor-pointer flex whitespace-nowrap [.light-theme_&]:!bg-black/[0.04] [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:!border-black/10 [.light-theme_&]:hover:!bg-black/[0.08]"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span className="sm:hidden">快照</span>
            <span className="hidden sm:inline">创建当前快照</span>
          </button>

          <button
            onClick={() => setIsLinkModalOpen(true)}
            className="flex-1 sm:flex-none justify-center items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-full bg-white/10 hover:bg-white/15 text-white/90 border border-white/20 text-[11px] sm:text-xs font-medium backdrop-blur-md transition active:scale-95 shadow-sm cursor-pointer flex whitespace-nowrap [.light-theme_&]:!bg-black/[0.04] [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:!border-black/10 [.light-theme_&]:hover:!bg-black/[0.08]"
          >
            <Link className="w-3.5 h-3.5 shrink-0" />
            <span className="sm:hidden">绑定</span>
            <span className="hidden sm:inline">绑定卡库旧版本</span>
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 sm:flex-none justify-center items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-full bg-white/10 hover:bg-white/15 text-white/90 border border-white/20 text-[11px] sm:text-xs font-medium backdrop-blur-md transition active:scale-95 shadow-sm cursor-pointer flex whitespace-nowrap [.light-theme_&]:!bg-black/[0.04] [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:!border-black/10 [.light-theme_&]:hover:!bg-black/[0.08]"
          >
            <Upload className="w-3.5 h-3.5 shrink-0" />
            <span className="sm:hidden">导入</span>
            <span className="hidden sm:inline">导入文件版本</span>
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

      {/* Snapshot Creation Card (Expandable) */}
      <AnimatePresence>
        {isCreatingSnapshot && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="relative p-4 sm:p-5 rounded-3xl bg-white/[0.06] backdrop-blur-2xl border border-white/20 space-y-4 shadow-xl overflow-hidden [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-black/10">
              <div className="flex items-center justify-between relative z-10">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 [.light-theme_&]:!text-[#1c1c1e]">
                  <Sparkles className="w-4 h-4 text-white/80 [.light-theme_&]:!text-[#1c1c1e]" />
                  保存当前卡片为历史版本快照
                </h4>
                <button 
                  onClick={() => setIsCreatingSnapshot(false)}
                  className="p-1 rounded-full text-white/40 hover:text-white transition cursor-pointer [.light-theme_&]:hover:!bg-black/5 [.light-theme_&]:!text-[#1c1c1e]/60"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 relative z-10">
                <div>
                  <label className="block text-[11px] font-medium text-white/80 mb-1 [.light-theme_&]:!text-[#1c1c1e]/80">
                    版本标识 / 版本号
                  </label>
                  <input
                    type="text"
                    value={snapshotName}
                    onChange={e => setSnapshotName(e.target.value)}
                    placeholder={`例如 v${currentVersionStr} 或 初版备份`}
                    className="w-full bg-white/5 border border-white/15 rounded-2xl px-3.5 py-2 text-xs text-white placeholder-white/40 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/20 transition [.light-theme_&]:!bg-black/[0.03] [.light-theme_&]:!border-black/10 [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:!placeholder-black/40 [.light-theme_&]:focus:!border-black/30 [.light-theme_&]:focus:!ring-black/5"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-white/80 mb-1 [.light-theme_&]:!text-[#1c1c1e]/80">
                    修改说明 / 迭代备注
                  </label>
                  <input
                    type="text"
                    value={snapshotNote}
                    onChange={e => setSnapshotNote(e.target.value)}
                    placeholder="例如：优化人设提示词与第2段开场白"
                    className="w-full bg-white/5 border border-white/15 rounded-2xl px-3.5 py-2 text-xs text-white placeholder-white/40 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/20 transition [.light-theme_&]:!bg-black/[0.03] [.light-theme_&]:!border-black/10 [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:!placeholder-black/40 [.light-theme_&]:focus:!border-black/30 [.light-theme_&]:focus:!ring-black/5"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1 relative z-10">
                <button
                  onClick={() => setIsCreatingSnapshot(false)}
                  className="px-4 py-2 rounded-full text-xs text-white/70 hover:text-white bg-white/10 hover:bg-white/15 border border-white/15 transition cursor-pointer [.light-theme_&]:!bg-black/5 [.light-theme_&]:!border [.light-theme_&]:!border-black/10 [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:hover:!bg-black/10"
                >
                  取消
                </button>
                <button
                  onClick={handleCreateSnapshot}
                  className="px-5 py-2 rounded-full text-xs font-medium text-white/90 bg-white/15 hover:bg-white/20 border border-white/25 shadow-sm transition active:scale-95 cursor-pointer [.light-theme_&]:!bg-black/[0.06] [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:!border-black/15 [.light-theme_&]:hover:!bg-black/[0.1]"
                >
                  保存快照
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Timeline Section */}
      <div className="space-y-4">
        {/* Node 1: Current Active Version (Identical Unified Layout) */}
        <div className="relative pl-5 sm:pl-8 before:absolute before:left-1 sm:before:left-3 before:top-[28px] sm:before:top-[32px] before:bottom-0 before:w-0.5 before:bg-white/15 [.light-theme_&]:before:!bg-black/10">
          {/* Node Dot */}
          <div className="absolute -left-1 sm:left-1 top-[28px] sm:top-[32px] -translate-y-1/2 w-4 h-4 sm:w-4.5 sm:h-4.5 rounded-full bg-gradient-to-tr from-purple-500 to-pink-500 border-2 border-slate-900 [.light-theme_&]:!border-white shadow-md shadow-purple-500/30 flex items-center justify-center z-10">
            <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          </div>

          <div className="relative p-3.5 sm:p-4.5 pl-4 sm:pl-5 rounded-3xl bg-white/[0.06] backdrop-blur-2xl border border-white/20 hover:border-white/35 transition-all duration-300 space-y-2 sm:space-y-2.5 overflow-hidden shadow-xl [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:backdrop-blur-none [.light-theme_&]:!border-black/10 [.light-theme_&]:!shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
            {/* Apple Reminders Style Left Vertical Accent Strip (Active) */}
            <div className="absolute left-0 top-3 bottom-3 w-1.5 rounded-r-full bg-gradient-to-b from-purple-500 to-pink-500 shadow-sm [.light-theme_&]:!from-[#a855f7] [.light-theme_&]:!to-[#ec4899]" />

            {/* Top Row: Name on Left + Status Pill on Right */}
            <div className="flex items-center justify-between gap-2 sm:gap-3 relative z-10">
              <h4 className="text-sm sm:text-base font-bold text-white tracking-tight flex items-center gap-1.5 min-w-0 truncate [.light-theme_&]:!text-[#1c1c1e]">
                <span className="truncate">{character.name}</span>
                <span className="text-[11px] font-normal text-white/50 shrink-0 [.light-theme_&]:!text-black/50">v{currentVersionStr}</span>
              </h4>

              <div className="flex items-center gap-1.5 shrink-0">
                <span className="px-2.5 sm:px-3 py-0.5 rounded-full text-[11px] font-semibold bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-pink-300 border border-pink-400/35 backdrop-blur-md shadow-xs flex items-center gap-1.5 [.light-theme_&]:!from-purple-100 [.light-theme_&]:!to-pink-100 [.light-theme_&]:!text-purple-700 [.light-theme_&]:!border-purple-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                  <span>当前活跃</span>
                </span>
              </div>
            </div>

            {/* Middle: Description Body */}
            <div className="relative z-10 space-y-2">
              <p className="text-[11px] sm:text-xs text-white/70 leading-relaxed font-normal line-clamp-2 [.light-theme_&]:!text-[#1c1c1e]/75">
                {currentDescription || "当前卡片设定完整生效中，开场白与世界书随时可供溯源。"}
              </p>

              {/* Middle Row: Metrics Pills (Right below description, perfectly fitting without crowding bottom) */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] sm:text-[11px] text-white/80 font-medium [.light-theme_&]:!bg-black/[0.04] [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:!border-black/10">
                  {currentDescription.length} 字
                </span>
                <span className="px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] sm:text-[11px] text-white/80 font-medium [.light-theme_&]:!bg-black/[0.04] [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:!border-black/10">
                  {currentGreetingsCount} 篇开场白
                </span>
                {currentWeatherBookCount > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] sm:text-[11px] text-white/80 font-medium [.light-theme_&]:!bg-black/[0.04] [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:!border-black/10">
                    {currentWeatherBookCount} 条世界书
                  </span>
                )}
              </div>
            </div>

            {/* Bottom Row: Timestamp on Left + Avatar on Right */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10 relative z-10 [.light-theme_&]:!border-black/5">
              {/* Bottom Left Timestamp */}
              <div className="flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-xs font-semibold text-white/75 [.light-theme_&]:!text-[#1c1c1e]/75">
                <Clock className="w-3.5 h-3.5 text-pink-300/90 shrink-0 [.light-theme_&]:!text-purple-600" />
                <span>{new Date(character.updatedAt || character.createdAt).toLocaleDateString()} {new Date(character.updatedAt || character.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>

              {/* Bottom Right Avatar */}
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full overflow-hidden shrink-0 border-2 border-white/30 shadow-md bg-white/10 [.light-theme_&]:!border-black/10">
                <ActiveAvatar character={character} avatarUrl={avatarUrl} />
              </div>
            </div>
          </div>
        </div>

        {/* Nodes 2..N: Historical Snapshots */}
        {historyList.length === 0 ? (
          <div className="ml-5 sm:ml-8 relative p-6 sm:p-8 rounded-3xl bg-white/[0.04] backdrop-blur-2xl border border-white/15 text-center text-white/60 text-xs space-y-2 overflow-hidden shadow-sm [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:backdrop-blur-none [.light-theme_&]:!border-black/10">
            <div className="relative z-10 space-y-1.5">
              <GitBranch className="w-8 h-8 mx-auto opacity-40 text-white/60 [.light-theme_&]:!text-[#1c1c1e]/60" />
              <p className="font-semibold text-sm text-white [.light-theme_&]:!text-[#1c1c1e]">暂无关联的历史旧版本</p>
              <p className="text-white/60 max-w-md mx-auto leading-relaxed [.light-theme_&]:!text-[#1c1c1e]/60">
                若您在卡库中存有该角色的旧版本或备用开场白卡片，可点击上方的「绑定卡库旧版本」进行融合溯源，亦可随时创建当前快照。
              </p>
            </div>
          </div>
        ) : (
          historyList.map((snapshot) => {
            const snapData = snapshot.data?.data || snapshot.data || {};
            const snapDesc = snapData.description || '';
            const snapGreetingsCount = 1 + (snapData.alternate_greetings?.length || 0);
            const snapWbCount = snapData.character_book?.entries?.length || 0;
            const isExpanded = expandedDiffId === snapshot.id;

            return (
              <div 
                key={snapshot.id}
                className="relative pl-5 sm:pl-8 before:absolute before:left-1 sm:before:left-3 before:top-0 before:bottom-0 before:w-0.5 before:bg-white/15 [.light-theme_&]:before:!bg-black/10 last:before:bottom-auto last:before:h-[34px] sm:last:before:h-[44px]"
              >
                {/* Node Dot */}
                <div className="absolute -left-0.5 sm:left-1.5 top-[28px] sm:top-[32px] -translate-y-1/2 w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full bg-slate-800 border-2 border-white/40 shadow-sm flex items-center justify-center [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-black/30 z-10">
                  <div className="w-1.5 h-1.5 rounded-full bg-white/60 [.light-theme_&]:!bg-black/40" />
                </div>

                <div className="relative p-3.5 sm:p-4.5 pl-4 sm:pl-5 rounded-3xl bg-white/[0.06] backdrop-blur-2xl border border-white/20 hover:border-white/35 transition-all duration-300 space-y-2 sm:space-y-2.5 shadow-lg hover:shadow-xl group overflow-hidden [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:backdrop-blur-none [.light-theme_&]:!border-black/10 [.light-theme_&]:!shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
                  {/* Apple Reminders Style Left Vertical Accent Strip (History) */}
                  <div className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full bg-white/20 [.light-theme_&]:!bg-[#d8d8dc]" />

                  {/* Top Row: Name on Left + Right Action Pills */}
                  <div className="flex items-center justify-between gap-2 sm:gap-3 relative z-10">
                    <h4 className="text-sm sm:text-base font-bold text-white tracking-tight flex items-center gap-1.5 min-w-0 truncate [.light-theme_&]:!text-[#1c1c1e]">
                      <span className="truncate">{snapshot.versionName || '未命名版本'}</span>
                    </h4>

                    {/* Right Action Pills */}
                    <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                      <button
                        onClick={() => setExpandedDiffId(isExpanded ? null : snapshot.id)}
                        className={`px-2 sm:px-2.5 py-1 rounded-full text-[11px] sm:text-xs font-medium transition-all flex items-center gap-1 active:scale-95 cursor-pointer ${
                          isExpanded 
                            ? 'bg-white text-[#121316] font-semibold shadow-sm border border-white/40 [.light-theme_&]:!bg-black/[0.1] [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:!border-black/20' 
                            : 'bg-white/10 hover:bg-white/20 text-white/80 hover:text-white border border-white/20 backdrop-blur-md [.light-theme_&]:!bg-black/[0.04] [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:!border-black/10 [.light-theme_&]:hover:!bg-black/[0.08]'
                        }`}
                        title="查看与当前版本差异对比"
                      >
                        <Eye className="w-3 h-3" />
                        <span className="hidden sm:inline">对比</span>
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>

                      <button
                        onClick={() => handleRollback(snapshot)}
                        className="px-2 sm:px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white/90 hover:text-white border border-white/20 text-[11px] sm:text-xs font-medium transition-all flex items-center gap-1 active:scale-95 shadow-xs backdrop-blur-md cursor-pointer [.light-theme_&]:!bg-black/[0.04] [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:!border-black/10 [.light-theme_&]:hover:!bg-black/[0.08]"
                        title="恢复为当前生效版本（当前版本将自动备份）"
                      >
                        <RotateCcw className="w-3 h-3 text-white/80 [.light-theme_&]:!text-[#1c1c1e]/80" />
                        <span className="hidden sm:inline">回滚</span>
                      </button>

                      <button
                        onClick={() => handleExportSnapshot(snapshot)}
                        className="p-1 sm:p-1.5 rounded-full bg-white/5 hover:bg-white/15 text-white/70 hover:text-white border border-white/15 text-xs transition active:scale-95 cursor-pointer [.light-theme_&]:!bg-black/[0.04] [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:!border-black/10 [.light-theme_&]:hover:!bg-black/[0.08]"
                        title="导出为此历史版本的 PNG 角色卡"
                      >
                        <Download className="w-3 h-3" />
                      </button>

                      <button
                        onClick={() => handleDeleteSnapshot(snapshot.id, snapshot.versionName)}
                        className="p-1 sm:p-1.5 rounded-full bg-white/5 hover:bg-red-500/20 text-white/50 hover:text-red-400 border border-white/15 text-xs transition active:scale-95 cursor-pointer [.light-theme_&]:!bg-black/[0.04] [.light-theme_&]:!text-white/60 [.light-theme_&]:!border-black/10 [.light-theme_&]:hover:!bg-red-50 [.light-theme_&]:hover:!text-red-600"
                        title="删除该版本快照"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Middle: Note / Description Body & Metrics Pills */}
                  <div className="relative z-10 space-y-2">
                    <p className="text-[11px] sm:text-xs text-white/70 leading-relaxed font-normal line-clamp-2 [.light-theme_&]:!text-[#1c1c1e]/75">
                      {snapshot.note || snapDesc || '历史快照数据已完整存档'}
                    </p>

                    {/* Middle Row: Metrics Pills (Right below description) */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] sm:text-[11px] text-white/80 font-medium [.light-theme_&]:!bg-black/[0.04] [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:!border-black/10">
                        {snapDesc.length} 字
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] sm:text-[11px] text-white/80 font-medium [.light-theme_&]:!bg-black/[0.04] [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:!border-black/10">
                        {snapGreetingsCount} 篇开场白
                      </span>
                      {snapWbCount > 0 && (
                        <span className="px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] sm:text-[11px] text-white/80 font-medium [.light-theme_&]:!bg-black/[0.04] [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:!border-black/10">
                          {snapWbCount} 条世界书
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Bottom Row: Timestamp on Left + Snapshot Avatar on Right */}
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10 relative z-10 [.light-theme_&]:!border-black/5">
                    {/* Bottom Left Timestamp */}
                    <div className="flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-xs font-semibold text-white/75 [.light-theme_&]:!text-[#1c1c1e]/75">
                      <Clock className="w-3.5 h-3.5 text-purple-300/80 shrink-0 [.light-theme_&]:!text-purple-600" />
                      <span>{new Date(snapshot.createdAt).toLocaleDateString()} {new Date(snapshot.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>

                    {/* Snapshot Avatar */}
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full overflow-hidden shrink-0 border-2 border-white/20 shadow-md bg-black/40 [.light-theme_&]:!border-black/10">
                      <SnapshotAvatar snapshot={snapshot} fallbackName={snapshot.cardName || character.name} />
                    </div>
                  </div>

                  {/* Collapsible Diff / Comparison Area */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 pt-4 border-t border-white/10 [.light-theme_&]:!border-black/10 space-y-4 text-xs">
                          {/* First message comparison */}
                          <div>
                            <div className="font-semibold text-white mb-2 flex items-center gap-1.5 [.light-theme_&]:!text-[#1c1c1e]">
                              <MessageSquare className="w-3.5 h-3.5 text-pink-300 [.light-theme_&]:!text-purple-600" />
                              <span>默认开场白对比</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="p-3.5 rounded-2xl bg-black/30 [.light-theme_&]:bg-black/[0.03] border border-white/10 [.light-theme_&]:border-black/10 space-y-1">
                                <span className="text-[10px] text-pink-300 font-bold block [.light-theme_&]:!text-purple-700">当前版本</span>
                                <p className="text-white/90 whitespace-pre-wrap max-h-36 overflow-y-auto font-mono text-[11px] leading-relaxed [.light-theme_&]:!text-[#1c1c1e]">
                                  {currentData.first_mes || '（无开场白）'}
                                </p>
                              </div>
                              <div className="p-3.5 rounded-2xl bg-black/30 [.light-theme_&]:bg-black/[0.03] border border-white/10 [.light-theme_&]:border-black/10 space-y-1">
                                <span className="text-[10px] text-purple-300 font-bold block [.light-theme_&]:!text-purple-700">历史版本 ({snapshot.versionName})</span>
                                <p className="text-white/90 whitespace-pre-wrap max-h-36 overflow-y-auto font-mono text-[11px] leading-relaxed [.light-theme_&]:!text-[#1c1c1e]">
                                  {snapData.first_mes || '（无开场白）'}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Description summary */}
                          <div>
                            <div className="font-semibold text-white mb-2 flex items-center gap-1.5 [.light-theme_&]:!text-[#1c1c1e]">
                              <FileText className="w-3.5 h-3.5 text-pink-300 [.light-theme_&]:!text-purple-600" />
                              <span>历史人设描述 (前 200 字)</span>
                            </div>
                            <div className="p-3.5 rounded-2xl bg-black/30 [.light-theme_&]:bg-black/[0.03] border border-white/10 [.light-theme_&]:border-black/10">
                              <p className="text-white/80 whitespace-pre-wrap line-clamp-4 font-mono text-[11px] leading-relaxed [.light-theme_&]:!text-[#1c1c1e]/80">
                                {snapDesc || '（无描述）'}
                              </p>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Link Existing Card Modal - Portaled to document.body */}
      {createPortal(
        <AnimatePresence>
          {isLinkModalOpen && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm [.light-theme_&]:bg-black/40">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                className="bg-slate-900 border border-white/15 rounded-3xl p-5 w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] [.light-theme_&]:bg-[#ffffff] [.light-theme_&]:border-black/10 [.light-theme_&]:shadow-2xl"
              >
                <div className="flex items-center justify-between pb-3 border-b border-white/10 [.light-theme_&]:border-black/10">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Link className="w-4 h-4 text-purple-400 [.light-theme_&]:text-purple-600" />
                      关联已有卡片为历史版本
                    </h3>
                    <p className="text-xs text-white/60 mt-0.5">
                      将卡库中的旧版本完整归档为当前角色的迭代分支，便于对比和随心回滚
                    </p>
                  </div>
                  <button
                    onClick={() => { setIsLinkModalOpen(false); setSelectedCandidate(null); }}
                    className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition cursor-pointer [.light-theme_&]:hover:bg-black/5 [.light-theme_&]:text-white/60 [.light-theme_&]:hover:text-[#1c1c1e]"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Search input */}
                <div className="pt-3 pb-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 [.light-theme_&]:text-black/40" />
                    <input
                      type="text"
                      placeholder="搜索卡库角色..."
                      value={linkSearchQuery}
                      onChange={e => setLinkSearchQuery(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-white/40 focus:outline-none focus:border-purple-500/50 transition [.light-theme_&]:bg-black/[0.03] [.light-theme_&]:border-black/10 [.light-theme_&]:text-[#1c1c1e] [.light-theme_&]:placeholder-black/40"
                    />
                  </div>
                </div>

                {/* Candidate list */}
                <div 
                  onScroll={handleCandidateScroll}
                  className="flex-1 overflow-y-auto space-y-2 pr-1 my-2 max-h-[40vh] custom-scrollbar"
                >
                  {filteredCandidates.length === 0 ? (
                    <div className="py-8 text-center text-xs text-white/40 [.light-theme_&]:text-black/40">
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
                          className={`p-3 rounded-2xl border transition cursor-pointer flex items-center justify-between gap-3 ${
                            isSelected
                              ? 'bg-purple-600/20 border-purple-500/60 shadow-inner [.light-theme_&]:bg-purple-50 [.light-theme_&]:border-purple-400'
                              : 'bg-white/5 border-white/10 hover:bg-white/10 [.light-theme_&]:bg-black/[0.03] [.light-theme_&]:border-black/10 [.light-theme_&]:hover:bg-black/[0.06]'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <CandidateAvatar char={c} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="font-semibold text-xs text-white truncate">
                                  {c.name}
                                </h4>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/80 font-mono [.light-theme_&]:bg-black/5 [.light-theme_&]:text-[#1c1c1e] [.light-theme_&]:border [.light-theme_&]:border-black/10">
                                  v{ver}
                                </span>
                              </div>
                              <p className="text-[10px] text-white/60 truncate mt-0.5">
                                修改: {new Date(c.fileModifiedAt || c.updatedAt || c.createdAt).toLocaleDateString()} · 描述: {(cData.description || '').length}字
                              </p>
                            </div>
                          </div>

                          <div className={`w-5 h-5 rounded-full flex items-center justify-center border transition shrink-0 ${
                            isSelected 
                              ? 'bg-purple-600 border-purple-500 text-white' 
                              : 'border-white/30 bg-black/20 [.light-theme_&]:border-black/20 [.light-theme_&]:bg-black/5'
                          }`}>
                            {isSelected && <Check className="w-3 h-3" />}
                          </div>
                        </div>
                      );
                    })
                  )}

                  {visibleCandidates.length < filteredCandidates.length && (
                    <div className="py-2.5 text-center text-[10px] text-white/40 [.light-theme_&]:text-black/40">
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
                  className="flex items-start gap-2.5 p-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition cursor-pointer select-none my-2 [.light-theme_&]:bg-black/[0.03] [.light-theme_&]:border-black/10 [.light-theme_&]:hover:bg-black/[0.06]"
                >
                  <div
                    className={`w-4 h-4 rounded flex items-center justify-center border transition shrink-0 mt-0.5 ${
                      deleteCandidateAfterLink
                        ? "bg-purple-600 border-purple-500 text-white shadow-sm shadow-purple-500/30"
                        : "border-white/30 bg-black/30 [.light-theme_&]:border-black/20 [.light-theme_&]:bg-black/5"
                    }`}
                  >
                    {deleteCandidateAfterLink && <Check className="w-3 h-3 text-white stroke-[2.5]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-white block">
                      绑定后将原独立卡片移至回收站
                    </span>
                    <span className="text-[10px] text-white/60 block">
                      推荐勾选，避免在列表中留有重复同名卡片，旧卡所有数据均完整封存在版本历史中
                    </span>
                  </div>
                </div>

                {/* Modal footer */}
                <div className="flex gap-2 pt-2 border-t border-white/10 [.light-theme_&]:border-black/10">
                  <button
                    type="button"
                    onClick={() => { setIsLinkModalOpen(false); setSelectedCandidate(null); }}
                    className="flex-1 py-2.5 px-3 rounded-full bg-white/10 hover:bg-white/15 text-white font-medium transition text-xs cursor-pointer [.light-theme_&]:bg-black/5 [.light-theme_&]:hover:bg-black/10 [.light-theme_&]:text-[#1c1c1e] [.light-theme_&]:border [.light-theme_&]:border-black/10"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={!selectedCandidate}
                    onClick={handleConfirmLink}
                    className="flex-1 py-2.5 px-3 rounded-full bg-white/15 hover:bg-white/20 disabled:opacity-40 font-medium text-white shadow-sm transition text-xs flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer border border-white/25 [.light-theme_&]:!bg-black/[0.06] [.light-theme_&]:!text-[#1c1c1e] [.light-theme_&]:!border-black/15 [.light-theme_&]:hover:!bg-black/[0.1]"
                  >
                    <Link className="w-3.5 h-3.5" />
                    确认关联为此卡历史版本
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
