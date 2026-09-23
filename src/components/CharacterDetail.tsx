import { getFallbackAvatar, resolveAvatarUrl } from '../lib/avatar';
import { useState, useEffect, useRef, memo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Download, Trash2, Book, MessageSquare, User, StickyNote, ChevronRight, Plus, Edit2, Power, X as XIcon, ChevronDown, ChevronUp, ExternalLink, Check, Upload, Send, Loader2, Share2 } from 'lucide-react';
import { getCharacter, deleteCharacter, saveCharacter, CharacterCard, getFolders, resolveFolderPath, getCachedMeta, getCharacterCategoryPrefix } from '../lib/db';
import { parseTavernCard } from '../types/tavern';
import { injectTavernData } from '../lib/png';
import { normalizeWorldbookEntries } from '../lib/worldbook';
import { getAISettings, normalizeSillyTavernUrl, getSillyTavernAuthHeaders } from '../lib/ai';
import { AvatarViewer } from './AvatarViewer';
import { QuickRepliesSection } from './QuickRepliesSection';
import { CharacterRegexSection } from './CharacterRegexSection';
import { CharacterChatsSection } from './CharacterChatsSection';
import { CharacterMemosSection } from './CharacterMemosSection';
import JSZip from 'jszip';
import { isAndroid, saveToGallery, shareFileOnAndroid, exportFileToMIU, readLocalFileBuffer, downloadOrShareFile, getDownloadTooltip } from '../lib/appBridge';
import { multipartPost } from '../lib/multipart';
import { useBackHandler } from '../lib/useBackHandler';

interface Props {
  id: string;
  onBack: () => void;
  onOpenChat?: (chatId: string) => void;
  onOpenImport?: (files?: FileList | File[]) => void;
  refreshKey?: number;
}

// memo 化: 防止父组件里无关的状态变化(比如列表滚动位置、其他弹窗开关)
// 连带触发这个 1700+ 行的大组件整体重渲染。
export const CharacterDetail = memo(function CharacterDetail({ id, onBack, onOpenChat, onOpenImport, refreshKey }: Props) {
  const [character, setCharacter] = useState<CharacterCard | null>(null);
  const [activeTab, setActiveTab] = useState<'profile' | 'greetings' | 'worldbook' | 'regex' | 'chats' | 'memos' | 'data_viewer'>('profile');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showExportAlert, setShowExportAlert] = useState(false);
  const [showAvatarViewer, setShowAvatarViewer] = useState(false);
  const [isSendingToST, setIsSendingToST] = useState(false);
  const [stFeedback, setStFeedback] = useState<{msg: string, type: 'success' | 'error'} | null>(null);
  const [isMetadataOpen, setIsMetadataOpen] = useState(false);
  const [isEditingTags, setIsEditingTags] = useState(false);
  const [tempTags, setTempTags] = useState<string>('');
  const [isEditingSource, setIsEditingSource] = useState(false);
  const [tempSource, setTempSource] = useState<string>('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [isAddingAlternate, setIsAddingAlternate] = useState(false);
  const [isEditingCreator, setIsEditingCreator] = useState(false);
  const [tempCreator, setTempCreator] = useState<string>('');
  const [isEditingVersion, setIsEditingVersion] = useState(false);
  const [tempVersion, setTempVersion] = useState<string>('');

  const [avatarUrl, setAvatarUrl] = useState<string>('');
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const hasDetailOverlay = Boolean(
    showDeleteConfirm ||
    showExportAlert ||
    showAvatarViewer ||
    isAddingAlternate ||
    isMetadataOpen ||
    isEditingTags ||
    isEditingSource ||
    isEditingName ||
    isEditingCreator ||
    isEditingVersion ||
    stFeedback
  );

  const handleDetailBack = () => {
    if (isAddingAlternate) { setIsAddingAlternate(false); return true; }
    if (showAvatarViewer) { setShowAvatarViewer(false); return true; }
    if (showDeleteConfirm) { setShowDeleteConfirm(false); return true; }
    if (showExportAlert) { setShowExportAlert(false); return true; }
    if (stFeedback) { setStFeedback(null); return true; }
    if (isMetadataOpen) { setIsMetadataOpen(false); return true; }
    if (isEditingTags) { setIsEditingTags(false); return true; }
    if (isEditingSource) { setIsEditingSource(false); return true; }
    if (isEditingName) { setIsEditingName(false); return true; }
    if (isEditingCreator) { setIsEditingCreator(false); return true; }
    if (isEditingVersion) { setIsEditingVersion(false); return true; }
    return false;
  };

  useBackHandler(hasDetailOverlay, handleDetailBack);

  useEffect(() => {
    getCharacter(id).then(async (char) => {
      setCharacter(char);
      if (char) {
        const category = getCharacterCategoryPrefix(char);
        if (category === '世界书') {
            setActiveTab('worldbook');
        } else if (category !== '未归类') {
            setActiveTab('data_viewer');
        } else {
            setActiveTab('profile');
        }

        setEditNameValue(char.name);
        if (char.avatarBlob) {
          const url = URL.createObjectURL(char.avatarBlob);
          setAvatarUrl(url);
        } else if (char.localFilePath && char.localFilePath.match(/\.(png|jpe?g|webp|gif|bmp)$/i)) {
            const { getLocalImageUrl } = await import('../lib/appBridge');
            setAvatarUrl(getLocalImageUrl(char.localFilePath, char.updatedAt || char.createdAt));
        } else {
          setAvatarUrl(resolveAvatarUrl(char.avatarUrlFallback, char.name || char.id));
        }
        
        // If it's a standalone worldbook, default to the worldbook tab
        if (char.data?.entries !== undefined) {
          setActiveTab('worldbook');
        }
      }
    });
  }, [id]);

  const handleNameSave = async () => {
    if (!editNameValue.trim() || !character) return;
    
    // Deep clone data to avoid reference mutation bugs
    const updatedData = JSON.parse(JSON.stringify(character.data));
    if (updatedData.data) {
      updatedData.data.name = editNameValue.trim();
    } else {
      updatedData.name = editNameValue.trim();
    }

    const updatedChar = { ...character, name: editNameValue.trim(), data: updatedData };
    
    const promise = saveCharacter(updatedChar);
    savePromiseRef.current = promise;
    await promise;
    setCharacter(updatedChar);
    setIsEditingName(false);
  };

  useEffect(() => {
    return () => {
      if (avatarUrl && avatarUrl.startsWith('blob:')) {
        URL.revokeObjectURL(avatarUrl);
      }
    };
  }, [avatarUrl]);

  const handleUpdateTags = async (tagsStr: string) => {
    setIsEditingTags(false);
    if (!character) return;
    const newTags = tagsStr.split(',').map(t => t.trim()).filter(t => t);
    
    let updatedData = { ...character.data };
    if (updatedData.data) {
      updatedData.data = { ...updatedData.data, tags: newTags };
    } else {
      updatedData.tags = newTags;
    }

    const updatedChar = { 
      ...character, 
      data: updatedData 
    };
    const promise = saveCharacter(updatedChar);
    savePromiseRef.current = promise;
    await promise;
    setCharacter(updatedChar);
  };

  const handleUpdateSource = async (sourceStr: string) => {
    setIsEditingSource(false);
    if (!character) return;
    
    let updatedData = { ...character.data };
    if (updatedData.data) {
      updatedData.data = {
        ...updatedData.data,
        extensions: { ...(updatedData.data.extensions || {}), source: sourceStr }
      };
    } else {
      updatedData.extensions = { ...(updatedData.extensions || {}), source: sourceStr };
      updatedData.source = sourceStr; // Fallback for V1
    }

    const updatedChar = { 
      ...character, 
      data: updatedData 
    };
    const promise = saveCharacter(updatedChar);
    savePromiseRef.current = promise;
    await promise;
    setCharacter(updatedChar);
  };

  const updateField = async (field: string, value: any) => {
    if (!character) return;
    const updatedChar = { ...character };
    let targetData = updatedChar.data.data ? updatedChar.data.data : updatedChar.data;
    targetData[field] = value;
    
    // For alternate greetings, also save to extensions for broader compatibility with some Tavern forks
    if (field === 'alternate_greetings') {
      targetData.extensions = targetData.extensions || {};
      targetData.extensions.alternate_greetings = value;
    }
    
    const promise = saveCharacter(updatedChar);
    savePromiseRef.current = promise;
    await promise;
    setCharacter(updatedChar);
  };

  const handleUpdateCreator = async (creatorStr: string) => {
    setIsEditingCreator(false);
    await updateField('creator', creatorStr);
  };

  const handleUpdateVersion = async (versionStr: string) => {
    setIsEditingVersion(false);
    await updateField('character_version', versionStr);
  };

  const handleBack = async () => {
    if (isEditingTags) await handleUpdateTags(tempTags);
    if (isEditingSource) await handleUpdateSource(tempSource);
    if (isEditingName) await handleNameSave();
    if (isEditingCreator) await handleUpdateCreator(tempCreator);
    if (isEditingVersion) await handleUpdateVersion(tempVersion);

    if (savePromiseRef.current) {
      await savePromiseRef.current;
    }
    onBack();
  };
  const handleDetailTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touch) {
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    }
  };

  const handleDetailTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    const touch = e.changedTouches[0];
    if (!start || !touch) return;
    touchStartRef.current = null;

    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    if (dx > 90 && start.x < 80 && Math.abs(dy) < 70) {
      handleBack();
    }
  };

  if (!character) return null;

  const card = parseTavernCard(character.data);
  const data = card.data;
  const rawData = character.data;
  const category = getCharacterCategoryPrefix(character);
  const isPreset = category === '预设';
  const isStandaloneWorldbook = category === '世界书';
  const isTheme = category === '美化';
  const isQR = category === '快速回复';
  const isScript = category === '脚本' || category === '工具区';
  const isSpecialData = isTheme || isQR || isScript || isPreset;

  const getSafeFilename = (name: string) => {
    return name.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5\-]/g, '_') || 'character';
  };

  const getNormalizedExportData = () => {
    let exportData = JSON.parse(JSON.stringify(character.data || {}));

    // Remove avatar fields so importing clients don't get stuck on old avatar
    if (exportData && typeof exportData === 'object') {
      if (exportData.avatar) delete exportData.avatar;
      if (exportData.data && exportData.data.avatar) delete exportData.data.avatar;
    }

    if (exportData.entries) {
      exportData.entries = normalizeWorldbookEntries(exportData.entries);
    } else if (exportData.data && exportData.data.entries) {
      exportData.data.entries = normalizeWorldbookEntries(exportData.data.entries);
    }
    if (exportData.character_book && exportData.character_book.entries) {
      exportData.character_book.entries = normalizeWorldbookEntries(exportData.character_book.entries);
    }
    if (exportData.data?.character_book?.entries) {
      exportData.data.character_book.entries = normalizeWorldbookEntries(exportData.data.character_book.entries);
    }
    if (exportData.extensions?.character_book?.entries) {
      exportData.extensions.character_book.entries = normalizeWorldbookEntries(exportData.extensions.character_book.entries);
    }
    if (exportData.data?.extensions?.character_book?.entries) {
      exportData.data.extensions.character_book.entries = normalizeWorldbookEntries(exportData.data.extensions.character_book.entries);
    }

    // 保证酒馆能识别：普通角色卡若无 data 包装则补 V2 信封；标签统一放进 data.tags。
    // 世界书/美化/预设/QR/脚本等特殊数据不套角色卡信封，保持原样。
    const isCharacterLike =
      !Array.isArray(exportData) &&
      typeof exportData === 'object' &&
      exportData !== null &&
      exportData.type !== 'script' &&
      exportData.entries === undefined &&
      exportData.blur_strength === undefined &&
      exportData.main_text_color === undefined &&
      exportData.temperature === undefined &&
      exportData.prompts === undefined &&
      exportData.quick_replies === undefined &&
      exportData.qrList === undefined &&
      (
        exportData.spec === 'chara_card_v2' ||
        exportData.spec === 'chara_card_v3' ||
        !!exportData.data ||
        !!exportData.name ||
        !!exportData.char_name ||
        !!exportData.character_name
      );
    if (isCharacterLike) {
      if (!exportData.data || typeof exportData.data !== 'object' || Array.isArray(exportData.data)) {
        exportData = { spec: 'chara_card_v2', spec_version: '2.0', data: exportData };
      }
      const inner = exportData.data;
      if (!Array.isArray(inner.tags)) {
        inner.tags = Array.isArray(exportData.tags) ? exportData.tags : [];
      }
      if (exportData.tags && exportData.data !== exportData) {
        delete exportData.tags;
      }
    }

    return exportData;
  };

  const getExportBaseName = async () => {
      const importedName =
        character.autoImportFilename
          ?.split("/")
          .pop()
          ?.replace(/\.[^.]+$/, "") || "";
      if (importedName) return importedName;

      const allMeta = await getCachedMeta();
      const sameNameChars = allMeta
        .filter(
          (meta) =>
            !meta.deletedAt &&
            meta.name?.trim() === character.name?.trim(),
        )
        .sort(
          (a, b) =>
            a.createdAt - b.createdAt ||
            a.id.localeCompare(b.id),
        );
      const duplicateIndex = sameNameChars.findIndex(
        (meta) => meta.id === character.id,
      );
      const baseName = getSafeFilename(character.name);
      return duplicateIndex > 0
        ? `${baseName}_${duplicateIndex}`
        : baseName;
    };

    const handleExportJson = async (share: boolean = true) => {
    const jsonStr = JSON.stringify(getNormalizedExportData(), null, 2);
    const safeName = await getExportBaseName();
    const exportFileName = `${safeName}.json`;
    const bytes = new TextEncoder().encode(jsonStr);
    await downloadOrShareFile(exportFileName, bytes.buffer, 'application/json', share);
  };

  const handleExportPng = async (share: boolean = true) => {
    if (isPreset || isStandaloneWorldbook || isTheme || isQR || isScript) {
      handleExportJson(share);
      return;
    }

    let baseBlob = character.avatarBlob;
    let localBuffer: ArrayBuffer | null = null;
    if (character.localFilePath) {
      localBuffer = await readLocalFileBuffer(character.localFilePath);
    } else if (!baseBlob && character.originalFile && (character.originalFile.type === 'image/png' || character.originalFile.name.endsWith('.png'))) {
      baseBlob = character.originalFile;
    }

    if (baseBlob || localBuffer) {
      try {
        const buffer = localBuffer || await baseBlob!.arrayBuffer();
        const newBuffer = injectTavernData(buffer, getNormalizedExportData());
        
        const safeName = await getExportBaseName();
        const exportFileName = `${safeName}.png`;
        await downloadOrShareFile(exportFileName, newBuffer, 'image/png', share);
      } catch (e) {
        console.error("Failed to export PNG", e);
        if (!isPreset && !isStandaloneWorldbook) setShowExportAlert(true);
        handleExportJson(share);
      }
    } else {
      if (!isPreset && !isStandaloneWorldbook) setShowExportAlert(true);
      handleExportJson(share);
    }
  };

  const handleSendToST = async () => {
    if (isPreset || isStandaloneWorldbook || isTheme || isQR || isScript) {
      setStFeedback({ msg: '此类型数据无法通过API直接发送至酒馆', type: 'error' });
      setTimeout(() => setStFeedback(null), 3000);
      return;
    }

    const aiSettings = getAISettings();
    const stUrl = normalizeSillyTavernUrl(aiSettings.sillyTavernUrl);
    if (!stUrl) {
      setStFeedback({ msg: '请先在"设置"中配置酒馆 API 地址', type: 'error' });
      setTimeout(() => setStFeedback(null), 3000);
      return;
    }

    let baseBlob = character.avatarBlob;
    let localBuffer: ArrayBuffer | null = null;
    const localImagePath =
      character.localFilePath &&
      /\.(png|jpe?g|webp|gif|bmp)$/i.test(character.localFilePath)
        ? character.localFilePath
        : undefined;

    if (localImagePath) {
      localBuffer = await readLocalFileBuffer(localImagePath);
    } else if (!baseBlob && character.originalFile && (character.originalFile.type === 'image/png' || character.originalFile.name.endsWith('.png'))) {
      baseBlob = character.originalFile;
    }

    const sendAsJson = !baseBlob && !localBuffer;
    
    setIsSendingToST(true);
    setStFeedback(null);
    try {
      const authHeaders = getSillyTavernAuthHeaders(aiSettings);

      let csrf = "";
      try {
        const csrfRes = await fetch(`${stUrl}/csrf-token`, { headers: authHeaders });
        if (csrfRes.ok) {
          const csrfData = await csrfRes.json().catch(() => ({}));
          csrf = csrfData.token || "";
        }
      } catch {}

      const doPush = async () => {
        const headers: Record<string, string> = { ...authHeaders };
        if (csrf) headers['X-CSRF-Token'] = csrf;
        if (sendAsJson) {
          const jsonStr = JSON.stringify(getNormalizedExportData(), null, 2);
          const jsonBlob = new Blob([jsonStr], { type: 'application/json' });
          const safeName = await getExportBaseName();
          return multipartPost(
            `${stUrl}/api/characters/import`,
            [{ name: 'file_type', value: 'json' }],
            { name: 'avatar', blob: jsonBlob, filename: `${safeName}.json` },
            headers,
          );
        }

        const buffer = localBuffer || await baseBlob!.arrayBuffer();
        const newBuffer = injectTavernData(buffer, getNormalizedExportData());
        const pngBlob = new Blob([newBuffer], { type: 'image/png' });
        return multipartPost(
          `${stUrl}/api/characters/import`,
          [{ name: 'file_type', value: 'png' }],
          { name: 'avatar', blob: pngBlob, filename: `${getSafeFilename(character.name)}.png` },
          headers,
        );
      };

      let res = await doPush();

      if (res.status === 403) {
        // CSRF token 过期/无效，刷新一次再试
        try {
          const csrfRes = await fetch(`${stUrl}/csrf-token`, { headers: authHeaders });
          if (csrfRes.ok) {
            const csrfData = await csrfRes.json().catch(() => ({}));
            csrf = csrfData.token || "";
          }
        } catch {}
        res = await doPush();
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }

      const responseText = await res.text().catch(() => '');
      try {
        const responseData = JSON.parse(responseText);
        if (responseData && responseData.error) {
          throw new Error('酒馆返回错误');
        }
      } catch (e) {
        // Not JSON or parse error, ignore
      }

      setStFeedback({ msg: '发送成功！', type: 'success' });
    } catch (err: any) {
      console.error(err);
      if (err.message.includes('Failed to fetch')) {
        setStFeedback({ msg: '已发送！(若酒馆未出现，请检查CORS设置)', type: 'success' });
      } else {
        setStFeedback({ msg: `发送失败: ${err.message}`, type: 'error' });
      }
    } finally {
      setIsSendingToST(false);
      setTimeout(() => setStFeedback(null), 3000);
    }
  };

  const handleDelete = async () => {
    await deleteCharacter(id);
    onBack();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      id="character-detail-scroll-container"
      onTouchStart={handleDetailTouchStart}
      onTouchEnd={handleDetailTouchEnd}
      className="fixed inset-0 bg-black text-white overflow-y-auto z-50"
    >
      {/* Blurred Background */}
      <div 
        className="fixed inset-0 bg-cover bg-center opacity-30 blur-3xl scale-110 [.light-theme_&]:opacity-40"
        style={{ backgroundImage: avatarUrl ? `url(${avatarUrl})` : undefined }}
      />
      
      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <header className="sticky top-0 p-4 pt-[max(1.75rem,env(safe-area-inset-top))] sm:pt-[max(1.75rem,env(safe-area-inset-top))] flex items-center justify-between bg-black/20 backdrop-blur-xl border-b border-white/10 z-20">
          <button onClick={handleBack} className="p-2 rounded-full hover:bg-white/10 transition">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div className="flex gap-2">
            {!isPreset && !isStandaloneWorldbook && !isTheme && (
              <button 
                onClick={handleSendToST} 
                className="p-2 rounded-full hover:bg-white/10 transition relative group" 
                title="发送到酒馆"
                disabled={isSendingToST}
              >
                {isSendingToST ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 text-blue-400 group-hover:text-blue-300" />}
              </button>
            )}
                        
            <button onClick={() => handleExportPng(true)} className="p-2 rounded-full hover:bg-white/10 transition" title={getDownloadTooltip("下载")}>
              <Download className="w-5 h-5" />
            </button>
            <button onClick={() => setShowDeleteConfirm(true)} className="p-2 rounded-full hover:bg-red-500/20 text-red-400 transition" title="删除">
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Alerts & Modals */}
        <AnimatePresence>
          {stFeedback && (
            <motion.div
              initial={{ opacity: 0, y: -20, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: -20, x: '-50%' }}
              className={`fixed top-20 left-1/2 px-4 py-3 rounded-xl text-sm shadow-xl z-[60] flex items-start sm:items-center gap-2 w-[90vw] sm:w-auto max-w-sm border ${
                stFeedback.type === 'success' 
                  ? 'bg-green-100 dark:bg-green-900 border-green-200 dark:border-green-800 text-green-800 dark:text-green-100' 
                  : 'bg-red-100 dark:bg-red-900 border-red-200 dark:border-red-800 text-red-800 dark:text-red-100'
              }`}
            >
              {stFeedback.type === 'success' ? <Check className="w-5 h-5 shrink-0 mt-0.5 sm:mt-0" /> : <XIcon className="w-5 h-5 shrink-0 mt-0.5 sm:mt-0" />}
              <span className="flex-1 break-words">{stFeedback.msg}</span>
            </motion.div>
          )}
          {showExportAlert && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="fixed top-20 left-1/2 -translate-x-1/2 bg-yellow-500/20 border border-yellow-500/50 text-yellow-200 px-4 py-2 rounded-full text-sm backdrop-blur-md z-50 flex items-center gap-2 shadow-xl"
            >
              <span>未找到原始 PNG 文件，已导出为 JSON。</span>
              <button onClick={() => setShowExportAlert(false)} className="ml-2 hover:text-white">✕</button>
            </motion.div>
          )}

          {showDeleteConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ scale: 0.95 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.95 }}
                className="bg-slate-900 border border-white/10 rounded-2xl p-6 max-w-sm w-full shadow-2xl"
              >
                <h3 className="text-xl font-bold mb-2">删除角色？</h3>
                <p className="text-slate-400 mb-6">确定要将 {character.name} 移至回收站吗？</p>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 hover:text-white transition"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleDelete}
                    className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white transition shadow-lg shadow-red-500/20"
                  >
                    删除
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Avatar & Name */}
        <div className="flex flex-col items-center pt-8 pb-6 px-4">
          <img
            src={avatarUrl || getFallbackAvatar(character.name || character.id, character.tags?.join(',') || (character.isTool ? 'tool' : undefined))}
            alt={character.name}
            onClick={() => setShowAvatarViewer(true)}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              if (character.avatarBlob) {
                  const blobUrl = URL.createObjectURL(character.avatarBlob);
                  if (target.src !== blobUrl && !target.src.startsWith('blob:')) {
                      target.src = blobUrl;
                      setAvatarUrl(blobUrl);
                      return;
                  }
              }
              const fallback = getFallbackAvatar(character.name || character.id, character.tags?.join(',') || (character.isTool ? 'tool' : undefined));
              if (target.src !== fallback) {
                 target.src = fallback;
                 setAvatarUrl(fallback);
              }
            }}
            className="w-32 h-32 rounded-full object-cover border-4 border-white/20 shadow-2xl cursor-pointer hover:scale-105 transition-transform"
          />
          {isEditingName ? (
            <div className="flex items-center gap-2 mt-4">
              <input
                type="text"
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleNameSave();
                  if (e.key === 'Escape') {
                    setIsEditingName(false);
                    setEditNameValue(character.name);
                  }
                }}
                className="bg-black/40 border border-white/20 rounded-lg px-3 py-1 text-xl sm:text-2xl font-bold text-center w-full max-w-[200px] focus:outline-none focus:border-purple-500"
                autoFocus
              />
              <button 
                onClick={handleNameSave}
                className="p-1.5 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition"
              >
                <Check className="w-5 h-5" />
              </button>
              <button 
                onClick={() => {
                  setIsEditingName(false);
                  setEditNameValue(character.name);
                }}
                className="p-1.5 bg-white/10 text-white/60 rounded-lg hover:bg-white/20 transition"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 mt-4 w-full px-4">
              <h1 className="text-2xl sm:text-3xl font-bold text-center break-words max-w-full">{character.name}</h1>
              <button 
                onClick={() => setIsEditingName(true)}
                className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition shrink-0"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            </div>
          )}
          <p className="text-white/60 text-sm mt-1">v{data.character_version || '1.0'} • {data.creator || 'Unknown Creator'}</p>
          
          {/* Metadata Drawer */}
          <div className="w-full max-w-md mt-4">
            <button
              onClick={() => setIsMetadataOpen(!isMetadataOpen)}
              className="w-full flex items-center justify-center gap-2 py-2 text-white/50 hover:text-white/80 transition-colors"
            >
              <div className="h-1 w-12 bg-white/20 rounded-full" />
            </button>
            <AnimatePresence>
              {isMetadataOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: 'spring', bounce: 0.3, duration: 0.5 }}
                  className="overflow-hidden"
                >
                  <div className="bg-black/40 backdrop-blur-md rounded-2xl p-4 mt-2 border border-white/5 space-y-3 shadow-inner">
                    <div className="flex flex-col gap-1 items-center text-center">
                      <div className="text-xs text-white/40 font-medium uppercase tracking-wider">
                        导入时间 (IMPORTED)
                      </div>
                      <div className="text-sm text-white/80 font-mono">
                        {new Date(character?.createdAt || Date.now()).toLocaleString()}
                      </div>
                    </div>

                    <div className="flex flex-col gap-1 items-center text-center">
                      <div className="text-xs text-white/40 font-medium uppercase tracking-wider">
                        本地修改时间 (MODIFIED)
                      </div>
                      <div className="text-sm text-white/80 font-mono">
                        {character?.originalFile?.lastModified ? new Date(character.originalFile.lastModified).toLocaleString() : '未知'}
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-white/40 font-medium uppercase tracking-wider flex items-center gap-1">
                          作者 (CREATOR)
                        </div>
                        <button onClick={() => {
                          if (isEditingCreator) {
                            handleUpdateCreator(tempCreator);
                          } else {
                            setTempCreator(data.creator || '');
                            setIsEditingCreator(true);
                          }
                        }}>
                          {isEditingCreator ? <Check className="w-3 h-3 text-green-400"/> : <Edit2 className="w-3 h-3 text-white/40 hover:text-white"/>}
                        </button>
                      </div>
                      {isEditingCreator ? (
                        <div className="flex items-center gap-2">
                          <input 
                            value={tempCreator} 
                            onChange={e => setTempCreator(e.target.value)} 
                            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-purple-500/50"
                            placeholder="作者名称"
                            autoFocus
                            onKeyDown={e => e.key === 'Enter' && handleUpdateCreator(tempCreator)}
                          />
                          <button onClick={() => handleUpdateCreator(tempCreator)} className="p-2 bg-green-500/20 text-green-400 rounded-xl hover:bg-green-500/30 transition shrink-0">
                            <Check className="w-4 h-4" />
                          </button>
                          <button onClick={() => setIsEditingCreator(false)} className="p-2 bg-white/10 text-white/60 rounded-xl hover:bg-white/20 transition shrink-0">
                            <XIcon className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="bg-white/5 rounded-xl px-3 py-2 text-sm text-white/80 min-h-[36px] flex items-center">
                          {data.creator || <span className="text-white/30">未知作者</span>}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-white/40 font-medium uppercase tracking-wider flex items-center gap-1">
                          版本 (VERSION)
                        </div>
                        <button onClick={() => {
                          if (isEditingVersion) {
                            handleUpdateVersion(tempVersion);
                          } else {
                            setTempVersion(data.character_version || '');
                            setIsEditingVersion(true);
                          }
                        }}>
                          {isEditingVersion ? <Check className="w-3 h-3 text-green-400"/> : <Edit2 className="w-3 h-3 text-white/40 hover:text-white"/>}
                        </button>
                      </div>
                      {isEditingVersion ? (
                        <div className="flex items-center gap-2">
                          <input 
                            value={tempVersion} 
                            onChange={e => setTempVersion(e.target.value)} 
                            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-purple-500/50"
                            placeholder="例如: 1.0"
                            autoFocus
                            onKeyDown={e => e.key === 'Enter' && handleUpdateVersion(tempVersion)}
                          />
                          <button onClick={() => handleUpdateVersion(tempVersion)} className="p-2 bg-green-500/20 text-green-400 rounded-xl hover:bg-green-500/30 transition shrink-0">
                            <Check className="w-4 h-4" />
                          </button>
                          <button onClick={() => setIsEditingVersion(false)} className="p-2 bg-white/10 text-white/60 rounded-xl hover:bg-white/20 transition shrink-0">
                            <XIcon className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="bg-white/5 rounded-xl px-3 py-2 text-sm text-white/80 min-h-[36px] flex items-center">
                          {data.character_version || <span className="text-white/30">1.0</span>}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-white/40 font-medium uppercase tracking-wider flex items-center gap-1">
                          标签 (TAGS)
                        </div>
                        <button onClick={() => {
                          if (isEditingTags) {
                            handleUpdateTags(tempTags);
                          } else {
                            setTempTags((data.tags || []).join(', '));
                            setIsEditingTags(true);
                          }
                        }}>
                          {isEditingTags ? <Check className="w-3 h-3 text-green-400"/> : <Edit2 className="w-3 h-3 text-white/40 hover:text-white"/>}
                        </button>
                      </div>
                      {isEditingTags ? (
                        <div className="flex items-center gap-2">
                          <input 
                            value={tempTags} 
                            onChange={e => {
                              // If user typed a space, replace it with a comma and space
                              const val = e.target.value;
                              if (val.endsWith(' ') && !val.endsWith(', ')) {
                                setTempTags(val.slice(0, -1) + ', ');
                              } else {
                                setTempTags(val);
                              }
                            }} 
                            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-purple-500/50"
                            placeholder="输入标签，用逗号或空格分隔"
                            autoFocus
                            onKeyDown={e => e.key === 'Enter' && handleUpdateTags(tempTags)}
                          />
                          <button onClick={() => handleUpdateTags(tempTags)} className="p-2 bg-green-500/20 text-green-400 rounded-xl hover:bg-green-500/30 transition shrink-0">
                            <Check className="w-4 h-4" />
                          </button>
                          <button onClick={() => setIsEditingTags(false)} className="p-2 bg-white/10 text-white/60 rounded-xl hover:bg-white/20 transition shrink-0">
                            <XIcon className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="bg-white/5 rounded-xl px-3 py-2 text-sm text-white/80 min-h-[36px] flex flex-wrap gap-1">
                          {data.tags && data.tags.length > 0 ? (
                            data.tags.map((tag: string, i: number) => (
                              <span key={i} className="bg-white/10 px-2 py-0.5 rounded-md text-xs">{tag}</span>
                            ))
                          ) : (
                            <span className="text-white/30">无标签</span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-white/40 font-medium uppercase tracking-wider flex items-center gap-1">
                          来源链接 (SOURCE)
                        </div>
                        <button onClick={() => {
                          if (isEditingSource) {
                            handleUpdateSource(tempSource);
                          } else {
                            setTempSource(data.extensions?.source || data.source || '');
                            setIsEditingSource(true);
                          }
                        }}>
                          {isEditingSource ? <Check className="w-3 h-3 text-green-400"/> : <Edit2 className="w-3 h-3 text-white/40 hover:text-white"/>}
                        </button>
                      </div>
                      {isEditingSource ? (
                        <div className="flex items-center gap-2">
                          <input 
                            value={tempSource} 
                            onChange={e => setTempSource(e.target.value)} 
                            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-purple-500/50"
                            placeholder="https://..."
                            autoFocus
                            onKeyDown={e => e.key === 'Enter' && handleUpdateSource(tempSource)}
                          />
                          <button onClick={() => handleUpdateSource(tempSource)} className="p-2 bg-green-500/20 text-green-400 rounded-xl hover:bg-green-500/30 transition shrink-0">
                            <Check className="w-4 h-4" />
                          </button>
                          <button onClick={() => setIsEditingSource(false)} className="p-2 bg-white/10 text-white/60 rounded-xl hover:bg-white/20 transition shrink-0">
                            <XIcon className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="bg-white/5 rounded-xl px-3 py-2 text-sm text-white/80 min-h-[36px] truncate flex items-center justify-between">
                          {data.extensions?.source || data.source ? (
                            <a 
                              href={data.extensions?.source || data.source} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1 truncate"
                            >
                              <ExternalLink className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">{data.extensions?.source || data.source}</span>
                            </a>
                          ) : (
                            <span className="text-white/30">无链接</span>
                          )}
                        </div>
                      )}
                    </div>

                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Tabs */}
        <div className="sticky top-[72px] z-20 -mx-4 px-4 py-3 mb-4">
          <div className="flex gap-2 overflow-x-auto hide-scrollbar">
          {(isSpecialData ? [
             { id: 'data_viewer', icon: User, label: '数据详情' },
          ] : [
            ...(!isStandaloneWorldbook ? [
              { id: 'profile', icon: User, label: isPreset ? '预设条目' : '档案' },
            ] : []),
            ...(!isPreset && !isStandaloneWorldbook ? [
              { id: 'greetings', icon: MessageSquare, label: '开场白' },
            ] : []),
            ...(!isPreset ? [
              { id: 'worldbook', icon: Book, label: '世界书' },
            ] : []),
            ...(!isPreset && !isStandaloneWorldbook ? [
              { id: 'regex', icon: Edit2, label: '正则替换' },
            ] : []),
            ...(!isPreset && !isStandaloneWorldbook ? [
              { id: 'chats', icon: MessageSquare, label: '聊天记录' },
            ] : []),
            ...(!isPreset && !isStandaloneWorldbook ? [
              { id: 'memos', icon: StickyNote, label: '备忘录' },
            ] : []),
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-white/20 text-white border border-white/30 [.light-theme_&]:bg-blue-500/10 [.light-theme_&]:text-[#007aff] [.light-theme_&]:border-blue-500/20 [.light-theme_&]:shadow-sm'
                  : 'bg-white/5 text-white/60 hover:bg-white/10 border border-transparent [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:bg-blue-500/5'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
          </div>
        </div>

        {/* Content Area - Glassmorphism Card */}
        <div className="flex-1 px-2 sm:px-4 pb-32">
          <div className="bg-black/40 backdrop-blur-2xl border border-white/10 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-2xl min-h-[50vh] [.light-theme_&]:bg-[#FCFCFC]/70 [.light-theme_&]:backdrop-blur-3xl [.light-theme_&]:border-black/5 [.light-theme_&]:shadow-xl">
            <AnimatePresence initial={false}>

              {activeTab === 'data_viewer' && (
                <motion.div
                  key="data_viewer"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="space-y-6"
                >
                  <div className="bg-[#0f111a] rounded-xl overflow-hidden border border-white/5">
                      <div className="p-4 border-b border-white/5 bg-black/20 flex items-center justify-between">
                          <h3 className="text-[15px] font-medium text-white/90">原生数据 (JSON)</h3>
                      </div>
                      <div className="p-4 overflow-auto max-h-[70vh] custom-scrollbar">
                          <pre className="text-[13px] text-slate-300 font-mono whitespace-pre-wrap break-all">
                              {(() => { try { const str = JSON.stringify(rawData, null, 2); if (str.length > 50000) { return str.substring(0, 50000) + "\n\n... (数据过大，为防止卡顿已截断显示，请使用导出功能查看完整内容)"; } return str; } catch (e) { return "无法解析此数据"; } })()}
                          </pre>
                      </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'profile' && (
                <motion.div
                  key="profile"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="space-y-6"
                >
                  {isPreset ? (
                    <div className="space-y-6">
                      {rawData.prompts && rawData.prompts.length > 0 && (
                        <div className="space-y-4">
                          <h3 className="text-lg font-semibold text-white/90 border-b border-white/10 pb-2">提示词条目 (Prompts)</h3>
                          {rawData.prompts.map((prompt: any, i: number) => (
                            <div key={i} className="mb-4">
                              <TextPreview title={prompt.name || prompt.identifier || `Prompt ${i+1}`} content={prompt.content || ''} />
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {rawData.system_prompt && <Section title="系统提示词 (System Prompt)" content={rawData.system_prompt} />}
                      {rawData.post_history_instructions && <Section title="历史后提示词 (Post History Instructions)" content={rawData.post_history_instructions} />}
                      
                      <div className="space-y-4">
                        <h3 className="text-lg font-semibold text-white/90 border-b border-white/10 pb-2">生成参数 (Generation Settings)</h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                          {rawData.temperature !== undefined && <div><span className="text-white/50">Temperature:</span> {rawData.temperature}</div>}
                          {rawData.top_p !== undefined && <div><span className="text-white/50">Top P:</span> {rawData.top_p}</div>}
                          {rawData.top_k !== undefined && <div><span className="text-white/50">Top K:</span> {rawData.top_k}</div>}
                          {rawData.rep_pen !== undefined && <div><span className="text-white/50">Rep Pen:</span> {rawData.rep_pen}</div>}
                          {rawData.presence_penalty !== undefined && <div><span className="text-white/50">Presence Pen:</span> {rawData.presence_penalty}</div>}
                          {rawData.frequency_penalty !== undefined && <div><span className="text-white/50">Frequency Pen:</span> {rawData.frequency_penalty}</div>}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Section title="描述 (Description)" content={data.description} onSave={(val) => updateField('description', val)} />
                      <Section title="性格 (Personality)" content={data.personality} onSave={(val) => updateField('personality', val)} />
                      <Section title="场景 (Scenario)" content={data.scenario} onSave={(val) => updateField('scenario', val)} />
                      <Section title="示例对话 (Mes Example)" content={data.mes_example} onSave={(val) => updateField('mes_example', val)} />
                      <Section title="作者备注 (Creator's Notes)" content={data.creator_notes} onSave={(val) => updateField('creator_notes', val)} />
                      <Section title="系统提示词 (System Prompt)" content={data.system_prompt} onSave={(val) => updateField('system_prompt', val)} />
                      <Section title="历史后提示词 (Post History Instructions)" content={data.post_history_instructions} onSave={(val) => updateField('post_history_instructions', val)} />
                      
                      {character && (
                        <QuickRepliesSection 
                          character={character} 
                          onUpdate={setCharacter} 
                        />
                      )}
                    </>
                  )}
                </motion.div>
              )}

              {activeTab === 'greetings' && (
                <motion.div
                  key="greetings"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="space-y-6"
                >
                  <Section title="首条消息" content={data.first_mes} onSave={(val) => updateField('first_mes', val)} />
                  
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-white/10 pb-2">
                      <h3 className="text-lg font-semibold text-white/90">备用开场白</h3>
                      <button 
                        onClick={() => setIsAddingAlternate(true)} 
                        className="text-purple-400 hover:text-purple-300 flex items-center gap-1 text-sm bg-purple-500/10 px-2 py-1 rounded-lg"
                      >
                        <Plus className="w-4 h-4" /> 添加
                      </button>
                    </div>
                    <div className="space-y-4">
                      {data.alternate_greetings && data.alternate_greetings.length > 0 ? (
                        data.alternate_greetings.map((msg: string, i: number) => (
                          <AlternateGreetingCard
                            key={i}
                            index={i}
                            content={msg}
                            onSave={(val) => {
                              const newGreetings = [...data.alternate_greetings];
                              newGreetings[i] = val;
                              updateField('alternate_greetings', newGreetings);
                            }}
                            onDelete={() => {
                              if (confirm('确定要删除这条备用开场白吗？')) {
                                 const newGreetings = data.alternate_greetings.filter((_: any, idx: number) => idx !== i);
                                 updateField('alternate_greetings', newGreetings);
                              }
                            }}
                          />
                        ))
                      ) : (
                        <p className="text-white/30 text-sm italic">暂无备用开场白</p>
                      )}
                    </div>
                  </div>

                  <FullScreenTextModal
                    isOpen={isAddingAlternate}
                    title="添加备用开场白"
                    content=""
                    onClose={() => setIsAddingAlternate(false)}
                    onSave={(val) => {
                      const newGreetings = [...(data.alternate_greetings || []), val];
                      updateField('alternate_greetings', newGreetings);
                      setIsAddingAlternate(false);
                    }}
                    initialEditMode={true}
                  />
                </motion.div>
              )}

              {activeTab === 'worldbook' && (
                <motion.div
                  key="worldbook"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                >
                  {(data.character_book || data.extensions?.character_book || rawData.entries) ? (
                    <WorldbookViewer 
                      book={data.character_book || data.extensions?.character_book || rawData} 
                      onUpdate={(newBook) => {
                        const updatedChar = { ...character };
                        
                        if (isStandaloneWorldbook) {
                          // Standalone worldbook
                          updatedChar.data = newBook;
                        } else {
                          // Embedded worldbook
                          let targetData = updatedChar.data.data ? updatedChar.data.data : updatedChar.data;
                          targetData.character_book = newBook;
                          targetData.extensions = { ...(targetData.extensions || {}), character_book: newBook };
                        }
                        
                        saveCharacter(updatedChar).then(() => setCharacter(updatedChar));
                      }}
                      onDelete={() => {
                        if (confirm('确定要删除整个世界书吗？此操作不可恢复。')) {
                          const updatedChar = { ...character };
                          
                          if (isStandaloneWorldbook) {
                            // Standalone worldbook - clear entries
                            updatedChar.data.entries = {};
                          } else {
                            let targetData = updatedChar.data.data ? updatedChar.data.data : updatedChar.data;
                            if (targetData.character_book) delete targetData.character_book;
                            if (targetData.extensions?.character_book) delete targetData.extensions.character_book;
                          }
                          
                          saveCharacter(updatedChar).then(() => setCharacter(updatedChar));
                        }
                      }}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-48 text-white/40">
                      <Book className="w-12 h-12 mb-2 opacity-50" />
                      <p>未包含世界书数据</p>
                      <div className="flex gap-3 mt-4">
                        <button 
                          onClick={() => {
                            const newBook = { name: '新世界书', description: '', entries: {} };
                            const updatedChar = { ...character };
                            let targetData = updatedChar.data.data ? updatedChar.data.data : updatedChar.data;
                            
                            targetData.character_book = newBook;
                            targetData.extensions = { ...(targetData.extensions || {}), character_book: newBook };
                            
                            saveCharacter(updatedChar).then(() => setCharacter(updatedChar));
                          }}
                          className="px-4 py-2 bg-purple-500/20 text-purple-300 rounded-lg hover:bg-purple-500/30 transition flex items-center gap-2"
                        >
                          <Plus className="w-4 h-4" /> 创建世界书
                        </button>
                        <label className="px-4 py-2 bg-blue-500/20 text-blue-300 rounded-lg hover:bg-blue-500/30 transition flex items-center gap-2 cursor-pointer">
                          <Upload className="w-4 h-4" /> 导入世界书
                          <input 
                            type="file" 
                            accept=".json" 
                            className="hidden" 
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              try {
                                const text = await new Promise<string>((resolve, reject) => {
                                  const reader = new FileReader();
                                  reader.onload = (e) => resolve(e.target?.result as string);
                                  reader.onerror = reject;
                                  reader.readAsText(file, "utf-8");
                                });
                                const json = JSON.parse(text);
                                
                                // Handle both array format and object format (like the provided example)
                                let entries: any = [];
                                let isV3 = false;
                                if (Array.isArray(json.entries)) {
                                  entries = json.entries;
                                } else if (json.entries && typeof json.entries === 'object') {
                                  entries = Array.isArray(json.entries) ? json.entries : (json.entries ? Object.values(json.entries) : []);
                                } else if (Array.isArray(json)) {
                                  entries = json;
                                } else if (json.data && json.data.entries) {
                                  // Handle Tavern V3 Worldbook format
                                  entries = Array.isArray(json.data.entries) ? json.data.entries : Object.values(json.data.entries);
                                  isV3 = true;
                                }

                                entries = normalizeWorldbookEntries(entries);

                                let newBook;
                                if (isV3) {
                                  newBook = { ...json, data: { ...json.data, entries: entries } };
                                } else {
                                  newBook = { 
                                    name: json.name || file.name.replace('.json', ''), 
                                    description: json.description || '', 
                                    entries: entries 
                                  };
                                }

                                const updatedChar = { ...character };
                                let targetData = updatedChar.data.data ? updatedChar.data.data : updatedChar.data;
                                
                                // Ensure we're setting it correctly
                                targetData.character_book = newBook;
                                if (!targetData.extensions) targetData.extensions = {};
                                targetData.extensions.character_book = newBook;
                                
                                await saveCharacter(updatedChar);
                                setCharacter(updatedChar);
                              } catch (err) {
                                alert('导入失败：不是有效的 JSON 文件');
                              }
                              e.target.value = '';
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'regex' && character && (
                <motion.div
                  key="regex"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                >
                  <CharacterRegexSection character={character} onUpdate={setCharacter} />
                </motion.div>
              )}

              {activeTab === 'chats' && character && (
                <CharacterChatsSection 
                   characterId={character.id} 
                   characterName={character.name} 
                   regexScripts={(character.data?.data?.extensions || character.data?.extensions || {}).regex_scripts || []} 
                   avatar={avatarUrl}
                   onOpenChat={onOpenChat}
                   onOpenImport={onOpenImport}
                   refreshKey={refreshKey}
                />
              )}

              {activeTab === 'memos' && character && (
                <CharacterMemosSection characterId={character.id} />
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {character && (
        <AvatarViewer
          isOpen={showAvatarViewer}
          character={character}
          onClose={() => setShowAvatarViewer(false)}
          onUpdate={(updatedCharacter) => {
            setCharacter(updatedCharacter);
            if (updatedCharacter.avatarBlob) {
              const url = URL.createObjectURL(updatedCharacter.avatarBlob);
              setAvatarUrl(url);
            } else if (updatedCharacter.localFilePath) {
              import('../lib/appBridge').then(({ getLocalImageUrl }) => {
                setAvatarUrl(getLocalImageUrl(updatedCharacter.localFilePath!, updatedCharacter.updatedAt || updatedCharacter.createdAt));
              });
            }
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('charactersUpdated'));
            }
          }}
        />
      )}
    </motion.div>
  );
});

function FullScreenTextModal({ 
  isOpen,
  title, 
  content, 
  onClose,
  onSave,
  initialEditMode = false
}: { 
  isOpen: boolean;
  title: string; 
  content: string; 
  onClose: () => void;
  onSave?: (val: string) => void;
  initialEditMode?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(initialEditMode);
  const [editValue, setEditValue] = useState(content);

  useBackHandler(isOpen, () => {
    onClose();
    return true;
  });

  const handleSave = () => {
    if (onSave) {
      onSave(editValue);
    }
    setIsEditing(false); // Only exit edit mode, modal stays open
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="full-screen-text-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex justify-center items-center p-4 sm:p-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 border border-white/10 shadow-2xl rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
          >
            <header className="px-5 py-4 flex items-center justify-between border-b border-white/10 bg-slate-800/50">
              <h2 className="text-lg font-bold truncate pr-4 text-white">{title}</h2>
              <div className="flex items-center gap-2">
                {onSave && (
                  isEditing ? (
                    <button onClick={handleSave} className="px-3 py-1.5 text-sm bg-purple-500 hover:bg-purple-600 text-white rounded-lg transition font-medium shadow-lg shadow-purple-500/20">
                      保存
                    </button>
                  ) : (
                    <button onClick={() => setIsEditing(true)} className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition">
                      <Edit2 className="w-4 h-4" />
                    </button>
                  )
                )}
                <button onClick={onClose} className="p-2 rounded-full hover:bg-red-500/20 text-white/60 hover:text-red-400 transition ml-2">
                  <XIcon className="w-5 h-5" />
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-5 sm:p-6 custom-scrollbar bg-slate-900">
              {isEditing ? (
                <textarea 
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  className="w-full min-h-[300px] h-full bg-black/40 border border-white/20 rounded-xl p-4 text-white/90 text-sm sm:text-base leading-relaxed focus:outline-none focus:border-purple-500 resize-none font-sans"
                  autoFocus
                />
              ) : (
                <div className="text-white/90 whitespace-pre-wrap text-sm sm:text-base leading-relaxed break-words">
                  {content || <span className="text-white/30 italic">暂无内容</span>}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function TextPreview({ title, content, onSave, initialEditMode }: { title: string; content: string; onSave?: (val: string) => void; initialEditMode?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(initialEditMode || false);
  const [isEditing, setIsEditing] = useState(initialEditMode || false);
  const [editValue, setEditValue] = useState(content);

  const handleSave = () => {
    if (onSave) {
      onSave(editValue);
    }
    setIsEditing(false);
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    if (!isExpanded) setIsExpanded(true);
  };

  if (!isExpanded && !isEditing) {
    return (
      <div 
        onClick={() => setIsExpanded(true)}
        className="group relative cursor-pointer bg-white/5 hover:bg-white/10 p-3 rounded-xl border border-white/10 transition-colors w-full overflow-hidden"
      >
        <div className="text-white/70 text-sm line-clamp-3 pr-8 break-words w-full">
          {content ? (content.length > 50000 ? content.substring(0, 50000) + "...(过长已截断)" : content) : <span className="text-white/30 italic">空内容...</span>}
        </div>
        <div className="mt-1.5 text-purple-400 text-xs font-medium flex justify-between items-center opacity-80 group-hover:opacity-100 transition-opacity">
          <span className="flex items-center gap-1">展开全文 <ChevronDown className="w-3 h-3" /></span>
        </div>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="bg-white/5 p-4 rounded-xl border border-white/10 flex flex-col relative w-full mb-2"
    >
      <div className="flex justify-between items-center mb-3">
        <div className="text-sm font-medium text-white/50">{title}</div>
        <div className="flex gap-2">
          {isEditing ? (
             <button onClick={handleSave} className="text-green-400 hover:bg-green-400/10 p-1.5 rounded-lg text-xs font-medium transition cursor-pointer">
               保存
             </button>
          ) : (
            onSave && (
              <button 
                onClick={handleEdit}
                className="text-white/60 hover:text-white hover:bg-white/10 p-1.5 rounded-lg transition cursor-pointer"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            )
          )}
        </div>
      </div>
      
      {isEditing ? (
        <textarea 
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          className="w-full bg-black/40 border border-white/20 rounded-xl p-3 text-white/90 text-sm sm:text-base leading-relaxed focus:outline-none focus:border-purple-500 min-h-[300px] resize-none"
          autoFocus
        />
      ) : (
        <div className="text-white/90 whitespace-pre-wrap text-sm sm:text-base leading-relaxed max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar break-words w-full">
          {content}
        </div>
      )}

      <button 
        onClick={() => { setIsExpanded(false); setIsEditing(false); }}
        className="mt-3 flex items-center justify-center gap-1 text-purple-400 text-sm font-medium py-1.5 hover:bg-white/5 rounded-lg transition w-full cursor-pointer"
      >
        <ChevronUp className="w-4 h-4" /> 收起 
      </button>
    </motion.div>
  );
}

function AlternateGreetingCard({ index, content, onSave, onDelete }: { key?: string | number; index: number; content: string; onSave: (val: string) => void; onDelete: () => void }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(content);

  const handleSave = () => {
    onSave(editValue);
    setIsEditing(false);
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    if (!isExpanded) setIsExpanded(true);
  };

  return (
    <div className="bg-white/5 p-3 rounded-xl border border-white/10 flex flex-col gap-2 transition-opacity hover:bg-white/10 mb-2">
      <div className="flex flex-wrap sm:flex-nowrap justify-between items-start gap-2 mb-1">
        <div className="flex flex-col min-w-0 flex-1">
          <h4 className="font-semibold text-purple-300 truncate">
            备用开场白 {index + 1}
          </h4>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
          {isExpanded && !isEditing && (
            <button onClick={handleEdit} className="p-1 hover:bg-white/10 rounded text-white/60 hover:text-white transition">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          )}
          {isEditing && (
            <button onClick={handleSave} className="p-1 hover:bg-green-500/20 rounded text-green-400 transition">
              <Check className="w-4 h-4" />
            </button>
          )}
          <button onClick={onDelete} className="p-1 hover:bg-red-500/20 rounded text-white/60 hover:text-red-400 transition">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      
      {!isExpanded && !isEditing ? (
        <div 
          className="group cursor-pointer w-full"
          onClick={() => setIsExpanded(true)}
        >
          <div className="text-white/70 text-sm line-clamp-3 break-words w-full">
            {content ? (content.length > 50000 ? content.substring(0, 50000) + "...(过长已截断)" : content) : <span className="text-white/30 italic">空内容...</span>}
          </div>
          <div className="mt-1.5 text-purple-400 text-xs font-medium flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
            <span>展开全文</span>
            <ChevronDown className="w-3 h-3" />
          </div>
        </div>
      ) : (
        <motion.div 
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="w-full flex flex-col"
        >
          {isEditing ? (
            <textarea 
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              className="w-full bg-black/40 border border-white/20 rounded-xl p-3 text-white/90 text-sm sm:text-base leading-relaxed focus:outline-none focus:border-purple-500 min-h-[200px] resize-none"
              autoFocus
            />
          ) : (
            <div className="text-white/90 whitespace-pre-wrap text-sm sm:text-base leading-relaxed max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar break-words w-full">
              {content}
            </div>
          )}
          <button 
            onClick={() => { setIsExpanded(false); setIsEditing(false); }}
            className="mt-3 flex items-center justify-center gap-1 text-purple-400 text-sm font-medium py-1.5 hover:bg-white/5 rounded-lg transition w-full cursor-pointer"
          >
            <ChevronUp className="w-4 h-4" /> 收起 
          </button>
        </motion.div>
      )}
    </div>
  );
}


function Section({ title, content, onSave }: { title: string; content?: string; onSave?: (val: string) => void }) {
  const [isAdding, setIsAdding] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-3">
        <h3 className="text-lg font-semibold text-white/90">{title}</h3>
        {(!content || content.trim() === '') && onSave && (
          <button onClick={() => setIsAdding(true)} className="text-purple-400 hover:text-purple-300 flex items-center gap-1 text-sm bg-purple-500/10 px-2 py-1 rounded-lg transition">
            <Plus className="w-4 h-4" /> 添加
          </button>
        )}
      </div>
      {content && content.trim() !== '' ? (
        <TextPreview title={title} content={content} onSave={onSave} />
      ) : (
        <p className="text-white/30 text-sm italic">暂无内容</p>
      )}

      <FullScreenTextModal
        isOpen={isAdding}
        title={`添加 ${title}`}
        content=""
        onClose={() => setIsAdding(false)}
        onSave={(val) => {
          if (onSave) onSave(val);
          setIsAdding(false);
        }}
        initialEditMode={true}
      />
    </div>
  );
}


export function WorldbookViewer({ book, onUpdate, onDelete }: { book: any; onUpdate: (newBook: any) => void; onDelete: () => void }) {
  const [showControls, setShowControls] = useState(false);
  const [viewingEntryIndex, setViewingEntryIndex] = useState<number | null>(null);
  const [editingEntryIndex, setEditingEntryIndex] = useState<number | null>(null);
  const [editingEntry, setEditingEntry] = useState<any>(null);

  useBackHandler(editingEntryIndex !== null, () => {
    setEditingEntryIndex(null);
    setEditingEntry(null);
    return true;
  });

  const entries = book.entries ? (Array.isArray(book.entries) ? book.entries : Object.values(book.entries)) : [];

  const handleAdd = () => {
    setEditingEntry({ keys: [], content: '', name: '', comment: '', order: 100, constant: false, selective: true, extensions: { position: 1 } });
    setEditingEntryIndex(-1);
  };

    const handleToggleEnable = (i: number) => {
    const newEntries = [...entries];
    const entry = { ...newEntries[i] };
    const currentlyEnabled = entry.disable !== undefined ? !entry.disable : entry.enabled !== false;
    entry.enabled = !currentlyEnabled;
    entry.disable = currentlyEnabled;
    newEntries[i] = entry;
    const newBook = { ...book };
    if (Array.isArray(book.entries)) {
       newBook.entries = newEntries;
    } else {
       const obj: any = {};
       newEntries.forEach((e: any, idx: number) => { obj[String(idx)] = { ...e, uid: e.uid !== undefined ? e.uid : idx }; });
       newBook.entries = obj;
    }
    onUpdate(newBook);
  };

  const handleEdit = (i: number) => {
    setEditingEntry({ ...entries[i] });
    setEditingEntryIndex(i);
  };

  const handleDelete = (i: number) => {
    if (confirm('确定要删除此世界书条目吗？')) {
      const newEntries = [...entries];
      newEntries.splice(i, 1);
      const newBook = { ...book };
      if (Array.isArray(book.entries)) {
         newBook.entries = newEntries;
      } else {
         const obj: any = {};
         newEntries.forEach((e: any, idx: number) => { obj[String(idx)] = { ...e, uid: e.uid !== undefined ? e.uid : idx }; });
         newBook.entries = obj;
      }
      onUpdate(newBook);
    }
  };

  const saveEntry = () => {
    const newEntries = [...entries];
    if (editingEntryIndex === -1) {
      newEntries.push(editingEntry);
    } else {
      newEntries[editingEntryIndex!] = editingEntry;
    }
    const newBook = { ...book };
    if (Array.isArray(book.entries)) {
       newBook.entries = newEntries;
    } else {
       const obj: any = {};
       newEntries.forEach((e: any, idx: number) => { obj[String(idx)] = { ...e, uid: e.uid !== undefined ? e.uid : idx }; });
       newBook.entries = obj;
    }
    onUpdate(newBook);
    setEditingEntryIndex(null);
    setEditingEntry(null);
  };

  const renderEditForm = () => {
    return createPortal(
      <AnimatePresence>
        {editingEntryIndex !== null && (
          <motion.div
            key="worldbook-edit-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex justify-center items-center p-4 sm:p-6 [.light-theme_&]:bg-black/40"
            onClick={() => {
              setEditingEntryIndex(null);
              setEditingEntry(null);
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
              className="bg-slate-900 flex flex-col w-full max-h-[85vh] border border-white/10 rounded-2xl shadow-2xl max-w-3xl overflow-hidden [.light-theme_&]:bg-[#FCFCFC] [.light-theme_&]:border-black/5"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex-none p-4 sm:p-6 border-b border-white/10 flex items-center justify-between bg-black/20 [.light-theme_&]:border-black/5 [.light-theme_&]:bg-black/5">
                <h3 className="text-lg font-semibold text-white [.light-theme_&]:text-[#1c1c1e]">
                  {editingEntryIndex === -1 ? '新增世界书条目' : '编辑世界书条目'}
                </h3>
                <button 
                  onClick={() => {
                    setEditingEntryIndex(null);
                    setEditingEntry(null);
                  }} 
                  className="p-1 hover:bg-white/10 rounded-full text-white/60 hover:text-white transition [.light-theme_&]:hover:bg-black/10 [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:text-[#1c1c1e]"
                >
                  <XIcon className="w-5 h-5" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1 [.light-theme_&]:text-[#1c1c1e]">标题 / 注释 (可选)</label>
                  <input 
                    type="text" 
                    value={editingEntry.comment || editingEntry.name || ''}
                    onChange={(e) => setEditingEntry({...editingEntry, comment: e.target.value, name: e.target.value})}
                    className="w-full bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-purple-500 transition [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10 [.light-theme_&]:text-[#1c1c1e]"
                    placeholder="条目的标题，不影响匹配"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1 [.light-theme_&]:text-[#1c1c1e]">关键词 (逗号分隔)</label>
                  <input 
                    type="text" 
                    value={(editingEntry.keys || []).join(', ')}
                    onChange={(e) => setEditingEntry({...editingEntry, keys: e.target.value.split(',').map((k: string)=>k.trim()).filter((k: string)=>k)})}
                    className="w-full bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-purple-500 transition [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10 [.light-theme_&]:text-[#1c1c1e]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-1 [.light-theme_&]:text-[#1c1c1e]">插入顺序 (Order)</label>
                    <input 
                      type="number" 
                      value={editingEntry.order ?? 100}
                      onChange={(e) => setEditingEntry({...editingEntry, order: parseInt(e.target.value) || 0})}
                      className="w-full bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-purple-500 transition [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10 [.light-theme_&]:text-[#1c1c1e]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-1 [.light-theme_&]:text-[#1c1c1e]">插入位置 (Position)</label>
                    <select
                      value={editingEntry.extensions?.position ?? editingEntry.position ?? 1}
                      onChange={(e) => setEditingEntry({...editingEntry, extensions: {...(editingEntry.extensions || {}), position: parseInt(e.target.value)}})}
                      className="w-full bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-purple-500 transition [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10 [.light-theme_&]:text-[#1c1c1e]"
                    >
                      <option value={0}>0 - 角色设定前 (Before Char Def)</option>
                      <option value={1}>1 - 角色设定后 (After Char Def)</option>
                      <option value={2}>2 - 示例对话前 (Before Example Msgs)</option>
                      <option value={3}>3 - 示例对话后 (After Example Msgs)</option>
                      <option value={4}>4 - 深度插入 (At Depth)</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-6 pb-2">
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-white/70 [.light-theme_&]:text-[#1c1c1e]">
                    <input 
                      type="checkbox"
                      checked={!!editingEntry.constant}
                      onChange={(e) => setEditingEntry({...editingEntry, constant: e.target.checked})}
                      className="rounded bg-black/30 border-white/10 text-purple-500 focus:ring-purple-500/20 [.light-theme_&]:bg-white [.light-theme_&]:border-black/20"
                    />
                    常驻激活 (Constant)
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-white/70 [.light-theme_&]:text-[#1c1c1e]">
                    <input 
                      type="checkbox"
                      checked={editingEntry.selective !== false}
                      onChange={(e) => setEditingEntry({...editingEntry, selective: e.target.checked})}
                      className="rounded bg-black/30 border-white/10 text-purple-500 focus:ring-purple-500/20 [.light-theme_&]:bg-white [.light-theme_&]:border-black/20"
                    />
                    条件触发 (Selective)
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1 [.light-theme_&]:text-[#1c1c1e]">内容</label>
                  <textarea 
                    value={editingEntry.content || editingEntry.entry || ''}
                    onChange={(e) => setEditingEntry({...editingEntry, content: e.target.value, entry: e.target.value})}
                    className="w-full bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-purple-500 transition min-h-[150px] resize-none [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10 [.light-theme_&]:text-[#1c1c1e]"
                  />
                </div>
              </div>

              <div className="flex-none p-4 sm:p-6 border-t border-white/10 bg-black/20 flex justify-end gap-3 [.light-theme_&]:border-black/5 [.light-theme_&]:bg-black/5">
                <button 
                  onClick={() => {
                    setEditingEntryIndex(null);
                    setEditingEntry(null);
                  }} 
                  className="px-4 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:text-[#1c1c1e] [.light-theme_&]:hover:bg-black/10"
                >
                  取消
                </button>
                <button onClick={saveEntry} className="px-6 py-2 rounded-lg bg-purple-500 text-white hover:bg-purple-600 transition flex items-center gap-2 shadow-lg shadow-purple-500/20">
                  保存
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
    );
  };

  return (
    <div className="flex flex-col gap-4 w-full h-full relative">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">
            {book.name || (book.data && book.data.name) || 'Worldbook'}
          </h2>
          <p className="text-sm text-white/60">
            {book.description || (book.data && book.data.description) || '包含世界观、设定和背景信息'}
          </p>
        </div>
        <div className="flex items-center gap-2">

          
          <button 
            onClick={async () => {
              let exportData = book;
              if (book.entries && Array.isArray(book.entries)) {
                exportData = { ...book, entries: {} };
                const normalizedEntries = normalizeWorldbookEntries(book.entries);
                normalizedEntries.forEach((e: any, i: number) => {
                  exportData.entries[String(i)] = { ...e, uid: e.uid !== undefined ? e.uid : i };
                });
              } else if (book.entries && typeof book.entries === 'object') {
                exportData = { ...book, entries: {} };
                const normalizedEntries = normalizeWorldbookEntries(book.entries);
                normalizedEntries.forEach((e: any, i: number) => {
                  exportData.entries[String(i)] = { ...e, uid: e.uid !== undefined ? e.uid : i };
                });
              }
              const jsonStr = JSON.stringify(exportData, null, 2);
              const safeName = (book.name || (book.data && book.data.name) || 'worldbook').replace(/[^a-zA-Z0-9_\u4e00-\u9fa5\-]/g, '_');
              const exportFileName = `${safeName}.json`;
              const bytes = new TextEncoder().encode(jsonStr);
              await downloadOrShareFile(exportFileName, bytes.buffer, 'application/json', true);
            }}
            className="p-2 rounded-full bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition"
            title={getDownloadTooltip("导出世界书")}
          >
            <Download className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setShowControls(!showControls)}
            className={`p-2 rounded-full transition ${showControls ? 'bg-purple-500 text-white' : 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30'}`}
            title="管理世界书"
          >
            <Edit2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showControls && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex gap-3 overflow-hidden mb-4"
          >
            <button 
              onClick={handleAdd}
              className="flex-1 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" /> 添加条目
            </button>
            <button 
              onClick={onDelete}
              className="flex-1 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm font-medium transition flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" /> 删除世界书
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      
      <div className="space-y-3">
        {entries.length === 0 ? (
          <p className="text-center text-white/40 py-8">暂无条目。</p>
        ) : (
          entries.map((entry: any, i: number) => {
            const isEnabled = entry.disable !== undefined ? !entry.disable : entry.enabled !== false;
            const keysArray = entry.key || entry.keys || [];
            const keysDisplay = Array.isArray(keysArray) ? keysArray.join(', ') : keysArray;
            const title = entry.comment || entry.name || keysDisplay || '无标题';
            const order = entry.order !== undefined ? entry.order : (entry.insertion_order || 50);

            return (
              <div key={i} className={`w-full bg-white/5 p-3 rounded-xl border ${isEnabled ? 'border-white/10' : 'border-white/5 opacity-60'} flex gap-3 transition-opacity overflow-hidden`}>
                <div className="flex-1 min-w-0 w-full">
                  <div className="flex flex-wrap sm:flex-nowrap justify-between items-start gap-2 mb-1 w-full">
                    <div className="flex flex-col min-w-0 flex-1">
                      <h4 className="font-semibold text-purple-300 truncate">
                        {title}
                      </h4>
                      {keysDisplay && keysDisplay !== title && (
                        <p className="text-xs text-white/40 truncate mt-0.5">
                          关键词: {keysDisplay}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                      <button
                        onClick={() => handleToggleEnable(i)}
                        className={`text-[10px] px-1.5 py-0.5 rounded-full transition whitespace-nowrap ${isEnabled ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/40'}`}
                      >
                        {isEnabled ? '已启用' : '已禁用'}
                      </button>
                      <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded-full text-white/60 whitespace-nowrap">
                        顺序: {order}
                      </span>
                      <button onClick={() => handleEdit(i)} className="p-1 hover:bg-white/10 rounded text-white/60 hover:text-white transition">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(i)} className="p-1 hover:bg-red-500/20 rounded text-white/60 hover:text-red-400 transition">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div 
                    className="group cursor-pointer mt-2 w-full"
                    onClick={() => setViewingEntryIndex(viewingEntryIndex === i ? null : i)}
                  >
                    {viewingEntryIndex === i ? (
                      <div className="text-white/90 whitespace-pre-wrap text-sm leading-relaxed pr-2 break-words w-full" onClick={e => e.stopPropagation()}>
                        {entry.content || entry.entry || ''}
                        <button 
                          onClick={(e) => { e.stopPropagation(); setViewingEntryIndex(null); }}
                          className="mt-3 flex items-center justify-center gap-1 text-purple-400 text-sm font-medium py-1.5 hover:bg-white/5 rounded-lg transition w-full cursor-pointer"
                        >
                          <ChevronUp className="w-4 h-4" /> 收起 
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="text-white/70 text-sm line-clamp-2 break-words w-full">{entry.content || entry.entry || ''}</div>
                        <div className="mt-1.5 text-purple-400 text-xs font-medium flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                          <span>展开全文</span>
                          <ChevronDown className="w-3 h-3" />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {renderEditForm()}
    </div>
  );
}
