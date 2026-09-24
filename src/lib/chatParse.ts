/**
 * 聊天记录解析/校验工具
 * 集中提供「这是不是一条真正的聊天消息」「这一组数据是不是真正的聊天记录」
 * 以及 JSONL / TXT 对话记录的统一解析，供所有导入路径共用。
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
  if ("chat_metadata" in obj) return true;
  if (
    ("user_name" in obj || "character_name" in obj || "create_date" in obj) &&
    !("mes" in obj) &&
    !("text" in obj)
  ) {
    return true;
  }
  return false;
}

export function looksLikeChatMessage(obj: any): boolean {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  if (looksLikeChatHeader(obj) || isToolOrCard(obj)) return false;
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

export function parseJsonlChat(text: string): any[] {
  if (!text) return [];
  const lines = text.trim().split("\n");
  const messages: any[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    try {
      const parsed = JSON.parse(l);
      if (parsed && typeof parsed === "object" && !looksLikeChatHeader(parsed) && looksLikeChatMessage(parsed)) {
        messages.push(parsed);
      }
    } catch {}
  }
  return messages;
}

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

export function looksLikeChatPayload(parsed: any): boolean {
  if (!parsed || isToolOrCard(parsed)) return false;
  if (Array.isArray(parsed)) {
    return parsed.some(looksLikeChatMessage);
  }
  if (Array.isArray(parsed.chat)) {
    return parsed.chat.some(looksLikeChatMessage);
  }
  return looksLikeChatMessage(parsed);
}

export function parseTextChatLog(text: string, defaultName: string = "Character"): { messages: any[]; isChat: boolean } {
  const trimmed = text.trim();
  if (!trimmed) return { messages: [], isChat: false };

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const sanitized = sanitizeChatMessages(parsed);
      if (sanitized.isChat) return sanitized;
    } catch {}

    const jsonlMsgs = parseJsonlChat(trimmed);
    if (jsonlMsgs.length > 0) return { messages: jsonlMsgs, isChat: true };
  }

  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const messages: any[] = [];
  let currentMsg: any = null;
  const speakerRegex = /^([^\s\[\]{}<>:：\/\\#@]{1,25})\s*[:：]\s*(.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmedLine = rawLine.trim();
    if (!trimmedLine && !currentMsg) continue;

    const match = trimmedLine.match(speakerRegex);
    const isTimestamp = match && /^\d+$/.test(match[1]);
    const isUrl = match && /^(https?|ftp|file|data)$/i.test(match[1]);

    if (match && !isTimestamp && !isUrl) {
      const speaker = match[1].trim();
      const firstLineContent = match[2];

      if (currentMsg) messages.push(currentMsg);
      currentMsg = {
        name: speaker,
        mes: firstLineContent,
        is_user:
          speaker.toLowerCase() === "you" ||
          speaker.toLowerCase() === "user" ||
          speaker === "你" ||
          (defaultName ? speaker.toLowerCase() !== defaultName.toLowerCase() : false),
        is_name: true,
        send_date: Date.now() + messages.length * 1000,
      };
    } else {
      if (currentMsg) {
        currentMsg.mes = currentMsg.mes ? currentMsg.mes + "\n" + rawLine : rawLine;
      } else if (trimmedLine) {
        currentMsg = {
          name: defaultName,
          mes: rawLine,
          is_user: false,
          is_name: true,
          send_date: Date.now(),
        };
      }
    }
  }

  if (currentMsg) messages.push(currentMsg);
  return { messages, isChat: messages.length > 0 };
}
