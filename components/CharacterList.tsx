import { Capacitor } from "@capacitor/core";
import { CURRENT_APP_VERSION } from "../config/version";
import { getFallbackAvatar, isFallbackMiuImage, resolveAvatarUrl, safeCreateObjectURL } from "../lib/avatar";
import React, { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Masonry from 'react-masonry-css';
import {
  Plus,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Trash2,
  CheckCircle2,
  Cloud,
  X,
  FolderInput,
  FolderPlus,
  UploadCloud,
  Search,
  LayoutGrid,
  List,
  Filter,
  Home,
  Menu,
  Edit2,
  MoreVertical,
  Download,
  ArrowUpDown,
  LayoutDashboard,
  Link,
  Link2,
  Loader2,
  Image as ImageIcon,
  Heart,
  Clock,
  ArrowLeftRight,
} from "lucide-react";
import { formatTokenCount, getCharacterTokenBreakdown, CharacterTokenBreakdown } from "../lib/tokens";
import {
  getCharacters,
  deleteCharacter,
  CharacterCard,
  saveCharacter,
  saveCharacters,
  getCharacter,
  getCharacterBlob,
  getCharacterThumb,
  updateCharacterCover,
  updateCharacterSortOrder,
  toggleCharacterFavorite,
  Folder,
  getFolders,
  getAllTags,
  saveFolder,
  deleteFolder,
  SortOption,
  getCachedMeta,
  getFolderPreviews,
  getCharacterCategoryPrefix,
  invalidateCache,
  normalizeSearchPath,
  SearchScope,
  filterCharacterMetasBySearch,
  renameTag,
  deleteTag,
  getCharacterListSummaryAndSlice,
  isCharacterNoImage,
  extractCharacterTags,
} from "../lib/db";
import { getLocalImageUrl } from "../lib/appBridge";
import { matchesFolderSearch, getFolderSearchScore as calcFolderSearchScore } from "../lib/searchUtils";
import { useInView } from "../lib/useInView";
import { useContinuousInView } from "../lib/useContinuousInView";
import { peekCachedUrl, putCachedBlobUrl, isCachedBlobUrl, releaseCachedUrl } from "../lib/thumbCache";
import { useBackHandler } from "../lib/useBackHandler";
import { getCardBadgeInfo } from "../lib/cardBadge";
import type JSZip from "jszip";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FrostedFolderCover, FrostedNewFolderCover } from "./FrostedFolderCover";

const TokenBreakdownModal = lazy(() => import("./TokenBreakdownModal").then((m) => ({ default: m.TokenBreakdownModal })));
const MoveToFolderModal = lazy(() => import("./MoveToFolderModal").then((m) => ({ default: m.MoveToFolderModal })));
const BindQRModal = lazy(() => import("./BindQRModal").then((m) => ({ default: m.BindQRModal })));
const ConfirmBindQRModal = lazy(() => import("./ConfirmBindQRModal").then((m) => ({ default: m.ConfirmBindQRModal })));
const FolderCoverPickerModal = lazy(() => import("./FolderCoverPickerModal").then((m) => ({ default: m.FolderCoverPickerModal })));
const CardCompareModal = lazy(() => import("./CardCompareModal").then((m) => ({ default: m.CardCompareModal })));
const Cropper = lazy(() => import("react-easy-crop"));

function useEverTrue(active: boolean) {
  const [ever, setEver] = useState(active);
  useEffect(() => {
    if (active && !ever) setEver(true);
  }, [active, ever]);
  return ever || active;
}

function SortableItemWrapper({
  id,
  children,
  disabled,
  className = "",
  isQR = false,
  activeDragIsQR = false,
  activeDragCharId = null,
}: {
  id: string;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
  isQR?: boolean;
  activeDragIsQR?: boolean;
  activeDragCharId?: string | null;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id, disabled });

  // 判断是否处于 QR 与普通角色的拖拽绑定交互中
  // 情况 1: 拖拽的是 QR 卡片，而当前卡片是普通角色卡（目标卡）
  // 情况 2: 拖拽的是普通角色卡，而当前卡片是 QR 卡片（目标卡）
  const isQRBindingTarget =
    !isDragging &&
    ((activeDragIsQR && !isQR) || (!!activeDragCharId && !activeDragIsQR && isQR));

  // 判断是否拖拽角色卡到文件夹目标上
  const isFolderDropTarget =
    !isDragging &&
    !!activeDragCharId &&
    id.startsWith("folder-");

  // 跨类型拖拽（绑定或移动进文件夹）交互时，禁止目标卡片和同屏其他卡片位移（禁止卡片逃跑）
  const shouldSuppressDisplacement =
    !isDragging &&
    (activeDragIsQR || (!!activeDragCharId && isQR) || isFolderDropTarget);

  const style: React.CSSProperties = {
    transform: isDragging
      ? CSS.Transform.toString(transform)
      : shouldSuppressDisplacement
        ? undefined
        : CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : (shouldSuppressDisplacement ? undefined : transition),
    opacity: isDragging ? 0.7 : 1,
    zIndex: isDragging ? 50 : isOver && (isQRBindingTarget || isFolderDropTarget) ? 30 : undefined,
    position: "relative",
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
    willChange: isDragging ? "transform" : undefined,
  };

  const showDropHighlight = isOver && isQRBindingTarget;
  const showFolderDropHighlight = isOver && isFolderDropTarget;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`select-none relative transition-transform duration-150 ${className} ${
        showDropHighlight
          ? "ring-4 ring-blue-500 ring-offset-2 ring-offset-[#1c1c1e] [.light-theme_&]:ring-offset-white rounded-2xl shadow-[0_0_25px_rgba(59,130,246,0.6)] scale-[1.04]"
          : showFolderDropHighlight
            ? "ring-4 ring-blue-500 ring-offset-2 ring-offset-[#1c1c1e] [.light-theme_&]:ring-offset-white rounded-2xl shadow-[0_0_25px_rgba(59,130,246,0.6)] scale-[1.04]"
            : ""
      }`}
    >
      {children}
      {showDropHighlight && (
        <div className="absolute inset-0 z-30 bg-blue-600/30 backdrop-blur-[2px] rounded-2xl flex flex-col items-center justify-center border-2 border-blue-400 pointer-events-none animate-pulse shadow-inner">
          <div className="w-10 h-10 rounded-2xl bg-blue-500/90 backdrop-blur-md flex items-center justify-center text-white shadow-lg mb-1.5 border border-white/20">
            <Link2 className="w-5 h-5 stroke-[2.2]" />
          </div>
          <span className="text-[11px] font-bold text-white bg-slate-900 [.light-theme_&]:!bg-[#007aff] [.light-theme_&]:!text-white px-3 py-1 rounded-full shadow-lg border border-blue-400/40 tracking-tight">
            松手立即绑定
          </span>
        </div>
      )}
      {showFolderDropHighlight && (
        <div className="absolute inset-0 z-30 bg-blue-600/30 backdrop-blur-[2px] rounded-3xl sm:rounded-2xl flex flex-col items-center justify-center border-2 border-blue-400 pointer-events-none animate-pulse shadow-inner">
          <div className="w-10 h-10 rounded-2xl bg-blue-500/90 backdrop-blur-md flex items-center justify-center text-white shadow-lg mb-1.5 border border-white/20">
            <FolderInput className="w-5 h-5 stroke-[2.2]" />
          </div>
          <span className="text-[11px] font-bold text-white bg-slate-900 [.light-theme_&]:!bg-[#007aff] [.light-theme_&]:!text-white px-3 py-1 rounded-full shadow-lg border border-blue-400/40 tracking-tight">
            松手移入文件夹
          </span>
        </div>
      )}
    </div>
  );
}

const compressImage = (file: File, maxDim = 400): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      let { width, height } = img;
      if (width > height && width > maxDim) {
        height *= maxDim / width;
        width = maxDim;
      } else if (height > maxDim) {
        width *= maxDim / height;
        height = maxDim;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Canvas toBlob failed"));
          },
          "image/webp",
          0.85,
        );
      } else {
        reject(new Error("Canvas context failed"));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };
    img.src = url;
  });
};

interface Props {
  key?: React.Key;
  folderId?: string | null;
  onSelect: (id: string) => void;
  onImport: () => void;
  onSelectFolder?: (id: string | null) => void;
  onOpenSidebar?: () => void;
  refreshTrigger?: number;
  isDetailOpen?: boolean;
  isLightMode?: boolean;
}

// 记忆每个文件夹所在的分页位置（在内存与 sessionStorage 中打通），避免在卡片详情或子文件夹返回时丢失第5页等当前页码
const folderPageMemory = new Map<string, number>();

function getFolderPage(folderKey: string): number {
  const inMem = folderPageMemory.get(folderKey);
  if (inMem && inMem > 0) return inMem;
  try {
    const raw = sessionStorage.getItem(`miu_folder_page_${folderKey}`);
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed > 0) {
        folderPageMemory.set(folderKey, parsed);
        return parsed;
      }
    }
  } catch (e) {}
  return 1;
}

function setFolderPage(folderKey: string, pageNum: number): void {
  if (pageNum <= 0) return;
  folderPageMemory.set(folderKey, pageNum);
  try {
    sessionStorage.setItem(`miu_folder_page_${folderKey}`, pageNum.toString());
  } catch (e) {}
}

const STARTUP_SNAPSHOT_KEY = "miu_startup_snapshot_v1";

interface StartupSnapshot {
  v: 1;
  sortBy: SortOption;
  pageSize: number;
  folders: Folder[];
  paginatedFolders: Folder[];
  folderPaths: Record<string, string>;
  folderCounts: Record<string, { chars: number; subfolders: number }>;
  folderAncestors: Record<string, Array<{ id: string; name: string }>>;
  characters: CharacterCard[];
  totalCharacters: number;
  totalAllCharacters: number;
  totalItems: number;
}

function readStartupSnapshot(
  folderId: string | null | undefined,
  page: number,
  sortBy: SortOption,
  pageSize: number,
): StartupSnapshot | null {
  if (folderId || page !== 1 || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STARTUP_SNAPSHOT_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    if (!snap || snap.v !== 1 || snap.sortBy !== sortBy || snap.pageSize !== pageSize) return null;
    if (!Array.isArray(snap.characters) || !Array.isArray(snap.folders)) return null;
    return snap as StartupSnapshot;
  } catch {
    return null;
  }
}

export function CharacterList({
  folderId,
  onSelect,
  onImport,
  onSelectFolder,
  onOpenSidebar,
  refreshTrigger,
  isDetailOpen = false,
  isLightMode: propIsLightMode = false,
}: Props) {
  const [isLightMode, setIsLightMode] = useState(() => {
    if (typeof propIsLightMode === "boolean" && propIsLightMode) return true;
    return (
      typeof document !== "undefined" &&
      (document.documentElement.classList.contains("light-theme") ||
        document.body.classList.contains("light-theme") ||
        localStorage.getItem("tavern_theme") === "light")
    );
  });

  useEffect(() => {
    const checkTheme = () => {
      const isLight =
        Boolean(propIsLightMode) ||
        (typeof document !== "undefined" &&
          (document.documentElement.classList.contains("light-theme") ||
            document.body.classList.contains("light-theme") ||
            localStorage.getItem("tavern_theme") === "light"));
      setIsLightMode(isLight);
    };
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    if (typeof document !== "undefined") {
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"],
      });
      window.addEventListener("storage", checkTheme);
    }
    return () => {
      observer.disconnect();
      if (typeof window !== "undefined") {
        window.removeEventListener("storage", checkTheme);
      }
    };
  }, [propIsLightMode]);
  const [showMainTokens, setShowMainTokens] = useState<boolean>(() => {
    return typeof localStorage !== "undefined" && localStorage.getItem("miu_show_main_page_tokens") !== "false";
  });

  useEffect(() => {
    const handleTokenVisChanged = (e: any) => {
      if (e.detail && typeof e.detail.show === "boolean") {
        setShowMainTokens(e.detail.show);
      } else if (typeof localStorage !== "undefined") {
        setShowMainTokens(localStorage.getItem("miu_show_main_page_tokens") !== "false");
      }
    };
    window.addEventListener("mainPageTokensVisibilityChanged", handleTokenVisChanged);
    return () => {
      window.removeEventListener("mainPageTokensVisibilityChanged", handleTokenVisChanged);
    };
  }, []);

  const folderKey = folderId || "root";
  const startupSnapRef = useRef<StartupSnapshot | null | undefined>(undefined);
  if (startupSnapRef.current === undefined) {
    const initPage = getFolderPage(folderKey);
    const initPageSize = Number(localStorage.getItem("tavern_pageSize")) || 50;
    const initSortBy = (localStorage.getItem("tavern_sortBy") as SortOption) || "newest_import";
    startupSnapRef.current = readStartupSnapshot(folderId, initPage, initSortBy, initPageSize);
  }
  const startupSnap = startupSnapRef.current;

  const [characters, setCharacters] = useState<CharacterCard[]>(() => startupSnap?.characters ?? []);
  const [folders, setFolders] = useState<Folder[]>(() => startupSnap?.folders ?? []);
  const [paginatedFolders, setPaginatedFolders] = useState<Folder[]>(
    () => startupSnap?.paginatedFolders ?? [],
  );
  const [folderPaths, setFolderPaths] = useState<Record<string, string>>(
    () => startupSnap?.folderPaths ?? {},
  );
  const [folderCounts, setFolderCounts] = useState<
    Record<string, { chars: number; subfolders: number }>
  >(() => startupSnap?.folderCounts ?? {});
  const [folderAncestors, setFolderAncestors] = useState<
    Record<string, Array<{ id: string; name: string }>>
  >(() => startupSnap?.folderAncestors ?? {});
  const [totalItems, setTotalItems] = useState(() => startupSnap?.totalItems ?? 0);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(() => Boolean(startupSnap));
  const [folderPreviews, setFolderPreviews] = useState<
    Record<string, any[]>
  >({});
  // 每次刷新文件夹预览图都会重新生成一批 blob URL, 这里记一份"当前挂着的"
  // 引用, 下次覆盖前先批量释放旧的, 避免每次翻页/切换文件夹都泄漏一批。
  const folderPreviewUrlsRef = useRef<string[]>([]);
  const setFolderPreviewsWithCleanup = (newPreviews: Record<string, any[]>) => {
    setFolderPreviews((prevPreviews) => {
      const mergedPreviews: Record<string, any[]> = {};
      const urlsToRevoke: string[] = [];

      const allFolderIds = new Set([
        ...Object.keys(prevPreviews || {}),
        ...Object.keys(newPreviews || {}),
      ]);

      for (const fId of allFolderIds) {
        const oldItems = prevPreviews[fId] || [];
        const newItems = newPreviews[fId] || [];

        if (newItems.length === 0) {
          oldItems.forEach((it) => {
            const u = typeof it === "string" ? it : it?.url;
            if (u && u.startsWith("blob:")) urlsToRevoke.push(u);
          });
          continue;
        }

        if (oldItems.length === 0) {
          mergedPreviews[fId] = newItems;
          continue;
        }

        // 严格校验新旧预览项：不仅要 seed/charId/isFallback 一致，URL 本身也必须相同且仍有效（绝不保留已被淘汰释放的旧 blob URL）
        const isIdentical =
          oldItems.length === newItems.length &&
          oldItems.every((oldIt, idx) => {
            const newIt = newItems[idx];
            const oldUrl = typeof oldIt === "string" ? oldIt : oldIt?.url;
            const newUrl = typeof newIt === "string" ? newIt : newIt?.url;
            if (!oldUrl || !newUrl || oldUrl !== newUrl) return false;
            if (oldUrl.startsWith("blob:") && !isCachedBlobUrl(oldUrl)) return false;
            const oldFallback = typeof oldIt === "string" ? false : Boolean(oldIt?.isFallback);
            const newFallback = typeof newIt === "string" ? false : Boolean(newIt?.isFallback);
            if (oldFallback !== newFallback) return false;
            const oldCharId = typeof oldIt === "string" ? undefined : oldIt?.charId;
            const newCharId = typeof newIt === "string" ? undefined : newIt?.charId;
            return oldCharId === newCharId;
          });

        if (isIdentical) {
          // 文件夹预览完全一致且 URL 仍存活: 保留原引用, 避免无效重渲染/闪烁
          mergedPreviews[fId] = oldItems;
        } else {
          // 使用新 URL, 淘汰旧 URL
          mergedPreviews[fId] = newItems;
          oldItems.forEach((it) => {
            const u = typeof it === "string" ? it : it?.url;
            if (u && u.startsWith("blob:")) urlsToRevoke.push(u);
          });
        }
      }

      const allCurrentUrls = Object.values(mergedPreviews)
        .flat()
        .map((p) => (typeof p === "string" ? p : p.url));
      const activeUrlSet = new Set(allCurrentUrls);
      folderPreviewUrlsRef.current = allCurrentUrls;

      if (urlsToRevoke.length > 0) {
        requestAnimationFrame(() => {
          urlsToRevoke.forEach((u) => {
            if (u && u.startsWith("blob:") && !activeUrlSet.has(u) && !isCachedBlobUrl(u)) {
              URL.revokeObjectURL(u);
            }
          });
        });
      }

      return mergedPreviews;
    });
  };
  useEffect(() => {
    return () => {
      folderPreviewUrlsRef.current.forEach((u) => {
        // 缩略图缓存持有的 URL 交给 LRU 自己释放(否则会把缓存里的图释放掉, 图会裂)
        if (u.startsWith("blob:") && !isCachedBlobUrl(u)) URL.revokeObjectURL(u);
      });
    };
  }, []);
  const [totalCharacters, setTotalCharacters] = useState(() => startupSnap?.totalCharacters ?? 0);
  const [totalAllCharacters, setTotalAllCharacters] = useState(() => startupSnap?.totalAllCharacters ?? 0);

  const prevFolderKeyRef = useRef<string>(folderKey);

  const [page, setPage] = useState<number>(() => {
    return getFolderPage(folderKey);
  });
  const [pageInputValue, setPageInputValue] = useState(() =>
    String(getFolderPage(folderKey)),
  );

  // 文件夹切换或从详情页/子文件夹返回时，同步恢复对应 folderKey 记忆的页码
  useEffect(() => {
    if (prevFolderKeyRef.current !== folderKey) {
      prevFolderKeyRef.current = folderKey;
      const targetPage = getFolderPage(folderKey);
      setPage(targetPage);
      setPageInputValue(targetPage.toString());
    }
  }, [folderKey]);

  useEffect(() => {
    setPageInputValue(page.toString());
  }, [page]);

  const [pageSize, setPageSize] = useState(
    () => Number(localStorage.getItem("tavern_pageSize")) || 50,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("basic");
  // 搜索框本身要立即响应输入(不然打字会卡顿感), 但真正触发查询用防抖后的值,
  // 避免每敲一个字就对全部角色做一次全量过滤+排序。
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  const searchScopeOptions: { id: SearchScope; label: string; placeholder: string }[] = [
    { id: "basic", label: "卡名/标签", placeholder: "搜索角色、标签或 文件夹/卡名..." },
    { id: "all", label: "全部内容", placeholder: "搜卡名、作者、备注、开场白、备忘录..." },
    { id: "creator", label: "作者", placeholder: "搜索作者名称..." },
    { id: "creator_notes", label: "作者备注", placeholder: "搜索作者备注..." },
    { id: "greetings", label: "开场白", placeholder: "搜索开场白内容..." },
    { id: "memos", label: "备忘录", placeholder: "搜索备忘录内容..." },
    { id: "content", label: "设定/世界书", placeholder: "搜索设定、描述、世界书..." },
  ];
  const activeScopeOption = searchScopeOptions.find((o) => o.id === searchScope) || searchScopeOptions[0];

  // 搜索历史记录 (保留 3-5 条，支持删除和全部清除)
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem("miu_search_history");
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
    } catch {
      return [];
    }
  });
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const suppressFocusPopupRef = useRef(false);

  const selectSearchScope = useCallback((nextScope: SearchScope) => {
    setSearchScope(nextScope);
    setIsSearchFocused(false);
    setDebouncedSearchQuery(searchQuery);
    suppressFocusPopupRef.current = true;
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      setTimeout(() => {
        suppressFocusPopupRef.current = false;
      }, 150);
    });
  }, [searchQuery]);

  const saveSearchToHistory = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearchHistory((prev) => {
      const filtered = prev.filter((item) => item !== trimmed);
      const updated = [trimmed, ...filtered].slice(0, 5);
      try {
        localStorage.setItem("miu_search_history", JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  const deleteSearchHistoryItem = useCallback((itemToDelete: string, e?: React.MouseEvent | React.PointerEvent) => {
    e?.stopPropagation();
    setSearchHistory((prev) => {
      const updated = prev.filter((item) => item !== itemToDelete);
      try {
        localStorage.setItem("miu_search_history", JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  const clearAllSearchHistory = useCallback((e?: React.MouseEvent | React.PointerEvent) => {
    e?.stopPropagation();
    setSearchHistory([]);
    try {
      localStorage.removeItem("miu_search_history");
    } catch {}
  }, []);

  // 搜索历史只在「离开搜索框」时存一次（回车 / 点历史项 / 点清空按钮也会存）。
  // 之前是打字停 1 秒就存，手机上打字一停顿就会把「阿 / 阿波 / 阿波菲斯」这种半截词
  // 也写进历史，只留 5 条，很快被自己的输入挤满。
  const handleSearchBlur = useCallback(() => {
    saveSearchToHistory(searchQuery);
  }, [searchQuery, saveSearchToHistory]);

  useEffect(() => {
    const handlePointerDownOutside = (e: PointerEvent | MouseEvent | TouchEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsSearchFocused(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDownOutside);
    return () => document.removeEventListener("pointerdown", handlePointerDownOutside);
  }, []);
  const [viewMode, setViewMode] = useState<"grid" | "list" | "masonry">(
    () =>
      (localStorage.getItem("tavern_viewMode") as
        "grid" | "list" | "masonry") || "grid",
  );

  useEffect(() => {
    localStorage.setItem("tavern_viewMode", viewMode);
  }, [viewMode]);
  const [sortBy, setSortBy] = useState<SortOption>(
    () =>
      (localStorage.getItem("tavern_sortBy") as SortOption) || "newest_import",
  );
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [tokenModalChar, setTokenModalChar] = useState<{
    name: string;
    breakdown: CharacterTokenBreakdown;
  } | null>(null);

  const handleOpenTokenBreakdown = useCallback(async (char: CharacterCard) => {
    try {
      let data = char.data;
      if (!data || Object.keys(data).length === 0) {
        const fullChar = await getCharacter(char.id);
        if (fullChar?.data) data = fullChar.data;
      }
      const breakdown = getCharacterTokenBreakdown(data);
      setTokenModalChar({
        name: char.name,
        breakdown,
      });
    } catch (err) {
      console.error("Failed to load token breakdown", err);
    }
  }, []);

  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  useEffect(() => {
    if (prevFolderKeyRef.current === folderKey && !debouncedSearchQuery && selectedTags.length === 0) {
      setFolderPage(folderKey, page);
    }
  }, [folderKey, page, debouncedSearchQuery, selectedTags.length]);

  const [tagActionModal, setTagActionModal] = useState<string | null>(null);
  const [renamingTagData, setRenamingTagData] = useState<{ old: string; new: string } | null>(null);
  const [isTagEditMode, setIsTagEditMode] = useState(false);
  const [isTagMutating, setIsTagMutating] = useState(false);
  const tagLongPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const tagLongPressTriggeredRef = useRef(false);

  const handleTagTouchStart = (tag: string) => {
    tagLongPressTriggeredRef.current = false;
    if (tagLongPressTimerRef.current) clearTimeout(tagLongPressTimerRef.current);
    tagLongPressTimerRef.current = setTimeout(() => {
      tagLongPressTriggeredRef.current = true;
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try { navigator.vibrate(40); } catch (e) {}
      }
      setTagActionModal(tag);
    }, 550);
  };

  const handleTagTouchEnd = () => {
    if (tagLongPressTimerRef.current) {
      clearTimeout(tagLongPressTimerRef.current);
      tagLongPressTimerRef.current = null;
    }
  };

  const [tagSearchQuery, setTagSearchQuery] = useState("");
  const [isTagSearchOpen, setIsTagSearchOpen] = useState(false);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [comparePairIds, setComparePairIds] = useState<[string, string] | null>(null);
  const [pendingQRBinding, setPendingQRBinding] = useState<{
    qrChar: CharacterCard;
    targetChar: CharacterCard;
  } | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const touchStartRef = useRef<{
    x: number;
    y: number;
    time: number;
    isEdge: boolean;
  } | null>(null);
  const isDraggingRef = useRef(false);
  const lastDragEndTimeRef = useRef(0);

  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [isCropping, setIsCropping] = useState(false);
  const [coverPickerFolder, setCoverPickerFolder] = useState<Folder | null>(null);

  const getCroppedImgBlob = async (
    imageSrc: string,
    pixelCrop: any,
  ): Promise<Blob | null> => {
    const image = new Image();
    image.src = imageSrc;
    await new Promise((resolve) => {
      image.onload = resolve;
    });

    const canvas = document.createElement("canvas");
    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;
    const ctx = canvas.getContext("2d");

    if (!ctx) return null;

    ctx.drawImage(
      image,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      pixelCrop.width,
      pixelCrop.height,
    );

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob);
      }, "image/png");
    });
  };

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const isImg = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(file.name);
      if (!isImg) {
        alert("所选文件不是图片格式，请选择图片文件。");
        if (coverInputRef.current) coverInputRef.current.value = "";
        return;
      }
      const url = URL.createObjectURL(file);
      setImageToCrop(url);
      if (coverInputRef.current) {
        coverInputRef.current.value = "";
      }
    }
  };

  const closeCrop = () => {
    if (imageToCrop && imageToCrop.startsWith("blob:")) {
      URL.revokeObjectURL(imageToCrop);
    }
    setImageToCrop(null);
  };

  const handleSaveCrop = async () => {
    if (imageToCrop && croppedAreaPixels) {
      setIsCropping(true);
      try {
        const croppedBlob = await getCroppedImgBlob(
          imageToCrop,
          croppedAreaPixels,
        );
        if (!croppedBlob) {
          setIsCropping(false);
          closeCrop();
          return;
        }

        const allFolders = await getFolders();
        let compressedFolderBlob: Blob | null = null;

        // We typecast croppedBlob as File for compressImage because it inherits it theoretically.
        // It's just a Blob, but standard compressImage can work or fail then fallback.
        const croppedFile = new File([croppedBlob], "cropped.png", {
          type: "image/png",
        });

        const charIdsToCover: string[] = [];
        const foldersToSave: Folder[] = [];

        for (const id of selectedIds) {
          const folder = allFolders.find((f) => f.id === id);
          if (folder) {
            if (!compressedFolderBlob) {
              try {
                compressedFolderBlob = await compressImage(croppedFile, 400);
              } catch (err) {
                compressedFolderBlob = croppedBlob;
              }
            }
            folder.avatarBlob = compressedFolderBlob;
            foldersToSave.push(folder);
          } else {
            charIdsToCover.push(id);
          }
        }

        closeCrop();
        setSelectionMode(false);
        setSelectedIds(new Set());


        if (foldersToSave.length > 0) {
          await Promise.all(foldersToSave.map((f) => saveFolder(f)));
          setFolders((prev) =>
            prev.map((folder) => {
              const updated = foldersToSave.find((f) => f.id === folder.id);
              return updated
                ? { ...folder, avatarBlob: updated.avatarBlob }
                : folder;
            }),
          );
        }
        if (charIdsToCover.length > 0) {
          const coverUpdatedAt = Date.now();
          await Promise.all(
            charIdsToCover.map((id) => updateCharacterCover(id, croppedBlob)),
          );
          setCharacters((prev) =>
            prev.map((char) =>
              charIdsToCover.includes(char.id)
                ? { ...char, updatedAt: coverUpdatedAt }
                : char,
            ),
          );
        }
      } catch (err) {
        console.error("Error saving cropped image:", err);
        alert("封面更换失败");
      } finally {
        setIsCropping(false);
      }
    }
  };

  const onCropComplete = useCallback(
    (croppedArea: any, croppedAreaPixels: any) => {
      setCroppedAreaPixels(croppedAreaPixels);
    },
    [],
  );

  const handleSetCharacterAsFolderCover = async (folder: Folder, char: CharacterCard) => {
    try {
      let avatarBlob = char.avatarBlob;
      if (!avatarBlob && char.hasBlobsSeparated) {
        const blobs = await getCharacterBlob(char.id);
        avatarBlob = blobs?.avatarBlob;
      }
      if (!avatarBlob && char.avatarUrlFallback) {
        try {
          const res = await fetch(char.avatarUrlFallback);
          if (res.ok) avatarBlob = await res.blob();
        } catch (e) {}
      }
      // 卡片本身没有真图(取到的是默认占位图)时不许当封面 ——
      // 否则文件夹封面会被占位图顶掉, 而且永远显示不出来是"哪张卡"
      if (avatarBlob) {
        try {
          const { isPlaceholderImageBlob } = await import('../lib/placeholder');
          if (await isPlaceholderImageBlob(avatarBlob)) {
            avatarBlob = undefined;
          }
        } catch {}
      }
      if (!avatarBlob) {
        alert('这张卡没有自己的图，不能作为文件夹封面');
        return;
      }
      if (avatarBlob) {
        let compressedBlob = avatarBlob;
        try {
          compressedBlob = await compressImage(new File([avatarBlob], "cover.png", { type: avatarBlob.type || "image/png" }), 400);
        } catch (e) {}
        const updatedFolder: Folder = { ...folder, avatarBlob: compressedBlob };
        await saveFolder(updatedFolder);
        setFolders((prev) => prev.map((f) => (f.id === folder.id ? updatedFolder : f)));
        setCoverPickerFolder(null);
        setSelectionMode(false);
        setSelectedIds(new Set());
        loadData();
      }
    } catch (err) {
      console.error("Failed to set character as folder cover:", err);
    }
  };

  const handleResetFolderCover = async (folder: Folder) => {
    try {
      const updatedFolder: Folder = { ...folder, avatarBlob: undefined };
      await saveFolder(updatedFolder);
      setFolders((prev) => prev.map((f) => (f.id === folder.id ? updatedFolder : f)));
      setCoverPickerFolder(null);
      setSelectionMode(false);
      setSelectedIds(new Set());
      loadData();
    } catch (err) {
      console.error("Failed to reset folder cover:", err);
    }
  };
  const [currentFolderName, setCurrentFolderName] = useState<string | null>(
    null,
  );
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [isBindModalOpen, setIsBindModalOpen] = useState(false);

  const everMoveModalOpen = useEverTrue(isMoveModalOpen);
  const everBindModalOpen = useEverTrue(isBindModalOpen);
  const everConfirmBindOpen = useEverTrue(!!pendingQRBinding);
  const everCoverPickerOpen = useEverTrue(!!coverPickerFolder);
  const everTokenModalOpen = useEverTrue(!!tokenModalChar);
  const everCompareModalOpen = useEverTrue(!!comparePairIds);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    message?: string;
  } | null>(null);
  const longPressRef = useRef<{
    timer: NodeJS.Timeout | null;
    triggered: boolean;
    startX?: number;
    startY?: number;
  }>({ timer: null, triggered: false });

  const [googleUser, setGoogleUser] = useState<any>(() => {
    if (typeof localStorage === "undefined") return null;
    try {
      const raw = localStorage.getItem("google_drive_user_info");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const handleAuthChange = (e: any) => {
      if (e.detail) setGoogleUser(e.detail.user);
    };
    window.addEventListener('google_auth_changed', handleAuthChange);
    return () => window.removeEventListener('google_auth_changed', handleAuthChange);
  }, []);

  const [showScrollTop, setShowScrollTop] = useState(false);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [isFoldersExpanded, setIsFoldersExpanded] = useState(
    () => localStorage.getItem("tavern_foldersExpanded") !== "false",
  );
  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  // 如果进入了子文件夹，按返回键（网页后退/安卓返回键/侧滑手势）时返回上一级目录
  // 核心安全保障：如果角色卡详情正处于打开状态，必须由详情自身处理返回，严禁穿透触发退出文件夹！
  useBackHandler(!!folderId && !isDetailOpen, () => {
    handleBack();
    return true;
  });

  // 如果正处于多选模式，按返回键直接退出多选模式（由于后注册，优先级高于返回上一级目录）
  useBackHandler(selectionMode && !comparePairIds, () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    return true;
  });

  useBackHandler(Boolean(tagActionModal || renamingTagData), () => {
    if (renamingTagData) setRenamingTagData(null);
    else if (tagActionModal) setTagActionModal(null);
    return true;
  });

  // 进入多选模式时，立即唤起并展示顶部操作栏
  useEffect(() => {
    if (selectionMode) {
      setIsHeaderVisible(true);
    }
  }, [selectionMode]);

  useEffect(() => {
    localStorage.setItem(
      "tavern_foldersExpanded",
      isFoldersExpanded.toString(),
    );
  }, [isFoldersExpanded]);

  useEffect(() => {
    localStorage.setItem("tavern_pageSize", pageSize.toString());
  }, [pageSize]);

  useEffect(() => {
    localStorage.setItem("tavern_sortBy", sortBy);
  }, [sortBy]);

  useEffect(() => {
    const scrollContainer = document.getElementById("main-scroll-container");
    let lastScroll = scrollContainer
      ? scrollContainer.scrollTop
      : window.scrollY || document.documentElement.scrollTop || 0;
    let upAccumulator = 0;
    let downAccumulator = 0;

    const handleScroll = () => {
      const currentScrollY = scrollContainer
        ? scrollContainer.scrollTop
        : window.scrollY || document.documentElement.scrollTop || 0;

      setShowScrollTop(currentScrollY > 500);

      const delta = currentScrollY - lastScroll;

      // 靠近页面顶部（<=80px）时始终保持显示
      if (currentScrollY <= 80) {
        setIsHeaderVisible(true);
        upAccumulator = 0;
        downAccumulator = 0;
      } else if (delta < 0) {
        // 向上滑动（手指往下拉或回滑浏览）：哪怕只滑一点点（累计>=8px），立即弹出顶部操作栏
        downAccumulator = 0;
        upAccumulator += Math.abs(delta);
        if (upAccumulator >= 8) {
          setIsHeaderVisible(true);
        }
      } else if (delta > 0) {
        // 向下滑动浏览（页面往下滚）：累计滑动超过24px才隐藏，避免微小抖动误触
        upAccumulator = 0;
        downAccumulator += delta;
        if (downAccumulator >= 24) {
          setIsHeaderVisible(false);
        }
      }

      lastScroll = currentScrollY;
    };

    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    }
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      if (scrollContainer) {
        scrollContainer.removeEventListener("scroll", handleScroll);
      }
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const scrollToTop = () => {
    const scrollContainer = document.getElementById("main-scroll-container");
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleBack = async () => {
    if (!folderId) return;
    if (folderId === "favorites" || folderId === "all") {
      onSelectFolder?.(null);
      return;
    }
    const allFolders = await getFolders();
    const current = allFolders.find((f) => f.id === folderId);
    onSelectFolder?.(current?.parentId || null);
  };
  const handleRootTouchStart = (e: React.TouchEvent) => {
    // 拖拽中、弹窗打开、多选模式时不记录手势
    if (
      isDraggingRef.current ||
      activeDragId ||
      pendingQRBinding ||
      isBindModalOpen ||
      isMoveModalOpen ||
      selectionMode
    ) {
      touchStartRef.current = null;
      return;
    }

    // 如果触摸起始于卡片、按钮、输入框等可交互元素，属于卡片操作或拖拽准备，绝不当作返回手势
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, a, input, [data-sortable-id], [role='button']")) {
      touchStartRef.current = null;
      return;
    }

    const touch = e.touches[0];
    // 允许从左侧边缘及边距空白区域（<= 75px）舒适起划，不再受限于极窄25px
    if (touch && touch.clientX <= 75) {
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
        isEdge: true,
      };
    } else {
      touchStartRef.current = null;
    }
  };

  const handleRootTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const touch = e.changedTouches[0];
    if (!start || !touch) return;

    // 拖拽中、刚结束拖拽（600ms内）或处于多选/弹窗状态时严禁触发手势返回
    if (
      isDraggingRef.current ||
      activeDragId ||
      Date.now() - lastDragEndTimeRef.current < 600 ||
      selectionMode ||
      pendingQRBinding ||
      isBindModalOpen ||
      isMoveModalOpen
    ) {
      return;
    }

    const elapsed = Date.now() - start.time;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    // 起始于左侧非卡片区域、快速轻扫(<=400ms)、水平右滑明显(>70px)且垂直偏移小(<60px)才返回上一级
    if (folderId && elapsed <= 400 && dx > 70 && Math.abs(dy) < 60) {
      handleBack();
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      setIsCreatingFolder(false);
      return;
    }
    const newFolder: Folder = {
      id: crypto.randomUUID(),
      name: newFolderName.trim(),
      createdAt: Date.now(),
      parentId: folderId || null,
    };
    await saveFolder(newFolder);
    setNewFolderName("");
    setIsCreatingFolder(false);
    loadData();
  };

  const handleUpdateFolder = async () => {
    if (!editingFolder || !newFolderName.trim()) {
      setEditingFolder(null);
      return;
    }
    await saveFolder({ ...editingFolder, name: newFolderName.trim() });
    setEditingFolder(null);
    setNewFolderName("");
    loadData();
  };

  const handleDeleteFolder = async (id: string, name: string) => {
    if (
      confirm(
        `确定要删除文件夹 "${name}" 吗？\n文件夹将被直接删除，其内的所有角色都将被移至回收站。`,
      )
    ) {
      setProgress({
        current: 0,
        total: 100,
        message: "正在准备删除...",
      });
      await deleteFolder(id, (current, total, msg) => {
        setProgress({
          current,
          total,
          message: msg,
        });
      });
      setProgress(null);
      loadData();
    }
  };

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 10,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 400,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const checkIsQR = (char: any): boolean => {
    if (!char) return false;
    if (char.isQR === true) return true;
    if (getCharacterCategoryPrefix(char) === "快速回复") return true;
    if (char.tags && Array.isArray(char.tags) && char.tags.includes("快速回复")) return true;
    return false;
  };

  const characterMap = useMemo(() => {
    const map = new Map<string, CharacterCard>();
    for (const c of characters) {
      map.set(c.id, c);
    }
    return map;
  }, [characters]);

  const activeChar =
    activeDragId && activeDragId.startsWith("char-")
      ? characterMap.get(activeDragId.replace("char-", "")) || null
      : null;
  const activeIsQR = activeChar ? checkIsQR(activeChar) : false;

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);

    const isFolder = activeIdStr.startsWith("folder-");

    if (isFolder) {
      const activeId = activeIdStr.replace("folder-", "");
      const overId = overIdStr.replace("folder-", "");

      // 1. Immediately update paginatedFolders state synchronously for real-time UI response
      const oldPagIndex = paginatedFolders.findIndex((f) => f.id === activeId);
      const newPagIndex = paginatedFolders.findIndex((f) => f.id === overId);

      if (oldPagIndex !== -1 && newPagIndex !== -1 && oldPagIndex !== newPagIndex) {
        const newPag = arrayMove(paginatedFolders, oldPagIndex, newPagIndex);
        setPaginatedFolders(newPag);
      }

      // 2. Immediately update full folders array and persist sortOrder
      const oldIndex = folders.findIndex((f) => f.id === activeId);
      const newIndex = folders.findIndex((f) => f.id === overId);

      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const newFolders = arrayMove(folders, oldIndex, newIndex);
        newFolders.forEach((f, i) => {
          f.sortOrder = i;
        });
        setFolders(newFolders);
        // Persist new orders to db
        await Promise.all(newFolders.map((f) => saveFolder(f)));
      }

      if (sortBy !== "custom") {
        setSortBy("custom");
      }
      return;
    } else {
      const activeId = activeIdStr.replace("char-", "");
      const overId = overIdStr.replace("char-", "");

      // 拖拽角色卡到文件夹上：直接移动到该文件夹
      if (overIdStr.startsWith("folder-")) {
        const targetFolderId = overIdStr.replace("folder-", "");
        const targetFolder = folders.find((f) => f.id === targetFolderId);
        if (targetFolder) {
          const idsToMove =
            selectedIds.has(activeId) && selectedIds.size > 0
              ? Array.from(selectedIds).filter(
                  (id) => !folders.some((f) => f.id === id),
                )
              : [activeId];

          const movedCharIds = new Set(idsToMove);
          setCharacters((prev) => prev.filter((c) => !movedCharIds.has(c.id)));
          setTotalCharacters((prev) => Math.max(0, prev - movedCharIds.size));
          setTotalItems((prev) => Math.max(0, prev - movedCharIds.size));
          setSelectedIds(new Set());
          setSelectionMode(false);

          for (const cId of idsToMove) {
            const char = await getCharacter(cId);
            if (char) {
              char.folderId = targetFolderId;
              await saveCharacter(char);
            }
          }
          invalidateCache();
          loadData();
        }
        return;
      }

      const charA = characters.find((c) => c.id === activeId);
      const charB = characters.find((c) => c.id === overId);

      if (charA && charB) {
        const isAQR = checkIsQR(charA);
        const isBQR = checkIsQR(charB);

        // One is QR and the other is a regular character -> Prompt QR binding confirmation!
        if ((isAQR && !isBQR) || (!isAQR && isBQR)) {
          const qrChar = isAQR ? charA : charB;
          const targetChar = isAQR ? charB : charA;
          setPendingQRBinding({ qrChar, targetChar });
          setSelectionMode(false);
          setSelectedIds(new Set());
          return;
        }
      }

      if (sortBy !== "custom") {
        setSortBy("custom");
      }

      const oldIndex = characters.findIndex((c) => c.id === activeId);
      const newIndex = characters.findIndex((c) => c.id === overId);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newChars = arrayMove(characters, oldIndex, newIndex);
        setCharacters(newChars);
        // Save new order to db
        newChars.forEach((c, i) => {
          updateCharacterSortOrder(c.id, i);
        });
      }
    }
  };

  const loadDataReqIdRef = useRef(0);
  const skipClampedPageRef = useRef<number | null>(null);
  const loadData = async () => {
    const reqId = ++loadDataReqIdRef.current;
    if (debouncedSearchQuery.trim()) {
      setIsSearching(true);
    }
    try {
      const allFoldersData = await getFolders();
      if (reqId !== loadDataReqIdRef.current) return;

      const folderMap = new Map<string, Folder>();
      allFoldersData.forEach((f) => folderMap.set(f.id, f));

      const pathMap: Record<string, string> = {};
      const ancestorMap: Record<string, Array<{ id: string; name: string }>> = {};
      const subfolderCountMap: Record<string, number> = {};

      for (const f of allFoldersData) {
        if (f.parentId) {
          subfolderCountMap[f.parentId] = (subfolderCountMap[f.parentId] || 0) + 1;
        }
        const parts: string[] = [];
        const ancestors: Array<{ id: string; name: string }> = [];
        let curr: Folder | undefined = f;
        const visited = new Set<string>();
        while (curr && !visited.has(curr.id)) {
          visited.add(curr.id);
          parts.unshift(curr.name);
          ancestors.unshift({ id: curr.id, name: curr.name });
          curr = curr.parentId ? folderMap.get(curr.parentId) : undefined;
        }
        pathMap[f.id] = parts.join(" / ");
        ancestorMap[f.id] = ancestors;
      }

      setFolderPaths(pathMap);
      setFolderAncestors(ancestorMap);

      let currentFolders: Folder[] = [];
      const hasSearch = !!debouncedSearchQuery.trim();
      const rawQ = debouncedSearchQuery.trim();

      const matchesFolder = (f: Folder): boolean => {
        return matchesFolderSearch(f.name, pathMap[f.id] || f.name, rawQ);
      };

      const allowFolderResults = hasSearch && (searchScope === "basic" || searchScope === "all");

      if (folderId === null) {
        if (hasSearch) {
          currentFolders = allowFolderResults ? allFoldersData.filter(matchesFolder) : [];
        } else {
          currentFolders = allFoldersData.filter((f) => !f.parentId);
        }
        setCurrentFolderName(null);
      } else if (folderId === "favorites") {
        currentFolders = [];
        setCurrentFolderName("我的收藏");
      } else {
        const currentFolder = folderMap.get(folderId);
        if (currentFolder) setCurrentFolderName(currentFolder.name);

        if (hasSearch) {
          if (allowFolderResults) {
            const descendantIds = new Set<string>();
            const collectDescendants = (pid: string) => {
              for (const f of allFoldersData) {
                if (f.parentId === pid && !descendantIds.has(f.id)) {
                  descendantIds.add(f.id);
                  collectDescendants(f.id);
                }
              }
            };
            collectDescendants(folderId);
            currentFolders = allFoldersData.filter(
              (f) => descendantIds.has(f.id) && matchesFolder(f),
            );
          } else {
            currentFolders = [];
          }
        } else {
          currentFolders = allFoldersData.filter((f) => f.parentId === folderId);
        }
      }

      const applyFolderSort = (a: Folder, b: Folder) => {
        switch (sortBy) {
          case "custom":
            if (a.sortOrder !== undefined && b.sortOrder !== undefined)
              return a.sortOrder - b.sortOrder;
            if (a.sortOrder !== undefined) return -1;
            if (b.sortOrder !== undefined) return 1;
            return b.createdAt - a.createdAt;
          case "newest_import":
            return b.createdAt - a.createdAt;
          case "oldest_import":
            return a.createdAt - b.createdAt;
          case "recently_modified": {
            const timeA = (a as any).updatedAt || a.createdAt;
            const timeB = (b as any).updatedAt || b.createdAt;
            return timeB - timeA;
          }
          case "a_z":
            return a.name.localeCompare(b.name, "zh-CN");
          case "z_a":
            return b.name.localeCompare(a.name, "zh-CN");
          default:
            return b.createdAt - a.createdAt;
        }
      };

      currentFolders.sort((a, b) => {
        if (hasSearch) {
          const scoreA = calcFolderSearchScore(a.name, pathMap[a.id] || a.name, rawQ);
          const scoreB = calcFolderSearchScore(b.name, pathMap[b.id] || b.name, rawQ);
          if (scoreA !== scoreB) {
            return scoreB - scoreA;
          }
        }
        return applyFolderSort(a, b);
      });

      setFolders(currentFolders);

      const currentVisibleFolders = selectedTags.length > 0 ? [] : currentFolders;
      const totalFolderCount = currentVisibleFolders.length;

      const summary = await getCharacterListSummaryAndSlice({
        folderId,
        searchQuery: debouncedSearchQuery,
        tags: selectedTags,
        searchScope,
        sortBy,
        page,
        pageSize,
        visibleFolderCount: totalFolderCount,
      });
      if (reqId !== loadDataReqIdRef.current) return;

      const countsMap: Record<string, { chars: number; subfolders: number }> = {};
      for (const f of allFoldersData) {
        countsMap[f.id] = {
          chars: summary.folderCharCounts[f.id] || 0,
          subfolders: subfolderCountMap[f.id] || 0,
        };
      }
      setFolderCounts(countsMap);

      setTotalCharacters(summary.totalChars);
      setTotalAllCharacters(summary.totalAllChars);
      const itemsTotal = totalFolderCount + summary.totalChars;
      setTotalItems(itemsTotal);

      if (summary.effectivePage !== page) {
        skipClampedPageRef.current = summary.effectivePage;
        setPage(summary.effectivePage);
      }

      const pageStart = (summary.effectivePage - 1) * pageSize;
      const pageEnd = summary.effectivePage * pageSize;
      const folderStart = Math.max(0, Math.min(totalFolderCount, pageStart));
      const folderEnd = Math.max(0, Math.min(totalFolderCount, pageEnd));
      const pageFolders = currentVisibleFolders.slice(folderStart, folderEnd);

      setPaginatedFolders(pageFolders);
      setCharacters(summary.characters);
      const nextChars = summary.characters;

      if (!folderId && summary.effectivePage === 1 && !debouncedSearchQuery.trim() && selectedTags.length === 0) {
        try {
          const compactChars = nextChars.map((c) => {
            const copy: any = { ...c };
            delete copy.data;
            delete copy.avatarBlob;
            delete copy.thumbBlob;
            if (typeof copy.avatar === "string" && copy.avatar.length > 512) {
              delete copy.avatar;
            }
            return copy;
          });
          const snapshot: StartupSnapshot = {
            v: 1,
            sortBy,
            pageSize,
            folders: currentFolders,
            paginatedFolders: pageFolders,
            folderPaths: pathMap,
            folderCounts: countsMap,
            folderAncestors: ancestorMap,
            characters: compactChars,
            totalCharacters: summary.totalChars,
            totalAllCharacters: summary.totalAllChars,
            totalItems: itemsTotal,
          };
          localStorage.setItem(STARTUP_SNAPSHOT_KEY, JSON.stringify(snapshot));
        } catch {}
      }

      // 文件夹封面缩略图异步后台加载，绝不阻塞列表和卡片首屏展示
      if (pageFolders.length > 0) {
        const previewFolderIds = pageFolders.map((f) => f.id);
        void getFolderPreviews(previewFolderIds, allFoldersData)
          .then((previews) => {
            if (reqId !== loadDataReqIdRef.current) return;
            setFolderPreviewsWithCleanup(previews);
          })
          .catch((err) => {
            console.error("Failed to load folder previews", err);
          });
      } else {
        setFolderPreviewsWithCleanup({});
      }
    } catch (err) {
      console.error("Failed to load data in CharacterList", err);
    } finally {
      if (reqId === loadDataReqIdRef.current) {
        setHasLoadedOnce(true);
        setIsSearching(false);
      }
    }
  };

  useEffect(() => {
    if (isComposingRef.current) return;
    if (!searchQuery) {
      setDebouncedSearchQuery("");
      return;
    }
    const t = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 200);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearchQuery, selectedTags, searchScope]);

  const prevLoadDepsRef = useRef<{
    pageSize: number;
    folderId: string | null | undefined;
    debouncedSearchQuery: string;
    selectedTags: string[];
    sortBy: SortOption;
    searchScope: SearchScope;
    refreshTrigger: number | undefined;
  } | null>(null);

  useEffect(() => {
    const prev = prevLoadDepsRef.current;
    const onlyPageChanged =
      prev !== null &&
      prev.pageSize === pageSize &&
      prev.folderId === folderId &&
      prev.debouncedSearchQuery === debouncedSearchQuery &&
      prev.selectedTags === selectedTags &&
      prev.sortBy === sortBy &&
      prev.searchScope === searchScope &&
      prev.refreshTrigger === refreshTrigger;

    prevLoadDepsRef.current = {
      pageSize,
      folderId,
      debouncedSearchQuery,
      selectedTags,
      sortBy,
      searchScope,
      refreshTrigger,
    };

    if (onlyPageChanged && skipClampedPageRef.current === page) {
      skipClampedPageRef.current = null;
      return;
    }
    skipClampedPageRef.current = null;
    loadData();
  }, [
    page,
    pageSize,
    folderId,
    debouncedSearchQuery,
    selectedTags,
    sortBy,
    searchScope,
    refreshTrigger,
  ]);

  useEffect(() => {
    const handleCharactersUpdated = () => {
      loadData();
    };
    window.addEventListener("charactersUpdated", handleCharactersUpdated);
    return () => window.removeEventListener("charactersUpdated", handleCharactersUpdated);
  }, [
    page,
    pageSize,
    folderId,
    debouncedSearchQuery,
    selectedTags,
    sortBy,
    searchScope,
  ]);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) {
        getAllTags().then((tags) => {
          if (!cancelled) setAllTags(tags);
        });
      }
    };
    if (isFilterOpen || selectedTags.length > 0) {
      run();
      return () => { cancelled = true; };
    }
    if (typeof (window as any).requestIdleCallback === "function") {
      const id = (window as any).requestIdleCallback(run, { timeout: 1500 });
      return () => { cancelled = true; (window as any).cancelIdleCallback?.(id); };
    }
    const t = setTimeout(run, 1200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [refreshTrigger, folderId, isFilterOpen, selectedTags.length]);

  useEffect(() => {
    if (!isFilterOpen) {
      setIsTagEditMode(false);
    }
  }, [isFilterOpen]);

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent | TouchEvent) => {
      if (tagActionModal || renamingTagData) return;
      if (filterRef.current && filterRef.current.contains(e.target as Node))
        return;
      if (sortRef.current && sortRef.current.contains(e.target as Node)) return;

      setIsFilterOpen(false);
      setIsSortOpen(false);
    };

    if (isFilterOpen || isSortOpen) {
      document.addEventListener("mousedown", handleGlobalClick);
      document.addEventListener("touchstart", handleGlobalClick, {
        passive: true,
      });
    }

    return () => {
      document.removeEventListener("mousedown", handleGlobalClick);
      document.removeEventListener("touchstart", handleGlobalClick);
    };
  }, [isFilterOpen, isSortOpen, tagActionModal, renamingTagData]);

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectPage = () => {
    let allPageSelected = true;
    for (const c of characters) {
      if (!selectedIds.has(c.id)) allPageSelected = false;
    }
    for (const f of paginatedFolders) {
      if (!selectedIds.has(f.id)) allPageSelected = false;
    }

    if (allPageSelected) {
      const newSet = new Set(selectedIds);
      characters.forEach((c) => newSet.delete(c.id));
      paginatedFolders.forEach((f) => newSet.delete(f.id));
      setSelectedIds(newSet);
    } else {
      const newSet = new Set(selectedIds);
      characters.forEach((c) => newSet.add(c.id));
      paginatedFolders.forEach((f) => newSet.add(f.id));
      setSelectedIds(newSet);
    }
  };

  const handleSelectAll = async () => {
    const { getCachedMeta } = await import("../lib/db");
    let allMeta = await getCachedMeta();
    allMeta = allMeta.filter((c) => !c.deletedAt);
    if (debouncedSearchQuery) {
      allMeta = await filterCharacterMetasBySearch(
        allMeta,
        debouncedSearchQuery,
        folderPaths,
        searchScope,
      );
    }
    if (selectedTags.length > 0) {
      allMeta = allMeta.filter((c) =>
        selectedTags.every((t) => (c.tags || []).includes(t))
      );
    }
    if (folderId === "favorites") {
      allMeta = allMeta.filter((c) => c.isFavorite);
    } else if (folderId === null) {
      if (!debouncedSearchQuery && selectedTags.length === 0) {
        allMeta = allMeta.filter((c) => !c.folderId);
      }
    } else if (folderId && folderId !== "all") {
      if (debouncedSearchQuery) {
        const allFoldersData = await getFolders();
        const descendantIds = new Set<string>([folderId]);
        const addDescendants = (pid: string) => {
          for (const f of allFoldersData) {
            if (f.parentId === pid && !descendantIds.has(f.id)) {
              descendantIds.add(f.id);
              addDescendants(f.id);
            }
          }
        };
        addDescendants(folderId);
        allMeta = allMeta.filter((c) => c.folderId && descendantIds.has(c.folderId));
      } else {
        allMeta = allMeta.filter((c) => c.folderId === folderId);
      }
    }

    const cleanQ = normalizeSearchPath(debouncedSearchQuery);
    const visibleFolders = debouncedSearchQuery
      ? (searchScope === "basic" || searchScope === "all"
          ? folders.filter((f) => {
              const cleanName = f.name.trim().toLowerCase();
              const cleanPath = normalizeSearchPath(folderPaths[f.id] || f.name);
              return cleanName.includes(cleanQ) || cleanPath.includes(cleanQ);
            })
          : [])
      : (selectedTags.length > 0 ? [] : folders);

    const totalSelectable = allMeta.length + visibleFolders.length;

    if (selectedIds.size === totalSelectable) {
      setSelectedIds(new Set());
    } else {
      const newSet = new Set<string>();
      allMeta.forEach((c) => newSet.add(c.id));
      visibleFolders.forEach((f) => newSet.add(f.id));
      setSelectedIds(newSet);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    const targetCount = selectedIds.size;
    if (
      confirm(
        `确定要删除选中的 ${targetCount} 项吗？\n（选中的角色及文件夹内的所有角色都将被移至回收站，文件夹将被直接删除）`,
      )
    ) {
      setSelectionMode(false);

      const folderIds = Array.from(selectedIds).filter((id) =>
        folders.some((f) => f.id === id),
      );
      const charIds = Array.from(selectedIds).filter(
        (id) => !folders.some((f) => f.id === id),
      );

      // Optimistic Update
      setFolders((prev) => prev.filter((f) => !folderIds.includes(f.id)));
      setCharacters((prev) => prev.filter((c) => !charIds.includes(c.id)));
      setTotalCharacters((prev) => prev - charIds.length);
      setTotalAllCharacters((prev) => Math.max(0, prev - charIds.length));
      setSelectedIds(new Set());
      setProgress({
        current: 0,
        total: targetCount,
        message: "正在后台删除...",
      });

      // Background deletion
      (async () => {
        await new Promise(r => setTimeout(r, 100));
        let count = 0;
        for (const id of folderIds) {
          await deleteFolder(id, (c, t, msg) => {
            setProgress({
              current: count,
              total: targetCount,
              message: `删除文件夹... ${count}/${targetCount} (${msg} ${c}/${t})`,
            });
          });
          count++;
          setProgress({
            current: count,
            total: targetCount,
            message: `删除文件夹... ${count}/${targetCount}`,
          });
        }

        if (charIds.length > 0) {
          await import("../lib/db").then((m) =>
            m.deleteCharactersBulk(charIds, (c, t, msg) => {
              setProgress({
                current: count + c,
                total: targetCount,
                message: msg + ` ${count + c}/${targetCount}`,
              });
            }),
          );
        }

        setProgress(null);
        loadData();
      })();
    }
  };

  const getSafeFilename = (name: string) => {
    return name.replace(/[\\/:*?"<>|]/g, "_") || "character";
  };

  const getFolderPath = (
    folderId: string | undefined,
    folders: Folder[],
  ): string => {
    const parts: string[] = [];
    const visited = new Set<string>();
    let currentId = folderId;
    while (currentId) {
      if (visited.has(currentId)) break; // 环形引用兜底：不让它无限走下去卡死主线程
      visited.add(currentId);
      const folder = folders.find((f) => f.id === currentId);
      if (!folder) break;
      parts.unshift(getSafeFilename(folder.name));
      currentId = folder.parentId || undefined;
    }
    return parts.join('/');
  };

  const executeBindQR = async (
    qrCharId: string,
    targetCharId: string,
    deleteSource: boolean = false,
  ) => {
    try {
      const fullQrChar = await getCharacter(qrCharId);
      const fullTargetChar = await getCharacter(targetCharId);
      if (!fullQrChar || !fullTargetChar) {
        alert("找不到对应的角色或快速回复卡片");
        return;
      }

      let qrData = fullQrChar.data || {};
      if (
        qrData.data &&
        typeof qrData.data === "object" &&
        !Array.isArray(qrData)
      ) {
        if (qrData.data.qrList || qrData.data.quick_replies) {
          qrData = qrData.data;
        }
      }

      let newQRs: any[] = [];
      let metadata: any = null;
      if (Array.isArray(qrData)) {
        newQRs = qrData;
      } else if (qrData.qrList && Array.isArray(qrData.qrList)) {
        newQRs = qrData.qrList;
        metadata = qrData;
      } else if (qrData.quick_replies && Array.isArray(qrData.quick_replies)) {
        newQRs = qrData.quick_replies;
        metadata = qrData;
      } else if (qrData.tavern_qr_sets && Array.isArray(qrData.tavern_qr_sets)) {
        newQRs = qrData.tavern_qr_sets.flatMap((s: any) => s.replies || []);
        metadata = qrData;
      }

      const updatedChar = { ...fullTargetChar };
      // Deep clone data to ensure it is fully writable and clonable by IDB
      updatedChar.data = JSON.parse(JSON.stringify(updatedChar.data || {}));

      let updatedData = updatedChar.data.data
        ? updatedChar.data.data
        : updatedChar.data;

      const newSets = updatedData.extensions?.tavern_qr_sets
        ? [...updatedData.extensions.tavern_qr_sets]
        : [];
      newSets.push({
        id: Date.now().toString() + Math.random().toString(),
        sourceName: fullQrChar.name,
        replies: JSON.parse(JSON.stringify(newQRs)),
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
      });

      updatedData.extensions = {
        ...(updatedData.extensions || {}),
        tavern_qr_sets: newSets,
        quick_replies: newSets.flatMap((s: any) => s.replies || []),
        qr_filename: `${fullQrChar.name}.json`,
      };

      setIsBindModalOpen(false);
      setPendingQRBinding(null);
      setSelectionMode(false);
      setSelectedIds(new Set());
      setActiveDragId(null);

      // Optimistically remove the QR card from local state immediately if deleting
      if (deleteSource) {
        setCharacters((prev) => prev.filter((c) => c.id !== fullQrChar.id));
        setTotalCharacters((prev) => Math.max(0, prev - 1));
        setTotalAllCharacters((prev) => Math.max(0, prev - 1));
        setTotalItems((prev) => Math.max(0, prev - 1));
      }

      await saveCharacter(updatedChar);

      if (deleteSource) {
        await deleteCharacter(fullQrChar.id);
      }

      invalidateCache();
      await loadData();
    } catch (e) {
      console.error("绑定失败:", e);
      try {
        alert(
          "绑定失败: " + (e instanceof Error ? e.message : String(e)),
        );
      } catch (err) {}
    }
  };

  const handleBindQR = async (targetCharId: string) => {
    const qrCharId = Array.from(selectedIds)[0];
    if (!qrCharId) return;
    await executeBindQR(qrCharId, targetCharId, false);
  };

  const cleanExportFolderParts = (folderName: string, charName: string, uniqueName?: string): string[] => {
    if (!folderName || folderName === "未归类") return [];
    const charLower = getSafeFilename(charName).toLowerCase().trim();
    const uniqueLower = (uniqueName ? getSafeFilename(uniqueName) : charLower).toLowerCase().trim();
    const ignored = new Set([
      charLower,
      uniqueLower,
      "替换头像",
      "替换卡面",
      "版本历史",
      "聊天记录",
      "alt_avatars",
      "avatars",
      "chats",
    ]);

    const rawParts = folderName.split("/").map((p) => getSafeFilename(p.trim())).filter(Boolean);
    const cleanParts: string[] = [];

    for (const p of rawParts) {
      const pLower = p.toLowerCase();
      if (ignored.has(pLower)) continue;
      if (cleanParts.length > 0 && cleanParts[cleanParts.length - 1].toLowerCase() === pLower) continue;
      cleanParts.push(p);
    }

    return cleanParts;
  };

  const addCharacterToZip = async (
    char: CharacterCard,
    zipFolder: JSZip | null,
    nativeZipHelpers?: {
      zipName: string;
      prefix: string;
      addEntry: (
        zipName: string,
        entryName: string,
        buffer: ArrayBuffer | Blob | string,
      ) => Promise<boolean>;
    },
    uniqueNameOverride?: string,
  ) => {
    // 保险起见, 用完整数据重新取一遍角色(调用方有时候传进来的可能是列表里的
    // 轻量对象, 没带全 data/blob), 避免导出内容缺胳膊少腿。
    const fullChar = await getCharacter(char.id);
    if (!fullChar) return;
    char = fullChar;

    const safeName = uniqueNameOverride || getSafeFilename(char.name);
    const exportFileName = `${safeName}.png`;

    const rawData = char.data;
    const isPreset = !!(
      rawData.prompts ||
      rawData.temperature !== undefined ||
      rawData.top_p !== undefined
    );
    const isStandaloneWorldbook = rawData.entries !== undefined;
    const isTheme =
      rawData.blur_strength !== undefined ||
      rawData.main_text_color !== undefined ||
      rawData.chat_display !== undefined;

    const addFileHelper = async (
      folderObj: JSZip | null,
      folderName: string,
      fileName: string,
      content: any,
    ) => {
      if (nativeZipHelpers) {
        let blobOrBuffer = content;
        if (typeof content === "string") {
          blobOrBuffer = new TextEncoder().encode(content).buffer;
        }
        const fullPath =
          nativeZipHelpers.prefix +
          (folderName ? `${folderName}/` : "") +
          fileName;
        await nativeZipHelpers.addEntry(
          nativeZipHelpers.zipName,
          fullPath,
          blobOrBuffer,
        );
      } else if (folderObj) {
        folderObj.file(fileName, content);
      }
    };

    if (isPreset || isStandaloneWorldbook || isTheme) {
      await addFileHelper(
        zipFolder,
        "",
        `${safeName}.json`,
        JSON.stringify(char.data, null, 2),
      );
      return;
    }

    let baseBlob = char.avatarBlob || char.originalFile;
    let localBuffer: ArrayBuffer | null = null;

    if (
      char.localFilePath &&
      typeof window !== "undefined" &&
      !!(window as any).Android
    ) {
      try {
        const { readLocalFileBuffer } = await import("../lib/appBridge");
        localBuffer = await readLocalFileBuffer(char.localFilePath);
      } catch (e) {
        console.error("Failed to read local file buffer", e);
      }
    }

    if (baseBlob || localBuffer) {
      try {
        const { injectTavernData } = await import("../lib/png");
        const buffer = localBuffer || (await baseBlob!.arrayBuffer());
        const newBuffer = injectTavernData(buffer, char.data);
        const finalBlob = new Blob([newBuffer], { type: "image/png" });

        const targetData = char.data.data ? char.data.data : char.data;
        const hasQR =
          targetData.extensions?.quick_replies &&
          targetData.extensions.quick_replies.length > 0;
        const hasAvatars = char.avatarHistory && char.avatarHistory.length > 0;

        const { getChatsForCharacter } = await import("../lib/db");
        const chats = await getChatsForCharacter(char.id);
        const hasChats = chats.length > 0;

        if (hasQR || hasAvatars || hasChats) {
          const charFolder = zipFolder ? zipFolder.folder(safeName) : null;
          const folderPrefix = safeName;

          await addFileHelper(
            charFolder,
            folderPrefix,
            exportFileName,
            finalBlob,
          );

          if (hasQR) {
            const qrFileName =
              targetData.extensions?.qr_filename || `${safeName}_qr.json`;
            let qrContentToExport: any = targetData.extensions.quick_replies;

            if (
              targetData.extensions.tavern_qr_sets &&
              targetData.extensions.tavern_qr_sets.length > 0
            ) {
              const metadata = targetData.extensions.tavern_qr_sets.find(
                (s: any) => s.metadata,
              )?.metadata;
              if (metadata) {
                qrContentToExport = { ...metadata };
                if (qrContentToExport.qrList)
                  qrContentToExport.qrList =
                    targetData.extensions.quick_replies;
                else if (qrContentToExport.quick_replies)
                  qrContentToExport.quick_replies =
                    targetData.extensions.quick_replies;
              } else {
                qrContentToExport = {
                  version: 2,
                  name: char.name,
                  qrList: targetData.extensions.quick_replies,
                };
              }
            } else {
              qrContentToExport = {
                version: 2,
                name: char.name,
                qrList: targetData.extensions.quick_replies,
              };
            }
            await addFileHelper(
              charFolder,
              folderPrefix,
              qrFileName,
              JSON.stringify(qrContentToExport, null, 2),
            );
          }
          if (hasAvatars) {
            const avatarsFolder = charFolder
              ? charFolder.folder("替换头像")
              : null;
            const avatarsPrefix = `${folderPrefix}/替换头像`;
            for (let index = 0; index < char.avatarHistory!.length; index++) {
              const avatarBlob = char.avatarHistory![index];
              let ext = "png";
              let fileName = `替换头像_${index + 1}.${ext}`;
              if (avatarBlob instanceof File) {
                fileName = avatarBlob.name;
              } else {
                if (avatarBlob.type === "image/jpeg") ext = "jpg";
                else if (avatarBlob.type === "image/webp") ext = "webp";
                fileName = `替换头像_${index + 1}.${ext}`;
              }
              await addFileHelper(
                avatarsFolder,
                avatarsPrefix,
                fileName,
                avatarBlob,
              );
            }
          }
          if (hasChats) {
            const chatsFolder = charFolder
              ? charFolder.folder("聊天记录")
              : null;
            const chatsPrefix = `${folderPrefix}/聊天记录`;
            for (let i = 0; i < chats.length; i++) {
              const chat = chats[i];
              const dateStr = new Date(chat.createdAt)
                .toISOString()
                .replace(/:/g, "-");
              const chatSafeName = getSafeFilename(chat.name || "Chat");
              const chatFileName = `${chatSafeName}_${dateStr}.jsonl`;
              const jsonlLines = chat.messages
                ? chat.messages.map((m) => JSON.stringify(m)).join("\n")
                : "";
              await addFileHelper(
                chatsFolder,
                chatsPrefix,
                chatFileName,
                jsonlLines,
              );
            }
          }
        } else {
          await addFileHelper(zipFolder, "", exportFileName, finalBlob);
        }
      } catch (err) {
        console.error("Failed to export injected PNG", err);
        await addFileHelper(
          zipFolder,
          "",
          `${safeName}.json`,
          JSON.stringify(char.data, null, 2),
        );
      }
    } else {
      await addFileHelper(
        zipFolder,
        "",
        `${safeName}.json`,
        JSON.stringify(char.data, null, 2),
      );
    }
  };

  const handleBatchCloudBackup = async () => {
    if (selectedIds.size === 0) return;

    const { getAccessToken, updateSyncState, isSyncTaskBusy } = await import("../lib/drive");
    if (isSyncTaskBusy()) {
      alert("已有同步或备份任务正在进行中，请等它跑完再点。");
      return;
    }
    const token = await getAccessToken();
    if (!token) {
      alert("请先前往「云端同步」页面登录 Google 账号。");
      return;
    }

    const idsToProcess = Array.from(selectedIds);
    setSelectionMode(false);
    setSelectedIds(new Set());

    try {
      const allFolders = await getFolders();
      const charIdsToExport = new Set<string>();

      const { getCachedMeta } = await import("../lib/db");
      const allMeta = await getCachedMeta();

      for (const id of idsToProcess) {
        const folder = allFolders.find((f) => f.id === id);
        if (folder) {
          const addFolderChars = (fId: string) => {
            allMeta.forEach((c) => {
              if (!c.deletedAt && c.folderId === fId) charIdsToExport.add(c.id);
            });
            const subs = allFolders.filter((f) => f.parentId === fId);
            for (const sub of subs) {
              addFolderChars(sub.id);
            }
          };
          addFolderChars(folder.id);
        } else {
          charIdsToExport.add(id);
        }
      }

      const charsArray = Array.from(charIdsToExport);
      if (charsArray.length === 0) {
        alert("所选文件夹中没有可上传的角色。");
        return;
      }

      let success = 0;
      let moved = 0;
      let skipped = 0;
      let failed = 0;
      const failedSamples: string[] = [];
      let completed = 0;
      const CONCURRENCY = Capacitor.isNativePlatform() ? 3 : 5;
      let currentIndex = 0;

      updateSyncState({
        isActive: true,
        taskName: '批量同步',
        message: `准备上传 ${charsArray.length} 个角色...`,
        isError: false,
        completed: false,
      });

      const { uploadCharacterToCloud } = await import("../lib/cloudDrive");

      const uploadWorker = async () => {
        while (currentIndex < charsArray.length) {
          const i = currentIndex++;
          try {
            const res = await uploadCharacterToCloud(token, charsArray[i]);
            if (res === 'uploaded') success++;
            else if (res === 'moved') moved++;
            else skipped++;
          } catch (e: any) {
            console.error("Upload failed for char:", charsArray[i], e);
            failed++;
            if (failedSamples.length < 5) {
              failedSamples.push(`${e?.message || String(e)}`);
            }
          } finally {
            completed++;
            updateSyncState({
              isActive: true,
              taskName: '批量同步',
              message: `正在同步至云端 (${completed}/${charsArray.length})...`,
            });
            await new Promise(r => setTimeout(r, Capacitor.isNativePlatform() ? 200 : 50));
          }
        }
      };

      const workers = [];
      for (let w = 0; w < CONCURRENCY; w++) {
        workers.push(uploadWorker());
      }
      await Promise.all(workers);

      updateSyncState({
        isActive: false,
        completed: failed === 0,
        isError: failed > 0,
        taskName: '批量同步',
        message: failed > 0
          ? `同步完成，但有 ${failed} 个失败：${failedSamples.join('；')}`
          : `云端同步完成！新上传 ${success}，嵌套更新 ${moved}，跳过 ${skipped}`,
      });
      alert(`云端同步完成！\n新上传: ${success} 个\n同步文件夹嵌套: ${moved} 个${skipped > 0 ? `\n分类未变已跳过: ${skipped} 个` : ''}${failed > 0 ? `\n\n⚠️ 失败: ${failed} 个\n${failedSamples.join('\n')}` : ''}`);
    } catch (err: any) {
      console.error(err);
      updateSyncState({
        isActive: false,
        isError: true,
        taskName: '批量同步',
        message: `同步失败: ${err.message}`,
      });
      alert("备份失败: " + err.message);
    }
  };

  const handleBatchExport = async (share: boolean = false) => {
    if (selectedIds.size === 0) return;

    const idsToProcess = new Set(selectedIds);
    setSelectionMode(false);
    setSelectedIds(new Set());
    await new Promise(r => setTimeout(r, 100));

    const createUniqueNameAllocator = () => {
      const assignedNames = new Set<string>();
      return (charName: string) => {
        const baseName = getSafeFilename(charName);
        let candidate = baseName;
        let count = 0;
        while (assignedNames.has(candidate.toLowerCase())) {
          count += 1;
          candidate = `${baseName}_${count}`;
        }
        assignedNames.add(candidate.toLowerCase());
        return candidate;
      };
    };

    const getSingleExportBaseName = async (char: CharacterCard) => {
      const importedName =
        char.autoImportFilename
          ?.split("/")
          .pop()
          ?.replace(/\.[^.]+$/, "") || "";
      if (importedName) return importedName;

      const allMeta = await getCachedMeta();
      const sameNameChars = allMeta
        .filter((meta) => !meta.deletedAt && meta.name?.trim() === char.name?.trim())
        .sort(
          (a, b) =>
            a.createdAt - b.createdAt ||
            a.id.localeCompare(b.id),
        );
      const duplicateIndex = sameNameChars.findIndex((meta) => meta.id === char.id);
      const baseName = getSafeFilename(char.name);
      return duplicateIndex > 0
        ? `${baseName}_${duplicateIndex}`
        : baseName;
    };

    try {
      const allFolders = await getFolders();

      const {
        isAndroid,
        saveToGallery,
        startAndroidZip,
        addAndroidZipEntry,
        finishAndroidZip,
      } = await import("../lib/appBridge");
      if (Capacitor.isNativePlatform()) {
        const charIdsToExport = new Set<string>();

        for (const id of Array.from(idsToProcess)) {
          const folder = allFolders.find((f) => f.id === id);
          if (folder) {
            const addFolderChars = async (fId: string) => {
              const { characters: fc } = await getCharacters(1, 10000, fId, "", [], "newest_import", false, false);
              fc.forEach((c) => charIdsToExport.add(c.id));
              const subs = allFolders.filter((f) => f.parentId === fId);
              for (const sub of subs) {
                await addFolderChars(sub.id);
              }
            };
            await addFolderChars(folder.id);
          } else {
            charIdsToExport.add(id);
          }
        }

        const charsArray = Array.from(charIdsToExport);

        if (charsArray.length === 1) {
          const char = await getCharacter(charsArray[0]);
          if (char) {
            const { isAndroid, exportFileToMIU, shareFileOnAndroid, readLocalFileBuffer } = await import("../lib/appBridge");
            const safeName = await getSingleExportBaseName(char);
            const exportData = { ...char.data };
            if (char.hasBlobsSeparated) {
                const blobs = await getCharacterBlob(char.id);
                if (blobs && blobs.avatarBlob && !exportData.avatar) {
                    exportData.avatar = "";
                }
            }

            let buffer: ArrayBuffer | null = null;
            if (char.localFilePath) {
                buffer = await readLocalFileBuffer(char.localFilePath);
            } else if (char.avatarBlob) {
                buffer = await char.avatarBlob.arrayBuffer();
            } else if (char.hasBlobsSeparated) {
                const blobs = await getCharacterBlob(char.id);
                if (blobs && blobs.avatarBlob) {
                    buffer = await blobs.avatarBlob.arrayBuffer();
                }
            }

            if (buffer) {
                try {
                    const { injectTavernData } = await import("../lib/png");
                    const newBuffer = injectTavernData(buffer, exportData);
                    const exportFileName = `${safeName}.png`;
                    const { downloadOrShareFile } = await import("../lib/appBridge");
                    // 单卡导出（只选中了一张卡）：额外往系统相册放一份，方便在相册里直接找到
                    await downloadOrShareFile(exportFileName, newBuffer, 'image/png', true, { toAlbum: true });
                    return; // Done
                } catch (e) {
                    console.error("Failed to inject PNG in single export", e);
                }
            }

            // Fallback to JSON
            const exportFileName = `${safeName}.json`;
            const bytes = new TextEncoder().encode(JSON.stringify(exportData, null, 2));
            const { downloadOrShareFile } = await import("../lib/appBridge");
            await downloadOrShareFile(exportFileName, bytes.buffer, 'application/json', true);
            return;
          }
        }

        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, "0");
        const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

        // 1. 原生安卓 Streaming ZIP 分卷模式（使用 500 张一卷，原生文件流写盘）
        if ((window as any).Android && (window as any).Android.startZip) {
          try {
            const NATIVE_CHUNK_SIZE = 500;
            const nativeTotalParts = Math.ceil(charsArray.length / NATIVE_CHUNK_SIZE);
            let nativeSuccessParts = 0;
            const getUniqueName = createUniqueNameAllocator();

            for (let partIdx = 0; partIdx < nativeTotalParts; partIdx++) {
              const chunk = charsArray.slice(partIdx * NATIVE_CHUNK_SIZE, (partIdx + 1) * NATIVE_CHUNK_SIZE);
              const partNumber = partIdx + 1;
              const zipName =
                nativeTotalParts > 1
                  ? `批量导出/Tavern_Export_${timestamp}_卷${partNumber}.zip`
                  : `批量导出/Tavern_Export_${timestamp}.zip`;

              const started = await startAndroidZip(zipName).catch(() => false);
              if (!started) throw new Error(`startAndroidZip failed for part ${partNumber}`);

              for (const cid of chunk) {
                const char = await getCharacter(cid);
                if (!char) continue;

                const uniqueName = getUniqueName(char.name);

                const { resolveFolderPath, getCharacterCategoryPrefix } =
                  await import("../lib/db");
                const folderName = await resolveFolderPath(char.folderId);
                let prefix = "";
                if (folderName === "未归类" || !folderName) {
                  const autoCategory = getCharacterCategoryPrefix(char);
                  prefix = autoCategory === "未归类" ? "" : `${autoCategory}/`;
                } else {
                  const parts = cleanExportFolderParts(folderName, char.name, uniqueName);
                  prefix = parts.length > 0 ? parts.join("/") + "/" : "";
                }

                await addCharacterToZip(
                  char,
                  null,
                  {
                    zipName,
                    prefix,
                    addEntry: addAndroidZipEntry,
                  },
                  uniqueName,
                );
              }

              const finalPath = await finishAndroidZip(zipName);
              if (finalPath) {
                nativeSuccessParts++;
                if (nativeTotalParts === 1) {
                  const { shareLocalFileOnAndroid } = await import("../lib/appBridge");
                  try {
                    await shareLocalFileOnAndroid(finalPath, "application/zip");
                  } catch (e) {}
                }
              }
            }

            if (nativeSuccessParts === nativeTotalParts) {
              alert(
                nativeTotalParts > 1
                  ? `批量导出成功！共 ${charsArray.length} 张卡片，已按每包上限500张自动切分为 ${nativeTotalParts} 个分卷包，文件均保存在：Download/MIU/批量导出/`
                  : `批量导出成功！文件已存至：Download/MIU/批量导出/`
              );
              return;
            }
          } catch (e) {
            console.warn("Native Android Zip export failed, falling back to JSZip chunked:", e);
          }
        }

        // 2. 通用 JSZip 分卷导出 (网页端模式：限制为 100 张一卷，完美保护网页浏览器内存不爆不卡)
        const WEB_CHUNK_SIZE = 100;
        const webTotalParts = Math.ceil(charsArray.length / WEB_CHUNK_SIZE);
        let successCountChunks = 0;
        let failedChunks: number[] = [];
        const getUniqueName = createUniqueNameAllocator();
        const { downloadOrShareFile } = await import("../lib/appBridge");
        const { default: JSZip } = await import("jszip");

        for (let partIdx = 0; partIdx < webTotalParts; partIdx++) {
          const chunk = charsArray.slice(partIdx * WEB_CHUNK_SIZE, (partIdx + 1) * WEB_CHUNK_SIZE);
          const zip = new JSZip();

          for (let cIdx = 0; cIdx < chunk.length; cIdx++) {
            const cid = chunk[cIdx];
            const char = await getCharacter(cid);
            if (!char) continue;

            const uniqueName = getUniqueName(char.name);

            const { resolveFolderPath, getCharacterCategoryPrefix } =
              await import("../lib/db");
            const folderName = await resolveFolderPath(char.folderId);
            if (folderName === "未归类" || !folderName) {
              const autoCategory = getCharacterCategoryPrefix(char);
              const uZip =
                autoCategory === "未归类" ? null : zip.folder(autoCategory);
              await addCharacterToZip(char, uZip || zip, undefined, uniqueName);
            } else {
              let currentZip: JSZip = zip;
              const parts = cleanExportFolderParts(folderName, char.name, uniqueName);
              for (const p of parts) {
                currentZip =
                  currentZip.folder(p) || currentZip;
              }
              await addCharacterToZip(char, currentZip, undefined, uniqueName);
            }

            // 每添加5张卡片让出一次 UI 主线程，防止网页卡死报警
            if (cIdx % 5 === 0) {
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          }

          const zipBlob = await zip.generateAsync({
            type: "blob",
            compression: "STORE",
          });
          const buffer = await zipBlob.arrayBuffer();
          const partNumber = partIdx + 1;
          const fileName =
            webTotalParts > 1
              ? `Tavern_Export_${timestamp}_卷${partNumber}.zip`
              : `Tavern_Export_${timestamp}.zip`;

          const res = await downloadOrShareFile(fileName, buffer, "application/zip", webTotalParts === 1);
          if (res.success) {
            successCountChunks++;
          } else {
            failedChunks.push(partNumber);
          }

          // 添加短暂停顿让手机浏览器 GC 进行垃圾回收，释放内存
          if (partIdx + 1 < webTotalParts) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }

        if (failedChunks.length > 0) {
          alert(`部分分卷导出失败（第 ${failedChunks.join(", ")} 卷）。如果手机内存不足，建议分批勾选卡片导出。`);
        } else {
          alert(
            webTotalParts > 1
              ? `批量导出成功！共 ${charsArray.length} 张卡片，已按网页端安全限制自动切分为 ${webTotalParts} 个压缩包（每包 100 张），文件均已准备完成！`
              : `批量导出成功！压缩包文件已准备完成。`
          );
        }

        return;
      }

      const exportTasks: { charId: string; path: string[] }[] = [];
      const seenCharIds = new Set<string>();

      const pushCharTask = async (charId: string, path: string[]) => {
        if (seenCharIds.has(charId)) return;
        seenCharIds.add(charId);
        exportTasks.push({
          charId,
          path: path.map((p) => getSafeFilename(p)),
        });
      };

      const { getCachedMeta } = await import("../lib/db");
      const allMeta = await getCachedMeta();

      for (const id of Array.from(idsToProcess)) {
        const folder = allFolders.find((f) => f.id === id);
        if (folder) {
          const collectFolderRecursive = (
            currentFolderId: string,
            currentPath: string[],
          ) => {
            const folderChars = allMeta.filter(
              (c) => !c.deletedAt && c.folderId === currentFolderId
            );
            for (const char of folderChars) {
              pushCharTask(char.id, currentPath);
            }
            const subFolders = allFolders.filter(
              (f) => f.parentId === currentFolderId,
            );
            for (const subFolder of subFolders) {
              collectFolderRecursive(subFolder.id, [
                ...currentPath,
                subFolder.name,
              ]);
            }
          };
          collectFolderRecursive(folder.id, [folder.name]);
        } else {
          const char = await getCharacter(id);
          if (!char) continue;
          const { resolveFolderPath, getCharacterCategoryPrefix } =
            await import("../lib/db");

          if (!char.folderId || char.folderId === "all") {
            const autoCategory = getCharacterCategoryPrefix(char);
            await pushCharTask(
              id,
              autoCategory === "未归类" ? [] : [autoCategory],
            );
          } else {
            const folderName = await resolveFolderPath(char.folderId);
            if (folderName === "未归类" || !folderName) {
              const autoCategory = getCharacterCategoryPrefix(char);
              await pushCharTask(
                id,
                autoCategory === "未归类" ? [] : [autoCategory],
              );
            } else {
              const cleanParts = cleanExportFolderParts(folderName, char.name);
              await pushCharTask(id, cleanParts);
            }
          }
        }
      }

      const CHUNK_SIZE = 100;
      const totalParts = Math.ceil(exportTasks.length / CHUNK_SIZE);
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, "0");
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const getUniqueName = createUniqueNameAllocator();
      const { default: JSZip } = await import("jszip");

      let chunkIndex = 1;
      for (let i = 0; i < exportTasks.length; i += CHUNK_SIZE) {
        const chunkTasks = exportTasks.slice(i, i + CHUNK_SIZE);
        const zip = new JSZip();

        for (const task of chunkTasks) {
          const char = await getCharacter(task.charId);
          if (!char) continue;

          const uniqueName = getUniqueName(char.name);
          const parts = cleanExportFolderParts(task.path.join("/"), char.name, uniqueName);
          let currentZip: JSZip = zip;
          for (const part of parts) {
            currentZip = currentZip.folder(getSafeFilename(part)) || currentZip;
          }
          await addCharacterToZip(char, currentZip, undefined, uniqueName);
        }

        const zipBlob = await zip.generateAsync({
          type: "blob",
          compression: "STORE",
        });
        const zipName =
          totalParts > 1
            ? `Tavern_Export_${timestamp}_卷${chunkIndex}.zip`
            : `Tavern_Export_${timestamp}.zip`;
        const { downloadOrShareFile } = await import("../lib/appBridge");
        await downloadOrShareFile(zipName, zipBlob, "application/zip", true);

        chunkIndex += 1;
        if (i + CHUNK_SIZE < exportTasks.length) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }

    } catch (e) {
      console.error("Batch export failed", e);
      alert("导出失败，请重试");
    }
  };

  const handleMoveToFolder = async (targetFolderId: string | null) => {
    // Prevent moving a folder into itself or its descendants
    const isDescendant = async (
      folderIdToCheck: string,
      targetId: string | null,
    ): Promise<boolean> => {
      if (!targetId) return false;
      if (folderIdToCheck === targetId) return true;
      const allFolders = await getFolders();
      const visited = new Set<string>();
      let current = allFolders.find((f) => f.id === targetId);
      while (current && current.parentId) {
        if (visited.has(current.id)) break; // 环形引用兜底
        visited.add(current.id);
        if (current.parentId === folderIdToCheck) return true;
        current = allFolders.find((f) => f.id === current.parentId);
      }
      return false;
    };

    const allFolders = await getFolders();
    const charsToSave: CharacterCard[] = [];
    const foldersToSave: Folder[] = [];

    for (const id of selectedIds) {
      const folder = allFolders.find((f) => f.id === id);
      if (folder) {
        if (await isDescendant(id, targetFolderId)) {
          alert(
            `无法移动：您选中的文件夹中包含了目标文件夹 "${folder.name}"，不能将其移入自身。`,
          );
          continue;
        }
        folder.parentId = targetFolderId;
        foldersToSave.push(folder);
      } else {
        const char = await getCharacter(id);
        if (char) {
          if (targetFolderId === null) {
            delete char.folderId;
          } else {
            char.folderId = targetFolderId;
          }
          charsToSave.push(char);
        }
      }
    }

    setIsMoveModalOpen(false);
    setSelectionMode(false);
    setSelectedIds(new Set());

    // 乐观更新: 移动的瞬间就把卡片/文件夹从当前视图里挪走,
    // 不等 saveFolder/saveCharacters(含数据库写入 + 后台安卓文件搬运)跑完。
    // 如果移动目标就是当前正在看的文件夹,则保留在列表里(不需要移除)。
    const movedCharIds = new Set(charsToSave.map((c) => c.id));
    const movedFolderIds = new Set(foldersToSave.map((f) => f.id));
    if (movedCharIds.size > 0) {
      setCharacters((prev) =>
        prev.filter(
          (c) => !movedCharIds.has(c.id) || targetFolderId === folderId,
        ),
      );
      setTotalCharacters((prev) =>
        targetFolderId === folderId ? prev : Math.max(0, prev - movedCharIds.size),
      );
    }
    if (movedFolderIds.size > 0) {
      setFolders((prev) =>
        prev.filter(
          (f) => !movedFolderIds.has(f.id) || targetFolderId === folderId,
        ),
      );
    }

    // 真正的存盘(含安卓端文件搬运)在后台跑, 完成后 loadData() 会用数据库里的
    // 真实结果校正一遍界面, 正常情况下不会有肉眼可见的变化。
    await Promise.all(foldersToSave.map((f) => saveFolder(f)));
    if (charsToSave.length > 0) {
      await saveCharacters(charsToSave);
    }
    loadData();
  };

  const handleToggleFavorite = async (e: React.MouseEvent, charId: string) => {
    e.stopPropagation();
    try {
      const newFav = await toggleCharacterFavorite(charId);
      setCharacters((prev) =>
        prev.map((c) =>
          c.id === charId
            ? { ...c, isFavorite: newFav, updatedAt: Date.now() }
            : c
        )
      );
      if (folderId === "favorites" && !newFav) {
        setCharacters((prev) => prev.filter((c) => c.id !== charId));
      }
    } catch (err) {
      console.error("Failed to toggle favorite:", err);
    }
  };

  return (
    <div className="pb-32 min-h-full bg-gradient-to-br from-slate-900 to-slate-800 text-white [.light-theme_&]:!bg-transparent [.light-theme_&]:!text-[#0f172a]" onTouchStart={handleRootTouchStart} onTouchEnd={handleRootTouchEnd}>
      <input
        type="file"
        ref={coverInputRef}
        className="hidden"
        accept="image/png, image/jpeg, image/webp, image/gif, image/*"
        onChange={handleCoverUpload}
      />
      <motion.header
        initial={{ y: 0 }}
        animate={{ y: (isHeaderVisible || selectionMode) ? 0 : "-100%" }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-xl border-b border-white/10 px-4 pt-[max(1.75rem,env(safe-area-inset-top))] sm:pt-[max(1.75rem,env(safe-area-inset-top))] pb-4 mb-6 cursor-pointer [.light-theme_&]:!bg-[#ffffff]/90 [.light-theme_&]:!border-none"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            scrollToTop();
          }
        }}
      >
        {selectionMode ? (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="flex items-center justify-between w-full"
          >
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => {
                  setSelectionMode(false);
                  setSelectedIds(new Set());
                }}
                className="p-2 rounded-xl transition shrink-0 cursor-pointer active:scale-95 bg-white/5 hover:bg-white/10 text-slate-300 [.light-theme_&]:!bg-[#f1f2f6] [.light-theme_&]:hover:!bg-[#e4e7eb] [.light-theme_&]:!border-none [.light-theme_&]:!text-[#0f172a]"
                title="退出选择"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-bold truncate leading-tight tracking-tight text-white [.light-theme_&]:!text-[#0f172a]">
                  已选中 {selectedIds.size} 项
                </h2>
                <p className="text-xs truncate mt-0.5 text-slate-400 [.light-theme_&]:!text-[#64748b]">
                  请确认对选中项的操作
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleSelectPage}
                className="px-3 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer active:scale-95 bg-white/5 hover:bg-white/10 text-slate-200 border-white/10 [.light-theme_&]:!bg-[#f1f2f6] [.light-theme_&]:hover:!bg-[#e4e7eb] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-none"
              >
                全选本页
              </button>
              <button
                onClick={handleSelectAll}
                className="px-3 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer active:scale-95 bg-white/5 hover:bg-white/10 text-slate-200 border-white/10 [.light-theme_&]:!bg-[#f1f2f6] [.light-theme_&]:hover:!bg-[#e4e7eb] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-none"
              >
                全选所有
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            <div className="flex-1 min-w-0 px-1">
              {folderId ? (
                <div className="flex flex-col gap-1 mb-1">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleBack}
                      className="p-1 -ml-1 rounded-lg hover:bg-white/10 transition text-white/60 hover:text-white [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#0f172a] [.light-theme_&]:hover:!bg-black/5"
                      title="返回上一层"
                    >
                      <ChevronLeft className="w-6 h-6" />
                    </button>
                    <h1 className="text-2xl font-bold text-white truncate [.light-theme_&]:!text-[#0f172a]">
                      {folderId === "all" ? "全部角色" : folderId === "favorites" ? "我的收藏" : currentFolderName}
                    </h1>
                  </div>

                  {folderId !== "all" && folderAncestors[folderId] && folderAncestors[folderId].length > 0 && (
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 text-xs text-white/50 [.light-theme_&]:!text-[#64748b]">
                      <button
                        onClick={() => {
                          if (searchQuery) {
                            setSearchQuery("");
                            setDebouncedSearchQuery("");
                          }
                          onSelectFolder?.(null);
                        }}
                        className="hover:text-blue-400 transition flex items-center gap-1 shrink-0 [.light-theme_&]:hover:!text-blue-600"
                      >
                        <Home className="w-3.5 h-3.5" />
                        <span>主页</span>
                      </button>
                      {folderAncestors[folderId].map((crumb, idx) => (
                        <React.Fragment key={crumb.id || idx}>
                          <ChevronRight className="w-3 h-3 text-white/30 shrink-0 [.light-theme_&]:!text-[#94a3b8]" />
                          {idx === folderAncestors[folderId].length - 1 ? (
                            <span className="font-semibold text-white/90 truncate max-w-[150px] sm:max-w-[220px] [.light-theme_&]:!text-[#0f172a]">
                              {crumb.name}
                            </span>
                          ) : (
                            <button
                              onClick={() => {
                                if (searchQuery) {
                                  setSearchQuery("");
                                  setDebouncedSearchQuery("");
                                }
                                onSelectFolder?.(crumb.id);
                              }}
                              className="hover:text-white [.light-theme_&]:hover:!text-[#0f172a] transition truncate max-w-[120px] shrink-0"
                            >
                              {crumb.name}
                            </button>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-black text-white [.light-theme_&]:!text-[#1c1c1e] truncate tracking-wide">
                    MIU
                  </h1>
                  <span className="text-[10px] font-semibold tracking-wider text-white/70 [.light-theme_&]:!text-[#1c1c1e]/70 bg-white/10 [.light-theme_&]:!bg-black/5 border border-white/15 [.light-theme_&]:!border-black/10 px-2 py-0.5 rounded-full select-none shadow-xs">
                    v{CURRENT_APP_VERSION}
                  </span>
                </div>
              )}
              <p className="text-slate-400 text-xs mt-0.5 truncate [.light-theme_&]:!text-[#64748b]">
                {isSearching && debouncedSearchQuery.trim() ? (
                  `正在「${activeScopeOption.label}」中搜索...`
                ) : folderId ? (
                  folders.length > 0 && totalCharacters > 0
                    ? `${folders.length} 个子文件夹 · ${totalCharacters} 个角色`
                    : folders.length > 0
                      ? `${folders.length} 个子文件夹`
                      : `${totalCharacters} 个角色`
                ) : (
                  folders.length > 0 && totalAllCharacters > 0
                    ? `${folders.length} 个文件夹 · ${totalAllCharacters} 个角色`
                    : folders.length > 0
                      ? `${folders.length} 个文件夹`
                      : `管理你的角色卡片 (${totalAllCharacters})`
                )}
              </p>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                onClick={onOpenSidebar}
                className="w-8 h-8 sm:w-8.5 sm:h-8.5 rounded-full bg-white/10 hover:bg-white/15 text-white/80 hover:text-white transition shrink-0 flex items-center justify-center border-0 border-none [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:!border-none [.light-theme_&]:!text-[#475569] [.light-theme_&]:hover:!text-[#0f172a] [.light-theme_&]:hover:!bg-[#cbd5e1] cursor-pointer shadow-xs"
                title="打开导航菜单"
              >
                {googleUser?.photoURL ? (
                  <img 
                    src={googleUser.photoURL} 
                    alt="User" 
                    referrerPolicy="no-referrer" 
                    className="w-5 h-5 sm:w-5.5 sm:h-5.5 rounded-full object-cover" 
                  />
                ) : (
                  <Menu className="w-4.5 h-4.5 stroke-[1.75]" />
                )}
              </button>

              <div ref={searchContainerRef} className="relative flex-1 min-w-0">
                <div
                  className={`flex items-center gap-1.5 w-full rounded-full ${
                    searchScope !== "basic" ? "pl-1.5" : "pl-3"
                  } ${searchQuery ? "pr-2" : "pr-3.5"} py-1.5 sm:py-2 transition shadow-xs ${
                    isLightMode
                      ? 'bg-[#e2e8f0] hover:bg-[#cbd5e1]/70 focus-within:bg-[#cbd5e1]/70 text-[#0f172a]'
                      : 'bg-white/10 hover:bg-white/15 focus-within:bg-white/15 text-white'
                  }`}
                >
                  {searchScope !== "basic" ? (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setIsSearchFocused((prev) => !prev)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 max-w-[84px] bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 [.light-theme_&]:!bg-[#e0edff] [.light-theme_&]:!text-[#007aff] transition cursor-pointer"
                      title="点击切换搜索范围"
                    >
                      <span className="truncate">{activeScopeOption.label}</span>
                      <span
                        role="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          selectSearchScope("basic");
                        }}
                        className="opacity-70 hover:opacity-100 leading-none"
                        title="恢复默认搜索"
                      >
                        <X className="w-3 h-3" />
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setIsSearchFocused((prev) => !prev)}
                      className="inline-flex items-center gap-0.5 shrink-0 px-1 py-0.5 -ml-0.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#0f172a] [.light-theme_&]:hover:!bg-black/5 transition cursor-pointer"
                      title="点击选择搜索范围（作者/全部内容/开场白等）"
                    >
                      <Search className="w-3.5 h-3.5 stroke-[1.85]" />
                      <ChevronDown className="w-3 h-3 opacity-70" />
                    </button>
                  )}

                  <form
                    action=""
                    onSubmit={(e) => {
                      e.preventDefault();
                      isComposingRef.current = false;
                      setDebouncedSearchQuery(searchQuery);
                      saveSearchToHistory(searchQuery);
                      setIsSearchFocused(false);
                      searchInputRef.current?.blur();
                    }}
                    className="flex-1 min-w-0"
                  >
                    <input
                      ref={searchInputRef}
                      type="text"
                      inputMode="search"
                      enterKeyHint="search"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck="false"
                      placeholder={activeScopeOption.placeholder}
                      value={searchQuery}
                      onFocus={() => {
                        if (!suppressFocusPopupRef.current && !searchQuery.trim()) {
                          setIsSearchFocused(true);
                        }
                      }}
                      onClick={() => {
                        if (!suppressFocusPopupRef.current && !searchQuery.trim()) {
                          setIsSearchFocused(true);
                        }
                      }}
                      onBlur={handleSearchBlur}
                      onCompositionStart={() => {
                        isComposingRef.current = true;
                      }}
                      onCompositionEnd={(e) => {
                        isComposingRef.current = false;
                        const val = e.currentTarget.value;
                        setSearchQuery(val);
                        setDebouncedSearchQuery(val);
                        if (val.trim()) {
                          setIsSearchFocused(false);
                        }
                      }}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSearchQuery(val);
                        if (val.trim()) {
                          setIsSearchFocused(false);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !isComposingRef.current) {
                          setDebouncedSearchQuery(searchQuery);
                          saveSearchToHistory(searchQuery);
                          setIsSearchFocused(false);
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      className={`w-full bg-transparent border-0 border-none text-sm focus:outline-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none ${
                        isLightMode
                          ? 'text-[#0f172a] placeholder:text-[#8e8e93]'
                          : 'text-white placeholder:text-white/40'
                      }`}
                    />
                  </form>

                  {isSearching && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 [.light-theme_&]:!text-[#007aff] shrink-0" />
                  )}

                  {searchQuery && (
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                      }}
                      onClick={() => {
                        isComposingRef.current = false;
                        setSearchQuery("");
                        setDebouncedSearchQuery("");
                        searchInputRef.current?.focus();
                      }}
                      className={`p-1 rounded-full transition cursor-pointer shrink-0 ${
                        isLightMode
                          ? 'text-slate-400 hover:text-slate-700 hover:bg-black/5 active:bg-black/10'
                          : 'text-white/40 hover:text-white hover:bg-white/10 active:bg-white/20'
                      }`}
                      title="清空输入"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* 搜索范围 + 搜索历史记录浮窗 - 点击空白搜索框或范围标签时弹出，输入关键词后自动收起以免遮挡结果 */}
                <AnimatePresence>
                  {isSearchFocused && (
                    <motion.div
                      initial={{ opacity: 0, y: 6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 6, scale: 0.98 }}
                      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                      className={`absolute -left-[38px] w-[calc(100vw-2rem)] max-w-[380px] sm:left-0 sm:w-full sm:min-w-[310px] sm:max-w-none top-full mt-2 z-50 rounded-2xl overflow-hidden shadow-xl border-0 border-none outline-none ${
                        isLightMode
                          ? 'bg-[#ffffff] [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-none [.light-theme_&]:!shadow-xl text-[#0f172a] [.light-theme_&]:!text-[#0f172a]'
                          : 'bg-slate-800 text-white border-0 border-none shadow-2xl'
                      }`}
                    >
                      {/* 搜索范围选择区 */}
                      <div className="px-3.5 pt-2.5 pb-2.5 border-b border-white/10 [.light-theme_&]:!border-[#f1f5f9]">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 [.light-theme_&]:!text-[#64748b]">
                            <Search className="w-3.5 h-3.5 stroke-[1.75]" />
                            <span>搜索范围</span>
                          </div>
                          {searchScope !== "basic" && (
                            <button
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => selectSearchScope("basic")}
                              className="text-[11px] font-medium text-blue-400 hover:text-blue-300 [.light-theme_&]:!text-[#007aff] cursor-pointer"
                            >
                              恢复默认
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {searchScopeOptions.map((opt) => {
                            const isActive = searchScope === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => selectSearchScope(opt.id)}
                                className={`px-2.5 py-1 rounded-full text-xs font-medium transition cursor-pointer active:scale-95 border-none ${
                                  isActive
                                    ? 'bg-blue-500/20 text-blue-300 font-semibold [.light-theme_&]:!bg-[#e0edff] [.light-theme_&]:!text-[#007aff]'
                                    : 'bg-white/5 hover:bg-white/10 text-white/75 [.light-theme_&]:!bg-[#f1f2f6] [.light-theme_&]:hover:!bg-[#e4e7eb] [.light-theme_&]:!text-[#2c3e50]'
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* 历史头部 - 无边框纯净设计 */}
                      <div className="flex items-center justify-between px-3.5 pt-2.5 pb-1.5 border-0 border-none">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 [.light-theme_&]:!text-slate-400">
                          <Clock className="w-3.5 h-3.5 stroke-[1.75]" />
                          <span>历史搜索</span>
                          {searchHistory.length > 0 && (
                            <span className="text-[10px] font-normal text-slate-400/80">
                              ({searchHistory.length}/5)
                            </span>
                          )}
                        </div>
                        {searchHistory.length > 0 && (
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => {
                              clearAllSearchHistory(e);
                            }}
                            className="text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1 p-1 -mr-1 border-0 border-none text-slate-400 hover:text-red-500 [.light-theme_&]:!text-slate-400 [.light-theme_&]:hover:!text-red-500"
                            title="清除全部搜索记录"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>全部清除</span>
                          </button>
                        )}
                      </div>

                      {/* 历史项列表与空状态 */}
                      <div className="p-1 max-h-[45vh] overflow-y-auto">
                        {(() => {
                          const matchingItems = searchQuery.trim()
                            ? searchHistory.filter((item) =>
                                item.toLowerCase().includes(searchQuery.trim().toLowerCase())
                              )
                            : searchHistory;

                          if (matchingItems.length > 0) {
                            return matchingItems.map((item) => (
                              <div
                                key={item}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setSearchQuery(item);
                                  setDebouncedSearchQuery(item);
                                  saveSearchToHistory(item);
                                  setIsSearchFocused(false);
                                }}
                                className={`group flex items-center justify-between px-3 py-2 rounded-xl text-xs sm:text-sm cursor-pointer transition-colors active:scale-[0.99] border-0 border-none ${
                                  isLightMode
                                    ? 'hover:bg-slate-100 [.light-theme_&]:hover:!bg-[#f1f2f6] text-[#0f172a] [.light-theme_&]:!text-[#0f172a]'
                                    : 'hover:bg-white/10 text-white'
                                }`}
                              >
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                  <Clock
                                    className={`w-3.5 h-3.5 shrink-0 ${
                                      isLightMode
                                        ? 'text-slate-400 group-hover:text-slate-600'
                                        : 'text-white/40 group-hover:text-white/70'
                                    }`}
                                  />
                                  <span className="truncate font-medium text-white [.light-theme_&]:!text-[#0f172a]">
                                    {item}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteSearchHistoryItem(item, e);
                                  }}
                                  className={`p-1 rounded-lg transition shrink-0 ml-2 cursor-pointer border-0 border-none ${
                                    isLightMode
                                      ? 'text-slate-400 hover:text-slate-700 hover:bg-slate-200/80 active:bg-slate-300'
                                      : 'text-white/40 hover:text-white hover:bg-white/10 active:bg-white/20'
                                  }`}
                                  title="删除此条记录"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ));
                          }

                          if (searchQuery.trim() && searchHistory.length > 0) {
                            return (
                              <div className="py-3 px-3.5 text-center text-xs text-slate-400 [.light-theme_&]:!text-slate-400 select-none font-normal">
                                无匹配的历史搜索记录
                              </div>
                            );
                          }

                          return (
                            <div className="py-3 px-3.5 text-center text-xs text-slate-400 [.light-theme_&]:!text-slate-400 select-none font-normal">
                              暂无历史搜索记录 (每次搜索将自动保存)
                            </div>
                          );
                        })()}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <button
                onClick={() =>
                  setViewMode((v) =>
                    v === "grid"
                      ? "masonry"
                      : v === "masonry"
                        ? "list"
                        : "grid",
                  )
                }
                className="w-8 h-8 sm:w-8.5 sm:h-8.5 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/15 text-white/80 hover:text-white transition shrink-0 border-0 border-none [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:hover:!bg-[#cbd5e1] [.light-theme_&]:!text-[#475569] [.light-theme_&]:hover:!text-[#0f172a] [.light-theme_&]:!border-none cursor-pointer shadow-xs"
                title="切换布局"
              >
                {viewMode === "grid" ? (
                  <LayoutGrid className="w-4.5 h-4.5 stroke-[1.75]" />
                ) : viewMode === "masonry" ? (
                  <LayoutDashboard className="w-4.5 h-4.5 stroke-[1.75]" />
                ) : (
                  <List className="w-4.5 h-4.5 stroke-[1.75]" />
                )}
              </button>

              <div ref={sortRef} className="relative shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsSortOpen(!isSortOpen);
                    setIsFilterOpen(false);
                  }}
                  className={`w-8 h-8 sm:w-8.5 sm:h-8.5 rounded-full flex items-center justify-center transition cursor-pointer border-0 border-none [.light-theme_&]:!border-none shadow-xs ${isSortOpen ? "bg-blue-500/20 text-blue-400 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-[#007aff]" : "bg-white/10 hover:bg-white/15 text-white/80 hover:text-white [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:hover:!bg-[#cbd5e1] [.light-theme_&]:!text-[#475569] [.light-theme_&]:hover:!text-[#0f172a]"}`}
                  title="排序"
                >
                  <ArrowUpDown className="w-4.5 h-4.5 stroke-[1.75]" />
                </button>

                <AnimatePresence>
                  {isSortOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute right-0 top-full mt-2 w-48 bg-slate-800 border-0 border-none rounded-2xl shadow-xl z-50 p-2 overflow-hidden [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-none [.light-theme_&]:!shadow-xl"
                    >
                      {[
                        { value: "newest_import", label: "最新导入" },
                        { value: "oldest_import", label: "最旧导入" },
                        { value: "recently_modified", label: "最近修改" },
                        { value: "tokens_desc", label: "Token 数量 (多到少)" },
                        { value: "tokens_asc", label: "Token 数量 (少到多)" },
                        { value: "a_z", label: "A - Z" },
                        { value: "z_a", label: "Z - A" },
                      ].map((option) => (
                        <button
                          key={option.value}
                          onClick={() => {
                            setSortBy(option.value as SortOption);
                            setIsSortOpen(false);
                          }}
                          className={`w-full text-left px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-medium transition cursor-pointer border-0 border-none ${
                            sortBy === option.value
                              ? "bg-blue-500/20 text-blue-400 font-semibold [.light-theme_&]:!bg-[#e0edff] [.light-theme_&]:!text-blue-600"
                              : "text-white/70 hover:bg-white/5 hover:text-white [.light-theme_&]:!text-[#334155] [.light-theme_&]:hover:!bg-[#f1f2f6] [.light-theme_&]:hover:!text-[#0f172a]"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div ref={filterRef} className="relative shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isFilterOpen) {
                      getAllTags().then(setAllTags);
                    }
                    setIsFilterOpen(!isFilterOpen);
                    setIsSortOpen(false);
                  }}
                  className={`w-8 h-8 sm:w-8.5 sm:h-8.5 rounded-full flex items-center justify-center transition cursor-pointer border-0 border-none [.light-theme_&]:!border-none shadow-xs ${selectedTags.length > 0 || isFilterOpen ? "bg-blue-500/20 text-blue-400 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-[#007aff]" : "bg-white/10 hover:bg-white/15 text-white/80 hover:text-white [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:hover:!bg-[#cbd5e1] [.light-theme_&]:!text-[#475569] [.light-theme_&]:hover:!text-[#0f172a]"}`}
                  title="筛选"
                >
                  <Filter className="w-4.5 h-4.5 stroke-[1.75]" />
                </button>

                <AnimatePresence>
                  {isFilterOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-slate-800 border border-white/10 rounded-3xl shadow-2xl z-50 p-5 sm:p-6 max-h-[65vh] overflow-y-auto overscroll-contain touch-pan-y miu-skin [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-none [.light-theme_&]:!shadow-2xl"
                    >
                      <div className="flex items-center justify-between mb-4 relative h-7">
                        {!isTagSearchOpen ? (
                          <div className="absolute inset-0 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-sm sm:text-base text-white [.light-theme_&]:!text-[#0f172a]">
                                按标签筛选
                              </h3>
                              <button
                                onClick={() => setIsTagSearchOpen(true)}
                                className="text-white/40 hover:text-white transition p-1 [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#0f172a] cursor-pointer"
                                title="搜索标签"
                              >
                                <Search className="w-4 h-4" />
                              </button>
                            </div>
                            <div className="flex items-center gap-2.5">
                              {selectedTags.length > 0 && !isTagEditMode && (
                                <button
                                  onClick={() => setSelectedTags([])}
                                  className="text-xs font-semibold text-red-400 hover:text-red-300 transition [.light-theme_&]:!text-red-500 [.light-theme_&]:hover:!text-red-600 cursor-pointer"
                                >
                                  清除选中
                                </button>
                              )}
                              {allTags.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setIsTagEditMode((prev) => !prev)}
                                  className={`text-xs font-semibold px-2.5 py-0.5 rounded-full transition cursor-pointer ${
                                    isTagEditMode
                                      ? "bg-blue-500/20 text-blue-300 [.light-theme_&]:!bg-[#eff6ff] [.light-theme_&]:!text-[#007aff]"
                                      : "text-white/55 hover:text-white [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#0f172a]"
                                  }`}
                                  title={isTagEditMode ? "退出标签编辑" : "编辑或删除标签"}
                                >
                                  {isTagEditMode ? "完成" : "编辑"}
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <motion.div
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width: "100%", opacity: 1 }}
                            className="absolute right-0 flex items-center bg-white/10 rounded-xl overflow-hidden h-full px-2 [.light-theme_&]:!bg-[#f1f2f6] [.light-theme_&]:!border-none"
                          >
                            <Search className="w-4 h-4 text-white/40 shrink-0 [.light-theme_&]:!text-[#64748b]" />
                            <input
                              autoFocus
                              type="text"
                              placeholder="搜索标签..."
                              value={tagSearchQuery}
                              onChange={(e) =>
                                setTagSearchQuery(e.target.value)
                              }
                              className="w-full bg-transparent text-xs sm:text-sm text-white placeholder:text-white/40 [.light-theme_&]:placeholder:!text-[#94a3b8] px-2 py-1 outline-none min-w-0 [.light-theme_&]:bg-transparent [.light-theme_&]:!text-[#0f172a]"
                            />
                            <button
                              onClick={() => {
                                setIsTagSearchOpen(false);
                                setTagSearchQuery("");
                              }}
                              className="p-1 hover:bg-white/10 rounded-md text-white/60 hover:text-white transition shrink-0 [.light-theme_&]:hover:!bg-black/10 [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#0f172a] cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </motion.div>
                        )}
                      </div>
                      {isTagEditMode && allTags.length > 0 && (
                        <p className="text-[11px] text-white/45 [.light-theme_&]:!text-[#64748b] mb-2.5">
                          点击任意标签可重命名或删除
                        </p>
                      )}
                      {allTags.length === 0 ? (
                        <p className="text-xs sm:text-sm text-white/40 py-4 [.light-theme_&]:!text-[#64748b]">无可用标签</p>
                      ) : (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-1">
                          {allTags
                            .filter((tag) =>
                              tag
                                .toLowerCase()
                                .includes(tagSearchQuery.toLowerCase()),
                            )
                            .map((tag) => {
                              const isSelected = selectedTags.includes(tag);

                              return (
                                <button
                                  key={tag}
                                  style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
                                  onTouchStart={() => handleTagTouchStart(tag)}
                                  onTouchEnd={handleTagTouchEnd}
                                  onTouchCancel={handleTagTouchEnd}
                                  onTouchMove={handleTagTouchEnd}
                                  onMouseDown={() => handleTagTouchStart(tag)}
                                  onMouseUp={handleTagTouchEnd}
                                  onMouseLeave={handleTagTouchEnd}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (tagLongPressTriggeredRef.current) return;
                                    handleTagTouchEnd();
                                    setTagActionModal(tag);
                                  }}
                                  onClick={() => {
                                    if (tagLongPressTriggeredRef.current) return;
                                    if (isTagEditMode) {
                                      setTagActionModal(tag);
                                      return;
                                    }
                                    if (isSelected) {
                                      setSelectedTags(
                                        selectedTags.filter((t) => t !== tag),
                                      );
                                    } else {
                                      setSelectedTags([...selectedTags, tag]);
                                    }
                                  }}
                                  className={`px-3.5 py-1.5 rounded-2xl text-xs sm:text-sm font-medium transition-all cursor-pointer select-none active:scale-95 border-none inline-flex items-center gap-1.5 ${
                                    isTagEditMode
                                      ? "bg-blue-500/15 text-blue-200 ring-1 ring-blue-400/35 hover:bg-blue-500/25 [.light-theme_&]:!bg-[#eff6ff] [.light-theme_&]:!text-[#007aff] [.light-theme_&]:ring-1 [.light-theme_&]:ring-[#bfdbfe] [.light-theme_&]:hover:!bg-[#dbeafe]"
                                      : isSelected 
                                        ? "bg-blue-500/25 text-blue-300 font-semibold [.light-theme_&]:!bg-blue-600 [.light-theme_&]:!text-[#ffffff] shadow-xs" 
                                        : "bg-white/5 text-white/75 hover:text-white hover:bg-white/10 [.light-theme_&]:!bg-[#f1f2f6] [.light-theme_&]:!text-[#2c3e50] [.light-theme_&]:hover:!bg-[#e4e7eb] [.light-theme_&]:hover:!text-[#0f172a]"
                                  }`}
                                  title={isTagEditMode ? "点击重命名或删除此标签" : "点击筛选标签，长按管理标签"}
                                >
                                  <span>{tag}</span>
                                </button>
                              );
                            })}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </motion.header>

      {totalItems === 0 && !hasLoadedOnce ? null : totalItems === 0 ? (
        isSearching && debouncedSearchQuery.trim() ? (
          <div className="flex flex-col items-center justify-center min-h-[16rem] text-slate-400 px-4 text-center [.light-theme_&]:!text-[#64748b]">
            <Loader2 className="w-8 h-8 mb-3 animate-spin text-blue-400 [.light-theme_&]:!text-[#007aff]" />
            <p className="[.light-theme_&]:!text-[#0f172a] font-medium text-sm">
              正在「{activeScopeOption.label}」中搜索...
            </p>
          </div>
        ) : debouncedSearchQuery.trim() ? (
          <div className="flex flex-col items-center justify-center min-h-[16rem] text-slate-400 px-4 text-center [.light-theme_&]:!text-[#64748b]">
            <Search className="w-12 h-12 mb-3 opacity-40 [.light-theme_&]:!text-[#94a3b8]" />
            <p className="[.light-theme_&]:!text-[#0f172a] font-medium">
              在「{activeScopeOption.label}」中未找到匹配卡片
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
              {searchScope !== "all" && (
                <button
                  type="button"
                  onClick={() => selectSearchScope("all")}
                  className="px-4 py-1.5 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 [.light-theme_&]:!bg-[#e0edff] [.light-theme_&]:!text-[#007aff] transition cursor-pointer"
                >
                  改为搜索全部内容（含作者/备注/开场白/备忘录）
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  isComposingRef.current = false;
                  setSearchQuery("");
                  setDebouncedSearchQuery("");
                  setSearchScope("basic");
                }}
                className="px-4 py-1.5 rounded-full text-xs font-medium bg-white/10 hover:bg-white/15 text-white/80 [.light-theme_&]:!bg-[#f1f2f6] [.light-theme_&]:hover:!bg-[#e4e7eb] [.light-theme_&]:!text-[#475569] transition cursor-pointer"
              >
                清空搜索
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400 px-4 [.light-theme_&]:!text-[#64748b]">
            <BookOpen className="w-16 h-16 mb-4 opacity-50 [.light-theme_&]:!text-[#94a3b8]" />
            <p className="[.light-theme_&]:!text-[#0f172a] font-medium">No characters found.</p>
            <p className="text-sm [.light-theme_&]:!text-[#64748b]">Tap the + button to import.</p>
          </div>
        )
      ) : (
        <div className={`px-4 transition-all duration-200 ${selectionMode ? 'pb-36 sm:pb-40' : 'pb-12 sm:pb-16'}`}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={(event) => {
              isDraggingRef.current = true;
              if (longPressRef.current.timer) {
                clearTimeout(longPressRef.current.timer);
                longPressRef.current.timer = null;
              }
              const idStr = String(event.active.id);
              setActiveDragId(idStr);
            }}
            onDragEnd={(event) => {
              isDraggingRef.current = false;
              const moved =
                Math.hypot(event.delta?.x || 0, event.delta?.y || 0) > 6 ||
                Boolean(event.over && event.active.id !== event.over.id);
              if (moved) {
                lastDragEndTimeRef.current = Date.now();
              }
              setActiveDragId(null);
              handleDragEnd(event);
            }}
            onDragCancel={() => {
              isDraggingRef.current = false;
              setActiveDragId(null);
            }}
          >
            <SortableContext
              items={[
                ...paginatedFolders.map((f) => `folder-${f.id}`),
                ...characters.map((c) => `char-${c.id}`),
              ]}
              strategy={rectSortingStrategy}
            >
              {(paginatedFolders.length > 0 ||
                (page === 1 && !searchQuery && selectedTags.length === 0)) && (
                <div
                  className={
                    viewMode === "list"
                      ? "flex flex-col gap-2 mb-2"
                      : viewMode === "grid"
                        ? "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4 mb-4 sm:mb-5"
                        : "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4 mb-4 sm:mb-5"
                  }
                >


                  {paginatedFolders.map((folder) => {
                    const previews = folderPreviews[folder.id] || [];
                    return (
                      <SortableItemWrapper
                        key={`folder-${folder.id}`}
                        id={`folder-${folder.id}`}
                        disabled={!!searchQuery || selectedTags.length > 0}
                        activeDragIsQR={activeIsQR}
                        activeDragCharId={activeChar?.id || null}
                      >
                        <div
                          style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none", touchAction: "pan-y" }}
                          onTouchStart={(e) => {
                            if (selectionMode || isDraggingRef.current) return;
                            (longPressRef.current as any).touchHandled = true;
                            longPressRef.current.triggered = false;
                            longPressRef.current.startX = e.touches[0].clientX;
                            longPressRef.current.startY = e.touches[0].clientY;
                            if (longPressRef.current.timer) clearTimeout(longPressRef.current.timer);
                            longPressRef.current.timer = setTimeout(() => {
                              if (isDraggingRef.current) return;
                              longPressRef.current.triggered = true;
                              if (!selectionMode) {
                                setSelectionMode(true);
                                setSelectedIds(new Set([folder.id]));
                                setIsHeaderVisible(true);
                              }
                            }, 550);
                          }}
                          onTouchMove={(e) => {
                            if (longPressRef.current.timer && e.touches[0]) {
                              const dx = Math.abs(e.touches[0].clientX - (longPressRef.current.startX || 0));
                              const dy = Math.abs(e.touches[0].clientY - (longPressRef.current.startY || 0));
                              if (dx > 10 || dy > 10 || isDraggingRef.current) {
                                clearTimeout(longPressRef.current.timer);
                                longPressRef.current.timer = null;
                              }
                            }
                          }}
                          onTouchEnd={() => {
                            if (longPressRef.current.timer) {
                              clearTimeout(longPressRef.current.timer);
                              longPressRef.current.timer = null;
                            }
                            setTimeout(() => { (longPressRef.current as any).touchHandled = false; }, 300);
                          }}
                          onTouchCancel={() => {
                            if (longPressRef.current.timer) {
                              clearTimeout(longPressRef.current.timer);
                              longPressRef.current.timer = null;
                            }
                            setTimeout(() => { (longPressRef.current as any).touchHandled = false; }, 300);
                          }}
                          onMouseDown={(e) => {
                            if (selectionMode || isDraggingRef.current || e.button !== 0 || (longPressRef.current as any).touchHandled) return;
                            longPressRef.current.triggered = false;
                            longPressRef.current.startX = e.clientX;
                            longPressRef.current.startY = e.clientY;
                            if (longPressRef.current.timer) clearTimeout(longPressRef.current.timer);
                            longPressRef.current.timer = setTimeout(() => {
                              if (isDraggingRef.current) return;
                              longPressRef.current.triggered = true;
                              if (!selectionMode) {
                                setSelectionMode(true);
                                setSelectedIds(new Set([folder.id]));
                                setIsHeaderVisible(true);
                              }
                            }, 550);
                          }}
                          onMouseMove={(e) => {
                            if (longPressRef.current.timer) {
                              const dx = Math.abs(e.clientX - (longPressRef.current.startX || 0));
                              const dy = Math.abs(e.clientY - (longPressRef.current.startY || 0));
                              if (dx > 10 || dy > 10 || isDraggingRef.current) {
                                clearTimeout(longPressRef.current.timer);
                                longPressRef.current.timer = null;
                              }
                            }
                          }}
                          onMouseUp={() => {
                            if (longPressRef.current.timer) {
                              clearTimeout(longPressRef.current.timer);
                              longPressRef.current.timer = null;
                            }
                          }}
                          onMouseLeave={() => {
                            if (longPressRef.current.timer) {
                              clearTimeout(longPressRef.current.timer);
                              longPressRef.current.timer = null;
                            }
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (longPressRef.current.triggered) return;
                            if (longPressRef.current.timer) {
                              clearTimeout(longPressRef.current.timer);
                              longPressRef.current.timer = null;
                            }
                            longPressRef.current.triggered = true;
                            if (!selectionMode) {
                              setSelectionMode(true);
                              setSelectedIds(new Set([folder.id]));
                              setIsHeaderVisible(true);
                            }
                          }}
                          onClick={(e) => {
                            if (longPressRef.current.triggered || Date.now() - lastDragEndTimeRef.current < 450) {
                              longPressRef.current.triggered = false;
                              e.preventDefault();
                              e.stopPropagation();
                              return;
                            }
                            if (selectionMode) {
                              toggleSelection(folder.id);
                            } else {
                              if (searchQuery) {
                                setSearchQuery("");
                                setDebouncedSearchQuery("");
                              }
                              onSelectFolder?.(folder.id);
                            }
                          }}
                          className={`${
                            viewMode === "list"
                              ? "flex items-center gap-4 p-3 rounded-2xl cursor-pointer transition duration-150 ease-out relative group select-none border bg-white/5 hover:bg-white/10 border-transparent overflow-hidden"
                              : "flex flex-col items-center cursor-pointer group relative select-none break-inside-avoid w-full rounded-2xl transition duration-150 ease-out border border-transparent"
                          } ${
                            selectedIds.has(folder.id)
                              ? viewMode === "list" ? "scale-[0.97]" : "scale-[0.93]"
                              : selectionMode
                                ? "active:scale-[0.92]"
                                : "hover:scale-[1.03] active:scale-[0.92]"
                          }`}
                        >
                          <FrostedFolderCover
                            folder={folder}
                            previews={previews}
                            viewMode={viewMode}
                            isSelected={selectedIds.has(folder.id)}
                          />

                          {viewMode === "list" ? (
                            <div className="flex-1 min-w-0 flex flex-col justify-center">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-white/90 truncate [.light-theme_&]:!text-[#0f172a]">{folder.name}</span>
                                <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300 font-medium shrink-0 [.light-theme_&]:!bg-[#e0edff] [.light-theme_&]:!text-[#007aff] [.light-theme_&]:!border-none">
                                  {folderCounts[folder.id]?.chars ?? 0} 照片{folderCounts[folder.id]?.subfolders ? ` · ${folderCounts[folder.id]?.subfolders} 文件夹` : ''}
                                </span>
                              </div>
                              {debouncedSearchQuery && folderPaths[folder.id] && folderPaths[folder.id] !== folder.name && (
                                <span className="text-xs text-blue-300/70 truncate mt-0.5 [.light-theme_&]:!text-blue-600">
                                  路径: {folderPaths[folder.id]}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col items-center w-full min-w-0 px-1 mt-1.5 text-center">
                              <span className="text-xs font-semibold text-white/90 group-hover:text-white transition truncate w-full [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:group-hover:!text-black">
                                {folder.name}
                              </span>
                              <span className="text-[11px] text-white/45 group-hover:text-white/65 transition truncate mt-0.5 [.light-theme_&]:!text-[#64748b] [.light-theme_&]:group-hover:!text-[#334155]">
                                {folderCounts[folder.id]?.chars ?? 0} 照片{folderCounts[folder.id]?.subfolders ? ` · ${folderCounts[folder.id]?.subfolders} 文件夹` : ''}
                              </span>
                              {debouncedSearchQuery && folderPaths[folder.id] && folderPaths[folder.id] !== folder.name && (
                                <span className="text-[10px] text-blue-300/70 truncate w-full text-center px-1 mt-0.5 [.light-theme_&]:!text-blue-600">
                                  {folderPaths[folder.id]}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </SortableItemWrapper>
                    );
                  })}
                </div>
              )}

              {folderId === "favorites" && characters.length === 0 && !searchQuery && selectedTags.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-white/40 [.light-theme_&]:!text-[#64748b]">
                  <Heart className="w-12 h-12 mb-3 text-rose-500/40 fill-rose-500/20 stroke-1" />
                  <p className="text-base font-medium [.light-theme_&]:!text-[#0f172a]">暂无收藏的角色卡</p>
                  <p className="text-xs mt-1 text-white/30 [.light-theme_&]:!text-[#64748b]">
                    点击卡片右上角的红心图标即可快速收藏
                  </p>
                </div>
              )}

              {paginatedFolders.length === 0 && characters.length === 0 && (searchQuery || selectedTags.length > 0) && (
                <div className="flex flex-col items-center justify-center py-20 text-white/40 [.light-theme_&]:!text-[#64748b]">
                  <Search className="w-12 h-12 mb-3 text-white/20 stroke-1 [.light-theme_&]:!text-[#94a3b8]" />
                  <p className="text-base font-medium [.light-theme_&]:!text-[#0f172a]">未找到匹配的角色卡或文件夹</p>
                  <p className="text-xs mt-1 text-white/30 [.light-theme_&]:!text-[#64748b]">
                    已搜索全部目录，尝试更换关键词或清除筛选标签
                  </p>
                </div>
              )}

              {viewMode === "masonry" ? (
                <Masonry
                  breakpointCols={{ default: 5, 1024: 4, 768: 3, 640: 2 }}
                  className="flex w-auto gap-4"
                  columnClassName="bg-clip-padding flex flex-col gap-4"
                >
                  {characters.map((char) => (
                    <SortableItemWrapper
                      key={`char-${char.id}`}
                      id={`char-${char.id}`}
                      disabled={!!searchQuery || selectedTags.length > 0}
                      className="w-full"
                      isQR={checkIsQR(char)}
                      activeDragIsQR={activeIsQR}
                      activeDragCharId={activeChar?.id || null}
                    >
                      <CharacterCardItem
                        char={char}
                        selectionMode={selectionMode}
                        isSelected={selectedIds.has(char.id)}
                        viewMode={viewMode}
                        showMainTokens={showMainTokens}
                        onClick={() => {
                          if (selectionMode) toggleSelection(char.id);
                          else onSelect(char.id);
                        }}
                        onLongPress={() => {
                          if (!selectionMode) {
                            setSelectionMode(true);
                            setSelectedIds(new Set([char.id]));
                            setIsHeaderVisible(true);
                          }
                        }}
                        onToggleFavorite={(e) => handleToggleFavorite(e, char.id)}
                        onOpenTokenBreakdown={handleOpenTokenBreakdown}
                      />
                    </SortableItemWrapper>
                  ))}
                </Masonry>
              ) : (
                <div
                  className={
                    viewMode === "grid"
                      ? "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4"
                      : "flex flex-col gap-2"
                  }
                >
                  {characters.map((char) => (
                    <SortableItemWrapper
                      key={`char-${char.id}`}
                      id={`char-${char.id}`}
                      disabled={!!searchQuery || selectedTags.length > 0}
                      isQR={checkIsQR(char)}
                      activeDragIsQR={activeIsQR}
                      activeDragCharId={activeChar?.id || null}
                    >
                      <CharacterCardItem
                        char={char}
                        selectionMode={selectionMode}
                        isSelected={selectedIds.has(char.id)}
                        viewMode={viewMode}
                        showMainTokens={showMainTokens}
                        onClick={() => {
                          if (selectionMode) toggleSelection(char.id);
                          else onSelect(char.id);
                        }}
                        onLongPress={() => {
                          if (!selectionMode) {
                            setSelectionMode(true);
                            setSelectedIds(new Set([char.id]));
                            setIsHeaderVisible(true);
                          }
                        }}
                        onToggleFavorite={(e) => handleToggleFavorite(e, char.id)}
                        onOpenTokenBreakdown={handleOpenTokenBreakdown}
                      />
                    </SortableItemWrapper>
                  ))}
                </div>
              )}
            </SortableContext>
          </DndContext>

          {/* Dedicated bottom spacer when in selectionMode on mobile/desktop */}
          {selectionMode && (
            <div className="w-full h-36 sm:h-44 shrink-0 pointer-events-none" aria-hidden="true" />
          )}

          {!selectionMode && (totalPages > 1 || totalItems > 0) && (
            <div className="flex justify-center items-center mt-12 mb-8 text-sm">
              <div className="flex items-center bg-white/5 rounded-xl p-1 border border-white/10 [.light-theme_&]:!bg-[#f1f2f6] [.light-theme_&]:!border-none">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-30 transition text-white [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:hover:!bg-[#e4e7eb]"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                <div className="flex items-center gap-2 text-slate-400 px-2 [.light-theme_&]:!text-[#64748b]">
                  <span>第</span>
                  <input
                    type="text"
                    value={pageInputValue}
                    onChange={(e) => {
                      setPageInputValue(e.target.value);
                    }}
                    onBlur={() => {
                      const val = parseInt(pageInputValue);
                      if (!isNaN(val) && val >= 1 && val <= totalPages) {
                        setPage(val);
                      } else {
                        setPageInputValue(page.toString());
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      }
                    }}
                    className="w-10 bg-black/20 border border-white/10 rounded-lg px-1 py-1 text-center text-white font-medium focus:outline-none focus:border-blue-500 transition [.light-theme_&]:!bg-[#e4e7eb] [.light-theme_&]:!border-none [.light-theme_&]:!text-[#0f172a]"
                  />
                  <span>/ {totalPages} 页</span>
                  <div className="w-px h-4 bg-white/10 mx-1 [.light-theme_&]:!bg-[#cbd5e1]" />
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="bg-transparent border-none text-white font-medium focus:outline-none cursor-pointer py-1 [.light-theme_&]:!text-[#0f172a]"
                  >
                    <option value={50} className="bg-slate-800 [.light-theme_&]:!bg-white [.light-theme_&]:!text-[#0f172a]">
                      50/页
                    </option>
                    <option value={100} className="bg-slate-800 [.light-theme_&]:!bg-white [.light-theme_&]:!text-[#0f172a]">
                      100/页
                    </option>
                    <option value={250} className="bg-slate-800 [.light-theme_&]:!bg-white [.light-theme_&]:!text-[#0f172a]">
                      250/页
                    </option>
                    <option value={500} className="bg-slate-800 [.light-theme_&]:!bg-white [.light-theme_&]:!text-[#0f172a]">
                      500/页
                    </option>
                  </select>
                </div>

                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-30 transition text-white [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:hover:!bg-[#e4e7eb]"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {everMoveModalOpen && (
        <Suspense fallback={null}>
          <MoveToFolderModal
            isOpen={isMoveModalOpen}
            onClose={() => setIsMoveModalOpen(false)}
            onMove={handleMoveToFolder}
            isLightMode={isLightMode}
          />
        </Suspense>
      )}

      {everBindModalOpen && (
        <Suspense fallback={null}>
          <BindQRModal
            isOpen={isBindModalOpen}
            onClose={() => setIsBindModalOpen(false)}
            onBind={handleBindQR}
            characters={characters}
            isLightMode={isLightMode}
            qrChar={
              characters.find((c) => c.id === Array.from(selectedIds)[0]) || null
            }
          />
        </Suspense>
      )}

      {everConfirmBindOpen && (
        <Suspense fallback={null}>
          <ConfirmBindQRModal
            isOpen={!!pendingQRBinding}
            onClose={() => setPendingQRBinding(null)}
            onConfirm={(deleteSource) => {
              if (pendingQRBinding) {
                executeBindQR(
                  pendingQRBinding.qrChar.id,
                  pendingQRBinding.targetChar.id,
                  deleteSource,
                );
              }
            }}
            qrChar={pendingQRBinding?.qrChar || null}
            targetChar={pendingQRBinding?.targetChar || null}
            isLightMode={isLightMode}
          />
        </Suspense>
      )}

      <AnimatePresence>
        {!selectionMode ? (
          <div className="fixed bottom-24 sm:bottom-28 right-6 sm:right-8 z-40 flex flex-col items-center gap-2.5">
            {/* 1. 一键回顶 (半透明毛玻璃小球，触发滚动时显示在最上方) */}
            <AnimatePresence>
              {showScrollTop && (
                <motion.button
                  key="scroll-top-btn"
                  initial={{ opacity: 0, scale: 0.8, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, y: 10 }}
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={scrollToTop}
                  className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-xl transition-all duration-200 cursor-pointer shrink-0 shadow-md bg-slate-900/80 hover:bg-slate-800 border border-white/20 text-white [.light-theme_&]:!bg-white [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:hover:!bg-[#f1f5f9] [.light-theme_&]:!shadow-md active:scale-95"
                  title="回到顶部"
                >
                  <ChevronLeft className="w-5 h-5 rotate-90 stroke-[2.2]" />
                </motion.button>
              )}
            </AnimatePresence>

            {/* 2. 点击加号后展开的小球选项组 (新建文件夹 & 导入) */}
            <AnimatePresence>
              {isAddMenuOpen && (
                <motion.div
                  key="fab-popover-balls"
                  initial={{ opacity: 0, y: 12, scale: 0.85 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 12, scale: 0.85 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="flex flex-col items-center gap-2.5"
                >
                  {/* 📁 新建文件夹小球 (单色图标) */}
                  <motion.button
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.92 }}
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      setIsCreatingFolder(true);
                    }}
                    className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-xl transition-all duration-200 cursor-pointer shrink-0 shadow-md bg-slate-900/80 hover:bg-slate-800 border border-white/20 text-white [.light-theme_&]:!bg-white [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:hover:!bg-[#f1f5f9] [.light-theme_&]:!shadow-md active:scale-95"
                    title="新建文件夹"
                  >
                    <FolderPlus className="w-4.5 h-4.5 stroke-[2]" />
                  </motion.button>

                  {/* 📥 导入角色/数据小球 (单色图标) */}
                  <motion.button
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.92 }}
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      onImport();
                    }}
                    className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-xl transition-all duration-200 cursor-pointer shrink-0 shadow-md bg-slate-900/80 hover:bg-slate-800 border border-white/20 text-white [.light-theme_&]:!bg-white [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:hover:!bg-[#f1f5f9] [.light-theme_&]:!shadow-md active:scale-95"
                    title="导入角色/数据"
                  >
                    <UploadCloud className="w-4.5 h-4.5 stroke-[2]" />
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 3. 主加号 (➕) 触发小球 (单色图标) */}
            <motion.button
              key="fab-main-trigger"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
              className="w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-xl transition-all duration-200 cursor-pointer shrink-0 shadow-md bg-slate-900/80 hover:bg-slate-800 border border-white/20 text-white [.light-theme_&]:!bg-white [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:hover:!bg-[#f1f5f9] [.light-theme_&]:!shadow-md active:scale-95"
              title="展开选项"
            >
              <Plus className={`w-5 h-5 stroke-[2.2] transition-transform duration-200 ${isAddMenuOpen ? 'rotate-45' : ''}`} />
            </motion.button>
          </div>
        ) : (
          <motion.div
            key="bottom-bar"
            initial={{ y: 24, opacity: 0, scale: 0.95, x: "-50%" }}
            animate={{ y: 0, opacity: 1, scale: 1, x: "-50%" }}
            exit={{ y: 20, opacity: 0, scale: 0.95, x: "-50%" }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="floating-pill-dock fixed bottom-6 left-1/2 z-50 rounded-full px-2 sm:px-3 py-1.5 transition-all max-w-[calc(100vw-1rem)] sm:max-w-max"
          >
            <div
              className="flex items-center gap-0.5 sm:gap-1.5 px-0.5 overflow-x-auto hide-scrollbar"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              <button
                onClick={() => setIsMoveModalOpen(true)}
                disabled={selectedIds.size === 0}
                className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-full transition active:scale-90 shrink-0 disabled:opacity-30 disabled:pointer-events-none"
              >
                <FolderInput className="w-5 h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight">移动</span>
              </button>

              {selectedIds.size === 1 &&
                folders.some((f) => f.id === Array.from(selectedIds)[0]) && (
                  <button
                    onClick={() => {
                      const folderId = Array.from(selectedIds)[0];
                      const folder = folders.find((f) => f.id === folderId);
                      if (folder) {
                        setEditingFolder(folder);
                        setNewFolderName(folder.name);
                        setSelectionMode(false);
                        setSelectedIds(new Set());
                      }
                    }}
                    className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-full transition active:scale-90 shrink-0 disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <Edit2 className="w-5 h-5 stroke-[1.8]" />
                    <span className="font-medium text-[10px] leading-none tracking-tight">重命名</span>
                  </button>
                )}

              {selectedIds.size === 2 &&
                Array.from(selectedIds).every(
                  (id) => !folders.some((f) => f.id === id),
                ) && (
                  <button
                    type="button"
                    onClick={() => {
                      const ids = Array.from(selectedIds);
                      if (ids.length === 2) {
                        setComparePairIds([ids[0], ids[1]]);
                      }
                    }}
                    className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-full transition active:scale-90 shrink-0 hover:!text-blue-400 [.light-theme_&]:hover:!text-[#007aff] cursor-pointer"
                    title="快速对比选中的两张卡片"
                  >
                    <ArrowLeftRight className="w-5 h-5 stroke-[1.8]" />
                    <span className="font-medium text-[10px] leading-none tracking-tight">对比</span>
                  </button>
                )}

              {selectedIds.size === 1 &&
                (() => {
                  const charId = Array.from(selectedIds)[0];
                  const char = characters.find((c) => c.id === charId);
                  return char && checkIsQR(char);
                })() && (
                  <button
                    onClick={() => setIsBindModalOpen(true)}
                    className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-full transition active:scale-90 shrink-0 hover:!text-blue-400 disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <Link2 className="w-5 h-5 stroke-[1.8]" />
                    <span className="font-medium text-[10px] leading-none tracking-tight">绑定</span>
                  </button>
                )}

              {selectedIds.size > 0 &&
                Array.from(selectedIds).every((id) =>
                  folders.some((f) => f.id === id),
                ) && (
                  <button
                    onClick={() => {
                      if (selectedIds.size === 1) {
                        const selectedFolderId = Array.from(selectedIds)[0];
                        const targetFolder = folders.find((f) => f.id === selectedFolderId);
                        if (targetFolder) {
                          setCoverPickerFolder(targetFolder);
                          return;
                        }
                      }
                      coverInputRef.current?.click();
                    }}
                    disabled={selectedIds.size === 0}
                    className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-full transition active:scale-90 shrink-0 hover:!text-orange-500 disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <ImageIcon className="w-5 h-5 stroke-[1.8]" />
                    <span className="font-medium text-[10px] leading-none tracking-tight">换封面</span>
                  </button>
                )}

              <button
                onClick={handleBatchCloudBackup}
                disabled={selectedIds.size === 0}
                className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-full transition active:scale-90 shrink-0 hover:!text-blue-500 disabled:opacity-30 disabled:pointer-events-none"
              >
                <Cloud className="w-5 h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight">传云盘</span>
              </button>

              <button
                onClick={() => handleBatchExport()}
                disabled={selectedIds.size === 0}
                className="floating-pill-item flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-full transition active:scale-90 shrink-0 hover:!text-green-500 disabled:opacity-30 disabled:pointer-events-none"
              >
                <Download className="w-5 h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight">导出</span>
              </button>

              <button
                onClick={handleBatchDelete}
                disabled={selectedIds.size === 0}
                className="floating-pill-item is-danger flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-full transition active:scale-90 shrink-0 cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
              >
                <Trash2 className="w-5 h-5 stroke-[1.8]" />
                <span className="font-medium text-[10px] leading-none tracking-tight whitespace-nowrap">
                  删除{selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                </span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {progress && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%', scale: 0.95 }}
            animate={{ opacity: 1, y: 0, x: '-50%', scale: 1 }}
            exit={{ opacity: 0, y: -20, x: '-50%', scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            style={{ top: 'max(1.25rem, calc(env(safe-area-inset-top, 0px) + 0.5rem))' }}
            className="tagger-floating-pill fixed left-1/2 z-[600] rounded-full px-4 py-2 sm:px-4.5 sm:py-2.5 flex items-center gap-2.5 max-w-[92vw] w-auto pointer-events-auto transition-all overflow-hidden select-none shadow-2xl"
          >
            <Loader2 className="w-4 h-4 animate-spin shrink-0 text-blue-400 [.light-theme_&]:!text-blue-600" />
            <span className="text-xs sm:text-sm font-medium text-slate-100 whitespace-nowrap tagger-floating-text [.light-theme_&]:!text-[#0f172a] truncate">
              {progress.message || '正在处理'}
            </span>
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full shrink-0 border-0 border-none outline-none text-blue-300 bg-blue-500/20 [.light-theme_&]:!text-blue-600 [.light-theme_&]:!bg-blue-50 tabular-nums">
              {progress.total > 0 ? (progress.total > 1 ? `${progress.current}/${progress.total}` : `${Math.round((progress.current / progress.total) * 100)}%`) : `${progress.current || 0}`}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(isCreatingFolder || editingFolder) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={`w-full max-w-xs sm:max-w-sm rounded-3xl p-5 sm:p-6 shadow-2xl backdrop-blur-2xl select-none transition-colors border ${
                isLightMode
                  ? "bg-white text-[#0f172a] border-[#e2e8f0] shadow-xl [.light-theme_&]:!bg-white [.light-theme_&]:!text-[#0f172a]"
                  : "bg-slate-800/95 text-white border-white/10 [.light-theme_&]:!bg-white [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#e2e8f0]"
              }`}
            >
              <h3
                className={`text-base sm:text-lg font-bold mb-4 sm:mb-6 text-center ${
                  isLightMode
                    ? "text-[#0f172a] [.light-theme_&]:!text-[#0f172a]"
                    : "text-white [.light-theme_&]:!text-[#0f172a]"
                }`}
              >
                {editingFolder ? "编辑文件夹" : "新建文件夹"}
              </h3>
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="文件夹名称"
                className={`w-full rounded-2xl px-4 py-2.5 sm:py-3 mb-4 sm:mb-6 text-center text-sm sm:text-base font-medium transition outline-none border ${
                  isLightMode
                    ? "bg-[#f1f5f9] border-[#cbd5e1] text-[#0f172a] placeholder:text-[#94a3b8] focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#cbd5e1]"
                    : "bg-black/20 border-white/10 text-white placeholder:text-white/40 focus:border-blue-500/50 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:placeholder:!text-[#94a3b8]"
                }`}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    editingFolder ? handleUpdateFolder() : handleCreateFolder();
                  }
                  if (e.key === "Escape") {
                    setIsCreatingFolder(false);
                    setEditingFolder(null);
                  }
                }}
              />
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={
                    editingFolder ? handleUpdateFolder : handleCreateFolder
                  }
                  className="w-full py-2.5 sm:py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-semibold transition active:scale-95 shadow-md shadow-blue-500/20 cursor-pointer"
                >
                  {editingFolder ? "保存修改" : "创建"}
                </button>
                {editingFolder && (
                  <button
                    type="button"
                    onClick={() => {
                      handleDeleteFolder(editingFolder.id, editingFolder.name);
                      setIsCreatingFolder(false);
                      setEditingFolder(null);
                    }}
                    className={`w-full py-2.5 sm:py-3 rounded-2xl text-xs sm:text-sm font-semibold transition active:scale-95 cursor-pointer ${
                      isLightMode
                        ? "bg-rose-50 hover:bg-rose-100 text-rose-600 [.light-theme_&]:!bg-rose-50 [.light-theme_&]:!text-rose-600"
                        : "bg-red-500/10 hover:bg-red-500/20 text-red-400 [.light-theme_&]:!bg-rose-50 [.light-theme_&]:!text-rose-600"
                    }`}
                  >
                    删除文件夹
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingFolder(false);
                    setEditingFolder(null);
                  }}
                  className={`w-full py-2.5 sm:py-3 rounded-2xl text-xs sm:text-sm font-semibold transition mt-1 active:scale-95 cursor-pointer ${
                    isLightMode
                      ? "bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#334155] border border-[#cbd5e1]/40 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#334155]"
                      : "bg-white/5 hover:bg-white/10 text-white/70 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#334155] [.light-theme_&]:!border [.light-theme_&]:!border-[#cbd5e1]/40"
                  }`}
                >
                  取消
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {imageToCrop && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md pt-[max(1.75rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="bg-slate-900 [.light-theme_&]:!bg-[#ffffff] text-white [.light-theme_&]:!text-[#0f172a] border border-white/10 [.light-theme_&]:!border-[#e2e8f0] rounded-3xl w-full max-w-lg flex flex-col shadow-2xl overflow-hidden max-h-[92vh] sm:max-h-[85vh]">
            <div className="p-4 border-b border-white/10 [.light-theme_&]:!border-[#e2e8f0] flex items-center justify-between bg-white/[0.02] [.light-theme_&]:!bg-transparent">
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-white [.light-theme_&]:!text-[#0f172a]">调整封面图片</h3>
                <span className="text-[10.5px] text-blue-400 bg-blue-500/15 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-[#007aff] px-2.5 py-0.5 rounded-full font-bold">
                  2:3 竖卡
                </span>
              </div>

              <button
                onClick={closeCrop}
                className="w-8.5 h-8.5 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition [.light-theme_&]:!bg-[#f1f2f6] [.light-theme_&]:hover:!bg-[#e4e7eb] [.light-theme_&]:!text-[#64748b] [.light-theme_&]:hover:!text-[#0f172a] border-0 border-none cursor-pointer"
              >
                <X className="w-5 h-5 stroke-[2]" />
              </button>
            </div>

            <div className="flex-1 min-h-[280px] relative w-full bg-black/70">
              <Suspense fallback={null}>
                <Cropper
                  image={imageToCrop}
                  crop={crop}
                  zoom={zoom}
                  aspect={2 / 3}
                  cropShape="rect"
                  showGrid={true}
                  onCropChange={setCrop}
                  onCropComplete={onCropComplete}
                  onZoomChange={setZoom}
                />
              </Suspense>
            </div>

            <div className="p-4 border-t border-white/10 [.light-theme_&]:!border-[#e2e8f0] bg-white/[0.02] [.light-theme_&]:!bg-[#f8fafc] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3.5">
              <div className="flex items-center gap-3">
                <span className="text-xs text-white/60 [.light-theme_&]:!text-[#64748b] font-medium shrink-0">缩放</span>
                <input
                  type="range"
                  value={zoom}
                  min={1}
                  max={3}
                  step={0.05}
                  aria-labelledby="Zoom"
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="flex-1 h-2 bg-white/10 [.light-theme_&]:!bg-[#e2e8f0] rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={closeCrop}
                  className="flex-1 sm:flex-none px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 font-medium rounded-xl text-xs sm:text-sm transition [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:hover:!bg-[#cbd5e1] [.light-theme_&]:!text-[#334155] border-0 border-none cursor-pointer"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveCrop}
                  disabled={isCropping}
                  className="flex-1 sm:flex-none px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs sm:text-sm transition flex items-center justify-center gap-1.5 shadow-md shadow-blue-500/25 border-0 border-none cursor-pointer"
                >
                  {isCropping && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>保存封面</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Folder Cover Picker Modal */}
      {everCoverPickerOpen && (
        <Suspense fallback={null}>
          <FolderCoverPickerModal
            isOpen={!!coverPickerFolder}
            folder={coverPickerFolder}
            onClose={() => setCoverPickerFolder(null)}
            onSelectCharacterCover={(char) => {
              if (coverPickerFolder) {
                handleSetCharacterAsFolderCover(coverPickerFolder, char);
              }
            }}
            onUploadCustomImage={() => {
              coverInputRef.current?.click();
            }}
            onResetCover={() => {
              if (coverPickerFolder) {
                handleResetFolderCover(coverPickerFolder);
              }
            }}
          />
        </Suspense>
      )}

      {everTokenModalOpen && tokenModalChar && (
        <Suspense fallback={null}>
          <TokenBreakdownModal
            isOpen={!!tokenModalChar}
            onClose={() => setTokenModalChar(null)}
            charName={tokenModalChar.name}
            breakdown={tokenModalChar.breakdown}
            isLightMode={isLightMode}
          />
        </Suspense>
      )}

      {everCompareModalOpen && (
        <Suspense fallback={null}>
          <CardCompareModal
            pairIds={comparePairIds}
            folders={folders}
            onClose={() => setComparePairIds(null)}
            onOpenChar={(id) => {
              setComparePairIds(null);
              setSelectionMode(false);
              setSelectedIds(new Set());
              onSelect(id);
            }}
            onMutated={(deletedId) => {
              if (deletedId) {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  next.delete(deletedId);
                  if (next.size === 0) setSelectionMode(false);
                  return next;
                });
              }
              invalidateCache();
              loadData();
            }}
          />
        </Suspense>
      )}

      <AnimatePresence>
        {tagActionModal !== null && (
          <div
            className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              if (!isTagMutating) setTagActionModal(null);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              onClick={(e) => e.stopPropagation()}
              className={`w-full max-w-xs sm:max-w-sm rounded-3xl p-5 sm:p-6 shadow-2xl backdrop-blur-2xl select-none transition-colors border ${
                isLightMode
                  ? "bg-white text-[#0f172a] border-[#e2e8f0] shadow-xl [.light-theme_&]:!bg-white [.light-theme_&]:!text-[#0f172a]"
                  : "bg-slate-800/95 text-white border-white/10 [.light-theme_&]:!bg-white [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#e2e8f0]"
              }`}
            >
              <h3 className="text-base sm:text-lg font-bold text-center text-white [.light-theme_&]:!text-[#0f172a]">
                管理标签
              </h3>
              <p className="text-xs text-center text-white/55 [.light-theme_&]:!text-[#64748b] mt-1 mb-5 truncate px-2">
                「{tagActionModal}」
              </p>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={isTagMutating}
                  onClick={() => {
                    const current = tagActionModal;
                    setTagActionModal(null);
                    setRenamingTagData({ old: current, new: current });
                  }}
                  className="w-full py-2.5 sm:py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-semibold transition active:scale-95 shadow-md shadow-blue-500/20 cursor-pointer disabled:opacity-50 [.light-theme_&]:!bg-[#eff6ff] [.light-theme_&]:hover:!bg-[#dbeafe] [.light-theme_&]:!text-[#007aff] [.light-theme_&]:shadow-none"
                >
                  重命名标签
                </button>
                <button
                  type="button"
                  disabled={isTagMutating}
                  onClick={async () => {
                    const targetTag = tagActionModal;
                    if (!targetTag) return;
                    if (!window.confirm(`确定从所有角色卡中移除标签「${targetTag}」吗？`)) return;
                    setIsTagMutating(true);
                    try {
                      await deleteTag(targetTag);
                      setSelectedTags((prev) => prev.filter((t) => t !== targetTag));
                      const updated = await getAllTags();
                      setAllTags(updated);
                      invalidateCache();
                      loadData();
                      setTagActionModal(null);
                    } catch (err: any) {
                      alert("删除标签失败: " + (err?.message || String(err)));
                    } finally {
                      setIsTagMutating(false);
                    }
                  }}
                  className={`w-full py-2.5 sm:py-3 rounded-2xl text-xs sm:text-sm font-semibold transition active:scale-95 cursor-pointer disabled:opacity-50 ${
                    isLightMode
                      ? "bg-rose-50 hover:bg-rose-100 text-rose-600 [.light-theme_&]:!bg-rose-50 [.light-theme_&]:!text-rose-600"
                      : "bg-red-500/10 hover:bg-red-500/20 text-red-400 [.light-theme_&]:!bg-rose-50 [.light-theme_&]:!text-rose-600"
                  }`}
                >
                  {isTagMutating ? "处理中..." : "删除标签"}
                </button>
                <button
                  type="button"
                  disabled={isTagMutating}
                  onClick={() => setTagActionModal(null)}
                  className={`w-full py-2.5 sm:py-3 rounded-2xl text-xs sm:text-sm font-semibold transition mt-1 active:scale-95 cursor-pointer ${
                    isLightMode
                      ? "bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#334155] border border-[#cbd5e1]/40 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#334155]"
                      : "bg-white/5 hover:bg-white/10 text-white/70 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#334155] [.light-theme_&]:!border [.light-theme_&]:!border-[#cbd5e1]/40"
                  }`}
                >
                  取消
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {renamingTagData !== null && (
          <div
            className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              if (!isTagMutating) setRenamingTagData(null);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              onClick={(e) => e.stopPropagation()}
              className={`w-full max-w-xs sm:max-w-sm rounded-3xl p-5 sm:p-6 shadow-2xl backdrop-blur-2xl select-none transition-colors border ${
                isLightMode
                  ? "bg-white text-[#0f172a] border-[#e2e8f0] shadow-xl [.light-theme_&]:!bg-white [.light-theme_&]:!text-[#0f172a]"
                  : "bg-slate-800/95 text-white border-white/10 [.light-theme_&]:!bg-white [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#e2e8f0]"
              }`}
            >
              <h3 className="text-base sm:text-lg font-bold mb-4 sm:mb-5 text-center text-white [.light-theme_&]:!text-[#0f172a]">
                重命名标签
              </h3>
              <input
                type="text"
                value={renamingTagData.new}
                onChange={(e) =>
                  setRenamingTagData((prev) =>
                    prev ? { ...prev, new: e.target.value } : null,
                  )
                }
                placeholder="输入新标签名"
                className={`w-full rounded-2xl px-4 py-2.5 sm:py-3 mb-4 sm:mb-5 text-center text-sm sm:text-base font-medium transition outline-none border ${
                  isLightMode
                    ? "bg-[#f1f5f9] border-[#cbd5e1] text-[#0f172a] placeholder:text-[#94a3b8] focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#cbd5e1]"
                    : "bg-black/20 border-white/10 text-white placeholder:text-white/40 focus:border-blue-500/50 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:placeholder:!text-[#94a3b8]"
                }`}
                autoFocus
                onKeyDown={async (e) => {
                  if (e.key === "Enter" && !isTagMutating) {
                    const nextTag = renamingTagData.new.trim();
                    const oldTag = renamingTagData.old;
                    if (!nextTag) return;
                    if (nextTag === oldTag) {
                      setRenamingTagData(null);
                      return;
                    }
                    setIsTagMutating(true);
                    try {
                      await renameTag(oldTag, nextTag);
                      setSelectedTags((prev) =>
                        Array.from(
                          new Set(prev.map((t) => (t === oldTag ? nextTag : t))),
                        ),
                      );
                      const updated = await getAllTags();
                      setAllTags(updated);
                      invalidateCache();
                      loadData();
                      setRenamingTagData(null);
                    } catch (err: any) {
                      alert("重命名标签失败: " + (err?.message || String(err)));
                    } finally {
                      setIsTagMutating(false);
                    }
                  }
                  if (e.key === "Escape" && !isTagMutating) {
                    setRenamingTagData(null);
                  }
                }}
              />
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={isTagMutating || !renamingTagData.new.trim()}
                  onClick={async () => {
                    const nextTag = renamingTagData.new.trim();
                    const oldTag = renamingTagData.old;
                    if (!nextTag) return;
                    if (nextTag === oldTag) {
                      setRenamingTagData(null);
                      return;
                    }
                    setIsTagMutating(true);
                    try {
                      await renameTag(oldTag, nextTag);
                      setSelectedTags((prev) =>
                        Array.from(
                          new Set(prev.map((t) => (t === oldTag ? nextTag : t))),
                        ),
                      );
                      const updated = await getAllTags();
                      setAllTags(updated);
                      invalidateCache();
                      loadData();
                      setRenamingTagData(null);
                    } catch (err: any) {
                      alert("重命名标签失败: " + (err?.message || String(err)));
                    } finally {
                      setIsTagMutating(false);
                    }
                  }}
                  className="w-full py-2.5 sm:py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold transition active:scale-95 shadow-md shadow-blue-500/20 cursor-pointer"
                >
                  {isTagMutating ? "保存中..." : "保存修改"}
                </button>
                <button
                  type="button"
                  disabled={isTagMutating}
                  onClick={() => setRenamingTagData(null)}
                  className={`w-full py-2.5 sm:py-3 rounded-2xl text-xs sm:text-sm font-semibold transition mt-1 active:scale-95 cursor-pointer ${
                    isLightMode
                      ? "bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#334155] border border-[#cbd5e1]/40 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#334155]"
                      : "bg-white/5 hover:bg-white/10 text-white/70 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#334155] [.light-theme_&]:!border [.light-theme_&]:!border-[#cbd5e1]/40"
                  }`}
                >
                  取消
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

const CharacterCardItem = React.memo(function CharacterCardItem({
  char,
  onClick,
  onLongPress,
  onToggleFavorite,
  onOpenTokenBreakdown,
  selectionMode,
  isSelected,
  viewMode,
  showMainTokens = true,
}: {
  key?: React.Key;
  char: CharacterCard;
  onClick: () => void;
  onLongPress: () => void;
  onToggleFavorite?: (e: React.MouseEvent) => void;
  onOpenTokenBreakdown?: (char: CharacterCard) => void;
  selectionMode: boolean;
  isSelected: boolean;
  viewMode: "grid" | "list" | "masonry";
  showMainTokens?: boolean;
}) {
  const defaultFallback = getFallbackAvatar(char.name || char.id, char.tags?.join(',') || (char.isTool ? 'tool' : undefined));
  const initialUrl = resolveAvatarUrl(char.avatarUrlFallback, char.name || char.id, char.tags?.join(',') || (char.isTool ? 'tool' : undefined));
  const thumbCacheKey = `${char.id}:${char.updatedAt || 0}`;
  const [url, setUrl] = useState<string>(() => {
    if (char.hasBlobsSeparated && !char.avatarBlob) {
      const cached = peekCachedUrl(thumbCacheKey);
      if (cached) return cached;
    } else if (
      !char.hasBlobsSeparated &&
      char.localFilePath &&
      /\.(png|jpe?g|webp|gif|bmp)$/i.test(char.localFilePath)
    ) {
      return getLocalImageUrl(char.localFilePath, char.updatedAt || char.createdAt);
    }
    return initialUrl;
  });
  // 追踪 onError 兜底逻辑里额外创建的 blob URL, 保证换掉/卸载时释放,
  // 否则长列表滚动 + 图片偶发加载失败会不断泄漏内存(可能是持续发热的一个来源)。
  const fallbackObjectUrlRef = useRef<string | null>(null);
  const retriedThumbRef = useRef(false);
  const retriedBlobRef = useRef(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (fallbackObjectUrlRef.current && !isCachedBlobUrl(fallbackObjectUrlRef.current)) {
        URL.revokeObjectURL(fallbackObjectUrlRef.current);
      }
      fallbackObjectUrlRef.current = null;
    };
  }, []);

  const setStableUrl = useCallback((newUrl: string, isOwnedFallbackBlob = false) => {
    if (
      fallbackObjectUrlRef.current &&
      fallbackObjectUrlRef.current !== newUrl &&
      !isCachedBlobUrl(fallbackObjectUrlRef.current)
    ) {
      URL.revokeObjectURL(fallbackObjectUrlRef.current);
    }
    fallbackObjectUrlRef.current = isOwnedFallbackBlob ? newUrl : null;
    setUrl(newUrl);
  }, []);

  const timerRef = useRef<any>(null);
  const isLongPress = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(cardRef); // 一次性:是否已经首次进入过视口附近,决定要不要开始加载
  const isNearby = useContinuousInView(cardRef); // 持续追踪:是否还在较大范围内,决定要不要保留已加载的图

  const handleImageError = useCallback(async () => {
    if (!isMountedRef.current || url === defaultFallback) return;

    if (char.hasBlobsSeparated && !retriedThumbRef.current) {
      retriedThumbRef.current = true;
      if (url && url.startsWith("blob:") && peekCachedUrl(thumbCacheKey) === url) {
        releaseCachedUrl(thumbCacheKey);
      }
      try {
        const thumbBlob = await getCharacterThumb(char.id);
        if (!isMountedRef.current) return;
        if (thumbBlob) {
          const freshUrl = putCachedBlobUrl(thumbCacheKey, thumbBlob, { forceReplace: true });
          if (freshUrl) {
            setStableUrl(freshUrl, false);
            return;
          }
        }
      } catch {}
    }

    if (!retriedBlobRef.current) {
      retriedBlobRef.current = true;
      if (char.avatarBlob) {
        const u = safeCreateObjectURL(char.avatarBlob);
        if (u) {
          setStableUrl(u, u.startsWith("blob:"));
          return;
        }
      } else if (char.hasBlobsSeparated) {
        try {
          const b = await getCharacterBlob(char.id);
          if (!isMountedRef.current) return;
          const u = b?.avatarBlob ? safeCreateObjectURL(b.avatarBlob) : null;
          if (u) {
            setStableUrl(u, u.startsWith("blob:"));
            return;
          }
        } catch {}
      } else if (
        char.localFilePath &&
        /\.(png|jpe?g|webp|gif|bmp)$/i.test(char.localFilePath)
      ) {
        setStableUrl(getLocalImageUrl(char.localFilePath, Date.now()), false);
        return;
      }
    }

    if (isMountedRef.current) {
      setStableUrl(defaultFallback, false);
    }
  }, [url, defaultFallback, char.hasBlobsSeparated, char.id, char.avatarBlob, char.localFilePath, thumbCacheKey, setStableUrl]);

  useEffect(() => {
    let isMounted = true;
    retriedThumbRef.current = false;
    retriedBlobRef.current = false;

    if (!isNearby) {
      // 划出屏幕较远范围: 把 <img> 换回轻量占位图, 释放已解码图像占用的内存,
      // 不清 LRU 缓存本身——缓存还在, 划回来的时候能几乎零成本地恢复。
      setStableUrl(initialUrl, false);
      return;
    }

    let objectUrl: string | null = null;

    if (char.avatarBlob) {
      objectUrl = safeCreateObjectURL(char.avatarBlob);
      if (objectUrl) setStableUrl(objectUrl, false);
    } else if (char.hasBlobsSeparated) {
      const cached = peekCachedUrl(thumbCacheKey);
      if (cached) {
        setStableUrl(cached, false);
      } else if (isCharacterNoImage(char.id)) {
        setStableUrl(initialUrl, false);
      } else if (isInView) {
        getCharacterThumb(char.id).then((thumbBlob) => {
          if (!isMounted) return;
          if (thumbBlob) {
            setStableUrl(putCachedBlobUrl(thumbCacheKey, thumbBlob), false);
          } else {
            setStableUrl(initialUrl, false);
          }
        });
      } else {
        setStableUrl(initialUrl, false);
      }
    } else if (
      char.localFilePath &&
      /\.(png|jpe?g|webp|gif|bmp)$/i.test(char.localFilePath)
    ) {
      setStableUrl(getLocalImageUrl(char.localFilePath, char.updatedAt || char.createdAt), false);
    } else {
      setStableUrl(initialUrl, false);
    }

    return () => {
      isMounted = false;
      if (objectUrl && !isCachedBlobUrl(objectUrl)) URL.revokeObjectURL(objectUrl);
    };
  }, [
    char.avatarBlob,
    char.localFilePath,
    char.hasBlobsSeparated,
    char.id,
    char.updatedAt,
    char.createdAt,
    thumbCacheKey,
    initialUrl,
    isInView,
    isNearby,
    setStableUrl,
  ]);

  // 页面切回前台、弹窗关闭或从 LRU 中被意外回收后，如果当前 <img> 已经处于失效/破图状态 (complete && naturalWidth === 0)，自动无缝重拉
  useEffect(() => {
    if (!isNearby || !url || !url.startsWith("blob:")) return;
    const checkBrokenImage = () => {
      const img = imgRef.current;
      if (img && img.complete && img.naturalWidth === 0) {
        void handleImageError();
      }
    };
    const rafId = requestAnimationFrame(checkBrokenImage);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        requestAnimationFrame(checkBrokenImage);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [isNearby, url, handleImageError]);

  const touchHandledRef = useRef(false);
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const lastLongPressTimeRef = useRef(0);

  const handlePointerStart = (e: React.SyntheticEvent) => {
    if (selectionMode) return;
    let clientX = 0;
    let clientY = 0;
    if (e.type === "touchstart") {
      touchHandledRef.current = true;
      const touch = (e as React.TouchEvent).touches[0];
      if (touch) {
        clientX = touch.clientX;
        clientY = touch.clientY;
      }
    } else if (e.type === "mousedown") {
      if (touchHandledRef.current || (e as React.MouseEvent).button !== 0) return;
      const mouse = e as React.MouseEvent;
      clientX = mouse.clientX;
      clientY = mouse.clientY;
    }
    touchStartXRef.current = clientX;
    touchStartYRef.current = clientY;

    isLongPress.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      isLongPress.current = true;
      lastLongPressTimeRef.current = Date.now();
      onLongPress();
    }, 550);
  };

  const handlePointerMove = (e: React.SyntheticEvent) => {
    if (!timerRef.current) return;
    let clientX = 0;
    let clientY = 0;
    if (e.type === "touchmove" && (e as React.TouchEvent).touches[0]) {
      clientX = (e as React.TouchEvent).touches[0].clientX;
      clientY = (e as React.TouchEvent).touches[0].clientY;
    } else if (e.type === "mousemove") {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }
    const dx = Math.abs(clientX - touchStartXRef.current);
    const dy = Math.abs(clientY - touchStartYRef.current);
    if (dx > 10 || dy > 10) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handlePointerEnd = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setTimeout(() => {
      touchHandledRef.current = false;
    }, 300);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isLongPress.current || Date.now() - lastLongPressTimeRef.current < 600) {
      isLongPress.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onClick();
  };

  const charTags = extractCharacterTags(char);
  const hasTags = charTags.length > 0;
  const badgeInfo = getCardBadgeInfo(char);

  if (viewMode === "list") {
    return (
      <div
        ref={cardRef}
        style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none", touchAction: "pan-y" }}
        onClick={handleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isLongPress.current || Date.now() - lastLongPressTimeRef.current < 800) {
            return;
          }
          if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
          }
          isLongPress.current = true;
          lastLongPressTimeRef.current = Date.now();
          onLongPress();
        }}
        onTouchStart={handlePointerStart}
        onTouchEnd={handlePointerEnd}
        onTouchCancel={handlePointerEnd}
        onTouchMove={handlePointerMove}
        onMouseDown={handlePointerStart}
        className={`relative flex items-center gap-4 p-3 rounded-2xl cursor-pointer transition duration-150 ease-out select-none bg-white/5 hover:bg-white/10 border border-transparent ${
          isSelected
            ? "scale-[0.97]"
            : selectionMode
              ? "active:scale-[0.95]"
              : "hover:scale-[1.02] active:scale-[0.95]"
        }`}
      >
        <div className="w-12 h-12 rounded-xl sm:rounded-2xl overflow-hidden shrink-0 relative bg-[#f0f4f8] [.light-theme_&]:bg-[#f0f4f8] dark:bg-[#1e2430] border border-slate-200/60 dark:border-white/10 shadow-xs flex items-center justify-center">
          <img
            ref={imgRef}
            src={url || undefined}
            alt={char.name}
            className={`w-full h-full pointer-events-none ${
              isFallbackMiuImage(url)
                ? 'object-contain p-2 bg-white'
                : 'object-cover'
            }`}
            onError={() => {
              void handleImageError();
            }}
          />
          {isSelected && (
            <div className="absolute inset-0 bg-black/45 pointer-events-none z-[2]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-white/90 truncate [.light-theme_&]:!text-[#0f172a]">{char.name}</h3>
            {badgeInfo && (
              <span className="text-[10px] bg-black/60 backdrop-blur-md border border-white/10 text-white/90 px-1.5 py-0.5 rounded-md flex-shrink-0 flex items-center gap-1 font-medium select-none">
                <span className={`w-1.5 h-1.5 rounded-full ${badgeInfo.dotColor} shrink-0`} />
                <span>{badgeInfo.label}</span>
              </span>
            )}
            {showMainTokens && !badgeInfo && char.tokenCount !== undefined && char.tokenCount > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenTokenBreakdown?.(char);
                }}
                className="text-[10px] bg-white/10 hover:bg-white/15 border border-white/15 text-white/90 [.light-theme_&]:!bg-stone-100 [.light-theme_&]:!border-stone-200 [.light-theme_&]:!text-stone-700 px-1.5 py-0.5 rounded-md flex-shrink-0 flex items-center font-mono font-medium transition cursor-pointer select-none active:scale-95 shadow-xs"
                title={`Token 数量: ${char.tokenCount.toLocaleString()} (常驻: ${formatTokenCount(char.permanentTokens || 0)})，点击查看拆解`}
              >
                <span>{formatTokenCount(char.tokenCount)} T</span>
              </button>
            )}
            {hasTags && (
              <div className="flex gap-1 overflow-hidden shrink-0">
                {charTags.slice(0, 3).map((t: string) => (
                  <span
                    key={t}
                    className="text-[9px] bg-slate-500/20 text-slate-400 px-1.5 py-0.5 rounded-sm flex-shrink-0 whitespace-nowrap [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:!text-[#334155]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {char.data?.creator && (
              <p className="text-xs text-slate-500 truncate [.light-theme_&]:!text-[#64748b]">
                by {char.data.creator}
              </p>
            )}
          </div>
        </div>

        {/* Right side favorite button in list view */}
        {!selectionMode && onToggleFavorite && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(e);
            }}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center hover:bg-white/10 [.light-theme_&]:hover:bg-black/5 transition relative group active:scale-90 cursor-pointer shrink-0 z-10"
            title={char.isFavorite ? "取消收藏" : "收藏"}
          >
            <Heart
              className={`w-4 h-4 sm:w-4.5 sm:h-4.5 transition-all duration-200 ${
                char.isFavorite
                  ? "text-rose-500 fill-rose-500 drop-shadow-[0_1px_4px_rgba(244,63,94,0.4)]"
                  : "text-white/40 hover:text-rose-400 [.light-theme_&]:text-slate-400 [.light-theme_&]:hover:text-rose-500"
              }`}
            />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none", touchAction: "pan-y" }}
      onClick={handleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isLongPress.current || Date.now() - lastLongPressTimeRef.current < 800) {
          return;
        }
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        isLongPress.current = true;
        lastLongPressTimeRef.current = Date.now();
        onLongPress();
      }}
      onTouchStart={handlePointerStart}
      onTouchEnd={handlePointerEnd}
      onTouchCancel={handlePointerEnd}
      onTouchMove={handlePointerMove}
      onMouseDown={handlePointerStart}
      onMouseMove={handlePointerMove}
      onMouseUp={handlePointerEnd}
      onMouseLeave={handlePointerEnd}
      className={`relative ${viewMode === "masonry" ? "w-full min-h-[160px] aspect-[2/3] bg-white/5" : "aspect-[2/3]"} rounded-2xl overflow-hidden cursor-pointer shadow-lg border-0 [.light-theme_&]:border-0 transition duration-150 ease-out group select-none ${
        isSelected
          ? "scale-[0.93] active:scale-90"
          : selectionMode
            ? "active:scale-[0.92]"
            : "hover:scale-105 active:scale-[0.92]"
      }`}
    >
      <img
        ref={imgRef}
        src={url || undefined}
        alt={char.name}
        className={`w-full h-full pointer-events-none ${
          isFallbackMiuImage(url)
            ? 'object-contain p-6 sm:p-8 bg-white'
            : 'object-cover'
        }`}
        onError={() => {
          void handleImageError();
        }}
      />
      {isSelected && (
        <div className="absolute inset-0 bg-black/45 pointer-events-none z-[2] transition-opacity" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent flex flex-col justify-end p-3 pointer-events-none z-[3]">
        <h3 className="font-semibold !text-white text-sm sm:text-base leading-tight drop-shadow-[0_1.5px_4px_rgba(0,0,0,0.95)] break-words truncate">
          {char.name}
        </h3>
        {hasTags && (
          <div className="flex flex-wrap gap-1 mt-1.5 h-[1.25rem] overflow-hidden -mr-1">
            {charTags.map((t: string) => (
              <span
                key={t}
                className="text-[9.5px] bg-black/45 backdrop-blur-md !text-white/95 border border-white/20 px-1.5 py-0.5 rounded-md truncate max-w-[75px] font-medium leading-tight shadow-xs"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {badgeInfo && (
        <div className="absolute top-2 left-2 z-10 px-2 py-0.5 bg-black/45 backdrop-blur-md rounded-md text-[10px] font-medium text-white/90 border border-white/15 flex items-center gap-1.5 shadow-sm pointer-events-none select-none">
          <span className={`w-1.5 h-1.5 rounded-full ${badgeInfo.dotColor} shrink-0`} />
          <span>{badgeInfo.label}</span>
        </div>
      )}

      {showMainTokens && !badgeInfo && char.tokenCount !== undefined && char.tokenCount > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenTokenBreakdown?.(char);
          }}
          className={`absolute ${badgeInfo ? "top-8.5" : "top-2"} left-2 z-10 px-1.5 py-0.5 bg-black/45 hover:bg-black/65 backdrop-blur-md rounded-md text-[10px] font-mono font-medium text-white/90 hover:text-white border border-white/20 flex items-center shadow-xs transition cursor-pointer select-none active:scale-95`}
          title={`Token 数量: ${char.tokenCount.toLocaleString()} (常驻: ${formatTokenCount(char.permanentTokens || 0)})，点击查看拆解`}
        >
          <span>{formatTokenCount(char.tokenCount)} T</span>
        </button>
      )}

      {/* Top right Heart favorite button - differentiated by layout */}
      {!selectionMode && onToggleFavorite && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(e);
          }}
          className={`absolute z-10 rounded-full flex items-center justify-center backdrop-blur-xs transition-all duration-200 cursor-pointer active:scale-85 ${
            viewMode === "masonry"
              ? "top-1.5 right-1.5 sm:top-2.5 sm:right-2.5 w-6 h-6 sm:w-7 sm:h-7"
              : "top-1 right-1 sm:top-2 sm:right-2 w-5 h-5 sm:w-6.5 sm:h-6.5"
          } ${
            char.isFavorite
              ? "bg-black/45 text-rose-500 shadow-xs opacity-100 border border-white/10"
              : "bg-black/30 text-white/70 hover:text-rose-400 opacity-0 group-hover:opacity-100"
          }`}
          title={char.isFavorite ? "取消收藏" : "收藏"}
        >
          <Heart
            className={`transition-transform duration-200 ${
              viewMode === "masonry"
                ? "w-3.5 h-3.5 sm:w-4 sm:h-4"
                : "w-2.5 h-2.5 sm:w-3.5 sm:h-3.5"
            } ${
              char.isFavorite
                ? "fill-rose-500 text-rose-500 drop-shadow-[0_1px_3px_rgba(244,63,94,0.5)]"
                : "text-white/90 hover:text-white"
            }`}
          />
        </button>
      )}
    </div>
  );
},
(prevProps, nextProps) => {
  if (prevProps.showMainTokens !== nextProps.showMainTokens) return false;
  if (prevProps.viewMode !== nextProps.viewMode) return false;
  if (prevProps.selectionMode !== nextProps.selectionMode) return false;
  if (prevProps.isSelected !== nextProps.isSelected) return false;

  const p = prevProps.char;
  const n = nextProps.char;
  if (p.id !== n.id) return false;
  if (p.updatedAt !== n.updatedAt) return false;
  if (p.name !== n.name) return false;
  if (p.folderId !== n.folderId) return false;
  if (p.isFavorite !== n.isFavorite) return false;
  if (p.deletedAt !== n.deletedAt) return false;
  if (p.avatarBlob !== n.avatarBlob) return false;
  if (p.localFilePath !== n.localFilePath) return false;
  if (p.tokenCount !== n.tokenCount) return false;
  if (p.permanentTokens !== n.permanentTokens) return false;

  return true;
}
);
