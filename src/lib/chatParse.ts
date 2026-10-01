/**
 * 聊天记录解析/校验工具
 * 集中提供「这是不是一条真正的聊天消息」「这一组数据是不是真正的聊天记录」
 * 以及 JSONL / TXT 对话记录的统一解析，供所有导入路径共用。
 */

/**
 * 判断对象是否是工具（脚本、预设、世界书、快速回复）或角色卡
 */
export function isToolOrCard(obj: any): boolean {
  if (!obj || typeof obj !== "object") return false;
  if (obj.type === "script" && obj.content !== undefined) return true;
  if (obj.temperature !== undefined || obj.prompts !== undefined || obj.top_p !== undefined) return true;
  if (obj.entries !== undefined || (obj.data && obj.data.entries !== undefined)) return true;
  if (obj.qrList !== undefined || obj.quick_replies !== undefined) return true;
  if (obj.spec === "chara_card_v2" || obj.spec === "chara_card_v3" || (obj.data && (obj.data.first_mes !== undefined || obj.data.personality !== undefined))) return true;
  return false;
}

export function looksLikeChatHeader(obj: any): boolean {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  return (
    "user_name" in obj ||
    "character_name" in obj ||
    "chat_metadata" in obj ||
    "create_date" in obj
  );
}

/**
 * 判断单个对象是否是一条真正的聊天消息。
 * 渲染层(ChatViewer/CharacterChatsSection)与数据层只读取以下字段，
 * 因此用它们来界定「消息」最稳妥：mes / is_user / swipes / send_date。
 */
export function looksLikeChatMessage(obj: any): boolean {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  if (looksLikeChatHeader(obj)) return false;
  if (isToolOrCard(obj)) return false;
  return (
    "mes" in obj ||
    "text" in obj ||
    "content" in obj ||
    "is_user" in obj ||
    "role" in obj ||
    "swipes" in obj ||
    "send_date" in obj ||
    "is_name" in obj ||
    "name" in obj
  );
}

/**
 * 清洗一组解析后的「消息」：
 *  - 丢弃会话元数据头；
 *  - 丢弃一切不是聊天消息的对象（世界书/预设/快速回复/角色卡等附属内容）；
 *  - 返回是否「确实是一条聊天记录」(isChat)。
 *
 * 只有 isChat === true 且 messages.length > 0 时，调用方才应把它存成一条聊天记录。
 */
export function sanitizeChatMessages(raw: any): {
  messages: any[];
  isChat: boolean;
} {
  let arr: any[];
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (raw && typeof raw === "object" && Array.isArray(raw.chat)) {
    arr = raw.chat;
  } else if (raw) {
    arr = [raw];
  } else {
    arr = [];
  }

  const messages = arr.filter(looksLikeChatMessage);
  return { messages, isChat: messages.length > 0 };
}

/**
 * 判断「准备写入 characters 表的对象」是否其实是聊天内容（而非角色卡/资源）。
 * 用于后台扫描时，避免把散落的聊天 .json 误建成主页上的角色卡。
 */
export function looksLikeChatPayload(parsed: any): boolean {
  if (!parsed) return false;
  if (isToolOrCard(parsed)) return false;
  if (Array.isArray(parsed)) {
    return parsed.some(looksLikeChatMessage);
  }
  if (Array.isArray(parsed.chat)) {
    return parsed.chat.some(looksLikeChatMessage);
  }
  return looksLikeChatMessage(parsed);
}

export function parseTextChatLog(text: string, defaultName: string = "Character"): { messages: any[]; isChat: boolean } {
  const lines = text.trim().split("\n");
  const messages: any[] = [];
  
  for (const line of lines) {
    if (!line.trim()) continue;
    // Basic detection for "Name: Message" or "Name : Message"
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      const name = match[1].trim();
      const mes = match[2].trim();
      messages.push({
        name: name,
        is_user: name.toLowerCase() === "you" || name.toLowerCase() === "user",
        is_name: true,
        mes: mes,
        send_date: Date.now()
      });
    } else {
      messages.push({
        name: defaultName,
        is_user: false,
        is_name: true,
        mes: line.trim(),
        send_date: Date.now()
      });
    }
  }
  
  return { messages, isChat: messages.length > 0 };
}
