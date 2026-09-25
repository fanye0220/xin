import { getCharacterCategoryPrefix } from "./db";

export interface CardBadgeInfo {
  label: string;
  dotColor: string;
  type: string;
}

/**
 * Determines badge label and visual styling for a character/resource card.
 * Returns null if the card is a standard character card (no badge needed).
 */
export function getCardBadgeInfo(char: any): CardBadgeInfo | null {
  if (!char) return null;

  // 1. Check isChat flag
  if (char.appProperties?.isChat === "true" || char.isChat === true) {
    return { label: "聊天记录", dotColor: "bg-blue-400", type: "chat" };
  }

  // 2. Direct category string
  let cat: string | undefined = char.category;

  // 3. Direct cardType
  if (!cat || cat === "未归类") {
    const ct = char.cardType || char.appProperties?.cardType;
    if (ct) {
      if (ct === "qr") cat = "快速回复";
      else if (ct === "preset") cat = "预设";
      else if (ct === "script") cat = "脚本";
      else if (ct === "worldbook") cat = "世界书";
      else if (ct === "theme") cat = "美化";
      else if (ct !== "character") cat = ct;
    }
  }

  // 4. isQR flag
  if ((!cat || cat === "未归类") && char.isQR === true) {
    cat = "快速回复";
  }

  // 5. Data payload available (when full character data is loaded)
  if (
    (!cat || cat === "未归类") &&
    char.data &&
    typeof char.data === "object" &&
    Object.keys(char.data).length > 0
  ) {
    cat = getCharacterCategoryPrefix(char);
  }

  // 6. Tags hints (e.g. tag contains 快速回复, 预设, 脚本, etc.)
  if ((!cat || cat === "未归类") && Array.isArray(char.tags)) {
    if (char.tags.includes("快速回复") || char.tags.includes("QR") || char.tags.includes("qr")) {
      cat = "快速回复";
    } else if (char.tags.includes("预设")) {
      cat = "预设";
    } else if (char.tags.includes("脚本")) {
      cat = "脚本";
    } else if (char.tags.includes("世界书")) {
      cat = "世界书";
    } else if (char.tags.includes("美化")) {
      cat = "美化";
    }
  }

  // 7. If isTool is true and still unknown
  if ((!cat || cat === "未归类") && char.isTool) {
    cat = "工具";
  }

  // 8. Normal character card has no badge
  if (!cat || cat === "未归类" || cat === "character") {
    return null;
  }

  switch (cat) {
    case "快速回复":
    case "qr":
    case "QR":
      return { label: "快速回复", dotColor: "bg-emerald-400", type: "qr" };
    case "预设":
    case "preset":
      return { label: "预设", dotColor: "bg-amber-400", type: "preset" };
    case "脚本":
    case "script":
      return { label: "脚本", dotColor: "bg-cyan-400", type: "script" };
    case "世界书":
    case "worldbook":
      return { label: "世界书", dotColor: "bg-purple-400", type: "worldbook" };
    case "美化":
    case "theme":
      return { label: "美化", dotColor: "bg-pink-400", type: "theme" };
    case "聊天记录":
    case "chat":
      return { label: "聊天记录", dotColor: "bg-blue-400", type: "chat" };
    default:
      return { label: cat, dotColor: "bg-slate-400", type: "custom" };
  }
}
