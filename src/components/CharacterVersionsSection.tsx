import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  History, GitBranch, Plus, Link, Upload, RotateCcw, 
  Trash2, Download, Eye, ChevronDown, ChevronUp, Check, 
  X, Search, Sparkles, Book, MessageSquare, AlertCircle,
  Clock, ArrowRight, FileText, CheckCircle2
} from 'lucide-react';
import { 
  CharacterCard, CardVersionSnapshot, saveCharacter, 
  getCharacters, deleteCharacter, getCharacter 
} from '../lib/db';
import { injectTavernData, extractTavernData } from '../lib/png';
import { downloadOrShareFile } from '../lib/appBridge';
import { getFallbackAvatar, resolveAvatarUrl } from '../lib/avatar';

interface Props {
  character: CharacterCard;
  onUpdateCharacter: (updated: CharacterCard) => void;
  onRefreshDetail?: () => void;
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
      <div className="w-full h-full flex items-center justify-center bg-purple-500/10 text-purple-300 font-bold text-xs">
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

export function CharacterVersionsSection({ character, onUpdateCharacter, onRefreshDetail }: Props) {
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
      // Filter out self and deleted cards
      const available = res.characters.filter(c => c.id !== character.id && !c.deletedAt);
      setCandidateCards(available);
    });
    return () => { isMounted = false; };
  }, [isLinkModalOpen, character.id]);

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
    <div className="space-y-6">
      {/* Top Banner & Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 text-white shadow-md shadow-purple-500/20">
              <History className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white [.light-theme_&]:text-slate-900">
              版本迭代与溯源
            </h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-medium border border-purple-500/30">
              {historyList.length > 0 ? `共 ${historyList.length + 1} 个演进版本` : '当前为单版本'}
            </span>
          </div>
          <p className="text-xs text-white/50 [.light-theme_&]:text-slate-500 mt-1">
            记录新旧版本的演变轨迹，支持历史快照对比、一键回滚以及关联绑定卡库中的旧版本。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setIsCreatingSnapshot(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 text-xs font-semibold transition active:scale-95 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>创建当前快照</span>
          </button>

          <button
            onClick={() => setIsLinkModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600/30 hover:bg-blue-600/50 text-blue-200 border border-blue-500/40 text-xs font-semibold transition active:scale-95 shadow-sm"
          >
            <Link className="w-3.5 h-3.5" />
            <span>绑定卡库旧版本</span>
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white/80 text-xs font-semibold transition active:scale-95 [.light-theme_&]:bg-black/10 [.light-theme_&]:text-slate-700"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>导入文件版本</span>
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
            <div className="p-4 rounded-2xl bg-purple-950/30 border border-purple-500/30 space-y-3 [.light-theme_&]:bg-purple-50 [.light-theme_&]:border-purple-200">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-purple-300 [.light-theme_&]:text-purple-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  保存当前卡片为历史版本快照
                </h4>
                <button 
                  onClick={() => setIsCreatingSnapshot(false)}
                  className="p-1 rounded-full text-white/40 hover:text-white transition [.light-theme_&]:text-slate-400 [.light-theme_&]:hover:text-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-white/70 [.light-theme_&]:text-slate-700 mb-1">
                    版本标识 / 版本号
                  </label>
                  <input
                    type="text"
                    value={snapshotName}
                    onChange={e => setSnapshotName(e.target.value)}
                    placeholder={`例如 v${currentVersionStr} 或 初版备份`}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition [.light-theme_&]:bg-white [.light-theme_&]:border-black/15 [.light-theme_&]:text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-white/70 [.light-theme_&]:text-slate-700 mb-1">
                    修改说明 / 迭代备注
                  </label>
                  <input
                    type="text"
                    value={snapshotNote}
                    onChange={e => setSnapshotNote(e.target.value)}
                    placeholder="例如：优化人设提示词与第2段开场白"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition [.light-theme_&]:bg-white [.light-theme_&]:border-black/15 [.light-theme_&]:text-slate-900"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setIsCreatingSnapshot(false)}
                  className="px-3 py-1.5 rounded-xl text-xs text-white/60 hover:text-white bg-white/5 hover:bg-white/10 transition"
                >
                  取消
                </button>
                <button
                  onClick={handleCreateSnapshot}
                  className="px-4 py-1.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-purple-500 to-blue-500 hover:opacity-90 shadow-md shadow-purple-500/20 transition active:scale-95"
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
        {/* Node 1: Current Active Version */}
        <div className="relative pl-6 sm:pl-8 before:absolute before:left-2 sm:before:left-3 before:top-4 before:bottom-0 before:w-0.5 before:bg-gradient-to-b before:from-purple-500 before:to-white/10">
          {/* Node Dot */}
          <div className="absolute left-0 sm:left-1 top-2.5 w-4 h-4 sm:w-5 sm:h-5 rounded-full bg-gradient-to-tr from-purple-600 to-pink-500 border-2 border-slate-900 shadow-md shadow-purple-500/50 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          </div>

          <div className="p-4 rounded-2xl bg-gradient-to-r from-purple-900/30 via-slate-900/40 to-blue-900/20 border border-purple-500/40 shadow-xl relative overflow-hidden [.light-theme_&]:from-purple-50/80 [.light-theme_&]:via-white [.light-theme_&]:to-blue-50/50 [.light-theme_&]:border-purple-300">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-black/40 border border-purple-500/30 shadow-inner">
                  <img
                    src={character.avatarUrlFallback || resolveAvatarUrl(undefined, character.name)}
                    alt={character.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.src = getFallbackAvatar(character.name);
                    }}
                  />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm text-white [.light-theme_&]:text-slate-900">
                      v{currentVersionStr}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 text-[10px] font-bold border border-green-500/30 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      当前活跃版本
                    </span>
                  </div>
                  <p className="text-[11px] text-white/50 [.light-theme_&]:text-slate-500 mt-0.5 flex items-center gap-2">
                    <Clock className="w-3 h-3" />
                    <span>更新时间: {new Date(character.updatedAt || character.createdAt).toLocaleString()}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <span className="text-[10px] text-purple-300/80 bg-purple-500/10 border border-purple-500/20 px-2 py-1 rounded-lg font-mono">
                  {character.name}
                </span>
              </div>
            </div>

            {/* Quick Metrics */}
            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-white/5 [.light-theme_&]:border-black/5 text-[11px] text-white/70 [.light-theme_&]:text-slate-600">
              <span className="px-2.5 py-1 rounded-lg bg-white/5 [.light-theme_&]:bg-black/5 flex items-center gap-1.5 font-medium">
                <FileText className="w-3.5 h-3.5 text-purple-400" />
                设定描述: {currentDescription.length} 字
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-white/5 [.light-theme_&]:bg-black/5 flex items-center gap-1.5 font-medium">
                <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
                开场白: {currentGreetingsCount} 篇
              </span>
              {currentWeatherBookCount > 0 && (
                <span className="px-2.5 py-1 rounded-lg bg-white/5 [.light-theme_&]:bg-black/5 flex items-center gap-1.5 font-medium">
                  <Book className="w-3.5 h-3.5 text-emerald-400" />
                  世界书: {currentWeatherBookCount} 条
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Nodes 2..N: Historical Snapshots */}
        {historyList.length === 0 ? (
          <div className="ml-6 sm:ml-8 p-8 rounded-2xl border border-dashed border-white/10 text-center text-white/40 text-xs space-y-2 [.light-theme_&]:border-black/10 [.light-theme_&]:text-slate-400">
            <GitBranch className="w-8 h-8 mx-auto opacity-30 text-purple-400" />
            <p className="font-medium text-sm text-white/60 [.light-theme_&]:text-slate-600">暂无关联的历史旧版本</p>
            <p>
              若您在卡库中存有该角色的旧版本或备用开场白卡片，可点击上方的「绑定卡库旧版本」进行融合溯源，亦可随时创建当前快照。
            </p>
          </div>
        ) : (
          historyList.map((snapshot, index) => {
            const snapData = snapshot.data?.data || snapshot.data || {};
            const snapDesc = snapData.description || '';
            const snapGreetingsCount = 1 + (snapData.alternate_greetings?.length || 0);
            const snapWbCount = snapData.character_book?.entries?.length || 0;
            const isExpanded = expandedDiffId === snapshot.id;

            return (
              <div 
                key={snapshot.id}
                className="relative pl-6 sm:pl-8 before:absolute before:left-2 sm:before:left-3 before:top-0 before:bottom-0 before:w-0.5 before:bg-white/10 last:before:bottom-6"
              >
                {/* Node Dot */}
                <div className="absolute left-0.5 sm:left-1.5 top-3 w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full bg-slate-800 border-2 border-white/40 shadow-sm flex items-center justify-center [.light-theme_&]:bg-white [.light-theme_&]:border-slate-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-white/60" />
                </div>

                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 hover:border-white/20 transition space-y-3 [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 bg-black/40 border border-white/10">
                        <SnapshotAvatar snapshot={snapshot} fallbackName={snapshot.cardName || character.name} />
                      </div>

                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold text-sm text-white [.light-theme_&]:text-slate-900">
                            {snapshot.versionName || '未命名版本'}
                          </h4>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/60 [.light-theme_&]:bg-black/10 [.light-theme_&]:text-slate-600 font-mono">
                            {new Date(snapshot.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        {snapshot.note && (
                          <p className="text-xs text-white/50 [.light-theme_&]:text-slate-500 mt-0.5">
                            {snapshot.note}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setExpandedDiffId(isExpanded ? null : snapshot.id)}
                        className={`p-1.5 rounded-lg border text-xs transition flex items-center gap-1 ${
                          isExpanded 
                            ? 'bg-purple-500/20 text-purple-300 border-purple-500/30' 
                            : 'bg-white/5 text-white/60 hover:text-white border-white/10 hover:bg-white/10 [.light-theme_&]:border-black/10 [.light-theme_&]:text-slate-600'
                        }`}
                        title="查看与当前版本差异对比"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">对比预览</span>
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>

                      <button
                        onClick={() => handleRollback(snapshot)}
                        className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border border-blue-500/20 text-xs transition flex items-center gap-1 active:scale-95"
                        title="恢复为当前生效版本（当前版本将自动备份）"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">回滚恢复</span>
                      </button>

                      <button
                        onClick={() => handleExportSnapshot(snapshot)}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/10 text-xs transition [.light-theme_&]:border-black/10 [.light-theme_&]:text-slate-600"
                        title="导出为此历史版本的 PNG 角色卡"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => handleDeleteSnapshot(snapshot.id, snapshot.versionName)}
                        className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs transition"
                        title="删除该版本快照"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Metrics bar */}
                  <div className="flex flex-wrap gap-2 text-[11px] text-white/60 [.light-theme_&]:text-slate-600">
                    <span className="px-2 py-0.5 rounded bg-white/5 [.light-theme_&]:bg-black/5">
                      字数: {snapDesc.length} (与当前相差 {snapDesc.length - currentDescription.length > 0 ? `+${snapDesc.length - currentDescription.length}` : snapDesc.length - currentDescription.length})
                    </span>
                    <span className="px-2 py-0.5 rounded bg-white/5 [.light-theme_&]:bg-black/5">
                      开场白: {snapGreetingsCount} 篇
                    </span>
                    {snapWbCount > 0 && (
                      <span className="px-2 py-0.5 rounded bg-white/5 [.light-theme_&]:bg-black/5">
                        世界书: {snapWbCount} 条
                      </span>
                    )}
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
                        <div className="mt-3 pt-3 border-t border-white/10 [.light-theme_&]:border-black/10 space-y-4 text-xs">
                          {/* First message comparison */}
                          <div>
                            <div className="font-semibold text-white/80 [.light-theme_&]:text-slate-800 mb-1.5 flex items-center gap-1.5">
                              <MessageSquare className="w-3.5 h-3.5 text-purple-400" />
                              <span>默认开场白对比</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="p-3 rounded-xl bg-black/40 border border-white/10 [.light-theme_&]:bg-white [.light-theme_&]:border-black/10 space-y-1">
                                <span className="text-[10px] text-green-400 font-bold block">当前版本</span>
                                <p className="text-white/70 [.light-theme_&]:text-slate-700 whitespace-pre-wrap max-h-36 overflow-y-auto font-mono text-[11px]">
                                  {currentData.first_mes || '（无开场白）'}
                                </p>
                              </div>
                              <div className="p-3 rounded-xl bg-purple-950/20 border border-purple-500/20 [.light-theme_&]:bg-purple-50/50 [.light-theme_&]:border-purple-200 space-y-1">
                                <span className="text-[10px] text-purple-400 font-bold block">历史版本 ({snapshot.versionName})</span>
                                <p className="text-white/70 [.light-theme_&]:text-slate-700 whitespace-pre-wrap max-h-36 overflow-y-auto font-mono text-[11px]">
                                  {snapData.first_mes || '（无开场白）'}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Description summary */}
                          <div>
                            <div className="font-semibold text-white/80 [.light-theme_&]:text-slate-800 mb-1.5 flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5 text-blue-400" />
                              <span>历史人设描述 (前 200 字)</span>
                            </div>
                            <div className="p-3 rounded-xl bg-black/30 border border-white/10 [.light-theme_&]:bg-white [.light-theme_&]:border-black/10">
                              <p className="text-white/60 [.light-theme_&]:text-slate-600 whitespace-pre-wrap line-clamp-4 font-mono text-[11px]">
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

      {/* Link Existing Card Modal */}
      <AnimatePresence>
        {isLinkModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-slate-900 border border-white/15 rounded-3xl p-5 w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] [.light-theme_&]:bg-[#FCFCFC] [.light-theme_&]:border-black/10"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10 [.light-theme_&]:border-black/10">
                <div>
                  <h3 className="text-base font-bold text-white [.light-theme_&]:text-slate-900 flex items-center gap-2">
                    <Link className="w-4 h-4 text-purple-400" />
                    关联已有卡片为历史版本
                  </h3>
                  <p className="text-xs text-white/50 [.light-theme_&]:text-slate-500 mt-0.5">
                    将卡库中的旧版本完整归档为当前角色的迭代分支，便于对比和随心回滚
                  </p>
                </div>
                <button
                  onClick={() => { setIsLinkModalOpen(false); setSelectedCandidate(null); }}
                  className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Search input */}
              <div className="pt-3 pb-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                  <input
                    type="text"
                    placeholder="搜索卡库角色..."
                    value={linkSearchQuery}
                    onChange={e => setLinkSearchQuery(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10 [.light-theme_&]:text-slate-900"
                  />
                </div>
              </div>

              {/* Candidate list */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 my-2 max-h-[40vh]">
                {filteredCandidates.length === 0 ? (
                  <div className="py-8 text-center text-xs text-white/40 [.light-theme_&]:text-slate-400">
                    没有找到符合条件的卡片
                  </div>
                ) : (
                  filteredCandidates.map(c => {
                    const isSelected = selectedCandidate?.id === c.id;
                    const cData = c.data?.data || c.data || {};
                    const ver = cData.character_version || c.data?.character_version || '1.0';

                    return (
                      <div
                        key={c.id}
                        onClick={() => setSelectedCandidate(isSelected ? null : c)}
                        className={`p-3 rounded-2xl border transition cursor-pointer flex items-center justify-between gap-3 ${
                          isSelected
                            ? 'bg-purple-600/20 border-purple-500/60 shadow-inner'
                            : 'bg-white/5 border-white/10 hover:bg-white/10 [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 bg-black/40 border border-white/10">
                            <img
                              src={c.avatarUrlFallback || resolveAvatarUrl(undefined, c.name)}
                              alt={c.name}
                              className="w-full h-full object-cover"
                              onError={(e) => { e.currentTarget.src = getFallbackAvatar(c.name); }}
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="font-semibold text-xs text-white [.light-theme_&]:text-slate-900 truncate">
                                {c.name}
                              </h4>
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-mono">
                                v{ver}
                              </span>
                            </div>
                            <p className="text-[10px] text-white/50 [.light-theme_&]:text-slate-500 truncate mt-0.5">
                              修改: {new Date(c.fileModifiedAt || c.updatedAt || c.createdAt).toLocaleDateString()} · 描述: {(cData.description || '').length}字
                            </p>
                          </div>
                        </div>

                        <div className={`w-5 h-5 rounded-full flex items-center justify-center border transition shrink-0 ${
                          isSelected 
                            ? 'bg-purple-600 border-purple-500 text-white' 
                            : 'border-white/30 bg-black/20 [.light-theme_&]:border-black/20'
                        }`}>
                          {isSelected && <Check className="w-3 h-3" />}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Delete candidate checkbox */}
              <div 
                onClick={() => {
                  const next = !deleteCandidateAfterLink;
                  setDeleteCandidateAfterLink(next);
                  localStorage.setItem('tavern_version_delete_candidate', String(next));
                }}
                className="flex items-start gap-2.5 p-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition cursor-pointer select-none my-2 [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10"
              >
                <div
                  className={`w-4 h-4 rounded flex items-center justify-center border transition shrink-0 mt-0.5 ${
                    deleteCandidateAfterLink
                      ? "bg-purple-600 border-purple-500 text-white shadow-sm shadow-purple-500/30"
                      : "border-white/30 bg-black/30 [.light-theme_&]:border-black/20 [.light-theme_&]:bg-white"
                  }`}
                >
                  {deleteCandidateAfterLink && <Check className="w-3 h-3 text-white stroke-[2.5]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-white block [.light-theme_&]:text-slate-800">
                    绑定后将原独立卡片移至回收站
                  </span>
                  <span className="text-[10px] text-white/50 block [.light-theme_&]:text-slate-500">
                    推荐勾选，避免在列表中留有重复同名卡片，旧卡所有数据均完整封存在版本历史中
                  </span>
                </div>
              </div>

              {/* Modal footer */}
              <div className="flex gap-2 pt-2 border-t border-white/10 [.light-theme_&]:border-black/10">
                <button
                  type="button"
                  onClick={() => { setIsLinkModalOpen(false); setSelectedCandidate(null); }}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-white/80 font-medium transition text-xs"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={!selectedCandidate}
                  onClick={handleConfirmLink}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-gradient-to-r from-purple-500 to-blue-500 hover:opacity-90 disabled:opacity-40 text-white font-semibold shadow-lg shadow-purple-500/25 transition text-xs flex items-center justify-center gap-1.5 active:scale-95"
                >
                  <Link className="w-3.5 h-3.5" />
                  确认关联为此卡历史版本
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
