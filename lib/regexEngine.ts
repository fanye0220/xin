import { CharacterCard } from './db';

/**
 * Extract embedded <style> tags from character data
 */
export function extractCharacterStyles(obj: any): string {
  let styles = "";
  const seen = new Set<string>();
  const extract = (o: any) => {
    if (typeof o === "string") {
      const matches = o.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
      if (matches) {
        for (const match of matches) {
          const innerMatch = match.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
          if (innerMatch && innerMatch[1]) {
            const rules = innerMatch[1].trim();
            if (rules && !seen.has(rules)) {
              seen.add(rules);
              styles += rules + "\n";
            }
          }
        }
      }
    } else if (Array.isArray(o)) {
      o.forEach(extract);
    } else if (typeof o === "object" && o !== null) {
      Object.values(o).forEach(extract);
    }
  };
  extract(obj);
  return styles;
}

export interface RegexScript {
  id?: string;
  scriptName?: string;
  findRegex?: string;
  regex?: string;
  replaceString?: string;
  replacementString?: string;
  trimStrings?: string[];
  disabled?: boolean;
  placement?: number[];
  flags?: string;
  markdownOnly?: boolean;
  promptOnly?: boolean;
  runOnEdit?: boolean;
  substituteRegex?: number;
  minDepth?: number | null;
  maxDepth?: number | null;
}

/**
 * Get all regex scripts from a character card (supports V2 extensions & TavernHelper scripts)
 */
export function getCharacterRegexScripts(char: CharacterCard | null | undefined): RegexScript[] {
  if (!char) return [];
  const targetData = char.data?.data || char.data || {};
  const exts = targetData.extensions || char.data?.extensions || {};
  const scripts = exts.regex_scripts || [];
  return Array.isArray(scripts) ? scripts : [];
}

/**
 * 酒馆助手 / MVU 的元数据区块（变量更新、分析、状态栏占位符）。
 * 注意：绝不能误删 <script> / <style> / 代码块内部的标签引用！
 */
const TAVERN_META_BLOCK_RES: RegExp[] = [
  /<UpdateVariable\b[^>]*>[\s\S]*?<\/UpdateVariable\s*>/gi,
  /<UpdateVariable\b[^>]*\/?>/gi,
  /<Analysis\b[^>]*>[\s\S]*?<\/Analysis\s*>/gi,
  /<PhoneAnalysis\b[^>]*>[\s\S]*?<\/PhoneAnalysis\s*>/gi,
  /<status_current_variables\b[^>]*>[\s\S]*?<\/status_current_variables\s*>/gi,
  /<StatusPlaceHolderImpl\b[^>]*\/?>/gi,
  /<StatusPlaceHolder\b[^>]*\/?>/gi,
];

/** 去掉酒馆助手/MVU 的元数据区块（保护 <script> / <style> / 代码围栏内部不被误伤） */
export function stripTavernMetaBlocks(text: string): string {
  if (!text) return text;
  const protectedParts = text.split(/(<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|```[\s\S]*?```)/gi);
  return protectedParts
    .map((part, idx) => {
      if (idx % 2 === 1) return part;
      let out = part;
      for (const re of TAVERN_META_BLOCK_RES) out = out.replace(re, '');
      return out;
    })
    .join('');
}

/**
 * 直接执行一组正则脚本（供角色卡正文及聊天记录共用）
 */
export function applyRegexScripts(
  text: string,
  scripts: RegexScript[],
  opts: {
    charName?: string;
    userName?: string;
    depth?: number;
    placement?: number;
    enabledIndices?: Set<number>;
    formatThink?: boolean;
  } = {}
): string {
  let result = (text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\r\\n/g, "\n");
  if (!result) return "";

  const charName = opts.charName || "Character";
  const userName = opts.userName || "User";
  const depth = opts.depth ?? 0;
  const targetPlacement = opts.placement ?? 2;

  const subMacros = (str: string) =>
    str
      .replace(/{{char}}/gi, charName)
      .replace(/<BOT>/gi, charName)
      .replace(/<CHAR>/gi, charName)
      .replace(/{{user}}/gi, userName)
      .replace(/<USER>/gi, userName);

  // 1. 先按 SillyTavern 原生顺序运行正则是关键：允许卡片自带 <think> 或状态栏占位符正则优先匹配！
  const validScripts = (scripts || []).filter((s, idx) => {
    if (opts.enabledIndices) {
      if (!opts.enabledIndices.has(idx)) return false;
    } else if (s.disabled) {
      return false;
    }
    if (!(s.regex || s.findRegex)) return false;
    if (s.replacementString === undefined && s.replaceString === undefined) return false;
    if (s.promptOnly) return false;
    if (
      Array.isArray(s.placement) &&
      s.placement.length > 0 &&
      !s.placement.includes(targetPlacement) &&
      !s.markdownOnly
    ) {
      return false;
    }
    if (typeof s.minDepth === "number" && s.minDepth >= -1 && depth < s.minDepth) return false;
    if (typeof s.maxDepth === "number" && s.maxDepth >= 0 && depth > s.maxDepth) return false;
    return true;
  });

  const DOLLAR_SENTINEL = '\u0000__MIU_DOLLAR__\u0000';

  for (const script of validScripts) {
    try {
      const raw = subMacros(script.regex || script.findRegex || "");
      let re: RegExp;
      const cleanRaw = raw.trim().replace(/;+\s*$/, '').trim();
      const lit = cleanRaw.match(/^\/([\s\S]+)\/([a-z]*)$/i);
      if (lit) {
        const validFlags = Array.from(new Set((lit[2] || '').split('')))
          .filter((f) => /^[gimsuy]$/i.test(f))
          .join('');
        re = new RegExp(lit[1], validFlags);
      } else {
        const flags = script.flags
          ? Array.from(new Set(script.flags.split(''))).filter((f) => /^[gimsuy]$/i.test(f)).join('')
          : '';
        re = new RegExp(cleanRaw, flags);
      }

      const rawReplace =
        script.replacementString !== undefined
          ? script.replacementString
          : script.replaceString || "";
      const trims = (script.trimStrings || []).map(subMacros).filter(Boolean);

      result = result.replace(re, (...args: any[]) => {
        const tpl = rawReplace
          .replace(/\$\$/g, DOLLAR_SENTINEL)
          .replace(/{{match}}/gi, "$0")
          .replace(/\$&/g, "$0");
        const out = tpl.replace(/\$(\d+)/g, (_m, num) => {
          let g = args[Number(num)];
          if (typeof g !== "string" || !g) return "";
          for (const t of trims) g = g.split(t).join("");
          return g;
        });
        return subMacros(out).split(DOLLAR_SENTINEL).join('$');
      });
    } catch (e) {
      console.warn("Invalid regex script skipped:", script, e);
    }
  }

  // 2. 常见宏替换（仅在正文中尚未被正则处理的宏）
  const now = new Date();
  result = result
    .replace(/{{char}}/gi, charName)
    .replace(/<BOT>/gi, charName)
    .replace(/<CHAR>/gi, charName)
    .replace(/{{user}}/gi, userName)
    .replace(/<USER>/gi, userName)
    .replace(/{{original}}/gi, '')
    .replace(/{{lastMessage}}/gi, '')
    .replace(/{{input}}/gi, '')
    .replace(/{{model}}/gi, 'AI')
    .replace(/{{time}}/gi, now.toLocaleTimeString())
    .replace(/{{date}}/gi, now.toLocaleDateString());

  // 3. 兜底折叠未闭合/未处理的 <think> 思维链（跳过代码块与 HTML 组件）
  if (opts.formatThink !== false) {
    const thinkRegex =
      /(?:<|&lt;|\[+|\\\[+|\{+)\s*(?:think|thought|thinking)\s*(?:>|&gt;|\]+|\\\]+|\}+)([\s\S]*?)(?:<|&lt;|\[+|\\\[+|\{+)\/\s*(?:think|thought|thinking)\s*(?:>|&gt;|\]+|\\\]+|\}+)/gi;
    const parts = result.split(/(```[\s\S]*?```|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>)/gi);
    result = parts
      .map((part, idx) =>
        idx % 2 === 1
          ? part
          : part.replace(
              thinkRegex,
              '<details class="tavern-think-details"><summary class="tavern-think-summary">🤔 心理活动与思考过程</summary><div class="tavern-think-content">$1</div></details>'
            )
      )
      .join('');
  }

  // 4. Markdown 里行首缩进 4 格的 HTML 会变成代码块 —— 去掉缩进（代码围栏里的不动）
  result = result
    .split(/(```[\s\S]*?```)/g)
    .map((part, i) => (i % 2 ? part : part.replace(/^[ \t]+(<[a-zA-Z!/])/gm, "$1")))
    .join("");

  // 5. 酒馆助手/MVU 的元数据区块不出现在正文里（不伤及 <script>/<style>）
  result = stripTavernMetaBlocks(result);

  return result;
}

/**
 * Apply TavernHelper-grade regex scripts and common macros ({{char}}, {{user}}, etc.) to text
 */
export function applyRegexToText(
  text: string,
  char: CharacterCard | null | undefined,
  userName: string = "User",
  opts: { depth?: number; placement?: number; formatThink?: boolean } = {}
): string {
  const charName = char?.name || char?.data?.name || char?.data?.data?.name || "Character";
  const scripts = char ? getCharacterRegexScripts(char) : [];
  return applyRegexScripts(text, scripts, {
    charName,
    userName,
    depth: opts.depth ?? 0,
    placement: opts.placement ?? 2,
    formatThink: opts.formatThink,
  });
}
