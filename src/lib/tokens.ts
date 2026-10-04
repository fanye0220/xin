/**
 * 角色卡与文本高精度 Token 计数与拆解分析工具
 * 兼容 GPT-4o / Claude 3.5 / Llama 3 / SillyTavern 酒馆生态通用标准
 */

/**
 * 估算单段文本的 Token 消耗
 * 针对 CJK 中日韩字符、全角标点、英文单词、数字、代码符号与格式做高精度估算
 */
export function estimateTokens(text?: string | null): number {
  if (!text || typeof text !== "string") return 0;
  const str = text.trim();
  if (!str) return 0;

  // 1. 中文字符、日韩假名、全角标点 (CJK 字符)
  // 现代大模型通用 Tokenizer 中，1 个标准汉字/全角符约占用 0.7 ~ 1.2 Token
  // 酒馆/通用估算标准将 1 个 CJK 字符记为 1 Token
  const cjkMatches = str.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af\uff01-\uffee]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;

  // 2. 剥离 CJK 字符后处理非 CJK 文本（英文、数字、符号、换行）
  const nonCjkStr = str.replace(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af\uff01-\uffee]/g, " ").trim();
  if (!nonCjkStr) {
    return cjkCount;
  }

  // 按空白切分成英文单词/片段
  const words = nonCjkStr.split(/\s+/).filter(Boolean);
  let nonCjkTokens = 0;

  for (const word of words) {
    // 标点符号与特殊字符单独算
    const puncts = word.match(/[.,/#!$%^&*;:{}=\-_`~()?"'<>[\]\\|]/g);
    const punctCount = puncts ? puncts.length : 0;
    const cleanWord = word.replace(/[.,/#!$%^&*;:{}=\-_`~()?"'<>[\]\\|]/g, "");

    if (cleanWord.length > 0) {
      // 英文单词平均 3.8 ~ 4 字符 1 个 Token
      nonCjkTokens += Math.max(1, Math.ceil(cleanWord.length / 3.8));
    }
    nonCjkTokens += punctCount;
  }

  // 换行符也消耗少量 Token (连续换行约 1 token)
  const lineBreaks = (str.match(/\n/g) || []).length;
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
  mesExample: number;
  mesExampleChars: number;
  systemPrompt: number;
  systemPromptChars: number;
  postHistoryInstructions: number;
  worldbook: number;
  worldbookEntriesCount: number;
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
      mesExample: 0,
      mesExampleChars: 0,
      systemPrompt: 0,
      systemPromptChars: 0,
      postHistoryInstructions: 0,
      worldbook: 0,
      worldbookEntriesCount: 0,
      totalCharCount: 0,
      permanentTokens: 0,
      initialTokens: 0,
      totalTokens: 0,
    };
  }

  const data = rawCardData.data ? rawCardData.data : rawCardData;

  const descText = String(data.description || "").trim();
  const personalityText = String(data.personality || "").trim();
  const scenarioText = String(data.scenario || "").trim();
  const firstMesText = String(data.first_mes || "").trim();
  const mesExampleText = String(data.mes_example || "").trim();
  const systemPromptText = String(data.system_prompt || "").trim();
  const postHistoryText = String(data.post_history_instructions || "").trim();

  // 备用开场白
  let altGreetingsText = "";
  let altGreetingsCount = 0;
  const altGreetings = data.alternate_greetings;
  if (Array.isArray(altGreetings)) {
    const validGreetings = altGreetings.filter((g: any) => typeof g === "string" && g.trim().length > 0);
    altGreetingsCount = validGreetings.length;
    altGreetingsText = validGreetings.join("\n\n");
  }

  // 嵌入世界书 / 设定集
  let worldbookText = "";
  let worldbookEntriesCount = 0;
  const book = data.character_book || data.worldbook || rawCardData.character_book;
  const entries = book?.entries || data.entries || rawCardData.entries;
  if (Array.isArray(entries)) {
    worldbookEntriesCount = entries.length;
    worldbookText = entries
      .map((e: any) => {
        const keys = e.keys ? (Array.isArray(e.keys) ? e.keys.join(", ") : String(e.keys)) : "";
        return `${keys ? `[条目关键词: ${keys}]\n` : ""}${e.content || ""}`;
      })
      .join("\n\n");
  }

  const descTokens = estimateTokens(descText);
  const personalityTokens = estimateTokens(personalityText);
  const scenarioTokens = estimateTokens(scenarioText);
  const firstMesTokens = estimateTokens(firstMesText);
  const altGreetingsTokens = estimateTokens(altGreetingsText);
  const mesExampleTokens = estimateTokens(mesExampleText);
  const systemPromptTokens = estimateTokens(systemPromptText);
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
    mesExample: mesExampleTokens,
    mesExampleChars: mesExampleText.length,
    systemPrompt: systemPromptTokens,
    systemPromptChars: systemPromptText.length,
    postHistoryInstructions: postHistoryTokens,
    worldbook: worldbookTokens,
    worldbookEntriesCount,
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
