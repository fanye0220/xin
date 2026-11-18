/**
 * Standard File Manager Search Utilities
 * Implements file-manager style search matching, negative prefix filtering, and relevance scoring.
 */

// Normalize search strings: strip extra whitespace around slashes, lowercase
export function normalizeSearchString(str: string): string {
  if (!str) return '';
  return str
    .replace(/\s*[\/\\]\s*/g, '/')
    .trim()
    .toLowerCase();
}

/**
 * Checks if a search occurrence of `cleanQuery` inside `targetText` is positive
 * (i.e. NOT preceded by a negative prefix like "不", "非", "无", "没").
 */
export function isPositiveOccurrence(
  targetText: string,
  cleanQuery: string,
  matchIndex: number,
  isQueryNegative: boolean
): boolean {
  if (isQueryNegative) return true;
  if (matchIndex <= 0) return true;

  const prevChar = targetText[matchIndex - 1];
  const prevTwoChars = matchIndex >= 2 ? targetText.slice(matchIndex - 2, matchIndex) : prevChar;

  for (const neg of ['不', '非', '无', '没']) {
    if (prevChar === neg || prevTwoChars.endsWith(neg)) {
      return false;
    }
  }

  return true;
}

/**
 * Finds if `targetText` contains `cleanQuery` positively.
 */
export function containsPositiveMatch(targetText: string, cleanQuery: string): boolean {
  if (!targetText || !cleanQuery) return false;

  const isQueryNegative = ['不', '非', '无', '没'].some((neg) => cleanQuery.startsWith(neg));

  let pos = targetText.indexOf(cleanQuery);
  while (pos !== -1) {
    if (isPositiveOccurrence(targetText, cleanQuery, pos, isQueryNegative)) {
      return true;
    }
    pos = targetText.indexOf(cleanQuery, pos + 1);
  }

  return false;
}

/**
 * Folder Search Matching (Standard File Manager style)
 */
export function matchesFolderSearch(
  folderName: string,
  folderPath: string,
  rawQuery: string
): boolean {
  if (!rawQuery || !rawQuery.trim()) return true;

  const cleanQuery = normalizeSearchString(rawQuery);
  const cleanName = normalizeSearchString(folderName);
  const cleanPath = normalizeSearchString(folderPath || folderName);

  // 1. Slash Query (e.g. "女u/感兴趣", "男u/三国")
  if (cleanQuery.includes('/')) {
    const lastSlash = cleanQuery.lastIndexOf('/');
    const folderPart = cleanQuery.slice(0, lastSlash);
    const namePart = cleanQuery.slice(lastSlash + 1);

    const pathMatches = !folderPart || containsPositiveMatch(cleanPath, folderPart);
    const nameMatches = !namePart || containsPositiveMatch(cleanName, namePart);

    if (pathMatches && nameMatches) return true;
    return false;
  }

  // 2. Single-term Query (e.g. "感兴趣" or "男u")
  // In file managers, searching "感兴趣" matches folders whose OWN NAME matches "感兴趣".
  if (containsPositiveMatch(cleanName, cleanQuery)) return true;

  // 3. Multi-term space separated query (e.g. "女u 感兴趣")
  const spaceTerms = rawQuery.trim().split(/\s+/).map(normalizeSearchString).filter(Boolean);
  if (spaceTerms.length > 1) {
    const allMatched = spaceTerms.every((term) =>
      containsPositiveMatch(cleanName, term) || containsPositiveMatch(cleanPath, term)
    );
    if (allMatched) return true;
  }

  return false;
}

/**
 * Calculate relevance score for Folders in search results.
 * Priority: Exact Name > Name Starts With > Name Contains > Path Slash Match
 */
export function getFolderSearchScore(
  folderName: string,
  folderPath: string,
  rawQuery: string
): number {
  if (!rawQuery || !rawQuery.trim()) return 0;

  const cleanQuery = normalizeSearchString(rawQuery);
  const cleanName = normalizeSearchString(folderName);
  const cleanPath = normalizeSearchString(folderPath || folderName);

  const depth = (cleanPath.match(/\//g) || []).length;
  const depthPenalty = depth * 50;

  // 1. Exact match on folder name (e.g. folder "感兴趣", query "感兴趣")
  if (cleanName === cleanQuery) return 100000 - depthPenalty;

  // 2. Folder name starts with query (e.g. folder "感兴趣专区", query "感兴趣")
  if (cleanName.startsWith(cleanQuery) && containsPositiveMatch(cleanName, cleanQuery)) {
    return 80000 - depthPenalty;
  }

  // 3. Folder name contains query (positive match)
  if (containsPositiveMatch(cleanName, cleanQuery)) {
    return 60000 - depthPenalty;
  }

  // 4. Slash Path Query (e.g. "女u/感兴趣")
  if (cleanQuery.includes('/')) {
    const lastSlash = cleanQuery.lastIndexOf('/');
    const folderPart = cleanQuery.slice(0, lastSlash);
    const namePart = cleanQuery.slice(lastSlash + 1);

    if (cleanPath === cleanQuery) return 90000 - depthPenalty;
    if (namePart && cleanName === namePart && containsPositiveMatch(cleanPath, folderPart)) {
      return 85000 - depthPenalty;
    }
    if (namePart && cleanName.startsWith(namePart) && containsPositiveMatch(cleanPath, folderPart)) {
      return 70000 - depthPenalty;
    }
    return 40000 - depthPenalty;
  }

  // 5. Full path contains query
  if (containsPositiveMatch(cleanPath, cleanQuery)) {
    return 20000 - depthPenalty;
  }

  return 1000 - depthPenalty;
}

/**
 * Character Card Search Matching (Standard File Manager style)
 * A card matches if its OWN name or tags match the query,
 * OR if the query contains a slash ("FolderPath/CardName") matching the parent path.
 */
export function matchesCharacterSearchUtil(
  charName: string,
  charTags: string[],
  folderPath: string,
  rawQuery: string
): boolean {
  if (!rawQuery || !rawQuery.trim()) return true;

  const cleanQuery = normalizeSearchString(rawQuery);
  const cleanName = normalizeSearchString(charName);
  const cleanFolderPath = normalizeSearchString(folderPath);

  // 1. Slash Query (e.g. "男u/李金玉" or "男u/感")
  if (cleanQuery.includes('/')) {
    const lastSlash = cleanQuery.lastIndexOf('/');
    const folderPart = cleanQuery.slice(0, lastSlash);
    const namePart = cleanQuery.slice(lastSlash + 1);

    const folderMatches = !folderPart || containsPositiveMatch(cleanFolderPath, folderPart);
    const nameMatches =
      !namePart ||
      containsPositiveMatch(cleanName, namePart) ||
      charTags.some((t) => containsPositiveMatch(normalizeSearchString(t), namePart));

    if (folderMatches && nameMatches) return true;
    return false;
  }

  // 2. Single-term Query (e.g. "感兴趣" or "李金玉")
  // In file managers, searching "李金玉" matches cards whose OWN name or tags match "李金玉".
  // It DOES NOT flood results with all cards inside folder "男u" when searching "男u".
  if (containsPositiveMatch(cleanName, cleanQuery)) return true;
  if (charTags.some((t) => containsPositiveMatch(normalizeSearchString(t), cleanQuery))) return true;

  // 3. Multi-term space separated query (e.g. "男u 李金玉")
  const spaceTerms = rawQuery.trim().split(/\s+/).map(normalizeSearchString).filter(Boolean);
  if (spaceTerms.length > 1) {
    const allMatched = spaceTerms.every((term) =>
      containsPositiveMatch(cleanName, term) ||
      charTags.some((t) => containsPositiveMatch(normalizeSearchString(t), term)) ||
      containsPositiveMatch(cleanFolderPath, term)
    );
    if (allMatched) return true;
  }

  return false;
}

/**
 * Calculate relevance score for Character Cards in search results.
 */
export function getCharacterSearchScoreUtil(
  charName: string,
  charTags: string[],
  folderPath: string,
  rawQuery: string
): number {
  if (!rawQuery || !rawQuery.trim()) return 0;

  const cleanQuery = normalizeSearchString(rawQuery);
  const cleanName = normalizeSearchString(charName);
  const cleanFolderPath = normalizeSearchString(folderPath);
  const fullPath = cleanFolderPath ? `${cleanFolderPath}/${cleanName}` : cleanName;

  // 1. Exact match on character name
  if (cleanName === cleanQuery) return 100000;

  // 2. Character name starts with query
  if (cleanName.startsWith(cleanQuery) && containsPositiveMatch(cleanName, cleanQuery)) {
    return 80000;
  }

  // 3. Character name contains query
  if (containsPositiveMatch(cleanName, cleanQuery)) {
    return 60000;
  }

  // 4. Slash query match (e.g. "男u/李金玉")
  if (cleanQuery.includes('/')) {
    if (fullPath === cleanQuery) return 90000;
    const lastSlash = cleanQuery.lastIndexOf('/');
    const folderPart = cleanQuery.slice(0, lastSlash);
    const namePart = cleanQuery.slice(lastSlash + 1);

    if (namePart && cleanName === namePart && containsPositiveMatch(cleanFolderPath, folderPart)) {
      return 85000;
    }
    if (namePart && cleanName.startsWith(namePart) && containsPositiveMatch(cleanFolderPath, folderPart)) {
      return 70000;
    }
    return 40000;
  }

  // 5. Tag match
  if (charTags.some((t) => normalizeSearchString(t) === cleanQuery)) return 30000;
  if (charTags.some((t) => containsPositiveMatch(normalizeSearchString(t), cleanQuery))) return 20000;

  return 1000;
}
