import { GoogleGenAI } from "@google/genai";

export interface CustomEndpoint {
  id: string;
  name: string;
  url: string;
  key: string;
  model: string;
}

export interface AISettings {
  type: 'custom';
  customEndpoints: CustomEndpoint[];
  activeCustomId: string;
  sillyTavernUrl?: string;
  sillyTavernUsername?: string;
  sillyTavernPassword?: string;
}

export function getAISettings(): AISettings {
  const saved = localStorage.getItem('ai_settings');
  if (saved) {
    try { 
      const parsed = JSON.parse(saved); 
      // Migration from old format
      if (parsed.customUrl !== undefined) {
        const migrated: AISettings = {
          type: 'custom',
          customEndpoints: [{
            id: 'default',
            name: '默认接口',
            url: parsed.customUrl || '',
            key: parsed.customKey || '',
            model: parsed.customModel || ''
          }],
          activeCustomId: 'default'
        };
        saveAISettings(migrated);
        return migrated;
      }
      if (parsed.type === 'gemini') {
          parsed.type = 'custom';
          saveAISettings(parsed);
      }
      return parsed;
    } catch (e) {}
  }
  return {
    type: 'custom',
    customEndpoints: [{
      id: 'default',
      name: '默认接口',
      url: '',
      key: '',
      model: ''
    }],
    activeCustomId: 'default'
  };
}

export function saveAISettings(settings: AISettings) {
  localStorage.setItem('ai_settings', JSON.stringify(settings));
}

export function normalizeSillyTavernUrl(raw?: string): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  let url = trimmed;
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  url = url.replace(/\/+$/, '');
  return url;
}

function encodeBasicCredentials(username: string, password: string): string {
  const credentials = `${username}:${password}`;
  const bytes = new TextEncoder().encode(credentials);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function getSillyTavernAuthHeaders(settings: AISettings): Record<string, string> {
  const headers: Record<string, string> = {};
  if (settings.sillyTavernUsername && settings.sillyTavernPassword) {
    headers['Authorization'] = `Basic ${encodeBasicCredentials(settings.sillyTavernUsername, settings.sillyTavernPassword)}`;
  }
  return headers;
}

export async function fetchCustomModels(url: string, key: string): Promise<string[]> {
  let baseUrl = url;
  if (baseUrl.endsWith('/chat/completions')) {
    baseUrl = baseUrl.replace(/\/chat\/completions$/, '');
  }
  baseUrl = baseUrl.replace(/\/$/, '');
  
  const res = await fetch(`${baseUrl}/models`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${key}`
    }
  });
  
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  
  const data = await res.json();
  if (data && Array.isArray(data.data)) {
    return data.data.map((m: any) => m.id);
  }
  return [];
}

export async function testConnection(settings: AISettings): Promise<{success: boolean, message?: string}> {
  try {
    const endpoint = settings.customEndpoints.find(e => e.id === settings.activeCustomId) || settings.customEndpoints[0];
    if (!endpoint || !endpoint.url || !endpoint.key) return { success: false, message: '请填写 API 地址和 Key' };
    let url = endpoint.url;
    if (!url.endsWith('/chat/completions')) {
      url = url.replace(/\/$/, '') + '/chat/completions';
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${endpoint.key}`
      },
      body: JSON.stringify({
        model: endpoint.model || 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'say hi' }],
        max_tokens: 10
      })
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, message: `HTTP ${res.status}: ${err.substring(0, 100)}` };
    }
    return { success: true, message: '连接成功！' };
  } catch (e: any) {
    return { success: false, message: e.message || String(e) };
  }
}

export async function callAI(prompt: string, expectJson: boolean = false, maxRetries = 5): Promise<string> {
  const settings = getAISettings();
  
  const endpoint = settings.customEndpoints.find(e => e.id === settings.activeCustomId) || settings.customEndpoints[0];
  if (!endpoint || !endpoint.url || !endpoint.key) throw new Error("API_KEY_MISSING");
  let url = endpoint.url;
  if (!url.endsWith('/chat/completions')) {
    url = url.replace(/\/$/, '') + '/chat/completions';
  }
  
  const finalPrompt = expectJson ? prompt + "\n\nIMPORTANT: You must respond ONLY with valid JSON. Do not include markdown formatting like ```json." : prompt;

  let lastError: any = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${endpoint.key}`
        },
        body: JSON.stringify({
          model: endpoint.model || 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: finalPrompt }]
        })
      });
      
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API Error ${res.status}: ${errText.substring(0, 200)}`);
      }
      
      const data = await res.json();
      let content = data.choices?.[0]?.message?.content || '';
      
      if (expectJson) {
         content = content.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      }
      return content;
    } catch (e: any) {
      lastError = e;
      console.warn(`AI request failed (attempt ${attempt}/${maxRetries}):`, e);
      if (attempt < maxRetries) {
        // Wait exponentially before retrying: 1.5s, 3s, 4.5s, 6s...
        await new Promise(resolve => setTimeout(resolve, attempt * 1500));
      }
    }
  }

  throw lastError;
}

export async function generateTagsForCharacters(characters: any[]): Promise<string[][]> {
  const charInfos = characters.map((char, index) => {
    let worldbookContent = '无';
    if (char.character_book && char.character_book.entries) {
      worldbookContent = char.character_book.entries
        .map((e: any) => `[${e.keys ? (Array.isArray(e.keys) ? e.keys.join(', ') : e.keys) : '条目'}]: ${e.content}`)
        .join('\n')
        .substring(0, 1000);
    } else if (char.extensions?.character_book?.entries) {
      worldbookContent = char.extensions.character_book.entries
        .map((e: any) => `[${e.keys ? (Array.isArray(e.keys) ? e.keys.join(', ') : e.keys) : '条目'}]: ${e.content}`)
        .join('\n')
        .substring(0, 1000);
    }
    
    return `
【角色 ${index + 1}】
角色名称: ${char.name || '未知'}
描述: ${(char.description || '无').substring(0, 1000)}
性格: ${(char.personality || '无').substring(0, 500)}
场景: ${(char.scenario || '无').substring(0, 500)}
首条消息: ${(char.first_mes || '无').substring(0, 1000)}
世界书(部分): ${worldbookContent}
`;
  }).join('\n\n');

  const prompt = `你是一个专业的网文标签分析助手，深谙起点中文网、晋江文学城等网络小说平台的流行标签体系与梗文化。请阅读以下 ${characters.length} 个角色设定，并为每个角色提取 3 到 8 个精准的网文风格分类标签。

【标签要求】
强烈建议优先使用起点、晋江等网文平台的高频流行词汇，提取以下维度的标签（不需要包含维度名称，直接输出单独的标签词即可）：
1. 分类题材/世界观：例如 快穿、穿书、无限流、赛博朋克、末世废土、仙侠修真、星际机甲、ABO、克苏鲁、年代、都市异能、西幻魔法 等。
2. 核心剧情/套路流派：例如 系统流、苟道流、无敌流、迪化流、追妻火葬场、破镜重圆、强强、天作之合、替身、真假千金、万人迷、火葬场、修罗场 等。
3. 角色属性/人设：例如 病娇、疯批、清冷、绿茶、腹黑、忠犬、傲娇、偏执狂、反派、龙傲天、美强惨、霸总、高岭之花、白月光、朱砂痣、黑莲花、人外 等。
4. 风格/调性萌点：例如 甜宠、苏爽、治愈、致郁、双向奔赴、沙雕、搞笑、日常、种田 等。

【严格禁止的后缀】
注意：由于我们是在给“角色设定卡”打标签，而不是真正的小说，所以请绝对不要在标签结尾加上“文”或“小说”字样！
例如：必须用“高干”代替“高干文”，用“甜宠”代替“甜宠文”，用“年代”代替“年代文”，用“爽文”的替代词“苏爽/大女主/大男主”。务必只保留最核心的属性词。

${charInfos}

请严格返回一个 JSON 数组，数组的长度必须与角色数量（${characters.length}）一致。数组中的每个元素也是一个数组，包含对应角色提取出的标签字符串。
例如，如果有 2 个角色，返回格式必须是：
[
  ["快穿", "万人迷", "病娇", "修罗场"],
  ["末世废土", "无限流", "无敌流", "腹黑"]
]
不要返回任何其他说明文字。`;

  try {
    const text = await callAI(prompt, true);
    let tagsList = JSON.parse(text);
    
    // Robust array extraction
    if (!Array.isArray(tagsList)) {
      if (typeof tagsList === 'object' && tagsList !== null) {
        const possibleArray = Object.values(tagsList).find(val => Array.isArray(val));
        if (possibleArray) {
          tagsList = possibleArray;
        }
      }
    }
    
    if (Array.isArray(tagsList)) {
      return tagsList.map(tags => {
        if (Array.isArray(tags)) {
          // Split by comma in case the AI returns a single string with commas
          return tags.flatMap(t => String(t).split(/[,，、]/)).map(t => t.trim()).filter(t => t);
        }
        return [];
      });
    }
    return characters.map(() => []);
  } catch (error) {
    console.error("Error generating tags:", error);
    throw error;
  }
}

export async function generateSummaryForCharacter(characterData: any): Promise<string> {
  const char = characterData.data?.data || characterData.data || characterData;
  
  // 1. 提取世界书/设定集完整内容
  let worldbookContent = '无';
  const book = char.character_book || char.extensions?.character_book || characterData.character_book;
  if (book && book.entries && Array.isArray(book.entries)) {
    const validEntries = book.entries.filter((e: any) => e && (e.content || e.entry));
    if (validEntries.length > 0) {
      worldbookContent = validEntries
        .map((e: any, idx: number) => {
          const keys = e.keys ? (Array.isArray(e.keys) ? e.keys.join(', ') : e.keys) : `条目${idx + 1}`;
          const text = e.content || e.entry || '';
          return `[${keys}]: ${text}`;
        })
        .join('\n')
        .substring(0, 3000);
    }
  }

  // 2. 提取首条消息与备用开场白
  const mainGreeting = char.first_mes || char.greeting || '';
  const altGreetings = Array.isArray(char.alternate_greetings) ? char.alternate_greetings.join('\n---\n') : '';
  const fullGreetings = [mainGreeting, altGreetings].filter(Boolean).join('\n---\n');

  // 3. 构建深度分析 Prompt（严格优先：人设背景 -> 世界书 -> 开场白）
  const prompt = `你是一个资深的角色人设与故事文案精炼师。请深入分析以下角色卡，全面梳理【核心人设/身份性格】、【世界书/背景设定】以及【开场白/故事契机】，为该角色撰写一份沉浸感极强、故事张力十足的角色简介（字数 150-450 字）。

【分析优先级与权重】
1. 人设与性格背景 (最高优先)：分析角色的真实身份、内外性格反差、过去经历、核心愿望与心理软肋。
2. 世界书与世界观设定 (次高优先)：提取势力背景、力量体系、世界法则或角色所处环境。
3. 开场白与与 {{user}} 的关系 (结合引导)：分析角色与 {{user}} 的宿怨/羁绊/利益牵扯，以及开场白中的剧情冲突点。

【角色卡完整资料】
角色名称: ${char.name || char.char_name || '未知'}

【一、人设与性格背景】
描述人设: ${(char.description || char.char_persona || '无').substring(0, 2000)}
性格特点: ${(char.personality || '无').substring(0, 1000)}
场景设定: ${(char.scenario || '无').substring(0, 800)}
作者寄语/备注: ${(char.creator_notes || '无').substring(0, 500)}

【二、世界书与关联设定】
${worldbookContent}

【三、开场白与剧情契机】
${fullGreetings ? fullGreetings.substring(0, 2000) : '无'}

【撰写格式与风格要求】
- 语言生动流畅，富有小说文案的拉扯感与戏剧张力（可分为人设背景、世界/局势、与 user 的关系等段落，可用虚线或自然换行隔开）。
- 必须全面结合【人设背景】与【世界书设定】，绝对不能只简单复述开场白对话！
- 字数控制在 150 到 450 字之间。
- 绝对不要输出任何无关的前缀说明（如"总结如下："、"这是一份简介"），直接输出最终精炼简介文本。`;

  const text = await callAI(prompt, false);
  return text.trim();
}
