import React, { useState, useEffect, useMemo } from "react";
import { Folder } from "../lib/db";
import { getFallbackAvatar } from "../lib/avatar";
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
}

export const FrostedFolderCover = React.memo(function FrostedFolderCover({
  folder,
  previews = [],
  viewMode = "grid",
  className = "",
}: Props) {
  const [customAvatarUrl, setCustomAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    if (folder.avatarBlob) {
      const objectUrl = URL.createObjectURL(folder.avatarBlob);
      setCustomAvatarUrl(objectUrl);
      return () => {
        URL.revokeObjectURL(objectUrl);
      };
    } else {
      setCustomAvatarUrl(null);
    }
  }, [folder.avatarBlob]);

  // Normalize previews into standard items with memoization
  const items: FolderPreviewItem[] = useMemo(() => {
    if (customAvatarUrl) {
      return [{ url: customAvatarUrl, seed: folder.id }];
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
            {/* Back Card */}
            <div
              className="absolute w-8 h-10 rounded-lg overflow-hidden shadow-sm border border-white/20 bg-slate-800"
              style={{ transform: "rotate(-5deg) translateX(-3px)", willChange: "transform" }}
            >
              <img
                src={items[1]?.url || items[0].url}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover pointer-events-none opacity-80"
                onError={(e) => {
                  const target = items[1] || items[0];
                  if (target?.seed) {
                    const category = target.tags?.join(",") || (target.isTool ? "tool" : undefined);
                    e.currentTarget.src = getFallbackAvatar(target.seed, category);
                  }
                }}
              />
            </div>
            {/* Front Card */}
            <div
              className="absolute w-8 h-10 rounded-lg overflow-hidden shadow-md border border-white/35 bg-slate-800"
              style={{ transform: "rotate(3deg) translateX(3px)", willChange: "transform" }}
            >
              <img
                src={items[0].url}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover pointer-events-none"
                onError={(e) => {
                  if (items[0].seed) {
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
              className="absolute w-8 h-10 rounded-lg border border-dashed border-white/20 bg-white/5"
              style={{ transform: "rotate(-5deg) translateX(-3px)" }}
            />
            <div
              className="absolute w-8 h-10 rounded-lg border border-dashed border-white/35 bg-white/10 flex items-center justify-center text-white/40 shadow-sm"
              style={{ transform: "rotate(3deg) translateX(3px)" }}
            >
              <FolderIcon className="w-3.5 h-3.5 text-blue-400" />
            </div>
          </div>
        )}
      </div>
    );
  }

  // Grid & Masonry View: Pure 2-Card Stack Artwork with GPU-accelerated transforms
  const hasBackCard = items.length >= 2;
  const hasFrontCard = items.length >= 1;

  return (
    <div
      className={`relative w-full ${viewMode === "masonry" ? "h-[200px] min-h-[160px]" : "aspect-[2/3]"} select-none group flex items-center justify-center p-1.5 ${className}`}
    >
      <div className="relative w-full h-full flex items-center justify-center transform-gpu">
        {/* 1. Back Layer (Tilted 2nd Card / Ghost Silhouette) */}
        <div
          className="absolute w-[94%] h-[95%] rounded-2xl overflow-hidden shadow-md transition-transform duration-300 origin-bottom-left group-hover:-rotate-6 group-hover:-translate-x-1"
          style={{
            transform: "rotate(-3.5deg) translate(-2.5px, 2px)",
            zIndex: 1,
            willChange: "transform",
          }}
        >
          {hasBackCard ? (
            <>
              <img
                src={items[1].url}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover pointer-events-none opacity-80"
                onError={(e) => {
                  if (items[1]?.seed) {
                    const category = items[1].tags?.join(",") || (items[1].isTool ? "tool" : undefined);
                    e.currentTarget.src = getFallbackAvatar(items[1].seed, category);
                  }
                }}
              />
              <div className="absolute inset-0 bg-black/35 border border-white/20 rounded-2xl" />
            </>
          ) : (
            /* Ghost Silhouette Frame */
            <div className="w-full h-full rounded-2xl border-2 border-dashed border-white/20 bg-white/[0.04]" />
          )}
        </div>

        {/* 2. Front Layer (Main Front Card with Image) */}
        <div
          className="absolute w-[94%] h-[95%] rounded-2xl overflow-hidden shadow-lg border border-white/20 bg-slate-800 transition-all duration-300 group-hover:scale-[1.02] group-hover:-translate-y-1 group-hover:border-white/40"
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
            <div className="w-full h-full rounded-2xl border-2 border-dashed border-white/25 bg-white/[0.04] backdrop-blur-xs flex flex-col items-center justify-center text-white/40">
              <Sparkles className="w-7 h-7 opacity-50 mb-1.5 group-hover:scale-110 group-hover:text-purple-300 transition-all" />
              <span className="text-[11px] font-medium tracking-wide text-white/50">无封面</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
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
      className={`relative w-full ${viewMode === "masonry" ? "h-[200px] min-h-[160px]" : "aspect-[2/3]"} select-none group cursor-pointer flex items-center justify-center p-1.5`}
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
          className="absolute w-[94%] h-[95%] rounded-2xl border-2 border-dashed border-white/25 bg-white/[0.04] backdrop-blur-xs flex flex-col items-center justify-center p-3 text-center transition-all duration-300 group-hover:border-purple-400/50 group-hover:bg-purple-500/10 group-hover:scale-[1.02] group-hover:-translate-y-1 shadow-lg text-white/40"
          style={{ zIndex: 2, willChange: "transform" }}
        >
          <Plus className="w-7 h-7 opacity-50 mb-1.5 group-hover:scale-110 group-hover:text-purple-300 transition-all" />
          <span className="text-[11px] font-medium tracking-wide text-white/50 group-hover:text-purple-200 transition-colors">新建</span>
        </div>
      </div>
    </div>
  );
});
