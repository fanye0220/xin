import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Cropper from 'react-easy-crop';
import {
  ArrowLeft,
  Plus,
  Search,
  User,
  Star,
  Send,
  Trash2,
  Edit2,
  Check,
  X as XIcon,
  Camera,
  Loader2,
  Save,
  Image as ImageIcon,
  FolderOpen,
  ChevronRight,
  Link2,
  Smartphone,
  Download,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import {
  UserPersona,
  CharMeta,
  getUserPersonas,
  saveUserPersona,
  deleteUserPersona,
  getCachedMeta,
  getCharacterThumb,
} from '../lib/db';
import { getFallbackAvatar, resolveAvatarUrl, safeCreateObjectURL, isFallbackMiuImage } from '../lib/avatar';
import { getLocalImageUrl, isAndroid } from '../lib/appBridge';
import { peekCachedUrl, putCachedBlobUrl } from '../lib/thumbCache';
import { getAISettings, normalizeSillyTavernUrl, getSillyTavernAuthHeaders } from '../lib/ai';
import {
  isLocalLinkSupported,
  getLocalReceiverStatus,
  pushFilesToOutbox,
  requestTavernPull,
  getTavernPullState,
  setTavernPullPicks,
  cancelTavernPull,
  pullCardById,
  getTavernPullThumb,
  requestTavernThumbs,
  type TavernCardInfo,
  type TavernPullState,
} from '../lib/localLink';
import { useBackHandler } from '../lib/useBackHandler';

interface Props {
  onClose: () => void;
  isLightMode?: boolean;
}

/** 获取酒馆 CSRF Token */
async function readTavernCsrf(stUrl: string, authHeaders: Record<string, string>) {
  try {
    const res = await fetch(`${stUrl}/csrf-token`, { headers: authHeaders, cache: 'no-store' });
    if (!res.ok) return '';
    const data = await res.json().catch(() => ({}));
    return data.token || '';
  } catch {
    return '';
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob | undefined {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return undefined;
  try {
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1) return undefined;
    const header = dataUrl.slice(5, commaIdx);
    const mime = header.split(';')[0] || 'image/png';
    const b64 = dataUrl.slice(commaIdx + 1);
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  } catch {
    return undefined;
  }
}

/** 生成用于 SillyTavern 人设槽位的新 PNG 头像（确保每推一次都是独立人设 key，不覆盖同名/原有人设） */
async function personaBlobToPng(blob: Blob | undefined, name: string): Promise<Blob> {
  if (blob) {
    const objUrl = safeCreateObjectURL(blob);
    if (objUrl) {
      try {
        const img = new Image();
        img.src = objUrl;
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('decode failed'));
        });
        const maxSide = 512;
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const w = Math.max(1, Math.round((img.naturalWidth || 256) * scale));
        const h = Math.max(1, Math.round((img.naturalHeight || 256) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
          if (png && png.size > 0) return png;
        }
      } catch {
        // Fallback to monogram avatar below
      } finally {
        if (objUrl.startsWith('blob:')) URL.revokeObjectURL(objUrl);
      }
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, '#1e293b');
    grad.addColorStop(1, '#0f172a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    ctx.fillStyle = 'rgba(59, 130, 246, 0.22)';
    ctx.beginPath();
    ctx.arc(210, 46, 72, 0, Math.PI * 2);
    ctx.fill();

    const ch = Array.from((name || 'U').trim() || 'U')[0] || 'U';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 112px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, 128, 134);
  }
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('生成人设头像 PNG 失败');
  return png;
}

function sanitizeSafeFileName(name: string): string {
  const cleaned = String(name || 'miu_persona')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
  return cleaned || 'miu_persona';
}

interface StPersonaItem {
  id: string;
  avatarKey: string;
  name: string;
  content: string;
  isActive: boolean;
}

/** 酒馆 User 人设头像的候选地址：新版走 persona 缩略图，老版本走 /User%20Avatars 静态目录。 */
function personaThumbUrls(stUrl: string, avatarKey: string): string[] {
  const base = String(stUrl || '').replace(/\/+$/, '');
  if (!base || !avatarKey) return [];
  const key = encodeURIComponent(avatarKey);
  return [
    `${base}/thumbnail?type=persona&file=${key}`,
    `${base}/User%20Avatars/${key}`,
  ];
}

const stPersonaAvatarCache = new Map<string, string>();

/**
 * 安卓 WebView 会把 http 图片当混合内容拦掉，HTTP 请求也可能被 CORS 拦，
 * 所以人设头像和角色卡一样走原生桥取 base64。网页版仍走下面的网络候选。
 */
function nativeStPersonaAvatar(stUrl: string, avatarKey: string): string | null {
  if (!stUrl || !avatarKey) return null;
  const cacheKey = `${stUrl}|${avatarKey}`;
  const cached = stPersonaAvatarCache.get(cacheKey);
  if (cached) return cached;
  if (!isAndroid()) return null;
  const bridge = (window as any).Android;
  if (!bridge || typeof bridge.fetchTavernPersonaAvatarAsDataUrl !== 'function') return null;
  try {
    const settings = getAISettings();
    const dataUrl = bridge.fetchTavernPersonaAvatarAsDataUrl(
      stUrl,
      avatarKey,
      settings.sillyTavernUsername || '',
      settings.sillyTavernPassword || '',
    );
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image')) {
      stPersonaAvatarCache.set(cacheKey, dataUrl);
      return dataUrl;
    }
  } catch {
    /* 原生取不到时回落到网络请求 */
  }
  return null;
}

/** 取人设头像字节：先不带头（避免 CORS 预检），失败再带鉴权头，多个地址依次试。 */
async function fetchTavernPersonaAvatar(
  stUrl: string,
  avatarKey: string,
  authHeaders: Record<string, string>,
): Promise<Blob | undefined> {
  const nativeDataUrl = nativeStPersonaAvatar(stUrl, avatarKey);
  if (nativeDataUrl) {
    try {
      const blob = await (await fetch(nativeDataUrl)).blob();
      if (blob.size > 0) return blob;
    } catch {
      /* 继续走网络候选 */
    }
  }
  const urls = personaThumbUrls(stUrl, avatarKey);
  if (urls.length === 0) return undefined;
  const headerSets: Record<string, string>[] = Object.keys(authHeaders || {}).length
    ? [{}, authHeaders]
    : [{}];
  for (const headers of headerSets) {
    for (const url of urls) {
      try {
        const res = await fetch(url, { headers, credentials: 'include' });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (!blob || blob.size === 0) continue;
        if (blob.type && blob.type.includes('html')) continue;
        return blob;
      } catch {
        /* 换下一个地址 */
      }
    }
  }
  return undefined;
}

function StPersonaThumb({
  stUrl,
  authHeaders,
  avatarKey,
  name,
}: {
  stUrl: string;
  authHeaders: Record<string, string>;
  avatarKey: string;
  name: string;
}) {
  const fallback = getFallbackAvatar(name || avatarKey);
  const [src, setSrc] = useState<string>(fallback);

  useEffect(() => {
    let active = true;
    let objUrl = '';
    const candidates = personaThumbUrls(stUrl, avatarKey);
    if (candidates.length === 0) {
      setSrc(fallback);
      return () => {};
    }
    setSrc(fallback);

    const nativeDataUrl = nativeStPersonaAvatar(stUrl, avatarKey);
    if (nativeDataUrl) {
      setSrc(nativeDataUrl);
      return () => { active = false; };
    }

    const tryFetch = async () => {
      const blob = await fetchTavernPersonaAvatar(stUrl, avatarKey, authHeaders);
      if (!active) return;
      if (!blob) {
        setSrc(fallback);
        return;
      }
      objUrl = URL.createObjectURL(blob);
      setSrc(objUrl);
    };

    // 图片路由大多不返回 CORS 头，所以先用 <img> 直接试；都不行再走 fetch + 鉴权头。
    const tryImage = (index: number) => {
      if (!active) return;
      if (index >= candidates.length) {
        void tryFetch();
        return;
      }
      const probe = new Image();
      probe.onload = () => {
        if (active && probe.naturalWidth > 0) setSrc(candidates[index]);
        else tryImage(index + 1);
      };
      probe.onerror = () => tryImage(index + 1);
      probe.src = candidates[index];
    };
    tryImage(0);

    return () => {
      active = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [stUrl, avatarKey, authHeaders]);

  const isFb = isFallbackMiuImage(src);
  return (
    <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0 bg-white/5 [.light-theme_&]:!bg-[#f1f5f9] flex items-center justify-center">
      <img
        src={src}
        alt={name}
        className={`w-full h-full ${isFb ? 'object-contain p-1.5 bg-white' : 'object-cover'}`}
        onError={() => {
          if (src !== fallback) setSrc(fallback);
        }}
      />
    </div>
  );
}

const pendingTtPersonaThumbs = new Set<string>();
let pendingTtPersonaThumbTimer = 0;

function queueTtPersonaThumb(avatar: string) {
  if (!avatar) return;
  pendingTtPersonaThumbs.add(avatar);
  if (pendingTtPersonaThumbTimer) return;
  pendingTtPersonaThumbTimer = window.setTimeout(() => {
    pendingTtPersonaThumbTimer = 0;
    const batch = Array.from(pendingTtPersonaThumbs);
    pendingTtPersonaThumbs.clear();
    if (batch.length) requestTavernThumbs(batch);
  }, 250);
}

function TtPersonaThumb({ avatar, rev }: { avatar: string; rev: number }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!avatar) return;
    const ready = getTavernPullThumb(avatar);
    if (ready) {
      setUrl(ready);
      return;
    }
    queueTtPersonaThumb(avatar);
  }, [avatar, rev]);

  return (
    <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0 bg-white/5 [.light-theme_&]:!bg-[#f1f5f9] flex items-center justify-center">
      {url ? (
        <img
          src={url}
          alt=""
          className={`w-full h-full ${isFallbackMiuImage(url) ? 'object-contain p-1 bg-white' : 'object-cover'}`}
        />
      ) : (
        <User className="w-5 h-5 text-blue-400 [.light-theme_&]:!text-[#007aff]" />
      )}
    </div>
  );
}

/** 轻量角色缩略图组件：复用全局有界 LRU 缩略图缓存 */
function CharThumbImg({ char, className }: { char: CharMeta; className: string }) {
  const defaultFallback = getFallbackAvatar(char.name || char.id, char.tags?.join(','));
  const [url, setUrl] = useState<string>(() => resolveAvatarUrl(char.avatarUrlFallback, char.name || char.id));

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

    getCharacterThumb(char.id)
      .then((thumbBlob) => {
        if (!isMounted) return;
        if (thumbBlob) {
          const blobUrl = putCachedBlobUrl(thumbCacheKey, thumbBlob);
          if (blobUrl) setUrl(blobUrl);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [char.id, char.updatedAt, char.localFilePath, char.avatarUrlFallback]);

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

/** 独立人设卡片项，安全管理每个卡片的 ObjectURL 生命周期 */
function PersonaCardItem({
  persona,
  onClick,
}: {
  persona: UserPersona;
  onClick: () => void;
}) {
  const defaultFallback = getFallbackAvatar(persona.name || persona.id);
  const [url, setUrl] = useState<string>(() => {
    if (persona.avatarUrlFallback && !isFallbackMiuImage(persona.avatarUrlFallback)) {
      return persona.avatarUrlFallback;
    }
    return defaultFallback;
  });

  useEffect(() => {
    let createdUrl: string | null = null;
    if (persona.avatarBlob) {
      createdUrl = safeCreateObjectURL(persona.avatarBlob);
      if (createdUrl) {
        setUrl(createdUrl);
      } else {
        setUrl(persona.avatarUrlFallback || defaultFallback);
      }
    } else if (persona.avatarUrlFallback) {
      setUrl(persona.avatarUrlFallback);
    } else {
      setUrl(defaultFallback);
    }

    return () => {
      if (createdUrl && createdUrl.startsWith('blob:')) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [persona.avatarBlob, persona.avatarUrlFallback, defaultFallback]);

  const isFallback = isFallbackMiuImage(url);
  const boundCount = persona.boundCharacterIds?.length || 0;

  return (
    <motion.div
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      className="relative aspect-[2/3] rounded-2xl overflow-hidden cursor-pointer shadow-lg border-0 [.light-theme_&]:border-0 transition-transform duration-150 group select-none bg-white/5"
    >
      <img
        src={url}
        alt={persona.name}
        loading="lazy"
        decoding="async"
        className={`w-full h-full pointer-events-none ${
          isFallback ? 'object-contain p-6 sm:p-8 bg-white' : 'object-cover'
        }`}
        onError={() => {
          if (url !== defaultFallback) {
            setUrl(defaultFallback);
          }
        }}
      />

      {/* 底部渐变蒙层与标题 */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/20 to-transparent flex flex-col justify-end p-3 pointer-events-none z-[3]">
        <h3 className="font-semibold !text-white text-sm sm:text-base leading-tight drop-shadow-[0_1.5px_4px_rgba(0,0,0,0.95)] truncate">
          {persona.name}
        </h3>
      </div>

      {/* 左上角默认状态角标 */}
      {persona.isDefault && (
        <div className="absolute top-2 left-2 z-10 px-2 py-0.5 bg-black/45 backdrop-blur-md rounded-md text-[10px] font-medium text-white/95 border border-white/15 flex items-center gap-1.5 shadow-sm pointer-events-none select-none">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
          <span>默认</span>
        </div>
      )}

      {/* 右上角挂载角色数量角标 */}
      {boundCount > 0 && (
        <div className="absolute top-2 right-2 z-10 px-1.5 py-0.5 bg-black/45 backdrop-blur-md rounded-md text-[10px] font-medium text-white/95 border border-white/15 flex items-center gap-1 shadow-sm pointer-events-none select-none">
          <Link2 className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
          <span>{boundCount}</span>
        </div>
      )}
    </motion.div>
  );
}

export function UserPersonaManager({ onClose, isLightMode }: Props) {
  const [personas, setPersonas] = useState<UserPersona[]>([]);
  const [charMetas, setCharMetas] = useState<CharMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Detail view states (activeId: null = list view, 'new' = creating new, string = viewing/editing existing)
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<UserPersona> | null>(null);
  const [draftAvatarUrl, setDraftAvatarUrl] = useState<string>('');

  // Inline editing states in Detail view
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [editContentValue, setEditContentValue] = useState('');

  // Feedback & Modals
  const [toastFeedback, setToastFeedback] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [isSendingToST, setIsSendingToST] = useState(false);
  const [isSendingToTT, setIsSendingToTT] = useState(false);
  const [showSendChoice, setShowSendChoice] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAvatarSheet, setShowAvatarSheet] = useState(false);
  const [showCharPicker, setShowCharPicker] = useState(false);
  const [charPickerSearch, setCharPickerSearch] = useState('');

  // Pull modal states (ST API + TT Link)
  const [showPullModal, setShowPullModal] = useState(false);
  const [pullSource, setPullSource] = useState<'st' | 'tt'>('st');
  const [pullSearch, setPullSearch] = useState('');
  const [stPullLoading, setStPullLoading] = useState(false);
  const [stPullImporting, setStPullImporting] = useState(false);
  const [stPullError, setStPullError] = useState('');
  const [stPullList, setStPullList] = useState<StPersonaItem[]>([]);
  const [stSelectedIds, setStSelectedIds] = useState<Set<string>>(new Set());
  const [stConnInfo, setStConnInfo] = useState<{ stUrl: string; authHeaders: Record<string, string> }>({
    stUrl: '',
    authHeaders: {},
  });
  const [ttPullState, setTtPullState] = useState<TavernPullState>(() => getTavernPullState());
  const [ttPullList, setTtPullList] = useState<TavernCardInfo[]>([]);
  const [ttSelectedIds, setTtSelectedIds] = useState<Set<string>>(new Set());
  const [ttWaitingList, setTtWaitingList] = useState(false);
  const [ttImporting, setTtImporting] = useState(false);
  const [ttNotice, setTtNotice] = useState('');
  const ttStoredListAtRef = useRef(0);
  const ttImportedRef = useRef(false);

  // Avatar cropper states
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);

  const galleryInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success', duration = 3000) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastFeedback({ msg, type });
    toastTimerRef.current = setTimeout(() => {
      setToastFeedback(null);
    }, duration);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const loadPersonas = async () => {
    setLoading(true);
    try {
      const list = await getUserPersonas();
      setPersonas(list);
      return list;
    } catch (e) {
      console.error('Failed to load user personas', e);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const loadCharMetas = async () => {
    try {
      const allMeta = await getCachedMeta();
      const filtered = allMeta.filter(
        (m) =>
          !m.deletedAt &&
          !m.isTool &&
          !m.isQR &&
          (!m.dupResType || m.dupResType === 'character') &&
          !['预设', '美化', '世界书', '快速回复', '脚本'].includes(m.category || ''),
      );
      setCharMetas(filtered);
    } catch (e) {
      console.error('Failed to load char metas', e);
    }
  };

  useEffect(() => {
    loadPersonas();
    loadCharMetas();
    const handlePersonasUpdated = () => {
      loadPersonas();
    };
    window.addEventListener('userPersonasUpdated', handlePersonasUpdated);
    return () => window.removeEventListener('userPersonasUpdated', handlePersonasUpdated);
  }, []);

  const charMetaMap = useMemo(() => {
    const map = new Map<string, CharMeta>();
    for (const m of charMetas) map.set(m.id, m);
    return map;
  }, [charMetas]);

  // Fast map of charId -> persona name for picker conflict hints
  const charToPersonaMap = useMemo(() => {
    const map = new Map<string, UserPersona>();
    for (const p of personas) {
      for (const cid of p.boundCharacterIds || []) {
        map.set(cid, p);
      }
    }
    return map;
  }, [personas]);

  // Manage draft avatar ObjectURL cleanly
  useEffect(() => {
    let createdUrl: string | null = null;
    const fallback = getFallbackAvatar(draft?.name || draft?.id || 'user');
    if (draft?.avatarBlob) {
      createdUrl = safeCreateObjectURL(draft.avatarBlob);
      setDraftAvatarUrl(createdUrl || draft.avatarUrlFallback || fallback);
    } else if (draft?.avatarUrlFallback) {
      setDraftAvatarUrl(draft.avatarUrlFallback);
    } else {
      setDraftAvatarUrl(fallback);
    }

    return () => {
      if (createdUrl && createdUrl.startsWith('blob:')) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [draft?.avatarBlob, draft?.avatarUrlFallback, draft?.name, draft?.id]);

  // Hardware / swipe back handler
  useBackHandler(
    activeId !== null || showDeleteConfirm || showAvatarSheet || showCharPicker || showSendChoice || showPullModal || !!imageToCrop,
    () => {
      if (imageToCrop) {
        closeCrop();
        return true;
      }
      if (showPullModal) {
        handleClosePullModal();
        return true;
      }
      if (showSendChoice) {
        setShowSendChoice(false);
        return true;
      }
      if (showCharPicker) {
        setShowCharPicker(false);
        return true;
      }
      if (showAvatarSheet) {
        setShowAvatarSheet(false);
        return true;
      }
      if (showDeleteConfirm) {
        setShowDeleteConfirm(false);
        return true;
      }
      if (activeId !== null) {
        handleCloseDetail();
        return true;
      }
      return false;
    },
  );

  const openPersonaDetail = (persona: UserPersona) => {
    setActiveId(persona.id);
    setDraft({ ...persona });
    setEditNameValue(persona.name);
    setEditContentValue(persona.content || '');
    setIsEditingName(false);
    setIsEditingContent(false);
    setShowDeleteConfirm(false);
  };

  const openCreateNew = () => {
    const newId = crypto.randomUUID();
    setActiveId('new');
    setDraft({
      id: newId,
      name: '',
      content: '',
      isDefault: personas.length === 0,
      boundCharacterIds: [],
    });
    setEditNameValue('');
    setEditContentValue('');
    setIsEditingName(true);
    setIsEditingContent(true);
    setShowDeleteConfirm(false);
  };

  const handleCloseDetail = () => {
    setActiveId(null);
    setDraft(null);
    setIsEditingName(false);
    setIsEditingContent(false);
    setShowDeleteConfirm(false);
    setShowCharPicker(false);
  };

  const persistPersona = async (personaData: UserPersona, successMsg?: string) => {
    const now = Date.now();
    const toSave: UserPersona = {
      ...personaData,
      name: personaData.name.trim(),
      updatedAt: now,
    };

    await saveUserPersona(toSave);
    await loadPersonas();
    setDraft(toSave);
    setActiveId(toSave.id);
    window.dispatchEvent(new CustomEvent('userPersonasUpdated'));
    if (successMsg) {
      showToast(successMsg, 'success');
    }
    return toSave;
  };

  const handleCreateOrSaveAll = async () => {
    const trimmedName = (isEditingName ? editNameValue : draft?.name || '').trim();
    if (!trimmedName) {
      showToast('请输入 User 人设名称', 'error');
      setIsEditingName(true);
      return;
    }

    const finalContent = isEditingContent ? editContentValue : draft?.content || '';
    const now = Date.now();
    const personaToSave: UserPersona = {
      id: draft?.id || crypto.randomUUID(),
      name: trimmedName,
      content: finalContent,
      avatarBlob: draft?.avatarBlob,
      avatarUrlFallback: draft?.avatarUrlFallback,
      isDefault: activeId === 'new' && personas.length === 0 ? true : Boolean(draft?.isDefault),
      boundCharacterIds: draft?.boundCharacterIds || [],
      createdAt: draft?.createdAt || now,
      updatedAt: now,
    };

    try {
      await persistPersona(personaToSave, activeId === 'new' ? '已创建并保存 User 人设卡片' : '人设已保存');
      setIsEditingName(false);
      setIsEditingContent(false);
    } catch (err: any) {
      showToast('保存失败: ' + (err?.message || String(err)), 'error');
    }
  };

  const handleNameSave = async () => {
    const trimmed = editNameValue.trim();
    if (!trimmed) {
      showToast('名称不能为空', 'error');
      return;
    }
    setIsEditingName(false);
    if (activeId === 'new') {
      setDraft((prev) => (prev ? { ...prev, name: trimmed } : prev));
      return;
    }
    if (!draft?.id) return;
    try {
      await persistPersona(
        {
          id: draft.id,
          name: trimmed,
          content: draft.content || '',
          avatarBlob: draft.avatarBlob,
          avatarUrlFallback: draft.avatarUrlFallback,
          isDefault: Boolean(draft.isDefault),
          boundCharacterIds: draft.boundCharacterIds || [],
          createdAt: draft.createdAt || Date.now(),
          updatedAt: Date.now(),
        },
        '名称已更新',
      );
    } catch (err: any) {
      showToast('保存名称失败: ' + (err?.message || String(err)), 'error');
    }
  };

  const handleContentSave = async () => {
    setIsEditingContent(false);
    if (activeId === 'new') {
      setDraft((prev) => (prev ? { ...prev, content: editContentValue } : prev));
      return;
    }
    if (!draft?.id) return;
    try {
      await persistPersona(
        {
          id: draft.id,
          name: draft.name || '未命名 User',
          content: editContentValue,
          avatarBlob: draft.avatarBlob,
          avatarUrlFallback: draft.avatarUrlFallback,
          isDefault: Boolean(draft.isDefault),
          boundCharacterIds: draft.boundCharacterIds || [],
          createdAt: draft.createdAt || Date.now(),
          updatedAt: Date.now(),
        },
        '人设正文已保存',
      );
    } catch (err: any) {
      showToast('保存正文失败: ' + (err?.message || String(err)), 'error');
    }
  };

  const handleToggleDefault = async () => {
    if (!draft) return;
    const nextDefault = !draft.isDefault;

    if (activeId === 'new') {
      setDraft((prev) => (prev ? { ...prev, isDefault: nextDefault } : prev));
      return;
    }

    try {
      await persistPersona(
        {
          id: draft.id!,
          name: draft.name || '未命名 User',
          content: draft.content || '',
          avatarBlob: draft.avatarBlob,
          avatarUrlFallback: draft.avatarUrlFallback,
          isDefault: nextDefault,
          boundCharacterIds: draft.boundCharacterIds || [],
          createdAt: draft.createdAt || Date.now(),
          updatedAt: Date.now(),
        },
        nextDefault ? `已将「${draft.name}」设为默认激活人设` : '已取消默认激活状态',
      );
    } catch (err: any) {
      showToast('更新默认状态失败: ' + (err?.message || String(err)), 'error');
    }
  };

  const handleToggleBindChar = async (charId: string) => {
    if (!draft) return;
    const current = Array.isArray(draft.boundCharacterIds) ? draft.boundCharacterIds : [];
    const exists = current.includes(charId);
    const nextBound = exists ? current.filter((id) => id !== charId) : [...current, charId];

    if (activeId === 'new') {
      setDraft((prev) => (prev ? { ...prev, boundCharacterIds: nextBound } : prev));
      return;
    }

    try {
      await persistPersona(
        {
          id: draft.id!,
          name: draft.name || '未命名 User',
          content: draft.content || '',
          avatarBlob: draft.avatarBlob,
          avatarUrlFallback: draft.avatarUrlFallback,
          isDefault: Boolean(draft.isDefault),
          boundCharacterIds: nextBound,
          createdAt: draft.createdAt || Date.now(),
          updatedAt: Date.now(),
        },
        exists ? '已取消角色卡挂载' : `已挂载到角色「${charMetaMap.get(charId)?.name || '未知角色'}」`,
      );
    } catch (err: any) {
      showToast('更新角色挂载失败: ' + (err?.message || String(err)), 'error');
    }
  };

  const handleDelete = async () => {
    if (!draft?.id || activeId === 'new') {
      handleCloseDetail();
      return;
    }
    try {
      await deleteUserPersona(draft.id);
      await loadPersonas();
      window.dispatchEvent(new CustomEvent('userPersonasUpdated'));
      setShowDeleteConfirm(false);
      handleCloseDetail();
      showToast('已删除该 User 人设卡片');
    } catch (err: any) {
      showToast('删除失败: ' + (err?.message || String(err)), 'error');
    }
  };

  const handlePushToSillyTavern = async () => {
    if (!draft || activeId === 'new') {
      showToast('请先保存此人设卡片后再投递到酒馆', 'error');
      return;
    }
    const aiSettings = getAISettings();
    const stUrl = normalizeSillyTavernUrl(aiSettings.sillyTavernUrl);
    if (!stUrl) {
      showToast('请先在「设置」中配置酒馆 API 地址', 'error');
      return;
    }

    setIsSendingToST(true);
    try {
      const authHeaders = getSillyTavernAuthHeaders(aiSettings);
      let csrf = await readTavernCsrf(stUrl, authHeaders);

      const postJsonWithCsrf = async (path: string, bodyObj: any) => {
        const exec = async () => {
          const reqHeaders: Record<string, string> = {
            ...authHeaders,
            'Content-Type': 'application/json',
          };
          if (csrf) reqHeaders['X-CSRF-Token'] = csrf;
          return fetch(`${stUrl}${path}`, {
            method: 'POST',
            headers: reqHeaders,
            body: JSON.stringify(bodyObj),
            cache: 'no-store',
          });
        };
        let r = await exec();
        if (r.status === 403) {
          csrf = await readTavernCsrf(stUrl, authHeaders);
          r = await exec();
        }
        return r;
      };

      const settingsRes = await postJsonWithCsrf('/api/settings/get', {});
      if (!settingsRes.ok) {
        throw new Error(`HTTP ${settingsRes.status}`);
      }

      const settingsData = await settingsRes.json().catch(() => ({} as any));
      const fileText = typeof settingsData?.settings === 'string' ? settingsData.settings : '';
      if (!fileText) {
        throw new Error('没读到酒馆设置文件（可能是版本或权限不对）');
      }

      const settingsFile = JSON.parse(fileText);
      const personaName = (isEditingName ? editNameValue : draft.name || 'User').trim() || 'User';
      const personaContent = isEditingContent ? editContentValue : draft.content || '';

      if (!settingsFile.power_user || typeof settingsFile.power_user !== 'object') {
        settingsFile.power_user = {};
      }
      if (!settingsFile.power_user.personas || typeof settingsFile.power_user.personas !== 'object') {
        settingsFile.power_user.personas = {};
      }
      if (!settingsFile.power_user.persona_descriptions || typeof settingsFile.power_user.persona_descriptions !== 'object') {
        settingsFile.power_user.persona_descriptions = {};
      }

      // 为每次推送生成全新唯一的 User Avatar PNG 文件名，确保在酒馆作为新的人设条目创建，不覆盖原有人设或同名人设
      const existingKeys = new Set(Object.keys(settingsFile.power_user.personas));
      const safeSlug = personaName.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'miu';
      let uniqueFileName = `miu_${safeSlug}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
      while (existingKeys.has(uniqueFileName)) {
        uniqueFileName = `miu_${safeSlug}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
      }

      const pngBlob = await personaBlobToPng(draft.avatarBlob, personaName);

      const uploadAvatar = async (endpoint: string) => {
        const doUpload = async () => {
          const formData = new FormData();
          formData.append('avatar', pngBlob, uniqueFileName);
          formData.append('overwrite_name', uniqueFileName);
          const upHeaders: Record<string, string> = { ...authHeaders };
          if (csrf) upHeaders['X-CSRF-Token'] = csrf;
          return fetch(`${stUrl}${endpoint}`, {
            method: 'POST',
            headers: upHeaders,
            body: formData,
            cache: 'no-store',
          });
        };
        let r = await doUpload();
        if (r.status === 403) {
          csrf = await readTavernCsrf(stUrl, authHeaders);
          r = await doUpload();
        }
        return r;
      };

      let uploadRes = await uploadAvatar('/api/avatars/upload');
      if (uploadRes.status === 404) {
        uploadRes = await uploadAvatar('/uploaduseravatar');
      }
      if (!uploadRes.ok) {
        throw new Error(`上传新头像失败（HTTP ${uploadRes.status}），无法作为新人设创建`);
      }

      const uploadJson = await uploadRes.json().catch(() => ({} as any));
      const rawReturnedPath = typeof uploadJson?.path === 'string' && uploadJson.path.trim()
        ? uploadJson.path.trim()
        : uniqueFileName;
      const newAvatarKey = rawReturnedPath.split('/').pop() || uniqueFileName;

      settingsFile.power_user.personas[newAvatarKey] = personaName;
      settingsFile.power_user.persona_descriptions[newAvatarKey] = {
        description: personaContent,
        position: 0,
        depth: 2,
        role: 0,
        lore: '',
        title: '',
      };

      settingsFile.user_avatar = newAvatarKey;
      settingsFile.name = personaName;
      settingsFile.user_name = personaName;
      settingsFile.user_description = personaContent;
      settingsFile.power_user.persona_description = personaContent;

      const saveRes = await postJsonWithCsrf('/api/settings/save', settingsFile);
      if (!saveRes.ok) {
        throw new Error(`HTTP ${saveRes.status}: ${await saveRes.text()}`);
      }

      showToast(`已将「${personaName}」作为新人设投递到酒馆`, 'success', 4000);
    } catch (err: any) {
      showToast(`投递失败：${err?.message || err}`, 'error', 4000);
    } finally {
      setIsSendingToST(false);
    }
  };

  /** 发送人设到 TT 联动（待发送队列） */
  const handlePushToTT = async () => {
    if (!draft || activeId === 'new') {
      showToast('请先保存此人设卡片后再发送', 'error');
      return;
    }
    if (!isLocalLinkSupported()) {
      showToast('当前环境不支持 TT 联动，请在安卓 App 里使用', 'error');
      return;
    }

    setIsSendingToTT(true);
    try {
      const personaName = (isEditingName ? editNameValue : draft.name || 'User').trim() || 'User';
      const personaContent = isEditingContent ? editContentValue : draft.content || '';
      let avatarDataUrl: string | undefined;
      if (draft.avatarBlob) {
        try {
          avatarDataUrl = await blobToDataUrl(draft.avatarBlob);
        } catch {
          avatarDataUrl = undefined;
        }
      }

      const payload = {
        format: 'miu-persona-v1',
        kind: 'persona',
        name: personaName,
        description: personaContent,
        content: personaContent,
        isDefault: Boolean(draft.isDefault),
        ...(avatarDataUrl ? { avatarDataUrl } : {}),
        updatedAt: Date.now(),
      };

      const safeName = sanitizeSafeFileName(personaName);
      const file = new File(
        [new TextEncoder().encode(JSON.stringify(payload, null, 2))],
        `${safeName}.persona.json`,
        { type: 'application/json' },
      );

      const result = await pushFilesToOutbox([file]);
      if (result.added > 0) {
        const running = getLocalReceiverStatus().running;
        showToast(
          running
            ? '已排队，切到酒馆 → 扩展面板 → MIU 联动 → 点「接收 MIU 推送」'
            : '已排队；记得先去「设置 → TauriTavern」开启接收服务',
          'success',
          5000,
        );
      } else {
        showToast('发送失败：内容为空或超过 32MB', 'error');
      }
    } catch (err: any) {
      showToast(`发送失败：${err?.message || err}`, 'error', 4000);
    } finally {
      setIsSendingToTT(false);
    }
  };

  const handleOpenSendChoice = () => {
    if (!draft || activeId === 'new') {
      showToast('请先保存此人设卡片后再投递', 'error');
      return;
    }
    if (!isLocalLinkSupported()) {
      handlePushToSillyTavern();
      return;
    }
    setShowSendChoice(true);
  };

  // ==================== 从酒馆 (API / TT 联动) 拉取人设 ====================
  const loadStPersonas = useCallback(async () => {
    const aiSettings = getAISettings();
    const stUrl = normalizeSillyTavernUrl(aiSettings.sillyTavernUrl);
    if (!stUrl) {
      setStPullError('请先在「设置」中配置酒馆 API 地址');
      setStPullList([]);
      setStSelectedIds(new Set());
      return;
    }

    setStPullLoading(true);
    setStPullError('');
    try {
      const authHeaders = getSillyTavernAuthHeaders(aiSettings);
      setStConnInfo({ stUrl, authHeaders });
      let csrf = await readTavernCsrf(stUrl, authHeaders);

      const doGet = async () => {
        const reqHeaders: Record<string, string> = {
          ...authHeaders,
          'Content-Type': 'application/json',
        };
        if (csrf) reqHeaders['X-CSRF-Token'] = csrf;
        return fetch(`${stUrl}/api/settings/get`, {
          method: 'POST',
          headers: reqHeaders,
          body: '{}',
          cache: 'no-store',
        });
      };

      let res = await doGet();
      if (res.status === 403) {
        csrf = await readTavernCsrf(stUrl, authHeaders);
        res = await doGet();
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json().catch(() => ({} as any));
      const settingsObj = typeof data?.settings === 'string'
        ? JSON.parse(data.settings)
        : (data?.settings && typeof data.settings === 'object' ? data.settings : {});

      const personasMap = (settingsObj?.power_user?.personas && typeof settingsObj.power_user.personas === 'object')
        ? settingsObj.power_user.personas as Record<string, string>
        : {};
      const descMap = (settingsObj?.power_user?.persona_descriptions && typeof settingsObj.power_user.persona_descriptions === 'object')
        ? settingsObj.power_user.persona_descriptions as Record<string, any>
        : {};
      const activeKey = typeof settingsObj?.user_avatar === 'string' ? settingsObj.user_avatar : '';

      const keySet = new Set<string>([
        ...Object.keys(personasMap),
        ...Object.keys(descMap),
      ]);
      if (keySet.size === 0 && activeKey) {
        keySet.add(activeKey);
      }

      const items: StPersonaItem[] = [];
      for (const avatarKey of keySet) {
        const rawDesc = descMap[avatarKey];
        const content = typeof rawDesc === 'string'
          ? rawDesc
          : (typeof rawDesc?.description === 'string' ? rawDesc.description : '');
        const rawName = personasMap[avatarKey];
        const fallbackName = activeKey === avatarKey
          ? (settingsObj?.name || settingsObj?.user_name || '')
          : '';
        const name = String(rawName || fallbackName || avatarKey.replace(/\.[^.]+$/, '') || '未命名 User').trim();
        items.push({
          id: avatarKey,
          avatarKey,
          name,
          content: activeKey === avatarKey && !content && typeof settingsObj?.user_description === 'string'
            ? settingsObj.user_description
            : content,
          isActive: activeKey === avatarKey,
        });
      }

      // 将当前激活人设排到最前面
      items.sort((a, b) => (a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1));
      setStPullList(items);
      setStSelectedIds(new Set(items.map((item) => item.id)));
      if (items.length === 0) {
        setStPullError('酒馆设置里暂未找到已保存的人设记录');
      }
    } catch (err: any) {
      setStPullError(`读取酒馆人设失败：${err?.message || err}`);
      setStPullList([]);
      setStSelectedIds(new Set());
    } finally {
      setStPullLoading(false);
    }
  }, []);

  const startTtPersonaPull = useCallback(() => {
    if (!isLocalLinkSupported()) {
      setTtNotice('当前不是安卓 App 环境，TT 联动不可用');
      return;
    }
    setTtNotice('');
    ttStoredListAtRef.current = 0;
    ttImportedRef.current = false;
    setTtPullList([]);
    setTtSelectedIds(new Set());
    if (!requestTavernPull('persona')) {
      setTtWaitingList(false);
      setTtNotice('接收服务没开着，先去「设置 → TauriTavern」开启接收服务。');
    } else {
      setTtWaitingList(true);
    }
    setTtPullState(getTavernPullState());
  }, []);

  const openPullModal = () => {
    const aiSettings = getAISettings();
    const hasSt = Boolean(normalizeSillyTavernUrl(aiSettings.sillyTavernUrl));
    const initialSource: 'st' | 'tt' = !hasSt && isLocalLinkSupported() ? 'tt' : 'st';
    setPullSearch('');
    setPullSource(initialSource);
    setShowPullModal(true);
    if (initialSource === 'st') {
      void loadStPersonas();
    } else {
      startTtPersonaPull();
    }
  };

  const handleClosePullModal = useCallback(() => {
    const cur = getTavernPullState();
    if (cur.phase === 'listing' || cur.phase === 'picking') {
      cancelTavernPull();
    }
    setShowPullModal(false);
  }, []);

  // Poll TT persona pull state while pull modal is open on TT tab
  useEffect(() => {
    if (!showPullModal || pullSource !== 'tt') return;
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      setTtPullState(getTavernPullState());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [showPullModal, pullSource]);

  useEffect(() => {
    if (!showPullModal || pullSource !== 'tt') return;
    if (ttPullState.phase === 'error') {
      setTtWaitingList(false);
      return;
    }
    if (ttPullState.phase !== 'picking' || !ttPullState.listAt) return;
    if (ttStoredListAtRef.current === ttPullState.listAt) return;
    if (ttPullState.listKind && ttPullState.listKind !== 'persona') return;
    ttStoredListAtRef.current = ttPullState.listAt;
    const items = ttPullState.list.filter((item) => item.kind === 'persona');
    setTtPullList(items);
    setTtSelectedIds(new Set(items.map((item) => item.id)));
    setTtWaitingList(false);
  }, [showPullModal, pullSource, ttPullState]);

  const importPulledFileAsPersona = useCallback(async (file: File, indexOffset = 0): Promise<boolean> => {
    const lowerName = file.name.toLowerCase();
    const now = Date.now() + indexOffset;
    if (lowerName.endsWith('.json') || file.type.includes('json')) {
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        if (json && typeof json === 'object') {
          const name = String(json.name || json.user_name || file.name.replace(/\.(persona\.)?json$/i, '') || '未命名 User').trim();
          const content = String(json.content ?? json.description ?? json.user_description ?? '');
          const rawAvatar = typeof json.avatarDataUrl === 'string'
            ? json.avatarDataUrl
            : (typeof json.avatar === 'string' && json.avatar.startsWith('data:') ? json.avatar : '');
          const avatarBlob = rawAvatar ? dataUrlToBlob(rawAvatar) : undefined;
          await saveUserPersona({
            id: crypto.randomUUID(),
            name: name || '未命名 User',
            content,
            avatarBlob,
            isDefault: false,
            boundCharacterIds: [],
            createdAt: now,
            updatedAt: now,
          });
          return true;
        }
      } catch {
        return false;
      }
    } else if (lowerName.endsWith('.png') || lowerName.endsWith('.webp') || lowerName.endsWith('.jpg') || file.type.startsWith('image/')) {
      const baseName = file.name.replace(/\.[^.]+$/, '') || '未命名 User';
      await saveUserPersona({
        id: crypto.randomUUID(),
        name: baseName,
        content: '',
        avatarBlob: file,
        isDefault: false,
        boundCharacterIds: [],
        createdAt: now,
        updatedAt: now,
      });
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    if (!showPullModal || pullSource !== 'tt' || ttPullState.phase !== 'done' || ttImportedRef.current) return;
    ttImportedRef.current = true;
    let cancelled = false;

    (async () => {
      setTtImporting(true);
      let imported = 0;
      for (let i = 0; i < ttPullState.importedIds.length; i++) {
        const file = await pullCardById(ttPullState.importedIds[i], i + 1);
        if (file && (await importPulledFileAsPersona(file, i))) {
          imported++;
        }
      }
      if (cancelled) return;
      setTtImporting(false);
      if (imported === 0) {
        ttImportedRef.current = false;
        setTtNotice('TT 说拉取完成，但没有读取到有效人设数据，请重试。');
        return;
      }
      await loadPersonas();
      window.dispatchEvent(new CustomEvent('userPersonasUpdated'));
      setShowPullModal(false);
      showToast(`已从 TT 联动拉取并导入 ${imported} 个新 User 人设`, 'success', 4000);
    })();

    return () => {
      cancelled = true;
    };
  }, [showPullModal, pullSource, ttPullState.phase, ttPullState.importedIds, importPulledFileAsPersona]);

  const handleConfirmStPull = async () => {
    const targets = stPullList.filter((item) => stSelectedIds.has(item.id));
    if (targets.length === 0 || stPullImporting) return;

    setStPullImporting(true);
    let successCount = 0;
    try {
      const { stUrl, authHeaders } = stConnInfo;
      const nowBase = Date.now();
      for (let i = 0; i < targets.length; i++) {
        const item = targets[i];
        let avatarBlob: Blob | undefined;
        if (stUrl && item.avatarKey) {
          // 头像读取失败也继续保留文字人设
          avatarBlob = await fetchTavernPersonaAvatar(stUrl, item.avatarKey, authHeaders);
        }
        await saveUserPersona({
          id: crypto.randomUUID(),
          name: item.name || '未命名 User',
          content: item.content || '',
          avatarBlob,
          isDefault: false,
          boundCharacterIds: [],
          createdAt: nowBase + i,
          updatedAt: nowBase + i,
        });
        successCount++;
      }

      await loadPersonas();
      window.dispatchEvent(new CustomEvent('userPersonasUpdated'));
      setShowPullModal(false);
      showToast(`已从酒馆拉取并导入 ${successCount} 个 User 人设`, 'success', 4000);
    } catch (err: any) {
      setStPullError(`导入人设失败：${err?.message || err}`);
    } finally {
      setStPullImporting(false);
    }
  };

  const handleConfirmTtPull = () => {
    const picks = Array.from(ttSelectedIds);
    if (!picks.length) return;
    setTtNotice('');
    ttImportedRef.current = false;
    if (!setTavernPullPicks(picks)) {
      setTtNotice('MIU 没记下勾选，请再点一次。');
      return;
    }
    setTtPullState(getTavernPullState());
  };

  // Avatar upload & cropping
  const handleAvatarFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isImg =
      file.type.startsWith('image/') ||
      /\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(file.name);
    if (!isImg) {
      showToast('所选文件不是图片格式', 'error');
      e.target.value = '';
      return;
    }
    const url = safeCreateObjectURL(file);
    if (url) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setImageToCrop(url);
    }
    e.target.value = '';
  };

  const onCropComplete = useCallback((_: any, croppedPixels: any) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  const closeCrop = () => {
    if (imageToCrop && imageToCrop.startsWith('blob:')) {
      URL.revokeObjectURL(imageToCrop);
    }
    setImageToCrop(null);
  };

  const handleSaveCrop = async () => {
    if (!imageToCrop || !croppedAreaPixels) return;
    try {
      const image = new Image();
      image.src = imageToCrop;
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
      });

      const canvas = document.createElement('canvas');
      const maxSize = 640;
      const scale = Math.min(1, maxSize / Math.max(croppedAreaPixels.width, croppedAreaPixels.height));
      const finalWidth = Math.max(1, Math.round(croppedAreaPixels.width * scale));
      const finalHeight = Math.max(1, Math.round(croppedAreaPixels.height * scale));

      canvas.width = finalWidth;
      canvas.height = finalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法创建画布');

      ctx.drawImage(
        image,
        croppedAreaPixels.x,
        croppedAreaPixels.y,
        croppedAreaPixels.width,
        croppedAreaPixels.height,
        0,
        0,
        finalWidth,
        finalHeight,
      );

      const blob =
        (await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/webp', 0.9))) ||
        (await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png')));

      if (!blob) throw new Error('生成头像失败');

      closeCrop();

      if (activeId === 'new') {
        setDraft((prev) => (prev ? { ...prev, avatarBlob: blob, avatarUrlFallback: undefined } : prev));
      } else if (draft?.id) {
        await persistPersona(
          {
            id: draft.id,
            name: draft.name || '未命名 User',
            content: draft.content || '',
            avatarBlob: blob,
            avatarUrlFallback: undefined,
            isDefault: Boolean(draft.isDefault),
            boundCharacterIds: draft.boundCharacterIds || [],
            createdAt: draft.createdAt || Date.now(),
            updatedAt: Date.now(),
          },
          '头像已更新',
        );
      }
    } catch (err: any) {
      showToast('头像处理失败: ' + (err?.message || String(err)), 'error');
    }
  };

  const filteredPersonas = personas.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.content || '').toLowerCase().includes(q);
  });

  const filteredCharMetas = useMemo(() => {
    const q = charPickerSearch.trim().toLowerCase();
    if (!q) return charMetas;
    return charMetas.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.tags || []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [charMetas, charPickerSearch]);

  const isDetailBackdropFallback = isFallbackMiuImage(draftAvatarUrl);

  return (
    <div className="flex-1 flex flex-col h-full w-full overflow-hidden select-none relative font-sans bg-[#0a0a0c] text-white [.light-theme_&]:!bg-[#f2f2f7] [.light-theme_&]:!text-[#0f172a]">
      {/* iOS Toast Feedback */}
      <AnimatePresence>
        {toastFeedback && (
          <motion.div
            key="persona-toast"
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            className={`fixed top-6 left-1/2 px-4 py-2.5 rounded-full text-xs sm:text-sm z-[160] flex items-center gap-2 max-w-[92vw] sm:max-w-md w-auto ios-toast pointer-events-auto ${
              toastFeedback.type === 'success' ? 'ios-toast-success' : 'ios-toast-error'
            }`}
          >
            {toastFeedback.type === 'success' ? (
              <Check className="w-4 h-4 shrink-0 text-emerald-400 ios-toast-icon-success" />
            ) : (
              <XIcon className="w-4 h-4 shrink-0 text-red-400 ios-toast-icon-error" />
            )}
            <span className="truncate font-medium">{toastFeedback.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ==================== 1. 统一风格的粘性磨砂顶部栏 (对标 重复卡检测 / 自动打标 / 聊天记录) ==================== */}
      <header className="sticky top-0 px-4 pb-3.5 pt-[max(1.75rem,env(safe-area-inset-top))] sm:px-6 sm:pb-4 border-b border-white/10 [.light-theme_&]:!border-[#e2e8f0] bg-slate-900/90 [.light-theme_&]:!bg-[#ffffff]/95 flex flex-col gap-3 z-20 backdrop-blur-xl shadow-2xs shrink-0">
        <div className="flex items-center justify-between gap-3 sm:gap-4">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="p-2 -ml-2 rounded-full transition text-white/80 hover:text-white hover:bg-white/10 [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!bg-transparent [.light-theme_&]:hover:!bg-black/5 [.light-theme_&]:active:!bg-black/10 cursor-pointer shrink-0"
              title="返回"
            >
              <ArrowLeft className="w-5 sm:w-6 h-5 sm:h-6" />
            </button>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-white [.light-theme_&]:!text-[#0f172a] truncate">
                人设库
              </h1>
              <p className="text-xs sm:text-sm text-white/50 mt-0.5 sm:mt-1 truncate [.light-theme_&]:!text-[#64748b]">
                {personas.length > 0
                  ? `共 ${personas.length} 个 User 人设 · 可挂载到角色卡与酒馆同步`
                  : '管理你的 User 个人设定档案，支持挂载到指定角色卡'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={openPullModal}
            className="shrink-0 flex items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-full text-xs sm:text-sm font-semibold transition active:scale-95 cursor-pointer bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 [.light-theme_&]:!bg-[#eff6ff] [.light-theme_&]:hover:!bg-[#dbeafe] [.light-theme_&]:!text-[#007aff] whitespace-nowrap"
            title="从酒馆或 TT 联动拉取 User 人设"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>拉取人设</span>
          </button>
        </div>

        {/* 集成搜索栏 */}
        <div className="relative">
          <div
            className={`flex items-center gap-2 w-full rounded-full pl-3.5 ${
              searchQuery ? 'pr-2' : 'pr-4'
            } py-2 transition ${
              isLightMode
                ? 'bg-[#f1f5f9] hover:bg-[#e2e8f0]/80 focus-within:bg-[#e2e8f0]/80 text-[#0f172a]'
                : 'bg-white/10 hover:bg-white/15 focus-within:bg-white/15 text-white'
            }`}
          >
            <Search className="w-4 h-4 text-white/40 [.light-theme_&]:!text-[#64748b] shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索人设名称或设定..."
              className="bg-transparent border-none outline-none flex-1 text-sm placeholder:text-white/40 [.light-theme_&]:placeholder:!text-[#64748b] min-w-0"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="p-1 rounded-full hover:bg-white/10 [.light-theme_&]:hover:bg-black/10 text-white/50 [.light-theme_&]:!text-[#64748b] cursor-pointer"
                title="清空搜索"
              >
                <XIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ==================== 2. 卡片网格区 ==================== */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 pt-4 sm:pt-6 pb-28 custom-scrollbar">
        <div className="max-w-7xl mx-auto">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500 [.light-theme_&]:!text-[#007aff]" />
            </div>
          ) : personas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
              <div className="w-20 h-20 rounded-full bg-white/5 [.light-theme_&]:!bg-[#ffffff] border border-white/10 [.light-theme_&]:!border-[#e2e8f0] shadow-sm flex items-center justify-center mb-4 text-white/30 [.light-theme_&]:!text-[#94a3b8]">
                <User className="w-9 h-9 stroke-[1.5]" />
              </div>
              <h3 className="text-base font-semibold text-white [.light-theme_&]:!text-[#0f172a]">
                暂无 User 人设卡片
              </h3>
              <p className="text-xs text-slate-400 [.light-theme_&]:!text-[#64748b] mt-1.5 max-w-xs leading-relaxed">
                添加不同世界观或身份的 User 人设，可固定挂载到对应角色卡（Char）上，聊天时自动同步头像和名称。
              </p>
            </div>
          ) : filteredPersonas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-white/40 [.light-theme_&]:!text-[#64748b]">
              <Search className="w-12 h-12 mb-3 text-white/20 stroke-1 [.light-theme_&]:!text-[#94a3b8]" />
              <p className="text-base font-medium [.light-theme_&]:!text-[#0f172a]">未找到匹配的人设卡片</p>
              <p className="text-xs mt-1 text-white/30 [.light-theme_&]:!text-[#64748b]">
                试试更换其他关键词搜索
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4">
              {filteredPersonas.map((persona) => (
                <PersonaCardItem
                  key={persona.id}
                  persona={persona}
                  onClick={() => openPersonaDetail(persona)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右下角悬浮加号圆球 (对标主页悬浮球) */}
      {!activeId && (
        <div className="fixed bottom-8 sm:bottom-10 right-6 sm:right-8 z-30">
          <motion.button
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            onClick={openCreateNew}
            className="w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-xl transition-all duration-200 cursor-pointer shadow-lg bg-slate-900/85 hover:bg-slate-800 border border-white/20 text-white [.light-theme_&]:!bg-white [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:hover:!bg-[#f1f5f9] active:scale-95"
            title="新建 User 人设卡片"
          >
            <Plus className="w-5 h-5 stroke-[2.2]" />
          </motion.button>
        </div>
      )}

      {/* ==================== 3. 详情页覆盖层 (对标 CharacterDetail) ==================== */}
      <AnimatePresence>
        {activeId !== null && draft && (
          <motion.div
            key="persona-detail-overlay"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black [.light-theme_&]:bg-[#eef4fe] text-white [.light-theme_&]:text-[#1c1c1e] overflow-y-auto overflow-x-hidden"
          >
            {/* 背景模糊光晕 */}
            <div
              className="fixed inset-0 opacity-30 blur-3xl scale-110 pointer-events-none transition-all duration-700"
              style={{
                backgroundImage: `url(${draftAvatarUrl})`,
                backgroundPosition: 'center',
                backgroundSize: isDetailBackdropFallback ? '320px auto' : 'cover',
                backgroundRepeat: 'no-repeat',
              }}
            />
            <div className="fixed inset-0 pointer-events-none bg-gradient-to-b from-black/20 via-transparent to-black/80 [.light-theme_&]:from-[#e8f1fd]/60 [.light-theme_&]:via-[#eef4fe]/40 [.light-theme_&]:to-[#e2eeff]/80" />

            <div className="relative z-10 min-h-screen flex flex-col w-full max-w-full overflow-x-hidden">
              {/* 详情页顶部粘性毛玻璃栏 */}
              <header className="sticky top-0 p-4 pt-[max(1.75rem,env(safe-area-inset-top))] flex items-center justify-between bg-black/20 [.light-theme_&]:bg-white/70 backdrop-blur-xl border-b border-white/10 [.light-theme_&]:!border-[#e2e8f0] z-20">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={handleCloseDetail}
                    className="p-2 rounded-full hover:bg-white/10 [.light-theme_&]:hover:bg-black/5 text-white [.light-theme_&]:text-[#1c1c1e] transition shrink-0 cursor-pointer"
                    title="返回"
                  >
                    <ArrowLeft className="w-6 h-6" />
                  </button>
                  {activeId === 'new' && (
                    <span className="text-sm font-semibold text-white/80 [.light-theme_&]:text-[#0f172a] truncate">
                      新建 User 人设
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleToggleDefault}
                    className="p-2 rounded-full hover:bg-white/10 [.light-theme_&]:hover:bg-black/5 transition relative group active:scale-90 cursor-pointer"
                    title={draft.isDefault ? '已设为默认激活人设（点击取消）' : '设为默认激活人设'}
                  >
                    <Star
                      className={`w-5 h-5 transition-all duration-200 ${
                        draft.isDefault
                          ? 'text-blue-400 fill-blue-400 scale-110 drop-shadow-[0_2px_8px_rgba(96,165,250,0.35)] [.light-theme_&]:!text-[#86b9f4] [.light-theme_&]:!fill-[#86b9f4]'
                          : 'text-white/70 hover:text-white [.light-theme_&]:text-[#1c1c1e] [.light-theme_&]:hover:text-[#007aff]'
                      }`}
                    />
                  </button>

                  {activeId !== 'new' && (
                    <>
                      <button
                        type="button"
                        onClick={handleOpenSendChoice}
                        disabled={isSendingToST || isSendingToTT}
                        className="p-2 rounded-full hover:bg-white/10 [.light-theme_&]:hover:bg-black/5 transition relative group cursor-pointer disabled:opacity-50"
                        title="同步投递到酒馆 / TT 联动"
                      >
                        {isSendingToST || isSendingToTT ? (
                          <Loader2 className="w-5 h-5 animate-spin text-blue-400 [.light-theme_&]:text-[#007aff]" />
                        ) : (
                          <Send className="w-5 h-5 text-blue-400 group-hover:text-blue-300 [.light-theme_&]:text-[#007aff]" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(true)}
                        className="p-2 rounded-full hover:bg-red-500/20 text-red-400 transition cursor-pointer"
                        title="删除此人设"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </>
                  )}
                </div>
              </header>

              {/* Hero 圆形头像与居中名称 */}
              <div className="flex flex-col items-center pt-8 pb-6 px-4">
                <div
                  onClick={() => setShowAvatarSheet(true)}
                  className="relative group cursor-pointer"
                  title="点击上传或更换头像"
                >
                  <img
                    src={draftAvatarUrl}
                    alt={draft.name || 'User'}
                    className={`w-32 h-32 rounded-full border-4 border-white/20 [.light-theme_&]:border-white shadow-2xl transition-transform group-hover:scale-105 ${
                      isDetailBackdropFallback ? 'object-contain p-6 bg-white' : 'object-cover'
                    }`}
                  />
                  <div className="absolute bottom-1 right-1 w-8 h-8 rounded-full bg-blue-600 text-white border-2 border-black/40 [.light-theme_&]:!border-white shadow-md flex items-center justify-center">
                    <Camera className="w-4 h-4" />
                  </div>
                </div>

                {/* 可编辑标题 */}
                {isEditingName ? (
                  <div className="flex items-center justify-center gap-2 mt-4 w-full px-4">
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingName(false);
                        setEditNameValue(draft.name || '');
                      }}
                      title="取消"
                      className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center shrink-0 transition active:scale-90 cursor-pointer ${
                        isLightMode
                          ? 'bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#64748b] hover:text-[#0f172a]'
                          : 'bg-white/10 hover:bg-white/20 text-white/70 hover:text-white'
                      }`}
                    >
                      <XIcon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </button>

                    <input
                      type="text"
                      value={editNameValue}
                      onChange={(e) => setEditNameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleNameSave();
                        if (e.key === 'Escape') {
                          setIsEditingName(false);
                          setEditNameValue(draft.name || '');
                        }
                      }}
                      placeholder="输入 User 名称..."
                      className={`rounded-xl px-3 py-1 text-xl sm:text-2xl font-bold text-center outline-none transition shadow-2xs ${
                        isLightMode
                          ? 'bg-white/95 border border-[#cbd5e1] text-[#0f172a] focus:border-[#3b82f6] focus:ring-3 focus:ring-blue-500/15'
                          : 'bg-black/40 border border-white/20 text-white focus:border-blue-500 focus:ring-3 focus:ring-blue-500/20'
                      }`}
                      style={{
                        width: `${Math.max(160, Math.min(280, (editNameValue.length + 2) * 20))}px`,
                      }}
                      autoFocus
                    />

                    <button
                      type="button"
                      onClick={handleNameSave}
                      title="确认名称"
                      className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center shrink-0 transition active:scale-90 cursor-pointer shadow-xs shadow-blue-500/20"
                    >
                      <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.4]" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center mt-4 w-full px-4">
                    <h1
                      onClick={() => {
                        setEditNameValue(draft.name || '');
                        setIsEditingName(true);
                      }}
                      className="text-2xl sm:text-3xl font-bold text-center break-words max-w-full cursor-pointer hover:opacity-80 active:opacity-60 transition"
                      title="点击编辑名称"
                    >
                      {draft.name || '未命名 User'}
                    </h1>
                  </div>
                )}

                {/* 副标题元数据 */}
                <div className="mt-2 flex items-center justify-center gap-2 text-xs text-white/60 [.light-theme_&]:!text-[#475569] flex-wrap">
                  <button
                    type="button"
                    onClick={handleToggleDefault}
                    className={`px-2.5 py-1 rounded-full font-medium transition cursor-pointer flex items-center gap-1 backdrop-blur-md ${
                      draft.isDefault
                        ? 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 [.light-theme_&]:!bg-[#eff6ff] [.light-theme_&]:hover:!bg-[#dbeafe] [.light-theme_&]:!text-[#007aff] [.light-theme_&]:shadow-xs'
                        : 'bg-white/10 text-white/75 hover:bg-white/15 [.light-theme_&]:!bg-white/75 [.light-theme_&]:hover:!bg-white [.light-theme_&]:!text-[#1e293b] [.light-theme_&]:shadow-xs'
                    }`}
                  >
                    <Star className={`w-3 h-3 ${draft.isDefault ? 'fill-current' : ''}`} />
                    <span>{draft.isDefault ? '全局默认人设' : '设为全局默认'}</span>
                  </button>
                  {draft.updatedAt && (
                    <>
                      <span>·</span>
                      <span>更新于 {new Date(draft.updatedAt).toLocaleDateString()}</span>
                    </>
                  )}
                </div>
              </div>

              {/* 详情玻璃容器 */}
              <div className="w-full max-w-4xl mx-auto px-4 pb-24">
                <div className="char-detail-glass-card rounded-3xl p-4 sm:p-6 backdrop-blur-xl space-y-4">
                  {/* 字数统计行 */}
                  <div className="flex items-center text-xs text-white/60 [.light-theme_&]:!text-[#64748b] px-1">
                    <span>
                      约 {(isEditingContent ? editContentValue : draft.content || '').length} 字
                    </span>
                  </div>

                  {/* 挂载到指定角色卡 (Char) */}
                  <div className="detail-card rounded-2xl p-4 sm:p-5">
                    <div className={`flex items-center justify-between gap-2 ${(draft.boundCharacterIds || []).length > 0 ? 'mb-3' : ''}`}>
                      <h2 className="text-sm sm:text-base font-bold detail-card-text">
                        挂载到角色卡 (Char)
                      </h2>
                      <button
                        type="button"
                        onClick={() => {
                          setCharPickerSearch('');
                          setShowCharPicker(true);
                        }}
                        className="px-3 py-1 rounded-full border-0 text-xs font-semibold bg-white/10 hover:bg-white/20 text-white [.light-theme_&]:!bg-[#eff6ff] [.light-theme_&]:hover:!bg-[#dbeafe] [.light-theme_&]:!text-[#007aff] transition cursor-pointer whitespace-nowrap flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>选择角色卡</span>
                      </button>
                    </div>

                    {(draft.boundCharacterIds || []).length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {(draft.boundCharacterIds || []).map((cid) => {
                          const cMeta = charMetaMap.get(cid);
                          return (
                            <div
                              key={cid}
                              className="inline-flex items-center gap-2 pl-1.5 pr-2 py-1 rounded-full bg-white/10 [.light-theme_&]:!bg-[#f1f5f9] border border-white/10 [.light-theme_&]:!border-[#e2e8f0] max-w-full"
                            >
                              <div className="w-6 h-6 rounded-full overflow-hidden shrink-0 bg-black/20">
                                {cMeta ? (
                                  <CharThumbImg char={cMeta} className="w-full h-full" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-[10px] font-bold">
                                    ?
                                  </div>
                                )}
                              </div>
                              <span className="text-xs font-medium detail-card-text truncate max-w-[140px]">
                                {cMeta?.name || '已删除或未知角色'}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleToggleBindChar(cid)}
                                className="p-0.5 rounded-full hover:bg-red-500/20 text-white/50 hover:text-red-400 [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#ef4444] transition cursor-pointer shrink-0"
                                title="取消挂载"
                              >
                                <XIcon className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* 人设正文卡片 */}
                  <div className="detail-card rounded-2xl p-4 sm:p-5">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <h2 className="text-sm sm:text-base font-bold detail-card-text">
                        人设正文 (User Persona)
                      </h2>

                      {!isEditingContent && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditContentValue(draft.content || '');
                            setIsEditingContent(true);
                          }}
                          className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#0f172a] [.light-theme_&]:hover:bg-black/5 transition cursor-pointer"
                          title="编辑人设正文"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {isEditingContent ? (
                      <div className="space-y-3">
                        <textarea
                          rows={10}
                          value={editContentValue}
                          onChange={(e) => setEditContentValue(e.target.value)}
                          placeholder="在此输入详细的 User 个人设定、外貌特征、性格倾向、身份背景等...&#10;例如：身份、称呼、外貌描写以及在故事中扮演的视角。"
                          className="w-full min-h-[220px] rounded-xl p-3.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500/30 [.light-theme_&]:focus:ring-[#007aff]/20 [.light-theme_&]:focus:!border-[#007aff] bg-black/30 border border-white/10 text-white placeholder:text-white/30 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:placeholder:!text-[#94a3b8] custom-scrollbar resize-y"
                        />

                        {activeId !== 'new' && (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setIsEditingContent(false);
                                setEditContentValue(draft.content || '');
                              }}
                              className="px-4 py-2 rounded-full text-xs font-medium text-white/60 hover:text-white hover:bg-white/10 [.light-theme_&]:!text-[#475569] [.light-theme_&]:hover:!bg-[#f1f5f9] transition cursor-pointer whitespace-nowrap"
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              onClick={handleContentSave}
                              className="px-5 py-2 rounded-full text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer whitespace-nowrap"
                            >
                              <Save className="w-3.5 h-3.5" />
                              <span>保存正文</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div
                        onClick={() => {
                          setEditContentValue(draft.content || '');
                          setIsEditingContent(true);
                        }}
                        className="cursor-text min-h-[100px]"
                      >
                        {draft.content ? (
                          <p className="detail-card-text text-sm sm:text-base leading-relaxed whitespace-pre-wrap break-words">
                            {draft.content}
                          </p>
                        ) : (
                          <p className="detail-card-text-muted text-sm py-4">
                            暂无详细人设正文，点击右上角编辑或点击此处开始书写...
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 新建模式底部保存按钮 */}
                  {activeId === 'new' && (
                    <div className="pt-2 flex items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={handleCloseDetail}
                        className="px-5 py-2.5 rounded-full text-sm font-medium bg-white/10 hover:bg-white/15 text-white/80 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#334155] transition cursor-pointer whitespace-nowrap"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={handleCreateOrSaveAll}
                        className="px-6 py-2.5 rounded-full text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-500/25 flex items-center gap-2 transition active:scale-95 cursor-pointer whitespace-nowrap"
                      >
                        <Check className="w-4 h-4 stroke-[2.5]" />
                        <span>保存人设卡片</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 隐藏文件选择器 */}
            <input
              type="file"
              ref={galleryInputRef}
              accept="image/png, image/jpeg, image/webp, image/gif"
              onChange={handleAvatarFileSelected}
              className="hidden"
            />
            <input
              type="file"
              ref={fileInputRef}
              accept="*/*"
              onChange={handleAvatarFileSelected}
              className="hidden"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ==================== 4. 挂载角色卡选择弹窗 ==================== */}
      <AnimatePresence>
        {showCharPicker && draft && (
          <div
            key="persona-char-picker"
            className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCharPicker(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-lg max-h-[82vh] bg-slate-900 [.light-theme_&]:!bg-[#ffffff] border-t sm:border border-white/10 [.light-theme_&]:!border-[#e2e8f0] rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden shadow-2xl"
            >
              <div className="p-4 sm:p-5 border-b border-white/10 [.light-theme_&]:!border-[#e2e8f0] flex items-center justify-between">
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white [.light-theme_&]:!text-[#0f172a]">
                    选择要挂载的角色卡
                  </h3>
                  <p className="text-xs text-white/50 [.light-theme_&]:!text-[#64748b] mt-0.5">
                    已选 {(draft.boundCharacterIds || []).length} 张 · 可多选绑定
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCharPicker(false)}
                  className="p-1.5 rounded-full hover:bg-white/10 [.light-theme_&]:hover:bg-black/5 text-white/60 hover:text-white [.light-theme_&]:!text-[#64748b] cursor-pointer"
                >
                  <XIcon className="w-5 h-5" />
                </button>
              </div>

              <div className="p-3 sm:px-5 border-b border-white/10 [.light-theme_&]:!border-[#e2e8f0]">
                <div
                  className={`flex items-center gap-2 rounded-full px-3.5 py-2 ${
                    isLightMode ? 'bg-[#f1f5f9] text-[#0f172a]' : 'bg-white/10 text-white'
                  }`}
                >
                  <Search className="w-4 h-4 text-white/40 [.light-theme_&]:!text-[#94a3b8] shrink-0" />
                  <input
                    type="text"
                    value={charPickerSearch}
                    onChange={(e) => setCharPickerSearch(e.target.value)}
                    placeholder="搜索角色名称或标签..."
                    className="bg-transparent border-none outline-none flex-1 text-sm placeholder:text-white/40 [.light-theme_&]:placeholder:!text-[#94a3b8] min-w-0"
                  />
                  {charPickerSearch && (
                    <button
                      type="button"
                      onClick={() => setCharPickerSearch('')}
                      className="p-0.5 rounded-full text-white/40 hover:text-white [.light-theme_&]:!text-[#94a3b8] cursor-pointer"
                    >
                      <XIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-1.5 custom-scrollbar">
                {filteredCharMetas.length === 0 ? (
                  <div className="text-center py-12 text-xs text-white/40 [.light-theme_&]:!text-[#64748b]">
                    未找到可选角色卡
                  </div>
                ) : (
                  filteredCharMetas.slice(0, 150).map((meta) => {
                    const isChecked = (draft.boundCharacterIds || []).includes(meta.id);
                    const otherPersona = !isChecked ? charToPersonaMap.get(meta.id) : undefined;
                    return (
                      <button
                        key={meta.id}
                        type="button"
                        onClick={() => handleToggleBindChar(meta.id)}
                        className={`w-full flex items-center gap-3 p-2.5 rounded-2xl transition text-left cursor-pointer border ${
                          isChecked
                            ? 'bg-blue-500/15 border-blue-500/50 [.light-theme_&]:!bg-[#eff6ff] [.light-theme_&]:!border-[#93c5fd]'
                            : 'bg-white/5 hover:bg-white/10 border-transparent [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:hover:!bg-[#f1f5f9]'
                        }`}
                      >
                        <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0 bg-black/20">
                          <CharThumbImg char={meta} className="w-full h-full" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-white [.light-theme_&]:!text-[#0f172a] truncate">
                            {meta.name}
                          </div>
                          {otherPersona && otherPersona.id !== draft.id ? (
                            <div className="text-[11px] text-amber-400 [.light-theme_&]:text-amber-600 truncate mt-0.5">
                              当前已挂载「{otherPersona.name}」，选择将改绑到此人设
                            </div>
                          ) : meta.tags && meta.tags.length > 0 ? (
                            <div className="text-[11px] text-white/40 [.light-theme_&]:!text-[#64748b] truncate mt-0.5">
                              {meta.tags.slice(0, 3).join(' · ')}
                            </div>
                          ) : null}
                        </div>
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition ${
                            isChecked
                              ? 'bg-blue-600 text-white shadow-xs'
                              : 'border border-white/25 [.light-theme_&]:!border-[#cbd5e1]'
                          }`}
                        >
                          {isChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              <div className="p-3 sm:p-4 border-t border-white/10 [.light-theme_&]:!border-[#e2e8f0] pb-[max(1rem,env(safe-area-inset-bottom))]">
                <button
                  type="button"
                  onClick={() => setShowCharPicker(false)}
                  className="w-full py-2.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition active:scale-[0.99] cursor-pointer"
                >
                  完成
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 头像来源选择上弹面板 */}
      <AnimatePresence>
        {showAvatarSheet && (
          <div key="persona-avatar-sheet" className="fixed inset-0 z-[110] flex items-end justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAvatarSheet(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="relative w-full max-w-lg bg-slate-900 border-t border-white/10 rounded-t-3xl p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl flex flex-col gap-3 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-[#e2e8f0]"
            >
              <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-1 [.light-theme_&]:bg-black/15" />
              <div className="text-center mb-1">
                <h4 className="text-base font-semibold text-white [.light-theme_&]:!text-[#0f172a]">
                  更换 User 头像
                </h4>
                <p className="text-xs text-white/50 mt-0.5 [.light-theme_&]:!text-[#64748b]">
                  选择相册图片或本地文件，支持圆形裁剪
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAvatarSheet(false);
                    galleryInputRef.current?.click();
                  }}
                  className="w-full flex items-center gap-3.5 p-3.5 rounded-2xl bg-white/5 hover:bg-white/10 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:hover:!bg-[#f1f5f9] active:scale-[0.99] border border-white/5 [.light-theme_&]:!border-[#e2e8f0] transition text-left cursor-pointer"
                >
                  <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/10 text-white [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:!text-[#0f172a] flex items-center justify-center shrink-0">
                    <ImageIcon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white [.light-theme_&]:!text-[#0f172a]">
                      从手机相册选取
                    </div>
                    <div className="text-xs text-white/40 [.light-theme_&]:!text-[#64748b]">
                      打开系统相册与图库
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/30 [.light-theme_&]:!text-[#94a3b8]" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowAvatarSheet(false);
                    fileInputRef.current?.click();
                  }}
                  className="w-full flex items-center gap-3.5 p-3.5 rounded-2xl bg-white/5 hover:bg-white/10 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:hover:!bg-[#f1f5f9] active:scale-[0.99] border border-white/5 [.light-theme_&]:!border-[#e2e8f0] transition text-left cursor-pointer"
                >
                  <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/10 text-white [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:!text-[#0f172a] flex items-center justify-center shrink-0">
                    <FolderOpen className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white [.light-theme_&]:!text-[#0f172a]">
                      从文件管理查找
                    </div>
                    <div className="text-xs text-white/40 [.light-theme_&]:!text-[#64748b]">
                      浏览内部存储中的图片文件
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/30 [.light-theme_&]:!text-[#94a3b8]" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowAvatarSheet(false)}
                className="w-full py-3 mt-1 rounded-2xl bg-white/10 hover:bg-white/15 active:scale-[0.99] text-white/80 font-medium text-sm transition [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#334155] cursor-pointer"
              >
                取消
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 头像裁剪弹窗 */}
      {imageToCrop && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-slate-900 [.light-theme_&]:!bg-[#ffffff] text-white [.light-theme_&]:!text-[#0f172a] border border-white/10 [.light-theme_&]:!border-[#e2e8f0] rounded-3xl w-full max-w-md flex flex-col shadow-2xl overflow-hidden h-[500px]">
            <div className="p-4 border-b border-white/10 [.light-theme_&]:!border-[#e2e8f0] flex items-center justify-between">
              <h3 className="text-base sm:text-lg font-bold">调整人设头像</h3>
              <button
                type="button"
                onClick={closeCrop}
                className="w-8.5 h-8.5 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition [.light-theme_&]:!bg-[#f1f2f6] [.light-theme_&]:hover:!bg-[#e4e7eb] [.light-theme_&]:!text-[#64748b] cursor-pointer"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 relative w-full h-full bg-black/70">
              <Cropper
                image={imageToCrop}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onCropComplete={onCropComplete}
                onZoomChange={setZoom}
              />
            </div>
            <div className="p-4 border-t border-white/10 [.light-theme_&]:!border-[#e2e8f0] bg-white/[0.02] [.light-theme_&]:!bg-[#f8fafc] flex items-center justify-between gap-4">
              <input
                type="range"
                value={zoom}
                min={1}
                max={3}
                step={0.05}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1 h-2 bg-white/10 [.light-theme_&]:!bg-[#e2e8f0] rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <button
                type="button"
                onClick={handleSaveCrop}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-full transition shadow-md shadow-blue-500/25 cursor-pointer whitespace-nowrap"
              >
                保存头像
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认上弹面板 */}
      <AnimatePresence>
        {showDeleteConfirm && draft && (
          <motion.div
            key="persona-delete-confirm"
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
              <div className="w-10 h-1 bg-white/20 [.light-theme_&]:!bg-black/10 rounded-full mx-auto mb-3" />

              <h3 className="text-base sm:text-lg font-bold text-center text-white [.light-theme_&]:!text-[#0f172a] mb-1">
                删除 User 人设？
              </h3>
              <p className="text-[11px] sm:text-xs text-center text-white/70 [.light-theme_&]:!text-[#475569] mb-4 px-2 leading-relaxed">
                确定要删除 <span className="font-bold text-white [.light-theme_&]:!text-[#0f172a]">{draft.name || '此人设'}</span> 吗？此操作无法撤销。
              </p>

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={handleDelete}
                  className={`w-full py-2.5 sm:py-3 rounded-full font-medium text-sm transition-all cursor-pointer active:scale-[0.98] border-0 outline-none flex items-center justify-center gap-2 ${
                    isLightMode
                      ? 'bg-[#fff0f2] hover:bg-[#ffe4e6] active:bg-[#fecdd3] text-[#e11d48] shadow-none'
                      : 'bg-[#FE2C55] hover:bg-[#E02447] active:bg-[#D41C3E] text-white shadow-md shadow-[#FE2C55]/25'
                  }`}
                >
                  <Trash2 className="w-4 h-4" />
                  <span>确认删除</span>
                </button>
                <button
                  type="button"
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
      </AnimatePresence>
      {/* 发送方式选择上弹面板（酒馆 API / TT 联动） */}
      <AnimatePresence>
        {showSendChoice && (
          <motion.div
            key="persona-send-choice"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 [.light-theme_&]:bg-black/40 backdrop-blur-sm z-[200] flex items-end justify-center"
            onClick={() => setShowSendChoice(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-[#1c1c1e] [.light-theme_&]:!bg-[#ffffff] border-t border-white/10 [.light-theme_&]:!border-black/5 rounded-t-3xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl select-none"
            >
              <div className="w-10 h-1 bg-white/20 [.light-theme_&]:!bg-black/10 rounded-full mx-auto mb-3" />

              <h3 className="text-base sm:text-lg font-bold text-center text-white [.light-theme_&]:!text-[#0f172a] mb-1">
                发送到酒馆
              </h3>
              <p className="text-[11px] sm:text-xs text-center text-white/70 [.light-theme_&]:!text-[#475569] mb-4 px-2 leading-relaxed">
                将以独立新人设投递，不会覆盖酒馆里已有或同名的人设
              </p>

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setShowSendChoice(false);
                    handlePushToSillyTavern();
                  }}
                  className={`w-full py-2.5 sm:py-3 rounded-full font-medium text-sm transition-all cursor-pointer active:scale-[0.98] border-0 outline-none flex items-center justify-center gap-2 ${
                    isLightMode
                      ? '!bg-[#eff6ff] hover:!bg-[#dbeafe] active:!bg-[#bfdbfe] !text-[#2563eb] shadow-none'
                      : 'bg-[#007aff] hover:bg-[#0062cc] active:bg-[#0051a8] text-white shadow-md shadow-[#007aff]/25'
                  }`}
                >
                  <Send className="w-4 h-4" />
                  <span>发送到酒馆（酒馆 API）</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowSendChoice(false);
                    handlePushToTT();
                  }}
                  className={`w-full py-2.5 sm:py-3 rounded-full font-medium text-sm transition-all cursor-pointer active:scale-[0.98] border-0 outline-none flex items-center justify-center gap-2 ${
                    isLightMode
                      ? '!bg-[#f1f5f9] hover:!bg-[#e2e8f0] active:!bg-[#cbd5e1] !text-[#334155] shadow-none'
                      : 'bg-white/10 hover:bg-white/15 active:bg-white/5 text-white/90'
                  }`}
                >
                  <Smartphone className="w-4 h-4" />
                  <span>发送到酒馆（TT 联动）</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowSendChoice(false)}
                  className={`w-full py-2.5 sm:py-3 rounded-full font-medium text-sm transition-all cursor-pointer active:scale-[0.98] border-0 outline-none flex items-center justify-center ${
                    isLightMode
                      ? '!bg-[#f8fafc] hover:!bg-[#f1f5f9] active:!bg-[#e2e8f0] !text-[#64748b] shadow-none'
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

      {/* ==================== 5. 拉取人设弹窗（酒馆 API & TT 联动） ==================== */}
      {showPullModal && createPortal(
        <AnimatePresence>
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm bg-black/75 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              onClick={(e) => e.stopPropagation()}
              className={`version-modal-box rounded-3xl p-5 sm:p-6 w-[94vw] sm:w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] relative overflow-hidden ${
                isLightMode ? 'light-theme !bg-[#ffffff] !text-[#0f172a] !border-[#e2e8f0]' : ''
              }`}
            >
              <div className="flex items-center justify-between pb-3.5 border-b version-modal-border relative z-10">
                <div>
                  <h3 className="text-base sm:text-lg font-bold version-modal-title">
                    拉取人设
                  </h3>
                  <p className="text-xs mt-1 version-modal-desc">
                    支持从酒馆 API 或 TT 联动拉取 User 人设，导入为独立新卡片
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleClosePullModal}
                  className="w-8 h-8 sm:w-9 sm:h-9 rounded-full version-modal-close-btn flex items-center justify-center cursor-pointer transition shadow-xs"
                >
                  <XIcon className="w-4 h-4" />
                </button>
              </div>

              {/* 来源切换条 */}
              <div className="flex items-center gap-2 mt-3 shrink-0 relative z-10">
                <button
                  type="button"
                  onClick={() => {
                    setPullSource('st');
                    if (stPullList.length === 0 && !stPullLoading) {
                      void loadStPersonas();
                    }
                  }}
                  className={`flex-1 py-2 px-3 rounded-full text-xs font-semibold transition cursor-pointer flex items-center justify-center border-0 outline-none ${
                    pullSource === 'st'
                      ? isLightMode
                        ? '!bg-[#86b9f4] !text-[#ffffff] hover:!bg-[#a7cbf6] shadow-xs'
                        : 'bg-blue-600 text-white shadow-xs'
                      : isLightMode
                        ? '!bg-[#f1f5f9] !text-[#475569] hover:!bg-[#e2e8f0]'
                        : 'bg-white/5 text-white/60 hover:bg-white/10'
                  }`}
                >
                  <span>从酒馆 (API) 拉取</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPullSource('tt');
                    startTtPersonaPull();
                  }}
                  className={`flex-1 py-2 px-3 rounded-full text-xs font-semibold transition cursor-pointer flex items-center justify-center border-0 outline-none ${
                    pullSource === 'tt'
                      ? isLightMode
                        ? '!bg-[#86b9f4] !text-[#ffffff] hover:!bg-[#a7cbf6] shadow-xs'
                        : 'bg-blue-600 text-white shadow-xs'
                      : isLightMode
                        ? '!bg-[#f1f5f9] !text-[#475569] hover:!bg-[#e2e8f0]'
                        : 'bg-white/5 text-white/60 hover:bg-white/10'
                  }`}
                >
                  <span>从 TT 联动拉取</span>
                </button>
              </div>

              {(() => {
                const kw = pullSearch.trim().toLowerCase();
                if (pullSource === 'st') {
                  const filteredSt = kw
                    ? stPullList.filter(
                        (item) =>
                          item.name.toLowerCase().includes(kw) ||
                          item.content.toLowerCase().includes(kw),
                      )
                    : stPullList;
                  return (
                    <>
                      {stPullList.length > 0 && (
                        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 mt-3 relative z-10">
                          <div className="relative flex-1 min-w-0">
                            <Search className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${isLightMode ? 'text-[#64748b]' : 'text-white/40'}`} />
                            <input
                              value={pullSearch}
                              onChange={(e) => setPullSearch(e.target.value)}
                              placeholder="搜索酒馆人设..."
                              className={`w-full pl-9 pr-3 py-2 rounded-2xl text-xs sm:text-sm outline-none border transition-all ${
                                isLightMode
                                  ? '!bg-[#f1f5f9] !text-[#0f172a] placeholder:!text-[#94a3b8] !border-[#e2e8f0] focus:!border-[#007aff] focus:!bg-[#ffffff]'
                                  : 'bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:bg-white/10'
                              }`}
                            />
                          </div>
                          <div className="flex items-center gap-2 shrink-0 justify-between sm:justify-end">
                            <span className={`text-xs font-semibold ${isLightMode ? 'text-[#475569]' : 'text-white/60'}`}>
                              已选 <strong className={isLightMode ? 'text-[#007aff] font-bold' : 'text-blue-400 font-bold'}>{stSelectedIds.size}</strong> / {stPullList.length}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setStSelectedIds(new Set(filteredSt.map((x) => x.id)))}
                                className={`text-xs px-3 py-1.5 rounded-full font-semibold cursor-pointer border-0 whitespace-nowrap transition ${
                                  isLightMode ? '!bg-[#f1f5f9] !text-[#334155] hover:!bg-[#e2e8f0]' : 'bg-white/10 text-white/80 hover:bg-white/15'
                                }`}
                              >
                                全选
                              </button>
                              <button
                                type="button"
                                onClick={() => setStSelectedIds(new Set())}
                                className={`text-xs px-3 py-1.5 rounded-full font-semibold cursor-pointer border-0 whitespace-nowrap transition ${
                                  isLightMode ? '!bg-[#f1f5f9] !text-[#334155] hover:!bg-[#e2e8f0]' : 'bg-white/10 text-white/80 hover:bg-white/15'
                                }`}
                              >
                                清空
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex-1 overflow-y-auto space-y-2 pr-1 my-3 max-h-[46vh] custom-scrollbar relative z-10">
                        {stPullLoading ? (
                          <div className="py-12 text-center space-y-2 version-modal-desc">
                            <Loader2 className="w-6 h-6 mx-auto animate-spin text-blue-500 [.light-theme_&]:!text-[#007aff]" />
                            <p className="text-xs sm:text-sm">载入中</p>
                          </div>
                        ) : stPullError ? (
                          <div className="py-12 px-4 text-center space-y-3">
                            <AlertCircle className="w-8 h-8 mx-auto text-amber-500 opacity-90" />
                            <p className="text-xs sm:text-sm version-modal-desc leading-relaxed">{stPullError}</p>
                            <button
                              type="button"
                              onClick={() => void loadStPersonas()}
                              className={`px-4 py-2 rounded-full text-xs font-semibold cursor-pointer border-0 inline-flex items-center gap-1.5 ${
                                isLightMode
                                  ? '!bg-[#eff6ff] !text-[#007aff] hover:!bg-[#dbeafe]'
                                  : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
                              }`}
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>重新获取</span>
                            </button>
                          </div>
                        ) : filteredSt.length === 0 ? (
                          <div className="py-12 text-center text-xs sm:text-sm version-modal-desc">
                            没有匹配的人设条目
                          </div>
                        ) : (
                          filteredSt.map((item) => {
                            const isSelected = stSelectedIds.has(item.id);
                            return (
                              <div
                                key={item.id}
                                onClick={() => {
                                  setStSelectedIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(item.id)) next.delete(item.id);
                                    else next.add(item.id);
                                    return next;
                                  });
                                }}
                                className={`p-3 rounded-2xl transition cursor-pointer flex items-center gap-3 border version-candidate-card select-none ${
                                  isSelected ? 'is-selected' : ''
                                }`}
                              >
                                <StPersonaThumb
                                  stUrl={stConnInfo.stUrl}
                                  authHeaders={stConnInfo.authHeaders}
                                  avatarKey={item.avatarKey}
                                  name={item.name}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <h4 className="font-bold text-sm truncate version-candidate-name">
                                      {item.name}
                                    </h4>
                                    {item.isActive && (
                                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 bg-blue-500/20 text-blue-200 [.light-theme_&]:!bg-[#eff6ff] [.light-theme_&]:!text-[#007aff]">
                                        酒馆当前激活
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs truncate mt-0.5 version-candidate-sub">
                                    {item.content ? item.content.slice(0, 80) : '暂无设定描述'}
                                  </p>
                                </div>
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center transition shrink-0 version-candidate-radio ${isSelected ? 'is-selected' : ''}`}>
                                  {isSelected && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>

                      <div className="flex gap-3 pt-3 border-t version-modal-border relative z-10">
                        <button
                          type="button"
                          onClick={handleClosePullModal}
                          className={`flex-1 py-3 px-4 rounded-2xl font-semibold text-xs sm:text-sm cursor-pointer transition active:scale-95 flex items-center justify-center whitespace-nowrap border-0 ${
                            isLightMode
                              ? '!bg-[#f1f5f9] !text-[#0f172a] hover:!bg-[#e2e8f0]'
                              : 'bg-white/10 hover:bg-white/20 text-white/90'
                          }`}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          disabled={stSelectedIds.size === 0 || stPullLoading || stPullImporting}
                          onClick={handleConfirmStPull}
                          className={`flex-1 py-3 px-4 rounded-2xl font-bold text-xs sm:text-sm disabled:opacity-40 flex items-center justify-center gap-2 whitespace-nowrap transition active:scale-95 cursor-pointer border-0 ${
                            isLightMode
                              ? '!bg-[#86b9f4] !text-[#ffffff] hover:!bg-[#a7cbf6]'
                              : 'bg-blue-600 hover:bg-blue-500 text-white'
                          }`}
                        >
                          {stPullImporting ? (
                            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                          ) : (
                            <Download className="w-4 h-4 shrink-0" />
                          )}
                          <span>{stPullImporting ? '正在导入...' : `拉取选中 (${stSelectedIds.size})`}</span>
                        </button>
                      </div>
                    </>
                  );
                }

                // source === 'tt'
                const filteredTt = kw
                  ? ttPullList.filter(
                      (card) =>
                        card.name.toLowerCase().includes(kw) ||
                        (card.sub || '').toLowerCase().includes(kw),
                    )
                  : ttPullList;
                const elapsed = ttPullState.requestedAt ? Date.now() - ttPullState.requestedAt : 0;
                const listStalled = ttPullState.phase === 'listing' && elapsed > 90000;
                const pullStalled = ttPullState.phase === 'pulling' && elapsed > 5 * 60 * 1000;
                const canPickTt = ttPullList.length > 0;
                const ttHint =
                  ttNotice ||
                  ttPullState.extError ||
                  (pullStalled
                    ? '拉取似乎卡住了，点「重新请求」再来一次。'
                    : listStalled
                      ? '请确认酒馆在前台打开，并在扩展面板中已点击「连接 MIU」（若扩展暂未升级人设协议，可先在酒馆端导出推送至待接收）。'
                      : '');

                return (
                  <>
                    {canPickTt && (
                      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 mt-3 relative z-10">
                        <div className="relative flex-1 min-w-0">
                          <Search className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${isLightMode ? 'text-[#64748b]' : 'text-white/40'}`} />
                          <input
                            value={pullSearch}
                            onChange={(e) => setPullSearch(e.target.value)}
                            placeholder="搜索 TT 人设..."
                            className={`w-full pl-9 pr-3 py-2 rounded-2xl text-xs sm:text-sm outline-none border transition-all ${
                              isLightMode
                                ? '!bg-[#f1f5f9] !text-[#0f172a] placeholder:!text-[#94a3b8] !border-[#e2e8f0] focus:!border-[#007aff] focus:!bg-[#ffffff]'
                                : 'bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:bg-white/10'
                            }`}
                          />
                        </div>
                        <div className="flex items-center gap-2 shrink-0 justify-between sm:justify-end">
                          <span className={`text-xs font-semibold ${isLightMode ? 'text-[#475569]' : 'text-white/60'}`}>
                            已选 <strong className={isLightMode ? 'text-[#007aff] font-bold' : 'text-blue-400 font-bold'}>{ttSelectedIds.size}</strong> / {ttPullList.length}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setTtSelectedIds(new Set(filteredTt.map((c) => c.id)))}
                              className={`text-xs px-3 py-1.5 rounded-full font-semibold cursor-pointer border-0 whitespace-nowrap transition ${
                                isLightMode ? '!bg-[#f1f5f9] !text-[#334155] hover:!bg-[#e2e8f0]' : 'bg-white/10 text-white/80 hover:bg-white/15'
                              }`}
                            >
                              全选
                            </button>
                            <button
                              type="button"
                              onClick={() => setTtSelectedIds(new Set())}
                              className={`text-xs px-3 py-1.5 rounded-full font-semibold cursor-pointer border-0 whitespace-nowrap transition ${
                                isLightMode ? '!bg-[#f1f5f9] !text-[#334155] hover:!bg-[#e2e8f0]' : 'bg-white/10 text-white/80 hover:bg-white/15'
                              }`}
                            >
                              清空
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex-1 overflow-y-auto space-y-2 pr-1 my-3 max-h-[46vh] custom-scrollbar relative z-10">
                      {ttImporting ? (
                        <div className="py-12 text-center text-xs sm:text-sm version-modal-desc">
                          正在将人设收进 MIU 人设库…
                        </div>
                      ) : ttWaitingList && !ttHint ? (
                        <div className="py-12 text-center space-y-2 version-modal-desc">
                          <Loader2 className="w-6 h-6 mx-auto animate-spin text-blue-500 [.light-theme_&]:!text-[#007aff]" />
                          <p className="text-xs sm:text-sm">载入中</p>
                        </div>
                      ) : !canPickTt ? (
                        <div className="py-12 text-center text-xs sm:text-sm version-modal-desc">
                          {ttHint ? '暂无可用人设列表' : '暂未收到 TauriTavern 人设列表'}
                        </div>
                      ) : filteredTt.length === 0 ? (
                        <div className="py-12 text-center text-xs sm:text-sm version-modal-desc">
                          没有匹配的人设
                        </div>
                      ) : (
                        filteredTt.map((card) => {
                          const isSelected = ttSelectedIds.has(card.id);
                          return (
                            <div
                              key={card.id}
                              onClick={() => {
                                setTtSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(card.id)) next.delete(card.id);
                                  else next.add(card.id);
                                  return next;
                                });
                              }}
                              className={`p-3 rounded-2xl transition cursor-pointer flex items-center gap-3 border version-candidate-card select-none ${
                                isSelected ? 'is-selected' : ''
                              }`}
                            >
                              <TtPersonaThumb avatar={card.avatar || card.id} rev={ttPullState.thumbRev} />
                              <div className="min-w-0 flex-1">
                                <h4 className="font-bold text-sm truncate version-candidate-name">
                                  {card.name || card.id}
                                </h4>
                                <p className="text-xs truncate mt-0.5 version-candidate-sub">
                                  {card.sub || 'TauriTavern User 人设'}
                                </p>
                              </div>
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center transition shrink-0 version-candidate-radio ${isSelected ? 'is-selected' : ''}`}>
                                {isSelected && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {(ttHint || ttPullState.phase === 'pulling') && (
                      <div className="mb-2 text-xs relative z-10 flex items-start gap-2 text-white/70 [.light-theme_&]:!text-[#334155]">
                        {ttHint ? (
                          <>
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-500 mt-0.5" />
                            <span className="min-w-0">{ttHint}</span>
                          </>
                        ) : (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                            <span className="truncate">
                              正在拉取 {ttPullState.done} / {ttPullState.total} 项
                              {ttPullState.failed > 0 ? `（失败 ${ttPullState.failed} 项）` : ''}
                            </span>
                          </>
                        )}
                      </div>
                    )}

                    <div className="flex gap-3 pt-3 border-t version-modal-border relative z-10">
                      <button
                        type="button"
                        onClick={handleClosePullModal}
                        className={`flex-1 py-3 px-4 rounded-2xl font-semibold text-xs sm:text-sm cursor-pointer transition active:scale-95 flex items-center justify-center whitespace-nowrap border-0 ${
                          isLightMode
                            ? '!bg-[#f1f5f9] !text-[#0f172a] hover:!bg-[#e2e8f0]'
                            : 'bg-white/10 hover:bg-white/20 text-white/90'
                        }`}
                      >
                        {canPickTt ? '取消' : '关闭'}
                      </button>
                      {canPickTt ? (
                        <button
                          type="button"
                          disabled={ttSelectedIds.size === 0}
                          onClick={handleConfirmTtPull}
                          className={`flex-1 py-3 px-4 rounded-2xl font-bold text-xs sm:text-sm disabled:opacity-40 flex items-center justify-center gap-2 whitespace-nowrap transition active:scale-95 cursor-pointer border-0 ${
                            isLightMode
                              ? '!bg-[#86b9f4] !text-[#ffffff] hover:!bg-[#a7cbf6]'
                              : 'bg-blue-600 hover:bg-blue-500 text-white'
                          }`}
                        >
                          <Download className="w-4 h-4 shrink-0" />
                          <span>拉取选中 ({ttSelectedIds.size})</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={ttImporting || (ttWaitingList && !listStalled) || (ttPullState.phase === 'pulling' && !pullStalled)}
                          onClick={startTtPersonaPull}
                          className={`flex-1 py-3 px-4 rounded-2xl font-bold text-xs sm:text-sm disabled:opacity-40 flex items-center justify-center gap-2 whitespace-nowrap transition active:scale-95 cursor-pointer border-0 ${
                            isLightMode
                              ? '!bg-[#86b9f4] !text-[#ffffff] hover:!bg-[#a7cbf6]'
                              : 'bg-blue-600 hover:bg-blue-500 text-white'
                          }`}
                        >
                          {ttImporting || ttWaitingList || ttPullState.phase === 'pulling' ? (
                            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                          ) : (
                            <RefreshCw className="w-4 h-4 shrink-0" />
                          )}
                          <span>
                            {ttImporting
                              ? '正在导入…'
                              : ttPullState.phase === 'pulling'
                                ? `拉取中 ${ttPullState.done}/${ttPullState.total}`
                                : ttWaitingList && !listStalled
                                  ? '载入中'
                                  : '重新请求'}
                          </span>
                        </button>
                      )}
                    </div>
                  </>
                );
              })()}
            </motion.div>
          </div>
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
