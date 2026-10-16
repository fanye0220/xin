import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, signInWithRedirect, GoogleAuthProvider, onAuthStateChanged, User, signInWithCredential } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { getFolders, getCachedMeta, getCharacter, getAllChatsMetadata, getChatById, saveFolder, saveCharacter, saveChatsBulk, invalidateCache, initDB } from './db';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { resumableUploadToDrive } from './driveUpload';
import { CURRENT_APP_VERSION } from '../config/version';

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

/** 是否有同步/备份任务正在进行中（挂机自动同步也算）。手动任务开跑前先问一下这个，避免两个任务撞在一起。 */
export function isSyncTaskBusy(): boolean {
  return syncState.isActive;
}

export function clearSyncState() {
  if (syncClearTimer) {
    clearTimeout(syncClearTimer);
    syncClearTimer = null;
  }
  syncState = { isActive: false, taskName: '', message: '', isError: false, completed: false };
  syncListeners.forEach(fn => fn(syncState));
}

let syncClearTimer: any = null;

export function updateSyncState(update: Partial<SyncState>) {
  if (syncClearTimer) {
    clearTimeout(syncClearTimer);
    syncClearTimer = null;
  }
  syncState = { ...syncState, ...update };
  syncListeners.forEach(fn => fn(syncState));
  
  // 保留完成或错误状态至少 60 秒常驻，让用户切到卡里也能清楚知道已完成；用户随时可点击 X 提前关闭
  if (!syncState.isActive && (syncState.completed || syncState.isError)) {
    syncClearTimer = setTimeout(() => {
      if (!syncState.isActive) {
        clearSyncState();
      }
    }, 60000);
  }
}

let autoSyncInterval: any = null;
let currentAccessToken: string | null = null;

export const getAuthCurrentUser = (): User | null => auth.currentUser;

export async function ensureValidAccessToken(): Promise<string | null> {
  const expirationStr = localStorage.getItem('google_drive_token_expiration');
  const tokenExpiration = expirationStr ? Number(expirationStr) : 0;
  
  if (cachedAccessToken && tokenExpiration > Date.now() + 60000) {
    return cachedAccessToken;
  }

  // Token is expired or missing. Try silent native refresh if on Android
  if (Capacitor.isNativePlatform()) {
    try {
      const result = await FirebaseAuthentication.signInWithGoogle({ scopes: ['https://www.googleapis.com/auth/drive.file'] });
      if (result.credential?.accessToken) {
        cachedAccessToken = result.credential.accessToken;
        const expiresAt = Date.now() + 3500 * 1000;
        localStorage.setItem('google_drive_access_token', cachedAccessToken);
        localStorage.setItem('google_drive_token_expiration', expiresAt.toString());
        currentAccessToken = cachedAccessToken;
        const currentUser = auth.currentUser;
        if (currentUser) {
          window.dispatchEvent(new CustomEvent('google_auth_changed', { detail: { user: currentUser, token: cachedAccessToken } }));
        }
        return cachedAccessToken;
      }
    } catch (e) {
      console.log('[NativeAuth] Silent Google token refresh info:', e);
    }
  }

  return cachedAccessToken;
}

function saveUserInfo(user: User) {
  try {
    const info = {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
    };
    localStorage.setItem('google_drive_user_info', JSON.stringify(info));
  } catch (e) {}
}

export function getStoredUserInfo(): any | null {
  try {
    const data = localStorage.getItem('google_drive_user_info');
    return data ? JSON.parse(data) : null;
  } catch (e) {
    return null;
  }
}

// Initialize auth state listener. Call this on app load.
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  // Check for stored user info immediately to avoid flickering/jumping to login UI
  const existingUser = getStoredUserInfo();
  if (existingUser && onAuthSuccess) {
    onAuthSuccess(existingUser as User, cachedAccessToken || "");
  }

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
          saveUserInfo(result.user);
          window.dispatchEvent(new CustomEvent('google_auth_changed', { detail: { user: result.user, token: cachedAccessToken } }));
          if (onAuthSuccess) onAuthSuccess(result.user, cachedAccessToken);
        }
      }
    }).catch(e => {
      console.error("Redirect auth error:", e);
    });
  });

  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      saveUserInfo(user);
      let validToken = await ensureValidAccessToken();

      if (validToken) {
        currentAccessToken = validToken;
        startAutoSyncRunner();
      }

      window.dispatchEvent(new CustomEvent('google_auth_changed', { detail: { user, token: validToken || "" } }));
      if (onAuthSuccess) onAuthSuccess(user, validToken || "");
    } else {
      const storedUser = getStoredUserInfo();
      if (storedUser) {
        // Firebase 掉线但本地还留着用户信息：先尝试拿有效 token，拿到才算真的已登录
        const restoredToken = await ensureValidAccessToken();
        if (restoredToken) {
          cachedAccessToken = restoredToken;
          currentAccessToken = restoredToken;
          startAutoSyncRunner();
          const restoredUser = (auth.currentUser || storedUser) as User;
          if (auth.currentUser) saveUserInfo(auth.currentUser);
          window.dispatchEvent(new CustomEvent('google_auth_changed', { detail: { user: restoredUser, token: restoredToken } }));
          if (onAuthSuccess) onAuthSuccess(restoredUser, restoredToken);
        } else {
          cachedAccessToken = null;
          currentAccessToken = null;
          localStorage.removeItem('google_drive_access_token');
          localStorage.removeItem('google_drive_token_expiration');
          localStorage.removeItem('google_drive_user_info');
          stopAutoSyncRunner();
          window.dispatchEvent(new CustomEvent('google_auth_changed', { detail: { user: null, token: null } }));
          if (onAuthFailure) onAuthFailure();
        }
      } else {
        cachedAccessToken = null;
        currentAccessToken = null;
        stopAutoSyncRunner();
        window.dispatchEvent(new CustomEvent('google_auth_changed', { detail: { user: null, token: null } }));
        if (onAuthFailure) onAuthFailure();
      }
    }
  });
};

function startAutoSyncRunner() {
  if (autoSyncInterval) return;
  
  autoSyncInterval = setInterval(async () => {
    const isEnabled = localStorage.getItem('miu_auto_backup') === '1';
    if (!isEnabled || !currentAccessToken || syncState.isActive) return;

    // 挂机时 token 很可能已经过期（约 1 小时）。先用 ensureValidAccessToken
    // 静默刷新，拿不到有效 token 就明确停下来报警，而不是带着坏 token
    // 空跑 30 分钟、每张卡都 401 却还报"同步完成"。
    const validToken = await ensureValidAccessToken();
    // 网页端没有静默刷新，ensureValidAccessToken 过期时会把旧 token 原样返回，
    // 于是挂机会拿着坏 token 白跑一轮（全部 401）。这里显式判一次过期时间，
    // 直接停下来提示重新登录，不要静默空跑。
    const expStr = localStorage.getItem('google_drive_token_expiration');
    const exp = expStr ? Number(expStr) : 0;
    const tokenExpiredOnWeb = !Capacitor.isNativePlatform() && exp > 0 && exp <= Date.now();
    if (!validToken || tokenExpiredOnWeb) {
      updateSyncState({ isActive: false, completed: false, isError: true, taskName: '挂机自动同步', message: '已停止：Google 登录已过期，请重新登录后再开启' });
      return;
    }
    currentAccessToken = validToken;

    const syncMode = localStorage.getItem('miu_auto_backup_mode') || 'cloud_library';

    if (syncMode === 'zip') {
      updateSyncState({ isActive: true, taskName: '挂机自动备份', message: '准备打包备份...', isError: false, completed: false });
      try {
        const stats = await uploadBackupToDrive(validToken, (msg) => {
          updateSyncState({ message: msg });
        }, true);
        if (stats.skippedCharacters > 0 || stats.skippedChats > 0 || stats.missingCardFiles > 0) {
          updateSyncState({ isActive: false, completed: false, isError: true, taskName: '挂机自动备份', message: `已自动备份，但有内容被跳过：角色 ${stats.skippedCharacters} 个 / 聊天 ${stats.skippedChats} 条 / 原卡文件 ${stats.missingCardFiles} 个` });
        } else {
          updateSyncState({ isActive: false, completed: true, taskName: '挂机自动备份', message: '已自动备份完成' });
        }
      } catch (e: any) {
        console.error("[AutoSync] Scheduled ZIP backup failed:", e);
        updateSyncState({ isActive: false, isError: true, message: `自动备份失败: ${e.message}` });
      }
    } else {
      updateSyncState({ isActive: true, taskName: '挂机自动同步', message: '准备自动同步卡片到云端卡库...', isError: false, completed: false });
      try {
        const { syncLibraryToCloud } = await import('./cloudDrive');
        const result = await syncLibraryToCloud(validToken, (msg) => {
          updateSyncState({ message: msg });
        });
        if (result.failed > 0) {
          updateSyncState({ isActive: false, completed: false, isError: true, taskName: '挂机自动同步', message: `已自动同步，但有 ${result.failed}/${result.total} 个失败：${result.failedSamples.join('；')}` });
        } else if (result.success + result.moved > 0) {
          updateSyncState({ isActive: false, completed: true, taskName: '挂机自动同步', message: `已自动同步：上传 ${result.success}，移动 ${result.moved}，跳过 ${result.skipped}` });
        } else {
          // 这一轮什么都没变（全是"内容一致已跳过"）。不弹悬浮窗，
          // 免得盖掉用户自己刚点的那次任务的结果，看着像两个说法打架。
          clearSyncState();
        }
      } catch (e: any) {
        console.error("[AutoSync] Scheduled cloud library sync failed:", e);
        updateSyncState({ isActive: false, isError: true, message: `云端卡库同步失败: ${e.message}` });
      }
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
    let resultUser: User | null = null;
    let resultAccessToken: string | null = null;

    // 新版 Credential Manager 不可用（国行 ROM 上 Google Play 服务缺失或过旧）时抛出的错误特征，
    // 典型报错: "Your device doesn't support credential manager"
    const isCredentialManagerUnavailable = (err: any) => {
      const msg = String((err && err.message) || err || '');
      const code = String((err && err.code) || '');
      return /credential manager|doesn'?t support|no credential|NoCredential/i.test(msg + ' ' + code);
    };

    const nativeScopes = ['https://www.googleapis.com/auth/drive.file'];
    const runNativeSignIn = async (options: any) => {
      const result = await FirebaseAuthentication.signInWithGoogle(options);
      if (!result.credential?.idToken) {
        throw new Error('No credential returned from native Google Sign-In');
      }
      const firebaseCred = GoogleAuthProvider.credential(result.credential.idToken, result.credential.accessToken);
      const authResult = await signInWithCredential(auth, firebaseCred);
      resultUser = authResult.user;
      resultAccessToken = result.credential.accessToken || null;
    };

    let nativeFailed: any = null;

    if (Capacitor.isNativePlatform()) {
      try {
        // 先走系统默认（新版凭据管理器 Credential Manager）
        await runNativeSignIn({ scopes: nativeScopes });
      } catch (firstErr: any) {
        console.warn('[NativeAuth] Native Google Sign-In failed:', firstErr);
        if (!isCredentialManagerUnavailable(firstErr)) {
          // 用户取消之类的其它情况，直接按原样抛出，不再弹第二次
          throw firstErr;
        }
        try {
          // 凭据管理器不可用（常见于国行 vivo / 华为 / 小米 / OPPO 等缺少新版 Google 服务的机器），
          // 退回旧版 Google 登录流程，它对 Google Play 服务版本要求更低。
          await runNativeSignIn({ scopes: nativeScopes, useCredentialManager: false });
        } catch (secondErr: any) {
          console.warn('[NativeAuth] Legacy Google Sign-In failed:', secondErr);
          nativeFailed = secondErr || firstErr;
        }
      }
    } else {
      try {
        const result = await signInWithPopup(auth, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (!credential?.accessToken) {
          throw new Error('Failed to get access token from Firebase Auth');
        }
        resultUser = result.user;
        resultAccessToken = credential.accessToken;
      } catch (popupErr: any) {
        const pMsg = String((popupErr && popupErr.message) || popupErr || '');
        const pCode = String((popupErr && popupErr.code) || '');
        console.warn('[WebAuth] Web popup failed, attempting redirect:', popupErr);
        if (pMsg.includes('disallowed_useragent') || pCode.includes('disallowed_useragent')) {
          throw new Error('Google 不允许在应用内置网页里登录（disallowed_useragent）。请在手机浏览器里打开网页版登录一次，或换一台有正常 Google 服务的设备。');
        }
        try {
          await signInWithRedirect(auth, provider);
          return null;
        } catch (redirectErr: any) {
          const rMsg = String((redirectErr && redirectErr.message) || redirectErr || '');
          if (rMsg.includes('disallowed_useragent')) {
            throw new Error('Google 不允许在应用内置网页里登录（disallowed_useragent）。请在手机浏览器里打开网页版登录一次，或换一台有正常 Google 服务的设备。');
          }
          throw new Error(redirectErr?.message || pMsg);
        }
      }
    }

    if (!resultUser) {
      if (isCredentialManagerUnavailable(nativeFailed)) {
        throw new Error('这台机器缺少可用的 Google 服务（登录用的凭据管理器不可用），无法在应用内登录云端备份。请把 Google Play 服务升级到较新版本后重试，或换一台有正常 Google 服务的设备。');
      }
      throw new Error(String((nativeFailed && nativeFailed.message) || nativeFailed || '无法完成 Google 账号登录'));
    }

    cachedAccessToken = resultAccessToken;
    if (resultUser) {
      saveUserInfo(resultUser as User);
    }
    const expiresAt = Date.now() + 3500 * 1000;
    if (cachedAccessToken) {
      localStorage.setItem('google_drive_access_token', cachedAccessToken);
      localStorage.setItem('google_drive_token_expiration', expiresAt.toString());
      currentAccessToken = cachedAccessToken;
    }
    startAutoSyncRunner();
    window.dispatchEvent(new CustomEvent('google_auth_changed', { detail: { user: resultUser, token: cachedAccessToken } }));
    return { user: resultUser as User, accessToken: cachedAccessToken! };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return await ensureValidAccessToken();
};

export const logout = async () => {
  if (Capacitor.isNativePlatform()) {
    await FirebaseAuthentication.signOut();
  }
  await auth.signOut();
  cachedAccessToken = null;
  localStorage.removeItem('google_drive_access_token');
  localStorage.removeItem('google_drive_token_expiration');
  localStorage.removeItem('google_drive_user_info');
  window.dispatchEvent(new CustomEvent('google_auth_changed', { detail: { user: null, token: null } }));
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
  'miu_auto_backup_mode',
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

export type BackupExportStats = {
  characters: number;
  chats: number;
  memos: number;
  skippedCharacters: number;
  skippedChats: number;
  missingCardFiles: number;
  issues: string[];
};

export type BackupExportResult = {
  blob: Blob;
  stats: BackupExportStats;
};

export async function exportAllDataForBackup(onProgress: (msg: string) => void): Promise<BackupExportResult> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();

  const db = await initDB();

  const stats: BackupExportStats = {
    characters: 0,
    chats: 0,
    memos: 0,
    skippedCharacters: 0,
    skippedChats: 0,
    missingCardFiles: 0,
    issues: [],
  };
  const noteIssue = (msg: string) => {
    if (stats.issues.length < 20) stats.issues.push(msg);
  };

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
  stats.memos = processedMemos.length;

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
    if (i % 25 === 0) {
      onProgress(`正在打包角色文件 (${i + 1}/${chars.length})...`);
      await new Promise((r) => setTimeout(r, 15));
    }
    const char = await getCharacter(chars[i].id);
    if (!char) {
      stats.skippedCharacters++;
      noteIssue(`角色数据读取失败，已跳过: ${chars[i].name || chars[i].id}`);
      continue;
    }
    if (char.deletedAt) continue;
    
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
        } catch(e: any) {
            stats.missingCardFiles++;
            noteIssue(`读取本地原卡文件失败: ${char.name || char.id} (${e?.message || e})`);
        }
    }

    if (charOriginalFile) {
       const extension = charOriginalFile.name ? charOriginalFile.name.split('.').pop() || 'png' : 'png';
       zip.file(`${folderPath}/${safeCharName}.${extension}`, new Blob([charOriginalFile], { type: charOriginalFile.type || 'image/png' }), { compression: "STORE" });
    }
    
    zip.file(`${folderPath}/${safeCharName}.json`, JSON.stringify(char.data || {}));
    
    const versionHistory = (char.versionHistory || []).map(v => ({
      id: v.id,
      versionName: v.versionName,
      note: v.note,
      createdAt: v.createdAt,
      fileModifiedAt: v.fileModifiedAt,
      cardName: v.cardName,
      sourceCharId: v.sourceCharId,
      tags: v.tags,
      data: v.data,
    }));

    zip.file(`${folderPath}/character.json`, JSON.stringify({
      id: char.id,
      name: char.name,
      createdAt: char.createdAt,
      updatedAt: char.updatedAt,
      fileModifiedAt: char.fileModifiedAt,
      folderId: char.folderId,
      sortOrder: char.sortOrder,
      autoImportFilename: char.autoImportFilename,
      tags: char.tags,
      versionHistory,
      data: char.data || {}
    }));

    if (char.versionHistory && char.versionHistory.length > 0) {
      for (const snap of char.versionHistory) {
        if (snap.completeCardPngBlob) {
          zip.file(`${folderPath}/Versions/${snap.id}.png`, snap.completeCardPngBlob, { compression: "STORE" });
        } else if (snap.avatarBlob) {
          // 快照不再持久化整张 PNG(体积太大), 这里现把角色数据写回头像,
          // 保证导出/备份出来的仍然是能重新导入酒馆的完整角色卡。
          try {
            const { injectTavernData } = await import("./png");
            const arrayBuf = await snap.avatarBlob.arrayBuffer();
            zip.file(`${folderPath}/Versions/${snap.id}.png`, injectTavernData(arrayBuf, snap.data), { compression: "STORE" });
          } catch {
            zip.file(`${folderPath}/Versions/${snap.id}.png`, snap.avatarBlob, { compression: "STORE" });
          }
        }
      }
    }

    if (char.avatarHistory && char.avatarHistory.length > 0) {
      for (let idx = 0; idx < char.avatarHistory.length; idx++) {
        const ab = char.avatarHistory[idx];
        if (!ab) continue;
        let ext = 'png';
        if (ab.type === 'image/jpeg') ext = 'jpg';
        else if (ab.type === 'image/webp') ext = 'webp';
        zip.file(`${folderPath}/AvatarHistory/avatar_${idx + 1}.${ext}`, ab, { compression: "STORE" });
      }
    }
    
    if (charAvatarBlob && !charOriginalFile) {
       zip.file(`${folderPath}/avatar.png`, new Blob([charAvatarBlob], { type: charAvatarBlob.type || 'image/png' }), { compression: "STORE" });
    }

    stats.characters++;
  }

  const allChats = await getAllChatsMetadata();
  onProgress(`正在导出聊天记录 (总数: ${allChats.length})...`);
  for (let i = 0; i < allChats.length; i++) {
    if (i % 25 === 0) {
      onProgress(`正在打包聊天记录 (${i + 1}/${allChats.length})...`);
      await new Promise((r) => setTimeout(r, 15));
    }
    const chatInfo = allChats[i] as any;
    if (chatInfo.deletedAt) continue;
    
    const chat = await getChatById(chatInfo.id);
    if (!chat) {
      stats.skippedChats++;
      noteIssue(`聊天记录读取失败，已跳过: ${chatInfo.name || chatInfo.id}`);
      continue;
    }
    
    const charMeta = chars.find(c => c.id === chat.characterId);
    const charName = charMeta ? charMeta.name : "Unknown";
    const safeCharName = charName.replace(/[/\\?%*:|"<>]/g, '_');
    const safeChatName = chat.name ? chat.name.replace(/[/\\?%*:|"<>]/g, '_') : 'Unnamed';
    
    const formattedDate = new Date(chat.createdAt).toISOString().replace(/[:.]/g, "-");
    const filename = `${safeChatName}_${formattedDate}.jsonl`;
    
    const jsonlString = chat.messages.map((m: any) => JSON.stringify(m)).join('\n');
    zip.file(`Chats/${safeCharName}/${filename}`, jsonlString);

    stats.chats++;
  }

  // Handle memos correctly, avoid stringifying Blobs by skipping them or converting?
  // Wait, the current logic already just does JSON.stringify(memos). It's flawed for images but that's what it was.
  
  onProgress("打包中，请稍候...");

  // 备份清单：记录这次到底打包了哪些东西、跳过了什么。
  // 备份体积/条数异常时，用户和自己都能一眼看出来是不是"假成功"。
  const manifest = {
    app: 'MIU',
    version: CURRENT_APP_VERSION,
    exportedAt: new Date().toISOString(),
    counts: { characters: stats.characters, chats: stats.chats, memos: stats.memos },
    skipped: {
      characters: stats.skippedCharacters,
      chats: stats.skippedChats,
      missingCardFiles: stats.missingCardFiles,
    },
    issues: stats.issues,
  };
  zip.file("_manifest.json", JSON.stringify(manifest, null, 2));

  const blob = await zip.generateAsync({ 
    type: "blob", 
    compression: "DEFLATE",
    compressionOptions: {
      level: 6
    }
  });
  return { blob, stats };

}

export type BackupRecord = {
  at: number;
  ok: boolean;
  size?: number;
  fileName?: string;
  note?: string;
};

export function recordBackupResult(record: BackupRecord) {
  try {
    localStorage.setItem('miu_last_backup_record', JSON.stringify(record));
  } catch {}
}

export function getLastBackupRecord(): BackupRecord | null {
  try {
    const raw = localStorage.getItem('miu_last_backup_record');
    return raw ? (JSON.parse(raw) as BackupRecord) : null;
  } catch {
    return null;
  }
}

export async function uploadBackupToDrive(accessToken: string, onProgress: (msg: string) => void, isAutoBackup: boolean = false): Promise<BackupExportStats> {
  onProgress("正在打包完整备份...");
  const { blob: zipBlob, stats } = await exportAllDataForBackup(onProgress);

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
    recordBackupResult({ at: Date.now(), ok: false, size: zipBlob.size, fileName: filename, note: `上传失败 HTTP ${uploadRes.status}` });
    throw new Error(`备份上传失败: ${uploadRes.status} ${errText}`);
  }

  // 上传返回 200 只代表"传完了"，不代表"云端存对了"。
  // 这里再回读一次云端文件大小，跟本地 zip 对不上就判失败，避免"假备份成功"。
  let uploadedFileId: string | null = null;
  let remoteSize: number | null = null;
  try {
    const meta: any = await uploadRes.json();
    if (meta && meta.id) uploadedFileId = String(meta.id);
    if (meta && meta.size !== undefined && meta.size !== null && meta.size !== "") {
      const n = Number(meta.size);
      if (!Number.isNaN(n)) remoteSize = n;
    }
  } catch {}

  if (uploadedFileId && remoteSize === null) {
    try {
      const verifyRes = await fetch(`https://www.googleapis.com/drive/v3/files/${uploadedFileId}?fields=size`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (verifyRes.ok) {
        const vMeta: any = await verifyRes.json();
        if (vMeta && vMeta.size !== undefined && vMeta.size !== null) {
          const n = Number(vMeta.size);
          if (!Number.isNaN(n)) remoteSize = n;
        }
      }
    } catch {}
  }

  const skippedParts: string[] = [];
  if (stats.skippedCharacters > 0) skippedParts.push(`跳过角色 ${stats.skippedCharacters} 个`);
  if (stats.skippedChats > 0) skippedParts.push(`跳过聊天 ${stats.skippedChats} 条`);
  if (stats.missingCardFiles > 0) skippedParts.push(`原卡文件缺失 ${stats.missingCardFiles} 个`);
  const skippedNote = skippedParts.length > 0 ? `（注意：${skippedParts.join('，')}）` : '';

  if (remoteSize !== null && remoteSize !== zipBlob.size) {
    recordBackupResult({ at: Date.now(), ok: false, size: zipBlob.size, fileName: filename, note: `云端大小 ${remoteSize} 与本地 ${zipBlob.size} 不一致` });
    throw new Error(`备份校验失败：云端文件 ${remoteSize} 字节，本地 ${zipBlob.size} 字节，备份可能不完整`);
  }

  recordBackupResult({
    at: Date.now(),
    ok: true,
    size: zipBlob.size,
    fileName: filename,
    note: [skippedNote, remoteSize === null ? '（未回读到云端大小，未做大小校验）' : ''].filter(Boolean).join(' '),
  });

  onProgress(`完整备份上传完成${skippedNote}${remoteSize === null ? '（未回读到云端大小，未做校验）' : ''}`);
  return stats;
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

export type BackupRestoreResult = {
  failedFolders: number;
  failedMemos: number;
  failedSettings: number;
  failedCharacters: number;
  failedChatFiles: number;
  issues: string[];
  mode: 'lossless' | 'compat';
};

export async function restoreBackupFromBlob(blob: Blob, onProgress: (msg: string) => void): Promise<BackupRestoreResult> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  onProgress("正在解压备份文件...");
  const loadedZip = await zip.loadAsync(blob);

  const restoreResult: BackupRestoreResult = {
    failedFolders: 0,
    failedMemos: 0,
    failedSettings: 0,
    failedCharacters: 0,
    failedChatFiles: 0,
    issues: [],
    mode: 'compat',
  };
  const noteRestoreIssue = (msg: string) => {
    if (restoreResult.issues.length < 20) restoreResult.issues.push(msg);
  };

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
      restoreResult.mode = 'lossless';
      onProgress("无损完整备份恢复成功！");
      return restoreResult;
    } catch (err: any) {
       console.error("Failed to restore lossless backup", err);
       onProgress("无损恢复报错，将尝试以兼容模式解析...");
    }
  }

  // --- OLD LOGIC FALLBACK (for strictly compatible zip or older backups) ---
  const foldersEntry = loadedZip.file("folders.json");
  if (foldersEntry) {
    onProgress("正在恢复分类数据...");
    try {
      const db = await initDB();
      const foldersJson = await foldersEntry.async("string");
      const folders = JSON.parse(foldersJson);
      const tx = db.transaction('folders', 'readwrite');
      const os = tx.objectStore('folders');
      await os.clear();
      for (const f of folders) {
        await os.put(f);
      }
      await tx.done;
    } catch (e: any) {
      console.error("Failed to restore folders", e);
      restoreResult.failedFolders++;
      noteRestoreIssue(`分类数据恢复失败: ${e?.message || e}`);
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
    } catch (e: any) {
      console.error("Failed to restore memos", e);
      restoreResult.failedMemos++;
      noteRestoreIssue(`备忘录恢复失败: ${e?.message || e}`);
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
    } catch (e: any) {
      console.error("Failed to restore settings compat", e);
      restoreResult.failedSettings++;
      noteRestoreIssue(`系统配置恢复失败: ${e?.message || e}`);
    }
  }

  const filesToProcess = Object.values(loadedZip.files);
  const characterFolders = new Map<string, { meta?: any, card?: any, avatar?: Blob, versions?: Map<string, Blob>, avatarHistory?: Blob[] }>();

  for (const file of filesToProcess) {
    if (file.dir) continue;
    const lowerName = file.name.toLowerCase();
    if (lowerName.startsWith("characters/")) {
      const parts = file.name.split("/");
      if (parts.length >= 3) {
        const folderName = parts[1];
        const fileName = parts[parts.length - 1];
        if (!characterFolders.has(folderName)) characterFolders.set(folderName, {});
        const folderEntry = characterFolders.get(folderName)!;
        
        if (lowerName.includes("/versions/")) {
          const vId = fileName.replace(/\.[^/.]+$/, "");
          if (!folderEntry.versions) folderEntry.versions = new Map();
          folderEntry.versions.set(vId, await file.async("blob"));
        } else if (lowerName.includes("/avatarhistory/")) {
          if (!folderEntry.avatarHistory) folderEntry.avatarHistory = [];
          folderEntry.avatarHistory.push(await file.async("blob"));
        } else if (fileName === "character.json") {
          const content = await file.async("string");
          try {
            folderEntry.meta = JSON.parse(content);
          } catch(e: any) {
            restoreResult.failedCharacters++;
            noteRestoreIssue(`角色元数据解析失败 (${file.name}): ${e?.message || e}`);
          }
        } else if (fileName === "card.json" || fileName.endsWith(".json")) {
          const content = await file.async("string");
          try {
             if (fileName === "card.json") {
                folderEntry.card = JSON.parse(content);
             } else if (!folderEntry.meta) {
                folderEntry.meta = JSON.parse(content);
             }
          } catch(e: any) {
            restoreResult.failedCharacters++;
            noteRestoreIssue(`卡片数据解析失败 (${file.name}): ${e?.message || e}`);
          }
        } else if (fileName === "avatar.png" || fileName.endsWith(".png") || fileName.endsWith(".webp") || fileName.endsWith(".jpg")) {
          const content = await file.async("blob");
          folderEntry.avatar = content;
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

  const charsToRestore: any[] = [];
  let charCount = 0;
  for (const [folderName, data] of characterFolders.entries()) {
    if (data.meta || data.card) {
      charCount++;
      if (charCount % 10 === 0) onProgress(`正在解析角色卡片 (${charCount}/${characterFolders.size})...`);
      
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

      if (data.avatarHistory && data.avatarHistory.length > 0) {
        charToSave.avatarHistory = data.avatarHistory;
      }

      if (charToSave.versionHistory && Array.isArray(charToSave.versionHistory)) {
        for (const snap of charToSave.versionHistory) {
          if (data.versions && data.versions.has(snap.id)) {
            const vBlob = data.versions.get(snap.id)!;
            snap.avatarBlob = vBlob;
            snap.completeCardPngBlob = vBlob;
          }
        }
      }
      
      charsToRestore.push(charToSave);
    }
  }

  if (charsToRestore.length > 0) {
    onProgress(`正在批量保存恢复的角色卡片 (${charsToRestore.length}个)...`);
    const { saveCharacters } = await import("./db");
    const BATCH_SIZE = 50;
    for (let b = 0; b < charsToRestore.length; b += BATCH_SIZE) {
      const batch = charsToRestore.slice(b, b + BATCH_SIZE);
      const currentDone = Math.min(b + batch.length, charsToRestore.length);
      onProgress(`正在写入数据库 (${currentDone}/${charsToRestore.length})...`);
      try {
        await saveCharacters(batch);
      } catch (e: any) {
        restoreResult.failedCharacters += batch.length;
        noteRestoreIssue(`写入角色卡片失败 (${batch.length}个): ${e?.message || e}`);
      }
      await new Promise(r => setTimeout(r, 0));
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
    let badLines = 0;
    for (const line of lines) {
      try {
        messages.push(JSON.parse(line));
      } catch(e: any) {
        badLines++;
      }
    }
    if (badLines > 0) {
      restoreResult.failedChatFiles++;
      noteRestoreIssue(`聊天记录有 ${badLines} 行无法解析 (${file.name})`);
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
  const totalRestoreFailures =
    restoreResult.failedFolders +
    restoreResult.failedMemos +
    restoreResult.failedSettings +
    restoreResult.failedCharacters +
    restoreResult.failedChatFiles;
  if (totalRestoreFailures > 0) {
    const sample = restoreResult.issues.slice(0, 3).join('；');
    onProgress(`数据恢复完成，但有 ${totalRestoreFailures} 项失败，其余内容已恢复${sample ? `。${sample}` : ''}`);
  } else {
    onProgress("数据恢复成功！");
  }
  return restoreResult;
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
  }, false).then((stats) => {
    const skipped: string[] = [];
    if (stats.skippedCharacters > 0) skipped.push(`跳过角色 ${stats.skippedCharacters} 个`);
    if (stats.skippedChats > 0) skipped.push(`跳过聊天 ${stats.skippedChats} 条`);
    if (stats.missingCardFiles > 0) skipped.push(`原卡文件缺失 ${stats.missingCardFiles} 个`);
    if (skipped.length > 0) {
      updateSyncState({ isActive: false, completed: false, isError: true, message: `备份完成，但有内容被跳过：${skipped.join('，')}` });
    } else {
      updateSyncState({ isActive: false, completed: true, message: '备份完成' });
    }
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
      const restoreResult = await restoreBackupFromBlob(blob, (msg) => updateSyncState({ message: msg }));
      const failed = restoreResult.failedFolders + restoreResult.failedMemos + restoreResult.failedSettings +
        restoreResult.failedCharacters + restoreResult.failedChatFiles;
      if (failed > 0) {
        updateSyncState({
          isActive: false,
          completed: false,
          isError: true,
          message: `数据恢复完成，但有 ${failed} 项失败（其余已恢复），即将刷新页面...`,
        });
      } else {
        updateSyncState({ isActive: false, completed: true, message: '数据恢复成功，即将刷新页面...' });
      }
      setTimeout(() => window.location.reload(), 2000);
    } catch (e: any) {
      updateSyncState({ isActive: false, isError: true, message: `恢复失败: ${e.message}` });
    }
  })();
};

