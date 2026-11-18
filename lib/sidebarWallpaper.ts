import { useState, useEffect } from 'react';

export type WallpaperMode = 'full' | 'banner' | 'none';

export interface SidebarWallpaperConfig {
  enabled: boolean;
  mode: WallpaperMode; // 'full' (全屏沉浸) | 'banner' (中段画卷) | 'none' (纯净默认)
  url: string;
  presetId?: string;
  blur: number; // 0, 4, 8, 12, 16
  darkness: number; // 0.1 ~ 0.7
  opacity: number; // 0.05 ~ 1.0 (壁纸透明度拉条)
  cardOpacity?: number; // 0.0 ~ 0.5 (账号卡片毛玻璃透明度拉条，默认 0.08)
  bottomOpacity?: number; // 0.0 ~ 0.5 (底部设置栏毛玻璃透明度拉条，默认 0.08)
  topColor?: string; // 智能吸取的顶部边缘纯色 (RGB)
  topGradient?: string; // 智能吸取的顶部自然延展渐变 (CSS linear-gradient)
  scale?: number; // 1.0 ~ 4.0 (双指缩放)
  offsetX?: number; // -100% ~ 100% (水平平移)
  offsetY?: number; // -100% ~ 100% (垂直平移)
  cardGlass: 'subtle' | 'frosted' | 'solid'; // 卡片毛玻璃风格
  showArtisticText: boolean; // 是否显示艺术美文寄语
  artisticTitle: string; // 艺术大字如 "Passion" 或 "“Let's take a fantastic trip”"
  artisticSubtitle: string; // 副标题如 "May we always roam freely..." 或 "- 旅行日记 *"
}

export interface WallpaperPreset {
  id: string;
  name: string;
  category: string;
  url: string;
  thumbnail: string;
  recommendedMode: WallpaperMode;
  defaultDarkness: number;
  defaultBlur: number;
  artisticTitle: string;
  artisticSubtitle: string;
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  {
    id: 'misty-forest',
    name: '苍翠雾林',
    category: '自然森系',
    url: 'https://images.unsplash.com/photo-1511497584788-87676104235f?q=80&w=1080&auto=format&fit=crop',
    thumbnail: 'https://images.unsplash.com/photo-1511497584788-87676104235f?q=80&w=300&auto=format&fit=crop',
    recommendedMode: 'full',
    defaultDarkness: 0.35,
    defaultBlur: 0,
    artisticTitle: 'Passion',
    artisticSubtitle: 'May we always roam freely, cherish life\'s goodness',
  },
  {
    id: 'dark-ocean-sand',
    name: '沉寂暗海',
    category: '海滨纪行',
    url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=1080&auto=format&fit=crop',
    thumbnail: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=300&auto=format&fit=crop',
    recommendedMode: 'banner',
    defaultDarkness: 0.25,
    defaultBlur: 0,
    artisticTitle: '“Let\'s take a fantastic trip”',
    artisticSubtitle: '- 旅行日记 *',
  },
  {
    id: 'starry-cosmos',
    name: '浩瀚星河',
    category: '深邃夜空',
    url: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?q=80&w=1080&auto=format&fit=crop',
    thumbnail: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?q=80&w=300&auto=format&fit=crop',
    recommendedMode: 'full',
    defaultDarkness: 0.4,
    defaultBlur: 0,
    artisticTitle: 'Infinite',
    artisticSubtitle: 'Beyond the stars, within our dreams',
  },
  {
    id: 'golden-sunset',
    name: '暮色晚霞',
    category: '暖阳余晖',
    url: 'https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?q=80&w=1080&auto=format&fit=crop',
    thumbnail: 'https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?q=80&w=300&auto=format&fit=crop',
    recommendedMode: 'full',
    defaultDarkness: 0.35,
    defaultBlur: 0,
    artisticTitle: 'Glow',
    artisticSubtitle: 'Catching the golden warmth of dusk',
  },
  {
    id: 'snowy-peaks',
    name: '雪域远峰',
    category: '高山冰川',
    url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=1080&auto=format&fit=crop',
    thumbnail: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=300&auto=format&fit=crop',
    recommendedMode: 'full',
    defaultDarkness: 0.3,
    defaultBlur: 0,
    artisticTitle: 'Serenity',
    artisticSubtitle: 'Pure silence above the clouds',
  },
  {
    id: 'zen-bamboo',
    name: '苍翠竹风',
    category: '禅意绿意',
    url: 'https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?q=80&w=1080&auto=format&fit=crop',
    thumbnail: 'https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?q=80&w=300&auto=format&fit=crop',
    recommendedMode: 'banner',
    defaultDarkness: 0.3,
    defaultBlur: 0,
    artisticTitle: 'Breeze',
    artisticSubtitle: 'Whispers of green leaves and quiet stones',
  },
  {
    id: 'cyber-neon',
    name: '赛博霓虹',
    category: '都市流光',
    url: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?q=80&w=1080&auto=format&fit=crop',
    thumbnail: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?q=80&w=300&auto=format&fit=crop',
    recommendedMode: 'full',
    defaultDarkness: 0.45,
    defaultBlur: 0,
    artisticTitle: 'Neon Pulse',
    artisticSubtitle: 'Electric dreams through the midnight haze',
  },
];

const STORAGE_KEY = 'tavern_sidebar_wallpaper_v1';
const EVENT_NAME = 'tavern_sidebar_wallpaper_changed';

export const DEFAULT_WALLPAPER_CONFIG: SidebarWallpaperConfig = {
  enabled: false,
  mode: 'full',
  url: '',
  presetId: undefined,
  blur: 0,
  darkness: 0.25,
  opacity: 0.85,
  cardOpacity: 0.08,
  bottomOpacity: 0.08,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  cardGlass: 'frosted',
  showArtisticText: false,
  artisticTitle: '',
  artisticSubtitle: '',
};

export function getSidebarWallpaperConfig(): SidebarWallpaperConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WALLPAPER_CONFIG;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_WALLPAPER_CONFIG, ...parsed };
  } catch {
    return DEFAULT_WALLPAPER_CONFIG;
  }
}

export function saveSidebarWallpaperConfig(config: SidebarWallpaperConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: config }));
  } catch (err) {
    console.error('Failed to save wallpaper config:', err);
  }
}

export function useSidebarWallpaper(): [SidebarWallpaperConfig, (config: SidebarWallpaperConfig) => void] {
  const [config, setConfig] = useState<SidebarWallpaperConfig>(getSidebarWallpaperConfig);

  useEffect(() => {
    const handleUpdate = () => {
      setConfig(getSidebarWallpaperConfig());
    };
    window.addEventListener(EVENT_NAME, handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener(EVENT_NAME, handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  const update = (newConfig: SidebarWallpaperConfig) => {
    saveSidebarWallpaperConfig(newConfig);
    setConfig(newConfig);
  };

  return [config, update];
}
