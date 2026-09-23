import { Capacitor } from '@capacitor/core';
import { getAuth } from 'firebase/auth';
import { getCharacter, getFolders, getCachedMeta, getChatsForCharacter, getChatById, isActualCharacterCard } from './db';
import { uploadBlobToDrive } from './driveUpload';

const CLOUD_FOLDER_NAME = 'AIs_Studio_Cloud_Cards';

const cloudFolderPromiseCache = new Map<string, Promise<string>>();

export function getCloudFolderId(token: string): Promise<string> {
  const cached = cloudFolderPromiseCache.get(token);
  if (cached) return cached;

  const promise = (async () => {
    const q = `name='${CLOUD_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&spaces=drive`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("Failed to query folder");
    const data = await response.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }
    
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: CLOUD_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder'
      })
    });
    if (!createRes.ok) throw new Error("Failed to create cloud folder");
    const createData = await createRes.json();
    return createData.id;
  })().catch((err) => {
    cloudFolderPromiseCache.delete(token);
    throw err;
  });

  cloudFolderPromiseCache.set(token, promise);
  return promise;
}

// 云同步之前是"不管你在 App 里怎么分文件夹, 所有角色卡的同步文件一律平铺
// 堆在同一个云端根目录里"——卡一多(几千张)这个根目录本身就没法看。
// 这里按角色在 App 内的文件夹路径, 在云端也建出同名的一层层子文件夹, 让云端
// 结构跟 App 里的文件夹结构对上。同一次批量同步里, 相同路径只查/建一次。
const driveSubfolderCache = new Map<string, Promise<string>>();

export function clearDriveSubfolderCache() {
  driveSubfolderCache.clear();
}

async function getOrCreateDriveSubfolder(
  token: string,
  parentId: string,
  name: string,
): Promise<string> {
  const cacheKey = `${parentId}/${name}`;
  const cached = driveSubfolderCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    const safeName = name.replace(/'/g, "\\'");
    const q = `name='${safeName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&spaces=drive&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.files && data.files.length > 0) {
        return data.files[0].id;
      }
    }

    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      })
    });
    if (!createRes.ok) throw new Error("创建云端子文件夹失败");
    const createData = await createRes.json();
    return createData.id;
  })();

  driveSubfolderCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch(e) {
    driveSubfolderCache.delete(cacheKey);
    throw e;
  }
}

async function resolveDriveFolderPath(
  token: string,
  rootFolderId: string,
  pathParts: string[],
): Promise<string> {
  if (pathParts.length === 0) return rootFolderId;
  let currentParent = rootFolderId;
  for (const part of pathParts) {
    currentParent = await getOrCreateDriveSubfolder(token, currentParent, part);
  }
  return currentParent;
}

import JSZip from 'jszip';
import { getSafeFilename } from './db';
import { injectTavernData } from './png';
import { extractTavernData } from './png';

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const b64 = dataUrl.split(',')[1];
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function generateThumbnail(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX_WIDTH = 256;
      const MAX_HEIGHT = 256;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_WIDTH) {
          height *= MAX_WIDTH / width;
          width = MAX_WIDTH;
        }
      } else {
        if (height > MAX_HEIGHT) {
          width *= MAX_HEIGHT / height;
          height = MAX_HEIGHT;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0, width, height);
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      URL.revokeObjectURL(url);
      
      const b64 = dataUrl.split(',')[1];
      resolve(b64);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}



async function convertToPNG(blob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(img, 0, 0);
      canvas.toBlob((b) => {
        URL.revokeObjectURL(url);
        if (b) resolve(b);
        else reject(new Error("Canvas toBlob failed"));
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };
    img.src = url;
  });
}


type CloudCardType = 'character' | 'preset' | 'worldbook' | 'theme' | 'qr' | 'script';

function unwrapCharacterData(rawData: any): any {
  if (rawData?.data && typeof rawData.data === 'object' && !Array.isArray(rawData.data)) {
    return rawData.data;
  }
  return rawData;
}

function detectCloudCardType(rawData: any): CloudCardType {
  if (!rawData || isActualCharacterCard(rawData)) return 'character';

  if (Array.isArray(rawData)) {
    if (rawData.length > 0 && (rawData[0]?.message !== undefined || rawData[0]?.label !== undefined)) {
      return 'qr';
    }
    return 'character';
  }

  const data = unwrapCharacterData(rawData);
  const toolTarget = data || rawData || {};
  const outer = rawData || {};

  // 1. QR
  if (
    Array.isArray(outer.qrList) ||
    Array.isArray(toolTarget.qrList) ||
    Array.isArray(outer.quick_replies) ||
    Array.isArray(toolTarget.quick_replies) ||
    Array.isArray(outer.tavern_qr_sets) ||
    Array.isArray(toolTarget.tavern_qr_sets) ||
    outer.qrList !== undefined ||
    toolTarget.qrList !== undefined ||
    outer.quick_replies !== undefined ||
    toolTarget.quick_replies !== undefined
  ) return 'qr';

  // 2. Preset
  if (
    Array.isArray(outer.prompts) ||
    Array.isArray(toolTarget.prompts) ||
    Array.isArray(outer.prompt_order) ||
    Array.isArray(toolTarget.prompt_order) ||
    outer.temperature !== undefined ||
    toolTarget.temperature !== undefined ||
    outer.top_p !== undefined ||
    toolTarget.top_p !== undefined ||
    outer.top_k !== undefined ||
    toolTarget.top_k !== undefined ||
    outer.min_p !== undefined ||
    toolTarget.min_p !== undefined ||
    outer.repetition_penalty !== undefined ||
    toolTarget.repetition_penalty !== undefined ||
    outer.openai_max_context !== undefined ||
    toolTarget.openai_max_context !== undefined ||
    outer.openai_max_tokens !== undefined ||
    toolTarget.openai_max_tokens !== undefined ||
    outer.max_context_length !== undefined ||
    toolTarget.max_context_length !== undefined ||
    outer.preset_type !== undefined ||
    toolTarget.preset_type !== undefined ||
    toolTarget.prompts !== undefined ||
    toolTarget.system_prompt !== undefined
  ) return 'preset';

  // 3. Worldbook
  if (
    outer.entries !== undefined ||
    toolTarget.entries !== undefined ||
    (outer.data && outer.data.entries !== undefined)
  ) return 'worldbook';

  // 4. Theme
  if (
    outer.blur_strength !== undefined ||
    toolTarget.blur_strength !== undefined ||
    outer.main_text_color !== undefined ||
    toolTarget.main_text_color !== undefined ||
    outer.chat_display !== undefined ||
    toolTarget.chat_display !== undefined
  ) return 'theme';

  // 5. Script
  if (
    outer.run !== undefined ||
    toolTarget.run !== undefined ||
    outer.type === 'tool' ||
    toolTarget.type === 'tool' ||
    outer.type === 'script' ||
    toolTarget.type === 'script' ||
    (outer.extensions && Array.isArray(outer.extensions.regex_scripts)) ||
    (toolTarget.extensions && Array.isArray(toolTarget.extensions.regex_scripts))
  ) return 'script';

  return 'character';
}

function extractSourceUrl(rawData: any): string {
  const value =
    rawData?.data?.extensions?.source ||
    rawData?.data?.source ||
    rawData?.extensions?.source ||
    rawData?.source ||
    '';
  return typeof value === 'string' ? value.trim() : String(value || '');
}

function hasQuickReplies(rawData: any): boolean {
  const target = rawData?.data?.extensions || rawData?.data || rawData?.extensions || rawData || {};
  const qr = target?.quick_replies || target?.qrList || target?.tavern_qr_sets;
  return Array.isArray(qr) && qr.length > 0;
}

function cloudTypeFolder(type: CloudCardType): string {
  if (type === 'preset') return '工具区/预设';
  if (type === 'worldbook') return '工具区/世界书';
  if (type === 'theme') return '工具区/美化';
  if (type === 'qr') return '工具区/快速回复';
  if (type === 'script') return '工具区/脚本';
  return '角色卡';
}

function buildQuickRepliesExport(rawData: any, charName: string): any | null {
  const target = rawData?.data?.extensions || rawData?.data || rawData?.extensions || rawData || {};
  const qrList =
    target?.extensions?.quick_replies ||
    target?.quick_replies ||
    target?.qrList ||
    '';
  const qrSets = target?.extensions?.tavern_qr_sets || target?.tavern_qr_sets;
  let qrContent: any = qrList;

  if (qrSets && qrSets.length > 0) {
    const metadata = qrSets.find((s: any) => s.metadata)?.metadata;
    if (metadata) {
      qrContent = { ...metadata };
      if (qrContent.qrList) qrContent.qrList = qrList;
      else if (qrContent.quick_replies) qrContent.quick_replies = qrList;
    } else {
      qrContent = { version: 2, name: charName, qrList };
    }
  } else if (Array.isArray(qrList) && qrList.length > 0) {
    qrContent = { version: 2, name: charName, qrList };
  } else {
    return null;
  }

  return qrContent;
}

function chatMessagesToJsonl(messages: any[]): string {
  return (messages || [])
    .map((m) =>
      JSON.stringify({
        name: m.name,
        is_user: m.is_user,
        is_name: m.is_name,
        send_date: m.send_date,
        mes: m.mes,
        extra: m.extra,
      }),
    )
    .join('\n');
}

async function hashString(value: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function buildCloudZip(
  char: any,
  chats: any[],
  hasExtras: boolean,
  sourceUrl: string,
): Promise<Blob> {
  const safeName = getSafeFilename(char.name || 'Character');
  const extraAvatars = (char.avatarHistory || []).filter((b: any) => !b ? false : (!char.avatarBlob || !(b.size === char.avatarBlob.size && b.type === char.avatarBlob.type)));

  const zip = new JSZip();

  zip.file('card.json', JSON.stringify(char.data, null, 2));

  const addAvatar = (folder: JSZip) => {
    if (!char.avatarBlob) return;
    let ext = 'png';
    if (char.avatarBlob.type === 'image/jpeg') ext = 'jpg';
    else if (char.avatarBlob.type === 'image/webp') ext = 'webp';
    else if (char.avatarBlob.type === 'image/gif') ext = 'gif';
    folder.file(`avatar.${ext}`, char.avatarBlob);
  };

  const addHistory = (folder: JSZip) => {
    if (!char.avatarHistory || char.avatarHistory.length === 0) return;
    const historyFolder = folder.folder('替换头像');
    if (!historyFolder) return;
    for (let i = 0; i < extraAvatars.length; i++) {
      const ab = extraAvatars[i];
      let ext = 'png';
      let fileName = `替换头像_${i + 1}.${ext}`;
      if (ab instanceof File) {
        fileName = ab.name;
      } else {
        if (ab.type === 'image/jpeg') ext = 'jpg';
        else if (ab.type === 'image/webp') ext = 'webp';
        fileName = `替换头像_${i + 1}.${ext}`;
      }
      historyFolder.file(fileName, ab);
    }
  };

  addAvatar(zip);
  addHistory(zip);

  if (hasExtras) {
    const cardFolder = zip.folder(safeName);
    if (cardFolder) {
      cardFolder.file('card.json', JSON.stringify(char.data, null, 2));
      addAvatar(cardFolder);
      addHistory(cardFolder);

      const qrExport = buildQuickRepliesExport(char.data, safeName);
      if (qrExport) {
        cardFolder.file(`${safeName}_qr.json`, JSON.stringify(qrExport, null, 2));
      }

      if (chats.length > 0) {
        const chatsFolder = cardFolder.folder('聊天记录');
        if (chatsFolder) {
          for (let i = 0; i < chats.length; i++) {
            const chat = chats[i];
            const dateStr = new Date(chat.createdAt).toISOString().replace(/:/g, '-');
            const chatSafeName = getSafeFilename(chat.name || 'Chat');
            chatsFolder.file(`${chatSafeName}_${dateStr}.jsonl`, chatMessagesToJsonl(chat.messages));
          }
        }
      }
    }
  }

  zip.file(
    'studio_meta.json',
    JSON.stringify({
      folderPath: '',
      sourceUrl,
      cardType: detectCloudCardType(char.data),
      createdAt: char.createdAt,
    }),
  );

  return await zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

async function buildCloudUploadPayload(
  char: any,
  chats: any[],
  hasExtras: boolean,
  sourceUrl: string,
  safeName: string,
): Promise<{ blob: Blob; fileName: string; mimeType: string }> {
  const extraAvatars = (char.avatarHistory || []).filter(b => !char.avatarBlob || !(b.size === char.avatarBlob.size && b.type === char.avatarBlob.type));
  const hasHistory = extraAvatars.length > 0;

  // 没有需要打包的额外内容时，尽量保留源文件格式，和旧版行为一致。
  if (!hasExtras && !hasHistory) {
    if (!char.avatarBlob) {
      return {
        blob: new Blob([JSON.stringify(char.data ?? {}, null, 2)], { type: 'application/json' }),
        fileName: `${safeName}_${char.id}.json`,
        mimeType: 'application/json',
      };
    }

    const originalType = char.avatarBlob.type || '';
    if (!originalType || originalType === 'image/png') {
      try {
        const buffer = await char.avatarBlob.arrayBuffer();
        const injectedBuffer = injectTavernData(buffer, char.data);
        return {
          blob: new Blob([injectedBuffer], { type: 'image/png' }),
          fileName: `${safeName}_${char.id}.png`,
          mimeType: 'image/png',
        };
      } catch (e) {
        console.error('Failed to inject PNG, falling back to ZIP', e);
      }
    }
  }

  const blob = await buildCloudZip(char, chats, hasExtras, sourceUrl);
  return {
    blob,
    fileName: `${safeName}_${char.id}.zip`,
    mimeType: 'application/zip',
  };
}

type CloudFilePayload = {
  blob: Blob;
  fileName: string;
  mimeType: string;
  appProperties: Record<string, string>;
  contentHash: string;
  extraMetadata?: Record<string, any>;
};

async function upsertCloudFile(
  token: string,
  folderId: string,
  payload: CloudFilePayload,
  searchQuery: string,
): Promise<'uploaded' | 'skipped'> {
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(searchQuery)}&spaces=drive&fields=files(id,name,appProperties,parents)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!searchRes.ok) throw new Error(`云端查询失败: HTTP ${searchRes.status}`);
  const searchData = await searchRes.json();

  if (searchData.files && searchData.files.length > 0) {
    const existing = searchData.files[0];
    const existingParents = Array.isArray(existing.parents) ? existing.parents : [];
    const shouldMove = existingParents.length !== 1 || existingParents[0] !== folderId;

    if (existing.appProperties?.contentHash === payload.contentHash) {
      if (shouldMove) {
        const removeParents = existingParents.filter(id => id !== folderId);
        let moveUrl = `https://www.googleapis.com/drive/v3/files/${existing.id}?addParents=${encodeURIComponent(folderId)}&fields=id,parents`;
        if (removeParents.length > 0) {
          moveUrl += `&removeParents=${encodeURIComponent(removeParents.join(','))}`;
        }
        await fetch(moveUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-HTTP-Method-Override': 'PATCH',
          },
        });
      }
      return 'skipped';
    }

    const patchMeta: any = {
      name: payload.fileName,
      appProperties: payload.appProperties,
    };
    if (payload.extraMetadata) Object.assign(patchMeta, payload.extraMetadata);

    let patchUrl = `https://www.googleapis.com/drive/v3/files/${existing.id}`;
    if (shouldMove) {
      const removeParents = existingParents.filter(id => id !== folderId);
      patchUrl += `?addParents=${encodeURIComponent(folderId)}`;
      if (removeParents.length > 0) {
        patchUrl += `&removeParents=${encodeURIComponent(removeParents.join(','))}`;
      }
    }

    await fetch(patchUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-HTTP-Method-Override': 'PATCH',
      },
      body: JSON.stringify(patchMeta),
    });

    const uploadRes = await uploadBlobToDrive(
      token,
      existing.id,
      payload.blob,
      payload.mimeType,
    );
    if (!uploadRes.ok) throw new Error('上传失败: ' + uploadRes.statusText);
    return 'uploaded';
  }

  const metadata: any = {
    name: payload.fileName,
    appProperties: payload.appProperties,
    parents: [folderId],
  };
  if (payload.extraMetadata) Object.assign(metadata, payload.extraMetadata);

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  });
  if (!createRes.ok) throw new Error('Failed to create file');
  const createdData = await createRes.json();
  const uploadRes = await uploadBlobToDrive(
    token,
    createdData.id,
    payload.blob,
    payload.mimeType,
  );
  if (!uploadRes.ok) throw new Error('上传失败: ' + uploadRes.statusText);
  return 'uploaded';
}

async function hashBlobLight(blob: Blob, extra: string = ''): Promise<string> {
  const file = blob as any;
  const size = blob.size;
  // Read a small chunk from the middle to ensure uniqueness without reading the whole file
  const chunk = blob.slice(Math.floor(size / 2), Math.floor(size / 2) + 10240);
  const buffer = await chunk.arrayBuffer();
  const chunkHex = Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  const info = [
    blob.size,
    blob.type,
    file?.name || '',
    file?.lastModified || 0,
    extra,
    chunkHex
  ].join('|');
  return hashString(info);
}

function getAvatarExtension(blob: Blob): string {
  const type = blob.type || '';
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/gif') return 'gif';
  if (!type) return 'png';
  return type.split('/')[1] || 'png';
}

function guessMimeFromExt(ext: string): string {
  const normalized = ext.toLowerCase();
  if (normalized === 'jpg' || normalized === 'jpeg') return 'image/jpeg';
  if (normalized === 'webp') return 'image/webp';
  if (normalized === 'gif') return 'image/gif';
  return 'image/png';
}



export async function computeCharacterCloudPathParts(
  char: any,
  allFolders?: any[]
): Promise<{ pathParts: string[]; folderPath: string }> {
  const { getCharacterCategoryPrefix, getFolders } = await import('./db');
  const folders = allFolders || (await getFolders());
  const toolCategory = getCharacterCategoryPrefix(char);
  const pathParts: string[] = [];

  if (toolCategory !== "未归类") {
    pathParts.push('工具区');
    const categoryName = (toolCategory === '美化' || toolCategory === '预设' || toolCategory === '世界书' || toolCategory === '快速回复')
      ? toolCategory
      : '脚本';

    if (char.folderId) {
      const visitedFolderIds = new Set<string>();
      let currentF = folders.find((f: any) => f.id === char.folderId);
      const subParts: string[] = [];
      while (currentF) {
        if (visitedFolderIds.has(currentF.id)) break;
        visitedFolderIds.add(currentF.id);
        subParts.unshift(currentF.name);
        currentF = folders.find((f: any) => f.id === currentF.parentId);
      }

      // Filter out redundant '工具区' or category names to prevent nested '工具区/世界书/世界书'
      const cleanSubParts = subParts.filter((part: string, idx: number) => {
        if (idx === 0 && part === '工具区') return false;
        if (idx === 0 && (part === categoryName || part === toolCategory)) return false;
        return true;
      });

      pathParts.push(categoryName);
      if (cleanSubParts.length > 0) {
        pathParts.push(...cleanSubParts);
      }
    } else {
      pathParts.push(categoryName);
    }
  } else {
    pathParts.push('角色卡');
    if (char.folderId) {
      const visitedFolderIds = new Set<string>();
      let currentF = folders.find((f: any) => f.id === char.folderId);
      const subParts: string[] = [];
      while (currentF) {
        if (visitedFolderIds.has(currentF.id)) break;
        visitedFolderIds.add(currentF.id);
        const isTopLevelGroup = currentF.name === '角色卡' && (currentF.parentId === null || currentF.parentId === undefined);
        if (!isTopLevelGroup) {
          subParts.unshift(currentF.name);
        }
        currentF = folders.find((f: any) => f.id === currentF.parentId);
      }
      pathParts.push(...subParts);
    }
  }

  const folderPath = pathParts.join('/');
  return { pathParts, folderPath };
}

export async function uploadCharacterToCloud(
  token: string,
  charId: string,
  onProgress?: (msg: string) => void,
): Promise<'uploaded' | 'skipped' | 'moved'> {
  if (onProgress) onProgress("准备云端数据...");
  const char = await getCharacter(charId);
  if (!char) throw new Error("Character not found");
  

  const rawData = char.data;
  const charType = detectCloudCardType(rawData);

  const folderId = await getCloudFolderId(token);
  const safeName = char.name ? char.name.replace(/[\\/:*?"<>|]/g, "_") : "Character";
  
  let thumbB64: string | null = null;
  if (char.avatarBlob) {
    if (onProgress) onProgress("生成云端预览图...");
    thumbB64 = await generateThumbnail(char.avatarBlob);
  }

  const { pathParts, folderPath } = await computeCharacterCloudPathParts(char);
  const { getChatsForCharacter } = await import('./db');
  const extraAvatars = (char.avatarHistory || []).filter(b => !char.avatarBlob || !(b.size === char.avatarBlob.size && b.type === char.avatarBlob.type));
  
  const hasExtraAvatars = extraAvatars.length > 0;
  const chats = await getChatsForCharacter(char.id);

  const targetParentId = await resolveDriveFolderPath(token, folderId, pathParts);

  const moveCloudFileToParent = async (fileId: string, currentParents: string[] = []) => {
    const shouldMove = currentParents.length !== 1 || currentParents[0] !== targetParentId;
    if (!shouldMove) return;
    const removeParents = currentParents.filter((id) => id !== targetParentId);
    let moveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${encodeURIComponent(targetParentId)}&fields=id,parents`;
    if (removeParents.length > 0) {
      moveUrl += `&removeParents=${encodeURIComponent(removeParents.join(','))}`;
    }
    await fetch(moveUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-HTTP-Method-Override': 'PATCH',
      },
    });
  };

  let finalBlob: Blob;
  let fileName = "";
  let mimeType = "";
  
  async function createZip(): Promise<Blob> {
    const zip = new JSZip();
    zip.file(`${safeName}.json`, JSON.stringify(char.data, null, 2));
    
    if (char.avatarBlob) {
      let ext = 'png';
      if (char.avatarBlob.type === 'image/jpeg') ext = 'jpg';
      else if (char.avatarBlob.type === 'image/webp') ext = 'webp';
      else if (char.avatarBlob.type === 'image/gif') ext = 'gif';
      zip.file(`avatar.${ext}`, char.avatarBlob);
    }
    
    if (hasExtraAvatars) {
      const historyFolder = zip.folder("替换头像");
      if (historyFolder) {
        for (let i = 0; i < extraAvatars.length; i++) {
          const ab = extraAvatars[i];
          let ext = "png";
          if (ab instanceof File) {
            ext = ab.name.split('.').pop() || "png";
          } else {
            if (ab.type === "image/jpeg") ext = "jpg";
            else if (ab.type === "image/webp") ext = "webp";
            else if (ab.type === "image/gif") ext = "gif";
          }
          historyFolder.file(`替换头像_${i + 1}.${ext}`, ab);
        }
      }
    }
    
    const studioMeta: any = {
      folderPath,
      createdAt: char.createdAt
    };
    if ((char as any).sourceUrl) studioMeta.sourceUrl = (char as any).sourceUrl;
    
    if (chats && chats.length > 0) {
      for (const chat of chats) {
        zip.file(`chat_${chat.name}_${chat.id}.json`, JSON.stringify(chat, null, 2));
      }
    }
    zip.file('studio_meta.json', JSON.stringify(studioMeta));
    // Yield to main thread for Android performance
    await new Promise(r => setTimeout(r, 10));
    return await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  }

  
  const hasHistory = extraAvatars.length > 0;
  const hasChats = Boolean(chats && chats.length > 0);
  if (!hasHistory && !hasChats && char.avatarBlob && (char.avatarBlob.type === 'image/png' || !char.avatarBlob.type)) {
    if (onProgress) onProgress("打包角色数据(PNG)...");
    try {
      const buffer = await char.avatarBlob.arrayBuffer();
      const injectedBuffer = injectTavernData(buffer, char.data);
      finalBlob = new Blob([injectedBuffer], { type: 'image/png' });
      fileName = `${safeName}_${char.id}.png`;
      mimeType = 'image/png';
    } catch (e) {
      console.error("Failed to inject PNG", e);
      finalBlob = await createZip();
      fileName = `${safeName}_${char.id}.zip`;
      mimeType = 'application/zip';
    }
  } else if (!hasHistory && !hasChats && !char.avatarBlob) {
    if (onProgress) onProgress("打包角色数据(JSON)...");
    finalBlob = new Blob([JSON.stringify(char.data, null, 2)], { type: 'application/json' });
    fileName = `${safeName}_${char.id}.json`;
    mimeType = 'application/json';
  } else {
    if (onProgress) onProgress("打包角色数据(ZIP)...");
    finalBlob = await createZip();
    fileName = `${safeName}_${char.id}.zip`;
    mimeType = 'application/zip';
  }

  
  if (onProgress) onProgress("计算数据指纹...");
  const dataStr = JSON.stringify(char.data);
  const avatarInfo = char.avatarBlob ? char.avatarBlob.size.toString() : 'no-avatar';
  const historyInfo = extraAvatars.length > 0 ? extraAvatars.map(b => b.size.toString()).join(',') : 'no-history';
  const rawHashData = dataStr + "|" + avatarInfo + "|" + historyInfo;
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawHashData));
  const contentHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (onProgress) onProgress("检查是否已存在...");
  const metadata: any = {
    name: fileName,
    appProperties: {
      isChar: "true",
      charId: char.id,
      charName: char.name || "",
      cardType: charType,
      folderPath: folderPath,
      createdAt: char.createdAt.toString(),
      contentHash: contentHash
    }
  };
  
  if (thumbB64) {
    metadata.contentHints = {
      thumbnail: {
        image: thumbB64,
        mimeType: 'image/jpeg'
      }
    };
  }

  const q = `appProperties has { key='charId' and value='${char.id}' } and trashed=false`;
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&spaces=drive&fields=files(id,name,appProperties,parents)`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!searchRes.ok) {
    throw new Error(`云端查询失败: HTTP ${searchRes.status}`);
  }
  const searchData = await searchRes.json();
  
  let targetFileId = '';
  let finalCharName = char.name || "未命名";

  let existingFile: any = null;
  if (searchData.files && searchData.files.length > 0) {
    existingFile = searchData.files[0];
  } else {
    // 如果根据 charId 没查到，在整个云盘中根据 contentHash 全局查找（可能之前传在根目录或其他旧目录）
    const qHash = `(appProperties has { key='isChar' and value='true' } or appProperties has { key='cardType' }) and appProperties has { key='contentHash' and value='${contentHash}' } and trashed=false`;
    try {
      const searchResHash = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(qHash)}&spaces=drive&fields=files(id,name,appProperties,parents)`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (searchResHash.ok) {
        const searchDataHash = await searchResHash.json();
        if (searchDataHash.files && searchDataHash.files.length > 0) {
          existingFile = searchDataHash.files[0];
        }
      }
    } catch (e) {
      console.warn("contentHash search fallback failed", e);
    }
  }

  if (existingFile) {
    const existingParents = Array.isArray(existingFile.parents) ? existingFile.parents : [];
    const currentCloudFolder = existingFile.appProperties?.folderPath || '';
    const folderChanged = currentCloudFolder !== folderPath || existingParents.length !== 1 || existingParents[0] !== targetParentId;

    if (existingFile.appProperties?.contentHash === contentHash) {
      if (folderChanged) {
        if (onProgress) onProgress("内容一致，正在同步移动并更新云端文件夹嵌套...");
        await moveCloudFileToParent(existingFile.id, existingParents);
        await fetch(`https://www.googleapis.com/drive/v3/files/${existingFile.id}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-HTTP-Method-Override': 'PATCH'
          },
          body: JSON.stringify({
            appProperties: {
              ...(existingFile.appProperties || {}),
              charId: char.id,
              charName: char.name || existingFile.appProperties?.charName || '',
              cardType: charType,
              folderPath: folderPath,
              contentHash: contentHash
            }
          })
        });
        return 'moved';
      }
      if (onProgress) onProgress("云端已有相同内容与分类的卡片，跳过");
      return 'skipped';
    }

    targetFileId = existingFile.id;
    finalCharName = existingFile.appProperties?.charName || finalCharName;
    metadata.appProperties.charName = finalCharName;
    
    if (onProgress) onProgress("更新云端文件信息与分类...");
    await fetch(`https://www.googleapis.com/drive/v3/files/${targetFileId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-HTTP-Method-Override': 'PATCH'
      },
      body: JSON.stringify(metadata)
    });
    await moveCloudFileToParent(targetFileId, existingParents);
  } else {
    if (onProgress) onProgress("检查同名卡片...");
    const safeQueryName = finalCharName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const qName = `name contains '${safeQueryName}' and '${targetParentId}' in parents and trashed=false`;
    const searchResName = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(qName)}&spaces=drive&fields=files(id,name,appProperties,parents)`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!searchResName.ok) {
      throw new Error(`云端同名查询失败: HTTP ${searchResName.status}`);
    }
    const searchDataName = await searchResName.json();
    
    if (searchDataName.files && searchDataName.files.length > 0) {
       const exactMatches = searchDataName.files.filter((f:any) => f.appProperties?.charName === finalCharName || f.appProperties?.charName?.startsWith(finalCharName + '_'));
       if (exactMatches.length > 0) {
          const identical = exactMatches.find((f:any) => f.appProperties?.contentHash === contentHash);
          if (identical) {
             const idParents = Array.isArray(identical.parents) ? identical.parents : [];
             const idFolder = identical.appProperties?.folderPath || '';
             const idFolderChanged = idFolder !== folderPath || idParents.length !== 1 || idParents[0] !== targetParentId;
             if (idFolderChanged) {
               if (onProgress) onProgress("内容一致，同步移动到新文件夹分类...");
               await moveCloudFileToParent(identical.id, idParents);
               await fetch(`https://www.googleapis.com/drive/v3/files/${identical.id}`, {
                 method: 'POST',
                 headers: {
                   Authorization: `Bearer ${token}`,
                   'Content-Type': 'application/json',
                   'X-HTTP-Method-Override': 'PATCH'
                 },
                 body: JSON.stringify({
                   appProperties: {
                     ...(identical.appProperties || {}),
                     charId: char.id,
                     charName: char.name || identical.appProperties?.charName || '',
                     cardType: charType,
                     folderPath: folderPath,
                     contentHash: contentHash
                   }
                 })
               });
               return 'moved';
             }
             if (onProgress) onProgress("云端已有相同内容的卡片，跳过");
             return 'skipped';
          }
          let maxSuffix = 0;
          const escapedName = finalCharName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`^${escapedName}_(\\d+)$`);
          for (const f of exactMatches) {
              const cName = f.appProperties?.charName || '';
              const match = cName.match(regex);
              if (match) {
                  const num = parseInt(match[1], 10);
                  if (num > maxSuffix) maxSuffix = num;
              }
          }
          finalCharName = `${finalCharName}_${maxSuffix + 1}`;
          metadata.appProperties.charName = finalCharName;
       }
    }
    if (onProgress) onProgress("创建云端文件...");
    metadata.parents = [targetParentId];
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(metadata)
    });
    if (!createRes.ok) throw new Error("Failed to create file");
    const createdData = await createRes.json();
    targetFileId = createdData.id;
  }

  if (onProgress) onProgress("上传实体数据...");
  const uploadRes = await uploadBlobToDrive(token, targetFileId, finalBlob, mimeType);

  if (!uploadRes.ok) {
    throw new Error("上传失败: " + uploadRes.statusText);
  }
  
  if (onProgress) onProgress("上传完成！");
  return 'uploaded';
}
export async function listCloudCharacters(token: string) {
  const q = `(appProperties has { key='isChar' and value='true' } or appProperties has { key='isChat' and value='true' }) and trashed=false`;
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,thumbnailLink,appProperties,size,createdTime,parents)&pageSize=1000`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("Failed to list cloud characters");
  const data = await response.json();
  const files = data.files || [];
  return files.filter((f: any) => {
    if (f.appProperties?.fileKind && f.appProperties.fileKind.startsWith('avatar_')) {
      return false;
    }
    return true;
  });
}



export async function downloadCloudCharacter(token: string, fileId: string, fileName?: string, onProgress?: (msg: string) => void) {
  if (onProgress) onProgress("正在下载云端文件...");
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("Download failed");
  
  const blob = await response.blob();
  
  let jsonData: any = null;
  let avatarBlob: Blob | null = null;
  let studioMeta: any = null;
  let avatarHistory: Blob[] = [];
  let chats: any[] = [];
  
  
  const fName = (fileName || "").toLowerCase();
  
  const tryParseZip = async (blobData: any) => {
     const zip = await JSZip.loadAsync(blobData);
     let zipJson: any = null;
     let fallbackJson: any = null;
     let zipAvatar: Blob | null = null;
     let zipMeta: any = null;
     let zipAvatarHistory: Blob[] = [];
     let zipChats: any[] = [];
     for (const [filename, file] of Object.entries(zip.files)) {
       if (file.dir) continue;
       const lowerName = filename.toLowerCase();
       if (lowerName === 'studio_meta.json' || lowerName.endsWith('/studio_meta.json')) {
         const text = await file.async('text');
         try { zipMeta = JSON.parse(text); } catch(e){}
       } else if (
         lowerName.startsWith('替换头像/') ||
         lowerName.includes('/替换头像/') ||
         lowerName.startsWith('history/') ||
         lowerName.includes('/history/') ||
         lowerName.startsWith('avatars/') ||
         lowerName.includes('/avatars/') ||
         lowerName.startsWith('alt/') ||
         lowerName.startsWith('alternate/')
       ) {
         const ext = filename.split('.').pop()?.toLowerCase();
         let mime = 'image/png';
         if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
         else if (ext === 'webp') mime = 'image/webp';
         else if (ext === 'gif') mime = 'image/gif';
         const b = await file.async('blob');
         const ab = new Blob([b], { type: mime });
         (ab as any)._filename = filename;
         zipAvatarHistory.push(ab);
       } else if (
         lowerName.startsWith('avatar.') ||
         lowerName.includes('/avatar.') ||
         lowerName.endsWith('/avatar.png') ||
         lowerName.endsWith('/avatar.jpg') ||
         lowerName.endsWith('/avatar.webp') ||
         lowerName.endsWith('/avatar.gif')
       ) {
         const ext = filename.split('.').pop()?.toLowerCase();
         let mime = 'image/png';
         if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
         else if (ext === 'webp') mime = 'image/webp';
         else if (ext === 'gif') mime = 'image/gif';
         const b = await file.async('blob');
         zipAvatar = new Blob([b], { type: mime });
       } else if (
         lowerName.endsWith('.json') &&
         (lowerName.startsWith('chat_') || lowerName.includes('/chat_'))
       ) {
         try {
           const text = await file.async('text');
           const chatObj = JSON.parse(text);
           if (chatObj && (chatObj.messages || chatObj.firstAiName || chatObj.id)) {
             zipChats.push(chatObj);
           }
         } catch(e) {}
       } else if (
         lowerName.endsWith('.json') &&
         !lowerName.startsWith('chat_') &&
         !lowerName.includes('/chat_') &&
         !lowerName.endsWith('_qr.json') &&
         !lowerName.includes('_qr.json')
       ) {
         const text = await file.async('text');
         try {
           const parsed = JSON.parse(text);
           if (
             lowerName === 'card.json' ||
             lowerName.endsWith('/card.json') ||
             lowerName === 'character.json' ||
             lowerName.endsWith('/character.json')
           ) {
             zipJson = parsed;
           } else if (parsed && (parsed.spec === 'chara_card_v2' || parsed.spec === 'chara_card_v3' || parsed.name || parsed.data?.name)) {
             zipJson = parsed;
           } else if (!fallbackJson) {
             fallbackJson = parsed;
           }
         } catch(e){}
       }
     }
     
     if (!zipJson && fallbackJson) {
       zipJson = fallbackJson;
     }

     // sort history to maintain 1, 2, 3... order
     zipAvatarHistory.sort((a: any, b: any) => {
         const getNum = (name: string) => {
             const m = name.match(/_?(\d+)\.?/);
             return m ? parseInt(m[1]) : null;
         };
         const numA = getNum(a._filename);
         const numB = getNum(b._filename);
         if (numA !== null && numB !== null) return numA - numB;
         return String(a._filename).localeCompare(String(b._filename));
     });
     
     // 确保主头像也保存在头像列表中，防止更换后丢失
     if (zipAvatar) {
       const hasZipAvatar = zipAvatarHistory.some(
         b => b.size === zipAvatar!.size && b.type === zipAvatar!.type
       );
       if (!hasZipAvatar) {
         zipAvatarHistory.unshift(zipAvatar);
       }
     }
     
     return { jsonData: zipJson, avatarBlob: zipAvatar, studioMeta: zipMeta, avatarHistory: zipAvatarHistory, chats: zipChats };
  };

  if (fName.endsWith('.zip')) {
     if (onProgress) onProgress("正在解压卡片...");
     const res = await tryParseZip(blob);
     jsonData = res.jsonData;
     avatarBlob = res.avatarBlob;
     studioMeta = res.studioMeta;
     if (res.avatarHistory) avatarHistory = res.avatarHistory;
     if (res.chats) chats = res.chats;
  } else if (fName.endsWith('.json')) {
     const text = await blob.text();
     jsonData = JSON.parse(text);
  } else if (fName.endsWith('.png') || fName.endsWith('.webp') || fName.endsWith('.jpg') || fName.endsWith('.jpeg')) {
     avatarBlob = blob;
     if (onProgress) onProgress("正在提取图片中的角色数据...");
     const buffer = await blob.arrayBuffer();
     try {
       const data = await extractTavernData(buffer);
       if (data) {
          jsonData = data;
       } else {
          throw new Error("extractTavernData returned null");
       }
     } catch (e) {
       console.error("Failed to extract tavern data from image, attempting to parse as ZIP fallback", e);
       try {
          const res = await tryParseZip(blob);
          if (res.jsonData) {
              jsonData = res.jsonData;
              if (res.avatarBlob) avatarBlob = res.avatarBlob;
              if (res.studioMeta) studioMeta = res.studioMeta;
              if (res.avatarHistory) avatarHistory = res.avatarHistory;
          }
       } catch (zipErr) {
          console.error("Also failed to parse as ZIP", zipErr);
       }
     }
  }
  // 如果未提取到数据（如单张未内嵌 Tavern 数据的普通 PNG 头像），在云端查找配套的 JSON 描述文件
  if (!jsonData) {
    try {
      const fileInfoRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,parents,appProperties`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (fileInfoRes.ok) {
        const fileInfo = await fileInfoRes.json();
        const charId = fileInfo.appProperties?.charId || fileInfo.appProperties?.relatedCharId;
        const parentId = fileInfo.parents && fileInfo.parents[0];
        let jsonQuery = '';
        if (charId) {
          jsonQuery = `(appProperties has { key='charId' and value='${charId}' } or appProperties has { key='relatedCharId' and value='${charId}' }) and mimeType='application/json' and trashed=false`;
        } else if (parentId) {
          jsonQuery = `'${parentId}' in parents and mimeType='application/json' and trashed=false`;
        }
        if (jsonQuery) {
          const findJsonRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(jsonQuery)}&spaces=drive&fields=files(id,name)`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (findJsonRes.ok) {
            const findJsonData = await findJsonRes.json();
            if (findJsonData.files && findJsonData.files.length > 0) {
              const targetJsonFile = findJsonData.files[0];
              const jsonContentRes = await fetch(`https://www.googleapis.com/drive/v3/files/${targetJsonFile.id}?alt=media`, {
                headers: { Authorization: `Bearer ${token}` }
              });
              if (jsonContentRes.ok) {
                const text = await jsonContentRes.text();
                jsonData = JSON.parse(text);
                avatarBlob = blob;
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn("Companion JSON search failed:", e);
    }
  }

  // 如果提取到了 JSON 但没有头像（如单独下载了 JSON 文件），尝试寻找配套头像
  if (jsonData && !avatarBlob) {
    try {
      const fileInfoRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,parents,appProperties`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (fileInfoRes.ok) {
        const fileInfo = await fileInfoRes.json();
        const charId = fileInfo.appProperties?.charId || fileInfo.appProperties?.relatedCharId;
        const parentId = fileInfo.parents && fileInfo.parents[0];
        let avatarQuery = '';
        if (charId) {
          avatarQuery = `(appProperties has { key='charId' and value='${charId}' } or appProperties has { key='relatedCharId' and value='${charId}' }) and (name contains 'avatar' or mimeType contains 'image/') and trashed=false`;
        } else if (parentId) {
          avatarQuery = `'${parentId}' in parents and (name contains 'avatar' or mimeType contains 'image/') and trashed=false`;
        }
        if (avatarQuery) {
          const findAvatarRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(avatarQuery)}&spaces=drive&fields=files(id,name,mimeType)`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (findAvatarRes.ok) {
            const findAvatarData = await findAvatarRes.json();
            if (findAvatarData.files && findAvatarData.files.length > 0) {
              const targetAvatarFile = findAvatarData.files[0];
              const avatarContentRes = await fetch(`https://www.googleapis.com/drive/v3/files/${targetAvatarFile.id}?alt=media`, {
                headers: { Authorization: `Bearer ${token}` }
              });
              if (avatarContentRes.ok) {
                avatarBlob = await avatarContentRes.blob();
              }
            }
          }
        }
      }
    } catch (e) {}
  }

  if (avatarBlob) {
    const exists = avatarHistory.some(b => b.size === avatarBlob!.size && b.type === avatarBlob!.type);
    if (!exists) {
      avatarHistory = [avatarBlob, ...avatarHistory];
    }
  }

  if (!jsonData) throw new Error("无效的云端卡片格式或未找到卡片数据");
  return { jsonData, avatarBlob, studioMeta, avatarHistory, chats };
}
export async function syncLibraryToCloud(token: string, onProgress?: (msg: string) => void) {
  if (onProgress) onProgress('准备同步到云端卡库...');
  const { getCachedMeta } = await import('./db');
  const allChars = (await getCachedMeta()).filter((c) => !c.deletedAt);
  let successCount = 0;
  let skippedCount = 0;
  let failCount = 0;
  let completedCount = 0;

  const isAndroid = Capacitor.isNativePlatform();
  const CONCURRENCY = isAndroid ? 1 : 3;
  let currentIndex = 0;

  const uploadWorker = async () => {
    while (currentIndex < allChars.length) {
      const charIndex = currentIndex++;
      const char = allChars[charIndex];
      try {
        const result = await uploadCharacterToCloud(token, char.id, () => {});
        if (result === 'skipped') {
          skippedCount++;
        } else {
          successCount++;
        }
      } catch (e) {
        console.error("Sync char error", char.id, e);
        failCount++;
      } finally {
        completedCount++;
        if (onProgress) onProgress(`正在批量同步至云端... (${completedCount}/${allChars.length})`);
        await new Promise(r => setTimeout(r, isAndroid ? 200 : 50));
      }
    }
  };

  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(uploadWorker());
  }
  
  await Promise.all(workers);

  if (onProgress) onProgress(`同步完成! 成功: ${successCount} 个, 跳过: ${skippedCount} 个, 失败: ${failCount} 个`);
}

export async function syncFolderStructureToCloud(
  token: string,
  onProgress?: (msg: string, current?: number, total?: number) => void
): Promise<{ moved: number; unchanged: number; total: number }> {
  if (onProgress) onProgress('正在读取本地与云端卡片列表...');
  const { getCachedMeta, getFolders } = await import('./db');
  const localChars = (await getCachedMeta()).filter(c => !c.deletedAt);
  const allFolders = await getFolders();
  const rootFolderId = await getCloudFolderId(token);
  const cloudChars = await listCloudCharacters(token);

  if (cloudChars.length === 0 || localChars.length === 0) {
    return { moved: 0, unchanged: 0, total: localChars.length };
  }

  let moved = 0;
  let unchanged = 0;
  let completed = 0;

  // Build lookup maps for fast matching
  const cloudByCharId = new Map<string, any>();
  const cloudByName = new Map<string, any>();

  for (const cf of cloudChars) {
    if (cf.appProperties?.charId) {
      cloudByCharId.set(cf.appProperties.charId, cf);
    }
    const cleanName = (cf.appProperties?.charName || cf.name?.replace(/\.(zip|png|json|webp|jpg)$/i, '') || '').trim();
    if (cleanName) {
      if (!cloudByName.has(cleanName) || cf.appProperties?.charId) {
        cloudByName.set(cleanName, cf);
      }
    }
  }

  const resolvedFolderCache = new Map<string, string>();

  for (const localChar of localChars) {
    completed++;
    if (onProgress) {
      onProgress(`正在同步分类层级 (${completed}/${localChars.length})...`, completed, localChars.length);
    }

    let cloudFile = cloudByCharId.get(localChar.id);
    if (!cloudFile && localChar.name) {
      cloudFile = cloudByName.get(localChar.name.trim());
    }

    if (!cloudFile) {
      unchanged++;
      continue;
    }

    const { pathParts, folderPath } = await computeCharacterCloudPathParts(localChar, allFolders);
    const currentCloudFolder = cloudFile.appProperties?.folderPath || '';
    const existingParents = Array.isArray(cloudFile.parents) ? cloudFile.parents : [];

    const cacheKey = pathParts.join('/');
    let targetParentId = resolvedFolderCache.get(cacheKey);
    if (!targetParentId) {
      targetParentId = await resolveDriveFolderPath(token, rootFolderId, pathParts);
      resolvedFolderCache.set(cacheKey, targetParentId);
    }

    const folderChanged = currentCloudFolder !== folderPath || existingParents.length !== 1 || existingParents[0] !== targetParentId;

    if (!folderChanged) {
      unchanged++;
      continue;
    }

    try {
      const removeParents = existingParents.filter((id: string) => id !== targetParentId);
      
      let moveUrl = `https://www.googleapis.com/drive/v3/files/${cloudFile.id}?addParents=${encodeURIComponent(targetParentId)}&fields=id,parents`;
      if (removeParents.length > 0) {
        moveUrl += `&removeParents=${encodeURIComponent(removeParents.join(','))}`;
      }

      await fetch(moveUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-HTTP-Method-Override': 'PATCH',
        },
      });

      await fetch(`https://www.googleapis.com/drive/v3/files/${cloudFile.id}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-HTTP-Method-Override': 'PATCH'
        },
        body: JSON.stringify({
          appProperties: {
            ...(cloudFile.appProperties || {}),
            folderPath: folderPath,
            charId: localChar.id,
            charName: localChar.name || cloudFile.appProperties?.charName || ''
          }
        })
      });

      if (cloudFile.appProperties) {
        cloudFile.appProperties.folderPath = folderPath;
      }
      cloudFile.parents = [targetParentId];
      moved++;
    } catch (err) {
      console.error(`Sync folder failed for char ${localChar.name}:`, err);
    }
  }

  return { moved, unchanged, total: localChars.length };
}

export async function deleteCloudCharacter(token: string, fileId: string) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("Delete failed");
}

export async function uploadChatsToCloud(
  token: string,
  chatIds: string[],
  onProgress?: (msg: string) => void
): Promise<{ success: number; skipped: number; failed: number }> {
  const { getChatById, getCharacter } = await import('./db');
  let success = 0;
  let skipped = 0;
  let failed = 0;
  
  for (let i = 0; i < chatIds.length; i++) {
    const chatId = chatIds[i];
    if (onProgress) onProgress(`(${i + 1}/${chatIds.length})`);
    try {
      const chat = await getChatById(chatId);
      if (!chat) {
        failed++;
        continue;
      }
      const char = await getCharacter(chat.characterId);
      const charNameFallback = char?.name || char?.data?.name || char?.data?.data?.name || (chat.name ? chat.name.split(" - ")[0] : "Unknown");
      const safeCharName = charNameFallback.replace(/[\\/:*?"<>|]/g, "_");
      const safeChatName = chat.name ? chat.name.replace(/[\\/:*?"<>|]/g, "_") : "Unnamed";
      const formattedDate = new Date(chat.createdAt).toISOString().replace(/[:.]/g, "-");
      const filename = `${safeChatName}_${formattedDate}.jsonl`;
      const pathParts = ['聊天记录', safeCharName];
      const folderPath = pathParts.join('/');
      
      const jsonlString = chat.messages.map((m: any) => JSON.stringify(m)).join('\n');
      const blob = new Blob([jsonlString], { type: 'application/jsonl' });
      
      const fileHash = await hashBlobLight(blob, 'chat');
      const rootFolderId = await getCloudFolderId(token);
      const targetParentId = await resolveDriveFolderPath(token, rootFolderId, pathParts);
      
      const payload: CloudFilePayload = {
        blob,
        fileName: filename,
        mimeType: 'application/jsonl',
        appProperties: {
           isChat: 'true',
           chatId: chat.id,
           charId: chat.characterId,
           folderPath,
           contentHash: fileHash
        },
        contentHash: fileHash
      };
      
      const result = await upsertCloudFile(token, targetParentId, payload, `appProperties has { key='chatId' and value='${chat.id}' } and trashed=false`);
      if (result === 'uploaded') success++;
      else skipped++;
    } catch(e) {
      console.error(e);
      failed++;
    }
  }
  return { success, skipped, failed };
}






