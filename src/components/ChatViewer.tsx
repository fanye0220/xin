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
  Download,
  Copy,
  Share2,
} from "lucide-react";
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
import { isAndroid, saveToGallery } from "../lib/appBridge";

interface ChatMessage {
  name: string;
  is_user: boolean;
  is_name: boolean;
  send_date: number;
  mes: string;
  extra?: any;
}

export function ChatViewer({
  onClose,
  initialChatId,
  singleMode,
  onOpenImport,
  refreshKey,
  onActiveViewChange,
  backSignal,
}: {
  onClose: () => void;
  initialChatId?: string | null;
  singleMode?: boolean;
  onOpenImport?: (files?: FileList | File[]) => void;
  refreshKey?: number;
  onActiveViewChange?: (hasInnerView: boolean) => void;
  backSignal?: number;
}) {
  const [savedChats, setSavedChats] = useState<
    (Omit<ChatLog, "messages"> & {
      messageCount: number;
      firstAiName?: string;
      lastMessagePreview?: string;
    })[]
  >([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChat, setActiveChat] = useState<ChatLog | null>(null);

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
        const { getChatById } = await import("../lib/db");
        const chat = await getChatById(activeChatId);
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
  const [newTagInput, setNewTagInput] = useState("");
  const userAvatarInputRef = useRef<HTMLInputElement>(null);

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
      const url = URL.createObjectURL(file);
      setImageToCrop(url);
      if (userAvatarInputRef.current) {
        userAvatarInputRef.current.value = "";
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

  const loadData = async () => {
    const chars = await getCharacters(1, 99999, undefined, "", [], "newest_import", false, false);
    setCharacters(chars.characters);
    const { getAllChatsMetadata } = await import("../lib/db");
    const chats = await getAllChatsMetadata();
    setSavedChats(chats.sort((a, b) => b.createdAt - a.createdAt));
  };

  useEffect(() => {
    loadData();
    const handleUpdate = () => loadData();
    window.addEventListener("chatsUpdated", handleUpdate);
    return () => window.removeEventListener("chatsUpdated", handleUpdate);
  }, []);

  useEffect(() => {
    if (refreshKey !== undefined) {
      loadData();
    }
  }, [refreshKey]);

  useEffect(() => {
    let active = true;
    const localObjectUrls: string[] = [];

    const loadUrls = async () => {
      let getLocalImageUrl: any;
      if (characters.some((c) => c.localFilePath)) {
        const m = await import("../lib/appBridge");
        getLocalImageUrl = m.getLocalImageUrl;
      }

      const { getCharacterThumb } = await import("../lib/db");
      const { peekCachedUrl, putCachedBlobUrl } = await import("../lib/thumbCache");

      const urls: Record<string, string> = {};
      const pendingThumbFetches: Promise<void>[] = [];

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
          // getCharacters() 这里是拿去做列表用的, 没带 avatarBlob(性能考虑),
          // 真正的头像要么从共享的缩略图 LRU 缓存里拿, 要么现场去数据库按需取一次
          // ——不能直接当成"没有头像"退回占位图, 参考 CharacterList 的做法。
          const thumbCacheKey = `${char.id}:${char.updatedAt || 0}`;
          const cached = peekCachedUrl(thumbCacheKey);
          if (cached) {
            urls[char.id] = cached;
          } else {
            urls[char.id] = resolveAvatarUrl(char.avatarUrlFallback, char.name || char.id, char.tags?.join(',') || (char.isTool ? 'tool' : undefined));
            pendingThumbFetches.push(
              getCharacterThumb(char.id).then((thumbBlob: Blob | null) => {
                if (thumbBlob && active) {
                  const url = putCachedBlobUrl(thumbCacheKey, thumbBlob);
                  setAvatarUrls((prev) => ({ ...prev, [char.id]: url }));
                }
              })
            );
          }
        } else {
          urls[char.id] = resolveAvatarUrl(char.avatarUrlFallback, char.name || char.id, char.tags?.join(',') || (char.isTool ? 'tool' : undefined));
        }
      });
      if (active) setAvatarUrls(urls);
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
            if (lowerName.endsWith(".json") || lowerName.endsWith(".jsonl") || lowerName.endsWith(".txt")) {
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
                const { parseJsonlChat } = await import("../lib/chatParse");
                parsedMessages = parseJsonlChat(text);
              } else if (lowerName.endsWith(".txt")) {
                const { parseTextChatLog } = await import("../lib/chatParse");
                const entryChatName = (zipEntry.name.split("/").pop() || zipEntry.name).replace(/\.[^/.]+$/, "");
                const parsed = parseTextChatLog(text, entryChatName);
                parsedMessages = parsed.messages;
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
                const folderMatch = characters.find(
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
                  const match = characters.find(
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
            const { parseJsonlChat } = await import("../lib/chatParse");
            parsedMessages = parseJsonlChat(text);
          } else if (file.name.toLowerCase().endsWith(".txt")) {
            const { parseTextChatLog } = await import("../lib/chatParse");
            const fileChatName = file.name.replace(/\.[^/.]+$/, "");
            const parsed = parseTextChatLog(text, fileChatName);
            parsedMessages = parsed.messages;
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
            const match = characters.find(
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

  const handleBatchExport = async (share: boolean = false) => {
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

        if (isAndroid()) {
          const { shareFileOnAndroid, exportFileToMIU } = await import("../lib/appBridge");
          const bytes = new TextEncoder().encode(jsonlString);
          if (share) {
            await shareFileOnAndroid(safeChatName, bytes.buffer, "application/jsonl");
          } else {
            const savedPath = await exportFileToMIU(safeChatName, bytes.buffer, "application/jsonl", false);
            if (savedPath) {
                alert(`导出聊天记录成功！\n文件已存至：${savedPath.split('Download/')[1] || savedPath}`);
            }
          }
        } else {
          const blob = new Blob([jsonlString], { type: "application/jsonl" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = safeChatName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
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

    if (isAndroid()) {
      const buffer = await content.arrayBuffer();
      const { shareFileOnAndroid, exportFileToMIU } = await import("../lib/appBridge");
      if (share) {
        await shareFileOnAndroid(zipName, buffer, "application/zip");
      } else {
        const savedPath = await exportFileToMIU(zipName, buffer, "application/zip", false);
        if (savedPath) {
            alert(`批量导出聊天记录成功！\n文件已存至：${savedPath.split('Download/')[1] || savedPath}`);
        }
      }
    } else {
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = zipName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

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
        <div className="flex-none p-4 pt-[max(1.75rem,env(safe-area-inset-top))] sm:p-6 sm:pt-[max(1.75rem,env(safe-area-inset-top))] border-b border-white/10 bg-black/20 flex items-start sm:items-center justify-between sticky top-0 z-20 backdrop-blur-md transition-all gap-2 sm:gap-4">
          <div className="flex items-start sm:items-center gap-3 sm:gap-4 flex-1 min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-blue-500/20 flex items-center justify-center border border-blue-500/30 shrink-0">
              <MessageSquare className="w-5 h-5 sm:w-6 sm:h-6 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent flex items-center gap-2 flex-wrap">
                聊天记录查看器
              </h2>
              <p className="text-white/60 text-xs sm:text-sm mt-1 leading-relaxed">
                查看酒馆(Tavern)导出的 JSONL
                聊天记录（已支持读取角色卡内的世界书和CSS正则进行渲染）
              </p>
              <AnimatePresence>
                {importProgress.show && (
                  <motion.div
                    initial={{ opacity: 0, y: -50, x: '-50%' }}
                    animate={{ opacity: 1, y: 0, x: '-50%' }}
                    exit={{ opacity: 0, y: -50, x: '-50%' }}
                    className="fixed top-12 sm:top-20 left-1/2 z-[100] bg-slate-800/90 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl p-3 sm:p-4 w-[90%] max-w-[16rem] sm:w-72 pointer-events-auto"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <Download className="w-5 h-5 text-blue-400 animate-bounce shrink-0" />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold text-white truncate">
                          正在导入记录
                        </h4>
                        <p className="text-xs text-white/50 truncate">
                          {importProgress.message}
                        </p>
                      </div>
                      <span className="text-xs font-medium text-blue-400/80 shrink-0">
                        {importProgress.total > 0
                          ? Math.round((importProgress.current / importProgress.total) * 100)
                          : 0}%
                      </span>
                    </div>
                    <div className="w-full bg-black/40 rounded-full h-1.5 overflow-hidden relative">
                      <div 
                        className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-300 relative"
                        style={{ width: `${importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}%` }}
                      >
                        <div className="absolute inset-0 bg-white/20 animate-pulse" />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition shrink-0 mt-1 sm:mt-0"
              title="设置"
            >
              <Settings2 className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition shrink-0 mt-1 sm:mt-0"
            >
              <X className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          </div>
        </div>
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
            <div className="pointer-events-auto bg-black/60 backdrop-blur-xl border border-white/10 flex items-center shadow-[0_10px_40px_rgba(0,0,0,0.5)] transition-all duration-500 overflow-visible rounded-full w-full justify-between p-1.5">
              <button
                onClick={() => (singleMode ? onClose() : setActiveChatId(null))}
                className="w-10 h-10 shrink-0 flex items-center justify-center rounded-full hover:bg-white/10 text-white/70 hover:text-white transition"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>

              <div
                className="flex flex-col items-center justify-center px-2 sm:px-4 overflow-hidden flex-1 cursor-pointer"
                onClick={() => setIsHeaderExpanded(!isHeaderExpanded)}
              >
                <span className="text-sm font-bold text-white truncate w-full text-center leading-tight">
                  {activeChat.name}
                </span>
                <span className="text-[11px] text-white/50 block text-center mt-0.5 w-full truncate">
                  {activeChat.messages.length} 条消息
                </span>
              </div>

              <div className="relative flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setIsHeaderExpanded(!isHeaderExpanded)}
                  className={`w-10 h-10 flex items-center justify-center rounded-full transition ${isHeaderExpanded ? "bg-blue-500/20 text-blue-400" : "hover:bg-white/10 text-white/70 hover:text-white"}`}
                >
                  <Settings2 className="w-5 h-5" />
                </button>

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
                      className="absolute top-full right-0 mt-3 bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-64 p-4 z-40 overflow-hidden"
                    >
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-2 flex-1 min-h-0">
                          <label className="text-xs text-white/50 font-medium shrink-0">
                            绑定角色获得正则效果
                          </label>
                          <div className="relative shrink-0 mb-2">
                             <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                             <input
                                type="text"
                                placeholder="搜索角色..."
                                value={characterSearchQuery}
                                onChange={(e) => setCharacterSearchQuery(e.target.value)}
                                className="w-full bg-black/30 border border-white/10 text-sm text-white focus:outline-none rounded-lg pl-9 pr-3 py-2"
                             />
                          </div>
                          <div className="flex-1 overflow-y-auto space-y-1 max-h-48 pr-1 hide-scrollbar">
                             <button
                                onClick={() => handleUpdateBinding("")}
                                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${(!activeChat.characterId && !activeCharacter?.id) ? 'bg-blue-500/20 text-blue-400' : 'text-white hover:bg-white/5'}`}
                             >
                                暂不绑定
                             </button>
                             {characters.filter(c => c.name.toLowerCase().includes(characterSearchQuery.toLowerCase())).map(c => (
                                <button
                                   key={c.id}
                                   onClick={() => handleUpdateBinding(c.id)}
                                   className={`w-full text-left px-3 py-2 rounded-lg text-sm transition truncate ${activeChat.characterId === c.id || activeCharacter?.id === c.id ? 'bg-blue-500/20 text-blue-400' : 'text-white hover:bg-white/5'}`}
                                >
                                   {c.name}
                                </button>
                             ))}
                          </div>
                        </div>
                        {activeCharacter && (
                          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                            <span className="text-xs text-green-400 flex items-center gap-1.5 font-medium">
                              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                              已应用角色正则规则
                            </span>
                          </div>
                        )}
                        <div className="pt-2 mt-2 border-t border-white/10">
                          <button
                            onClick={() => {
                              setIsHeaderExpanded(false);
                              setShowSettings(true);
                            }}
                            className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-white/5 rounded-lg text-sm text-blue-300 transition"
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
          <AnimatePresence mode="wait">
            {isBatchMode ? (
              <motion.div
                key="batch"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="w-full flex items-center justify-between bg-slate-800/90 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-xl mb-4 shrink-0 cursor-default"
              >
                <button
                  onClick={() => {
                    setIsBatchMode(false);
                    setSelectedChatIds(new Set());
                    setShowDuplicatesOnly(false);
                  }}
                  className="p-2 -ml-2 rounded-full hover:bg-white/10 transition"
                >
                  <X className="w-6 h-6" />
                </button>
                <span className="font-bold text-lg flex-1 text-center">
                  已选择 {selectedChatIds.size} 项
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (selectedChatIds.size === savedChats.length) {
                        setSelectedChatIds(new Set());
                      } else {
                        setSelectedChatIds(
                          new Set(savedChats.map((c) => c.id)),
                        );
                      }
                    }}
                    className="text-purple-400 font-medium px-3 py-1.5 hover:bg-purple-400/10 rounded-lg transition text-sm whitespace-nowrap"
                  >
                    {selectedChatIds.size === savedChats.length
                      ? "全不选"
                      : "全选所有"}
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="normal"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="flex flex-col sm:flex-row sm:items-center justify-between px-2 shrink-0 gap-3 mb-4"
              >
                <h3 className="text-lg font-medium text-white shrink-0">
                  所有记录 ({savedChats.length})
                </h3>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:flex-initial">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                    <input
                      type="text"
                      placeholder="搜索..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full sm:w-40 pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-full text-sm text-white focus:outline-none focus:border-purple-500/50 transition-colors placeholder:text-white/30"
                    />
                  </div>
                  <button
                    onClick={() => setIsCleanerOpen(true)}
                    className="p-2.5 border rounded-full transition shrink-0 flex items-center justify-center bg-white/5 border-white/10 text-white/50 hover:text-white hover:bg-white/10"
                    title="清理记录和分支"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      if (onOpenImport) {
                        onOpenImport();
                      } else {
                        fileInputRef.current?.click();
                      }
                    }}
                    className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-full text-sm transition flex items-center justify-center gap-2 shrink-0"
                  >
                    <UploadCloud className="w-4 h-4" />
                    <span className="hidden sm:inline">导入</span>
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".json,.jsonl,.txt,.zip"
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
              </motion.div>
            )}
          </AnimatePresence>

          {savedChats.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-3xl">
              <FileJson className="w-16 h-16 text-white/20 mb-4 mx-auto" />
              <h3 className="text-xl font-medium text-white/60 mb-2">
                拖拽或点击上方按钮导入聊天记录
              </h3>
              <p className="text-white/40 mb-8">
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
                          className={`border rounded-2xl p-4 cursor-pointer transition flex items-center justify-between shadow-sm relative overflow-hidden ${
                            isBatchMode && allSelected
                              ? "bg-purple-500/20 border-purple-500/50 [.light-theme_&]:bg-[#D4A6D5]/20 [.light-theme_&]:border-[#D4A6D5]/90 [.light-theme_&]:shadow-[0_0_15px_rgba(212,166,213,0.3)]"
                              : "bg-white/[0.04] hover:bg-white/[0.08] border-white/5"
                          }`}
                        >
                          <AnimatePresence>
                            {isBatchMode && (
                              <motion.div
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.8 }}
                                className="absolute top-2 right-2 z-10"
                              >
                                <div
                                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                                    allSelected
                                      ? "bg-purple-500 border-purple-500 [.light-theme_&]:bg-[#D4A6D5]/90 [.light-theme_&]:border-[#D4A6D5]/90"
                                      : "border-white/40 bg-black/20 backdrop-blur-md"
                                  }`}
                                >
                                  {allSelected && (
                                    <CheckCircle2 className="w-4 h-4 text-white" />
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-full border border-white/20 bg-black/30 flex items-center justify-center shrink-0 shadow-inner overflow-hidden">
                              {group.characterId &&
                              avatarUrls[group.characterId] ? (
                                <img
                                  src={avatarUrls[group.characterId]}
                                  alt="avatar"
                                  className="w-full h-full object-cover"
                                                                    onError={(e) => {
                                    const c = characters.find(
                                      (ch) => ch.id === group.characterId,
                                    );
                                    if (c) {
                                      if (c.avatarBlob)
                                        e.currentTarget.src =
                                          setFallbackAvatarBlobUrl(c.id, c.avatarBlob);
                                      else if (c.hasBlobsSeparated) {
                                        import("../lib/db").then((m) =>
                                          m.getCharacterBlob(c.id).then((b) => {
                                            if (b && b.avatarBlob)
                                              e.currentTarget.src =
                                                setFallbackAvatarBlobUrl(c.id, b.avatarBlob);
                                            else {
                                              const fb = getFallbackAvatar(c.name || c.id, c.tags?.join(',') || (c.isTool ? 'tool' : undefined));
                                              if (e.currentTarget.src !== fb) e.currentTarget.src = fb;
                                            }
                                          }),
                                        ).catch(() => {
                                          const fb = getFallbackAvatar(c.name || c.id, c.tags?.join(',') || (c.isTool ? 'tool' : undefined));
                                          if (e.currentTarget.src !== fb) e.currentTarget.src = fb;
                                        });
                                      } else {
                                        const fb = getFallbackAvatar(c.name || c.id, c.tags?.join(',') || (c.isTool ? 'tool' : undefined));
                                        if (e.currentTarget.src !== fb) e.currentTarget.src = fb;
                                      }
                                    }
                                  }}
                                />
                              ) : (
                                <span className="text-lg font-bold text-white/50">
                                  {groupName.charAt(0)}
                                </span>
                              )}
                            </div>
                            <div className="truncate">
                              <h4 className="font-semibold text-white/90 text-base truncate mb-0.5">
                                {groupName}
                              </h4>
                              <p className="text-xs text-white/40">
                                {group.chats.length} 个历史记录
                              </p>
                            </div>
                          </div>
                          <div className="text-white/40 shrink-0">
                            {!isBatchMode &&
                              (isExpanded ? (
                                <ChevronUp className="w-5 h-5" />
                              ) : (
                                <ChevronDown className="w-5 h-5" />
                              ))}
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
                        className={`rounded-2xl p-5 cursor-pointer transition flex flex-col gap-3 relative overflow-hidden ring-1 hover:shadow-lg ${
                          isSelected && isBatchMode
                            ? "bg-purple-500/20 ring-purple-500/50 [.light-theme_&]:bg-[#D4A6D5]/20 [.light-theme_&]:ring-[#D4A6D5]/90 [.light-theme_&]:shadow-[0_0_15px_rgba(212,166,213,0.3)]"
                            : "bg-white/[0.03] hover:bg-white/[0.06] ring-white/5"
                        }`}
                      >
                        <AnimatePresence>
                          {isBatchMode && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.8 }}
                              className="absolute top-2 right-2 z-10"
                            >
                              <div
                                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                                  isSelected
                                    ? "bg-purple-500 border-purple-500 [.light-theme_&]:bg-[#D4A6D5]/90 [.light-theme_&]:border-[#D4A6D5]/90"
                                    : "border-white/40 bg-black/20 backdrop-blur-md"
                                }`}
                              >
                                {isSelected && (
                                  <CheckCircle2 className="w-4 h-4 text-white" />
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
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
                                    className="w-full bg-black/40 border border-blue-500/50 rounded flex px-2 py-1 text-sm text-blue-300 focus:outline-none placeholder-blue-300/30"
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
                                  className="text-sm font-medium text-blue-300 cursor-pointer hover:text-blue-200 transition flex items-center gap-2 mb-1"
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
                                      <span className="text-xs text-blue-300/50 shrink-0 flex items-center gap-1 leading-none pt-0.5">
                                        <Edit2 className="w-3 h-3" />
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-blue-300/50 flex items-center gap-1 font-normal">
                                      <Plus className="w-3.5 h-3.5" />{" "}
                                      添加内容备注...
                                    </span>
                                  )}
                                </div>
                              )}
                              <h4
                                className="font-medium text-white/90 truncate w-full text-sm"
                                title={chat.name}
                              >
                                {chat.name}
                              </h4>
                            </div>
                          </div>

                          <button
                            onClick={(e) => handleRemoveChat(e, chat.id)}
                            className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition z-10 shrink-0 mt-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="flex justify-between items-center text-xs text-white/40 pb-2 border-b border-white/5">
                          <span className="flex items-center gap-1">
                            <Book className="w-4 h-4 text-blue-400" />
                            {chat.messageCount} 条消息
                          </span>
                          <span className="flex items-center gap-1">
                            {new Date(chat.createdAt).toLocaleString()}
                          </span>
                        </div>

                        <div className="text-white/60 text-xs leading-relaxed max-w-none line-clamp-3 overflow-hidden break-words">
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
                        ? new Date(msg.send_date).toLocaleString()
                        : "";
                      return (
                        <div
                          className={`flex gap-4 pb-6 mt-4 px-2 ${msg.is_user ? "flex-row-reverse" : ""} overflow-hidden w-full min-w-0`}
                        >
                          <div className="shrink-0 pt-1">
                            {msg.is_user ? (
                              userAvatar ? (
                                <div className="w-10 h-10 rounded-full border border-white/20 bg-black/30 flex items-center justify-center shrink-0 shadow-lg overflow-hidden">
                                  <img
                                    src={userAvatar}
                                    alt="user avatar"
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-white/10 text-slate-300 border border-white/20 flex items-center justify-center shadow-lg font-bold [.light-theme_&]:bg-blue-600 [.light-theme_&]:text-white [.light-theme_&]:border-transparent [.light-theme_&]:shadow-blue-500/20">
                                  {msg.name?.charAt(0) || "U"}
                                </div>
                              )
                            ) : activeCharacter &&
                              avatarUrls[activeCharacter.id] ? (
                              <img
                                src={avatarUrls[activeCharacter.id]}
                                alt="avatar"
                                className="w-10 h-10 rounded-full object-cover shadow-lg border border-white/10"
                                                                onError={(e) => {
                                  const c = activeCharacter;
                                  if (c) {
                                    if (c.avatarBlob)
                                      e.currentTarget.src = setFallbackAvatarBlobUrl(c.id, c.avatarBlob);
                                    else if (c.hasBlobsSeparated) {
                                      import("../lib/db").then((m) =>
                                        m.getCharacterBlob(c.id).then((b) => {
                                          if (b && b.avatarBlob)
                                            e.currentTarget.src =
                                              setFallbackAvatarBlobUrl(c.id, b.avatarBlob);
                                          else {
                                            const fb = getFallbackAvatar(c.name || c.id, c.tags?.join(',') || (c.isTool ? 'tool' : undefined));
                                            if (e.currentTarget.src !== fb) e.currentTarget.src = fb;
                                          }
                                        }),
                                      ).catch(() => {
                                        const fb = getFallbackAvatar(c.name || c.id, c.tags?.join(',') || (c.isTool ? 'tool' : undefined));
                                        if (e.currentTarget.src !== fb) e.currentTarget.src = fb;
                                      });
                                    } else {
                                      const fb = getFallbackAvatar(c.name || c.id, c.tags?.join(',') || (c.isTool ? 'tool' : undefined));
                                      if (e.currentTarget.src !== fb) e.currentTarget.src = fb;
                                    }
                                  }
                                }}
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-white/[0.05] flex items-center justify-center shadow-sm border border-white/10 text-slate-200 font-bold [.light-theme_&]:bg-indigo-900 [.light-theme_&]:text-indigo-200 [.light-theme_&]:border-indigo-500/30 [.light-theme_&]:shadow-lg">
                                {msg.name?.charAt(0) || "AI"}
                              </div>
                            )}
                          </div>

                          <div
                            className={`max-w-[85%] md:max-w-[80%] min-w-0 ${msg.is_user ? "items-end" : "items-start"} flex flex-col gap-1`}
                          >
                            <div
                              className={`flex items-center gap-2 text-xs ${msg.is_user ? "flex-row-reverse text-slate-400 [.light-theme_&]:text-blue-600" : "text-slate-400 [.light-theme_&]:text-slate-500"}`}
                            >
                              <span className="font-semibold">
                                {msg.name ||
                                  (msg.is_user ? "User" : "Character")}
                              </span>
                              {dateString && <span>· {dateString}</span>}
                            </div>

                            <div
                              className={`px-5 py-3 rounded-2xl max-w-full min-w-0 overflow-x-auto ${
                                msg.is_user
                                  ? "bg-blue-600/20 text-blue-50 border border-blue-500/20 rounded-tr-sm shadow-sm backdrop-blur-md [.light-theme_&]:bg-blue-600/90 [.light-theme_&]:text-white [.light-theme_&]:border-blue-500/30"
                                  : "bg-white/[0.04] text-white/90 border border-white/5 rounded-tl-sm shadow-sm backdrop-blur-md [.light-theme_&]:bg-indigo-950/80 [.light-theme_&]:text-indigo-100 [.light-theme_&]:border-indigo-500/20"
                              }`}
                            >
                              <div
                                className={`prose prose-sm max-w-none chat-bubble-prose
                                    prose-headings:text-white/90 prose-p:leading-relaxed 
                                    prose-a:text-blue-400 hover:prose-a:text-blue-300
                                    prose-strong:text-white prose-code:text-pink-300
                                    prose-pre:bg-black/30 prose-pre:max-w-full
                                    [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 break-words w-full 
                                    ${msg.is_user ? "prose-p:text-slate-100 text-slate-100 [.light-theme_&]:prose-p:text-white [.light-theme_&]:text-white" : "prose-invert"}
                                  `}
                              >
                                <MessageContent
                                  content={formatCustomTags(
                                    applyRegexes(
                                      msg.mes || "",
                                      activeCharacter,
                                    ),
                                  )}
                                />
                              </div>
                            </div>

                            {/* Render ST Extensions / Status Bars */}
                            {msg.extra && msg.extra.chara_status && (
                              <div className="mt-1 px-4 py-2 bg-[rgba(0,0,0,0.2)] border border-[rgba(255,255,255,0.05)] rounded-xl backdrop-blur-sm text-xs font-mono text-[#e2e8f0] max-w-full overflow-x-auto">
                                <div className="font-sans font-semibold text-[#94a3b8] mb-1 uppercase tracking-wider text-[10px]">
                                  Tavern Assistant Status
                                </div>
                                <pre className="whitespace-pre-wrap">
                                  {typeof msg.extra.chara_status === "string"
                                    ? msg.extra.chara_status
                                    : JSON.stringify(
                                        msg.extra.chara_status,
                                        null,
                                        2,
                                      )}
                                </pre>
                              </div>
                            )}
                            {msg.extra && msg.extra.tavernAStatus && (
                              <div className="mt-1 px-4 py-2 bg-[rgba(0,0,0,0.2)] border border-[rgba(255,255,255,0.05)] rounded-xl backdrop-blur-sm text-xs font-mono text-[#e2e8f0] max-w-full overflow-x-auto">
                                <div className="font-sans font-semibold text-[#94a3b8] mb-1 uppercase tracking-wider text-[10px]">
                                  Status Panel
                                </div>
                                <pre className="whitespace-pre-wrap">
                                  {typeof msg.extra.tavernAStatus === "string"
                                    ? msg.extra.tavernAStatus
                                    : JSON.stringify(
                                        msg.extra.tavernAStatus,
                                        null,
                                        2,
                                      )}
                                </pre>
                              </div>
                            )}
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
              <h3 className="text-lg font-bold text-white flex items-center gap-2 [.light-theme_&]:text-[#1c1c1e]">
                <Settings2 className="w-5 h-5 text-blue-400 [.light-theme_&]:text-[#007aff]" />
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
                      onClick={() => userAvatarInputRef.current?.click()}
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
                  </div>
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
                    className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50 [.light-theme_&]:bg-[#ffffff] [.light-theme_&]:border-black/10 [.light-theme_&]:text-[#1c1c1e] [.light-theme_&]:placeholder:text-[#8e8e93]"
                  />
                  <button
                    onClick={handleAddCustomTag}
                    disabled={!newTagInput.trim()}
                    className="p-2 bg-blue-600 hover:bg-blue-500 disabled:bg-white/10 disabled:text-white/30 text-white rounded-xl transition [.light-theme_&]:disabled:bg-black/5 [.light-theme_&]:disabled:text-[#8e8e93] [.light-theme_&]:bg-[#007aff] [.light-theme_&]:hover:bg-[#0056b3]"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>

                {customTags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {customTags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 rounded-lg text-sm [.light-theme_&]:bg-[#007aff]/10 [.light-theme_&]:text-[#007aff] [.light-theme_&]:border-[#007aff]/20"
                      >
                        {tag}
                        <button
                          onClick={() => handleRemoveCustomTag(tag)}
                          className="hover:text-red-400 p-0.5 rounded-full transition [.light-theme_&]:text-[#007aff]/60 [.light-theme_&]:hover:text-[#ff3b30]"
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

      {/* Delete Chat Confirmation Modal */}
      <AnimatePresence>
        {deleteChatId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setDeleteChatId(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-2xl p-6 max-w-sm w-full shadow-2xl [.light-theme_&]:bg-[#ffffff]/90 [.light-theme_&]:backdrop-blur-3xl [.light-theme_&]:border-black/5"
            >
              <h3 className="text-xl font-bold mb-2 text-white [.light-theme_&]:text-[#1c1c1e]">
                删除聊天记录？
              </h3>
              <p className="text-slate-400 mb-6 [.light-theme_&]:text-[#8e8e93]">
                此操作无法撤销，确定要删除这条聊天记录吗？
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDeleteChatId(null)}
                  className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 hover:text-white transition [.light-theme_&]:bg-black/5 [.light-theme_&]:hover:bg-black/10 [.light-theme_&]:text-[#1c1c1e] [.light-theme_&]:hover:text-[#1c1c1e]"
                >
                  取消
                </button>
                <button
                  onClick={confirmDeleteChat}
                  className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white transition shadow-lg shadow-red-500/20 [.light-theme_&]:bg-[#ff3b30] [.light-theme_&]:hover:bg-[#b31f17] [.light-theme_&]:text-white"
                >
                  删除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {imageToCrop && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-2xl w-full max-w-md flex flex-col shadow-2xl overflow-hidden h-[500px] [.light-theme_&]:bg-[#ffffff]/90 [.light-theme_&]:backdrop-blur-3xl [.light-theme_&]:border-black/5">
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02] [.light-theme_&]:bg-black/[0.02] [.light-theme_&]:border-black/5">
              <h3 className="text-lg font-bold text-white [.light-theme_&]:text-[#1c1c1e]">
                调整头像
              </h3>
              <button
                onClick={closeCrop}
                className="p-1 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition [.light-theme_&]:hover:bg-black/5 [.light-theme_&]:text-[#8e8e93] [.light-theme_&]:hover:text-[#1c1c1e]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 relative w-full h-full bg-black/50">
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
            <div className="p-4 border-t border-white/10 bg-white/[0.02] flex items-center justify-between gap-4">
              <input
                type="range"
                value={zoom}
                min={1}
                max={3}
                step={0.1}
                aria-labelledby="Zoom"
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer"
              />
              <button
                onClick={handleSaveCrop}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition"
              >
                保存头像
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Batch Actions Bar */}
      <AnimatePresence>
        {isBatchMode && selectedChatIds.size > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0, x: "-50%" }}
            animate={{ y: 0, opacity: 1, x: "-50%" }}
            exit={{ y: 100, opacity: 0, x: "-50%" }}
            className="fixed bottom-8 left-1/2 z-[60] max-w-[95vw] sm:max-w-[80vw] bg-slate-800/80 backdrop-blur-2xl border border-white/10 rounded-full shadow-2xl overflow-hidden"
          >
            <div
              className="flex items-center p-1 overflow-x-auto"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              <style>{`
                .no-scrollbar::-webkit-scrollbar {
                  display: none;
                }
              `}</style>
              <div className="flex items-center gap-2 no-scrollbar px-1 min-w-max">
            
            <button
              onClick={() => handleBatchExport(false)}
              disabled={selectedChatIds.size === 0}
              className="flex flex-col items-center gap-1 px-4 py-2 rounded-full hover:bg-white/10 text-white/70 hover:text-green-400 transition disabled:opacity-50 group shrink-0"
            >
              <div className="p-2 rounded-full bg-white/5 group-hover:bg-green-400/20 transition">
                <Download className="w-5 h-5" />
              </div>
              <span className="font-medium text-[10px]">导出</span>
            </button>
            <div className="w-px h-8 bg-white/10 shrink-0" />
            <button
              onClick={handleChatsCloudUpload}
              disabled={selectedChatIds.size === 0}
              className="flex flex-col items-center gap-1 px-4 py-2 rounded-full hover:bg-blue-500/10 text-white/70 hover:text-blue-400 transition disabled:opacity-50 group shrink-0"
            >
              <div className="p-2 rounded-full bg-white/5 group-hover:bg-blue-400/20 transition">
                <UploadCloud className="w-5 h-5" />
              </div>
              <span className="font-medium text-[10px]">传云盘</span>
            </button>
            <div className="w-px h-8 bg-white/10 shrink-0" />
            <button
              onClick={handleBatchDelete}
              disabled={selectedChatIds.size === 0}
              className="flex flex-col items-center gap-1 px-4 py-2 rounded-full hover:bg-red-500/10 text-white/70 hover:text-red-400 transition disabled:opacity-50 group shrink-0"
            >
              <div className="p-2 rounded-full bg-white/5 group-hover:bg-red-400/20 transition">
                <Trash2 className="w-5 h-5" />
              </div>
              <span className="font-medium text-[10px]">删除</span>
            </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
