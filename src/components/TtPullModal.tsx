import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle,
  BookOpen,
  Braces,
  Check,
  Download,
  Loader2,
  MessageSquare,
  Palette,
  RefreshCw,
  Search,
  SlidersHorizontal,
  UserRound,
  X,
} from 'lucide-react';
import {
  cancelTavernPull,
  getTavernPullThumb,
  getTavernPullState,
  pullCardById,
  requestTavernPull,
  requestTavernThumbs,
  setTavernPullPicks,
  type TavernCardInfo,
  type TavernPullKind,
  type TavernPullState,
} from '../lib/localLink';
import { useInView } from '../lib/useInView';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** 拉回来的卡交给 App 走正常导入流程 */
  onImportFiles: (files: File[]) => void;
}

/** 等酒馆回列表超过这个时间就算超时（酒馆挂后台会被降频，给宽一点）。 */
const LIST_TIMEOUT_MS = 90000;
/** 拉取整体超过这个时间就算卡住。 */
const PULL_TIMEOUT_MS = 5 * 60 * 1000;

const chipButtonClass =
  'text-xs px-3 py-1.5 rounded-xl transition cursor-pointer active:scale-[0.98] font-semibold bg-white/5 hover:bg-white/15 text-white/80 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] border-none outline-none select-none';

/** 分类就是酒馆里的那几类；没有「全部」——那等于一开面板就把酒馆里的东西全要过来。 */
type PullTab = TavernPullKind;

const PULL_TABS: { key: PullTab; label: string }[] = [
  { key: 'character', label: '角色卡' },
  { key: 'worldbook', label: '世界书' },
  { key: 'preset', label: '预设' },
  { key: 'theme', label: '美化' },
  { key: 'qr', label: '快速回复' },
  { key: 'regex', label: '正则' },
];

/** 空列表 / 空勾选用同一个常量，省得每次渲染都新建一个。 */
const EMPTY_ITEMS: TavernCardInfo[] = [];
const EMPTY_SELECTION: Set<string> = new Set();

const KIND_LABEL: Record<TavernPullKind, string> = {
  character: '角色卡',
  worldbook: '世界书',
  preset: '预设',
  theme: '美化',
  qr: '快速回复',
  regex: '正则',
};

function KindIcon({ kind, className }: { kind: TavernPullKind; className?: string }) {
  if (kind === 'worldbook') return <BookOpen className={className} />;
  if (kind === 'preset') return <SlidersHorizontal className={className} />;
  if (kind === 'theme') return <Palette className={className} />;
  if (kind === 'qr') return <MessageSquare className={className} />;
  if (kind === 'regex') return <Braces className={className} />;
  return <UserRound className={className} />;
}

/**
 * 小头像请求合批：一屏几十行如果各发一次桥调用太碎，
 * 攒 250ms 合成一次（原生那边同一个 avatar 只会排一次队，一轮最多给 12 张）。
 */
const pendingThumbs = new Set<string>();
let pendingThumbTimer = 0;

function queueThumbRequest(avatar: string) {
  if (!avatar) return;
  pendingThumbs.add(avatar);
  if (pendingThumbTimer) return;
  pendingThumbTimer = window.setTimeout(() => {
    pendingThumbTimer = 0;
    const batch = Array.from(pendingThumbs);
    pendingThumbs.clear();
    if (batch.length) requestTavernThumbs(batch);
  }, 250);
}

/**
 * 列表里的小头像：只有划进视口的那几行才会去问酒馆要，
 * 而且只要一张 112px 的小图（几 KB），不会顺手把整张卡拉下来；
 * 也不自己起轮询定时器——有图送到时父层的 thumbRev 会变，effect 会重跑。
 */
function PullAvatar({ avatar, rev }: { avatar: string; rev: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!inView) return;
    const ready = getTavernPullThumb(avatar);
    if (ready) {
      setUrl(ready);
      return;
    }
    queueThumbRequest(avatar);
  }, [inView, avatar, rev]);

  return (
    <div
      ref={ref}
      className="w-11 h-11 rounded-xl overflow-hidden shrink-0 bg-white/5 [.light-theme_&]:!bg-[#f1f5f9] flex items-center justify-center"
    >
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" decoding="async" />
      ) : (
        <UserRound className="w-4 h-4 text-white/25 [.light-theme_&]:!text-slate-300" />
      )}
    </div>
  );
}

export function TtPullModal({ isOpen, onClose, onImportFiles }: Props) {
  const isLightMode = typeof document !== 'undefined' && (
    document.documentElement.classList.contains('light-theme') ||
    document.body.classList.contains('light-theme') ||
    localStorage.getItem('tavern_theme') === 'light'
  );
  const [state, setState] = useState<TavernPullState>(() => getTavernPullState());
  const [tab, setTab] = useState<PullTab>('character');
  /** 每一类各存一份拿到的列表：点过的分类不会再问酒馆要第二遍。 */
  const [lists, setLists] = useState<Partial<Record<PullTab, TavernCardInfo[]>>>({});
  /** 每类各记一份勾选：来回切分类不会把刚勾好的清掉。 */
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  /** 正在等哪一类的列表（null = 没在等）。 */
  const [pendingKind, setPendingKind] = useState<PullTab | null>(null);
  const [query, setQuery] = useState('');
  /** 列表一次先渲染多少条：酒馆里卡多的时候别一口气糊上千行 DOM。 */
  const [displayLimit, setDisplayLimit] = useState(36);
  const [notice, setNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const importedRef = useRef(false);
  const listsRef = useRef<Partial<Record<PullTab, TavernCardInfo[]>>>({});
  const pendingRef = useRef<PullTab | null>(null);
  const storedListAtRef = useRef(0);

  /**
   * 只要当前这一类的列表——和「酒馆拉取中心」一个路子：
   * 点角色卡就只问角色卡，点预设才去读预设目录；已经拿过的直接吃缓存，不再跑一趟。
   */
  const requestKind = useCallback((kind: PullTab, force?: boolean) => {
    setNotice('');
    setDisplayLimit(36);
    if (!force && listsRef.current[kind]) {
      pendingRef.current = null;
      setPendingKind(null);
      return;
    }
    pendingRef.current = kind;
    setPendingKind(kind);
    if (!requestTavernPull(kind)) {
      pendingRef.current = null;
      setPendingKind(null);
      setNotice('接收服务没开着，先回上一页点「开启接收服务」。');
    }
    setState(getTavernPullState());
  }, []);

  const switchKind = (kind: PullTab) => {
    if (kind === tab) return;
    setTab(kind);
    setQuery('');
    requestKind(kind);
  };

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setImporting(false);
    setNotice('');
    importedRef.current = false;
    listsRef.current = {};
    setLists({});
    setSelections({});
    storedListAtRef.current = 0;
    setTab('character');
    requestKind('character', true);
  }, [isOpen, requestKind]);

  // 每秒看一次原生状态：酒馆回列表、拉取进度、拉完的卡 id 都在里面。
  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setInterval(() => setState(getTavernPullState()), 1000);
    return () => window.clearInterval(timer);
  }, [isOpen]);

  /**
   * 酒馆把某一类的列表送回来了：按它报的类别存进缓存（老原生没报就按我们请求的那一类算），
   * 刚拿到的这一类默认全选；之后用户怎么勾就怎么算——每秒轮询不会把取消掉的又选回来。
   */
  useEffect(() => {
    if (state.phase === 'error') {
      pendingRef.current = null;
      setPendingKind(null);
      return;
    }
    if (state.phase !== 'picking' || !state.listAt) return;
    if (storedListAtRef.current === state.listAt) return;
    const kind = (state.listKind || pendingRef.current || '') as PullTab | '';
    if (!kind || !PULL_TABS.some((item) => item.key === kind)) return;
    storedListAtRef.current = state.listAt;
    const items = state.list.filter((card) => card.kind === kind);
    const nextLists = { ...listsRef.current, [kind]: items };
    listsRef.current = nextLists;
    setLists(nextLists);
    setSelections((prev) => ({ ...prev, [kind]: new Set(items.map((card) => card.id)) }));
    if (pendingRef.current === kind) {
      pendingRef.current = null;
      setPendingKind(null);
    }
  }, [state.phase, state.list, state.listAt, state.listKind]);

  // 拉完了：按 id 把这几张取走，直接交给导入流程。
  useEffect(() => {
    if (!isOpen || state.phase !== 'done' || importedRef.current) return;
    importedRef.current = true;
    let cancelled = false;

    (async () => {
      setImporting(true);
      const files: File[] = [];
      for (let index = 0; index < state.importedIds.length; index++) {
        const file = await pullCardById(state.importedIds[index], index + 1);
        if (file) files.push(file);
      }
      if (cancelled) return;
      setImporting(false);
      if (files.length === 0) {
        importedRef.current = false;
        setNotice('酒馆说拉好了，但 MIU 这边没取到卡，再点一次重新请求。');
        return;
      }
      onImportFiles(files);
      onClose();
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, state.phase, state.importedIds, onImportFiles, onClose]);

  const currentItems = lists[tab] || EMPTY_ITEMS;
  const currentSelected = selections[tab] || EMPTY_SELECTION;
  const currentCount = currentItems.length;
  /** 当前这一类的列表还没到手。 */
  const waitingList = pendingKind === tab && currentCount === 0;

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return currentItems;
    return currentItems.filter((card) =>
      card.name.toLowerCase().includes(keyword) ||
      card.avatar.toLowerCase().includes(keyword) ||
      (card.sub || '').toLowerCase().includes(keyword),
    );
  }, [currentItems, query]);

  /** 这一屏先渲染的部分（分页尺寸和酒馆拉取中心一致：36 起）。 */
  const visible = useMemo(() => filtered.slice(0, displayLimit), [filtered, displayLimit]);

  const toggle = (id: string) => {
    setSelections((prev) => {
      const next = new Set(prev[tab] || []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [tab]: next };
    });
  };

  const elapsed = state.requestedAt ? Date.now() - state.requestedAt : 0;
  const listStalled = state.phase === 'listing' && elapsed > LIST_TIMEOUT_MS;
  const pullStalled = state.phase === 'pulling' && elapsed > PULL_TIMEOUT_MS;
  const extSeenAgo = state.extSeenAt > 0
    ? Math.max(0, Math.round((Date.now() - state.extSeenAt) / 1000))
    : -1;
  const hint =
    notice ||
    state.extError ||
    (state.phase !== 'listing' && state.thumbError
      ? 'TauriTavern 那头取不到缩略图（' + state.thumbError + '），列表先显示占位图标，不影响勾选和拉取。'
      : '') ||
    (pullStalled
      ? '拉取好像卡住了，点「重新请求」再来一次。'
      : listStalled
        ? extSeenAgo >= 0
          ? '酒馆扩展还在轮询（' + extSeenAgo + ' 秒前刚回过话），但列表没送上来，它那边多半在忙别的（比如正在推卡）。'
          : '酒馆扩展一次都没回话：酒馆要开着（挂小窗也行，别退到后台），扩展面板里点过「连接 MIU」。'
        : '');

  const handlePull = () => {
    const picks = Array.from(currentSelected);
    if (!picks.length) return;
    setNotice('');
    if (!setTavernPullPicks(picks)) {
      setNotice('MIU 没记下勾选，再点一次。');
      return;
    }
    setState(getTavernPullState());
  };

  const handleClose = () => {
    const current = getTavernPullState();
    // 还没交给酒馆的就取消掉；已经在拉的就让它拉完（拉完会进待接收）。
    if (current.phase === 'listing' || current.phase === 'picking') cancelTavernPull();
    onClose();
  };

  if (!isOpen) return null;

  const canPick = currentCount > 0;

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm bg-black/75 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className={`version-modal-box rounded-3xl p-5 sm:p-6 w-[92vw] sm:w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] relative overflow-hidden ${
            isLightMode ? "light-theme !bg-white !text-slate-900 !border-[#e2e8f0]" : ""
          }`}
        >
          <div className="flex items-center justify-between pb-3.5 border-b version-modal-border relative z-10">
            <div>
              <h3 className="text-base sm:text-lg font-bold version-modal-title flex items-center gap-2">
                <Download className="w-5 h-5 opacity-80 text-blue-500" />
                拉取 TauriTavern
              </h3>
              <p className="text-xs mt-1 version-modal-desc">
                {canPick
                  ? `这一类有 ${currentCount} 项，勾选要拉进 MIU 的`
                  : '和酒馆拉取中心一样：点哪一类才拉哪一类'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full version-modal-close-btn flex items-center justify-center cursor-pointer transition shadow-xs"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <>
              {canPick && (
                <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2.5 mt-3 relative z-10">
                  <div className="relative flex-1 min-w-0">
                    <Search className={`absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${isLightMode ? "text-slate-400" : "text-white/40"}`} />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="搜索名称"
                      className={`w-full pl-9 pr-3 py-2.5 rounded-2xl text-xs sm:text-sm outline-none border transition-all ${
                        isLightMode
                          ? "bg-[#f1f5f9] text-[#0f172a] placeholder:text-[#94a3b8] border-[#e2e8f0] focus:border-blue-500 focus:bg-white"
                          : "bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:bg-white/10"
                      }`}
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0 justify-between sm:justify-end">
                    <span className={`text-xs font-semibold ${isLightMode ? "text-slate-600" : "text-white/60"}`}>
                      已勾选 <strong className={isLightMode ? "text-blue-600 font-bold" : "text-blue-400 font-bold"}>{currentSelected.size}</strong> / {currentCount} 项
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelections((prev) => ({ ...prev, [tab]: new Set(filtered.map((card) => card.id)) }))}
                        className={`text-xs px-3 py-1.5 rounded-full transition cursor-pointer font-semibold border-none outline-none select-none ${
                          isLightMode
                            ? "bg-[#f1f5f9] text-[#334155] hover:bg-[#e2e8f0] active:bg-[#cbd5e1]"
                            : "bg-white/5 text-white/80 hover:bg-white/15 active:bg-white/20"
                        }`}
                      >
                        全选 ({filtered.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelections((prev) => ({ ...prev, [tab]: new Set() }))}
                        className={`text-xs px-3 py-1.5 rounded-full transition cursor-pointer font-semibold border-none outline-none select-none ${
                          isLightMode
                            ? "bg-[#f1f5f9] text-[#334155] hover:bg-[#e2e8f0] active:bg-[#cbd5e1]"
                            : "bg-white/5 text-white/80 hover:bg-white/15 active:bg-white/20"
                        }`}
                      >
                        清空
                      </button>
                    </div>
                  </div>
                </div>
              )}

                            {!importing && (
                <div className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar pb-1 mt-2.5 shrink-0 relative z-10">
                  {PULL_TABS.map((item) => {
                    const active = tab === item.key;
                    const count = lists[item.key]?.length;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => switchKind(item.key)}
                        className={`shrink-0 whitespace-nowrap px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-150 cursor-pointer border-none outline-none select-none flex items-center justify-center gap-1.5 ${
                          active
                            ? 'bg-blue-600 text-white shadow-xs'
                            : isLightMode
                              ? 'bg-[#f1f5f9] text-[#475569] hover:bg-[#e2e8f0] hover:text-[#0f172a]'
                              : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        <span>{item.label}</span>
                        {pendingKind === item.key ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : typeof count === 'number' ? (
                          <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                            active
                              ? 'bg-white/25 text-white'
                              : isLightMode
                                ? 'bg-[#e2e8f0] text-[#475569]'
                                : 'bg-white/10 text-white/50'
                          }`}>
                            {count}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}

              <div
                onScroll={(event) => {
                  const target = event.currentTarget;
                  if (target.scrollHeight - target.scrollTop - target.clientHeight < 280) {
                    if (displayLimit < filtered.length) {
                      setDisplayLimit((prev) => Math.min(prev + 36, filtered.length));
                    }
                  }
                }}
                className="flex-1 overflow-y-auto space-y-2 sm:space-y-2.5 pr-1 my-3 max-h-[50vh] custom-scrollbar relative z-10"
              >
                {importing ? (
                  <div className="py-12 text-center text-sm version-modal-desc">正在把内容收进 MIU…</div>
                ) : waitingList ? (
                  <div className="py-12 text-center space-y-2 version-modal-desc">
                    <Loader2 className="w-6 h-6 mx-auto animate-spin text-blue-500" />
                    <p className="text-sm">{state.message || '正在向 TauriTavern 要列表…'}</p>
                  </div>
                ) : currentCount === 0 ? (
                  <div className="py-12 text-center text-sm version-modal-desc">这一类还没拉取，点上面的分类去要。</div>
                ) : filtered.length === 0 ? (
                  <div className="py-12 text-center text-sm version-modal-desc">没有符合条件的项</div>
                ) : (
                  visible.map((card) => {
                    const isSelected = currentSelected.has(card.id);
                    const sub = card.kind === 'character'
                      ? card.avatar
                      : [KIND_LABEL[card.kind], card.apiId, card.sub].filter(Boolean).join(' · ');
                    return (
                      <div
                        key={card.id}
                        onClick={() => toggle(card.id)}
                        className={`p-3.5 rounded-2xl transition cursor-pointer flex items-center justify-between gap-3 border version-candidate-card select-none outline-none focus:outline-none ${isSelected ? 'is-selected' : ''}`}
                      >
                        {card.kind === 'character' ? (
                          <PullAvatar avatar={card.avatar} rev={state.thumbRev} />
                        ) : (
                          <div className="w-11 h-11 rounded-xl shrink-0 bg-blue-500/10 [.light-theme_&]:!bg-blue-50 flex items-center justify-center text-blue-400 [.light-theme_&]:!text-blue-600">
                            <KindIcon kind={card.kind} className="w-5 h-5" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-sm sm:text-base truncate version-candidate-name">
                            {card.name || card.id}
                          </h4>
                          <p className="text-xs truncate mt-1 font-normal version-candidate-sub">
                            {sub}
                          </p>
                        </div>
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center transition shrink-0 version-candidate-radio ${isSelected ? 'is-selected' : ''}`}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                        </div>
                      </div>
                    );
                  })
                )}

                {!importing && displayLimit < filtered.length && (
                  <button
                    type="button"
                    onClick={() => setDisplayLimit((prev) => Math.min(prev + 48, filtered.length))}
                    className={`w-full py-2.5 text-center text-xs font-semibold rounded-xl transition cursor-pointer border-none outline-none select-none ${
                      isLightMode
                        ? 'bg-[#f1f5f9] text-[#334155] hover:bg-[#e2e8f0]'
                        : 'bg-white/5 text-white/80 hover:bg-white/15'
                    }`}
                  >
                    加载更多… (已显示 {visible.length} / {filtered.length} 项)
                  </button>
                )}
              </div>
          </>

          {(hint || state.phase === 'pulling') && (
            <div className="mb-2 text-xs relative z-10 flex items-start gap-2 text-white/70 [.light-theme_&]:!text-[#334155]">
              {hint ? (
                <>
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-500 mt-0.5" />
                  <span className="min-w-0">{hint}</span>
                </>
              ) : (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span className="truncate">
                    正在拉取 {state.done} / {state.total} 项
                    {state.failed > 0 ? `（失败 ${state.failed} 项）` : ''}
                  </span>
                </>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-3 border-t version-modal-border relative z-10">
            <button
              type="button"
              onClick={handleClose}
              className="soft-pill flex-1 py-3 px-4 rounded-2xl font-semibold text-xs sm:text-sm cursor-pointer transition active:scale-95 text-center bg-white/10 hover:bg-white/20 text-white/90 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:hover:!bg-[#e2e8f0]"
            >
              {canPick ? '取消' : '关闭'}
            </button>
            {canPick ? (
              <button
                type="button"
                disabled={currentSelected.size === 0}
                onClick={handlePull}
                className="flex-1 py-3 px-4 rounded-2xl bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-blue-600 [.light-theme_&]:hover:!bg-blue-100 font-bold text-xs sm:text-sm disabled:opacity-40 flex items-center justify-center gap-2 transition active:scale-95 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                拉取选中 ({currentSelected.size})
              </button>
            ) : (
              <button
                type="button"
                disabled={importing || (waitingList && !listStalled) || (state.phase === 'pulling' && !pullStalled)}
                onClick={() => requestKind(tab, true)}
                className="flex-1 py-3 px-4 rounded-2xl bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-blue-600 [.light-theme_&]:hover:!bg-blue-100 font-bold text-xs sm:text-sm disabled:opacity-40 flex items-center justify-center gap-2 transition active:scale-95 cursor-pointer"
              >
                {importing || waitingList || state.phase === 'pulling' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                {importing
                  ? '正在导入…'
                  : state.phase === 'pulling'
                    ? `拉取中 ${state.done}/${state.total}`
                    : waitingList
                      ? '正在等 TauriTavern…'
                      : '重新请求'}
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}
