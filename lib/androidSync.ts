import type { CharacterCard, ChatLog } from "./db";

// 本地目录扫描与安卓本地文件自动搬运已彻底移除，仅保留空实现兼容极少数残留签名。
export async function syncWithAndroidLocalDirectory(
  _onProgress?: (msg: string, current: number, total: number) => void,
  _forceNewPaths?: string[],
): Promise<boolean> {
  return false;
}

export async function syncAndroidFolder(): Promise<boolean> {
  return false;
}

export async function resolveFolderPath(_folderId?: string | null): Promise<string> {
  return "未归类";
}

export async function _tryCleanupOldAndroidFilesWorker(_char: CharacterCard, _newPath?: string): Promise<void> {}
export async function _syncChatToAndroidWorker(_chat: ChatLog, _skipCharacterSync: boolean = false): Promise<void> {}
export async function _deleteChatFromAndroidWorker(_chat: ChatLog): Promise<void> {}
export function syncCharacterToAndroid(_char: CharacterCard, _blobs?: any): void {}
export function fastMoveCharacterOnAndroid(_char: CharacterCard): void {}
export async function deleteCharacterFromAndroid(_char: CharacterCard): Promise<void> {}
export async function deleteFolderFromAndroid(_folder: any): Promise<void> {}
export async function syncChatToAndroid(_chat: ChatLog, _skipCharacterSync: boolean = false): Promise<void> {}
export async function deleteChatFromAndroid(_chat: ChatLog): Promise<void> {}
export async function tryCleanupOldAndroidFiles(_char: CharacterCard, _newPath?: string): Promise<void> {}
export async function batchFastMoveCharactersOnAndroid(_chars: CharacterCard[]): Promise<void> {}
export async function batchCleanupAndroidFiles(_chars: CharacterCard[]): Promise<void> {}
