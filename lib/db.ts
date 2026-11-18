import { getFallbackAvatar, isFallbackMiuImage, resolveAvatarUrl, safeCreateObjectURL } from "./avatar";
import { openDB, DBSchema, IDBPDatabase } from "idb";
import { getLocalImageUrl, isAndroid } from "./appBridge";
import { sanitizeChatMessages } from "./chatParse";
import { getCharacterTokenBreakdown } from "./tokens";
import { isStoredPlaceholderCopy } from "./placeholder";
import { withReadSlot } from "./thumbCache";
import {
  containsPositiveMatch,
  normalizeSearchString,
  matchesCharacterSearchUtil,
  getCharacterSearchScoreUtil,
} from "./searchUtils";

// 本地 Android 文件移动/扫描已全面移除，完全使用 IndexedDB + 云端同步。

// 批量写入（比如一次导入几千张卡）时，逐条派发 charactersUpdated 会让首页列表被反复整表重载。
// 批量模式下先攒着不发，结束或短时间内的重复派发再合并成一次。
let _bulkUpdateDepth = 0;
let _pendingBulkNotify = false;
let _charactersUpdatedTimer: ReturnType<typeof setTimeout> | null = null;
let _charactersUpdatedLastAt = 0;
const CHARACTERS_UPDATED_MIN_INTERVAL = 500;

export function beginBulkCharacterUpdates(): void {
  _bulkUpdateDepth++;
}

export function endBulkCharacterUpdates(): void {
  if (_bulkUpdateDepth > 0) _bulkUpdateDepth--;
  if (_bulkUpdateDepth === 0 && _pendingBulkNotify) {
    _pendingBulkNotify = false;
    if (_charactersUpdatedTimer) {
      clearTimeout(_charactersUpdatedTimer);
      _charactersUpdatedTimer = null;
    }
    notifyCharactersUpdated();
  }
}

function notifyCharactersUpdated(): void {
  if (typeof window === "undefined") return;
  if (_bulkUpdateDepth > 0) {
    _pendingBulkNotify = true;
    return;
  }
  const now = Date.now();
  const elapsed = now - _charactersUpdatedLastAt;
  if (elapsed < CHARACTERS_UPDATED_MIN_INTERVAL) {
    if (_charactersUpdatedTimer) return;
    _charactersUpdatedTimer = setTimeout(() => {
      _charactersUpdatedTimer = null;
      notifyCharactersUpdated();
    }, CHARACTERS_UPDATED_MIN_INTERVAL - elapsed);
    return;
  }
  _charactersUpdatedLastAt = now;
  window.dispatchEvent(new CustomEvent("charactersUpdated"));
}

export type ResourceType = 'character' | 'worldbook' | 'qr' | 'preset' | 'script' | 'theme';

export function getSafeFilename(name: string): string {
  if (!name) return "Unknown";
  return name.replace(/[\\/:\*\?"<>\|]/g, "_").trim();
}

/**
 * 严格判定是否为真正的酒馆角色卡 (Character Card)
 * SillyTavern 角色卡核心特征：
 * 1. 显式规范：chara_card_v1 / v2 / v3
 * 2. 独有核心交互字段：首条开场白 (first_mes)、性格 (personality)、对话示例 (mes_example)、备用开场白 (alternate_greetings)、人设 (char_persona)
 * 3. 包含角色名称且具有人设设定 (description) / 场景 (scenario)
 * 4. 注意：酒馆角色卡经常内置 character_book（内嵌世界书），这属于角色卡自身的背景知识库，绝非独立世界书工具！
 */
export function isActualCharacterCard(rawData: any, foldersMap?: Map<string, string>): boolean {
  if (!rawData) return false;
  if (Array.isArray(rawData)) return false;

  const outer = rawData?.data || rawData;
  const target = (outer?.data && typeof outer.data === 'object' && !Array.isArray(outer.data)) ? outer.data : outer;

  // 1. 显式规范 (chara_card_v1 / chara_card_v2 / chara_card_v3)
  const isExplicitCharSpec = 
    rawData.spec === "chara_card_v2" || rawData.spec === "chara_card_v3" || rawData.spec === "chara_card_v1" ||
    outer.spec === "chara_card_v2" || outer.spec === "chara_card_v3" || outer.spec === "chara_card_v1" ||
    target.spec === "chara_card_v2" || target.spec === "chara_card_v3" || target.spec === "chara_card_v1";

  if (isExplicitCharSpec) {
    return true;
  }

  // 2. 角色独有的对话与人设交互核心字段 (只要具备开场白、性格、对话示例、备用开场白之一，即为角色卡)
  const hasCharDialogue = 
    Boolean(target.first_mes && String(target.first_mes).trim().length > 0) ||
    Boolean(target.personality && String(target.personality).trim().length > 0) ||
    Boolean(target.char_persona && String(target.char_persona).trim().length > 0) ||
    Boolean(target.mes_example && String(target.mes_example).trim().length > 0) ||
    Boolean(Array.isArray(target.alternate_greetings) && target.alternate_greetings.length > 0) ||
    Boolean(outer.first_mes && String(outer.first_mes).trim().length > 0) ||
    Boolean(outer.personality && String(outer.personality).trim().length > 0) ||
    Boolean(outer.char_persona && String(outer.char_persona).trim().length > 0) ||
    Boolean(outer.mes_example && String(outer.mes_example).trim().length > 0) ||
    Boolean(Array.isArray(outer.alternate_greetings) && outer.alternate_greetings.length > 0);

  if (hasCharDialogue) {
    return true;
  }

  // 3. 检查是否为纯粹独立工具（如顶层即为 entries 词条字典且无角色描述和姓名）
  const hasRootEntries = 
    (rawData.entries !== undefined && typeof rawData.entries === 'object') ||
    (outer.entries !== undefined && typeof outer.entries === 'object');
  const hasStandaloneQr = 
    (Array.isArray(rawData.qrList) && rawData.qrList.length > 0) ||
    (Array.isArray(outer.qrList) && outer.qrList.length > 0);
  const hasStandalonePrompts = 
    (Array.isArray(rawData.prompts) && rawData.prompts.length > 0) ||
    (Array.isArray(outer.prompts) && outer.prompts.length > 0);

  if (hasRootEntries || hasStandaloneQr || hasStandalonePrompts) {
    return false;
  }

  // 4. 普通角色卡 (包含名字 + 人设描述 / 场景设定)
  const charName = 
    rawData.name || rawData.char_name || rawData.character_name ||
    outer.name || outer.char_name || outer.character_name ||
    target.name || target.char_name || target.character_name;

  const hasCharacterContent =
    Boolean(target.description && String(target.description).trim().length > 0) ||
    Boolean(target.scenario && String(target.scenario).trim().length > 0) ||
    Boolean(target.creator_notes && String(target.creator_notes).trim().length > 0) ||
    Boolean(target.system_prompt && String(target.system_prompt).trim().length > 0) ||
    Boolean(outer.description && String(outer.description).trim().length > 0) ||
    Boolean(outer.scenario && String(outer.scenario).trim().length > 0);

  if (charName && hasCharacterContent) {
    return true;
  }

  return false;
}

/**
 * 严格、精准地识别卡片或数据的资源类型：
 * 角色卡 (character) | 世界书 (worldbook) | 快速回复 (qr) | 预设 (preset) | 脚本 (script) | 美化 (theme)
 * 优先检测各工具的特征结构，杜绝工具因为带有 name/description 被误判为角色卡！
 */
export function getResourceType(char: any, foldersMap?: Map<string, string>): ResourceType {
  if (!char) return 'character';

  // 1. 优先检查是否为真正角色卡：如果是角色卡，绝不误判为世界书或其它工具
  // （即使卡片名称带“世界书”、文件名带“worldbook”或内嵌有 character_book）
  if (isActualCharacterCard(char, foldersMap)) {
    return 'character';
  }

  // 2. 检查显式指定类型或扩展标记
  if (char.cardType === 'character') return 'character';
  if (char.cardType === 'worldbook') return 'worldbook';
  if (char.cardType === 'qr') return 'qr';
  if (char.cardType === 'preset') return 'preset';
  if (char.cardType === 'script') return 'script';
  if (char.cardType === 'theme') return 'theme';

  // 3. 检查所属文件夹名称特征
  let folderName = "";
  if (char.folderId && foldersMap) {
    folderName = foldersMap.get(char.folderId) || "";
  } else if (char.folder) {
    folderName = String(char.folder);
  }
  const lowerFolder = folderName.toLowerCase();
  if (lowerFolder.includes("世界书") || lowerFolder.includes("worldbook") || lowerFolder.includes("lorebook")) return 'worldbook';
  if (lowerFolder.includes("快速回复") || lowerFolder.includes("quick_replies") || lowerFolder.includes("qr")) return 'qr';
  if (lowerFolder.includes("预设") || lowerFolder.includes("preset")) return 'preset';
  if (lowerFolder.includes("脚本") || lowerFolder.includes("script") || lowerFolder.includes("正则") || lowerFolder.includes("regex")) return 'script';
  if (lowerFolder.includes("美化") || lowerFolder.includes("theme")) return 'theme';

  const rawData = char?.data?.data || char?.data || char || {};
  const outer = char?.data || char || {};
  const target = (outer.data && typeof outer.data === 'object' && !Array.isArray(outer.data)) ? outer.data : outer;
  const original = rawData.original_data || outer.original_data || target.original_data || {};

  // 4. 独立世界书 (Worldbook / Lorebook) 特征签名
  // 酒馆独立世界书格式：顶层包含 entries（词条字典或列表），且不具备角色对话交互特征
  const hasRootEntries =
    (rawData.entries !== undefined && typeof rawData.entries === 'object') ||
    (outer.entries !== undefined && typeof outer.entries === 'object') ||
    (target.entries !== undefined && typeof target.entries === 'object') ||
    (original.entries !== undefined && typeof original.entries === 'object');

  const hasWorldbookProps =
    rawData.world_book !== undefined || outer.world_book !== undefined || target.world_book !== undefined || original.world_book !== undefined ||
    rawData.lorebook !== undefined || outer.lorebook !== undefined || target.lorebook !== undefined || original.lorebook !== undefined ||
    rawData.lorebookVersion !== undefined || outer.lorebookVersion !== undefined ||
    rawData.world_info !== undefined || outer.world_info !== undefined || target.world_info !== undefined ||
    (rawData.scan_depth !== undefined && rawData.token_budget !== undefined) ||
    (outer.scan_depth !== undefined && outer.token_budget !== undefined) ||
    (target.scan_depth !== undefined && target.token_budget !== undefined);

  const rawName = String(char.name || rawData.name || outer.name || target.name || '').trim();
  const filename = String(char.autoImportFilename || '').toLowerCase();

  const isWorldbookFileOrName =
    filename.endsWith('.lorebook') || filename.endsWith('_lorebook') || filename.endsWith('-lorebook') ||
    filename.endsWith('.worldbook') || filename.endsWith('_worldbook') || filename.endsWith('-worldbook') ||
    filename.includes('.lorebook.json') || filename.includes('_lorebook.json') || filename.includes('.worldbook.json') ||
    /(?:^|[_\-\s\[\(（【])(?:世界书|worldbook|lorebook|world_info)(?:[\]\)）】]|$|[_\-\s\.])/i.test(rawName);

  if (hasRootEntries || hasWorldbookProps || isWorldbookFileOrName) {
    return 'worldbook';
  }

  // 5. 独立快速回复 (QR / Quick Reply) 特征签名
  const isQrArray = Array.isArray(rawData) && rawData.length > 0 && 
    (rawData[0]?.label !== undefined || rawData[0]?.message !== undefined || rawData[0]?.set !== undefined || rawData[0]?.button !== undefined || rawData[0]?.execute !== undefined);

  const hasQrList = 
    (Array.isArray(rawData.qrList) && rawData.qrList.length >= 0) ||
    (Array.isArray(outer.qrList) && outer.qrList.length >= 0) ||
    (Array.isArray(target.qrList) && target.qrList.length >= 0) ||
    rawData.qrList !== undefined || outer.qrList !== undefined || target.qrList !== undefined;

  const hasQrSettings = 
    rawData.disableSend !== undefined || outer.disableSend !== undefined || target.disableSend !== undefined ||
    rawData.showPanel !== undefined || outer.showPanel !== undefined || target.showPanel !== undefined ||
    rawData.placeholders !== undefined || outer.placeholders !== undefined || target.placeholders !== undefined ||
    rawData.preventSend !== undefined || outer.preventSend !== undefined;

  const hasStandaloneQuickReplies = 
    Array.isArray(rawData.quick_replies) ||
    Array.isArray(outer.quick_replies) ||
    Array.isArray(target.quick_replies) ||
    Array.isArray(rawData.quickReplies) ||
    Array.isArray(rawData.tavern_qr_sets) ||
    Array.isArray(outer.tavern_qr_sets) ||
    Array.isArray(target.extensions?.quick_replies);

  const hasButtonsList = 
    (Array.isArray(rawData.buttons) && rawData.buttons.length > 0 &&
      (rawData.buttons[0]?.message !== undefined || rawData.buttons[0]?.label !== undefined || rawData.buttons[0]?.execute !== undefined));

  const isQrFileOrName =
    filename.includes('.qr.') || filename.includes('_qr.') || filename.includes('-qr.') ||
    filename.endsWith('.qr.json') || filename.endsWith('_qr.json') || filename.endsWith('-qr.json') ||
    filename.includes('quick_replies') || filename.includes('quickreply') ||
    /(?:^|[_\-\s\[\(（【])(?:qr|快速回复|快捷回复)(?:[\]\)）】]|$|[_\-\s\.])/i.test(rawName);

  if (char.isQR === true || isQrArray || hasQrList || hasQrSettings || hasStandaloneQuickReplies || hasButtonsList || isQrFileOrName) {
    return 'qr';
  }

  // 6. 独立生成预设 (Preset) 特征签名
  const hasPromptsArray = 
    (Array.isArray(rawData.prompts) && rawData.prompts.length > 0) ||
    (Array.isArray(outer.prompts) && outer.prompts.length > 0) ||
    (Array.isArray(target.prompts) && target.prompts.length > 0) ||
    (Array.isArray(original.prompts) && original.prompts.length > 0);
  const hasPresetProps = 
    Array.isArray(rawData.prompt_order) || Array.isArray(outer.prompt_order) || Array.isArray(target.prompt_order) ||
    rawData.preset_type !== undefined || outer.preset_type !== undefined || target.preset_type !== undefined ||
    rawData.completion_preset !== undefined || outer.completion_preset !== undefined || target.completion_preset !== undefined ||
    rawData.chat_completion_source !== undefined || outer.chat_completion_source !== undefined || target.chat_completion_source !== undefined ||
    rawData.min_p !== undefined || outer.min_p !== undefined || target.min_p !== undefined ||
    rawData.top_a !== undefined || outer.top_a !== undefined || target.top_a !== undefined ||
    rawData.tfs !== undefined || outer.tfs !== undefined || target.tfs !== undefined ||
    (rawData.temperature !== undefined && rawData.top_p !== undefined && rawData.openai_max_tokens !== undefined) ||
    (outer.temperature !== undefined && outer.top_p !== undefined && outer.openai_max_tokens !== undefined) ||
    (target.temperature !== undefined && target.top_p !== undefined && target.openai_max_tokens !== undefined);
  const isPresetFileOrName =
    filename.includes('.preset') || filename.includes('_preset') || filename.includes('-preset') ||
    /(?:^|[_\-\s\[\(（【])(?:预设|preset)(?:[\]\)）】]|$|[_\-\s\.])/i.test(rawName);

  if (hasPromptsArray || hasPresetProps || isPresetFileOrName) {
    return 'preset';
  }

  // 7. 独立美化主题 (Theme) 特征签名（需放在脚本/isTool 兜底之前，避免带 isTool 标记的主题或美化正则被归入脚本）
  const hasThemeProps =
    rawData.blur_strength !== undefined || outer.blur_strength !== undefined || target.blur_strength !== undefined ||
    rawData.main_text_color !== undefined || outer.main_text_color !== undefined || target.main_text_color !== undefined ||
    rawData.quote_text_color !== undefined || outer.quote_text_color !== undefined || target.quote_text_color !== undefined ||
    rawData.italics_text_color !== undefined || outer.italics_text_color !== undefined || target.italics_text_color !== undefined ||
    rawData.underline_text_color !== undefined || outer.underline_text_color !== undefined || target.underline_text_color !== undefined ||
    rawData.blur_tint_color !== undefined || outer.blur_tint_color !== undefined || target.blur_tint_color !== undefined ||
    rawData.chat_tint_color !== undefined || outer.chat_tint_color !== undefined || target.chat_tint_color !== undefined ||
    rawData.user_mes_blur_tint_color !== undefined || outer.user_mes_blur_tint_color !== undefined || target.user_mes_blur_tint_color !== undefined ||
    rawData.bot_mes_blur_tint_color !== undefined || outer.bot_mes_blur_tint_color !== undefined || target.bot_mes_blur_tint_color !== undefined ||
    rawData.shadow_color !== undefined || outer.shadow_color !== undefined || target.shadow_color !== undefined ||
    rawData.border_color !== undefined || outer.border_color !== undefined || target.border_color !== undefined ||
    rawData.chat_display !== undefined || outer.chat_display !== undefined || target.chat_display !== undefined ||
    rawData.theme_name !== undefined || outer.theme_name !== undefined || target.theme_name !== undefined ||
    rawData.chat_width !== undefined || outer.chat_width !== undefined || target.chat_width !== undefined ||
    rawData.font_scale !== undefined || outer.font_scale !== undefined || target.font_scale !== undefined ||
    rawData.avatar_style !== undefined || outer.avatar_style !== undefined || target.avatar_style !== undefined ||
    rawData.custom_css !== undefined || outer.custom_css !== undefined || target.custom_css !== undefined ||
    rawData.waifuMode !== undefined || outer.waifuMode !== undefined || target.waifuMode !== undefined ||
    rawData.fast_ui_mode !== undefined || outer.fast_ui_mode !== undefined || target.fast_ui_mode !== undefined ||
    rawData.bogus_folders !== undefined || outer.bogus_folders !== undefined || target.bogus_folders !== undefined ||
    rawData.type === 'theme' || outer.type === 'theme' || target.type === 'theme';

  const isThemeFileOrName =
    filename.endsWith('.css') ||
    filename.includes('.theme') || filename.includes('_theme') || filename.includes('-theme') ||
    /(?:^|[_\-\s\[\(（【])(?:美化|theme|皮肤|主题)(?:[\]\)）】]|$|[_\-\s\.])/i.test(rawName);

  if (hasThemeProps || isThemeFileOrName) {
    return 'theme';
  }

  // 8. 独立脚本 / 正则 (Script) 特征签名
  const isScriptArray = Array.isArray(rawData) && rawData.length > 0 && (rawData[0]?.findRegex !== undefined || rawData[0]?.replaceString !== undefined || rawData[0]?.find_regex !== undefined);
  const hasScriptProps = 
    rawData.findRegex !== undefined || outer.findRegex !== undefined || target.findRegex !== undefined ||
    rawData.replaceString !== undefined || outer.replaceString !== undefined || target.replaceString !== undefined ||
    rawData.find_regex !== undefined || outer.find_regex !== undefined || target.find_regex !== undefined ||
    rawData.replace_with !== undefined || outer.replace_with !== undefined || target.replace_with !== undefined ||
    rawData.run !== undefined || outer.run !== undefined || target.run !== undefined ||
    rawData.type === "script" || outer.type === "script" || target.type === "script" ||
    rawData.type === "tool" || outer.type === "tool" || target.type === "tool" ||
    rawData.script !== undefined || outer.script !== undefined || target.script !== undefined;
  const isScriptFileOrName =
    filename.includes('.script') || filename.includes('_script') || filename.includes('.regex') ||
    /(?:^|[_\-\s\[\(（【])(?:脚本|正则|script|regex)(?:[\]\)）】]|$|[_\-\s\.])/i.test(rawName);

  // 套壳写法：文件最外层是 { name, regex / scripts / regex_scripts: [...] }
  // 只认文件最外层（outer），不认卡内 extensions 里的正则，避免把角色卡误判成脚本。
  // 而且真角色卡在函数开头已被 isActualCharacterCard 拦截，根本走不到这里。
  const isNestedScriptContainer =
    (Array.isArray(outer.regex) && outer.regex.length > 0) ||
    (Array.isArray(outer.scripts) && outer.scripts.length > 0) ||
    (Array.isArray(outer.regex_scripts) && outer.regex_scripts.length > 0);

  if (isScriptArray || hasScriptProps || isScriptFileOrName || isNestedScriptContainer || char?.isTool) {
    return 'script';
  }

  // 9. 默认皆归类为普通角色卡 (character)
  return 'character';
}

export function getCharacterCategoryPrefix(char: any, foldersMap?: Map<string, string>): string {
  if (!char) return "未归类";

  // If this object is a lightweight meta (no data field attached)
  // and has a valid category property, use it directly!
  const isLightMeta = char.data === undefined;
  if (isLightMeta && typeof char.category === "string" && char.category !== "未归类") {
    return char.category;
  }

  const type = getResourceType(char, foldersMap);
  switch (type) {
    case 'qr': return '快速回复';
    case 'worldbook': return '世界书';
    case 'preset': return '预设';
    case 'theme': return '美化';
    case 'script': return '脚本';
    default: return '未归类';
  }
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  parentId?: string | null;
  sortOrder?: number;
  tags?: string[];
  isTool?: boolean;
  avatarBlob?: Blob;
  deletedAt?: number;
}

export interface CardVersionSnapshot {
  id: string;
  versionName?: string;
  note?: string;
  createdAt: number;
  fileModifiedAt?: number;
  data: any;
  avatarBlob?: Blob;
  avatarHistory?: Blob[];
  avatarUrlFallback?: string;
  cardName: string;
  sourceCharId?: string;
  sourceUrlFallback?: string;
  completeCardPngBlob?: Blob;
  tags?: string[];
}

export interface CharacterCard {
  id: string;
  name: string;
  autoImportFilename?: string;
  avatarBlob?: Blob;
  localFilePath?: string;
  avatarUrlFallback?: string;
  avatarHistory?: Blob[];
  versionHistory?: CardVersionSnapshot[];
  activeVersionId?: string;
  data: any;
  originalFile?: File;
  createdAt: number;
  updatedAt?: number;
  fileModifiedAt?: number;
  deletedAt?: number;
  folderId?: string;
  isFavorite?: boolean;
  hasBlobsSeparated?: boolean;
  sortOrder?: number;
  tags?: string[];
  aiSummary?: string;
  isTool?: boolean;
  isQR?: boolean;
  category?: string;
  sourceUrl?: string;
  updateUrl?: string;
  lastCheckResult?: any;
  lastCheckVersion?: string;
  lastCheckError?: string;
  lastCheckChanges?: any;
  lastCheckedAt?: number;
  tokenCount?: number;
  permanentTokens?: number;
}

export interface ChatLog {
  id: string;
  characterId: string;
  name: string;
  messages: any[];
  createdAt: number;
  updatedAt?: number;
  messageCount?: number;
  note?: string;
  firstAiName?: string;
  localFilePath?: string;
}

export interface ChatMetadata {
  id: string;
  characterId: string;
  name: string;
  createdAt: number;
  note?: string;
  messageCount: number;
  firstAiName?: string;
  lastMessagePreview?: string;
}

interface TavernDB extends DBSchema {
  characters: {
    key: string;
    value: CharacterCard;
    indexes: { "by-date": number; "by-folder": string };
  };
  folders: {
    key: string;
    value: Folder;
    indexes: { "by-date": number };
  };
  blobs: {
    key: string;
    value: { avatarBlob?: Blob; originalFile?: File; avatarHistory?: Blob[]; thumbBlob?: Blob };
  };
  thumbs: {
    key: string;
    value: { thumbBlob?: Blob; thumbVersion: number; noImage?: boolean };
  };
  char_meta: {
    key: string;
    value: CharMeta;
    indexes: { "by-folder": string };
  };
  chats: {
    key: string;
    value: ChatLog;
    indexes: { "by-character": string; "by-date": number };
  };
  chat_metadata: {
    key: string;
    value: ChatMetadata;
    indexes: { "by-character": string; "by-date": number };
  };
  memos: {
    key: string;
    value: CharacterMemo;
    indexes: { "by-character": string; "by-date": number };
  };
  user_personas: {
    key: string;
    value: UserPersona;
    indexes: { "by-date": number };
  };
}

export interface CharacterMemo {
  id: string;
  characterId: string;
  type: "text" | "image" | "file";
  content: string; // Markdown or File name
  blob?: Blob; // For images/files
  createdAt: number;
  isPinned?: boolean;
  order?: number;
}

export interface UserPersona {
  id: string;
  name: string;
  avatarBlob?: Blob;
  avatarUrlFallback?: string;
  content: string;
  isDefault?: boolean;
  boundCharacterIds?: string[];
  createdAt: number;
  updatedAt: number;
}

let dbPromise: Promise<IDBPDatabase<TavernDB>>;

export function initDB() {
  if (!dbPromise) {
    dbPromise = openDB<TavernDB>("tavern-manager-v2", 9, {
      async upgrade(db, oldVersion, newVersion, transaction) {
        if (oldVersion < 1) {
          const store = db.createObjectStore("characters", { keyPath: "id" });
          store.createIndex("by-date", "createdAt");
        }
        if (oldVersion < 2) {
          const charStore = transaction.objectStore("characters");
          charStore.createIndex("by-folder", "folderId");

          const folderStore = db.createObjectStore("folders", {
            keyPath: "id",
          });

          folderStore.createIndex("by-date", "createdAt");
        }
        if (oldVersion < 3) {
          db.createObjectStore("blobs");
        }
        if (oldVersion < 4) {
          const chatStore = db.createObjectStore("chats", { keyPath: "id" });
          chatStore.createIndex("by-character", "characterId");
          chatStore.createIndex("by-date", "createdAt");
        }
        if (oldVersion < 5) {
          const memoStore = db.createObjectStore("memos", { keyPath: "id" });
          memoStore.createIndex("by-character", "characterId");
          memoStore.createIndex("by-date", "createdAt");
        }
        if (oldVersion < 6) {
          const metaStore = db.createObjectStore("chat_metadata", {
            keyPath: "id",
          });

          metaStore.createIndex("by-character", "characterId");
          metaStore.createIndex("by-date", "createdAt");

          // Prepopulate chat_metadata from existing chats
          const chatStore = transaction.objectStore("chats");
          let cursor = await chatStore.openCursor();
          while (cursor) {
            const val = cursor.value;
            const aiMsg = val.messages?.find((m: any) => !m.is_user && m.name);
            const lastMsg = val.messages?.length
              ? val.messages[val.messages.length - 1]
              : null;
            let preview = lastMsg?.mes || "";
            if (preview.length > 200)
              preview = preview.substring(0, 200) + "...";

            metaStore.put({
              id: val.id,
              characterId: val.characterId,
              name: val.name,
              createdAt: val.createdAt,
              note: val.note,
              messageCount: val.messages?.length || 0,
              firstAiName: aiMsg?.name,
              lastMessagePreview: preview,
            });

            cursor = await cursor.continue();
          }
        }
        if (oldVersion < 7) {
          const charMetaStore = db.createObjectStore("char_meta", {
            keyPath: "id",
          });
          charMetaStore.createIndex("by-folder", "folderId");

          const charStore = transaction.objectStore("characters");
          let cursor = await charStore.openCursor();
          while (cursor) {
            charMetaStore.put(buildCharMeta(cursor.value));
            cursor = await cursor.continue();
          }
        }
        if (oldVersion < 8) {
          const personaStore = db.createObjectStore("user_personas", { keyPath: "id" });
          personaStore.createIndex("by-date", "createdAt");
        }
        if (oldVersion < 9) {
          if (!db.objectStoreNames.contains("thumbs")) {
            db.createObjectStore("thumbs");
          }
        }
      },
      blocked() {
        console.warn("IndexedDB open blocked by another tab or instance");
      },
      blocking() {
        console.warn("IndexedDB blocking database upgrade in another tab");
      },
      terminated() {
        console.warn("IndexedDB connection terminated unexpectedly");
        dbPromise = null as any;
      },
    }).catch((err) => {
      console.error("Failed to initialize IndexedDB:", err);
      dbPromise = null as any;
      throw err;
    });
  }
  return dbPromise;
}

const MIGRATION_V25_FLAG = 'tavern_migration_v25_done';

export async function migrateDatabase(
  onProgress?: (current: number, total: number) => void,
) {
  // Check migration gate to prevent startup CPU lag and device heating
  if (typeof localStorage !== 'undefined' && localStorage.getItem(MIGRATION_V25_FLAG) === 'true') {
    return;
  }

  const db = await initDB();

  const totalCharsCount = await db.count("characters");
  if (totalCharsCount === 0) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MIGRATION_V25_FLAG, 'true');
    }
    return;
  }

  // First pass: just count how many need migration without loading full objects into RAM
  let totalToMigrate = 0;
  let txCheck = db.transaction("characters", "readonly");
  let cursorCheck = await txCheck.objectStore("characters").openCursor();
  const unmigratedIds: string[] = [];

  while (cursorCheck) {
    if (!cursorCheck.value.hasBlobsSeparated) {
      unmigratedIds.push(cursorCheck.key as string);
    }
    cursorCheck = await cursorCheck.continue();
  }

  totalToMigrate = unmigratedIds.length;

  const CHUNK_SIZE = 10;
  for (let i = 0; i < totalToMigrate; i += CHUNK_SIZE) {
    const chunkIds = unmigratedIds.slice(i, i + CHUNK_SIZE);
    const writeTx = db.transaction(["characters", "blobs", "char_meta"], "readwrite");
    const charStore = writeTx.objectStore("characters");
    const blobStore = writeTx.objectStore("blobs");
    const charMetaStore = writeTx.objectStore("char_meta");

    for (const id of chunkIds) {
      const char = await charStore.get(id);
      if (!char) continue;

      if (char.avatarBlob || char.originalFile || char.avatarHistory) {
        await blobStore.put(
          {
            avatarBlob: char.avatarBlob,
            originalFile: char.originalFile,
            avatarHistory: char.avatarHistory,
          },
          char.id,
        );
      }

      delete char.avatarBlob;
      delete char.originalFile;
      delete char.avatarHistory;
      char.hasBlobsSeparated = true;

      await charStore.put(char);
      await charMetaStore.put(buildCharMeta(char));
    }
    await writeTx.done;

    if (onProgress) {
      onProgress(Math.min(i + CHUNK_SIZE, totalToMigrate), totalToMigrate);
    }
  }

  // Second pass: retroactively categorize tool cards into designated tool folders and refresh char_meta
  // 一次性迁移: 逐条用独立事务读/写(不跨任务持有事务), 需要改文件夹的先收集, 最后统一写回。
  // 注意不要在事务还开着的时候 await 定时器 —— 事务会被浏览器自动提交, 之后继续读写会抛
  // TransactionInactiveError, 迁移就会中途失败。
  const scanKeys = await db.getAllKeys("characters");
  const changedChars: CharacterCard[] = [];

  for (const scanKey of scanKeys) {
    const char = (await db.get("characters", scanKey)) as CharacterCard | undefined;
    if (!char) continue;
    const category = getCharacterCategoryPrefix(char);
    if (category !== "未归类" && (!char.folderId || char.folderId === "all")) {
      const folderName = category === "脚本" ? "工具区" : category;
      const targetFolderId = await getOrCreateNestedFolder([folderName]);
      if (targetFolderId && char.folderId !== targetFolderId) {
        char.folderId = targetFolderId;
        changedChars.push(char);
      }
    }
    await db.put("char_meta", buildCharMeta(char));
  }

  if (changedChars.length > 0) {
    const writeTx = db.transaction("characters", "readwrite");
    for (const char of changedChars) {
      await writeTx.store.put(char);
    }
    await writeTx.done;
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(MIGRATION_V25_FLAG, 'true');
  }

  invalidateCache();
}

let foldersCache: Folder[] | null = null;
let foldersPromise: Promise<Folder[]> | null = null;

export async function getFolders(): Promise<Folder[]> {
  if (foldersCache) return foldersCache.slice();
  if (!foldersPromise) {
    foldersPromise = (async () => {
      const db = await initDB();
      const folders = await db.getAllFromIndex("folders", "by-date");
      const sorted = folders.sort((a, b) => {
        if (a.sortOrder !== undefined && b.sortOrder !== undefined) {
          return a.sortOrder - b.sortOrder;
        }
        if (a.sortOrder !== undefined) return -1;
        if (b.sortOrder !== undefined) return 1;
        return b.createdAt - a.createdAt;
      });
      foldersCache = sorted;
      return sorted;
    })().finally(() => {
      foldersPromise = null;
    });
  }
  const res = await foldersPromise;
  return res.slice();
}

export async function getOrCreateNestedFolder(
  pathParts: string[],
  baseParentId?: string | null,
): Promise<string | undefined> {
  if (pathParts.length === 0) return baseParentId || undefined;
  let currentParentId: string | undefined = baseParentId || undefined;

  const folders = await getFolders();

  for (const part of pathParts) {
    const existing = folders.find(
      (f) =>
        f.name === part &&
        (f.parentId || undefined) === (currentParentId || undefined),
    );
    if (existing) {
      currentParentId = existing.id;
    } else {
      const newFolder: Folder = {
        id: crypto.randomUUID(),
        name: part,
        createdAt: Date.now(),
        parentId: currentParentId || undefined,
      };
      await saveFolder(newFolder);
      folders.push(newFolder);
      currentParentId = newFolder.id;
    }
  }
  return currentParentId;
}

export interface FolderPreviewItem {
  url: string;
  seed: string;
  tags?: string[];
  isTool?: boolean;
  /** 这张其实是「默认占位图」而不是真卡片图 —— 渲染端据此走 object-contain 小白底, 不会拉满 */
  isFallback?: boolean;
}

export async function getFolderPreviews(
  folderIds: string[],
  preloadedFolders?: Folder[],
): Promise<Record<string, FolderPreviewItem[]>> {
  if (folderIds.length === 0) return {};

  const previews: Record<string, FolderPreviewItem[]> = {};

  // 一次性在内存中按 folderId 分组所有未删除卡片，避免每个文件夹甚至每个嵌套子文件夹都开 IndexedDB 游标事务
  const [allMeta, allFolders, thumbCacheMod] = await Promise.all([
    getCachedMeta(),
    preloadedFolders ? Promise.resolve(preloadedFolders) : getFolders(),
    import("./thumbCache"),
  ]);

  const { peekFolderCoverUrl, putFolderCoverBlobUrl } = thumbCacheMod;

  const metasByFolder = new Map<string, CharMeta[]>();
  for (const m of allMeta) {
    if (m.deletedAt || !m.folderId) continue;
    let arr = metasByFolder.get(m.folderId);
    if (!arr) {
      arr = [];
      metasByFolder.set(m.folderId, arr);
    }
    arr.push(m);
  }

  const childrenByParent = new Map<string, string[]>();
  for (const f of allFolders) {
    if (!f.parentId) continue;
    let arr = childrenByParent.get(f.parentId);
    if (!arr) {
      arr = [];
      childrenByParent.set(f.parentId, arr);
    }
    arr.push(f.id);
  }

  let coverSortBy: SortOption = 'newest_import';
  try {
    const saved = localStorage.getItem('tavern_sortBy') as SortOption | null;
    if (saved) coverSortBy = saved;
  } catch {
    // ignore
  }

  const isToolMeta = (m: CharMeta) =>
    Boolean(
      m.isTool ||
        m.isQR ||
        m.tags?.some((t: string) =>
          ['tool', '工具', 'preset', 'regex', 'qr', '快捷回复'].includes(t.toLowerCase()),
        ),
    );

  // 廉价同步能确定的真卡图：安卓本地图片文件 / 卡片自带网络头像
  const cheapImageUrl = (m: CharMeta): string | undefined => {
    if (m.localFilePath && /\.(png|jpe?g|webp|gif|bmp)$/i.test(m.localFilePath)) {
      return getLocalImageUrl(m.localFilePath, m.updatedAt || m.createdAt);
    }
    if (m.avatarUrlFallback && !isFallbackMiuImage(m.avatarUrlFallback)) {
      return m.avatarUrlFallback;
    }
    return undefined;
  };

  const readThumbUrl = async (m: CharMeta): Promise<string | undefined> => {
    try {
      const cacheKey = `folder_cover_${m.id}:${m.updatedAt || m.createdAt || 0}`;
      const cached = peekFolderCoverUrl(cacheKey);
      if (cached) return cached;
      const thumbBlob = await getCharacterThumb(m.id);
      if (!thumbBlob) return undefined;
      return putFolderCoverBlobUrl(cacheKey, thumbBlob) || undefined;
    } catch {
      return undefined;
    }
  };

  await Promise.all(
    folderIds.map(async (folderId) => {
      const directMetas = metasByFolder.get(folderId);
      const metas: CharMeta[] = directMetas ? directMetas.slice() : [];

      // 如果当前文件夹直属卡片为空，递归查找子孙文件夹里的卡片作为预览候选
      if (metas.length === 0) {
        const seen = new Set<string>([folderId]);
        const stack = [...(childrenByParent.get(folderId) || [])];
        while (stack.length > 0) {
          const cId = stack.pop()!;
          if (seen.has(cId)) continue;
          seen.add(cId);
          const subMetas = metasByFolder.get(cId);
          if (subMetas && subMetas.length > 0) {
            for (const sm of subMetas) metas.push(sm);
          }
          const subChildren = childrenByParent.get(cId);
          if (subChildren) {
            for (const sc of subChildren) {
              if (!seen.has(sc)) stack.push(sc);
            }
          }
        }
      }

      const sortedMetas = metas.slice().sort((a, b) => {
        const aTool = isToolMeta(a);
        const bTool = isToolMeta(b);
        if (aTool !== bTool) return aTool ? 1 : -1;
        let diff = 0;
        switch (coverSortBy) {
          case 'custom': {
            const ao = a.sortOrder;
            const bo = b.sortOrder;
            if (ao !== undefined && bo !== undefined) diff = ao - bo;
            else if (ao !== undefined) diff = -1;
            else if (bo !== undefined) diff = 1;
            else diff = (b.createdAt || 0) - (a.createdAt || 0);
            break;
          }
          case 'oldest_import':
            diff = (a.createdAt || 0) - (b.createdAt || 0);
            break;
          case 'recently_modified':
            diff = (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
            break;
          case 'tokens_desc':
            diff = (b.tokenCount || 0) - (a.tokenCount || 0);
            break;
          case 'tokens_asc':
            diff = (a.tokenCount || 0) - (b.tokenCount || 0);
            break;
          case 'a_z':
            diff = (a.name || '').localeCompare(b.name || '', 'zh-CN');
            break;
          case 'z_a':
            diff = (b.name || '').localeCompare(a.name || '', 'zh-CN');
            break;
          case 'newest_import':
          default:
            diff = (b.createdAt || 0) - (a.createdAt || 0);
            break;
        }
        if (diff !== 0) return diff;
        // 关键稳定键：相同时间戳或名称时，固定按 ID 排序，保证每次计算顺序绝对一致，绝不跳动
        return (a.id || '').localeCompare(b.id || '');
      });

      const pickedItems: FolderPreviewItem[] = [];
      let firstMeta: CharMeta | undefined;
      // 探查深度放宽至 50 张卡：只要文件夹内有带头像的卡，就坚定找出来作为封面，绝不轻易误判成全空 miu
      let maxSearch = 50;
      for (const meta of sortedMetas) {
        if (!firstMeta) firstMeta = meta;
        if (pickedItems.length >= 2) break;
        if (maxSearch-- <= 0) break;

        let url = cheapImageUrl(meta);
        if (!url) {
          url = await readThumbUrl(meta);
        }
        if (!url) continue;

        pickedItems.push({
          url,
          seed: meta.name || meta.id,
          tags: meta.tags,
          isTool: meta.isTool,
          isFallback: false,
        });
      }
      if (pickedItems.length === 0 && firstMeta) {
        pickedItems.push({
          url: getFallbackAvatar(
            firstMeta.name || firstMeta.id,
            firstMeta.tags?.join(',') || (firstMeta.isTool ? 'tool' : undefined),
          ),
          seed: firstMeta.name || firstMeta.id,
          tags: firstMeta.tags,
          isTool: firstMeta.isTool,
          isFallback: true,
        });
      }

      previews[folderId] = pickedItems;
    }),
  );

  return previews;
}

export async function getFolderItemCounts(
  folderIds: string[],
): Promise<Record<string, number>> {
  if (folderIds.length === 0) return {};
  const meta = await getCachedMeta();
  const counts: Record<string, number> = {};
  for (const id of folderIds) {
    counts[id] = 0;
  }
  for (const m of meta) {
    if (!m.deletedAt && m.folderId && counts[m.folderId] !== undefined) {
      counts[m.folderId]++;
    }
  }
  return counts;
}

export async function resolveFolderPath(
  folderId?: string | null,
): Promise<string> {
  const defaultUncategorized = "未归类";
  if (!folderId) return defaultUncategorized;

  const folders = await getFolders();
  let currentId: string | undefined | null = folderId;
  const pathParts: string[] = [];

  while (currentId) {
    const folder = folders.find((f) => f.id === currentId);
    if (!folder) break;
    pathParts.unshift(folder.name);
    currentId = folder.parentId;

    if (pathParts.length > 50) break;
  }

  if (pathParts.length === 0) return defaultUncategorized;
  return pathParts.join("/");
}

export async function saveFolder(folder: Folder): Promise<void> {
  const db = await initDB();
  await db.put("folders", folder);
  foldersCache = null;
  foldersPromise = null;
  _cachedFolderPathMap = null;
}

export async function deleteFolder(
  id: string,
  _onProgress?: (current: number, total: number, msg: string) => void,
): Promise<void> {
  const db = await initDB();

  // Find all descendant folders using a readonly transaction
  const tx1 = db.transaction(["folders", "characters"], "readonly");
  const folderStore1 = tx1.objectStore("folders");
  const allFolders = await folderStore1.getAll();
  const folderIdsToDelete = new Set<string>([id]);

  let added = true;
  while (added) {
    added = false;
    for (const f of allFolders) {
      if (
        f.parentId &&
        folderIdsToDelete.has(f.parentId) &&
        !folderIdsToDelete.has(f.id)
      ) {
        folderIdsToDelete.add(f.id);
        added = true;
      }
    }
  }

  // Find all characters in these folders
  const charsToMove: CharacterCard[] = [];
  const charStore1 = tx1.objectStore("characters");
  const index1 = charStore1.index("by-folder");
  for (const folderId of folderIdsToDelete) {
    let cursor = await index1.openCursor(folderId);
    while (cursor) {
      charsToMove.push(cursor.value);
      cursor = await cursor.continue();
    }
  }

  await tx1.done;

  for (const char of charsToMove) {
    if (!char.deletedAt) {
      char.deletedAt = Date.now();
    }
  }

  // Delete folders and update characters in a write transaction
  const tx2 = db.transaction(["folders", "characters", "char_meta"], "readwrite");
  const folderStore2 = tx2.objectStore("folders");
  const charStore2 = tx2.objectStore("characters");
  const charMetaStore2 = tx2.objectStore("char_meta");

  for (const folderId of folderIdsToDelete) {
    await folderStore2.delete(folderId);
  }

  for (const char of charsToMove) {
    await charStore2.put(char);
    await charMetaStore2.put(buildCharMeta(char));
  }
  await tx2.done;
  invalidateCache();
}

export async function cleanupEmptyFolders(): Promise<void> {
  const allFolders = await getFolders();
  if (allFolders.length === 0) return;

  const foldersToDelete = new Set<string>();
  for (const f of allFolders) {
    if (f.name === "回收站") {
      foldersToDelete.add(f.id);
    }
  }
  if (foldersToDelete.size === 0) return;

  const db = await initDB();
  const tx = db.transaction("folders", "readwrite");
  for (const id of foldersToDelete) {
    await tx.store.delete(id);
  }
  await tx.done;
  invalidateCache();
}

export type SortOption =
  | "newest_import"
  | "oldest_import"
  | "recently_modified"
  | "tokens_desc"
  | "tokens_asc"
  | "a_z"
  | "z_a"
  | "custom";

export interface CharMeta {
  id: string;
  createdAt: number;
  updatedAt?: number;
  fileModifiedAt?: number;
  name: string;
  autoImportFilename?: string;
  sortOrder?: number;

  deletedAt?: number;
  folderId?: string;
  isFavorite?: boolean;

  avatarUrlFallback?: string;
  localFilePath?: string;
  hasBlobsSeparated?: boolean;

  isQR?: boolean;
  tags?: string[];
  isTool?: boolean;
  category?: string;
  aiSummary?: string;

  tokenCount?: number;
  permanentTokens?: number;

  /* ---- 查重指纹：只存「比对重复」用得着的几个值，查重时不必把整张卡读出来 ---- */
  dupVersion?: number;
  dupResType?: ResourceType;
  dupBaseName?: string;
  dupIsGenericName?: boolean;
  dupDescHash?: string;
  dupFirstHash?: string;
  dupDescLen?: number;
  dupFirstLen?: number;
}

function buildCharMeta(val: any, foldersMap?: Map<string, string>): CharMeta {
  let charTags = val.data?.data?.tags || val.data?.tags || val.tags;
  if (!Array.isArray(charTags)) charTags = [];
  const cat = getCharacterCategoryPrefix(val, foldersMap);
  const isTool = cat !== "未归类";
  const isQR = cat === "快速回复";
  const fallbackAvatar = resolveAvatarUrl(val.avatarUrlFallback, val.name || val.id, cat);
  // 默认占位图不再复制进索引：用户换过默认图之后它是一串几百 KB 的 data URL，
  // 每张没图的卡都在索引里背一份 —— 库越大，冷启动读索引越慢、越占内存
  // （也就是"进 App 要等一会儿"和越用越烫的来源）。显示时由 resolveAvatarUrl
  // 现取当前默认图，换过默认图依然全局生效，图不会裂。
  const storedFallbackAvatar = isStoredPlaceholderCopy(fallbackAvatar) ? undefined : fallbackAvatar;
  const isFav = Boolean(
    val.isFavorite ||
    val.favorite ||
    val.data?.data?.isFavorite ||
    val.data?.isFavorite ||
    val.data?.favorite
  );

  const summary = val.aiSummary || val.data?.aiSummary || val.data?.data?.aiSummary;
  const aiSummary = typeof summary === "string" ? summary : undefined;

  let tokenCount = val.tokenCount;
  let permanentTokens = val.permanentTokens;
  if ((tokenCount === undefined || permanentTokens === undefined) && val.data) {
    try {
      const breakdown = getCharacterTokenBreakdown(val.data);
      tokenCount = breakdown.totalTokens;
      permanentTokens = breakdown.permanentTokens;
    } catch {}
  }

  // 有些工具卡（比如 prompts 里混了 null 的预设）token 就是算不出来。以前这里会留下
  // undefined，而"索引里有 undefined 就整库重建一次"的判断会因此**每次打开都成立** ——
  // 卡库越大，每次开 App 都要陪着重建一遍（就是"第一次打开要等很久"的真凶）。
  // 算不出来就记 0：卡片列表本来就是"大于 0 才显示 T 角标"，0 和 undefined 显示一样。
  if (typeof tokenCount !== "number") tokenCount = 0;
  if (typeof permanentTokens !== "number") permanentTokens = 0;

  return {
    id: val.id,
    createdAt: val.createdAt,
    updatedAt: val.updatedAt,
    fileModifiedAt: val.fileModifiedAt || val.originalFile?.lastModified,
    name: val.name || "",
    autoImportFilename: val.autoImportFilename,
    sortOrder: val.sortOrder,
    deletedAt: val.deletedAt,
    folderId: val.folderId,
    isFavorite: isFav,
    tags: charTags,
    isTool,
    isQR,
    category: cat,
    aiSummary,
    localFilePath: val.localFilePath,
    hasBlobsSeparated: val.hasBlobsSeparated,
    avatarUrlFallback: storedFallbackAvatar,
    tokenCount,
    permanentTokens,
    // 查重指纹（基础名 / 设定 / 开场白）在建索引时就顺手算好，查重时直接读索引，
    // 不再把整张卡的大字段读出来重算一遍（那是「删重复卡会发烫」的大头）。
    // 这里走 safe 版：算指纹失败最坏就是"这张卡没指纹"（查重时会对它回退读一次整卡），
    // 绝不能让一张卡因为算指纹出错而被从索引里丢掉 —— 那卡在卡库里就看不见了。
    ...safeDuplicateFingerprint(val, foldersMap),
  };
}

let cachedMeta: CharMeta[] | null = null;
let buildingMetaPromise: Promise<CharMeta[]> | null = null;
const REPAIR_CATEGORY_FLAG = "tavern_category_repair_v10_strict_worldbook_card_distinction";
const REPAIR_TOKEN_FLAG = "tavern_meta_tokens_v4";
// 一次性把索引里那份"默认占位图副本"清掉的标志位
const SLIM_PLACEHOLDER_FLAG = "tavern_meta_slim_placeholder_v1";

/** 老版拉工具时把 `名字.worldbook.json` 整个当成了名字，展示出来会带 `.worldbook` 这类尾巴，这里统一去掉。 */
const TOOL_NAME_KIND_SUFFIX = /\.(worldbook|lorebook|preset|theme|qr|regex|script)$/i;
export function stripToolNameSuffix(name?: string): string {
  const value = String(name || "").trim();
  return value.replace(TOOL_NAME_KIND_SUFFIX, "").trim() || value;
}

export async function cleanupGhostCards(): Promise<{ cleanedCount: number }> {
  try {
    const db = await initDB();
    const tx = db.transaction(["characters", "char_meta", "blobs", "thumbs"], "readwrite");
    const charStore = tx.objectStore("characters");
    const metaStore = tx.objectStore("char_meta");
    const blobStore = tx.objectStore("blobs");
    const thumbStore = tx.objectStore("thumbs");

    // Ultra-fast check using only primary keys (0.001s, zero RAM overhead)
    const metaKeys = await metaStore.getAllKeys();
    const charKeys = await charStore.getAllKeys();

    const charKeySet = new Set(charKeys);
    let cleanedCount = 0;

    for (const key of metaKeys) {
      if (!charKeySet.has(key)) {
        await metaStore.delete(key);
        await blobStore.delete(key);
        await thumbStore.delete(key);
        cleanedCount++;
      }
    }

    await tx.done;
    if (cleanedCount > 0) {
      invalidateCache();
    }
    return { cleanedCount };
  } catch (err) {
    console.warn("Error running cleanupGhostCards:", err);
    return { cleanedCount: 0 };
  }
}

export async function getCachedMeta(): Promise<CharMeta[]> {
  if (cachedMeta) return cachedMeta;

  if (!buildingMetaPromise) {
    buildingMetaPromise = buildMetaCache()
      .then((res) => {
        cachedMeta = res;
        return res;
      })
      .finally(() => {
        buildingMetaPromise = null;
      });
  }
  return buildingMetaPromise;
}

let metaMaintenanceScheduled = false;

async function loadFolderLookup(db: IDBPDatabase<TavernDB>): Promise<{
  folderMap: Map<string, string>;
  toolFolderIds: Set<string>;
}> {
  const folderMap = new Map<string, string>();
  const toolFolderIds = new Set<string>();
  try {
    const foldersTx = db.transaction("folders", "readonly");
    const allFolders = await foldersTx.store.getAll();
    await foldersTx.done;
    for (const f of allFolders) {
      folderMap.set(f.id, f.name);
      if (["世界书", "预设", "工具区", "美化", "快速回复", "脚本"].includes(f.name)) {
        toolFolderIds.add(f.id);
      }
    }
  } catch (e) {}
  return { folderMap, toolFolderIds };
}

async function runFullMetaRebuild(
  db: IDBPDatabase<TavernDB>,
  previousMeta: CharMeta[],
): Promise<{ meta: CharMeta[]; changedCount: number }> {
  const { folderMap, toolFolderIds } = await loadFolderLookup(db);
  const repairKeys = await db.getAllKeys("characters");
  const repairChanged: CharacterCard[] = [];
  const rebuilt: CharMeta[] = [];

  for (const repairKey of repairKeys) {
    try {
      const char = (await db.get("characters", repairKey)) as CharacterCard | undefined;
      if (!char) continue;

      const data = char.data?.data || char.data || {};
      const charName = char.name || data.name || data.char_name;
      const hasContent = !!(data.description || data.first_mes || data.scenario || data.creator_notes || Object.keys(data).length > 0);
      if (!charName && !hasContent) {
        continue;
      }

      const resType = getResourceType(char, folderMap);
      const isTool = resType !== 'character';
      const cat = getCharacterCategoryPrefix(char, folderMap);
      let changed = false;

      if (isTool) {
        const expectedCat = cat !== "未归类" ? cat : (
          resType === 'worldbook' ? '世界书' :
          resType === 'qr' ? '快速回复' :
          resType === 'preset' ? '预设' :
          resType === 'script' ? '脚本' :
          resType === 'theme' ? '美化' : '工具'
        );
        if (char.category !== expectedCat || !char.isTool || (expectedCat === '快速回复' && !char.isQR)) {
          char.category = expectedCat;
          char.isTool = true;
          char.isQR = expectedCat === '快速回复';
          changed = true;
        }
      } else {
        if (char.category !== "未归类" || char.isTool || char.isQR) {
          char.category = "未归类";
          char.isTool = false;
          char.isQR = false;
          changed = true;
        }
        if (char.folderId && toolFolderIds.has(char.folderId)) {
          char.folderId = undefined;
          changed = true;
        }
      }

      if (changed) {
        repairChanged.push(char);
      }

      rebuilt.push(buildCharMeta(char, folderMap));
    } catch (err) {
      console.warn("[MetaCache] 跳过一张索引重建失败的卡：", repairKey, err);
    }
  }

  if (rebuilt.length === 0 && repairKeys.length > 0) {
    console.warn("[MetaCache] 重建结果为空, 保留原索引。characters:", repairKeys.length);
    return { meta: previousMeta, changedCount: 0 };
  }

  if (repairChanged.length > 0) {
    const writeTx = db.transaction("characters", "readwrite");
    for (const char of repairChanged) {
      await writeTx.store.put(char);
    }
    await writeTx.done;
  }

  if (rebuilt.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < rebuilt.length; i += CHUNK) {
      const chunk = rebuilt.slice(i, i + CHUNK);
      const putTx = db.transaction("char_meta", "readwrite");
      for (const meta of chunk) {
        await putTx.store.put(meta);
      }
      await putTx.done;
    }
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(REPAIR_CATEGORY_FLAG, 'true');
    localStorage.setItem(REPAIR_TOKEN_FLAG, 'true');
  }

  return { meta: rebuilt, changedCount: repairChanged.length };
}

async function slimPlaceholderCopiesInMeta(
  db: IDBPDatabase<TavernDB>,
  metaList: CharMeta[],
): Promise<{ meta: CharMeta[]; slimmedCount: number }> {
  if (typeof localStorage === 'undefined' || localStorage.getItem(SLIM_PLACEHOLDER_FLAG) === 'true') {
    return { meta: metaList, slimmedCount: 0 };
  }
  try {
    const slimmed: CharMeta[] = [];
    const nextMeta = metaList.map((m) => {
      if (!isStoredPlaceholderCopy(m.avatarUrlFallback)) return m;
      const next = { ...m, avatarUrlFallback: undefined };
      slimmed.push(next);
      return next;
    });
    if (slimmed.length > 0) {
      const CHUNK = 200;
      for (let i = 0; i < slimmed.length; i += CHUNK) {
        const putTx = db.transaction("char_meta", "readwrite");
        for (const meta of slimmed.slice(i, i + CHUNK)) {
          putTx.store.put(meta);
        }
        await putTx.done;
      }
      console.log("[MetaCache] 索引瘦身: 清掉", slimmed.length, "张卡上的占位图副本");
    }
    localStorage.setItem(SLIM_PLACEHOLDER_FLAG, 'true');
    return { meta: nextMeta, slimmedCount: slimmed.length };
  } catch (err) {
    console.warn("[MetaCache] 索引瘦身失败, 下次打开再试：", err);
    return { meta: metaList, slimmedCount: 0 };
  }
}

function scheduleIdleMetaMaintenance(needsRepair: boolean, needsSlim: boolean) {
  if (metaMaintenanceScheduled || typeof window === 'undefined') return;
  metaMaintenanceScheduled = true;
  const delayMs = needsRepair ? 1200 : 2500;
  setTimeout(async () => {
    try {
      const db = await initDB();
      let currentMeta = cachedMeta || (await db.getAll("char_meta"));
      let didChange = false;

      if (needsRepair) {
        const res = await runFullMetaRebuild(db, currentMeta);
        currentMeta = res.meta;
        if (res.changedCount > 0) {
          didChange = true;
        }
      } else if (currentMeta.length > 0) {
        const charKeys = await db.getAllKeys("characters");
        const have = new Set(currentMeta.map((m) => m.id));
        const missing = charKeys.filter((k) => !have.has(k as string)).map((k) => String(k));
        const incomplete = currentMeta
          .filter(
            (m) =>
              m.category === undefined ||
              m.tokenCount === undefined ||
              !("aiSummary" in m),
          )
          .map((m) => m.id);
        const toFix = Array.from(new Set(missing.concat(incomplete)));
        if (toFix.length > 0) {
          const { folderMap } = await loadFolderLookup(db);
          const filled: CharMeta[] = [];
          for (let i = 0; i < toFix.length; i++) {
            try {
              const char = (await db.get("characters", toFix[i])) as CharacterCard | undefined;
              if (char) filled.push(buildCharMeta(char, folderMap));
            } catch (err) {
              console.warn("[MetaCache] 这张卡补索引失败, 先跳过：", toFix[i], err);
            }
            if (i % 50 === 49) await new Promise((r) => setTimeout(r, 0));
          }
          if (filled.length > 0) {
            const putTx = db.transaction("char_meta", "readwrite");
            for (const meta of filled) putTx.store.put(meta);
            await putTx.done;
            const byId = new Map(currentMeta.map((m) => [m.id, m]));
            for (const meta of filled) byId.set(meta.id, meta);
            currentMeta = Array.from(byId.values());
            didChange = true;
            console.log("[MetaCache] 索引里补/修了", filled.length, "条记录");
          }
        }
      }

      if (needsSlim && currentMeta.length > 0) {
        const slimRes = await slimPlaceholderCopiesInMeta(db, currentMeta);
        currentMeta = slimRes.meta;
        if (slimRes.slimmedCount > 0) {
          didChange = true;
        }
      }

      if (didChange) {
        cachedMeta = currentMeta;
        tagsCache = null;
        notifyCharactersUpdated();
      } else if (cachedMeta) {
        cachedMeta = currentMeta;
      }
    } catch (e) {
      console.warn("[MetaCache] 后台索引维护失败:", e);
    }
  }, delayMs);
}

async function buildMetaCache(): Promise<CharMeta[]> {
  const db = await initDB();
  let newMeta = await db.getAll("char_meta");

  const needsRepair = typeof localStorage !== 'undefined' && (
    localStorage.getItem(REPAIR_CATEGORY_FLAG) !== 'true' ||
    localStorage.getItem(REPAIR_TOKEN_FLAG) !== 'true'
  );
  const needsSlim = typeof localStorage !== 'undefined' && (
    localStorage.getItem(SLIM_PLACEHOLDER_FLAG) !== 'true'
  );

  // 如果 char_meta 已有数据，首屏直接放行返回，把补漏、重建校验与占位图瘦身延后到空闲后台执行
  if (newMeta && newMeta.length > 0) {
    cachedMeta = newMeta;
    scheduleIdleMetaMaintenance(needsRepair, needsSlim);
    return cachedMeta;
  }

  // 空库极速退出：characters 也没数据时直接置完标志返回空数组，避免多余事务
  const charCount = await db.count("characters");
  if (charCount === 0) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(REPAIR_CATEGORY_FLAG, 'true');
      localStorage.setItem(REPAIR_TOKEN_FLAG, 'true');
      localStorage.setItem(SLIM_PLACEHOLDER_FLAG, 'true');
    }
    cachedMeta = [];
    return cachedMeta;
  }

  // 确实没有 char_meta 索引且库里有卡：同步重建一次
  try {
    const res = await runFullMetaRebuild(db, []);
    const slimRes = await slimPlaceholderCopiesInMeta(db, res.meta);
    newMeta = slimRes.meta;
  } catch (err) {
    console.warn("[MetaCache] 重建索引失败:", err);
    return [];
  }

  cachedMeta = newMeta;
  return cachedMeta;
}
export type SearchScope =
  | "basic"
  | "all"
  | "creator"
  | "creator_notes"
  | "greetings"
  | "memos"
  | "content";

interface DeepSearchDoc {
  creator: string;
  creatorNotes: string;
  greetings: string;
  content: string;
}

let _invalidateTimer: ReturnType<typeof setTimeout> | null = null;
let _cachedFolderPathMap: { timestamp: number; map: Record<string, string> } | null = null;
let deepCharTextCache: Map<string, DeepSearchDoc> | null = null;
let deepCharCachePromise: Promise<Map<string, DeepSearchDoc>> | null = null;
let deepMemoTextCache: Map<string, string> | null = null;
let deepMemoCachePromise: Promise<Map<string, string>> | null = null;

export function invalidateCache() {
  // 立刻清空内存缓存,保证"存盘后马上读"不会读到旧数据(比如移动卡片到文件夹后
  // 立刻刷新列表)。后面这段只是清理磁盘上的缓存快照 + 标签缓存,不影响正确性,
  // 用防抖避免批量操作时被反复触发导致重复的全量重建。
  cachedMeta = null;
  foldersCache = null;
  foldersPromise = null;
  tagsCache = null;
  _cachedFolderPathMap = null;
  deepCharTextCache = null;
  deepCharCachePromise = null;
  deepMemoTextCache = null;
  deepMemoCachePromise = null;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('miu_startup_snapshot_v1');
    }
  } catch {}
  if (_invalidateTimer) return;
  _invalidateTimer = setTimeout(() => {
    _invalidateTimer = null;
    initDB().then(db => {
      db.delete("blobs", "_char_meta_cache_v2_").catch(() => {});
    });
  }, 100);
}

export async function getCachedFolderPathMap(): Promise<Record<string, string>> {
  const now = Date.now();
  if (_cachedFolderPathMap) {
    return _cachedFolderPathMap.map;
  }
  const folders = await getFolders();
  const folderMap = new Map<string, Folder>();
  folders.forEach((f) => folderMap.set(f.id, f));

  const pathMap: Record<string, string> = {};
  for (const f of folders) {
    const parts: string[] = [];
    let curr: Folder | undefined = f;
    const visited = new Set<string>();
    while (curr && !visited.has(curr.id)) {
      visited.add(curr.id);
      parts.unshift(curr.name);
      curr = curr.parentId ? folderMap.get(curr.parentId) : undefined;
    }
    pathMap[f.id] = parts.join("/");
  }
  _cachedFolderPathMap = { timestamp: now, map: pathMap };
  return pathMap;
}

export function normalizeSearchPath(str: string): string {
  return normalizeSearchString(str);
}

export function matchesCharacterSearch(
  c: CharMeta,
  rawQuery: string,
  folderPathMap: Record<string, string>
): boolean {
  const rawFolderPath = (c.folderId && folderPathMap[c.folderId]) ? folderPathMap[c.folderId] : "";
  return matchesCharacterSearchUtil(c.name || "", c.tags || [], rawFolderPath, rawQuery);
}

export function getCharacterSearchScore(
  c: CharMeta,
  rawQuery: string,
  folderPathMap: Record<string, string>
): number {
  const rawFolderPath = (c.folderId && folderPathMap[c.folderId]) ? folderPathMap[c.folderId] : "";
  return getCharacterSearchScoreUtil(c.name || "", c.tags || [], rawFolderPath, rawQuery);
}

function extractDeepSearchDoc(char: any): DeepSearchDoc {
  const outer = char?.data && typeof char.data === "object" ? char.data : {};
  const d = outer?.data && typeof outer.data === "object" ? outer.data : outer;

  const creator = [d.creator, d.author, outer.creator, outer.author]
    .filter((v) => typeof v === "string" && v.trim())
    .join(" ")
    .toLowerCase();

  const creatorNotes = [
    d.creator_notes,
    outer.creator_notes,
    d.extensions?.creator_notes,
    outer.extensions?.creator_notes,
  ]
    .filter((v) => typeof v === "string" && v.trim())
    .join("\n")
    .toLowerCase();

  const greetingsParts: string[] = [];
  if (typeof d.first_mes === "string" && d.first_mes.trim()) greetingsParts.push(d.first_mes);
  if (typeof outer.first_mes === "string" && outer.first_mes.trim() && outer.first_mes !== d.first_mes) {
    greetingsParts.push(outer.first_mes);
  }
  if (Array.isArray(d.alternate_greetings)) {
    for (const g of d.alternate_greetings) {
      if (typeof g === "string" && g.trim()) greetingsParts.push(g);
    }
  }
  if (Array.isArray(d.extensions?.alternate_greetings)) {
    for (const g of d.extensions.alternate_greetings) {
      if (typeof g === "string" && g.trim()) greetingsParts.push(g);
    }
  }
  const greetings = greetingsParts.join("\n").toLowerCase();

  const contentParts: string[] = [];
  const pushText = (v: any) => {
    if (typeof v === "string" && v.trim()) contentParts.push(v);
  };
  pushText(char?.aiSummary);
  pushText(d.aiSummary);
  pushText(d.description);
  pushText(d.personality);
  pushText(d.scenario);
  pushText(d.mes_example);
  pushText(d.system_prompt);
  pushText(d.post_history_instructions);
  pushText(d.char_persona);
  pushText(d.world_scenario);

  const book =
    d.character_book ||
    d.extensions?.character_book ||
    (outer?.entries ? outer : null);
  if (book && typeof book === "object") {
    pushText(book.name);
    pushText(book.description);
    const entries = Array.isArray(book.entries)
      ? book.entries
      : book.entries && typeof book.entries === "object"
        ? Object.values(book.entries)
        : [];
    for (const entry of entries as any[]) {
      if (!entry || typeof entry !== "object") continue;
      pushText(entry.name);
      pushText(entry.comment);
      if (Array.isArray(entry.keys)) pushText(entry.keys.join(" "));
      else if (Array.isArray(entry.key)) pushText(entry.key.join(" "));
      pushText(entry.content || entry.entry);
    }
  }

  if (Array.isArray(d.prompts)) {
    for (const p of d.prompts) {
      if (!p || typeof p !== "object") continue;
      pushText(p.name);
      pushText(p.content);
    }
  }
  if (Array.isArray(d.qrList)) {
    for (const q of d.qrList) {
      if (!q || typeof q !== "object") continue;
      pushText(q.label);
      pushText(q.message);
    }
  }
  const regexList = Array.isArray(d.extensions?.regex_scripts)
    ? d.extensions.regex_scripts
    : Array.isArray(outer)
      ? outer
      : [];
  for (const r of regexList) {
    if (!r || typeof r !== "object") continue;
    pushText(r.scriptName);
    pushText(r.findRegex);
    pushText(r.replaceString);
  }

  return {
    creator,
    creatorNotes,
    greetings,
    content: contentParts.join("\n").toLowerCase(),
  };
}

async function getDeepCharTextMap(): Promise<Map<string, DeepSearchDoc>> {
  if (deepCharTextCache) return deepCharTextCache;
  if (deepCharCachePromise) return deepCharCachePromise;

  deepCharCachePromise = (async () => {
    const db = await initDB();
    const map = new Map<string, DeepSearchDoc>();
    const tx = db.transaction("characters", "readonly");
    let cursor = await tx.store.openCursor();
    while (cursor) {
      const char = cursor.value;
      if (char && !char.deletedAt) {
        map.set(char.id, extractDeepSearchDoc(char));
      }
      cursor = await cursor.continue();
    }
    deepCharTextCache = map;
    return map;
  })().finally(() => {
    deepCharCachePromise = null;
  });

  return deepCharCachePromise;
}

async function getDeepMemoTextMap(): Promise<Map<string, string>> {
  if (deepMemoTextCache) return deepMemoTextCache;
  if (deepMemoCachePromise) return deepMemoCachePromise;

  deepMemoCachePromise = (async () => {
    const db = await initDB();
    const partsMap = new Map<string, string[]>();
    const tx = db.transaction("memos", "readonly");
    let cursor = await tx.store.openCursor();
    while (cursor) {
      const memo = cursor.value;
      if (memo && memo.characterId && typeof memo.content === "string" && memo.content.trim()) {
        const list = partsMap.get(memo.characterId) || [];
        list.push(memo.content);
        partsMap.set(memo.characterId, list);
      }
      cursor = await cursor.continue();
    }
    const map = new Map<string, string>();
    partsMap.forEach((parts, charId) => {
      map.set(charId, parts.join("\n").toLowerCase());
    });
    deepMemoTextCache = map;
    return map;
  })().finally(() => {
    deepMemoCachePromise = null;
  });

  return deepMemoCachePromise;
}

export async function filterCharacterMetasBySearch(
  metas: CharMeta[],
  rawQuery: string,
  folderPathMap: Record<string, string>,
  searchScope: SearchScope = "basic"
): Promise<CharMeta[]> {
  const trimmed = rawQuery.trim();
  if (!trimmed) return metas;

  if (searchScope === "basic") {
    return metas.filter((c) => matchesCharacterSearch(c, trimmed, folderPathMap));
  }

  const terms = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return metas;

  const matchesTerms = (text: string) => {
    if (!text) return false;
    return terms.every((t) => text.includes(t));
  };

  if (searchScope === "memos") {
    const memoMap = await getDeepMemoTextMap();
    return metas.filter((c) => matchesTerms(memoMap.get(c.id) || ""));
  }

  const charMap = await getDeepCharTextMap();
  if (searchScope === "all") {
    const memoMap = await getDeepMemoTextMap();
    return metas.filter((c) => {
      if (matchesCharacterSearch(c, trimmed, folderPathMap)) return true;
      const doc = charMap.get(c.id);
      const memoText = memoMap.get(c.id) || "";
      const folderPath = c.folderId && folderPathMap[c.folderId] ? folderPathMap[c.folderId] : "";
      const combined = [
        (c.name || "").toLowerCase(),
        (c.tags || []).join(" ").toLowerCase(),
        folderPath.toLowerCase(),
        doc?.creator || "",
        doc?.creatorNotes || "",
        doc?.greetings || "",
        doc?.content || "",
        memoText,
      ]
        .filter(Boolean)
        .join("\n");
      return matchesTerms(combined);
    });
  }

  return metas.filter((c) => {
    const doc = charMap.get(c.id);
    if (!doc) return false;
    if (searchScope === "creator") return matchesTerms(doc.creator);
    if (searchScope === "creator_notes") return matchesTerms(doc.creatorNotes);
    if (searchScope === "greetings") return matchesTerms(doc.greetings);
    if (searchScope === "content") return matchesTerms(doc.content);
    return false;
  });
}

export async function getFilteredCharacterCount(
  folderId?: string | null,
  searchQuery: string = "",
  tags: string[] = [],
  searchScope: SearchScope = "basic"
): Promise<number> {
  let allMeta = await getCachedMeta();
  allMeta = allMeta.filter((c) => !c.deletedAt);

  const folderPathMap = await getCachedFolderPathMap();

  if (searchQuery) {
    allMeta = await filterCharacterMetasBySearch(allMeta, searchQuery, folderPathMap, searchScope);
  }

  if (tags.length > 0) {
    allMeta = allMeta.filter((c) => tags.every((t) => (c.tags || []).includes(t)));
  }

  if (folderId === "favorites") {
    allMeta = allMeta.filter((c) => c.isFavorite);
  } else if (folderId === null) {
    if (!searchQuery && tags.length === 0) {
      allMeta = allMeta.filter((c) => !c.folderId);
    }
  } else if (folderId && folderId !== "all") {
    if (searchQuery) {
      const folders = await getFolders();
      const descendantIds = new Set<string>([folderId]);
      const addDescendants = (pid: string) => {
        for (const f of folders) {
          if (f.parentId === pid && !descendantIds.has(f.id)) {
            descendantIds.add(f.id);
            addDescendants(f.id);
          }
        }
      };
      addDescendants(folderId);
      allMeta = allMeta.filter((c) => c.folderId && descendantIds.has(c.folderId));
    } else {
      allMeta = allMeta.filter((c) => c.folderId === folderId);
    }
  }

  return allMeta.length;
}

export async function getCharacters(
  page: number,
  pageSize: number,
  folderId?: string | null,
  searchQuery: string = "",
  tags: string[] = [],
  sortBy: SortOption = "newest_import",
  includeBlobs: boolean = true,
  includeData: boolean = true,
  offset?: number,
  limit?: number,
  searchScope: SearchScope = "basic"
): Promise<{ characters: CharacterCard[]; total: number }> {
  const db = await initDB();

  let allMeta = await getCachedMeta();
  allMeta = allMeta.filter((c) => !c.deletedAt);

  const folderPathMap = await getCachedFolderPathMap();

  if (searchQuery) {
    allMeta = await filterCharacterMetasBySearch(allMeta, searchQuery, folderPathMap, searchScope);
  }

  if (tags.length > 0) {
    allMeta = allMeta.filter((c) => tags.every((t) => (c.tags || []).includes(t)));
  }

  if (folderId === "favorites") {
    allMeta = allMeta.filter((c) => c.isFavorite);
  } else if (folderId === null) {
    if (!searchQuery && tags.length === 0) {
      allMeta = allMeta.filter((c) => !c.folderId);
    }
  } else if (folderId && folderId !== "all") {
    if (searchQuery) {
      const folders = await getFolders();
      const descendantIds = new Set<string>([folderId]);
      const addDescendants = (pid: string) => {
        for (const f of folders) {
          if (f.parentId === pid && !descendantIds.has(f.id)) {
            descendantIds.add(f.id);
            addDescendants(f.id);
          }
        }
      };
      addDescendants(folderId);
      allMeta = allMeta.filter((c) => c.folderId && descendantIds.has(c.folderId));
    } else {
      allMeta = allMeta.filter((c) => c.folderId === folderId);
    }
  }

  // Apply sorting
  const applyStandardSort = (a: CharMeta, b: CharMeta, sortOption: SortOption) => {
    switch (sortOption) {
      case "custom":
        if (a.sortOrder !== undefined && b.sortOrder !== undefined) {
          return a.sortOrder - b.sortOrder;
        }
        if (a.sortOrder !== undefined) return -1;
        if (b.sortOrder !== undefined) return 1;
        return b.createdAt - a.createdAt;
      case "newest_import":
        return b.createdAt - a.createdAt;
      case "oldest_import":
        return a.createdAt - b.createdAt;
      case "recently_modified":
        return (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
      case "tokens_desc":
        return (b.tokenCount || 0) - (a.tokenCount || 0);
      case "tokens_asc":
        return (a.tokenCount || 0) - (b.tokenCount || 0);
      case "a_z":
        return a.name.localeCompare(b.name, "zh-CN");
      case "z_a":
        return b.name.localeCompare(a.name, "zh-CN");
      default:
        return b.createdAt - a.createdAt;
    }
  };

  if (searchQuery) {
    allMeta.sort((a, b) => {
      const scoreA = getCharacterSearchScore(a, searchQuery, folderPathMap);
      const scoreB = getCharacterSearchScore(b, searchQuery, folderPathMap);
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      return applyStandardSort(a, b, sortBy);
    });
  } else {
    allMeta.sort((a, b) => applyStandardSort(a, b, sortBy));
  }

  const total = allMeta.length;
  const paginatedMeta = (offset !== undefined && limit !== undefined)
    ? (limit === 0 ? [] : allMeta.slice(offset, offset + limit))
    : allMeta.slice((page - 1) * pageSize, page * pageSize);

  if (paginatedMeta.length === 0) {
    return { characters: [], total };
  }

  // Fast path: if full JSON data is not needed, we construct list items directly from metadata
  // This avoids reading the massive 'data' fields, which causes severe lag on large collections.
  if (!includeData) {
    const characters: CharacterCard[] = [];
    const needsLegacyCharRead = paginatedMeta.some((m) => !m.hasBlobsSeparated);
    const fetchTx = needsLegacyCharRead
      ? db.transaction("characters", "readonly")
      : null;
    const fetchStore = fetchTx ? fetchTx.store : null;

    for (const meta of paginatedMeta) {
      if (meta.hasBlobsSeparated) {
        // Fast path for migrated
        characters.push({
          ...meta,
          tokenCount: meta.tokenCount,
          permanentTokens: meta.permanentTokens,
          data: {} // Empty data
        } as unknown as CharacterCard);
      } else {
        // Must fetch the old bloated character to get its avatarBlob
        const fullChar = fetchStore ? await fetchStore.get(meta.id) : undefined;
        if (fullChar) {
          const strippedChar = { 
            ...fullChar, 
            tokenCount: meta.tokenCount ?? fullChar.tokenCount,
            permanentTokens: meta.permanentTokens ?? fullChar.permanentTokens,
            data: {}, 
            tags: meta.tags, 
            isQR: meta.isQR, 
            isTool: meta.isTool 
          };
          delete (strippedChar as any)._isExplicitAvatarUpdate;
          delete (strippedChar as any)._oldFolderId;
          delete (strippedChar as any)._wasDeleted;
          delete (strippedChar as any)._previousFilePath;
          characters.push(strippedChar);
        } else {
          characters.push({ 
            ...meta, 
            tokenCount: meta.tokenCount,
            permanentTokens: meta.permanentTokens,
            data: {} 
          } as unknown as CharacterCard);
        }
      }
    }
    if (fetchTx) await fetchTx.done;

    // Load blobs if requested
    if (includeBlobs) {
      for (const char of characters) {
        if (char.hasBlobsSeparated) {
          const blobs = await db.get("blobs", char.id);
          if (blobs) {
            char.avatarBlob = blobs.avatarBlob;
            char.originalFile = blobs.originalFile;
            char.avatarHistory = blobs.avatarHistory;
          }
        }
      }
    }
    return { characters, total };
  }

  // Now fetch full objects ONLY for the paginated slice
  // 每 50 个一批, 每批用一个新事务读完就关; 让出主线程必须放在事务之外, 否则事务会被
  // 浏览器自动提交, 之后继续读会抛 TransactionInactiveError(详见 findDuplicates 的说明)。
  const characters: CharacterCard[] = [];
  const FETCH_CHUNK = 50;

  for (let chunkStart = 0; chunkStart < paginatedMeta.length; chunkStart += FETCH_CHUNK) {
    const chunk = paginatedMeta.slice(chunkStart, chunkStart + FETCH_CHUNK);
    const fetchTx = db.transaction("characters", "readonly");
    const fetched = (await Promise.all(
      chunk.map((meta) => fetchTx.store.get(meta.id)),
    )) as (CharacterCard | undefined)[];
    await fetchTx.done;

    for (const fullChar of fetched) {
      if (fullChar && !fullChar.deletedAt) {
        delete (fullChar as any)._isExplicitAvatarUpdate;
        delete (fullChar as any)._oldFolderId;
        delete (fullChar as any)._wasDeleted;
        delete (fullChar as any)._previousFilePath;
        characters.push(fullChar);
      }
    }

    if (chunkStart + FETCH_CHUNK < paginatedMeta.length) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // Load blobs only for the paginated characters
  if (includeBlobs) {
    for (const char of characters) {
      if (char.hasBlobsSeparated) {
        const blobs = await db.get("blobs", char.id);
        if (blobs) {
          char.avatarBlob = blobs.avatarBlob;
          char.originalFile = blobs.originalFile;
          char.avatarHistory = blobs.avatarHistory;
        }
      }
    }
  }

  return { characters, total };
}

/**
 * 首页列表单次聚合查询：一次完成「文件夹计数 + 当前视图筛选总数 + 全库筛选总数 + 当前页切片 + 批量缩略图预热」，
 * 消除原来 loadData() 重复过滤四遍全库元数据的开销。
 */
export async function getCharacterListSummaryAndSlice(params: {
  folderId?: string | null;
  searchQuery?: string;
  tags?: string[];
  searchScope?: SearchScope;
  sortBy?: SortOption;
  page: number;
  pageSize: number;
  visibleFolderCount: number;
}): Promise<{
  folderCharCounts: Record<string, number>;
  totalChars: number;
  totalAllChars: number;
  effectivePage: number;
  characters: CharacterCard[];
}> {
  const {
    folderId,
    searchQuery = "",
    tags = [],
    searchScope = "basic",
    sortBy = "newest_import",
    page,
    pageSize,
    visibleFolderCount,
  } = params;

  const [allMetaRaw, folderPathMap, allFolders] = await Promise.all([
    getCachedMeta(),
    getCachedFolderPathMap(),
    getFolders(),
  ]);

  const folderCharCounts: Record<string, number> = {};
  const activeMeta: CharMeta[] = [];
  for (const m of allMetaRaw) {
    if (m.deletedAt) continue;
    activeMeta.push(m);
    if (m.folderId) {
      folderCharCounts[m.folderId] = (folderCharCounts[m.folderId] || 0) + 1;
    }
  }

  let filteredGlobal = activeMeta;
  if (searchQuery) {
    filteredGlobal = await filterCharacterMetasBySearch(
      filteredGlobal,
      searchQuery,
      folderPathMap,
      searchScope,
    );
  }
  if (tags.length > 0) {
    filteredGlobal = filteredGlobal.filter((c) =>
      tags.every((t) => (c.tags || []).includes(t)),
    );
  }

  const totalAllChars = filteredGlobal.length;

  let viewMeta = filteredGlobal;
  if (folderId === "favorites") {
    viewMeta = filteredGlobal.filter((c) => c.isFavorite);
  } else if (folderId === null) {
    if (!searchQuery && tags.length === 0) {
      viewMeta = filteredGlobal.filter((c) => !c.folderId);
    }
  } else if (folderId && folderId !== "all") {
    if (searchQuery) {
      const descendantIds = new Set<string>([folderId]);
      const addDescendants = (pid: string) => {
        for (const f of allFolders) {
          if (f.parentId === pid && !descendantIds.has(f.id)) {
            descendantIds.add(f.id);
            addDescendants(f.id);
          }
        }
      };
      addDescendants(folderId);
      viewMeta = filteredGlobal.filter(
        (c) => c.folderId && descendantIds.has(c.folderId),
      );
    } else {
      viewMeta = filteredGlobal.filter((c) => c.folderId === folderId);
    }
  }

  const totalChars = viewMeta.length;
  const itemsTotal = visibleFolderCount + totalChars;
  const calculatedTotalPages = Math.max(1, Math.ceil(itemsTotal / pageSize));
  const effectivePage = Math.max(1, Math.min(page, calculatedTotalPages));

  const pageStart = (effectivePage - 1) * pageSize;
  const pageEnd = effectivePage * pageSize;
  const charStart = Math.max(0, pageStart - visibleFolderCount);
  const charEnd = Math.max(0, Math.min(totalChars, pageEnd - visibleFolderCount));
  const charLimit = Math.max(0, charEnd - charStart);

  if (charLimit <= 0) {
    return {
      folderCharCounts,
      totalChars,
      totalAllChars: folderId ? totalChars : totalAllChars,
      effectivePage,
      characters: [],
    };
  }

  const applyStandardSort = (a: CharMeta, b: CharMeta, sortOption: SortOption) => {
    switch (sortOption) {
      case "custom":
        if (a.sortOrder !== undefined && b.sortOrder !== undefined) {
          return a.sortOrder - b.sortOrder;
        }
        if (a.sortOrder !== undefined) return -1;
        if (b.sortOrder !== undefined) return 1;
        return b.createdAt - a.createdAt;
      case "newest_import":
        return b.createdAt - a.createdAt;
      case "oldest_import":
        return a.createdAt - b.createdAt;
      case "recently_modified":
        return (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
      case "tokens_desc":
        return (b.tokenCount || 0) - (a.tokenCount || 0);
      case "tokens_asc":
        return (a.tokenCount || 0) - (b.tokenCount || 0);
      case "a_z":
        return a.name.localeCompare(b.name, "zh-CN");
      case "z_a":
        return b.name.localeCompare(a.name, "zh-CN");
      default:
        return b.createdAt - a.createdAt;
    }
  };

  const sortedViewMeta = viewMeta.slice();
  if (searchQuery) {
    sortedViewMeta.sort((a, b) => {
      const scoreA = getCharacterSearchScore(a, searchQuery, folderPathMap);
      const scoreB = getCharacterSearchScore(b, searchQuery, folderPathMap);
      if (scoreA !== scoreB) return scoreB - scoreA;
      return applyStandardSort(a, b, sortBy);
    });
  } else {
    sortedViewMeta.sort((a, b) => applyStandardSort(a, b, sortBy));
  }

  const paginatedMeta = sortedViewMeta.slice(charStart, charEnd);
  const needsCharStore = paginatedMeta.some((m) => !m.hasBlobsSeparated);
  let characters: CharacterCard[] = [];

  if (!needsCharStore) {
    characters = paginatedMeta.map(
      (meta) =>
        ({
          ...meta,
          tokenCount: meta.tokenCount,
          permanentTokens: meta.permanentTokens,
          data: {},
        }) as unknown as CharacterCard,
    );
  } else {
    const db = await initDB();
    const fetchTx = db.transaction("characters", "readonly");
    const fetchStore = fetchTx.store;
    for (const meta of paginatedMeta) {
      if (meta.hasBlobsSeparated) {
        characters.push({
          ...meta,
          tokenCount: meta.tokenCount,
          permanentTokens: meta.permanentTokens,
          data: {},
        } as unknown as CharacterCard);
      } else {
        const fullChar = await fetchStore.get(meta.id);
        if (fullChar) {
          const strippedChar = {
            ...fullChar,
            tokenCount: meta.tokenCount ?? fullChar.tokenCount,
            permanentTokens: meta.permanentTokens ?? fullChar.permanentTokens,
            data: {},
            tags: meta.tags,
            isQR: meta.isQR,
            isTool: meta.isTool,
          };
          delete (strippedChar as any)._isExplicitAvatarUpdate;
          characters.push(strippedChar);
        } else {
          characters.push({
            ...meta,
            tokenCount: meta.tokenCount,
            permanentTokens: meta.permanentTokens,
            data: {},
          } as unknown as CharacterCard);
        }
      }
    }
    await fetchTx.done;
  }

  await prewarmCharacterThumbs(characters);

  return {
    folderCharCounts,
    totalChars,
    totalAllChars: folderId ? totalChars : totalAllChars,
    effectivePage,
    characters,
  };
}

export async function getAllCharacters(includeBlobs = false): Promise<CharacterCard[]> {
  const db = await initDB();
  const valid: CharacterCard[] = [];
  const allKeys = await db.getAllKeys("characters");
  const SCAN_CHUNK = 50;

  for (let chunkStart = 0; chunkStart < allKeys.length; chunkStart += SCAN_CHUNK) {
    const chunk = allKeys.slice(chunkStart, chunkStart + SCAN_CHUNK);
    const tx = db.transaction("characters", "readonly");
    const rows = (await Promise.all(
      chunk.map((key) => tx.store.get(key)),
    )) as (CharacterCard | undefined)[];
    await tx.done;

    for (const char of rows) {
      if (char && !char.deletedAt) {
        valid.push(char);
      }
    }

    if (chunkStart + SCAN_CHUNK < allKeys.length) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  if (includeBlobs) {
    for (const char of valid) {
      if (char.hasBlobsSeparated) {
        const blobs = await db.get('blobs', char.id);
        if (blobs) {
          char.avatarBlob = blobs.avatarBlob;
          char.originalFile = blobs.originalFile;
          char.avatarHistory = blobs.avatarHistory;
        }
      }
    }
  }
  return valid;
}

let tagsCache: string[] | null = null;

export async function getAllTags(): Promise<string[]> {
  if (tagsCache) return tagsCache;
  const meta = await getCachedMeta();

  const tags = new Set<string>();

  meta.forEach((c) => {
    if (!c.deletedAt) {
      c.tags.forEach((t) => tags.add(t));
    }
  });

  tagsCache = Array.from(tags).sort();
  return tagsCache;
}

export async function renameTag(oldTag: string, newTag: string): Promise<void> {
  invalidateCache();
  const db = await initDB();
  const tx = db.transaction(["characters", "char_meta"], "readwrite");
  const store = tx.objectStore("characters");
  const metaStore = tx.objectStore("char_meta");
  let cursor = await store.openCursor();

  while (cursor) {
    const char = cursor.value;
    const charTags = char.data?.data?.tags || char.data?.tags;
    if (charTags && Array.isArray(charTags) && charTags.includes(oldTag)) {
      const newTags = charTags.map((t: string) => (t === oldTag ? newTag : t));
      if (char.data?.data) {
        char.data.data.tags = Array.from(new Set(newTags));
      } else {
        char.data.tags = Array.from(new Set(newTags));
      }
      char.updatedAt = Date.now();
      await cursor.update(char);
      await metaStore.put(buildCharMeta(char));
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function deleteTag(tagToDelete: string): Promise<void> {
  invalidateCache();
  const db = await initDB();
  const tx = db.transaction(["characters", "char_meta"], "readwrite");
  const store = tx.objectStore("characters");
  const metaStore = tx.objectStore("char_meta");
  let cursor = await store.openCursor();

  while (cursor) {
    const char = cursor.value;
    const charTags = char.data?.data?.tags || char.data?.tags;
    if (charTags && Array.isArray(charTags) && charTags.includes(tagToDelete)) {
      const newTags = charTags.filter((t: string) => t !== tagToDelete);
      if (char.data?.data) {
        char.data.data.tags = newTags;
      } else {
        char.data.tags = newTags;
      }
      char.updatedAt = Date.now();
      await cursor.update(char);
      await metaStore.put(buildCharMeta(char));
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

let _blobReads = 0;
const _blobReadQueue: { id: string; resolve: (val: any) => void; reject: (err: any) => void }[] = [];

function runBlobReads() {
  while (_blobReads < 2 && _blobReadQueue.length > 0) {
    _blobReads++;
    const req = _blobReadQueue.shift()!;
    initDB()
      .then((db) => db.get("blobs", req.id))
      .then(req.resolve)
      .catch(req.reject)
      .finally(() => {
        _blobReads--;
        runBlobReads();
      });
  }
}

export function getCharacterBlob(id: string): Promise<any> {
  return new Promise((resolve, reject) => {
    _blobReadQueue.push({ id, resolve, reject });
    runBlobReads();
  });
}

const noImageCharIds = new Set<string>();
const thumbInFlight = new Map<string, Promise<Blob | null>>();

export function isCharacterNoImage(id: string): boolean {
  return noImageCharIds.has(id);
}

export async function prewarmCharacterThumbs(chars: CharacterCard[]): Promise<void> {
  if (!chars || chars.length === 0) return;
  try {
    const { peekCachedUrl, putCachedBlobUrl } = await import("./thumbCache");
    const needIds: { id: string; key: string }[] = [];
    for (const c of chars) {
      if (!c.hasBlobsSeparated || c.avatarBlob) continue;
      if (noImageCharIds.has(c.id)) continue;
      const key = `${c.id}:${c.updatedAt || 0}`;
      if (peekCachedUrl(key)) continue;
      needIds.push({ id: c.id, key });
    }
    if (needIds.length === 0) return;

    const db = await initDB();
    const tx = db.transaction("thumbs", "readonly");
    const store = tx.objectStore("thumbs");
    const results = await Promise.all(needIds.map((item) => store.get(item.id)));
    await tx.done;

    for (let i = 0; i < needIds.length; i++) {
      const rec = results[i];
      if (!rec || (rec.thumbVersion !== 3 && rec.thumbVersion !== 4)) continue;
      if (rec.noImage) {
        noImageCharIds.add(needIds[i].id);
      } else if (rec.thumbBlob) {
        putCachedBlobUrl(needIds[i].key, rec.thumbBlob);
      }
    }
  } catch (e) {
    console.warn("prewarmCharacterThumbs failed:", e);
  }
}

/**
 * 拿一张小缩略图用来在列表/卡片上显示：
 * 1) 优先从独立轻量表 "thumbs" (~15KB) 读取，完全不触发大 "blobs" 记录的反序列化；
 * 2) 无头像卡片会记入 noImage 负缓存，彻底避免反复回退读取完整角色卡大 JSON；
 * 3) 对老数据未入 "thumbs" 的卡按需从 "blobs" 迁移/懒生成一次，之后秒读。
 */
export async function getCharacterThumb(id: string): Promise<Blob | null> {
  if (noImageCharIds.has(id)) return null;
  const existingTask = thumbInFlight.get(id);
  if (existingTask) return existingTask;

  const task = (async (): Promise<Blob | null> => {
    const db = await initDB();

    try {
      const fastThumb = await db.get("thumbs", id);
      if (fastThumb && (fastThumb.thumbVersion === 3 || fastThumb.thumbVersion === 4)) {
        if (fastThumb.noImage) {
          noImageCharIds.add(id);
          return null;
        }
        if (fastThumb.thumbBlob) {
          return fastThumb.thumbBlob;
        }
      }
    } catch {}

    return withReadSlot(async () => {
      const blobs = await db.get("blobs", id);
      const tv = (blobs as any)?.thumbVersion;
      if (blobs?.thumbBlob && (tv === 3 || tv === 4)) {
        db.put("thumbs", { thumbBlob: blobs.thumbBlob, thumbVersion: tv }, id).catch(() => {});
        return blobs.thumbBlob;
      }

      let avatarBlob = blobs?.avatarBlob;
      if (!avatarBlob) {
        const char = await db.get("characters", id);
        if (char?.localFilePath && isAndroid()) {
          try {
            const { readLocalFileBuffer } = await import("./appBridge");
            const buffer = await readLocalFileBuffer(char.localFilePath);
            if (buffer) {
              let ext = "image/png";
              if (char.localFilePath.endsWith(".jpg") || char.localFilePath.endsWith(".jpeg")) ext = "image/jpeg";
              else if (char.localFilePath.endsWith(".webp")) ext = "image/webp";
              avatarBlob = new Blob([buffer], { type: ext });
            }
          } catch {}
        }
      }

      if (!avatarBlob) {
        if (blobs?.thumbBlob) {
          db.put("thumbs", { thumbBlob: blobs.thumbBlob, thumbVersion: 4 }, id).catch(() => {});
          return blobs.thumbBlob;
        }
        noImageCharIds.add(id);
        db.put("thumbs", { noImage: true, thumbVersion: 4 }, id).catch(() => {});
        return null;
      }

      try {
        const { isPlaceholderImageBlob } = await import("./placeholder");
        if (await isPlaceholderImageBlob(avatarBlob)) {
          noImageCharIds.add(id);
          db.put("thumbs", { noImage: true, thumbVersion: 4 }, id).catch(() => {});
          return null;
        }
      } catch {}

      const { generateThumbnail } = await import("./avatar");
      let thumb: Blob;
      try {
        thumb = await generateThumbnail(avatarBlob, 480, 0.85);
      } catch {
        return blobs?.thumbBlob || null;
      }

      db.put("thumbs", { thumbBlob: thumb, thumbVersion: 4 }, id).catch((e) => {
        console.warn("Failed to persist generated HD thumbnail:", e);
      });
      return thumb;
    });
  })().finally(() => {
    thumbInFlight.delete(id);
  });

  thumbInFlight.set(id, task);
  return task;
}

export async function getCharacter(
  id: string,
): Promise<CharacterCard | undefined> {
  const db = await initDB();
  const char = await db.get("characters", id);
  if (char) {
    // Sanitize leaked properties from older versions
    delete (char as any)._isExplicitAvatarUpdate;
    delete (char as any)._oldFolderId;
    delete (char as any)._wasDeleted;
    delete (char as any)._previousFilePath;

    if (char.hasBlobsSeparated) {
      const blobs = await db.get("blobs", id);
      if (blobs) {
        char.avatarBlob = blobs.avatarBlob;
        char.originalFile = blobs.originalFile;
        char.avatarHistory = blobs.avatarHistory;
      }
    }
  }
  return char;
}

export async function saveCharacter(character: CharacterCard): Promise<void> {
  return saveCharacters([character]);
}

/**
 * 判断两个二进制资源是不是"同一张图"。这里不能用对象引用比较: 每次从 IndexedDB
 * 读出来的 Blob 都是新对象, 直接比引用会把"根本没换过头像"误判成换过头像, 于是
 * 白白清掉缩略图缓存 + 触发一次全量安卓图库同步 —— 详情页打开、版本切换/绑定
 * 之后的卡顿很大一部分就是这么来的。退回到体积 + MIME 比较(有文件名/修改时间时
 * 一并比较)。
 */
function isSameBinary(a?: Blob | File | null, b?: Blob | File | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.size !== b.size) return false;
  if ((a.type || "") !== (b.type || "")) return false;
  const aName = (a as File).name;
  const bName = (b as File).name;
  if (aName !== undefined && bName !== undefined) {
    if (aName !== bName) return false;
    if ((a as File).lastModified !== (b as File).lastModified) return false;
  }
  return true;
}

export async function saveCharacters(
  characters: CharacterCard[],
  _cleanupAndroidPaths?: string[],
  onAndroidSyncProgress?: (current: number, total: number) => void,
): Promise<void> {
  if (characters.length === 0) return;
  const db = await initDB();

  // 1) Compute final blobs concurrently using a single readonly transaction
  const allFinalBlobs = new Map<string, any>();
  const tx1 = db.transaction(["characters", "blobs"], "readonly");
  const charStore1 = tx1.objectStore("characters");
  const blobStore1 = tx1.objectStore("blobs");
  let needsOrphanLink = false;

  await Promise.all(
    characters.map(async (character) => {
      const existing = await charStore1.get(character.id);
      if (existing) {
        if (!(character as any)._skipTouchUpdatedAt) {
          character.updatedAt = Date.now();
        }
        if (existing.name !== character.name) {
          needsOrphanLink = true;
        }
      } else {
        needsOrphanLink = true;
      }

      let finalBlobs: {
        avatarBlob?: Blob;
        originalFile?: File;
        avatarHistory?: Blob[];
        thumbBlob?: Blob;
      } = {
        avatarBlob: character.avatarBlob,
        originalFile: character.originalFile,
        avatarHistory: character.avatarHistory,
      };

      if (character.localFilePath && character.avatarBlob === undefined) {
        const existingBlobs = await blobStore1.get(character.id);
        finalBlobs = {
          avatarBlob: existingBlobs?.avatarBlob,
          originalFile:
            character.originalFile !== undefined
              ? character.originalFile
              : existingBlobs?.originalFile,
          avatarHistory:
            character.avatarHistory !== undefined
              ? character.avatarHistory
              : existingBlobs?.avatarHistory,
          thumbBlob: existingBlobs?.thumbBlob,
        };
      } else if (existing?.hasBlobsSeparated) {
        const existingBlobs = await blobStore1.get(character.id);
        if (existingBlobs) {
          if (
            character.avatarBlob !== undefined &&
            !isSameBinary(character.avatarBlob, existingBlobs.avatarBlob)
          ) {
            (character as any)._isExplicitAvatarUpdate = true;
          }
          finalBlobs.avatarBlob =
            character.avatarBlob !== undefined
              ? character.avatarBlob
              : existingBlobs.avatarBlob;
          finalBlobs.originalFile =
            character.originalFile !== undefined
              ? character.originalFile
              : existingBlobs.originalFile;
          finalBlobs.avatarHistory =
            character.avatarHistory !== undefined
              ? character.avatarHistory
              : existingBlobs.avatarHistory;
          finalBlobs.thumbBlob = (character as any)._isExplicitAvatarUpdate
            ? undefined
            : existingBlobs.thumbBlob;
        }
      } else {
        if (character.avatarBlob !== undefined) {
          (character as any)._isExplicitAvatarUpdate = true;
        }
      }

      allFinalBlobs.set(character.id, finalBlobs);
    }),
  );
  await tx1.done;

  // 2) Write to IndexedDB using a new transaction (pipelined writes for maximum throughput)
  const tx2 = db.transaction(["characters", "blobs", "char_meta", "thumbs"], "readwrite");
  const charStore2 = tx2.objectStore("characters");
  const blobStore2 = tx2.objectStore("blobs");
  const charMetaStore2 = tx2.objectStore("char_meta");
  const thumbsStore2 = tx2.objectStore("thumbs");

  tx2.done.catch(() => {});
  tx2.done.then(
    () => invalidateCache(),
    () => invalidateCache(),
  );

  for (const character of characters) {
    if ((character.tokenCount === undefined || character.permanentTokens === undefined) && character.data) {
      try {
        const breakdown = getCharacterTokenBreakdown(character.data);
        character.tokenCount = breakdown.totalTokens;
        character.permanentTokens = breakdown.permanentTokens;
      } catch {}
    }

    const finalBlobs = allFinalBlobs.get(character.id);
    blobStore2.put(finalBlobs, character.id);

    if ((character as any)._isExplicitAvatarUpdate) {
      noImageCharIds.delete(character.id);
      thumbsStore2.delete(character.id);
    }

    const charToSave = { ...character, hasBlobsSeparated: true };
    delete charToSave.avatarBlob;
    delete charToSave.originalFile;
    delete charToSave.avatarHistory;
    if (Array.isArray(charToSave.versionHistory) && charToSave.versionHistory.length > 0) {
      charToSave.versionHistory = charToSave.versionHistory.map((snap) => {
        if (!snap || !snap.completeCardPngBlob) return snap;
        const { completeCardPngBlob: _drop, ...rest } = snap;
        return rest as CardVersionSnapshot;
      });
    }
    delete (charToSave as any)._isExplicitAvatarUpdate;
    delete (charToSave as any)._oldFolderId;
    delete (charToSave as any)._wasDeleted;
    delete (charToSave as any)._previousFilePath;
    delete (charToSave as any)._skipTouchUpdatedAt;

    charStore2.put(charToSave);
    charMetaStore2.put(buildCharMeta(charToSave));
  }

  await tx2.done;

  for (const character of characters) {
    if ((character as any)._isExplicitAvatarUpdate) {
      import("./thumbCache").then(({ evictCharacterThumb }) => {
        evictCharacterThumb(character.id);
      }).catch(() => {});
    }
  }

  if (typeof window !== "undefined") {
    notifyCharactersUpdated();
  }

  // 2.5) Link orphaned chats to these characters if names match.
  // 换头像/换封面这类只动图片不动角色信息的保存, 不需要扫全部孤儿聊天。
  if (needsOrphanLink) {
  try {
    const orphanTx = db.transaction(["chat_metadata", "chats"], "readwrite");
    const metaStore = orphanTx.objectStore("chat_metadata");
    const chatStore = orphanTx.objectStore("chats");
    const index = metaStore.index("by-character");

    // get all orphans
    const orphans = await index.getAll("");

    if (orphans && orphans.length > 0) {
      for (const orphan of orphans) {
        // find if it matches any character we just saved
        const match = characters.find((c) => {
          return (
            orphan.firstAiName &&
            orphan.firstAiName.toLowerCase() === c.name.toLowerCase()
          );
        });
        if (match) {
          orphan.characterId = match.id;
          await metaStore.put(orphan);

          const fullChat = await chatStore.get(orphan.id);
          if (fullChat) {
            fullChat.characterId = match.id;
            await chatStore.put(fullChat);
          }
        }
      }
    }
    await orphanTx.done;
  } catch (e) {
    console.warn("Failed to link orphaned chats:", e);
  }
  }

  onAndroidSyncProgress?.(characters.length, characters.length);
}

export async function updateCharacterCover(
  id: string,
  avatarBlob: Blob,
): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(["characters", "blobs", "char_meta", "thumbs"], "readwrite");
  const charStore = tx.objectStore("characters");
  const blobStore = tx.objectStore("blobs");
  const charMetaStore = tx.objectStore("char_meta");
  const thumbStore = tx.objectStore("thumbs");

  const char = await charStore.get(id);
  if (!char) {
    await tx.done;
    return;
  }

  const currentBlobs = (await blobStore.get(id)) || {};
  const finalBlobs = {
    ...currentBlobs,
    avatarBlob,
    // 头像真的换了, 旧的缩略图缓存不能继续用; 下次列表显示时会懒生成新的
    thumbBlob: undefined,
  };
  await blobStore.put(finalBlobs, id);
  await thumbStore.delete(id);
  noImageCharIds.delete(id);

  char.hasBlobsSeparated = true;
  char.updatedAt = Date.now();
  delete char.avatarBlob;
  delete char.originalFile;
  delete char.avatarHistory;
  await charStore.put(char);

  const meta = buildCharMeta(char);
  await charMetaStore.put(meta);
  await tx.done;

  if (cachedMeta) {
    const idx = cachedMeta.findIndex((m) => m.id === id);
    if (idx >= 0) {
      cachedMeta[idx] = {
        ...cachedMeta[idx],
        updatedAt: meta.updatedAt,
        hasBlobsSeparated: true,
      };
    } else {
      cachedMeta.push(meta);
    }
  }
  tagsCache = null;
}

export async function updateCharacterSortOrder(
  id: string,
  sortOrder: number,
): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(["characters", "char_meta"], "readwrite");
  const charStore = tx.objectStore("characters");
  const char = await charStore.get(id);
  if (!char) {
    await tx.done;
    return;
  }

  char.sortOrder = sortOrder;
  char.updatedAt = Date.now();
  await charStore.put(char);

  const meta = buildCharMeta(char);
  await tx.objectStore("char_meta").put(meta);
  await tx.done;

  if (cachedMeta) {
    const idx = cachedMeta.findIndex((m) => m.id === id);
    if (idx >= 0) {
      cachedMeta[idx] = {
        ...cachedMeta[idx],
        sortOrder,
        updatedAt: meta.updatedAt,
      };
    }
  }
}

export async function toggleCharacterFavorite(id: string): Promise<boolean> {
  const db = await initDB();
  const tx = db.transaction(["characters", "char_meta"], "readwrite");
  const charStore = tx.objectStore("characters");
  const charMetaStore = tx.objectStore("char_meta");
  
  const char = await charStore.get(id);
  if (!char) {
    await tx.done;
    return false;
  }

  const newFav = !char.isFavorite;
  char.isFavorite = newFav;
  char.updatedAt = Date.now();
  if (char.data && typeof char.data === "object") {
    char.data.isFavorite = newFav;
  }
  await charStore.put(char);

  const meta = buildCharMeta(char);
  await charMetaStore.put(meta);
  await tx.done;

  if (cachedMeta) {
    const idx = cachedMeta.findIndex((m) => m.id === id);
    if (idx >= 0) {
      cachedMeta[idx] = {
        ...cachedMeta[idx],
        isFavorite: newFav,
        updatedAt: char.updatedAt,
      };
    }
  }
  return newFav;
}

export async function getFavoriteCharacterCount(): Promise<number> {
  const allMeta = await getCachedMeta();
  return allMeta.filter((c) => !c.deletedAt && c.isFavorite).length;
}

export async function deleteCharactersBulk(
  ids: string[],
  onProgress?: (current: number, total: number, message: string) => void,
): Promise<void> {
  invalidateCache();
  if (ids.length === 0) return;
  const db = await initDB();

  const toHardDelete: CharacterCard[] = [];
  const toSoftDelete: CharacterCard[] = [];

  const READ_CHUNK = 50;
  for (let i = 0; i < ids.length; i += READ_CHUNK) {
    const chunkIds = ids.slice(i, i + READ_CHUNK);
    const tx = db.transaction("characters", "readonly");
    const chunkRows = (await Promise.all(
      chunkIds.map((id) => tx.store.get(id)),
    )) as (CharacterCard | undefined)[];
    await tx.done;

    for (const char of chunkRows) {
      if (!char) continue;
      if (char.deletedAt) {
        toHardDelete.push(char);
      } else {
        char.deletedAt = Date.now();
        toSoftDelete.push(char);
      }
    }

    if (i + READ_CHUNK < ids.length) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  let totalProcessed = 0;
  const totalItems = toSoftDelete.length + toHardDelete.length;

  // 索引里要用文件夹名判断工具类型（世界书 / 预设 / QR），这里读一次给后面写索引用，
  // 免得算出来的查重类型跟着文件夹一起丢
  let foldersMapForMeta: Map<string, string> | undefined;
  try {
    const ftx = db.transaction("folders", "readonly");
    const allFolders = await ftx.store.getAll();
    await ftx.done;
    foldersMapForMeta = new Map(allFolders.map((f: any) => [f.id, f.name] as [string, string]));
  } catch (e) {}

  // Soft Delete Transaction
  // 批量写进同一个事务, 不在循环里逐个 await(参考卡库的写法), 减少不必要的等待
  if (toSoftDelete.length > 0) {
    const tx = db.transaction(["characters", "char_meta"], "readwrite");
    for (const char of toSoftDelete) {
      tx.objectStore("characters").put(char);
      tx.objectStore("char_meta").put(buildCharMeta(char, foldersMapForMeta));
    }
    await tx.done;
    totalProcessed += toSoftDelete.length;
    onProgress?.(totalProcessed, totalItems, "移动角色到回收站...");
  }

  // Hard Delete Logic
  if (toHardDelete.length > 0) {
    const tx = db.transaction(["characters", "blobs", "char_meta", "thumbs"], "readwrite");
    const charStore = tx.objectStore("characters");
    const blobStore = tx.objectStore("blobs");
    const charMetaStore = tx.objectStore("char_meta");
    const thumbStore = tx.objectStore("thumbs");
    for (const char of toHardDelete) {
      charStore.delete(char.id);
      blobStore.delete(char.id);
      charMetaStore.delete(char.id);
      thumbStore.delete(char.id);
      noImageCharIds.delete(char.id);
    }
    await tx.done;
    totalProcessed += toHardDelete.length;
    onProgress?.(totalProcessed, totalItems, "彻底删除角色...");
  }
  invalidateCache();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("charactersDeleted", { detail: { ids } }));
    notifyCharactersUpdated();
  }
}

export async function deleteCharacter(id: string): Promise<void> {
  invalidateCache();
  const db = await initDB();
  const char = await db.get("characters", id);
  if (!char) {
    // If character store record doesn't exist, purge any dangling meta/blobs for this ID
    const tx = db.transaction(["char_meta", "blobs", "thumbs"], "readwrite");
    await tx.objectStore("char_meta").delete(id);
    await tx.objectStore("blobs").delete(id);
    await tx.objectStore("thumbs").delete(id);
    noImageCharIds.delete(id);
    await tx.done;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("characterDeleted", { detail: { id } }));
    }
    return;
  }

  if (char.deletedAt) {
    // Hard delete if already in trash
    const tx = db.transaction(["characters", "blobs", "char_meta", "thumbs"], "readwrite");
    await tx.objectStore("characters").delete(id);
    await tx.objectStore("blobs").delete(id);
    await tx.objectStore("char_meta").delete(id);
    await tx.objectStore("thumbs").delete(id);
    noImageCharIds.delete(id);
    await tx.done;
  } else {
    // Soft delete
    char.deletedAt = Date.now();
    await db.put("characters", char);
    await db.put("char_meta", buildCharMeta(char));
  }
  invalidateCache();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("characterDeleted", { detail: { id } }));
    notifyCharactersUpdated();
  }
}

export async function restoreCharacter(id: string): Promise<void> {
  invalidateCache();
  const db = await initDB();
  const char = await db.get("characters", id);
  if (char && char.deletedAt) {
    delete char.deletedAt;

    // Check if the folder still exists, otherwise remove folderId
    if (char.folderId) {
      const folder = await db.get("folders", char.folderId);
      if (!folder) {
        delete char.folderId;
      } else {
        let currentFolderId = char.folderId;
        const txFolders = db.transaction("folders", "readwrite");
        const folderStore = txFolders.store;
        while (currentFolderId) {
          const f = await folderStore.get(currentFolderId);
          if (f) {
            if (f.deletedAt) {
              delete f.deletedAt;
              await folderStore.put(f);
            }
            currentFolderId = f.parentId;
          } else {
            break;
          }
        }
        await txFolders.done;
      }
    }

    await db.put("characters", char);
    // 工具类（世界书 / 预设 / QR）是靠所在文件夹名认出来的，写索引时把这张卡所在
    // 文件夹一起喂进去，查重指纹里的类型才不会算成"角色卡"
    let restoreFolders: Map<string, string> | undefined;
    if (char.folderId) {
      const fold = await db.get("folders", char.folderId);
      if (fold) restoreFolders = new Map([[fold.id, fold.name]]);
    }
    await db.put("char_meta", buildCharMeta(char, restoreFolders));
  }
  invalidateCache();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("characterRestored", { detail: { id } }));
    notifyCharactersUpdated();
  }
}

export async function getTrashedCharacters(
  includeBlobs: boolean = false,
): Promise<CharacterCard[]> {
  const meta = await getCachedMeta();
  const trashedMeta = meta.filter((m) => m.deletedAt);
  trashedMeta.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));

  // 极速构建轻量角色元数据对象：0ms 极速响应，无需拉取数十兆的全量卡片字段与历史记录，杜绝内存飙升与转圈卡顿
  if (!includeBlobs) {
    return trashedMeta.map((m) => ({
      id: m.id,
      name: m.name,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      fileModifiedAt: m.fileModifiedAt,
      deletedAt: m.deletedAt,
      folderId: m.folderId,
      isFavorite: m.isFavorite,
      avatarUrlFallback: m.avatarUrlFallback,
      localFilePath: m.localFilePath,
      hasBlobsSeparated: m.hasBlobsSeparated,
      isQR: m.isQR,
      tags: m.tags || [],
      isTool: m.isTool,
      category: m.category,
      data: {} as any,
    }));
  }

  const db = await initDB();
  const trashed: CharacterCard[] = [];
  const fetchTx = db.transaction("characters", "readonly");
  const store = fetchTx.store;

  for (const m of trashedMeta) {
    const fullChar = await store.get(m.id);
    if (fullChar) {
      trashed.push(fullChar);
    }
  }

  for (const char of trashed) {
    if (char.hasBlobsSeparated) {
      const blobs = await db.get("blobs", char.id);
      if (blobs) {
        char.avatarBlob = blobs.avatarBlob;
        char.originalFile = blobs.originalFile;
        char.avatarHistory = blobs.avatarHistory;
      }
    }
  }
  return trashed;
}

export async function emptyTrash(): Promise<void> {
  const meta = await getCachedMeta();
  const toDelete = meta.filter((m) => m.deletedAt).map((m) => m.id);
  if (toDelete.length > 0) {
    await deleteCharactersBulk(toDelete);
  }
}

export async function cleanupOldTrash(): Promise<void> {
  invalidateCache();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const meta = await getCachedMeta();
  const toDelete = meta
    .filter((m) => m.deletedAt && now - m.deletedAt > SEVEN_DAYS_MS)
    .map((m) => m.id);

  if (toDelete.length > 0) {
    await deleteCharactersBulk(toDelete);
  }
}

export interface DuplicateCharacter {
  char: CharacterCard;
  reason: string;
}

export interface DuplicateGroup {
  id: string;
  resourceType: ResourceType;
  characters: DuplicateCharacter[];
}

/**
 * 规范化卡片基础名称：智能剥离重名后缀、版本号、副本标识等
 * 例如："爱丽丝_1", "爱丽丝_12345", "爱丽丝 (1)", "爱丽丝_v2", "爱丽丝 - 副本", "爱丽丝_new" -> "爱丽丝"
 */
export function normalizeCardBaseName(rawName: string): string {
  if (!rawName) return "";
  let s = rawName.trim();

  // 1. 去除常见文件扩展名
  s = s.replace(/\.(zip|png|json|webp|jpg|jpeg|jsonl)$/i, "").trim();

  // 2. 去除末尾 UUID / 36位唯一标识 (如 _3fa85f64-5717-4562-b3fc-2c963f66afa6)
  s = s.replace(/_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, "").trim();
  s = s.replace(/_[a-f0-9-]{36}$/i, "").trim();

  // 3. 循环剥离末尾的数字后缀、重名序号、版本号、副本标识
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s
      .replace(/[_\s\-]+(?:v|ver|version)?\d+$/i, "") // _1, _12345, -1, 2, _v1, _v2
      .replace(/[\(\（\[【]\s*(?:v|ver|version|副本|复制|copy|第)?\s*\d*\s*[\)\）\]】]$/i, "") // (1), （1）, [1], (副本), (copy)
      .replace(/[_\s\-]+(?:copy|bak|backup|new|old|temp|draft|duplicate|副本|新|旧|备份|更新|重置|修改|修|改|第[0-9一二三四五六七八九十]+版)$/i, "") // _copy, _副本, _new, _旧
      .trim();
  }
  return s.trim() || rawName.trim();
}

/** 查重指纹格式版本：改过提取规则就 +1，老索引会自动重建一次。 */
export const DUP_FP_VERSION = 1;

/** 这些是「占位名」，同名也不算重复（新建卡默认名字之类）。 */
const GENERIC_DUP_NAMES = new Set([
  "",
  "未命名",
  "未命名角色",
  "未命名工具",
  "untitled",
  "new character",
  "character",
  "card",
  "角色",
  "新建角色",
]);

/**
 * 算一张卡的「查重指纹」：只取比对重复要用的那几个值
 * （基础名 / 是不是占位名 / 资源类型 / 设定指纹+长度 / 开场白指纹+长度）。
 *
 * 以前这些是在查重时现算的：要先把卡库里每一张卡的完整数据读出来才够算，卡多、正文长
 * 就很慢（删一次重复卡就整库重算一遍，机器会明显发烫）。现在改成「建索引时算一次存进
 * 轻量索引 char_meta」，查重只读索引 —— 索引里没有大字段，也没有卡图 base64。
 */
export function computeDuplicateFingerprint(
  val: any,
  foldersMap?: Map<string, string>,
): Pick<CharMeta, "dupVersion" | "dupResType" | "dupBaseName" | "dupIsGenericName" | "dupDescHash" | "dupFirstHash" | "dupDescLen" | "dupFirstLen"> {
  const data = val?.data?.data || val?.data || {};
  const rawName = String(val?.name || data.name || "").trim();
  const baseName = normalizeCardBaseName(rawName).toLowerCase();

  // 预设 / 世界书 / 快速回复这些工具类资源, 正文散在 prompts / entries / qrList 里
  let extraContent = "";
  if (data.prompts && Array.isArray(data.prompts)) {
    extraContent = data.prompts.map((p: any) => p?.content || p?.text || "").join("");
  } else if (data.entries && (Array.isArray(data.entries) || typeof data.entries === "object")) {
    const entVals = Array.isArray(data.entries) ? data.entries : Object.values(data.entries);
    extraContent = (entVals as any[]).map((e: any) => e?.content || e?.text || e?.comment || "").join("");
  } else if (data.qrList && Array.isArray(data.qrList)) {
    extraContent = data.qrList.map((q: any) => q?.message || q?.label || "").join("");
  } else if (data.content && typeof data.content === "string") {
    extraContent = data.content;
  }

  const descClean = (String(data.description || "") + extraContent).replace(/\s+/g, "");
  const firstClean = String(data.first_mes || "").replace(/\s+/g, "");

  return {
    dupVersion: DUP_FP_VERSION,
    dupResType: getResourceType(val, foldersMap),
    dupBaseName: baseName,
    dupIsGenericName: GENERIC_DUP_NAMES.has(baseName),
    dupDescHash: descClean ? hashForDuplicateKey(descClean) : "",
    dupFirstHash: firstClean ? hashForDuplicateKey(firstClean) : "",
    dupDescLen: descClean.length,
    dupFirstLen: firstClean.length,
  };
}

/**
 * 算指纹的"兜底版"：任何一张卡的数据长得再野（第三方卡把 null 塞进 prompts 之类），
 * 也只是这张卡暂时没有指纹，不会把这张卡从索引里踢出去。
 */
function safeDuplicateFingerprint(val: any, foldersMap?: Map<string, string>) {
  try {
    return computeDuplicateFingerprint(val, foldersMap);
  } catch (err) {
    console.warn("[MetaCache] 这张卡的查重指纹没算出来（卡本身不受影响）：", err);
    return {};
  }
}

/**
 * 索引里的指纹 → 查重扫描用的条目。索引里没有指纹（老数据、或字段自相矛盾）时返回 null，
 * 调用方只对那一张卡回退读一次整卡。
 */
function duplicateEntryFromMeta(meta: CharMeta): DuplicateScanEntry | null {
  if (!meta || meta.dupVersion !== DUP_FP_VERSION || !meta.dupResType) return null;
  // 索引里两个字段打架（一个说是工具、一个算成了角色卡）：宁可多读这一次，也不能把
  // 工具卡和角色卡凑成一组重复。
  if (meta.isTool && meta.dupResType === "character") return null;
  return {
    id: meta.id,
    resType: meta.dupResType,
    baseName: meta.dupBaseName || "",
    isGenericName: !!meta.dupIsGenericName,
    descHash: meta.dupDescHash || "",
    firstHash: meta.dupFirstHash || "",
    descLen: meta.dupDescLen || 0,
    firstLen: meta.dupFirstLen || 0,
  };
}

interface DuplicateScanEntry {
  id: string;
  resType: ResourceType;
  baseName: string;
  isGenericName: boolean;
  descHash: string;
  firstHash: string;
  descLen: number;
  firstLen: number;
}

/**
 * 给超长正文算一个短指纹当 Map key 用。查重以前直接把"设定 + 开场白"的全文拼成
 * key 塞进 Map, 卡一多就是几十 MB 的字符串长期驻留内存, 光哈希这些 key 就能把
 * 主线程堵死。这里换成 64 位量级哈希 + 长度, 等值判断的效果和全文 key 等价。
 */
function hashForDuplicateKey(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 16777619);
    h2 = Math.imul(h2 + code, 2246822519);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}-${input.length.toString(16)}`;
}

export async function findDuplicates(): Promise<DuplicateGroup[]> {
  const db = await initDB();

  // 加载文件夹映射，确保能准确识别位于特定工具文件夹中的卡片类型
  const foldersTx = db.transaction("folders", "readonly");
  const allFolders = await foldersTx.store.getAll();
  await foldersTx.done;
  const foldersMap = new Map<string, string>();
  for (const f of allFolders) {
    foldersMap.set(f.id, f.name);
  }

  // 查重只读轻量索引 char_meta：里面已经存好了「比对重复」要用的指纹
  // （基础名 / 设定指纹 / 开场白指纹 + 各自长度），不用再把每张卡的完整数据
  // （大字段 data、世界书条目、预设全文、卡图 base64）逐张读进内存再算一遍。
  // 索引里没有指纹的（升级后第一次还没重建索引、极个别漏写的老数据）只对那一张
  // 回退读整卡，并顺手把指纹补写回索引，下次就不用再读了。
  const precomputed: DuplicateScanEntry[] = [];

  const metaRows = await db.getAll("char_meta");
  const metaById = new Map<string, CharMeta>();
  const needFill: string[] = [];
  for (const meta of metaRows) {
    metaById.set(meta.id, meta);
    if (meta.deletedAt) continue;
    const entry = duplicateEntryFromMeta(meta);
    if (entry) precomputed.push(entry);
    else needFill.push(meta.id);
  }

  // characters 里有、索引里没有的（异常数据，正常不该出现）：一起补，保证不漏卡
  const charKeys = await db.getAllKeys("characters");
  for (const key of charKeys) {
    if (!metaById.has(key)) needFill.push(key);
  }

  if (needFill.length > 0) {
    // 逐批读（每批 50 张，批与批之间让出主线程），只读缺指纹的那些卡
    const FILL_CHUNK = 50;
    const filledMetas: CharMeta[] = [];
    for (let i = 0; i < needFill.length; i += FILL_CHUNK) {
      const chunkIds = needFill.slice(i, i + FILL_CHUNK);
      const fillTx = db.transaction("characters", "readonly");
      const chunkRows = (await Promise.all(
        chunkIds.map((id) => fillTx.store.get(id)),
      )) as (CharacterCard | undefined)[];
      await fillTx.done;

      for (const char of chunkRows) {
        if (!char || char.deletedAt) continue;
        const meta = buildCharMeta(char, foldersMap);
        filledMetas.push(meta);
        const entry = duplicateEntryFromMeta(meta);
        if (entry) precomputed.push(entry);
      }

      if (i + FILL_CHUNK < needFill.length) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // 补写回索引：一个事务批量写，不逐条开事务
    if (filledMetas.length > 0) {
      try {
        const putTx = db.transaction("char_meta", "readwrite");
        for (const meta of filledMetas) putTx.store.put(meta);
        await putTx.done;
        invalidateCache();
      } catch (e) {}
    }
  }

  const entryById = new Map<string, DuplicateScanEntry>();
  for (const item of precomputed) entryById.set(item.id, item);

  // 并查集 (Union-Find) 关联所有同名/重名/迭代/内容重复的卡片
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let p = parent.get(id) || id;
    if (p !== id) {
      p = find(p);
      parent.set(id, p);
    }
    return p;
  };
  const union = (id1: string, id2: string) => {
    const root1 = find(id1);
    const root2 = find(id2);
    if (root1 !== root2) {
      parent.set(root1, root2);
    }
  };

  // 1. 同基础名称（包含 _1, _12345, (1), _v2 等重名/迭代卡）
  // 必须严格加上资源类型 resType 隔离，角色卡、世界书、QR绝对不能互相匹配！
  const baseNameMap = new Map<string, string[]>();

  // 2. 精确内容相同（设定与开场白均一致，支持改名或内容完全相同）
  const contentMap = new Map<string, string[]>();

  // 3. 基础名称 + 设定一致 / 基础名称 + 开场白一致
  const nameDescMap = new Map<string, string[]>();
  const nameFirstMap = new Map<string, string[]>();

  for (const item of precomputed) {
    // 同基础名称 (非通用占位名) 自动聚合 - 严格在相同资源类型内！
    if (item.baseName && !item.isGenericName) {
      const key = `${item.resType}:::${item.baseName}`;
      const list = baseNameMap.get(key) || [];
      list.push(item.id);
      baseNameMap.set(key, list);
    }

    if (item.descHash && item.firstHash && (item.descLen > 20 || item.firstLen > 20)) {
      const key = `${item.resType}:::${item.descHash}|${item.firstHash}`;
      const list = contentMap.get(key) || [];
      list.push(item.id);
      contentMap.set(key, list);
    }

    if (item.baseName && item.descHash) {
      const key = `${item.resType}:::${item.baseName}|${item.descHash}`;
      const list = nameDescMap.get(key) || [];
      list.push(item.id);
      nameDescMap.set(key, list);
    }

    if (item.baseName && item.firstHash) {
      const key = `${item.resType}:::${item.baseName}|${item.firstHash}`;
      const list = nameFirstMap.get(key) || [];
      list.push(item.id);
      nameFirstMap.set(key, list);
    }
  }

  const connectList = (list: string[]) => {
    if (list.length > 1) {
      for (let i = 1; i < list.length; i++) {
        union(list[0], list[i]);
      }
    }
  };

  for (const list of baseNameMap.values()) connectList(list);
  for (const list of contentMap.values()) connectList(list);
  for (const list of nameDescMap.values()) connectList(list);
  for (const list of nameFirstMap.values()) connectList(list);

  // 按根节点分组
  const groupMap = new Map<string, string[]>();
  for (const item of precomputed) {
    const root = find(item.id);
    const list = groupMap.get(root) || [];
    list.push(item.id);
    groupMap.set(root, list);
  }

  const rawGroups = Array.from(groupMap.values()).filter((list) => list.length > 1);

  // 严密硬隔离防护：无论何种情况，重复卡组内绝对不能混入不同资源类型的卡！
  // 角色卡只能和角色卡一组；快速回复只能和快速回复一组；世界书只能和世界书一组！
  const strictlySeparatedGroups: string[][] = [];
  for (const groupIds of rawGroups) {
    const byType = new Map<ResourceType, string[]>();
    for (const id of groupIds) {
      const entry = entryById.get(id);
      if (!entry) continue;
      const list = byType.get(entry.resType) || [];
      list.push(id);
      byType.set(entry.resType, list);
    }
    for (const [_, typedIds] of byType.entries()) {
      if (typedIds.length > 1) {
        strictlySeparatedGroups.push(typedIds);
      }
    }
  }

  const allNeededIds = Array.from(new Set(strictlySeparatedGroups.flat()));
  const cardById = new Map<string, CharacterCard>();
  const FETCH_CHUNK = 50;

  for (let i = 0; i < allNeededIds.length; i += FETCH_CHUNK) {
    const chunkIds = allNeededIds.slice(i, i + FETCH_CHUNK);
    const tx = db.transaction("characters", "readonly");
    const rows = (await Promise.all(
      chunkIds.map((id) => tx.store.get(id)),
    )) as (CharacterCard | undefined)[];
    await tx.done;

    for (const char of rows) {
      if (char && !char.deletedAt) {
        cardById.set(char.id, char);
      }
    }
    if (i + FETCH_CHUNK < allNeededIds.length) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  const finalGroups: DuplicateGroup[] = [];

  for (const groupIds of strictlySeparatedGroups) {
    const groupChars: CharacterCard[] = [];
    for (const id of groupIds) {
      const char = cardById.get(id);
      if (char && !char.deletedAt) groupChars.push(char);
    }

    if (groupChars.length === 0) continue;

    const groupResType = getResourceType(groupChars[0], foldersMap);
    const sorted = [...groupChars].sort((a, b) => a.createdAt - b.createdAt);
    const analyzedChars: DuplicateCharacter[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];
      const cData = current.data?.data || current.data || {};

      if (i === 0) {
        analyzedChars.push({ char: current, reason: "最早导入的版本" });
        continue;
      }

      const oldest = sorted[0];
      const oData = oldest.data?.data || oldest.data || {};

      const reasons: string[] = [];

      if (groupResType === 'worldbook') {
        const cEnts = cData.entries || cData.data?.entries || {};
        const oEnts = oData.entries || oData.data?.entries || {};
        const cCount = Array.isArray(cEnts) ? cEnts.length : Object.keys(cEnts).length;
        const oCount = Array.isArray(oEnts) ? oEnts.length : Object.keys(oEnts).length;
        if (cCount > oCount) reasons.push(`词条+${cCount - oCount}`);
        else if (cCount < oCount) reasons.push(`词条-${oCount - cCount}`);
        else reasons.push("词条内容相同");
      } else if (groupResType === 'qr') {
        const cQr = Array.isArray(cData.qrList) ? cData.qrList.length : (Array.isArray(cData) ? cData.length : 0);
        const oQr = Array.isArray(oData.qrList) ? oData.qrList.length : (Array.isArray(oData) ? oData.length : 0);
        if (cQr > oQr) reasons.push(`动作+${cQr - oQr}`);
        else if (cQr < oQr) reasons.push(`动作-${oQr - cQr}`);
        else reasons.push("动作内容相同");
      } else if (groupResType === 'preset') {
        const cP = Array.isArray(cData.prompts) ? cData.prompts.length : 0;
        const oP = Array.isArray(oData.prompts) ? oData.prompts.length : 0;
        if (cP !== oP) reasons.push(`提示词条目变更`);
        else reasons.push("预设参数微调");
      } else {
        // Character cards
        const cDesc = cData.description || "";
        const oDesc = oData.description || "";
        const cFirst = cData.first_mes || "";
        const oFirst = oData.first_mes || "";
        const cMesExample = cData.mes_example || "";
        const oMesExample = oData.mes_example || "";

        const cBook =
          cData.character_book?.entries?.length ||
          cData.extensions?.character_book?.entries?.length ||
          0;
        const oBook =
          oData.character_book?.entries?.length ||
          oData.extensions?.character_book?.entries?.length ||
          0;

        const cAlt =
          cData.alternate_greetings?.length ||
          cData.extensions?.alternate_greetings?.length ||
          0;
        const oAlt =
          oData.alternate_greetings?.length ||
          oData.extensions?.alternate_greetings?.length ||
          0;

        // 首先检查是否与组内前面某张卡片内容完全一致（例如 1122 中的第二个 1 或第二个 2）
        let identicalPrevIndex = -1;
        for (let j = 0; j < i; j++) {
          const pData = sorted[j].data?.data || sorted[j].data || {};
          const pDesc = pData.description || "";
          const pFirst = pData.first_mes || "";
          const pMesEx = pData.mes_example || "";
          const pBook =
            pData.character_book?.entries?.length ||
            pData.extensions?.character_book?.entries?.length ||
            0;
          const pAlt =
            pData.alternate_greetings?.length ||
            pData.extensions?.alternate_greetings?.length ||
            0;

          if (
            cDesc === pDesc &&
            cFirst === pFirst &&
            cMesExample === pMesEx &&
            cBook === pBook &&
            cAlt === pAlt
          ) {
            identicalPrevIndex = j;
            break;
          }
        }

        if (identicalPrevIndex !== -1) {
          reasons.push("完全相同副本");
        } else if (
          cDesc === oDesc &&
          cFirst === oFirst &&
          cBook === oBook &&
          cAlt === oAlt &&
          cMesExample === oMesExample
        ) {
          reasons.push("基本相同");
        } else {
          if (cFirst !== oFirst) {
            if (cFirst.length > oFirst.length + 20) reasons.push("开场白长");
            else if (cFirst.length < oFirst.length - 20) reasons.push("开场白短");
            else reasons.push("改开场白");
          }
          if (cDesc !== oDesc) {
            if (cDesc.length > oDesc.length + 50) reasons.push("设定较长");
            else if (cDesc.length < oDesc.length - 50) reasons.push("设定较短");
            else reasons.push("改设定");
          }
          if (cBook > oBook) reasons.push(`世界书+${cBook - oBook}`);
          else if (cBook < oBook && cBook > 0)
            reasons.push(`世界书-${oBook - cBook}`);

          if (cAlt > oAlt) reasons.push(`备用开场+${cAlt - oAlt}`);

          if (cMesExample !== oMesExample) {
            if (cMesExample.length > oMesExample.length + 50)
              reasons.push("示例较长");
          }
        }
      }

      if (reasons.length === 0) {
        const cName = (current.name || cData.name || "").trim();
        const oName = (oldest.name || oData.name || "").trim();
        if (cName !== oName) {
          reasons.push("重名迭代");
        } else {
          reasons.push("微调细节");
        }
      }

      analyzedChars.push({ char: current, reason: reasons.join("，") });
    }

    finalGroups.push({
      id: crypto.randomUUID(),
      resourceType: groupResType,
      characters: analyzedChars,
    });
  }

  return finalGroups;
}

export async function getChatsForCharacter(
  characterId: string,
): Promise<ChatLog[]> {
  const db = await initDB();
  return db.getAllFromIndex("chats", "by-character", characterId);
}

export async function getChatById(id: string): Promise<ChatLog | undefined> {
  const db = await initDB();
  return db.get("chats", id);
}


export async function getChatsMetadataForCharacter(characterId: string, characterName: string): Promise<ChatMetadata[]> {
  const db = await initDB();
  const tx = db.transaction("chat_metadata", "readonly");
  const index = tx.store.index("by-character");
  
  const exactMatches = await index.getAll(characterId);
  const orphanMatches = await index.getAll("");
  
  await tx.done;
  
  const result = [...exactMatches];
  if (characterName) {
    const lowerName = characterName.toLowerCase();
    for (const orphan of orphanMatches) {
      if (orphan.firstAiName && orphan.firstAiName.toLowerCase() === lowerName) {
        result.push(orphan);
      }
    }
  }
  
  return result;
}

export async function getAllChatsMetadata(): Promise<ChatMetadata[]> {
  const db = await initDB();
  return db.getAll("chat_metadata");
}

export function computeChatMetadata(chat: ChatLog): ChatMetadata {
  const aiMsg = chat.messages?.find((m: any) => !m.is_user && m.name);
  const lastMsg = chat.messages?.length
    ? chat.messages[chat.messages.length - 1]
    : null;
  let preview = lastMsg?.mes || "";
  if (preview.length > 200) preview = preview.substring(0, 200) + "...";

  return {
    id: chat.id,
    characterId: chat.characterId,
    name: chat.name,
    createdAt: chat.createdAt,
    note: chat.note,
    messageCount: chat.messages?.length || 0,
    firstAiName: aiMsg?.name,
    lastMessagePreview: preview,
  };
}

export async function saveChat(chat: ChatLog): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(["chats", "chat_metadata"], "readwrite");
  await tx.objectStore("chats").put(chat);
  await tx.objectStore("chat_metadata").put(computeChatMetadata(chat));
  await tx.done;
}

export async function saveChatsBulk(
  chatsInput: ChatLog[],
  onProgress?: (current: number, total: number, phase: string) => void,
): Promise<void> {
  const db = await initDB();

  // 仅保留真正的聊天记录：剔除会话元数据头与非消息内容（世界书/预设/快速回复/
  // 角色卡等附属文件）。这样既避免空白/乱码气泡，也避免一份导出包里的附属文件
  // 各自生成一张「记录卡」（导入后主页/列表「爆出很多张」）。
  const chats: ChatLog[] = [];
  for (const c of chatsInput) {
    const { messages, isChat } = sanitizeChatMessages(c.messages);
    if (!isChat) continue; // 不是聊天记录，跳过，不生成记录卡
    chats.push({ ...c, messages });
  }

  if (chats.length === 0) {
    return;
  }

  // Pre-fetch all metadata to avoid duplicates by characterId + name
  const existingMeta = await getAllChatsMetadata();
  const existingMap = new Map<string, string>();
  for (const m of existingMeta) {
    existingMap.set(`${m.characterId}_${m.name}`, m.id);
  }

  // Deduplicate incoming chats against themselves as well
  const finalChatsToSave: ChatLog[] = [];
  const processedKeys = new Set<string>();

  for (const chat of chats) {
    const key = `${chat.characterId}_${chat.name}`;
    if (processedKeys.has(key)) continue; // skip duplicates within the incoming batch
    processedKeys.add(key);

    const existingId = existingMap.get(key);
    if (existingId) {
      chat.id = existingId; // Overwrite the existing chat!
    }
    finalChatsToSave.push(chat);
  }

  const CHUNK_SIZE = 100;
  for (let i = 0; i < finalChatsToSave.length; i += CHUNK_SIZE) {
    const chunk = finalChatsToSave.slice(i, i + CHUNK_SIZE);
    const tx = db.transaction(["chats", "chat_metadata"], "readwrite");
    const chatStore = tx.objectStore("chats");
    const metaStore = tx.objectStore("chat_metadata");

    for (const chat of chunk) {
      chatStore.put(chat);
      metaStore.put(computeChatMetadata(chat));
    }
    await tx.done;

    if (onProgress) {
      onProgress(
        Math.min(i + CHUNK_SIZE, finalChatsToSave.length),
        finalChatsToSave.length,
        "正在保存数据到数据库...",
      );
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  invalidateCache();
}

export async function deleteChat(id: string): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(["chats", "chat_metadata"], "readwrite");
  await tx.objectStore("chats").delete(id);
  await tx.objectStore("chat_metadata").delete(id);
  await tx.done;
}

export async function deleteChatsBulk(
  ids: string[],
  onProgress?: (current: number, total: number, message: string) => void,
): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(["chats", "chat_metadata"], "readwrite");
  const chatStore = tx.objectStore("chats");
  const metaStore = tx.objectStore("chat_metadata");

  for (const id of ids) {
    chatStore.delete(id);
    metaStore.delete(id);
  }
  await tx.done;

  if (ids.length > 0) {
    onProgress?.(ids.length, ids.length, "清理聊天记录...");
  }
}

export async function getMemosForCharacter(
  characterId: string,
): Promise<CharacterMemo[]> {
  const db = await initDB();
  const memos = await db.getAllFromIndex("memos", "by-character", characterId);
  return memos.sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    if (a.order !== undefined && b.order !== undefined)
      return a.order - b.order;
    return b.createdAt - a.createdAt;
  }); // Pinned first, then ordered, then newest first
}

export async function saveMemo(memo: CharacterMemo): Promise<void> {
  const db = await initDB();
  await db.put("memos", memo);
  deepMemoTextCache = null;
  deepMemoCachePromise = null;
}

export async function deleteMemo(id: string): Promise<void> {
  const db = await initDB();
  await db.delete("memos", id);
  deepMemoTextCache = null;
  deepMemoCachePromise = null;
}

export async function getUserPersonas(): Promise<UserPersona[]> {
  const db = await initDB();
  const list = await db.getAllFromIndex("user_personas", "by-date");
  return list.sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

export async function saveUserPersona(persona: UserPersona): Promise<void> {
  const db = await initDB();
  const boundSet = new Set(persona.boundCharacterIds || []);
  if (persona.isDefault || boundSet.size > 0) {
    const all = await getUserPersonas();
    const tx = db.transaction("user_personas", "readwrite");
    for (const p of all) {
      if (p.id === persona.id) continue;
      let changed = false;
      const updated = { ...p };
      if (persona.isDefault && updated.isDefault) {
        updated.isDefault = false;
        changed = true;
      }
      if (boundSet.size > 0 && Array.isArray(updated.boundCharacterIds) && updated.boundCharacterIds.some(cid => boundSet.has(cid))) {
        updated.boundCharacterIds = updated.boundCharacterIds.filter(cid => !boundSet.has(cid));
        changed = true;
      }
      if (changed) {
        updated.updatedAt = Date.now();
        await tx.store.put(updated);
      }
    }
    await tx.done;
  }
  await db.put("user_personas", persona);
}

export async function getUserPersonaForCharacter(characterId: string): Promise<UserPersona | null> {
  if (!characterId) return null;
  const list = await getUserPersonas();
  return list.find(p => Array.isArray(p.boundCharacterIds) && p.boundCharacterIds.includes(characterId)) || null;
}

export async function setUserPersonaForCharacter(characterId: string, personaId: string | null): Promise<void> {
  if (!characterId) return;
  const db = await initDB();
  const all = await getUserPersonas();
  const now = Date.now();
  const tx = db.transaction("user_personas", "readwrite");
  for (const p of all) {
    const current = Array.isArray(p.boundCharacterIds) ? p.boundCharacterIds : [];
    const hasChar = current.includes(characterId);
    if (p.id === personaId) {
      if (!hasChar) {
        await tx.store.put({
          ...p,
          boundCharacterIds: [...current, characterId],
          updatedAt: now,
        });
      }
    } else if (hasChar) {
      await tx.store.put({
        ...p,
        boundCharacterIds: current.filter(id => id !== characterId),
        updatedAt: now,
      });
    }
  }
  await tx.done;
}

export async function deleteUserPersona(id: string): Promise<void> {
  const db = await initDB();
  await db.delete("user_personas", id);
}
