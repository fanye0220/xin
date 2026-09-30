export function normalizeWorldbookEntries(entriesRaw: any): any[] {
  let entriesArray: any[] = [];
  if (Array.isArray(entriesRaw)) {
    entriesArray = entriesRaw;
  } else if (entriesRaw && typeof entriesRaw === 'object') {
    entriesArray = Object.values(entriesRaw);
  }

  return entriesArray.map((e: any) => {
    // Determine the key representation
    let keysArray: string[] = [];
    if (e.key) keysArray = Array.isArray(e.key) ? e.key : [e.key];
    else if (e.keys) keysArray = Array.isArray(e.keys) ? e.keys : [e.keys];

    // Some formats store keys as comma-separated string
    if (typeof keysArray === 'string') {
      keysArray = (keysArray as string).split(',').map((k: string) => k.trim()).filter(Boolean);
    }
    
    // Fallback logic for order
    let order = 50;
    if (e.order !== undefined && !isNaN(parseInt(e.order))) {
      order = parseInt(e.order);
    } else if (e.insertion_order !== undefined && !isNaN(parseInt(e.insertion_order))) {
      order = parseInt(e.insertion_order);
    }
    
    // Fallback logic for enable/disable
    let enabled = true;
    if (e.enabled !== undefined) {
      enabled = !!e.enabled;
    } else if (e.disable !== undefined) {
      enabled = !e.disable;
    }

    return {
      ...e,
      key: keysArray,
      keys: keysArray,
      order: order,
      insertion_order: order,
      disable: !enabled,
      enabled: enabled
    };
  });
}

/**
 * Universal resolver for embedded or standalone worldbook / character book
 */
export function resolveWorldbook(cardData: any): any | null {
  if (!cardData) return null;
  const d = cardData.data || cardData;
  const cb =
    d.character_book ||
    cardData.character_book ||
    d.extensions?.character_book ||
    cardData.extensions?.character_book ||
    d.data?.character_book ||
    cardData.data?.character_book ||
    d.world_info ||
    cardData.world_info ||
    d.extensions?.world_info ||
    cardData.extensions?.world_info ||
    (cardData.entries ? cardData : null) ||
    (d.entries ? d : null);
  if (!cb) return null;
  return cb;
}
