
import { isToolOrCard, looksLikeChatHeader, looksLikeChatMessage, parseJsonlChat, sanitizeChatMessages, looksLikeChatPayload, parseTextChatLog } from "./src/lib/chatParse";

// Test 1: JSONL with header
const jsonl = `{"user_name":"You","character_name":"Alice","create_date":123456}
{"name":"Alice","is_user":false,"mes":"Hello world!","send_date":123457}
{"name":"You","is_user":true,"mes":"Hi Alice!","send_date":123458}`;

const jsonlMsgs = parseJsonlChat(jsonl);
console.log("Test 1 JSONL parse count:", jsonlMsgs.length);
if (jsonlMsgs.length !== 2) throw new Error("Expected 2 messages");

// Test 2: Text chat log
const textChat = `沈雀里: 早上好啊！
沈长昀: 早，今天感觉如何？
今天天气不错。
You: 我很好，谢谢关心。`;

const textParsed = parseTextChatLog(textChat, "沈雀里");
console.log("Test 2 Text chat parse:", textParsed.isChat, textParsed.messages.length);
if (!textParsed.isChat || textParsed.messages.length !== 3) throw new Error("Expected 3 messages in text chat");

// Test 3: Worldbook / Tool / Card rejection in chat payload
const worldbook = { entries: [{ key: "magic", content: "..." }] };
console.log("Test 3 Worldbook isChatPayload:", looksLikeChatPayload(worldbook));
if (looksLikeChatPayload(worldbook)) throw new Error("Worldbook should not look like chat");

const characterCard = { spec: "chara_card_v2", data: { name: "Test", first_mes: "Hi" } };
console.log("Test 3 Card isChatPayload:", looksLikeChatPayload(characterCard));
if (looksLikeChatPayload(characterCard)) throw new Error("Character card should not look like chat");

// Test 4: Sanitize chat messages
const mixedRaw = [
  { user_name: "You", character_name: "Test" },
  { name: "Test", mes: "Hello", is_user: false },
  { entries: [] }
];
const sanitized = sanitizeChatMessages(mixedRaw);
console.log("Test 4 Sanitized count:", sanitized.messages.length, sanitized.isChat);
if (sanitized.messages.length !== 1 || !sanitized.isChat) throw new Error("Sanitize failed");

console.log("ALL CHAT PARSE TESTS PASSED SUCCESSFULLY!");
