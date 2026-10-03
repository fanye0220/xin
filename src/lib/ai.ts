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
        await new Promise(resolve => setTimeout(resolve, attempt * 1500));
      }
    }
  }

  throw lastError;
}

export async function generateTagsForCharacters(characters: any[]): Promise<string[][]> {
  const settings = getAISettings();
  const endpoint = settings.customEndpoints.find(e => e.id === settings.activeCustomId) || settings.customEndpoints[0];
  if (!endpoint || !endpoint.url || !endpoint.key) {
    throw new Error("API_KEY_MISSING");
  }

  const prompt = `你是一个资深且敏锐的二次元与角色扮演（Roleplay/Tavern）角色分类专家。
请根据以下角色卡的详细信息，深入理解其核心魅力与人设特征，为每个角色提取 3 到 6 个最核心、最贴切的中文标签（Tag）。

【标签提取规范与偏好】
1. 核心人设与萌点（极其重要）：如傲娇、腹黑、病娇、爹系、高岭之花、忠犬、疯批、清冷白月光、阳光开朗、暴躁别扭、强取豪夺等。
2. 身份与职业特征：如摄政王、同桌、养父、总裁、师尊、锦衣卫、AI女仆、刺客、偶像等。
3. 关系与互动题材：如青梅竹马、先婚后爱、师徒、宿敌、修罗场、养成、双向奔赴、破镜重圆等。
4. 世界观与题材背景：如古代架空、现代都市、玄幻仙侠、赛博朋克、末世科幻、西幻魔幻等。
5. 标签格式规范：
   - 每个标签 2 到 4 个汉字为佳，精准凝练，符合中文酒馆玩家与网文分类习惯；
   - 严禁空泛或无意义标签（如“男角色”、“人类”、“剧情”等）；
   - 杜绝重复同义标签；
   - 必须输出纯 JSON 格式。

【待分类角色列表】
${characters.map((c, i) => {
  const data = c.data?.data || c.data || c;
  const id = c.id || data.id || `char_${i + 1}`;
  const name = c.name || data.name || data.char_name || '未知角色';
  const desc = (data.description || data.char_persona || data.persona || '').substring(0, 600);
  const personality = (data.personality || '').substring(0, 300);
  const scenario = (data.scenario || '').substring(0, 300);
  const firstMes = (data.first_mes || data.greeting || '').substring(0, 500);
  const existingTags = (Array.isArray(data.tags) ? data.tags : Array.isArray(c.tags) ? c.tags : []).slice(0, 8).join('、');

  return `--- 角色 ${i + 1} (ID: ${id}) ---
姓名: ${name}
${existingTags ? `已有标签(供参考): ${existingTags}\n` : ''}人设与外貌: ${desc || '无详细描述'}
性格描述: ${personality || '无'}
背景与场景: ${scenario || '无'}
开场白剧情: ${firstMes || '无'}`;
}).join('\n\n')}

请按如下 JSON 格式返回：
{
  "results": [
    { "id": "角色的实际ID", "tags": ["标签1", "标签2", "标签3", "标签4"] }
  ]
}`;

  try {
    const responseText = await callAI(prompt, true);
    let parsed: any;
    try {
      parsed = JSON.parse(responseText);
    } catch (err) {
      const match = responseText.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      }
    }

    if (parsed && Array.isArray(parsed.results)) {
      return characters.map(c => {
        const charId = c.id || c.data?.data?.id || c.data?.id;
        const item = parsed.results.find((r: any) => r.id === charId || String(r.id) === String(charId));
        return item && Array.isArray(item.tags) ? item.tags : [];
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
