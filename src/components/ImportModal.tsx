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
  CheckCircle2,
  Check,
  Search,
  Folder,
  ArrowRight,
  Loader2,
  RefreshCw,
  Globe,
  Database,
  Terminal,
  RotateCcw,
  Sparkles,
  FileText,
} from "lucide-react";
import { extractTavernData, parsePayload } from "../lib/png";
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
  getCharacterCategoryPrefix,
  CardVersionSnapshot,
} from "../lib/db";
import { normalizeWorldbookEntries } from "../lib/worldbook";
import { parseTavernCard } from "../types/tavern";
import { isAndroid, saveToGallery } from "../lib/appBridge";
import { getAISettings, normalizeSillyTavernUrl, getSillyTavernAuthHeaders } from "../lib/ai";
import JSZip from "jszip";
import { useInView } from "../lib/useInView";
import { getCharacterTokenBreakdown, formatTokenCount, CharacterTokenBreakdown } from "../lib/tokens";
import { TokenBreakdownModal } from "./TokenBreakdownModal";
import { withReadSlot } from "../lib/thumbCache";

const tavernAvatarCache = new Map<string, string>();

const ALT_FOLDERS = ["替换卡面", "替换头像", "avatars", "alt", "alternate"];
const VERSION_FOLDERS = ["版本历史", "versions", "version_history", "history"];

const SYSTEM_CONTAINER_BUCKETS = [
  "角色卡", "角色卡片", "角色卡包", "角色卡片包", "角色包", "角色", "卡包", "卡片", "角包",
  "characters", "cards", "character", "card",
  "工具区", "工具包", "工具", "tools", "presets", "预设", "世界书", "world_info",
  "聊天记录", "聊天", "chats", "chat",
  "回收站", "trash",
  "tavern_export", "miu_backup", "miu_autobackup", "chats_export", "backup", "backups", "export", "exports",
  "sillytavern", "aitavern", "aitavern_backups"
];

function isSystemContainerName(name: string): boolean {
  if (!name) return true;
  const clean = name.trim().toLowerCase().replace(/[\-_0-9\s\(\)（）\.]/g, "");
  if (!clean) return true;
  if (SYSTEM_CONTAINER_BUCKETS.includes(clean)) return true;
  return /^(角色卡|角色卡片|角色卡包|角色包|卡包|卡片|工具区|工具包|聊天记录|Tavern_Export|MIU_Backup|MIU_AutoBackup|chats_export|backup|export|cards|characters|sillytavern|aitavern)[\-_0-9A-Za-z_卷\s\(\)（）]*/i.test(name.trim());
}

function stripSystemContainerBucketParts(parts: string[]): string[] {
  let res = [...parts];
  while (res.length > 0 && isSystemContainerName(res[0])) {
    res.shift();
  }
  return res;
}

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
  toolPrefix?: string[];
  errorMsg?: string;
}

export function TavernAvatar({ char, aiSettings, className = "w-12 h-12 sm:w-14 sm:h-14 rounded-2xl object-cover shrink-0 shadow-xs" }: { char: any, aiSettings: any, className?: string }) {
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
      className={className}
      alt={char.name}
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

  const [isLightMode, setIsLightMode] = useState(() => {
    return (
      document.documentElement.classList.contains("light-theme") ||
      localStorage.getItem("tavern_theme") === "light"
    );
  });

  useEffect(() => {
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
  }, []);

  const [autoCategorizeSameName, setAutoCategorizeSameName] = useState<boolean>(
    () => localStorage.getItem("miu_auto_categorize_same_name") !== "false",
  );
  const [autoCategorizedSummary, setAutoCategorizedSummary] = useState<
    Array<{
      cardId: string;
      charName: string;
      folderId: string;
      folderPath: string;
      breakdown?: CharacterTokenBreakdown;
      isTool?: boolean;
    }> | null
  >(null);
  const [importTokenSummary, setImportTokenSummary] = useState<{
    totalTokens: number;
    items: Array<{
      cardId: string;
      charName: string;
      folderId?: string;
      folderPath: string;
      avatarBlob?: Blob;
      avatarUrlFallback?: string;
      breakdown: CharacterTokenBreakdown;
      attachedChatsCount: number;
      attachedAvatarsCount: number;
      isTool?: boolean;
    }>;
  } | null>(null);
  const [tokenSearchQuery, setTokenSearchQuery] = useState("");
  const [selectedTokenBreakdown, setSelectedTokenBreakdown] = useState<{
    name: string;
    breakdown: CharacterTokenBreakdown;
  } | null>(null);

  const [importedSuccessCount, setImportedSuccessCount] = useState(0);
  const [isReverting, setIsReverting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setAutoCategorizedSummary(null);
      setImportTokenSummary(null);
      setSelectedTokenBreakdown(null);
      setTokenSearchQuery("");
    }
  }, [isOpen]);

  const [tavernMode, setTavernMode] = useState<boolean>(false);
  const [tavernChars, setTavernChars] = useState<any[]>([]);
  const [selectedTavernChars, setSelectedTavernChars] = useState<Set<string>>(new Set());
  const [isPulling, setIsPulling] = useState(false);
  const [tavernSearchQuery, setTavernSearchQuery] = useState("");
  const [pullLogs, setPullLogs] = useState<string[]>([]);
  const [currentPullChar, setCurrentPullChar] = useState<{ name: string; avatar: any } | null>(null);

  const addPullLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setPullLogs(prev => [`[${time}] ${msg}`, ...prev.slice(0, 19)]);
  };

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
    setPullLogs([]);
    setCurrentPullChar(null);
    addPullLog(`正在与酒馆服务器发起连接: ${stUrl}`);
    setProgress({ current: 0, total: 0, message: "正在连接酒馆并获取角色列表..." });

    try {
      const headers = getSillyTavernAuthHeaders(aiSettings);

      const androidBridge = (window as any).Android;
      if (isAndroid() && androidBridge && typeof androidBridge.fetchTavernCharListLite === 'function') {
        try {
          addPullLog("检测到 Android 环境，使用原生轻量传输解析角色索引...");
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
                addPullLog(`获取成功！共加载 ${nativeList.length} 个酒馆角色`);
                setProgress(null);
                return;
              }
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

      let reachable = false;
      let connectError = "";
      for (const testUrl of [`${stUrl}/csrf-token`, `${stUrl}/version`, `${stUrl}/`]) {
        try {
          const testRes = await fetchWithTimeout(testUrl, { headers }, 8000);
          reachable = Boolean(testRes);
          if (reachable) break;
        } catch (e: any) {
          connectError = e?.message || String(e);
        }
      }
      if (!reachable) {
        throw new Error(`无法连接酒馆 ${stUrl}（${connectError || "网络请求失败"}）。请确认 Termux 中酒馆已启动、端口正确，并且地址以 http:// 开头`);
      }

      addPullLog("连通性校验成功，请求角色全量清单...");
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
      addPullLog(`加载成功！共有 ${validChars.length} 张可用角色卡`);
      setProgress(null);
    } catch (e: any) {
      setError(`获取列表失败: ${e.message}`);
      addPullLog(`获取失败: ${e.message}`);
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

    setIsPulling(true);
    setPullLogs([]);
    addPullLog(`开始批量拉取 ${charsToFetch.length} 张角色卡...`);
    setProgress({ current: 0, total: charsToFetch.length, message: `正在下载角色卡 (0/${charsToFetch.length})...` });

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
        setCurrentPullChar({ name: char.name, avatar: char });
        addPullLog(`正在下载 [${index + 1}/${charsToFetch.length}]: ${char.name}`);

        try {
          const res = await fetch(`${stUrl}/characters/${encodeURIComponent(char.avatar)}`, { headers });
          if (res.ok) {
            const blob = await res.blob();
            const file = new File([blob], char.avatar, { type: blob.type || 'image/png' });
            files[index] = file;
            addPullLog(`√ 下载完成: ${char.name}`);
          } else {
            lastDownloadError = `HTTP ${res.status}`;
            addPullLog(`× 下载失败: ${char.name} (HTTP ${res.status})`);
          }
        } catch (e: any) {
          lastDownloadError = e?.message || String(e);
          addPullLog(`× 下载出错: ${char.name} (${lastDownloadError})`);
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

    const downloadedFiles = files.filter(Boolean);
    if (downloadedFiles.length > 0) {
      addPullLog(`数据传输完成！共获取到 ${downloadedFiles.length} 个有效卡片包，正在解析整理保存...`);
      setProgress({ current: downloadedFiles.length, total: downloadedFiles.length, message: "正在解析并保存角色卡到本地档案库..." });
      await handleFiles(downloadedFiles);
    } else {
      setError(`下载失败，未获取到任何卡片。${lastDownloadError ? `（${lastDownloadError}）` : ""}`);
    }
    setIsPulling(false);
  };

  useEffect(() => {
    if (isOpen) {
      setProgress(null);
      setImportErrors([]);
      setError(null);
      if (initialFiles && !initialFilesHandled.current) {
        initialFilesHandled.current = true;
        handleFiles(initialFiles);
      }
    } else {
      initialFilesHandled.current = false;
    }
  }, [isOpen, initialFiles]);

  const initialFilesHandled = useRef(false);

  const getOrCreateNestedFolder = async (
    pathParts: string[],
    startParentId?: string | null,
  ): Promise<string | undefined> => {
    if (pathParts.length === 0) return startParentId || undefined;
    const folders = await getFolders();
    let currentParentId = startParentId || undefined;

    for (const folderName of pathParts) {
      const existing = folders.find(
        (f) =>
          f.name.toLowerCase() === folderName.toLowerCase() &&
          (f.parentId || undefined) === (currentParentId || undefined),
      );

      if (existing) {
        currentParentId = existing.id;
      } else {
        const newFolder: DBFolder = {
          id: `folder_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          name: folderName,
          parentId: currentParentId,
          sortOrder: 0,
          createdAt: Date.now(),
        };
        await saveFolder(newFolder);
        folders.push(newFolder);
        currentParentId = newFolder.id;
      }
    }

    return currentParentId;
  };

  const handleFiles = async (
    fileList: FileList | File[],
    targetFolderId?: string | null,
  ) => {
    setError(null);
    setImportErrors([]);
    const fileArray = Array.from(fileList);
    if (fileArray.length === 0) return;

    setProgress({
      current: 0,
      total: fileArray.length,
      message: "正在准备解析文件...",
    });

    const parsedItems: ParsedItem[] = [];
    const errors: { file: string; error: string }[] = [];
    const extractedRoots = new Map<
      string,
      {
        folderId: string;
        chars: ParsedItem[];
        others: ParsedItem[];
      }
    >();

    const progressTracker = {
      current: 0,
      total: fileArray.length,
    };

    const parseFiles = async (
      items: File[],
      accumulatedParsed: ParsedItem[],
      accumulatedErrors: { file: string; error: string }[],
      extractedRootsMap: Map<
        string,
        {
          folderId: string;
          chars: ParsedItem[];
          others: ParsedItem[];
        }
      >,
    ): Promise<void> => {
      for (let i = 0; i < items.length; i++) {
        progressTracker.current++;

        if (progressTracker.current % 10 === 0 || progressTracker.current === progressTracker.total) {
          setProgress({
            current: progressTracker.current,
            total: progressTracker.total,
            message: `正在解析文件 (${progressTracker.current}/${progressTracker.total})...`,
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        const file = items[i];
        const fullPath = file.webkitRelativePath || file.name;
        const normalizedPath = fullPath.replace(/\\/g, "/");
        const pathSegments = normalizedPath.split("/");

        let folderName = "";
        let fileName = normalizedPath;
        if (pathSegments.length > 1) {
          folderName = pathSegments.slice(0, -1).join("/");
          fileName = pathSegments[pathSegments.length - 1];
        }

        const ext = fileName.split(".").pop()?.toLowerCase();
        const folderSegments = folderName
          .split("/")
          .map((p) => p.trim().toLowerCase())
          .filter(Boolean);
        const lastFolder = folderSegments[folderSegments.length - 1] || "";
        const inVersionFolder = folderSegments.some((p) =>
          VERSION_FOLDERS.includes(p),
        );
        const inAltFolder =
          folderSegments.some((p) => ALT_FOLDERS.includes(p)) ||
          /^(替换头像|替换卡面|avatar|alt)[\-_0-9]*/i.test(fileName);
        const isStudioMetaFile = fileName.toLowerCase() === "studio_meta.json";

        try {
          if (ext === "zip") {
            setProgress({
              current: Math.min(progressTracker.current, progressTracker.total),
              total: progressTracker.total,
              message: `正在读取 ZIP 数据包...`,
            });
            const zipContent = await JSZip.loadAsync(file, {
              decodeFileName: function (bytes: any) {
                try {
                  return new TextDecoder("utf-8", { fatal: true }).decode(
                    new Uint8Array(bytes),
                  );
                } catch {
                  return new TextDecoder("gbk").decode(new Uint8Array(bytes));
                }
              },
            });
            const rawRootName = fileName.replace(/\.zip$/i, "").trim();
            const isExportArchiveName = isSystemContainerName(rawRootName);

            const fileEntries = Object.entries(zipContent.files).filter(
              ([relPath, entry]) => {
                if (entry.dir) return false;
                const clean = relPath.replace(/\\/g, "/");
                if (clean.includes("__MACOSX")) return false;
                if (clean.split("/").some((p) => p.startsWith(".") || p === "Thumbs.db" || p === "desktop.ini")) return false;
                return true;
              }
            );

            // 检查压缩包内本身是否已经带有分类目录层级
            const hasInternalFolders = fileEntries.some(([relPath]) => {
              const clean = relPath.replace(/\\/g, "/");
              return clean.includes("/");
            });

            // 永远不把 ZIP 压缩包的包名强制作为最外层新建文件夹，直接将其内容直接还原/解压到当前分类或对应子文件夹中
            const shouldCreateRootFolder = false;
            const rootFolderName = "";

            const zipFiles: File[] = [];
            const BATCH_SIZE = 15;
            for (let b = 0; b < fileEntries.length; b += BATCH_SIZE) {
              const chunk = fileEntries.slice(b, b + BATCH_SIZE);
              await Promise.all(
                chunk.map(async ([relativePath, zipEntry]) => {
                  let cleanPath = relativePath.replace(/\\/g, "/");

                  let cleanSegments = cleanPath.split("/").filter(Boolean);
                  // 自动剥离与压缩包同名的最外层包裹文件夹 (如 "试验品/card1.png" -> "card1.png")
                  if (cleanSegments.length > 1 && cleanSegments[0].toLowerCase().trim() === rawRootName.toLowerCase().trim()) {
                    cleanSegments = cleanSegments.slice(1);
                  }

                  // 自动剥离压缩包内部嵌套的顶层大类/容器包名 (如 "角色卡/日常/猫娘.png" -> "日常/猫娘.png")
                  const strippedSegments = stripSystemContainerBucketParts(cleanSegments);
                  if (strippedSegments.length > 0) {
                    cleanPath = strippedSegments.join("/");
                  }

                  const blob = await zipEntry.async("blob");
                  const zipFileName = cleanPath.split("/").pop() || "file";
                  const lowerZipName = zipFileName.toLowerCase();
                  let zipFileType = blob.type || "application/octet-stream";
                  if (lowerZipName.endsWith(".png")) zipFileType = "image/png";
                  else if (/\.jpe?g$/.test(lowerZipName)) zipFileType = "image/jpeg";
                  else if (lowerZipName.endsWith(".webp")) zipFileType = "image/webp";
                  else if (lowerZipName.endsWith(".gif")) zipFileType = "image/gif";
                  else if (lowerZipName.endsWith(".json")) zipFileType = "application/json";
                  else if (lowerZipName.endsWith(".jsonl")) zipFileType = "application/json";
                  else if (lowerZipName.endsWith(".txt")) zipFileType = "text/plain";
                  else if (lowerZipName.endsWith(".js")) zipFileType = "text/javascript";

                  const entryDate = zipEntry.date
                    ? zipEntry.date.getTime()
                    : file.lastModified || Date.now();
                  const extractedFile = new File([blob], zipFileName, {
                    type: zipFileType,
                    lastModified: entryDate,
                  });
                  (extractedFile as any).__miuFromZip = true;

                  const simulatedPath = rootFolderName ? `${rootFolderName}/${cleanPath}` : cleanPath;
                  Object.defineProperty(extractedFile, "webkitRelativePath", {
                    value: simulatedPath,
                    writable: false,
                  });

                  zipFiles.push(extractedFile);
                })
              );

              const doneCount = Math.min(b + BATCH_SIZE, fileEntries.length);
              setProgress({
                current: doneCount,
                total: fileEntries.length,
                message: `正在解压归档卡片文件 (${doneCount}/${fileEntries.length})...`,
              });
              await new Promise((resolve) => setTimeout(resolve, 0));
            }

            if (zipFiles.length > 0) {
              progressTracker.total = zipFiles.length;
              progressTracker.current = 0;

              await parseFiles(
                zipFiles,
                accumulatedParsed,
                accumulatedErrors,
                extractedRootsMap,
              );
            }
            continue;
          }

          // ---------- 图片（PNG / WebP / JPEG 内嵌角色卡，GIF 仅作替换头像） ----------
          if (["png", "webp", "jpeg", "jpg", "gif"].includes(ext || "")) {
            let cardData: any = null;
            if (ext !== "gif") {
              const arrayBuffer = await file.arrayBuffer();
              cardData = await extractTavernData(arrayBuffer);
            }

            if (cardData) {
              accumulatedParsed.push({
                file,
                path: normalizedPath,
                folder: folderName,
                isMain: !inVersionFolder && !inAltFolder,
                data: cardData,
                isImage: true,
                isVersion: inVersionFolder || undefined,
              });
              continue;
            }

            accumulatedParsed.push({
              file,
              path: normalizedPath,
              folder: folderName,
              isMain: false,
              isImage: true,
              isVersion: inVersionFolder || undefined,
              errorMsg:
                inAltFolder || inVersionFolder || items.length > 1
                  ? undefined
                  : "未找到内嵌的酒馆角色数据",
            });
            continue;
          }

          // ---------- 文本 / JSON 文件 ----------
          if (["json", "jsonl", "txt", "js"].includes(ext || "")) {
            const text = await file.text();

            if (ext === "jsonl") {
              const parsedMessages: any[] = [];
              for (const line of text.split("\n")) {
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;
                try {
                  const p = JSON.parse(trimmedLine);
                  if (p) parsedMessages.push(p);
                } catch {}
              }
              const { sanitizeChatMessages } = await import("../lib/chatParse");
              const sanitized = sanitizeChatMessages(parsedMessages);
              if (sanitized.isChat) {
                accumulatedParsed.push({
                  file,
                  path: normalizedPath,
                  folder: folderName,
                  isMain: false,
                  isImage: false,
                  isChatLog: true,
                  data: sanitized.messages,
                });
              } else {
                accumulatedParsed.push({
                  file,
                  path: normalizedPath,
                  folder: folderName,
                  isMain: false,
                  isImage: false,
                  errorMsg: "无效的聊天记录文件。",
                });
              }
              continue;
            }

            if (ext === "txt") {
              const { parseTextChatLog } = await import("../lib/chatParse");
              const parsedText = parseTextChatLog(
                text,
                fileName.replace(/\.[^/.]+$/, ""),
              );
              if (parsedText.isChat) {
                accumulatedParsed.push({
                  file,
                  path: normalizedPath,
                  folder: folderName,
                  isMain: false,
                  isImage: false,
                  isChatLog: true,
                  data: parsedText.messages,
                });
              } else {
                accumulatedParsed.push({
                  file,
                  path: normalizedPath,
                  folder: folderName,
                  isMain: false,
                  isImage: false,
                  data: {
                    type: "script",
                    name: fileName.replace(/\.[^/.]+$/, ""),
                    content: text,
                  },
                  toolPrefix: ["工具区"],
                });
              }
              continue;
            }

            if (ext === "js") {
              accumulatedParsed.push({
                file,
                path: normalizedPath,
                folder: folderName,
                isMain: false,
                isImage: false,
                data: {
                  type: "script",
                  name: fileName.replace(/\.[^/.]+$/, ""),
                  content: text,
                },
                toolPrefix: ["工具区"],
              });
              continue;
            }

            let parsedJson: any = null;
            try {
              parsedJson = JSON.parse(text);
            } catch {
              const jsonMatch = text.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                try {
                  parsedJson = JSON.parse(jsonMatch[0]);
                } catch {}
              }
            }

            if (parsedJson !== null && parsedJson !== undefined) {
              const isChatData = Array.isArray(parsedJson)
                ? parsedJson.some(
                    (m: any) =>
                      m &&
                      (m.mes !== undefined ||
                        m.text !== undefined ||
                        m.is_user !== undefined ||
                        m.send_date !== undefined),
                  )
                : !!(
                    parsedJson.chat &&
                    Array.isArray(parsedJson.chat) &&
                    !parsedJson.name &&
                    !parsedJson.char_name &&
                    !parsedJson.character_name &&
                    !parsedJson.data?.name &&
                    !parsedJson.data?.char_name &&
                    !parsedJson.data?.character_name
                  );

              if (
                Array.isArray(parsedJson) &&
                parsedJson.length > 0 &&
                !isChatData &&
                (parsedJson[0]?.name || parsedJson[0]?.data?.name)
              ) {
                for (const cardItem of parsedJson) {
                  accumulatedParsed.push({
                    file,
                    path: normalizedPath,
                    folder: folderName,
                    isMain: !inVersionFolder,
                    data: cardItem,
                    isImage: false,
                    isVersion: inVersionFolder || undefined,
                  });
                }
                continue;
              }

              const isCharacterJson = isActualCharacterCard(parsedJson);
              const detectedCategory = isCharacterJson
                ? "未归类"
                : getCharacterCategoryPrefix({ data: parsedJson });
              const looksLikeCharacter = Boolean(
                parsedJson.name ||
                  parsedJson.char_name ||
                  parsedJson.character_name ||
                  parsedJson.data?.name ||
                  parsedJson.data?.char_name ||
                  parsedJson.data?.character_name,
              );

              if (isStudioMetaFile) {
                accumulatedParsed.push({
                  file,
                  path: normalizedPath,
                  folder: folderName,
                  isMain: false,
                  isImage: false,
                  isMeta: true,
                  data: parsedJson,
                });
              } else if (isCharacterJson) {
                accumulatedParsed.push({
                  file,
                  path: normalizedPath,
                  folder: folderName,
                  isMain: !inVersionFolder,
                  data: parsedJson,
                  isImage: false,
                  isVersion: inVersionFolder || undefined,
                });
              } else if (detectedCategory !== "未归类") {
                accumulatedParsed.push({
                  file,
                  path: normalizedPath,
                  folder: folderName,
                  isMain: false,
                  isImage: false,
                  data: parsedJson,
                  toolPrefix: [
                    detectedCategory === "脚本" ? "工具区" : detectedCategory,
                  ],
                });
              } else if (looksLikeCharacter && !isChatData) {
                accumulatedParsed.push({
                  file,
                  path: normalizedPath,
                  folder: folderName,
                  isMain: !inVersionFolder,
                  data: parsedJson,
                  isImage: false,
                  isVersion: inVersionFolder || undefined,
                });
              } else if (isChatData) {
                accumulatedParsed.push({
                  file,
                  path: normalizedPath,
                  folder: folderName,
                  isMain: false,
                  isImage: false,
                  isChatLog: true,
                  data: Array.isArray(parsedJson) ? parsedJson : parsedJson.chat,
                });
              } else {
                accumulatedParsed.push({
                  file,
                  path: normalizedPath,
                  folder: folderName,
                  isMain: false,
                  isImage: false,
                  errorMsg: "非酒馆卡或预设格式：无法识别的数据结构。",
                });
              }
              continue;
            }

            accumulatedParsed.push({
              file,
              path: normalizedPath,
              folder: folderName,
              isMain: false,
              isImage: false,
              errorMsg: "未找到有效角色数据",
            });
            continue;
          }

          accumulatedParsed.push({
            file,
            path: normalizedPath,
            folder: folderName,
            isMain: false,
            isImage: false,
            errorMsg: `不支持的文件格式: .${ext}`,
          });
        } catch (err: any) {
          accumulatedErrors.push({
            file: fileName,
            error: err.message || "解析失败",
          });
        }

      }
    };

    // Await complete parsing of all files and zip archives
    await parseFiles(fileArray, parsedItems, errors, extractedRoots);

    // Proceed with importing all parsed items
    await processImport(
      parsedItems,
      errors,
      extractedRoots,
      targetFolderId,
    );
  };
    const processImport = async (
      items: ParsedItem[],
      initialErrors: { file: string; error: string }[],
      extractedRootsMap: Map<
        string,
        {
          folderId: string;
          chars: ParsedItem[];
          others: ParsedItem[];
        }
      >,
      targetFolderId?: string | null,
    ) => {
      setProgress({
        current: items.length,
        total: items.length,
        message: "正在归类与保存角色数据...",
      });

      const errors = [...initialErrors];
      for (const item of items) {
        // 图片类错误在下方「替换卡面」归属阶段统一处理，避免同一文件重复报错
        if (
          item.errorMsg &&
          !item.isImage &&
          !item.isVersion &&
          !item.isMeta &&
          !item.isChatLog
        ) {
          errors.push({ file: item.file.name, error: item.errorMsg });
        }
      }

      let mainItems = items.filter(
        (item) => item.isMain && item.data && !item.isVersion && !item.isMeta,
      );
      const altImages = items.filter(
        (item) =>
          !item.isMain &&
          item.isImage &&
          !item.isChatLog &&
          !item.isVersion &&
          !item.isMeta,
      );
      const chatLogs = items.filter(
        (item) => item.isChatLog && Array.isArray(item.data),
      );
      const toolItems = items.filter((item) => (item.toolPrefix || []).length > 0);
      const metaItems = items.filter((item) => item.isMeta);
      const versionItems = items.filter((item) => item.isVersion);

      // 位于「替换头像 / 替换卡面」或「版本历史」文件夹中的卡片 / 图片需从主卡列表降级
      const itemsToDemote: ParsedItem[] = [];
      for (const item of mainItems) {
        const folderParts = item.folder
          .split("/")
          .map((p) => p.trim().toLowerCase())
          .filter(Boolean);
        const inAlt =
          folderParts.some((p) => ALT_FOLDERS.includes(p)) ||
          /^(替换头像|替换卡面|avatar|alt)[\-_0-9]*/i.test(item.file.name);
        const inVer = folderParts.some((p) => VERSION_FOLDERS.includes(p));
        if (inAlt) {
          itemsToDemote.push(item);
        } else if (inVer) {
          versionItems.push(item);
          itemsToDemote.push(item);
        }
      }
      if (itemsToDemote.length > 0) {
        mainItems = mainItems.filter((item) => !itemsToDemote.includes(item));
        for (const item of itemsToDemote) {
          if (item.isImage && !versionItems.includes(item)) {
            altImages.push(item);
          }
        }
      }

      const altImagesByMain = new Map<ParsedItem, File[]>();
      for (const alt of altImages) {
        const possibleMains = mainItems.filter((main) => {
          const mainPrefix = main.folder ? main.folder + "/" : "";
          if (alt.folder.startsWith(mainPrefix)) {
            const relative = alt.folder.substring(mainPrefix.length);
            const firstFolder = (relative.split("/")[0] || "").toLowerCase();
            if (ALT_FOLDERS.includes(firstFolder) || relative === "") {
              return true;
            }
          }
          const altFolderParts = alt.folder.split("/").map((p) => p.trim().toLowerCase()).filter(Boolean);
          if (altFolderParts.length > 0 && ALT_FOLDERS.includes(altFolderParts[altFolderParts.length - 1])) {
            const altParent = altFolderParts.slice(0, -1).join("/");
            const mainFolderClean = main.folder.split("/").map((p) => p.trim().toLowerCase()).filter(Boolean).join("/");
            if (altParent === mainFolderClean) return true;
          }
          if (main.folder && alt.folder && alt.folder.startsWith(main.folder)) {
            return true;
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
          errors.push({
            file: alt.file.name,
            error: alt.errorMsg || "作为替换卡面导入失败：未找到所属角色卡",
          });
        }
      }

      const versionsByMain = new Map<ParsedItem, ParsedItem[]>();
      for (const versionItem of versionItems) {
        const possibleMains = mainItems.filter((main) => {
          const mainPrefix = main.folder ? main.folder + "/" : "";
          return (
            versionItem.folder.startsWith(mainPrefix) ||
            versionItem.folder === main.folder
          );
        });
        possibleMains.sort((a, b) => b.folder.length - a.folder.length);
        if (possibleMains.length > 0) {
          const closestMain = possibleMains[0];
          if (!versionsByMain.has(closestMain)) {
            versionsByMain.set(closestMain, []);
          }
          versionsByMain.get(closestMain)!.push(versionItem);
        }
      }

      const metaByMain = new Map<ParsedItem, any>();
      for (const metaItem of metaItems) {
        const possibleMains = mainItems.filter((main) => {
          const mainPrefix = main.folder ? main.folder + "/" : "";
          return (
            metaItem.folder.startsWith(mainPrefix) ||
            metaItem.folder === main.folder
          );
        });
        possibleMains.sort((a, b) => b.folder.length - a.folder.length);
        if (possibleMains.length > 0) {
          metaByMain.set(possibleMains[0], metaItem.data);
        }
      }

      if (
        mainItems.length === 0 &&
        toolItems.length === 0 &&
        chatLogs.length === 0
      ) {
        setProgress(null);
        if (errors.length > 0) {
          setImportErrors(errors);
        } else {
          setError("所选文件未解析到任何有效角色数据");
        }
        return;
      }

      try {
        const {
          getCharacters,
          getFolders,
          getCachedMeta,
          saveChatsBulk,
          cleanupEmptyFolders,
        } = await import("../lib/db");
        const { characters: existingChars } = await getCharacters(1, 10000);
        const existingFolders = await getFolders();
        const existingMeta = await getCachedMeta();
        const { extractImageTimestamp, extractDateFromCardData } = await import(
          "../lib/fileDate"
        );

        const sameNameAutoSummary: Array<{
          cardId: string;
          charName: string;
          folderId: string;
          folderPath: string;
          breakdown?: CharacterTokenBreakdown;
        }> = [];

        const findFolderPath = (fId: string): string => {
          const names: string[] = [];
          let curr: string | undefined = fId;
          while (curr) {
            const found: DBFolder | undefined = existingFolders.find(
              (f) => f.id === curr,
            );
            if (found) {
              names.unshift(found.name);
              curr = found.parentId;
            } else {
              break;
            }
          }
          return names.join(" / ") || "未知文件夹";
        };

        // 判定本次导入文件是否全归属于同一个最外层包裹文件夹（例如拖入文件夹 "试验品"）
        let commonTopFolder: string | null = null;
        // 仅对"拖入文件夹"生效：ZIP 不做共同顶层剥离，否则会把真实文件夹当成外壳剥掉
        const dragMainItems = mainItems.filter((m) => !(m.file as any).__miuFromZip);
        const allMainFolders = dragMainItems.map((m) => m.folder).filter(Boolean);
        if (allMainFolders.length > 0 && allMainFolders.length === dragMainItems.length) {
          const firstTop = allMainFolders[0].split("/")[0]?.toLowerCase().trim();
          if (firstTop && allMainFolders.every((f) => f.split("/")[0]?.toLowerCase().trim() === firstTop)) {
            commonTopFolder = firstTop;
          }
        }

        const resolveFolderForItem = async (
          item: ParsedItem,
          prefix?: string[],
        ): Promise<string | undefined> => {
          let assignFolderId: string | undefined =
            folderId || targetFolderId || undefined;
          if (item.folder) {
            let parts = item.folder.split("/").filter(Boolean);

            // 1. 自动剥离顶层系统容器/大类包名 ("角色卡", "角色卡包", "characters", "工具区" 等)
            parts = stripSystemContainerBucketParts(parts);

            // 2. 自动剥离拖入文件夹的最外层容器包裹 (如拖入 "试验品" 文件夹，直接把内部文件平铺导入)
            if (!(item.file as any).__miuFromZip && commonTopFolder && parts.length > 0 && parts[0].toLowerCase().trim() === commonTopFolder) {
              parts = parts.slice(1);
            }

            // 3. 智能防嵌套剥离：角色同名导出文件夹剥离
            if (parts.length > 0) {
              const lastPart = parts[parts.length - 1].toLowerCase().trim();
              const charBaseName = item.file.name.replace(/\.[^/.]+$/, "").toLowerCase().trim();
              const rawCharName = String(
                item.data?.name ||
                item.data?.data?.name ||
                item.data?.char_name ||
                item.data?.character_name ||
                ""
              ).toLowerCase().trim();
              const safeCharName = getSafeFilename(rawCharName).toLowerCase().trim();

              if (
                lastPart === charBaseName ||
                (rawCharName && (lastPart === rawCharName || lastPart === safeCharName))
              ) {
                parts = parts.slice(0, -1);
              }
            }

            // 再次剥离顶层系统容器
            parts = stripSystemContainerBucketParts(parts);

            if (parts.length > 0) {
              const topFolder = parts[0];
              if (extractedRootsMap.has(topFolder)) {
                const rootInfo = extractedRootsMap.get(topFolder)!;
                const subParts = parts.slice(1);
                assignFolderId =
                  subParts.length > 0
                    ? await getOrCreateNestedFolder(subParts, rootInfo.folderId)
                    : rootInfo.folderId;
              } else {
                assignFolderId = await getOrCreateNestedFolder(
                  parts,
                  folderId || targetFolderId,
                );
              }
            } else if (prefix && prefix.length > 0) {
              // 剥壳把工具分类名（世界书/预设/工具区）也剥掉了，这里回落到识别出的分类
              assignFolderId = await getOrCreateNestedFolder(
                prefix,
                folderId || targetFolderId,
              );
            }
          } else if (prefix && prefix.length > 0) {
            // 工具分类名本身就是目标文件夹，不再走系统大类剥离
            assignFolderId = await getOrCreateNestedFolder(
              prefix,
              folderId || targetFolderId,
            );
          }
          return assignFolderId;
        };

        // 与已有卡片 + 本次导入内部做同名文件去重
        const existingImportPathKeys = new Set<string>();
        const existingNameCounts = new Map<string, number>();
        for (const meta of existingMeta) {
          if (meta.deletedAt) continue;
          if (meta.autoImportFilename) {
            existingImportPathKeys.add(
              `${meta.folderId || ""}/${meta.autoImportFilename}`,
            );
          }
          if (!meta.name || meta.isTool) continue;
          const key = getSafeFilename(meta.name).toLowerCase();
          existingNameCounts.set(key, (existingNameCounts.get(key) || 0) + 1);
        }
        const newPathsAssigned = new Set<string>();
        const newNameCounts = new Map<string, number>();

        const charsToSave: CharacterCard[] = [];
        const importedCardsTokens: Array<{
          cardId: string;
          charName: string;
          folderId?: string;
          folderPath: string;
          avatarBlob?: Blob;
          avatarUrlFallback?: string;
          breakdown: CharacterTokenBreakdown;
          attachedChatsCount: number;
          attachedAvatarsCount: number;
          isTool?: boolean;
        }> = [];
        let successCount = 0;

        for (let mIdx = 0; mIdx < mainItems.length; mIdx++) {
          const item = mainItems[mIdx];
          if (mIdx % 25 === 0) {
            setProgress({
              current: mIdx,
              total: mainItems.length,
              message: `正在准备角色数据 (${mIdx}/${mainItems.length})...`,
            });
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          try {
            const data = item.data;
            const file = item.file;

            if (data && typeof data === "object" && !Array.isArray(data)) {
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
            }

            const charName =
              String(
                data?.name ||
                  data?.data?.name ||
                  data?.char_name ||
                  data?.character_name ||
                  data?.data?.char_name ||
                  data?.data?.character_name ||
                  file.name.replace(/\.[^/.]+$/, "") ||
                  "Unknown Character",
              ).trim() || "Unknown Character";

            let assignFolderId = await resolveFolderForItem(item);
            let autoCategorized = false;

            if (!assignFolderId && autoCategorizeSameName) {
              const matched = existingChars.find(
                (c) =>
                  c.name &&
                  c.name.trim().toLowerCase() === charName.toLowerCase() &&
                  c.folderId,
              );
              if (matched && matched.folderId) {
                assignFolderId = matched.folderId;
                autoCategorized = true;
              }
            }

            let buffer: ArrayBuffer | null = null;
            try {
              buffer = await file.arrayBuffer();
            } catch {}

            const embeddedDate = extractDateFromCardData(data);
            const imageTimestamp =
              buffer &&
              (file.type.startsWith("image/") ||
                /\.(png|jpe?g|webp)$/i.test(file.name))
                ? extractImageTimestamp(buffer)
                : null;

            const now = Date.now();
            const fileLastMod = file.lastModified;
            const isFreshCacheCopy =
              fileLastMod && Math.abs(now - fileLastMod) < 120000;

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

            let localFilePath: string | undefined;
            let avatarBlob: Blob | undefined;
            const refreshedFile =
              authenticModifiedTime &&
              buffer &&
              authenticModifiedTime !== file.lastModified
                ? new File([buffer], file.name, {
                    type: file.type || "application/octet-stream",
                    lastModified: authenticModifiedTime,
                  })
                : file;

            if (isAndroid() && (file as any).androidAbsPath) {
              localFilePath = (file as any).androidAbsPath;
            } else if (item.isImage) {
              avatarBlob = file;
            }
            const originalFile: File = refreshedFile;

            const baseF = getSafeFilename(charName);
            const nameExt = file.name.includes(".")
              ? file.name.substring(file.name.lastIndexOf("."))
              : "";
            const nameKey = baseF.toLowerCase();
            let dupIndex =
              (existingNameCounts.get(nameKey) || 0) +
              (newNameCounts.get(nameKey) || 0);
            let autoImportFilename =
              dupIndex === 0
                ? `${baseF}${nameExt}`
                : `${baseF}_${dupIndex}${nameExt}`;
            let pathKey = `${assignFolderId || ""}/${autoImportFilename}`;
            while (
              existingImportPathKeys.has(pathKey) ||
              newPathsAssigned.has(pathKey)
            ) {
              dupIndex++;
              autoImportFilename = `${baseF}_${dupIndex}${nameExt}`;
              pathKey = `${assignFolderId || ""}/${autoImportFilename}`;
            }
            newPathsAssigned.add(pathKey);
            newNameCounts.set(nameKey, (newNameCounts.get(nameKey) || 0) + 1);

            const studioMeta = metaByMain.get(item);
            let versionHistory: CardVersionSnapshot[] = [];
            if (studioMeta && Array.isArray(studioMeta.versionHistory)) {
              versionHistory = studioMeta.versionHistory.map((v: any) => ({
                ...v,
              }));
            }

            const assignedVersions = versionsByMain.get(item) || [];
            for (const versionItem of assignedVersions) {
              const versionName = versionItem.file.name.replace(/\.[^/.]+$/, "");
              const existingSnap = versionHistory.find(
                (s: any) =>
                  s.id === versionName ||
                  s.versionName === versionName ||
                  (typeof s.versionName === "string" &&
                    s.versionName.includes(versionName)),
              );
              if (existingSnap) {
                existingSnap.avatarBlob = versionItem.file;
                existingSnap.completeCardPngBlob = versionItem.file;
                if (!existingSnap.data && versionItem.data) {
                  existingSnap.data = versionItem.data;
                }
              } else {
                versionHistory.push({
                  id: crypto.randomUUID(),
                  versionName,
                  note: "从版本历史归档导入",
                  createdAt: versionItem.file.lastModified || Date.now(),
                  fileModifiedAt: versionItem.file.lastModified,
                  data: versionItem.data || {},
                  avatarBlob: versionItem.file,
                  completeCardPngBlob: versionItem.file,
                  cardName:
                    versionItem.data?.data?.name ||
                    versionItem.data?.name ||
                    versionName,
                });
              }
            }
            versionHistory.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

            const newCard: CharacterCard = {
              id: crypto.randomUUID(),
              name: charName,
              autoImportFilename,
              avatarBlob,
              localFilePath,
              avatarUrlFallback: item.isImage ? "" : getFallbackAvatar(charName),
              data,
              originalFile,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              fileModifiedAt: authenticModifiedTime,
              folderId: assignFolderId,
              avatarHistory: altImagesByMain.get(item),
              versionHistory:
                versionHistory.length > 0 ? versionHistory : undefined,
            };

            const cardTokens = getCharacterTokenBreakdown(newCard.data);
            newCard.tokenCount = cardTokens.totalTokens;
            newCard.permanentTokens = cardTokens.permanentTokens;
            charsToSave.push(newCard);
            successCount++;

            importedCardsTokens.push({
              cardId: newCard.id,
              charName,
              folderId: assignFolderId,
              folderPath: assignFolderId ? findFolderPath(assignFolderId) : "未分类",
              avatarBlob: newCard.avatarBlob,
              avatarUrlFallback: newCard.avatarUrlFallback,
              breakdown: cardTokens,
              attachedChatsCount: (altImagesByMain.get(item) || []).length,
              attachedAvatarsCount: (versionHistory || []).length,
            });

            if (autoCategorized && assignFolderId) {
              sameNameAutoSummary.push({
                cardId: newCard.id,
                charName,
                folderId: assignFolderId,
                folderPath: findFolderPath(assignFolderId),
                breakdown: cardTokens,
              });
            }
          } catch (err: any) {
            errors.push({ file: item.file.name, error: err.message || "未知错误" });
          }

          setProgress({
            current: charsToSave.length,
            total: mainItems.length + toolItems.length,
            message: "正在解析数据...",
          });
        }

        // ---------- 工具类文件（世界书 / 预设 / 快速回复 / 美化 / 脚本） ----------
        for (const item of toolItems) {
          try {
            const data = item.data;
            const file = item.file;

            if (data && typeof data === "object" && !Array.isArray(data)) {
              if (data.entries) {
                data.entries = normalizeWorldbookEntries(data.entries);
              } else if (data.data?.entries) {
                data.data.entries = normalizeWorldbookEntries(data.data.entries);
              }
            }

            const toolName =
              String(
                data?.name ||
                  data?.data?.name ||
                  file.name.replace(/\.[^/.]+$/, "") ||
                  "未命名工具",
              ).trim() || file.name.replace(/\.[^/.]+$/, "");

            const assignFolderId = await resolveFolderForItem(
              item,
              item.toolPrefix,
            );

            const toolTokens = getCharacterTokenBreakdown(data);
            const toolCard: CharacterCard = {
              id: crypto.randomUUID(),
              name: toolName,
              autoImportFilename: file.name,
              data,
              avatarUrlFallback: getFallbackAvatar(toolName),
              createdAt: Date.now(),
              updatedAt: Date.now(),
              folderId: assignFolderId,
              tokenCount: toolTokens.totalTokens,
              permanentTokens: toolTokens.permanentTokens,
            };

            charsToSave.push(toolCard);
            successCount++;

            importedCardsTokens.push({
              cardId: toolCard.id,
              charName: toolName,
              folderId: assignFolderId,
              folderPath: assignFolderId ? findFolderPath(assignFolderId) : "工具区",
              avatarUrlFallback: toolCard.avatarUrlFallback,
              breakdown: toolTokens,
              attachedChatsCount: 0,
              attachedAvatarsCount: 0,
              isTool: true,
            });
          } catch (err: any) {
            errors.push({ file: item.file.name, error: err.message || "未知错误" });
          }
        }

        if (charsToSave.length > 0) {
          setProgress({
            current: 0,
            total: charsToSave.length,
            message: "正在保存到数据库...",
          });
          const BATCH_SIZE = 50;
          for (let bIdx = 0; bIdx < charsToSave.length; bIdx += BATCH_SIZE) {
            const batch = charsToSave.slice(bIdx, bIdx + BATCH_SIZE);
            const currentSaved = Math.min(bIdx + batch.length, charsToSave.length);
            setProgress({
              current: currentSaved,
              total: charsToSave.length,
              message: `正在写入本地数据库 (${currentSaved}/${charsToSave.length})...`,
            });
            await saveCharacters(batch);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }

        // ---------- 聊天记录 ----------
        if (chatLogs.length > 0) {
          setProgress({
            current: 0,
            total: chatLogs.length,
            message: "正在保存聊天记录...",
          });

          const allCharsForMatching = [...charsToSave, ...existingChars];
          const chatsToSave: ChatLog[] = [];

          for (const chatItem of chatLogs) {
            if (!Array.isArray(chatItem.data)) continue;

            let charId = "";
            const parts = chatItem.path.split("/");
            const chatIndex =
              parts.indexOf("聊天记录") !== -1
                ? parts.indexOf("聊天记录")
                : parts.indexOf("chats");
            if (chatIndex > 0) {
              const ownerName = parts[chatIndex - 1];
              const matchedChar = allCharsForMatching.find(
                (c) =>
                  (c.name && getSafeFilename(c.name) === ownerName) ||
                  c.name === ownerName ||
                  (c.autoImportFilename &&
                    c.autoImportFilename.split("/").pop()?.split(".")[0] ===
                      ownerName),
              );
              if (matchedChar) charId = matchedChar.id;
            }

            if (!charId) {
              const aiMessage = chatItem.data.find(
                (m: any) => !m.is_user && m.name,
              );
              if (aiMessage?.name) {
                const match = allCharsForMatching.find(
                  (c) =>
                    c.name &&
                    c.name.toLowerCase() === String(aiMessage.name).toLowerCase(),
                );
                if (match) charId = match.id;
              }
            }

            const chatName = chatItem.file.name.replace(/\.[^/.]+$/, "");
            const finalMessages = chatItem.data
              .filter(
                (m: any) =>
                  m &&
                  (m.mes !== undefined ||
                    m.text !== undefined ||
                    m.is_user !== undefined ||
                    m.send_date !== undefined ||
                    m.swipes !== undefined),
              )
              .map((m: any) => {
                const res: any = { ...m };
                if (res.is_user === undefined) res.is_user = res.name !== chatName;
                if (res.send_date === undefined) res.send_date = Date.now();
                if (m.mes !== undefined) res.mes = m.mes;
                else if (m.text !== undefined) res.mes = m.text;
                return res;
              });

            chatsToSave.push({
              id: crypto.randomUUID(),
              characterId: charId,
              name: chatName,
              messages: finalMessages,
              createdAt: chatItem.file.lastModified || Date.now(),
            });
            successCount++;
          }

          if (chatsToSave.length > 0) {
            await saveChatsBulk(chatsToSave, (current, total, phase) => {
              setProgress({
                current,
                total,
                message: `${phase} ${current}/${total}`,
              });
            });
          }
        }

        setImportedSuccessCount(successCount);

        if (successCount === 0) {
          setProgress(null);
          if (errors.length > 0) {
            setImportErrors(errors);
          } else {
            setError("未能成功导入任何角色卡或关联数据。");
          }
          return;
        }

        await cleanupEmptyFolders();
        setProgress(null);

        // 如果部分辅助文件有轻微错误，但在已导入成功卡片时不阻断主结算界面
        if (importedCardsTokens.length > 0) {
          const totalTokens = importedCardsTokens.reduce((sum, item) => sum + item.breakdown.totalTokens, 0);
          setImportTokenSummary({
            totalTokens,
            items: importedCardsTokens,
          });
          if (sameNameAutoSummary.length > 0) {
            setAutoCategorizedSummary(sameNameAutoSummary);
          }
          onImported();
        } else if (sameNameAutoSummary.length > 0) {
          setAutoCategorizedSummary(sameNameAutoSummary);
          onImported();
        } else {
          onImported();
          onClose();
        }
      } catch (err: any) {
        setProgress(null);
        setError(`保存角色失败: ${err.message}`);
      }
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

  const aiSettings = getAISettings();
  const stUrl = normalizeSillyTavernUrl(aiSettings.sillyTavernUrl);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(progress || isPulling) ? undefined : onClose}
            className="fixed inset-0 bg-black/60 [.light-theme_&]:!bg-black/25 backdrop-blur-sm z-[70]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 backdrop-blur-2xl border rounded-3xl shadow-2xl z-[80] flex flex-col transition-all duration-300 ${isLightMode ? "bg-white text-slate-900 border-[#e2e8f0]" : "bg-slate-900/95 text-slate-100 border-white/10"} ${
              tavernMode
                ? "w-[96vw] max-w-6xl h-[92vh] sm:h-[88vh] p-4 sm:p-6"
                : importTokenSummary ? "w-[94vw] max-w-[540px] max-h-[88vh] p-5 sm:p-6" : (progress ? "w-[92vw] max-w-[340px] sm:max-w-[380px] p-6 sm:p-7" : "w-[92vw] max-w-[420px] sm:max-w-[460px] p-5 sm:p-6")
            }`}
          >
            {/* Header Section */}
            <div className="flex justify-between items-center mb-3.5 pb-3 border-b border-white/10 [.light-theme_&]:!border-[#f1f5f9] version-modal-border shrink-0 gap-3">
              {tavernMode ? (
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-2xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center text-blue-400 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-blue-600 shrink-0">
                    <Cloud className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base sm:text-lg font-bold text-slate-100 [.light-theme_&]:!text-[#0f172a] truncate">
                      酒馆角色卡拉取中心
                    </h2>
                    <div className="flex items-center gap-2 text-xs text-emerald-400 [.light-theme_&]:!text-emerald-700 mt-0.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                      <span className="font-mono text-[11px] truncate max-w-[220px] sm:max-w-[360px]">
                        {stUrl || "未在设置中配置 API 地址"}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <h2 className="text-base sm:text-lg font-bold text-slate-100 [.light-theme_&]:!text-[#0f172a]">
                  {autoCategorizedSummary ? "导入完成" : (importTokenSummary ? "导入完成" : (progress ? "正在导入" : "导入角色卡"))}
                </h2>
              )}

              <div className="flex items-center gap-2 shrink-0">
                {(!progress || tavernMode) && (
                  <button
                    onClick={onClose}
                    className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition cursor-pointer bg-white/10 hover:bg-white/20 text-white/90 hover:text-white border border-white/10 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:active:!bg-[#cbd5e1] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!shadow-2xs"
                    title="关闭"
                  >
                    <X className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                )}
              </div>
            </div>

            {/* Main Content Body */}
            {autoCategorizedSummary ? (
              <div className="py-2 flex flex-col flex-1 min-h-0">
                <div className="flex items-center gap-3 mb-3.5 shrink-0">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-[#34C759]/15 border border-[#34C759]/30 flex items-center justify-center shrink-0">
                    <CheckCircle className="w-5 h-5 text-[#34C759]" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base sm:text-lg text-slate-100 [.light-theme_&]:!text-[#0f172a]">导入完成</h3>
                    <p className="text-xs sm:text-sm text-slate-100/60 [.light-theme_&]:!text-slate-500">共成功导入 {importedSuccessCount} 项卡片/数据</p>
                  </div>
                </div>

                <div className="rounded-2xl p-4 mb-4 shrink-0 border bg-blue-500/10 border-blue-500/20 text-blue-300 [.light-theme_&]:!bg-blue-50/80 [.light-theme_&]:!border-blue-200/80 [.light-theme_&]:!text-blue-900">
                  <div className="flex items-center gap-2 text-xs sm:text-sm font-bold mb-1.5">
                    <Folder className="w-4 h-4 text-blue-500 shrink-0" />
                    <span>检测到同名角色卡，已自动归入已有分类：</span>
                  </div>
                  <p className="text-xs sm:text-sm mb-3 text-white/60 [.light-theme_&]:!text-slate-600 leading-relaxed">
                    系统匹配到已有同名角色的分类文件夹并已自动整理归类。您可以前往查看，或一键移回主页。
                  </p>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                    {autoCategorizedSummary.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs sm:text-sm p-3 rounded-xl border bg-black/30 border-white/10 text-white [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a]">
                        <div className="min-w-0 flex-1 mr-2">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold truncate block text-white [.light-theme_&]:!text-[#0f172a]">{item.charName}</span>
                            {!item.isTool && item.breakdown && item.breakdown.totalTokens > 0 && (
                              <button
                                type="button"
                                onClick={() => setSelectedTokenBreakdown({ name: item.charName, breakdown: item.breakdown! })}
                                className="text-[10px] font-mono px-2 py-0.5 rounded-md border transition active:scale-95 shrink-0 cursor-pointer bg-white/10 border-white/15 text-white/80 hover:bg-white/20 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#334155] [.light-theme_&]:hover:!bg-[#e2e8f0]"
                                title="点击查看 Token 详情"
                              >
                                <span>{formatTokenCount(item.breakdown.totalTokens)} T</span>
                              </button>
                            )}
                          </div>
                          <span className="text-xs truncate block mt-0.5 text-blue-300 [.light-theme_&]:!text-[#007aff] font-medium">📁 {item.folderPath}</span>
                        </div>
                        {onNavigateFolder && (
                          <button
                            type="button"
                            onClick={() => {
                              onNavigateFolder(item.folderId);
                              setAutoCategorizedSummary(null);
                              onClose();
                            }}
                            className="px-3 py-1.5 text-xs bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 rounded-xl shrink-0 font-semibold transition flex items-center gap-1 active:scale-95 cursor-pointer [.light-theme_&]:!bg-[#007aff]/10 [.light-theme_&]:hover:!bg-[#007aff]/20 [.light-theme_&]:!text-[#007aff]"
                          >
                            <span>前往文件夹</span>
                            <ArrowRight className="w-3.5 h-3.5" />
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
                    className="flex-1 py-3 px-3 rounded-2xl text-xs sm:text-sm font-semibold transition disabled:opacity-50 bg-white/10 hover:bg-white/15 text-white/80 [.light-theme_&]:!bg-white [.light-theme_&]:hover:!bg-[#f1f5f9] [.light-theme_&]:active:!bg-[#e2e8f0] [.light-theme_&]:!border [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] cursor-pointer"
                  >
                    {isReverting ? "正在移回..." : "移回主页未分类"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAutoCategorizedSummary(null);
                      onClose();
                    }}
                    className="flex-1 py-3 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-xs sm:text-sm font-bold transition shadow-sm cursor-pointer"
                  >
                    知道了 / 完成
                  </button>
                </div>
              </div>
            ) : importTokenSummary ? (
              <div className="py-1 flex flex-col flex-1 min-h-0 overflow-hidden">
                {/* Success Banner */}
                <div className="flex items-center gap-3 mb-3 shrink-0">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-[#34C759]/15 border border-[#34C759]/30 flex items-center justify-center shrink-0">
                    <Check className="w-5 h-5 text-[#34C759] stroke-[2.5]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-base sm:text-lg text-slate-100 [.light-theme_&]:!text-[#0f172a]">
                        导入成功
                      </h3>
                      <span className="px-2.5 py-1 rounded-full border text-xs font-mono font-bold flex items-center gap-1.5 shadow-2xs bg-slate-800 border-slate-700 text-slate-100 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a]">
                        <FileText className="w-3.5 h-3.5 text-slate-400 [.light-theme_&]:!text-[#0f172a]" />
                        <span>总计 {formatTokenCount(importTokenSummary.totalTokens)} T</span>
                      </span>
                    </div>
                    <p className="text-xs text-slate-100/60 [.light-theme_&]:!text-slate-500 mt-0.5">
                      共成功导入 {importTokenSummary.items.length} 项卡片/数据，以下为归类与存储信息：
                    </p>
                  </div>
                </div>

                {/* Search Bar if multiple cards */}
                {importTokenSummary.items.length > 3 && (
                  <div className="mb-2.5 shrink-0 relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/40 [.light-theme_&]:!text-[#64748b]" />
                    <input
                      type="text"
                      value={tokenSearchQuery}
                      onChange={(e) => setTokenSearchQuery(e.target.value)}
                      placeholder="搜索本次导入卡片..."
                      className="w-full pl-8 pr-3 py-2 rounded-xl text-xs outline-none border transition bg-white/5 border-white/10 text-white focus:border-blue-500/50 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:placeholder:!text-[#94a3b8] [.light-theme_&]:focus:!border-[#007aff]"
                    />
                  </div>
                )}

                {/* Cards List */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar min-h-0">
                  {importTokenSummary.items
                    .filter((c) =>
                      !tokenSearchQuery.trim() ||
                      c.charName.toLowerCase().includes(tokenSearchQuery.toLowerCase()) ||
                      c.folderPath.toLowerCase().includes(tokenSearchQuery.toLowerCase())
                    )
                    .map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between gap-3 p-3 rounded-2xl border transition bg-white/5 border-white/10 hover:bg-white/8 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:hover:!bg-[#f8fafc]"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <div className="w-10 h-10 rounded-xl overflow-hidden bg-white/10 shrink-0 relative border border-white/10 [.light-theme_&]:!border-[#e2e8f0]">
                            {item.avatarBlob ? (
                              <img
                                src={URL.createObjectURL(item.avatarBlob)}
                                alt={item.charName}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <img
                                src={item.avatarUrlFallback || getFallbackAvatar(item.charName)}
                                alt={item.charName}
                                className="w-full h-full object-cover"
                              />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-xs sm:text-sm truncate text-white [.light-theme_&]:!text-[#0f172a] flex items-center gap-2">
                              <span className="truncate">{item.charName}</span>
                              {!item.isTool && item.breakdown && item.breakdown.totalTokens > 0 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSelectedTokenBreakdown({
                                      name: item.charName,
                                      breakdown: item.breakdown,
                                    })
                                  }
                                  className="text-[10px] font-mono px-2 py-0.5 rounded-md border shrink-0 transition active:scale-95 cursor-pointer bg-white/10 border-white/15 text-white/80 hover:bg-white/20 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#334155] [.light-theme_&]:hover:!bg-[#e2e8f0]"
                                  title="点击查看 Token 详细拆解"
                                >
                                  {formatTokenCount(item.breakdown.totalTokens)} T
                                </button>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 text-[11px] text-white/50 [.light-theme_&]:!text-[#64748b] mt-0.5 truncate">
                              <span className="font-medium text-blue-400 [.light-theme_&]:!text-[#007aff] truncate">📁 {item.folderPath}</span>
                              {item.breakdown.totalCharCount > 0 && (
                                <span>· {item.breakdown.totalCharCount}字</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Actions: Navigate Folder if any */}
                        <div className="flex items-center gap-2 shrink-0">
                          {onNavigateFolder && item.folderId && (
                            <button
                              type="button"
                              onClick={() => {
                                onNavigateFolder(item.folderId!);
                                setImportTokenSummary(null);
                                onClose();
                              }}
                              className="px-3.5 py-1.5 text-xs bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 rounded-xl shrink-0 font-semibold transition flex items-center gap-1 active:scale-95 cursor-pointer [.light-theme_&]:!bg-[#007aff]/10 [.light-theme_&]:hover:!bg-[#007aff]/20 [.light-theme_&]:!text-[#007aff]"
                              title="前往目标文件夹"
                            >
                              <span>前往文件夹</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                </div>

                {/* Footer Buttons */}
                <div className="flex gap-2.5 mt-3 pt-2.5 border-t border-white/10 [.light-theme_&]:!border-[#e2e8f0] shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setImportTokenSummary(null);
                      setAutoCategorizedSummary(null);
                      onClose();
                    }}
                    className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-xs sm:text-sm font-bold transition shadow-md shadow-blue-500/20 cursor-pointer text-center [.light-theme_&]:!bg-[#007aff] [.light-theme_&]:hover:!bg-[#0062cc] [.light-theme_&]:!text-white"
                  >
                    完成并进入卡库
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
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                  {/* Pull Progress Live Activity Terminal Banner */}
                  {(isPulling || progress) && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mb-4 p-4 rounded-3xl bg-blue-500/10 border border-blue-500/20 [.light-theme_&]:!bg-blue-50/90 [.light-theme_&]:!border-blue-200 shrink-0 shadow-sm"
                    >
                      <div className="flex items-center justify-between mb-2.5 gap-2">
                        <div className="flex items-center gap-3 min-w-0">
                          {currentPullChar ? (
                            <TavernAvatar char={currentPullChar.avatar} aiSettings={aiSettings} className="w-10 h-10 rounded-xl object-cover shrink-0 shadow-xs border border-blue-400/30" />
                          ) : (
                            <Loader2 className="w-5 h-5 animate-spin text-blue-500 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="text-xs sm:text-sm font-bold text-slate-100 [.light-theme_&]:!text-[#0f172a] truncate">
                              {progress?.message || (isPulling ? "正在通讯与拉取..." : "准备中...")}
                            </div>
                            <div className="text-[11px] text-blue-400 [.light-theme_&]:!text-blue-600 font-semibold truncate mt-0.5">
                              {currentPullChar ? `正在处理: ${currentPullChar.name}` : `进度: ${progress?.current || 0} / ${progress?.total || tavernChars.length}`}
                            </div>
                          </div>
                        </div>

                        {progress && progress.total > 0 && (
                          <div className="text-right shrink-0 font-mono text-xs font-bold text-blue-400 [.light-theme_&]:!text-blue-600">
                            {Math.round(((progress.current || 0) / progress.total) * 100)}%
                          </div>
                        )}
                      </div>

                      {/* Progress bar */}
                      {progress && progress.total > 0 && (
                        <div className="w-full bg-black/20 [.light-theme_&]:!bg-slate-200 h-2.5 rounded-full overflow-hidden mb-3">
                          <motion.div 
                            className="bg-blue-500 h-full rounded-full transition-all duration-300" 
                            style={{ width: `${Math.min(100, Math.round(((progress.current || 0) / progress.total) * 100))}%` }}
                          />
                        </div>
                      )}

                      {/* Live Log Terminal Stream */}
                      {pullLogs.length > 0 && (
                        <div className="bg-black/40 [.light-theme_&]:!bg-slate-900 text-emerald-400 p-2.5 rounded-2xl font-mono text-[11px] max-h-28 overflow-y-auto custom-scrollbar border border-white/5 space-y-1">
                          {pullLogs.map((log, idx) => (
                            <div key={idx} className="leading-relaxed flex items-center gap-1.5 opacity-90">
                              <Terminal className="w-3 h-3 text-emerald-500 shrink-0" />
                              <span className="truncate">{log}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  )}

                  {/* Filter & Toolbar */}
                  <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2.5 mb-3 shrink-0">
                    <div className="relative flex-1 min-w-0">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 [.light-theme_&]:!text-[#64748b]" />
                      <input
                        type="text"
                        placeholder="搜索角色名称、描述或标签..."
                        value={tavernSearchQuery}
                        onChange={(e) => setTavernSearchQuery(e.target.value)}
                        className="w-full rounded-2xl py-2 pl-10 pr-8 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all border bg-white/5 hover:bg-white/10 focus:bg-white/10 border-white/10 text-white placeholder:text-white/30 [.light-theme_&]:!bg-white [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:placeholder:!text-[#94a3b8] [.light-theme_&]:focus:!border-blue-500 [.light-theme_&]:!shadow-2xs"
                      />
                      {tavernSearchQuery && (
                        <button
                          onClick={() => setTavernSearchQuery("")}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white [.light-theme_&]:!text-slate-400 [.light-theme_&]:hover:!text-slate-700 text-xs p-1 rounded-full"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0 justify-between sm:justify-end">
                      <span className="text-xs font-semibold text-white/60 [.light-theme_&]:!text-slate-600">
                        已选中 <strong className="text-blue-400 [.light-theme_&]:!text-blue-600 font-bold">{selectedTavernChars.size}</strong> / {tavernChars.length} 项
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedTavernChars(new Set([...selectedTavernChars, ...filteredTavernChars.map(c => c.avatar)]))}
                          className="text-xs border px-3 py-1.5 rounded-xl transition cursor-pointer font-medium bg-white/5 hover:bg-white/15 border-white/10 text-white/80 hover:text-white [.light-theme_&]:!bg-white [.light-theme_&]:hover:!bg-[#f1f5f9] [.light-theme_&]:active:!bg-[#e2e8f0] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!shadow-2xs"
                        >
                          全选当前 ({filteredTavernChars.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedTavernChars(new Set())}
                          className="text-xs border px-3 py-1.5 rounded-xl transition cursor-pointer font-medium bg-white/5 hover:bg-white/15 border-white/10 text-white/80 hover:text-white [.light-theme_&]:!bg-white [.light-theme_&]:hover:!bg-[#f1f5f9] [.light-theme_&]:active:!bg-[#e2e8f0] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!shadow-2xs"
                        >
                          清空
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Character Grid */}
                  <div className="flex-1 overflow-y-auto custom-scrollbar p-1 min-h-0">
                    {tavernChars.length === 0 && !isPulling && (
                      <div className="flex flex-col items-center justify-center py-16 text-center text-white/40 [.light-theme_&]:!text-slate-500 space-y-3">
                        <Cloud className="w-12 h-12 opacity-30 text-blue-400" />
                        <p className="text-sm font-semibold">未加载到角色卡或 API 未连通</p>
                        <button
                          onClick={fetchTavernList}
                          className="px-4 py-2 rounded-xl bg-blue-500/20 text-blue-400 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-blue-600 font-bold text-xs hover:bg-blue-500/30 transition cursor-pointer"
                        >
                          点击试运行连接酒馆
                        </button>
                      </div>
                    )}

                    {tavernChars.length > 0 && filteredTavernChars.length === 0 && (
                      <div className="text-center text-white/40 [.light-theme_&]:!text-slate-500 py-16 text-xs sm:text-sm">
                        没有符合 "{tavernSearchQuery}" 搜索条件的角色卡
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 pb-2">
                      {filteredTavernChars.map(char => {
                        const isSelected = selectedTavernChars.has(char.avatar);
                        return (
                          <div
                            key={char.avatar}
                            onClick={() => {
                              const newSet = new Set(selectedTavernChars);
                              if (newSet.has(char.avatar)) newSet.delete(char.avatar);
                              else newSet.add(char.avatar);
                              setSelectedTavernChars(newSet);
                            }}
                            className={`group relative flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all duration-200 border ${
                              isSelected
                                ? 'bg-blue-500/15 border-blue-500/60 text-white [.light-theme_&]:!bg-blue-50/90 [.light-theme_&]:!border-blue-400 [.light-theme_&]:!text-[#0f172a] shadow-xs scale-[1.01]'
                                : 'bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/10 [.light-theme_&]:!bg-white [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:hover:!bg-[#f8fafc] [.light-theme_&]:!text-[#0f172a]'
                            }`}
                          >
                            <TavernAvatar char={char} aiSettings={aiSettings} className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl object-cover shrink-0 shadow-xs border border-white/10 [.light-theme_&]:!border-[#e2e8f0]" />
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-xs sm:text-sm truncate text-slate-100 [.light-theme_&]:!text-[#0f172a] group-hover:text-blue-400 [.light-theme_&]:group-hover:!text-blue-600 transition-colors">
                                {char.name}
                              </div>
                              <div className="text-[11px] text-white/50 [.light-theme_&]:!text-slate-500 line-clamp-2 mt-0.5 leading-relaxed">
                                {char.creator_notes || char.description?.substring(0, 60) || '暂无详细描述信息'}
                              </div>
                            </div>

                            <div className={`w-5 h-5 rounded-lg flex items-center justify-center border transition-all duration-200 shrink-0 ${
                              isSelected
                                ? 'border-blue-500 bg-blue-500 text-white [.light-theme_&]:!border-blue-600 [.light-theme_&]:!bg-blue-600 [.light-theme_&]:!text-white shadow-xs'
                                : 'border-white/20 bg-black/20 [.light-theme_&]:!border-slate-300 [.light-theme_&]:!bg-white'
                            }`}>
                              {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Bottom Actions */}
                  <div className="flex items-center gap-3 mt-4 pt-3 border-t border-white/10 [.light-theme_&]:!border-[#f1f5f9] version-modal-border shrink-0">
                    <button
                      onClick={() => { setTavernMode(false); setTavernSearchQuery(""); }}
                      className="py-3 px-5 border rounded-2xl font-semibold text-xs sm:text-sm transition-colors cursor-pointer bg-white/5 hover:bg-white/15 border-white/10 text-white [.light-theme_&]:!bg-white [.light-theme_&]:hover:!bg-[#f1f5f9] [.light-theme_&]:active:!bg-[#e2e8f0] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!shadow-2xs"
                    >
                      返回本地上传
                    </button>
                    <button
                      onClick={pullSelectedTavernChars}
                      disabled={selectedTavernChars.size === 0 || isPulling}
                      className="flex-1 py-3 px-5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold text-xs sm:text-sm transition-all shadow-md disabled:opacity-50 flex justify-center items-center gap-2 cursor-pointer"
                    >
                      {isPulling ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>正在同步拉取中...</span>
                        </>
                      ) : (
                        <>
                          <Cloud className="w-4 h-4" />
                          <span>批量拉取已选角色 ({selectedTavernChars.size})</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })() : importErrors.length > 0 ? (
              <div className="py-3 flex flex-col flex-1 min-h-0">
                <div className="bg-red-500/10 border border-red-500/20 [.light-theme_&]:!bg-red-50 [.light-theme_&]:!border-red-200 rounded-2xl p-4 flex-1 overflow-y-auto custom-scrollbar">
                  <div className="flex items-center gap-2 text-red-400 [.light-theme_&]:!text-red-600 mb-3 sticky top-0 py-1 font-bold text-sm sm:text-base">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <h3>
                      文件解析提示 ({importErrors.length} 个文件无法作为角色卡解析)
                    </h3>
                  </div>
                  <p className="text-xs text-red-300/80 [.light-theme_&]:!text-red-700/80 mb-3 leading-relaxed">
                    未能在以下文件中读取到标准的 Tavern / 酒馆角色卡元数据。如果是常规图片或非角色卡文件，系统已为您过滤：
                  </p>
                  <ul className="space-y-2 text-xs sm:text-sm">
                    {importErrors.map((err, i) => (
                      <li
                        key={i}
                        className="flex flex-col bg-black/20 border border-white/5 [.light-theme_&]:!bg-white [.light-theme_&]:!border-red-100 p-2.5 rounded-xl"
                      >
                        <span className="font-semibold text-red-300 [.light-theme_&]:!text-red-800 truncate">
                          {err.file}
                        </span>
                        <span className="text-xs text-red-200/70 [.light-theme_&]:!text-red-600/80 mt-0.5">
                          {err.error}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex gap-2.5 mt-3 pt-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setImportErrors([]);
                    }}
                    className="flex-1 py-3 px-4 bg-white/10 hover:bg-white/15 text-white/90 rounded-2xl text-xs sm:text-sm font-semibold transition cursor-pointer [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border [.light-theme_&]:!border-[#e2e8f0]"
                  >
                    重新选择文件
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setImportErrors([]);
                      onClose();
                    }}
                    className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-xs sm:text-sm font-bold transition cursor-pointer"
                  >
                    知道了 / 关闭
                  </button>
                </div>
              </div>
            ) : progress ? (
              <div className="py-4 sm:py-6 flex flex-col items-center justify-center text-center">
                <Loader2 className="w-10 h-10 animate-spin text-blue-500 mb-3.5" />
                <p className="text-base sm:text-lg font-bold text-center text-slate-100 [.light-theme_&]:!text-[#0f172a]">
                  {progress.message || "正在解析文件..."}
                </p>
                <p className="text-xs sm:text-sm font-semibold font-mono mt-2 tabular-nums text-slate-100/60 [.light-theme_&]:!text-slate-500">
                  还有 {progress.current}/{progress.total} 张卡
                </p>
              </div>
            ) : (
              <>
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-3xl py-7 sm:py-8 px-4 flex flex-col items-center justify-center cursor-pointer transition-all ${
                    isDragging
                      ? isLightMode
                        ? "border-blue-500 bg-[#eff6ff]"
                        : "border-blue-400 bg-blue-500/15"
                      : isLightMode
                        ? "border-[#cbd5e1] hover:border-blue-500 bg-[#f8fafc] hover:bg-[#eff6ff]"
                        : "border-white/15 hover:border-blue-400/50 bg-white/[0.04] hover:bg-white/[0.08]"
                  }`}
                >
                  <UploadCloud
                    className={`w-10 h-10 sm:w-12 sm:h-12 mb-3 transition-colors ${
                      isDragging 
                        ? "text-blue-500 scale-110" 
                        : isLightMode 
                          ? "text-blue-500/70" 
                          : "text-white/40"
                    }`}
                  />
                  <p className={`text-center text-sm sm:text-base font-bold mb-1 ${
                    isLightMode ? "text-[#0f172a]" : "text-white"
                  }`}>
                    点击上传或拖拽文件到此处
                  </p>
                  <p className={`text-center text-xs sm:text-sm leading-relaxed max-w-[280px] ${
                    isLightMode ? "text-[#64748b]" : "text-white/60"
                  }`}>
                    支持多个 PNG/JSON 格式，或包含文件夹结构的 ZIP 压缩包
                  </p>

                  <div className={`flex gap-3.5 mt-3.5 ${
                    isLightMode ? "text-[#64748b]" : "text-white/60"
                  }`}>
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <ImageIcon className="w-4 h-4 opacity-70" /> PNG
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <FileJson className="w-4 h-4 opacity-70" /> JSON
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <FileArchive className="w-4 h-4 opacity-70" /> ZIP
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between px-1">
                  <div
                    onClick={() => {
                      const next = !autoCategorizeSameName;
                      setAutoCategorizeSameName(next);
                      localStorage.setItem("miu_auto_categorize_same_name", next ? "true" : "false");
                    }}
                    className="flex items-center gap-3 cursor-pointer select-none transition py-1 text-white/90 hover:text-white [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:hover:!text-black"
                  >
                    <div
                      className={`w-5 h-5 rounded-lg flex items-center justify-center border transition shrink-0 ${
                        autoCategorizeSameName
                          ? "bg-white text-black border-white [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#cbd5e1]"
                          : "border-white/30 bg-black/30 [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:!bg-white [.light-theme_&]:hover:!bg-[#f1f5f9]"
                      }`}
                    >
                      {autoCategorizeSameName && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                    </div>
                    <span className="font-semibold text-xs sm:text-sm text-white/90 [.light-theme_&]:!text-[#0f172a]">
                      导入同名卡自动归入已有分类文件夹
                    </span>
                  </div>
                </div>

                <div className="mt-4 w-full flex justify-center">
                  <button 
                    onClick={(e) => { e.stopPropagation(); fetchTavernList(); }}
                    disabled={isPulling}
                    className="flex items-center gap-2 px-6 py-3.5 sm:py-4 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-blue-600 rounded-2xl font-bold text-sm sm:text-base transition-all duration-300 disabled:opacity-50 w-full justify-center border border-blue-500/20 hover:border-blue-500/40 shadow-sm cursor-pointer"
                  >
                    {isPulling ? <Loader2 className="w-5 h-5 animate-spin shrink-0" /> : <Cloud className="w-5 h-5 shrink-0" />}
                    <span className="truncate">拉取酒馆卡片</span>
                  </button>
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`mt-4 p-3.5 rounded-2xl text-xs sm:text-sm border font-medium ${
                      isLightMode
                        ? "bg-red-50 border-red-200 text-red-700"
                        : "bg-red-500/20 border-red-500/30 text-red-300"
                    }`}
                  >
                    {error}
                  </motion.div>
                )}
              </>
            )}

            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleFiles(e.target.files);
                }
                e.target.value = "";
              }}
              accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.json,.jsonl,.txt,.js,.zip,application/json,application/zip,application/x-zip-compressed,text/plain,text/javascript,*/*"
              className="hidden"
              multiple
            />
          </motion.div>
        </>
      )}

      {selectedTokenBreakdown && (
        <TokenBreakdownModal
          isOpen={!!selectedTokenBreakdown}
          onClose={() => setSelectedTokenBreakdown(null)}
          charName={selectedTokenBreakdown.name}
          breakdown={selectedTokenBreakdown.breakdown}
          isLightMode={isLightMode}
        />
      )}
    </AnimatePresence>
  );
}
