/**
 * 酒馆助手（JS-Slash-Runner / MVU）运行时的轻量兼容层。
 *
 * MIU 的开场白/消息渲染在沙箱 iframe 中运行。SillyTavern / JS-Slash-Runner 生态的
 * 「状态栏 / 前端面板 / 封面 / 交互菜单」依赖同步或异步的全局 API（getChatMessages、
 * getVariables、waitGlobalInitialized、eventOn、Mvu、lodash `_`、YAML 等）。
 *
 * 本模块提供统一、健壮、只读无副作用（外加本地预览变量持久化与 swipe 跳转）的兼容层。
 */

/** MVU `_.set('a.b', 旧值, 新值)` 等指令 */
export interface MvuCommand {
  op: 'set' | 'insert' | 'assign' | 'add' | 'remove' | string;
  args: any[];
}

export interface WorldbookRuntimeEntry {
  uid?: number | string;
  comment?: string;
  name?: string;
  keys?: string[];
  content?: string;
  enabled?: boolean;
}

const UPDATE_BLOCK_RE = /<UpdateVariable\b[^>]*>([\s\S]*?)<\/UpdateVariable\s*>/gi;
const STATUS_VARS_RE = /<(?:status_current_variables|initvar|InitVar)\b[^>]*>([\s\S]*?)<\/(?:status_current_variables|initvar|InitVar)\s*>/gi;

function splitBalancedArgs(argStr: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escape = false;

  for (let i = 0; i < argStr.length; i++) {
    const ch = argStr[i];
    if (escape) {
      cur += ch;
      escape = false;
      continue;
    }
    if (quote) {
      cur += ch;
      if (ch === '\\') {
        escape = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') {
      depth++;
      cur += ch;
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      if (depth > 0) depth--;
      cur += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function coerceJsLiteral(raw: string): any {
  const s = raw.trim();
  if (!s) return '';
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"')) || (s.startsWith('`') && s.endsWith('`'))) {
    const inner = s.slice(1, -1);
    return inner.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\(['"\\])/g, '$1');
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (s === 'undefined') return undefined;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      return JSON.parse(s);
    } catch {
      // Relaxed single-quoted JSON fallback
      try {
        const relaxed = s
          .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner) => `"${inner.replace(/"/g, '\\"')}"`)
          .replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(relaxed);
      } catch {
        return s;
      }
    }
  }
  return s;
}

/** 轻量级 JSON / YAML 解析（用于 [InitVar] 世界书或 <status_current_variables> 块） */
export function parseLooseYamlOrJson(raw: string): Record<string, any> | null {
  if (!raw || typeof raw !== 'string') return null;
  let text = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  // Strip surrounding XML-like tags or markdown code fences
  text = text
    .replace(/^<(?:initvar|InitVar|status_current_variables|variables)\b[^>]*>/i, '')
    .replace(/<\/(?:initvar|InitVar|status_current_variables|variables)\s*>$/i, '')
    .trim();
  const fenceMatch = text.match(/^```(?:json|yaml|yml)?\s*\n([\s\S]*?)\n?```\s*$/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  if (!text) return null;

  // 1. Try JSON directly
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Fall through to YAML parser
    }
  }

  // 2. Indentation-based YAML subset parser
  const lines = text.split('\n');
  const root: Record<string, any> = {};
  const stack: Array<{ indent: number; container: any; parent?: any; parentKey?: string }> = [
    { indent: -1, container: root },
  ];

  const parseScalar = (val: string): any => {
    const v = val.trim();
    if (!v || v === '~' || v === 'null') return null;
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1);
    }
    if ((v.startsWith('[') && v.endsWith(']')) || (v.startsWith('{') && v.endsWith('}'))) {
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    }
    return v;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine.trim() || rawLine.trim().startsWith('#') || rawLine.trim() === '---') continue;
    const indent = rawLine.search(/\S/);
    const trimmed = rawLine.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const top = stack[stack.length - 1];

    if (trimmed.startsWith('- ')) {
      const itemVal = trimmed.slice(2).trim();
      if (!Array.isArray(top.container)) {
        if (top.parent && top.parentKey !== undefined && typeof top.parent[top.parentKey] === 'object' && Object.keys(top.parent[top.parentKey]).length === 0) {
          top.parent[top.parentKey] = [];
          top.container = top.parent[top.parentKey];
        } else {
          continue;
        }
      }
      if (itemVal.includes(': ') || itemVal.endsWith(':')) {
        const colonIdx = itemVal.indexOf(':');
        const k = itemVal.slice(0, colonIdx).trim().replace(/^['"]|['"]$/g, '');
        const rest = itemVal.slice(colonIdx + 1).trim();
        const obj: Record<string, any> = {};
        if (rest) obj[k] = parseScalar(rest);
        else obj[k] = {};
        top.container.push(obj);
        stack.push({ indent, container: obj });
      } else {
        top.container.push(parseScalar(itemVal));
      }
      continue;
    }

    const colonMatch = trimmed.match(/^([^:#]+?)\s*:\s*(.*)$/);
    if (!colonMatch || Array.isArray(top.container)) continue;

    const key = colonMatch[1].trim().replace(/^['"]|['"]$/g, '');
    const rest = colonMatch[2].replace(/\s+#.*$/, '').trim();
    if (!key) continue;

    if (!rest) {
      const child: Record<string, any> = {};
      top.container[key] = child;
      stack.push({ indent, container: child, parent: top.container, parentKey: key });
    } else {
      top.container[key] = parseScalar(rest);
    }
  }

  return Object.keys(root).length > 0 ? root : null;
}

/** 从文本中解析 MVU 变量更新指令（支持嵌套对象/数组参数，不再被分号截断） */
export function parseMvuCommands(text: string): MvuCommand[] {
  if (!text) return [];
  const blocks = text.match(UPDATE_BLOCK_RE);
  const body = blocks && blocks.length > 0 ? blocks.join('\n') : text;
  const cmds: MvuCommand[] = [];

  const callStartRe = /_\.(set|insert|assign|add|remove)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callStartRe.exec(body))) {
    const op = m[1];
    let idx = callStartRe.lastIndex;
    let depth = 1;
    let quote: '"' | "'" | '`' | null = null;
    let escape = false;

    while (idx < body.length && depth > 0) {
      const ch = body[idx];
      if (escape) {
        escape = false;
      } else if (quote) {
        if (ch === '\\') escape = true;
        else if (ch === quote) quote = null;
      } else {
        if (ch === '"' || ch === "'" || ch === '`') quote = ch;
        else if (ch === '(') depth++;
        else if (ch === ')') depth--;
      }
      idx++;
    }

    const inner = body.slice(callStartRe.lastIndex, depth === 0 ? idx - 1 : idx);
    const rawArgs = splitBalancedArgs(inner);
    if (rawArgs.length > 0) {
      cmds.push({ op, args: rawArgs.map(coerceJsLiteral) });
    }
    callStartRe.lastIndex = idx;
  }
  return cmds;
}

function setNestedPath(root: Record<string, any>, path: string, value: any) {
  const keys = String(path).split('.').map((k) => k.trim()).filter(Boolean);
  if (!keys.length) return;
  let cur: any = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof cur[k] !== 'object' || cur[k] === null || Array.isArray(cur[k])) {
      cur[k] = {};
    }
    cur = cur[k];
  }
  const last = keys[keys.length - 1];
  cur[last] = value;
}

export function deepMergeObjects(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return target;
  const out: Record<string, any> = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = out[key];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv)) {
      out[key] = deepMergeObjects(tv, sv);
    } else if (sv !== undefined) {
      out[key] = sv;
    }
  }
  return out;
}

/** 把指令套成一棵嵌套变量对象（和 MVU 的 stat_data 结构一致） */
export function buildMvuStatData(cmds: MvuCommand[]): Record<string, any> {
  const root: Record<string, any> = {};
  for (const c of cmds) {
    if (c.op === 'set' && c.args.length >= 3) {
      setNestedPath(root, String(c.args[0]), c.args[2]);
    } else if (c.op === 'set' && c.args.length === 2) {
      setNestedPath(root, String(c.args[0]), c.args[1]);
    } else if (c.op === 'insert' && c.args.length >= 2) {
      setNestedPath(root, String(c.args[0]), c.args[1]);
    } else if (c.op === 'assign' && c.args.length >= 2) {
      setNestedPath(root, String(c.args[0]), c.args[1]);
    }
  }
  return root;
}

/** 一行拿到文本里的 MVU 变量（同时支持 _.set 指令、JSON Patch、YAML/JSON 状态块） */
export function extractMvuStatData(text: string): Record<string, any> {
  if (!text) return {};
  let merged: Record<string, any> = {};

  try {
    // 1. Parse <status_current_variables> / <initvar> blocks if any
    STATUS_VARS_RE.lastIndex = 0;
    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = STATUS_VARS_RE.exec(text))) {
      const parsed = parseLooseYamlOrJson(blockMatch[1]);
      if (parsed) {
        const inner = parsed.stat_data && typeof parsed.stat_data === 'object' ? parsed.stat_data : parsed;
        merged = deepMergeObjects(merged, inner);
      }
    }
  } catch {}

  try {
    // 2. Parse <UpdateVariable> JSON-Patch or _.set commands
    const updateBlocks = text.match(UPDATE_BLOCK_RE);
    if (updateBlocks) {
      for (const blk of updateBlocks) {
        const inner = blk.replace(/^<UpdateVariable\b[^>]*>/i, '').replace(/<\/UpdateVariable\s*>$/i, '').trim();
        if (inner.startsWith('[')) {
          try {
            const ops = JSON.parse(inner);
            if (Array.isArray(ops)) {
              for (const op of ops) {
                if (op && typeof op.path === 'string' && (op.op === 'replace' || op.op === 'add')) {
                  const dotPath = op.path.replace(/^\//, '').replace(/\//g, '.');
                  setNestedPath(merged, dotPath, op.value);
                }
              }
            }
          } catch {}
        }
      }
    }

    const fromCmds = buildMvuStatData(parseMvuCommands(text));
    merged = deepMergeObjects(merged, fromCmds);
  } catch {}

  return merged;
}

/** 提取角色卡世界书条目，供运行时 API 和 [InitVar] 解析使用 */
export function extractWorldbookEntriesFromCard(char: any): WorldbookRuntimeEntry[] {
  try {
    const data = char?.data?.data || char?.data || char || {};
    const book = data?.character_book || char?.data?.character_book;
    const rawEntries = book?.entries;
    if (!rawEntries) return [];
    const arr = Array.isArray(rawEntries) ? rawEntries : Object.values(rawEntries);
    return arr
      .filter((e: any) => e && typeof e === 'object')
      .map((e: any, idx: number) => ({
        uid: e.uid ?? e.id ?? idx,
        comment: String(e.comment || e.name || ''),
        name: String(e.name || e.comment || ''),
        keys: Array.isArray(e.keys) ? e.keys.map(String) : Array.isArray(e.key) ? e.key.map(String) : [],
        content: typeof e.content === 'string' ? e.content : '',
        enabled: e.enabled !== undefined ? Boolean(e.enabled) : !e.disable,
      }));
  } catch {
    return [];
  }
}

/** 卡片扩展变量 + 世界书 [InitVar] 初始变量提取 */
export function getInitialVariablesFromCard(char: any): Record<string, any> {
  let merged: Record<string, any> = {};
  try {
    const data = char?.data?.data || char?.data || char || {};
    const rawInit = data?.extensions?.variables ?? char?.data?.extensions?.variables ?? data?.variables;
    if (typeof rawInit === 'string') {
      const parsed = parseLooseYamlOrJson(rawInit);
      if (parsed) {
        merged = deepMergeObjects(merged, parsed.stat_data && typeof parsed.stat_data === 'object' ? parsed.stat_data : parsed);
      }
    } else if (rawInit && typeof rawInit === 'object') {
      const inner = rawInit.stat_data && typeof rawInit.stat_data === 'object' ? rawInit.stat_data : rawInit;
      merged = deepMergeObjects(merged, inner);
    }

    const wbEntries = extractWorldbookEntriesFromCard(char);
    for (const entry of wbEntries) {
      if (!entry.content) continue;
      const title = `${entry.comment || ''} ${entry.name || ''} ${(entry.keys || []).join(' ')}`;
      const isInitVar = /initvar|初始变量|var_init/i.test(title) || /<initvar\b/i.test(entry.content);
      if (!isInitVar) continue;
      const parsed = parseLooseYamlOrJson(entry.content);
      if (parsed) {
        const inner = parsed.stat_data && typeof parsed.stat_data === 'object' ? parsed.stat_data : parsed;
        merged = deepMergeObjects(merged, inner);
      }
    }
  } catch {}
  return merged;
}

/** 合并卡片、世界书 [InitVar]、消息历史与当前文本中的初始变量 */
export function resolveCombinedStatData(opts: {
  character?: any;
  mvuSourceText?: string;
  extraVariables?: Record<string, any> | null;
}): Record<string, any> {
  let stat = opts.character ? getInitialVariablesFromCard(opts.character) : {};
  if (opts.extraVariables && typeof opts.extraVariables === 'object') {
    const extraInner =
      opts.extraVariables.stat_data && typeof opts.extraVariables.stat_data === 'object'
        ? opts.extraVariables.stat_data
        : opts.extraVariables;
    stat = deepMergeObjects(stat, extraInner);
  }
  if (opts.mvuSourceText) {
    const msgStat = extractMvuStatData(opts.mvuSourceText);
    stat = deepMergeObjects(stat, msgStat);
  }
  return stat;
}

function safeJson(value: any): string {
  let json: string;
  try {
    json = JSON.stringify(value ?? {});
  } catch {
    json = '{}';
  }
  if (typeof json !== 'string') json = '{}';
  // 内联 <script> 中严禁出现 "<" 或换行分隔符
  return json.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * 生成注入到卡片 iframe 里的 JS-Slash-Runner / TavernHelper / MVU 兼容运行时脚本。
 * - getChatMessages / getVariables 等与真酒馆助手一样「同步返回可用结果」（await 它也同样成立）
 * - 自动注入离线可用的 lodash (`_`) 子集垫片（CDN 加载成功后会被完整版覆盖）
 * - 支持 eventOn / eventEmit / waitGlobalInitialized / initializeGlobal / Mvu / Worldbook 读取
 */
export function buildTavernRuntimeScript(opts: {
  statData?: Record<string, any> | null;
  characterName?: string;
  userName?: string;
  currentMessage?: string;
  swipes?: string[];
  currentSwipeId?: number;
  messageId?: number;
  worldbookEntries?: WorldbookRuntimeEntry[];
  frameId?: string;
} = {}): string {
  const statJson = safeJson(opts.statData || {});
  const charName = safeJson(opts.characterName || 'Character');
  const userName = safeJson(opts.userName || 'User');
  const currentMes = safeJson(opts.currentMessage || '');
  const swipesList = Array.isArray(opts.swipes) && opts.swipes.length > 0
    ? opts.swipes
    : [opts.currentMessage || ''];
  const swipesJson = safeJson(swipesList);
  const swipeId = typeof opts.currentSwipeId === 'number' && opts.currentSwipeId >= 0 ? opts.currentSwipeId : 0;
  const msgId = typeof opts.messageId === 'number' && opts.messageId >= 0 ? opts.messageId : 0;
  const wbJson = safeJson((opts.worldbookEntries || []).slice(0, 100));
  const fId = safeJson(opts.frameId || 'th-frame');

  return `
(function(){
  if (window.__MIU_TAVERN_RUNTIME__) return;
  window.__MIU_TAVERN_RUNTIME__ = true;

  var STAT = ${statJson};
  var CHAR_NAME = ${charName};
  var USER_NAME = ${userName};
  var CURRENT_MES = ${currentMes};
  var SWIPES = ${swipesJson};
  var SWIPE_ID = ${swipeId};
  var MSG_ID = ${msgId};
  var WORLDBOOK = ${wbJson};
  var FRAME_ID = ${fId};
  var noop = function(){};

  // 本地持久化（配合普通 TavernHelper.setVariable/getVariable 面板）
  var varStoreKey = 'tavern_vars_' + encodeURIComponent(CHAR_NAME || 'default');
  var localStore = {};
  try {
    var rawLocal = localStorage.getItem(varStoreKey);
    if (rawLocal) localStore = JSON.parse(rawLocal) || {};
  } catch(e) { localStore = {}; }
  function saveLocalStore() {
    try { localStorage.setItem(varStoreKey, JSON.stringify(localStore)); } catch(e) {}
  }

  // 轻量 Lodash 离线垫片：在 CDN 未完成加载或离线时保障 _.get / _.set / _.cloneDeep 等不报错
  if (typeof window._ === 'undefined') {
    var isObj = function(v){ return v !== null && typeof v === 'object'; };
    var toPath = function(p){
      if (Array.isArray(p)) return p;
      return String(p || '').replace(/\\[(\\d+)\\]/g, '.$1').split('.').filter(Boolean);
    };
    var cloneDeep = function(v){
      if (!isObj(v)) return v;
      if (Array.isArray(v)) return v.map(cloneDeep);
      var out = {};
      Object.keys(v).forEach(function(k){ out[k] = cloneDeep(v[k]); });
      return out;
    };
    var mergeObj = function(target){
      for (var i = 1; i < arguments.length; i++) {
        var src = arguments[i];
        if (!isObj(src)) continue;
        Object.keys(src).forEach(function(k){
          if (isObj(src[k]) && !Array.isArray(src[k]) && isObj(target[k]) && !Array.isArray(target[k])) {
            mergeObj(target[k], src[k]);
          } else {
            target[k] = src[k];
          }
        });
      }
      return target;
    };
    window._ = {
      get: function(obj, path, def){
        if (!obj) return def;
        var keys = toPath(path), cur = obj;
        for (var i = 0; i < keys.length; i++) {
          if (cur == null || typeof cur !== 'object') return def;
          cur = cur[keys[i]];
        }
        return cur === undefined ? def : cur;
      },
      set: function(obj, path, val){
        if (!isObj(obj)) return obj;
        var keys = toPath(path), cur = obj;
        for (var i = 0; i < keys.length - 1; i++) {
          var k = keys[i];
          if (!isObj(cur[k])) cur[k] = /^\\d+$/.test(keys[i+1]) ? [] : {};
          cur = cur[k];
        }
        if (keys.length) cur[keys[keys.length - 1]] = val;
        return obj;
      },
      has: function(obj, path){
        if (!obj) return false;
        var keys = toPath(path), cur = obj;
        for (var i = 0; i < keys.length; i++) {
          if (cur == null || typeof cur !== 'object' || !(keys[i] in cur)) return false;
          cur = cur[keys[i]];
        }
        return true;
      },
      unset: function(obj, path){
        if (!obj) return false;
        var keys = toPath(path), cur = obj;
        for (var i = 0; i < keys.length - 1; i++) {
          if (!isObj(cur[keys[i]])) return false;
          cur = cur[keys[i]];
        }
        if (keys.length && cur && typeof cur === 'object') { delete cur[keys[keys.length - 1]]; return true; }
        return false;
      },
      cloneDeep: cloneDeep,
      merge: mergeObj,
      assign: Object.assign,
      isObject: isObj,
      isPlainObject: function(v){ return isObj(v) && !Array.isArray(v); },
      isArray: Array.isArray,
      isString: function(v){ return typeof v === 'string'; },
      isNumber: function(v){ return typeof v === 'number' && !isNaN(v); },
      isBoolean: function(v){ return typeof v === 'boolean'; },
      isNil: function(v){ return v === null || v === undefined; },
      isEmpty: function(v){
        if (v == null) return true;
        if (Array.isArray(v) || typeof v === 'string') return v.length === 0;
        if (isObj(v)) return Object.keys(v).length === 0;
        return false;
      },
      isEqual: function(a, b){
        try { return JSON.stringify(a) === JSON.stringify(b); } catch(e) { return a === b; }
      },
      keys: Object.keys,
      values: Object.values,
      entries: Object.entries,
      forEach: function(col, fn){
        if (Array.isArray(col)) col.forEach(fn);
        else if (isObj(col)) Object.keys(col).forEach(function(k){ fn(col[k], k, col); });
        return col;
      },
      each: function(col, fn){ return window._.forEach(col, fn); },
      map: function(col, fn){
        if (Array.isArray(col)) return col.map(typeof fn === 'function' ? fn : function(x){ return x && x[fn]; });
        if (isObj(col)) return Object.keys(col).map(function(k){ return fn(col[k], k, col); });
        return [];
      },
      filter: function(col, fn){ return Array.isArray(col) ? col.filter(fn) : []; },
      find: function(col, fn){ return Array.isArray(col) ? col.find(fn) : undefined; },
      some: function(col, fn){ return Array.isArray(col) ? col.some(fn) : false; },
      every: function(col, fn){ return Array.isArray(col) ? col.every(fn) : true; },
      uniq: function(arr){ return Array.isArray(arr) ? Array.from(new Set(arr)) : []; },
      flatten: function(arr){ return Array.isArray(arr) ? arr.reduce(function(a, b){ return a.concat(b); }, []) : []; },
      clamp: function(n, lo, hi){ return Math.min(Math.max(n, lo), hi); },
      round: function(n, p){ var m = Math.pow(10, p || 0); return Math.round(n * m) / m; },
      range: function(start, end, step){
        if (end === undefined) { end = start; start = 0; }
        step = step || 1;
        var r = [];
        for (var i = start; step > 0 ? i < end : i > end; i += step) r.push(i);
        return r;
      },
      debounce: function(fn, wait){
        var t = null;
        return function(){ var a = arguments, c = this; clearTimeout(t); t = setTimeout(function(){ fn.apply(c, a); }, wait || 0); };
      },
      throttle: function(fn, wait){
        var last = 0;
        return function(){ var now = Date.now(); if (now - last >= (wait || 0)) { last = now; return fn.apply(this, arguments); } };
      },
      escape: function(s){ return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },
      unescape: function(s){ return String(s || '').replace(/&quot;/g,'"').replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&amp;/g,'&'); },
      pick: function(obj, keys){ var o = {}; (keys || []).forEach(function(k){ if (obj && k in obj) o[k] = obj[k]; }); return o; },
      omit: function(obj, keys){ var o = Object.assign({}, obj); (keys || []).forEach(function(k){ delete o[k]; }); return o; }
    };
  }

  // 构建兼容 JS-Slash-Runner ChatMessage & SillyTavern context 的消息对象
  var mesText = CURRENT_MES || (SWIPES[SWIPE_ID] || SWIPES[0] || '');
  var message = {
    message_id: MSG_ID,
    id: MSG_ID,
    name: CHAR_NAME,
    role: 'assistant',
    is_user: false,
    is_system: false,
    is_hidden: false,
    message: mesText,
    mes: mesText,
    swipe_id: SWIPE_ID,
    swipes: SWIPES.slice(),
    swipes_data: SWIPES.map(function(){ return { stat_data: STAT }; }),
    swipes_info: SWIPES.map(function(){ return {}; }),
    send_date: Date.now(),
    data: { stat_data: STAT },
    extra: {}
  };
  var messages = [message];

  function buildVariablesSnapshot() {
    var snap = Object.assign({}, localStore, { stat_data: STAT });
    return snap;
  }

  function resolvePath(obj, path) {
    if (!path) return obj;
    var cur = obj;
    String(path).split('.').forEach(function(k){
      if (cur && typeof cur === 'object') cur = cur[k];
      else cur = undefined;
    });
    return cur;
  }

  function substitute(text, extra) {
    if (typeof text !== 'string') return text;
    var now = new Date();
    var out = text
      .replace(/\\{\\{char\\}\\}/gi, CHAR_NAME)
      .replace(/\\{\\{user\\}\\}/gi, USER_NAME)
      .replace(/\\{\\{lastMessageId\\}\\}/gi, String(MSG_ID))
      .replace(/\\{\\{lastCharMessage\\}\\}/gi, message.message || '')
      .replace(/\\{\\{lastUserMessage\\}\\}/gi, '')
      .replace(/\\{\\{time\\}\\}/gi, now.toLocaleTimeString())
      .replace(/\\{\\{date\\}\\}/gi, now.toLocaleDateString())
      .replace(/\\{\\{isodate\\}\\}/gi, now.toISOString().slice(0, 10))
      .replace(/\\{\\{isotime\\}\\}/gi, now.toTimeString().slice(0, 8))
      .replace(/\\{\\{(?:getvar|getglobalvar|get_message_variable)::([^}]+)\\}\\}/gi, function(_, key){
        var v = api.getVariable(key.trim());
        return v !== undefined && v !== null ? (typeof v === 'object' ? JSON.stringify(v) : String(v)) : '';
      });
    if (extra && typeof extra === 'object') {
      Object.keys(extra).forEach(function(k){
        out = out.split('{{' + k + '}}').join(String(extra[k]));
      });
    }
    return out;
  }

  function parseRangeAndFilter(range, options) {
    if (options && options.hide_state === 'hidden') return [];
    if (options && options.role && options.role !== 'assistant') return [];
    if (range === undefined || range === null || range === '') return messages.slice();

    var r = typeof range === 'string' ? substitute(range).trim() : range;
    if (typeof r === 'number' || /^-?\\d+$/.test(String(r))) {
      var idx = Number(r);
      if (idx < 0) idx = messages.length + idx;
      if (idx >= 0 && idx < messages.length) return [messages[idx]];
      // 单楼层预览兜底：对 0 或 -1 都返回当前楼层
      return messages.slice();
    }
    var pair = String(r).match(/^(-?\\d+)\\s*-\\s*(-?\\d+)$/);
    if (pair) {
      var a = Number(pair[1]);
      var b = Number(pair[2]);
      if (a < 0) a = messages.length + a;
      if (b < 0) b = messages.length + b;
      var lo = Math.max(0, Math.min(a, b));
      var hi = Math.min(messages.length - 1, Math.max(a, b));
      return messages.slice(lo, hi + 1);
    }
    return messages.slice();
  }

  // 事件总线
  var listeners = {};
  function addEvt(evt, fn, once) {
    if (!evt || typeof fn !== 'function') return noop;
    if (!listeners[evt]) listeners[evt] = [];
    listeners[evt].push({ fn: fn, once: !!once });
    return function(){ removeEvt(evt, fn); };
  }
  function removeEvt(evt, fn) {
    if (!listeners[evt]) return;
    if (!fn) { delete listeners[evt]; return; }
    listeners[evt] = listeners[evt].filter(function(item){ return item.fn !== fn; });
  }
  function emitEvt(evt) {
    var args = Array.prototype.slice.call(arguments, 1);
    var list = (listeners[evt] || []).slice();
    listeners[evt] = (listeners[evt] || []).filter(function(item){ return !item.once; });
    list.forEach(function(item){
      try { item.fn.apply(null, args); } catch(e) { console.warn('[TavernRuntime event]', evt, e); }
    });
  }

  var api = {
    // 聊天楼层读写（同步返回数组：既兼容 sync getChatMessages(-1)[0]，也兼容 await getChatMessages(-1)）
    getChatMessages: function(range, options){
      return parseRangeAndFilter(range, options);
    },
    getChatMessagesById: function(id, options){
      return parseRangeAndFilter(id, options);
    },
    getChatMessagesByRange: function(range, options){
      return parseRangeAndFilter(range, options);
    },
    getLastMessageId: function(){ return MSG_ID; },
    getCurrentMessageId: function(){ return MSG_ID; },
    getCurrentCharacterId: function(){ return '0'; },
    getCurrentCharacterName: function(){ return CHAR_NAME; },
    setChatMessage: function(contentOrObj, msgId, options){
      if (options && typeof options.swipe_id === 'number') {
        window.parent.postMessage({ type: 'jump_greeting', targetIndex: options.swipe_id }, '*');
      } else if (contentOrObj && typeof contentOrObj === 'object' && typeof contentOrObj.swipe_id === 'number') {
        window.parent.postMessage({ type: 'jump_greeting', targetIndex: contentOrObj.swipe_id }, '*');
      } else if (typeof msgId === 'number' && typeof contentOrObj === 'string' && contentOrObj !== message.message) {
        message.message = contentOrObj;
        message.mes = contentOrObj;
      }
      if (contentOrObj && typeof contentOrObj === 'object' && contentOrObj.data && contentOrObj.data.stat_data) {
        STAT = contentOrObj.data.stat_data;
        message.data = { stat_data: STAT };
      }
      return Promise.resolve();
    },
    setChatMessages: function(updates){
      if (Array.isArray(updates) && updates[0]) {
        if (typeof updates[0].swipe_id === 'number') {
          window.parent.postMessage({ type: 'jump_greeting', targetIndex: updates[0].swipe_id }, '*');
        }
        if (updates[0].data && updates[0].data.stat_data) {
          STAT = updates[0].data.stat_data;
          message.data = { stat_data: STAT };
        }
      }
      return Promise.resolve();
    },
    createChatMessages: function(){ return Promise.resolve(); },
    deleteChatMessages: function(){ return Promise.resolve(); },
    getChatHistory: function(){ return messages.slice(); },
    getLastUserMessage: function(){ return ''; },
    getLastCharMessage: function(){ return message; },
    setGreeting: function(index){
      var idx = parseInt(index, 10);
      if (!isNaN(idx)) window.parent.postMessage({ type: 'jump_greeting', targetIndex: idx }, '*');
    },
    swipe: function(index){
      var idx = parseInt(index, 10);
      if (!isNaN(idx)) window.parent.postMessage({ type: 'jump_greeting', targetIndex: idx }, '*');
    },

    // 变量系统（同步返回，兼容 global/chat/message/script 作用域）
    getVariables: function(options){
      if (options && options.type === 'message') {
        return { stat_data: STAT };
      }
      return buildVariablesSnapshot();
    },
    getAllVariables: function(){
      return buildVariablesSnapshot();
    },
    replaceVariables: function(next){
      if (next && typeof next === 'object') {
        if (next.stat_data && typeof next.stat_data === 'object') {
          STAT = next.stat_data;
          Object.keys(next).forEach(function(k){ if (k !== 'stat_data') localStore[k] = next[k]; });
        } else {
          STAT = next;
        }
        saveLocalStore();
        message.data = { stat_data: STAT };
      }
      return buildVariablesSnapshot();
    },
    insertOrAssignVariables: function(next){
      if (next && typeof next === 'object') {
        if (next.stat_data && typeof next.stat_data === 'object') {
          STAT = Object.assign({}, STAT, next.stat_data);
        } else {
          Object.assign(localStore, next);
          STAT = Object.assign({}, STAT, next);
        }
        saveLocalStore();
        message.data = { stat_data: STAT };
      }
      return buildVariablesSnapshot();
    },
    insertVariables: function(next){ return api.insertOrAssignVariables(next); },
    setVariables: function(obj){ return api.insertOrAssignVariables(obj); },
    deleteVariable: function(path){
      if (path) {
        delete localStore[path];
        saveLocalStore();
      }
      return buildVariablesSnapshot();
    },
    getVariable: function(path, def){
      if (!path) return buildVariablesSnapshot();
      var fromLocal = localStore[path];
      if (fromLocal !== undefined) return fromLocal;
      var fromStat = resolvePath(STAT, path);
      if (fromStat !== undefined) return fromStat;
      var fromSnap = resolvePath(buildVariablesSnapshot(), path);
      return fromSnap !== undefined ? fromSnap : def;
    },
    setVariable: function(path, value){
      localStore[path] = value;
      if (typeof path === 'string' && path.indexOf('.') !== -1 && window._ && typeof window._.set === 'function') {
        window._.set(STAT, path, value);
      } else if (path) {
        STAT[path] = value;
      }
      saveLocalStore();
      message.data = { stat_data: STAT };
      return value;
    },
    getGlobalVariable: function(key, def){ return api.getVariable(key, def); },
    setGlobalVariable: function(key, val){ return api.setVariable(key, val); },

    // 宏与斜杠命令
    substitudeMacros: function(text, extra){ return substitute(text, extra); },
    substituteMacros: function(text, extra){ return substitute(text, extra); },
    triggerSlash: function(cmd){
      var m = String(cmd || '').match(/(?:\\/swipe|\\/greeting|\\/branch)\\s+(\\d+)/i);
      if (m) {
        window.parent.postMessage({ type: 'jump_greeting', targetIndex: parseInt(m[1], 10) }, '*');
      }
      return Promise.resolve('');
    },
    triggerSlashWithResult: function(cmd){ return api.triggerSlash(cmd); },
    executeSlashCommand: function(cmd){ return api.triggerSlash(cmd); },

    // 事件系统与全局初始化同步（waitGlobalInitialized）
    eventOn: function(evt, fn){ return addEvt(evt, fn, false); },
    eventOnce: function(evt, fn){ return addEvt(evt, fn, true); },
    eventOff: function(evt, fn){ removeEvt(evt, fn); },
    eventRemoveListener: function(evt, fn){ removeEvt(evt, fn); },
    eventEmit: emitEvt,
    eventEmitAndWait: function(){ emitEvt.apply(null, arguments); return Promise.resolve(); },
    eventMakeLast: function(evt, fn){ return addEvt(evt, fn, false); },
    eventClearEvent: function(evt){ delete listeners[evt]; },
    eventClearAll: function(){ listeners = {}; },
    trigger: emitEvt,
    initializeGlobal: function(name, value){
      if (name) window[name] = value;
      emitEvt('global_' + name + '_initialized', value);
    },
    waitGlobalInitialized: function(name){
      if (name && window[name] !== undefined) return Promise.resolve(window[name]);
      return new Promise(function(resolve){
        var tries = 0;
        var timer = setInterval(function(){
          tries++;
          if ((name && window[name] !== undefined) || tries > 30) {
            clearInterval(timer);
            resolve(name ? window[name] : undefined);
          }
        }, 50);
      });
    },

    // 世界书读取（直接提供角色卡附带的世界书条目）
    getWorldbook: function(){ return WORLDBOOK.slice(); },
    getCharWorldbook: function(){ return WORLDBOOK.slice(); },
    getWorldbookNames: function(){ return WORLDBOOK.length ? [CHAR_NAME + ' Worldbook'] : []; },
    getCharWorldbookNames: function(){ return { primary: WORLDBOOK.length ? CHAR_NAME + ' Worldbook' : null, additional: [] }; },
    getLorebookEntries: function(){ return WORLDBOOK.slice(); },
    setLorebookEntries: function(){ return Promise.resolve(); },
    getCharLorebooks: function(){ return { primary: WORLDBOOK.length ? CHAR_NAME + ' Worldbook' : null, additional: [] }; },

    // 杂项工具
    getRequestHeaders: function(){ return {}; },
    getCharAvatarPath: function(){ return ''; },
    formatAsTavernRegexedString: function(text){ return text; },
    formatAsDisplayedMessage: function(text){ return text; },
    retrieveDisplayedMessage: function(){ return null; },
    errorCatched: function(fn){
      return function(){
        try { return typeof fn === 'function' ? fn.apply(this, arguments) : undefined; }
        catch(e) { console.warn('[TavernHelper errorCatched]', e); }
      };
    },
    getScriptId: function(){ return 'miu-script-' + FRAME_ID; },
    getIframeName: function(){ return FRAME_ID; },
    getExtensionDirectory: function(){ return ''; },
    generate: function(){ return Promise.resolve(''); },
    generateRaw: function(){ return Promise.resolve(''); },
    stopGenerationById: noop,
    isGenerating: function(){ return false; },
    builtin: {}
  };
  api.builtin = api;

  window.TavernHelper = api;
  window.setGreeting = api.setGreeting;
  window.selectGreeting = api.setGreeting;
  window.swipe = api.swipe;

  var globals = [
    'getChatMessages','getChatMessagesById','getChatMessagesByRange','getLastMessageId','getCurrentMessageId',
    'getCurrentCharacterId','getCurrentCharacterName','setChatMessage','setChatMessages','createChatMessages','deleteChatMessages',
    'getChatHistory','getLastUserMessage','getLastCharMessage','getVariables','getAllVariables','replaceVariables',
    'insertOrAssignVariables','insertVariables','setVariables','deleteVariable','getVariable','setVariable',
    'getGlobalVariable','setGlobalVariable','substitudeMacros','substituteMacros','triggerSlash','triggerSlashWithResult',
    'executeSlashCommand','eventOn','eventOnce','eventOff','eventRemoveListener','eventEmit','eventEmitAndWait',
    'eventMakeLast','eventClearEvent','eventClearAll','initializeGlobal','waitGlobalInitialized',
    'getWorldbook','getCharWorldbook','getWorldbookNames','getCharWorldbookNames','getLorebookEntries',
    'setLorebookEntries','getCharLorebooks','formatAsTavernRegexedString','formatAsDisplayedMessage',
    'retrieveDisplayedMessage','errorCatched','getScriptId','getIframeName','getExtensionDirectory',
    'generate','generateRaw','stopGenerationById','isGenerating'
  ];
  for (var i = 0; i < globals.length; i++) {
    var key = globals[i];
    window[key] = api[key] || noop;
  }

  window.tavern_events = {
    APP_READY: 'app_ready',
    CHAT_CHANGED: 'chat_changed',
    CHAT_CREATED: 'chat_created',
    CHAT_LOADED: 'chat_loaded',
    MESSAGE_RECEIVED: 'message_received',
    MESSAGE_SENT: 'message_sent',
    MESSAGE_UPDATED: 'message_updated',
    MESSAGE_EDITED: 'message_edited',
    MESSAGE_SWIPED: 'message_swiped',
    MESSAGE_DELETED: 'message_deleted',
    USER_MESSAGE_RENDERED: 'user_message_rendered',
    CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
    GENERATION_STARTED: 'generation_started',
    GENERATION_AFTER_COMMANDS: 'generation_after_commands',
    GENERATION_ENDED: 'generation_ended',
    WORLDINFO_UPDATED: 'worldinfo_updated',
    MAG_VARIABLE_INITIALIZED: 'mag_variable_initialized',
    MAG_VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
    MAG_VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended'
  };

  // MVU（MagVarUpdate）扩展的完整兼容入口
  var mvu = {
    events: {
      VARIABLE_INITIALIZED: 'mag_variable_initialized',
      VARIABLE_UPDATE_STARTED: 'mag_variable_update_started',
      VARIABLE_UPDATE_ENDED: 'mag_variable_update_ended'
    },
    getMvuData: function(){ return { stat_data: STAT }; },
    getRecordFromMessage: function(msg){
      if (msg && msg.data && msg.data.stat_data) return msg.data;
      return { stat_data: STAT };
    },
    getMvuVariables: function(){ return STAT; },
    setMvuVariables: function(next){ return api.replaceVariables(next); },
    getMvuVariable: function(path){ return api.getVariable(path); },
    setMvuVariable: function(path, value){ return api.setVariable(path, value); },
    isMvuMessage: function(){ return true; },
    parseMessage: function(){ return STAT; },
    on: function(evt, fn){ return addEvt(evt, fn, false); },
    once: function(evt, fn){ return addEvt(evt, fn, true); },
    emit: emitEvt,
    off: function(evt, fn){ removeEvt(evt, fn); },
    isDuringExtraAnalysis: function(){ return false; }
  };
  window.Mvu = mvu;
  window.MVU = mvu;

  window.SillyTavern = {
    getContext: function(){
      return {
        characters: [{ name: CHAR_NAME }],
        characterId: 0,
        name1: USER_NAME,
        name2: CHAR_NAME,
        chat: messages.slice(),
        chatMetadata: { variables: buildVariablesSnapshot() },
        eventSource: { on: api.eventOn, once: api.eventOnce, emit: api.eventEmit, makeLast: api.eventMakeLast, removeListener: api.eventRemoveListener }
      };
    },
    chat: messages.slice(),
    saveChat: function(){ return Promise.resolve(); },
    reloadCurrentChat: function(){ return Promise.resolve(); }
  };

  window.toastr = window.toastr || { info: noop, success: noop, warning: noop, error: noop, clear: noop };
})();
`;
}

/** 注入前保险：内联 <script> 里不能出现 "</script" */
export function isRuntimeScriptSafe(script: string): boolean {
  return !/<\/script/i.test(script);
}