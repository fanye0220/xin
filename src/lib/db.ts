import { getFallbackAvatar, resolveAvatarUrl } from "./avatar";
import { openDB, DBSchema, IDBPDatabase } from "idb";
import { getLocalImageUrl, isAndroid } from "./appBridge";
import { sanitizeChatMessages } from "./chatParse";
import { getCharacterTokenBreakdown } from "./tokens";

// 本地 Android 文件同步已按需求关闭，后续只使用 IndexedDB + 云端同步。
const ENABLE_ANDROID_FILE_SYNC = false;

let _androidSyncQueue = Promise.resolve();
let _inAndroidSyncQueue = false;
export function enqueueAndroidSync<T>(task: () => Promise<T>): Promise<T> {
  // Reentrant-safe: if already inside a queue task, execute directly to avoid deadlock
  if (_inAndroidSyncQueue) {
    return task();
  }
  return new Promise((resolve, reject) => {
    _androidSyncQueue = _androidSyncQueue.then(async () => {
      _inAndroidSyncQueue = true;
      try {
        resolve(await task());
      } catch (e) {
        console.error("Android sync queue error:", e);
        reject(e);
      } finally {
        _inAndroidSyncQueue = false;
      }
    });
  });
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
    (rawData.temperature !== undefined && rawData.top_p !== undefined && rawData.openai_max_tokens !== undefined) ||
    (outer.temperature !== undefined && outer.top_p !== undefined && outer.openai_max_tokens !== undefined) ||
    (target.temperature !== undefined && target.top_p !== undefined && target.openai_max_tokens !== undefined);
  const isPresetFileOrName =
    filename.includes('.preset') || filename.includes('_preset') || filename.includes('-preset') ||
    /(?:^|[_\-\s\[\(（【])(?:预设|preset)(?:[\]\)）】]|$|[_\-\s\.])/i.test(rawName);

  if (hasPromptsArray || hasPresetProps || isPresetFileOrName) {
    return 'preset';
  }

  // 7. 独立脚本 / 正则 (Script) 特征签名
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

  if (isScriptArray || hasScriptProps || isScriptFileOrName || char?.isTool) {
    return 'script';
  }

  // 8. 独立美化主题 (Theme) 特征签名
  const hasThemeProps = 
    rawData.blur_strength !== undefined || outer.blur_strength !== undefined || target.blur_strength !== undefined ||
    rawData.main_text_color !== undefined || outer.main_text_color !== undefined || target.main_text_color !== undefined ||
    rawData.chat_display !== undefined || outer.chat_display !== undefined || target.chat_display !== undefined ||
    rawData.theme_name !== undefined || outer.theme_name !== undefined || target.theme_name !== undefined ||
    rawData.chat_width !== undefined || outer.chat_width !== undefined || target.chat_width !== undefined;

  if (hasThemeProps) {
    return 'theme';
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
  lastCheckedAt?: number;
  lastCheckResult?: 'up-to-date' | 'has-update' | 'error' | string;
  lastCheckVersion?: string;
  lastCheckChanges?: string[];
  lastCheckError?: string;
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

let dbPromise: Promise<IDBPDatabase<TavernDB>>;

export function initDB() {
  if (!dbPromise) {
    dbPromise = openDB<TavernDB>("tavern-manager-v2", 7, {
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
      },
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
  const txScan = db.transaction("characters", "readonly");
  let cursorScan = await txScan.objectStore("characters").openCursor();
  const allChars: CharacterCard[] = [];
  while (cursorScan) {
    allChars.push(cursorScan.value);
    cursorScan = await cursorScan.continue();
  }

  for (const char of allChars) {
    let changed = false;
    const category = getCharacterCategoryPrefix(char);
    if (category !== "未归类" && (!char.folderId || char.folderId === "all")) {
      const folderName = category === "脚本" ? "工具区" : category;
      const targetFolderId = await getOrCreateNestedFolder([folderName]);
      if (targetFolderId && char.folderId !== targetFolderId) {
        char.folderId = targetFolderId;
        changed = true;
      }
    }

    const writeTx = db.transaction(["characters", "char_meta"], "readwrite");
    if (changed) {
      await writeTx.objectStore("characters").put(char);
    }
    await writeTx.objectStore("char_meta").put(buildCharMeta(char));
    await writeTx.done;
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(MIGRATION_V25_FLAG, 'true');
  }

  invalidateCache();
}

export async function getFolders(): Promise<Folder[]> {
  const db = await initDB();
  const folders = await db.getAllFromIndex("folders", "by-date");
  return folders.sort((a, b) => {
    if (a.sortOrder !== undefined && b.sortOrder !== undefined) {
      return a.sortOrder - b.sortOrder;
    }
    if (a.sortOrder !== undefined) return -1;
    if (b.sortOrder !== undefined) return 1;
    return b.createdAt - a.createdAt;
  });
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
}

export async function getFolderPreviews(
  folderIds: string[],
): Promise<Record<string, FolderPreviewItem[]>> {
  if (folderIds.length === 0) return {};
  const db = await initDB();
  const tx = db.transaction("char_meta", "readonly");
  const index = tx.store.index("by-folder");

  const previews: Record<string, FolderPreviewItem[]> = {};

  await Promise.all(
    folderIds.map(async (folderId) => {
      let metas = await index.getAll(folderId);
      metas = metas.filter((m) => !m.deletedAt);
      metas.sort((a, b) => b.createdAt - a.createdAt);
      const topMetas = metas.slice(0, 4);

      // 只读取前 4 张卡的轻量 meta, 再按需取头像 blob, 不再全量读取角色 data
      const topBlobs = await Promise.all(
        topMetas.map(async (meta) => {
          let url: string | undefined = undefined;
          if (meta.localFilePath) {
            url = getLocalImageUrl(
              meta.localFilePath,
              meta.updatedAt || meta.createdAt,
            );
          } else if (meta.hasBlobsSeparated) {
            const blobs = await db.get("blobs", meta.id);
            if (blobs?.avatarBlob) url = URL.createObjectURL(blobs.avatarBlob);
          } else {
            const legacyChar = await db.get("characters", meta.id);
            if (legacyChar?.avatarBlob) {
              url = URL.createObjectURL(legacyChar.avatarBlob);
            }
          }
          let fallbackUrlStr = meta.avatarUrlFallback;
          if (fallbackUrlStr && (
              fallbackUrlStr.includes("api.dicebear.com") || 
              fallbackUrlStr.startsWith('data:image/svg+xml;charset=utf-8,') || 
              fallbackUrlStr.startsWith('data:image/svg+xml;base64,')
          )) {
            fallbackUrlStr = undefined;
          }
          return {
            url: url || fallbackUrlStr || getFallbackAvatar(meta.name || meta.id, meta.tags?.join(',') || (meta.isTool ? 'tool' : undefined)),
            seed: meta.name || meta.id,
            tags: meta.tags,
            isTool: meta.isTool
          };
        }),
      );

      previews[folderId] = topBlobs.filter(Boolean) as FolderPreviewItem[];
    }),
  );

  return previews;
}

export async function getFolderItemCounts(
  folderIds: string[],
): Promise<Record<string, number>> {
  if (folderIds.length === 0) return {};
  const db = await initDB();
  const tx = db.transaction("char_meta", "readonly");
  const index = tx.store.index("by-folder");
  const counts: Record<string, number> = {};
  await Promise.all(
    folderIds.map(async (folderId) => {
      const metas = await index.getAll(folderId);
      counts[folderId] = metas.filter((m) => !m.deletedAt).length;
    }),
  );
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

  if (ENABLE_ANDROID_FILE_SYNC && isAndroid()) {
    try {
      const { syncCharacterToAndroid } = await import("./androidSync");
      const allFolders = await db.getAllFromIndex("folders", "by-date");
      const descendantIds = new Set<string>([folder.id]);
      let added = true;
      while (added) {
        added = false;
        for (const f of allFolders) {
          if (
            f.parentId &&
            descendantIds.has(f.parentId) &&
            !descendantIds.has(f.id)
          ) {
            descendantIds.add(f.id);
            added = true;
          }
        }
      }

      const allChars = await db.getAll("characters");
      const charsToSync = allChars.filter(
        (c) => c.folderId && descendantIds.has(c.folderId) && !c.deletedAt,
      );

      for (const char of charsToSync) {
        const blobs = await db.get("blobs", char.id);
        const newPaths = await syncCharacterToAndroid(char, blobs || null);
        if (newPaths && newPaths.length > 0) {
          if (newPaths[0].match(/\.(png|jpe?g|webp|gif|bmp)$/i)) {
            char.localFilePath = newPaths[0];
          } else {
            delete char.localFilePath;
            (char as any)._androidSyncPath = newPaths[0];
          }
          await db.put("characters", char);
        }
        await new Promise((r) => setTimeout(r, 20));
      }
    } catch (e) {
      console.error("Android folder sync failed", e);
    }
  }
}

export async function deleteFolder(
  id: string,
  onProgress?: (current: number, total: number, msg: string) => void,
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

  // Find the target folder (the parent of the root folder being deleted)
  const rootFolder = allFolders.find((f) => f.id === id);
  const targetParentId = rootFolder?.parentId;

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

  // Sync to Android outside of transactions asynchronously
  if (ENABLE_ANDROID_FILE_SYNC && isAndroid() && charsToMove.length > 0) {
    try {
      const {
        fastMoveCharacterOnAndroid,
        syncCharacterToAndroid,
        deleteFolderFromAndroid,
      } = await import("./androidSync");
      const dbRef = await initDB();

      // Attempt to delete native folders
      for (const folderId of folderIdsToDelete) {
        const f = allFolders.find((x) => x.id === folderId);
        if (f) await deleteFolderFromAndroid(f).catch(() => {});
      }

      let totalProcessed = 0;
      for (let i = 0; i < charsToMove.length; i++) {
        const char = charsToMove[i];
        const fastPaths = await fastMoveCharacterOnAndroid(char);
        if (fastPaths && fastPaths.length > 0) {
          if (fastPaths[0].match(/\.(png|jpe?g|webp|gif|bmp)$/i)) {
            char.localFilePath = fastPaths[0];
          } else {
            delete char.localFilePath;
            (char as any)._androidSyncPath = fastPaths[0];
          }
          await dbRef.put("characters", char);
        } else {
          const blobs = await dbRef.get("blobs", char.id);
          const syncPaths = await syncCharacterToAndroid(char, blobs || null);
          if (syncPaths && syncPaths.length > 0) {
            if (syncPaths[0].match(/\.(png|jpe?g|webp|gif|bmp)$/i)) {
              char.localFilePath = syncPaths[0];
            } else {
              delete char.localFilePath;
              (char as any)._androidSyncPath = syncPaths[0];
            }
            await dbRef.put("characters", char);
          }
        }
        totalProcessed++;
        onProgress?.(totalProcessed, charsToMove.length, "移动角色到回收站...");
        await new Promise((r) => setTimeout(r, 2));
      }
    } catch (e) {
      console.error("Android folder delete sync failed", e);
    }
  }
}

export async function cleanupEmptyFolders(): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(["folders", "characters", "char_meta"], "readwrite");
  const allFolders = await tx.objectStore("folders").getAll();
  const allCharacters = await tx.objectStore("characters").getAll();

  const charStore = tx.objectStore("characters");
  const charMetaStore = tx.objectStore("char_meta");
  let purgedTrashCharacters = 0;
  for (const c of allCharacters) {
    if (
      c.localFilePath &&
      (c.localFilePath.includes("回收站/") ||
        c.localFilePath.includes("回收站"))
    ) {
      if (!c.deletedAt) {
        c.deletedAt = Date.now();
        await charStore.put(c);
        await charMetaStore.put(buildCharMeta(c));
        purgedTrashCharacters++;
      }
    }
  }

  if (allFolders.length === 0 && purgedTrashCharacters === 0) {
    await tx.done;
    return;
  }

  // Preserve all user folders even if they are currently empty.
  // Only remove legacy/internal "回收站" folder if accidentally stored in folders.
  const foldersToDelete = new Set<string>();
  for (const f of allFolders) {
    if (f.name === "回收站") {
      foldersToDelete.add(f.id);
    }
  }

  if (foldersToDelete.size > 0) {
    const store = tx.objectStore("folders");
    for (const id of foldersToDelete) {
      await store.delete(id);
    }
  }

  await tx.done;

  if (foldersToDelete.size > 0 || purgedTrashCharacters > 0) {
    invalidateCache();

    if (ENABLE_ANDROID_FILE_SYNC && foldersToDelete.size > 0 && isAndroid()) {
      try {
        const { deleteFolderFromAndroid } = await import("./androidSync");
        for (const id of foldersToDelete) {
          const f = allFolders.find((x) => x.id === id);
          if (f && f.name !== "回收站") {
            await deleteFolderFromAndroid(f);
          }
        }
      } catch (e) {}
    }
  }
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

  tokenCount?: number;
  permanentTokens?: number;
}

function buildCharMeta(val: any, foldersMap?: Map<string, string>): CharMeta {
  let charTags = val.data?.data?.tags || val.data?.tags || val.tags;
  if (!Array.isArray(charTags)) charTags = [];
  const cat = getCharacterCategoryPrefix(val, foldersMap);
  const isTool = cat !== "未归类";
  const isQR = cat === "快速回复";
  const fallbackAvatar = resolveAvatarUrl(val.avatarUrlFallback, val.name || val.id, cat);
  const isFav = Boolean(
    val.isFavorite ||
    val.favorite ||
    val.data?.data?.isFavorite ||
    val.data?.isFavorite ||
    val.data?.favorite
  );

  let tokenCount = val.tokenCount;
  let permanentTokens = val.permanentTokens;
  if ((tokenCount === undefined || permanentTokens === undefined) && val.data) {
    try {
      const breakdown = getCharacterTokenBreakdown(val.data);
      tokenCount = breakdown.totalTokens;
      permanentTokens = breakdown.permanentTokens;
    } catch {}
  }

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
    localFilePath: val.localFilePath,
    hasBlobsSeparated: val.hasBlobsSeparated,
    avatarUrlFallback: fallbackAvatar,
    tokenCount,
    permanentTokens,
  };
}

let cachedMeta: CharMeta[] | null = null;
let isBuildingCache = false;
const REPAIR_CATEGORY_FLAG = "tavern_category_repair_v10_strict_worldbook_card_distinction";
const REPAIR_TOKEN_FLAG = "tavern_meta_tokens_v4";

export async function cleanupGhostCards(): Promise<{ cleanedCount: number }> {
  try {
    const db = await initDB();
    const tx = db.transaction(["characters", "char_meta", "blobs"], "readwrite");
    const charStore = tx.objectStore("characters");
    const metaStore = tx.objectStore("char_meta");
    const blobStore = tx.objectStore("blobs");

    // Ultra-fast check using only primary keys (0.001s, zero RAM overhead)
    const metaKeys = await metaStore.getAllKeys();
    const charKeys = await charStore.getAllKeys();

    const charKeySet = new Set(charKeys);
    let cleanedCount = 0;

    for (const key of metaKeys) {
      if (!charKeySet.has(key)) {
        await metaStore.delete(key);
        await blobStore.delete(key);
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

  if (isBuildingCache) {
    while (isBuildingCache) await new Promise((r) => setTimeout(r, 50));
    if (cachedMeta) return cachedMeta;
  }
  isBuildingCache = true;

  const db = await initDB();
  let newMeta = await db.getAll("char_meta");

  const needsRepair = typeof localStorage !== 'undefined' && (
    localStorage.getItem(REPAIR_CATEGORY_FLAG) !== 'true' ||
    localStorage.getItem(REPAIR_TOKEN_FLAG) !== 'true'
  );

  // 第一次升级/索引丢失/缺少 category 字段/缺少 token 统计/需要修复历史错误分类时, 从完整角色表重建一次, 并写回轻量索引。
  // 之后所有常用入口都只读 char_meta, 不再触碰大字段 data。
  if (!newMeta || newMeta.length === 0 || newMeta.some((m) => m.category === undefined || m.tokenCount === undefined) || needsRepair) {
    const tx = db.transaction("characters", "readonly");
    const allChars = await tx.store.getAll();
    await tx.done;

    // Build folder map for folder-based classification
    const foldersTx = db.transaction("folders", "readonly");
    const allFolders = await foldersTx.store.getAll();
    await foldersTx.done;
    const folderMap = new Map<string, string>();
    for (const f of allFolders) {
      folderMap.set(f.id, f.name);
    }

    const toolFolderIds = new Set<string>();
    for (const f of allFolders) {
      if (["世界书", "预设", "工具区", "美化", "快速回复", "脚本"].includes(f.name)) {
        toolFolderIds.add(f.id);
      }
    }

    const updatedCharsToWrite: CharacterCard[] = [];
    newMeta = [];

    for (const char of allChars) {
      // 过滤空无内容的无效幽灵数据
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
        // 真正普通角色卡
        if (char.category !== "未归类" || char.isTool || char.isQR) {
          char.category = "未归类";
          char.isTool = false;
          char.isQR = false;
          changed = true;
        }
        // 若普通角色卡误入工具文件夹，恢复为未归类
        if (char.folderId && toolFolderIds.has(char.folderId)) {
          char.folderId = undefined;
          changed = true;
        }
      }

      if (changed) {
        updatedCharsToWrite.push(char);
      }
      newMeta.push(buildCharMeta(char, folderMap));
    }

    if (updatedCharsToWrite.length > 0) {
      const writeTx = db.transaction("characters", "readwrite");
      for (const item of updatedCharsToWrite) {
        await writeTx.store.put(item);
      }
      await writeTx.done;
    }

    if (newMeta.length > 0) {
      const putTx = db.transaction("char_meta", "readwrite");
      for (const meta of newMeta) {
        await putTx.store.put(meta);
      }
      await putTx.done;
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(REPAIR_CATEGORY_FLAG, 'true');
      localStorage.setItem(REPAIR_TOKEN_FLAG, 'true');
    }
  }

  cachedMeta = newMeta;
  isBuildingCache = false;
  return cachedMeta;
}

let _invalidateTimer: ReturnType<typeof setTimeout> | null = null;
export function invalidateCache() {
  // 立刻清空内存缓存,保证"存盘后马上读"不会读到旧数据(比如移动卡片到文件夹后
  // 立刻刷新列表)。后面这段只是清理磁盘上的缓存快照 + 标签缓存,不影响正确性,
  // 用防抖避免批量操作时被反复触发导致重复的全量重建。
  cachedMeta = null;
  tagsCache = null;
  if (_invalidateTimer) return;
  _invalidateTimer = setTimeout(() => {
    _invalidateTimer = null;
    initDB().then(db => {
      db.delete("blobs", "_char_meta_cache_v2_").catch(() => {});
    });
  }, 100);
}

export async function getFilteredCharacterCount(
  folderId?: string | null,
  searchQuery: string = "",
  tags: string[] = []
): Promise<number> {
  let allMeta = await getCachedMeta();
  allMeta = allMeta.filter((c) => !c.deletedAt);

  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    allMeta = allMeta.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.tags.some((t) => t.toLowerCase().includes(query)),
    );
  }

  if (tags.length > 0) {
    allMeta = allMeta.filter((c) => tags.every((t) => c.tags.includes(t)));
  }

  if (folderId === "favorites") {
    allMeta = allMeta.filter((c) => c.isFavorite);
  } else if (folderId === null) {
    if (!searchQuery && tags.length === 0) {
      allMeta = allMeta.filter((c) => !c.folderId);
    }
  } else if (folderId && folderId !== "all") {
    allMeta = allMeta.filter((c) => c.folderId === folderId);
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
  limit?: number
): Promise<{ characters: CharacterCard[]; total: number }> {
  const db = await initDB();

  let allMeta = await getCachedMeta();
  allMeta = allMeta.filter((c) => !c.deletedAt);

  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    allMeta = allMeta.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.tags.some((t) => t.toLowerCase().includes(query)),
    );
  }

  if (tags.length > 0) {
    allMeta = allMeta.filter((c) => tags.every((t) => c.tags.includes(t)));
  }

  if (folderId === "favorites") {
    allMeta = allMeta.filter((c) => c.isFavorite);
  } else if (folderId === null) {
    if (!searchQuery && tags.length === 0) {
      allMeta = allMeta.filter((c) => !c.folderId);
    }
  } else if (folderId && folderId !== "all") {
    allMeta = allMeta.filter((c) => c.folderId === folderId);
  }

  // Apply sorting
  allMeta.sort((a, b) => {
    switch (sortBy) {
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
  });

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
    const fetchTx = db.transaction("characters", "readonly");
    const fetchStore = fetchTx.store;

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
        const fullChar = await fetchStore.get(meta.id);
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
  const fetchTx = db.transaction("characters", "readonly");
  const fetchStore = fetchTx.store;
  const characters: CharacterCard[] = [];

  for (const meta of paginatedMeta) {
    const fullChar = await fetchStore.get(meta.id);
    if (fullChar && !fullChar.deletedAt) {
      delete (fullChar as any)._isExplicitAvatarUpdate;
      delete (fullChar as any)._oldFolderId;
      delete (fullChar as any)._wasDeleted;
      delete (fullChar as any)._previousFilePath;
      characters.push(fullChar);
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

export async function getAllCharacters(includeBlobs = true): Promise<CharacterCard[]> {
  const db = await initDB();
  const all = await db.getAll('characters');
  const valid = all.filter((c) => !c.deletedAt);
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

/**
 * 拿一张小缩略图用来在列表/卡片上显示, 而不是整张原图——参考卡库的做法。
 * 有缓存好的缩略图就直接用; 没有的话(老角色卡, 之前存的时候还没有这个机制)
 * 第一次显示时才现场从原图生成一次, 存回数据库, 下次就不用再生成了。
 * 生成失败(比如没有头像)就返回 null, 调用方自己退回到占位图。
 */
export async function getCharacterThumb(id: string): Promise<Blob | null> {
  const db = await initDB();
  const blobs = await db.get("blobs", id);
  if (blobs?.thumbBlob && (blobs as any).thumbVersion === 3) {
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
      } catch (e) {}
    }
  }
  if (!avatarBlob) {
    // 若原图也没有, 但有旧缩略图则暂用旧缩略图
    return blobs?.thumbBlob || null;
  }

  const { generateThumbnail } = await import("./avatar");
  let thumb: Blob;
  try {
    thumb = await generateThumbnail(avatarBlob, 800, 0.90);
  } catch {
    return blobs?.thumbBlob || null;
  }

  // 存回去(带上 thumbVersion: 3 标记), 下次直接读高清缓存, 不用重新生成
  try {
    const tx = db.transaction("blobs", "readwrite");
    const store = tx.objectStore("blobs");
    const current = (await store.get(id)) || {};
    await store.put({ ...current, thumbBlob: thumb, thumbVersion: 3 } as any, id);
    await tx.done;
  } catch (e) {
    console.warn("Failed to persist generated HD thumbnail:", e);
  }
  return thumb;
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
  invalidateCache();
  return saveCharacters([character]);
}

export async function saveCharacters(
  characters: CharacterCard[],
  cleanupAndroidPaths?: string[],
  onAndroidSyncProgress?: (current: number, total: number) => void,
): Promise<void> {
  if (characters.length === 0) return;
  const db = await initDB();

  // Track changes for Android fast move
  const charsNeedMove: CharacterCard[] = [];

  // 1) Compute final blobs using a readonly transaction
  const allFinalBlobs = new Map<string, any>();
  const tx1 = db.transaction(["characters", "blobs"], "readonly");
  const charStore1 = tx1.objectStore("characters");
  const blobStore1 = tx1.objectStore("blobs");
  let needsOrphanLink = false;

  for (const character of characters) {
    const existing = await charStore1.get(character.id);
    let dataChanged = false;
    if (existing) {
      if (JSON.stringify(existing.data) !== JSON.stringify(character.data)) {
        dataChanged = true;
      }
      if (!(character as any)._skipTouchUpdatedAt) {
        character.updatedAt = Date.now();
      }
      needsOrphanLink =
        needsOrphanLink || existing.name !== character.name || dataChanged;

      // Check if name or folder changed
      if (
        existing.name !== character.name ||
        existing.folderId !== character.folderId ||
        (existing.deletedAt ? true : false) !==
          (character.deletedAt ? true : false)
      ) {
        (character as any)._oldFolderId = existing.folderId;
        (character as any)._wasDeleted = !!existing.deletedAt;
        charsNeedMove.push(character);
      }

      if (existing.localFilePath && !character.localFilePath) {
        (character as any)._previousFilePath = existing.localFilePath;
      }
    } else {
      // New characters might also need to be placed properly
      charsNeedMove.push(character);
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

    if (character.localFilePath) {
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
        // 头像没变(这个分支的 avatarBlob 就是延用 existingBlobs 的), 缩略图缓存跟着延续
        thumbBlob: existingBlobs?.thumbBlob,
      };
    } else if (existing?.hasBlobsSeparated) {
      const existingBlobs = await blobStore1.get(character.id);
      if (existingBlobs) {
        if (
          character.avatarBlob !== undefined &&
          character.avatarBlob !== existingBlobs.avatarBlob
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
        // 头像真的换了就不带旧缩略图过去, 下次显示时会自动重新懒生成;
        // 没换的话延续原来缓存的缩略图, 不用重新生成
        finalBlobs.thumbBlob = (character as any)._isExplicitAvatarUpdate
          ? undefined
          : existingBlobs.thumbBlob;
      }
    } else {
      if (character.avatarBlob !== undefined) {
        (character as any)._isExplicitAvatarUpdate = true;
      }
    }
    
    if (dataChanged || (character as any)._isExplicitAvatarUpdate || !character.localFilePath) {
      (character as any)._needsFullAndroidSync = true;
    }

    allFinalBlobs.set(character.id, finalBlobs);
  }
  await tx1.done;

  // 2) Write to IndexedDB using a new transaction
  const tx2 = db.transaction(["characters", "blobs", "char_meta"], "readwrite");
  const charStore2 = tx2.objectStore("characters");
  const blobStore2 = tx2.objectStore("blobs");
  const charMetaStore2 = tx2.objectStore("char_meta");

  for (const character of characters) {
    if ((character.tokenCount === undefined || character.permanentTokens === undefined) && character.data) {
      try {
        const breakdown = getCharacterTokenBreakdown(character.data);
        character.tokenCount = breakdown.totalTokens;
        character.permanentTokens = breakdown.permanentTokens;
      } catch {}
    }

    const finalBlobs = allFinalBlobs.get(character.id);
    await blobStore2.put(finalBlobs, character.id);

    const charToSave = { ...character, hasBlobsSeparated: true };
    delete charToSave.avatarBlob;
    delete charToSave.originalFile;
    delete charToSave.avatarHistory;
    delete (charToSave as any)._isExplicitAvatarUpdate;
    delete (charToSave as any)._oldFolderId;
    delete (charToSave as any)._wasDeleted;
    delete (charToSave as any)._previousFilePath;
    delete (charToSave as any)._skipTouchUpdatedAt;

    await charStore2.put(charToSave);
    await charMetaStore2.put(buildCharMeta(charToSave));
  }

  await tx2.done;
  invalidateCache();

  for (const character of characters) {
    if ((character as any)._isExplicitAvatarUpdate) {
      import("./thumbCache").then(({ evictCharacterThumb }) => {
        evictCharacterThumb(character.id);
      }).catch(() => {});
    }
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("charactersUpdated"));
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

  // 3) Sync mapped files to Android (Async without transaction bounds)
  if (ENABLE_ANDROID_FILE_SYNC && isAndroid()) {
    try {
      const { syncCharacterToAndroid, fastMoveCharacterOnAndroid } =
        await import("./androidSync");
      const dbRef = await initDB();

      const syncTask = enqueueAndroidSync(async () => {
        // 3.1) Move/Rename files if needed
      for (let i = 0; i < charsNeedMove.length; i++) {
        const char = charsNeedMove[i];
        const newPaths = await fastMoveCharacterOnAndroid(char);
        if (newPaths && newPaths.length > 0) {
          const freshChar = await dbRef.get("characters", char.id);
          if (freshChar) {
            if (newPaths[0].match(/\.(png|jpe?g|webp|gif|bmp)$/i)) {
              freshChar.localFilePath = newPaths[0];
            } else {
              delete freshChar.localFilePath;
              (freshChar as any)._androidSyncPath = newPaths[0];
            }
            await dbRef.put("characters", freshChar);
            char.localFilePath = freshChar.localFilePath; // update ref for next steps
          }
        }
        await new Promise((r) => setTimeout(r, 20)); // throttle
      }

      // 3.2) Sync full content to Android
      for (let i = 0; i < characters.length; i++) {
        const character = characters[i];
        if (!(character as any)._needsFullAndroidSync && character.localFilePath) {
           onAndroidSyncProgress?.(i + 1, characters.length);
           continue;
        }
        const finalBlobs = allFinalBlobs.get(character.id);
        const syncPaths = await syncCharacterToAndroid(character, finalBlobs);
        if (syncPaths && syncPaths.length > 0) {
          const freshChar = await dbRef.get("characters", character.id);
          if (freshChar) {
            if (syncPaths[0].match(/\.(png|jpe?g|webp|gif|bmp)$/i)) {
              freshChar.localFilePath = syncPaths[0];
            } else {
              delete freshChar.localFilePath;
              (freshChar as any)._androidSyncPath = syncPaths[0];
            }
            await dbRef.put("characters", freshChar);
            character.localFilePath = freshChar.localFilePath;
          }
        }
        onAndroidSyncProgress?.(i + 1, characters.length);
        await new Promise((r) => setTimeout(r, 0));
      }
      if (cleanupAndroidPaths && cleanupAndroidPaths.length > 0) {
        const { deleteLocalGalleryFile } = await import("./appBridge");
        for (const p of cleanupAndroidPaths) {
          await deleteLocalGalleryFile(p);
        }
      }
      });
      // 只有调用方传入了进度回调(比如导入流程)才等这个后台任务跑完 ——
      // 这种场景下调用方会在进度跑完后才收尾(隐藏加载动画/关闭弹窗),
      // 如果不等,进度回调会在调用方已经"收尾"之后才姗姗来迟地触发,
      // 导致界面卡在一个已经清空又被重新点亮的进度状态里出不来。
      // 没传回调的场景(比如拖动卡片到文件夹)不需要等待,保持原来的"后台跑、界面不卡"。
      if (onAndroidSyncProgress) {
        await syncTask;
      }
    } catch (err) {
      console.error("Failed to sync to android gallery", err);
    }
  }
  invalidateCache();
}

export async function updateCharacterCover(
  id: string,
  avatarBlob: Blob,
): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(["characters", "blobs", "char_meta"], "readwrite");
  const charStore = tx.objectStore("characters");
  const blobStore = tx.objectStore("blobs");
  const charMetaStore = tx.objectStore("char_meta");

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

  for (const id of ids) {
    const char = await db.get("characters", id);
    if (!char) continue;
    if (char.deletedAt) {
      toHardDelete.push(char);
    } else {
      char.deletedAt = Date.now();
      toSoftDelete.push(char);
    }
  }

  let totalProcessed = 0;
  const totalItems = toSoftDelete.length + toHardDelete.length;

  // Soft Delete Transaction
  // 批量写进同一个事务, 不在循环里逐个 await(参考卡库的写法), 减少不必要的等待
  if (toSoftDelete.length > 0) {
    const tx = db.transaction(["characters", "char_meta"], "readwrite");
    for (const char of toSoftDelete) {
      tx.objectStore("characters").put(char);
      tx.objectStore("char_meta").put(buildCharMeta(char));
    }
    await tx.done;

    if (ENABLE_ANDROID_FILE_SYNC && isAndroid()) {
      try {
        const { batchFastMoveCharactersOnAndroid, syncCharacterToAndroid } =
          await import("./androidSync");
        const dbRef = await initDB();
        await enqueueAndroidSync(async () => {
          // 先批量算好这一批角色分别要挪到哪, 一次性调用原生接口(而不是
          // 一个个调), 大幅减少批量删除/移到回收站时的跨桥调用次数。
          const movedPaths = await batchFastMoveCharactersOnAndroid(toSoftDelete);

          const needsFallback: CharacterCard[] = [];
          const pathUpdates: { id: string; path: string }[] = [];
          for (const char of toSoftDelete) {
            const newPath = movedPaths.get(char.id);
            if (newPath) {
              pathUpdates.push({ id: char.id, path: newPath });
            } else {
              needsFallback.push(char);
            }
          }

          // 批量移动成功的这些, 路径更新也批量写进同一个事务
          if (pathUpdates.length > 0) {
            const tx = dbRef.transaction("characters", "readwrite");
            for (const { id, path } of pathUpdates) {
              const freshChar = await tx.store.get(id);
              if (freshChar) {
                if (path.match(/\.(png|jpe?g|webp|gif|bmp)$/i)) {
                  freshChar.localFilePath = path;
                } else {
                  delete freshChar.localFilePath;
                  (freshChar as any)._androidSyncPath = path;
                }
                tx.store.put(freshChar);
              }
            }
            await tx.done;
          }
          totalProcessed += pathUpdates.length;
          onProgress?.(totalProcessed, totalItems, "移动角色到回收站...");

          // 批量移动失败/没有可用路径的少数(通常是老数据、路径不完整),
          // 退回原来的逐个完整同步兜底, 保证数据最终是对的
          for (const char of needsFallback) {
            const freshChar = await dbRef.get("characters", char.id);
            if (freshChar) {
              const blobs = await dbRef.get("blobs", char.id);
              const syncPaths = await syncCharacterToAndroid(char, blobs || null);
              if (syncPaths && syncPaths.length > 0) {
                if (syncPaths[0].match(/\.(png|jpe?g|webp|gif|bmp)$/i)) {
                  freshChar.localFilePath = syncPaths[0];
                } else {
                  delete freshChar.localFilePath;
                  (freshChar as any)._androidSyncPath = syncPaths[0];
                }
                await dbRef.put("characters", freshChar);
              }
            }
            totalProcessed++;
            onProgress?.(totalProcessed, totalItems, "移动角色到回收站...");
          }
        });
      } catch (e) {}
    } else {
      totalProcessed += toSoftDelete.length;
      onProgress?.(totalProcessed, totalItems, "移动角色到回收站...");
    }
  }

  // Hard Delete Logic
  // 参考卡库的批量删除做法: 安卓那边的文件清理只查一次全部角色、只调一次批量
  // 原生接口(而不是删一个查一次全表 + 调一次桥接), 数据库这边也只开一个事务
  // 批量删完, 而不是每删一个就单独开一个事务。这几处叠加起来是"删几百上千张卡
  // 会很烫"的主要原因, 批量之后开销不再随删除数量线性(甚至平方级)增长。
  if (toHardDelete.length > 0) {
    if (ENABLE_ANDROID_FILE_SYNC && isAndroid()) {
      try {
        const { batchCleanupAndroidFiles } = await import("./androidSync");
        await enqueueAndroidSync(async () => {
          await batchCleanupAndroidFiles(toHardDelete);
        });
      } catch (e) {}
    }

    const tx = db.transaction(["characters", "blobs", "char_meta"], "readwrite");
    const charStore = tx.objectStore("characters");
    const blobStore = tx.objectStore("blobs");
    const charMetaStore = tx.objectStore("char_meta");
    for (const char of toHardDelete) {
      charStore.delete(char.id);
      blobStore.delete(char.id);
      charMetaStore.delete(char.id);
    }
    await tx.done;
    totalProcessed += toHardDelete.length;
    onProgress?.(totalProcessed, totalItems, "彻底删除角色...");
  }
  invalidateCache();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("charactersUpdated"));
  }
}

export async function deleteCharacter(id: string): Promise<void> {
  invalidateCache();
  const db = await initDB();
  const char = await db.get("characters", id);
  if (!char) {
    // If character store record doesn't exist, purge any dangling meta/blobs for this ID
    const tx = db.transaction(["char_meta", "blobs"], "readwrite");
    await tx.objectStore("char_meta").delete(id);
    await tx.objectStore("blobs").delete(id);
    await tx.done;
    return;
  }

  if (char.deletedAt) {
      // Hard delete if already in trash
      if (ENABLE_ANDROID_FILE_SYNC && isAndroid()) {
        const { deleteCharacterFromAndroid } = await import("./androidSync");
        enqueueAndroidSync(async () => {
           await deleteCharacterFromAndroid(char);
           const tx = db.transaction(["characters", "blobs", "char_meta"], "readwrite");
           await tx.objectStore("characters").delete(id);
           await tx.objectStore("blobs").delete(id);
           await tx.objectStore("char_meta").delete(id);
           await tx.done;
        }).catch(() => {});
      } else {
        const tx = db.transaction(["characters", "blobs", "char_meta"], "readwrite");
        await tx.objectStore("characters").delete(id);
        await tx.objectStore("blobs").delete(id);
        await tx.objectStore("char_meta").delete(id);
        await tx.done;
      }
    } else {
      // Soft delete
      char.deletedAt = Date.now();
      await db.put("characters", char);
      await db.put("char_meta", buildCharMeta(char));

      if (ENABLE_ANDROID_FILE_SYNC && isAndroid()) {
        const { fastMoveCharacterOnAndroid, syncCharacterToAndroid } =
          await import("./androidSync");
        const dbRef = await initDB();
        enqueueAndroidSync(async () => {
          const fastPaths = await fastMoveCharacterOnAndroid(char);
          const freshChar = await dbRef.get("characters", id);
          if (freshChar) {
            if (fastPaths && fastPaths.length > 0) {
              if (fastPaths[0].match(/\.(png|jpe?g|webp|gif|bmp)$/i)) {
                freshChar.localFilePath = fastPaths[0];
              } else {
                delete freshChar.localFilePath;
                (freshChar as any)._androidSyncPath = fastPaths[0];
              }
              await dbRef.put("characters", freshChar);
            } else {
              const blobs = await dbRef.get("blobs", id);
              const syncPaths = await syncCharacterToAndroid(char, blobs || null);
              if (syncPaths && syncPaths.length > 0) {
                if (syncPaths[0].match(/\.(png|jpe?g|webp|gif|bmp)$/i)) {
                  freshChar.localFilePath = syncPaths[0];
                } else {
                  delete freshChar.localFilePath;
                  (freshChar as any)._androidSyncPath = syncPaths[0];
                }
                await dbRef.put("characters", freshChar);
              }
            }
          }
        }).catch(() => {});
      }
    }
  invalidateCache();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("charactersUpdated"));
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
    await db.put("char_meta", buildCharMeta(char));

    if (ENABLE_ANDROID_FILE_SYNC && isAndroid()) {
      import("./androidSync").then(
        async ({ fastMoveCharacterOnAndroid, syncCharacterToAndroid }) => {
          try {
            const dbRef = await initDB();
            const fastPaths = await fastMoveCharacterOnAndroid(char);
            if (fastPaths && fastPaths.length > 0) {
              if (fastPaths[0].match(/\.(png|jpe?g|webp|gif|bmp)$/i)) {
                char.localFilePath = fastPaths[0];
              } else {
                delete char.localFilePath;
                (char as any)._androidSyncPath = fastPaths[0];
              }
              await dbRef.put("characters", char);
            } else {
              const blobs = await dbRef.get("blobs", id);
              const syncPaths = await syncCharacterToAndroid(
                char,
                blobs || null,
              );
              if (syncPaths && syncPaths.length > 0) {
                if (syncPaths[0].match(/\.(png|jpe?g|webp|gif|bmp)$/i)) {
                  char.localFilePath = syncPaths[0];
                } else {
                  delete char.localFilePath;
                  (char as any)._androidSyncPath = syncPaths[0];
                }
                await dbRef.put("characters", char);
              }
            }
          } catch (e) {}
        },
      );
    }
  }
  invalidateCache();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("charactersUpdated"));
  }
}

export async function getTrashedCharacters(
  includeBlobs: boolean = false,
): Promise<CharacterCard[]> {
  const db = await initDB();
  const trashed: CharacterCard[] = [];
  const tx = db.transaction("characters", "readonly");
  const store = tx.store;
  let cursor = await store.openCursor();

  while (cursor) {
    const char = cursor.value;
    if (char.deletedAt) {
      trashed.push(char);
    }
    cursor = await cursor.continue();
  }

  trashed.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));

  if (includeBlobs) {
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
  }
  return trashed;
}

export async function emptyTrash(): Promise<void> {
  const db = await initDB();
  const tx1 = db.transaction("characters", "readonly");
  const store = tx1.store;
  let cursor = await store.openCursor();

  const toDelete: string[] = [];
  while (cursor) {
    const char = cursor.value;
    if (char.deletedAt) {
      toDelete.push(char.id);
    }
    cursor = await cursor.continue();
  }
  await tx1.done;

  // 直接复用 deleteCharactersBulk 的批量硬删除逻辑(只查一次全部角色、
  // 只调一次原生批量接口、数据库一个事务删完), 不再自己另起一套
  // "一个个删、每个之间还睡50ms"的循环。
  await deleteCharactersBulk(toDelete);
}

export async function cleanupOldTrash(): Promise<void> {
  invalidateCache();
  const db = await initDB();
  const tx1 = db.transaction("characters", "readonly");
  const store = tx1.store;
  let cursor = await store.openCursor();

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const toDelete: CharacterCard[] = [];
  while (cursor) {
    const char = cursor.value;
    if (char.deletedAt && now - char.deletedAt > SEVEN_DAYS_MS) {
      toDelete.push(char);
    }
    cursor = await cursor.continue();
  }
  await tx1.done;

  if (ENABLE_ANDROID_FILE_SYNC && isAndroid()) {
    try {
      const { deleteCharacterFromAndroid } = await import("./androidSync");
      for (const char of toDelete) {
        await deleteCharacterFromAndroid(char);
        await new Promise((r) => setTimeout(r, 50));
      }
    } catch (e) {
      console.error("Failed to async clean up old trash on Android", e);
    }
  }

  const tx2 = db.transaction(["characters", "blobs", "char_meta"], "readwrite");
  const store2 = tx2.objectStore("characters");
  const blobStore = tx2.objectStore("blobs");
  const charMetaStore2 = tx2.objectStore("char_meta");
  for (const char of toDelete) {
    await store2.delete(char.id);
    await blobStore.delete(char.id);
    await charMetaStore2.delete(char.id);
  }
  await tx2.done;
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

export async function findDuplicates(): Promise<DuplicateGroup[]> {
  const db = await initDB();

  const tx = db.transaction("characters", "readonly");
  const store = tx.store;
  const allChars = await store.getAll();
  await tx.done;

  // 加载文件夹映射，确保能准确识别位于特定工具文件夹中的卡片类型
  const foldersTx = db.transaction("folders", "readonly");
  const allFolders = await foldersTx.store.getAll();
  await foldersTx.done;
  const foldersMap = new Map<string, string>();
  for (const f of allFolders) {
    foldersMap.set(f.id, f.name);
  }

  const precomputed: any[] = [];
  const charMap = new Map<string, CharacterCard>();

  const GENERIC_NAMES = new Set([
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

  for (const char of allChars) {
    if (!char.deletedAt) {
      charMap.set(char.id, char);
      const resType = getResourceType(char, foldersMap);
      const data = char.data?.data || char.data || {};
      const firstMes = data.first_mes || "";
      const desc = data.description || "";
      const rawName = (char.name || data.name || "").trim();
      const baseName = normalizeCardBaseName(rawName).toLowerCase();
      const isGenericName = GENERIC_NAMES.has(baseName);

      // Support presets, worldbooks, and other tool types content matching
      let extraContent = "";
      if (data.prompts && Array.isArray(data.prompts)) {
        extraContent = data.prompts.map((p: any) => p.content || p.text || "").join("");
      } else if (data.entries && (Array.isArray(data.entries) || typeof data.entries === 'object')) {
        const entVals = Array.isArray(data.entries) ? data.entries : Object.values(data.entries);
        extraContent = entVals.map((e: any) => e.content || e.text || e.comment || "").join("");
      } else if (data.qrList && Array.isArray(data.qrList)) {
        extraContent = data.qrList.map((q: any) => q.message || q.label || "").join("");
      } else if (data.content && typeof data.content === "string") {
        extraContent = data.content;
      }

      const descClean = (desc + extraContent).replace(/\s+/g, "");
      const firstClean = firstMes.replace(/\s+/g, "");

      precomputed.push({
        id: char.id,
        resType,
        rawName,
        baseName,
        isGenericName,
        descClean,
        firstClean,
        bothEmpty: !descClean && !firstClean,
      });
    }
  }

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

    if (item.descClean && item.firstClean && (item.descClean.length > 20 || item.firstClean.length > 20)) {
      const key = `${item.resType}:::${item.descClean}|${item.firstClean}`;
      const list = contentMap.get(key) || [];
      list.push(item.id);
      contentMap.set(key, list);
    }

    if (item.baseName && item.descClean) {
      const key = `${item.resType}:::${item.baseName}|${item.descClean}`;
      const list = nameDescMap.get(key) || [];
      list.push(item.id);
      nameDescMap.set(key, list);
    }

    if (item.baseName && item.firstClean) {
      const key = `${item.resType}:::${item.baseName}|${item.firstClean}`;
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
      const char = charMap.get(id);
      if (!char) continue;
      const type = getResourceType(char, foldersMap);
      const list = byType.get(type) || [];
      list.push(id);
      byType.set(type, list);
    }
    for (const [_, typedIds] of byType.entries()) {
      if (typedIds.length > 1) {
        strictlySeparatedGroups.push(typedIds);
      }
    }
  }

  const finalGroups: DuplicateGroup[] = [];

  for (const groupIds of strictlySeparatedGroups) {
    const groupChars: CharacterCard[] = [];
    for (const id of groupIds) {
      const char = charMap.get(id);
      if (char) groupChars.push(char);
    }

    if (groupChars.length === 0) continue;

    await Promise.all(
      groupChars.map(async (char) => {
        if (char.hasBlobsSeparated) {
          const blobs = await db.get("blobs", char.id);
          if (blobs) {
            char.avatarBlob = blobs.avatarBlob;
            char.originalFile = blobs.originalFile;
            char.avatarHistory = blobs.avatarHistory;
          }
        }
      }),
    );

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
  const tx1 = db.transaction("chats", "readonly");
  const oldChat = await tx1.store.get(chat.id);
  await tx1.done;

  const tx = db.transaction(["chats", "chat_metadata"], "readwrite");
  await tx.objectStore("chats").put(chat);
  await tx.objectStore("chat_metadata").put(computeChatMetadata(chat));
  await tx.done;

  if (ENABLE_ANDROID_FILE_SYNC && isAndroid()) {
    try {
      const { syncChatToAndroid, deleteChatFromAndroid } =
        await import("./androidSync");
      if (
        oldChat &&
        (oldChat.characterId !== chat.characterId || oldChat.name !== chat.name)
      ) {
        await deleteChatFromAndroid(oldChat);
      }
      await syncChatToAndroid(chat);
    } catch (e) {}
  }
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

  if (ENABLE_ANDROID_FILE_SYNC && isAndroid()) {
    try {
      const { syncChatToAndroid, syncCharacterToAndroid } =
        await import("./androidSync");
      const charIdsSynced = new Set<string>();

      for (let i = 0; i < finalChatsToSave.length; i++) {
        const chat = finalChatsToSave[i];
        if (chat.characterId && !charIdsSynced.has(chat.characterId)) {
          charIdsSynced.add(chat.characterId);
          const char = await getCharacter(chat.characterId);
          if (char) {
            const blobs = await db.get("blobs", char.id);
            const syncPaths = await syncCharacterToAndroid(char, blobs || null);
            if (
              syncPaths &&
              syncPaths.length > 0 &&
              syncPaths[0] !== char.localFilePath
            ) {
              char.localFilePath = syncPaths[0];
              await db.put("characters", char);
            }
          }
        }
        await syncChatToAndroid(chat, true); // Pass skipCharacterSync=true
        await new Promise((r) => setTimeout(r, 50));
      }
    } catch (e) {
      console.error("Android chat sync bulk failed", e);
    }
  }
  invalidateCache();
}

export async function deleteChat(id: string): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(["chats", "chat_metadata"], "readwrite");
  const chat = await tx.objectStore("chats").get(id);
  await tx.objectStore("chats").delete(id);
  await tx.objectStore("chat_metadata").delete(id);
  await tx.done;

  if (ENABLE_ANDROID_FILE_SYNC && isAndroid() && chat) {
    try {
      const { deleteChatFromAndroid } = await import("./androidSync");
      await deleteChatFromAndroid(chat);
    } catch (e) {
      console.error("Failed to delete chat file on Android", e);
    }
  }
}

export async function deleteChatsBulk(
  ids: string[],
  onProgress?: (current: number, total: number, message: string) => void,
): Promise<void> {
  const db = await initDB();
  const tx = db.transaction(["chats", "chat_metadata"], "readwrite");
  const chatStore = tx.objectStore("chats");
  const metaStore = tx.objectStore("chat_metadata");

  const chatsToDelete = [];

  for (const id of ids) {
    const chat = await chatStore.get(id);
    if (chat) chatsToDelete.push(chat);
    chatStore.delete(id);
    metaStore.delete(id);
  }
  await tx.done;

  if (ENABLE_ANDROID_FILE_SYNC && isAndroid() && chatsToDelete.length > 0) {
    try {
      const { deleteChatFromAndroid } = await import("./androidSync");
      for (let i = 0; i < chatsToDelete.length; i++) {
        const chat = chatsToDelete[i];
        await deleteChatFromAndroid(chat);
        onProgress?.(i + 1, chatsToDelete.length, "清理本地聊天记录...");
        // Small delay to prevent JSI congestion
        await new Promise((r) => setTimeout(r, 5));
      }
    } catch (e) {
      console.error("Failed to async delete chat files on Android", e);
    }
  } else if (chatsToDelete.length > 0) {
    onProgress?.(chatsToDelete.length, chatsToDelete.length, "清理聊天记录...");
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
}

export async function deleteMemo(id: string): Promise<void> {
  const db = await initDB();
  await db.delete("memos", id);
}
