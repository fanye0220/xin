import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, ChevronLeft, ChevronRight, Edit3, Check, Copy, 
  Sliders, Sun, Moon, Coffee, Palette, 
  Plus, Star, Trash2, CheckCircle2, BookOpen, Sparkles,
  Code, MessageSquareText
} from 'lucide-react';
import { CharacterCard } from '../lib/db';
import { resolveAvatarUrl, getFallbackAvatar } from '../lib/avatar';
import { useBackHandler } from '../lib/useBackHandler';
import { MessageContent } from './MessageContent';
import { applyRegexToText, extractCharacterStyles } from '../lib/regexEngine';

export interface GreetingReaderSettings {
  highlightDialogue: boolean;
  highlightSoftBg: boolean;
  colorTheme: 'sky' | 'violet' | 'rose' | 'emerald' | 'amber';
  fontSize: number; // 14, 16, 18, 20, 22
  lineHeight: 'normal' | 'relaxed' | 'loose';
  readerTheme: 'paper' | 'dark' | 'tavern' | 'sepia';
  enableMarkdown: boolean; // 是否启用 Markdown 与富文本渲染
  enableMacros: boolean; // 是否开启宏与角色正则 ({{char}}, {{user}})
  enableCustomTags: boolean; // 是否开启思维链与标签折叠 (<think>)
}

const DEFAULT_SETTINGS: GreetingReaderSettings = {
  highlightDialogue: true,
  highlightSoftBg: false,
  colorTheme: 'sky',
  fontSize: 17,
  lineHeight: 'relaxed',
  readerTheme: 'dark',
  enableMarkdown: true,
  enableMacros: true,
  enableCustomTags: true,
};

const STORAGE_KEY = 'miu_greeting_reader_settings';

function loadSettings(): GreetingReaderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch (e) {
    // Ignore error
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(settings: GreetingReaderSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    // Ignore error
  }
}

interface TextSegment {
  type: 'dialogue' | 'action' | 'thought' | 'text';
  content: string;
}

/**
 * Parses a paragraph into dialogue quotes, asterisk actions, parentheses thoughts, and narrative text.
 */
function parseParagraphTokens(text: string): TextSegment[] {
  if (!text) return [];

  // Match:
  // 1. Chinese/Japanese/English quotation pairs: “...”, ‘...’, 「...」, 『...』, "...", 〝...〞
  // 2. Asterisk actions/descriptions: *...*
  // 3. Parentheses thoughts: （...）
  const pattern = /(“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|〝[^〞]*〞|"[^"\n]+"|\*[^*]+\*|（[^）]*）)/g;

  const tokens: TextSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        type: 'text',
        content: text.substring(lastIndex, match.index),
      });
    }

    const matched = match[0];
    if (matched.startsWith('*') && matched.endsWith('*') && matched.length >= 2) {
      tokens.push({
        type: 'action',
        content: matched,
      });
    } else if (matched.startsWith('（') && matched.endsWith('）')) {
      tokens.push({
        type: 'thought',
        content: matched,
      });
    } else {
      tokens.push({
        type: 'dialogue',
        content: matched,
      });
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({
      type: 'text',
      content: text.substring(lastIndex),
    });
  }

  return tokens;
}

/**
 * Safely applies dialogue highlight styling to quotation pairs within Markdown text
 * without ever touching HTML tags, attributes, <style>, <script>, or code blocks
 */
function applySafeDialogueHighlight(text: string, highlightClass: string): string {
  if (!highlightClass || !text) return text;
  // Split by HTML tags and code blocks so we NEVER touch HTML attributes, styles or scripts
  const parts = text.split(/(<script[\s\S]*?<\/script\s*>|<style[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->|<[^>]+>|```[\s\S]*?```|`[^`]+`)/gi);
  return parts.map((part) => {
    if (!part) return '';
    if (part.startsWith('<') || part.startsWith('`')) {
      return part; // keep HTML tags and code blocks completely untouched!
    }
    // Safely highlight Chinese and Japanese quotation pairs: “...”, 「...」, 『...』, 〝...〞, ‘...’
    return part.replace(/(“[^”\n]*”|「[^」\n]*」|『[^』\n]*』|〝[^〞\n]*〞|‘[^’\n]*’)/g, `<span class="${highlightClass}">$1</span>`);
  }).join('');
}

/**
 * Custom smooth animated iOS switch toggle that matches the active theme
 */
function ThemedSwitch({
  checked,
  onChange,
  activeColor,
  isLight,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  activeColor: string;
  isLight: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none"
      style={{
        backgroundColor: checked 
          ? activeColor 
          : isLight 
            ? 'rgba(0, 0, 0, 0.16)' 
            : 'rgba(255, 255, 255, 0.2)',
      }}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className="pointer-events-none inline-block h-5 w-5 rounded-full shadow-md transition-transform"
        style={{
          backgroundColor: '#ffffff',
          transform: checked ? 'translateX(20px)' : 'translateX(0px)',
        }}
      />
    </button>
  );
}

interface GreetingReaderModalProps {
  isOpen: boolean;
  character: CharacterCard;
  avatarUrl?: string | null;
  initialIndex?: number;
  onClose: () => void;
  onUpdateGreeting?: (firstMes: string, altGreetings: string[]) => Promise<void> | void;
}

export function GreetingReaderModal({
  isOpen,
  character,
  avatarUrl,
  initialIndex = 0,
  onClose,
  onUpdateGreeting,
}: GreetingReaderModalProps) {
  // Read current greetings from character card data
  const dataObj = character.data || {};
  const charData = dataObj.data || dataObj;
  
  const firstMes: string = charData.first_mes || '';
  const altGreetings: string[] = useMemo(() => {
    const list = charData.alternate_greetings;
    return Array.isArray(list) ? list : [];
  }, [charData.alternate_greetings]);

  // Combined greetings list: [first_mes, ...altGreetings]
  const greetingsList = useMemo(() => {
    const list: {
      isFirst: boolean;
      altIndex: number;
      label: string;
      title: string;
      content: string;
    }[] = [];

    // Always push first message (even if empty)
    list.push({
      isFirst: true,
      altIndex: -1,
      label: '首条开场白',
      title: '开场白 1',
      content: firstMes,
    });

    // Push alternate greetings
    altGreetings.forEach((alt, idx) => {
      list.push({
        isFirst: false,
        altIndex: idx,
        label: `备用开场白 #${idx + 1}`,
        title: `备用开场白 ${idx + 1}`,
        content: alt || '',
      });
    });

    return list;
  }, [firstMes, altGreetings]);

  // Current active greeting index
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  // Settings
  const [settings, setSettings] = useState<GreetingReaderSettings>(loadSettings);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [showGreetingPicker, setShowGreetingPicker] = useState(false);

  // Immersive controls toggle: clicking blank canvas hides/shows top & bottom bars
  const [showControls, setShowControls] = useState(true);

  // In-reader editing mode
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  // Toast feedback & Page turn cues
  const [copyToast, setCopyToast] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [turnFeedback, setTurnFeedback] = useState<'prev' | 'next' | null>(null);

  // Scroll container ref
  const containerRef = useRef<HTMLDivElement>(null);
  const pointerStartPos = useRef<{ x: number; y: number; time: number } | null>(null);

  // Sync initialIndex when modal opens or initialIndex changes
  useEffect(() => {
    if (isOpen) {
      const target = Math.max(0, Math.min(initialIndex, greetingsList.length - 1));
      setCurrentIndex(target);
      setIsEditing(false);
      setShowSettingsDrawer(false);
      setShowGreetingPicker(false);
      setShowControls(true);
    }
  }, [isOpen, initialIndex, greetingsList.length]);

  // Save settings when changed
  const updateSetting = <K extends keyof GreetingReaderSettings>(
    key: K,
    value: GreetingReaderSettings[K]
  ) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveSettings(next);
      return next;
    });
  };

  // Safe index within bounds
  const safeIndex = Math.max(0, Math.min(currentIndex, greetingsList.length - 1));
  const currentGreeting = greetingsList[safeIndex] || greetingsList[0];

  // Listen for greeting jump messages from HTML iframe or interactive choice cards
  useEffect(() => {
    const handleJumpMessage = (event: MessageEvent) => {
      if (
        (event.data?.type === 'jump_greeting' || event.data?.type === 'set_greeting' || event.data?.type === 'select_greeting') &&
        typeof event.data?.targetIndex === 'number'
      ) {
        let rawIdx = event.data.targetIndex;
        // In SillyTavern, 1-indexed Option 1 usually corresponds to alternate_greetings[0] (index 1 in greetingsList)
        // Check if rawIdx is within [0, greetingsList.length - 1]
        let targetIdx = rawIdx;
        if (targetIdx >= 0 && targetIdx < greetingsList.length) {
          setCurrentIndex(targetIdx);
          const targetTitle = greetingsList[targetIdx]?.title || `开场白 #${targetIdx + 1}`;
          setActionFeedback(`已跳转至：${targetTitle}`);
          setTimeout(() => setActionFeedback(null), 2200);
        } else if (targetIdx > 0 && targetIdx - 1 < greetingsList.length) {
          // If rawIdx is 1-based index (e.g. 1st greeting is index 0)
          setCurrentIndex(targetIdx - 1);
          const targetTitle = greetingsList[targetIdx - 1]?.title || `开场白 #${targetIdx}`;
          setActionFeedback(`已跳转至：${targetTitle}`);
          setTimeout(() => setActionFeedback(null), 2200);
        }
      }
    };

    window.addEventListener('message', handleJumpMessage);
    return () => window.removeEventListener('message', handleJumpMessage);
  }, [greetingsList]);

  // Scroll to top when switching greetings
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [safeIndex]);

  // Handle hardware / gesture back button
  useBackHandler(isOpen, () => {
    if (showSettingsDrawer) {
      setShowSettingsDrawer(false);
      return true;
    }
    if (showGreetingPicker) {
      setShowGreetingPicker(false);
      return true;
    }
    if (isEditing) {
      setIsEditing(false);
      return true;
    }
    onClose();
    return true;
  });

  // Keyboard navigation: Left/Right arrow to switch, Escape to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditing) return; // Don't intercept when typing in editor

      if (e.key === 'Escape') {
        if (showSettingsDrawer) setShowSettingsDrawer(false);
        else if (showGreetingPicker) setShowGreetingPicker(false);
        else onClose();
      } else if (e.key === 'ArrowLeft') {
        setCurrentIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        setCurrentIndex((prev) => Math.min(greetingsList.length - 1, prev + 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isEditing, greetingsList.length, showSettingsDrawer, showGreetingPicker, onClose]);

  // Novel reader 3-zone tap & swipe handling: Left 30% prev, Middle 40% menu toggle, Right 30% next
  const handlePointerDown = (e: React.PointerEvent) => {
    pointerStartPos.current = { x: e.clientX, y: e.clientY, time: Date.now() };
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!pointerStartPos.current) return;
    const startX = pointerStartPos.current.x;
    const startY = pointerStartPos.current.y;
    const endX = e.clientX;
    const endY = e.clientY;
    const dx = endX - startX;
    const dy = endY - startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    pointerStartPos.current = null;

    if (isEditing) return;

    // Check if clicked element was an interactive button, link, form control, or popover
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, [role="button"], .pointer-events-auto')) {
      return;
    }

    // Horizontal Swipe Gesture Detection (> 35px horizontal drag)
    if (absDx > 35 && absDx > absDy * 1.4) {
      if (dx < 0) {
        // Swipe Left -> Next Greeting
        if (safeIndex < greetingsList.length - 1) {
          setCurrentIndex((prev) => prev + 1);
          setTurnFeedback('next');
          setTimeout(() => setTurnFeedback(null), 1000);
        } else {
          setActionFeedback('已是最后一条开场白');
          setTimeout(() => setActionFeedback(null), 1800);
        }
      } else {
        // Swipe Right -> Prev Greeting
        if (safeIndex > 0) {
          setCurrentIndex((prev) => prev - 1);
          setTurnFeedback('prev');
          setTimeout(() => setTurnFeedback(null), 1000);
        } else {
          setActionFeedback('已是第一条开场白');
          setTimeout(() => setActionFeedback(null), 1800);
        }
      }
      return;
    }

    // Clean Tap Detection (< 10px movement)
    if (absDx < 10 && absDy < 10) {
      const width = window.innerWidth || document.documentElement.clientWidth || 360;
      const relativeX = endX / width;

      if (relativeX < 0.3) {
        // Left 30%: Previous Greeting Page
        if (safeIndex > 0) {
          setCurrentIndex((prev) => prev - 1);
          setTurnFeedback('prev');
          setTimeout(() => setTurnFeedback(null), 1000);
        } else {
          setActionFeedback('已是第一条开场白');
          setTimeout(() => setActionFeedback(null), 1800);
        }
      } else if (relativeX > 0.7) {
        // Right 30%: Next Greeting Page
        if (safeIndex < greetingsList.length - 1) {
          setCurrentIndex((prev) => prev + 1);
          setTurnFeedback('next');
          setTimeout(() => setTurnFeedback(null), 1000);
        } else {
          setActionFeedback('已是最后一条开场白');
          setTimeout(() => setActionFeedback(null), 1800);
        }
      } else {
        // Middle 40%: Toggle Menu Overlay (Edit, Close, Settings)
        setShowControls((v) => !v);
      }
    }
  };

  // Copy current greeting
  const handleCopy = () => {
    const textToCopy = currentGreeting.content || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        setCopyToast(true);
        setTimeout(() => setCopyToast(false), 2000);
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = textToCopy;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopyToast(true);
      setTimeout(() => setCopyToast(false), 2000);
    }
  };

  // Start editing
  const handleStartEdit = () => {
    setEditValue(currentGreeting.content || '');
    setIsEditing(true);
    setShowControls(true);
  };

  // Save edit
  const handleSaveEdit = async () => {
    if (!onUpdateGreeting) {
      setIsEditing(false);
      return;
    }

    if (currentGreeting.isFirst) {
      await onUpdateGreeting(editValue, altGreetings);
    } else {
      const newAlt = [...altGreetings];
      newAlt[currentGreeting.altIndex] = editValue;
      await onUpdateGreeting(firstMes, newAlt);
    }

    setIsEditing(false);
    setActionFeedback('已保存正文修改');
    setTimeout(() => setActionFeedback(null), 2000);
  };

  // Promote current alternate greeting to first message
  const handlePromoteToFirst = async () => {
    if (!onUpdateGreeting || currentGreeting.isFirst) return;

    const promotedContent = currentGreeting.content;
    const oldFirst = firstMes;
    const newAlt = altGreetings.filter((_, idx) => idx !== currentGreeting.altIndex);
    if (oldFirst && oldFirst.trim()) {
      newAlt.unshift(oldFirst);
    }

    await onUpdateGreeting(promotedContent, newAlt);
    setCurrentIndex(0);
    setActionFeedback('已设为默认首条开场白');
    setTimeout(() => setActionFeedback(null), 2500);
  };

  // Delete current alternate greeting
  const handleDeleteCurrent = async () => {
    if (!onUpdateGreeting || currentGreeting.isFirst) return;
    if (!confirm(`确定要删除“${currentGreeting.title}”吗？此操作无法撤销。`)) return;

    const newAlt = altGreetings.filter((_, idx) => idx !== currentGreeting.altIndex);
    await onUpdateGreeting(firstMes, newAlt);
    setCurrentIndex((prev) => Math.max(0, prev - 1));
    setActionFeedback('已删除备用开场白');
    setTimeout(() => setActionFeedback(null), 2000);
  };

  // Add new alternate greeting
  const handleAddNew = async () => {
    if (!onUpdateGreeting) return;
    const newAlt = [...altGreetings, ''];
    await onUpdateGreeting(firstMes, newAlt);
    setCurrentIndex(newAlt.length);
    setIsEditing(true);
    setShowControls(true);
    setEditValue('');
  };

  // Handle clicking choice cards or links directly in Markdown view
  const handleContainerClick = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest('a, button, [data-index], [data-greeting], [data-target], .cyoa-card, .choice-card, .fate-card, .option-card, .branch-card');
    if (!target) return;

    const href = target.getAttribute('href') || '';
    const dataTarget = target.getAttribute('data-target') || target.getAttribute('data-index') || target.getAttribute('data-greeting');
    const text = ((target as HTMLElement).innerText || target.textContent || '').trim();

    let targetIdx: number | null = null;
    if (dataTarget && !isNaN(parseInt(dataTarget))) {
      targetIdx = parseInt(dataTarget);
    } else if (href && /#?(?:greeting|branch|swipe|opt)[-_]?(\d+)/i.test(href)) {
      const m = href.match(/#?(?:greeting|branch|swipe|opt)[-_]?(\d+)/i);
      if (m) targetIdx = parseInt(m[1]);
    } else if (href && /^#(\d+)$/.test(href)) {
      targetIdx = parseInt(href.substring(1));
    } else {
      const numMatch = text.match(/(?:^|[^\d])([1-9]\d?)[.、\s]/);
      if (numMatch) {
        targetIdx = parseInt(numMatch[1]);
      }
    }

    if (targetIdx !== null) {
      e.preventDefault();
      e.stopPropagation();
      let finalIdx = targetIdx;
      if (finalIdx >= 0 && finalIdx < greetingsList.length) {
        setCurrentIndex(finalIdx);
        setActionFeedback(`已跳转至：${greetingsList[finalIdx]?.title || `开场白 #${finalIdx + 1}`}`);
        setTimeout(() => setActionFeedback(null), 2200);
      } else if (finalIdx > 0 && finalIdx - 1 < greetingsList.length) {
        setCurrentIndex(finalIdx - 1);
        setActionFeedback(`已跳转至：${greetingsList[finalIdx - 1]?.title || `开场白 #${finalIdx}`}`);
        setTimeout(() => setActionFeedback(null), 2200);
      }
    }
  };

  // Active theme properties
  const isPaper = settings.readerTheme === 'paper';
  const isDark = settings.readerTheme === 'dark';
  const isTavern = settings.readerTheme === 'tavern';
  const isSepia = settings.readerTheme === 'sepia';
  const isLight = isPaper || isSepia;

  // Theme definition palette - 100% explicit styles
  const themeStyles = useMemo(() => {
    if (isPaper) {
      return {
        bg: '#ffffff',
        text: '#0f172a', // Rich readable charcoal black
        name: '#0284c7', // Sky Blue 600
        subtitle: '#0284c7',
        dashed: '#7dd3fc',
        action: '#475569',
        thought: '#64748b',
        footer: '#0284c7',
        headerBg: 'rgba(255, 255, 255, 0.95)',
        headerBorder: '#e2e8f0',
        headerText: '#0f172a',
        headerBtnHover: 'hover:bg-black/[0.06] active:bg-black/[0.1]',
        primaryBtnBg: '#0284c7',
        primaryBtnText: '#ffffff',
        primaryBtnHover: 'hover:bg-sky-600',
        cancelBtnBg: 'rgba(0, 0, 0, 0.04)',
        cancelBtnBorder: '#cbd5e1',
        cancelBtnText: '#0f172a',
        cancelBtnHover: 'hover:bg-black/[0.08]',
        floatingBarBg: 'rgba(255, 255, 255, 0.96)',
        floatingBarBorder: '#cbd5e1',
        floatingBarText: '#0f172a',
        floatingBarShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.08)',
        floatingBarDivider: '#e2e8f0',
        floatingBarBtnHover: 'hover:bg-black/[0.06] active:bg-black/[0.1]',
        floatingBarAddBtn: 'text-sky-600 hover:bg-sky-500/10 active:bg-sky-500/20',
        drawerBg: '#ffffff',
        drawerBorder: '#e2e8f0',
        drawerText: '#0f172a',
        drawerCardBg: '#f8fafc',
        drawerCardBorder: '#e2e8f0',
        drawerSubText: '#64748b',
        drawerBtnBg: '#f1f5f9',
        drawerBtnBorder: '#cbd5e1',
        drawerBtnHover: 'hover:bg-black/[0.06] active:bg-black/[0.1]',
        themeAccentColor: '#0284c7',
      };
    }
    if (isSepia) {
      return {
        bg: '#fbf7ee',
        text: '#2d2417',
        name: '#8b4513',
        subtitle: '#a0522d',
        dashed: 'rgba(199, 178, 153, 0.8)',
        action: '#786851',
        thought: '#786851',
        footer: '#9c8e79',
        headerBg: 'rgba(251, 247, 238, 0.95)',
        headerBorder: '#e5d8c5',
        headerText: '#2d2417',
        headerBtnHover: 'hover:bg-black/[0.06] active:bg-black/[0.1]',
        primaryBtnBg: '#8b4513',
        primaryBtnText: '#ffffff',
        primaryBtnHover: 'hover:bg-[#a0522d]',
        cancelBtnBg: 'rgba(0, 0, 0, 0.04)',
        cancelBtnBorder: '#dfd1bd',
        cancelBtnText: '#2d2417',
        cancelBtnHover: 'hover:bg-black/[0.08]',
        floatingBarBg: 'rgba(251, 247, 238, 0.96)',
        floatingBarBorder: '#dfd1bd',
        floatingBarText: '#2d2417',
        floatingBarShadow: '0 10px 25px -5px rgba(80, 50, 20, 0.1)',
        floatingBarDivider: '#dfd1bd',
        floatingBarBtnHover: 'hover:bg-black/[0.06] active:bg-black/[0.1]',
        floatingBarAddBtn: 'text-[#8b4513] hover:bg-[#8b4513]/10 active:bg-[#8b4513]/20',
        drawerBg: '#fbf7ee',
        drawerBorder: '#e5d8c5',
        drawerText: '#2d2417',
        drawerCardBg: '#f4ecdc',
        drawerCardBorder: '#e0d1bb',
        drawerSubText: '#786851',
        drawerBtnBg: '#ede2ce',
        drawerBtnBorder: '#dfd1bd',
        drawerBtnHover: 'hover:bg-black/[0.06] active:bg-black/[0.1]',
        themeAccentColor: '#8b4513',
      };
    }
    if (isTavern) {
      return {
        bg: '#0f1420',
        text: '#f8fafc',
        name: '#818cf8',
        subtitle: '#818cf8',
        dashed: 'rgba(129, 140, 248, 0.4)',
        action: '#a5b4fc',
        thought: '#a5b4fc',
        footer: '#6366f1',
        headerBg: 'rgba(15, 20, 32, 0.92)',
        headerBorder: 'rgba(99, 102, 241, 0.25)',
        headerText: '#e0e7ff',
        headerBtnHover: 'hover:bg-white/[0.08] active:bg-white/[0.12]',
        primaryBtnBg: '#6366f1',
        primaryBtnText: '#ffffff',
        primaryBtnHover: 'hover:bg-[#818cf8]',
        cancelBtnBg: 'rgba(99, 102, 241, 0.12)',
        cancelBtnBorder: 'rgba(99, 102, 241, 0.3)',
        cancelBtnText: '#e0e7ff',
        cancelBtnHover: 'hover:bg-indigo-500/20',
        floatingBarBg: 'rgba(23, 31, 48, 0.92)',
        floatingBarBorder: 'rgba(99, 102, 241, 0.25)',
        floatingBarText: '#e0e7ff',
        floatingBarShadow: '0 15px 35px -5px rgba(0, 0, 0, 0.8)',
        floatingBarDivider: 'rgba(99, 102, 241, 0.3)',
        floatingBarBtnHover: 'hover:bg-white/[0.08] active:bg-white/[0.12]',
        floatingBarAddBtn: 'text-indigo-400 hover:bg-indigo-500/20 active:bg-indigo-500/30',
        drawerBg: '#141b2b',
        drawerBorder: 'rgba(99, 102, 241, 0.25)',
        drawerText: '#e0e7ff',
        drawerCardBg: 'rgba(255, 255, 255, 0.04)',
        drawerCardBorder: 'rgba(99, 102, 241, 0.15)',
        drawerSubText: '#94a3b8',
        drawerBtnBg: 'rgba(99, 102, 241, 0.1)',
        drawerBtnBorder: 'rgba(99, 102, 241, 0.2)',
        drawerBtnHover: 'hover:bg-white/[0.08] active:bg-white/[0.12]',
        themeAccentColor: '#818cf8',
      };
    }
    // Default Dark Night
    return {
      bg: '#111216',
      text: '#f1f5f9',
      name: '#38bdf8',
      subtitle: '#38bdf8',
      dashed: 'rgba(56, 189, 248, 0.4)',
      action: '#94a3b8',
      thought: '#94a3b8',
      footer: '#64748b',
      headerBg: 'rgba(17, 18, 22, 0.92)',
      headerBorder: 'rgba(255, 255, 255, 0.08)',
      headerText: '#f1f5f9',
      headerBtnHover: 'hover:bg-white/[0.08] active:bg-white/[0.12]',
      primaryBtnBg: '#0284c7',
      primaryBtnText: '#ffffff',
      primaryBtnHover: 'hover:bg-sky-500',
      cancelBtnBg: 'rgba(255, 255, 255, 0.08)',
      cancelBtnBorder: 'rgba(255, 255, 255, 0.15)',
      cancelBtnText: '#f1f5f9',
      cancelBtnHover: 'hover:bg-white/[0.12]',
      floatingBarBg: 'rgba(26, 27, 34, 0.92)',
      floatingBarBorder: 'rgba(255, 255, 255, 0.12)',
      floatingBarText: '#f1f5f9',
      floatingBarShadow: '0 15px 35px -5px rgba(0, 0, 0, 0.8)',
      floatingBarDivider: 'rgba(255, 255, 255, 0.15)',
      floatingBarBtnHover: 'hover:bg-white/[0.08] active:bg-white/[0.12]',
      floatingBarAddBtn: 'text-sky-400 hover:bg-sky-500/20 active:bg-sky-500/30',
      drawerBg: '#15171e',
      drawerBorder: 'rgba(255, 255, 255, 0.1)',
      drawerText: '#f1f5f9',
      drawerCardBg: 'rgba(255, 255, 255, 0.04)',
      drawerCardBorder: 'rgba(255, 255, 255, 0.08)',
      drawerSubText: '#94a3b8',
      drawerBtnBg: 'rgba(255, 255, 255, 0.05)',
      drawerBtnBorder: 'rgba(255, 255, 255, 0.1)',
      drawerBtnHover: 'hover:bg-white/[0.08] active:bg-white/[0.12]',
      themeAccentColor: '#38bdf8',
    };
  }, [isPaper, isDark, isTavern, isSepia]);

  // Dialogue highlight style definitions
  const getDialogueHighlightStyle = () => {
    if (!settings.highlightDialogue) return '';

    const { colorTheme, highlightSoftBg } = settings;

    if (colorTheme === 'sky') {
      if (isLight) {
        return highlightSoftBg 
          ? 'text-[#0284c7] font-semibold bg-sky-100/90 px-1 py-0.5 rounded border-b border-sky-300'
          : 'text-[#0284c7] font-semibold';
      }
      return highlightSoftBg
        ? 'text-sky-300 font-semibold bg-sky-950/60 px-1 py-0.5 rounded border-b border-sky-500/50'
        : 'text-sky-300 font-semibold drop-shadow-sm';
    }

    if (colorTheme === 'violet') {
      if (isLight) {
        return highlightSoftBg
          ? 'text-[#7c3aed] font-semibold bg-purple-100/90 px-1 py-0.5 rounded border-b border-blue-300'
          : 'text-[#7c3aed] font-semibold';
      }
      return highlightSoftBg
        ? 'text-blue-300 font-semibold bg-purple-950/60 px-1 py-0.5 rounded border-b border-blue-500/50'
        : 'text-blue-300 font-semibold drop-shadow-sm';
    }

    if (colorTheme === 'rose') {
      if (isLight) {
        return highlightSoftBg
          ? 'text-[#e11d48] font-semibold bg-rose-100/90 px-1 py-0.5 rounded border-b border-rose-300'
          : 'text-[#e11d48] font-semibold';
      }
      return highlightSoftBg
        ? 'text-rose-300 font-semibold bg-rose-950/60 px-1 py-0.5 rounded border-b border-rose-500/50'
        : 'text-rose-300 font-semibold drop-shadow-sm';
    }

    if (colorTheme === 'emerald') {
      if (isLight) {
        return highlightSoftBg
          ? 'text-[#059669] font-semibold bg-emerald-100/90 px-1 py-0.5 rounded border-b border-emerald-300'
          : 'text-[#059669] font-semibold';
      }
      return highlightSoftBg
        ? 'text-emerald-300 font-semibold bg-emerald-950/60 px-1 py-0.5 rounded border-b border-emerald-500/50'
        : 'text-emerald-300 font-semibold drop-shadow-sm';
    }

    if (colorTheme === 'amber') {
      if (isLight) {
        return highlightSoftBg
          ? 'text-[#d97706] font-semibold bg-amber-100/90 px-1 py-0.5 rounded border-b border-amber-300'
          : 'text-[#d97706] font-semibold';
      }
      return highlightSoftBg
        ? 'text-amber-300 font-semibold bg-amber-950/60 px-1 py-0.5 rounded border-b border-amber-500/50'
        : 'text-amber-300 font-semibold drop-shadow-sm';
    }

    return isLight ? 'text-[#0284c7] font-semibold' : 'text-sky-400 font-semibold';
  };

  // Line height class
  const lineHeightClass = 
    settings.lineHeight === 'loose' ? 'leading-[2.2]' :
    settings.lineHeight === 'normal' ? 'leading-[1.65]' : 'leading-[1.9]';

  // Resolved avatar image
  const displayAvatar = avatarUrl || resolveAvatarUrl(character.avatarUrlFallback, character.name || character.id);

  // Formatted footer end note matching user's image:
  const endOrnamentText = currentGreeting.isFirst 
    ? '—— 开场白 完 ——'
    : `—— 备用开场白 #${currentGreeting.altIndex + 1} 完 ——`;

  // Extract character custom styles
  const characterStyles = useMemo(() => {
    return extractCharacterStyles(character?.data);
  }, [character]);

  // Processed greeting content for rich Markdown rendering
  const processedRenderedContent = useMemo(() => {
    let text = currentGreeting.content || '';
    if (!text.trim()) return '';

    // 1. Macros and regex scripts
    if (settings.enableMacros) {
      text = applyRegexToText(text, character, 'User');
    }

    // 2. Custom fold tags and think tags
    if (settings.enableCustomTags) {
      const thinkRegex =
        /(?:<|&lt;|\[+|\\\[+|\{+)\s*(?:think|thought|thinking)\s*(?:>|&gt;|\]+|\\\]+|\}+)([\s\S]*?)(?:<|&lt;|\[+|\\\[+|\{+)\/\s*(?:think|thought|thinking)\s*(?:>|&gt;|\]+|\\\]+|\}+)/gi;
      
      const thinkBorderColor = isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)';
      const thinkBgColor = isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)';
      const thinkSummaryColor = themeStyles.themeAccentColor;

      text = text.replace(
        thinkRegex,
        `<details class="text-sm rounded-xl p-3 my-3 border overflow-hidden max-w-full" style="background-color: ${thinkBgColor}; border-color: ${thinkBorderColor};"><summary class="cursor-pointer font-bold select-none transition-opacity hover:opacity-80" style="color: ${thinkSummaryColor};">🤔 思维链 / 心理活动</summary><div class="mt-2.5 pt-2 border-t text-sm leading-relaxed whitespace-pre-wrap break-words opacity-90 overflow-x-auto" style="border-color: ${thinkBorderColor};">$1</div></details>`
      );
    }

    // 3. Dialogue Highlight in Markdown (if enabled)
    if (settings.highlightDialogue) {
      const dialogueClass = getDialogueHighlightStyle();
      if (dialogueClass) {
        text = applySafeDialogueHighlight(text, dialogueClass);
      }
    }

    return text;
  }, [
    currentGreeting.content, 
    character, 
    settings.enableMacros, 
    settings.enableCustomTags, 
    settings.highlightDialogue, 
    settings.colorTheme, 
    settings.highlightSoftBg, 
    isLight, 
    themeStyles
  ]);

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="greeting-reader-fullscreen"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[120] flex flex-col select-text"
        style={{ backgroundColor: themeStyles.bg, color: themeStyles.text }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        {/* Top Control Bar - Fully theme adaptive with explicit inline background and borders */}
        <AnimatePresence>
          {(showControls || isEditing) && (
            <motion.header
              initial={{ y: -60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -60, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="fixed top-0 left-0 right-0 z-40 px-4 sm:px-8 py-2.5 sm:py-3.5 pt-[max(1.75rem,env(safe-area-inset-top))] sm:pt-[max(1.75rem,env(safe-area-inset-top))] backdrop-blur-xl border-b flex items-center justify-between transition-colors shadow-xs"
              style={{
                backgroundColor: themeStyles.headerBg,
                borderColor: themeStyles.headerBorder,
                color: themeStyles.headerText,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Left: Close & Greeting Title (Click to open list picker) */}
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <button
                  onClick={onClose}
                  className={`p-2 -ml-1 rounded-full transition-colors cursor-pointer active:scale-95 ${themeStyles.headerBtnHover}`}
                  style={{ color: themeStyles.headerText }}
                  title="退出全屏阅读 (Esc)"
                  aria-label="返回"
                >
                  <X className="w-5 h-5" />
                </button>

                <button
                  onClick={() => setShowGreetingPicker((v) => !v)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-colors cursor-pointer text-xs sm:text-sm font-medium ${themeStyles.headerBtnHover}`}
                  style={{ color: themeStyles.headerText }}
                  title="点击展开全部开场白列表"
                >
                  <BookOpen className="w-4 h-4 opacity-75" />
                  <span className="truncate max-w-[130px] sm:max-w-[200px]">
                    {currentGreeting.label}
                  </span>
                  <span className="opacity-60 text-xs font-mono">
                    ({safeIndex + 1}/{greetingsList.length})
                  </span>
                </button>
              </div>

              {/* Right: Keep only Edit and More/Settings */}
              <div className="flex items-center gap-2 shrink-0">
                {/* Edit Button or Themed Action Buttons */}
                {!isEditing ? (
                  <button
                    onClick={handleStartEdit}
                    className={`p-2 rounded-lg transition-colors cursor-pointer active:scale-95 ${themeStyles.headerBtnHover}`}
                    style={{ color: themeStyles.headerText }}
                    title="编辑当前开场白正文"
                  >
                    <Edit3 className="w-4.5 h-4.5" />
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    {/* Themed Cancel Button */}
                    <button
                      onClick={() => setIsEditing(false)}
                      className={`px-3.5 py-1.5 rounded-full border text-xs font-medium cursor-pointer transition-all active:scale-95 ${themeStyles.cancelBtnHover}`}
                      style={{ 
                        backgroundColor: themeStyles.cancelBtnBg,
                        borderColor: themeStyles.cancelBtnBorder,
                        color: themeStyles.cancelBtnText,
                      }}
                    >
                      取消
                    </button>
                    {/* Themed Save Button */}
                    <button
                      onClick={handleSaveEdit}
                      className={`px-3.5 py-1.5 rounded-full font-medium text-xs flex items-center gap-1.5 shadow-sm active:scale-95 transition-all cursor-pointer ${themeStyles.primaryBtnHover}`}
                      style={{
                        backgroundColor: themeStyles.primaryBtnBg,
                        color: themeStyles.primaryBtnText,
                      }}
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>保存</span>
                    </button>
                  </div>
                )}

                {/* More / Settings Button */}
                <button
                  onClick={() => setShowSettingsDrawer((v) => !v)}
                  className={`p-2 rounded-lg transition-colors cursor-pointer active:scale-95 ${themeStyles.headerBtnHover}`}
                  style={{ color: themeStyles.headerText }}
                  title="高亮设置、渲染选项、阅读主题与更多操作"
                >
                  <Sliders className="w-4.5 h-4.5" />
                </button>
              </div>
            </motion.header>
          )}
        </AnimatePresence>

        {/* Action toast feedback */}
        <AnimatePresence>
          {(copyToast || actionFeedback) && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 ios-toast ios-toast-success text-xs sm:text-sm rounded-full flex items-center gap-2 pointer-events-none"
            >
              {copyToast && <CheckCircle2 className="w-4 h-4 text-green-400 ios-toast-icon-success shrink-0" />}
              <span>{copyToast ? '开场白正文已复制到剪贴板' : actionFeedback}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Content Area - True Full-Screen Edge-to-Edge Canvas without Card Containers */}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto pt-[max(4.5rem,calc(env(safe-area-inset-top)+3rem))] sm:pt-[max(5rem,calc(env(safe-area-inset-top)+3.5rem))] pb-28 px-5 sm:px-8 md:px-12 custom-scrollbar flex flex-col items-center cursor-default"
        >
          {/* Centered Reading Column with comfortable readability */}
          <div className="w-full max-w-2xl sm:max-w-3xl flex flex-col items-center my-4 sm:my-8">
            
            {/* Top Section: Avatar, Character Name, Opening Subtitle, Dashed Line */}
            <div className="flex flex-col items-center text-center w-full">
              {/* Circular Avatar */}
              <div className="relative group select-none">
                <img
                  src={displayAvatar}
                  alt={character.name || 'Character'}
                  className="w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover shadow-xl border-2 transition-transform duration-300 group-hover:scale-105"
                  style={{
                    borderColor: isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)',
                  }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = getFallbackAvatar(character.name || 'Character');
                  }}
                />
                <div className="absolute inset-0 rounded-full ring-2 ring-sky-400/20 pointer-events-none" />
              </div>

              {/* Character Name */}
              <h1 className="mt-5 text-2xl sm:text-3xl tracking-wide font-bold" style={{ color: themeStyles.name }}>
                {character.name || '无名'}
              </h1>

              {/* Subtitle - matching screenshot "开场白1" */}
              <div className="mt-3 flex items-center gap-2">
                <span className="text-sm sm:text-base tracking-widest font-semibold" style={{ color: themeStyles.subtitle }}>
                  {currentGreeting.isFirst ? '开场白1' : `开场白${safeIndex + 1}`}
                </span>
                {!currentGreeting.isFirst && (
                  <span
                    className="text-[11px] px-1.5 py-0.5 rounded font-medium"
                    style={{
                      backgroundColor: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)',
                      color: isLight ? '#475569' : '#cbd5e1',
                    }}
                  >
                    备用
                  </span>
                )}
                {settings.enableMarkdown && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium flex items-center gap-1 opacity-70"
                    style={{
                      backgroundColor: isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.08)',
                      color: isLight ? '#64748b' : '#94a3b8',
                    }}
                    title="富文本 / Markdown 渲染已开启"
                  >
                    <Sparkles className="w-2.5 h-2.5" />
                    渲染
                  </span>
                )}
              </div>

              {/* Dashed Separator Line */}
              <div 
                className="w-44 sm:w-64 my-6 border-t border-dashed" 
                style={{ borderColor: themeStyles.dashed }} 
              />
            </div>

            {/* Body Content (正文) */}
            <div className="w-full mt-2 min-h-[160px]" onClick={(e) => isEditing && e.stopPropagation()}>
              {isEditing ? (
                <div className="flex flex-col gap-3 w-full">
                  <div className="flex items-center justify-between text-xs opacity-70 px-1" style={{ color: themeStyles.text }}>
                    <span>编辑正文 (支持 Markdown、表格、HTML、对话“”高亮与思维链 &lt;think&gt;)</span>
                    <span>共 {editValue.length} 字</span>
                  </div>
                  <textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    rows={14}
                    className="w-full p-4 sm:p-5 rounded-2xl border border-sky-400/50 focus:outline-none focus:ring-2 focus:ring-sky-400/50 text-base leading-relaxed resize-y font-sans shadow-xs"
                    style={{
                      backgroundColor: isLight ? '#ffffff' : 'rgba(0, 0, 0, 0.4)',
                      color: isLight ? '#0f172a' : '#f8fafc',
                    }}
                    placeholder="在此输入角色开场白正文..."
                    autoFocus
                  />
                  <div className="flex justify-end gap-2.5 pt-2">
                    <button
                      onClick={() => setIsEditing(false)}
                      className={`px-4 py-2 rounded-full border text-xs sm:text-sm font-medium transition-all cursor-pointer active:scale-95 ${themeStyles.cancelBtnHover}`}
                      style={{
                        backgroundColor: themeStyles.cancelBtnBg,
                        borderColor: themeStyles.cancelBtnBorder,
                        color: themeStyles.cancelBtnText,
                      }}
                    >
                      取消
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      className={`px-5 py-2 rounded-full text-xs sm:text-sm font-medium shadow-sm transition-all cursor-pointer active:scale-95 ${themeStyles.primaryBtnHover}`}
                      style={{
                        backgroundColor: themeStyles.primaryBtnBg,
                        color: themeStyles.primaryBtnText,
                      }}
                    >
                      保存并应用
                    </button>
                  </div>
                </div>
              ) : currentGreeting.content && currentGreeting.content.trim() !== '' ? (
                settings.enableMarkdown ? (
                  /* Rich Markdown / HTML / Tags / Macros rendering mode */
                  <div
                    onClick={handleContainerClick}
                    className={`greeting-reader-prose text-justify [text-align:justify] [text-justify:inter-ideograph] break-words break-all sm:break-words tracking-normal ${lineHeightClass} w-full`}
                    style={{ fontSize: `${settings.fontSize}px`, color: themeStyles.text }}
                  >
                    <MessageContent 
                      content={processedRenderedContent} 
                      themeMode={isLight ? 'light' : 'dark'} 
                      swipes={greetingsList.map(g => g.content)}
                      characterName={character.name}
                    />
                  </div>
                ) : (
                  /* Classic Paragraph Tokenizer mode */
                  <div
                    className={`text-justify [text-align:justify] [text-justify:inter-ideograph] break-words break-all sm:break-words tracking-normal ${lineHeightClass} w-full`}
                    style={{ fontSize: `${settings.fontSize}px`, color: themeStyles.text }}
                  >
                    {currentGreeting.content.split(/\n+/).map((para, pIdx) => {
                      const trimmed = para.trim();
                      if (!trimmed) return null;

                      const tokens = parseParagraphTokens(trimmed);

                      return (
                        <p key={pIdx} className="mb-4 sm:mb-5.5 last:mb-0">
                          {tokens.map((token, tIdx) => {
                            if (token.type === 'dialogue') {
                              return (
                                <span
                                  key={tIdx}
                                  className={`transition-colors ${getDialogueHighlightStyle()}`}
                                >
                                  {token.content}
                                </span>
                              );
                            }
                            if (token.type === 'action') {
                              return (
                                <span key={tIdx} className="transition-colors italic" style={{ color: themeStyles.action }}>
                                  {token.content}
                                </span>
                              );
                            }
                            if (token.type === 'thought') {
                              return (
                                <span key={tIdx} className="transition-colors opacity-90" style={{ color: themeStyles.thought }}>
                                  {token.content}
                                </span>
                              );
                            }
                            return <span key={tIdx}>{token.content}</span>;
                          })}
                        </p>
                      );
                    })}
                  </div>
                )
              ) : (
                <div className="py-10 flex flex-col items-center justify-center text-center opacity-70">
                  <p className="text-sm italic" style={{ color: themeStyles.text }}>此开场白暂无内容</p>
                  <button
                    onClick={handleStartEdit}
                    className="mt-3 px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer"
                    style={{
                      backgroundColor: themeStyles.cancelBtnBg,
                      color: themeStyles.themeAccentColor,
                      border: `1px solid ${themeStyles.cancelBtnBorder}`,
                    }}
                  >
                    点击开始编写正文
                  </button>
                </div>
              )}
            </div>

            {/* Ending Ornament Line - matching user's screenshot "—— 备用开场白 #1 完 ——" */}
            {!isEditing && (
              <div className="mt-14 sm:mt-20 text-center select-none w-full">
                <span className="text-xs sm:text-sm tracking-widest font-medium" style={{ color: themeStyles.footer }}>
                  {endOrnamentText}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Floating Navigation Toolbar: < 1 / 10 > | + */}
        <AnimatePresence>
          {(showControls || isEditing) && (
            <motion.footer
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="fixed bottom-4 sm:bottom-6 left-0 right-0 z-40 pointer-events-none flex justify-center px-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div 
                className="pointer-events-auto backdrop-blur-2xl border rounded-full px-3 py-1.5 flex items-center gap-1.5 sm:gap-2.5 transition-all"
                style={{
                  backgroundColor: themeStyles.floatingBarBg,
                  borderColor: themeStyles.floatingBarBorder,
                  color: themeStyles.floatingBarText,
                  boxShadow: themeStyles.floatingBarShadow,
                }}
              >
                {/* Prev button < */}
                <button
                  onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                  disabled={safeIndex <= 0}
                  className={`p-1.5 rounded-full transition-colors cursor-pointer active:scale-95 ${
                    safeIndex <= 0
                      ? 'opacity-25 cursor-not-allowed'
                      : themeStyles.floatingBarBtnHover
                  }`}
                  style={{ color: themeStyles.floatingBarText }}
                  title="上一条开场白 (←)"
                >
                  <ChevronLeft className="w-4.5 h-4.5" />
                </button>

                {/* Index Stepper & List toggle: 1 / 10 */}
                <button
                  onClick={() => setShowGreetingPicker((v) => !v)}
                  className={`px-2.5 py-1 rounded-full text-xs sm:text-sm font-semibold tracking-wider transition-colors cursor-pointer font-mono ${themeStyles.floatingBarBtnHover}`}
                  style={{ color: themeStyles.floatingBarText }}
                  title="点击查看全部开场白列表"
                >
                  <span>{safeIndex + 1}</span>
                  <span className="opacity-40 mx-1">/</span>
                  <span>{greetingsList.length}</span>
                </button>

                {/* Next button > */}
                <button
                  onClick={() => setCurrentIndex((prev) => Math.min(greetingsList.length - 1, prev + 1))}
                  disabled={safeIndex >= greetingsList.length - 1}
                  className={`p-1.5 rounded-full transition-colors cursor-pointer active:scale-95 ${
                    safeIndex >= greetingsList.length - 1
                      ? 'opacity-25 cursor-not-allowed'
                      : themeStyles.floatingBarBtnHover
                  }`}
                  style={{ color: themeStyles.floatingBarText }}
                  title="下一条开场白 (→)"
                >
                  <ChevronRight className="w-4.5 h-4.5" />
                </button>

                {/* Divider | */}
                <div className="w-[1px] h-4 mx-1" style={{ backgroundColor: themeStyles.floatingBarDivider }} />

                {/* Add button + */}
                {onUpdateGreeting && (
                  <button
                    onClick={handleAddNew}
                    className={`p-1.5 rounded-full transition-colors cursor-pointer active:scale-95 ${themeStyles.floatingBarAddBtn}`}
                    title="添加新的备用开场白"
                  >
                    <Plus className="w-4.5 h-4.5" />
                  </button>
                )}
              </div>
            </motion.footer>
          )}
        </AnimatePresence>

        {/* More / Settings Drawer ("更多面板") - 100% Theme Adaptive */}
        <AnimatePresence>
          {showSettingsDrawer && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end"
              onClick={() => setShowSettingsDrawer(false)}
            >
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 280 }}
                className="w-full max-w-sm border-l p-5 sm:p-6 shadow-2xl h-full flex flex-col justify-between overflow-y-auto"
                style={{
                  backgroundColor: themeStyles.drawerBg,
                  borderColor: themeStyles.drawerBorder,
                  color: themeStyles.drawerText,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="space-y-6">
                  {/* Clean Title without Icon & Close */}
                  <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: themeStyles.drawerBorder }}>
                    <h3 className="font-semibold text-base" style={{ color: themeStyles.drawerText }}>
                      正文高亮与排版设置
                    </h3>
                    <button
                      onClick={() => setShowSettingsDrawer(false)}
                      className={`p-1.5 rounded-full transition-colors cursor-pointer ${themeStyles.drawerBtnHover}`}
                      style={{ color: themeStyles.drawerText }}
                      title="关闭设置"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Markdown & Rich Rendering Switches */}
                  <div className="space-y-3">
                    <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: themeStyles.drawerSubText }}>
                      富文本与高级渲染
                    </label>
                    
                    {/* Enable Markdown rendering */}
                    <div 
                      className="flex items-center justify-between p-3 rounded-xl border transition-colors"
                      style={{
                        backgroundColor: themeStyles.drawerCardBg,
                        borderColor: themeStyles.drawerCardBorder,
                      }}
                    >
                      <div>
                        <div className="text-sm font-medium flex items-center gap-1.5" style={{ color: themeStyles.drawerText }}>
                          <span>Markdown 与富文本渲染</span>
                        </div>
                        <div className="text-xs opacity-60" style={{ color: themeStyles.drawerSubText }}>支持加粗、斜体、表格、代码块与 HTML</div>
                      </div>
                      <ThemedSwitch
                        checked={settings.enableMarkdown}
                        onChange={(val) => updateSetting('enableMarkdown', val)}
                        activeColor={themeStyles.themeAccentColor}
                        isLight={isLight}
                      />
                    </div>

                    {/* Enable Macros and Character Regex scripts */}
                    <div 
                      className="flex items-center justify-between p-3 rounded-xl border transition-colors"
                      style={{
                        backgroundColor: themeStyles.drawerCardBg,
                        borderColor: themeStyles.drawerCardBorder,
                      }}
                    >
                      <div>
                        <div className="text-sm font-medium" style={{ color: themeStyles.drawerText }}>宏替换与角色正则</div>
                        <div className="text-xs opacity-60" style={{ color: themeStyles.drawerSubText }}>自动替换 &#123;&#123;char&#125;&#125;、&#123;&#123;user&#125;&#125; 及正则脚本</div>
                      </div>
                      <ThemedSwitch
                        checked={settings.enableMacros}
                        onChange={(val) => updateSetting('enableMacros', val)}
                        activeColor={themeStyles.themeAccentColor}
                        isLight={isLight}
                      />
                    </div>

                    {/* Enable Think / Fold tags */}
                    <div 
                      className="flex items-center justify-between p-3 rounded-xl border transition-colors"
                      style={{
                        backgroundColor: themeStyles.drawerCardBg,
                        borderColor: themeStyles.drawerCardBorder,
                      }}
                    >
                      <div>
                        <div className="text-sm font-medium" style={{ color: themeStyles.drawerText }}>思维链与标签折叠</div>
                        <div className="text-xs opacity-60" style={{ color: themeStyles.drawerSubText }}>将 &lt;think&gt; 思维链整理为可折叠面板</div>
                      </div>
                      <ThemedSwitch
                        checked={settings.enableCustomTags}
                        onChange={(val) => updateSetting('enableCustomTags', val)}
                        activeColor={themeStyles.themeAccentColor}
                        isLight={isLight}
                      />
                    </div>
                  </div>

                  {/* Dialogue Highlighting Switch - Themed iOS Switches */}
                  <div className="space-y-3">
                    <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: themeStyles.drawerSubText }}>
                      正文对话高亮
                    </label>
                    <div 
                      className="flex items-center justify-between p-3 rounded-xl border transition-colors"
                      style={{
                        backgroundColor: themeStyles.drawerCardBg,
                        borderColor: themeStyles.drawerCardBorder,
                      }}
                    >
                      <div>
                        <div className="text-sm font-medium" style={{ color: themeStyles.drawerText }}>启用对话台词高亮</div>
                        <div className="text-xs opacity-60" style={{ color: themeStyles.drawerSubText }}>自动识别“”、「」引号内的对话台词</div>
                      </div>
                      <ThemedSwitch
                        checked={settings.highlightDialogue}
                        onChange={(val) => updateSetting('highlightDialogue', val)}
                        activeColor={themeStyles.themeAccentColor}
                        isLight={isLight}
                      />
                    </div>

                    <div 
                      className="flex items-center justify-between p-3 rounded-xl border transition-colors"
                      style={{
                        backgroundColor: themeStyles.drawerCardBg,
                        borderColor: themeStyles.drawerCardBorder,
                      }}
                    >
                      <div>
                        <div className="text-sm font-medium" style={{ color: themeStyles.drawerText }}>柔和微光底色</div>
                        <div className="text-xs opacity-60" style={{ color: themeStyles.drawerSubText }}>在台词文字后增加微光色块背景</div>
                      </div>
                      <ThemedSwitch
                        checked={settings.highlightSoftBg}
                        onChange={(val) => updateSetting('highlightSoftBg', val)}
                        activeColor={themeStyles.themeAccentColor}
                        isLight={isLight}
                      />
                    </div>
                  </div>

                  {/* Highlight Color Theme */}
                  <div className="space-y-3">
                    <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: themeStyles.drawerSubText }}>
                      高亮色彩预设
                    </label>
                    <div className="grid grid-cols-5 gap-2">
                      {[
                        { id: 'sky', label: '晴空蓝', color: 'bg-sky-400', hex: '#38bdf8' },
                        { id: 'violet', label: '紫藤罗', color: 'bg-blue-400', hex: '#c084fc' },
                        { id: 'rose', label: '樱花粉', color: 'bg-rose-400', hex: '#fb7185' },
                        { id: 'emerald', label: '薄荷青', color: 'bg-emerald-400', hex: '#34d399' },
                        { id: 'amber', label: '落日金', color: 'bg-amber-400', hex: '#fbbf24' },
                      ].map((item) => {
                        const isSelected = settings.colorTheme === item.id;
                        return (
                          <button
                            key={item.id}
                            onClick={() => updateSetting('colorTheme', item.id as any)}
                            className="flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all cursor-pointer"
                            style={{
                              borderColor: isSelected ? item.hex : 'transparent',
                              backgroundColor: isSelected ? `${item.hex}18` : 'transparent',
                              opacity: isSelected ? 1 : 0.75,
                            }}
                          >
                            <div className={`w-5 h-5 rounded-full ${item.color} shadow-xs`} />
                            <span className="text-[11px] whitespace-nowrap font-medium" style={{ color: themeStyles.drawerText }}>{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Reader Theme (Paper White / Dark Night / Tavern / Sepia) - Selected border matching each theme */}
                  <div className="space-y-3">
                    <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: themeStyles.drawerSubText }}>
                      全屏阅读主题
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { 
                          id: 'paper', 
                          label: '纸境白 (白色全屏)', 
                          icon: Sun, 
                          bg: '#ffffff', 
                          textColor: '#0f172a', 
                          borderColor: '#cbd5e1',
                          activeBorderColor: '#0284c7', 
                          iconColor: '#0284c7',
                        },
                        { 
                          id: 'dark', 
                          label: '深邃夜 (黑色全屏)', 
                          icon: Moon, 
                          bg: '#111216', 
                          textColor: '#f8fafc', 
                          borderColor: 'rgba(255, 255, 255, 0.2)',
                          activeBorderColor: '#38bdf8', 
                          iconColor: '#38bdf8',
                        },
                        { 
                          id: 'tavern', 
                          label: '酒馆蓝 (经典灰蓝)', 
                          icon: Palette, 
                          bg: '#0f1420', 
                          textColor: '#e0e7ff', 
                          borderColor: 'rgba(129, 140, 248, 0.3)',
                          activeBorderColor: '#818cf8', 
                          iconColor: '#818cf8',
                        },
                        { 
                          id: 'sepia', 
                          label: '羊皮纸 (护眼暖调)', 
                          icon: Coffee, 
                          bg: '#fbf7ee', 
                          textColor: '#2d2417', 
                          borderColor: '#d6c7ab',
                          activeBorderColor: '#8b4513', 
                          iconColor: '#8b4513',
                        },
                      ].map((t) => {
                        const Icon = t.icon;
                        const isSelected = settings.readerTheme === t.id;
                        return (
                          <button
                            key={t.id}
                            onClick={() => updateSetting('readerTheme', t.id as any)}
                            className="p-3 rounded-xl border flex items-center gap-2 transition-all cursor-pointer text-left"
                            style={{
                              backgroundColor: t.bg,
                              color: t.textColor,
                              border: `1px solid ${isSelected ? t.activeBorderColor : t.borderColor}`,
                              boxShadow: isSelected ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                              opacity: isSelected ? 1 : 0.8,
                            }}
                          >
                            <Icon className="w-4 h-4 shrink-0" style={{ color: t.iconColor }} />
                            <div className="text-xs font-semibold leading-snug">{t.label}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Font Size Adjustments - 100% Legible & Theme Adaptive */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: themeStyles.drawerSubText }}>
                        字号大小
                      </label>
                      <span className="text-xs font-mono font-bold" style={{ color: themeStyles.drawerText }}>
                        {settings.fontSize}px
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateSetting('fontSize', Math.max(14, settings.fontSize - 1))}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${themeStyles.drawerBtnHover}`}
                        style={{
                          backgroundColor: themeStyles.drawerBtnBg,
                          borderColor: themeStyles.drawerBtnBorder,
                          color: themeStyles.drawerText,
                        }}
                      >
                        A- 缩小
                      </button>
                      <div className="flex-1 flex justify-center gap-1.5">
                        {[15, 17, 19, 21].map((size) => {
                          const isSelected = settings.fontSize === size;
                          return (
                            <button
                              key={size}
                              onClick={() => updateSetting('fontSize', size)}
                              className="px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer transition-all"
                              style={{
                                backgroundColor: isSelected ? themeStyles.themeAccentColor : themeStyles.drawerBtnBg,
                                color: isSelected ? '#ffffff' : themeStyles.drawerText,
                                border: isSelected ? `1px solid ${themeStyles.themeAccentColor}` : `1px solid ${themeStyles.drawerBtnBorder}`,
                                boxShadow: isSelected ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                              }}
                            >
                              {size === 15 ? '小' : size === 17 ? '中' : size === 19 ? '大' : '特大'}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        onClick={() => updateSetting('fontSize', Math.min(24, settings.fontSize + 1))}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${themeStyles.drawerBtnHover}`}
                        style={{
                          backgroundColor: themeStyles.drawerBtnBg,
                          borderColor: themeStyles.drawerBtnBorder,
                          color: themeStyles.drawerText,
                        }}
                      >
                        A+ 放大
                      </button>
                    </div>
                  </div>

                  {/* Actions: Copy / Set as default first / Delete (100% Theme Adaptive) */}
                  <div className="space-y-2 pt-2 border-t" style={{ borderColor: themeStyles.drawerBorder }}>
                    <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: themeStyles.drawerSubText }}>
                      操作选项
                    </label>
                    <button
                      onClick={handleCopy}
                      className={`w-full p-2.5 rounded-xl border flex items-center justify-center gap-2 text-xs font-medium transition-colors cursor-pointer ${themeStyles.drawerBtnHover}`}
                      style={{
                        backgroundColor: themeStyles.drawerCardBg,
                        borderColor: themeStyles.drawerCardBorder,
                        color: themeStyles.drawerText,
                      }}
                    >
                      <Copy className="w-4 h-4 opacity-75" /> 复制当前开场白正文
                    </button>

                    {!currentGreeting.isFirst && onUpdateGreeting && (
                      <button
                        onClick={() => {
                          setShowSettingsDrawer(false);
                          handlePromoteToFirst();
                        }}
                        className={`w-full p-2.5 rounded-xl border flex items-center justify-center gap-2 text-xs font-medium transition-colors cursor-pointer ${themeStyles.drawerBtnHover}`}
                        style={{
                          backgroundColor: themeStyles.drawerCardBg,
                          borderColor: themeStyles.drawerCardBorder,
                          color: themeStyles.drawerText,
                        }}
                      >
                        <Star className="w-4 h-4 opacity-75" /> 设为默认首条开场白
                      </button>
                    )}

                    {!currentGreeting.isFirst && onUpdateGreeting && (
                      <button
                        onClick={() => {
                          setShowSettingsDrawer(false);
                          handleDeleteCurrent();
                        }}
                        className={`w-full p-2.5 rounded-xl border flex items-center justify-center gap-2 text-xs font-medium transition-colors cursor-pointer ${themeStyles.drawerBtnHover}`}
                        style={{
                          backgroundColor: themeStyles.drawerCardBg,
                          borderColor: themeStyles.drawerCardBorder,
                          color: themeStyles.drawerText,
                        }}
                      >
                        <Trash2 className="w-4 h-4 opacity-75" /> 删除当前备用开场白
                      </button>
                    )}
                  </div>
                </div>

                <div className="pt-4 border-t text-center" style={{ borderColor: themeStyles.drawerBorder }}>
                  <button
                    onClick={() => setSettings(DEFAULT_SETTINGS)}
                    className="text-xs opacity-50 hover:opacity-100 transition cursor-pointer"
                    style={{ color: themeStyles.drawerText }}
                  >
                    恢复默认排版设置
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Greeting List Drawer / Picker */}
        <AnimatePresence>
          {showGreetingPicker && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6"
              onClick={() => setShowGreetingPicker(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="w-full max-w-lg border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
                style={{
                  backgroundColor: themeStyles.drawerBg,
                  borderColor: themeStyles.drawerBorder,
                  color: themeStyles.drawerText,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-4 sm:p-5 border-b flex items-center justify-between" style={{ borderColor: themeStyles.drawerBorder }}>
                  <h3 className="font-semibold text-base sm:text-lg" style={{ color: themeStyles.drawerText }}>
                    开场白列表 ({greetingsList.length})
                  </h3>
                  <button
                    onClick={() => setShowGreetingPicker(false)}
                    className={`p-1.5 rounded-full transition-colors cursor-pointer ${themeStyles.drawerBtnHover}`}
                    style={{ color: themeStyles.drawerText }}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-4 overflow-y-auto space-y-2.5 flex-1 custom-scrollbar">
                  {greetingsList.map((g, idx) => {
                    const isSelected = idx === safeIndex;
                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          setCurrentIndex(idx);
                          setShowGreetingPicker(false);
                        }}
                        className="w-full p-3.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1.5"
                        style={{
                          backgroundColor: isSelected 
                            ? (isLight ? `${themeStyles.themeAccentColor}12` : `${themeStyles.themeAccentColor}22`)
                            : themeStyles.drawerCardBg,
                          borderColor: isSelected ? themeStyles.themeAccentColor : themeStyles.drawerCardBorder,
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span 
                              className="text-xs font-bold"
                              style={{ color: isSelected ? themeStyles.themeAccentColor : themeStyles.drawerText }}
                            >
                              {g.title}
                            </span>
                            {g.isFirst && (
                              <span 
                                className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                                style={{
                                  backgroundColor: `${themeStyles.themeAccentColor}20`,
                                  color: themeStyles.themeAccentColor,
                                }}
                              >
                                默认
                              </span>
                            )}
                          </div>
                          {isSelected && (
                            <Check className="w-4 h-4" style={{ color: themeStyles.themeAccentColor }} />
                          )}
                        </div>
                        <p 
                          className="text-xs line-clamp-2 leading-relaxed" 
                          style={{ color: themeStyles.drawerSubText }}
                        >
                          {g.content || <span className="italic opacity-50">空内容...</span>}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {onUpdateGreeting && (
                  <div className="p-4 border-t" style={{ borderColor: themeStyles.drawerBorder }}>
                    <button
                      onClick={() => {
                        setShowGreetingPicker(false);
                        handleAddNew();
                      }}
                      className={`w-full p-2.5 rounded-xl font-medium text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer shadow-sm transition active:scale-95 ${themeStyles.primaryBtnHover}`}
                      style={{
                        backgroundColor: themeStyles.primaryBtnBg,
                        color: themeStyles.primaryBtnText,
                      }}
                    >
                      <Plus className="w-4 h-4" />
                      <span>添加新的备用开场白</span>
                    </button>
                  </div>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
