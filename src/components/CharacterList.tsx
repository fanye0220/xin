import { Capacitor } from "@capacitor/core";
import { getFallbackAvatar, resolveAvatarUrl } from "../lib/avatar";
import React, { useState, useEffect, useRef, useCallback } from "react";
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
  Search,
  LayoutGrid,
  List,
  Filter,
  Folder as FolderIcon,
  Menu,
  Edit2,
  MoreVertical,
  Download,
  ArrowUpDown,
  LayoutDashboard,
  Link,
  Loader2,
  Image as ImageIcon,
} from "lucide-react";
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
  Folder,
  getFolders,
  getAllTags,
  saveFolder,
  deleteFolder,
  SortOption,
  getCachedMeta,
} from "../lib/db";
import { useInView } from "../lib/useInView";
import { useContinuousInView } from "../lib/useContinuousInView";
import { peekCachedUrl, putCachedBlobUrl } from "../lib/thumbCache";
import { MoveToFolderModal } from "./MoveToFolderModal";
import { BindQRModal } from "./BindQRModal";
import JSZip from "jszip";
import { injectTavernData } from "../lib/png";
import { uploadCharacterToCloud } from "../lib/cloudDrive";
import Cropper from "react-easy-crop";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
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

function FolderCover({
  folder,
  previews,
  viewMode,
}: {
  folder: Folder;
  previews: any[];
  viewMode: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (folder.avatarBlob) {
      const objectUrl = URL.createObjectURL(folder.avatarBlob);
      setUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    } else {
      setUrl(null);
    }
  }, [folder.avatarBlob]);

  if (url) {
    return (
      <div className="w-full h-full bg-black/20 flex items-center justify-center relative overflow-hidden pointer-events-none">
        <img
          src={url}
          alt=""
          className="w-full h-full object-cover relative z-10 pointer-events-none"
        />
      </div>
    );
  }

  if (previews.length > 0) {
    return (
      <div
        className={`w-full h-full grid grid-cols-2 grid-rows-2 gap-1 pointer-events-none ${viewMode === "list" ? "p-1.5" : "p-3"}`}
      >
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="w-full h-full bg-black/20 rounded-md overflow-hidden pointer-events-none flex items-center justify-center"
          >
            {previews[i] && (
              <img
                src={typeof previews[i] === 'string' ? previews[i] : previews[i].url}
                alt=""
                className="w-full h-full object-cover pointer-events-none"
                onError={(e) => {
                    const item = previews[i];
                    const seed = (typeof item === 'object' && item?.seed) ? item.seed : (typeof item === 'string' ? item : (folder.name || folder.id));
                    const category = (typeof item === 'object') ? (item.tags || (item.isTool ? 'tool' : undefined)) : undefined;
                    e.currentTarget.src = getFallbackAvatar(seed, category);
                    e.currentTarget.style.display = 'block';
                }}
              />
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <FolderIcon className="w-1/2 h-1/2 text-slate-400/70 dark:text-white/50 pointer-events-none" />
  );
}
function SortableItemWrapper({
  id,
  children,
  disabled,
  className = "",
}: {
  id: string;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    position: "relative" as const,
    userSelect: "none" as const,
    WebkitUserSelect: "none" as const,
    WebkitTouchCallout: "none" as const,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`select-none ${className}`}
    >
      {children}
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
}

export function CharacterList({
  folderId,
  onSelect,
  onImport,
  onSelectFolder,
  onOpenSidebar,
  refreshTrigger,
}: Props) {
  const [characters, setCharacters] = useState<CharacterCard[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderPreviews, setFolderPreviews] = useState<
    Record<string, any[]>
  >({});
  // 每次刷新文件夹预览图都会重新生成一批 blob URL, 这里记一份"当前挂着的"
  // 引用, 下次覆盖前先批量释放旧的, 避免每次翻页/切换文件夹都泄漏一批。
  const folderPreviewUrlsRef = useRef<string[]>([]);
  const setFolderPreviewsWithCleanup = (previews: Record<string, any[]>) => {
    const oldUrls = folderPreviewUrlsRef.current;
    const newUrls = Object.values(previews).flat().map(p => typeof p === 'string' ? p : p.url);
    folderPreviewUrlsRef.current = newUrls;
    setFolderPreviews(previews);
    if (oldUrls.length > 0) {
      requestAnimationFrame(() => {
        oldUrls.forEach((u) => {
          if (u && u.startsWith("blob:")) URL.revokeObjectURL(u);
        });
      });
    }
  };
  useEffect(() => {
    return () => {
      folderPreviewUrlsRef.current.forEach((u) => {
        if (u.startsWith("blob:")) URL.revokeObjectURL(u);
      });
    };
  }, []);
  const [totalCharacters, setTotalCharacters] = useState(0);
  const [page, setPage] = useState(1);
  const [pageInputValue, setPageInputValue] = useState("1");

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

  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isEditingTags, setIsEditingTags] = useState(false);
  const [editingTagValue, setEditingTagValue] = useState<{
    old: string;
    new: string;
  } | null>(null);
  const [tagSearchQuery, setTagSearchQuery] = useState("");
  const [isTagSearchOpen, setIsTagSearchOpen] = useState(false);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [isCropping, setIsCropping] = useState(false);

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
  const [currentFolderName, setCurrentFolderName] = useState<string | null>(
    null,
  );
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
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
    startY?: number;
  }>({ timer: null, triggered: false });

  const [showScrollTop, setShowScrollTop] = useState(false);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [isFoldersExpanded, setIsFoldersExpanded] = useState(
    () => localStorage.getItem("tavern_foldersExpanded") !== "false",
  );
  const lastScrollY = useRef(0);
  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

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
    if (!scrollContainer) return;

    const handleScroll = () => {
      const currentScrollY = scrollContainer.scrollTop;
      setShowScrollTop(currentScrollY > 500);

      if (currentScrollY > lastScrollY.current + 10 && currentScrollY > 100) {
        setIsHeaderVisible(false);
      } else if (
        currentScrollY < lastScrollY.current - 10 ||
        currentScrollY < 100
      ) {
        setIsHeaderVisible(true);
      }
      lastScrollY.current = currentScrollY;
    };

    scrollContainer.addEventListener("scroll", handleScroll);
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    const scrollContainer = document.getElementById("main-scroll-container");
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleBack = async () => {
    if (!folderId) return;
    const allFolders = await getFolders();
    const current = allFolders.find((f) => f.id === folderId);
    onSelectFolder?.(current?.parentId || null);
  };
  const handleRootTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touch) {
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
    }
  };

  const handleRootTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    const touch = e.changedTouches[0];
    if (!start || !touch) return;
    touchStartRef.current = null;

    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    // 进入子文件夹后, 从屏幕左边缘向右轻扫即可返回上一级。
    if (!selectionMode && folderId && dx > 90 && start.x < 80 && Math.abs(dy) < 70) {
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
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    if (sortBy !== "custom") {
      setSortBy("custom");
    }

    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);

    const isFolder = activeIdStr.startsWith("folder-");

    if (isFolder) {
      const activeId = activeIdStr.replace("folder-", "");
      const overId = overIdStr.replace("folder-", "");

      const oldIndex = folders.findIndex((f) => f.id === activeId);
      const newIndex = folders.findIndex((f) => f.id === overId);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newFolders = arrayMove(folders, oldIndex, newIndex);
        setFolders(newFolders);
        // Save new order to db
        newFolders.forEach((f, i) => {
          f.sortOrder = i;
          saveFolder(f);
        });
      }
    } else {
      const activeId = activeIdStr.replace("char-", "");
      const overId = overIdStr.replace("char-", "");

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

  const loadData = () => {
    getCharacters(
      page,
      pageSize,
      folderId,
      debouncedSearchQuery,
      selectedTags,
      sortBy,
      false,
      false
    ).then(({ characters, total }) => {
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      if (page > totalPages) {
        setTotalCharacters(total);
        setPage(totalPages);
        return;
      }
      setCharacters(characters);
      setTotalCharacters(total);
    });

    getFolders().then(async (data) => {
      let currentFolders: Folder[] = [];
      if (folderId === null) {
        currentFolders = data.filter((f) => !f.parentId);
        setCurrentFolderName(null);
      } else {
        currentFolders = data.filter((f) => f.parentId === folderId);
        const currentFolder = data.find((f) => f.id === folderId);
        if (currentFolder) setCurrentFolderName(currentFolder.name);
      }

      currentFolders.sort((a, b) => {
        if (sortBy === "custom") {
          if (a.sortOrder !== undefined && b.sortOrder !== undefined)
            return a.sortOrder - b.sortOrder;
          if (a.sortOrder !== undefined) return -1;
          if (b.sortOrder !== undefined) return 1;
        }
        return b.createdAt - a.createdAt;
      });

      setFolders(currentFolders);

      // Fetch previews for folders concurrently
      try {
        const { getFolderPreviews } = await import("../lib/db");
        const folderIds = currentFolders.map((f) => f.id);
        const previews = await getFolderPreviews(folderIds);
        setFolderPreviewsWithCleanup(previews);
      } catch (err) {
        console.error("Failed to load folder previews", err);
      }
    });
  };

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

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
    getAllTags().then(setAllTags);
  }, [refreshTrigger, folderId]); // We can just fetch it when folder triggers, though realistically it only needs refreshTrigger. I will keep it as refreshTrigger.

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent | TouchEvent) => {
      if (filterRef.current && filterRef.current.contains(e.target as Node))
        return;
      if (sortRef.current && sortRef.current.contains(e.target as Node)) return;

      setIsFilterOpen(false);
      setIsSortOpen(false);
      setIsEditingTags(false);
      setEditingTagValue(null);
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

  const totalPages = Math.ceil(totalCharacters / pageSize);

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const handleSelectPage = () => {
    const pageItems =
      characters.length +
      (!searchQuery && selectedTags.length === 0 && page === 1
        ? folders.length
        : 0);

    let allPageSelected = true;
    for (const c of characters) {
      if (!selectedIds.has(c.id)) allPageSelected = false;
    }
    if (!searchQuery && selectedTags.length === 0 && page === 1) {
      for (const f of folders) {
        if (!selectedIds.has(f.id)) allPageSelected = false;
      }
    }

    if (allPageSelected) {
      const newSet = new Set(selectedIds);
      characters.forEach((c) => newSet.delete(c.id));
      if (!searchQuery && selectedTags.length === 0 && page === 1) {
        folders.forEach((f) => newSet.delete(f.id));
      }
      setSelectedIds(newSet);
    } else {
      const newSet = new Set(selectedIds);
      characters.forEach((c) => newSet.add(c.id));
      if (!searchQuery && selectedTags.length === 0 && page === 1) {
        folders.forEach((f) => newSet.add(f.id));
      }
      setSelectedIds(newSet);
    }
  };

  const handleSelectAll = async () => {
    const { characters: allChars } = await getCharacters(
      1,
      100000,
      folderId,
      searchQuery,
      selectedTags,
      sortBy,
      false,
      false
    );
    const totalItems =
      allChars.length +
      (!searchQuery && selectedTags.length === 0 ? folders.length : 0);

    if (selectedIds.size === totalItems) {
      setSelectedIds(new Set());
    } else {
      const newSet = new Set<string>();
      allChars.forEach((c) => newSet.add(c.id));
      if (!searchQuery && selectedTags.length === 0) {
        folders.forEach((f) => newSet.add(f.id));
      }
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

  const checkIsQR = (char: CharacterCard) => {
    return (char as any).isQR === true;
  };

  const handleBindQR = async (targetCharId: string) => {
    const qrCharId = Array.from(selectedIds)[0];
    const qrChar = characters.find((c) => c.id === qrCharId);
    if (!qrChar) return;

    try {
      const targetChar = await getCharacter(targetCharId);
      if (!targetChar) return;

      const qrData = qrChar.data || {};
      let newQRs = [];
      let metadata = null;
      if (Array.isArray(qrData)) {
        newQRs = qrData;
      } else if (qrData.qrList && Array.isArray(qrData.qrList)) {
        newQRs = qrData.qrList;
        metadata = qrData;
      } else if (qrData.quick_replies && Array.isArray(qrData.quick_replies)) {
        newQRs = qrData.quick_replies;
        metadata = qrData;
      }

      const updatedChar = { ...targetChar };
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
        sourceName: qrChar.name,
        replies: JSON.parse(JSON.stringify(newQRs)),
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
      });

      updatedData.extensions = {
        ...(updatedData.extensions || {}),
        tavern_qr_sets: newSets,
        quick_replies: newSets.flatMap((s: any) => s.replies),
        qr_filename: `${qrChar.name}.json`,
      };

      setIsBindModalOpen(false);
      setSelectionMode(false);
      setSelectedIds(new Set());
      await new Promise(r => setTimeout(r, 100));

      await saveCharacter(updatedChar);
      loadData(); // Refresh the list
    } catch (e) {
      console.error(e);
      try {
        alert(
          "绑定失败，请查看控制台: " +
            (e instanceof Error ? e.message : String(e)),
        );
      } catch (err) {}
    }
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

    const { getAccessToken } = await import("../lib/drive");
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
      let completed = 0;
      const CONCURRENCY = Capacitor.isNativePlatform() ? 3 : 5;
      let currentIndex = 0;

      setProgress({
        current: 0,
        total: charsArray.length,
        message: `正在准备批量同步至云端...`,
      });

      const uploadWorker = async () => {
        while (currentIndex < charsArray.length) {
          const i = currentIndex++;
          try {
            await uploadCharacterToCloud(token, charsArray[i]);
            success++;
          } catch (e) {
            console.error("Upload failed for char:", charsArray[i], e);
          } finally {
            completed++;
            setProgress({
              current: completed,
              total: charsArray.length,
              message: `正在批量同步至云端...`,
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

      setProgress(null);
      alert(`云端备份成功！共备份 ${success} 个角色资料。`);
    } catch (err: any) {
      console.error(err);
      setProgress(null);
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
                    if (Capacitor.isNativePlatform()) {
                        await exportFileToMIU(exportFileName, newBuffer, 'image/png', true);
                    } else {
                        const blob = new Blob([newBuffer], { type: 'image/png' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = exportFileName;
                        a.click();
                        URL.revokeObjectURL(url);
                    }
                    return; // Done
                } catch (e) {
                    console.error("Failed to inject PNG in single export", e);
                }
            }

            // Fallback to JSON
            const exportFileName = `${safeName}.json`;
            const bytes = new TextEncoder().encode(JSON.stringify(exportData, null, 2));
            if (Capacitor.isNativePlatform()) {
                await exportFileToMIU(exportFileName, bytes.buffer, 'application/json', true);
            } else {
                const blob = new Blob([bytes.buffer], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = exportFileName;
                a.click();
                URL.revokeObjectURL(url);
            }
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
              prefix =
                folderName.split("/").map(getSafeFilename).join("/") + "/";
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
             
             alert(
              `批量导出成功！共导出 ${successCount} 个角色资料。\n文件已存至：Download/MIU/${zipName}`,
             );
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
              const parts = folderName.split("/");
              for (const p of parts) {
                currentZip =
                  currentZip.folder(getSafeFilename(p)) || currentZip;
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
              await pushCharTask(id, folderName.split("/"));
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
          let currentZip: JSZip = zip;
          for (const part of task.path) {
            currentZip = currentZip.folder(getSafeFilename(part)) || currentZip;
          }
          await addCharacterToZip(char, currentZip, undefined, uniqueName);
        }

        const zipBlob = await zip.generateAsync({
          type: "blob",
          compression: "STORE",
        });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download =
          totalParts > 1
            ? `Tavern_Export_${timestamp}_卷${chunkIndex}.zip`
            : `Tavern_Export_${timestamp}.zip`;
        a.click();
        URL.revokeObjectURL(url);

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

  return (
    <div className="pb-32 min-h-full bg-gradient-to-br from-slate-900 to-slate-800 text-white" onTouchStart={handleRootTouchStart} onTouchEnd={handleRootTouchEnd}>
      <input
        type="file"
        ref={coverInputRef}
        className="hidden"
        accept="image/png, image/jpeg, image/webp, image/gif"
        onChange={handleCoverUpload}
      />
      <motion.header
        initial={{ y: 0 }}
        animate={{ y: isHeaderVisible ? 0 : "-100%" }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-xl border-b border-white/10 px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-4 mb-6 cursor-pointer"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            scrollToTop();
          }
        }}
      >
        {selectionMode ? (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full flex items-center justify-between bg-slate-800/90 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-xl"
          >
            <button
              onClick={() => {
                setSelectionMode(false);
                setSelectedIds(new Set());
              }}
              className="p-2 -ml-2 rounded-full hover:bg-white/10 transition"
            >
              <X className="w-6 h-6" />
            </button>
            <span className="font-bold text-lg flex-1 text-center">
              已选择 {selectedIds.size} 项
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSelectPage}
                className="text-purple-400 font-medium px-3 py-1.5 hover:bg-purple-400/10 rounded-lg transition text-sm whitespace-nowrap"
              >
                全选本页
              </button>
              <button
                onClick={handleSelectAll}
                className="text-pink-400 font-medium px-3 py-1.5 hover:bg-pink-400/10 rounded-lg transition text-sm whitespace-nowrap"
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
                <div className="flex items-center gap-2 mb-1">
                  <button
                    onClick={handleBack}
                    className="p-1 -ml-1 rounded-lg hover:bg-white/10 transition text-white/60 hover:text-white"
                  >
                    <ChevronLeft className="w-6 h-6" />
                  </button>
                  <h1 className="text-2xl font-bold text-white truncate">
                    {folderId === "all" ? "全部角色" : currentFolderName}
                  </h1>
                </div>
              ) : (
                <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-600 truncate">
                  SillyTavern管理器
                </h1>
              )}
              <p className="text-slate-400 text-xs mt-0.5 truncate">
                管理你的角色卡片 ({totalCharacters})
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onOpenSidebar}
                className="p-2 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition shrink-0"
              >
                <Menu className="w-5 h-5" />
              </button>

              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="text"
                  placeholder="搜索..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-purple-500/50 transition"
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
                className="p-2 bg-white/5 border border-white/10 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition shrink-0"
              >
                {viewMode === "grid" ? (
                  <LayoutGrid className="w-5 h-5" />
                ) : viewMode === "masonry" ? (
                  <LayoutDashboard className="w-5 h-5" />
                ) : (
                  <List className="w-5 h-5" />
                )}
              </button>

              <div ref={sortRef} className="relative shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsSortOpen(!isSortOpen);
                    setIsFilterOpen(false);
                  }}
                  className={`p-2 border rounded-xl transition ${isSortOpen ? "bg-purple-500/20 text-purple-400 border-purple-500/50" : "bg-white/5 text-white/60 border-white/10 hover:text-white hover:bg-white/10"}`}
                >
                  <ArrowUpDown className="w-5 h-5" />
                </button>

                <AnimatePresence>
                  {isSortOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute right-0 top-full mt-2 w-48 bg-slate-800 border border-white/10 rounded-2xl shadow-xl z-50 p-2 overflow-hidden"
                    >
                      {[
                        { value: "newest_import", label: "最新导入" },
                        { value: "oldest_import", label: "最旧导入" },
                        { value: "recently_modified", label: "最近修改" },
                        { value: "a_z", label: "A - Z" },
                        { value: "z_a", label: "Z - A" },
                      ].map((option) => (
                        <button
                          key={option.value}
                          onClick={() => {
                            setSortBy(option.value as SortOption);
                            setIsSortOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2.5 rounded-xl text-sm transition ${
                            sortBy === option.value
                              ? "bg-purple-500/20 text-purple-400 font-medium"
                              : "text-white/70 hover:bg-white/5 hover:text-white"
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
                  className={`p-2 border rounded-xl transition ${selectedTags.length > 0 ? "bg-purple-500/20 text-purple-400 border-purple-500/50" : "bg-white/5 text-white/60 border-white/10 hover:text-white hover:bg-white/10"}`}
                >
                  <Filter className="w-5 h-5" />
                </button>

                <AnimatePresence>
                  {isFilterOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute right-0 top-full mt-2 w-72 bg-slate-800 border border-white/10 rounded-2xl shadow-xl z-50 p-4 max-h-[60vh] overflow-y-auto overscroll-contain touch-pan-y"
                    >
                      <div className="flex items-center justify-between mb-3 relative h-6">
                        {!isTagSearchOpen ? (
                          <div className="absolute inset-0 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold text-white">
                                按标签筛选
                              </h3>
                              <button
                                onClick={() => setIsTagSearchOpen(true)}
                                className="text-white/40 hover:text-white transition"
                              >
                                <Search className="w-4 h-4" />
                              </button>
                            </div>
                            <div className="flex items-center gap-2">
                              {selectedTags.length > 0 && (
                                <button
                                  onClick={() => setSelectedTags([])}
                                  className="text-xs text-red-400 hover:text-red-300 transition"
                                >
                                  清除选中
                                </button>
                              )}
                              {allTags.length > 0 && (
                                <button
                                  onClick={() => {
                                    setIsEditingTags(!isEditingTags);
                                    setEditingTagValue(null);
                                  }}
                                  className="text-xs text-purple-400 hover:text-purple-300 transition"
                                >
                                  {isEditingTags ? "完成" : "编辑"}
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <motion.div
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width: "100%", opacity: 1 }}
                            className="absolute right-0 flex items-center bg-white/10 rounded-lg overflow-hidden h-full"
                          >
                            <Search className="w-3.5 h-3.5 text-white/40 ml-2 shrink-0" />
                            <input
                              autoFocus
                              type="text"
                              placeholder="搜索标签..."
                              value={tagSearchQuery}
                              onChange={(e) =>
                                setTagSearchQuery(e.target.value)
                              }
                              className="w-full bg-transparent text-sm text-white px-2 py-1 outline-none min-w-0"
                            />
                            <button
                              onClick={() => {
                                setIsTagSearchOpen(false);
                                setTagSearchQuery("");
                              }}
                              className="p-1 hover:bg-white/10 rounded-md mr-0.5 text-white/60 hover:text-white transition shrink-0"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </motion.div>
                        )}
                      </div>
                      {allTags.length === 0 ? (
                        <p className="text-sm text-white/40">无可用标签</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {allTags
                            .filter((tag) =>
                              tag
                                .toLowerCase()
                                .includes(tagSearchQuery.toLowerCase()),
                            )
                            .map((tag) => {
                              const isSelected = selectedTags.includes(tag);

                              if (isEditingTags) {
                                if (editingTagValue?.old === tag) {
                                  return (
                                    <div
                                      key={tag}
                                      className="flex items-center gap-1 w-full bg-black/20 p-1 rounded-lg border border-purple-500/50"
                                    >
                                      <input
                                        autoFocus
                                        type="text"
                                        value={editingTagValue.new}
                                        onChange={(e) =>
                                          setEditingTagValue({
                                            ...editingTagValue,
                                            new: e.target.value,
                                          })
                                        }
                                        className="flex-1 bg-transparent text-sm text-white px-2 py-1 outline-none"
                                        onKeyDown={async (e) => {
                                          if (
                                            e.key === "Enter" &&
                                            editingTagValue.new.trim() &&
                                            editingTagValue.new.trim() !== tag
                                          ) {
                                            await import("../lib/db").then(
                                              (m) =>
                                                m.renameTag(
                                                  tag,
                                                  editingTagValue.new.trim(),
                                                ),
                                            );
                                            setEditingTagValue(null);
                                            loadData();
                                            import("../lib/db").then((m) =>
                                              m.getAllTags().then(setAllTags),
                                            );
                                          } else if (e.key === "Escape") {
                                            setEditingTagValue(null);
                                          }
                                        }}
                                      />
                                      <button
                                        onClick={async () => {
                                          if (
                                            editingTagValue.new.trim() &&
                                            editingTagValue.new.trim() !== tag
                                          ) {
                                            await import("../lib/db").then(
                                              (m) =>
                                                m.renameTag(
                                                  tag,
                                                  editingTagValue.new.trim(),
                                                ),
                                            );
                                            setEditingTagValue(null);
                                            loadData();
                                            import("../lib/db").then((m) =>
                                              m.getAllTags().then(setAllTags),
                                            );
                                          } else {
                                            setEditingTagValue(null);
                                          }
                                        }}
                                        className="p-1.5 text-green-400 hover:bg-green-400/20 rounded-md transition"
                                      >
                                        <CheckCircle2 className="w-4 h-4" />
                                      </button>
                                      <button
                                        onClick={() => setEditingTagValue(null)}
                                        className="p-1.5 text-white/40 hover:bg-white/10 rounded-md transition"
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                  );
                                }

                                return (
                                  <div
                                    key={tag}
                                    className="flex items-center gap-1 bg-white/5 rounded-lg pl-3 pr-1 py-1 border border-white/10"
                                  >
                                    <span className="text-sm text-white/80">
                                      {tag}
                                    </span>
                                    <button
                                      onClick={() =>
                                        setEditingTagValue({
                                          old: tag,
                                          new: tag,
                                        })
                                      }
                                      className="p-1 text-white/40 hover:text-blue-400 hover:bg-blue-400/10 rounded transition"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={async () => {
                                        if (
                                          confirm(
                                            `确定要删除标签 "${tag}" 吗？这会从所有角色中移除该标签。`,
                                          )
                                        ) {
                                          await import("../lib/db").then((m) =>
                                            m.deleteTag(tag),
                                          );
                                          setSelectedTags(
                                            selectedTags.filter(
                                              (t) => t !== tag,
                                            ),
                                          );
                                          loadData();
                                          import("../lib/db").then((m) =>
                                            m.getAllTags().then(setAllTags),
                                          );
                                        }
                                      }}
                                      className="p-1 text-white/40 hover:text-red-400 hover:bg-red-400/10 rounded transition"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                );
                              }

                              return (
                                <button
                                  key={tag}
                                  onClick={() => {
                                    if (isSelected) {
                                      setSelectedTags(
                                        selectedTags.filter((t) => t !== tag),
                                      );
                                    } else {
                                      setSelectedTags([...selectedTags, tag]);
                                    }
                                  }}
                                  className={`px-3 py-1.5 rounded-lg text-sm transition ${isSelected ? "bg-purple-500 text-white" : "bg-white/5 text-white/60 hover:bg-white/10"}`}
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

      {totalCharacters === 0 && folders.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-slate-400 px-4">
          <BookOpen className="w-16 h-16 mb-4 opacity-50" />
          <p>No characters found.</p>
          <p className="text-sm">Tap the + button to import.</p>
        </div>
      ) : (
        <div className="px-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={(event) => {
              if (!selectionMode) {
                setSelectionMode(true);
                const idStr = String(event.active.id);
                if (idStr.startsWith("char-")) {
                  const id = idStr.replace("char-", "");
                  setSelectedIds(new Set([id]));
                } else if (idStr.startsWith("folder-")) {
                  const id = idStr.replace("folder-", "");
                  setSelectedIds(new Set([id]));
                }
              }
            }}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={[
                ...(!searchQuery && selectedTags.length === 0 && page === 1
                  ? folders.map((f) => `folder-${f.id}`)
                  : []),
                ...characters.map((c) => `char-${c.id}`),
              ]}
              strategy={rectSortingStrategy}
            >
              {!searchQuery && selectedTags.length === 0 && page === 1 && (
                <div
                  className={
                    viewMode === "list"
                      ? "flex flex-col gap-2 mb-2"
                      : viewMode === "grid"
                        ? "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4 mb-6"
                        : "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-6"
                  }
                >
                  <motion.div
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setIsCreatingFolder(true)}
                    className={
                      viewMode === "list"
                        ? "flex items-center gap-4 p-3 bg-white/5 hover:bg-white/10 rounded-2xl cursor-pointer transition border border-dashed border-white/20"
                        : viewMode === "masonry" 
                          ? "flex flex-col items-center gap-2 cursor-pointer group break-inside-avoid mb-4" 
                          : "flex flex-col items-center gap-2 cursor-pointer group break-inside-avoid"
                    }
                  >
                    <div
                      className={
                        viewMode === "list"
                          ? "w-12 h-12 bg-white/5 border-2 border-dashed border-white/20 rounded-xl flex items-center justify-center shrink-0"
                          : "w-full aspect-square bg-white/5 border-2 border-dashed border-white/20 rounded-3xl flex items-center justify-center group-hover:bg-white/10 group-hover:border-white/40 transition"
                      }
                    >
                      <Plus className="w-8 h-8 text-white/40 group-hover:text-white/60 transition" />
                    </div>
                    <span
                      className={
                        viewMode === "list"
                          ? "font-medium text-white/60"
                          : "text-xs font-medium text-center truncate w-full text-white/60 group-hover:text-white/80"
                      }
                    >
                      新建文件夹
                    </span>
                  </motion.div>

                  {folders.map((folder) => {
                    const previews = folderPreviews[folder.id] || [];
                    return (
                      <SortableItemWrapper
                        key={`folder-${folder.id}`}
                        id={`folder-${folder.id}`}
                        disabled={!!searchQuery || selectedTags.length > 0}
                      >
                        <motion.div
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onTouchStart={(e) => {
                            longPressRef.current.triggered = false;
                            longPressRef.current.startY = e.touches[0].clientY;
                            longPressRef.current.timer = setTimeout(() => {
                              longPressRef.current.triggered = true;
                              if (!selectionMode) {
                                setSelectionMode(true);
                                setSelectedIds(new Set([folder.id]));
                              }
                            }, 500);
                          }}
                          onTouchMove={(e) => {
                            if (longPressRef.current.timer) {
                              const dy = Math.abs(
                                e.touches[0].clientY -
                                  (longPressRef.current.startY || 0),
                              );
                              if (dy > 10) {
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
                          onMouseDown={() => {
                            longPressRef.current.triggered = false;
                            longPressRef.current.timer = setTimeout(() => {
                              longPressRef.current.triggered = true;
                              if (!selectionMode) {
                                setSelectionMode(true);
                                setSelectedIds(new Set([folder.id]));
                              }
                            }, 500);
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
                          onClick={(e) => {
                            if (longPressRef.current.triggered) {
                              e.preventDefault();
                              return;
                            }
                            if (selectionMode) {
                              toggleSelection(folder.id);
                            } else {
                              onSelectFolder?.(folder.id);
                            }
                          }}
                          className={
                            viewMode === "list"
                              ? "flex items-center gap-4 p-3 bg-white/5 hover:bg-white/10 rounded-2xl cursor-pointer transition relative group select-none"
                              : "flex flex-col items-center gap-2 cursor-pointer group relative select-none break-inside-avoid"
                          }
                        >
                          {selectionMode && (
                            <div className="absolute top-2 right-2 z-10">
                              <div
                                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                                  selectedIds.has(folder.id)
                                    ? "bg-purple-500 border-purple-500"
                                    : "border-white/40 bg-black/20 backdrop-blur-md"
                                }`}
                              >
                                {selectedIds.has(folder.id) && (
                                  <CheckCircle2 className="w-4 h-4 text-white" />
                                )}
                              </div>
                            </div>
                          )}
                          <div
                            className={
                              viewMode === "list"
                                ? "w-12 h-12 bg-white/10 backdrop-blur-md rounded-xl flex items-center justify-center border border-white/20 shrink-0 overflow-hidden object-cover relative"
                                : "w-full aspect-square bg-white/10 backdrop-blur-md rounded-3xl flex items-center justify-center border border-white/20 group-hover:bg-white/20 transition shadow-sm overflow-hidden relative"
                            }
                          >
                            <FolderCover
                              folder={folder}
                              previews={previews}
                              viewMode={viewMode}
                            />
                          </div>
                          <span
                            className={
                              viewMode === "list"
                                ? "font-medium text-white/90 flex-1"
                                : "text-xs font-medium text-center truncate w-full text-white/80 group-hover:text-white"
                            }
                          >
                            {folder.name}
                          </span>
                        </motion.div>
                      </SortableItemWrapper>
                    );
                  })}
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
                    >
                      <CharacterCardItem
                        char={char}
                        selectionMode={selectionMode}
                        isSelected={selectedIds.has(char.id)}
                        viewMode={viewMode}
                        onClick={() => {
                          if (selectionMode) toggleSelection(char.id);
                          else onSelect(char.id);
                        }}
                        onLongPress={() => {
                          if (!selectionMode) {
                            setSelectionMode(true);
                            setSelectedIds(new Set([char.id]));
                          }
                        }}
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
                    >
                      <CharacterCardItem
                        char={char}
                        selectionMode={selectionMode}
                        isSelected={selectedIds.has(char.id)}
                        viewMode={viewMode}
                        onClick={() => {
                          if (selectionMode) toggleSelection(char.id);
                          else onSelect(char.id);
                        }}
                        onLongPress={() => {
                          if (!selectionMode) {
                            setSelectionMode(true);
                            setSelectedIds(new Set([char.id]));
                          }
                        }}
                      />
                    </SortableItemWrapper>
                  ))}
                </div>
              )}
            </SortableContext>
          </DndContext>

          {!selectionMode && (totalPages > 1 || characters.length > 0) && (
            <div className="flex justify-center items-center mt-12 mb-8 text-sm">
              <div className="flex items-center bg-white/5 rounded-xl p-1 border border-white/10">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-30 transition text-white"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                <div className="flex items-center gap-2 text-slate-400 px-2">
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
                    className="w-10 bg-black/20 border border-white/10 rounded-lg px-1 py-1 text-center text-white font-medium focus:outline-none focus:border-purple-500 transition"
                  />
                  <span>/ {totalPages} 页</span>
                  <div className="w-px h-4 bg-white/10 mx-1" />
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="bg-transparent border-none text-white font-medium focus:outline-none cursor-pointer py-1"
                  >
                    <option value={50} className="bg-slate-800">
                      50/页
                    </option>
                    <option value={100} className="bg-slate-800">
                      100/页
                    </option>
                    <option value={250} className="bg-slate-800">
                      250/页
                    </option>
                    <option value={500} className="bg-slate-800">
                      500/页
                    </option>
                  </select>
                </div>

                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-30 transition text-white"
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
      />

      <BindQRModal
        isOpen={isBindModalOpen}
        onClose={() => setIsBindModalOpen(false)}
        onBind={handleBindQR}
        characters={characters}
        qrChar={
          characters.find((c) => c.id === Array.from(selectedIds)[0]) || null
        }
      />

      <AnimatePresence>
        {showScrollTop && !selectionMode && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={scrollToTop}
            className="fixed bottom-36 right-8 w-12 h-12 bg-slate-800/80 backdrop-blur-md border border-white/10 rounded-full flex items-center justify-center shadow-xl text-white/80 hover:text-white hover:bg-slate-700/80 transition z-40"
          >
            <ChevronLeft className="w-6 h-6 rotate-90" />
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!selectionMode ? (
          <motion.button
            key="fab"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={onImport}
            className="fixed bottom-20 right-8 w-14 h-14 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center shadow-xl shadow-purple-500/30 text-white z-40"
          >
            <Plus className="w-6 h-6" />
          </motion.button>
        ) : (
          <motion.div
            key="bottom-bar"
            initial={{ y: 100, opacity: 0, x: "-50%" }}
            animate={{ y: 0, opacity: 1, x: "-50%" }}
            exit={{ y: 100, opacity: 0, x: "-50%" }}
            className="fixed bottom-8 left-1/2 z-50 max-w-[95vw] sm:max-w-[80vw] bg-slate-800/80 backdrop-blur-2xl border border-white/10 rounded-full shadow-2xl overflow-hidden"
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
              <div className="flex items-center gap-2 no-scrollbar px-1">
                <button
                  onClick={() => setIsMoveModalOpen(true)}
                  disabled={selectedIds.size === 0}
                  className="flex flex-col items-center gap-1 px-4 py-2 rounded-full hover:bg-white/10 text-white/70 hover:text-blue-400 transition disabled:opacity-50 group shrink-0"
                >
                  <div className="p-2 rounded-full bg-white/5 group-hover:bg-blue-400/20 transition">
                    <FolderInput className="w-5 h-5" />
                  </div>
                  <span className="font-medium text-[10px]">移动</span>
                </button>
                {selectedIds.size === 1 &&
                  folders.some((f) => f.id === Array.from(selectedIds)[0]) && (
                    <>
                      <div className="w-px h-8 bg-white/10 shrink-0" />
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
                        className="flex flex-col items-center gap-1 px-4 py-2 rounded-full hover:bg-white/10 text-white/70 hover:text-yellow-400 transition group shrink-0"
                      >
                        <div className="p-2 rounded-full bg-white/5 group-hover:bg-yellow-400/20 transition">
                          <Edit2 className="w-5 h-5" />
                        </div>
                        <span className="font-medium text-[10px]">重命名</span>
                      </button>
                    </>
                  )}
                {selectedIds.size === 1 &&
                  (() => {
                    const charId = Array.from(selectedIds)[0];
                    const char = characters.find((c) => c.id === charId);
                    return char && checkIsQR(char);
                  })() && (
                    <>
                      <div className="w-px h-8 bg-white/10 shrink-0" />
                      <button
                        onClick={() => setIsBindModalOpen(true)}
                        className="flex flex-col items-center gap-1 px-4 py-2 rounded-full hover:bg-white/10 text-white/70 hover:text-purple-400 transition group shrink-0"
                      >
                        <div className="p-2 rounded-full bg-white/5 group-hover:bg-purple-400/20 transition">
                          <Link className="w-5 h-5" />
                        </div>
                        <span className="font-medium text-[10px]">绑定</span>
                      </button>
                    </>
                  )}

                {selectedIds.size > 0 &&
                  Array.from(selectedIds).every((id) =>
                    folders.some((f) => f.id === id),
                  ) && (
                    <>
                      <div className="w-px h-8 bg-white/10 shrink-0" />
                      <button
                        onClick={() => coverInputRef.current?.click()}
                        disabled={selectedIds.size === 0}
                        className="flex flex-col items-center gap-1 px-4 py-2 rounded-full hover:bg-white/10 text-white/70 hover:text-orange-400 transition disabled:opacity-50 group shrink-0"
                      >
                        <div className="p-2 rounded-full bg-white/5 group-hover:bg-orange-400/20 transition">
                          <ImageIcon className="w-5 h-5" />
                        </div>
                        <span className="font-medium text-[10px]">换封面</span>
                      </button>
                    </>
                  )}

                <div className="w-px h-8 bg-white/10 shrink-0" />
                <button
                  onClick={handleBatchCloudBackup}
                  disabled={selectedIds.size === 0}
                  className="flex flex-col items-center gap-1 px-4 py-2 rounded-full hover:bg-blue-500/10 text-white/70 hover:text-blue-400 transition disabled:opacity-50 group shrink-0"
                >
                  <div className="p-2 rounded-full bg-white/5 group-hover:bg-blue-400/20 transition">
                    <Cloud className="w-5 h-5" />
                  </div>
                  <span className="font-medium text-[10px]">传云盘</span>
                </button>
                <div className="w-px h-8 bg-white/10 shrink-0" />
                <button
                  onClick={() => handleBatchExport()}
                  disabled={selectedIds.size === 0}
                  className="flex flex-col items-center gap-1 px-4 py-2 rounded-full hover:bg-white/10 text-white/70 hover:text-green-400 transition disabled:opacity-50 group shrink-0"
                >
                  <div className="p-2 rounded-full bg-white/5 group-hover:bg-green-400/20 transition">
                    <Download className="w-5 h-5" />
                  </div>
                  <span className="font-medium text-[10px]">导出</span>
                </button>
                <div className="w-px h-8 bg-white/10 shrink-0" />
                <button
                  onClick={handleBatchDelete}
                  disabled={selectedIds.size === 0}
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

      <AnimatePresence>
        {progress && (
          <motion.div
            initial={{ opacity: 0, y: -50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -50, x: '-50%' }}
            className="fixed top-12 sm:top-20 left-1/2 z-[200] bg-slate-800/90 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl p-3 sm:p-4 w-[90%] max-w-[16rem] sm:w-72 pointer-events-auto"
          >
            <div className="flex items-center gap-3 mb-2">
              <Loader2 className="w-5 h-5 text-blue-400 animate-spin shrink-0" />
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-white truncate">
                  正在处理
                </h4>
                <p className="text-xs text-white/50 truncate">
                  {progress.message}
                </p>
              </div>
              <span className="text-xs font-medium text-blue-400/80 shrink-0">
                {progress.total > 0
                  ? Math.round((progress.current / progress.total) * 100)
                  : 0}%
              </span>
            </div>
            <div className="w-full bg-black/40 rounded-full h-1.5 overflow-hidden relative">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-300 relative"
                style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
              >
                <div className="absolute inset-0 bg-white/20 animate-pulse" />
              </div>
            </div>
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
              className="bg-slate-800/90 backdrop-blur-2xl rounded-3xl p-6 w-full max-w-sm border border-white/10 shadow-2xl"
            >
              <h3 className="text-lg font-semibold text-white mb-6 text-center">
                {editingFolder ? "编辑文件夹" : "新建文件夹"}
              </h3>
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="文件夹名称"
                className="w-full bg-black/20 border border-white/10 rounded-2xl px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:border-purple-500/50 transition mb-6 text-center text-lg"
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
                  onClick={
                    editingFolder ? handleUpdateFolder : handleCreateFolder
                  }
                  className="w-full py-3 rounded-2xl bg-purple-500/80 hover:bg-purple-500 text-white font-medium transition"
                >
                  {editingFolder ? "保存修改" : "创建"}
                </button>
                {editingFolder && (
                  <button
                    onClick={() => {
                      handleDeleteFolder(editingFolder.id, editingFolder.name);
                      setIsCreatingFolder(false);
                      setEditingFolder(null);
                    }}
                    className="w-full py-3 rounded-2xl bg-red-500/10 hover:bg-red-500/20 text-red-400 font-medium transition"
                  >
                    删除文件夹
                  </button>
                )}
                <button
                  onClick={() => {
                    setIsCreatingFolder(false);
                    setEditingFolder(null);
                  }}
                  className="w-full py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-white/70 font-medium transition mt-2"
                >
                  取消
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {imageToCrop && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-xl flex flex-col shadow-2xl overflow-hidden h-[70vh] max-h-[800px]">
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
              <h3 className="text-lg font-bold text-white">调整封面图片</h3>

              <button
                onClick={closeCrop}
                className="p-1 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition hidden sm:block"
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
                cropShape="rect"
                showGrid={true}
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

              <div className="flex items-center gap-2">
                <button
                  onClick={closeCrop}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/80 font-medium rounded-xl transition sm:hidden"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveCrop}
                  className="px-6 py-2 bg-purple-500 hover:bg-purple-600 text-white font-bold rounded-xl transition"
                >
                  保存封面
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CharacterCardItem = React.memo(function CharacterCardItem({
  char,
  onClick,
  onLongPress,
  selectionMode,
  isSelected,
  viewMode,
}: {
  key?: React.Key;
  char: CharacterCard;
  onClick: () => void;
  onLongPress: () => void;
  selectionMode: boolean;
  isSelected: boolean;
  viewMode: "grid" | "list" | "masonry";
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

  const handleTouchStart = () => {
    isLongPress.current = false;
    timerRef.current = setTimeout(() => {
      isLongPress.current = true;
      onLongPress();
    }, 500); // 500ms for long press
  };

  const handleTouchEnd = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isLongPress.current) {
      e.preventDefault();
      return;
    }
    onClick();
  };

  const charTags = (char as any).tags || char.data?.data?.tags || char.data?.tags;
  const hasTags = charTags && Array.isArray(charTags) && charTags.length > 0;

  if (viewMode === "list") {
    return (
      <motion.div
        ref={cardRef}
        whileHover={{ scale: selectionMode ? 1 : 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
        onMouseDown={handleTouchStart}
        onMouseUp={handleTouchEnd}
        onMouseLeave={handleTouchEnd}
        className={`relative flex items-center gap-4 p-3 rounded-2xl cursor-pointer transition-all select-none ${isSelected ? "bg-purple-500/20 border-purple-500/50" : "bg-white/5 hover:bg-white/10 border-transparent"} border`}
      >
        <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0">
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
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-white/90 truncate">{char.name}</h3>
            {hasTags && (
              <div className="flex gap-1 overflow-hidden shrink-0">
                {charTags.slice(0, 3).map((t: string) => (
                  <span
                    key={t}
                    className="text-[9px] bg-slate-500/20 text-slate-400 px-1.5 py-0.5 rounded-sm flex-shrink-0 whitespace-nowrap"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {char.data?.creator && (
              <p className="text-xs text-slate-500 truncate">
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

        <AnimatePresence>
          {selectionMode && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="shrink-0"
            >
              {isSelected ? (
                <div className="bg-purple-500 rounded-full text-white shadow-lg">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
              ) : (
                <div className="bg-black/40 rounded-full border-2 border-white/60 w-6 h-6 shadow-sm" />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  return (
    <motion.div
      ref={cardRef}
      whileHover={{ scale: selectionMode ? 1 : 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
      onMouseDown={handleTouchStart}
      onMouseUp={handleTouchEnd}
      onMouseLeave={handleTouchEnd}
      className={`relative ${viewMode === "masonry" ? "w-full h-auto min-h-[150px] bg-white/5" : "aspect-[2/3]"} rounded-2xl overflow-hidden cursor-pointer shadow-lg border transition-all duration-300 group select-none ${isSelected ? "border-purple-500 ring-2 ring-purple-500" : "border-white/10"}`}
    >
      <motion.img
        animate={{ scale: isSelected ? 0.9 : 1 }}
        transition={{ duration: 0.2 }}
        src={url || undefined}
        alt={char.name}
        className={`w-full ${viewMode === "masonry" ? "h-auto block" : "h-full"} object-cover pointer-events-none`}
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
      <div className="absolute inset-0 bg-gradient-to-t from-[var(--overlay-bottom)] via-[var(--overlay-mid)] to-transparent flex flex-col justify-end p-3 pointer-events-none">
        <h3 className="font-semibold text-[#ffffff] text-sm sm:text-base leading-tight drop-shadow-md break-words truncate">
          {char.name}
        </h3>
        {hasTags && (
          <div className="flex flex-wrap gap-1 mt-1.5 h-[1.125rem] overflow-hidden -mr-1">
            {charTags.map((t: string) => (
              <span
                key={t}
                className="text-[9px] bg-[#000000]/40 backdrop-blur-md text-[#ffffff] px-1 py-0.5 rounded-sm truncate max-w-[60px]"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        {/* <div className="flex items-center gap-1 mt-1.5">
          {char.autoImportFilename && (
            <span className="text-[9px] text-[#ffffff]/60 truncate shrink">
              {char.autoImportFilename}
            </span>
          )}
        </div> */}
      </div>

      <AnimatePresence>
        {selectionMode && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="absolute top-2 right-2 z-10"
          >
            {isSelected ? (
              <div className="bg-purple-500 rounded-full text-white shadow-lg">
                <CheckCircle2 className="w-6 h-6" />
              </div>
            ) : (
              <div className="bg-black/40 rounded-full border-2 border-white/60 w-6 h-6 shadow-sm" />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
);
