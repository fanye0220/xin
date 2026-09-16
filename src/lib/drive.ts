import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User, signInWithCredential } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { getFolders, getCachedMeta, getCharacter, getAllChatsMetadata, getChatById, saveFolder, saveCharacter, saveChatsBulk, invalidateCache, initDB } from './db';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { resumableUploadToDrive } from './driveUpload';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
// Request Workspace scopes
provider.addScope('https://www.googleapis.com/auth/drive.file');

// Flag to indicate if we are in the middle of a sign-in flow.
let isSigningIn = false;
// Cache the access token in memory with persistence.
let cachedAccessToken: string | null = localStorage.getItem('google_drive_access_token');
let tokenExpiration: number | null = Number(localStorage.getItem('google_drive_token_expiration')) || null;

if (tokenExpiration && Date.now() > tokenExpiration) {
  cachedAccessToken = null;
  localStorage.removeItem('google_drive_access_token');
  localStorage.removeItem('google_drive_token_expiration');
}

export type SyncState = {
  isActive: boolean;
  taskName: string;
  message: string;
  isError: boolean;
  completed: boolean;
};

let syncState: SyncState = { isActive: false, taskName: '', message: '', isError: false, completed: false };
const syncListeners = new Set<(state: SyncState) => void>();

export function onSyncStateChange(listener: (state: SyncState) => void) {
  syncListeners.add(listener);
  listener(syncState);
  return () => syncListeners.delete(listener);
}

function updateSyncState(update: Partial<SyncState>) {
  syncState = { ...syncState, ...update };
  syncListeners.forEach(fn => fn(syncState));
  
  if (!syncState.isActive && (syncState.completed || syncState.isError)) {
    setTimeout(() => {
      if (!syncState.isActive) {
        updateSyncState({ completed: false, isError: false, message: '', taskName: '' });
      }
    }, 5000);
  }
}

let autoSyncInterval: any = null;
let currentAccessToken: string | null = null;

// Initialize auth state listener. Call this on app load.
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  // Check for redirect result on initialization (for Android WebView support)
  import('firebase/auth').then(({ getAuth, getRedirectResult, GoogleAuthProvider }) => {
    const authInstance = getAuth();
    getRedirectResult(authInstance).then(result => {
      if (result) {
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (credential?.accessToken) {
          cachedAccessToken = credential.accessToken;
          const expiresAt = Date.now() + 3500 * 1000;
          localStorage.setItem('google_drive_access_token', cachedAccessToken);
          localStorage.setItem('google_drive_token_expiration', expiresAt.toString());
          currentAccessToken = cachedAccessToken;
          startAutoSyncRunner();
          if (onAuthSuccess) onAuthSuccess(result.user, cachedAccessToken);
        }
      }
    }).catch(e => {
      console.error("Redirect auth error:", e);
    });
  });

  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        currentAccessToken = cachedAccessToken;
        startAutoSyncRunner();
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        currentAccessToken = null;
        localStorage.removeItem('google_drive_access_token');
        localStorage.removeItem('google_drive_token_expiration');
        stopAutoSyncRunner();
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      currentAccessToken = null;
      localStorage.removeItem('google_drive_access_token');
      localStorage.removeItem('google_drive_token_expiration');
      stopAutoSyncRunner();
      if (onAuthFailure) onAuthFailure();
    }
  });
};

function startAutoSyncRunner() {
  if (autoSyncInterval) return;
  
  autoSyncInterval = setInterval(async () => {
    const isEnabled = localStorage.getItem('miu_auto_backup') === '1';
    if (!isEnabled || !currentAccessToken || syncState.isActive) return;
    
    updateSyncState({ isActive: true, taskName: '自动备份', message: '准备备份...', isError: false, completed: false });
    try {
      await uploadBackupToDrive(currentAccessToken, (msg) => {
        updateSyncState({ message: msg });
      }, true);
      updateSyncState({ isActive: false, completed: true, message: '自动备份完成' });
    } catch (e: any) {
      console.error("[AutoSync] Scheduled backup failed:", e);
      updateSyncState({ isActive: false, isError: true, message: `自动备份失败: ${e.message}` });
    }
  }, 1000 * 60 * 30); // 30 minutes
}

function stopAutoSyncRunner() {
  if (autoSyncInterval) {
    clearInterval(autoSyncInterval);
    autoSyncInterval = null;
  }
}

// Must be called from a button click or user interaction
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    let resultUser;
    let resultAccessToken;

    if (Capacitor.isNativePlatform()) {
      const result = await FirebaseAuthentication.signInWithGoogle({ scopes: ['https://www.googleapis.com/auth/drive.file'] });
      
      if (result.credential?.idToken) {
        const firebaseCred = GoogleAuthProvider.credential(result.credential.idToken, result.credential.accessToken);
        const authResult = await signInWithCredential(auth, firebaseCred);
        resultUser = authResult.user;
        resultAccessToken = result.credential.accessToken;
      } else {
        throw new Error('No credential returned from native Google Sign-In');
      }
    } else {
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error('Failed to get access token from Firebase Auth');
      }
      resultUser = result.user;
      resultAccessToken = credential.accessToken;
    }

    cachedAccessToken = resultAccessToken;
    const expiresAt = Date.now() + 3500 * 1000;
    if (cachedAccessToken) {
      localStorage.setItem('google_drive_access_token', cachedAccessToken);
      localStorage.setItem('google_drive_token_expiration', expiresAt.toString());
      currentAccessToken = cachedAccessToken;
    }
    startAutoSyncRunner();
    return { user: resultUser as User, accessToken: cachedAccessToken! };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  if (Capacitor.isNativePlatform()) {
    await FirebaseAuthentication.signOut();
  }
  await auth.signOut();
  cachedAccessToken = null;
  localStorage.removeItem('google_drive_access_token');
  localStorage.removeItem('google_drive_token_expiration');
};

// Google Drive API Functions

// Base folder name
const FOLDER_NAME = 'AITavern_Backups';

const BACKUP_SETTING_KEYS = [
  'tavern_theme',
  'tavern_viewMode',
  'tavern_sortBy',
  'tavern_pageSize',
  'tavern_foldersExpanded',
  'tavern_sidebarFoldersExpanded',
  'chatViewer_customTags',
  'miu_auto_backup',
];

const backupFolderPromiseCache = new Map<string, Promise<string>>();

function getOrCreateBackupFolder(accessToken: string): Promise<string> {
  const cached = backupFolderPromiseCache.get(accessToken);
  if (cached) return cached;

  const promise = (async () => {
    // Check if folder exists
    let res = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    let data = await res.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id; // Return existing folder ID
    }

    // Create folder
    res = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });
    data = await res.json();
    return data.id;
  })().catch((err) => {
    backupFolderPromiseCache.delete(accessToken);
    throw err;
  });

  backupFolderPromiseCache.set(accessToken, promise);
  return promise;
}

export async function exportAllDataForBackup(onProgress: (msg: string) => void): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();

  const db = await initDB();

  // Export folders and memos explicitly
  onProgress("正在打包应用数据...");
  const folders = (await db.getAll('folders')).filter(f => !(f as any).deletedAt);
  zip.file("folders.json", JSON.stringify(folders));
  
  const memos = await db.getAll('memos');
  const processedMemos = memos.map(m => {
      if (m.blob) {
          const extension = m.blob.type === 'image/jpeg' ? 'jpg' : (m.blob.type === 'image/webp' ? 'webp' : 'png');
          const filename = `memo_${m.id}.${extension}`;
          zip.file(`Memos/${filename}`, m.blob, { compression: "STORE" });
          return { ...m, _blobFilename: filename, blob: undefined };
      }
      return m;
  });
  zip.file("memos.json", JSON.stringify(processedMemos));

  // Settings
  onProgress("正在导出系统配置...");
  const appSettings: any = {};
  for (const key of BACKUP_SETTING_KEYS) {
    const val = localStorage.getItem(key);
    if (val !== null && val !== undefined) {
      appSettings[key] = val;
    }
  }
  zip.file("settings.json", JSON.stringify(appSettings));

  // Compatible Export layout inside the same Backup Zip
  const chars = await getCachedMeta();
  onProgress(`正在导出角色文件 (总数: ${chars.length})...`);
  
  for (let i = 0; i < chars.length; i++) {
    const char = await getCharacter(chars[i].id);
    if (!char || char.deletedAt) continue;
    
    const safeCharName = char.name.replace(/[/\\?%*:|"<>]/g, '_');
    const folderPath = `Characters/${safeCharName}_${char.id}`;
    
    let charOriginalFile = char.originalFile;
    let charAvatarBlob = char.avatarBlob;

    if (char.localFilePath && !charOriginalFile) {
        try {
            const { readLocalFileBuffer } = await import('./appBridge');
            const buf = await readLocalFileBuffer(char.localFilePath);
            if (buf) {
                let mime = 'image/png';
                let ext = 'png';
                if (char.localFilePath.toLowerCase().endsWith('.webp')) { mime = 'image/webp'; ext = 'webp'; }
                else if (char.localFilePath.toLowerCase().match(/\.(jpe?g)$/)) { mime = 'image/jpeg'; ext = 'jpg'; }
                
                charOriginalFile = new File([buf], `original.${ext}`, { type: mime });
                charAvatarBlob = new Blob([buf], { type: mime });
            }
        } catch(e) {}
    }

    if (charOriginalFile) {
       const extension = charOriginalFile.name ? charOriginalFile.name.split('.').pop() || 'png' : 'png';
       zip.file(`${folderPath}/${safeCharName}.${extension}`, new Blob([charOriginalFile], { type: charOriginalFile.type || 'image/png' }), { compression: "STORE" });
    }
    
    zip.file(`${folderPath}/${safeCharName}.json`, JSON.stringify(char.data || {}));
    
    zip.file(`${folderPath}/character.json`, JSON.stringify({
      id: char.id,
      name: char.name,
      createdAt: char.createdAt,
      folderId: char.folderId,
      sortOrder: char.sortOrder,
      autoImportFilename: char.autoImportFilename,
      data: char.data || {}
    }));
    
    if (charAvatarBlob && !charOriginalFile) {
       zip.file(`${folderPath}/avatar.png`, new Blob([charAvatarBlob], { type: charAvatarBlob.type || 'image/png' }), { compression: "STORE" });
    }
  }

  const allChats = await getAllChatsMetadata();
  onProgress(`正在导出聊天记录 (总数: ${allChats.length})...`);
  for (let i = 0; i < allChats.length; i++) {
    const chatInfo = allChats[i] as any;
    if (chatInfo.deletedAt) continue;
    
    const chat = await getChatById(chatInfo.id);
    if (!chat) continue;
    
    const charMeta = chars.find(c => c.id === chat.characterId);
    const charName = charMeta ? charMeta.name : "Unknown";
    const safeCharName = charName.replace(/[/\\?%*:|"<>]/g, '_');
    const safeChatName = chat.name ? chat.name.replace(/[/\\?%*:|"<>]/g, '_') : 'Unnamed';
    
    const formattedDate = new Date(chat.createdAt).toISOString().replace(/[:.]/g, "-");
    const filename = `${safeChatName}_${formattedDate}.jsonl`;
    
    const jsonlString = chat.messages.map((m: any) => JSON.stringify(m)).join('\n');
    zip.file(`Chats/${safeCharName}/${filename}`, jsonlString);
  }

  // Handle memos correctly, avoid stringifying Blobs by skipping them or converting?
  // Wait, the current logic already just does JSON.stringify(memos). It's flawed for images but that's what it was.
  
  onProgress("打包中，请稍候...");
  return await zip.generateAsync({ 
    type: "blob", 
    compression: "DEFLATE",
    compressionOptions: {
      level: 6
    }
  });
}

export async function uploadBackupToDrive(accessToken: string, onProgress: (msg: string) => void, isAutoBackup: boolean = false): Promise<void> {
  onProgress("正在打包完整备份...");
  const zipBlob = await exportAllDataForBackup(onProgress);

  const folderId = await getOrCreateBackupFolder(accessToken);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = isAutoBackup
    ? `MIU_AutoBackup_${timestamp}.zip`
    : `MIU_Backup_${timestamp}.zip`;

  onProgress("正在上传完整备份...(0%)");
  const uploadRes = await resumableUploadToDrive(
    accessToken,
    { name: filename, parents: [folderId], mimeType: "application/zip" },
    zipBlob,
    "application/zip",
    (uploaded, total) => {
      const pct = total > 0 ? Math.floor((uploaded / total) * 100) : 0;
      onProgress(`正在上传完整备份...(${pct}%)`);
    },
  );
  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => "");
    throw new Error(`备份上传失败: ${uploadRes.status} ${errText}`);
  }

  onProgress("完整备份上传完成");
}

export async function listBackupsFromDrive(accessToken: string) {
  const folderId = await getOrCreateBackupFolder(accessToken);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q='${folderId}' in parents and trashed=false&orderBy=createdTime desc&fields=files(id, name, createdTime, size)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('读取备份列表失败');
  const data = await res.json();
  return data.files || [];
}

export async function downloadBackupFromDrive(accessToken: string, fileId: string): Promise<Blob> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('下载备份失败');
  return res.blob();
}

export async function restoreBackupFromBlob(blob: Blob, onProgress: (msg: string) => void): Promise<void> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  onProgress("正在解压备份文件...");
  const loadedZip = await zip.loadAsync(blob);

  // Check if it's the NEW lossless backup format
  const sysDbEntry = loadedZip.file("aitavern_sys_db.json");
  if (sysDbEntry) {
    onProgress("检测到无损完整备份，正在恢复...");
    try {
      const db = await initDB();
      const content = await sysDbEntry.async("string");
      const dbDump = JSON.parse(content);
      
      // Clear and Restore stores
      const storesToRestore = ['folders', 'characters', 'chats', 'chat_metadata', 'memos'] as const;
      for (const store of storesToRestore) {
        if (dbDump[store] && Array.isArray(dbDump[store])) {
           onProgress(`正在恢复 ${store} (${dbDump[store].length}条数据)...`);
           const tx = db.transaction(store as any, 'readwrite');
           const os = tx.objectStore(store as any);
           await os.clear();
           for (const item of dbDump[store]) {
              await os.put(item);
           }
           await tx.done;
        }
      }

      // Restore blobs
      const sysBlobs = Object.values(loadedZip.files).filter(f => !f.dir && f.name.startsWith('sys_blobs/'));
      if (sysBlobs.length > 0) {
        onProgress(`正在解析备份文件结构 (${sysBlobs.length}个二进制文件)...`);
        const db = await initDB();
        const tx = db.transaction('blobs', 'readwrite');
        const os = tx.objectStore('blobs');
        await os.clear();
        
        // Group JSZip references by ID, keeping memory footprint low
        const blobGroups = new Map<string, { avatarFile?: { f: any, ext: string }, originalFile?: { f: any, ext: string } }>();
        
        for (const file of sysBlobs) {
          const parts = file.name.split('/');
          const filename = parts[1]; // {id}_avatar.png or {id}_original
          const lastUnderscore = filename.lastIndexOf('_');
          if (lastUnderscore > 0) {
            const id = filename.substring(0, lastUnderscore);
            let typeWithExt = filename.substring(lastUnderscore + 1); // "avatar.webp" or "original"
            let ext = 'png';
            let type = typeWithExt;
            
            const dotIndex = typeWithExt.lastIndexOf('.');
            if (dotIndex > 0) {
               ext = typeWithExt.substring(dotIndex + 1);
               type = typeWithExt.substring(0, dotIndex);
            }
            
            if (!blobGroups.has(id)) blobGroups.set(id, {});
            const group = blobGroups.get(id)!;
            if (type === 'avatar') group.avatarFile = { f: file, ext };
            if (type === 'original') group.originalFile = { f: file, ext };
          }
        }

        // Now process and save sequentially, loading one blob at a time
        let count = 0;
        for (const [id, group] of blobGroups.entries()) {
          count++;
          if (count % 10 === 0 || count === blobGroups.size) {
            onProgress(`正在导入多媒体与大图等数据 (${count}/${blobGroups.size})...`);
          }
          
          const val: any = {};
          if (group.avatarFile) {
            const b = await group.avatarFile.f.async("blob");
            const mime = b.type || (group.avatarFile.ext === 'webp' ? 'image/webp' : (group.avatarFile.ext.match(/jpe?g/) ? 'image/jpeg' : 'image/png'));
            val.avatarBlob = new Blob([b], { type: mime });
          }
          if (group.originalFile) {
            const b = await group.originalFile.f.async("blob");
            const mime = b.type || (group.originalFile.ext === 'webp' ? 'image/webp' : (group.originalFile.ext.match(/jpe?g/) ? 'image/jpeg' : 'image/png'));
            val.originalFile = new File([b], `original.${group.originalFile.ext}`, { type: mime });
          }
          
          await os.put(val, id);
        }
        await tx.done;
      }
      
      // Restore settings
      const settingsEntry = loadedZip.file("settings.json");
      if (settingsEntry) {
         onProgress("正在恢复系统配置...");
         const settingsContent = await settingsEntry.async("string");
         const savedSettings = JSON.parse(settingsContent);
         for (const [key, val] of Object.entries(savedSettings)) {
            if (val !== null && val !== undefined) {
               localStorage.setItem(key, String(val));
            }
         }
      }

      invalidateCache();
      onProgress("无损完整备份恢复成功！");
      return;
    } catch (err: any) {
       console.error("Failed to restore lossless backup", err);
       onProgress("无损恢复报错，将尝试以兼容模式解析...");
    }
  }

  // --- OLD LOGIC FALLBACK (for strictly compatible zip or older backups) ---
  const foldersEntry = loadedZip.file("folders.json");
  if (foldersEntry) {
    onProgress("正在以兼容模式恢复分类数据...");
    const foldersJson = await foldersEntry.async("string");
    try {
      const folders = JSON.parse(foldersJson);
      for (const folder of folders) {
        await saveFolder(folder);
      }
    } catch (e) {
      console.error("Failed to restore folders", e);
    }
  }

  const foldersEntryCompat = loadedZip.file("folders.json");
  if (foldersEntryCompat) {
    onProgress("正在恢复分类数据...");
    try {
      const db = await initDB();
      const foldersJson = await foldersEntryCompat.async("string");
      const folders = JSON.parse(foldersJson);
      const tx = db.transaction('folders', 'readwrite');
      const os = tx.objectStore('folders');
      await os.clear();
      for (const f of folders) {
        await os.put(f);
      }
      await tx.done;
    } catch (e) {
      console.error("Failed to restore folders", e);
    }
  }

  const memosEntryCompat = loadedZip.file("memos.json");
  if (memosEntryCompat) {
    onProgress("正在恢复备忘录数据...");
    try {
      const db = await initDB();
      const memosJson = await memosEntryCompat.async("string");
      const memos = JSON.parse(memosJson);
      const tx = db.transaction('memos', 'readwrite');
      const os = tx.objectStore('memos');
      await os.clear();
      for (const m of memos) {
        if (m._blobFilename) {
            const blobEntry = loadedZip.file(`Memos/${m._blobFilename}`);
            if (blobEntry) {
                const b = await blobEntry.async("blob");
                m.blob = new Blob([b], { type: m._blobFilename.endsWith('jpg') ? 'image/jpeg' : (m._blobFilename.endsWith('webp') ? 'image/webp' : 'image/png') });
            }
            delete m._blobFilename;
        }
        await os.put(m);
      }
      await tx.done;
    } catch (e) {
      console.error("Failed to restore memos", e);
    }
  }

  const settingsEntryCompat = loadedZip.file("settings.json");
  if (settingsEntryCompat) {
    onProgress("正在恢复系统配置...");
    try {
      const settingsContent = await settingsEntryCompat.async("string");
      const savedSettings = JSON.parse(settingsContent);
      for (const [key, val] of Object.entries(savedSettings)) {
         if (val !== null && val !== undefined) {
            localStorage.setItem(key, String(val));
         }
      }
    } catch (e) {
      console.error("Failed to restore settings compat", e);
    }
  }

  const filesToProcess = Object.values(loadedZip.files);
  const characterFolders = new Map<string, { meta?: any, card?: any, avatar?: Blob }>();

  for (const file of filesToProcess) {
    if (file.dir) continue;
    const lowerName = file.name.toLowerCase();
    if (lowerName.startsWith("characters/")) {
      const parts = file.name.split("/");
      if (parts.length >= 3) {
        const folderName = parts[1];
        const fileName = parts[parts.length - 1];
        if (!characterFolders.has(folderName)) characterFolders.set(folderName, {});
        
        if (fileName === "character.json") {
          const content = await file.async("string");
          try {
            characterFolders.get(folderName)!.meta = JSON.parse(content);
          } catch(e) {}
        } else if (fileName === "card.json" || fileName.endsWith(".json")) {
          const content = await file.async("string");
          try {
             if (fileName === "card.json") {
                characterFolders.get(folderName)!.card = JSON.parse(content);
             } else if (!characterFolders.get(folderName)!.meta) {
                characterFolders.get(folderName)!.meta = JSON.parse(content);
             }
          } catch(e) {}
        } else if (fileName === "avatar.png" || fileName.endsWith(".png") || fileName.endsWith(".webp") || fileName.endsWith(".jpg")) {
          const content = await file.async("blob");
          characterFolders.get(folderName)!.avatar = content;
        }
      }
    }
  }

  // Pre-load all existing characters currently in DB so we can overwrite duplicates by Name
  const existingChars = await getCachedMeta();
  const existingCharsByName = new Map<string, any>();
  for (const c of existingChars) {
    if (c.name) {
      existingCharsByName.set(c.name.trim(), c);
    }
  }

  let charCount = 0;
  for (const [folderName, data] of characterFolders.entries()) {
    if (data.meta || data.card) {
      charCount++;
      if (charCount % 5 === 0) onProgress(`正在以兼容模式恢复角色卡片 (${charCount}/${characterFolders.size})...`);
      
      let charToSave: any = {};
      
      const lastUnderscore = folderName.lastIndexOf('_');
      let fallbackId = folderName;
      let fallbackName = folderName;
      if (lastUnderscore > 0) {
        fallbackName = folderName.substring(0, lastUnderscore);
        fallbackId = folderName.substring(lastUnderscore + 1);
      }

      const metaIsWrapper = data.meta && data.meta.id && data.meta.data;
      
      if (metaIsWrapper) {
        Object.assign(charToSave, data.meta);
      } else {
        const cardData = data.card || data.meta || {};
        charToSave.id = fallbackId;
        charToSave.name = cardData.name || fallbackName;
        charToSave.data = cardData;
        charToSave.createdAt = Date.now();
      }

      // Check if a character with the same name already exists in our local list to automatically overwrite
      const matchedName = (charToSave.name || "").trim();
      if (matchedName && existingCharsByName.has(matchedName)) {
        const existing = existingCharsByName.get(matchedName);
        charToSave.id = existing.id;
        if (existing.folderId && !charToSave.folderId) {
          charToSave.folderId = existing.folderId;
        }
      }

      if (data.avatar) {
        charToSave.avatarBlob = data.avatar;
      }
      
      try {
        await saveCharacter(charToSave);
      } catch (err) {
        console.error("Failed to restore character compat:", charToSave.id, err);
      }
    }
  }

  const chatFiles = filesToProcess.filter(f => !f.dir && f.name.toLowerCase().startsWith("chats/") && f.name.endsWith(".jsonl"));
  onProgress(`正在解析兼容版聊天记录 (${chatFiles.length})...`);
  
  const chatsToSave = [];
  let chatParseCount = 0;
  for (const file of chatFiles) {
    chatParseCount++;
    if (chatParseCount % 10 === 0) onProgress(`正在解析兼容版聊天记录 (${chatParseCount}/${chatFiles.length})...`);
    
    const content = await file.async("string");
    const lines = content.split('\n').filter(l => l.trim() !== '');
    const messages = [];
    for (const line of lines) {
      try {
        messages.push(JSON.parse(line));
      } catch(e) {}
    }
    
    if (messages.length > 0) {
      const parts = file.name.split("/");
      const fileName = parts[2];
      
      const fileNameWithoutExt = fileName.replace(".jsonl", "");
      const dateMatch = fileNameWithoutExt.match(/_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)$/);
      let safeChatName = fileNameWithoutExt;
      let createdAtStr = new Date().toISOString();
      
      if (dateMatch) {
         safeChatName = fileNameWithoutExt.substring(0, fileNameWithoutExt.length - dateMatch[0].length);
         createdAtStr = dateMatch[1].replace(/-/g, ':').replace(/T(\d{2}):(\d{2}):(\d{2}):(\d{3})Z/, 'T$1:$2:$3.$4Z');
      } else {
         createdAtStr = new Date().toISOString();
      }

      const safeCharFolderFromPath = parts[1];
      let targetCharId = "";
      for (const [folderName, data] of characterFolders.entries()) {
         if ((data.meta || data.card) && folderName.startsWith(safeCharFolderFromPath)) {
            if (data.meta && data.meta.id) {
               targetCharId = data.meta.id;
            } else {
               const lastUnderscore = folderName.lastIndexOf('_');
               if (lastUnderscore > 0) {
                 targetCharId = folderName.substring(lastUnderscore + 1);
               } else {
                 targetCharId = folderName;
               }
            }
            break;
         }
      }
      
      const newChatId = "cloud-sync-" + Math.random().toString(36).substring(2, 9) + Date.now();
      
      chatsToSave.push({
         id: newChatId,
         characterId: targetCharId,
         name: safeChatName || "Recovered Chat",
         messages: messages,
         createdAt: new Date(createdAtStr).getTime() || Date.now(),
         updatedAt: Date.now()
      });
    }
  }

  if (chatsToSave.length > 0) {
    onProgress("正在保存兼容版聊天记录...");
    await saveChatsBulk(chatsToSave, (c, t) => {
      onProgress(`正在保存兼容版聊天记录到数据库 (${c}/${t})...`);
    });
  }

  invalidateCache();
  onProgress("数据恢复成功！");
}

export async function deleteBackupFromDrive(accessToken: string, fileId: string) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('删除备份失败');
}

export const triggerManualBackup = (token: string) => {
  if (syncState.isActive) throw new Error("已有备份/恢复任务正在进行中");
  
  updateSyncState({ isActive: true, taskName: '手动备份', message: '准备备份...', isError: false, completed: false });
  
  uploadBackupToDrive(token, (msg) => {
    updateSyncState({ message: msg });
  }, false).then(() => {
    updateSyncState({ isActive: false, completed: true, message: '备份完成' });
  }).catch((e: any) => {
    updateSyncState({ isActive: false, isError: true, message: `备份失败: ${e.message}` });
  });
};

export const triggerRestore = (token: string, fileId: string) => {
  if (syncState.isActive) throw new Error("已有备份/恢复任务正在进行中");
  updateSyncState({ isActive: true, taskName: '恢复数据', message: '正在从云端下载...', isError: false, completed: false });
  
  (async () => {
    try {
      const blob = await downloadBackupFromDrive(token, fileId);
      await restoreBackupFromBlob(blob, (msg) => updateSyncState({ message: msg }));
      updateSyncState({ isActive: false, completed: true, message: '数据恢复成功，即将刷新页面...' });
      setTimeout(() => window.location.reload(), 2000);
    } catch (e: any) {
      updateSyncState({ isActive: false, isError: true, message: `恢复失败: ${e.message}` });
    }
  })();
};

