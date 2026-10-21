import React, { useState, useEffect, useMemo } from "react";
import { Folder } from "../lib/db";
import { getFallbackAvatar, isFallbackMiuImage, safeCreateObjectURL } from "../lib/avatar";
import { Folder as FolderIcon, Sparkles, Plus } from "lucide-react";

export interface FolderPreviewItem {
  url: string;
  seed?: string;
  tags?: string[];
  isTool?: boolean;
}

interface Props {
  folder: Folder;
  previews?: (FolderPreviewItem | string)[];
  viewMode?: "grid" | "list" | "masonry";
  className?: string;
  isSelected?: boolean;
}

export const FrostedFolderCover = React.memo(function FrostedFolderCover({
  folder,
  previews = [],
  viewMode = "grid",
  className = "",
  isSelected = false,
}: Props) {
  const [customAvatarUrl, setCustomAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    if (folder.avatarBlob) {
      const objectUrl = safeCreateObjectURL(folder.avatarBlob);
      setCustomAvatarUrl(objectUrl);
      return () => {
        if (objectUrl && objectUrl.startsWith('blob:')) {
          URL.revokeObjectURL(objectUrl);
        }
      };
    } else {
      setCustomAvatarUrl(null);
    }
  }, [folder.avatarBlob]);

  // Normalize previews into standard items with memoization
  const items: FolderPreviewItem[] = useMemo(() => {
    // 过滤与排序预览项：优先真正的角色卡（非工具，非机器人 SVG）
    const sortedPreviews = (previews || []).slice().sort((a, b) => {
      const aIsTool = typeof a === "object" ? Boolean(a?.isTool) : false;
      const bIsTool = typeof b === "object" ? Boolean(b?.isTool) : false;
      if (aIsTool !== bIsTool) return aIsTool ? 1 : -1;

      const aUrl = typeof a === "string" ? a : a?.url;
      const bUrl = typeof b === "string" ? b : b?.url;
      const aSvg = !aUrl || aUrl.startsWith('data:image/svg+xml');
      const bSvg = !bUrl || bUrl.startsWith('data:image/svg+xml');
      if (aSvg !== bSvg) return aSvg ? 1 : -1;

      return 0;
    });

    const isCustomSvg = customAvatarUrl && customAvatarUrl.startsWith('data:image/svg+xml');

    if (customAvatarUrl && !isCustomSvg) {
      const list: FolderPreviewItem[] = [{ url: customAvatarUrl, seed: folder.id }];
      if (sortedPreviews && sortedPreviews.length > 0) {
        const backPreview = sortedPreviews.find((p) => {
          const urlStr = typeof p === "string" ? p : p?.url;
          return urlStr && urlStr !== customAvatarUrl;
        }) || sortedPreviews[0];

        if (backPreview) {
          const urlStr = typeof backPreview === "string" ? backPreview : backPreview.url;
          const seedStr = typeof backPreview === "string" ? `${folder.id}-back` : backPreview.seed || `${folder.id}-back`;
          list.push({
            url: urlStr,
            seed: seedStr,
            tags: typeof backPreview === "object" ? backPreview.tags : undefined,
            isTool: typeof backPreview === "object" ? backPreview.isTool : undefined,
          });
        }
      }
      return list;
    }
    return sortedPreviews.slice(0, 2).map((p, idx) => {
      if (typeof p === "string") {
        return { url: p, seed: `${folder.id}-${idx}` };
      }
      return p;
    });
  }, [customAvatarUrl, previews, folder.id]);

  if (viewMode === "list") {
    return (
      <div
        className={`w-12 h-12 relative flex items-center justify-center shrink-0 select-none ${className}`}
      >
        {items.length > 0 ? (
          <div className="relative w-10 h-11 flex items-center justify-center">
            {/* Back Card - 2nd image preview when available */}
            {items.length >= 2 && (
              <div
                className="absolute w-8 h-10 rounded-lg overflow-hidden shadow-xs border-0 outline-none"
                style={{ transform: "rotate(-5deg) translateX(-3px)", willChange: "transform" }}
              >
                <img
                  src={items[1].url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className={`w-full h-full pointer-events-none ${
                    isFallbackMiuImage(items[1].url)
                      ? 'object-contain p-1 bg-white'
                      : 'object-cover'
                  }`}
                  onError={(e) => {
                    if (items[1]?.seed) {
                      const category = items[1].tags?.join(",") || (items[1].isTool ? "tool" : undefined);
                      e.currentTarget.src = getFallbackAvatar(items[1].seed, category);
                    }
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent [.light-theme_&]:from-black/50 [.light-theme_&]:via-black/15 [.light-theme_&]:to-transparent pointer-events-none rounded-lg" />
              </div>
            )}
            {/* Front Card */}
            <div
              className={`absolute w-8 h-10 rounded-lg overflow-hidden shadow-xs border-0 outline-none ${
                items.length >= 2 ? "" : ""
              }`}
              style={{
                transform: items.length >= 2 ? "rotate(3deg) translateX(3px)" : "none",
                willChange: "transform",
              }}
            >
              <img
                src={items[0].url}
                alt=""
                loading="lazy"
                decoding="async"
                className={`w-full h-full pointer-events-none ${
                  isFallbackMiuImage(items[0].url)
                    ? 'object-contain p-1 bg-white'
                    : 'object-cover'
                }`}
                onError={(e) => {
                  if (items[0]?.seed) {
                    const category = items[0].tags?.join(",") || (items[0].isTool ? "tool" : undefined);
                    e.currentTarget.src = getFallbackAvatar(items[0].seed, category);
                  }
                }}
              />
            </div>
          </div>
        ) : (
          <div className="relative w-10 h-11 flex items-center justify-center">
            <div
              className="absolute w-8 h-10 rounded-lg border border-dashed border-white/15 [.light-theme_&]:!border-[#cbd5e1] bg-white/5"
              style={{ transform: "rotate(-5deg) translateX(-3px)" }}
            />
            <div
              className="absolute w-8 h-10 rounded-lg border border-dashed border-white/20 [.light-theme_&]:!border-[#cbd5e1] bg-white/10 flex items-center justify-center text-white/40 shadow-xs"
              style={{ transform: "rotate(3deg) translateX(3px)" }}
            >
              <FolderIcon className="w-3.5 h-3.5 text-blue-400 [.light-theme_&]:!text-[#007aff]" />
            </div>
          </div>
        )}
        {isSelected && (
          <div className="absolute inset-0 bg-black/45 rounded-xl pointer-events-none z-20 transition-opacity" />
        )}
      </div>
    );
  }

  // Grid & Masonry View: 2-Card Stack Artwork matching single card dimensions exactly
  const hasBackCard = items.length >= 2;
  const hasFrontCard = items.length >= 1;

  return (
    <div
      className={`relative w-full aspect-[2/3] select-none group flex items-center justify-center ${className}`}
    >
      <div className="relative w-full h-full flex items-center justify-center transform-gpu">
        {/* 1. Back Layer (Rendered when 2nd card preview exists, subtly peeking from top-left) */}
        {hasBackCard && (
          <div
            className="absolute w-full h-full rounded-2xl overflow-hidden shadow-xs border-0 outline-none transition-transform duration-300 origin-bottom-left group-hover:-rotate-3 group-hover:-translate-x-0.5"
            style={{
              transform: "rotate(-2deg) translate(-2px, -1px)",
              zIndex: 1,
              willChange: "transform",
            }}
          >
            <img
              src={items[1].url}
              alt=""
              loading="lazy"
              decoding="async"
              className={`w-full h-full pointer-events-none transition-all duration-300 ${
                isFallbackMiuImage(items[1].url)
                  ? 'object-contain p-4 bg-white'
                  : 'object-cover'
              }`}
              onError={(e) => {
                if (items[1]?.seed) {
                  const category = items[1].tags?.join(",") || (items[1].isTool ? "tool" : undefined);
                  e.currentTarget.src = getFallbackAvatar(items[1].seed, category);
                }
              }}
            />
            {/* 卡片同款渐变沉浸遮罩 (底部渐变过渡, 拒绝呆板实色) */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent [.light-theme_&]:from-black/50 [.light-theme_&]:via-black/20 [.light-theme_&]:to-transparent pointer-events-none rounded-2xl transition-opacity" />
            {isSelected && (
              <div className="absolute inset-0 bg-black/45 rounded-2xl pointer-events-none z-10 transition-opacity" />
            )}
          </div>
        )}

        {/* 2. Front Layer (Full-size Main Card identical to single character card size) */}
        <div
          className="absolute w-full h-full rounded-2xl overflow-hidden shadow-sm border-0 outline-none transition-all duration-300 group-hover:scale-[1.01] group-hover:-translate-y-0.5"
          style={{ zIndex: 2, willChange: "transform" }}
        >
          {hasFrontCard ? (
            <img
              src={items[0].url}
              alt=""
              loading="lazy"
              decoding="async"
              className={`w-full h-full pointer-events-none ${
                isFallbackMiuImage(items[0].url)
                  ? 'object-contain p-4 bg-white'
                  : 'object-cover'
              }`}
              onError={(e) => {
                if (items[0]?.seed) {
                  const category = items[0].tags?.join(",") || (items[0].isTool ? "tool" : undefined);
                  e.currentTarget.src = getFallbackAvatar(items[0].seed, category);
                }
              }}
            />
          ) : (
            /* Empty Card Background */
            <div className="w-full h-full rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xs flex flex-col items-center justify-center p-2 text-center text-white/40 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-slate-400">
              <FolderIcon className="w-4.5 h-4.5 sm:w-6 sm:h-6 opacity-45 mb-1 shrink-0 [.light-theme_&]:!text-[#007aff]" />
              <span className="text-[10px] sm:text-xs font-medium tracking-wide opacity-80 select-none">空文件夹</span>
            </div>
          )}
          {isSelected && (
            <div className="absolute inset-0 bg-black/45 rounded-2xl pointer-events-none z-10 transition-opacity" />
          )}
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  if (prevProps.isSelected !== nextProps.isSelected) return false;
  if (prevProps.viewMode !== nextProps.viewMode) return false;
  if (prevProps.className !== nextProps.className) return false;
  if (prevProps.folder.id !== nextProps.folder.id) return false;
  if (prevProps.folder.name !== nextProps.folder.name) return false;
  if (prevProps.folder.avatarBlob !== nextProps.folder.avatarBlob) return false;

  const p1 = prevProps.previews || [];
  const p2 = nextProps.previews || [];
  if (p1.length !== p2.length) return false;
  for (let i = 0; i < p1.length; i++) {
    const u1 = typeof p1[i] === "string" ? p1[i] : (p1[i] as any)?.url;
    const u2 = typeof p2[i] === "string" ? p2[i] : (p2[i] as any)?.url;
    if (u1 !== u2) return false;
  }

  return true;
});

/**
 * Matching Full-Size 2-Card Stack "New Folder" Component
 */
export const FrostedNewFolderCover = React.memo(function FrostedNewFolderCover({
  viewMode = "grid",
}: {
  viewMode?: "grid" | "list" | "masonry";
}) {
  if (viewMode === "list") {
    return (
      <div className="w-10 h-10 rounded-lg bg-white/[0.04] border border-dashed border-white/25 flex items-center justify-center shrink-0">
        <Plus className="w-4 h-4 text-white/50" />
      </div>
    );
  }

  return (
    <div
      className="relative w-full aspect-[2/3] select-none group cursor-pointer flex items-center justify-center"
    >
      <div className="relative w-full h-full flex items-center justify-center transform-gpu">
        {/* Back Ghost Card */}
        <div
          className="absolute w-full h-full rounded-2xl border-2 border-dashed border-white/20 bg-white/[0.04] transition-transform duration-300 origin-bottom-left group-hover:-rotate-3 group-hover:-translate-x-0.5"
          style={{
            transform: "rotate(-2deg) translate(-2px, -1px)",
            zIndex: 1,
            willChange: "transform",
          }}
        />
        {/* Front Ghost Card */}
        <div
          className="absolute w-full h-full rounded-2xl border-2 border-dashed border-white/25 bg-white/[0.04] backdrop-blur-xs flex flex-col items-center justify-center p-2 text-center transition-all duration-300 group-hover:border-blue-400/50 group-hover:bg-blue-500/10 group-hover:scale-[1.01] group-hover:-translate-y-0.5 shadow-lg text-white/40"
          style={{ zIndex: 2, willChange: "transform" }}
        >
          <Plus className="w-4.5 h-4.5 sm:w-6 sm:h-6 opacity-50 mb-1 group-hover:scale-110 group-hover:text-blue-300 [.light-theme_&]:group-hover:!text-blue-600 transition-all shrink-0" />
          <span className="text-[10px] sm:text-xs font-medium tracking-wide text-white/50 group-hover:text-blue-300 [.light-theme_&]:group-hover:!text-blue-600 transition-colors select-none">新建</span>
        </div>
      </div>
    </div>
  );
});
