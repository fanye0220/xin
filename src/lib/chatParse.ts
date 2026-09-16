/**
 * 聊天记录解析/校验工具
 *
 * 历史问题：
 *  - 导入聊天记录时，任何 .json/.jsonl 都被无差别当成「一条聊天记录」。
 *    酒馆(SillyTavern)导出的压缩包里通常同时包含：聊天 .jsonl、世界书 .json、
 *    预设 .json、快速回复 .json、角色卡 .json 等「附属文件」。这些附属文件被
 *    误当成聊天记录后：
 *      1) 在查看器里渲染成空白/乱码气泡（它们没有 mes 字段）；
 *      2) 每个附属文件都生成一张「记录卡」，于是导入一份压缩包就「爆出很多张卡」。
 *  - 酒馆 .jsonl 的第一行是会话元数据头(user_name / chat_metadata 等)，不是消息，
 *    也会被当成一条消息渲染成空白/乱码气泡。
 *
 * 这里集中提供「这是不是一条真正的聊天消息」「这一组数据是不是真正的聊天记录」
 * 的判断，供所有导入路径与后台扫描共用。
 */

/**
 * 判断单个对象是否是一条真正的聊天消息。
 * 渲染层(ChatViewer/CharacterChatsSection)与数据层只读取以下字段，
 * 因此用它们来界定「消息」最稳妥：mes / is_user / swipes / send_date。
 */
export function looksLikeChatMessage(obj: any): boolean {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  return (
    "mes" in obj ||
    "is_user" in obj ||
    "swipes" in obj ||
    "send_date" in obj
  );
}

/**
 * 判断对象是否是酒馆 .jsonl 的会话元数据头（首行），它不是消息。
 */
export function looksLikeChatHeader(obj: any): boolean {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  if (looksLikeChatMessage(obj)) return false;
  return (
    "user_name" in obj ||
    "character_name" in obj ||
    "chat_metadata" in obj ||
    "create_date" in obj
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
  if (Array.isArray(parsed)) {
    return parsed.some(looksLikeChatMessage);
  }
  if (Array.isArray(parsed.chat)) {
    return parsed.chat.some(looksLikeChatMessage);
  }
  return looksLikeChatMessage(parsed);
}
