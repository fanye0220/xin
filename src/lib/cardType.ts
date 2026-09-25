import { isActualCharacterCard, getCharacterCategoryPrefix } from './db';

export type CardCategoryType = 'character' | 'qr' | 'worldbook' | 'preset' | 'theme' | 'script';

export interface CardTypeBadgeInfo {
  type: CardCategoryType;
  label: string;
  bgClass?: string;
  textClass?: string;
  borderClass?: string;
}

/**
 * 识别卡片是否为非角色卡（如快速回复/QR、世界书、预设、脚本/正则、美化等）
 * 如果是普通角色卡则返回 null，不显示角标；
 * 如果是工具/预设/世界书等，则返回对应的角标信息。
 */
export function getCardTypeBadgeInfo(char: any): CardTypeBadgeInfo | null {
  if (!char) return null;

  const rawData = char?.data?.data || char?.data || char || {};
  const outer = char?.data || char || {};
  const target = (outer.data && typeof outer.data === "object" && !Array.isArray(outer.data)) ? outer.data : outer;

  // 1. Check if it's an actual character card -> NEVER display tool badges on character cards!
  if (isActualCharacterCard(rawData) || isActualCharacterCard(outer) || isActualCharacterCard(target)) {
    return null;
  }

  // 2. Direct category or detected category
  const cat = char.category || getCharacterCategoryPrefix(char);
  if (!cat || cat === '未归类' || cat === 'character') {
    return null;
  }

  if (cat === '快速回复' || cat === 'qr') {
    return { type: 'qr', label: '快速回复' };
  }
  if (cat === '世界书' || cat === 'worldbook') {
    return { type: 'worldbook', label: '世界书' };
  }
  if (cat === '预设' || cat === 'preset') {
    return { type: 'preset', label: '预设' };
  }
  if (cat === '脚本' || cat === 'script') {
    return { type: 'script', label: '脚本' };
  }
  if (cat === '美化' || cat === 'theme') {
    return { type: 'theme', label: '美化' };
  }
  if (cat === '聊天记录' || cat === 'chat') {
    return { type: 'script', label: '聊天记录' };
  }
  return { type: 'script', label: cat };
}
