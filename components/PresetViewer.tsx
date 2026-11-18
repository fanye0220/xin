import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Edit2,
  Plus,
  Save,
  Search,
  Sliders,
  Trash2,
  X as XIcon,
  FileText,
  MoreVertical,
} from 'lucide-react';
import { CharacterCard, saveCharacter } from '../lib/db';
import { downloadOrShareFile, getDownloadTooltip } from '../lib/appBridge';
import { useBackHandler } from '../lib/useBackHandler';

export interface PresetPromptEntry {
  identifier: string;
  name: string;
  role: 'system' | 'user' | 'assistant' | string;
  content: string;
  system_prompt?: boolean;
  marker?: boolean;
  enabled: boolean;
  injection_position?: number;
  injection_depth?: number;
  injection_order?: number;
  forbid_overrides?: boolean;
  _raw?: any;
}

interface Props {
  character: CharacterCard;
  onUpdate: (updated: CharacterCard) => void;
  isLightMode?: boolean;
}

function resolveActiveOrderBlock(promptOrder: any): Array<{ identifier: string; enabled?: boolean }> {
  if (!Array.isArray(promptOrder) || promptOrder.length === 0) return [];
  const preferred =
    promptOrder.find((block: any) => block && Number(block.character_id) === 100001 && Array.isArray(block.order)) ||
    [...promptOrder].reverse().find((block: any) => block && Array.isArray(block.order) && block.order.length > 0);
  if (preferred && Array.isArray(preferred.order)) {
    return preferred.order.filter((item: any) => item && item.identifier !== undefined);
  }
  if (promptOrder[0] && promptOrder[0].identifier !== undefined) {
    return promptOrder.filter((item: any) => item && item.identifier !== undefined);
  }
  return [];
}

function buildResolvedEntries(rawData: any): PresetPromptEntry[] {
  const rawPrompts: any[] = Array.isArray(rawData?.prompts)
    ? rawData.prompts.filter((p: any) => p && typeof p === 'object')
    : [];

  const byId = new Map<string, PresetPromptEntry>();
  const orderedIds: string[] = [];

  rawPrompts.forEach((p, idx) => {
    const id = String(p.identifier ?? p.id ?? `prompt_${idx}`);
    const entry: PresetPromptEntry = {
      identifier: id,
      name: String(p.name ?? p.identifier ?? `条目 ${idx + 1}`),
      role: String(p.role || 'system'),
      content: typeof p.content === 'string' ? p.content : (typeof p.text === 'string' ? p.text : ''),
      system_prompt: !!p.system_prompt,
      marker: !!p.marker,
      enabled: p.enabled !== false,
      injection_position: typeof p.injection_position === 'number' ? p.injection_position : 0,
      injection_depth: typeof p.injection_depth === 'number' ? p.injection_depth : 4,
      injection_order: typeof p.injection_order === 'number' ? p.injection_order : 100,
      forbid_overrides: p.forbid_overrides,
      _raw: p,
    };
    if (!byId.has(id)) {
      byId.set(id, entry);
      orderedIds.push(id);
    }
  });

  const activeOrder = resolveActiveOrderBlock(rawData?.prompt_order);
  if (activeOrder.length === 0) {
    return orderedIds.map((id) => byId.get(id)!);
  }

  const result: PresetPromptEntry[] = [];
  const used = new Set<string>();

  for (const ord of activeOrder) {
    const id = String(ord.identifier);
    const matched = byId.get(id);
    if (matched && !used.has(id)) {
      used.add(id);
      result.push({
        ...matched,
        enabled: ord.enabled !== undefined ? !!ord.enabled : matched.enabled,
      });
    }
  }

  for (const id of orderedIds) {
    if (!used.has(id)) {
      result.push(byId.get(id)!);
    }
  }

  return result;
}

export const PresetViewer: React.FC<Props> = ({ character, onUpdate, isLightMode = false }) => {
  const rawData = useMemo(() => {
    const d = character.data;
    if (d?.data && !d.prompts && Array.isArray(d.data.prompts)) return d.data;
    return d || {};
  }, [character.data]);

  const entries = useMemo(() => buildResolvedEntries(rawData), [rawData]);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'enabled' | 'has_content'>('all');
  const [showControls, setShowControls] = useState(false);
  const [showParams, setShowParams] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [visibleEntryCount, setVisibleEntryCount] = useState(35);
  const loadMoreRef = React.useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isThemeLight, setIsThemeLight] = useState(() => {
    if (isLightMode) return true;
    return (
      typeof document !== 'undefined' &&
      (document.documentElement.classList.contains('light-theme') ||
        document.body.classList.contains('light-theme') ||
        localStorage.getItem('tavern_theme') === 'light')
    );
  });

  useEffect(() => {
    const syncTheme = () => {
      const light =
        isLightMode ||
        (typeof document !== 'undefined' &&
          (document.documentElement.classList.contains('light-theme') ||
            document.body.classList.contains('light-theme') ||
            localStorage.getItem('tavern_theme') === 'light'));
      setIsThemeLight(Boolean(light));
    };
    syncTheme();
    if (typeof document === 'undefined') return;
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [isLightMode]);

  useEffect(() => {
    setVisibleEntryCount(35);
  }, [character.id]);

  const [entryMenuState, setEntryMenuState] = useState<{
    index: number;
    entry: PresetPromptEntry;
    hasContent: boolean;
    x: number;
    y: number;
    placement: 'top' | 'bottom';
  } | null>(null);

  const [isEditingPresetName, setIsEditingPresetName] = useState(false);
  const [presetNameDraft, setPresetNameDraft] = useState(character.name || rawData.name || '');

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingForm, setEditingForm] = useState<PresetPromptEntry | null>(null);

  useBackHandler(entryMenuState !== null || editingIndex !== null, () => {
    if (entryMenuState !== null) {
      setEntryMenuState(null);
      return true;
    }
    setEditingIndex(null);
    setEditingForm(null);
    return true;
  });

  useEffect(() => {
    if (!entryMenuState) return;
    const handleClose = () => setEntryMenuState(null);
    window.addEventListener('scroll', handleClose, true);
    window.addEventListener('resize', handleClose);
    return () => {
      window.removeEventListener('scroll', handleClose, true);
      window.removeEventListener('resize', handleClose);
    };
  }, [entryMenuState]);

  const handleToggleEntryMenu = (
    index: number,
    entry: PresetPromptEntry,
    hasContent: boolean,
    e: React.MouseEvent<HTMLButtonElement>,
  ) => {
    e.stopPropagation();
    if (entryMenuState?.index === index) {
      setEntryMenuState(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const menuWidth = 152;
    const menuHeight = hasContent ? 136 : 96;
    const spaceBelow = window.innerHeight - rect.bottom;
    const isUpward = spaceBelow < menuHeight + 16 && rect.top > menuHeight + 16;

    let x = rect.right - menuWidth;
    if (x < 12) x = 12;
    if (x + menuWidth > window.innerWidth - 12) {
      x = window.innerWidth - menuWidth - 12;
    }

    setEntryMenuState({
      index,
      entry,
      hasContent,
      x,
      y: isUpward ? rect.top - 6 : rect.bottom + 6,
      placement: isUpward ? 'top' : 'bottom',
    });
  };

  const enabledCount = useMemo(() => entries.filter((e) => e.enabled).length, [entries]);
  const contentEntriesCount = useMemo(
    () => entries.filter((e) => e.content.trim().length > 0).length,
    [entries],
  );

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => {
        if (filterMode === 'enabled' && !entry.enabled) return false;
        if (filterMode === 'has_content' && !entry.content.trim()) return false;
        if (q) {
          return (
            entry.name.toLowerCase().includes(q) ||
            entry.identifier.toLowerCase().includes(q) ||
            entry.role.toLowerCase().includes(q) ||
            entry.content.toLowerCase().includes(q)
          );
        }
        return true;
      });
  }, [entries, filterMode, searchQuery]);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (items) => {
        if (items.some((it) => it.isIntersecting)) {
          setVisibleEntryCount((v) => v + 40);
        }
      },
      { rootMargin: '250px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleEntryCount, filteredItems.length, searchQuery]);

  const genParams = useMemo(() => {
    const list: Array<{ label: string; value: string }> = [];
    const add = (label: string, val: any) => {
      if (val !== undefined && val !== null && val !== '') {
        list.push({ label, value: String(val) });
      }
    };
    add('Temperature', rawData.temperature);
    add('Top P', rawData.top_p);
    add('Top K', rawData.top_k);
    add('Min P', rawData.min_p);
    add('Top A', rawData.top_a);
    add('Rep Pen', rawData.repetition_penalty ?? rawData.rep_pen);
    add('Presence Pen', rawData.presence_penalty);
    add('Frequency Pen', rawData.frequency_penalty);
    add('Max Context', rawData.openai_max_context ?? rawData.max_context_length);
    add('Max Tokens', rawData.openai_max_tokens ?? rawData.max_tokens);
    return list;
  }, [rawData]);

  const persistEntries = async (nextEntries: PresetPromptEntry[], nextPresetName?: string) => {
    const clonedData = JSON.parse(JSON.stringify(character.data || {}));
    const targetObj =
      clonedData?.data && !clonedData.prompts && Array.isArray(clonedData.data.prompts)
        ? clonedData.data
        : clonedData;

    targetObj.prompts = nextEntries.map((item) => {
      const base = item._raw && typeof item._raw === 'object' ? { ...item._raw } : {};
      return {
        ...base,
        identifier: item.identifier,
        name: item.name,
        role: item.role || 'system',
        content: item.content,
        system_prompt: !!item.system_prompt,
        marker: !!item.marker,
        enabled: !!item.enabled,
        injection_position: item.injection_position ?? 0,
        injection_depth: item.injection_depth ?? 4,
        injection_order: item.injection_order ?? 100,
      };
    });

    const newOrderList = nextEntries.map((item) => ({
      identifier: item.identifier,
      enabled: !!item.enabled,
    }));

    if (Array.isArray(targetObj.prompt_order)) {
      const idx100001 = targetObj.prompt_order.findIndex(
        (b: any) => b && Number(b.character_id) === 100001 && Array.isArray(b.order),
      );
      if (idx100001 >= 0) {
        targetObj.prompt_order[idx100001].order = newOrderList;
      } else {
        const lastOrderIdx = [...targetObj.prompt_order]
          .reverse()
          .findIndex((b: any) => b && Array.isArray(b.order));
        if (lastOrderIdx >= 0) {
          const realIdx = targetObj.prompt_order.length - 1 - lastOrderIdx;
          targetObj.prompt_order[realIdx].order = newOrderList;
        } else {
          targetObj.prompt_order.push({ character_id: 100001, order: newOrderList });
        }
      }
    } else {
      targetObj.prompt_order = [{ character_id: 100001, order: newOrderList }];
    }

    if (nextPresetName !== undefined) {
      targetObj.name = nextPresetName;
      if (clonedData !== targetObj && clonedData.name !== undefined) {
        clonedData.name = nextPresetName;
      }
    }

    const updatedChar: CharacterCard = {
      ...character,
      name: nextPresetName !== undefined ? nextPresetName : character.name,
      data: clonedData,
      updatedAt: Date.now(),
    };

    await saveCharacter(updatedChar);
    onUpdate(updatedChar);
  };

  const commitPresetName = async (draft: string) => {
    const trimmed = draft.trim();
    setIsEditingPresetName(false);
    const currentName = character.name || rawData.name || '';
    if (!trimmed || trimmed === currentName) {
      setPresetNameDraft(currentName);
      return;
    }
    setPresetNameDraft(trimmed);
    await persistEntries(entries, trimmed);
  };

  const handleToggleEntry = async (index: number) => {
    const next = [...entries];
    next[index] = { ...next[index], enabled: !next[index].enabled };
    await persistEntries(next);
  };

  const handleMoveEntry = async (index: number, delta: number) => {
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= entries.length) return;
    const next = [...entries];
    const tmp = next[index];
    next[index] = next[targetIdx];
    next[targetIdx] = tmp;
    await persistEntries(next);
  };

  const handleDeleteEntry = async (index: number) => {
    const target = entries[index];
    if (!confirm(`确定要删除预设条目「${target.name || target.identifier}」吗？`)) return;
    const next = entries.filter((_, i) => i !== index);
    await persistEntries(next);
  };

  const handleOpenAdd = () => {
    setEditingIndex(-1);
    setEditingForm({
      identifier: crypto.randomUUID(),
      name: '新预设条目',
      role: 'system',
      content: '',
      system_prompt: false,
      marker: false,
      enabled: true,
      injection_position: 0,
      injection_depth: 4,
      injection_order: 100,
    });
  };

  const handleOpenEdit = (index: number) => {
    setEditingIndex(index);
    setEditingForm({ ...entries[index] });
  };

  const handleSaveEntry = async () => {
    if (!editingForm || editingIndex === null) return;
    const next = [...entries];
    const cleanForm: PresetPromptEntry = {
      ...editingForm,
      name: editingForm.name.trim() || '未命名条目',
    };
    if (editingIndex === -1) {
      next.push(cleanForm);
    } else {
      next[editingIndex] = cleanForm;
    }
    await persistEntries(next);
    setEditingIndex(null);
    setEditingForm(null);
  };

  const handleCopyContent = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
    } catch {}
  };

  const handleExportJson = async () => {
    const jsonStr = JSON.stringify(rawData, null, 2);
    const safeName = (character.name || rawData.name || 'preset').replace(/[^a-zA-Z0-9_\u4e00-\u9fa5\-]/g, '_');
    const bytes = new TextEncoder().encode(jsonStr);
    await downloadOrShareFile(`${safeName}.json`, bytes.buffer, 'application/json', true);
  };

  const currentPresetName = character.name || rawData.name || '未命名预设';

  return (
    <div className="flex flex-col gap-3 w-full relative">
      {/* 顶部标题与操作栏（对齐 WorldbookViewer） */}
      <div className="flex items-center justify-between gap-3 border-b border-white/10 [.light-theme_&]:!border-[#e2e8f0] pb-2.5">
        <div className="min-w-0 flex-1">
          {isEditingPresetName ? (
            <input
              type="text"
              value={presetNameDraft}
              onChange={(e) => setPresetNameDraft(e.target.value)}
              onBlur={() => void commitPresetName(presetNameDraft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  setPresetNameDraft(currentPresetName);
                  setIsEditingPresetName(false);
                }
              }}
              placeholder="输入预设名称"
              className="w-full bg-transparent border-b border-blue-500/80 text-lg font-semibold text-white/95 placeholder:text-white/30 focus:outline-none py-0.5 leading-snug [.light-theme_&]:!text-[#0f172a]"
              autoFocus
            />
          ) : (
            <h3
              onClick={() => {
                setPresetNameDraft(currentPresetName);
                setIsEditingPresetName(true);
              }}
              title="点击修改预设名称"
              className="inline-block max-w-full text-lg font-semibold text-white/90 [.light-theme_&]:!text-[#0f172a] truncate cursor-text rounded-md px-1.5 -mx-1.5 py-0.5 hover:bg-white/[0.06] [.light-theme_&]:hover:bg-black/[0.04] transition-colors"
            >
              {currentPresetName}
            </h3>
          )}
          <p className="text-xs text-white/55 [.light-theme_&]:!text-[#64748b] mt-0.5">
            共 {entries.length} 条 · 已启用 {enabledCount} 条 · 含正文 {contentEntriesCount} 条
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {genParams.length > 0 && (
            <button
              type="button"
              onClick={() => setShowParams((v) => !v)}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition active:scale-95 cursor-pointer shadow-xs ${
                showParams
                  ? 'bg-blue-600 text-white border border-blue-500 shadow-sm'
                  : 'soft-pill'
              }`}
              title="查看生成参数"
            >
              <Sliders className="w-4 h-4 opacity-85" />
            </button>
          )}
          <button
            type="button"
            onClick={handleExportJson}
            className="w-9 h-9 rounded-full soft-pill flex items-center justify-center transition active:scale-95 cursor-pointer shadow-xs"
            title={getDownloadTooltip('导出预设 JSON')}
          >
            <Download className="w-4 h-4 opacity-80" />
          </button>
          <button
            type="button"
            onClick={() => setShowControls((v) => !v)}
            className={`w-9 h-9 rounded-full flex items-center justify-center transition active:scale-95 cursor-pointer shadow-xs ${
              showControls
                ? 'bg-blue-600 text-white border border-blue-500 shadow-sm'
                : 'soft-pill'
            }`}
            title="管理预设"
          >
            <Edit2 className="w-4 h-4 opacity-80" />
          </button>
        </div>
      </div>

      {/* 管理工具条 */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex justify-end items-center gap-2 pb-1">
              <button
                type="button"
                onClick={() => {
                  setPresetNameDraft(currentPresetName);
                  setIsEditingPresetName(true);
                }}
                className="soft-pill px-3.5 py-2 rounded-full text-xs sm:text-sm font-medium flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
              >
                <Edit2 className="w-3.5 h-3.5 opacity-80" />
                <span>更名</span>
              </button>
              <button
                type="button"
                onClick={handleOpenAdd}
                className="soft-pill px-3.5 py-2 rounded-full text-xs sm:text-sm font-medium flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 opacity-80" />
                <span>添加条目</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 生成参数展开面板 */}
      <AnimatePresence>
        {showParams && genParams.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="detail-card rounded-2xl p-3.5 sm:p-4 mb-1">
              <div className="text-xs font-semibold text-white/70 [.light-theme_&]:!text-[#475569] mb-2.5">
                生成参数 (Generation Settings)
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 text-xs">
                {genParams.map((item) => (
                  <div
                    key={item.label}
                    className="px-3 py-2 rounded-xl bg-black/25 border border-white/10 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!border-[#e2e8f0] flex items-center justify-between gap-2"
                  >
                    <span className="text-white/50 [.light-theme_&]:!text-[#64748b] truncate">{item.label}</span>
                    <span className="font-mono font-semibold text-white/90 [.light-theme_&]:!text-[#0f172a] shrink-0">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 兼容旧版 system_prompt / post_history_instructions 展示 */}
      {(rawData.system_prompt || rawData.post_history_instructions) && entries.length === 0 && (
        <div className="space-y-3">
          {rawData.system_prompt && (
            <div className="detail-card rounded-2xl p-4">
              <div className="text-xs font-bold text-blue-300 [.light-theme_&]:!text-[#007aff] mb-2">
                系统提示词 (System Prompt)
              </div>
              <p className="text-sm whitespace-pre-wrap break-words detail-card-text">{rawData.system_prompt}</p>
            </div>
          )}
          {rawData.post_history_instructions && (
            <div className="detail-card rounded-2xl p-4">
              <div className="text-xs font-bold text-blue-300 [.light-theme_&]:!text-[#007aff] mb-2">
                历史后提示词 (Post History Instructions)
              </div>
              <p className="text-sm whitespace-pre-wrap break-words detail-card-text">
                {rawData.post_history_instructions}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 条目列表 */}
      <div className="space-y-2.5">
        {filteredItems.length === 0 ? (
          <div className="w-full detail-card p-8 rounded-2xl flex flex-col items-center justify-center text-center">
            <FileText className="w-11 h-11 mb-3 opacity-35 text-slate-400 [.light-theme_&]:!text-slate-500" />
            <p className="detail-card-text text-sm font-medium">
              {entries.length === 0 ? '该预设中暂未识别到提示词条目' : '没有符合条件的预设条目'}
            </p>
            {entries.length === 0 && (
              <p className="detail-card-text-muted text-xs mt-1">
                若预设包含旧版参数或纯文本提示词，可点击「原生数据」查看或点击上方「添加条目」
              </p>
            )}
          </div>
        ) : (
          (searchQuery.trim() ? filteredItems : filteredItems.slice(0, visibleEntryCount)).map(({ entry, index }) => {
            const isExpanded = expandedIds.has(entry.identifier);
            const hasContent = entry.content.trim().length > 0;
            const roleLabel =
              entry.role === 'user' ? 'User' : entry.role === 'assistant' ? 'Assistant' : 'System';
            const roleBadgeClass =
              entry.role === 'user'
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20 [.light-theme_&]:!bg-emerald-50 [.light-theme_&]:!text-emerald-700 [.light-theme_&]:!border-emerald-200'
                : entry.role === 'assistant'
                  ? 'bg-violet-500/15 text-violet-300 border-violet-500/20 [.light-theme_&]:!bg-violet-50 [.light-theme_&]:!text-violet-700 [.light-theme_&]:!border-violet-200'
                  : 'bg-blue-500/15 text-blue-300 border-blue-500/20 [.light-theme_&]:!bg-[#eff6ff] [.light-theme_&]:!text-[#007aff] [.light-theme_&]:!border-[#bfdbfe]';

            return (
              <div
                key={`${entry.identifier}_${index}`}
                className={`w-full detail-card p-3.5 rounded-2xl transition-opacity ${
                  entry.enabled ? '' : 'opacity-55'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-mono text-white/40 [.light-theme_&]:!text-[#94a3b8] shrink-0">
                        #{index + 1}
                      </span>
                      <h4 className="font-semibold text-blue-300 [.light-theme_&]:!text-[#1d4ed8] text-sm truncate">
                        {entry.name}
                      </h4>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <button
                        type="button"
                        onClick={() => void handleToggleEntry(index)}
                        className={`text-[10.5px] px-2 py-0.5 rounded-full font-semibold border transition cursor-pointer ${
                          entry.enabled
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25 [.light-theme_&]:!bg-emerald-50 [.light-theme_&]:!text-emerald-700 [.light-theme_&]:!border-emerald-200'
                            : 'bg-white/5 text-white/45 border-white/10 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#64748b] [.light-theme_&]:!border-[#e2e8f0]'
                        }`}
                        title="点击切换启用/禁用"
                      >
                        {entry.enabled ? '已启用' : '已禁用'}
                      </button>

                      <span className={`text-[10.5px] px-2 py-0.5 rounded-full font-medium border ${roleBadgeClass}`}>
                        {roleLabel}
                      </span>

                      {entry.injection_position === 1 && (
                        <span className="text-[10.5px] px-2 py-0.5 rounded-full font-medium bg-amber-500/15 text-amber-300 border border-amber-500/20 [.light-theme_&]:!bg-amber-50 [.light-theme_&]:!text-amber-700 [.light-theme_&]:!border-amber-200">
                          对话深度 @{entry.injection_depth ?? 4}
                        </span>
                      )}

                      {entry.marker && (
                        <span className="text-[10.5px] px-2 py-0.5 rounded-full font-medium bg-white/10 text-white/60 border border-white/10 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#64748b] [.light-theme_&]:!border-[#e2e8f0]">
                          系统占位
                        </span>
                      )}

                      {hasContent && (
                        <span className="text-[10.5px] text-white/45 [.light-theme_&]:!text-[#64748b] font-mono">
                          {entry.content.length} 字
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 操作按钮：保留上下移动，其余采用迭代三个点菜单 */}
                  <div className="flex items-center gap-0.5 sm:gap-1 shrink-0 relative">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => void handleMoveEntry(index, -1)}
                      className="p-1.5 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition [.light-theme_&]:text-slate-400 [.light-theme_&]:hover:text-[#0f172a] disabled:opacity-20 disabled:pointer-events-none cursor-pointer"
                      title="上移条目"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      disabled={index === entries.length - 1}
                      onClick={() => void handleMoveEntry(index, 1)}
                      className="p-1.5 hover:bg-white/10 rounded-lg text-white/60 hover:text-white transition [.light-theme_&]:text-slate-400 [.light-theme_&]:hover:text-[#0f172a] disabled:opacity-20 disabled:pointer-events-none cursor-pointer"
                      title="下移条目"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>

                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => handleToggleEntryMenu(index, entry, hasContent, e)}
                        className="p-1.5 hover:bg-white/10 rounded-lg text-white/70 hover:text-white transition [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:text-[#0f172a] cursor-pointer"
                        title="更多操作"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* 折叠正文展示区（默认折叠，点击展开，p4 风格） */}
                {hasContent && (
                  <div className="mt-2 pt-2 border-t border-white/10 [.light-theme_&]:!border-[#e2e8f0]">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(entry.identifier)) next.delete(entry.identifier);
                            else next.add(entry.identifier);
                            return next;
                          });
                        }}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 [.light-theme_&]:!text-[#007aff] hover:underline cursor-pointer"
                      >
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        <span>{isExpanded ? '收起提示词正文' : '展开提示词正文'}</span>
                      </button>
                      <span className="text-[11px] font-mono text-white/40 [.light-theme_&]:!text-[#64748b]">
                        {entry.content.length} 字
                      </span>
                    </div>

                    {isExpanded && (
                      <div className="mt-2 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words detail-card-text bg-black/20 [.light-theme_&]:!bg-[#f8fafc] p-3 rounded-xl border border-white/5 [.light-theme_&]:!border-black/[0.06]">
                        {entry.content}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
        {!searchQuery.trim() && visibleEntryCount < filteredItems.length && (
          <div ref={loadMoreRef} className="py-3 text-center">
            <button
              type="button"
              onClick={() => setVisibleEntryCount((v) => v + 40)}
              className="text-xs font-medium text-blue-400 [.light-theme_&]:!text-[#007aff] hover:underline cursor-pointer"
            >
              加载更多条目 ({visibleEntryCount} / {filteredItems.length})
            </button>
          </div>
        )}
      </div>

      {/* 条目更多操作顶层 Portal 浮层菜单（避免被卡片 overflow-hidden 或兄弟卡片层叠遮挡） */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {entryMenuState && (
            <div
              className={`fixed inset-0 z-[300] select-none ${isThemeLight ? 'light-theme' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setEntryMenuState(null);
              }}
              onTouchStart={(e) => {
                if (e.target === e.currentTarget) {
                  e.stopPropagation();
                  setEntryMenuState(null);
                }
              }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: entryMenuState.placement === 'top' ? 6 : -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: entryMenuState.placement === 'top' ? 6 : -6 }}
                transition={{ duration: 0.15 }}
                style={{
                  position: 'fixed',
                  left: `${entryMenuState.x}px`,
                  top: entryMenuState.placement === 'top' ? undefined : `${entryMenuState.y}px`,
                  bottom: entryMenuState.placement === 'top' ? `${window.innerHeight - entryMenuState.y}px` : undefined,
                }}
                className={`z-[301] w-[152px] rounded-2xl p-1.5 border backdrop-blur-xl shadow-2xl overflow-hidden ${
                  isThemeLight
                    ? 'bg-white/95 border-[#e2e8f0] text-[#0f172a] shadow-xl'
                    : 'bg-[#181b24]/95 border-white/15 text-white shadow-2xl'
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                {entryMenuState.hasContent && (
                  <button
                    type="button"
                    onClick={() => {
                      const { entry } = entryMenuState;
                      setEntryMenuState(null);
                      void handleCopyContent(entry.identifier, entry.content);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
                      isThemeLight
                        ? 'text-[#0f172a] hover:bg-[#f1f5f9] active:bg-[#e2e8f0]'
                        : 'text-white/90 hover:bg-white/10 active:bg-white/15'
                    }`}
                  >
                    {copiedId === entryMenuState.entry.identifier ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 opacity-70 shrink-0" />
                    )}
                    <span>{copiedId === entryMenuState.entry.identifier ? '已复制正文' : '复制正文'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const { index } = entryMenuState;
                    setEntryMenuState(null);
                    handleOpenEdit(index);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
                    isThemeLight
                      ? 'text-[#0f172a] hover:bg-[#f1f5f9] active:bg-[#e2e8f0]'
                      : 'text-white/90 hover:bg-white/10 active:bg-white/15'
                  }`}
                >
                  <Edit2 className="w-3.5 h-3.5 opacity-70 shrink-0" />
                  <span>编辑条目</span>
                </button>
                <div className={`my-1 border-t ${isThemeLight ? 'border-[#f1f5f9]' : 'border-white/10'}`} />
                <button
                  type="button"
                  onClick={() => {
                    const { index } = entryMenuState;
                    setEntryMenuState(null);
                    void handleDeleteEntry(index);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
                    isThemeLight
                      ? 'text-[#ff3b30] hover:bg-[#ff3b30]/10 active:bg-[#ff3b30]/15'
                      : 'text-red-400 hover:bg-red-500/20 active:bg-red-500/25'
                  }`}
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  <span>删除条目</span>
                </button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {/* 新增 / 编辑预设条目弹窗 */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {editingIndex !== null && editingForm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`fixed inset-0 z-[99999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] ${isThemeLight ? 'light-theme' : ''}`}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-2xl bg-slate-900 border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[min(90vh,calc(100dvh-2rem))] [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-black/10 [.light-theme_&]:!text-[#1c1c1e]"
              >
                <div className="flex-none p-4 sm:p-6 border-b border-white/10 flex justify-between items-center bg-black/20 [.light-theme_&]:border-black/5 [.light-theme_&]:bg-black/5">
                  <h3 className="text-lg font-bold text-white [.light-theme_&]:!text-[#0f172a]">
                    {editingIndex === -1 ? '新增预设条目' : '编辑预设条目'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingIndex(null);
                      setEditingForm(null);
                    }}
                    className="p-2 hover:bg-white/10 rounded-full text-white/60 hover:text-white transition [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:text-[#1c1c1e] cursor-pointer"
                  >
                    <XIcon className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 custom-scrollbar">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-white/60 [.light-theme_&]:!text-slate-600 mb-1.5 font-medium">
                        条目名称
                      </label>
                      <input
                        type="text"
                        value={editingForm.name}
                        onChange={(e) => setEditingForm({ ...editingForm, name: e.target.value })}
                        placeholder="输入预设条目名称"
                        className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-blue-500 [.light-theme_&]:!bg-black/5 [.light-theme_&]:!border-black/10 [.light-theme_&]:!text-[#1c1c1e]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-white/60 [.light-theme_&]:!text-slate-600 mb-1.5 font-medium">
                        消息角色 (Role)
                      </label>
                      <select
                        value={editingForm.role}
                        onChange={(e) => setEditingForm({ ...editingForm, role: e.target.value })}
                        className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-blue-500 [.light-theme_&]:!bg-black/5 [.light-theme_&]:!border-black/10 [.light-theme_&]:!text-[#1c1c1e]"
                      >
                        <option value="system">System</option>
                        <option value="user">User</option>
                        <option value="assistant">Assistant</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-white/60 [.light-theme_&]:!text-slate-600 mb-1.5 font-medium">
                        插入方式
                      </label>
                      <select
                        value={editingForm.injection_position ?? 0}
                        onChange={(e) =>
                          setEditingForm({ ...editingForm, injection_position: Number(e.target.value) })
                        }
                        className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 [.light-theme_&]:!bg-black/5 [.light-theme_&]:!border-black/10 [.light-theme_&]:!text-[#1c1c1e]"
                      >
                        <option value={0}>相对位置</option>
                        <option value={1}>对话中插入 (@深度)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-white/60 [.light-theme_&]:!text-slate-600 mb-1.5 font-medium">
                        插入深度 (Depth)
                      </label>
                      <input
                        type="number"
                        value={editingForm.injection_depth ?? 4}
                        onChange={(e) =>
                          setEditingForm({ ...editingForm, injection_depth: Number(e.target.value) })
                        }
                        className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 [.light-theme_&]:!bg-black/5 [.light-theme_&]:!border-black/10 [.light-theme_&]:!text-[#1c1c1e]"
                      />
                    </div>
                    <div className="flex items-end pb-1">
                      <label className="flex items-center gap-2 cursor-pointer text-sm text-white/85 [.light-theme_&]:!text-[#0f172a]">
                        <input
                          type="checkbox"
                          checked={editingForm.enabled}
                          onChange={(e) => setEditingForm({ ...editingForm, enabled: e.target.checked })}
                          className="w-4 h-4 rounded accent-blue-600"
                        />
                        <span>启用此条目</span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs text-white/60 [.light-theme_&]:!text-slate-600 font-medium">
                        提示词正文
                      </label>
                      <span className="text-[11px] font-mono text-white/40 [.light-theme_&]:!text-[#64748b]">
                        {editingForm.content.length} 字
                      </span>
                    </div>
                    <textarea
                      value={editingForm.content}
                      onChange={(e) => setEditingForm({ ...editingForm, content: e.target.value })}
                      placeholder="输入预设提示词内容..."
                      rows={10}
                      className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white text-sm leading-relaxed focus:outline-none focus:border-blue-500 [.light-theme_&]:!bg-black/5 [.light-theme_&]:!border-black/10 [.light-theme_&]:!text-[#1c1c1e] custom-scrollbar resize-y"
                    />
                  </div>
                </div>

                <div className="flex-none p-4 sm:p-6 border-t border-white/10 bg-black/20 flex justify-end gap-3 [.light-theme_&]:border-black/5 [.light-theme_&]:bg-black/5">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingIndex(null);
                      setEditingForm(null);
                    }}
                    className="px-4 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:text-[#1c1c1e] [.light-theme_&]:hover:bg-black/10 cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveEntry()}
                    className="px-6 py-2 rounded-full font-bold text-xs sm:text-sm bg-white text-black hover:bg-neutral-200 [.light-theme_&]:!bg-[#007aff] [.light-theme_&]:!text-white [.light-theme_&]:hover:!bg-[#0066d6] transition flex items-center gap-2 shadow-xs cursor-pointer"
                  >
                    <Save className="w-4 h-4 stroke-[2.5]" />
                    <span>保存</span>
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
};
