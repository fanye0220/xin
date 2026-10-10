import React, { useState, useEffect, useMemo } from "react";
import { Folder } from "../lib/db";
import { getFallbackAvatar, safeCreateObjectURL } from "../lib/avatar";
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
    if (customAvatarUrl) {
      const list: FolderPreviewItem[] = [{ url: customAvatarUrl, seed: folder.id }];
      if (previews && previews.length > 0) {
        const backPreview = previews.find((p) => {
          const urlStr = typeof p === "string" ? p : p?.url;
          return urlStr && urlStr !== customAvatarUrl;
        }) || previews[0];

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
    return (previews || []).slice(0, 2).map((p, idx) => {
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
                  className="w-full h-full object-cover pointer-events-none"
                  onError={(e) => {
                    if (items[1]?.seed) {
                      const category = items[1].tags?.join(",") || (items[1].isTool ? "tool" : undefined);
                      e.currentTarget.src = getFallbackAvatar(items[1].seed, category);
                    }
                  }}
                />
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
                className="w-full h-full object-cover pointer-events-none"
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

  // Grid & Masonry View: 2-Card Stack Artwork with zero borders or black outlines
  const hasBackCard = items.length >= 2;
  const hasFrontCard = items.length >= 1;

  return (
    <div
      className={`relative w-full aspect-[2/3] select-none group flex items-center justify-center p-1.5 ${className}`}
    >
      <div className="relative w-full h-full flex items-center justify-center transform-gpu">
        {/* 1. Back Layer (Rendered when 2nd card preview exists, no black overlay or border) */}
        {hasBackCard && (
          <div
            className="absolute w-[94%] h-[95%] rounded-2xl overflow-hidden shadow-xs border-0 outline-none transition-transform duration-300 origin-bottom-left group-hover:-rotate-6 group-hover:-translate-x-1"
            style={{
              transform: "rotate(-3.5deg) translate(-2.5px, 2px)",
              zIndex: 1,
              willChange: "transform",
            }}
          >
            <img
              src={items[1].url}
              alt=""
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover pointer-events-none"
              onError={(e) => {
                if (items[1]?.seed) {
                  const category = items[1].tags?.join(",") || (items[1].isTool ? "tool" : undefined);
                  e.currentTarget.src = getFallbackAvatar(items[1].seed, category);
                }
              }}
            />
            {isSelected && (
              <div className="absolute inset-0 bg-black/45 rounded-2xl pointer-events-none z-10 transition-opacity" />
            )}
          </div>
        )}

        {/* 2. Front Layer (Main Front Card with Image, zero border or black outline) */}
        <div
          className="absolute w-[94%] h-[95%] rounded-2xl overflow-hidden shadow-sm border-0 outline-none transition-all duration-300 group-hover:scale-[1.02] group-hover:-translate-y-1"
          style={{ zIndex: 2, willChange: "transform" }}
        >
          {hasFrontCard ? (
            <img
              src={items[0].url}
              alt=""
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover pointer-events-none"
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
      className="relative w-full aspect-[2/3] select-none group cursor-pointer flex items-center justify-center p-1.5"
    >
      <div className="relative w-full h-full flex items-center justify-center transform-gpu">
        {/* Back Ghost Card */}
        <div
          className="absolute w-[94%] h-[95%] rounded-2xl border-2 border-dashed border-white/20 bg-white/[0.04] transition-transform duration-300 origin-bottom-left group-hover:-rotate-6 group-hover:-translate-x-1"
          style={{
            transform: "rotate(-3.5deg) translate(-2.5px, 2px)",
            zIndex: 1,
            willChange: "transform",
          }}
        />
        {/* Front Ghost Card */}
        <div
          className="absolute w-[94%] h-[95%] rounded-2xl border-2 border-dashed border-white/25 bg-white/[0.04] backdrop-blur-xs flex flex-col items-center justify-center p-2 text-center transition-all duration-300 group-hover:border-blue-400/50 group-hover:bg-blue-500/10 group-hover:scale-[1.02] group-hover:-translate-y-1 shadow-lg text-white/40"
          style={{ zIndex: 2, willChange: "transform" }}
        >
          <Plus className="w-4.5 h-4.5 sm:w-6 sm:h-6 opacity-50 mb-1 group-hover:scale-110 group-hover:text-blue-300 [.light-theme_&]:group-hover:!text-blue-600 transition-all shrink-0" />
          <span className="text-[10px] sm:text-xs font-medium tracking-wide text-white/50 group-hover:text-blue-300 [.light-theme_&]:group-hover:!text-blue-600 transition-colors select-none">新建</span>
        </div>
      </div>
    </div>
  );
});
