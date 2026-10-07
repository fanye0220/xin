import { resolveAvatarUrl } from "../lib/avatar";
import { getFallbackAvatar } from "../lib/avatar";
import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { Virtuoso } from "react-virtuoso";
import { motion, AnimatePresence } from "framer-motion";
import {
  UploadCloud,
  MessageSquare,
  User,
  FileJson,
  X,
  Settings2,
  Sliders,
  Link,
  ChevronUp,
  ChevronDown,
  Trash2,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Plus,
  Book,
  Search,
  CheckCircle2,
  Check,
  CheckSquare,
  Download,
  Copy,
  Share2,
  Image as ImageIcon,
  FolderOpen,
  Palette,
  LayoutList,
  MoreHorizontal,
} from "lucide-react";
import { useBubbleTheme, BubbleThemeId, ColorSphere } from "../lib/bubbleThemes";
import { MessageContent } from "./MessageContent";
import { ChatCleanerModal } from "./ChatCleanerModal";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import Cropper from "react-easy-crop";
import { ReactNode } from "react";
import {
  getCharacters,
  CharacterCard,
  saveChat,
  saveChatsBulk,
  deleteChat,
  ChatLog,
  getCharacter,
  resolveFolderPath,
} from "../lib/db";
import { isAndroid, saveToGallery, getDownloadTooltip } from "../lib/appBridge";

interface ChatMessage {
  name: string;
  is_user: boolean;
  is_name: boolean;
  send_date: number;
  mes: string;
  extra?: any;
}

function SplitAvatar({
  characterAvatarUrl,
  userAvatarUrl,
  size = 22,
  className = '',
}: {
  characterAvatarUrl?: string | null;
  userAvatarUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const uniqueId = React.useId().replace(/:/g, '');
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`inline-block shrink-0 select-none ${className}`}
      style={{
        filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.25))',
      }}
    >
      <defs>
        <clipPath id={`split-avatar-circle-${uniqueId}`}>
          <circle cx="50" cy="50" r="48" />
        </clipPath>
        <clipPath id={`split-char-${uniqueId}`}>
          <polygon points="0,0 100,0 0,100" />
        </clipPath>
        <clipPath id={`split-user-${uniqueId}`}>
          <polygon points="100,0 100,100 0,100" />
        </clipPath>
      </defs>

      <g clipPath={`url(#split-avatar-circle-${uniqueId})`}>
        {/* 左上半部：角色头像（或角色默认剪影） */}
        <g clipPath={`url(#split-char-${uniqueId})`}>
          {characterAvatarUrl ? (
            <image
              href={characterAvatarUrl}
              x="0"
              y="0"
              width="100"
              height="100"
              preserveAspectRatio="xMidYMid slice"
            />
          ) : (
            <rect width="100" height="100" fill="#3b82f6" />
          )}
          {!characterAvatarUrl && (
            <text
              x="30"
              y="45"
              fill="#ffffff"
              fontSize="28"
              fontWeight="bold"
              textAnchor="middle"
              dominantBaseline="central"
            >
              C
            </text>
          )}
        </g>

        {/* 右下半部：用户头像（或用户默认剪影） */}
        <g clipPath={`url(#split-user-${uniqueId})`}>
          {userAvatarUrl ? (
            <image
              href={userAvatarUrl}
              x="0"
              y="0"
              width="100"
              height="100"
              preserveAspectRatio="xMidYMid slice"
            />
          ) : (
            <rect width="100" height="100" fill="#ec4899" />
          )}
          {!userAvatarUrl && (
            <text
              x="70"
              y="75"
              fill="#ffffff"
              fontSize="28"
              fontWeight="bold"
              textAnchor="middle"
              dominantBaseline="central"
            >
              U
            </text>
          )}
        </g>

        {/* 对角线精致分割线 */}
        <line
          x1="0"
          y1="100"
          x2="100"
          y2="0"
          stroke="rgba(255, 255, 255, 0.85)"
          strokeWidth="3.5"
        />
      </g>

      {/* 外圈保护圆环 */}
      <circle
        cx="50"
        cy="50"
        r="48"
        fill="none"
        stroke="rgba(0, 0, 0, 0.2)"
        strokeWidth="2.5"
      />
    </svg>
  );
}

export function ChatViewer({
  onClose,
  initialChatId,
  singleMode,
  onOpenImport,
  refreshKey,
  onActiveViewChange,
  backSignal,
  isLightMode: propIsLightMode,
}: {
  onClose: () => void;
  initialChatId?: string | null;
  singleMode?: boolean;
  onOpenImport?: (files?: FileList | File[]) => void;
  refreshKey?: number;
  onActiveViewChange?: (hasInnerView: boolean) => void;
  backSignal?: number;
  isLightMode?: boolean;
}) {
  const [isLightMode, setIsLightMode] = useState(() => {
    if (typeof propIsLightMode === "boolean") return propIsLightMode;
    return (
      document.documentElement.classList.contains("light-theme") ||
      localStorage.getItem("tavern_theme") === "light"
    );
  });

  useEffect(() => {
    if (typeof propIsLightMode === "boolean") {
      setIsLightMode(propIsLightMode);
      return;
    }
    const checkTheme = () => {
      setIsLightMode(
        document.documentElement.classList.contains("light-theme") ||
        localStorage.getItem("tavern_theme") === "light"
      );
    };
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    window.addEventListener("storage", checkTheme);
    return () => {
      observer.disconnect();
      window.removeEventListener("storage", checkTheme);
    };
  }, [propIsLightMode]);

  const [savedChats, setSavedChats] = useState<
    (Omit<ChatLog, "messages"> & {
      messageCount: number;
      firstAiName?: string;
      lastMessagePreview?: string;
    })[]
  >([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChat, setActiveChat] = useState<ChatLog | null>(null);
  const [chatDisplayMode, setChatDisplayMode] = useState<'card' | 'bubble'>(
    () => (localStorage.getItem('miu_chat_display_mode') as any) || 'card'
  );
  const [editingMsgIndex, setEditingMsgIndex] = useState<number | null>(null);
  const [editingMsgContent, setEditingMsgContent] = useState<string>("");

  const handleSaveEditedMessage = async () => {
    if (editingMsgIndex === null || !activeChat) return;
    const updatedMessages = [...activeChat.messages];
    updatedMessages[editingMsgIndex] = {
      ...updatedMessages[editingMsgIndex],
      mes: editingMsgContent,
    };
    const updatedChat = {
      ...activeChat,
      messages: updatedMessages,
      updatedAt: Date.now(),
    };
    setActiveChat(updatedChat);
    setEditingMsgIndex(null);

    const { saveChat } = await import("../lib/db");
    await saveChat(updatedChat);
  };

  // 全局的返回手势/物理返回键(App.tsx 那边)不知道这个工具内部还有"列表 -> 具体
  // 聊天"这一层导航, 之前会直接把整个聊天记录查看器关掉, 而不是先退回列表。
  // 这里把"当前是否深入到某条聊天里"同步给外层, 外层想让我们退一层时就把
  // backSignal 加一, 我们收到变化就退回列表。
  useEffect(() => {
    onActiveViewChange?.(!!activeChatId);
  }, [activeChatId]);

  const isFirstBackSignal = useRef(true);
  useEffect(() => {
    if (isFirstBackSignal.current) {
      isFirstBackSignal.current = false;
      return;
    }
    if (activeChatId) setActiveChatId(null);
  }, [backSignal]);

  useEffect(() => {
    if (initialChatId) {
      setActiveChatId(initialChatId);
    }
  }, [initialChatId]);

  useEffect(() => {
    const loadActiveChat = async () => {
      if (activeChatId) {
        const { getChatById, getChatsForCharacter } = await import("../lib/db");
        let chat = await getChatById(activeChatId);
        if (!chat) {
          // If activeChatId is a character ID, attempt to auto-load its latest chat log
          const charChats = await getChatsForCharacter(activeChatId);
          if (charChats && charChats.length > 0) {
            charChats.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
            chat = charChats[0];
          }
        }
        setActiveChat(chat || null);
      } else {
        setActiveChat(null);
      }
    };
    loadActiveChat();
  }, [activeChatId]);

  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [characters, setCharacters] = useState<CharacterCard[]>([]);

  const [isHeaderExpanded, setIsHeaderExpanded] = useState(false);
  const [isMainHeaderExpanded, setIsMainHeaderExpanded] = useState(true);
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string>>({});
  const [imgErrorMap, setImgErrorMap] = useState<Record<string, boolean>>({});
  // 记录 onError 兜底逻辑里给某个角色创建过的 blob URL, 换新的之前先把旧的释放掉,
  // 避免每次头像加载失败都新建一个却不释放。
  const fallbackAvatarUrlsRef = useRef<Record<string, string>>({});
  const setFallbackAvatarBlobUrl = (charId: string, blob: Blob): string => {
    const prev = fallbackAvatarUrlsRef.current[charId];
    if (prev) URL.revokeObjectURL(prev);
    const newUrl = URL.createObjectURL(blob);
    fallbackAvatarUrlsRef.current[charId] = newUrl;
    return newUrl;
  };
  useEffect(() => {
    return () => {
      Object.values(fallbackAvatarUrlsRef.current).forEach((u) =>
        URL.revokeObjectURL(u),
      );
      fallbackAvatarUrlsRef.current = {};
    };
  }, []);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {},
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [characterSearchQuery, setCharacterSearchQuery] = useState("");

  const [isBatchMode, setIsBatchMode] = useState(false);
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(
    new Set(),
  );
  const [isCleanerOpen, setIsCleanerOpen] = useState(false);

  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);

  const [importProgress, setImportProgress] = useState<{
    show: boolean;
    current: number;
    total: number;
    message: string;
  }>({ show: false, current: 0, total: 0, message: "" });

  const handleTouchStart = (
    e: React.TouchEvent | React.MouseEvent,
    chatOrGroupId: string,
    isGroup: boolean,
  ) => {
    if (isBatchMode) return;
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    touchStartPos.current = { x: clientX, y: clientY };

    longPressTimer.current = setTimeout(() => {
      setIsBatchMode(true);
      if (!isGroup) {
        setSelectedChatIds(new Set([chatOrGroupId]));
      } else {
        const group = groupedChats.find(
          (g) => g.characterName === chatOrGroupId,
        );
        if (group) {
          setSelectedChatIds(new Set(group.chats.map((c) => c.id)));
        }
      }
    }, 500);
  };

  const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!touchStartPos.current) return;
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;

    const dx = clientX - touchStartPos.current.x;
    const dy = clientY - touchStartPos.current.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      touchStartPos.current = null;
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    touchStartPos.current = null;
  };

  const groupedChats = useMemo(() => {
    const groups: {
      characterName: string;
      characterId: string | undefined;
      chats: typeof savedChats;
      aiName: string | undefined;
    }[] = [];
    const map = new Map<string, number>();

    const charById = new Map<string, typeof characters[0]>();
    const charByName = new Map<string, typeof characters[0]>();
    characters.forEach(c => {
      charById.set(c.id, c);
      charByName.set(c.name.toLowerCase(), c);
    });

    savedChats.forEach((chat) => {
      let matchedChar = chat.characterId ? charById.get(chat.characterId) : null;
      if (!matchedChar && chat.firstAiName) {
        matchedChar = charByName.get(chat.firstAiName.toLowerCase()) || null;
      }

      const groupName = matchedChar?.name || chat.firstAiName || "未归类聊天";

      if (
        searchQuery &&
        !groupName.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !chat.name.toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return;
      }

      const charId = matchedChar?.id;

      let index = map.get(groupName);
      if (index === undefined) {
        index = groups.length;
        map.set(groupName, index);
        groups.push({
          characterName: groupName,
          characterId: charId,
          aiName: chat.firstAiName,
          chats: [],
        });
      }
      groups[index].chats.push(chat);
    });

    let result = groups.sort(
      (a, b) => b.chats[0].createdAt - a.chats[0].createdAt,
    );

    return result;
  }, [savedChats, characters, searchQuery]);

  // Initially expand the group that contains the active chat
  useEffect(() => {
    if (activeChatId && groupedChats.length > 0) {
      const activeGroup = groupedChats.find((g) =>
        g.chats.some((c) => c.id === activeChatId),
      );
      if (
        activeGroup &&
        expandedGroups[activeGroup.characterName] === undefined
      ) {
        setExpandedGroups((prev) => ({
          ...prev,
          [activeGroup.characterName]: true,
        }));
      }
    }
  }, [activeChatId, groupedChats]);

  const flattenedChatItems = useMemo(() => {
    const items: (
      | { type: "header"; groupName: string; group: (typeof groupedChats)[0] }
      | {
          type: "chat";
          chat: (typeof savedChats)[0];
          groupName: string;
          isLast?: boolean;
        }
    )[] = [];
    groupedChats.forEach((group) => {
      items.push({ type: "header", groupName: group.characterName, group });
      if (expandedGroups[group.characterName] || searchQuery) {
        group.chats.forEach((chat, i) => {
          items.push({
            type: "chat",
            chat,
            groupName: group.characterName,
            isLast: i === group.chats.length - 1,
          });
        });
      }
    });
    return items;
  }, [groupedChats, expandedGroups, searchQuery]);

  const toggleGroup = (groupName: string) => {
    setExpandedGroups((prev) => ({ ...prev, [groupName]: !prev[groupName] }));
  };

  const [editingNoteFor, setEditingNoteFor] = useState<string | null>(null);
  const [editNoteContent, setEditNoteContent] = useState("");

  const [customTags, setCustomTags] = useState<string[]>([]);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showBubblePicker, setShowBubblePicker] = useState(false);
  const { themeId: bubbleThemeId, theme: bubbleTheme, setTheme: setBubbleTheme, allThemes: bubbleThemes } = useBubbleTheme();
  const [showUserAvatarSheet, setShowUserAvatarSheet] = useState(false);
  const [newTagInput, setNewTagInput] = useState("");
  const userAvatarInputRef = useRef<HTMLInputElement>(null);
  const userFileInputRef = useRef<HTMLInputElement>(null);

  // Cropping states
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);

  useEffect(() => {
    const savedTags = localStorage.getItem("chatViewer_customTags");
    if (savedTags) {
      try {
        setCustomTags(JSON.parse(savedTags));
      } catch (e) {}
    }
    const savedAvatar = localStorage.getItem("chatViewer_userAvatar");
    if (savedAvatar) {
      setUserAvatar(savedAvatar);
    }
  }, []);

  const handleAddCustomTag = () => {
    if (newTagInput.trim()) {
      const tag = newTagInput
        .trim()
        .replace(/^<*\/?|\/?>*$/g, "")
        .trim();
      if (!tag) return;

      const updated = [...customTags, tag];
      setCustomTags(updated);
      localStorage.setItem("chatViewer_customTags", JSON.stringify(updated));
      setNewTagInput("");
    }
  };

  const handleRemoveCustomTag = (tagToRemove: string) => {
    const updated = customTags.filter((t) => t !== tagToRemove);
    setCustomTags(updated);
    localStorage.setItem("chatViewer_customTags", JSON.stringify(updated));
  };

  const handleUserAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const isImg = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(file.name);
      if (!isImg) {
        alert("所选文件不是图片格式，请在文件管理中选择图片。");
        if (userAvatarInputRef.current) userAvatarInputRef.current.value = "";
        if (userFileInputRef.current) userFileInputRef.current.value = "";
        return;
      }
      const url = URL.createObjectURL(file);
      setImageToCrop(url);
      if (userAvatarInputRef.current) {
        userAvatarInputRef.current.value = "";
      }
      if (userFileInputRef.current) {
        userFileInputRef.current.value = "";
      }
    }
  };

  const onCropComplete = useCallback(
    (croppedArea: any, croppedAreaPixels: any) => {
      setCroppedAreaPixels(croppedAreaPixels);
    },
    [],
  );

  const getCroppedImg = async (
    imageSrc: string,
    pixelCrop: any,
  ): Promise<string> => {
    const image = new Image();
    image.src = imageSrc;
    await new Promise((resolve) => (image.onload = resolve));

    const canvas = document.createElement("canvas");
    const maxSize = 256;
    const scale = Math.min(
      1,
      maxSize / Math.max(pixelCrop.width, pixelCrop.height),
    );
    const finalWidth = pixelCrop.width * scale;
    const finalHeight = pixelCrop.height * scale;

    canvas.width = finalWidth;
    canvas.height = finalHeight;
    const ctx = canvas.getContext("2d");

    if (!ctx) return "";

    ctx.drawImage(
      image,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      finalWidth,
      finalHeight,
    );

    return canvas.toDataURL("image/jpeg", 0.85);
  };

  const closeCrop = () => {
    if (imageToCrop && imageToCrop.startsWith("blob:")) {
      URL.revokeObjectURL(imageToCrop);
    }
    setImageToCrop(null);
  };

  const handleSaveCrop = async () => {
    if (imageToCrop && croppedAreaPixels) {
      const croppedImage = await getCroppedImg(imageToCrop, croppedAreaPixels);
      setUserAvatar(croppedImage);
      try {
        localStorage.setItem("chatViewer_userAvatar", croppedImage);
      } catch (e) {
        console.warn("Could not save user avatar to local storage", e);
      }
      closeCrop();
    }
  };

  const handleClearUserAvatar = () => {
    setUserAvatar(null);
    localStorage.removeItem("chatViewer_userAvatar");
  };

  const handleSaveNote = async (chatMeta: any) => {
    const { getChatById } = await import("../lib/db");
    const fullChat = await getChatById(chatMeta.id);
    if (fullChat) {
      await saveChat({ ...fullChat, note: editNoteContent });
    }
    setEditingNoteFor(null);
    loadData();
  };

  const allCharactersRef = useRef<CharacterCard[] | null>(null);
  const getAllCharactersCached = async (): Promise<CharacterCard[]> => {
    if (allCharactersRef.current) return allCharactersRef.current;
    const { getCharacters } = await import("../lib/db");
    const res = await getCharacters(1, 99999, undefined, "", [], "newest_import", false, false);
    allCharactersRef.current = res.characters;
    return res.characters;
  };

  const [bindableCharacters, setBindableCharacters] = useState<CharacterCard[]>([]);

  useEffect(() => {
    if (isHeaderExpanded && bindableCharacters.length === 0) {
      getAllCharactersCached().then(setBindableCharacters);
    }
  }, [isHeaderExpanded]);

  const loadData = async () => {
    const { getAllChatsMetadata } = await import("../lib/db");
    const chats = await getAllChatsMetadata();
    const sortedChats = (chats || []).sort((a, b) => b.createdAt - a.createdAt);
    setSavedChats(sortedChats);

    // 没有聊天记录时立即返回，彻底避免扫描全量角色库与海量缩略图请求导致的卡顿
    if (sortedChats.length === 0) {
      setCharacters([]);
      setAvatarUrls({});
      return;
    }

    // 仅针对有聊天记录的角色提取其 ID 和名称
    const neededCharIds = new Set<string>();
    const neededNames = new Set<string>();
    sortedChats.forEach((c) => {
      if (c.characterId) neededCharIds.add(c.characterId);
      if (c.firstAiName) neededNames.add(c.firstAiName.trim().toLowerCase());
    });

    const allChars = await getAllCharactersCached();
    const relevantChars = allChars.filter(
      (c) => neededCharIds.has(c.id) || neededNames.has(c.name.trim().toLowerCase())
    );
    setCharacters(relevantChars);
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (refreshKey !== undefined) {
      allCharactersRef.current = null;
      loadData();
    }
  }, [refreshKey]);

  useEffect(() => {
    let active = true;
    const localObjectUrls: string[] = [];

    if (characters.length === 0) {
      setAvatarUrls({});
      return;
    }

    const loadUrls = async () => {
      let getLocalImageUrl: any;
      if (characters.some((c) => c.localFilePath)) {
        const m = await import("../lib/appBridge");
        getLocalImageUrl = m.getLocalImageUrl;
      }

      const { getCharacterThumb } = await import("../lib/db");
      const { peekCachedUrl, putCachedBlobUrl } = await import("../lib/thumbCache");

      const urls: Record<string, string> = {};
      const pendingThumbFetches: Promise<{ charId: string; url: string } | null>[] = [];

      characters.forEach((char) => {
        if (char.localFilePath && getLocalImageUrl) {
          urls[char.id] = getLocalImageUrl(
            char.localFilePath,
            char.updatedAt || char.createdAt,
          );
        } else if (char.avatarBlob) {
          const objectUrl = URL.createObjectURL(char.avatarBlob);
          localObjectUrls.push(objectUrl);
          urls[char.id] = objectUrl;
        } else if (char.hasBlobsSeparated) {
          const thumbCacheKey = `${char.id}:${char.updatedAt || 0}`;
          const cached = peekCachedUrl(thumbCacheKey);
          if (cached) {
            urls[char.id] = cached;
          } else {
            pendingThumbFetches.push(
              getCharacterThumb(char.id).then((thumbBlob: Blob | null) => {
                if (thumbBlob && active) {
                  const url = putCachedBlobUrl(thumbCacheKey, thumbBlob);
                  return { charId: char.id, url };
                }
                return null;
              })
            );
          }
        } else if (
          char.avatarUrlFallback &&
          !char.avatarUrlFallback.includes('api.dicebear.com') &&
          (char.avatarUrlFallback.startsWith('http://') ||
           char.avatarUrlFallback.startsWith('https://') ||
           char.avatarUrlFallback.startsWith('data:image/') ||
           char.avatarUrlFallback.startsWith('blob:')) &&
          !char.avatarUrlFallback.startsWith('data:image/svg+xml')
        ) {
          urls[char.id] = char.avatarUrlFallback;
        }
      });
      if (active) setAvatarUrls(urls);

      // 批量更新缩略图，避免并发异步解析导致频繁触发重渲染
      if (pendingThumbFetches.length > 0) {
        Promise.all(pendingThumbFetches).then((results) => {
          if (!active) return;
          const updates: Record<string, string> = {};
          results.forEach((r) => {
            if (r) updates[r.charId] = r.url;
          });
          if (Object.keys(updates).length > 0) {
            setAvatarUrls((prev) => ({ ...prev, ...updates }));
          }
        });
      }
    };

    loadUrls();

    return () => {
      active = false;
      localObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [characters]);

  const handleFileUpload = async (files: FileList | File[]) => {
    let imported = 0;
    const pendingChats: ChatLog[] = [];
    const allCharsForMatching = await getAllCharactersCached();

    setImportProgress({
      show: true,
      current: 0,
      total: 1,
      message: "正在分析文件...",
    });

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        if (file.name.toLowerCase().endsWith(".zip")) {
          const { default: JSZip } = await import("jszip");
          const zip = new JSZip();
          const loadedZip = await zip.loadAsync(file, {
            decodeFileName: function (bytes: any) {
              try {
                return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
              } catch (e) {
                return new TextDecoder("gbk").decode(new Uint8Array(bytes));
              }
            }
          });

          const filesToProcess = [];
          for (const relativePath in loadedZip.files) {
            const zipEntry = loadedZip.files[relativePath];
            if (zipEntry.dir) continue;

            const lowerName = zipEntry.name.toLowerCase();
            if (lowerName.endsWith(".json") || lowerName.endsWith(".jsonl")) {
              filesToProcess.push(zipEntry);
            }
          }

          setImportProgress({
            show: true,
            current: 0,
            total: filesToProcess.length,
            message: `正在解析压缩包 ${file.name}...`,
          });

          for (let j = 0; j < filesToProcess.length; j++) {
            const zipEntry = filesToProcess[j];
            const lowerName = zipEntry.name.toLowerCase();

            if (j % 10 === 0) {
              setImportProgress({
                show: true,
                current: j + 1,
                total: filesToProcess.length,
                message: `正在解析: ${zipEntry.name.split("/").pop()}`,
              });
              // yield to main thread to allow react to render progress
              await new Promise((r) => setTimeout(r, 0));
            }

            try {
              const arrayBuffer = await zipEntry.async("arraybuffer");
              const blob = new Blob([arrayBuffer]);
              const text = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target?.result as string);
                reader.onerror = reject;
                reader.readAsText(blob, "utf-8");
              });
              let parsedMessages: any[] = [];

              if (lowerName.endsWith(".jsonl")) {
                const lines = text.trim().split("\n");
                for (let k = 0; k < lines.length; k++) {
                  try {
                    const parsed = JSON.parse(lines[k]);
                    if (parsed) parsedMessages.push(parsed);
                  } catch (e) {}
                  if (k % 500 === 0)
                    await new Promise((r) => setTimeout(r, 0));
                }
              } else {
                try {
                  const data = JSON.parse(text);
                  if (Array.isArray(data)) parsedMessages = data;
                  else if (data.chat && Array.isArray(data.chat))
                    parsedMessages = data.chat;
                  else parsedMessages = [data];
                } catch (err) {
                  if (text.trim().split("\n").length > 1) {
                    const lines = text.trim().split("\n");
                    for (let k = 0; k < lines.length; k++) {
                      try {
                        const parsed = JSON.parse(lines[k]);
                        if (parsed) parsedMessages.push(parsed);
                      } catch (e) {}
                      if (k % 500 === 0)
                        await new Promise((r) => setTimeout(r, 0));
                    }
                  }
                }
              }

              if (parsedMessages.length === 0) continue;

              let charId = "";
              const pathParts = zipEntry.name.split("/");
              if (pathParts.length > 1) {
                let charNameIndex = pathParts.length - 2;
                if (
                  pathParts[charNameIndex] === "聊天记录" &&
                  pathParts.length > 2
                ) {
                  charNameIndex = pathParts.length - 3;
                }
                const parentFolderName = pathParts[charNameIndex];
                const folderMatch = allCharsForMatching.find(
                  (c) =>
                    c.name.toLowerCase() === parentFolderName.toLowerCase(),
                );
                if (folderMatch) charId = folderMatch.id;
              }

              if (!charId) {
                const aiMessage = parsedMessages.find(
                  (m) => !m.is_user && m.name,
                );
                if (aiMessage && aiMessage.name) {
                  const match = allCharsForMatching.find(
                    (c) =>
                      c.name.toLowerCase() === aiMessage.name?.toLowerCase(),
                  );
                  if (match) charId = match.id;
                }
              }

              const chatName = zipEntry.name.split("/").pop() || zipEntry.name;
              const finalMessages = parsedMessages.map((m: any) => ({
                ...m,
                is_user: m.is_user !== undefined ? m.is_user : m.name !== chatName,
                send_date: m.send_date || Date.now(),
                mes: m.mes || m.text || "",
              }));

              pendingChats.push({
                id: crypto.randomUUID(),
                characterId: charId,
                name: chatName.replace(/\.[^/.]+$/, ""),
                messages: finalMessages,
                createdAt: zipEntry.date ? zipEntry.date.getTime() : Date.now(),
              });
              imported++;
            } catch (e) {
              console.error(
                `Failed to parse file inside zip: ${zipEntry.name}`,
                e,
              );
            }
          }
        } else {
          setImportProgress({
            show: true,
            current: 0,
            total: 1,
            message: `正在解析文件 ${file.name}...`,
          });

          const text = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.onerror = reject;
            reader.readAsText(file, "utf-8");
          });
          let parsedMessages: any[] = [];

          if (file.name.toLowerCase().endsWith(".jsonl")) {
            const lines = text.trim().split("\n");
            for (let k = 0; k < lines.length; k++) {
              try {
                const parsed = JSON.parse(lines[k]);
                if (parsed) parsedMessages.push(parsed);
              } catch (e) {}
              if (k % 500 === 0) await new Promise((r) => setTimeout(r, 0));
            }
          } else {
            try {
              const data = JSON.parse(text);
              if (Array.isArray(data)) parsedMessages = data;
              else if (data.chat && Array.isArray(data.chat))
                parsedMessages = data.chat;
              else parsedMessages = [data];
            } catch (err) {
              if (text.trim().split("\n").length > 1) {
                const lines = text.trim().split("\n");
                for (let k = 0; k < lines.length; k++) {
                  try {
                    const parsed = JSON.parse(lines[k]);
                    if (parsed) parsedMessages.push(parsed);
                  } catch (e) {}
                  if (k % 500 === 0) await new Promise((r) => setTimeout(r, 0));
                }
              }
            }
          }

          if (parsedMessages.length === 0) continue;

          const aiMessage = parsedMessages.find((m) => !m.is_user && m.name);
          let charId = "";
          if (aiMessage && aiMessage.name) {
            const match = allCharsForMatching.find(
              (c) => c.name.toLowerCase() === aiMessage.name.toLowerCase(),
            );
            if (match) charId = match.id;
          }

          const chatName = file.name.replace(/\.[^/.]+$/, "");
          const finalMessages = parsedMessages.map((m: any) => ({
            ...m,
            is_user: m.is_user !== undefined ? m.is_user : m.name !== chatName,
            send_date: m.send_date || Date.now(),
            mes: m.mes || m.text || "",
          }));

          pendingChats.push({
            id: crypto.randomUUID(),
            characterId: charId,
            name: chatName,
            messages: finalMessages,
            createdAt: file.lastModified || Date.now(),
          });
          imported++;
        }
      } catch (e) {
        console.error(e);
        alert(
          `解析文件 ${file.name} 失败，请确保格式为酒馆导出的 zip, jsonl 或 json 格式。`,
        );
      }
    }

    if (pendingChats.length > 0) {
      setImportProgress((prev) => ({
        ...prev,
        message: "正在保存记录到数据库...",
      }));
      await saveChatsBulk(pendingChats, (current, total, phase) => {
        setImportProgress((prev) => ({
          ...prev,
          current,
          total,
          message: phase,
        }));
      });
    }

    if (imported > 0) {
      loadData();
    }

    setTimeout(() => {
      setImportProgress({ show: false, current: 0, total: 0, message: "" });
    }, 500);
  };

  // Auto-detect active character if bound or match by AI name
  let activeCharacter =
    activeChat && activeChat.characterId
      ? characters.find((c) => c.id === activeChat.characterId)
      : null;
  if (activeChat && !activeCharacter) {
    const aiMsg = activeChat.messages.find((m) => !m.is_user && m.name);
    if (aiMsg?.name) {
      activeCharacter =
        characters.find(
          (c) => c.name.toLowerCase() === aiMsg.name?.toLowerCase(),
        ) || null;
    }
  }

  const formatCustomTags = (text: string) => {
    if (!text) return "";
    let result = text;
    // Format various Think tags: <think>, [think], {{think}}
    const thinkRegex =
      /(?:<|&lt;|\[+|\\\[+|\{+)\s*(?:think|thought|thinking)\s*(?:>|&gt;|\]+|\\\]+|\}+)([\s\S]*?)(?:<|&lt;|\[+|\\\[+|\{+)\/\s*(?:think|thought|thinking)\s*(?:>|&gt;|\]+|\\\]+|\}+)/gi;
    result = result.replace(
      thinkRegex,
      '<details class="text-sm bg-[rgba(255,255,255,0.05)] [.light-theme_&]:bg-black/5 border border-[rgba(255,255,255,0.1)] [.light-theme_&]:border-black/10 rounded-lg p-2 my-2 w-full max-w-full overflow-hidden"><summary class="cursor-pointer font-bold text-[#8491CD] hover:opacity-80 transition-opacity select-none">🤔 思维链</summary><div class="mt-2 text-[#707CB1] break-words whitespace-pre-wrap max-w-full overflow-x-auto">$1</div></details>',
    );

    // Apply user defined custom tags
    const processedTags = new Set(
      customTags
        .map((t) =>
          t
            .replace(/^<*\/?|\/?>*$/g, "")
            .replace(/^\[*\/?|\/?\]*$/g, "")
            .replace(/^\{*\/?|\/?\}*$/g, "")
            .trim(),
        )
        .filter(Boolean),
    );

    processedTags.forEach((tag) => {
      // Escape tag for regex just in case
      const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // Match paired tags with optional attributes. Handle <, &lt;, [, {
      const pairedRe = new RegExp(
        `(?:<|&lt;|\\[|\\{)\\s*${escapedTag}(?:\\s+(?:[^>&\\]\\}]+))?(?:>|&gt;|\\]|\\})([\\s\\S]*?)(?:<|&lt;|\\[|\\{)\\/\\s*${escapedTag}\\s*(?:>|&gt;|\\]|\\})`,
        "gi",
      );
      result = result.replace(
        pairedRe,
        `<details class="text-sm bg-[rgba(255,255,255,0.05)] [.light-theme_&]:bg-black/5 border border-[rgba(255,255,255,0.1)] [.light-theme_&]:border-black/10 rounded-lg p-2 my-2 w-full max-w-full overflow-hidden"><summary class="cursor-pointer font-bold text-[#8491CD] select-none">${tag}</summary><div class="mt-2 text-[#707CB1] whitespace-pre-wrap break-words max-w-full overflow-x-auto">$1</div></details>`,
      );

      // Match stray/single tags so they don't disappear in markdown rendering
      const singleRe = new RegExp(
        `(?:<|&lt;|\\[|\\{)\\s*${escapedTag}(?:\\s+(?:[^>&\\]\\}]+))?\\/?\\s*(?:>|&gt;|\\]|\\})`,
        "gi",
      );
      result = result.replace(
        singleRe,
        `<div class="text-sm border-l-2 border-[#8491CD]/50 pl-3 py-1 my-2 text-[#8491CD] italic text-xs"><span class="font-bold">&lt;${tag}&gt;</span></div>`,
      );

      // Clean up stray closing tags
      const singleCloseRe = new RegExp(
        `(?:<|&lt;|\\[|\\{)\\/\\s*${escapedTag}\\s*(?:>|&gt;|\\]|\\})`,
        "gi",
      );
      result = result.replace(
        singleCloseRe,
        `<div class="text-sm border-l-2 border-[#8491CD]/50 pl-3 py-1 my-2 text-[#8491CD] italic text-xs"><span class="font-bold">&lt;/${tag}&gt;</span></div>`,
      );
    });

    return result;
  };

  const extractStyles = (obj: any): string => {
    let styles = "";
    const seen = new Set<string>();
    const extract = (o: any) => {
      if (typeof o === "string") {
        const matches = o.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
        if (matches) {
          for (const match of matches) {
            const innerMatch = match.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
            if (innerMatch && innerMatch[1]) {
              const rules = innerMatch[1].trim();
              // We add the bare CSS rules, but we could wrap them to scope if we want.
              if (rules && !seen.has(rules)) {
                seen.add(rules);
                styles += rules + "\n";
              }
            }
          }
        }
      } else if (Array.isArray(o)) {
        o.forEach(extract);
      } else if (typeof o === "object" && o !== null) {
        Object.values(o).forEach(extract);
      }
    };
    extract(obj);
    return styles;
  };

  const cssStyleString = activeCharacter
    ? extractStyles(activeCharacter.data)
    : "";

  const applyRegexes = (
    text: string,
    char: CharacterCard | null | undefined,
  ) => {
    let result = text;
    if (!char) return result;

    const exts = char.data?.data?.extensions || char.data?.extensions || {};
    const regexScripts = exts.regex_scripts || [];

    if (!Array.isArray(regexScripts)) return result;

    const validScripts = regexScripts.filter(
      (s) =>
        !s.disabled &&
        (s.regex || s.findRegex) &&
        (s.replacementString !== undefined || s.replaceString !== undefined),
    );

    for (const script of validScripts) {
      try {
        let pattern = script.regex || script.findRegex;
        let flags = "g";
        if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
          const lastSlash = pattern.lastIndexOf("/");
          flags = pattern.substring(lastSlash + 1);
          if (!flags.includes("g")) flags += "g";
          pattern = pattern.substring(1, lastSlash);
        }

        pattern = pattern.replace(/{{char}}/gi, char.name);
        pattern = pattern.replace(/{{user}}/gi, "User");
        let replaceStr =
          script.replacementString !== undefined
            ? script.replacementString
            : script.replaceString;

        // Handle unescaping \n and \t from JSON parsed string representing literal slashes
        replaceStr = replaceStr.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
        replaceStr = replaceStr
          .replace(/{{char}}/gi, char.name)
          .replace(/{{user}}/gi, "User");

        const re = new RegExp(pattern, flags);
        result = result.replace(re, replaceStr);
      } catch (e) {
        // invalid regex, skip
      }
    }
    return result;
  };

  const handleUpdateBinding = async (charId: string) => {
    if (!activeChat) return;
    const updated = { ...activeChat, characterId: charId };
    setActiveChat(updated);
    await saveChat(updated);
    loadData();
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      if (onOpenImport) {
        onOpenImport(e.dataTransfer.files);
      } else {
        handleFileUpload(e.dataTransfer.files);
      }
    }
  };

  const [deleteChatId, setDeleteChatId] = useState<string | null>(null);

  const confirmDeleteChat = async () => {
    if (!deleteChatId) return;
    const idToDelete = deleteChatId;
    setDeleteChatId(null);
    setSavedChats((prev) => prev.filter((c) => c.id !== idToDelete));
    if (activeChatId === idToDelete) {
      if (singleMode) onClose();
      else setActiveChatId(null);
    }
    await deleteChat(idToDelete);
  };

  const handleRemoveChat = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteChatId(id);
  };

  const handleBatchExport = async (share: boolean = true) => {
    if (selectedChatIds.size === 1) {
      const chatId = Array.from(selectedChatIds)[0];
      const { getChatById } = await import("../lib/db");
      const fullChat = await getChatById(chatId);
      if (fullChat) {
        const jsonlString = fullChat.messages
          .map((m) =>
            JSON.stringify({
              name: m.name,
              is_user: m.is_user,
              is_name: m.is_name,
              send_date: m.send_date,
              mes: m.mes,
              extra: m.extra,
            }),
          )
          .join("\n");

        let safeChatName = fullChat.name.replace(/[/\\?%*:|"<>]/g, "-");
        if (!safeChatName.endsWith(".jsonl")) safeChatName += ".jsonl";

        const { downloadOrShareFile } = await import("../lib/appBridge");
        const bytes = new TextEncoder().encode(jsonlString);
        await downloadOrShareFile(safeChatName, bytes.buffer, "application/jsonl", share);
        setIsBatchMode(false);
        setShowDuplicatesOnly(false);
        setSelectedChatIds(new Set());
        return;
      }
    }

    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const { getChatById } = await import("../lib/db");

    await Promise.all(
      Array.from(selectedChatIds).map(async (chatId) => {
        const fullChat = await getChatById(chatId);
        if (!fullChat) return;

        const matchedChar = fullChat.characterId
          ? characters.find((c) => c.id === fullChat.characterId)
          : null;
        let aiName = "";
        const aiMsg = fullChat.messages?.find((m: any) => !m.is_user && m.name);
        if (aiMsg) aiName = aiMsg.name;

        let folderName = matchedChar?.name || aiName || "未归类聊天";
        // simple sanitization for folder name
        folderName = folderName.replace(/[/\\?%*:|"<>]/g, "-");

        const jsonlString = fullChat.messages
          .map((m) =>
            JSON.stringify({
              name: m.name,
              is_user: m.is_user,
              is_name: m.is_name,
              send_date: m.send_date,
              mes: m.mes,
              extra: m.extra,
            }),
          )
          .join("\n");

        let safeChatName = fullChat.name.replace(/[/\\?%*:|"<>]/g, "-");
        if (!safeChatName.endsWith(".jsonl")) safeChatName += ".jsonl";

        zip.file(`${folderName}/聊天记录/${safeChatName}`, jsonlString);
      }),
    );

    const content = await zip.generateAsync({ type: "blob" });
    const zipName = `chats_export_${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;

    const { downloadOrShareFile } = await import("../lib/appBridge");
    await downloadOrShareFile(zipName, content, "application/zip", share);

    setIsBatchMode(false);
    setShowDuplicatesOnly(false);
    setSelectedChatIds(new Set());
  };

  const handleChatsCloudUpload = async () => {
    if (selectedChatIds.size === 0) return;

    const { getAccessToken } = await import("../lib/drive");
    const token = await getAccessToken();
    if (!token) {
      alert("请先前往「云端同步」页面登录 Google 账号。");
      return;
    }

    const idsToUpload = Array.from(selectedChatIds);
    setIsBatchMode(false);
    setSelectedChatIds(new Set());
    setShowDuplicatesOnly(false);

    try {
      setImportProgress({
        show: true,
        current: 0,
        total: idsToUpload.length,
        message: "正在准备上传聊天记录到云端...",
      });

      const { uploadChatsToCloud } = await import("../lib/cloudDrive");
      const result = await uploadChatsToCloud(token, idsToUpload, (msg) => {
        const m = msg.match(/\((\d+)\/(\d+)\)/);
        setImportProgress((prev) => ({
          show: true,
          current: m ? Number(m[1]) : prev.current,
          total: m ? Number(m[2]) : prev.total,
          message: msg,
        }));
      });

      setImportProgress({ show: false, current: 0, total: 0, message: "" });
      alert(
        `云端上传完成！成功 ${result.success} 条，跳过 ${result.skipped} 条，失败 ${result.failed} 条。`,
      );
    } catch (err: any) {
      console.error(err);
      setImportProgress({ show: false, current: 0, total: 0, message: "" });
      alert("上传聊天记录失败: " + err.message);
    }
  };

  const handleBatchDelete = async () => {
    if (
      confirm(
        `确定要删除选中的 ${selectedChatIds.size} 条记录吗？\n此操作无法撤销。`,
      )
    ) {
      const idsToDelete = Array.from(selectedChatIds);
      const toDeleteSet = new Set(selectedChatIds);

      setSelectedChatIds(new Set());
      setIsBatchMode(false);
      setShowDuplicatesOnly(false);

      setSavedChats((prev) => prev.filter((c) => !toDeleteSet.has(c.id)));
      if (activeChatId && toDeleteSet.has(activeChatId)) {
        if (singleMode) onClose();
        else setActiveChatId(null);
      }

      // Background deletion
      (async () => {
        setImportProgress({
          show: true,
          current: 0,
          total: idsToDelete.length,
          message: "正在后台删除...",
        });

        const { deleteChatsBulk } = await import("../lib/db");
        await deleteChatsBulk(idsToDelete, (c, t, msg) => {
          setImportProgress({
            show: true,
            current: c,
            total: t,
            message: msg + ` ${c}/${t}`,
          });
        });

        setImportProgress({ show: false, current: 0, total: 0, message: "" });
      })();
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-900 relative overflow-hidden [.light-theme_&]:bg-[#F0F2F5]">
      {/* Dynamic CSS Styles from the active character's configuration */}
      {cssStyleString && (
        <style dangerouslySetInnerHTML={{ __html: cssStyleString }} />
      )}

      {!activeChatId && (
        <header className="sticky top-0 px-4 pb-4 pt-[max(1.75rem,env(safe-area-inset-top))] sm:px-6 sm:pb-5 border-b border-white/10 [.light-theme_&]:!border-[#e2e8f0] bg-slate-900/90 [.light-theme_&]:!bg-[#ffffff]/95 flex items-center justify-between z-20 backdrop-blur-xl gap-2 sm:gap-4 transition-all">
          <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-white/10 [.light-theme_&]:!bg-transparent [.light-theme_&]:hover:!bg-black/5 [.light-theme_&]:active:!bg-black/10 text-white [.light-theme_&]:!text-[#0f172a] transition active:scale-95 touch-manipulation select-none cursor-pointer shrink-0"
              title="返回"
            >
              <ArrowLeft className="w-5 sm:w-6 h-5 sm:h-6" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl sm:text-2xl font-bold text-white [.light-theme_&]:!text-[#0f172a] truncate">
                聊天记录查看器
              </h1>
              <p className="text-xs sm:text-sm text-white/50 [.light-theme_&]:!text-[#8e8e93] mt-0.5 sm:mt-1 truncate">
                可导入JSONL 聊天记录  支持CSS正则渲染
              </p>
              <AnimatePresence>
                {importProgress.show && (
                  <motion.div
                    initial={{ opacity: 0, y: -20, x: '-50%' }}
                    animate={{ opacity: 1, y: 0, x: '-50%' }}
                    exit={{ opacity: 0, y: -20, x: '-50%' }}
                    style={{ top: 'max(1.25rem, calc(env(safe-area-inset-top, 0px) + 0.5rem))' }}
                    className={`fixed left-1/2 z-[100] backdrop-blur-xl border rounded-full px-4 py-2 sm:px-4.5 sm:py-2 flex items-center gap-2.5 max-w-[92vw] w-auto pointer-events-auto overflow-hidden select-none ${
                      isLightMode
                        ? 'bg-slate-800/95 border-blue-100 shadow-[0_8px_30px_rgba(0,0,0,0.08)]'
                        : 'bg-slate-900/90 border-white/15 shadow-[0_8px_30px_rgba(0,0,0,0.25)]'
                    }`}
                  >
                    <Download className={`w-4 h-4 animate-bounce shrink-0 ${isLightMode ? 'text-blue-400' : 'text-blue-400'}`} />
                    <span className={`text-xs sm:text-sm font-medium whitespace-nowrap ${isLightMode ? 'text-[#0f172a]' : 'text-slate-100'}`}>
                      {importProgress.message || '正在导入记录'}
                    </span>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                      isLightMode ? 'text-blue-600 bg-blue-50' : 'text-blue-300 bg-blue-500/20'
                    }`}>
                      {importProgress.total > 0 ? Math.round((importProgress.current / importProgress.total) * 100) : 0}%
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-full hover:bg-white/10 [.light-theme_&]:!bg-transparent [.light-theme_&]:hover:!bg-black/5 [.light-theme_&]:active:!bg-black/10 text-white/70 hover:text-white [.light-theme_&]:!text-[#0f172a] transition shrink-0 cursor-pointer"
              title="界面设置"
            >
              <Settings2 className="w-5 sm:w-6 h-5 sm:h-6" />
            </button>
          </div>
        </header>
      )}

      {/* 悬浮窗球 (Floating Pill Header) when chat is active */}
      <AnimatePresence>
        {activeChatId && activeChat && (
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className="absolute top-[max(1rem,env(safe-area-inset-top))] z-30 pointer-events-none transition-all duration-500 ease-out flex left-1/2 -translate-x-1/2 w-full max-w-sm sm:max-w-md px-4"
          >
            <div className="pointer-events-auto chat-header-pill backdrop-blur-3xl flex items-center transition-all duration-500 overflow-visible rounded-full w-full justify-between p-1.5">
              <button
                onClick={() => (singleMode ? onClose() : setActiveChatId(null))}
                className="w-10 h-10 shrink-0 flex items-center justify-center rounded-full chat-header-btn transition"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>

              <div
                className="flex flex-col items-center justify-center px-2 sm:px-4 overflow-hidden flex-1 cursor-pointer"
                onClick={() => setIsHeaderExpanded(!isHeaderExpanded)}
              >
                <span className="text-sm font-bold chat-header-title-text truncate w-full text-center leading-tight">
                  {activeChat.name}
                </span>
                <span className="text-[11px] chat-header-sub-text block text-center mt-0.5 w-full truncate">
                  {activeChat.messages.length} 条消息
                </span>
              </div>

              <div className="relative flex items-center gap-1 shrink-0">
                {/* 切换 卡片阅读模式 / 对话气泡模式 */}
                <button
                  onClick={() => {
                    const nextMode = chatDisplayMode === 'card' ? 'bubble' : 'card';
                    setChatDisplayMode(nextMode);
                    localStorage.setItem('miu_chat_display_mode', nextMode);
                  }}
                  className="w-10 h-10 flex items-center justify-center rounded-full chat-header-btn transition hover:scale-105 active:scale-95 cursor-pointer"
                  title={chatDisplayMode === 'card' ? "当前：卡片阅读模式（点击切换气泡）" : "当前：对话气泡模式（点击切换卡片）"}
                >
                  {chatDisplayMode === 'card' ? (
                    <LayoutList className="w-4.5 h-4.5 text-blue-400 [.light-theme_&]:!text-blue-600" />
                  ) : (
                    <MessageSquare className="w-4.5 h-4.5 text-slate-300 [.light-theme_&]:!text-slate-600" />
                  )}
                </button>

                <button
                  onClick={() => {
                    setShowBubblePicker(!showBubblePicker);
                    if (isHeaderExpanded) setIsHeaderExpanded(false);
                  }}
                  className={`w-10 h-10 flex items-center justify-center rounded-full transition hover:scale-105 active:scale-95 border-0 ${
                    showBubblePicker
                      ? "chat-header-btn-active !bg-blue-500/20 !text-blue-400 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-blue-600 !border-0 [.light-theme_&]:!border-0 shadow-none"
                      : "chat-header-btn !border-0"
                  }`}
                  title={`当前气泡配色：${bubbleTheme.name}（点击切换）`}
                >
                  <ColorSphere
                    botColor={bubbleTheme.botColor}
                    userColor={bubbleTheme.userColor}
                    size={22}
                  />
                </button>

                <button
                  onClick={() => {
                    setIsHeaderExpanded(!isHeaderExpanded);
                    if (showBubblePicker) setShowBubblePicker(false);
                  }}
                  className={`w-10 h-10 flex items-center justify-center rounded-full transition hover:scale-105 active:scale-95 border-0 ${
                    isHeaderExpanded
                      ? "chat-header-btn-active !bg-blue-500/20 !text-blue-400 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-blue-600 !border-0 [.light-theme_&]:!border-0 shadow-none"
                      : "chat-header-btn !border-0"
                  }`}
                  title="绑定角色与正则设置"
                >
                  <Sliders className="w-4.5 h-4.5" />
                </button>

                <AnimatePresence>
                  {showBubblePicker && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9, y: 10, transformOrigin: "top right" }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: 10 }}
                      className="bubble-picker-popover absolute top-full right-0 mt-3 backdrop-blur-2xl rounded-2xl shadow-2xl w-64 p-3 z-40 overflow-hidden"
                    >
                      <div className="bubble-picker-divider flex items-center justify-between pb-2 mb-2 border-b">
                        <span className="bubble-picker-title text-xs font-bold flex items-center gap-2">
                          <ColorSphere botColor={bubbleTheme.botColor} userColor={bubbleTheme.userColor} size={16} />
                          切换气泡色彩球
                        </span>
                      </div>
                      <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-0.5">
                        {bubbleThemes.map((t) => {
                          const isSelected = bubbleThemeId === t.id;
                          return (
                            <button
                              key={t.id}
                              onClick={() => {
                                setBubbleTheme(t.id);
                                setShowBubblePicker(false);
                              }}
                              className={`bubble-picker-item w-full flex items-center gap-2.5 p-2 rounded-xl text-left transition ${
                                isSelected ? 'is-selected font-semibold' : ''
                              }`}
                            >
                              <ColorSphere botColor={t.botColor} userColor={t.userColor} size={26} />
                              <div className="flex-1 truncate">
                                <div className="text-xs font-bold">{t.name}</div>
                                <div className="bubble-picker-item-badge text-[10px] truncate">{t.badge}</div>
                              </div>
                              {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {isHeaderExpanded && (
                    <motion.div
                      initial={{
                        opacity: 0,
                        scale: 0.9,
                        y: 10,
                        transformOrigin: "top right",
                      }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: 10 }}
                      className="chat-header-popover absolute top-full right-0 mt-3 backdrop-blur-3xl rounded-2xl shadow-2xl w-64 p-4 z-40 overflow-hidden"
                    >
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-2 flex-1 min-h-0">
                          <label className="text-xs text-white/60 [.light-theme_&]:!text-slate-600 font-semibold shrink-0">
                            绑定角色获得正则效果
                          </label>
                          <div className="relative shrink-0 mb-2">
                             <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 [.light-theme_&]:!text-slate-400" />
                             <input
                                type="text"
                                placeholder="搜索角色..."
                                value={characterSearchQuery}
                                onChange={(e) => setCharacterSearchQuery(e.target.value)}
                                className="w-full chat-search-input focus:outline-none rounded-lg pl-9 pr-3 py-2 text-sm"
                             />
                          </div>
                          <div className="flex-1 overflow-y-auto space-y-1 max-h-48 pr-1 hide-scrollbar">
                             <button
                                onClick={() => handleUpdateBinding("")}
                                className={`bubble-picker-item w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm transition cursor-pointer ${
                                  (!activeChat.characterId && !activeCharacter?.id)
                                    ? 'is-selected font-semibold'
                                    : ''
                                }`}
                             >
                                <span>暂不绑定</span>
                                {(!activeChat.characterId && !activeCharacter?.id) && (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                                )}
                             </button>
                             {(bindableCharacters.length > 0 ? bindableCharacters : characters).filter(c => c.name.toLowerCase().includes(characterSearchQuery.toLowerCase())).map(c => {
                                const isSelected = activeChat.characterId === c.id || activeCharacter?.id === c.id;
                                return (
                                  <button
                                     key={c.id}
                                     onClick={() => handleUpdateBinding(c.id)}
                                     className={`bubble-picker-item w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm transition truncate cursor-pointer ${
                                       isSelected ? 'is-selected font-semibold' : ''
                                     }`}
                                  >
                                     <span className="truncate">{c.name}</span>
                                     {isSelected && (
                                       <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                                     )}
                                  </button>
                                );
                             })}
                          </div>
                        </div>
                        {activeCharacter && (
                          <div className="bg-green-500/10 border border-green-500/20 [.light-theme_&]:!bg-green-50 [.light-theme_&]:!border-green-200 rounded-lg p-3">
                            <span className="text-xs text-green-400 [.light-theme_&]:!text-green-700 flex items-center gap-1.5 font-medium">
                              <div className="w-1.5 h-1.5 rounded-full bg-green-400 [.light-theme_&]:!bg-green-600 animate-pulse" />
                              已应用角色正则规则
                            </span>
                          </div>
                        )}
                        <div className="pt-2 mt-2 border-t border-white/10 [.light-theme_&]:!border-slate-200">
                          <button
                            onClick={() => {
                              setIsHeaderExpanded(false);
                              setShowSettings(true);
                            }}
                            className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-white/5 [.light-theme_&]:hover:!bg-slate-100 rounded-lg text-sm text-blue-300 [.light-theme_&]:!text-blue-600 transition cursor-pointer"
                          >
                            <span>界面设置 (头像/折叠)</span>
                            <Settings2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={`flex-1 overflow-hidden p-6 max-w-5xl mx-auto w-full relative flex flex-col`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        {isDragActive && (
          <div className="absolute inset-0 z-50 bg-blue-500/10 backdrop-blur-sm border-2 border-dashed border-blue-400 rounded-3xl m-6 flex items-center justify-center">
            <div className="text-center">
              <UploadCloud className="w-16 h-16 text-blue-400 mx-auto mb-4" />
              <h3 className="text-2xl font-bold text-white">
                松开鼠标导入文件
              </h3>
            </div>
          </div>
        )}

        <div className="space-y-6 flex-1 flex flex-col min-h-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between px-2 shrink-0 gap-3 mb-4">
            <h3 className="text-lg font-medium text-white shrink-0 [.light-theme_&]:!text-[#0f172a]">
              所有记录 ({savedChats.length})
            </h3>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-initial">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/50 [.light-theme_&]:!text-[#64748b] stroke-[1.75]" />
                <input
                  type="text"
                  placeholder="搜索..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full sm:w-44 pl-9 pr-4 py-1.5 sm:py-2 bg-white/10 hover:bg-white/15 focus:bg-white/15 border border-transparent rounded-full text-sm text-white focus:outline-none focus:border-blue-500/40 transition-colors placeholder:text-white/40 [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:hover:!bg-[#cbd5e1]/70 [.light-theme_&]:focus:!bg-[#cbd5e1]/70 [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:placeholder:!text-[#8e8e93] shadow-xs"
                />
              </div>
              <button
                onClick={() => setIsCleanerOpen(true)}
                className="w-8.5 h-8.5 sm:w-9 sm:h-9 rounded-full transition shrink-0 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white/80 hover:text-white border border-transparent [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:hover:!bg-[#cbd5e1] [.light-theme_&]:!text-[#475569] [.light-theme_&]:hover:!text-[#0f172a] cursor-pointer active:scale-95 shadow-xs"
                title="清理记录和分支"
              >
                <Trash2 className="w-4 h-4 stroke-[1.75]" />
              </button>
              <button
                onClick={() => {
                  if (onOpenImport) {
                    onOpenImport();
                  } else {
                    fileInputRef.current?.click();
                  }
                }}
                className="w-8.5 h-8.5 sm:w-9 sm:h-9 rounded-full transition shrink-0 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white/80 hover:text-white border border-transparent [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:hover:!bg-[#cbd5e1] [.light-theme_&]:!text-[#475569] [.light-theme_&]:hover:!text-[#0f172a] cursor-pointer active:scale-95 shadow-xs"
                title="导入聊天记录"
              >
                <UploadCloud className="w-4 h-4 stroke-[1.75]" />
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".json,.jsonl,.zip"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  if (onOpenImport) {
                    onOpenImport(e.target.files);
                  } else {
                    handleFileUpload(e.target.files);
                  }
                }
              }}
            />
          </div>

          {savedChats.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-3xl [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:!bg-white/60">
              <FileJson className="w-16 h-16 text-white/20 mb-4 mx-auto [.light-theme_&]:!text-slate-400" />
              <h3 className="text-xl font-medium text-white/60 mb-2 [.light-theme_&]:!text-[#0f172a]">
                拖拽或点击上方按钮导入聊天记录
              </h3>
              <p className="text-white/40 mb-8 [.light-theme_&]:!text-[#64748b]">
                支持批量导入 .zip 或 .jsonl 格式文件
              </p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 relative">
              <Virtuoso
                style={{ height: "100%" }}
                data={flattenedChatItems}
                itemContent={(index, item) => {
                  if (item.type === "header") {
                    const { groupName, group } = item;
                    const isExpanded =
                      !!expandedGroups[groupName] || !!searchQuery;
                    const allSelected = group.chats.every((c) =>
                      selectedChatIds.has(c.id),
                    );
                    const anySelected = group.chats.some((c) =>
                      selectedChatIds.has(c.id),
                    );

                    return (
                      <div
                        className="pb-4"
                        onTouchStart={(e) =>
                          handleTouchStart(e, groupName, true)
                        }
                        onTouchMove={handleTouchMove}
                        onTouchEnd={handleTouchEnd}
                        onMouseDown={(e) =>
                          handleTouchStart(e, groupName, true)
                        }
                        onMouseMove={handleTouchMove}
                        onMouseUp={handleTouchEnd}
                        onMouseLeave={handleTouchEnd}
                      >
                        <div
                          onClick={(e) => {
                            if (isBatchMode) {
                              e.stopPropagation();
                              const newSet = new Set(selectedChatIds);
                              if (allSelected) {
                                group.chats.forEach((c) => newSet.delete(c.id));
                              } else {
                                group.chats.forEach((c) => newSet.add(c.id));
                              }
                              setSelectedChatIds(newSet);
                            } else {
                              toggleGroup(groupName);
                            }
                          }}
                          className={`rounded-2xl p-4 cursor-pointer transition flex items-center justify-between shadow-xs relative overflow-hidden border ${
                            isBatchMode && allSelected
                              ? "bg-slate-950/90 border border-white/10 [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:!border-[#e2e8f0]"
                              : "bg-white/[0.06] hover:bg-white/[0.09] border border-white/10 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:hover:!bg-[#f8fafc] [.light-theme_&]:!border-[#e2e8f0]"
                          } [.light-theme_&]:!shadow-xs`}
                        >
                          {/* Full-card dark dimming overlay on selection (matching DuplicateDetector and TrashBin) */}
                          {isBatchMode && allSelected && (
                            <div className="absolute inset-0 rounded-2xl z-20 pointer-events-none transition-all bg-black/65 [.light-theme_&]:!bg-slate-900/35" />
                          )}
                          <div className="flex items-center gap-3 min-w-0">
                            {(() => {
                              const groupChar = group.characterId ? characters.find(c => c.id === group.characterId) : null;
                              const charId = groupChar?.id;
                              const gUrl = charId ? avatarUrls[charId] : null;
                              const hasPhoto = !!(gUrl && !imgErrorMap[charId]);
                              if (hasPhoto) {
                                return (
                                  <div className="w-10 h-10 rounded-full avatar-frame flex items-center justify-center shrink-0 shadow-inner overflow-hidden">
                                    <img
                                      src={gUrl}
                                      alt="avatar"
                                      className="w-full h-full object-cover"
                                      onError={() => {
                                        if (charId) {
                                          setImgErrorMap((prev) => ({ ...prev, [charId]: true }));
                                        }
                                      }}
                                    />
                                  </div>
                                );
                              }
                              return (
                                <div className="w-10 h-10 rounded-full avatar-fallback font-bold flex items-center justify-center shadow-inner shrink-0 select-none">
                                  {(groupChar?.name || groupName || "AI").charAt(0)}
                                </div>
                              );
                            })()}
                            <div className="truncate">
                              <h4 className="font-semibold text-white/90 text-base truncate mb-0.5 [.light-theme_&]:!text-[#0f172a]">
                                {groupName}
                              </h4>
                              <p className="text-xs text-white/40 [.light-theme_&]:!text-[#64748b]">
                                {group.chats.length} 个历史记录
                              </p>
                            </div>
                          </div>
                          <div className="text-white/40 shrink-0 z-30 [.light-theme_&]:!text-[#64748b]">
                            {isBatchMode ? (
                              allSelected ? (
                                <div className="w-6 h-6 rounded-full bg-white text-slate-950 flex items-center justify-center shadow-md [.light-theme_&]:!bg-[#0f172a] [.light-theme_&]:!text-[#ffffff]">
                                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                                </div>
                              ) : (
                                <div className="w-6 h-6 rounded-full border-2 border-white/30 group-hover:border-white/60 [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:group-hover:!border-[#94a3b8]" />
                              )
                            ) : isExpanded ? (
                              <ChevronUp className="w-5 h-5" />
                            ) : (
                              <ChevronDown className="w-5 h-5" />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  const chat = item.chat;
                  let matchedChar = chat.characterId
                    ? characters.find((c) => c.id === chat.characterId)
                    : null;
                  if (!matchedChar) {
                    if (chat.firstAiName) {
                      matchedChar =
                        characters.find(
                          (c) =>
                            c.name.toLowerCase() ===
                            chat.firstAiName?.toLowerCase(),
                        ) || null;
                    }
                  }
                  const isSelected = selectedChatIds.has(chat.id);
                  return (
                    <div
                      className="pb-4 pl-4 sm:pl-8"
                      onTouchStart={(e) => handleTouchStart(e, chat.id, false)}
                      onTouchMove={handleTouchMove}
                      onTouchEnd={handleTouchEnd}
                      onMouseDown={(e) => handleTouchStart(e, chat.id, false)}
                      onMouseMove={handleTouchMove}
                      onMouseUp={handleTouchEnd}
                      onMouseLeave={handleTouchEnd}
                    >
                      <div
                        onClick={(e) => {
                          if (isBatchMode) {
                            e.stopPropagation();
                            const newSet = new Set(selectedChatIds);
                            if (newSet.has(chat.id)) newSet.delete(chat.id);
                            else newSet.add(chat.id);
                            setSelectedChatIds(newSet);
                          } else {
                            setActiveChatId(chat.id);
                          }
                        }}
                        className={`rounded-2xl p-5 cursor-pointer transition flex flex-col gap-3 relative overflow-hidden border ${
                          isSelected && isBatchMode
                            ? "bg-slate-950/90 border border-white/10 [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:!border-[#e2e8f0]"
                            : "bg-white/[0.06] hover:bg-white/[0.09] border border-white/10 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:hover:!bg-[#f8fafc] [.light-theme_&]:!border-[#e2e8f0]"
                        } [.light-theme_&]:!shadow-xs`}
                      >
                        {/* Full-card dark dimming overlay on selection (matching DuplicateDetector and TrashBin) */}
                        {isSelected && isBatchMode && (
                          <div className="absolute inset-0 rounded-2xl z-20 pointer-events-none transition-all bg-black/65 [.light-theme_&]:!bg-slate-900/35" />
                        )}
                        <div className="flex justify-between items-start mb-2 gap-3">
                          <div className="flex-1 min-w-0 flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              {editingNoteFor === chat.id ? (
                                <div
                                  className="w-full mb-1"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    autoFocus
                                    className="w-full bg-black/40 border border-blue-500/50 rounded flex px-2 py-1 text-sm text-blue-300 focus:outline-none placeholder-blue-300/30 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!border-[#93c5fd] [.light-theme_&]:!text-blue-600 [.light-theme_&]:placeholder:!text-blue-400/50"
                                    value={editNoteContent}
                                    onChange={(e) =>
                                      setEditNoteContent(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter")
                                        handleSaveNote(chat);
                                    }}
                                    onBlur={() => handleSaveNote(chat)}
                                    placeholder="添加内容备注..."
                                  />
                                </div>
                              ) : (
                                <div
                                  className="text-sm font-semibold text-blue-400 [.light-theme_&]:!text-[#007aff] cursor-pointer hover:text-blue-300 [.light-theme_&]:hover:!text-blue-700 transition flex items-center gap-2 mb-1"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingNoteFor(chat.id);
                                    setEditNoteContent(chat.note || "");
                                  }}
                                  title="点击编辑备注"
                                >
                                  {chat.note ? (
                                    <>
                                      <span className="truncate">
                                        {chat.note}
                                      </span>
                                      <span className="text-xs text-blue-400/70 [.light-theme_&]:!text-[#007aff]/70 shrink-0 flex items-center gap-1 leading-none pt-0.5">
                                        <Edit2 className="w-3 h-3 stroke-[2]" />
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-blue-400/80 [.light-theme_&]:!text-[#007aff] flex items-center gap-1 font-medium">
                                      <Plus className="w-3.5 h-3.5 stroke-[2.5]" />{" "}
                                      添加内容备注...
                                    </span>
                                  )}
                                </div>
                              )}
                              <h4
                                className="font-medium text-white/90 truncate w-full text-sm [.light-theme_&]:!text-[#0f172a]"
                                title={chat.name}
                              >
                                {chat.name}
                              </h4>
                            </div>
                          </div>

                          {isBatchMode ? (
                            <div className="shrink-0 z-30 mt-1">
                              {isSelected ? (
                                <div className="w-6 h-6 rounded-full bg-white text-slate-950 flex items-center justify-center shadow-md [.light-theme_&]:!bg-[#0f172a] [.light-theme_&]:!text-[#ffffff]">
                                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                                </div>
                              ) : (
                                <div className="w-6 h-6 rounded-full border-2 border-white/30 group-hover:border-white/60 [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:group-hover:!border-[#94a3b8]" />
                              )}
                            </div>
                          ) : (
                            <button
                              onClick={(e) => handleRemoveChat(e, chat.id)}
                              className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition z-10 shrink-0 mt-1 cursor-pointer"
                              title="删除记录"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>

                        <div className="flex justify-between items-center text-xs text-white/40 pb-2 border-b border-white/5 [.light-theme_&]:!text-[#64748b] [.light-theme_&]:!border-[#e2e8f0]">
                          <span className="flex items-center gap-1">
                            <Book className="w-4 h-4 text-blue-400 [.light-theme_&]:!text-blue-600" />
                            {chat.messageCount} 条消息
                          </span>
                          <span className="flex items-center gap-1">
                            {new Date(chat.createdAt).toLocaleString()}
                          </span>
                        </div>

                        <div className="text-white/60 text-xs leading-relaxed max-w-none line-clamp-3 overflow-hidden break-words [.light-theme_&]:!text-[#475569]">
                          {formatCustomTags(
                            applyRegexes(
                              chat.lastMessagePreview || "空记录",
                              matchedChar,
                            ),
                          ).replace(/<\/?[^>]+(>|$)/g, "")}
                        </div>
                      </div>
                    </div>
                  );
                }}
              />
            </div>
          )}
        </div>

        <AnimatePresence>
          {activeChatId && activeChat && (
            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 20 }}
              transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
              className="absolute inset-0 z-10 bg-slate-900/80 backdrop-blur-xl flex h-full pt-16 [.light-theme_&]:bg-[#FCFCFC]/80 [.light-theme_&]:backdrop-blur-3xl"
            >
              <div className="relative z-0 h-full w-full">
                <div className="absolute inset-0">
                  <Virtuoso
                    style={{ height: "100%" }}
                    data={activeChat.messages}
                    context={{ activeCharacterId: activeCharacter?.id }}
                    initialTopMostItemIndex={
                      activeChat.messages ? activeChat.messages.length - 1 : 0
                    }
                    components={{
                      Header: () => <div className="h-24" />,
                      Footer: () => <div className="h-32" />,
                    }}
                    itemContent={(i, msg) => {
                      const dateString = msg.send_date
                        ? new Date(msg.send_date).toLocaleString("zh-CN", {
                            year: "numeric",
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "";

                      if (chatDisplayMode === 'card') {
                        const tokenCount = Math.round((msg.mes || "").length * 0.75);
                        const cardBgColor = msg.is_user ? bubbleTheme.userColor : bubbleTheme.botColor;
                        const cardTextColor = msg.is_user ? bubbleTheme.userTextColor : bubbleTheme.botTextColor;

                        return (
                          <div className="w-full max-w-3xl sm:max-w-4xl mx-auto px-3 sm:px-6 py-2 sm:py-3">
                            <div
                              className="border border-white/10 rounded-2xl p-4 sm:p-5 shadow-lg backdrop-blur-md transition-colors duration-200 [.light-theme_&]:border-black/10"
                              style={{
                                backgroundColor: cardBgColor,
                                color: cardTextColor,
                              }}
                            >
                              {/* Card Header */}
                              <div className="flex items-center justify-between gap-3 pb-3 mb-3.5 border-b border-current/15">
                                <div className="flex items-center gap-3 min-w-0">
                                  {/* Avatar */}
                                  {msg.is_user ? (
                                    userAvatar ? (
                                      <img
                                        src={userAvatar}
                                        alt="user"
                                        className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl object-cover shadow-sm shrink-0 cursor-pointer hover:opacity-85 transition"
                                        onClick={() => setShowUserAvatarSheet(true)}
                                      />
                                    ) : (
                                      <div
                                        onClick={() => setShowUserAvatarSheet(true)}
                                        className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-black/20 text-current font-bold flex items-center justify-center shrink-0 shadow-sm cursor-pointer hover:opacity-85 transition"
                                      >
                                        {msg.name?.charAt(0) || "U"}
                                      </div>
                                    )
                                  ) : (() => {
                                    const charId = activeCharacter?.id;
                                    const charUrl = charId ? avatarUrls[charId] : null;
                                    if (charUrl && !imgErrorMap[charId]) {
                                      return (
                                        <img
                                          src={charUrl}
                                          alt="avatar"
                                          className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl object-cover shadow-sm shrink-0"
                                          onError={() => setImgErrorMap((prev) => ({ ...prev, [charId]: true }))}
                                        />
                                      );
                                    }
                                    return (
                                      <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-black/20 text-current font-bold flex items-center justify-center shrink-0 shadow-sm">
                                        {(msg.name || activeCharacter?.name || "AI").charAt(0)}
                                      </div>
                                    );
                                  })()}

                                  {/* Title & Metadata Column */}
                                  <div className="flex flex-col min-w-0">
                                    <h3 className="font-bold text-sm sm:text-base text-current truncate leading-snug" style={{ color: cardTextColor }}>
                                      {msg.name || (msg.is_user ? "User" : activeCharacter?.name || "Character")}
                                    </h3>
                                    <div className="flex items-center gap-1.5 text-[11px] opacity-70 mt-0.5 flex-wrap" style={{ color: cardTextColor }}>
                                      <span className="font-semibold opacity-90">
                                        #{i + 1}
                                      </span>
                                      {dateString && (
                                        <>
                                          <span>·</span>
                                          <span className="truncate">{dateString}</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                </div>

                              {/* Card Body Content */}
                              <div 
                                className="prose prose-sm sm:prose-base max-w-none chat-bubble-prose leading-relaxed break-words"
                                style={{ color: cardTextColor }}
                              >
                                <MessageContent
                                  content={formatCustomTags(
                                    applyRegexes(msg.mes || "", activeCharacter)
                                  )}
                                  themeMode={isLightMode ? 'light' : 'dark'}
                                  characterName={activeCharacter?.name}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div className="w-full max-w-3xl sm:max-w-4xl mx-auto px-3 sm:px-6">
                          <div
                            className={`flex gap-3 sm:gap-4 pb-6 mt-2 ${msg.is_user ? "flex-row-reverse" : ""} overflow-hidden w-full min-w-0`}
                          >
                            <div className="shrink-0 pt-1">
                              {msg.is_user ? (
                                userAvatar ? (
                                  <div 
                                    onClick={() => setShowUserAvatarSheet(true)}
                                    className="w-10 h-10 rounded-full avatar-frame flex items-center justify-center shrink-0 shadow-lg overflow-hidden cursor-pointer hover:opacity-85 transition active:scale-95"
                                    title="点击更换你的头像"
                                  >
                                    <img
                                      src={userAvatar}
                                      alt="user avatar"
                                      className="w-full h-full object-cover"
                                    />
                                  </div>
                                ) : (
                                  <div 
                                    onClick={() => setShowUserAvatarSheet(true)}
                                    className="w-10 h-10 rounded-full avatar-fallback flex items-center justify-center shadow-lg font-bold cursor-pointer hover:opacity-85 transition active:scale-95"
                                    title="点击更换你的头像"
                                  >
                                    {msg.name?.charAt(0) || "U"}
                                  </div>
                                )
                              ) : (() => {
                                const charId = activeCharacter?.id;
                                const charUrl = charId ? avatarUrls[charId] : null;
                                const hasPhoto = !!(charUrl && !imgErrorMap[charId]);
                                if (hasPhoto) {
                                  return (
                                    <div className="w-10 h-10 rounded-full avatar-frame flex items-center justify-center shrink-0 shadow-lg overflow-hidden">
                                      <img
                                        src={charUrl}
                                        alt="avatar"
                                        className="w-full h-full object-cover"
                                        onError={() => {
                                          if (charId) {
                                            setImgErrorMap((prev) => ({ ...prev, [charId]: true }));
                                          }
                                        }}
                                      />
                                    </div>
                                  );
                                }
                                return (
                                  <div className="w-10 h-10 rounded-full avatar-fallback flex items-center justify-center shadow-lg font-bold shrink-0 select-none">
                                    {(msg.name || activeCharacter?.name || "AI").charAt(0)}
                                  </div>
                                );
                              })()}
                            </div>

                            <div
                              className={`max-w-[85%] md:max-w-[80%] min-w-0 ${msg.is_user ? "items-end" : "items-start"} flex flex-col gap-1`}
                            >
                              <div
                                className={`flex items-center gap-2 text-xs ${msg.is_user ? "flex-row-reverse text-slate-400 [.light-theme_&]:text-slate-500" : "text-slate-400 [.light-theme_&]:text-slate-500"}`}
                              >
                                <span className="font-semibold">
                                  {msg.name ||
                                    (msg.is_user ? "User" : "Character")}
                                </span>
                                {dateString && <span>· {dateString}</span>}
                              </div>

                              <div
                                className="relative px-5 py-3 rounded-2xl max-w-full min-w-0 shadow-sm transition-colors"
                                style={{
                                  backgroundColor: msg.is_user ? bubbleTheme.userColor : bubbleTheme.botColor,
                                  color: msg.is_user ? bubbleTheme.userTextColor : bubbleTheme.botTextColor,
                                }}
                              >
                                <div
                                  className="prose prose-sm max-w-none chat-bubble-prose
                                      prose-headings:text-inherit prose-p:leading-relaxed 
                                      prose-a:underline hover:opacity-80
                                      prose-strong:font-bold prose-code:text-pink-300
                                      prose-pre:bg-black/30 prose-pre:max-w-full
                                      [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 break-words w-full"
                                  style={{ color: msg.is_user ? bubbleTheme.userTextColor : bubbleTheme.botTextColor }}
                                >
                                  <MessageContent
                                    content={formatCustomTags(
                                      applyRegexes(
                                        msg.mes || "",
                                        activeCharacter,
                                      ),
                                    )}
                                    themeMode={isLightMode ? 'light' : 'dark'}
                                    characterName={activeCharacter?.name}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {showSettings && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowSettings(false)}
        >
          <div
            className="bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-2xl w-full max-w-md flex flex-col shadow-2xl ring-1 ring-white/10 overflow-hidden [.light-theme_&]:bg-[#ffffff]/90 [.light-theme_&]:backdrop-blur-3xl [.light-theme_&]:border-black/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-white/10 flex items-center justify-between bg-white/[0.02] [.light-theme_&]:bg-black/[0.02] [.light-theme_&]:border-black/5">
              <h3 className="text-lg font-bold text-white [.light-theme_&]:!text-[#1c1c1e]">
                界面设置
              </h3>
              <button
                onClick={() => setShowSettings(false)}
                className="p-2 -mr-2 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition [.light-theme_&]:hover:bg-black/5 [.light-theme_&]:text-[#8e8e93] [.light-theme_&]:hover:text-[#1c1c1e]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 flex flex-col gap-6 max-h-[70vh] overflow-y-auto">
              {/* User Avatar Settings */}
              <div className="flex flex-col gap-3">
                <label className="text-sm font-medium text-white/80 [.light-theme_&]:text-[#1c1c1e]/80">
                  你的头像
                </label>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-full bg-white/10 text-slate-300 border border-white/20 flex items-center justify-center shadow-lg shrink-0 overflow-hidden relative group [.light-theme_&]:bg-black/5 [.light-theme_&]:text-[#8e8e93] [.light-theme_&]:border-black/10 [.light-theme_&]:shadow-sm">
                    {userAvatar ? (
                      <img
                        src={userAvatar}
                        alt="avatar"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-xl font-bold text-white [.light-theme_&]:text-[#1c1c1e]">
                        U
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => setShowUserAvatarSheet(true)}
                      className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm transition [.light-theme_&]:bg-black/5 [.light-theme_&]:hover:bg-black/10 [.light-theme_&]:text-[#1c1c1e]"
                    >
                      上传头像
                    </button>
                    {userAvatar && (
                      <button
                        onClick={handleClearUserAvatar}
                        className="px-3 py-1.5 border border-red-500/30 text-red-400 hover:bg-red-500/10 rounded-lg text-sm transition [.light-theme_&]:border-[#ff3b30]/30 [.light-theme_&]:text-[#ff3b30] [.light-theme_&]:hover:bg-[#ff3b30]/10"
                      >
                        移除头像
                      </button>
                    )}
                    <input
                      type="file"
                      ref={userAvatarInputRef}
                      onChange={handleUserAvatarUpload}
                      accept="image/png, image/jpeg, image/webp, image/gif"
                      className="hidden"
                    />
                    <input
                      type="file"
                      ref={userFileInputRef}
                      onChange={handleUserAvatarUpload}
                      accept="*/*"
                      className="hidden"
                    />
                  </div>
                </div>
              </div>

              {/* Chat Bubble Theme Settings */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-white/80 [.light-theme_&]:text-[#1c1c1e]/80 flex items-center gap-2">
                    <ColorSphere botColor={bubbleTheme.botColor} userColor={bubbleTheme.userColor} size={20} />
                    气泡配色风格（色彩球）
                  </label>
                  <span className="text-xs text-white/50 [.light-theme_&]:text-[#1c1c1e]/50 font-medium">
                    当前: {bubbleTheme.name}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {bubbleThemes.map((t) => {
                    const isSelected = bubbleThemeId === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setBubbleTheme(t.id)}
                        className={`bubble-theme-card p-3 rounded-2xl border text-left transition-all relative overflow-hidden flex flex-col gap-2 ${
                          isSelected ? 'is-selected' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <ColorSphere botColor={t.botColor} userColor={t.userColor} size={22} />
                            <span className="bubble-theme-title text-xs font-bold truncate">
                              {t.name}
                            </span>
                          </div>
                          {isSelected && (
                            <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)] shrink-0" />
                          )}
                        </div>
                        {/* Live mini preview of solid bubbles with authentic speech tails */}
                        <div className="bubble-mini-preview-bg flex flex-col gap-1.5 mt-0.5 p-2 rounded-xl">
                          {/* User message */}
                          <div
                            className="self-end px-2.5 py-1 rounded-xl text-[10px] font-medium max-w-[88%] truncate shadow-xs relative"
                            style={{ backgroundColor: t.userColor, color: t.userTextColor }}
                          >
                            自己看到的气泡
                          </div>
                          {/* Bot message */}
                          <div
                            className="self-start px-2.5 py-1 rounded-xl text-[10px] font-medium max-w-[88%] truncate shadow-xs relative"
                            style={{ backgroundColor: t.botColor, color: t.botTextColor }}
                          >
                            主题含天气泡
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Fold Tags Settings */}
              <div className="flex flex-col gap-3">
                <label className="text-sm font-medium text-white/80 shrink-0 mt-1 [.light-theme_&]:text-[#1c1c1e]/80">
                  自定义折叠标签
                </label>
                <p className="text-xs text-white/50 leading-relaxed -mt-2 [.light-theme_&]:text-[#1c1c1e]/50">
                  添加你想要自动折叠的标签。比如你输入{" "}
                  <strong>Real_Task</strong>，聊天记录中的{" "}
                  <i>&lt;Real_Task&gt;...&lt;/Real_Task&gt;</i> 就会被自动折叠。
                </p>

                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="text"
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddCustomTag();
                    }}
                    placeholder="输入标签名 (如 Real_Task)"
                    className="fold-tag-input flex-1 rounded-xl px-3.5 py-2 text-sm shadow-xs"
                  />
                  <button
                    onClick={handleAddCustomTag}
                    disabled={!newTagInput.trim()}
                    className="fold-tag-add-btn flex items-center justify-center gap-1 shrink-0 active:scale-95 cursor-pointer"
                    title="添加自定义折叠标签"
                  >
                    <Plus className="w-4 h-4 stroke-[2.5]" />
                  </button>
                </div>

                {customTags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {customTags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="fold-tag-pill inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm"
                      >
                        {tag}
                        <button
                          onClick={() => handleRemoveCustomTag(tag)}
                          className="hover:text-red-500 p-0.5 rounded-full transition opacity-70 hover:opacity-100"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 用户头像来源选择上弹面板 (Action Sheet) */}
      <AnimatePresence>
        {showUserAvatarSheet && (
          <div className="fixed inset-0 z-[110] flex items-end justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowUserAvatarSheet(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
              className="relative w-full max-w-lg bg-slate-900 border-t border-white/10 rounded-t-3xl p-5 pb-8 shadow-2xl flex flex-col gap-3 [.light-theme_&]:bg-[#f2f2f7] [.light-theme_&]:border-black/10"
            >
              <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-1 [.light-theme_&]:bg-black/20" />
              <div className="text-center mb-1">
                <h4 className="text-base font-semibold text-white [.light-theme_&]:text-[#1c1c1e]">选择头像来源</h4>
                <p className="text-xs text-white/50 mt-0.5 [.light-theme_&]:text-black/50">支持从相册或系统文件管理中挑选图片</p>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    setShowUserAvatarSheet(false);
                    userAvatarInputRef.current?.click();
                  }}
                  className="w-full flex items-center gap-3.5 p-3.5 rounded-2xl bg-white/5 hover:bg-white/10 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:hover:!bg-[#f1f5f9] active:scale-[0.99] border border-white/5 [.light-theme_&]:!border-[#e2e8f0] transition text-left cursor-pointer"
                >
                  <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/10 text-white [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:!text-[#0f172a] flex items-center justify-center shrink-0 shadow-xs">
                    <ImageIcon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white [.light-theme_&]:!text-[#0f172a]">从手机相册选取</div>
                    <div className="text-xs text-white/40 [.light-theme_&]:!text-[#64748b]">打开系统相册与图库</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/30 [.light-theme_&]:!text-[#94a3b8]" />
                </button>
                <button
                  onClick={() => {
                    setShowUserAvatarSheet(false);
                    userFileInputRef.current?.click();
                  }}
                  className="w-full flex items-center gap-3.5 p-3.5 rounded-2xl bg-white/5 hover:bg-white/10 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:hover:!bg-[#f1f5f9] active:scale-[0.99] border border-white/5 [.light-theme_&]:!border-[#e2e8f0] transition text-left cursor-pointer"
                >
                  <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/10 text-white [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:!text-[#0f172a] flex items-center justify-center shrink-0 shadow-xs">
                    <FolderOpen className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white [.light-theme_&]:!text-[#0f172a]">从文件管理查找</div>
                    <div className="text-xs text-white/40 [.light-theme_&]:!text-[#64748b]">浏览手机内部存储或未入库图片</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/30 [.light-theme_&]:!text-[#94a3b8]" />
                </button>
              </div>
              <button
                onClick={() => setShowUserAvatarSheet(false)}
                className="w-full py-3 mt-1 rounded-2xl bg-white/10 hover:bg-white/15 active:scale-[0.99] text-white/80 font-medium text-sm transition [.light-theme_&]:bg-black/5 [.light-theme_&]:text-[#1c1c1e]"
              >
                取消
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Chat Confirmation Modal */}
      <AnimatePresence>
        {deleteChatId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-end justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setDeleteChatId(null)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-[#1c1c1e] [.light-theme_&]:!bg-[#ffffff] border-t border-white/10 [.light-theme_&]:!border-black/5 rounded-t-3xl p-5 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl select-none"
            >
              {/* Indicator Handle */}
              <div className="w-10 h-1 bg-white/20 [.light-theme_&]:!bg-black/10 rounded-full mx-auto mb-4" />

              <h3 className="text-base sm:text-lg font-bold text-center text-white [.light-theme_&]:!text-[#0f172a] mb-1.5">
                删除聊天记录？
              </h3>
              <p className="text-xs sm:text-sm text-center text-white/70 [.light-theme_&]:!text-slate-600 mb-6 px-2 leading-relaxed">
                此操作无法撤销，确定要删除这条聊天记录吗？
              </p>

              <div className="space-y-2.5">
                <button
                  onClick={confirmDeleteChat}
                  className="w-full py-3.5 rounded-2xl bg-[#FE2C55] hover:bg-[#E02447] active:bg-[#D41C3E] text-white font-bold text-sm sm:text-base transition-all shadow-md shadow-[#FE2C55]/25 cursor-pointer active:scale-[0.98]"
                >
                  删除聊天记录
                </button>
                <button
                  onClick={() => setDeleteChatId(null)}
                  className="w-full py-3.5 rounded-2xl bg-white/10 hover:bg-white/15 active:bg-white/5 text-white/90 [.light-theme_&]:!bg-[#f2f3f5] [.light-theme_&]:hover:!bg-[#e5e6eb] [.light-theme_&]:!text-[#0f172a] font-semibold text-sm sm:text-base transition-all cursor-pointer active:scale-[0.98]"
                >
                  取消
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {imageToCrop && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-slate-900 [.light-theme_&]:!bg-[#ffffff] text-white [.light-theme_&]:!text-[#0f172a] border border-white/10 [.light-theme_&]:!border-[#e2e8f0] rounded-3xl w-full max-w-md flex flex-col shadow-2xl overflow-hidden h-[500px]">
            <div className="p-4 border-b border-white/10 [.light-theme_&]:!border-[#e2e8f0] flex items-center justify-between bg-white/[0.02] [.light-theme_&]:!bg-transparent">
              <h3 className="text-base sm:text-lg font-bold text-white [.light-theme_&]:!text-[#0f172a]">
                调整头像
              </h3>
              <button
                onClick={closeCrop}
                className="w-8.5 h-8.5 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition [.light-theme_&]:!bg-[#f1f2f6] [.light-theme_&]:hover:!bg-[#e4e7eb] [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#0f172a] border-0 border-none cursor-pointer"
              >
                <X className="w-5 h-5 stroke-[2]" />
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
                aria-labelledby="Zoom"
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1 h-2 bg-white/10 [.light-theme_&]:!bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <button
                onClick={handleSaveCrop}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition shadow-md shadow-blue-500/25 border-0 border-none cursor-pointer"
              >
                保存头像
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Batch Actions Bar */}
      <AnimatePresence>
        {isBatchMode && (
          <motion.div
            initial={{ y: 24, opacity: 0, scale: 0.92, x: "-50%" }}
            animate={{ y: 0, opacity: 1, scale: 1, x: "-50%" }}
            exit={{ y: 20, opacity: 0, scale: 0.95, x: "-50%" }}
            transition={{ type: "spring", stiffness: 450, damping: 28 }}
            className="floating-pill-dock fixed bottom-6 left-1/2 z-[60] max-w-[95vw] sm:max-w-max rounded-full px-3 py-1.5 transition-all overflow-hidden"
          >
            <div
              className="flex items-center gap-1 sm:gap-2 px-1 overflow-x-auto hide-scrollbar"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              <button
                onClick={() => {
                  if (selectedChatIds.size === savedChats.length) {
                    setSelectedChatIds(new Set());
                  } else {
                    setSelectedChatIds(new Set(savedChats.map((c) => c.id)));
                  }
                }}
                className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-full transition active:scale-90 shrink-0"
              >
                <CheckSquare className="w-5 h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight">
                  {selectedChatIds.size === savedChats.length ? "全不选" : "全选"}
                </span>
              </button>

              <button
                onClick={() => handleBatchExport(true)}
                disabled={selectedChatIds.size === 0}
                className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-3.5 py-1.5 rounded-full transition active:scale-90 shrink-0 hover:!text-green-500 disabled:opacity-30 disabled:pointer-events-none"
                title={getDownloadTooltip("导出聊天记录")}
              >
                <Download className="w-5 h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight">
                  导出{selectedChatIds.size > 0 ? ` (${selectedChatIds.size})` : ''}
                </span>
              </button>

              <button
                onClick={handleChatsCloudUpload}
                disabled={selectedChatIds.size === 0}
                className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-3.5 py-1.5 rounded-full transition active:scale-90 shrink-0 hover:!text-blue-500 disabled:opacity-30 disabled:pointer-events-none"
              >
                <UploadCloud className="w-5 h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight">传云盘</span>
              </button>

              <button
                onClick={handleBatchDelete}
                disabled={selectedChatIds.size === 0}
                className="floating-pill-item is-danger flex flex-col items-center justify-center gap-0.5 px-3.5 py-1.5 rounded-full transition active:scale-90 shrink-0 cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
              >
                <Trash2 className="w-5 h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight">
                  删除{selectedChatIds.size > 0 ? ` (${selectedChatIds.size})` : ''}
                </span>
              </button>

              <button
                onClick={() => {
                  setIsBatchMode(false);
                  setSelectedChatIds(new Set());
                }}
                className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-full transition active:scale-90 shrink-0 hover:!text-slate-400 cursor-pointer"
                title="退出多选"
              >
                <X className="w-5 h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight">退出</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 编辑消息弹窗 */}
      {editingMsgIndex !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm select-none"
          onClick={() => setEditingMsgIndex(null)}
        >
          <div
            className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg flex flex-col shadow-2xl overflow-hidden [.light-theme_&]:!bg-slate-800 [.light-theme_&]:!border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-white/10 flex items-center justify-between [.light-theme_&]:!border-slate-100">
              <h3 className="font-bold text-base text-white [.light-theme_&]:!text-slate-900 flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-blue-400" />
                <span>编辑消息 #{editingMsgIndex + 1}</span>
              </h3>
              <button
                onClick={() => setEditingMsgIndex(null)}
                className="p-1.5 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition [.light-theme_&]:!text-slate-400 [.light-theme_&]:hover:!bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">
              <textarea
                value={editingMsgContent}
                onChange={(e) => setEditingMsgContent(e.target.value)}
                rows={8}
                className="w-full rounded-xl bg-black/30 border border-white/10 p-3 text-sm text-white focus:outline-none focus:border-blue-500/50 transition-colors resize-none [.light-theme_&]:!bg-slate-50 [.light-theme_&]:!border-slate-200 [.light-theme_&]:!text-slate-800"
                placeholder="输入消息内容..."
              />
            </div>
            <div className="p-4 border-t border-white/10 flex items-center justify-end gap-2.5 [.light-theme_&]:!border-slate-100">
              <button
                onClick={() => setEditingMsgIndex(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white/70 hover:bg-white/10 transition [.light-theme_&]:!text-slate-600 [.light-theme_&]:hover:!bg-slate-100 cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleSaveEditedMessage}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white transition active:scale-95 cursor-pointer shadow-md"
              >
                保存修改
              </button>
            </div>
          </div>
        </div>
      )}

      <ChatCleanerModal
        isOpen={isCleanerOpen}
        onClose={() => setIsCleanerOpen(false)}
        onDeleted={() => {
          loadData();
        }}
      />
    </div>
  );
}
