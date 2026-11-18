import { parseTavernCard } from "../types/tavern";

/**
 * 角色卡与文本高精度 Token 计数与拆解分析工具
 * 兼容 GPT-4o / Claude 3.5 / Llama 3 / SillyTavern 酒馆生态通用标准
 */

// ASCII 分类查找表: 0=普通字符, 1=空白, 2=标点符号, 3=换行(\n)
const ASCII_CHAR_TYPE = new Uint8Array(128);
for (const ws of [0x09, 0x0b, 0x0c, 0x0d, 0x20]) ASCII_CHAR_TYPE[ws] = 1;
ASCII_CHAR_TYPE[0x0a] = 3;
for (const ch of ".,/#!$%^&*;:{}=-_`~()?\"'<>[]\\|") {
  ASCII_CHAR_TYPE[ch.charCodeAt(0)] = 2;
}

function isUnicodeWhitespace(code: number): boolean {
  return (
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

function isCjkCode(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fa5) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xff01 && code <= 0xffee)
  );
}

/**
 * 估算单段文本的 Token 消耗
 * 针对 CJK 中日韩字符、全角标点、英文单词、数字、代码符号与格式做高精度估算（单遍零分配扫描）
 */
export function estimateTokens(text?: string | null): number {
  if (!text || typeof text !== "string") return 0;
  const len = text.length;
  if (len === 0) return 0;

  let start = 0;
  while (start < len) {
    const c = text.charCodeAt(start);
    if ((c < 128 && (ASCII_CHAR_TYPE[c] === 1 || ASCII_CHAR_TYPE[c] === 3)) || (c >= 128 && isUnicodeWhitespace(c))) {
      start++;
    } else {
      break;
    }
  }
  if (start >= len) return 0;

  let end = len - 1;
  while (end > start) {
    const c = text.charCodeAt(end);
    if ((c < 128 && (ASCII_CHAR_TYPE[c] === 1 || ASCII_CHAR_TYPE[c] === 3)) || (c >= 128 && isUnicodeWhitespace(c))) {
      end--;
    } else {
      break;
    }
  }

  let cjkCount = 0;
  let nonCjkTokens = 0;
  let lineBreaks = 0;
  let wordCleanLen = 0;
  let wordPunctCount = 0;
  let hasNonCjkContent = false;

  for (let i = start; i <= end; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) {
      const t = ASCII_CHAR_TYPE[code];
      if (t === 0) {
        wordCleanLen++;
        hasNonCjkContent = true;
      } else if (t === 2) {
        wordPunctCount++;
        hasNonCjkContent = true;
      } else {
        if (t === 3) lineBreaks++;
        if (wordCleanLen > 0) {
          nonCjkTokens += Math.max(1, Math.ceil(wordCleanLen / 3.8));
          wordCleanLen = 0;
        }
        if (wordPunctCount > 0) {
          nonCjkTokens += wordPunctCount;
          wordPunctCount = 0;
        }
      }
    } else if (isCjkCode(code)) {
      cjkCount++;
      if (wordCleanLen > 0) {
        nonCjkTokens += Math.max(1, Math.ceil(wordCleanLen / 3.8));
        wordCleanLen = 0;
      }
      if (wordPunctCount > 0) {
        nonCjkTokens += wordPunctCount;
        wordPunctCount = 0;
      }
    } else if (isUnicodeWhitespace(code)) {
      if (wordCleanLen > 0) {
        nonCjkTokens += Math.max(1, Math.ceil(wordCleanLen / 3.8));
        wordCleanLen = 0;
      }
      if (wordPunctCount > 0) {
        nonCjkTokens += wordPunctCount;
        wordPunctCount = 0;
      }
    } else {
      wordCleanLen++;
      hasNonCjkContent = true;
    }
  }

  if (wordCleanLen > 0) {
    nonCjkTokens += Math.max(1, Math.ceil(wordCleanLen / 3.8));
  }
  if (wordPunctCount > 0) {
    nonCjkTokens += wordPunctCount;
  }

  if (!hasNonCjkContent) {
    return cjkCount;
  }

  const breakTokens = Math.floor(lineBreaks / 2);
  return cjkCount + nonCjkTokens + breakTokens;
}

export interface CharacterTokenBreakdown {
  description: number;
  descriptionChars: number;
  personality: number;
  personalityChars: number;
  scenario: number;
  scenarioChars: number;
  firstMessage: number;
  firstMessageChars: number;
  alternateGreetings: number;
  alternateGreetingsCount: number;
  alternateGreetingsChars: number;
  mesExample: number;
  mesExampleChars: number;
  systemPrompt: number;
  systemPromptChars: number;
  postHistoryInstructions: number;
  worldbook: number;
  worldbookEntriesCount: number;
  worldbookChars: number;
  totalCharCount: number;
  // 永久 Token（常驻设定）：description + personality + scenario + system_prompt + post_history_instructions
  permanentTokens: number;
  // 初始 Token：permanentTokens + firstMessage
  initialTokens: number;
  // 全部字段总计 Token（包含所有备用问候语、示例对话与世界书）
  totalTokens: number;
}

/**
 * 深度解析角色卡各字段 Token 及字符占比
 */
export function getCharacterTokenBreakdown(rawCardData: any): CharacterTokenBreakdown {
  if (!rawCardData || typeof rawCardData !== "object") {
    return {
      description: 0,
      descriptionChars: 0,
      personality: 0,
      personalityChars: 0,
      scenario: 0,
      scenarioChars: 0,
      firstMessage: 0,
      firstMessageChars: 0,
      alternateGreetings: 0,
      alternateGreetingsCount: 0,
      alternateGreetingsChars: 0,
      mesExample: 0,
      mesExampleChars: 0,
      systemPrompt: 0,
      systemPromptChars: 0,
      postHistoryInstructions: 0,
      worldbook: 0,
      worldbookEntriesCount: 0,
      worldbookChars: 0,
      totalCharCount: 0,
      permanentTokens: 0,
      initialTokens: 0,
      totalTokens: 0,
    };
  }

  // 统一解包 Tavern 卡片数据 (兼容 V1, V2, V3, DB 包装层, 独立世界书/预设 JSON)
  const parsed = parseTavernCard(rawCardData);
  const data = parsed.data;

  const cleanText = (s: any) => String(s || "").replace(/\r\n/g, "\n").trim();

  const descText = cleanText(data.description);
  const personalityText = cleanText(data.personality);
  const scenarioText = cleanText(data.scenario);
  const firstMesText = cleanText(data.first_mes);
  const mesExampleText = cleanText(data.mes_example);
  const systemPromptText = cleanText(data.system_prompt);
  const postHistoryText = cleanText(data.post_history_instructions);

  // 备用开场白与问候语（兼容数组或对象格式）
  const rawAltGreetings = data.alternate_greetings || data.extensions?.alternate_greetings || [];
  const altGreetings = Array.isArray(rawAltGreetings)
    ? rawAltGreetings
    : (rawAltGreetings && typeof rawAltGreetings === "object" ? Object.values(rawAltGreetings) : []);
  const validAltGreetings = altGreetings
    .map((g: any) => cleanText(typeof g === "string" ? g : g?.content || g?.message || ""))
    .filter((g: string) => g.length > 0);
  const altGreetingsCount = validAltGreetings.length;
  const altGreetingsText = validAltGreetings.join("\n\n");

  // 嵌入世界书 / 设定集 / Worldbook Entries（兼容数组或字典对象）
  let worldbookText = "";
  let worldbookEntriesCount = 0;
  const book = data.character_book || rawCardData.character_book || rawCardData.worldbook || rawCardData.data?.character_book || data.extensions?.character_book;
  const rawBookEntries = book?.entries || rawCardData.entries || (Array.isArray(rawCardData) ? rawCardData : null);
  const entries = Array.isArray(rawBookEntries)
    ? rawBookEntries
    : (rawBookEntries && typeof rawBookEntries === "object" ? Object.values(rawBookEntries) : null);

  if (Array.isArray(entries)) {
    worldbookEntriesCount = entries.length;
    worldbookText = entries
      .map((e: any) => {
        if (!e) return "";
        const keys = e.keys ? (Array.isArray(e.keys) ? e.keys.join(", ") : String(e.keys)) : (e.key ? String(e.key) : "");
        const comment = e.comment || e.name || "";
        const content = cleanText(e.content || e.value || "");
        return `${comment ? `[${comment}]\n` : ""}${keys ? `[触发词: ${keys}]\n` : ""}${content}`;
      })
      .filter(Boolean)
      .join("\n\n");
  }

  // 兼容 Prompt / Preset 预设卡
  let extraText = "";
  if (rawCardData.prompts && Array.isArray(rawCardData.prompts)) {
    extraText = rawCardData.prompts.map((p: any) => p.content || p.text || "").filter(Boolean).join("\n\n");
  }

  const descTokens = estimateTokens(descText);
  const personalityTokens = estimateTokens(personalityText);
  const scenarioTokens = estimateTokens(scenarioText);
  const firstMesTokens = estimateTokens(firstMesText);
  const altGreetingsTokens = estimateTokens(altGreetingsText);
  const mesExampleTokens = estimateTokens(mesExampleText);
  const systemPromptTokens = estimateTokens(systemPromptText + (extraText ? "\n" + extraText : ""));
  const postHistoryTokens = estimateTokens(postHistoryText);
  const worldbookTokens = estimateTokens(worldbookText);

  const totalCharCount =
    descText.length +
    personalityText.length +
    scenarioText.length +
    firstMesText.length +
    altGreetingsText.length +
    mesExampleText.length +
    systemPromptText.length +
    extraText.length +
    postHistoryText.length +
    worldbookText.length;

  const permanentTokens = descTokens + personalityTokens + scenarioTokens + systemPromptTokens + postHistoryTokens;
  const initialTokens = permanentTokens + firstMesTokens;
  const totalTokens = permanentTokens + firstMesTokens + altGreetingsTokens + mesExampleTokens + worldbookTokens;

  return {
    description: descTokens,
    descriptionChars: descText.length,
    personality: personalityTokens,
    personalityChars: personalityText.length,
    scenario: scenarioTokens,
    scenarioChars: scenarioText.length,
    firstMessage: firstMesTokens,
    firstMessageChars: firstMesText.length,
    alternateGreetings: altGreetingsTokens,
    alternateGreetingsCount: altGreetingsCount,
    alternateGreetingsChars: altGreetingsText.length,
    mesExample: mesExampleTokens,
    mesExampleChars: mesExampleText.length,
    systemPrompt: systemPromptTokens,
    systemPromptChars: systemPromptText.length + extraText.length,
    postHistoryInstructions: postHistoryTokens,
    worldbook: worldbookTokens,
    worldbookEntriesCount,
    worldbookChars: worldbookText.length,
    totalCharCount,
    permanentTokens,
    initialTokens,
    totalTokens,
  };
}

/**
 * 极速版卡片 Token 估算（用于列表页秒级批量展示，不阻塞主线程）
 */
export function estimateCardQuickTokens(rawCardData: any): number {
  if (!rawCardData) return 0;
  const d = rawCardData.data ? rawCardData.data : rawCardData;
  const text = `${d.description || ""} ${d.personality || ""} ${d.scenario || ""} ${d.first_mes || ""}`;
  return estimateTokens(text);
}

/**
 * 友好的数字格式化，如 1,420 或 12.5k
 */
export function formatTokenCount(num: number): string {
  if (num >= 10000) {
    return `${(num / 1000).toFixed(1)}k`;
  }
  return num.toLocaleString();
}
