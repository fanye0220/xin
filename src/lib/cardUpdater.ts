import { CharacterCard, saveCharacter, getCharacter } from './db';
import { extractTavernData } from './png';

export interface CardUpdateResult {
  hasUpdate: boolean;
  checkedAt: number;
  sourceUrl: string;
  currentVersion: string;
  remoteVersion: string;
  changesSummary: string[];
  remoteData?: any;
  remoteAvatarBlob?: Blob;
  remoteName?: string;
  error?: string;
}

/**
 * 针对不同来源 URL 进行智能预处理（支持 DC 常见分享盘、Pixeldrain、Catbox、Chub、Rentry、GitHub 等）
 */
export function normalizeSourceUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  if (!url) return '';

  // 1. Pixeldrain URLs (DC 常用免登分享盘) -> 自动转为直链 API 下载
  const pixeldrainMatch = url.match(/https?:\/\/(?:www\.)?pixeldrain\.com\/(?:u|l)\/([a-zA-Z0-9_-]+)/i);
  if (pixeldrainMatch) {
    return `https://pixeldrain.com/api/file/${pixeldrainMatch[1]}`;
  }

  // 2. Google Drive 共享链接 -> 转换为直接导出下载
  const gdriveMatch = url.match(/https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i);
  if (gdriveMatch) {
    return `https://drive.google.com/uc?export=download&id=${gdriveMatch[1]}`;
  }

  // 3. Dropbox 链接 -> 开启直接下载参数
  if (url.includes('dropbox.com')) {
    if (url.includes('dl=0')) {
      return url.replace('dl=0', 'dl=1');
    }
    if (!url.includes('dl=1')) {
      return url.includes('?') ? `${url}&dl=1` : `${url}?dl=1`;
    }
    return url;
  }

  // 4. Hugging Face blob 链接 -> 转换为 raw 直链
  if (url.includes('huggingface.co') && url.includes('/blob/')) {
    return url.replace('/blob/', '/raw/');
  }

  // 5. Chub / CharacterHub URLs -> 自动解析为其下载或 API 链接
  const chubMatch = url.match(/https?:\/\/(?:www\.)?(?:chub\.ai|characterhub\.org)\/characters\/([^\/\?#]+(?:\/[^\/\?#]+)?)/i);
  if (chubMatch) {
    const fullPath = chubMatch[1];
    return `https://api.chub.ai/api/characters/${fullPath}?full=true`;
  }

  // 6. Rentry URLs -> 自动获取 raw 文本
  const rentryMatch = url.match(/https?:\/\/rentry\.(?:co|org)\/([^\/\?#]+)(?:\/raw)?/i);
  if (rentryMatch) {
    return `https://rentry.co/${rentryMatch[1]}/raw`;
  }

  // 7. GitHub blob URLs -> 转为 raw 链接
  if (url.includes('github.com') && url.includes('/blob/')) {
    return url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
  }

  return url;
}

/**
 * 多通道防反爬与 CORS 代理抓取流水线
 */
export async function fetchRemoteCardBuffer(targetUrl: string, customProxyUrl?: string): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const normalizedUrl = normalizeSourceUrl(targetUrl);
  if (!normalizedUrl) {
    throw new Error('请输入有效的更新检测网址');
  }

  // 特殊识别 Discord 频道/消息链接 (discord.com/channels/...)
  if (normalizedUrl.includes('discord.com/channels/')) {
    throw new Error('当前绑定的是 Discord 频道帖子跳转链接。由于 DC 社区需登录账号且防爬，App 无法直接抓取频道内容。您可以点击链接直达 DC 帖子查看作者更新，或将作者/机器人分享的网盘直链 (如 Pixeldrain/Catbox) 填入作为检测源。');
  }

  // 代理通道列表（支持直连与多重免费高可用 CORS 代理）
  const proxyEndpoints: { name: string; getUrl: (u: string) => string }[] = [];

  if (customProxyUrl?.trim()) {
    proxyEndpoints.push({
      name: '自定义中继代理',
      getUrl: (u) => `${customProxyUrl.trim().replace(/\/+$/, '')}/${encodeURIComponent(u)}`
    });
  }

  // 直连尝试（部分支持 CORS 的 CDN，如 GitHub raw、Catbox 等）
  proxyEndpoints.push({
    name: '直接连接',
    getUrl: (u) => u
  });

  // CORS 代理通道
  proxyEndpoints.push({
    name: 'CorsProxy',
    getUrl: (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`
  });

  proxyEndpoints.push({
    name: 'AllOrigins',
    getUrl: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`
  });

  proxyEndpoints.push({
    name: 'CodeTabs',
    getUrl: (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`
  });

  let lastError: Error | null = null;

  for (const proxy of proxyEndpoints) {
    try {
      const fetchUrl = proxy.getUrl(normalizedUrl);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const response = await fetch(fetchUrl, {
        signal: controller.signal,
        headers: {
          'Accept': 'image/png,image/webp,image/*,application/json,text/plain,*/*'
        }
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      const buffer = await response.arrayBuffer();

      if (buffer && buffer.byteLength > 10) {
        return { buffer, contentType };
      }
    } catch (err: any) {
      lastError = err;
      // Continue to next proxy channel
    }
  }

  throw new Error(`无法从该网址下载卡片数据: ${lastError?.message || '网络连接超时或目标反爬拦截'}`);
}

/**
 * 从 URL 解析出完整的角色卡数据和头像 Blob
 */
export async function parseCardFromUrl(url: string, customProxyUrl?: string): Promise<{ data: any; avatarBlob?: Blob }> {
  const { buffer, contentType } = await fetchRemoteCardBuffer(url, customProxyUrl);

  // 1. 尝试作为图片解析元数据 (PNG / WebP / JPEG)
  try {
    const tavernData = await extractTavernData(buffer);
    if (tavernData) {
      const avatarBlob = new Blob([buffer], { type: contentType.includes('webp') ? 'image/webp' : 'image/png' });
      return { data: tavernData, avatarBlob };
    }
  } catch (e) {
    // Not a valid PNG/WebP metadata, continue to JSON text decoding
  }

  // 2. 尝试作为纯 JSON / Rentry 文本解析
  try {
    const text = new TextDecoder('utf-8').decode(buffer);
    let trimmed = text.trim();
    if (trimmed.charCodeAt(0) === 0xfeff) {
      trimmed = trimmed.slice(1).trim();
    }

    // Chub API 返回包装格式
    if (trimmed.startsWith('{')) {
      const json = JSON.parse(trimmed);
      if (json.node?.definition) {
        return { data: json.node.definition };
      }
      if (json.data && (json.data.name || json.data.description || json.data.first_mes || json.spec)) {
        return { data: json };
      }
      if (json.name || json.char_name || json.description || json.first_mes) {
        return { data: json };
      }
    }
  } catch (e) {
    // ignore
  }

  throw new Error('成功连接网址，但在该链接中未检测到符合酒馆/V2/V3规范的角色卡元数据');
}

/**
 * 比较本地卡片与远程卡片数据，计算详细变动与差异
 */
export function compareCardVersions(localCard: CharacterCard, remoteData: any, remoteAvatarBlob?: Blob): {
  hasUpdate: boolean;
  currentVersion: string;
  remoteVersion: string;
  changesSummary: string[];
} {
  const localTarget = localCard.data?.data || localCard.data || {};
  const remoteTarget = remoteData?.data || remoteData || {};

  const currentVersion = String(localTarget.character_version || localCard.data?.character_version || '1.0').trim();
  const remoteVersion = String(remoteTarget.character_version || remoteData?.character_version || currentVersion || '1.0').trim();

  const changesSummary: string[] = [];

  // 1. 版本号差异
  if (remoteVersion && currentVersion && remoteVersion !== currentVersion) {
    changesSummary.push(`版本号升级: ${currentVersion} → ${remoteVersion}`);
  }

  // 2. 角色名称
  const localName = (localCard.name || localTarget.name || '').trim();
  const remoteName = (remoteTarget.name || remoteData.name || '').trim();
  if (remoteName && localName && remoteName !== localName) {
    changesSummary.push(`角色名变动: 「${localName}」→「${remoteName}」`);
  }

  // 3. 人设与描述
  const localDesc = (localTarget.description || '').trim();
  const remoteDesc = (remoteTarget.description || '').trim();
  if (remoteDesc && localDesc && remoteDesc !== localDesc) {
    const diffChars = remoteDesc.length - localDesc.length;
    changesSummary.push(`角色描述更新 (${diffChars >= 0 ? `+${diffChars}` : diffChars} 字)`);
  } else if (!localDesc && remoteDesc) {
    changesSummary.push(`新增角色描述 (${remoteDesc.length} 字)`);
  }

  // 4. 性格设定
  const localPerson = (localTarget.personality || '').trim();
  const remotePerson = (remoteTarget.personality || '').trim();
  if (remotePerson && localPerson && remotePerson !== localPerson) {
    changesSummary.push('性格特征/人设设定已调整');
  }

  // 5. 开场白与备用问候语
  const localFirst = (localTarget.first_mes || '').trim();
  const remoteFirst = (remoteTarget.first_mes || '').trim();
  if (remoteFirst && localFirst && remoteFirst !== localFirst) {
    changesSummary.push('首条开场白已更新');
  }

  const localGreetings = Array.isArray(localTarget.alternate_greetings) ? localTarget.alternate_greetings : [];
  const remoteGreetings = Array.isArray(remoteTarget.alternate_greetings) ? remoteTarget.alternate_greetings : [];
  if (remoteGreetings.length !== localGreetings.length) {
    const diff = remoteGreetings.length - localGreetings.length;
    changesSummary.push(`备用开场白数量变动 (${diff > 0 ? `+${diff}` : diff} 条)`);
  } else if (remoteGreetings.length > 0 && JSON.stringify(remoteGreetings) !== JSON.stringify(localGreetings)) {
    changesSummary.push('备用开场白内容已更新');
  }

  // 6. 世界书 / Lorebook 条目
  const localEntries = localTarget.character_book?.entries || localTarget.lorebook?.entries || [];
  const remoteEntries = remoteTarget.character_book?.entries || remoteTarget.lorebook?.entries || [];
  const localEntriesCount = Array.isArray(localEntries) ? localEntries.length : 0;
  const remoteEntriesCount = Array.isArray(remoteEntries) ? remoteEntries.length : 0;

  if (remoteEntriesCount !== localEntriesCount) {
    const diff = remoteEntriesCount - localEntriesCount;
    changesSummary.push(`世界书设定条目 (${diff > 0 ? `+${diff}` : diff} 条)`);
  } else if (remoteEntriesCount > 0 && JSON.stringify(remoteEntries) !== JSON.stringify(localEntries)) {
    changesSummary.push('世界书条目设定已更新');
  }

  // 7. 头像更新检测
  if (remoteAvatarBlob && localCard.avatarBlob) {
    if (remoteAvatarBlob.size !== localCard.avatarBlob.size) {
      changesSummary.push('角色主头像已更新');
    }
  }

  const hasUpdate = changesSummary.length > 0;

  return {
    hasUpdate,
    currentVersion,
    remoteVersion,
    changesSummary
  };
}

/**
 * 针对单张角色卡进行更新检测
 */
export async function checkForCardUpdate(localCard: CharacterCard, customUrl?: string): Promise<CardUpdateResult> {
  const targetUrl = customUrl || localCard.updateUrl || localCard.sourceUrl || localCard.data?.extensions?.source || localCard.data?.source || '';
  
  if (!targetUrl || typeof targetUrl !== 'string') {
    return {
      hasUpdate: false,
      checkedAt: Date.now(),
      sourceUrl: '',
      currentVersion: '1.0',
      remoteVersion: '1.0',
      changesSummary: [],
      error: '该角色卡未绑定任何更新源网址'
    };
  }

  try {
    const { data: remoteData, avatarBlob: remoteAvatarBlob } = await parseCardFromUrl(targetUrl);
    const diff = compareCardVersions(localCard, remoteData, remoteAvatarBlob);

    const remoteName = remoteData.name || remoteData.data?.name || localCard.name;

    const result: CardUpdateResult = {
      hasUpdate: diff.hasUpdate,
      checkedAt: Date.now(),
      sourceUrl: targetUrl,
      currentVersion: diff.currentVersion,
      remoteVersion: diff.remoteVersion,
      changesSummary: diff.changesSummary,
      remoteData,
      remoteAvatarBlob,
      remoteName
    };

    // 保存检测结果缓存至角色卡
    const updatedCard: CharacterCard = {
      ...localCard,
      sourceUrl: targetUrl,
      lastCheckedAt: Date.now(),
      lastCheckResult: diff.hasUpdate ? 'has_update' : 'latest',
      lastCheckVersion: diff.remoteVersion,
      lastCheckChanges: diff.changesSummary,
      lastCheckError: undefined,
    };
    await saveCharacter(updatedCard);

    return result;
  } catch (err: any) {
    const result: CardUpdateResult = {
      hasUpdate: false,
      checkedAt: Date.now(),
      sourceUrl: targetUrl,
      currentVersion: '1.0',
      remoteVersion: '1.0',
      changesSummary: [],
      error: err.message || '检测更新失败'
    };

    const updatedCard: CharacterCard = {
      ...localCard,
      sourceUrl: targetUrl,
      lastCheckedAt: Date.now(),
      lastCheckResult: 'error',
      lastCheckError: err.message || '检测更新失败'
    };
    await saveCharacter(updatedCard);

    return result;
  }
}

/**
 * 应用更新：支持直接就地升级（自动备份原版本到历史）或另存为新角色卡
 */
export async function applyCardUpdate(
  localCard: CharacterCard,
  updateResult: CardUpdateResult,
  mode: 'upgrade' | 'save_as_new' = 'upgrade'
): Promise<CharacterCard> {
  if (!updateResult.remoteData) {
    throw new Error('缺少远程更新数据');
  }

  const fullChar = (await getCharacter(localCard.id)) || localCard;

  if (mode === 'save_as_new') {
    const newId = 'char_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const newName = (updateResult.remoteName || fullChar.name) + ` (${updateResult.remoteVersion || '新版'})`;
    
    const newCard: CharacterCard = {
      id: newId,
      name: newName,
      data: updateResult.remoteData,
      avatarBlob: updateResult.remoteAvatarBlob || fullChar.avatarBlob,
      avatarUrlFallback: fullChar.avatarUrlFallback,
      folderId: fullChar.folderId,
      sourceUrl: updateResult.sourceUrl,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastCheckedAt: Date.now(),
      lastCheckResult: 'latest',
      tags: fullChar.tags ? [...fullChar.tags] : []
    };

    await saveCharacter(newCard);
    return newCard;
  }

  // 1. 就地升级：先将当前版本完整存入 versionHistory 进行安全快照备份
  const currentSnapshot = {
    id: 'snap_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    versionName: `v${fullChar.data?.data?.character_version || fullChar.data?.character_version || '旧版备份'} (${new Date().toLocaleDateString('zh-CN')})`,
    note: `自动快照备份：升级至远程新版 ${updateResult.remoteVersion || ''}`,
    createdAt: Date.now(),
    data: JSON.parse(JSON.stringify(fullChar.data || {})),
    avatarBlob: fullChar.avatarBlob,
    cardName: fullChar.name,
    sourceCharId: fullChar.id,
    tags: fullChar.tags ? [...fullChar.tags] : []
  };

  const existingHistory = Array.isArray(fullChar.versionHistory) ? [...fullChar.versionHistory] : [];
  existingHistory.unshift(currentSnapshot);

  // 2. 覆盖为远程新数据
  const upgradedCard: CharacterCard = {
    ...fullChar,
    data: updateResult.remoteData,
    avatarBlob: updateResult.remoteAvatarBlob || fullChar.avatarBlob,
    versionHistory: existingHistory,
    sourceUrl: updateResult.sourceUrl,
    updatedAt: Date.now(),
    lastCheckedAt: Date.now(),
    lastCheckResult: 'latest',
    lastCheckChanges: [],
    lastCheckError: undefined
  };

  await saveCharacter(upgradedCard);
  return upgradedCard;
}
