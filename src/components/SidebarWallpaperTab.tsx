import React, { useRef, useState, useEffect } from 'react';
import { 
  Upload, 
  Trash2, 
  RotateCcw,
  MessageSquare, 
  Tag, 
  Sparkles, 
  Copy, 
  Trash, 
  Folder as FolderIcon,
  ChevronRight,
  Plus,
  Settings,
  Moon,
  Sun,
  Wifi,
  Battery,
  Lock,
  Unlock,
  Check
} from 'lucide-react';
import { SidebarWallpaperConfig } from '../lib/sidebarWallpaper';
import { extractTopImageColors } from '../lib/imageColorExtractor';

interface Props {
  config: SidebarWallpaperConfig;
  onChange: (config: SidebarWallpaperConfig) => void;
}

function GoogleGIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.97 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      />
    </svg>
  );
}

function PinchDiagonalIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

export function SidebarWallpaperTab({ config, onChange }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState(() => !document.documentElement.classList.contains('light-theme'));
  const [sampledColors, setSampledColors] = useState<{
    topColor: string;
    topEdgeColor: string;
    gradient: string;
  } | null>(null);

  // Position Lock State (Locked by default to prevent accidental displacement)
  const [isPositionLocked, setIsPositionLocked] = useState(true);
  const [toastFeedback, setToastFeedback] = useState<string | null>(null);

  useEffect(() => {
    const updateTheme = () => {
      setIsDarkTheme(!document.documentElement.classList.contains('light-theme'));
    };
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('storage', updateTheme);
    return () => {
      observer.disconnect();
      window.removeEventListener('storage', updateTheme);
    };
  }, []);

  const currentOpacity = config.opacity !== undefined ? config.opacity : 0.85;
  const currentCardOpacity = config.cardOpacity !== undefined ? config.cardOpacity : 0.08;
  const currentBottomOpacity = config.bottomOpacity !== undefined ? config.bottomOpacity : 0.08;
  const currentScale = config.scale !== undefined ? config.scale : 1;
  const currentOffsetX = config.offsetX !== undefined ? config.offsetX : 0;
  const currentOffsetY = config.offsetY !== undefined ? config.offsetY : 0;

  // Extract top edge color from the image whenever URL changes
  useEffect(() => {
    if (config.url) {
      extractTopImageColors(config.url).then((res) => {
        setSampledColors(res);
        if (config.topColor !== res.topColor || config.topGradient !== res.gradient) {
          onChange({
            ...config,
            topColor: res.topColor,
            topGradient: res.gradient,
          });
        }
      });
    } else {
      setSampledColors(null);
    }
  }, [config.url]);

  // Touch & Drag state tracking
  const touchState = useRef<{
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
    startDistance?: number;
    startScale?: number;
    hasMoved: boolean;
  }>({
    startX: 0,
    startY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
    hasMoved: false,
  });

  const mouseState = useRef<{
    isDown: boolean;
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
    hasMoved: boolean;
  }>({
    isDown: false,
    startX: 0,
    startY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
    hasMoved: false,
  });

  const hasWallpaper = Boolean(config.enabled && config.url);
  const hasCustomTransform = currentScale !== 1 || currentOffsetX !== 0 || currentOffsetY !== 0;

  const handleFileUpload = (file?: File) => {
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) {
      alert('壁纸图片大小不能超过 20MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const result = event.target?.result as string;
      if (result) {
        const colors = await extractTopImageColors(result);
        setSampledColors(colors);
        setIsPositionLocked(false); // Open adjustment mode for newly uploaded image
        setToastFeedback('已加载新壁纸，现可自由拖拽缩放');
        setTimeout(() => setToastFeedback(null), 2500);

        onChange({
          ...config,
          enabled: true,
          mode: 'full',
          url: result,
          darkness: config.darkness ?? 0.25,
          opacity: currentOpacity,
          cardOpacity: currentCardOpacity,
          bottomOpacity: currentBottomOpacity,
          topColor: colors.topColor,
          topGradient: colors.gradient,
          scale: 1,
          offsetX: 0,
          offsetY: 0,
          blur: 0,
        });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleClearWallpaper = () => {
    setIsPositionLocked(true);
    onChange({
      ...config,
      enabled: false,
      mode: 'none',
      url: '',
      topColor: undefined,
      topGradient: undefined,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
  };

  const handleResetTransform = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange({
      ...config,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
  };

  // Touch pinch and pan handlers (Disabled when position is locked)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (!hasWallpaper || isPositionLocked) return;
    if (e.touches.length === 1) {
      touchState.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startOffsetX: currentOffsetX,
        startOffsetY: currentOffsetY,
        hasMoved: false,
      };
    } else if (e.touches.length >= 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchState.current = {
        startX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        startY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        startOffsetX: currentOffsetX,
        startOffsetY: currentOffsetY,
        startDistance: dist,
        startScale: currentScale,
        hasMoved: true,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!hasWallpaper || isPositionLocked) return;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (e.touches.length === 1 && !touchState.current.startDistance) {
      const dx = e.touches[0].clientX - touchState.current.startX;
      const dy = e.touches[0].clientY - touchState.current.startY;
      if (Math.hypot(dx, dy) > 4) {
        touchState.current.hasMoved = true;
      }
      if (touchState.current.hasMoved) {
        const nextX = touchState.current.startOffsetX + (dx / rect.width) * 100;
        const nextY = touchState.current.startOffsetY + (dy / rect.height) * 100;
        onChange({
          ...config,
          offsetX: Math.max(-120, Math.min(120, nextX)),
          offsetY: Math.max(-120, Math.min(120, nextY)),
        });
      }
    } else if (e.touches.length >= 2 && touchState.current.startDistance && touchState.current.startScale) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const scaleFactor = dist / touchState.current.startDistance;
      const nextScale = Math.max(0.7, Math.min(4, touchState.current.startScale * scaleFactor));

      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const dx = midX - touchState.current.startX;
      const dy = midY - touchState.current.startY;
      const nextX = touchState.current.startOffsetX + (dx / rect.width) * 100;
      const nextY = touchState.current.startOffsetY + (dy / rect.height) * 100;

      onChange({
        ...config,
        scale: Number(nextScale.toFixed(3)),
        offsetX: Math.max(-120, Math.min(120, nextX)),
        offsetY: Math.max(-120, Math.min(120, nextY)),
      });
    }
  };

  const handleTouchEnd = () => {
    touchState.current.startDistance = undefined;
  };

  // Mouse wheel zoom (Disabled when position is locked)
  const handleWheel = (e: React.WheelEvent) => {
    if (!hasWallpaper || isPositionLocked) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.08 : -0.08;
    const nextScale = Math.max(0.7, Math.min(4, currentScale + delta));
    onChange({
      ...config,
      scale: Number(nextScale.toFixed(3)),
    });
  };

  // Mouse drag pan (Disabled when position is locked)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!hasWallpaper || isPositionLocked) return;
    mouseState.current = {
      isDown: true,
      startX: e.clientX,
      startY: e.clientY,
      startOffsetX: currentOffsetX,
      startOffsetY: currentOffsetY,
      hasMoved: false,
    };
  };

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!mouseState.current.isDown || !hasWallpaper || isPositionLocked) return;
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;

      const dx = e.clientX - mouseState.current.startX;
      const dy = e.clientY - mouseState.current.startY;
      if (Math.hypot(dx, dy) > 4) {
        mouseState.current.hasMoved = true;
      }
      if (mouseState.current.hasMoved) {
        const nextX = mouseState.current.startOffsetX + (dx / rect.width) * 100;
        const nextY = mouseState.current.startOffsetY + (dy / rect.height) * 100;
        onChange({
          ...config,
          offsetX: Math.max(-120, Math.min(120, nextX)),
          offsetY: Math.max(-120, Math.min(120, nextY)),
        });
      }
    };

    const handleGlobalMouseUp = () => {
      if (mouseState.current.isDown) {
        mouseState.current.isDown = false;
      }
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [hasWallpaper, isPositionLocked, config, onChange]);

  const handleViewportClick = () => {
    if (!hasWallpaper) {
      fileInputRef.current?.click();
    } else if (isPositionLocked) {
      setToastFeedback('壁纸位置已锁定，点击下方【解锁调整】或【更换壁纸】可移动');
      setTimeout(() => setToastFeedback(null), 2500);
    } else if (!touchState.current.hasMoved && !mouseState.current.hasMoved) {
      fileInputRef.current?.click();
    }
  };

  return (
    <div className="flex flex-col items-center justify-center w-full py-0.5 select-none">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileUpload(file);
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Toast Feedback Notification Banner */}
      {toastFeedback && (
        <div className="mb-2 px-3 py-1 rounded-full bg-slate-800 text-slate-100 border border-slate-700 text-xs font-medium shadow-lg animate-in fade-in zoom-in-95 duration-150 flex items-center gap-1.5 z-30">
          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>{toastFeedback}</span>
        </div>
      )}

      {/* Modern Smartphone Viewport: Slender 9:19.5 phone screen aspect ratio */}
      <div
        ref={viewportRef}
        onClick={handleViewportClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingFile(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setIsDraggingFile(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDraggingFile(false);
          const file = e.dataTransfer.files?.[0];
          if (file && file.type.startsWith('image/')) {
            handleFileUpload(file);
          }
        }}
        className={`w-[218px] sm:w-[230px] aspect-[9/19.5] max-h-[55vh] sm:max-h-[58vh] rounded-[36px] sm:rounded-[40px] border-[5px] transition-all duration-200 relative overflow-hidden flex flex-col shadow-2xl ${
          hasWallpaper && !isPositionLocked ? 'touch-none cursor-grab active:cursor-grabbing' : 'touch-pan-y cursor-pointer'
        } ${
          isDarkTheme ? 'bg-slate-950 border-slate-800' : 'bg-[#ffffff] border-stone-300'
        } ${
          isDraggingFile 
            ? 'border-blue-500 scale-[1.02] ring-4 ring-blue-500/30' 
            : 'ring-1 ring-black/5'
        }`}
      >
        {/* Lock/Unlock Badge Overlay inside Viewport */}
        {hasWallpaper && (
          <div className="absolute top-2.5 right-3.5 z-20 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-[10px] text-white/90 flex items-center gap-1 border border-white/20 select-none pointer-events-none">
            {isPositionLocked ? (
              <>
                <Lock className="w-2.5 h-2.5 text-emerald-400" />
                <span className="text-emerald-300 font-medium">已锁定</span>
              </>
            ) : (
              <>
                <Unlock className="w-2.5 h-2.5 text-amber-300 animate-pulse" />
                <span className="text-amber-200 font-medium">移动中</span>
              </>
            )}
          </div>
        )}

        {/* Sharp Wallpaper Foreground Layer */}
        {hasWallpaper && (
          <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
            <div 
              className="w-full h-full bg-cover bg-center transition-opacity duration-150"
              style={{
                backgroundImage: `url(${config.url})`,
                opacity: currentOpacity,
                transform: `translate3d(${currentOffsetX}%, ${currentOffsetY}%, 0) scale(${currentScale})`,
                transformOrigin: 'center center',
              }}
            />
          </div>
        )}

        {/* Wallpaper Tint / Dimming Overlay (Only in dark theme; never dim in light theme) */}
        {hasWallpaper && isDarkTheme && (
          <div 
            className="absolute inset-0 pointer-events-none transition-all duration-300 z-0 bg-black/20"
          />
        )}

        {/* Realistic Phone Status Bar */}
        <div className={`pt-2.5 px-4 flex items-center justify-between relative z-10 shrink-0 pointer-events-none text-[10px] font-medium tracking-tight ${
          isDarkTheme ? 'text-white/80' : '!text-[#1c1c1e]'
        }`}>
          <span>11:13</span>
          <div className="flex items-center gap-1.5 text-[10px]">
            <Wifi className="w-3 h-3 stroke-[2]" />
            <span className="text-[9px] font-bold">5G</span>
            <Battery className="w-3.5 h-3.5 stroke-[2]" />
          </div>
        </div>

        {/* Top Header inside Viewport */}
        <div className="pt-2 px-3 pb-1 flex items-center justify-between relative z-10 shrink-0 pointer-events-none">
          <span className={`text-[10px] font-bold tracking-wider uppercase drop-shadow-sm ${
            isDarkTheme ? 'text-white/70' : '!text-[#1c1c1e]'
          }`}>MIU PROFILE</span>
          <div className={`w-4.5 h-4.5 rounded-full flex items-center justify-center text-xs ${
            isDarkTheme ? 'text-white/70' : '!text-[#1c1c1e]'
          }`}>
            ✕
          </div>
        </div>

        {/* Viewport Content Area */}
        <div className="flex-1 overflow-y-auto hide-scrollbar relative z-10 flex flex-col pointer-events-none">
          {/* Frosted Glass Profile Card with User-Adjustable Opacity */}
          <div className="px-2.5 pt-0.5 pb-1.5">
            <div 
              className={`rounded-2xl p-2.5 shadow-sm transition-all border ${
                isDarkTheme ? 'text-white' : '!text-[#1c1c1e]'
              }`}
              style={{
                backgroundColor: currentCardOpacity > 0.005
                  ? `rgba(255, 255, 255, ${currentCardOpacity})`
                  : 'transparent',
                borderColor: currentCardOpacity > 0.01 
                  ? (isDarkTheme 
                      ? `rgba(255, 255, 255, ${Math.min(0.35, currentCardOpacity * 2 + 0.06)})` 
                      : `rgba(0, 0, 0, ${Math.min(0.15, currentCardOpacity * 1.5)})`)
                  : 'transparent',
                borderWidth: currentCardOpacity > 0.01 ? '1px' : '0px',
                backdropFilter: currentCardOpacity > 0.005 ? `blur(${Math.round(currentCardOpacity * 35 + 4)}px)` : undefined,
                WebkitBackdropFilter: currentCardOpacity > 0.005 ? `blur(${Math.round(currentCardOpacity * 35 + 4)}px)` : undefined,
              }}
            >
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full border flex items-center justify-center shrink-0 shadow-sm ${
                  isDarkTheme ? 'bg-slate-900/50 border-white/20' : 'bg-stone-100 border-black/10'
                }`}>
                  <GoogleGIcon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-[11px] truncate drop-shadow-xs">登录 Google ...</span>
                    <span className={`text-[8px] px-1.5 py-0.2 rounded-full border font-medium shrink-0 ${
                      isDarkTheme 
                        ? 'border-white/25 text-white/90 bg-white/[0.08]' 
                        : 'border-black/15 !text-[#1c1c1e] bg-black/5'
                    }`}>
                      点击登录
                    </span>
                  </div>
                  <p className={`text-[8.5px] truncate mt-0.5 drop-shadow-xs ${
                    isDarkTheme ? 'text-white/80' : '!text-[#48484a]'
                  }`}>
                    连接云端备份与角色数据同步
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Fully Transparent Menu Rows */}
          <div className={`px-2.5 space-y-0.5 ${
            isDarkTheme 
              ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]' 
              : '!text-[#1c1c1e]'
          }`}>
            <div className="flex items-center justify-between px-2 py-1.5 text-xs transition">
              <div className="flex items-center gap-2.5">
                <MessageSquare className="w-3.5 h-3.5 stroke-[1.8]" />
                <span className="text-[12px] font-medium">聊天记录</span>
              </div>
              <ChevronRight className="w-3 h-3 opacity-60" />
            </div>

            <div className="flex items-center justify-between px-2 py-1.5 text-xs transition">
              <div className="flex items-center gap-2.5">
                <Tag className="w-3.5 h-3.5 stroke-[1.8]" />
                <span className="text-[12px] font-medium">自动打标</span>
              </div>
              <ChevronRight className="w-3 h-3 opacity-60" />
            </div>

            <div className="flex items-center justify-between px-2 py-1.5 text-xs transition">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-3.5 h-3.5 stroke-[1.8]" />
                <span className="text-[12px] font-medium">智能推荐</span>
              </div>
              <ChevronRight className="w-3 h-3 opacity-60" />
            </div>

            <div className="flex items-center justify-between px-2 py-1.5 text-xs transition">
              <div className="flex items-center gap-2.5">
                <Copy className="w-3.5 h-3.5 stroke-[1.8]" />
                <span className="text-[12px] font-medium">重复卡检测</span>
              </div>
              <ChevronRight className="w-3 h-3 opacity-60" />
            </div>

            <div className="flex items-center justify-between px-2 py-1.5 text-xs transition">
              <div className="flex items-center gap-2.5">
                <Trash className="w-3.5 h-3.5 stroke-[1.8]" />
                <span className="text-[12px] font-medium">回收站</span>
              </div>
              <ChevronRight className="w-3 h-3 opacity-60" />
            </div>
          </div>

          {/* Folder Section Row (No harsh dividing border) */}
          <div className={`px-2.5 pt-1.5 ${
            isDarkTheme 
              ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]' 
              : '!text-[#1c1c1e]'
          }`}>
            <div className="flex items-center justify-between px-2 py-1 text-xs">
              <div className="flex items-center gap-2">
                <ChevronRight className="w-3 h-3 opacity-60" />
                <FolderIcon className="w-3.5 h-3.5 stroke-[1.8]" />
                <span className="text-[12px] font-medium">文件夹分类</span>
              </div>
              <Plus className="w-3 h-3 opacity-70" />
            </div>
          </div>

          {/* Bottom Settings & Theme Bar with User-Adjustable Transparency */}
          <div 
            className={`mt-auto p-2 space-y-0.5 relative z-10 transition-all ${
              isDarkTheme 
                ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]' 
                : '!text-[#1c1c1e]'
            }`}
            style={{
              backgroundColor: currentBottomOpacity > 0.005
                ? `rgba(255, 255, 255, ${currentBottomOpacity})`
                : 'transparent',
              borderColor: currentBottomOpacity > 0.01 
                ? (isDarkTheme 
                    ? `rgba(255, 255, 255, ${Math.min(0.35, currentBottomOpacity * 2 + 0.06)})` 
                    : `rgba(0, 0, 0, ${Math.min(0.15, currentBottomOpacity * 1.5)})`)
                : 'transparent',
              borderTopWidth: currentBottomOpacity > 0.01 ? '1px' : '0px',
              backdropFilter: currentBottomOpacity > 0.005 ? `blur(${Math.round(currentBottomOpacity * 35 + 4)}px)` : undefined,
              WebkitBackdropFilter: currentBottomOpacity > 0.005 ? `blur(${Math.round(currentBottomOpacity * 35 + 4)}px)` : undefined,
            }}
          >
            <div className="flex items-center justify-between px-2 py-0.5 text-xs">
              <div className="flex items-center gap-2">
                <Settings className="w-3.5 h-3.5 stroke-[1.8]" />
                <span className="text-[12px] font-medium">设置</span>
              </div>
              <ChevronRight className="w-3 h-3 opacity-60" />
            </div>
            <div className="flex items-center justify-between px-2 py-0.5 text-xs">
              <div className="flex items-center gap-2">
                {isDarkTheme ? (
                  <Moon className="w-3.5 h-3.5 stroke-[1.8]" />
                ) : (
                  <Sun className="w-3.5 h-3.5 stroke-[1.8] !text-[#1c1c1e]" />
                )}
                <span className="text-[12px] font-medium">{isDarkTheme ? '深色夜间模式' : '明亮浅色模式'}</span>
              </div>
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
                isDarkTheme 
                  ? 'border-white/30 bg-white/10 text-white/90' 
                  : 'border-black/15 bg-black/5 !text-[#1c1c1e]'
              }`}>
                点击切换
              </span>
            </div>
          </div>
        </div>

        {/* Empty state hint */}
        {!hasWallpaper && (
          <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px] flex flex-col items-center justify-center p-4 text-center z-20 group-hover:bg-black/65 transition-colors">
            <div className="w-10 h-10 rounded-2xl bg-white/15 border border-white/25 flex items-center justify-center text-white mb-2 shadow-lg group-hover:scale-110 transition-transform">
              <Upload className="w-4.5 h-4.5 stroke-[1.8]" />
            </div>
            <span className="text-xs font-semibold text-white drop-shadow-sm">
              点击选择壁纸
            </span>
            <span className="text-[9.5px] text-white/60 mt-0.5">
              支持上传本地相册图片
            </span>
          </div>
        )}
      </div>

      {/* Pinch & Zoom Hint or Locked Status Hint */}
      {hasWallpaper && (
        <div className="flex items-center justify-center gap-1.5 text-xs sm:text-sm select-none mt-2.5 px-2 text-center">
          {isPositionLocked ? (
            <div className="flex items-center gap-1.5 font-semibold px-3.5 py-1.5 rounded-full border shadow-xs text-emerald-300 bg-emerald-500/15 border-emerald-500/30">
              <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>壁纸位置已锁定（点击【更换 / 调整壁纸】开放挪动）</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 font-semibold px-3.5 py-1.5 rounded-full border shadow-xs text-amber-300 bg-amber-500/15 border-amber-500/30">
              <PinchDiagonalIcon className="w-4 h-4 text-amber-400 shrink-0 stroke-[2]" />
              <span>可滑动拖拽或捏合调整，满意后请点击【确认壁纸位置】</span>
            </div>
          )}
        </div>
      )}

      {/* Sliders Container: Wallpaper, Account Card, and Bottom Bar Opacity */}
      <div className="w-full max-w-[320px] sm:max-w-[360px] mt-3.5 px-1 space-y-3">
        {/* Slider 1: 壁纸透明度 */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-slate-100">
              壁纸透明度
            </span>
            <span className="font-mono font-medium text-slate-300">
              {Math.round(currentOpacity * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="10"
            max="100"
            step="1"
            value={Math.round(currentOpacity * 100)}
            onChange={(e) => {
              const val = Number(e.target.value) / 100;
              onChange({
                ...config,
                opacity: val,
              });
            }}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-blue-500 focus:outline-none bg-slate-700"
          />
        </div>

        {/* Slider 2: 账号卡片毛玻璃透明度 */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-slate-100">
              账号卡片透明度
            </span>
            <span className="font-mono font-medium text-slate-300">
              {currentCardOpacity <= 0.01 ? '全透 (0%)' : `${Math.round(currentCardOpacity * 100)}%`}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="40"
            step="1"
            value={Math.round(currentCardOpacity * 100)}
            onChange={(e) => {
              const val = Number(e.target.value) / 100;
              onChange({
                ...config,
                cardOpacity: val,
              });
            }}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-blue-500 focus:outline-none bg-slate-700"
          />
        </div>

        {/* Slider 3: 底部设置栏透明度 */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-slate-100">
              底栏设置透明度
            </span>
            <span className="font-mono font-medium text-slate-300">
              {currentBottomOpacity <= 0.01 ? '全透 (0%)' : `${Math.round(currentBottomOpacity * 100)}%`}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="40"
            step="1"
            value={Math.round(currentBottomOpacity * 100)}
            onChange={(e) => {
              const val = Number(e.target.value) / 100;
              onChange({
                ...config,
                bottomOpacity: val,
              });
            }}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-blue-500 focus:outline-none bg-slate-700"
          />
        </div>
      </div>

      {/* Action Buttons Beneath the Viewport */}
      {hasWallpaper ? (
        <div className="flex items-center gap-2 sm:gap-2.5 mt-3 flex-wrap justify-center w-full max-w-[360px] px-1">
          {!isPositionLocked ? (
            /* Editing / Unlocked Mode: Show Confirm Button */
            <>
              <button
                type="button"
                onClick={() => {
                  setIsPositionLocked(true);
                  setToastFeedback('已确认并锁定壁纸位置，防止误触挪动');
                  setTimeout(() => setToastFeedback(null), 2500);
                }}
                className="px-4 py-2 rounded-full text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 shadow-md transition flex items-center gap-1.5 cursor-pointer active:scale-95 animate-pulse shrink-0"
                title="确认当前位置并锁定展示"
              >
                <Check className="w-4 h-4" />
                <span>确认壁纸位置</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  fileInputRef.current?.click();
                }}
                className="px-3.5 py-2 rounded-full text-xs sm:text-sm font-medium transition flex items-center gap-1.5 cursor-pointer active:scale-95 shrink-0 text-slate-100 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700/60"
                title="选择本地新图片"
              >
                <Upload className="w-4 h-4" />
                <span>选择新图片</span>
              </button>

              {hasCustomTransform && (
                <button
                  type="button"
                  onClick={handleResetTransform}
                  className="px-3 py-2 rounded-full text-xs sm:text-sm font-medium transition flex items-center gap-1 cursor-pointer active:scale-95 shrink-0 text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60"
                  title="复原缩放与位置"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>复位</span>
                </button>
              )}
            </>
          ) : (
            /* Locked Mode: Show Change Wallpaper button */
            <>
              <button
                type="button"
                onClick={() => {
                  setIsPositionLocked(false);
                  setToastFeedback('已解锁，现可滑动拖拽或捏合缩放图片，完成后请点击【确认壁纸位置】');
                  setTimeout(() => setToastFeedback(null), 3000);
                }}
                className="px-4 py-2 rounded-full text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 shadow-md shadow-blue-500/20 transition flex items-center gap-1.5 cursor-pointer active:scale-95 shrink-0"
                title="开启壁纸位置拖拽与调整模式"
              >
                <Unlock className="w-4 h-4" />
                <span>更换 / 调整壁纸</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsPositionLocked(false);
                  fileInputRef.current?.click();
                }}
                className="px-3.5 py-2 rounded-full text-xs sm:text-sm font-medium transition flex items-center gap-1.5 cursor-pointer active:scale-95 shrink-0 text-slate-100 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700/60"
                title="选择本地新图片"
              >
                <Upload className="w-4 h-4" />
                <span>选择新图片</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleClearWallpaper();
            }}
            className="px-3.5 py-2 rounded-full text-xs sm:text-sm font-medium transition flex items-center gap-1.5 cursor-pointer active:scale-95 shrink-0 text-rose-300 hover:text-rose-200 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/25"
            title="移除当前壁纸，恢复默认深色"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>清除壁纸</span>
          </button>
        </div>
      ) : (
        <p className="text-xs sm:text-sm text-slate-400 mt-3 text-center">
          点击视窗即可更换侧栏壁纸
        </p>
      )}
    </div>
  );
}
