/**
 * MIU 本地接收服务（酒馆 / TauriTavern -> MIU）的前端封装。
 *
 * 原生实现见 android/app/src/main/java/com/miu/app/MiuLocalReceiver.java：
 * 只在手机本机监听 127.0.0.1 的回环端口，酒馆侧扩展把角色卡 POST 过来即可，
 * 不需要账号、不需要登录、不上云。
 *
 * 网页版（Vercel / 浏览器）没有本地端口能力，isLocalLinkSupported() 会返回 false。
 */

export interface LocalReceiverStatus {
  /** 当前环境是否支持（只有安卓 App 是 true） */
  supported: boolean;
  running: boolean;
  port: number;
  pending: number;
  total: number;
  lastPushAt: number;
}

interface AndroidBridge {
  startLocalReceiver?: () => number;
  stopLocalReceiver?: () => void;
  getLocalReceiverStatus?: () => string;
  pullLocalReceiverOne?: () => string | null;
  clearLocalReceiver?: () => void;
  listLocalReceiverCards?: () => string;
  pullLocalReceiverById?: (id: string) => string | null;
  dropLocalReceiverById?: (id: string) => boolean;
  getOutboxStatus?: () => string;
  outboxBegin?: (name: string, bytes: number) => string | null;
  outboxChunk?: (operationId: string, index: number, base64: string) => boolean;
  outboxEnd?: (operationId: string) => boolean;
  removeOutboxCard?: (id: string) => boolean;
  clearOutbox?: () => number;
  requestTavernPull?: (kind?: string) => boolean;
  getTavernPullState?: () => string;
  setTavernPullPicks?: (json: string) => boolean;
  cancelTavernPull?: () => void;
  requestTavernThumbs?: (json: string) => void;
  getTavernPullThumb?: (avatar: string) => string;
  getPendingCardThumb?: (id: string) => string;
}

/** 队列里一张卡的元信息（不含内容）。 */
export interface QueueCardInfo {
  id: string;
  name: string;
  bytes: number;
  ts: number;
  /** 酒馆推过来时顺带带的小头像有没有（有也不在这里下发，按需取）。 */
  hasThumb?: boolean;
}

/** 一次推卡的分片大小，必须和原生 MiuLocalReceiver.MCP_CHUNK_BYTES 保持一致。 */
const CHUNK_BYTES = 48 * 1024;

const EMPTY_STATUS: LocalReceiverStatus = {
  supported: false,
  running: false,
  port: -1,
  pending: 0,
  total: 0,
  lastPushAt: 0,
};

function getBridge(): AndroidBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as any).Android as AndroidBridge | undefined;
  if (!bridge || typeof bridge.startLocalReceiver !== 'function') return null;
  return bridge;
}

export function isLocalLinkSupported(): boolean {
  return getBridge() !== null;
}

export function getLocalReceiverStatus(): LocalReceiverStatus {
  const bridge = getBridge();
  if (!bridge) return { ...EMPTY_STATUS };

  try {
    const raw = bridge.getLocalReceiverStatus?.();
    if (!raw) return { ...EMPTY_STATUS, supported: true };
    const parsed = JSON.parse(raw);
    return {
      supported: true,
      running: Boolean(parsed?.running),
      port: typeof parsed?.port === 'number' ? parsed.port : -1,
      pending: Number(parsed?.pending) || 0,
      total: Number(parsed?.total) || 0,
      lastPushAt: Number(parsed?.lastPushAt) || 0,
    };
  } catch {
    return { ...EMPTY_STATUS, supported: true };
  }
}

/** 开启接收服务，返回端口；失败返回 -1。 */
export function startLocalReceiver(): number {
  const bridge = getBridge();
  if (!bridge) return -1;
  try {
    const port = bridge.startLocalReceiver?.();
    return typeof port === 'number' ? port : -1;
  } catch {
    return -1;
  }
}

export function stopLocalReceiver(): void {
  try {
    getBridge()?.stopLocalReceiver?.();
  } catch {
    /* ignore */
  }
}

export function clearLocalReceiver(): void {
  try {
    getBridge()?.clearLocalReceiver?.();
  } catch {
    /* ignore */
  }
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function safeFileName(rawName: string | undefined, index: number): string {
  let name = (rawName || '').trim().replace(/[\\/]/g, '_').replace(/[\r\n"]/g, '');
  if (!name) name = `miu_tt_${Date.now()}_${index}`;
  if (!/\.(png|jpe?g|webp|json)$/i.test(name)) name += '.png';
  return name;
}

/**
 * 取走全部待接收卡片，转成 File（可直接交给导入流程）。
 * 一张一张通过原生桥取，避免一次性把几十 MB 的字符串塞进 JS 桥。
 */
export async function pullPendingCards(
  onProgress?: (pulled: number, pendingLeft: number) => void,
  maxCards = 500,
): Promise<File[]> {
  const bridge = getBridge();
  if (!bridge) return [];

  const files: File[] = [];
  for (let i = 0; i < maxCards; i++) {
    let raw: string | null = null;
    try {
      raw = bridge.pullLocalReceiverOne?.() ?? null;
    } catch {
      break;
    }
    if (!raw || raw === 'null') break;

    try {
      const parsed = JSON.parse(raw);
      const data = typeof parsed?.data === 'string' ? parsed.data : '';
      if (!data) continue;

      const bytes = base64ToBytes(data);
      if (!bytes.length) continue;

      const name = safeFileName(parsed?.name, i + 1);
      const type = name.toLowerCase().endsWith('.json') ? 'application/json' : 'image/png';
      files.push(new File([bytes], name, { type }));
    } catch {
      // 单张坏卡跳过，不影响后面的
      continue;
    }

    if (onProgress) {
      const left = getLocalReceiverStatus().pending;
      onProgress(files.length, left);
    }
    // 让出主线程，避免大量卡片把界面卡住
    if (i % 10 === 9) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// 待接收卡：可自选（导入面板用）
// ---------------------------------------------------------------------------

function parseCardList(json: string | undefined | null): QueueCardInfo[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    const cards = Array.isArray(parsed?.cards) ? parsed.cards : [];
    return cards
      .map((card: any) => ({
        id: String(card?.id ?? ''),
        name: String(card?.name ?? ''),
        bytes: Number(card?.bytes) || 0,
        ts: Number(card?.ts) || 0,
        hasThumb: Boolean(card?.hasThumb),
      }))
      .filter((card: QueueCardInfo) => card.id);
  } catch {
    return [];
  }
}

/** 列出待接收卡（只给元信息，不取内容）。 */
export function listPendingCards(): QueueCardInfo[] {
  const bridge = getBridge();
  if (!bridge?.listLocalReceiverCards) return [];
  try {
    return parseCardList(bridge.listLocalReceiverCards());
  } catch {
    return [];
  }
}

/** 列出等待发送到酒馆（TT）的卡。 */
export function listOutboxCards(): QueueCardInfo[] {
  const bridge = getBridge();
  if (!bridge?.getOutboxStatus) return [];
  try {
    return parseCardList(bridge.getOutboxStatus());
  } catch {
    return [];
  }
}

function fileFromCardJson(raw: string | null, fallbackIndex: number): File | null {
  if (!raw || raw === 'null') return null;
  try {
    const parsed = JSON.parse(raw);
    const data = typeof parsed?.data === 'string' ? parsed.data : '';
    if (!data) return null;

    const bytes = base64ToBytes(data);
    if (!bytes.length) return null;

    const name = safeFileName(parsed?.name, fallbackIndex);
    const type = name.toLowerCase().endsWith('.json') ? 'application/json' : 'image/png';
    return new File([bytes], name, { type });
  } catch {
    return null;
  }
}

/** 按 id 取走一张待接收卡（取出即从原生队列移除）。 */
export async function pullCardById(id: string, fallbackIndex = 1): Promise<File | null> {
  const bridge = getBridge();
  if (!bridge?.pullLocalReceiverById) return null;
  try {
    return fileFromCardJson(bridge.pullLocalReceiverById(id), fallbackIndex);
  } catch {
    return null;
  }
}

/** 丢掉一张待接收卡（不导入）。 */
export function dropCardById(id: string): boolean {
  try {
    return Boolean(getBridge()?.dropLocalReceiverById?.(id));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 发送到酒馆（MIU -> TT）
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** 从待发送列表里移除一张卡。 */
export function removeOutboxCard(id: string): boolean {
  try {
    return Boolean(getBridge()?.removeOutboxCard?.(id));
  } catch {
    return false;
  }
}

/** 清空待发送列表，返回清掉的张数。 */
export function clearOutbox(): number {
  try {
    return Number(getBridge()?.clearOutbox?.() ?? 0);
  } catch {
    return 0;
  }
}

/**
 * 把一批卡片放进「待发送到酒馆」队列。
 * 一张一张分片交给原生，避免一次性把几十 MB 塞进 JS 桥。
 */
export async function pushFilesToOutbox(
  files: File[],
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<{ added: number; failed: number }> {
  const bridge = getBridge();
  if (!bridge?.outboxBegin || !bridge?.outboxChunk || !bridge?.outboxEnd) {
    return { added: 0, failed: files.length };
  }

  let added = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!bytes.length) {
        failed++;
      } else {
        const operationId = bridge.outboxBegin(file.name, bytes.length);
        if (!operationId) {
          failed++;
        } else {
          let ok = true;
          const chunks = Math.ceil(bytes.length / CHUNK_BYTES);
          for (let index = 0; index < chunks; index++) {
            const slice = bytes.subarray(
              index * CHUNK_BYTES,
              Math.min((index + 1) * CHUNK_BYTES, bytes.length),
            );
            if (!bridge.outboxChunk(operationId, index, bytesToBase64(slice))) {
              ok = false;
              break;
            }
            if (index % 4 === 3) await new Promise((resolve) => setTimeout(resolve, 0));
          }

          if (!ok || !bridge.outboxEnd(operationId)) {
            failed++;
          } else {
            added++;
          }
        }
      }
    } catch {
      failed++;
    }

    if (onProgress) onProgress(added + failed, files.length, file.name);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return { added, failed };
}

// ---------------------------------------------------------------------------
// 从酒馆拉取（酒馆 -> MIU，由 MIU 这边发起）
//
// MIU 没法直接调酒馆的接口（TT 的 HTTP 只认它自己网页里带 CSRF 令牌的请求），
// 所以流程是：MIU 记一个「想要列表」的请求 -> 酒馆扩展轮询取走、把角色列表送上来
// -> MIU 显示列表给用户勾选 -> 扩展取走勾中的 avatar、导出 PNG 推进待接收队列
// -> MIU 按 id 把这几张取走导入。
// ---------------------------------------------------------------------------

export type TavernPullPhase = 'idle' | 'listing' | 'picking' | 'pulling' | 'done' | 'error';

/** 拉取列表里的数据类型。 */
export type TavernPullKind = 'character' | 'worldbook' | 'preset' | 'theme' | 'qr' | 'regex';

/**
 * 酒馆拉取列表里的一项。
 * 角色卡的 id 就是 avatar 文件名；工具类用 wb: / preset: / theme: / qr: / regex: 开头。
 */
export interface TavernCardInfo {
  id: string;
  kind: TavernPullKind;
  avatar: string;
  name: string;
  apiId?: string;
  sub?: string;
}

export interface TavernPullState {
  phase: TavernPullPhase;
  message: string;
  /** 酒馆送回来的列表（只有拿到列表后才有内容；按分类拉取时就是那一类的）。 */
  list: TavernCardInfo[];
  /** 上面这份列表是哪一类的（原生侧记的，按需拉取时用来归类）。 */
  listKind: TavernPullKind | '';
  listSize: number;
  listAt: number;
  picksCount: number;
  total: number;
  done: number;
  failed: number;
  requestedAt: number;
  finishedAt: number;
  /** 本轮拉取落进待接收队列的卡 id，用于精确取走这几张。 */
  importedIds: string[];
  /** 已收到的小头像张数；变了说明有新图，列表靠它触发重试。 */
  thumbRev: number;
  /** 酒馆扩展最近一次轮询的时间（0 = 从没回过话）。 */
  extSeenAt: number;
  /** 酒馆扩展上报的失败原因，界面直接显示。 */
  extError: string;
  /** 酒馆那头渲染小头像失败的原因（缩略图取不到等）。 */
  thumbError: string;
}

const EMPTY_PULL_STATE: TavernPullState = {
  phase: 'idle',
  message: '',
  list: [],
  listKind: '',
  listSize: 0,
  listAt: 0,
  picksCount: 0,
  total: 0,
  done: 0,
  failed: 0,
  requestedAt: 0,
  finishedAt: 0,
  importedIds: [],
  thumbRev: 0,
  extSeenAt: 0,
  extError: '',
  thumbError: '',
};

const PULL_PHASES: TavernPullPhase[] = ['idle', 'listing', 'picking', 'pulling', 'done', 'error'];

const PULL_KINDS: TavernPullKind[] = ['character', 'worldbook', 'preset', 'theme', 'qr', 'regex'];

function parseTavernCards(value: unknown): TavernCardInfo[] {
  if (!Array.isArray(value)) return [];
  const cards: TavernCardInfo[] = [];
  for (const item of value) {
    const raw = item as any;
    const avatar = typeof raw?.avatar === 'string' ? raw.avatar : '';
    const id = typeof raw?.id === 'string' && raw.id ? raw.id : avatar;
    if (!id) continue;
    const kind = PULL_KINDS.includes(raw?.kind) ? (raw.kind as TavernPullKind) : 'character';
    const name = typeof raw?.name === 'string' && raw.name ? raw.name : (avatar || id);
    cards.push({
      id,
      kind,
      avatar,
      name,
      apiId: typeof raw?.apiId === 'string' ? raw.apiId : undefined,
      sub: typeof raw?.sub === 'string' ? raw.sub : undefined,
    });
  }
  return cards;
}

/** 当前拉取状态（读不到就是 idle）。 */
export function getTavernPullState(): TavernPullState {
  const bridge = getBridge();
  if (!bridge?.getTavernPullState) return { ...EMPTY_PULL_STATE };
  try {
    const parsed = JSON.parse(bridge.getTavernPullState() || '{}');
    const phase = PULL_PHASES.includes(parsed?.phase) ? (parsed.phase as TavernPullPhase) : 'idle';
    const importedIds = Array.isArray(parsed?.imported)
      ? parsed.imported.filter((id: unknown): id is string => typeof id === 'string' && Boolean(id))
      : [];
    return {
      phase,
      message: typeof parsed?.message === 'string' ? parsed.message : '',
      list: parseTavernCards(parsed?.list),
      listKind: PULL_KINDS.includes(parsed?.listKind) ? (parsed.listKind as TavernPullKind) : '',
      listSize: Number(parsed?.listSize) || 0,
      listAt: Number(parsed?.listAt) || 0,
      picksCount: Number(parsed?.picksCount) || 0,
      total: Number(parsed?.total) || 0,
      done: Number(parsed?.done) || 0,
      failed: Number(parsed?.failed) || 0,
      requestedAt: Number(parsed?.requestedAt) || 0,
      finishedAt: Number(parsed?.finishedAt) || 0,
      importedIds,
      thumbRev: Number(parsed?.thumbRev) || 0,
      extSeenAt: Number(parsed?.extSeenAt) || 0,
      extError: typeof parsed?.extError === 'string' ? parsed.extError : '',
      thumbError: typeof parsed?.thumbError === 'string' ? parsed.thumbError : '',
    };
  } catch {
    return { ...EMPTY_PULL_STATE };
  }
}

/** 请酒馆渲染这几张卡的小头像（只传当前看得见的那几张，别一次要一整个列表）。 */
export function requestTavernThumbs(avatars: string[]): void {
  if (!avatars.length) return;
  try {
    getBridge()?.requestTavernThumbs?.(JSON.stringify(avatars));
  } catch {
    /* ignore */
  }
}

/** 取某张酒馆卡的小头像（data URL）；还没送到就返回空串。 */
export function getTavernPullThumb(avatar: string): string {
  try {
    return getBridge()?.getTavernPullThumb?.(avatar) || '';
  } catch {
    return '';
  }
}

/** 取某张待接收卡的随卡小头像（data URL）；没有就返回空串。 */
export function getPendingCardThumb(id: string): string {
  try {
    return getBridge()?.getPendingCardThumb?.(id) || '';
  } catch {
    return '';
  }
}

/**
 * 请酒馆把列表送过来。
 * kind 指明这一次只要哪一类（不传 = 全都要）：点了哪一类才拉哪一类，别一开面板就把酒馆全要过来。
 */
export function requestTavernPull(kind?: TavernPullKind): boolean {
  try {
    return Boolean(getBridge()?.requestTavernPull?.(kind || ''));
  } catch {
    return false;
  }
}

/** 把勾中的 avatar 交给原生，等酒馆扩展来取。 */
export function setTavernPullPicks(avatars: string[]): boolean {
  if (!avatars.length) return false;
  try {
    return Boolean(getBridge()?.setTavernPullPicks?.(JSON.stringify(avatars)));
  } catch {
    return false;
  }
}

/** 取消当前拉取。 */
export function cancelTavernPull(): void {
  try {
    getBridge()?.cancelTavernPull?.();
  } catch {
    /* ignore */
  }
}
