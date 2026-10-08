import { getResourceType } from './db';

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

  const resType = getResourceType(char);
  if (resType === 'character') {
    return null;
  }

  switch (resType) {
    case 'qr':
      return { type: 'qr', label: '快速回复' };
    case 'worldbook':
      return { type: 'worldbook', label: '世界书' };
    case 'preset':
      return { type: 'preset', label: '预设' };
    case 'script':
      return { type: 'script', label: '脚本' };
    case 'theme':
      return { type: 'theme', label: '美化' };
    default:
      return null;
  }
}
