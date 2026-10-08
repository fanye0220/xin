import { Capacitor } from "@capacitor/core";
import { CURRENT_APP_VERSION } from "../config/version";
import { getFallbackAvatar, resolveAvatarUrl } from "../lib/avatar";
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Masonry from 'react-masonry-css';
import {
  Plus,
  BookOpen,
  ChevronLeft,
  ChevronRight,
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
} from "lucide-react";
import { formatTokenCount, getCharacterTokenBreakdown, CharacterTokenBreakdown } from "../lib/tokens";
import { TokenBreakdownModal } from "./TokenBreakdownModal";
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
  getFilteredCharacterCount,
  getCharacterCategoryPrefix,
  invalidateCache,
} from "../lib/db";
import { useInView } from "../lib/useInView";
import { useContinuousInView } from "../lib/useContinuousInView";
import { peekCachedUrl, putCachedBlobUrl } from "../lib/thumbCache";
import { useBackHandler } from "../lib/useBackHandler";
import { getCardBadgeInfo } from "../lib/cardBadge";
import { MoveToFolderModal } from "./MoveToFolderModal";
import { BindQRModal } from "./BindQRModal";
import { ConfirmBindQRModal } from "./ConfirmBindQRModal";
import JSZip from "jszip";
import { injectTavernData } from "../lib/png";
import { uploadCharacterToCloud } from "../lib/cloudDrive";
import Cropper from "react-easy-crop";
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
import { FolderCoverPickerModal } from "./FolderCoverPickerModal";

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

// 记忆每个文件夹所在的分页位置，避免在卡片详情或子文件夹返回时丢失第5页等当前页码
const folderPageMemory = new Map<string, number>();

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

  const [characters, setCharacters] = useState<CharacterCard[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [paginatedFolders, setPaginatedFolders] = useState<Folder[]>([]);
  const [folderPaths, setFolderPaths] = useState<Record<string, string>>({});
  const [folderCounts, setFolderCounts] = useState<
    Record<string, { chars: number; subfolders: number }>
  >({});
  const [folderAncestors, setFolderAncestors] = useState<
    Record<string, Array<{ id: string; name: string }>>
  >({});
  const [totalItems, setTotalItems] = useState(0);
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

        // 检查新旧预览项的特征/Seed/路径是否完全一致
        const isIdentical =
          oldItems.length === newItems.length &&
          oldItems.every((oldIt, idx) => {
            const newIt = newItems[idx];
            const oldSeed = typeof oldIt === "string" ? oldIt : oldIt?.seed || oldIt?.url;
            const newSeed = typeof newIt === "string" ? newIt : newIt?.seed || newIt?.url;
            return oldSeed && newSeed && oldSeed === newSeed;
          });

        if (isIdentical) {
          // 文件夹预览无变化: 保留原 URL 引用, 绝不触发相邻文件夹封面的刷新/闪烁!
          mergedPreviews[fId] = oldItems;
          newItems.forEach((it) => {
            const u = typeof it === "string" ? it : it?.url;
            if (u && u.startsWith("blob:")) urlsToRevoke.push(u);
          });
        } else {
          // 真正的封面修改: 使用新 URL, 释放旧 URL
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
      folderPreviewUrlsRef.current = allCurrentUrls;

      if (urlsToRevoke.length > 0) {
        requestAnimationFrame(() => {
          urlsToRevoke.forEach((u) => {
            if (u && u.startsWith("blob:")) URL.revokeObjectURL(u);
          });
        });
      }

      return mergedPreviews;
    });
  };
  useEffect(() => {
    return () => {
      folderPreviewUrlsRef.current.forEach((u) => {
        if (u.startsWith("blob:")) URL.revokeObjectURL(u);
      });
    };
  }, []);
  const [totalCharacters, setTotalCharacters] = useState(0);
  const [totalAllCharacters, setTotalAllCharacters] = useState(0);

  const folderKey = folderId || "root";
  const [page, setPage] = useState<number>(() => {
    return folderPageMemory.get(folderKey) || 1;
  });
  const [pageInputValue, setPageInputValue] = useState(() =>
    String(folderPageMemory.get(folderKey) || 1),
  );

  useEffect(() => {
    setPageInputValue(page.toString());
  }, [page]);

  const [pageSize, setPageSize] = useState(
    () => Number(localStorage.getItem("tavern_pageSize")) || 50,
  );
  const [searchQuery, setSearchQuery] = useState("");
  // 搜索框本身要立即响应输入(不然打字会卡顿感), 但真正触发查询用防抖后的值,
  // 避免每敲一个字就对全部角色做一次全量过滤+排序。
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
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
    if (!debouncedSearchQuery && selectedTags.length === 0) {
      folderPageMemory.set(folderKey, page);
    }
  }, [folderKey, page, debouncedSearchQuery, selectedTags.length]);

  const [tagActionModal, setTagActionModal] = useState<string | null>(null);
  const [renamingTagData, setRenamingTagData] = useState<{ old: string; new: string } | null>(null);
  const tagLongPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const tagLongPressTriggeredRef = useRef(false);

  const handleTagTouchStart = (tag: string) => {
    tagLongPressTriggeredRef.current = false;
    tagLongPressTimerRef.current = setTimeout(() => {
      tagLongPressTriggeredRef.current = true;
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try { navigator.vibrate(40); } catch (e) {}
      }
      setTagActionModal(tag);
    }, 500);
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

  const [googleUser, setGoogleUser] = useState<any>(null);

  useEffect(() => {
    import('../lib/drive').then(({ getAuthCurrentUser }) => {
      setGoogleUser(getAuthCurrentUser());
    });
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
  useBackHandler(selectionMode, () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
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
        delay: 250,
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
  const loadData = async () => {
    const reqId = ++loadDataReqIdRef.current;
    try {
      const allFoldersData = await getFolders();
      // 构建文件夹映射与完整路径生成
      const folderMap = new Map<string, Folder>();
      allFoldersData.forEach((f) => folderMap.set(f.id, f));

      const getFolderPath = (fId: string): string => {
        const parts: string[] = [];
        let curr: Folder | undefined = folderMap.get(fId);
        const visited = new Set<string>();
        while (curr && !visited.has(curr.id)) {
          visited.add(curr.id);
          parts.unshift(curr.name);
          curr = curr.parentId ? folderMap.get(curr.parentId) : undefined;
        }
        return parts.join(" / ");
      };

      const pathMap: Record<string, string> = {};
      const ancestorMap: Record<string, Array<{ id: string; name: string }>> = {};
      const getFolderAncestors = (fId: string): Array<{ id: string; name: string }> => {
        const list: Array<{ id: string; name: string }> = [];
        let curr: Folder | undefined = folderMap.get(fId);
        const visited = new Set<string>();
        while (curr && !visited.has(curr.id)) {
          visited.add(curr.id);
          list.unshift({ id: curr.id, name: curr.name });
          curr = curr.parentId ? folderMap.get(curr.parentId) : undefined;
        }
        return list;
      };

      for (const f of allFoldersData) {
        pathMap[f.id] = getFolderPath(f.id);
        ancestorMap[f.id] = getFolderAncestors(f.id);
      }
      setFolderPaths(pathMap);
      setFolderAncestors(ancestorMap);

      // 计算每个文件夹的子文件夹数和卡片数
      const subfolderCountMap: Record<string, number> = {};
      for (const f of allFoldersData) {
        if (f.parentId) {
          subfolderCountMap[f.parentId] = (subfolderCountMap[f.parentId] || 0) + 1;
        }
      }
      const countsMap: Record<string, { chars: number; subfolders: number }> = {};
      for (const f of allFoldersData) {
        countsMap[f.id] = {
          chars: 0,
          subfolders: subfolderCountMap[f.id] || 0,
        };
      }
      try {
        const { getFolderItemCounts } = await import("../lib/db");
        const charCounts = await getFolderItemCounts(allFoldersData.map((f) => f.id));
        for (const f of allFoldersData) {
          countsMap[f.id].chars = charCounts[f.id] || 0;
        }
      } catch (err) {
        console.error("Failed to load folder item counts", err);
      }
      if (reqId !== loadDataReqIdRef.current) return;
      setFolderCounts(countsMap);

      let currentFolders: Folder[] = [];
      const hasSearch = !!debouncedSearchQuery.trim();
      const q = debouncedSearchQuery.trim().toLowerCase();

      if (folderId === null) {
        if (hasSearch) {
          // 在根目录搜索时：全局跨文件夹搜索所有匹配的文件夹（匹配名称或完整路径）
          currentFolders = allFoldersData.filter((f) => {
            const p = pathMap[f.id]?.toLowerCase() || "";
            return f.name.toLowerCase().includes(q) || p.includes(q);
          });
        } else {
          currentFolders = allFoldersData.filter((f) => !f.parentId);
        }
        setCurrentFolderName(null);
      } else if (folderId === "favorites") {
        currentFolders = [];
        setCurrentFolderName("我的收藏");
      } else {
        const currentFolder = allFoldersData.find((f) => f.id === folderId);
        if (currentFolder) setCurrentFolderName(currentFolder.name);

        if (hasSearch) {
          // 在子文件夹中搜索时：递归搜索当前文件夹下所有层级的子孙文件夹
          const descendantIds = new Set<string>();
          const collectDescendants = (pid: string) => {
            for (const f of allFoldersData) {
              if (f.parentId === pid) {
                descendantIds.add(f.id);
                collectDescendants(f.id);
              }
            }
          };
          collectDescendants(folderId);

          currentFolders = allFoldersData.filter((f) =>
            descendantIds.has(f.id) && (
              f.name.toLowerCase().includes(q) ||
              (pathMap[f.id]?.toLowerCase() || "").includes(q)
            )
          );
        } else {
          currentFolders = allFoldersData.filter((f) => f.parentId === folderId);
        }
      }

      // 彻底修复：文件夹必须全面适配所有排序模式（新旧、名称、最近修改、自定义等）！
      currentFolders.sort((a, b) => {
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
      });

      if (reqId !== loadDataReqIdRef.current) return;
      setFolders(currentFolders);

      let currentVisibleFolders = currentFolders;
      if (selectedTags.length > 0) {
        currentVisibleFolders = [];
      }

      const totalFolderCount = currentVisibleFolders.length;
      const totalChars = await getFilteredCharacterCount(
        folderId,
        debouncedSearchQuery,
        selectedTags,
      );
      const totalAllChars = folderId
        ? totalChars
        : await getFilteredCharacterCount(
            "all",
            debouncedSearchQuery,
            selectedTags,
          );
      if (reqId !== loadDataReqIdRef.current) return;
      setTotalCharacters(totalChars);
      setTotalAllCharacters(totalAllChars);

      const itemsTotal = totalFolderCount + totalChars;
      setTotalItems(itemsTotal);

      const calculatedTotalPages = Math.max(1, Math.ceil(itemsTotal / pageSize));
      let currentPage = page;
      if (page > calculatedTotalPages) {
        currentPage = calculatedTotalPages;
        setPage(calculatedTotalPages);
      }

      const pageStart = (currentPage - 1) * pageSize;
      const pageEnd = currentPage * pageSize;

      // Slice folders for this page
      const folderStart = Math.max(0, Math.min(totalFolderCount, pageStart));
      const folderEnd = Math.max(0, Math.min(totalFolderCount, pageEnd));
      const pageFolders = currentVisibleFolders.slice(folderStart, folderEnd);
      setPaginatedFolders(pageFolders);

      // Slice characters for this page
      const charStart = Math.max(0, pageStart - totalFolderCount);
      const charEnd = Math.max(0, Math.min(totalChars, pageEnd - totalFolderCount));
      const charLimit = Math.max(0, charEnd - charStart);

      if (charLimit > 0) {
        const { characters: fetchedChars } = await getCharacters(
          1,
          charLimit,
          folderId,
          debouncedSearchQuery,
          selectedTags,
          sortBy,
          false,
          false,
          charStart,
          charLimit,
        );
        if (reqId !== loadDataReqIdRef.current) return;
        setCharacters(fetchedChars);
      } else {
        if (reqId !== loadDataReqIdRef.current) return;
        setCharacters([]);
      }

      // Fetch previews for visible folders on current page only
      if (pageFolders.length > 0) {
        try {
          const { getFolderPreviews } = await import("../lib/db");
          const folderIds = pageFolders.map((f) => f.id);
          const previews = await getFolderPreviews(folderIds);
          if (reqId !== loadDataReqIdRef.current) return;
          setFolderPreviewsWithCleanup(previews);
        } catch (err) {
          console.error("Failed to load folder previews", err);
        }
      } else {
        if (reqId !== loadDataReqIdRef.current) return;
        setFolderPreviewsWithCleanup({});
      }
    } catch (err) {
      console.error("Failed to load data in CharacterList", err);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearchQuery, selectedTags]);

  useEffect(() => {
    loadData();
  }, [
    page,
    pageSize,
    folderId,
    debouncedSearchQuery,
    selectedTags,
    sortBy,
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
  ]);

  useEffect(() => {
    getAllTags().then(setAllTags);
  }, [refreshTrigger, folderId]); // We can just fetch it when folder triggers, though realistically it only needs refreshTrigger. I will keep it as refreshTrigger.

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent | TouchEvent) => {
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
  }, [isFilterOpen, isSortOpen]);

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
    const { characters: allChars } = await getCharacters(
      1,
      100000,
      folderId,
      debouncedSearchQuery,
      selectedTags,
      sortBy,
      false,
      false,
      0,
      100000,
    );
    const visibleFolders = debouncedSearchQuery
      ? folders.filter((f) =>
          f.name.toLowerCase().includes(debouncedSearchQuery.toLowerCase()),
        )
      : (selectedTags.length > 0 ? [] : folders);

    const totalSelectable = allChars.length + visibleFolders.length;

    if (selectedIds.size === totalSelectable) {
      setSelectedIds(new Set());
    } else {
      const newSet = new Set<string>();
      allChars.forEach((c) => newSet.add(c.id));
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

    const { getAccessToken, updateSyncState } = await import("../lib/drive");
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

      for (const id of idsToProcess) {
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
      if (charsArray.length === 0) {
        alert("所选文件夹中没有可上传的角色。");
        return;
      }

      let success = 0;
      let moved = 0;
      let skipped = 0;
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

      const uploadWorker = async () => {
        while (currentIndex < charsArray.length) {
          const i = currentIndex++;
          try {
            const res = await uploadCharacterToCloud(token, charsArray[i]);
            if (res === 'uploaded') success++;
            else if (res === 'moved') moved++;
            else skipped++;
          } catch (e) {
            console.error("Upload failed for char:", charsArray[i], e);
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
        completed: true,
        taskName: '批量同步',
        message: `同步完成！新增 ${success}，移动 ${moved}${skipped > 0 ? `，跳过 ${skipped}` : ''}`,
      });
      alert(`云端同步完成！\n新上传: ${success} 个\n同步文件夹嵌套: ${moved} 个${skipped > 0 ? `\n分类未变已跳过: ${skipped} 个` : ''}`);
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
                    await downloadOrShareFile(exportFileName, newBuffer, 'image/png', true);
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

        // Native Android Streaming Zip
        if ((window as any).Android && (window as any).Android.startZip) {
          const zipName = `批量导出/Tavern_Export_${timestamp}.zip`;
          const started = await startAndroidZip(zipName);
          if (!started) {
            alert("无法启动原生ZIP导出引擎");
            return;
          }

          let successCount = 0;
          const getUniqueName = createUniqueNameAllocator();
          for (const cid of charsArray) {
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
            successCount++;
          }

          const finalPath = await finishAndroidZip(zipName);
          if (finalPath) {
            const { shareLocalFileOnAndroid } = await import("../lib/appBridge");
            let shared = false;
            try {
              shared = await shareLocalFileOnAndroid(finalPath, "application/zip");
            } catch (e) {
              console.warn("Failed to share zip:", e);
            }
            if (!shared) {
              alert(
                `批量导出成功！共导出 ${successCount} 个角色资料。\n文件已存至：Download/MIU/${zipName}`,
              );
            }
          } else {
            alert("导出结束时发生错误！");
          }

          return;
        }

        // Fallback: JSZip Chunked approach
        const CHUNK_SIZE = 999999;
        const totalParts = Math.ceil(charsArray.length / CHUNK_SIZE);

        let successCountChunks = 0;
        let failedChunks: number[] = [];
        const getUniqueName = createUniqueNameAllocator();

        for (let i = 0; i < charsArray.length; i += CHUNK_SIZE) {
          const chunk = charsArray.slice(i, i + CHUNK_SIZE);
          const zip = new JSZip();

          for (const cid of chunk) {
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
          }

          const zipBlob = await zip.generateAsync({
            type: "blob",
            compression: "STORE",
          });
          const buffer = await zipBlob.arrayBuffer();
          const chunkIndex = i / CHUNK_SIZE + 1;
          const fileName =
            totalParts > 1
              ? `批量导出/Tavern_Export_${timestamp}_卷${chunkIndex}.zip`
              : `批量导出/Tavern_Export_${timestamp}.zip`;

          const result = await saveToGallery(fileName, buffer);
          if (result) {
            successCountChunks++;
          } else {
            failedChunks.push(chunkIndex);
          }

          // 添加延迟等待安卓端落盘，释放内存限制导致前序任务被抛弃。
          if (i + CHUNK_SIZE < charsArray.length) {
            await new Promise((resolve) => setTimeout(resolve, 3500));
          }
        }

        if (failedChunks.length > 0) {
          alert(
            `导出失败！由于文件过大，导致安卓内存过载。\n强烈建议：请下载最新源码重新打包安装您的安卓App（APK），升级后将开启底层原生 ZIP 引擎，支持上千张卡片无限制一次性导出且无内存报错！`,
          );
        } else {
          alert(
            `批量导出成功！本次为传统JS导出引擎。保存在 Download/MIU/批量导出/ 目录下。\n如果遇到导出不全、闪退问题，请重新编译更新您的 Android App (APK) 获取最新原生无限制导出引擎！`,
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

      for (const id of Array.from(idsToProcess)) {
        const folder = allFolders.find((f) => f.id === id);
        if (folder) {
          const collectFolderRecursive = async (
            currentFolderId: string,
            currentPath: string[],
          ) => {
            const { characters: folderChars } = await getCharacters(
              1,
              10000,
              currentFolderId,
            );
            for (const char of folderChars) {
              await pushCharTask(char.id, currentPath);
            }
            const subFolders = allFolders.filter(
              (f) => f.parentId === currentFolderId,
            );
            for (const subFolder of subFolders) {
              await collectFolderRecursive(subFolder.id, [
                ...currentPath,
                subFolder.name,
              ]);
            }
          };
          await collectFolderRecursive(folder.id, [folder.name]);
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
                {folderId ? (
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

              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50 [.light-theme_&]:!text-[#64748b] stroke-[1.75]" />
                <input
                  type="text"
                  placeholder="搜索..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-white/10 hover:bg-white/15 focus:bg-white/15 border-0 border-none rounded-full pl-8.5 pr-4 py-1.5 sm:py-2 text-sm text-white placeholder:text-white/40 focus:outline-none transition [.light-theme_&]:!bg-[#e2e8f0] [.light-theme_&]:hover:!bg-[#cbd5e1]/70 [.light-theme_&]:focus:!bg-[#cbd5e1]/70 [.light-theme_&]:!border-none [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:placeholder:!text-[#8e8e93] shadow-xs"
                />
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
                            <div className="flex items-center gap-3">
                              {selectedTags.length > 0 && (
                                <button
                                  onClick={() => setSelectedTags([])}
                                  className="text-xs font-semibold text-red-400 hover:text-red-300 transition [.light-theme_&]:!text-red-500 [.light-theme_&]:hover:!text-red-600 cursor-pointer"
                                >
                                  清除选中
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
                                  onTouchStart={() => handleTagTouchStart(tag)}
                                  onTouchEnd={handleTagTouchEnd}
                                  onTouchMove={handleTagTouchEnd}
                                  onMouseDown={() => handleTagTouchStart(tag)}
                                  onMouseUp={handleTagTouchEnd}
                                  onMouseLeave={handleTagTouchEnd}
                                  onClick={() => {
                                    if (tagLongPressTriggeredRef.current) return;
                                    if (isSelected) {
                                      setSelectedTags(
                                        selectedTags.filter((t) => t !== tag),
                                      );
                                    } else {
                                      setSelectedTags([...selectedTags, tag]);
                                    }
                                  }}
                                  className={`px-3.5 py-1.5 rounded-2xl text-xs sm:text-sm font-medium transition-all cursor-pointer select-none active:scale-95 border-none ${
                                    isSelected 
                                      ? "bg-blue-500/25 text-blue-300 font-semibold [.light-theme_&]:!bg-blue-600 [.light-theme_&]:!text-[#ffffff] shadow-xs" 
                                      : "bg-white/5 text-white/75 hover:text-white hover:bg-white/10 [.light-theme_&]:!bg-[#f1f2f6] [.light-theme_&]:!text-[#2c3e50] [.light-theme_&]:hover:!bg-[#e4e7eb] [.light-theme_&]:hover:!text-[#0f172a]"
                                  }`}
                                  title="点击筛选标签，长按管理标签"
                                >
                                  {tag}
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

      {totalItems === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-slate-400 px-4 [.light-theme_&]:!text-[#64748b]">
          <BookOpen className="w-16 h-16 mb-4 opacity-50 [.light-theme_&]:!text-[#94a3b8]" />
          <p className="[.light-theme_&]:!text-[#0f172a] font-medium">No characters found.</p>
          <p className="text-sm [.light-theme_&]:!text-[#64748b]">Tap the + button to import.</p>
        </div>
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
              lastDragEndTimeRef.current = Date.now();
              setActiveDragId(null);
              handleDragEnd(event);
            }}
            onDragCancel={() => {
              isDraggingRef.current = false;
              lastDragEndTimeRef.current = Date.now();
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
                        ? "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4 mb-6"
                        : "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-6"
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
                        <motion.div
                          animate={{ scale: selectedIds.has(folder.id) ? (viewMode === "list" ? 0.97 : 0.93) : 1 }}
                          transition={{ duration: 0.12, ease: "easeOut" }}
                          whileHover={selectionMode ? undefined : { scale: 1.03 }}
                          whileTap={{ scale: 0.92 }}
                          onTouchStart={(e) => {
                            if (selectionMode || isDraggingRef.current) return;
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
                            }, 320);
                          }}
                          onTouchMove={(e) => {
                            if (longPressRef.current.timer && e.touches[0]) {
                              const dx = Math.abs(e.touches[0].clientX - (longPressRef.current.startX || 0));
                              const dy = Math.abs(e.touches[0].clientY - (longPressRef.current.startY || 0));
                              if (dx > 20 || dy > 20 || isDraggingRef.current) {
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
                          }}
                          onTouchCancel={() => {
                            if (longPressRef.current.timer) {
                              clearTimeout(longPressRef.current.timer);
                              longPressRef.current.timer = null;
                            }
                          }}
                          onMouseDown={(e) => {
                            if (selectionMode || isDraggingRef.current || e.button !== 0) return;
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
                            }, 320);
                          }}
                          onMouseMove={(e) => {
                            if (longPressRef.current.timer) {
                              const dx = Math.abs(e.clientX - (longPressRef.current.startX || 0));
                              const dy = Math.abs(e.clientY - (longPressRef.current.startY || 0));
                              if (dx > 20 || dy > 20 || isDraggingRef.current) {
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
                          className={
                            viewMode === "list"
                              ? "flex items-center gap-4 p-3 rounded-2xl cursor-pointer transition-colors duration-150 relative group select-none border bg-white/5 hover:bg-white/10 border-transparent overflow-hidden"
                              : "flex flex-col items-center cursor-pointer group relative select-none break-inside-avoid w-full rounded-2xl p-1 transition-colors duration-150 border border-transparent overflow-hidden"
                          }
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
                        </motion.div>
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
                      ? "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4"
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

      <MoveToFolderModal
        isOpen={isMoveModalOpen}
        onClose={() => setIsMoveModalOpen(false)}
        onMove={handleMoveToFolder}
        isLightMode={isLightMode}
      />

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

      <AnimatePresence>
        {!selectionMode ? (
          <div className="fixed bottom-20 right-6 sm:right-8 z-40 flex flex-col items-center gap-2.5">
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

      {tokenModalChar && (
        <TokenBreakdownModal
          isOpen={!!tokenModalChar}
          onClose={() => setTokenModalChar(null)}
          charName={tokenModalChar.name}
          breakdown={tokenModalChar.breakdown}
          isLightMode={isLightMode}
        />
      )}
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
  const [url, setUrl] = useState<string>(initialUrl);
  // 追踪 onError 兜底逻辑里额外创建的 blob URL, 保证换掉/卸载时释放,
  // 否则长列表滚动 + 图片偶发加载失败会不断泄漏内存(可能是持续发热的一个来源)。
  const fallbackObjectUrlRef = useRef<string | null>(null);
  const setUrlWithFallbackCleanup = (newUrl: string, isObjectUrl: boolean) => {
    if (fallbackObjectUrlRef.current) {
      URL.revokeObjectURL(fallbackObjectUrlRef.current);
    }
    fallbackObjectUrlRef.current = isObjectUrl ? newUrl : null;
    setUrl(newUrl);
  };
  useEffect(() => {
    return () => {
      if (fallbackObjectUrlRef.current) {
        URL.revokeObjectURL(fallbackObjectUrlRef.current);
      }
    };
  }, []);
  const timerRef = useRef<any>(null);
  const isLongPress = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(cardRef); // 一次性:是否已经首次进入过视口附近,决定要不要开始加载
  const isNearby = useContinuousInView(cardRef); // 持续追踪:是否还在较大范围内,决定要不要保留已加载的图

  useEffect(() => {
    if (!isInView) return;
    let isMounted = true;

    if (!isNearby) {
      // 划出屏幕较远范围: 把 <img> 换回轻量占位图, 释放已解码图像占用的内存,
      // 不清 LRU 缓存本身——缓存还在, 划回来的时候能几乎零成本地恢复。
      // 参考卡库"划出屏幕就卸载"的做法。
      setUrl(initialUrl);
      return;
    }

    let objectUrl: string | null = null;

    if (char.avatarBlob) {
      objectUrl = URL.createObjectURL(char.avatarBlob);
      setUrl(objectUrl);
    } else if (char.hasBlobsSeparated) {
      // 优先用小缩略图, 而不是整张原图去解码显示(参考卡库的做法):
      // 有界LRU缓存里已经有就直接用(几乎零成本), 没有再去数据库拿
      // (数据库那边会懒生成缩略图并持久化, 详见 getCharacterThumb)
      // 缓存的 key 里带上 updatedAt: 换头像本质是同一个 id 但内容变了,
      // 只用 id 当 key 会导致换完头像主页还在用内存里换头像之前缓存的那张,
      // 详情页(不走这个缓存)却已经能看到新的——带上 updatedAt, 头像一换
      // key 就跟着变, 自然变成一次缓存未命中, 会重新去数据库拿最新缩略图。
      const thumbCacheKey = `${char.id}:${char.updatedAt || 0}`;
      const cached = peekCachedUrl(thumbCacheKey);
      if (cached) {
        setUrl(cached);
      } else {
        getCharacterThumb(char.id).then((thumbBlob) => {
          if (thumbBlob && isMounted) {
            setUrl(putCachedBlobUrl(thumbCacheKey, thumbBlob));
          }
        });
      }
    } else if (
      char.localFilePath &&
      char.localFilePath.match(/\.(png|jpe?g|webp|gif|bmp)$/i)
    ) {
      import("../lib/appBridge").then(({ getLocalImageUrl }) => {
        if (isMounted)
          setUrl(
            getLocalImageUrl(
              char.localFilePath!,
              char.updatedAt || char.createdAt,
            ),
          );
      });
    }

    return () => {
      isMounted = false;
      // 注意: 缩略图 URL 现在由全局有界 LRU 缓存(thumbCache.ts)统一管理生命周期,
      // 允许被其他卡片实例复用, 只有被 LRU 淘汰时才真正释放, 这里不用管;
      // 只有 char.avatarBlob 直接创建的这个是本组件私有的, 需要自己清理。
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    char.avatarBlob,
    char.localFilePath,
    char.hasBlobsSeparated,
    char.id,
    char.updatedAt,
    isInView,
    isNearby,
  ]);

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
    }, 320);
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
    if (dx > 20 || dy > 20) {
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

  const charTags = (char as any).tags || char.data?.data?.tags || char.data?.tags;
  const hasTags = charTags && Array.isArray(charTags) && charTags.length > 0;
  const badgeInfo = getCardBadgeInfo(char);

  if (viewMode === "list") {
    return (
      <motion.div
        ref={cardRef}
        animate={{ scale: isSelected ? 0.97 : 1 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        whileHover={selectionMode ? undefined : { scale: 1.02 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          if (Date.now() - lastLongPressTimeRef.current < 800) return;
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
        className="relative flex items-center gap-4 p-3 rounded-2xl cursor-pointer transition-colors duration-150 select-none bg-white/5 hover:bg-white/10 border border-transparent"
      >
        <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 relative">
          <img
            src={url || undefined}
            alt={char.name}
            className="w-full h-full object-cover pointer-events-none"
            onError={() => {
              if (url === defaultFallback) return;
              if (fallbackObjectUrlRef.current) {
                setUrl(defaultFallback);
                return;
              }
              if (char.avatarBlob) setUrlWithFallbackCleanup(URL.createObjectURL(char.avatarBlob), true);
              else if (char.hasBlobsSeparated) {
                getCharacterBlob(char.id).then((b) => {
                  if (b && b.avatarBlob)
                    setUrlWithFallbackCleanup(URL.createObjectURL(b.avatarBlob), true);
                  else setUrl(defaultFallback);
                });
              } else setUrl(defaultFallback);
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
            {/* {char.autoImportFilename && (
              <span className="text-[10px] text-slate-500 truncate flex-shrink-1">
                {char.autoImportFilename}
              </span>
            )} */}
          </div>
        </div>

        {/* Right side favorite button in list view */}
        {!selectionMode && onToggleFavorite && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(e);
            }}
            className="p-2 rounded-full hover:bg-white/10 [.light-theme_&]:hover:bg-black/5 transition relative group active:scale-90 cursor-pointer shrink-0 z-10"
            title={char.isFavorite ? "取消收藏" : "收藏"}
          >
            <Heart
              className={`w-4.5 h-4.5 transition-all duration-200 ${
                char.isFavorite
                  ? "text-rose-500 fill-rose-500 scale-110 drop-shadow-[0_2px_6px_rgba(244,63,94,0.4)]"
                  : "text-white/40 hover:text-rose-400 [.light-theme_&]:text-slate-400 [.light-theme_&]:hover:text-rose-500"
              }`}
            />
          </button>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      ref={cardRef}
      animate={{ scale: isSelected ? 0.93 : 1 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      whileHover={selectionMode ? undefined : { scale: 1.05 }}
      whileTap={{ scale: isSelected ? 0.9 : 0.92 }}
      onClick={handleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        if (Date.now() - lastLongPressTimeRef.current < 800) return;
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
      className={`relative ${viewMode === "masonry" ? "w-full min-h-[160px] aspect-[2/3] bg-white/5" : "aspect-[2/3]"} rounded-2xl overflow-hidden cursor-pointer shadow-lg border-0 [.light-theme_&]:border-0 transition-colors duration-150 group select-none`}
    >
      <img
        src={url || undefined}
        alt={char.name}
        loading="lazy"
        decoding="async"
        className="w-full h-full object-cover pointer-events-none"
        onError={() => {
          if (url === defaultFallback) return;
          if (fallbackObjectUrlRef.current) {
            setUrl(defaultFallback);
            return;
          }
          if (char.avatarBlob) setUrlWithFallbackCleanup(URL.createObjectURL(char.avatarBlob), true);
          else if (char.hasBlobsSeparated) {
            getCharacterBlob(char.id).then((b) => {
              if (b && b.avatarBlob) setUrlWithFallbackCleanup(URL.createObjectURL(b.avatarBlob), true);
              else setUrl(defaultFallback);
            });
          } else setUrl(defaultFallback);
        }}
      />
      {isSelected && (
        <div className="absolute inset-0 bg-black/45 pointer-events-none z-[2] transition-opacity" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent flex flex-col justify-end p-3 pointer-events-none z-[3]">
        <h3 className="font-semibold !text-white text-sm sm:text-base leading-tight drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)] break-words truncate">
          {char.name}
        </h3>
        {hasTags && (
          <div className="flex flex-wrap gap-1 mt-1.5 h-[1.25rem] overflow-hidden -mr-1">
            {charTags.map((t: string) => (
              <span
                key={t}
                className="text-[9.5px] bg-black/60 backdrop-blur-md !text-white/95 border border-white/20 px-1.5 py-0.5 rounded-md truncate max-w-[75px] font-medium leading-tight shadow-xs"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {badgeInfo && (
        <div className="absolute top-2 left-2 z-10 px-2 py-0.5 bg-black/60 backdrop-blur-md rounded-md text-[10px] font-medium text-white/90 border border-white/10 flex items-center gap-1.5 shadow-sm pointer-events-none select-none">
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
          className={`absolute ${badgeInfo ? "top-8.5" : "top-2"} left-2 z-10 px-1.5 py-0.5 bg-black/60 hover:bg-black/80 backdrop-blur-md rounded-md text-[10px] font-mono font-medium text-white/90 hover:text-white border border-white/20 flex items-center shadow-xs transition cursor-pointer select-none active:scale-95`}
          title={`Token 数量: ${char.tokenCount.toLocaleString()} (常驻: ${formatTokenCount(char.permanentTokens || 0)})，点击查看拆解`}
        >
          <span>{formatTokenCount(char.tokenCount)} T</span>
        </button>
      )}

      {/* Top right Heart favorite button */}
      {!selectionMode && onToggleFavorite && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(e);
          }}
          className={`absolute top-2 right-2 z-10 w-7 h-7 rounded-full flex items-center justify-center backdrop-blur-md transition-all duration-200 cursor-pointer active:scale-85 ${
            char.isFavorite
              ? "bg-black/50 text-rose-500 shadow-sm opacity-100"
              : "bg-black/35 text-white/75 hover:text-rose-400 opacity-0 group-hover:opacity-100 max-sm:opacity-85"
          }`}
          title={char.isFavorite ? "取消收藏" : "收藏"}
        >
          <Heart
            className={`w-4 h-4 transition-transform duration-200 ${
              char.isFavorite
                ? "fill-rose-500 text-rose-500 scale-110 drop-shadow-[0_1px_4px_rgba(244,63,94,0.5)]"
                : "text-white/90 hover:text-white"
            }`}
          />
        </button>
      )}
    </motion.div>
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
