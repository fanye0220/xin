import React, { useState, useEffect } from 'react';

export type BubbleThemeId =
  | 'slate_blue'
  | 'oatmeal_matcha'
  | 'mist_cornflower'
  | 'silver_charcoal'
  | 'mint_mocha'
  | 'orange_blue';

export interface BubbleTheme {
  id: BubbleThemeId;
  name: string;
  badge: string;
  description: string;
  // Bot (left side) bubble: 100% solid color
  botColor: string;
  botTextColor: string;
  // User (right side) bubble: 100% solid color
  userColor: string;
  userTextColor: string;
}

export const BUBBLE_THEMES: Record<BubbleThemeId, BubbleTheme> = {
  // 截图 1 (075917): 深炭灰底 + 冰蓝气泡
  slate_blue: {
    id: 'slate_blue',
    name: '夜暮冰蓝',
    badge: '灰夜 · 冰蓝',
    description: '深灰稳重底座搭配纯净冰透淡蓝',
    botColor: '#48484E',
    botTextColor: '#F5F5F7',
    userColor: '#A5C9FF',
    userTextColor: '#1E293B',
  },
  // 截图 2 (075923): 燕麦米褐 + 抹茶森绿
  oatmeal_matcha: {
    id: 'oatmeal_matcha',
    name: '燕麦抹茶',
    badge: '燕麦 · 抹茶',
    description: '温暖奶麦米褐搭配森系沉稳抹茶绿',
    botColor: '#E6DECA',
    botTextColor: '#38342D',
    userColor: '#778A4E',
    userTextColor: '#FFFFFF',
  },
  // 截图 3 (075928): 浅素灰 + 雾面矢车菊蓝
  mist_cornflower: {
    id: 'mist_cornflower',
    name: '素灰雾蓝',
    badge: '素灰 · 雾蓝',
    description: '明亮浅素灰搭配温柔静谧雾霾蓝',
    botColor: '#E4E4E8',
    botTextColor: '#202022',
    userColor: '#9CBDE2',
    userTextColor: '#FFFFFF',
  },
  // 截图 4 (075933): 中性银灰 + 哑光炭黑
  silver_charcoal: {
    id: 'silver_charcoal',
    name: '银灰炭黑',
    badge: '银灰 · 炭黑',
    description: '纯粹中性冷灰搭配高级磨砂哑黑',
    botColor: '#ABABAB',
    botTextColor: '#222222',
    userColor: '#3F3F3F',
    userTextColor: '#FFFFFF',
  },
  // 截图 5 (075938): 薄荷浅绿 + 浓香焦褐
  mint_mocha: {
    id: 'mint_mocha',
    name: '薄荷青褐',
    badge: '薄荷 · 焦褐',
    description: '清新马卡龙浅绿搭配馥郁焦糖巧克褐',
    botColor: '#C6ECE8',
    botTextColor: '#22353A',
    userColor: '#5A463F',
    userTextColor: '#FFFFFF',
  },
  // P1同款对撞色：复古赤陶红豆与沉稳夜极墨黑
  orange_blue: {
    id: 'orange_blue',
    name: '赤陶墨黑',
    badge: '赤陶 · 墨黑',
    description: '复古暖红豆赤陶与沉稳夜极纯黑气泡',
    botColor: '#b85959',
    botTextColor: '#FFFFFF',
    userColor: '#0a0a0a',
    userTextColor: '#FFFFFF',
  },
};

const BUBBLE_THEME_STORAGE_KEY = 'chat_bubble_theme_v2';
const BUBBLE_THEME_CHANGE_EVENT = 'chat_bubble_theme_changed_v2';

export function getBubbleThemeId(): BubbleThemeId {
  try {
    const saved = localStorage.getItem(BUBBLE_THEME_STORAGE_KEY) as BubbleThemeId;
    if (saved && BUBBLE_THEMES[saved]) {
      return saved;
    }
  } catch (e) {
    // fallback
  }
  return 'slate_blue';
}

export function setBubbleThemeId(themeId: BubbleThemeId) {
  try {
    localStorage.setItem(BUBBLE_THEME_STORAGE_KEY, themeId);
    window.dispatchEvent(new CustomEvent(BUBBLE_THEME_CHANGE_EVENT, { detail: themeId }));
  } catch (e) {
    // ignore
  }
}

export function useBubbleTheme() {
  const [themeId, setThemeId] = useState<BubbleThemeId>(getBubbleThemeId);

  useEffect(() => {
    const handler = (e: any) => {
      if (e.detail && BUBBLE_THEMES[e.detail as BubbleThemeId]) {
        setThemeId(e.detail);
      } else {
        setThemeId(getBubbleThemeId());
      }
    };
    window.addEventListener(BUBBLE_THEME_CHANGE_EVENT, handler);
    return () => window.removeEventListener(BUBBLE_THEME_CHANGE_EVENT, handler);
  }, []);

  const changeTheme = (newId: BubbleThemeId) => {
    setBubbleThemeId(newId);
    setThemeId(newId);
  };

  return {
    themeId,
    theme: BUBBLE_THEMES[themeId] || BUBBLE_THEMES.slate_blue,
    setTheme: changeTheme,
    allThemes: Object.values(BUBBLE_THEMES),
  };
}

/**
 * 屏幕截图 2026-09-28 075334.png 同款双色对角切割色彩球
 */
export function ColorSphere({
  botColor,
  userColor,
  size = 28,
  className = '',
  hasShadow = true,
}: {
  botColor: string;
  userColor: string;
  size?: number;
  className?: string;
  hasShadow?: boolean;
}) {
  const uniqueId = React.useId().replace(/:/g, '');
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`inline-block shrink-0 select-none ${className}`}
      style={{
        filter: hasShadow ? 'drop-shadow(0 2px 5px rgba(0,0,0,0.22))' : undefined,
      }}
    >
      <defs>
        <clipPath id={`sphere-clip-${uniqueId}`}>
          <circle cx="50" cy="50" r="48" />
        </clipPath>
      </defs>
      <g clipPath={`url(#sphere-clip-${uniqueId})`}>
        {/* 右下半部（用户气泡色） */}
        <rect width="100" height="100" fill={userColor} />
        {/* 左上半部（角色气泡色），沿对角线精准平分 */}
        <polygon points="0,0 100,0 0,100" fill={botColor} />
      </g>
      {/* 边缘圆环边框 */}
      <circle
        cx="50"
        cy="50"
        r="48"
        fill="none"
        stroke="rgba(0, 0, 0, 0.18)"
        strokeWidth="2.5"
      />
    </svg>
  );
}
