import { getFallbackAvatar, resolveAvatarUrl } from "./avatar";
import { openDB, DBSchema, IDBPDatabase } from "idb";
import { getLocalImageUrl, isAndroid } from "./appBridge";
import { sanitizeChatMessages } from "./chatParse";

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

export function getSafeFilename(name: string): string {
  if (!name) return "Unknown";
  return name.replace(/[\\/:\*\?"<>\|]/g, "_").trim();
}

export function getCharacterCategoryPrefix(char: any): string {
  const rawData = char?.data?.data || char?.data || char || {};
  const outer = char?.data || char || {};

  // Real character cards are not tool categories
  if (isActualCharacterCard(rawData) || isActualCharacterCard(outer)) {
    return "未归类";
  }

  // 1. Quick Reply
  if (
    Array.isArray(rawData) ||
    Array.isArray(outer) ||
    Array.isArray(rawData.qrList) ||
    Array.isArray(outer.qrList) ||
    Array.isArray(rawData.quick_replies) ||
    Array.isArray(outer.quick_replies) ||
    Array.isArray(rawData.tavern_qr_sets) ||
    Array.isArray(outer.tavern_qr_sets) ||
    rawData.qrList !== undefined ||
    outer.qrList !== undefined ||
    rawData.quick_replies !== undefined ||
    outer.quick_replies !== undefined
  ) {
    return "快速回复";
  }

  // 2. Theme / Beautify
  if (
    rawData.blur_strength !== undefined ||
    outer.blur_strength !== undefined ||
    rawData.main_text_color !== undefined ||
    outer.main_text_color !== undefined ||
    rawData.chat_display !== undefined ||
    outer.chat_display !== undefined
  ) {
    return "美化";
  }

  // 3. Preset
  if (
    Array.isArray(rawData.prompts) ||
    Array.isArray(outer.prompts) ||
    Array.isArray(rawData.prompt_order) ||
    Array.isArray(outer.prompt_order) ||
    rawData.temperature !== undefined ||
    outer.temperature !== undefined ||
    rawData.top_p !== undefined ||
    outer.top_p !== undefined ||
    rawData.top_k !== undefined ||
    outer.top_k !== undefined ||
    rawData.min_p !== undefined ||
    outer.min_p !== undefined ||
    rawData.repetition_penalty !== undefined ||
    outer.repetition_penalty !== undefined ||
    rawData.openai_max_context !== undefined ||
    outer.openai_max_context !== undefined ||
    rawData.openai_max_tokens !== undefined ||
    outer.openai_max_tokens !== undefined ||
    rawData.max_context_length !== undefined ||
    outer.max_context_length !== undefined ||
    rawData.preset_type !== undefined ||
    outer.preset_type !== undefined ||
    rawData.prompts !== undefined ||
    outer.prompts !== undefined ||
    rawData.system_prompt !== undefined ||
    outer.system_prompt !== undefined
  ) {
    return "预设";
  }

  // 4. Worldbook
  if (
    rawData.entries !== undefined ||
    outer.entries !== undefined ||
    rawData.data?.entries !== undefined ||
    outer.data?.entries !== undefined
  ) {
    return "世界书";
  }

  // 5. Script / Tool / Regex
  if (
    rawData.run !== undefined ||
    outer.run !== undefined ||
    rawData.type === "tool" ||
    outer.type === "tool" ||
    rawData.type === "script" ||
    outer.type === "script" ||
    (rawData.extensions && Array.isArray(rawData.extensions.regex_scripts)) ||
    (outer.extensions && Array.isArray(outer.extensions.regex_scripts))
  ) {
    return "脚本";
  }

  return "未归类";
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

export interface CharacterCard {
  id: string;
  name: string;
  autoImportFilename?: string;
  avatarBlob?: Blob;
  localFilePath?: string;
  avatarUrlFallback?: string;
  avatarHistory?: Blob[];
  data: any;
  originalFile?: File;
  createdAt: number;
  updatedAt?: number;
  deletedAt?: number;
  folderId?: string;
  hasBlobsSeparated?: boolean;
  sortOrder?: number;
  tags?: string[];
  isTool?: boolean;
}

export interface ChatLog {
  id: string;
  characterId: string;
  name: string;
  messages: any[];
  createdAt: number;
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

export function isActualCharacterCard(rawData: any): boolean {
  if (!rawData) return false;
  if (Array.isArray(rawData)) return false;

  const outer = rawData;
  const target =
    outer.data && typeof outer.data === 'object' && !Array.isArray(outer.data)
      ? outer.data
      : outer;

  // 1. Explicit V2/V3 spec character card
  if (
    outer.spec === "chara_card_v2" ||
    outer.spec === "chara_card_v3" ||
    target.spec === "chara_card_v2" ||
    target.spec === "chara_card_v3"
  ) {
    return true;
  }

  // 2. Character-specific fields (personality, first_mes, mes_example)
  if (
    (typeof target.first_mes === 'string' && target.first_mes.trim().length > 0) ||
    (typeof target.personality === 'string' && target.personality.trim().length > 0) ||
    (typeof target.mes_example === 'string' && target.mes_example.trim().length > 0)
  ) {
    return true;
  }

  // 3. Check for Quick Reply (QR) signatures -> NOT a character card
  if (
    Array.isArray(outer.qrList) ||
    Array.isArray(target.qrList) ||
    Array.isArray(outer.quick_replies) ||
    Array.isArray(target.quick_replies) ||
    Array.isArray(outer.tavern_qr_sets) ||
    Array.isArray(target.tavern_qr_sets) ||
    outer.qrList !== undefined ||
    target.qrList !== undefined ||
    outer.quick_replies !== undefined ||
    target.quick_replies !== undefined
  ) {
    return false;
  }

  // 4. Check for Preset signatures -> NOT a character card
  if (
    Array.isArray(outer.prompts) ||
    Array.isArray(target.prompts) ||
    Array.isArray(outer.prompt_order) ||
    Array.isArray(target.prompt_order) ||
    outer.temperature !== undefined ||
    target.temperature !== undefined ||
    outer.top_p !== undefined ||
    target.top_p !== undefined ||
    outer.top_k !== undefined ||
    target.top_k !== undefined ||
    outer.min_p !== undefined ||
    target.min_p !== undefined ||
    outer.repetition_penalty !== undefined ||
    target.repetition_penalty !== undefined ||
    outer.openai_max_context !== undefined ||
    target.openai_max_context !== undefined ||
    outer.openai_max_tokens !== undefined ||
    target.openai_max_tokens !== undefined ||
    outer.max_context_length !== undefined ||
    target.max_context_length !== undefined ||
    outer.preset_type !== undefined ||
    target.preset_type !== undefined
  ) {
    return false;
  }

  // 5. Check for Worldbook / Lorebook signatures -> NOT a character card
  if (
    outer.entries !== undefined ||
    target.entries !== undefined ||
    (outer.data && outer.data.entries !== undefined)
  ) {
    return false;
  }

  // 6. Check for Theme / Beautify signatures -> NOT a character card
  if (
    outer.blur_strength !== undefined ||
    target.blur_strength !== undefined ||
    outer.main_text_color !== undefined ||
    target.main_text_color !== undefined ||
    outer.chat_display !== undefined ||
    target.chat_display !== undefined
  ) {
    return false;
  }

  // 7. Check for Script / Regex signatures -> NOT a character card
  if (
    outer.run !== undefined ||
    target.run !== undefined ||
    outer.type === "script" ||
    target.type === "script" ||
    outer.type === "tool" ||
    target.type === "tool" ||
    (outer.extensions && Array.isArray(outer.extensions.regex_scripts)) ||
    (target.extensions && Array.isArray(target.extensions.regex_scripts))
  ) {
    return false;
  }

  // 8. If none of the tool signatures match, check if it has character name and description/scenario
  const charName =
    target.name ||
    target.char_name ||
    target.character_name ||
    target.data?.name ||
    (typeof outer.name === 'string' ? outer.name : undefined);

  const hasCharacterContent =
    target.description !== undefined ||
    target.scenario !== undefined ||
    Array.isArray(target.tags);

  if (charName && hasCharacterContent) {
    return true;
  }

  return !!charName;
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
  const rawFolders = await db.getAllFromIndex("folders", "by-date");
  const folders = rawFolders.filter(f => !f.deletedAt);
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
    const f = allFolders.find((x) => x.id === folderId);
    if (f) {
      f.deletedAt = Date.now();
      await folderStore2.put(f);
    }
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

  const folderUsageCount = new Map<string, number>();
  for (const f of allFolders) folderUsageCount.set(f.id, 0);

  for (const c of allCharacters) {
    if (
      c.localFilePath &&
      (c.localFilePath.includes("回收站/") ||
        c.localFilePath.includes("回收站"))
    )
      continue; // already deleted
    if (c.deletedAt) continue;
    if (c.folderId && folderUsageCount.has(c.folderId)) {
      folderUsageCount.set(c.folderId, folderUsageCount.get(c.folderId)! + 1);
    }
  }

  let deletedAny = true;
  const foldersToDelete = new Set<string>();

  for (const f of allFolders) {
    if (f.deletedAt) continue;
    if (f.name === "回收站") {
      foldersToDelete.add(f.id);
    }
  }

  while (deletedAny) {
    deletedAny = false;
    for (const f of allFolders) {
      if (foldersToDelete.has(f.id)) continue;

      if (folderUsageCount.get(f.id)! > 0) continue;

      const hasSubfolders = allFolders.some(
        (sub) => sub.parentId === f.id && !foldersToDelete.has(sub.id),
      );
      if (hasSubfolders) continue;

      foldersToDelete.add(f.id);
      deletedAny = true;
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
          // Wait, do NOT delete the native "回收站" folder!
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
  | "a_z"
  | "z_a"
  | "custom";

export interface CharMeta {
  id: string;
  createdAt: number;
  updatedAt?: number;
  name: string;
  autoImportFilename?: string;
  sortOrder?: number;


  deletedAt?: number;
  folderId?: string;

  avatarUrlFallback?: string;
  localFilePath?: string;
  hasBlobsSeparated?: boolean;

  isQR?: boolean;
  tags?: string[];
  isTool?: boolean;
}

function buildCharMeta(val: any): CharMeta {
  let charTags = val.data?.data?.tags || val.data?.tags;
  if (!Array.isArray(charTags)) charTags = [];
  const cat = getCharacterCategoryPrefix(val);
  const isTool = cat !== "未归类";
  const isQR = cat === "快速回复";
  const fallbackAvatar = resolveAvatarUrl(val.avatarUrlFallback, val.name || val.id, cat);
  return {
    id: val.id,
    createdAt: val.createdAt,
    updatedAt: val.updatedAt,
    name: val.name || "",
    autoImportFilename: val.autoImportFilename,
    sortOrder: val.sortOrder,
    deletedAt: val.deletedAt,
    folderId: val.folderId,
    tags: charTags,
    isTool,
    isQR,
    localFilePath: val.localFilePath,
    hasBlobsSeparated: val.hasBlobsSeparated,
    avatarUrlFallback: fallbackAvatar,
  };
}

let cachedMeta: CharMeta[] | null = null;
let isBuildingCache = false;

export async function getCachedMeta(): Promise<CharMeta[]> {
  if (cachedMeta) return cachedMeta;

  if (isBuildingCache) {
    while (isBuildingCache) await new Promise((r) => setTimeout(r, 50));
    if (cachedMeta) return cachedMeta;
  }
  isBuildingCache = true;

  const db = await initDB();
  let newMeta = await db.getAll("char_meta");

  // 第一次升级/索引丢失时, 从完整角色表重建一次, 并写回轻量索引。
  // 之后所有常用入口都只读 char_meta, 不再触碰大字段 data。
  if (!newMeta || newMeta.length === 0) {
    const tx = db.transaction("characters", "readonly");
    const allChars = await tx.store.getAll();
    await tx.done;

    newMeta = allChars.map(buildCharMeta);
    if (newMeta.length > 0) {
      const putTx = db.transaction("char_meta", "readwrite");
      for (const meta of newMeta) {
        await putTx.store.put(meta);
      }
      await putTx.done;
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

export async function getCharacters(
  page: number,
  pageSize: number,
  folderId?: string | null,
  searchQuery: string = "",
  tags: string[] = [],
  sortBy: SortOption = "newest_import",
  includeBlobs: boolean = true,
  includeData: boolean = true
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

  if (folderId === null) {
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
      case "a_z":
        return a.name.localeCompare(b.name, "zh-CN");
      case "z_a":
        return b.name.localeCompare(a.name, "zh-CN");
      default:
        return b.createdAt - a.createdAt;
    }
  });

  const total = allMeta.length;
  const paginatedMeta = allMeta.slice((page - 1) * pageSize, page * pageSize);

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
          data: {} // Empty data
        } as unknown as CharacterCard);
      } else {
        // Must fetch the old bloated character to get its avatarBlob
        const fullChar = await fetchStore.get(meta.id);
        if (fullChar) {
          const strippedChar = { ...fullChar, data: {}, tags: meta.tags, isQR: meta.isQR, isTool: meta.isTool };
          delete (strippedChar as any)._isExplicitAvatarUpdate;
          delete (strippedChar as any)._oldFolderId;
          delete (strippedChar as any)._wasDeleted;
          delete (strippedChar as any)._previousFilePath;
          characters.push(strippedChar);
        } else {
          characters.push({ ...meta, data: {} } as unknown as CharacterCard);
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
    if (fullChar) {
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
  if (!blobs) return null;
  if (blobs.thumbBlob) return blobs.thumbBlob;
  if (!blobs.avatarBlob) return null;

  const { generateThumbnail } = await import("./avatar");
  let thumb: Blob;
  try {
    thumb = await generateThumbnail(blobs.avatarBlob, 200, 0.82);
  } catch {
    return null;
  }

  // 存回去, 下次直接读缓存, 不用重新生成
  try {
    const tx = db.transaction("blobs", "readwrite");
    const store = tx.objectStore("blobs");
    const current = await store.get(id);
    if (current) {
      await store.put({ ...current, thumbBlob: thumb }, id);
    }
    await tx.done;
  } catch (e) {
    console.warn("Failed to persist generated thumbnail:", e);
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
      character.updatedAt = Date.now();
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
        originalFile: undefined,
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

    await charStore2.put(charToSave);
    await charMetaStore2.put(buildCharMeta(charToSave));
  }

  await tx2.done;
  invalidateCache();

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
}

export async function deleteCharacter(id: string): Promise<void> {
  invalidateCache();
  const db = await initDB();
  const char = await db.get("characters", id);
  if (char) {
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

  const tx2 = db.transaction("folders", "readwrite");
  const fStore = tx2.store;
  let fCursor = await fStore.openCursor();
  while (fCursor) {
    if (fCursor.value.deletedAt) {
      await fCursor.delete();
    }
    fCursor = await fCursor.continue();
  }
  await tx2.done;
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
  characters: DuplicateCharacter[];
}

export async function findDuplicates(): Promise<DuplicateGroup[]> {
  const db = await initDB();

  const tx = db.transaction("characters", "readonly");
  const store = tx.store;
  const allChars = await store.getAll();
  await tx.done;

  const precomputed: any[] = [];
  const charMap = new Map<string, CharacterCard>();

  for (const char of allChars) {
    if (!char.deletedAt) {
      charMap.set(char.id, char);
      const data = char.data?.data || char.data || {};
      const firstMes = data.first_mes || "";
      const desc = data.description || "";
      const name = (char.name || data.name || "").trim().toLowerCase();

      const descClean = desc.replace(/\s+/g, "");
      const firstClean = firstMes.replace(/\s+/g, "");

      precomputed.push({
        id: char.id,
        name,
        descClean,
        firstClean,
        bothEmpty: !descClean && !firstClean,
      });
    }
  }

  const groups: string[][] = [];
  const processedIds = new Set<string>();

  const nameDescMap = new Map<string, string[]>();
  const nameFirstMap = new Map<string, string[]>();
  const nameEmptyMap = new Map<string, string[]>();
  const descFirstMap = new Map<string, string[]>();

  for (const item of precomputed) {
    if (item.name && item.descClean) {
      const key = `${item.name}|${item.descClean}`;
      const list = nameDescMap.get(key) || [];
      list.push(item.id);
      nameDescMap.set(key, list);
    }
    if (item.name && item.firstClean) {
      const key = `${item.name}|${item.firstClean}`;
      const list = nameFirstMap.get(key) || [];
      list.push(item.id);
      nameFirstMap.set(key, list);
    }
    if (item.name && item.bothEmpty) {
      const key = item.name;
      const list = nameEmptyMap.get(key) || [];
      list.push(item.id);
      nameEmptyMap.set(key, list);
    }
    if (item.descClean && item.firstClean && item.descClean.length > 50) {
      const key = `${item.descClean}|${item.firstClean}`;
      const list = descFirstMap.get(key) || [];
      list.push(item.id);
      descFirstMap.set(key, list);
    }
  }

  const addGroup = (list: string[]) => {
    const validIds = list.filter((id) => !processedIds.has(id));
    if (validIds.length > 1) {
      validIds.forEach((id) => processedIds.add(id));
      groups.push(validIds);
    }
  };

  for (const list of nameDescMap.values()) addGroup(list);
  for (const list of nameFirstMap.values()) addGroup(list);
  for (const list of nameEmptyMap.values()) addGroup(list);
  for (const list of descFirstMap.values()) addGroup(list);

  const finalGroups: DuplicateGroup[] = [];

  for (const groupIds of groups) {
    const groupChars: CharacterCard[] = [];
    for (const id of groupIds) {
      const char = charMap.get(id);
      if (char) groupChars.push(char);
    }

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

      const reasons: string[] = [];

      if (
        cDesc === oDesc &&
        cFirst === oFirst &&
        cBook === oBook &&
        cAlt === oAlt &&
        cMesExample === oMesExample
      ) {
        let isIdenticalToPrev = false;
        for (let j = 0; j < i; j++) {
          const pData = sorted[j].data?.data || sorted[j].data || {};
          if (
            cDesc === (pData.description || "") &&
            cFirst === (pData.first_mes || "")
          ) {
            isIdenticalToPrev = true;
            break;
          }
        }
        if (isIdenticalToPrev) {
          reasons.push("内容重复");
        } else {
          reasons.push("基本相同");
        }
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

      if (reasons.length === 0) {
        reasons.push("微调细节");
      }

      analyzedChars.push({ char: current, reason: reasons.join("，") });
    }

    finalGroups.push({
      id: crypto.randomUUID(),
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
