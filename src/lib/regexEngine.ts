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
 * Get all regex scripts from a character card
 */
export function getCharacterRegexScripts(char: CharacterCard | null | undefined): RegexScript[] {
  if (!char) return [];
  const targetData = char.data?.data || char.data || {};
  const exts = targetData.extensions || char.data?.extensions || {};
  const scripts = exts.regex_scripts || [];
  return Array.isArray(scripts) ? scripts : [];
}

/**
 * Apply TavernHelper-grade regex scripts and common macros ({{char}}, {{user}}, etc.) to text
 */
export function applyRegexToText(
  text: string,
  char: CharacterCard | null | undefined,
  userName: string = "User",
  opts: { depth?: number } = {}
): string {
  let result = text || "";
  if (!result) return "";

  const charName = char?.name || (char?.data?.name) || (char?.data?.data?.name) || "Character";

  // 1. Format <think>, [think], {{think}}, <thought> into clean collapsible tavern think box
  const thinkRegex =
    /(?:<|&lt;|\[+|\\\[+|\{+)\s*(?:think|thought|thinking)\s*(?:>|&gt;|\]+|\\\]+|\}+)([\s\S]*?)(?:<|&lt;|\[+|\\\[+|\{+)\/\s*(?:think|thought|thinking)\s*(?:>|&gt;|\]+|\\\]+|\}+)/gi;
  result = result.replace(
    thinkRegex,
    '<details class="tavern-think-details"><summary class="tavern-think-summary">🤔 心理活动与思考过程</summary><div class="tavern-think-content">$1</div></details>'
  );

  // 2. Apply standard Tavern / SillyTavern / TavernHelper macros
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

  if (!char) return result;

  const depth = opts.depth ?? 0;
  const subMacros = (str: string) =>
    str
      .replace(/{{char}}/gi, charName)
      .replace(/<BOT>/gi, charName)
      .replace(/<CHAR>/gi, charName)
      .replace(/{{user}}/gi, userName)
      .replace(/<USER>/gi, userName);

  // 3. 只运行「显示用」的脚本（和酒馆一致）：
  //    - 开场白属于 AI 输出，placement 必须包含 2（没填 placement 则不限制）
  //    - promptOnly（仅发给模型）的脚本不能作用于显示
  //    - markdownOnly（仅格式化显示）正是我们要的
  //    - minDepth / maxDepth 按酒馆规则，开场白 depth = 0
  const validScripts = getCharacterRegexScripts(char).filter((s) => {
    if (s.disabled) return false;
    if (!(s.regex || s.findRegex)) return false;
    if (s.replacementString === undefined && s.replaceString === undefined) return false;
    if (s.promptOnly) return false;
    if (Array.isArray(s.placement) && s.placement.length > 0 && !s.placement.includes(2)) return false;
    if (typeof s.minDepth === "number" && s.minDepth >= -1 && depth < s.minDepth) return false;
    if (typeof s.maxDepth === "number" && s.maxDepth >= 0 && depth > s.maxDepth) return false;
    return true;
  });

  for (const script of validScripts) {
    try {
      const raw = subMacros(script.regex || script.findRegex || "");

      // 与酒馆 regexFromString 一致：/pattern/flags 就按写的 flags 来（不再强行加 g）；
      // 不是斜杠格式就当正则源码，而不是当字面量转义。
      let re: RegExp;
      const lit = raw.match(/^\/([\s\S]+)\/([a-z]*)$/i);
      if (lit && /^(?!.*?(.).*?\1)[gmixsuyd]*$/.test(lit[2])) {
        re = new RegExp(lit[1], lit[2]);
      } else {
        re = new RegExp(raw);
      }

      const rawReplace =
        script.replacementString !== undefined
          ? script.replacementString
          : script.replaceString || "";
      const trims = (script.trimStrings || []).map(subMacros).filter(Boolean);

      // 注意：不再把 replacement 里的字面量 \n \t 改成真实换行。
      // 酒馆不这么做，而且状态栏里的 <script> 常有 '\n' 字符串，被改成真换行会直接语法错误。
      result = result.replace(re, (...args: any[]) => {
        const tpl = rawReplace.replace(/{{match}}/gi, "$0");
        const out = tpl.replace(/\$(\d+)/g, (_m, num) => {
          let g = args[Number(num)];
          if (typeof g !== "string" || !g) return "";
          for (const t of trims) g = g.split(t).join("");
          return g;
        });
        return subMacros(out);
      });
    } catch (e) {
      console.warn("Invalid regex script skipped:", script, e);
    }
  }

  // 4. Markdown 里行首缩进 4 格的 HTML 会变成代码块 —— 去掉缩进（代码围栏里的不动）
  result = result
    .split(/(```[\s\S]*?```)/g)
    .map((part, i) => (i % 2 ? part : part.replace(/^[ \t]+(<[a-zA-Z!/])/gm, "$1")))
    .join("");

  return result;
}
