import { getFallbackAvatar, resolveAvatarUrl } from "../lib/avatar";
import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  UploadCloud,
  FileJson,
  Image as ImageIcon,
  AlertCircle,
  FileArchive,
  Cloud,
  CheckCircle,
  Check,
  Search,
  Folder,
  ArrowRight,
} from "lucide-react";
import { extractTavernData } from "../lib/png";
import {
  saveCharacter,
  saveCharacters,
  CharacterCard,
  getSafeFilename,
  getFolders,
  saveFolder,
  Folder as DBFolder,
  ChatLog,
  isActualCharacterCard,
} from "../lib/db";
import { normalizeWorldbookEntries } from "../lib/worldbook";
import { parseTavernCard } from "../types/tavern";
import { isAndroid, saveToGallery } from "../lib/appBridge";
import { getAISettings, normalizeSillyTavernUrl, getSillyTavernAuthHeaders } from "../lib/ai";
import JSZip from "jszip";
import { useInView } from "../lib/useInView";
import { withReadSlot } from "../lib/thumbCache";

const tavernAvatarCache = new Map<string, string>();

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
  onNavigateFolder?: (folderId: string | null) => void;
  folderId?: string | null;
  initialFiles?: FileList | File[] | null;
}

interface ParsedItem {
  file: File;
  path: string;
  folder: string;
  isMain: boolean;
  data?: any;
  isImage: boolean;
  isChatLog?: boolean;
  isVersion?: boolean;
  isMeta?: boolean;
  errorMsg?: string;
}

export function TavernAvatar({ char, aiSettings }: { char: any, aiSettings: any }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(() =>
    tavernAvatarCache.get(char.avatar) || null
  );
  const [error, setError] = useState(false);
  const containerRef = useRef<HTMLImageElement>(null);
  const inView = useInView(containerRef);

  useEffect(() => {
    if (!inView) return;
    if (tavernAvatarCache.has(char.avatar)) {
      setBlobUrl(tavernAvatarCache.get(char.avatar)!);
      return;
    }

    let cancelled = false;
    const androidBridge = (window as any).Android;

    const fetchImg = () =>
      withReadSlot(async () => {
        if (cancelled) return;

        const stUrl = normalizeSillyTavernUrl(aiSettings.sillyTavernUrl);
        if (!stUrl) return;

        if (isAndroid() && androidBridge && typeof androidBridge.fetchTavernAvatarAsDataUrl === 'function') {
          const dataUrl = androidBridge.fetchTavernAvatarAsDataUrl(
            stUrl,
            char.avatar,
            aiSettings.sillyTavernUsername || "",
            aiSettings.sillyTavernPassword || "",
          );
          if (cancelled) return;
          if (dataUrl && dataUrl.startsWith("data:")) {
            tavernAvatarCache.set(char.avatar, dataUrl);
            setBlobUrl(dataUrl);
          } else {
            setError(true);
          }
          return;
        }

        const headers = getSillyTavernAuthHeaders(aiSettings);

        try {
          const thumbUrl = `${stUrl}/thumbnail?type=avatar&file=${encodeURIComponent(char.avatar)}`;
          let res = await fetch(thumbUrl, { headers });

          if (!res.ok) {
            res = await fetch(
              `${stUrl}/characters/${encodeURIComponent(char.avatar)}`,
              { headers }
            );
          }

          if (res.ok && !cancelled) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            tavernAvatarCache.set(char.avatar, url);
            setBlobUrl(url);
          } else {
            if (!cancelled) setError(true);
          }
        } catch {
          if (!cancelled) setError(true);
        }
      });

    fetchImg();
    return () => { cancelled = true; };
  }, [char.avatar, aiSettings, inView]);

  return (
    <img
      ref={containerRef}
      src={error || !blobUrl ? getFallbackAvatar(char.name) : blobUrl}
      className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg object-cover shrink-0"
    />
  );
}

export function ImportModal({ isOpen, onClose, onImported, onNavigateFolder, folderId, initialFiles }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<
    { file: string; error: string }[]
  >([]);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    message?: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [autoCategorizeSameName, setAutoCategorizeSameName] = useState<boolean>(
    () => localStorage.getItem("miu_auto_categorize_same_name") !== "false",
  );
  const [autoCategorizedSummary, setAutoCategorizedSummary] = useState<
    Array<{
      cardId: string;
      charName: string;
      folderId: string;
      folderPath: string;
    }> | null
  >(null);
  const [importedSuccessCount, setImportedSuccessCount] = useState(0);
  const [isReverting, setIsReverting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setAutoCategorizedSummary(null);
      setError(null);
      setImportErrors([]);
      setProgress(null);
      setIsReverting(false);
    }
  }, [isOpen]);

  const initialFilesHandled = useRef(false);

  const [tavernMode, setTavernMode] = useState<boolean>(false);
  const [tavernChars, setTavernChars] = useState<any[]>([]);
  const [selectedTavernChars, setSelectedTavernChars] = useState<Set<string>>(new Set());
  const [isPulling, setIsPulling] = useState(false);
  const [tavernSearchQuery, setTavernSearchQuery] = useState("");

  const fetchTavernList = async () => {
    const aiSettings = getAISettings();
    const stUrl = normalizeSillyTavernUrl(aiSettings.sillyTavernUrl);
    if (!stUrl) {
      setError('请先在"设置"中配置酒馆 API 地址。Termux 本地通常是 http://127.0.0.1:8000');
      return;
    }

    setIsPulling(true);
    setTavernMode(true);
    setError(null);
    setProgress({ current: 0, total: 0, message: "正在连接酒馆并获取角色列表..." });

    try {
      const headers = getSillyTavernAuthHeaders(aiSettings);

      // Android 真机优先走 MainActivity 的 Java 桥接：原生流式解析
      // /api/characters/all，只回传 name/avatar/description，避免几十 MB
      // 大 JSON 进 WebView 后卡在 JSON.parse，导致一直转圈。
      const androidBridge = (window as any).Android;
      if (isAndroid() && androidBridge && typeof androidBridge.fetchTavernCharListLite === 'function') {
        try {
          const raw = androidBridge.fetchTavernCharListLite(
            stUrl,
            aiSettings.sillyTavernUsername || '',
            aiSettings.sillyTavernPassword || '',
          );
          if (raw) {
            const meta = JSON.parse(raw);
            if (meta && (meta.status === 200 || meta.status === 201)) {
              const nativeList = Array.isArray(meta.list)
                ? meta.list.filter((c: any) => c && c.avatar && c.name)
                : [];
              if (nativeList.length > 0) {
                setTavernChars(nativeList);
                setSelectedTavernChars(new Set(nativeList.map((c: any) => c.avatar)));
                setProgress(null);
                return;
              }
            } else {
              console.warn('native tavern list returned', meta?.status, meta?.error || '');
            }
          }
        } catch (e) {
          console.warn('native tavern list failed, falling back to fetch', e);
        }
      }

      const fetchWithTimeout = (url: string, init: RequestInit, timeoutMs: number) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
      };

      // 先做连通性检查，这样“地址填错/没启动/缺 http://”会显示明确原因。
      let reachable = false;
      let connectError = "";
      for (const testUrl of [`${stUrl}/csrf-token`, `${stUrl}/version`, `${stUrl}/`]) {
        try {
          const testRes = await fetchWithTimeout(testUrl, { headers }, 8000);
          reachable = Boolean(testRes);
          break;
        } catch (e: any) {
          connectError = e?.message || String(e);
        }
      }
      if (!reachable) {
        throw new Error(`无法连接酒馆 ${stUrl}（${connectError || "网络请求失败"}）。请确认 Termux 中酒馆已启动、端口正确，并且地址以 http:// 开头`);
      }

      let csrf = "";
      const refreshCsrf = async () => {
        try {
          const csrfRes = await fetchWithTimeout(`${stUrl}/csrf-token`, { headers }, 8000);
          if (csrfRes.ok) {
            const csrfData = await csrfRes.json().catch(() => ({}));
            csrf = csrfData.token || "";
          }
        } catch {}
      };
      await refreshCsrf();

      const requestList = async (url: string, method: 'GET' | 'POST', body?: string) => {
        try {
          const reqHeaders: Record<string, string> = { ...headers };
          if (csrf) reqHeaders['X-CSRF-Token'] = csrf;
          if (body !== undefined) reqHeaders['Content-Type'] = 'application/json';
          const res = await fetchWithTimeout(url, { method, headers: reqHeaders, body }, 90000);
          if (!res.ok) {
            let detail = `HTTP ${res.status}`;
            try {
              const text = (await res.text()).trim();
              if (text) detail = text.length > 220 ? `${text.slice(0, 220)}...` : text;
            } catch {}
            return { ok: false as const, status: res.status, arr: [] as any[], error: detail };
          }

          const data = await res.json();
          const arr = Array.isArray(data)
            ? data
            : Array.isArray(data?.characters)
              ? data.characters
              : Array.isArray(data?.data)
                ? data.data
                : data && typeof data === 'object'
                  ? Object.values(data)
                  : [];
          return { ok: true as const, status: res.status, arr, error: arr.length === 0 ? "返回列表为空" : "" };
        } catch (e: any) {
          return { ok: false as const, status: -1, arr: [] as any[], error: e?.message || "网络错误" };
        }
      };

      let validChars: any[] = [];
      let lastError = "";
      const attempts: { url: string; method: 'GET' | 'POST'; body?: string }[] = [
        { url: `${stUrl}/api/characters/all`, method: 'POST', body: JSON.stringify({ shallow: true }) },
        { url: `${stUrl}/api/characters/all`, method: 'GET' },
        { url: `${stUrl}/api/characters`, method: 'GET' },
      ];

      for (const attempt of attempts) {
        let result = await requestList(attempt.url, attempt.method, attempt.body);
        if (result.status === 403 && attempt.method === 'POST') {
          await refreshCsrf();
          result = await requestList(attempt.url, attempt.method, attempt.body);
        }
        if (result.ok && result.arr.length) {
          validChars = result.arr.filter((c: any) => c && c.avatar && c.name);
          lastError = "";
          break;
        }
        lastError = result.error || `HTTP ${result.status}`;
      }

      if (validChars.length === 0) {
        throw new Error(lastError || "未找到可用卡片");
      }

      setTavernChars(validChars);
      setSelectedTavernChars(new Set(validChars.map((c: any) => c.avatar)));
      setProgress(null);
    } catch (e: any) {
      setError(`获取列表失败: ${e.message}`);
      setProgress(null);
    } finally {
      setIsPulling(false);
    }
  };

  const pullSelectedTavernChars = async () => {
    const aiSettings = getAISettings();
    const stUrl = normalizeSillyTavernUrl(aiSettings.sillyTavernUrl);
    if (!stUrl) return;

    const charsToFetch = tavernChars.filter(c => selectedTavernChars.has(c.avatar));
    if (charsToFetch.length === 0) return;

    setProgress({ current: 0, total: charsToFetch.length, message: "正在下载角色卡..." });
    setTavernMode(false);
    setTavernSearchQuery("");

    const files: File[] = [];
    const headers = getSillyTavernAuthHeaders(aiSettings);
    let lastDownloadError = "";

    let completed = 0;
    let currentIndex = 0;
    const CONCURRENCY = 6;

    const downloadWorker = async () => {
      while (currentIndex < charsToFetch.length) {
        const index = currentIndex++;
        const char = charsToFetch[index];
        try {
          const res = await fetch(`${stUrl}/characters/${encodeURIComponent(char.avatar)}`, { headers });
          if (res.ok) {
            const blob = await res.blob();
            const file = new File([blob], char.avatar, { type: blob.type || 'image/png' });
            files[index] = file;
          } else {
            lastDownloadError = `HTTP ${res.status}`;
            console.error("Failed to fetch avatar", char.avatar);
          }
        } catch (e) {
          lastDownloadError = e?.message || String(e);
          console.error("Error fetching", char.avatar, e);
        } finally {
          completed++;
          setProgress({
            current: completed,
            total: charsToFetch.length,
            message: `已下载 ${completed}/${charsToFetch.length}`,
          });
        }
      }
    };

    const workers = [];
    for (let w = 0; w < CONCURRENCY; w++) {
      workers.push(downloadWorker());
    }
    await Promise.all(workers);

    setProgress(null);
    const downloadedFiles = files.filter(Boolean);
    if (downloadedFiles.length > 0) {
      handleFiles(downloadedFiles);
    } else {
      setError(`下载失败，未获取到任何卡片。${lastDownloadError ? `（${lastDownloadError}）` : ""}`);
    }
  };

  useEffect(() => {
    if (isOpen) {
      // 每次真正打开弹窗都强制清一次上次可能残留的进度/错误状态,
      // 避免上一轮导入的状态(比如卡在"20/20"再也没清掉)在下一次打开时还留着。
      setProgress(null);
      setImportErrors([]);
      setError(null);
      if (initialFiles && !initialFilesHandled.current) {
        initialFilesHandled.current = true;
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        handleFiles(initialFiles);
      }
    } else {
      initialFilesHandled.current = false;
    }
  }, [isOpen, initialFiles]);

  const getOrCreateNestedFolder = async (
    pathParts: string[],
    startParentId?: string | null,
  ): Promise<string | undefined> => {
    if (pathParts.length === 0) return startParentId || undefined;
    let currentParentId: string | null = startParentId || null;

    const folders = await getFolders();

    for (const part of pathParts) {
      const existing = folders.find(
        (f) => f.name === part && (f.parentId || null) === currentParentId,
      );
      if (existing) {
        currentParentId = existing.id;
      } else {
        const newFolder: DBFolder = {
          id: crypto.randomUUID(),
          name: part,
          createdAt: Date.now(),
          parentId: currentParentId,
        };
        await saveFolder(newFolder);
        folders.push(newFolder);
        currentParentId = newFolder.id;
      }
    }
    return currentParentId || undefined;
  };

  const parseChunk = async (
    files: File[],
    startIndex: number,
    chunkSize: number,
    parsedItems: ParsedItem[],
    errors: { file: string; error: string }[],
    extractedRoots: string[],
  ) => {
    const endIndex = Math.min(startIndex + chunkSize, files.length);

    for (let i = startIndex; i < endIndex; i++) {
      const file = files[i];
      const path = file.webkitRelativePath || file.name;
      const folder = path.substring(0, path.lastIndexOf("/")) || "";
      const isImage =
        file.type.startsWith("image/") ||
        file.name.match(/\.(png|jpe?g|webp|gif)$/i) !== null;

      let isMain = false;
      let data: any = null;
      let errorMsg = "";

      try {
        if (file.type === "image/png" || file.name.endsWith(".png")) {
          const buffer = await file.arrayBuffer();
          data = await extractTavernData(buffer);
          if (data) {
            isMain = true;
          } else {
            errorMsg = "非酒馆卡或预设格式：未找到Tavern角色数据。";
          }
        } else if (
          file.type === "application/json" ||
          file.name.toLowerCase().endsWith(".json") ||
          file.name.toLowerCase().endsWith(".jsonl") ||
          file.name.endsWith(".js") ||
          file.name.endsWith(".txt")
        ) {
          const text = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.onerror = reject;
            reader.readAsText(file, "utf-8");
          });
          if (file.name.toLowerCase().endsWith(".jsonl")) {
            const lines = text.trim().split("\n");
            let parsedMessages = [];
            for (const line of lines) {
              try {
                const p = JSON.parse(line);
                if (p) parsedMessages.push(p);
              } catch (e) {}
            }
            const { sanitizeChatMessages } = await import("../lib/chatParse");
            const sanitized = sanitizeChatMessages(parsedMessages);
            if (sanitized.isChat) {
              data = sanitized.messages;
              isMain = false;
            } else {
              errorMsg = "无效的聊天记录文件。";
            }
          } else if (file.name.endsWith(".txt")) {
            const { parseTextChatLog } = await import("../lib/chatParse");
            const parsed = parseTextChatLog(text);
            if (parsed.isChat) {
              data = parsed.messages;
              isMain = false;
            } else {
              data = { type: "script", name: file.name.replace(/\.[^/.]+$/, ""), content: text };
              isMain = true;
            }
          } else if (file.name.endsWith(".js")) {
            data = { type: "script", name: file.name.replace(/\.[^/.]+$/, ""), content: text };
            isMain = true;
          } else {
            data = JSON.parse(text);
            const isActualChar = isActualCharacterCard(data);
            const isTheme =
              !isActualChar &&
              (data.blur_strength !== undefined ||
              data.main_text_color !== undefined ||
              data.chat_display !== undefined);
            const isAIPreset =
              !isActualChar &&
              (data.temperature !== undefined ||
              data.prompts !== undefined ||
              data.top_p !== undefined ||
              data.preset_type !== undefined);
            const isWorldbook =
              !isActualChar &&
              (data.entries !== undefined ||
              (data.data && data.data.entries !== undefined));
            const isQR = !isActualChar && (Array.isArray(data) ? (data.length > 0 && (data[0]?.label !== undefined || data[0]?.message !== undefined || data[0]?.set !== undefined)) : ((data?.quick_replies !== undefined || data?.qrList !== undefined) && data?.spec !== "chara_card_v2" && data?.spec !== "chara_card_v3" && data?.first_mes === undefined && data?.personality === undefined));
            const isScript = !isActualChar && (data?.type === "script" && data?.content !== undefined && data?.name !== undefined);

            const isChatData = Array.isArray(data)
              ? data.some((item) => item && (item.mes !== undefined || item.text !== undefined || item.is_user !== undefined || item.send_date !== undefined))
              : !!(data.chat && Array.isArray(data.chat) && !data.name && !data.char_name && !data.character_name && !data.data?.name && !data.data?.char_name && !data.data?.character_name);

            const isCharacter =
              isActualChar ||
              (!isTheme &&
              !isAIPreset &&
              !isWorldbook &&
              !isQR &&
              !isScript &&
              !isChatData &&
              !!(data.name || data.char_name || data.character_name || data.data?.name || data.data?.char_name || data.data?.character_name));

            const isStudioMeta = file.name.toLowerCase() === "studio_meta.json";

            if (isStudioMeta) {
              isMain = false;
            } else if (
              isTheme ||
              isAIPreset ||
              isWorldbook ||
              isQR ||
              isScript ||
              isCharacter
            ) {
              isMain = true;
            } else if (isChatData) {
              if (Array.isArray(data)) {
                isMain = false;
              } else if (data.chat && Array.isArray(data.chat)) {
                data = data.chat;
                isMain = false;
              } else {
                data = [data]; // 对于不标准的聊天记录结构，防止被丢弃，至少包装成数组
                isMain = false;
              }
            } else {
              errorMsg = "非酒馆卡或预设格式：无法识别的数据结构。";
            }
          }
        } else {
          errorMsg = "不支持的文件格式。";
        }
      } catch (err: any) {
        errorMsg = err.message || "未知错误";
      }

      const isChatLog = !isMain && data !== null && Array.isArray(data);
      const isStudioMetaFile = file.name.toLowerCase() === "studio_meta.json";
      const isVersionFile = folder.toLowerCase().split("/").some(p => ["版本历史", "versions", "version_history", "history"].includes(p));

      parsedItems.push({
        file,
        path,
        folder,
        isMain: isVersionFile || isStudioMetaFile ? false : isMain,
        data,
        isImage,
        isChatLog,
        isVersion: isVersionFile,
        isMeta: isStudioMetaFile,
        errorMsg: isMain || isChatLog || isVersionFile || isStudioMetaFile ? undefined : errorMsg,
      });

      setProgress({
        current: i + 1,
        total: files.length,
        message: "正在解析文件...",
      });
    }

    if (endIndex < files.length) {
      setTimeout(
        () =>
          parseChunk(
            files,
            endIndex,
            chunkSize,
            parsedItems,
            errors,
            extractedRoots,
          ),
        0,
      );
    } else {
      assembleAndSave(parsedItems, errors, extractedRoots);
    }
  };

  const assembleAndSave = async (
    parsedItems: ParsedItem[],
    errors: { file: string; error: string }[],
    extractedRoots: string[],
  ) => {
    let mainItems = parsedItems.filter((item) => item.isMain && !item.isVersion && !item.isMeta);
    let altImages = parsedItems.filter(
      (item) => !item.isMain && item.isImage && !item.isChatLog && !item.isVersion && !item.isMeta,
    );
    const chatLogs = parsedItems.filter((item) => item.isChatLog);
    const versionItems = parsedItems.filter((item) => item.isVersion);
    const metaItems = parsedItems.filter((item) => item.isMeta);
    const otherItems = parsedItems.filter(
      (item) => !item.isMain && !item.isImage && !item.isChatLog && !item.isVersion && !item.isMeta,
    );

    // Demote mainItems that are likely alternate avatars or version files
    const itemsToDemote = new Set<ParsedItem>();
    const ALT_FOLDERS = ["替换卡面", "替换头像", "avatars", "alt", "alternate"];
    const VERSION_FOLDERS = ["版本历史", "versions", "version_history", "history"];

    for (const item of mainItems) {
      const folderParts = item.folder.split("/");
      const lastFolder = folderParts[folderParts.length - 1]?.toLowerCase();
      if (ALT_FOLDERS.includes(lastFolder)) {
        itemsToDemote.add(item);
      } else if (VERSION_FOLDERS.includes(lastFolder)) {
        versionItems.push(item);
        itemsToDemote.add(item);
      }
    }

    mainItems = mainItems.filter((item) => !itemsToDemote.has(item));
    for (const item of itemsToDemote) {
      if (item.isImage && !versionItems.includes(item)) {
        altImages.push(item);
      } else if (!versionItems.includes(item)) {
        otherItems.push(item);
      }
    }

    for (const item of otherItems) {
      errors.push({ file: item.file.name, error: item.errorMsg || "无效文件" });
    }

    const altImagesByMain = new Map<ParsedItem, File[]>();
    const unassignedAltImages: ParsedItem[] = [];

    for (const alt of altImages) {
      const possibleMains = mainItems.filter((main) => {
        // ONLY match if the alt image is inside the '替换头像' folder of the main card
        const mainPrefix = main.folder ? main.folder + "/" : "";
        if (alt.folder.startsWith(mainPrefix)) {
          const relative = alt.folder.substring(mainPrefix.length);
          const firstFolder = relative.split("/")[0];
          if (ALT_FOLDERS.includes(firstFolder.toLowerCase())) {
            return true;
          }
        }
        return false;
      });

      possibleMains.sort((a, b) => b.folder.length - a.folder.length);

      if (possibleMains.length > 0) {
        const closestMain = possibleMains[0];
        if (!altImagesByMain.has(closestMain)) {
          altImagesByMain.set(closestMain, []);
        }
        altImagesByMain.get(closestMain)!.push(alt.file);
      } else {
        unassignedAltImages.push(alt);
      }
    }

    // Match historical versions to their main card
    const versionsByMain = new Map<ParsedItem, ParsedItem[]>();
    for (const vItem of versionItems) {
      const possibleMains = mainItems.filter((main) => {
        const mainPrefix = main.folder ? main.folder + "/" : "";
        return vItem.folder.startsWith(mainPrefix) || vItem.folder === main.folder;
      });
      possibleMains.sort((a, b) => b.folder.length - a.folder.length);
      if (possibleMains.length > 0) {
        const closestMain = possibleMains[0];
        if (!versionsByMain.has(closestMain)) {
          versionsByMain.set(closestMain, []);
        }
        versionsByMain.get(closestMain)!.push(vItem);
      }
    }

    // Match studio_meta.json to main card
    const metaByMain = new Map<ParsedItem, any>();
    for (const mItem of metaItems) {
      const possibleMains = mainItems.filter((main) => {
        const mainPrefix = main.folder ? main.folder + "/" : "";
        return mItem.folder.startsWith(mainPrefix) || mItem.folder === main.folder;
      });
      if (possibleMains.length > 0) {
        metaByMain.set(possibleMains[0], mItem.data);
      }
    }

    for (const alt of unassignedAltImages) {
      errors.push({
        file: alt.file.name,
        error: alt.errorMsg || "作为替换卡面导入失败：未找到所属角色卡",
      });
    }

    const charsToSave: CharacterCard[] = [];
    let successCount = 0;

    const { getCachedMeta } = await import("../lib/db");
    const existingMeta = await getCachedMeta();
    const existingImportPathKeys = new Set(
      existingMeta
        .filter((c) => !c.deletedAt && c.autoImportFilename)
        .map((c) => `${c.folderId || ""}/${c.autoImportFilename}`),
    );
    const existingNameCounts = new Map<string, number>();
    for (const meta of existingMeta) {
      if (meta.deletedAt || !meta.name || meta.isTool) continue;
      const key = getSafeFilename(meta.name).toLowerCase();
      existingNameCounts.set(key, (existingNameCounts.get(key) || 0) + 1);
    }
    const newPathsAssigned = new Set<string>();
    const newNameCounts = new Map<string, number>();

    const { initDB } = await import("../lib/db");
    const db = await initDB();
    const existingChars = await db.getAll("characters");
    const autoCategorizedList: Array<{
      cardId: string;
      charName: string;
      folderId: string;
    }> = [];

    for (let i = 0; i < mainItems.length; i++) {
      const item = mainItems[i];
      try {
        let targetFolderId = folderId || undefined;
        let autoClassifiedFolderId: string | null = null;
        let charName = "Unknown";

        let folderParts: string[] = [];
        if (item.folder) {
          folderParts = item.folder.split("/").filter(Boolean);
        }

        const data = item.data;
        const file = item.file;

        // Normalize worldbook entries
        if (data.entries) {
          data.entries = normalizeWorldbookEntries(data.entries);
        } else if (data.data && data.data.entries) {
          data.data.entries = normalizeWorldbookEntries(data.data.entries);
        }

        if (data.character_book && data.character_book.entries) {
          data.character_book.entries = normalizeWorldbookEntries(
            data.character_book.entries,
          );
        }
        if (data.data?.character_book?.entries) {
          data.data.character_book.entries = normalizeWorldbookEntries(
            data.data.character_book.entries,
          );
        }
        if (data.extensions?.character_book?.entries) {
          data.extensions.character_book.entries = normalizeWorldbookEntries(
            data.extensions.character_book.entries,
          );
        }
        if (data.data?.extensions?.character_book?.entries) {
          data.data.extensions.character_book.entries =
            normalizeWorldbookEntries(
              data.data.extensions.character_book.entries,
            );
        }

        const isTheme =
          data.blur_strength !== undefined ||
          data.main_text_color !== undefined ||
          data.chat_display !== undefined;
        const isAIPreset =
          data.temperature !== undefined ||
          data.prompts !== undefined ||
          data.top_p !== undefined;
        const isWorldbook =
          data.entries !== undefined ||
          (data.data && data.data.entries !== undefined);
        const isQR = Array.isArray(data) ? (data.length > 0 && data[0]?.label !== undefined && data[0]?.message !== undefined) : ((data?.quick_replies !== undefined || data?.qrList !== undefined) && data?.spec !== "chara_card_v2" && data?.spec !== "chara_card_v3" && data?.first_mes === undefined && data?.personality === undefined);
            const isScript = data?.type === "script" && data?.content !== undefined && data?.name !== undefined;
        const isCharacter = !isTheme && !isAIPreset && !isWorldbook && !isQR && !isScript && !!(data.name || data.char_name || data.character_name || data.data?.name || data.data?.char_name || data.data?.character_name);


        const path = (file as any).webkitRelativePath || file.name;
        const dir = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";



        let pathPrefix: string[] = [];

        if (isTheme) {
          pathPrefix = ["美化"];
          charName = data.name || file.name.replace(/\.[^/.]+$/, "");
        } else if (isAIPreset) {
          pathPrefix = ["预设"];
          charName = data.name || file.name.replace(/\.[^/.]+$/, "");
        } else if (isWorldbook) {
          pathPrefix = ["世界书"];
          charName =
            data.name || data.data?.name || file.name.replace(/\.[^/.]+$/, "");
        } else if (isQR) {
          pathPrefix = ["快速回复"];
          charName = data.name || file.name.replace(/\.[^/.]+$/, "");
        } else if (isScript) {
          pathPrefix = ["工具区"];
          charName = data.name || file.name.replace(/\.[^/.]+$/, "");
        } else if (isCharacter) {
          charName = data.name || data.char_name || data.character_name || data.data?.name || data.data?.char_name || data.data?.character_name || "Unknown Character";
        }

        if (folderParts.length > 0) {
          // If the zip already has a folder structure, respect it strictly. Do not prepend pathPrefix.
          targetFolderId = await getOrCreateNestedFolder(folderParts, folderId);
        } else if (pathPrefix.length > 0) {
          targetFolderId = await getOrCreateNestedFolder(pathPrefix, folderId);
        } else {
          targetFolderId = folderId || undefined;
          // 若在主页根目录下导入且文件自身未指定子文件夹，检测数据库中是否已有同名且已分配分类文件夹的角色卡
          // 仅当用户开启了「导入同名卡时自动跟随分类」配置时生效
          if (!targetFolderId && isCharacter && autoCategorizeSameName) {
            const cleanName = charName.trim().toLowerCase();
            const existingWithFolder = existingMeta.find(
              (m) =>
                !m.deletedAt &&
                !m.isTool &&
                m.folderId &&
                m.name &&
                m.name.trim().toLowerCase() === cleanName,
            );
            if (existingWithFolder && existingWithFolder.folderId) {
              targetFolderId = existingWithFolder.folderId;
              autoClassifiedFolderId = existingWithFolder.folderId;
            }
          }
        }

        const avatarUrlFallback =
          file.type === "image/png" || file.name.endsWith(".png")
            ? ""
            : getFallbackAvatar(charName);

        let localFilePath: string | undefined;
        let avatarBlob: Blob | undefined;
        let originalFile: File | undefined;

        let pathParts = [...pathPrefix];
        if (folderParts.length > 0) {
          pathParts.push(...folderParts);
        }

        let targetFilePath = file.name;
        if (pathParts.length > 0) {
          targetFilePath = pathParts.join("/") + "/" + file.name;
        }

        const { extractImageTimestamp, extractDateFromCardData } = await import("../lib/fileDate");
        let buffer: ArrayBuffer | null = null;
        try {
          buffer = await file.arrayBuffer();
        } catch (e) {}

        const embeddedDate = extractDateFromCardData(data);
        const imageTimestamp = (buffer && (file.type.startsWith("image/") || file.name.match(/\.(png|jpe?g|webp)$/i)))
          ? extractImageTimestamp(buffer)
          : null;

        const now = Date.now();
        const fileLastMod = file.lastModified;
        const isFreshCacheCopy = fileLastMod && Math.abs(now - fileLastMod) < 120000;

        let authenticModifiedTime: number | undefined;
        if (imageTimestamp) {
          authenticModifiedTime = imageTimestamp;
        } else if (embeddedDate) {
          authenticModifiedTime = embeddedDate;
        } else if (fileLastMod && !isFreshCacheCopy) {
          authenticModifiedTime = fileLastMod;
        } else {
          authenticModifiedTime = fileLastMod || now;
        }

        if (isAndroid()) {
          if ((file as any).androidAbsPath) {
            // Already unzipped natively!
            localFilePath = (file as any).androidAbsPath;
            avatarBlob = undefined;
            originalFile = authenticModifiedTime && buffer && authenticModifiedTime !== file.lastModified
              ? new File([buffer], file.name, { type: file.type || "application/octet-stream", lastModified: authenticModifiedTime })
              : file;
          } else {
            if (file.type === "image/png" || file.name.endsWith(".png")) {
              avatarBlob = file;
            }
            originalFile = authenticModifiedTime && buffer && authenticModifiedTime !== file.lastModified
              ? new File([buffer], file.name, { type: file.type || "application/octet-stream", lastModified: authenticModifiedTime })
              : file;
          }
        } else {
          if (file.type === "image/png" || file.name.endsWith(".png")) {
            avatarBlob = file;
          }
          originalFile = authenticModifiedTime && buffer && authenticModifiedTime !== file.lastModified
            ? new File([buffer], file.name, { type: file.type || "application/octet-stream", lastModified: authenticModifiedTime })
            : file;
        }

        const useCharacterName = isCharacter;
        const baseF = useCharacterName
          ? getSafeFilename(charName)
          : file.name.replace(/\.[^/.]+$/, "");
        let ext = file.name.includes(".")
          ? file.name.substring(file.name.lastIndexOf("."))
          : "";
        const nameKey = useCharacterName ? baseF.toLowerCase() : "";
        let c = useCharacterName
          ? (existingNameCounts.get(nameKey) || 0) +
            (newNameCounts.get(nameKey) || 0)
          : 0;
        let autoImportFilename =
          c === 0 ? `${baseF}${ext}` : `${baseF}_${c}${ext}`;
        let pathKey = `${targetFolderId || ""}/${autoImportFilename}`;
        while (
          existingImportPathKeys.has(pathKey) ||
          newPathsAssigned.has(pathKey)
        ) {
          c++;
          autoImportFilename = `${baseF}_${c}${ext}`;
          pathKey = `${targetFolderId || ""}/${autoImportFilename}`;
        }
        newPathsAssigned.add(pathKey);
        if (useCharacterName) {
          newNameCounts.set(nameKey, (newNameCounts.get(nameKey) || 0) + 1);
        }

        // Assemble version history
        const studioMeta = metaByMain.get(item);
        let versionHistory: any[] = [];
        if (studioMeta && Array.isArray(studioMeta.versionHistory)) {
          versionHistory = studioMeta.versionHistory.map((v: any) => ({ ...v }));
        }

        const assignedVersions = versionsByMain.get(item) || [];
        for (const vItem of assignedVersions) {
          const vName = vItem.file.name.replace(/\.[^/.]+$/, "");
          const existingSnap = versionHistory.find((s: any) => s.id === vName || s.versionName === vName || s.versionName?.includes(vName));
          if (existingSnap) {
            existingSnap.avatarBlob = vItem.file;
            existingSnap.completeCardPngBlob = vItem.file;
            if (!existingSnap.data && vItem.data) {
              existingSnap.data = vItem.data;
            }
          } else {
            versionHistory.push({
              id: crypto.randomUUID(),
              versionName: vName,
              note: "从版本历史归档导入",
              createdAt: vItem.file.lastModified || Date.now(),
              fileModifiedAt: vItem.file.lastModified,
              data: vItem.data || {},
              avatarBlob: vItem.file,
              completeCardPngBlob: vItem.file,
              cardName: (vItem.data?.data?.name || vItem.data?.name || vName),
            });
          }
        }
        versionHistory.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        const newChar: CharacterCard & { autoImportFilename?: string } = {
          id: crypto.randomUUID(),
          name: charName,
          autoImportFilename,
          avatarBlob,
          localFilePath,
          avatarUrlFallback,
          data: data,
          originalFile,
          createdAt: Date.now(),
          fileModifiedAt: authenticModifiedTime,
          folderId: targetFolderId,
          avatarHistory: altImagesByMain.get(item) || [],
          versionHistory: versionHistory.length > 0 ? versionHistory : undefined,
        } as any;

        charsToSave.push(newChar);
        if (autoClassifiedFolderId) {
          autoCategorizedList.push({
            cardId: newChar.id,
            charName,
            folderId: autoClassifiedFolderId,
          });
        }
        successCount++;
      } catch (err: any) {
        errors.push({ file: item.file.name, error: err.message || "未知错误" });
      }

      setProgress({
        current: i + 1,
        total: mainItems.length,
        message: "正在解析数据...",
      });
    }

    if (charsToSave.length > 0) {
      setProgress({
        current: 0,
        total: charsToSave.length,
        message: "正在保存到数据库...",
      });
      await saveCharacters(charsToSave, extractedRoots, (current, total) => {
        setProgress({
          current,
          total,
          message: `正在写入本地数据库... ${current}/${total}`,
        });
      });
    }

    if (chatLogs.length > 0) {
      setProgress({
        current: 0,
        total: chatLogs.length,
        message: "正在保存聊天记录...",
      });
      const allCharsForMatching = [...charsToSave, ...existingChars];

      const chatsToSave: ChatLog[] = [];
      for (const cl of chatLogs) {
        let charId = "";
        const parts = cl.path.split("/");
        const chatIndex = parts.indexOf("聊天记录") !== -1 ? parts.indexOf("聊天记录") : parts.indexOf("chats");
        if (chatIndex > 0) {
          const charName = parts[chatIndex - 1]; // CharacterName
          const { getSafeFilename } = await import("../lib/db");
          const matchedChar = allCharsForMatching.find(
            (c) =>
              getSafeFilename(c.name) === charName ||
              c.name === charName ||
              (c.autoImportFilename &&
                c.autoImportFilename.split("/").pop()?.split(".")[0] ===
                  charName),
          );
          if (matchedChar) charId = matchedChar.id;
        }

        if (!charId && Array.isArray(cl.data)) {
          const aiMessage = cl.data.find(
            (m: any) => !m.is_user && m.name,
          );
          if (aiMessage && aiMessage.name) {
            const match = allCharsForMatching.find(
              (c) =>
                c.name.toLowerCase() === aiMessage.name?.toLowerCase(),
            );
            if (match) charId = match.id;
          }
        }

        const chatName = cl.file.name.replace(/\.[^/.]+$/, "");
        const finalMessages = cl.data.filter((m: any) => m && (m.mes !== undefined || m.text !== undefined || m.is_user !== undefined || m.send_date !== undefined || m.swipes !== undefined)).map((m: any) => {
          const res: any = { ...m };
          if (res.is_user === undefined) res.is_user = res.name !== chatName;
          if (res.send_date === undefined) res.send_date = Date.now();
          if (m.mes !== undefined) res.mes = m.mes;
          else if (m.text !== undefined) res.mes = m.text;
          return res;
        });

        const newChat: ChatLog = {
          id: crypto.randomUUID(),
          characterId: charId,
          name: chatName,
          messages: finalMessages,
          createdAt: cl.file.lastModified || Date.now(),
        };
        chatsToSave.push(newChat);
        successCount++;
      }

      if (chatsToSave.length > 0) {
        const { saveChatsBulk } = await import("../lib/db");
        await saveChatsBulk(chatsToSave, (current, total, phase) => {
          setProgress({
            current,
            total,
            message: phase + ` ${current}/${total}`,
          });
        });
      }
    }

    if (autoCategorizedList.length > 0) {
      const { resolveFolderPath } = await import("../lib/db");
      const folderPathMap = new Map<string, string>();
      for (const item of autoCategorizedList) {
        if (!folderPathMap.has(item.folderId)) {
          const resolved = await resolveFolderPath(item.folderId);
          folderPathMap.set(item.folderId, resolved || "分类文件夹");
        }
      }
      const summaryList = autoCategorizedList.map((item) => ({
        ...item,
        folderPath: folderPathMap.get(item.folderId) || "分类文件夹",
      }));
      setAutoCategorizedSummary(summaryList);
      setImportedSuccessCount(successCount);
    }

    setProgress(null);
    if (errors.length > 0) {
      setImportErrors(errors);
      if (successCount > 0) {
        const { cleanupEmptyFolders } = await import("../lib/db");
        await cleanupEmptyFolders();
        onImported();
        window.dispatchEvent(new CustomEvent("chatsUpdated"));
        window.dispatchEvent(new CustomEvent("charactersUpdated"));
      }
    } else if (successCount === 0) {
      setError("未能成功导入任何文件。");
    } else {
      const { cleanupEmptyFolders } = await import("../lib/db");
      await cleanupEmptyFolders();
      onImported();
      window.dispatchEvent(new CustomEvent("chatsUpdated"));
      window.dispatchEvent(new CustomEvent("charactersUpdated"));
      if (autoCategorizedList.length === 0) {
        onClose();
      }
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    setError(null);
    setImportErrors([]);

    let fileArray: File[] = [];
    let extractedRoots: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.name.endsWith(".zip")) {
        try {
          const zip = await JSZip.loadAsync(f, {
            decodeFileName: function (bytes: any) {
              try {
                return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
              } catch (e) {
                return new TextDecoder("gbk").decode(new Uint8Array(bytes));
              }
            }
          });
          for (const relativePath in zip.files) {
            const zipEntry = zip.files[relativePath];
            if (
              !zipEntry.dir &&
              relativePath.match(/\.(png|jpe?g|webp|gif|json|jsonl|txt|js)$/i)
            ) {
              const arrayBuffer = await zipEntry.async("arraybuffer");

              let type = "application/octet-stream";
              if (relativePath.endsWith(".png")) type = "image/png";
              else if (relativePath.match(/\.jpe?g$/i)) type = "image/jpeg";
              else if (relativePath.endsWith(".webp")) type = "image/webp";
              else if (relativePath.endsWith(".gif")) type = "image/gif";
              else if (relativePath.toLowerCase().endsWith(".json"))
                type = "application/json";
              else if (relativePath.toLowerCase().endsWith(".jsonl"))
                type = "application/json";
              else if (relativePath.toLowerCase().endsWith(".txt"))
                type = "text/plain";
              else if (relativePath.toLowerCase().endsWith(".js"))
                type = "text/javascript";

              const entryDate = zipEntry.date ? zipEntry.date.getTime() : (f.lastModified || Date.now());
              const extractedFile = new File(
                [arrayBuffer],
                zipEntry.name.split("/").pop() || "file",
                { type, lastModified: entryDate },
              );
              // Mock webkitRelativePath to preserve folder structure from ZIP
              Object.defineProperty(extractedFile, "webkitRelativePath", {
                value: relativePath,
                writable: false,
              });
              fileArray.push(extractedFile);
            }
          }
        } catch (e) {
          console.error("Failed to read zip", e);
          setError(`ZIP 文件读取失败: ${f.name}`);
          return;
        }
      } else if (
        f.type.startsWith("image/") ||
        f.name.match(/\.(png|jpe?g|webp|gif)$/i) ||
        f.type === "application/json" ||
        f.name.toLowerCase().endsWith(".json") || f.name.toLowerCase().endsWith(".jsonl") || f.name.toLowerCase().endsWith(".txt") || f.name.toLowerCase().endsWith(".js")
      ) {
        fileArray.push(f);
      }
    }

    if (fileArray.length === 0) {
      setError("未找到有效的图片、JSON 或 ZIP 文件。");
      return;
    }

    setProgress({
      current: 0,
      total: fileArray.length,
      message: "准备导入...",
    });

    // Process in chunks of 50 to avoid blocking UI
    parseChunk(fileArray, 0, 20, [], [], extractedRoots);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (!e.dataTransfer.items) {
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
      return;
    }

    const allFiles: File[] = [];

    const readEntry = async (entry: any, path = "") => {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          entry.file(resolve, reject),
        );
        // Mock webkitRelativePath so processChunk can create folders
        Object.defineProperty(file, "webkitRelativePath", {
          value: path + file.name,
          writable: false,
        });
        allFiles.push(file);
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const readAllEntries = async () => {
          let entries: any[] = [];
          let keepReading = true;
          while (keepReading) {
            const batch = await new Promise<any[]>((resolve, reject) => {
              dirReader.readEntries(resolve, reject);
            });
            if (batch.length > 0) {
              entries = entries.concat(batch);
            } else {
              keepReading = false;
            }
          }
          return entries;
        };
        const entries = await readAllEntries();
        for (const child of entries) {
          await readEntry(child, path + entry.name + "/");
        }
      }
    };

    const promises = [];
    for (let i = 0; i < e.dataTransfer.items.length; i++) {
      const item = e.dataTransfer.items[i];
      if (item.kind === "file") {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          promises.push(readEntry(entry, ""));
        }
      }
    }

    await Promise.all(promises);

    if (allFiles.length > 0) {
      handleFiles(allFiles);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(progress || tavernMode) ? undefined : onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-md bg-slate-900/80 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 shadow-2xl z-[80] text-white max-h-[85vh] flex flex-col"
          >
            <div className="flex justify-between items-center mb-6 shrink-0">
              <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-600">
                {autoCategorizedSummary ? "导入完成" : "导入角色卡"}
              </h2>
              {!progress && (
                <button
                  onClick={onClose}
                  className="p-2 rounded-full hover:bg-white/10 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            {autoCategorizedSummary ? (
              <div className="py-2 flex flex-col flex-1 min-h-0">
                <div className="flex items-center gap-2.5 text-emerald-400 mb-3 shrink-0">
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-white">导入完成</h3>
                    <p className="text-xs text-white/60">共成功导入 {importedSuccessCount} 项卡片/数据</p>
                  </div>
                </div>

                <div className="bg-purple-500/10 border border-purple-500/20 rounded-2xl p-3.5 mb-4 shrink-0">
                  <div className="flex items-center gap-2 text-xs font-semibold text-purple-300 mb-1.5">
                    <Folder className="w-4 h-4 text-purple-400 shrink-0" />
                    <span>检测到同名角色卡，已自动归入已有分类：</span>
                  </div>
                  <p className="text-[11px] text-white/50 mb-2.5">
                    系统匹配到已有同名角色的分类文件夹并已自动整理归类。您可以前往查看，或一键移回主页。
                  </p>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                    {autoCategorizedSummary.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs bg-black/30 p-2.5 rounded-xl border border-white/5">
                        <div className="min-w-0 flex-1 mr-2">
                          <span className="font-medium text-white truncate block">{item.charName}</span>
                          <span className="text-[11px] text-purple-300/80 truncate block mt-0.5">📁 {item.folderPath}</span>
                        </div>
                        {onNavigateFolder && (
                          <button
                            type="button"
                            onClick={() => {
                              onNavigateFolder(item.folderId);
                              setAutoCategorizedSummary(null);
                              onClose();
                            }}
                            className="px-2.5 py-1 text-[11px] bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-lg shrink-0 font-medium transition flex items-center gap-1"
                          >
                            <span>前往文件夹</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2.5 mt-auto pt-2 shrink-0">
                  <button
                    type="button"
                    disabled={isReverting}
                    onClick={async () => {
                      setIsReverting(true);
                      try {
                        const { getCharacter, saveCharacters } = await import("../lib/db");
                        const charsToRevert = [];
                        for (const item of autoCategorizedSummary) {
                          const c = await getCharacter(item.cardId);
                          if (c) {
                            c.folderId = undefined;
                            charsToRevert.push(c);
                          }
                        }
                        if (charsToRevert.length > 0) {
                          await saveCharacters(charsToRevert);
                        }
                        onImported();
                        window.dispatchEvent(new CustomEvent("charactersUpdated"));
                      } catch (e) {
                        console.error("Revert folder failed", e);
                      } finally {
                        setIsReverting(false);
                        setAutoCategorizedSummary(null);
                        onClose();
                      }
                    }}
                    className="flex-1 py-2.5 px-3 bg-white/10 hover:bg-white/15 text-white/80 rounded-xl text-xs sm:text-sm font-medium transition disabled:opacity-50"
                  >
                    {isReverting ? "正在移回..." : "移回主页未分类"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAutoCategorizedSummary(null);
                      onClose();
                    }}
                    className="flex-1 py-2.5 px-3 bg-gradient-to-r from-purple-500 to-pink-500 hover:opacity-95 text-white rounded-xl text-xs sm:text-sm font-medium transition shadow-lg shadow-purple-500/20"
                  >
                    知道了 / 完成
                  </button>
                </div>
              </div>
            ) : tavernMode ? (() => {
  const filteredTavernChars = tavernChars.filter(char => 
    char.name.toLowerCase().includes(tavernSearchQuery.toLowerCase()) || 
    (char.creator_notes && char.creator_notes.toLowerCase().includes(tavernSearchQuery.toLowerCase())) ||
    (char.description && char.description.toLowerCase().includes(tavernSearchQuery.toLowerCase()))
  );
              return (
              <div className="py-2 flex flex-col flex-1 min-h-0 overflow-hidden">
                <div className="flex justify-between items-center mb-3 shrink-0 gap-2">
                   <h3 className="font-bold text-sm sm:text-base truncate">选择要拉取的角色 ({selectedTavernChars.size}/{tavernChars.length})</h3>
                   <div className="flex gap-2">
                     <button onClick={() => setSelectedTavernChars(new Set([...selectedTavernChars, ...filteredTavernChars.map(c => c.avatar)]))} className="text-xs bg-white/5 hover:bg-white/15 border border-white/10 text-white/80 hover:text-white px-3 py-1.5 rounded-lg shrink-0 transition-colors">全选筛选</button>
                     <button onClick={() => setSelectedTavernChars(new Set())} className="text-xs bg-white/5 hover:bg-white/15 border border-white/10 text-white/80 hover:text-white px-3 py-1.5 rounded-lg shrink-0 transition-colors">清空</button>
                   </div>
                </div>
                <div className="relative mb-3 shrink-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                  <input
                    type="text"
                    placeholder="搜索角色名或简介..."
                    value={tavernSearchQuery}
                    onChange={(e) => setTavernSearchQuery(e.target.value)}
                    className="w-full bg-white/5 hover:bg-white/10 focus:bg-white/10 border border-white/10 rounded-xl py-2 pl-9 pr-4 text-sm focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 transition-all placeholder:text-white/30"
                  />
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                   {tavernChars.length === 0 && <p className="text-center text-slate-400 py-10">未找到任何角色，或 API 地址错误。</p>}
                   {tavernChars.length > 0 && filteredTavernChars.length === 0 && <p className="text-center text-slate-400 py-10">没有匹配搜索结果。</p>}
                   {filteredTavernChars.map(char => (
                      <div key={char.avatar} 
                           onClick={() => {
                              const newSet = new Set(selectedTavernChars);
                              if (newSet.has(char.avatar)) newSet.delete(char.avatar);
                              else newSet.add(char.avatar);
                              setSelectedTavernChars(newSet);
                           }}
                           className={`flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-xl cursor-pointer transition-all duration-200 ${selectedTavernChars.has(char.avatar) ? 'bg-purple-500/20 border border-purple-500/50 shadow-[inset_0_0_15px_rgba(168,85,247,0.15)]' : 'bg-white/5 border border-transparent hover:border-white/10 hover:bg-white/10'}`}>
                         <TavernAvatar char={char} aiSettings={getAISettings()} />
                         <div className="flex-1 min-w-0">
                           <div className="font-medium text-sm sm:text-base truncate">{char.name}</div>
                           <div className="text-xs text-white/50 truncate">{char.creator_notes || char.description?.substring(0, 50) || '无简介'}</div>
                         </div>
                         <div className={`w-5 h-5 rounded-md flex items-center justify-center border transition-all duration-200 ${selectedTavernChars.has(char.avatar) ? 'border-purple-400 bg-purple-500 text-white shadow-[0_0_8px_rgba(168,85,247,0.6)]' : 'border-white/20 bg-black/20'}`}>
                           {selectedTavernChars.has(char.avatar) && <CheckCircle className="w-3.5 h-3.5" />}
                         </div>
                      </div>
                   ))}
                </div>
                <div className="flex gap-3 mt-6 shrink-0">
                  <button onClick={() => { setTavernMode(false); setTavernSearchQuery(""); }} className="flex-1 py-3 bg-white/5 hover:bg-white/15 border border-white/10 text-white rounded-xl font-medium transition-colors">
                    返回
                  </button>
                  <button 
                    onClick={pullSelectedTavernChars} 
                    disabled={selectedTavernChars.size === 0}
                    className="flex-1 py-3 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 text-white rounded-xl font-medium transition-all shadow-lg shadow-purple-500/25 disabled:opacity-50 disabled:shadow-none"
                  >
                    拉取已选 ({selectedTavernChars.size})
                  </button>
                </div>
              </div>
              );
            })() : importErrors.length > 0 ? (
              <div className="py-4 flex flex-col max-h-[60vh]">
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex-1 overflow-y-auto">
                  <div className="flex items-center gap-2 text-red-400 mb-3 sticky top-0 bg-slate-900/90 backdrop-blur-sm py-1">
                    <AlertCircle className="w-5 h-5" />
                    <h3 className="font-bold">
                      部分文件导入失败 ({importErrors.length})
                    </h3>
                  </div>
                  <ul className="space-y-2 text-sm text-red-300/80">
                    {importErrors.map((err, i) => (
                      <li
                        key={i}
                        className="flex flex-col bg-black/20 p-2 rounded"
                      >
                        <span className="font-medium text-red-300 truncate">
                          {err.file}
                        </span>
                        <span className="text-xs opacity-80 mt-0.5">
                          {err.error}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <button
                  onClick={() => {
                    setImportErrors([]);
                    onClose();
                  }}
                  className="w-full mt-4 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium transition"
                >
                  关闭
                </button>
              </div>
            ) : progress ? (
              <div className="py-8 flex flex-col items-center">
                <div className="w-16 h-16 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-4" />
                <p className="text-lg font-medium text-center">
                  {progress.message || "导入中..."}
                </p>
                <p className="text-slate-400 text-center tabular-nums">
                  {progress.current} / {progress.total}
                </p>
                <div className="w-full bg-white/10 rounded-full h-2 mt-4 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all duration-300"
                    style={{
                      width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ) : (
              <>
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-colors ${
                    isDragging
                      ? "border-purple-500 bg-purple-500/10"
                      : "border-white/20 hover:border-white/40 hover:bg-white/5"
                  }`}
                >
                  <UploadCloud
                    className={`w-12 h-12 mb-4 ${isDragging ? "text-purple-400" : "text-slate-400"}`}
                  />
                  <p className="text-center font-medium mb-1">
                    点击上传或拖拽文件到此处
                  </p>
                  <p className="text-center text-sm text-slate-400">
                    支持多个 PNG/JSON 格式，或包含文件夹结构的 ZIP 压缩包
                  </p>

                  <div className="flex gap-4 mt-6 text-slate-500">
                    <div className="flex items-center gap-1 text-xs">
                      <ImageIcon className="w-4 h-4" /> PNG
                    </div>
                    <div className="flex items-center gap-1 text-xs">
                      <FileJson className="w-4 h-4" /> JSON
                    </div>
                    <div className="flex items-center gap-1 text-xs">
                      <FileArchive className="w-4 h-4" /> ZIP
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between px-1 text-xs text-white/70 [.light-theme_&]:text-slate-600">
                  <div
                    onClick={() => {
                      const next = !autoCategorizeSameName;
                      setAutoCategorizeSameName(next);
                      localStorage.setItem("miu_auto_categorize_same_name", next ? "true" : "false");
                    }}
                    className="flex items-center gap-2.5 cursor-pointer select-none hover:text-white [.light-theme_&]:hover:text-slate-900 transition py-1"
                  >
                    <div
                      className={`w-4 h-4 rounded flex items-center justify-center border transition shrink-0 ${
                        autoCategorizeSameName
                          ? "bg-purple-600 border-purple-500 text-white shadow-sm shadow-purple-500/30"
                          : "border-white/30 bg-black/30 [.light-theme_&]:border-black/20 [.light-theme_&]:bg-white"
                      }`}
                    >
                      {autoCategorizeSameName && <Check className="w-3 h-3 text-white stroke-[2.5]" />}
                    </div>
                    <span className="font-medium text-xs">导入同名卡自动归入已有分类文件夹</span>
                  </div>
                </div>

                {isAndroid() && (
                  <div className="mt-4 w-full flex justify-center">
                    <button 
                      onClick={(e) => { e.stopPropagation(); fetchTavernList(); }}
                      disabled={isPulling}
                      className="flex items-center gap-2 px-6 py-3.5 bg-gradient-to-r from-purple-500/10 to-pink-500/10 hover:from-purple-500/20 hover:to-pink-500/20 text-purple-400 rounded-xl font-medium transition-all duration-300 disabled:opacity-50 w-full justify-center border border-purple-500/30 hover:border-purple-400/50 shadow-lg shadow-purple-500/10 hover:shadow-purple-500/20"
                    >
                      {isPulling ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" /> : <Cloud className="w-5 h-5 shrink-0" />}
                      <span className="truncate">拉取酒馆卡片</span>
                    </button>
                  </div>
                )}

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 p-3 bg-red-500/20 border border-red-500/30 rounded-xl text-red-400 text-sm"
                  >
                    {error}
                  </motion.div>
                )}
              </>
            )}

            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
              accept=".png,.jpg,.jpeg,.webp,.gif,.json,.jsonl,.txt,.js,.zip,application/json,application/zip,application/x-zip-compressed,text/plain,text/javascript"
              className="hidden"
              multiple
            />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
