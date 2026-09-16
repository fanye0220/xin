import { isAndroid, saveToGallery, deleteLocalGalleryFile, readLocalFileBuffer, pickAndroidFiles, renameLocalGalleryFile } from "./appBridge";
import {
  CharacterCard,
  getFolders,
  getCharacter,
  ChatLog,
  initDB,
  getCachedMeta,
  getOrCreateNestedFolder,
  computeChatMetadata,
  invalidateCache,
  getChatsForCharacter,
  enqueueAndroidSync,
  isActualCharacterCard,
  getCharacterCategoryPrefix,
} from "./db";
import { extractTavernData, injectTavernData } from "./png";

const getSafeFilename = (name: string) => {
  return name.replace(/[\\/:*?"<>|]/g, "_") || "character";
};

export async function syncWithAndroidLocalDirectory(
  onProgress?: (msg: string, current: number, total: number) => void,
  forceNewPaths?: string[],
): Promise<boolean> {
  return Promise.resolve(false);
}

export async function syncAndroidFolder(): Promise<boolean> { return Promise.resolve(false); }

export async function resolveFolderPath(
  folderId?: string | null,
): Promise<string> {
  const defaultUncategorized = "未归类";
  if (!folderId || folderId === "all") return defaultUncategorized;

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
  // Make sure each folder name is safe
  return pathParts.map(getSafeFilename).join("/");
}



export async function _tryCleanupOldAndroidFilesWorker(char: CharacterCard, newPath?: string) {
  if (!isAndroid()) return;
  const targetPath = char.localFilePath || (char as any)._androidSyncPath;
  if (!targetPath) return;

  const db = await initDB();
  const tx = db.transaction("characters", "readonly");
  const allChars = await tx.store.getAll();
  await tx.done;

  const parts = targetPath.split("/");
  const safeName = getSafeFilename(char.name);
  
  
  let isFolder = false;
  let dirPath = "";
  if (parts.length >= 2) {
    const parentName = parts[parts.length - 2];
    const knownCategories = ["回收站", "未归类", "未分类", "预设", "世界书", "快速回复", "工具区"];
    
    // Check if the parent folder is essentially a dedicated character folder
    // Character folders are usually named after the character (safeName), or folderBaseName from the file
    let fileName = parts[parts.length - 1];
    let fileBaseName = fileName.split(".")[0] || "";
    
    // It's a character folder if the parent folder is NOT a category AND (matches safeName or matches fileBaseName)
    if (!knownCategories.includes(parentName) && (parentName.includes(safeName) || safeName.includes(parentName) || parentName === fileBaseName)) {
      isFolder = true;
      dirPath = parts.slice(0, parts.length - 1).join("/");
    }
  }



  // Check if any other character is using the exact file or exactly the same folder
  for (const c of allChars) {
    if (c.id === char.id) continue;
    const p = c.localFilePath || (c as any)._androidSyncPath;
    if (p) {
      if (isFolder && p.startsWith(dirPath + "/")) {
        // Another character is still using files in this folder (or the folder itself)
        return;
      } else if (!isFolder && p === targetPath) {
        // Another character is using this exact standalone file
        return;
      }
    }
  }


  if (isFolder) {
    if (newPath && newPath.startsWith(dirPath + "/")) {
      // The character is still in this folder, just a different file
      await deleteLocalGalleryFile(targetPath);
    } else {
      // Attempt to delete entire subfolder recursively
      if ((window as any).Android && (window as any).Android.listAllTavernFiles) {
        try {
          const filesStr = await (window as any).Android.listAllTavernFiles();
          const files: { absolutePath: string }[] = JSON.parse(filesStr);
          const dirsToDelete = new Set<string>();
          for (const f of files) {
            if (f.absolutePath.startsWith(dirPath + "/")) {
              await deleteLocalGalleryFile(f.absolutePath);
              
              let currentPath = f.absolutePath;
              while (currentPath.length > dirPath.length) {
                 const lastSlash = currentPath.lastIndexOf("/");
                 if (lastSlash <= dirPath.length) break;
                 currentPath = currentPath.substring(0, lastSlash);
                 if (currentPath !== dirPath) dirsToDelete.add(currentPath);
              }
            }
          }
          const sortedDirs = Array.from(dirsToDelete).sort((a, b) => b.length - a.length);
          for (const d of sortedDirs) {
             await deleteLocalGalleryFile(d);
          }
        } catch (e) {
          console.error("Failed to list files for recursive delete", e);
        }
      }
      await deleteLocalGalleryFile(dirPath);
    }
  } else {
    // Attempt to delete the single file
    await deleteLocalGalleryFile(targetPath);
  }

}

async function _syncCharacterToAndroidWorker(
  char: CharacterCard,
  blobStoreValue: {
    avatarBlob?: Blob;
    originalFile?: File;
    avatarHistory?: Blob[];
  } | null, previousFilePath?: string
): Promise<string[]> {
  if (!isAndroid()) return [];

  // Determine prefix and folder
  let prefix = getCharacterCategoryPrefix(char);
  let folderPath = await resolveFolderPath(char.folderId);

  if (char.deletedAt) {
    folderPath = "回收站";
  } else if ((folderPath === "未归类" || folderPath === "未分类")) {
    if (prefix) {
      folderPath = prefix;
    } else {
      folderPath = "";
    }
  }

  const safeName = getSafeFilename(char.name);

  let savedPaths: string[] = [];
  const isTool = prefix !== "未归类";

  if (isTool) {
    let buffer: ArrayBuffer;
    let ext = "json";
    let fileName = "";
    if (char.autoImportFilename) {
      fileName = char.autoImportFilename.split("/").pop() || "";
    }
    
    // Always generate buffer from char.data for tools to prevent empty files from IndexedDB File blob issues
    const jsonStr = JSON.stringify(char.data || {}, null, 2);
    buffer = new TextEncoder().encode(jsonStr).buffer;

    if (fileName) {
      const parts = fileName.split(".");
      if (parts.length > 1) {
        ext = parts[parts.length - 1];
      }
    }

    if (!fileName) {
      fileName = `${safeName}.${ext}`;
    }
    const saveTarget = folderPath ? `${folderPath}/${fileName}` : fileName;
    const path = await saveToGallery(saveTarget, buffer);
    if (path) {
      savedPaths.push(path);
      if (previousFilePath && previousFilePath !== path) {
        await _tryCleanupOldAndroidFilesWorker({
          ...char,
          localFilePath: previousFilePath,
        } as CharacterCard);
      }
    }
    return savedPaths;
  }

  let baseBlob = blobStoreValue?.avatarBlob || blobStoreValue?.originalFile;
  let localBuffer: ArrayBuffer | null = null;

  if (!baseBlob && previousFilePath) {
    localBuffer = await readLocalFileBuffer(previousFilePath);
  } else if (baseBlob) {
    localBuffer = await baseBlob.arrayBuffer();
  }

  if (!localBuffer) {
    // If we failed to read the image buffer but the character is image-based, DO NOT fallback to JSON!
    // That would destroy the user's avatar.
    const isImageBased = previousFilePath?.match(/\.(png|jpe?g|webp|gif|bmp)$/i) || blobStoreValue?.avatarBlob || (blobStoreValue?.avatarHistory && blobStoreValue.avatarHistory.length > 0);
    if (isImageBased) {
      console.error("Failed to read local image buffer, aborting sync to avoid data loss.");
      return [];
    }
  }

  if (localBuffer) {
    let injectedBuffer: ArrayBuffer;
    let isPng = false;
    try {
      const uint8 = new Uint8Array(localBuffer);
      if (
        uint8.length >= 8 &&
        uint8[0] === 0x89 &&
        uint8[1] === 0x50 &&
        uint8[2] === 0x4e &&
        uint8[3] === 0x47
      ) {
        isPng = true;
      }
    } catch (e) {}

    let cardExt = isPng ? "png" : "json";
    let fileName = "";
    if (char.autoImportFilename) {
      fileName = char.autoImportFilename.split("/").pop() || "";
    }

    if (!isPng && baseBlob instanceof File && baseBlob.name) {
      const parts = baseBlob.name.split(".");
      if (parts.length > 1) {
        cardExt = parts[parts.length - 1];
      }
    }

    if (fileName) {
      const parts = fileName.split(".");
      if (parts.length > 1) {
        // If the original file was json, but now we have a PNG avatar, we must change extension to png
        if (isPng) {
          fileName = parts.slice(0, -1).join(".") + ".png";
        } else {
          cardExt = parts[parts.length - 1];
        }
      } else if (isPng) {
        fileName = `${fileName}.png`;
      }
    } else {
      fileName = `${safeName}.${cardExt}`;
    }

    // Ensure we strip any previous timestamp from fileName so it doesn't pollute folder names
    const partsForStrip = fileName.split(".");
    if (partsForStrip.length > 1) {
       let namePart = partsForStrip.slice(0, -1).join(".");
       namePart = namePart.replace(/_\d{13}$/, "");
       fileName = `${namePart}.${partsForStrip[partsForStrip.length - 1]}`;
    }

    try {
      if (isPng) {
        injectedBuffer = injectTavernData(localBuffer, char.data);
      } else {
        injectedBuffer = localBuffer;
      }
    } catch (e) {
      console.warn("Failed to inject tavern data, using raw buffer", e);
      injectedBuffer = localBuffer;
    }

    const targetData = char.data.data ? char.data.data : char.data;
    const hasQR =
      targetData.extensions?.quick_replies &&
      targetData.extensions.quick_replies.length > 0;
    const avatarHistory = blobStoreValue?.avatarHistory || [];
    const hasAvatars = avatarHistory.length > 0;

    const chats = await getChatsForCharacter(char.id);
    const hasChats = chats.length > 0;

    let mainCardPath = "";

    if (hasQR || hasAvatars || hasChats) {
      // Put everything in a subfolder
      const folderBaseName = fileName.split(".")[0] || safeName;

      const subFolder = folderPath ? `${folderPath}/${folderBaseName}` : folderBaseName;
      mainCardPath =
        (await saveToGallery(`${subFolder}/${fileName}`, injectedBuffer)) || "";

      if (hasChats) {
        for (const c of chats) {
          await new Promise(r => setTimeout(r, 0));
          const dateStr = new Date(c.createdAt)
            .toISOString()
            .replace(/:/g, "-");
          const cName = getSafeFilename(c.name || "Chat");
          const lines = c.messages
            ? c.messages.map((m) => JSON.stringify(m)).join("\n")
            : "";
          const b = new TextEncoder().encode(lines).buffer;
          await saveToGallery(
            `${subFolder}/聊天记录/${cName}_${dateStr}.jsonl`,
            b,
          );
        }
      }

      if (hasQR) {
        const qrFileName =
          targetData.extensions?.qr_filename || `${safeName}_qr.json`;
        let qrContentToExport: any = targetData.extensions.quick_replies;
        if (
          targetData.extensions.tavern_qr_sets &&
          targetData.extensions.tavern_qr_sets.length > 0
        ) {
          const metadata = targetData.extensions.tavern_qr_sets.find(
            (s: any) => s.metadata,
          )?.metadata;
          if (metadata) {
            qrContentToExport = { ...metadata };
            if (qrContentToExport.qrList)
              qrContentToExport.qrList = targetData.extensions.quick_replies;
            else if (qrContentToExport.quick_replies)
              qrContentToExport.quick_replies =
                targetData.extensions.quick_replies;
          } else {
            qrContentToExport = {
              version: 2,
              name: char.name,
              qrList: targetData.extensions.quick_replies,
            };
          }
        } else {
          qrContentToExport = {
            version: 2,
            name: char.name,
            qrList: targetData.extensions.quick_replies,
          };
        }
        const qrBuffer = new TextEncoder().encode(
          JSON.stringify(qrContentToExport, null, 2),
        ).buffer;
        await saveToGallery(`${subFolder}/${qrFileName}`, qrBuffer);
      }

      if (hasAvatars) {
        for (let i = 0; i < avatarHistory.length; i++) {
          await new Promise(r => setTimeout(r, 0));
          const avatarBlob = avatarHistory[i];
          let ext = "png";
          let histFileName = `替换头像_${i + 1}.${ext}`;
          if (typeof File !== "undefined" && avatarBlob instanceof File && avatarBlob.name) {
            histFileName = avatarBlob.name;
          } else {
            if (avatarBlob.type === "image/jpeg") ext = "jpg";
            else if (avatarBlob.type === "image/webp") ext = "webp";
            histFileName = `替换头像_${i + 1}.${ext}`;
          }
          const b = await avatarBlob.arrayBuffer();
          await saveToGallery(`${subFolder}/替换头像/${histFileName}`, b);
        }
      }
    } else {
      const saveTarget = folderPath ? `${folderPath}/${fileName}` : fileName;
      mainCardPath =
        (await saveToGallery(saveTarget, injectedBuffer)) ||
        "";
    }

    if (mainCardPath) {
      savedPaths.push(mainCardPath);
      if (previousFilePath && previousFilePath !== mainCardPath) {
        await _tryCleanupOldAndroidFilesWorker({
          ...char,
          localFilePath: previousFilePath,
        } as CharacterCard, mainCardPath);
        const chats = await getChatsForCharacter(char.id);
        for (const c of chats) {
          await new Promise((r) => setTimeout(r, 0));
          await _syncChatToAndroidWorker(c, true);
        }
      }
    }
  } else {
    // Only json fallback if it's not an image based card, e.g. imported as json and no avatar fallback worked
    const jsonStr = JSON.stringify(char.data, null, 2);
    const buffer = new TextEncoder().encode(jsonStr).buffer;
    let fallbackFileName = char.autoImportFilename
      ? char.autoImportFilename.split("/").pop() || ""
      : "";
    if (!fallbackFileName) {
      fallbackFileName = `${safeName}.json`;
    }
    if (!fallbackFileName.endsWith(".json")) {
      fallbackFileName = `${fallbackFileName.split(".")[0] || safeName}.json`;
    }
    const saveTarget = folderPath ? `${folderPath}/${fallbackFileName}` : fallbackFileName;
    const path = await saveToGallery(
      saveTarget,
      buffer,
    );
    if (path) {
      savedPaths.push(path);
      if (previousFilePath && previousFilePath !== path) {
        await _tryCleanupOldAndroidFilesWorker({
          ...char,
          localFilePath: previousFilePath,
        } as CharacterCard);
        const chats = await getChatsForCharacter(char.id);
        for (const c of chats) {
          await new Promise((r) => setTimeout(r, 0));
          await _syncChatToAndroidWorker(c, true);
        }
      }
    }
  }

  return savedPaths;
}

export async function _syncChatToAndroidWorker(chat: ChatLog, skipCharacterSync: boolean = false): Promise<void> {
  if (!isAndroid()) return;
  const safeName = getSafeFilename(chat.name || "Chat");

  // Get character associated with chat to potentially place it nicely
  const char = await getCharacter(chat.characterId);
  const dateStr = new Date(chat.createdAt).toISOString().replace(/:/g, "-");
  const chatFileName = `${safeName}_${dateStr}.jsonl`; // Or whatever format, jsonl is tavern style

  // Format to standard jsonl format
  const jsonlLines = chat.messages
    ? chat.messages.map((m) => JSON.stringify(m)).join("\n")
    : "";
  const buffer = new TextEncoder().encode(jsonlLines).buffer;

  if (char) {
    let charFolderName = getSafeFilename(char.name);
    if (char.autoImportFilename) {
      charFolderName =
        char.autoImportFilename.split("/").pop()?.split(".")[0] ||
        charFolderName;
    }
    let prefix = getCharacterCategoryPrefix(char);
    let folderPath = await resolveFolderPath(char.folderId);
    if (char.deletedAt) {
      folderPath = "回收站";
    } else if ((folderPath === "未归类" || folderPath === "未分类")) {
      if (prefix) {
        folderPath = prefix;
      } else {
        folderPath = "";
      }
    }

    // Save to FolderPath/CharacterName/聊天记录/ChatName.jsonl
    const saveTarget = folderPath ? `${folderPath}/${charFolderName}/聊天记录/${chatFileName}` : `${charFolderName}/聊天记录/${chatFileName}`;
    const savedPath = await saveToGallery(
      saveTarget,
      buffer,
    );
    if (savedPath) {
       chat.localFilePath = savedPath;
       const db = await initDB();
       await db.put("chats", chat);
    }

    // Sync character so it also moves into the subfolder if it hasn't yet
    if (!skipCharacterSync) {
      const db = await initDB();
      const blobs = await db.get("blobs", char.id);
      const syncPaths = await _syncCharacterToAndroidWorker(char, blobs || null);
      if (
        syncPaths &&
        syncPaths.length > 0 &&
        syncPaths[0] !== char.localFilePath
      ) {
        char.localFilePath = syncPaths[0];
        await db.put("characters", char);
      }
    }
  } else {
    // If unbounded chat, put into a default unbound directory
    const savedPath = await saveToGallery(`未绑定聊天记录/${chatFileName}`, buffer);
    if (savedPath) {
      chat.localFilePath = savedPath;
      const db = await initDB();
      await db.put("chats", chat);
    }
  }
  
}


// Since Android doesn't have an API to list directories and delete them easily,
// when we soft delete or hard delete a character, we should ideally delete its files.
async function _deleteCharacterFromAndroidWorker(
  char: CharacterCard,
): Promise<void> {
  await _tryCleanupOldAndroidFilesWorker(char);
  
}

async function _fastMoveCharacterOnAndroidWorker(
  char: CharacterCard,
): Promise<string[] | null> {
  if (!isAndroid()) return null;
  const previousFilePath = char.localFilePath || (char as any)._androidSyncPath || (char as any)._previousFilePath;
  if (!previousFilePath) return null; // No file synced

  const safeName = getSafeFilename(char.name);

  let fileName = "";
  if (char.autoImportFilename) {
    fileName = char.autoImportFilename.split("/").pop() || "";
  }
  
  if (fileName) {
    // Strip timestamp just like syncCharacterToAndroid
    const partsForStrip = fileName.split(".");
    if (partsForStrip.length > 1) {
       let namePart = partsForStrip.slice(0, -1).join(".");
       namePart = namePart.replace(/_\d{13}$/, "");
       fileName = `${namePart}.${partsForStrip[partsForStrip.length - 1]}`;
    }
  }
  
  const folderBaseName = fileName ? (fileName.split(".")[0] || safeName) : safeName;

  // Figure out the old directory or file name
  // Note: previousFilePath usually looks like `.../MIU_Sync/文件夹/角色名/角色名.png` or `.../MIU_Sync/文件夹/角色名.png`
  let oldDirPath = "";
  let oldIsFolder = false;
  const oldParts = previousFilePath.split("/");
  if (
    oldParts.length >= 2 &&
    oldParts[oldParts.length - 2] === folderBaseName
  ) {
    oldIsFolder = true;
    oldDirPath = oldParts.slice(0, oldParts.length - 1).join("/");
  }

  // Calculate old logical path relative to root
  let oldFolderPath = await resolveFolderPath((char as any)._oldFolderId);
  if ((char as any)._wasDeleted) {
    oldFolderPath = "回收站";
  } else if ((oldFolderPath === "未归类" || oldFolderPath === "未分类")) {
    if (getCharacterCategoryPrefix(char)) {
      oldFolderPath = getCharacterCategoryPrefix(char);
    } else {
      oldFolderPath = "";
    }
  }

  // Calculate new logical path relative to root
  let newFolderPath = await resolveFolderPath(char.folderId);
  let prefix = getCharacterCategoryPrefix(char);
  if (char.deletedAt) {
    newFolderPath = "回收站";
  } else if (
    (newFolderPath === "未归类" || newFolderPath === "未分类")
  ) {
    if (prefix) {
      newFolderPath = prefix;
    } else {
      newFolderPath = "";
    }
  }

  if (oldIsFolder) {
    // We rename the entire folder
    // e.g. from `/storage/.../Imported/myChar` to `回收站/myChar`
    // renameLocalGalleryFile handles translating newFolderPath to the absolute native path
    const oldDirRelative = oldFolderPath ? `${oldFolderPath}/${folderBaseName}` : folderBaseName;
    const newDirRelative = newFolderPath ? `${newFolderPath}/${folderBaseName}` : folderBaseName;
    const success = await renameLocalGalleryFile(oldDirPath, newDirRelative);
    if (success) {
      // Return constructed new previousFilePath
      // Replace the old relative directory portion with the new one to preserve the absolute root path
      const newFilePath = previousFilePath.replace(
        `/${oldDirRelative}/`,
        `/${newDirRelative}/`,
      );
      return [newFilePath];
    }
  } else {
    // Standalone file move
    const extractedName = oldParts[oldParts.length - 1]; // e.g. myChar.png
    const oldFileRelative = oldFolderPath ? `${oldFolderPath}/${extractedName}` : extractedName;
    const newFileRelative = newFolderPath ? `${newFolderPath}/${extractedName}` : extractedName;
    const success = await renameLocalGalleryFile(
      previousFilePath,
      newFileRelative,
    );
    if (success) {
      const newFilePath = previousFilePath.replace(
        `/${oldFileRelative}`,
        `/${newFileRelative}`,
      );
      return [newFilePath];
    }
  }
  return null;
}

async function _deleteFolderFromAndroidWorker(folder: any): Promise<void> {
  if (!isAndroid()) return;
  const folderPath = await resolveFolderPath(folder.id);
  if (folderPath && folderPath !== "未归类") {
    if ((window as any).Android && (window as any).Android.listAllTavernFiles) {
      try {
        const filesStr = await (window as any).Android.listAllTavernFiles();
        const files: { absolutePath: string }[] = JSON.parse(filesStr);
        for (const f of files) {
          if (f.absolutePath.startsWith(folderPath + "/")) {
            await deleteLocalGalleryFile(f.absolutePath);
          }
        }
      } catch (e) {
        console.error("Failed to list files for folder delete", e);
      }
    }
    await deleteLocalGalleryFile(folderPath);
  }
}

export async function _deleteChatFromAndroidWorker(chat: ChatLog): Promise<void> {
  const safeName = getSafeFilename(chat.name || "Chat");

  const char = await getCharacter(chat.characterId);
  const dateStr = new Date(chat.createdAt).toISOString().replace(/:/g, "-");
  const chatFileName = `${safeName}_${dateStr}.jsonl`;

  if (char) {
    let charFolderName = getSafeFilename(char.name);
    if (char.autoImportFilename) {
      charFolderName =
        char.autoImportFilename.split("/").pop()?.split(".")[0] ||
        charFolderName;
    }
    let folderPath = await resolveFolderPath(char.folderId);
    let prefix = getCharacterCategoryPrefix(char);
    if (char.deletedAt) {
      folderPath = "回收站";
    } else if ((folderPath === "未归类" || folderPath === "未分类")) {
      if (prefix) {
        folderPath = prefix;
      } else {
        folderPath = "";
      }
    }
    const targetPath = folderPath ? `${folderPath}/${charFolderName}/聊天记录/${chatFileName}` : `${charFolderName}/聊天记录/${chatFileName}`;
    await deleteLocalGalleryFile(targetPath);
  } else {
    // If unbounded chat
    const targetPath = `未绑定聊天记录/${chatFileName}`;
    await deleteLocalGalleryFile(targetPath);
  }
  
}





// --- EXPORTED WRAPPERS FOR SEQUENTIAL SYNC ---
// ALL LOCAL SYNC HAS BEEN DISABLED PER USER REQUEST (RELYING ON CLOUD SYNC)
export function syncCharacterToAndroid(
  char: CharacterCard,
  blobStoreValue: {
    avatarBlob?: Blob;
    originalFile?: File;
    avatarHistory?: Blob[];
  } | null,
): Promise<string[]> {
  return Promise.resolve([]);
}

export function fastMoveCharacterOnAndroid(
  char: CharacterCard,
): Promise<string[] | null> {
  return Promise.resolve(null);
}

export function deleteCharacterFromAndroid(char: CharacterCard): Promise<void> {
  return Promise.resolve();
}

export function deleteFolderFromAndroid(folder: any): Promise<void> {
  return Promise.resolve();
}

export function syncChatToAndroid(chat: ChatLog, skipCharacterSync: boolean = false): Promise<void> {
  return Promise.resolve();
}

export function deleteChatFromAndroid(chat: ChatLog): Promise<void> {
  return Promise.resolve();
}

export function tryCleanupOldAndroidFiles(char: CharacterCard, newPath?: string): Promise<void> {
  return Promise.resolve();
}

export function batchFastMoveCharactersOnAndroid(
  chars: CharacterCard[],
): Promise<Map<string, string>> {
  return Promise.resolve(new Map());
}

export function batchCleanupAndroidFiles(chars: CharacterCard[]): Promise<void> {
  return Promise.resolve();
}
