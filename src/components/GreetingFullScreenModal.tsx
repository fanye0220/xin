import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  X,
  BookOpen,
  Edit3,
  Save,
  Copy,
  Check,
  Type,
  List,
} from 'lucide-react';
import { CharacterCard } from '../lib/db';
import { getFallbackAvatar, safeCreateObjectURL } from '../lib/avatar';
import { MessageContent } from './MessageContent';
import {
  applyRegexToText,
  extractCharacterStyles,
  getCharacterRegexScripts,
} from '../lib/regexEngine';

export interface GreetingItem {
  type: 'first_mes' | 'alternate';
  index: number;
  title: string;
  content: string;
}

interface Props {
  isOpen: boolean;
  character: CharacterCard;
  avatarUrl?: string | null;
  initialIndex?: number;
  onClose: () => void;
  onSaveGreeting: (type: 'first_mes' | 'alternate', index: number, newContent: string) => void;
  onDeleteGreeting?: (index: number) => void;
  onAddAlternate?: (content: string) => void;
}

type ReaderTheme = 'dark' | 'slate' | 'sepia' | 'light';
type ReaderFont = 'serif' | 'sans' | 'kaiti';

const THEMES: Record<
  ReaderTheme,
  {
    name: string;
    bg: string;
    cardBg: string;
    text: string;
    muted: string;
    border: string;
    accent: string;
    barBg: string;
    isDark: boolean;
  }
> = {
  dark: {
    name: '纯黑',
    bg: '#0a0a0c',
    cardBg: '#121215',
    text: '#ebebf0',
    muted: '#8e8e98',
    border: 'rgba(255, 255, 255, 0.08)',
    accent: '#a78bfa',
    barBg: 'rgba(18, 18, 21, 0.94)',
    isDark: true,
  },
  slate: {
    name: '深空',
    bg: '#0f1217',
    cardBg: '#161a22',
    text: '#e2e8f0',
    muted: '#94a3b8',
    border: 'rgba(255, 255, 255, 0.08)',
    accent: '#818cf8',
    barBg: 'rgba(22, 26, 34, 0.94)',
    isDark: true,
  },
  sepia: {
    name: '暖阳',
    bg: '#ece5d8',
    cardBg: '#f6f1e7',
    text: '#2d2620',
    muted: '#786e64',
    border: 'rgba(0, 0, 0, 0.08)',
    accent: '#9333ea',
    barBg: 'rgba(246, 241, 231, 0.95)',
    isDark: false,
  },
  light: {
    name: '纸白 (P1同款)',
    bg: '#f4f5f8',
    cardBg: '#ffffff',
    text: '#222831',
    muted: '#6b7280',
    border: 'rgba(0, 0, 0, 0.08)',
    accent: '#3b82f6',
    barBg: 'rgba(255, 255, 255, 0.95)',
    isDark: false,
  },
};

const FONTS: Record<ReaderFont, { name: string; style: string }> = {
  serif: {
    name: '宋体',
    style:
      '"Songti SC", "Source Han Serif SC", "Noto Serif CJK SC", Georgia, "New York", serif',
  },
  sans: {
    name: '黑体',
    style:
      '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  },
  kaiti: {
    name: '楷体',
    style:
      '"Kaiti SC", "STKaiti", "KaiTi", "Source Han Serif SC", Georgia, serif',
  },
};

const FONT_SIZES = [
  { label: '小', px: 15, lineHeight: 1.9 },
  { label: '中', px: 17, lineHeight: 2.0 },
  { label: '大', px: 19, lineHeight: 2.05 },
  { label: '特大', px: 21, lineHeight: 2.1 },
];

export function GreetingFullScreenModal({
  isOpen,
  character,
  avatarUrl,
  initialIndex = 0,
  onClose,
  onSaveGreeting,
  onDeleteGreeting,
  onAddAlternate,
}: Props) {
  const targetData = character.data?.data || character.data || {};
  const firstMes = targetData.first_mes || '';
  const alternates: string[] = targetData.alternate_greetings || [];

  // Build list of all greetings
  const greetingItems: GreetingItem[] = useMemo(() => {
    const list: GreetingItem[] = [];
    list.push({
      type: 'first_mes',
      index: 0,
      title: '首条消息',
      content: firstMes,
    });
    alternates.forEach((alt, idx) => {
      list.push({
        type: 'alternate',
        index: idx,
        title: `开场白 ${idx + 2}`,
        content: alt || '',
      });
    });
    return list;
  }, [firstMes, alternates]);

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | 'none'>('none');
  const [isEditing, setIsEditing] = useState(false);
  // Default to false: pure reading mode! Tap to reveal exit
  const [areBarsVisible, setAreBarsVisible] = useState(false);
  const [showCatalogDrawer, setShowCatalogDrawer] = useState(false);
  const [showAaMenu, setShowAaMenu] = useState(false);

  // Settings
  const [theme, setTheme] = useState<ReaderTheme>(() => {
    try {
      return (localStorage.getItem('miu_reader_theme') as ReaderTheme) || 'dark';
    } catch {
      return 'dark';
    }
  });

  const [font, setFont] = useState<ReaderFont>(() => {
    try {
      return (localStorage.getItem('miu_reader_font') as ReaderFont) || 'serif';
    } catch {
      return 'serif';
    }
  });

  const [fontSizeIndex, setFontSizeIndex] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('miu_reader_font_size');
      return saved !== null ? Number(saved) : 1;
    } catch {
      return 1;
    }
  });

  const [indentFirstLine, setIndentFirstLine] = useState<boolean>(() => {
    try {
      return localStorage.getItem('miu_reader_indent') === 'true';
    } catch {
      return false; // In P1 style, clean paragraph formatting without aggressive indent is default
    }
  });

  const userName = 'User';

  // Text & editing state
  const [currentText, setCurrentText] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [copied, setCopied] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Gesture handling: Swipe left & right to change chapters
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  // Character regex scripts & styles
  const regexScripts = useMemo(() => getCharacterRegexScripts(character), [character]);
  const customCss = useMemo(() => extractCharacterStyles(character.data), [character]);

  const currentTheme = THEMES[theme] || THEMES.dark;
  const currentFontConfig = FONTS[font] || FONTS.serif;
  const currentSizeConfig = FONT_SIZES[fontSizeIndex] || FONT_SIZES[1];

  // Sync index and text
  useEffect(() => {
    if (currentIndex >= greetingItems.length) {
      setCurrentIndex(Math.max(0, greetingItems.length - 1));
    }
  }, [greetingItems.length, currentIndex]);

  useEffect(() => {
    const item = greetingItems[currentIndex];
    if (item) {
      setCurrentText(item.content);
      setIsDirty(false);
    }
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [currentIndex, greetingItems]);

  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(Math.min(initialIndex, Math.max(0, greetingItems.length - 1)));
      setIsEditing(false);
      setAreBarsVisible(false); // start completely clean without bars
      setSlideDirection('none');
    }
  }, [isOpen, initialIndex]);

  // Settings handlers
  const handleSetTheme = (t: ReaderTheme) => {
    setTheme(t);
    try {
      localStorage.setItem('miu_reader_theme', t);
    } catch {}
  };

  const handleSetFont = (f: ReaderFont) => {
    setFont(f);
    try {
      localStorage.setItem('miu_reader_font', f);
    } catch {}
  };

  const handleSetFontSizeIndex = (idx: number) => {
    const clamped = Math.max(0, Math.min(FONT_SIZES.length - 1, idx));
    setFontSizeIndex(clamped);
    try {
      localStorage.setItem('miu_reader_font_size', String(clamped));
    } catch {}
  };

  const handleToggleIndent = () => {
    const nextVal = !indentFirstLine;
    setIndentFirstLine(nextVal);
    try {
      localStorage.setItem('miu_reader_indent', String(nextVal));
    } catch {}
  };

  const currentItem = greetingItems[currentIndex] || greetingItems[0] || {
    type: 'first_mes',
    index: 0,
    title: '首条消息',
    content: '',
  };

  // P1 Chapter Label formatting
  const p1ChapterLabel = useMemo(() => {
    if (currentIndex === 0) return '开场白 1';
    return `开场白 ${currentIndex + 1}`;
  }, [currentIndex]);

  // P1 Ending tag formatting
  const p1EndingLabel = useMemo(() => {
    if (currentIndex === 0) return '—— 首条消息 完 ——';
    return `—— 备用开场白 #${currentIndex} 完 ——`;
  }, [currentIndex]);

  // Rendered text with Regex & macros automatically applied
  const renderedText = useMemo(() => {
    return applyRegexToText(currentText, character, userName);
  }, [currentText, character, userName]);

  // Handle Save
  const handleSave = () => {
    onSaveGreeting(currentItem.type, currentItem.index, currentText);
    setIsDirty(false);
    setIsEditing(false);
  };

  // Handle Copy
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(renderedText || currentText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  // Navigate between greetings
  const handlePrev = () => {
    if (currentIndex > 0) {
      if (isDirty && !confirm('有未保存的内容，切换将丢失修改，是否继续？')) return;
      setSlideDirection('right');
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleNext = () => {
    if (currentIndex < greetingItems.length - 1) {
      if (isDirty && !confirm('有未保存的内容，切换将丢失修改，是否继续？')) return;
      setSlideDirection('left');
      setCurrentIndex(currentIndex + 1);
    }
  };

  // Touch gesture listeners for Swiping Left/Right
  const onTouchStart = (e: React.TouchEvent) => {
    if (isEditing) return;
    const touch = e.touches[0];
    touchStartXRef.current = touch.clientX;
    touchStartYRef.current = touch.clientY;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (isEditing || touchStartXRef.current === null || touchStartYRef.current === null) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartXRef.current;
    const dy = touch.clientY - touchStartYRef.current;

    // Detect horizontal swipe gesture (at least 45px distance and largely horizontal)
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < -45) {
        handleNext();
      } else if (dx > 45) {
        handlePrev();
      }
    }

    touchStartXRef.current = null;
    touchStartYRef.current = null;
  };

  // Clicking text or blank area toggles the exit & control bar (novel software style)
  const handleContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // Interactive tags (details, summary, links, buttons, spoilers)
    const interactiveTarget = target.closest(
      'a, button, summary, details, .spoiler, [data-jump], [data-target], [data-alt]'
    );

    if (interactiveTarget) {
      if (interactiveTarget.classList.contains('spoiler')) {
        interactiveTarget.classList.toggle('revealed');
        return;
      }

      if (interactiveTarget.tagName === 'SUMMARY' || interactiveTarget.tagName === 'DETAILS') {
        return;
      }

      const href =
        interactiveTarget.getAttribute('href') ||
        interactiveTarget.getAttribute('data-jump') ||
        interactiveTarget.getAttribute('data-target') ||
        interactiveTarget.getAttribute('data-alt');

      if (href) {
        const matchAlt = href.match(/(?:greeting|alt|branch|开场白|备用)[-_:]?(\d+)/i);
        if (matchAlt) {
          e.preventDefault();
          const targetNum = parseInt(matchAlt[1], 10);
          if (targetNum >= 0 && targetNum < greetingItems.length) {
            setSlideDirection(targetNum > currentIndex ? 'left' : 'right');
            setCurrentIndex(targetNum);
            return;
          }
        }

        if (href.startsWith('#')) {
          e.preventDefault();
          const targetId = href.slice(1);
          const el = document.getElementById(targetId) || document.querySelector(`[name="${targetId}"]`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
          }
        }
      }
      return;
    }

    // Tapping blank area / text toggles exit and reader chrome
    if (!isEditing) {
      setAreBarsVisible((prev) => !prev);
      setShowAaMenu(false);
      setShowCatalogDrawer(false);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
        return;
      }

      if (e.key === 'Escape') {
        if (showAaMenu) {
          setShowAaMenu(false);
          return;
        }
        if (showCatalogDrawer) {
          setShowCatalogDrawer(false);
          return;
        }
        if (isEditing) {
          if (isDirty && !confirm('有未保存的内容，确定要退出编辑吗？')) return;
          setIsEditing(false);
          return;
        }
        onClose();
        return;
      }

      const target = e.target as HTMLElement;
      const isInput = target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT';
      if (!isInput && !isEditing) {
        if (e.key === 'ArrowLeft') {
          handlePrev();
        } else if (e.key === 'ArrowRight') {
          handleNext();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDirty, isEditing, currentIndex, greetingItems.length, showAaMenu, showCatalogDrawer]);

  if (!isOpen) return null;

  const effectiveAvatar =
    avatarUrl ||
    (character.avatarBlob ? safeCreateObjectURL(character.avatarBlob) : null) ||
    getFallbackAvatar(character.name || character.id);

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16 }}
        style={{
          backgroundColor: currentTheme.bg,
        }}
        className="fixed inset-0 z-[150] flex flex-col items-center justify-center p-2 sm:p-4 md:p-6 select-none overflow-hidden"
      >
        {/* Custom Character CSS & Tavern Styles */}
        {customCss && <style dangerouslySetInnerHTML={{ __html: customCss }} />}

        <style>{`
          .tavern-think-details {
            margin: 1.25rem 0;
            padding: 0.5rem 0.85rem;
            border-radius: 1rem;
            background: ${currentTheme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'};
            border: 1px solid ${currentTheme.border};
            transition: all 0.2s ease;
          }
          .tavern-think-summary {
            cursor: pointer;
            font-size: 0.825rem;
            color: ${currentTheme.muted};
            user-select: none;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            list-style: none;
            font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
          }
          .tavern-think-summary::-webkit-details-marker {
            display: none;
          }
          .tavern-think-summary::after {
            content: "∨";
            font-size: 0.75rem;
            margin-left: 0.25rem;
            transition: transform 0.2s ease;
            opacity: 0.6;
          }
          .tavern-think-details[open] > .tavern-think-summary::after {
            transform: rotate(180deg);
          }
          .tavern-think-content {
            margin-top: 0.75rem;
            padding-top: 0.65rem;
            border-top: 1px dashed ${currentTheme.border};
            font-size: 0.875rem;
            color: ${currentTheme.muted};
            line-height: 1.7;
          }

          .reader-prose details:not(.tavern-think-details) {
            margin: 1rem 0;
            padding: 0.75rem 1rem;
            border-radius: 1rem;
            background: ${currentTheme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'};
            border: 1px solid ${currentTheme.border};
          }
          .reader-prose details:not(.tavern-think-details) summary {
            cursor: pointer;
            font-weight: 600;
            padding: 0.2rem 0;
            user-select: none;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            list-style: none;
          }
          .reader-prose details:not(.tavern-think-details) summary::-webkit-details-marker {
            display: none;
          }
          .reader-prose details:not(.tavern-think-details) summary::before {
            content: "▶";
            font-size: 0.75rem;
            display: inline-block;
            transition: transform 0.2s ease;
            opacity: 0.6;
          }
          .reader-prose details[open]:not(.tavern-think-details) > summary::before {
            transform: rotate(90deg);
          }
          .reader-prose p {
            margin-bottom: 1.15em;
            ${indentFirstLine ? 'text-indent: 2em;' : ''}
          }
          .reader-prose a {
            color: ${currentTheme.accent};
            text-decoration: underline;
            text-underline-offset: 3px;
            cursor: pointer;
          }
          .reader-prose button {
            cursor: pointer;
          }
          .reader-prose .spoiler {
            background: ${currentTheme.isDark ? '#38383a' : '#c8c8c8'};
            color: transparent;
            border-radius: 4px;
            padding: 0 4px;
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .reader-prose .spoiler.revealed,
          .reader-prose .spoiler:hover {
            background: transparent;
            color: inherit;
          }
          .reader-prose blockquote {
            border-left: 3px solid ${currentTheme.border};
            padding-left: 1rem;
            margin: 1.25rem 0;
            color: ${currentTheme.muted};
            font-style: italic;
          }
        `}</style>

        {/* 🌟 核心卡片容器：曲面屏安全边距 + 极简圆角卡片 (P1 同款居中优雅排版) */}
        <div
          style={{
            backgroundColor: currentTheme.cardBg,
            borderColor: currentTheme.border,
            color: currentTheme.text,
            fontFamily: currentFontConfig.style,
          }}
          className="w-full max-w-xl h-full rounded-[28px] sm:rounded-[36px] border shadow-2xl overflow-hidden relative flex flex-col transition-colors duration-200"
        >
          {/* 1. 小说软件式浮层：点击空白处才出现退出按钮与顶栏 (Tap Blank to Reveal Exit) */}
          <AnimatePresence>
            {areBarsVisible && (
              <motion.header
                initial={{ y: -50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -50, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  backgroundColor: currentTheme.barBg,
                  borderColor: currentTheme.border,
                }}
                className="absolute top-0 inset-x-0 h-14 px-4 sm:px-6 flex items-center justify-between z-30 border-b backdrop-blur-xl"
              >
                {/* 退出阅读按钮 (像小说软件那样) */}
                <button
                  onClick={() => {
                    if (isDirty && !confirm('有未保存的内容，确定要退出吗？')) return;
                    onClose();
                  }}
                  style={{ color: currentTheme.text }}
                  className="px-3 py-1.5 -ml-1 rounded-full bg-white/10 [.light-theme_&]:!bg-black/5 hover:bg-white/15 [.light-theme_&]:hover:!bg-black/10 transition flex items-center gap-1.5 active:scale-95 text-xs sm:text-sm font-semibold cursor-pointer shadow-xs"
                  title="退出全屏阅读"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>退出阅读</span>
                </button>

                {/* 章节序号展示 (2 / 20 ☰) */}
                <div
                  onClick={() => setShowCatalogDrawer(true)}
                  className="flex items-center gap-1.5 cursor-pointer px-2.5 py-1 rounded-full hover:bg-white/5 [.light-theme_&]:hover:!bg-black/5 transition"
                >
                  <span style={{ color: currentTheme.muted }} className="text-xs font-medium tabular-nums">
                    {currentIndex + 1} / {greetingItems.length}
                  </span>
                  <List className="w-3.5 h-3.5 opacity-60" />
                </div>

                {/* 右侧微调：字号设置与编辑 (T ✎) */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setShowAaMenu(!showAaMenu)}
                    style={{ color: showAaMenu ? currentTheme.accent : currentTheme.muted }}
                    className="p-1.5 rounded-full hover:bg-white/5 [.light-theme_&]:hover:!bg-black/5 transition active:scale-95"
                    title="字号排版与主题"
                  >
                    <Type className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => setIsEditing(!isEditing)}
                    style={{ color: isEditing ? currentTheme.accent : currentTheme.muted }}
                    className="p-1.5 rounded-full hover:bg-white/5 [.light-theme_&]:hover:!bg-black/5 transition active:scale-95"
                    title="编辑正文"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                </div>
              </motion.header>
            )}
          </AnimatePresence>

          {/* 2. 主阅读内容区 (重点：曲面屏两边留白安全距离 px-8 sm:px-14 md:px-16，字不贴边) */}
          <main
            ref={scrollContainerRef}
            onClick={handleContentClick}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            className="flex-1 overflow-y-auto px-8 sm:px-14 md:px-16 custom-scrollbar select-text"
          >
            <div className="w-full min-h-full flex flex-col justify-between">
              {/* 🌟 P1 同款美化头部排版 (Circular Avatar, Name, Chapter Label, Dashed Line) */}
              <div className="pt-16 sm:pt-22 pb-6 sm:pb-8 flex flex-col items-center text-center">
                {/* 1. 圆形精致头像 (P1 同款圆形圆角) */}
                <div className="relative mb-3.5 group">
                  <img
                    src={effectiveAvatar}
                    alt={character.name}
                    className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover shadow-xl border-2 ring-4 ring-white/5 [.light-theme_&]:!ring-black/5"
                    style={{ borderColor: currentTheme.border }}
                  />
                </div>

                {/* 2. 角色名字 (P1 一之濑亚子 风格，淡蓝/柔紫优雅色泽) */}
                <h2
                  style={{
                    color: currentTheme.isDark ? currentTheme.accent : '#2563eb',
                  }}
                  className="text-xl sm:text-2xl font-bold tracking-wider mb-2 transition-colors"
                >
                  {character.name || '角色'}
                </h2>

                {/* 3. 开场白编号副标题 (P1 开场白1 风格) */}
                <div
                  style={{ color: currentTheme.muted }}
                  className="text-xs sm:text-sm font-medium tracking-widest opacity-80 mb-2 font-sans"
                >
                  {p1ChapterLabel}
                </div>

                {/* 4. 极简虚线分隔线 (P1 同款细虚线) */}
                <div
                  style={{ borderColor: currentTheme.border }}
                  className="w-44 sm:w-60 mx-auto border-b border-dashed opacity-40 my-3"
                />
              </div>

              {/* 编辑模式 vs 阅读正文 */}
              {isEditing ? (
                <div className="flex-1 flex flex-col min-h-[55vh]">
                  <textarea
                    value={currentText}
                    onChange={(e) => {
                      setCurrentText(e.target.value);
                      setIsDirty(true);
                    }}
                    style={{
                      backgroundColor: currentTheme.isDark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.03)',
                      borderColor: currentTheme.border,
                      color: currentTheme.text,
                      fontSize: `${currentSizeConfig.px}px`,
                      lineHeight: currentSizeConfig.lineHeight,
                    }}
                    placeholder="在此编辑开场白正文内容..."
                    className="w-full flex-1 min-h-[50vh] p-4 sm:p-6 rounded-2xl border outline-none resize-none shadow-inner font-sans"
                    autoFocus
                  />
                  <div className="flex items-center justify-between mt-3 text-xs pb-4">
                    <span style={{ color: currentTheme.muted }}>Ctrl+S 快速保存</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setCurrentText(currentItem.content);
                          setIsDirty(false);
                          setIsEditing(false);
                        }}
                        style={{ color: currentTheme.muted }}
                        className="px-3 py-1.5 rounded-xl hover:bg-white/5 [.light-theme_&]:hover:!bg-black/5 transition"
                      >
                        取消
                      </button>
                      <button
                        onClick={handleSave}
                        className="px-4 py-1.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-500 transition shadow-sm"
                      >
                        保存修改
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* 5. 正文区域 (P1 同款排版，两边充分留白，曲面屏绝对不贴边) */
                <article
                  style={{
                    fontSize: `${currentSizeConfig.px}px`,
                    lineHeight: currentSizeConfig.lineHeight,
                  }}
                  className="reader-prose w-full break-words transition-all text-justify"
                >
                  {renderedText ? (
                    <MessageContent content={renderedText} />
                  ) : (
                    <div
                      style={{ color: currentTheme.muted }}
                      className="flex flex-col items-center justify-center py-20 text-center"
                    >
                      <BookOpen className="w-10 h-10 mb-3 opacity-30 stroke-[1.2]" />
                      <p className="text-sm">此开场白内容为空</p>
                    </div>
                  )}
                </article>
              )}

              {/* 6. P1 同款尾部完结标识 (—— 备用开场白 #1 完 ——) */}
              {!isEditing && renderedText && (
                <div
                  style={{ color: currentTheme.muted }}
                  className="mt-14 mb-16 flex flex-col items-center text-center gap-2 text-xs opacity-50 font-sans tracking-widest select-none"
                >
                  <span>{p1EndingLabel}</span>
                  <span className="text-[10px] opacity-60 font-light">
                    左划 / 右滑切换开场白 · 轻触空白退出
                  </span>
                </div>
              )}
            </div>
          </main>

          {/* 3. Aa 设置浮层 (点空白唤出顶栏时可选) */}
          <AnimatePresence>
            {showAaMenu && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -10 }}
                transition={{ duration: 0.15 }}
                style={{
                  backgroundColor: currentTheme.barBg,
                  borderColor: currentTheme.border,
                  color: currentTheme.text,
                }}
                className="absolute top-16 right-4 w-72 p-4 rounded-3xl shadow-2xl border backdrop-blur-2xl z-40 flex flex-col gap-3.5"
              >
                {/* 字号调节 */}
                <div className="flex items-center justify-between">
                  <span style={{ color: currentTheme.muted }} className="text-xs font-medium">
                    字号
                  </span>
                  <div
                    style={{ backgroundColor: currentTheme.isDark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.03)' }}
                    className="flex items-center rounded-2xl p-1 border border-white/5 dark:border-black/5"
                  >
                    <button
                      onClick={() => handleSetFontSizeIndex(fontSizeIndex - 1)}
                      disabled={fontSizeIndex === 0}
                      className="px-2.5 py-0.5 text-xs font-medium disabled:opacity-30 hover:opacity-100 transition"
                    >
                      A-
                    </button>
                    <span className="px-2 text-xs font-semibold tabular-nums">
                      {currentSizeConfig.px}px
                    </span>
                    <button
                      onClick={() => handleSetFontSizeIndex(fontSizeIndex + 1)}
                      disabled={fontSizeIndex === FONT_SIZES.length - 1}
                      className="px-2.5 py-0.5 text-sm font-semibold disabled:opacity-30 hover:opacity-100 transition"
                    >
                      A+
                    </button>
                  </div>
                </div>

                {/* 字体选择 */}
                <div className="flex items-center justify-between">
                  <span style={{ color: currentTheme.muted }} className="text-xs font-medium">
                    字体
                  </span>
                  <div
                    style={{ backgroundColor: currentTheme.isDark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.03)' }}
                    className="flex items-center gap-1 rounded-2xl p-1 border border-white/5 dark:border-black/5"
                  >
                    {(Object.keys(FONTS) as ReaderFont[]).map((fKey) => (
                      <button
                        key={fKey}
                        onClick={() => handleSetFont(fKey)}
                        className={`px-2.5 py-0.5 rounded-xl text-xs font-medium transition ${
                          font === fKey
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'opacity-70 hover:opacity-100'
                        }`}
                        style={{ fontFamily: FONTS[fKey].style }}
                      >
                        {FONTS[fKey].name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 背景主题调色盘 (包含 P1 纯白与纯黑) */}
                <div className="flex items-center justify-between">
                  <span style={{ color: currentTheme.muted }} className="text-xs font-medium">
                    配色
                  </span>
                  <div className="flex items-center gap-2">
                    {(Object.keys(THEMES) as ReaderTheme[]).map((tKey) => {
                      const t = THEMES[tKey];
                      const isSelected = theme === tKey;
                      return (
                        <button
                          key={tKey}
                          onClick={() => handleSetTheme(tKey)}
                          style={{
                            backgroundColor: t.cardBg,
                            borderColor: isSelected ? currentTheme.accent : t.border,
                          }}
                          className={`w-6 h-6 rounded-full border-2 transition-all flex items-center justify-center shadow-xs ${
                            isSelected ? 'ring-2 ring-blue-500/40 scale-110' : 'opacity-85'
                          }`}
                          title={t.name}
                        >
                          {isSelected && (
                            <Check
                              className="w-3 h-3"
                              style={{
                                color: tKey === 'light' || tKey === 'sepia' ? '#111' : '#fff',
                              }}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 首行缩进 */}
                <div className="flex items-center justify-between pt-1 border-t border-white/5 [.light-theme_&]:!border-black/5">
                  <span style={{ color: currentTheme.muted }} className="text-xs font-medium">
                    首行缩进 (空两格)
                  </span>
                  <button
                    onClick={handleToggleIndent}
                    style={{
                      backgroundColor: indentFirstLine ? currentTheme.accent : 'transparent',
                      color: indentFirstLine ? '#fff' : currentTheme.muted,
                    }}
                    className="px-2.5 py-0.5 rounded-xl text-xs font-medium border border-white/10 dark:border-black/10 transition"
                  >
                    {indentFirstLine ? '已开' : '关'}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 4. 侧边目录抽屉 (Catalog / TOC Drawer) */}
          <AnimatePresence>
            {showCatalogDrawer && (
              <div
                onClick={() => setShowCatalogDrawer(false)}
                className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-start items-stretch rounded-[28px] sm:rounded-[36px] overflow-hidden"
              >
                <motion.div
                  initial={{ x: '-100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '-100%' }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    backgroundColor: currentTheme.barBg,
                    borderColor: currentTheme.border,
                    color: currentTheme.text,
                  }}
                  className="w-full max-w-xs h-full border-r shadow-2xl backdrop-blur-2xl flex flex-col"
                >
                  <div
                    style={{ borderColor: currentTheme.border }}
                    className="flex items-center justify-between px-5 py-4 border-b"
                  >
                    <div className="flex items-center gap-2">
                      <List className="w-4 h-4 text-blue-400" />
                      <h3 className="font-bold text-sm">开场白目录</h3>
                      <span
                        style={{ color: currentTheme.muted }}
                        className="text-xs tabular-nums opacity-75"
                      >
                        ({greetingItems.length})
                      </span>
                    </div>
                    <button
                      onClick={() => setShowCatalogDrawer(false)}
                      style={{ color: currentTheme.muted }}
                      className="p-1.5 rounded-full hover:bg-white/10 [.light-theme_&]:hover:!bg-black/10 transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3 space-y-1.5 custom-scrollbar">
                    {greetingItems.map((item, idx) => {
                      const isSelected = idx === currentIndex;
                      const previewSnippet =
                        item.content.trim().slice(0, 50).replace(/\s+/g, ' ') || '（暂无正文）';

                      return (
                        <div
                          key={idx}
                          onClick={() => {
                            setSlideDirection(idx > currentIndex ? 'left' : 'right');
                            setCurrentIndex(idx);
                            setShowCatalogDrawer(false);
                          }}
                          style={{
                            backgroundColor: isSelected
                              ? currentTheme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'
                              : 'transparent',
                            borderColor: isSelected
                              ? currentTheme.accent
                              : 'transparent',
                          }}
                          className={`p-3 rounded-2xl border transition cursor-pointer group flex flex-col gap-1 ${
                            isSelected ? 'shadow-xs' : 'hover:bg-white/5 [.light-theme_&]:hover:!bg-black/5'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-xs font-semibold truncate ${
                                isSelected ? 'text-blue-400' : ''
                              }`}
                            >
                              {item.title}
                            </span>
                            <span
                              style={{ color: currentTheme.muted }}
                              className="text-[10px] tabular-nums opacity-70"
                            >
                              {item.content.length} 字
                            </span>
                          </div>
                          <p
                            style={{ color: currentTheme.muted }}
                            className="text-[11px] line-clamp-2 leading-relaxed opacity-80"
                          >
                            {previewSnippet}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
