import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Image as ImageIcon, Sparkles, Upload, RotateCcw, Loader2, Search } from "lucide-react";
import { Folder, CharacterCard, getCharacters, getCharacterThumb, getCharacterBlob } from "../lib/db";
import { getFallbackAvatar, resolveAvatarUrl } from "../lib/avatar";
import { peekCachedUrl, putCachedBlobUrl } from "../lib/thumbCache";
import { useBackHandler } from "../lib/useBackHandler";

interface Props {
  isOpen: boolean;
  folder: Folder | null;
  onClose: () => void;
  onSelectCharacterCover: (char: CharacterCard) => void;
  onUploadCustomImage: () => void;
  onResetCover: () => void;
}

// Memoized individual item for optimal grid performance
const CoverPickerItem = React.memo(function CoverPickerItem({
  char,
  onSelect,
}: {
  char: CharacterCard;
  onSelect: (char: CharacterCard) => void;
}) {
  const defaultFallback = getFallbackAvatar(
    char.name || char.id,
    char.tags?.join(",") || (char.isTool ? "tool" : undefined),
  );
  const initialUrl = resolveAvatarUrl(
    char.avatarUrlFallback,
    char.name || char.id,
    char.tags?.join(",") || (char.isTool ? "tool" : undefined),
  );
  const [url, setUrl] = useState<string>(initialUrl);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (char.avatarBlob) {
      const objUrl = URL.createObjectURL(char.avatarBlob);
      blobUrlRef.current = objUrl;
      setUrl(objUrl);
    } else if (char.hasBlobsSeparated) {
      const thumbKey = `${char.id}:${char.updatedAt || 0}`;
      const cached = peekCachedUrl(thumbKey);
      if (cached) {
        setUrl(cached);
      } else {
        getCharacterThumb(char.id).then((thumbBlob) => {
          if (thumbBlob && isMounted) {
            const cachedUrl = putCachedBlobUrl(thumbKey, thumbBlob);
            setUrl(cachedUrl);
          }
        });
      }
    }

    return () => {
      isMounted = false;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
    };
  }, [char.id, char.avatarBlob, char.hasBlobsSeparated, char.updatedAt]);

  return (
    <motion.div
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      onClick={() => onSelect(char)}
      className="group flex flex-col items-center cursor-pointer select-none"
    >
      <div className="w-full aspect-[2/3] rounded-xl overflow-hidden bg-slate-800 border border-white/15 shadow-md group-hover:border-purple-400 group-hover:shadow-purple-500/20 group-hover:shadow-lg transition-all relative">
        <img
          src={url}
          alt={char.name}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover pointer-events-none"
          onError={(e) => {
            e.currentTarget.src = defaultFallback;
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-1.5 opacity-90 group-hover:opacity-100 transition">
          <span className="text-[11px] font-medium text-white truncate w-full">
            {char.name}
          </span>
        </div>
      </div>
    </motion.div>
  );
});

export function FolderCoverPickerModal({
  isOpen,
  folder,
  onClose,
  onSelectCharacterCover,
  onUploadCustomImage,
  onResetCover,
}: Props) {
  const [characters, setCharacters] = useState<CharacterCard[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState("");

  useBackHandler(isOpen, () => {
    onClose();
    return true;
  });

  useEffect(() => {
    if (isOpen && folder) {
      setIsLoading(true);
      setSearch("");
      // Fetch characters belonging to this folder (paginated chunk to protect memory)
      getCharacters(1, 200, folder.id, "", [], "newest_import", true, false)
        .then(({ characters: chars }) => {
          setCharacters(chars);
        })
        .catch((err) => {
          console.error("Failed to load folder characters for cover picker:", err);
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      setCharacters([]);
    }
  }, [isOpen, folder]);

  const filteredCharacters = useMemo(() => {
    if (!search.trim()) return characters;
    const query = search.toLowerCase().trim();
    return characters.filter(
      (c) =>
        c.name?.toLowerCase().includes(query) ||
        c.tags?.some((t) => t.toLowerCase().includes(query)),
    );
  }, [characters, search]);

  if (!isOpen || !folder) return null;

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
        onClick={onClose}
        onTouchStart={(e) => e.stopPropagation()}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-lg flex flex-col shadow-2xl overflow-hidden max-h-[85vh]"
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-purple-400" />
                <span>更换文件夹封面</span>
              </h3>
              <p className="text-xs text-white/50 mt-0.5">
                当前文件夹: <span className="text-purple-300 font-medium">{folder.name}</span>
              </p>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Action Bar (Upload or Reset) */}
          <div className="p-3 bg-black/20 border-b border-white/5 flex items-center gap-2 overflow-x-auto">
            <button
              onClick={() => {
                onClose();
                onUploadCustomImage();
              }}
              className="flex-1 min-w-[130px] flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 font-medium text-xs transition"
            >
              <Upload className="w-4 h-4" />
              <span>上传本地图片</span>
            </button>

            {folder.avatarBlob && (
              <button
                onClick={() => {
                  onResetCover();
                  onClose();
                }}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/10 font-medium text-xs transition shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>恢复默认预览</span>
              </button>
            )}
          </div>

          {/* Search bar inside picker if many cards */}
          {characters.length > 8 && (
            <div className="px-4 pt-3 pb-1">
              <div className="relative w-full">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索文件夹内的卡片名称..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-purple-400/50"
                />
              </div>
            </div>
          )}

          {/* Folder Characters Selection Grid */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-white/70">
                从文件夹内的卡片中选择 ({filteredCharacters.length})
              </span>
              <span className="text-[11px] text-white/40">点击直接设为封面</span>
            </div>

            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-16 text-white/40">
                <Loader2 className="w-8 h-8 animate-spin text-purple-400 mb-2" />
                <span className="text-xs">加载角色卡片中...</span>
              </div>
            ) : filteredCharacters.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-white/40 bg-white/[0.02] rounded-2xl border border-dashed border-white/10">
                <Sparkles className="w-8 h-8 opacity-30 mb-2" />
                <p className="text-xs">
                  {characters.length === 0 ? "该文件夹内暂无角色卡片" : "未搜索到匹配的卡片"}
                </p>
                <p className="text-[10px] text-white/30 mt-1">您可以点击上方“上传本地图片”为文件夹设定封面</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {filteredCharacters.map((char) => (
                  <CoverPickerItem
                    key={char.id}
                    char={char}
                    onSelect={(selectedChar) => {
                      onSelectCharacterCover(selectedChar);
                      onClose();
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-white/10 bg-white/[0.02] flex items-center justify-end">
            <button
              onClick={onClose}
              className="px-5 py-2 bg-white/5 hover:bg-white/10 text-white/70 font-medium rounded-xl text-xs transition"
            >
              取消
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
