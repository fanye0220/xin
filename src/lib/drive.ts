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

// ============================================================================
// Token 刷新 / 过期处理
//
// 之前这里没有任何续期逻辑：拿到 Google OAuth access token 后假设它能活
// 3500 秒，之后无论是自动备份（每 30 分钟跑一次）、手动备份、单卡云同步，
// 全都直接拿旧 token 发请求——过期了（通常 1 小时左右）就只会收到 401，
// 而这里完全没处理 401，用户只会看到一坨看不懂的错误信息，得自己想到要
// "退出重新登录"才能恢复。
//
// 这里补上：
// 1. getValidAccessToken()：每次云端操作前先检查 token 是否快过期（提前
//    5 分钟这个安全余量），快过期就先尝试静默刷新一次，成功了才继续。
// 2. driveApiFetch()：给普通的 JSON 请求（查/建/删文件夹和文件）用，如果
//    请求真的返回了 401（比如 token 在请求过程中被撤销），再补一次静默刷新
//    重试，还不行才真正报错。
// 3. 静默刷新拿不到新 token 时，明确把状态标成"需要重新登录"并停掉自动
//    备份的定时器（避免它顶着一个肯定会失败的 token 每 30 分钟重试一次、
//    白白报错刷屏），而不是无限重试或者假装什么事都没发生。
// ============================================================================

export class DriveAuthError extends Error {
  constructor(message: string = '登录已过期，请重新登录 Google 账号后再试') {
    super(message);
    this.name = 'DriveAuthError';
  }
}

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // 提前 5 分钟续期，别踩着过期边界

function isTokenValid(): boolean {
  return !!cachedAccessToken && !!tokenExpiration && Date.now() < tokenExpiration - TOKEN_REFRESH_MARGIN_MS;
}

function persistToken(token: string) {
  cachedAccessToken = token;
  const expiresAt = Date.now() + 3500 * 1000;
  tokenExpiration = expiresAt;
  localStorage.setItem('google_drive_access_token', token);
  localStorage.setItem('google_drive_token_expiration', expiresAt.toString());
  currentAccessToken = token;
}

let gisScriptPromise: Promise<void> | null = null;
function loadGisScript(): Promise<void> {
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve();
  if (gisScriptPromise) return gisScriptPromise;
  gisScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('加载 Google Identity Services 失败'));
    document.head.appendChild(script);
  });
  return gisScriptPromise;
}

// Web 端静默续期：用 Google Identity Services 的 prompt:'' 模式，只有用户
// 之前已经在这个浏览器里对这个应用授权过，才可能不弹窗直接拿到新 token；
// 需要交互的情况下 Google 不会触发回调，所以加个超时兜底当作失败处理。
function silentRefreshWeb(): Promise<string | null> {
  return new Promise(async (resolve) => {
    let settled = false;
    const settle = (val: string | null) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };
    try {
      await loadGisScript();
    } catch {
      settle(null);
      return;
    }
    try {
      const google = (window as any).google;
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: (firebaseConfig as any).oAuthClientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (resp: any) => settle(resp?.access_token || null),
        error_callback: () => settle(null),
      });
      tokenClient.requestAccessToken({ prompt: '' });
      setTimeout(() => settle(null), 8000);
    } catch (e) {
      settle(null);
    }
  });
}

let refreshPromise: Promise<string | null> | null = null;

// 静默刷新 access token，不弹交互式登录框。原生端如果设备上还有已授权的
// Google 账号，Firebase 插件通常能不弹 UI 直接拿到新 token；拿不到（比如
// 用户已经在别处撤销了授权）就返回 null，调用方需要引导用户手动重新登录，
// 而不是当成临时网络错误无限重试。
function silentRefreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      let token: string | null = null;
      if (Capacitor.isNativePlatform()) {
        const result = await FirebaseAuthentication.signInWithGoogle({ scopes: ['https://www.googleapis.com/auth/drive.file'] });
        token = result.credential?.accessToken || null;
      } else {
        token = await silentRefreshWeb();
      }
      if (token) {
        persistToken(token);
        return token;
      }
      return null;
    } catch (e) {
      console.warn('[Drive] 静默刷新 token 失败:', e);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

let authFailureCallback: (() => void) | null = null;

// 标记"需要用户手动重新登录"：清掉本地缓存的 token、停掉自动备份定时器
// （防止它顶着一个注定失败的 token 每 30 分钟重试一次），并复用注册在
// initAuth 里的 onAuthFailure 回调，让 UI 该弹登录页就弹登录页，跟原来
// "token 检测失败"时的行为保持一致。
function markNeedsReauth() {
  cachedAccessToken = null;
  currentAccessToken = null;
  tokenExpiration = null;
  localStorage.removeItem('google_drive_access_token');
  localStorage.removeItem('google_drive_token_expiration');
  stopAutoSyncRunner();
  updateSyncState({ needsReauth: true } as Partial<SyncState>);
  authFailureCallback?.();
}

// 云端操作前先调这个拿一个"确认没过期"的 token；内部会在快过期时自动
// 静默续期。静默续期失败会抛 DriveAuthError，调用方 catch 到这个类型时
// 应该提示用户重新登录，而不是当成普通网络错误展示。
export async function getValidAccessToken(): Promise<string> {
  if (isTokenValid()) return cachedAccessToken!;
  const refreshed = await silentRefreshAccessToken();
  if (refreshed) return refreshed;
  markNeedsReauth();
  throw new DriveAuthError();
}

// 给普通 JSON 请求（查询/新建/删除文件或文件夹）用的 fetch 包装：自动带上
// 一个有效 token，如果服务器仍然返回 401（比如 token 在请求过程中被撤销），
// 再补一次静默刷新并重试一次，还是不行才真正抛错。
export async function driveApiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const attempt = async (token: string) => {
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };

  const token = await getValidAccessToken();
  let res = await attempt(token);

  if (res.status === 401) {
    const refreshed = await silentRefreshAccessToken();
    if (!refreshed) {
      markNeedsReauth();
      throw new DriveAuthError();
    }
    res = await attempt(refreshed);
    if (res.status === 401) {
      markNeedsReauth();
      throw new DriveAuthError();
    }
  }
  return res;
}

export type SyncState = {
  isActive: boolean;
  taskName: string;
  message: string;
  isError: boolean;
  completed: boolean;
  needsReauth: boolean;
};

let syncState: SyncState = { isActive: false, taskName: '', message: '', isError: false, completed: false, needsReauth: false };
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
  // 记下来，这样 markNeedsReauth()（比如自动备份后台发现 token 死了）也能
  // 触发同一个回调，让 UI 弹回登录页，跟这里 onAuthFailure 的效果一致。
  authFailureCallback = onAuthFailure || null;

  // Check for redirect result on initialization (for Android WebView support)
  import('firebase/auth').then(({ getAuth, getRedirectResult, GoogleAuthProvider }) => {
    const authInstance = getAuth();
    getRedirectResult(authInstance).then(result => {
      if (result) {
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (credential?.accessToken) {
          persistToken(credential.accessToken);
          updateSyncState({ needsReauth: false });
          startAutoSyncRunner();
          if (onAuthSuccess) onAuthSuccess(result.user, cachedAccessToken!);
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
        updateSyncState({ needsReauth: false });
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
      // 每次跑之前先确保 token 有效（快过期会自动静默续期一次），而不是
      // 直接拿可能已经过期的旧 token 硬发请求。
      const freshToken = await getValidAccessToken();
      await uploadBackupToDrive(freshToken, (msg) => {
        updateSyncState({ message: msg });
      }, true);
      updateSyncState({ isActive: false, completed: true, message: '自动备份完成' });
    } catch (e: any) {
      console.error("[AutoSync] Scheduled backup failed:", e);
      if (e instanceof DriveAuthError) {
        // markNeedsReauth() 内部已经停掉了这个定时器，这里不用再管——
        // 顶着一个肯定会失败的 token 每 30 分钟报错刷屏没有意义，等用户
        // 重新登录后 initAuth 会重新 startAutoSyncRunner()。
        updateSyncState({ isActive: false, isError: true, message: '登录已过期，自动备份已暂停，请重新登录' });
      } else {
        updateSyncState({ isActive: false, isError: true, message: `自动备份失败: ${e.message}` });
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

    if (resultAccessToken) {
      persistToken(resultAccessToken);
    }
    updateSyncState({ needsReauth: false });
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
  try {
    // 尽量返回一个有效 token（快过期会先静默续期），而不是无脑吐出可能
    // 已经过期的缓存值——调用方（UI 层）大多只是拿这个 token 存进 state
    // 再传给下面各个云端函数，那些函数内部也会各自再校验一遍，这里能提前
    // 刷新就提前刷新，减少一次"先失败再刷新重试"的往返。
    return await getValidAccessToken();
  } catch {
    return cachedAccessToken;
  }
};

export const logout = async () => {
  if (Capacitor.isNativePlatform()) {
    await FirebaseAuthentication.signOut();
  }
  await auth.signOut();
  cachedAccessToken = null;
  currentAccessToken = null;
  tokenExpiration = null;
  localStorage.removeItem('google_drive_access_token');
  localStorage.removeItem('google_drive_token_expiration');
  stopAutoSyncRunner();
  updateSyncState({ needsReauth: false });
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
    let res = await driveApiFetch(`https://www.googleapis.com/drive/v3/files?q=name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    if (!res.ok) throw new Error(`查询备份文件夹失败: HTTP ${res.status}`);
    let data = await res.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id; // Return existing folder ID
    }

    // Create folder
    res = await driveApiFetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });
    if (!res.ok) throw new Error(`创建备份文件夹失败: HTTP ${res.status}`);
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
  // 不直接信任传进来的 accessToken——调用它的地方可能是几十分钟前拿到的
  // React state，这里统一换成一个确认没过期(必要时已静默续期过)的 token。
  accessToken = await getValidAccessToken();

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
    if (uploadRes.status === 401) {
      markNeedsReauth();
      throw new DriveAuthError('登录已过期，备份上传中断，请重新登录后再试一次');
    }
    const errText = await uploadRes.text().catch(() => "");
    throw new Error(`备份上传失败: ${uploadRes.status} ${errText}`);
  }

  onProgress("完整备份上传完成");
}

export async function listBackupsFromDrive(accessToken: string) {
  accessToken = await getValidAccessToken();
  const folderId = await getOrCreateBackupFolder(accessToken);
  const res = await driveApiFetch(`https://www.googleapis.com/drive/v3/files?q='${folderId}' in parents and trashed=false&orderBy=createdTime desc&fields=files(id, name, createdTime, size)`);
  if (!res.ok) throw new Error('读取备份列表失败');
  const data = await res.json();
  return data.files || [];
}

export async function downloadBackupFromDrive(accessToken: string, fileId: string): Promise<Blob> {
  const res = await driveApiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
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
  const res = await driveApiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
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
    const message = e instanceof DriveAuthError ? e.message : `备份失败: ${e.message}`;
    updateSyncState({ isActive: false, isError: true, message });
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
      const message = e instanceof DriveAuthError ? e.message : `恢复失败: ${e.message}`;
      updateSyncState({ isActive: false, isError: true, message });
    }
  })();
};

