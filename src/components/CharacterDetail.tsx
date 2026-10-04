import { getFallbackAvatar, resolveAvatarUrl } from '../lib/avatar';
import { useState, useEffect, useRef, memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Download, Trash2, Book, MessageSquare, User, StickyNote, ChevronRight, Plus, Edit2, Power, X as XIcon, ChevronDown, ChevronUp, ExternalLink, Check, Upload, Send, Loader2, Share2, Folder as FolderIcon, History, AlertCircle, Maximize2, BookOpen, Sparkles, FileJson, Image as ImageIcon, Save, Heart, RefreshCw, FileText } from 'lucide-react';
import { getCharacter, deleteCharacter, saveCharacter, toggleCharacterFavorite, CharacterCard, getFolders, resolveFolderPath, getCachedMeta, getCharacterCategoryPrefix, isActualCharacterCard } from '../lib/db';
import { getCardTypeBadgeInfo } from '../lib/cardType';
import { parseTavernCard } from '../types/tavern';
import { injectTavernData } from '../lib/png';
import { normalizeWorldbookEntries } from '../lib/worldbook';
import { getAISettings, normalizeSillyTavernUrl, getSillyTavernAuthHeaders } from '../lib/ai';
import { AvatarViewer } from './AvatarViewer';
import { GreetingReaderModal } from './GreetingReaderModal';
import { QuickRepliesSection } from './QuickRepliesSection';
import { CharacterRegexSection } from './CharacterRegexSection';
import { CharacterChatsSection } from './CharacterChatsSection';
import { CharacterMemosSection } from './CharacterMemosSection';
import { CharacterVersionsSection } from './CharacterVersionsSection';
import { MoveToFolderModal } from './MoveToFolderModal';
import { CharacterSummaryModal } from './CharacterSummaryModal';
import { TokenBreakdownModal } from './TokenBreakdownModal';
import { getCharacterTokenBreakdown, formatTokenCount } from '../lib/tokens';
import { FormattedCardContent } from './FormattedCardContent';
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
  isLightMode?: boolean;
}

// memo 化: 防止父组件里无关的状态变化(比如列表滚动位置、其他弹窗开关)
// 连带触发这个 1700+ 行的大组件整体重渲染。
export const CharacterDetail = memo(function CharacterDetail({ id, onBack, onOpenChat, onOpenImport, refreshKey, isLightMode: propIsLightMode }: Props) {
  const [character, setCharacter] = useState<CharacterCard | null>(null);
  const [activeTab, setActiveTab] = useState<'profile' | 'greetings' | 'worldbook' | 'regex' | 'chats' | 'memos' | 'versions' | 'data_viewer'>('profile');

  const [isLightMode, setIsLightMode] = useState(() => {
    if (typeof propIsLightMode === 'boolean') return propIsLightMode;
    return (
      document.documentElement.classList.contains('light-theme') ||
      localStorage.getItem('tavern_theme') === 'light'
    );
  });

  useEffect(() => {
    if (typeof propIsLightMode === 'boolean') {
      setIsLightMode(propIsLightMode);
      return;
    }
    const checkTheme = () => {
      setIsLightMode(
        document.documentElement.classList.contains('light-theme') ||
        localStorage.getItem('tavern_theme') === 'light'
      );
    };
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    window.addEventListener('storage', checkTheme);
    return () => {
      observer.disconnect();
      window.removeEventListener('storage', checkTheme);
    };
  }, [propIsLightMode]);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDownloadChoice, setShowDownloadChoice] = useState(false);
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
  const [showGreetingReader, setShowGreetingReader] = useState(false);
  const [greetingReaderInitialIndex, setGreetingReaderInitialIndex] = useState(0);
  const [greetingReaderEditMode, setGreetingReaderEditMode] = useState(false);

  const [avatarUrl, setAvatarUrl] = useState<string>('');
  const [resolvedModifiedDate, setResolvedModifiedDate] = useState<Date | null>(null);
  const [isMoveFolderOpen, setIsMoveFolderOpen] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [currentFolderPath, setCurrentFolderPath] = useState<string>('');
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (character?.folderId) {
      resolveFolderPath(character.folderId).then(setCurrentFolderPath);
    } else {
      setCurrentFolderPath('');
    }
  }, [character?.folderId]);

  const handleMoveFolder = async (targetFolderId: string | null) => {
    if (!character) return;
    const updated = {
      ...character,
      folderId: targetFolderId || undefined,
      updatedAt: Date.now(),
    };
    setCharacter(updated);
    setIsMoveFolderOpen(false);
    await saveCharacter(updated);
    if (targetFolderId) {
      resolveFolderPath(targetFolderId).then(setCurrentFolderPath);
    } else {
      setCurrentFolderPath('');
    }
    window.dispatchEvent(new CustomEvent('charactersUpdated'));
    setStFeedback({
      type: 'success',
      msg: targetFolderId ? '已移动到所选分类文件夹' : '已移至主页（未分类）',
    });
    setTimeout(() => setStFeedback(null), 2500);
  };

  const [showTokenBreakdownModal, setShowTokenBreakdownModal] = useState(false);
  const tokenBreakdown = useMemo(() => {
    return getCharacterTokenBreakdown(character);
  }, [character]);

  const hasDetailOverlay = Boolean(
    showTokenBreakdownModal ||
    showSummaryModal ||
    showGreetingReader ||
    isMoveFolderOpen ||
    showDeleteConfirm ||
    showDownloadChoice ||
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
    if (showSummaryModal) { setShowSummaryModal(false); return true; }
    if (showGreetingReader) { setShowGreetingReader(false); return true; }
    if (isMoveFolderOpen) { setIsMoveFolderOpen(false); return true; }
    if (isAddingAlternate) { setIsAddingAlternate(false); return true; }
    if (showAvatarViewer) { setShowAvatarViewer(false); return true; }
    if (showDeleteConfirm) { setShowDeleteConfirm(false); return true; }
    if (showDownloadChoice) { setShowDownloadChoice(false); return true; }
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

  // 关键修复：当角色详情打开时，必须全程拦截返回事件！
  // 1. 若内部有次级浮层/编辑态，先关闭浮层；
  // 2. 若无次级浮层，退出角色卡详情（返回列表），绝不穿透导致关闭所属文件夹或回到第 1 页！
  useBackHandler(true, () => {
    if (hasDetailOverlay) {
      return handleDetailBack();
    }
    handleBack();
    return true;
  });

  useEffect(() => {
    getCharacter(id).then(async (char) => {
      setCharacter(char);
      if (char) {
        const isActual = isActualCharacterCard(char.data || char);
        const category = isActual ? '未归类' : getCharacterCategoryPrefix(char);
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
        if (!isActual && char.data?.entries !== undefined) {
          setActiveTab('worldbook');
        }

        // Authenticate real modification time from file metadata / PNG chunks
        try {
          const { resolveCharacterModifiedTime } = await import('../lib/fileDate');
          let imgBuf: ArrayBuffer | null = null;
          if (char.avatarBlob) {
            try { imgBuf = await char.avatarBlob.arrayBuffer(); } catch (e) {}
          } else if (char.originalFile) {
            try { imgBuf = await char.originalFile.arrayBuffer(); } catch (e) {}
          } else if (char.localFilePath) {
            try {
              const { readLocalFileBuffer } = await import('../lib/appBridge');
              imgBuf = await readLocalFileBuffer(char.localFilePath);
            } catch (e) {}
          }

          const resolved = resolveCharacterModifiedTime(char, imgBuf);
          if (resolved) {
            setResolvedModifiedDate(new Date(resolved));
            if (!char.fileModifiedAt || char.fileModifiedAt !== resolved) {
              char.fileModifiedAt = resolved;
              saveCharacter(char).catch(console.error);
            }
          } else if (char.originalFile?.lastModified) {
            setResolvedModifiedDate(new Date(char.originalFile.lastModified));
          } else {
            setResolvedModifiedDate(null);
          }
        } catch (e) {
          if (char.originalFile?.lastModified) {
            setResolvedModifiedDate(new Date(char.originalFile.lastModified));
          }
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
      sourceUrl: sourceStr,
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

  const handleUpdateGreetings = async (newFirstMes: string, newAlternateGreetings: string[]) => {
    if (!character) return;
    const updatedChar = { ...character };
    let targetData = updatedChar.data.data ? updatedChar.data.data : updatedChar.data;
    targetData.first_mes = newFirstMes;
    targetData.alternate_greetings = newAlternateGreetings;
    targetData.extensions = targetData.extensions || {};
    targetData.extensions.alternate_greetings = newAlternateGreetings;

    const promise = saveCharacter(updatedChar);
    savePromiseRef.current = promise;
    await promise;
    setCharacter(updatedChar);
    window.dispatchEvent(new CustomEvent('charactersUpdated'));
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
  const isToolCard = isSpecialData || isStandaloneWorldbook || !isActualCharacterCard(rawData) || Boolean(getCardTypeBadgeInfo(character));

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
      isActualCharacterCard(exportData) ||
      category === '未归类' ||
      (!Array.isArray(exportData) &&
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
        ));
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

  const handleToggleFavorite = async () => {
    if (!character) return;
    try {
      const newFav = await toggleCharacterFavorite(character.id);
      setCharacter((prev) => prev ? { ...prev, isFavorite: newFav } : null);
    } catch (e) {
      console.error("Failed to toggle favorite:", e);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      id="character-detail-scroll-container"
      onTouchStart={handleDetailTouchStart}
      onTouchEnd={handleDetailTouchEnd}
      className="fixed inset-0 bg-black [.light-theme_&]:bg-[#eef4fe] text-white [.light-theme_&]:text-[#1c1c1e] overflow-y-auto z-50"
    >
      {/* Blurred Background - Beautifully adapted for both dark and light themes */}
      <div 
        className="fixed inset-0 bg-cover bg-center opacity-30 blur-3xl scale-110 pointer-events-none [.light-theme_&]:opacity-40 [.light-theme_&]:scale-125"
        style={{ backgroundImage: avatarUrl ? `url(${avatarUrl})` : undefined }}
      />
      <div 
        className="fixed inset-0 pointer-events-none bg-gradient-to-b from-black/20 via-transparent to-black/80 [.light-theme_&]:from-[#e8f1fd]/60 [.light-theme_&]:via-[#eef4fe]/40 [.light-theme_&]:to-[#e2eeff]/80"
      />
      
      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header - Real Pure White translucency glass in light theme and 20% in dark theme */}
        <header className="sticky top-0 p-4 pt-[max(1.75rem,env(safe-area-inset-top))] sm:pt-[max(1.75rem,env(safe-area-inset-top))] flex items-center justify-between bg-black/20 [.light-theme_&]:bg-white/70 backdrop-blur-xl border-b border-white/10 [.light-theme_&]:border-blue-100/70 z-20">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={handleBack} className="p-2 rounded-full hover:bg-white/10 [.light-theme_&]:hover:bg-black/5 text-white [.light-theme_&]:text-[#1c1c1e] transition shrink-0" title="返回">
              <ArrowLeft className="w-6 h-6" />
            </button>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* 收藏红心按钮 */}
            {character && (
              <button
                onClick={handleToggleFavorite}
                className="p-2 rounded-full hover:bg-white/10 [.light-theme_&]:hover:bg-black/5 transition relative group active:scale-90 cursor-pointer"
                title={character.isFavorite ? "取消收藏" : "收藏"}
              >
                <Heart
                  className={`w-5 h-5 transition-all duration-200 ${
                    character.isFavorite
                      ? "text-rose-500 fill-rose-500 scale-110 drop-shadow-[0_2px_8px_rgba(244,63,94,0.4)]"
                      : "text-white/70 hover:text-white [.light-theme_&]:text-[#1c1c1e] [.light-theme_&]:hover:text-rose-500"
                  }`}
                />
              </button>
            )}

            {!isPreset && !isStandaloneWorldbook && !isTheme && (
              <button 
                onClick={handleSendToST} 
                className="p-2 rounded-full hover:bg-white/10 [.light-theme_&]:hover:bg-black/5 transition relative group" 
                title="发送到酒馆"
                disabled={isSendingToST}
              >
                {isSendingToST ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5 text-blue-400 group-hover:text-blue-300 [.light-theme_&]:text-[#007aff]" />}
              </button>
            )}
                        
            <button onClick={() => setShowDownloadChoice(true)} className="p-2 rounded-full hover:bg-white/10 [.light-theme_&]:hover:bg-black/5 text-white [.light-theme_&]:text-[#1c1c1e] transition" title={getDownloadTooltip("下载")}>
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
              className={`fixed top-6 left-1/2 px-4 py-2.5 rounded-full text-xs sm:text-sm z-[60] flex items-center gap-2 max-w-[92vw] sm:max-w-md w-auto ios-toast pointer-events-auto ${
                stFeedback.type === 'success' ? 'ios-toast-success' : 'ios-toast-error'
              }`}
              role={stFeedback.type === 'success' ? 'status' : 'alert'}
            >
              {stFeedback.type === 'success' ? (
                <Check className={`w-4 h-4 shrink-0 text-emerald-400 ios-toast-icon-success`} />
              ) : (
                <XIcon className={`w-4 h-4 shrink-0 text-red-400 ios-toast-icon-error`} />
              )}
              <span className="truncate font-medium">{stFeedback.msg}</span>
            </motion.div>
          )}
          {showExportAlert && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="fixed top-6 left-1/2 -translate-x-1/2 bg-slate-900/95 [.light-theme_&]:!bg-slate-800/95 border border-amber-500/40 [.light-theme_&]:!border-amber-200 text-amber-200 [.light-theme_&]:!text-amber-950 px-4 py-2.5 rounded-full text-xs sm:text-sm backdrop-blur-xl z-50 flex items-center gap-2.5 shadow-[0_8px_30px_rgba(245,158,11,0.15)] [.light-theme_&]:!shadow-[0_8px_30px_rgba(245,158,11,0.1)] pointer-events-auto"
            >
              <AlertCircle className="w-4 h-4 text-amber-400 [.light-theme_&]:!text-amber-600 shrink-0" />
              <span className="font-medium truncate">未找到原始 PNG 文件，已导出为 JSON。</span>
              <button 
                onClick={() => setShowExportAlert(false)} 
                className="ml-0.5 p-1 hover:bg-white/10 [.light-theme_&]:hover:!bg-amber-100 rounded-full text-amber-200/70 hover:text-white [.light-theme_&]:!text-amber-900/60 [.light-theme_&]:hover:!text-amber-950 transition cursor-pointer"
              >
                ✕
              </button>
            </motion.div>
          )}

          {showDeleteConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 [.light-theme_&]:bg-black/40 backdrop-blur-sm z-[200] flex items-end justify-center"
              onClick={() => setShowDeleteConfirm(false)}
            >
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-lg bg-[#1c1c1e] [.light-theme_&]:!bg-[#ffffff] border-t border-white/10 [.light-theme_&]:!border-black/5 rounded-t-3xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl select-none"
              >
                {/* Indicator Handle */}
                <div className="w-10 h-1 bg-white/20 [.light-theme_&]:!bg-black/10 rounded-full mx-auto mb-3" />

                <h3 className="text-base sm:text-lg font-bold text-center text-white [.light-theme_&]:!text-[#0f172a] mb-1">
                  删除角色？
                </h3>
                <p className="text-[11px] sm:text-xs text-center text-white/70 [.light-theme_&]:!text-slate-600 mb-4 px-2 leading-relaxed">
                  确定要将 <span className="font-bold text-white [.light-theme_&]:!text-[#0f172a]">{character.name}</span> 移至回收站吗？
                </p>

                <div className="space-y-2.5">
                  <button
                    onClick={handleDelete}
                    className={`w-full py-2.5 sm:py-3 rounded-full font-medium text-sm transition-all cursor-pointer active:scale-[0.98] border-0 outline-none flex items-center justify-center gap-2 ${
                      isLightMode
                        ? 'bg-[#fff0f2] hover:bg-[#ffe4e6] active:bg-[#fecdd3] text-[#e11d48] shadow-none'
                        : 'bg-[#FE2C55] hover:bg-[#E02447] active:bg-[#D41C3E] text-white shadow-md shadow-[#FE2C55]/25'
                    }`}
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>移至回收站</span>
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className={`w-full py-2.5 sm:py-3 rounded-full font-medium text-sm transition-all cursor-pointer active:scale-[0.98] border-0 outline-none flex items-center justify-center ${
                      isLightMode
                        ? 'bg-[#f1f5f9] hover:bg-[#e2e8f0] active:bg-[#cbd5e1] text-[#334155] shadow-none'
                        : 'bg-white/10 hover:bg-white/15 active:bg-white/5 text-white/90'
                    }`}
                  >
                    取消
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}

          {showDownloadChoice && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 [.light-theme_&]:bg-black/40 backdrop-blur-sm z-[200] flex items-end justify-center"
              onClick={() => setShowDownloadChoice(false)}
            >
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-lg bg-[#1c1c1e] [.light-theme_&]:!bg-[#ffffff] border-t border-white/10 [.light-theme_&]:!border-black/5 rounded-t-3xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl select-none"
              >
                {/* Indicator Handle */}
                <div className="w-10 h-1 bg-white/20 [.light-theme_&]:!bg-black/10 rounded-full mx-auto mb-3" />

                <h3 className="text-base sm:text-lg font-bold text-center text-white [.light-theme_&]:!text-[#0f172a] mb-1">
                  选择下载格式
                </h3>
                <p className="text-[11px] sm:text-xs text-center text-white/70 [.light-theme_&]:!text-slate-600 mb-4 px-2 leading-relaxed">
                  选择以下任意一种格式导出角色卡，均可直接导入酒馆
                </p>

                <div className="space-y-2.5">
                  <button
                    onClick={() => {
                      setShowDownloadChoice(false);
                      handleExportPng(true);
                    }}
                    className={`w-full py-2.5 sm:py-3 rounded-full font-medium text-sm transition-all cursor-pointer active:scale-[0.98] border-0 outline-none flex items-center justify-center gap-2 ${
                      isLightMode
                        ? 'bg-[#eff6ff] hover:bg-[#dbeafe] active:bg-[#bfdbfe] text-[#2563eb] shadow-none'
                        : 'bg-[#007aff] hover:bg-[#0062cc] active:bg-[#0051a8] text-white shadow-md shadow-[#007aff]/25'
                    }`}
                  >
                    <ImageIcon className="w-4 h-4" />
                    <span>下载 PNG 角色卡</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowDownloadChoice(false);
                      handleExportJson(true);
                    }}
                    className={`w-full py-2.5 sm:py-3 rounded-full font-medium text-sm transition-all cursor-pointer active:scale-[0.98] border-0 outline-none flex items-center justify-center gap-2 ${
                      isLightMode
                        ? 'bg-[#f1f5f9] hover:bg-[#e2e8f0] active:bg-[#cbd5e1] text-[#334155] shadow-none'
                        : 'bg-white/10 hover:bg-white/15 active:bg-white/5 text-white/90'
                    }`}
                  >
                    <FileJson className="w-4 h-4" />
                    <span>下载 JSON 角色卡</span>
                  </button>
                  <button
                    onClick={() => setShowDownloadChoice(false)}
                    className={`w-full py-2.5 sm:py-3 rounded-full font-medium text-sm transition-all cursor-pointer active:scale-[0.98] border-0 outline-none flex items-center justify-center ${
                      isLightMode
                        ? 'bg-[#f8fafc] hover:bg-[#f1f5f9] active:bg-[#e2e8f0] text-[#64748b] shadow-none'
                        : 'bg-white/5 hover:bg-white/10 active:bg-white/[0.02] text-white/60'
                    }`}
                  >
                    取消
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
            <div className="flex items-center justify-center gap-2 mt-4 w-full px-4">
              {/* Cancel Button on Left for symmetrical balance */}
              <button 
                onClick={() => {
                  setIsEditingName(false);
                  setEditNameValue(character.name);
                }}
                title="取消"
                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center shrink-0 transition active:scale-90 cursor-pointer ${
                  isLightMode
                    ? "bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#64748b] hover:text-[#0f172a]"
                    : "bg-white/10 hover:bg-white/20 text-white/70 hover:text-white"
                }`}
              >
                <XIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>

              {/* Centered, sleekly proportioned input */}
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
                className={`rounded-xl px-3 py-1 text-xl sm:text-2xl font-bold text-center outline-none transition shadow-2xs ${
                  isLightMode
                    ? "bg-white/95 border border-[#cbd5e1] text-[#0f172a] focus:border-[#3b82f6] focus:ring-3 focus:ring-blue-500/15"
                    : "bg-black/40 border border-white/20 text-white focus:border-blue-500 focus:ring-3 focus:ring-blue-500/20"
                }`}
                style={{ width: `${Math.max(110, Math.min(220, (editNameValue.length + 1) * 22))}px` }}
                autoFocus
              />

              {/* Save Button on Right for symmetrical balance */}
              <button 
                onClick={handleNameSave}
                title="保存"
                className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shrink-0 transition active:scale-90 cursor-pointer shadow-xs shadow-blue-500/20"
              >
                <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.4]" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 mt-4 w-full px-4 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-bold text-center break-words max-w-full">{character.name}</h1>
              <button 
                onClick={() => setIsEditingName(true)}
                className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition shrink-0"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            </div>
          )}
          {/* Version, Creator & Historical Version Badge (Vertically arranged to avoid horizontal crowding) */}
          <div className="mt-1 flex flex-col items-center justify-center gap-1.5">
            <div className="text-white/70 text-sm flex items-center justify-center gap-2 flex-wrap [.light-theme_&]:text-slate-600">
              <button
                onClick={() => setActiveTab('versions')}
                className="font-medium text-white/90 hover:text-white transition underline underline-offset-4 decoration-white/25 hover:decoration-white/70 flex items-center gap-1 group cursor-pointer active:scale-95 [.light-theme_&]:text-[#1c1c1e] [.light-theme_&]:decoration-black/20 [.light-theme_&]:hover:text-black [.light-theme_&]:hover:decoration-black/50"
                title="点击查看此角色的版本迭代与溯源历史"
              >
                <span>v{data.character_version || '1.0'}</span>
              </button>
              <span>•</span>
              <span>{data.creator || 'Unknown Creator'}</span>
            </div>

            {/* Historical version hint arranged vertically to prevent horizontal crowding */}
            {character?.versionHistory && character.versionHistory.length > 0 && (
              <button
                onClick={() => setActiveTab('versions')}
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-[11px] text-white/80 hover:text-white transition cursor-pointer active:scale-95 shadow-sm [.light-theme_&]:bg-stone-100 [.light-theme_&]:border-stone-200 [.light-theme_&]:text-stone-700 [.light-theme_&]:hover:bg-stone-200"
                title="点击查看历史演进轨迹与快照对比"
              >
                <History className="w-3 h-3 shrink-0" />
                <span>{character.versionHistory.length} 个历史版本</span>
              </button>
            )}
          </div>
          
          {/* 文件夹归类胶囊 (居中首排展示) */}
          <div className="flex items-center justify-center mt-2 max-w-full px-2">
            <button
              onClick={() => setIsMoveFolderOpen(true)}
              className="group inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-xs text-white/90 transition cursor-pointer active:scale-95 backdrop-blur-md shadow-xs [.light-theme_&]:bg-stone-100 [.light-theme_&]:border-stone-200 [.light-theme_&]:text-stone-700 [.light-theme_&]:hover:bg-stone-200 shrink min-w-0"
              title={currentFolderPath ? `文件夹: ${currentFolderPath}（点击更改）` : '未分类（点击归类）'}
            >
              <FolderIcon className="w-3.5 h-3.5 text-white/70 [.light-theme_&]:text-stone-700 shrink-0 transition-transform group-hover:scale-105" />
              <span className="font-medium tracking-wide truncate max-w-[150px] sm:max-w-[240px]">
                {currentFolderPath ? `文件夹: ${currentFolderPath}` : '未分类（点击归类）'}
              </span>
              <ChevronRight className="w-3 h-3 text-white/40 [.light-theme_&]:text-stone-500 shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>

          {/* 字符 / Token 胶囊 & 简介标志按钮 (仅普通角色卡展示，工具区/预设/世界书等不展示) */}
          {!isToolCard && (
            <div className="flex items-center justify-center gap-2 mt-2 max-w-full px-2 flex-wrap">
              {/* 字符 / Token 统计胶囊 (自然融入原生胶囊设计，无⚡图标) */}
              <button
                onClick={() => setShowTokenBreakdownModal(true)}
                className="group inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-xs text-white/90 transition cursor-pointer active:scale-95 backdrop-blur-md shadow-xs [.light-theme_&]:bg-stone-100 [.light-theme_&]:border-stone-200 [.light-theme_&]:text-stone-700 [.light-theme_&]:hover:bg-stone-200 shrink-0 font-medium"
                title="点击查看各字段 Token 详细分析与上下文占比"
              >
                <FileText className="w-3.5 h-3.5 text-white/70 [.light-theme_&]:text-stone-700 shrink-0 transition-transform group-hover:scale-105" />
                <span className="font-mono tracking-wide">
                  {formatTokenCount(tokenBreakdown.totalTokens)} T
                </span>
                <span className="text-[10px] opacity-75 font-normal">
                  (常驻 {formatTokenCount(tokenBreakdown.permanentTokens)})
                </span>
              </button>

              {/* 简介标志按钮 */}
              <button
                onClick={() => setShowSummaryModal(true)}
                className="group inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-xs text-white/90 transition cursor-pointer active:scale-95 backdrop-blur-md shadow-xs [.light-theme_&]:bg-stone-100 [.light-theme_&]:border-stone-200 [.light-theme_&]:text-stone-700 [.light-theme_&]:hover:bg-stone-200 shrink-0"
                title="查看与重新生成简介"
              >
                <Sparkles className="w-3.5 h-3.5 text-white/70 [.light-theme_&]:text-stone-700 shrink-0 transition-transform group-hover:scale-105" />
                <span className="font-medium tracking-wide">简介</span>
              </button>
            </div>
          )}
          
          {/* Metadata Section - Collapsible Drawer with Sleek Handle */}
          <div className="w-full max-w-lg mt-2 px-2 sm:px-4 flex flex-col items-center">
            <button
              onClick={() => setIsMetadataOpen(!isMetadataOpen)}
              className="w-full flex items-center justify-center py-2 text-white/50 hover:text-white transition-colors cursor-pointer group active:scale-95"
              title={isMetadataOpen ? "点击收起详情" : "点击展开元数据"}
            >
              <div className="h-1 w-12 bg-white/30 group-hover:bg-white/60 rounded-full transition-colors" />
            </button>
            <AnimatePresence>
              {isMetadataOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}
                  className="overflow-hidden w-full space-y-2.5 pt-1"
                >
                  {/* Timestamps */}
                  <div className="flex items-center justify-center gap-4 text-xs sm:text-sm text-white/90 [.light-theme_&]:!text-[#0f172a] font-mono flex-wrap">
                    <span>导入: {new Date(character?.createdAt || Date.now()).toLocaleDateString()}</span>
                    <span>•</span>
                    <span>修改: {resolvedModifiedDate ? resolvedModifiedDate.toLocaleDateString() : (character?.originalFile?.lastModified ? new Date(character.originalFile.lastModified).toLocaleDateString() : '未知')}</span>
                  </div>

                  {/* Editable Fields: Creator, Version, Tags, Source */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs sm:text-sm">
                    {/* Creator */}
                    <div className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-white/10 border border-white/15 [.light-theme_&]:!bg-black/5 [.light-theme_&]:!border-transparent backdrop-blur-sm">
                      <span className="text-white/80 font-medium shrink-0 [.light-theme_&]:!text-[#0f172a] text-xs sm:text-sm">作者</span>
                      {isEditingCreator ? (
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <input 
                            value={tempCreator} 
                            onChange={e => setTempCreator(e.target.value)} 
                            className="bg-black/60 border border-white/30 rounded-lg px-2.5 py-1 text-xs text-white outline-none flex-1 min-w-0 w-full focus:border-white/70 [.light-theme_&]:!bg-white [.light-theme_&]:!border-slate-300 [.light-theme_&]:!text-[#0f172a]"
                            placeholder="作者名称"
                            autoFocus
                            onKeyDown={e => e.key === 'Enter' && handleUpdateCreator(tempCreator)}
                          />
                          <button onClick={() => handleUpdateCreator(tempCreator)} className="p-1 text-green-400 hover:bg-green-500/20 rounded-lg shrink-0 [.light-theme_&]:text-[#1DB954] [.light-theme_&]:hover:bg-[#1DB954]/10 cursor-pointer">
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setIsEditingCreator(false)} className="p-1 text-white/50 hover:bg-white/10 rounded-lg shrink-0 [.light-theme_&]:!text-slate-400 [.light-theme_&]:hover:!bg-slate-200 cursor-pointer">
                            <XIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 min-w-0 justify-end">
                          <span className={`truncate text-xs sm:text-sm ${
                            data.creator && data.creator.trim() && data.creator !== '未知' && data.creator !== 'Unknown Creator'
                              ? 'text-white [.light-theme_&]:!text-[#0f172a] font-semibold'
                              : 'text-white/60 [.light-theme_&]:!text-[#0f172a] font-normal'
                          }`}>
                            {data.creator || '未知'}
                          </span>
                          <button onClick={() => { setTempCreator(data.creator || ''); setIsEditingCreator(true); }} className="p-1 text-white/50 hover:text-white [.light-theme_&]:!text-slate-500 [.light-theme_&]:hover:!text-[#0f172a] transition cursor-pointer">
                            <Edit2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Version */}
                    <div className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-white/10 border border-white/15 [.light-theme_&]:!bg-black/5 [.light-theme_&]:!border-transparent backdrop-blur-sm">
                      <span className="text-white/80 font-medium shrink-0 [.light-theme_&]:!text-[#0f172a] text-xs sm:text-sm">版本</span>
                      {isEditingVersion ? (
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <input 
                            value={tempVersion} 
                            onChange={e => setTempVersion(e.target.value)} 
                            className="bg-black/60 border border-white/30 rounded-lg px-2.5 py-1 text-xs text-white outline-none flex-1 min-w-0 w-full focus:border-white/70 [.light-theme_&]:!bg-white [.light-theme_&]:!border-slate-300 [.light-theme_&]:!text-[#0f172a]"
                            placeholder="例如: 1.0"
                            autoFocus
                            onKeyDown={e => e.key === 'Enter' && handleUpdateVersion(tempVersion)}
                          />
                          <button onClick={() => handleUpdateVersion(tempVersion)} className="p-1 text-green-400 hover:bg-green-500/20 rounded-lg shrink-0 [.light-theme_&]:text-[#1DB954] [.light-theme_&]:hover:bg-[#1DB954]/10 cursor-pointer">
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setIsEditingVersion(false)} className="p-1 text-white/50 hover:bg-white/10 rounded-lg shrink-0 [.light-theme_&]:!text-slate-400 [.light-theme_&]:hover:!bg-slate-200 cursor-pointer">
                            <XIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 min-w-0 justify-end">
                          <span className={`truncate text-xs sm:text-sm ${
                            data.character_version && data.character_version.trim() && data.character_version !== '无版本'
                              ? 'text-white [.light-theme_&]:!text-[#0f172a] font-semibold'
                              : 'text-white/60 [.light-theme_&]:!text-[#0f172a] font-normal'
                          }`}>
                            {data.character_version || '1.0'}
                          </span>
                          <button onClick={() => { setTempVersion(data.character_version || ''); setIsEditingVersion(true); }} className="p-1 text-white/50 hover:text-white [.light-theme_&]:!text-slate-500 [.light-theme_&]:hover:!text-[#0f172a] transition cursor-pointer">
                            <Edit2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Tags */}
                    <div className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-white/10 border border-white/15 [.light-theme_&]:!bg-black/5 [.light-theme_&]:!border-transparent backdrop-blur-sm">
                      <span className="text-white/80 font-medium shrink-0 [.light-theme_&]:!text-[#0f172a] text-xs sm:text-sm">标签</span>
                      {isEditingTags ? (
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <input 
                            value={tempTags} 
                            onChange={e => {
                              const val = e.target.value;
                              if (val.endsWith(' ') && !val.endsWith(', ')) {
                                setTempTags(val.slice(0, -1) + ', ');
                              } else {
                                setTempTags(val);
                              }
                            }} 
                            className="bg-black/60 border border-white/30 rounded-lg px-2.5 py-1 text-xs text-white outline-none flex-1 min-w-0 w-full focus:border-white/70 [.light-theme_&]:!bg-white [.light-theme_&]:!border-slate-300 [.light-theme_&]:!text-[#0f172a]"
                            placeholder="标签逗号分隔"
                            autoFocus
                            onKeyDown={e => e.key === 'Enter' && handleUpdateTags(tempTags)}
                          />
                          <button onClick={() => handleUpdateTags(tempTags)} className="p-1 text-green-400 hover:bg-green-500/20 rounded-lg shrink-0 [.light-theme_&]:text-[#1DB954] [.light-theme_&]:hover:bg-[#1DB954]/10 cursor-pointer">
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setIsEditingTags(false)} className="p-1 text-white/50 hover:bg-white/10 rounded-lg shrink-0 [.light-theme_&]:!text-slate-400 [.light-theme_&]:hover:!bg-slate-200 cursor-pointer">
                            <XIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 min-w-0 justify-end">
                          <span className={`truncate text-xs sm:text-sm ${
                            data.tags && data.tags.length > 0
                              ? 'text-white [.light-theme_&]:!text-[#0f172a] font-semibold'
                              : 'text-white/60 [.light-theme_&]:!text-[#0f172a] font-normal'
                          }`}>
                            {data.tags && data.tags.length > 0 ? data.tags.join(', ') : '无标签'}
                          </span>
                          <button onClick={() => { setTempTags((data.tags || []).join(', ')); setIsEditingTags(true); }} className="p-1 text-white/50 hover:text-white [.light-theme_&]:!text-slate-500 [.light-theme_&]:hover:!text-[#0f172a] transition cursor-pointer">
                            <Edit2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Source */}
                    <div className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-white/10 border border-white/15 [.light-theme_&]:!bg-black/5 [.light-theme_&]:!border-transparent backdrop-blur-sm">
                      <span className="text-white/80 font-medium shrink-0 [.light-theme_&]:!text-[#0f172a] text-xs sm:text-sm">来源</span>
                      {isEditingSource ? (
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <input 
                            value={tempSource} 
                            onChange={e => setTempSource(e.target.value)} 
                            className="bg-black/60 border border-white/30 rounded-lg px-2.5 py-1 text-xs text-white outline-none flex-1 min-w-0 w-full focus:border-white/70 [.light-theme_&]:!bg-white [.light-theme_&]:!border-slate-300 [.light-theme_&]:!text-[#0f172a]"
                            placeholder="https://..."
                            autoFocus
                            onKeyDown={e => e.key === 'Enter' && handleUpdateSource(tempSource)}
                          />
                          <button onClick={() => handleUpdateSource(tempSource)} className="p-1 text-green-400 hover:bg-green-500/20 rounded-lg shrink-0 [.light-theme_&]:text-[#1DB954] [.light-theme_&]:hover:bg-[#1DB954]/10 cursor-pointer">
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setIsEditingSource(false)} className="p-1 text-white/50 hover:bg-white/10 rounded-lg shrink-0 [.light-theme_&]:!text-slate-400 [.light-theme_&]:hover:!bg-slate-200 cursor-pointer">
                            <XIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 min-w-0 justify-end">
                          {data.extensions?.source || data.source || character.sourceUrl ? (
                            <a 
                              href={data.extensions?.source || data.source || character.sourceUrl} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-blue-400 [.light-theme_&]:!text-[#007aff] hover:underline flex items-center gap-1 truncate font-medium text-xs sm:text-sm cursor-pointer min-w-0 font-mono"
                              title={data.extensions?.source || data.source || character.sourceUrl}
                            >
                              <ExternalLink className="w-3 h-3 shrink-0 text-blue-400 [.light-theme_&]:!text-[#007aff]" />
                              <span className="truncate max-w-[200px] sm:max-w-[280px]">{data.extensions?.source || data.source || character.sourceUrl}</span>
                            </a>
                          ) : (
                            <span className="text-white/60 [.light-theme_&]:!text-[#0f172a] font-normal text-xs sm:text-sm">无来源</span>
                          )}
                          <button 
                            onClick={() => { setTempSource(data.extensions?.source || data.source || character.sourceUrl || ''); setIsEditingSource(true); }} 
                            className="p-1 text-white/50 hover:text-white [.light-theme_&]:!text-slate-500 [.light-theme_&]:hover:!text-[#0f172a] transition cursor-pointer shrink-0"
                            title="修改来源网址"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
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
        <div className="sticky top-[72px] z-20 -mx-4 px-4 py-2 mb-4 bg-transparent [.light-theme_&]:!bg-transparent [.light-theme_&]:!backdrop-blur-none backdrop-blur-md">
          <div className="flex gap-2 overflow-x-auto hide-scrollbar scroll-smooth px-1 py-1 pr-8">
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
              { id: 'versions', icon: History, label: '版本迭代' },
            ] : []),
            ...(!isPreset && !isStandaloneWorldbook ? [
              { id: 'memos', icon: StickyNote, label: '备忘录' },
            ] : []),
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`relative flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-medium transition-colors whitespace-nowrap focus:outline-none focus:ring-0 active:outline-none outline-none select-none cursor-pointer z-0 shrink-0 ${
                activeTab === tab.id
                  ? 'char-detail-tab-active shadow-sm font-semibold'
                  : 'char-detail-tab-inactive'
              }`}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              {activeTab === tab.id && (
                <motion.div
                  layoutId="charDetailActiveTabIndicator"
                  className="char-detail-tab-indicator -z-10"
                  transition={{ type: "spring", stiffness: 450, damping: 35 }}
                />
              )}
              <tab.icon className="w-4 h-4 relative z-10 shrink-0" />
              <span className="relative z-10">{tab.label}</span>
            </button>
          ))}
          </div>
        </div>

        {/* Content Area - Glassmorphism Card */}
        <div className="flex-1 px-2 sm:px-4 pb-32">
          <div className="char-detail-glass-card backdrop-blur-2xl rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-2xl min-h-[50vh] overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-6"
              >
            {activeTab === 'data_viewer' && (
              <div
                key="data_viewer"
                className="space-y-6"
              >
                <div className="raw-data-card rounded-xl overflow-hidden">
                    <div className="p-4 raw-data-header flex items-center justify-between">
                        <h3 className="text-[15px] font-medium raw-data-header-title">原生数据 (JSON)</h3>
                    </div>
                    <div className="p-4 overflow-auto max-h-[70vh] custom-scrollbar">
                        <pre className="text-[13px] raw-data-code font-mono whitespace-pre-wrap break-all">
                            {(() => { try { const str = JSON.stringify(rawData, null, 2); if (str.length > 50000) { return str.substring(0, 50000) + "\n\n... (数据过大，为防止卡顿已截断显示，请使用导出功能查看完整内容)"; } return str; } catch (e) { return "无法解析此数据"; } })()}
                        </pre>
                    </div>
                </div>
              </div>
            )}

            {activeTab === 'profile' && (
              <div
                key="profile"
                className="space-y-6"
              >
                  {isPreset ? (
                    <div className="space-y-6">
                      {rawData.prompts && rawData.prompts.length > 0 && (
                        <div className="space-y-4">
                          <h3 className="text-lg font-semibold text-white/90 [.light-theme_&]:!text-slate-800 border-b border-white/10 [.light-theme_&]:!border-slate-200 pb-2">提示词条目 (Prompts)</h3>
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
                        <h3 className="text-lg font-semibold text-white/90 [.light-theme_&]:!text-slate-800 border-b border-white/10 [.light-theme_&]:!border-slate-200 pb-2">生成参数 (Generation Settings)</h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm [.light-theme_&]:text-slate-700">
                          {rawData.temperature !== undefined && <div><span className="text-white/50 [.light-theme_&]:!text-slate-500">Temperature:</span> {rawData.temperature}</div>}
                          {rawData.top_p !== undefined && <div><span className="text-white/50 [.light-theme_&]:!text-slate-500">Top P:</span> {rawData.top_p}</div>}
                          {rawData.top_k !== undefined && <div><span className="text-white/50 [.light-theme_&]:!text-slate-500">Top K:</span> {rawData.top_k}</div>}
                          {rawData.rep_pen !== undefined && <div><span className="text-white/50 [.light-theme_&]:!text-slate-500">Rep Pen:</span> {rawData.rep_pen}</div>}
                          {rawData.presence_penalty !== undefined && <div><span className="text-white/50 [.light-theme_&]:!text-slate-500">Presence Pen:</span> {rawData.presence_penalty}</div>}
                          {rawData.frequency_penalty !== undefined && <div><span className="text-white/50 [.light-theme_&]:!text-slate-500">Frequency Pen:</span> {rawData.frequency_penalty}</div>}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Section title="描述 (Description)" content={data.description} character={character} onSave={(val) => updateField('description', val)} />
                      <Section title="性格 (Personality)" content={data.personality} character={character} onSave={(val) => updateField('personality', val)} />
                      <Section title="场景 (Scenario)" content={data.scenario} character={character} onSave={(val) => updateField('scenario', val)} />
                      <Section title="示例对话 (Mes Example)" content={data.mes_example} character={character} onSave={(val) => updateField('mes_example', val)} />
                      <Section title="作者备注 (Creator's Notes)" content={data.creator_notes} character={character} onSave={(val) => updateField('creator_notes', val)} />
                      <Section title="系统提示词 (System Prompt)" content={data.system_prompt} character={character} onSave={(val) => updateField('system_prompt', val)} />
                      <Section title="历史后提示词 (Post History Instructions)" content={data.post_history_instructions} character={character} onSave={(val) => updateField('post_history_instructions', val)} />
                      
                      {character && (
                        <QuickRepliesSection 
                          character={character} 
                          onUpdate={setCharacter} 
                          isLightMode={isLightMode}
                        />
                      )}
                    </>
                  )}
              </div>
            )}

            {activeTab === 'greetings' && (
              <div
                key="greetings"
                className="space-y-6"
              >
                  <Section 
                    title="首条消息" 
                    content={data.first_mes} 
                    character={character}
                    onSave={(val) => updateField('first_mes', val)} 
                    onOpenReader={() => {
                      setGreetingReaderInitialIndex(0);
                      setGreetingReaderEditMode(false);
                      setShowGreetingReader(true);
                    }}
                    onOpenEdit={() => {
                      setGreetingReaderInitialIndex(0);
                      setGreetingReaderEditMode(true);
                      setShowGreetingReader(true);
                    }}
                  />
                  
                  <div className="space-y-4">
                    <div className="flex items-center justify-between border-b border-white/10 [.light-theme_&]:!border-[#e2e8f0] pb-2 mb-3">
                      <h3 className="text-lg font-semibold text-white/90 [.light-theme_&]:!text-[#0f172a]">备用开场白</h3>
                      <button 
                        onClick={() => {
                          const currentAlts = Array.isArray(data.alternate_greetings) ? data.alternate_greetings : [];
                          const newGreetings = [...currentAlts, ''];
                          updateField('alternate_greetings', newGreetings);
                          setGreetingReaderInitialIndex(newGreetings.length);
                          setGreetingReaderEditMode(true);
                          setShowGreetingReader(true);
                        }} 
                        className="px-2.5 py-1 rounded-full text-xs sm:text-sm font-medium flex items-center gap-1.5 transition cursor-pointer active:scale-95 bg-transparent hover:bg-white/10 text-white [.light-theme_&]:!bg-transparent [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:hover:!bg-black/5 border-0 outline-none"
                      >
                        <Plus className="w-4 h-4 text-white [.light-theme_&]:!text-[#0f172a]" />
                        <span>添加</span>
                      </button>
                    </div>
                    <div className="space-y-4">
                      {data.alternate_greetings && data.alternate_greetings.length > 0 ? (
                        data.alternate_greetings.map((msg: string, i: number) => (
                          <AlternateGreetingCard
                            key={i}
                            index={i}
                            content={msg}
                            character={character}
                            onOpenReader={() => {
                              setGreetingReaderInitialIndex(i + 1);
                              setGreetingReaderEditMode(false);
                              setShowGreetingReader(true);
                            }}
                            onOpenEdit={() => {
                              setGreetingReaderInitialIndex(i + 1);
                              setGreetingReaderEditMode(true);
                              setShowGreetingReader(true);
                            }}
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
                        <div className="w-full detail-card p-3.5 rounded-2xl transition-all flex flex-col overflow-hidden mb-2">
                          <div className="detail-card-text-muted text-sm italic">
                            暂无备用开场白
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
              </div>
            )}

            {activeTab === 'worldbook' && (
              <div
                key="worldbook"
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
                    <div className="space-y-4">
                      <div className="flex justify-between items-center mb-2">
                        <div>
                          <h2 className="text-xl font-bold text-white/90 [.light-theme_&]:!text-[#0f172a] mb-1">世界书</h2>
                          <p className="text-sm text-white/60 [.light-theme_&]:!text-[#64748b]">
                            包含世界观、设定和背景信息
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => {
                              const newBook = { name: '新世界书', description: '', entries: {} };
                              const updatedChar = { ...character };
                              let targetData = updatedChar.data.data ? updatedChar.data.data : updatedChar.data;
                              
                              targetData.character_book = newBook;
                              targetData.extensions = { ...(targetData.extensions || {}), character_book: newBook };
                              
                              saveCharacter(updatedChar).then(() => setCharacter(updatedChar));
                            }}
                            className="w-9 h-9 rounded-full soft-pill flex items-center justify-center transition active:scale-95 cursor-pointer shadow-xs"
                            title="创建世界书"
                          >
                            <Plus className="w-4.5 h-4.5 opacity-80" />
                          </button>
                          <label 
                            className="w-9 h-9 rounded-full soft-pill flex items-center justify-center transition active:scale-95 cursor-pointer shadow-xs"
                            title="导入世界书"
                          >
                            <Upload className="w-4.5 h-4.5 opacity-80" />
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

                      <div className="w-full detail-card p-8 rounded-2xl flex flex-col items-center justify-center text-center">
                        <Book className="w-12 h-12 mb-3 opacity-40 text-slate-400 [.light-theme_&]:!text-slate-500" />
                        <p className="detail-card-text text-sm font-medium">当前角色未包含世界书数据</p>
                        <p className="detail-card-text-muted text-xs mt-1">点击上方按钮可新建世界书或导入 JSON 设定文件</p>
                      </div>
                    </div>
                  )}
              </div>
            )}

            {activeTab === 'regex' && character && (
              <div
                key="regex"
              >
                <CharacterRegexSection character={character} onUpdate={setCharacter} isLightMode={isLightMode} />
              </div>
            )}

            {activeTab === 'chats' && character && (
              <div
                key="chats"
              >
                <CharacterChatsSection 
                   characterId={character.id} 
                   characterName={character.name} 
                   regexScripts={(character.data?.data?.extensions || character.data?.extensions || {}).regex_scripts || []} 
                   avatar={avatarUrl}
                   onOpenChat={onOpenChat}
                   onOpenImport={onOpenImport}
                   refreshKey={refreshKey}
                   isLightMode={isLightMode}
                />
              </div>
            )}

            {activeTab === 'versions' && character && (
              <div
                key="versions"
              >
                <CharacterVersionsSection 
                  character={character}
                  avatarUrl={avatarUrl}
                  isLightMode={isLightMode}
                  onUpdateCharacter={(updated) => {
                    setCharacter(updated);
                    setEditNameValue(updated.name);
                    if (updated.avatarBlob) {
                      const newUrl = URL.createObjectURL(updated.avatarBlob);
                      setAvatarUrl(newUrl);
                    } else if (updated.avatarUrlFallback) {
                      setAvatarUrl(resolveAvatarUrl(updated.avatarUrlFallback, updated.name || updated.id));
                    }
                    window.dispatchEvent(new CustomEvent('charactersUpdated'));
                  }}
                  onRefreshDetail={() => {
                    getCharacter(id).then(async (char) => {
                      if (char) {
                        setCharacter(char);
                        setEditNameValue(char.name);
                        if (char.avatarBlob) {
                          setAvatarUrl(URL.createObjectURL(char.avatarBlob));
                        }
                      }
                    });
                  }}
                />
              </div>
            )}

            {activeTab === 'memos' && character && (
              <div
                key="memos"
              >
                <CharacterMemosSection characterId={character.id} isLightMode={isLightMode} />
              </div>
            )}
              </motion.div>
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
            if (updatedCharacter.localFilePath) {
              import('../lib/appBridge').then(({ getLocalImageUrl }) => {
                setAvatarUrl(getLocalImageUrl(updatedCharacter.localFilePath!, updatedCharacter.updatedAt || updatedCharacter.createdAt));
              });
            } else if (updatedCharacter.avatarBlob) {
              const url = URL.createObjectURL(updatedCharacter.avatarBlob);
              setAvatarUrl(url);
            }
            window.dispatchEvent(new CustomEvent('charactersUpdated'));
          }}
        />
      )}

      {character && (
        <GreetingReaderModal
          isOpen={showGreetingReader}
          onClose={() => setShowGreetingReader(false)}
          character={character}
          avatarUrl={avatarUrl}
          initialIndex={greetingReaderInitialIndex}
          initialEditMode={greetingReaderEditMode}
          onUpdateGreeting={handleUpdateGreetings}
        />
      )}

      <MoveToFolderModal
        isOpen={isMoveFolderOpen}
        onClose={() => setIsMoveFolderOpen(false)}
        onMove={handleMoveFolder}
      />

      {showTokenBreakdownModal && character && (
        <TokenBreakdownModal
          isOpen={true}
          onClose={() => setShowTokenBreakdownModal(false)}
          charName={character.name}
          breakdown={tokenBreakdown}
          isLightMode={isLightMode}
        />
      )}

      {showSummaryModal && character && (
        <CharacterSummaryModal
          character={character}
          onClose={() => setShowSummaryModal(false)}
          onOpenDetail={() => setShowSummaryModal(false)}
          onSummaryUpdated={async () => {
            const fresh = await getCharacter(character.id);
            if (fresh) {
              setCharacter(fresh);
            }
          }}
          isLightMode={isLightMode}
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

  useEffect(() => {
    setIsEditing(initialEditMode);
    setEditValue(content);
  }, [isOpen, content, initialEditMode]);

  useBackHandler(isOpen, () => {
    onClose();
    return true;
  });

  const handleSave = () => {
    if (onSave) {
      onSave(editValue);
    }
    onClose();
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="full-screen-text-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex justify-center items-center p-4 sm:p-6 [.light-theme_&]:bg-black/40"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 border border-white/10 shadow-2xl rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden [.light-theme_&]:bg-[#FCFCFC] [.light-theme_&]:border-black/5"
          >
            <div className="flex-none p-4 sm:p-6 border-b border-white/10 flex items-center justify-between bg-black/20 [.light-theme_&]:border-black/5 [.light-theme_&]:bg-black/5">
              <h3 className="text-lg font-semibold text-white [.light-theme_&]:text-[#1c1c1e]">{title}</h3>
              <div className="flex items-center gap-2">
                {!isEditing && onSave && (
                  <button onClick={() => setIsEditing(true)} className="p-1 hover:bg-white/10 rounded-full text-white/60 hover:text-white transition [.light-theme_&]:hover:bg-black/10 [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:text-[#1c1c1e] cursor-pointer" title="编辑">
                    <Edit2 className="w-4 h-4" />
                  </button>
                )}
                <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full text-white/60 hover:text-white transition [.light-theme_&]:hover:bg-black/10 [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:text-[#1c1c1e] cursor-pointer">
                  <XIcon className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              {isEditing ? (
                <textarea 
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  className="w-full min-h-[300px] bg-black/30 border border-white/10 rounded-lg p-4 text-white text-sm sm:text-base leading-relaxed focus:outline-none focus:border-blue-500 transition resize-none font-sans [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10 [.light-theme_&]:text-[#1c1c1e]"
                  autoFocus
                />
              ) : (
                <FormattedCardContent
                  content={content}
                  className="text-white/90 [.light-theme_&]:!text-slate-800 text-sm sm:text-base leading-relaxed break-words"
                />
              )}
            </div>

            {isEditing && (
              <div className="flex-none p-4 sm:p-6 border-t border-white/10 bg-black/20 flex justify-end gap-3 [.light-theme_&]:border-black/5 [.light-theme_&]:bg-black/5">
                <button 
                  onClick={() => {
                    if (initialEditMode) {
                      onClose();
                    } else {
                      setIsEditing(false);
                      setEditValue(content);
                    }
                  }} 
                  className="px-4 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:text-[#1c1c1e] [.light-theme_&]:hover:bg-black/10 cursor-pointer"
                >
                  取消
                </button>
                <button 
                  onClick={handleSave} 
                  className="px-6 py-2 rounded-full font-bold text-xs sm:text-sm bg-white text-black hover:bg-neutral-200 [.light-theme_&]:!bg-black [.light-theme_&]:!text-white [.light-theme_&]:hover:!bg-neutral-800 transition flex items-center gap-2 shadow-sm cursor-pointer"
                >
                  <Save className="w-4 h-4 stroke-[2.5]" />
                  保存
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function TextPreview({ 
  title, 
  content, 
  character,
  onSave, 
  initialEditMode, 
  onOpenReader,
  onOpenEdit 
}: { 
  title: string; 
  content: string; 
  character?: CharacterCard | null;
  onSave?: (val: string) => void; 
  initialEditMode?: boolean; 
  onOpenReader?: () => void;
  onOpenEdit?: () => void;
}) {
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
    if (onOpenEdit) {
      onOpenEdit();
    } else {
      setIsEditing(true);
      if (!isExpanded) setIsExpanded(true);
    }
  };

  const handleCardClick = () => {
    if (onOpenReader) {
      onOpenReader();
    } else {
      setIsExpanded(prev => !prev);
    }
  };

  return (
    <div className="w-full detail-card p-3.5 rounded-2xl transition-all flex flex-col overflow-hidden mb-2">
      {/* Action bar for Editing */}
      {onSave && !isEditing && (
        <div className="flex justify-end items-center gap-1.5 mb-1.5">
          <button 
            onClick={handleEdit}
            className="p-1 hover:bg-white/10 rounded text-white/60 hover:text-white transition [.light-theme_&]:text-slate-400 [.light-theme_&]:hover:text-slate-800 cursor-pointer"
            title="编辑"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {isEditing ? (
        <div className="w-full flex flex-col gap-2 mt-1">
          <textarea 
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            className="w-full bg-black/30 border border-white/10 rounded-xl p-3.5 text-white text-sm sm:text-base leading-relaxed focus:outline-none focus:border-blue-500 min-h-[220px] resize-none [.light-theme_&]:!bg-black/5 [.light-theme_&]:!border-black/10 [.light-theme_&]:!text-[#0f172a]"
            autoFocus
          />
          <div className="flex justify-end gap-3 pt-1">
            <button 
              onClick={() => { setIsEditing(false); setEditValue(content); }}
              className="px-4 py-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/5 text-xs sm:text-sm transition [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:text-[#1c1c1e] [.light-theme_&]:hover:bg-black/10 cursor-pointer"
            >
              取消
            </button>
            <button 
              onClick={handleSave} 
              className="px-5 py-1.5 rounded-full font-bold text-xs sm:text-sm bg-white text-black hover:bg-neutral-200 [.light-theme_&]:!bg-black [.light-theme_&]:!text-white [.light-theme_&]:hover:!bg-neutral-800 transition flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Save className="w-3.5 h-3.5 stroke-[2.5]" />
              保存
            </button>
          </div>
        </div>
      ) : (
        <div className="w-full">
          {onOpenReader ? (
            /* When full-screen reader is available, clicking card directly opens full-screen reader */
            <div 
              className="group cursor-pointer w-full"
              onClick={handleCardClick}
            >
              <div className="detail-card-text-muted text-sm line-clamp-3 break-words w-full">
                <FormattedCardContent content={content} character={character} clampLines={3} />
              </div>
              <div className="mt-1.5 text-[#60A5FA] [.light-theme_&]:!text-blue-600 group-hover:text-blue-400 [.light-theme_&]:group-hover:!text-blue-700 text-xs font-medium flex items-center gap-1 transition-colors">
                <span>展开全文</span>
                <ChevronDown className="w-3 h-3" />
              </div>
            </div>
          ) : isExpanded ? (
            <div className="detail-card-text text-sm leading-relaxed pr-2 break-words w-full">
              <FormattedCardContent content={content} character={character} />
              <button 
                onClick={(e) => { e.stopPropagation(); setIsExpanded(false); }}
                className="mt-3 flex items-center justify-center gap-1 text-[#60A5FA] [.light-theme_&]:!text-blue-600 text-xs font-medium py-1.5 hover:bg-[#60A5FA]/10 [.light-theme_&]:hover:bg-blue-50 rounded-lg transition w-full cursor-pointer"
              >
                <ChevronUp className="w-3.5 h-3.5" /> 收起
              </button>
            </div>
          ) : (
            <div 
              className="group cursor-pointer w-full"
              onClick={() => setIsExpanded(true)}
            >
              <div className="detail-card-text-muted text-sm line-clamp-3 break-words w-full">
                <FormattedCardContent content={content} character={character} clampLines={3} />
              </div>
              <div className="mt-1.5 text-[#60A5FA] [.light-theme_&]:!text-blue-600 group-hover:text-blue-400 [.light-theme_&]:group-hover:!text-blue-700 text-xs font-medium flex items-center gap-1 transition-colors">
                <span>展开全文</span>
                <ChevronDown className="w-3 h-3" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AlternateGreetingCard({ 
  index, 
  content, 
  character,
  onSave, 
  onDelete, 
  onOpenReader,
  onOpenEdit 
}: { 
  key?: string | number; 
  index: number; 
  content: string; 
  character?: CharacterCard | null;
  onSave: (val: string) => void; 
  onDelete: () => void; 
  onOpenReader?: () => void;
  onOpenEdit?: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(content);

  const handleSave = () => {
    onSave(editValue);
    setIsEditing(false);
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onOpenEdit) {
      onOpenEdit();
    } else {
      setIsEditing(true);
    }
  };

  const handleCardClick = () => {
    if (onOpenReader) {
      onOpenReader();
    }
  };

  return (
    <div className="w-full detail-card p-3.5 rounded-2xl transition-all flex flex-col overflow-hidden mb-2">
      <div className="flex flex-wrap sm:flex-nowrap justify-between items-center gap-2 mb-1.5">
        <h4 className="font-semibold text-blue-300 [.light-theme_&]:!text-blue-700 text-sm truncate">
          备用开场白 {index + 1}
        </h4>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {!isEditing && (
            <button 
              onClick={handleEdit} 
              className="p-1 hover:bg-white/10 rounded text-white/60 hover:text-white transition [.light-theme_&]:text-slate-400 [.light-theme_&]:hover:text-slate-800 cursor-pointer"
              title="编辑"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button 
            onClick={onDelete} 
            className="p-1 hover:bg-red-500/20 rounded text-white/60 hover:text-red-400 transition [.light-theme_&]:text-slate-400 [.light-theme_&]:hover:text-red-500 cursor-pointer"
            title="删除"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      
      {isEditing ? (
        <div className="w-full flex flex-col gap-2 mt-1">
          <textarea 
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            className="w-full bg-black/30 border border-white/10 rounded-xl p-3.5 text-white text-sm sm:text-base leading-relaxed focus:outline-none focus:border-blue-500 min-h-[220px] resize-none [.light-theme_&]:!bg-black/5 [.light-theme_&]:!border-black/10 [.light-theme_&]:!text-[#0f172a]"
            autoFocus
          />
          <div className="flex justify-end gap-3 pt-1">
            <button 
              onClick={() => { setIsEditing(false); setEditValue(content); }}
              className="px-4 py-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/5 text-xs sm:text-sm transition [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:text-[#1c1c1e] [.light-theme_&]:hover:bg-black/10 cursor-pointer"
            >
              取消
            </button>
            <button 
              onClick={handleSave} 
              className="px-5 py-1.5 rounded-full font-bold text-xs sm:text-sm bg-white text-black hover:bg-neutral-200 [.light-theme_&]:!bg-black [.light-theme_&]:!text-white [.light-theme_&]:hover:!bg-neutral-800 transition flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Save className="w-3.5 h-3.5 stroke-[2.5]" />
              保存
            </button>
          </div>
        </div>
      ) : (
        <div className="w-full">
          <div 
            className="group cursor-pointer w-full"
            onClick={handleCardClick}
          >
            <div className="detail-card-text-muted text-sm line-clamp-3 break-words w-full">
              <FormattedCardContent content={content} character={character} clampLines={3} />
            </div>
            <div className="mt-1.5 text-[#60A5FA] [.light-theme_&]:!text-blue-600 group-hover:text-blue-400 [.light-theme_&]:group-hover:!text-blue-700 text-xs font-medium flex items-center gap-1 transition-colors">
              <span>展开全文</span>
              <ChevronDown className="w-3 h-3" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ 
  title, 
  content, 
  character,
  onSave, 
  onOpenReader,
  onOpenEdit 
}: { 
  title: string; 
  content?: string; 
  character?: CharacterCard | null;
  onSave?: (val: string) => void; 
  onOpenReader?: () => void;
  onOpenEdit?: () => void;
}) {
  const [isAdding, setIsAdding] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between border-b border-white/10 [.light-theme_&]:!border-[#e2e8f0] pb-2 mb-3">
        <h3 className="text-lg font-semibold text-white/90 [.light-theme_&]:!text-[#0f172a]">{title}</h3>
        <div className="flex items-center gap-1.5">
          {(!content || content.trim() === '') && onSave && (
            <button 
              onClick={() => {
                if (onOpenEdit) {
                  onOpenEdit();
                } else {
                  setIsAdding(true);
                }
              }} 
              className="px-2.5 py-1 rounded-full text-xs sm:text-sm font-medium flex items-center gap-1 transition cursor-pointer active:scale-95 bg-transparent hover:bg-white/10 text-white [.light-theme_&]:!bg-transparent [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:hover:!bg-black/5 border-0 outline-none"
            >
              <Plus className="w-3.5 h-3.5 text-white [.light-theme_&]:!text-[#0f172a]" />
              <span>添加</span>
            </button>
          )}
        </div>
      </div>
      {content && content.trim() !== '' ? (
        <TextPreview 
          title={title} 
          content={content || ''} 
          character={character} 
          onSave={onSave} 
          onOpenReader={onOpenReader}
          onOpenEdit={onOpenEdit}
        />
      ) : (
        <div 
          className={`w-full p-3.5 rounded-2xl transition-all flex flex-col overflow-hidden mb-2 bg-transparent border-0 shadow-none [.light-theme_&]:!bg-transparent [.light-theme_&]:!border-none [.light-theme_&]:!shadow-none ${onSave || onOpenEdit ? 'cursor-pointer hover:bg-white/5 [.light-theme_&]:hover:!bg-black/5' : ''}`}
          onClick={() => {
            if (onOpenEdit) {
              onOpenEdit();
            } else if (onSave) {
              setIsAdding(true);
            }
          }}
        >
          <div className="text-white/40 [.light-theme_&]:!text-slate-400 text-sm italic">
            暂无内容
          </div>
        </div>
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
                    className="w-full bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-blue-500 transition [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10 [.light-theme_&]:text-[#1c1c1e]"
                    placeholder="条目的标题，不影响匹配"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1 [.light-theme_&]:text-[#1c1c1e]">关键词 (逗号分隔)</label>
                  <input 
                    type="text" 
                    value={(editingEntry.keys || []).join(', ')}
                    onChange={(e) => setEditingEntry({...editingEntry, keys: e.target.value.split(',').map((k: string)=>k.trim()).filter((k: string)=>k)})}
                    className="w-full bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-blue-500 transition [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10 [.light-theme_&]:text-[#1c1c1e]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-1 [.light-theme_&]:text-[#1c1c1e]">插入顺序 (Order)</label>
                    <input 
                      type="number" 
                      value={editingEntry.order ?? 100}
                      onChange={(e) => setEditingEntry({...editingEntry, order: parseInt(e.target.value) || 0})}
                      className="w-full bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-blue-500 transition [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10 [.light-theme_&]:text-[#1c1c1e]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-1 [.light-theme_&]:text-[#1c1c1e]">插入位置 (Position)</label>
                    <select
                      value={editingEntry.extensions?.position ?? editingEntry.position ?? 1}
                      onChange={(e) => setEditingEntry({...editingEntry, extensions: {...(editingEntry.extensions || {}), position: parseInt(e.target.value)}})}
                      className="w-full bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-blue-500 transition [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10 [.light-theme_&]:text-[#1c1c1e]"
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
                      className="rounded bg-black/30 border-white/10 text-blue-500 focus:ring-blue-500/20 [.light-theme_&]:bg-white [.light-theme_&]:border-black/20"
                    />
                    常驻激活 (Constant)
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-white/70 [.light-theme_&]:text-[#1c1c1e]">
                    <input 
                      type="checkbox"
                      checked={editingEntry.selective !== false}
                      onChange={(e) => setEditingEntry({...editingEntry, selective: e.target.checked})}
                      className="rounded bg-black/30 border-white/10 text-blue-500 focus:ring-blue-500/20 [.light-theme_&]:bg-white [.light-theme_&]:border-black/20"
                    />
                    条件触发 (Selective)
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/70 mb-1 [.light-theme_&]:text-[#1c1c1e]">内容</label>
                  <textarea 
                    value={editingEntry.content || editingEntry.entry || ''}
                    onChange={(e) => setEditingEntry({...editingEntry, content: e.target.value, entry: e.target.value})}
                    className="w-full bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-blue-500 transition min-h-[150px] resize-none [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10 [.light-theme_&]:text-[#1c1c1e]"
                  />
                </div>
              </div>

              <div className="flex-none p-4 sm:p-6 border-t border-white/10 bg-black/20 flex justify-end gap-3 [.light-theme_&]:border-black/5 [.light-theme_&]:bg-black/5">
                <button 
                  onClick={() => {
                    setEditingEntryIndex(null);
                    setEditingEntry(null);
                  }} 
                  className="px-4 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:text-[#1c1c1e] [.light-theme_&]:hover:bg-black/10 cursor-pointer"
                >
                  取消
                </button>
                <button 
                  onClick={saveEntry} 
                  className="px-6 py-2 rounded-full font-bold text-xs sm:text-sm bg-white text-black hover:bg-neutral-200 [.light-theme_&]:!bg-black [.light-theme_&]:!text-white [.light-theme_&]:hover:!bg-neutral-800 transition flex items-center gap-2 shadow-sm cursor-pointer"
                >
                  <Save className="w-4 h-4 stroke-[2.5]" />
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
          <h2 className="text-xl font-bold text-white/90 [.light-theme_&]:!text-[#0f172a] mb-1">
            {book.name || (book.data && book.data.name) || 'Worldbook'}
          </h2>
          <p className="text-sm text-white/60 [.light-theme_&]:!text-[#64748b]">
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
            className="w-9 h-9 rounded-full soft-pill flex items-center justify-center transition active:scale-95 cursor-pointer shadow-xs"
            title={getDownloadTooltip("导出世界书")}
          >
            <Download className="w-4.5 h-4.5 opacity-80" />
          </button>
          <button 
            onClick={() => setShowControls(!showControls)}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition active:scale-95 cursor-pointer shadow-xs focus:outline-none focus:ring-0 ${
              showControls 
                ? 'bg-blue-600 text-white border border-blue-500 shadow-sm [.light-theme_&]:!border-blue-600' 
                : 'soft-pill'
            }`}
            title="管理世界书"
          >
            <Edit2 className="w-4.5 h-4.5 opacity-80" />
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
              className="soft-pill flex-1 py-2 rounded-xl text-sm font-medium transition flex items-center justify-center gap-2 cursor-pointer shadow-xs"
            >
              <Plus className="w-4 h-4" /> 添加条目
            </button>
            <button 
              onClick={onDelete}
              className="flex-1 py-2 bg-red-500/15 hover:bg-red-500/25 text-rose-400 [.light-theme_&]:!bg-rose-50 [.light-theme_&]:!text-rose-600 border border-rose-500/20 [.light-theme_&]:!border-rose-200 rounded-xl text-sm font-medium transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" /> 删除世界书
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      
      <div className="space-y-3">
        {entries.length === 0 ? (
          <div className="w-full detail-card p-8 rounded-2xl flex flex-col items-center justify-center text-center">
            <Book className="w-12 h-12 mb-3 opacity-40 text-slate-400 [.light-theme_&]:!text-slate-500" />
            <p className="detail-card-text text-sm font-medium">世界书中暂无条目</p>
            <p className="detail-card-text-muted text-xs mt-1">请点击上方管理或添加条目</p>
          </div>
        ) : (
          entries.map((entry: any, i: number) => {
            const isEnabled = entry.disable !== undefined ? !entry.disable : entry.enabled !== false;
            const keysArray = entry.key || entry.keys || [];
            const keysDisplay = Array.isArray(keysArray) ? keysArray.join(', ') : keysArray;
            const title = entry.comment || entry.name || keysDisplay || '无标题';
            const order = entry.order !== undefined ? entry.order : (entry.insertion_order || 50);

            return (
              <div key={i} className={`w-full detail-card p-3.5 rounded-2xl ${isEnabled ? '' : 'opacity-60'} flex gap-3 transition-opacity overflow-hidden mb-2`}>
                <div className="flex-1 min-w-0 w-full">
                  <div className="flex flex-wrap sm:flex-nowrap justify-between items-start gap-2 mb-1 w-full">
                    <div className="flex flex-col min-w-0 flex-1">
                      <h4 className="font-semibold text-blue-300 [.light-theme_&]:!text-blue-700 truncate">
                        {title}
                      </h4>
                      {keysDisplay && keysDisplay !== title && (
                        <p className="text-xs text-white/40 [.light-theme_&]:!text-slate-400 truncate mt-0.5">
                          关键词: {keysDisplay}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                      <button
                        onClick={() => handleToggleEnable(i)}
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition whitespace-nowrap border ${isEnabled ? 'bg-green-500/10 text-green-400 border-green-500/20 [.light-theme_&]:!bg-[#E7F9EE] [.light-theme_&]:!text-[#1DB954] [.light-theme_&]:!border-[#1DB954]/20' : 'bg-white/5 text-white/30 border-white/5 [.light-theme_&]:!bg-[#F2F2F7] [.light-theme_&]:!text-[#8E8E93] [.light-theme_&]:!border-transparent'}`}
                      >
                        {isEnabled ? '已启用' : '已禁用'}
                      </button>
                      <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-full text-white/70 border border-white/10 [.light-theme_&]:!bg-[#F2F2F7] [.light-theme_&]:!text-[#3A3A3C] [.light-theme_&]:!border-transparent whitespace-nowrap font-bold shadow-sm">
                        顺序: {order}
                      </span>
                      <button onClick={() => handleEdit(i)} className="p-1 hover:bg-white/10 rounded text-white/60 hover:text-white transition [.light-theme_&]:text-slate-400 [.light-theme_&]:hover:text-slate-800">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(i)} className="p-1 hover:bg-red-500/20 rounded text-white/60 hover:text-red-400 transition [.light-theme_&]:text-slate-400 [.light-theme_&]:hover:text-red-500">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div 
                    className="group cursor-pointer mt-2 w-full"
                    onClick={() => setViewingEntryIndex(viewingEntryIndex === i ? null : i)}
                  >
                    {viewingEntryIndex === i ? (
                      <div className="detail-card-text whitespace-pre-wrap text-sm leading-relaxed pr-2 break-words w-full" onClick={e => e.stopPropagation()}>
                        {entry.content || entry.entry || ''}
                        <button 
                          onClick={(e) => { e.stopPropagation(); setViewingEntryIndex(null); }}
                          className="mt-3 flex items-center justify-center gap-1 text-[#60A5FA] [.light-theme_&]:!text-blue-600 text-xs font-medium py-1.5 hover:bg-[#60A5FA]/10 [.light-theme_&]:hover:bg-blue-50 rounded-lg transition w-full cursor-pointer"
                        >
                          <ChevronUp className="w-3.5 h-3.5" /> 收起 
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="detail-card-text-muted text-sm line-clamp-3 break-words w-full">{entry.content || entry.entry || ''}</div>
                        <div className="mt-1.5 text-[#60A5FA] [.light-theme_&]:!text-blue-600 group-hover:text-blue-400 [.light-theme_&]:group-hover:!text-blue-700 text-xs font-medium flex items-center gap-1 transition-colors">
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
