/**
 * 酒馆助手（JS-Slash-Runner / MVU）运行时的轻量兼容层。
 *
 * MIU 的开场白/消息是跑在沙箱 iframe 里的。酒馆里这类卡片的「状态栏 / 封面 / 直播间」
 * 基本都是 <script> + 酒馆助手 API 驱动的，缺少 getChatMessages / getCurrentMessageId /
 * triggerSlash 这些全局函数时，卡片自己的 catch 会渲染出
 * 「状态栏加载出错: getChatMessages is not defined」。
 *
 * 这里提供一套只读、无副作用的同名 API（外加从开场白里解析出来的 MVU 变量），
 * 让卡片的界面能正常渲染出来，而不是一片报错。
 */

/** MVU `_.set('a.b', 旧值, 新值)` 之类的指令 */
export interface MvuCommand {
  op: 'set' | 'insert' | 'assign' | 'add' | 'remove' | string;
  args: string[];
}

const UPDATE_BLOCK_RE = /<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/gi;
const COMMAND_RE = /_\.(set|insert|assign|add|remove)\s*\(([^;]*?)\)\s*(?=;|\n|$)/g;
const ARG_RE = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(-?\d+(?:\.\d+)?)|(true|false|null)/g;

/** 从一段文本里抽出 MVU 变量更新指令（只看 <UpdateVariable> 区块，没有区块就全文找） */
export function parseMvuCommands(text: string): MvuCommand[] {
  if (!text) return [];
  const source = (text.match(UPDATE_BLOCK_RE) || []).join('\n');
  const body = source || text;
  const cmds: MvuCommand[] = [];
  let m: RegExpExecArray | null;
  COMMAND_RE.lastIndex = 0;
  while ((m = COMMAND_RE.exec(body))) {
    const args: string[] = [];
    ARG_RE.lastIndex = 0;
    let a: RegExpExecArray | null;
    while ((a = ARG_RE.exec(m[2]))) {
      const raw = a[1] ?? a[2] ?? a[3] ?? a[4] ?? '';
      args.push(a[3] !== undefined ? raw : raw);
    }
    if (args.length) cmds.push({ op: m[1], args });
  }
  return cmds;
}

/** 把指令套成一棵嵌套变量对象（和 MVU 的 stat_data 结构一致） */
export function buildMvuStatData(cmds: MvuCommand[]): Record<string, any> {
  const root: Record<string, any> = {};
  const setPath = (path: string, value: any) => {
    const keys = String(path).split('.').map((k) => k.trim()).filter(Boolean);
    if (!keys.length) return;
    let cur: any = root;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (typeof cur[k] !== 'object' || cur[k] === null || Array.isArray(cur[k])) cur[k] = {};
      cur = cur[k];
    }
    const last = keys[keys.length - 1];
    if (cur[last] === undefined) cur[last] = value;
  };
  const coerce = (v: string) => {
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  };
  for (const c of cmds) {
    if (c.op === 'set' && c.args.length >= 3) setPath(c.args[0], coerce(c.args[2]));
    else if (c.op === 'insert' && c.args.length >= 3) setPath(c.args[0], coerce(c.args[1]));
    else if (c.op === 'assign' && c.args.length >= 2) setPath(c.args[0], coerce(c.args[1]));
  }
  return root;
}

/** 一行拿到开场白里的初始变量 */
export function extractMvuStatData(text: string): Record<string, any> {
  try {
    return buildMvuStatData(parseMvuCommands(text || ''));
  } catch {
    return {};
  }
}

/** 卡片的扩展里可能带着 TavernHelper 脚本（MVU 等），这里只取变量初始值用得到的部分 */
export function getInitialVariablesFromCard(char: any): Record<string, any> {
  try {
    const data = char?.data?.data || char?.data || char || {};
    const init = data?.extensions?.variables ?? data?.variables;
    return init && typeof init === 'object' ? init : {};
  } catch {
    return {};
  }
}

function safeJson(value: any): string {
  let json: string;
  try {
    json = JSON.stringify(value ?? {});
  } catch {
    json = '{}';
  }
  if (typeof json !== 'string') json = '{}';
  // 这段 JSON 会被塞进内联 <script>，不能出现 "<" 序列
  return json.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * 生成注入到卡片 iframe 里的运行时脚本。
 * 只补齐酒馆助手/MVU 的常用 API，遇到不认识的就返回空值，绝不抛错。
 */
export function buildTavernRuntimeScript(opts: {
  statData?: Record<string, any> | null;
  characterName?: string;
  userName?: string;
} = {}): string {
  const statJson = safeJson(opts.statData || {});
  const charName = safeJson(opts.characterName || 'Character');
  const userName = safeJson(opts.userName || 'User');

  return `
(function(){
  if (window.__MIU_TAVERN_RUNTIME__) return;
  window.__MIU_TAVERN_RUNTIME__ = true;

  var STAT = ${statJson};
  var CHAR_NAME = ${charName};
  var USER_NAME = ${userName};
  var noop = function(){};
  var resolveEmpty = function(){ return Promise.resolve(''); };
  var message = { message_id: 0, id: 0, role: 'assistant', mes: '', message: '', name: CHAR_NAME,
                  is_user: false, swipe_id: 0, swipes: [''], send_date: 0, data: { stat_data: STAT } };
  var messages = [message];
  var variables = { stat_data: STAT };

  function substitute(text, extra) {
    if (typeof text !== 'string') return text;
    var out = text
      .replace(/\\{\\{char\\}\\}/gi, CHAR_NAME)
      .replace(/\\{\\{user\\}\\}/gi, USER_NAME)
      .replace(/\\{\\{time\\}\\}/gi, new Date().toLocaleTimeString())
      .replace(/\\{\\{date\\}\\}/gi, new Date().toLocaleDateString());
    if (extra && typeof extra === 'object') {
      Object.keys(extra).forEach(function(k){
        out = out.split('{{' + k + '}}').join(String(extra[k]));
      });
    }
    return out;
  }

  var api = {
    getChatMessages: function(){ return Promise.resolve(messages.slice()); },
    getChatMessagesById: function(){ return Promise.resolve(messages.slice()); },
    getChatMessagesByRange: function(){ return Promise.resolve(messages.slice()); },
    getLastMessageId: function(){ return messages.length - 1; },
    getCurrentMessageId: function(){ return messages.length - 1; },
    getCurrentCharacterId: function(){ return ''; },
    getCurrentCharacterName: function(){ return CHAR_NAME; },
    setChatMessage: function(){ return Promise.resolve(); },
    createChatMessages: function(){ return Promise.resolve(); },
    deleteChatMessages: function(){ return Promise.resolve(); },
    getChatHistory: function(){ return Promise.resolve([]); },
    getLastUserMessage: function(){ return USER_NAME; },
    getLastCharMessage: function(){ return message; },
    getVariables: function(){ return variables; },
    replaceVariables: function(next){
      if (next && typeof next === 'object') {
        if (next.stat_data && typeof next.stat_data === 'object') STAT = next.stat_data;
        else STAT = next;
        variables = { stat_data: STAT };
        message.data = { stat_data: STAT };
      }
      return variables;
    },
    insertOrAssignVariables: function(next){
      if (next && typeof next === 'object') {
        var base = STAT && typeof STAT === 'object' ? STAT : {};
        STAT = Object.assign({}, base, next);
        variables = { stat_data: STAT };
        message.data = { stat_data: STAT };
      }
      return variables;
    },
    deleteVariable: function(){ return variables; },
    getVariable: function(path){
      if (!path) return STAT;
      var cur = STAT;
      String(path).split('.').forEach(function(k){
        if (cur && typeof cur === 'object') cur = cur[k];
        else cur = undefined;
      });
      return cur;
    },
    setVariable: function(path, value){
      if (!STAT || typeof STAT !== 'object') STAT = {};
      var keys = String(path).split('.');
      var cur = STAT;
      for (var i = 0; i < keys.length - 1; i++) {
        if (typeof cur[keys[i]] !== 'object' || cur[keys[i]] === null) cur[keys[i]] = {};
        cur = cur[keys[i]];
      }
      cur[keys[keys.length - 1]] = value;
      variables = { stat_data: STAT };
      message.data = { stat_data: STAT };
      return variables;
    },
    substitudeMacros: function(text, extra){ return substitute(text, extra); },
    substituteMacros: function(text, extra){ return substitute(text, extra); },
    triggerSlash: function(){ return resolveEmpty(); },
    triggerSlashWithResult: function(){ return resolveEmpty(); },
    eventOn: noop,
    eventOff: noop,
    eventOnce: noop,
    eventEmit: noop,
    eventRemoveListener: noop,
    getWorldbook: function(){ return Promise.resolve([]); },
    getWorldbookNames: function(){ return []; },
    getCharWorldbookNames: function(){ return { primary: null, additional: [] }; },
    getLorebookEntries: function(){ return Promise.resolve([]); },
    setLorebookEntries: function(){ return Promise.resolve(); },
    getRequestHeaders: function(){ return {}; },
    getCharAvatarPath: function(){ return ''; },
    getCharLorebooks: function(){ return { primary: null, additional: [] }; },
    formatAsTavernRegexedString: function(text){ return text; },
    formatAsDisplayedMessage: function(text){ return text; },
    generate: function(){ return resolveEmpty(); },
    stopGenerationById: noop,
    isGenerating: function(){ return false; },
    builtin: {}
  };
  api.builtin = api;
  window.TavernHelper = window.TavernHelper || api;

  var globals = ['getChatMessages','getChatMessagesById','getChatMessagesByRange','getLastMessageId','getCurrentMessageId',
    'getCurrentCharacterId','getCurrentCharacterName','setChatMessage','createChatMessages','deleteChatMessages',
    'getChatHistory','getLastUserMessage','getLastCharMessage','getVariables','replaceVariables',
    'insertOrAssignVariables','deleteVariable','getVariable','setVariable','substitudeMacros','substituteMacros',
    'triggerSlash','triggerSlashWithResult','eventOn','eventOff','eventOnce','eventEmit','eventRemoveListener',
    'getWorldbook','getWorldbookNames','getCharWorldbookNames','getLorebookEntries','setLorebookEntries',
    'getRequestHeaders','getCharAvatarPath','getCharLorebooks','formatAsTavernRegexedString',
    'formatAsDisplayedMessage','generate','stopGenerationById','isGenerating'];
  for (var i = 0; i < globals.length; i++) {
    var key = globals[i];
    if (typeof window[key] !== 'function') window[key] = api[key] || noop;
  }
  // MVU（变量更新）扩展的入口
  var mvu = {
    getMvuVariables: function(){ return STAT; },
    setMvuVariables: function(next){ return api.replaceVariables(next); },
    getMvuVariable: function(path){ return api.getVariable(path); },
    setMvuVariable: function(path, value){ return api.setVariable(path, value); },
    isMvuMessage: function(){ return true; },
    parseMessage: function(){ return STAT; },
    on: noop, once: noop, emit: noop, off: noop,
    isDuringExtraAnalysis: function(){ return false; }
  };
  window.Mvu = window.Mvu || mvu;
  window.MVU = window.MVU || mvu;
  window.SillyTavern = window.SillyTavern || { getContext: function(){ return { characters: [], characterId: 0, name1: USER_NAME }; } };
  window.toastr = window.toastr || { info: noop, success: noop, warning: noop, error: noop, clear: noop };
})();
`;
}

/** 注入前保险：内联 <script> 里不能出现 "</script" */
export function isRuntimeScriptSafe(script: string): boolean {
  return !/<\/script/i.test(script);
}