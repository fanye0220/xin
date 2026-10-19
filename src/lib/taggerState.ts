import { useState, useEffect } from 'react';
import { getCharacters, saveCharacter, getCharacter } from './db';
import { generateTagsForCharacters, generateSummaryForCharacter } from './ai';

export interface TaggingLog {
  id: string;
  name: string;
  status: 'success' | 'failed' | 'pending';
  tags?: string[];
  errorMsg?: string;
}

export interface TaggingProgress {
  current: number;
  total: number;
  success: number;
  failed: number;
}

export interface RetagReviewItem {
  char: any;
  oldTags: string[];
  newTags: string[];
}

class TaggerState {
  isTagging = false;
  taggingMode: 'untagged' | 'tagged' | 'summary' | null = null;
  isPaused = false;
  isCompleted = false;
  stopRequested = false;
  apiKeyMissing = false;
  progress: TaggingProgress = { current: 0, total: 0, success: 0, failed: 0 };
  logs: TaggingLog[] = [];
  untaggedCharacters: any[] = [];
  taggedCharacters: any[] = [];
  unsummarizedCharacters: any[] = [];
  summarizedCharacters: any[] = [];
  retagReviewQueue: RetagReviewItem[] = [];
  batchSize = 10;
  logsExpanded = true;
  /** 因为是退到后台才自动暂停（不是用户自己按的暂停），回到前台要能接着跑。 */
  visibilityPaused = false;
  pauseWaiters: Array<() => void> = [];
  
  listeners: Set<() => void> = new Set();
  errorCallback: ((msg: string) => void) | null = null;

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach(l => l());
  }
  
  setErrorCallback(cb: (msg: string) => void) {
    this.errorCallback = cb;
  }

  async loadCharacters() {
    const { getCachedMeta } = await import('./db');
    const allMeta = await getCachedMeta();
    
    this.untaggedCharacters = [];
    this.taggedCharacters = [];
    this.unsummarizedCharacters = [];
    this.summarizedCharacters = [];

    allMeta.forEach(m => {
      // 1. Skip soft-deleted / trash characters
      if (m.deletedAt) return;

      // 2. Skip tool / QR / non-character cards
      if (m.isTool || m.isQR || (m.category && m.category !== '未归类')) return;

      // 3. Skip empty ghost cards without character content
      const charName = m.name;
      if (!charName) return;

      const tags = m.tags || [];
      const isBeautify = tags.some((t: string) => t.includes('美化') || t.includes('预设') || t.includes('UI') || t.includes('主题') || t.includes('工具') || t.includes('插件') || t.includes('正则') || t.includes('组件') || t.includes('工作流'));
      if (isBeautify) return;

      const lightweightChar: any = {
        id: m.id,
        name: m.name,
        tags: m.tags || [],
        aiSummary: m.aiSummary,
        category: m.category,
        avatarUrlFallback: m.avatarUrlFallback,
        localFilePath: m.localFilePath,
        hasBlobsSeparated: m.hasBlobsSeparated,
        updatedAt: m.updatedAt,
        createdAt: m.createdAt,
        data: {
          name: m.name,
          tags: m.tags || [],
          aiSummary: m.aiSummary
        }
      };

      if (!tags || tags.length === 0) {
        this.untaggedCharacters.push(lightweightChar);
      } else {
        this.taggedCharacters.push(lightweightChar);
      }

      const summary = m.aiSummary;
      if (!summary) {
        this.unsummarizedCharacters.push(lightweightChar);
      } else {
        this.summarizedCharacters.push(lightweightChar);
      }
    });

    this.notify();
  }

  setLogsExpanded(expanded: boolean) {
    this.logsExpanded = expanded;
    this.notify();
  }

  setBatchSize(size: number) {
    this.batchSize = size;
    this.notify();
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    this.visibilityPaused = false;
    if (!this.isPaused) this.releasePauseWaiters();
    this.notify();
  }

  /** 退到后台就把打标停下来：不然 WebView 里的定时器和 AI 请求会在后台一直跑。 */
  handleVisibility(visible: boolean) {
    if (!visible) {
      if (this.isTagging && !this.isPaused) {
        this.visibilityPaused = true;
        this.isPaused = true;
        this.notify();
      }
      return;
    }
    if (this.visibilityPaused) {
      this.visibilityPaused = false;
      if (this.isTagging) this.isPaused = false;
      this.releasePauseWaiters();
      this.notify();
    }
  }

  private releasePauseWaiters() {
    const waiters = this.pauseWaiters;
    this.pauseWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /** 暂停时不靠 500ms 空转轮询，直接挂起等恢复（省电）。 */
  private waitWhilePaused(): Promise<void> {
    if (!this.isPaused || this.stopRequested) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.pauseWaiters.push(resolve);
    });
  }

  stopTagging() {
    this.stopRequested = true;
    this.isPaused = false;
    this.visibilityPaused = false;
    this.releasePauseWaiters();
    this.isCompleted = false;
    this.notify();
  }

  clearCompleted() {
    this.isCompleted = false;
    this.notify();
  }

  dismiss() {
    this.stopRequested = true;
    this.isTagging = false;
    this.isPaused = false;
    this.visibilityPaused = false;
    this.releasePauseWaiters();
    this.isCompleted = false;
    this.logs = [];
    this.progress = { current: 0, total: 0, success: 0, failed: 0 };
    this.retagReviewQueue = [];
    this.notify();
  }

  async startRetagging() {
    // Avoid double tagging
    const availableForRetag = this.taggedCharacters.filter(c => 
      !this.retagReviewQueue.some(item => item.char.id === c.id)
    );
    
    if (availableForRetag.length === 0 || this.isTagging) return;
    
    this.isTagging = true;
    this.taggingMode = 'tagged';
    this.isPaused = false;
    this.visibilityPaused = false;
    this.releasePauseWaiters();
    this.isCompleted = false;
    this.stopRequested = false;
    this.apiKeyMissing = false;
    
    const charsToProcess = this.batchSize === 0 ? availableForRetag : availableForRetag.slice(0, this.batchSize);
    this.progress = { current: 0, total: charsToProcess.length, success: 0, failed: 0 };
    
    this.logs = charsToProcess.map(c => ({
      id: c.id,
      name: c.data?.data?.name || c.data?.name || '未知角色',
      status: 'pending' as const
    }));
    this.notify();

    const API_BATCH_SIZE = 5;

    for (let i = 0; i < charsToProcess.length; i += API_BATCH_SIZE) {
      if (this.stopRequested) break;
      
      await this.waitWhilePaused();
      
      if (this.stopRequested) break;

      const batch = charsToProcess.slice(i, i + API_BATCH_SIZE);
      const fullBatch = await Promise.all(
        batch.map(async (c) => {
          if (c.data?.description || c.data?.first_mes) return c;
          const full = await getCharacter(c.id);
          return full || c;
        })
      );
      
      try {
        const tagsList = await generateTagsForCharacters(fullBatch);

        for (let j = 0; j < fullBatch.length; j++) {
          const char = fullBatch[j];
          const tags = tagsList[j];

          if (tags && tags.length > 0) {
            const fullChar = await getCharacter(char.id) || char;
            this.retagReviewQueue.push({
              char: fullChar,
              oldTags: fullChar.data?.data?.tags || fullChar.data?.tags || [],
              newTags: tags
            });
            this.progress.current++;
            this.progress.success++;
            const logIndex = this.logs.findIndex(l => l.id === char.id);
            if (logIndex !== -1) this.logs[logIndex] = { ...this.logs[logIndex], status: 'success', tags };
          } else {
            this.progress.current++;
            this.progress.failed++;
            const logIndex = this.logs.findIndex(l => l.id === char.id);
            if (logIndex !== -1) this.logs[logIndex] = { ...this.logs[logIndex], status: 'failed', errorMsg: 'AI未返回有效标签' };
            if (this.errorCallback) this.errorCallback(`角色 ${char.data?.data?.name || char.data?.name} 重新打标失败：AI未返回有效标签`);
          }
          this.notify();
        }
      } catch (error: any) {
        if (error.message === "API_KEY_MISSING") {
          this.apiKeyMissing = true;
          this.isTagging = false;
          if (this.errorCallback) this.errorCallback("打标中断：未配置 API Key");
          this.notify();
          return;
        }
        
        console.error(`Failed to retag batch starting at ${i}:`, error);
        if (this.errorCallback) this.errorCallback(`打标中断：API 请求失败 (${error.message || String(error)})`);
        
        for (let j = 0; j < batch.length; j++) {
          this.progress.current++;
          this.progress.failed++;
          const logIndex = this.logs.findIndex(l => l.id === batch[j].id);
          if (logIndex !== -1) this.logs[logIndex] = { ...this.logs[logIndex], status: 'failed', errorMsg: error.message || String(error) };
        }
        this.notify();
        this.isPaused = true;
        this.notify();
      }
      
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    this.isTagging = false;
    this.isPaused = false;
    if (!this.stopRequested && this.progress.total > 0) {
      this.isCompleted = true;
    }
    this.notify();
  }

  async approveRetag(charId: string, customTags?: string[]) {
    const idx = this.retagReviewQueue.findIndex(item => item.char.id === charId);
    if (idx === -1) return;
    
    const item = this.retagReviewQueue[idx];
    const updatedChar = { ...item.char };
    const finalTags = customTags || item.newTags;

    if (updatedChar.data.data) {
      updatedChar.data.data.tags = finalTags;
    } else {
      updatedChar.data.tags = finalTags;
    }
    await saveCharacter(updatedChar);
    
    this.retagReviewQueue.splice(idx, 1);
    this.taggedCharacters = this.taggedCharacters.filter(c => c.id !== charId);
    this.notify();
  }

  rejectRetag(charId: string) {
    const idx = this.retagReviewQueue.findIndex(item => item.char.id === charId);
    if (idx === -1) return;
    this.retagReviewQueue.splice(idx, 1);
    this.taggedCharacters = this.taggedCharacters.filter(c => c.id !== charId);
    this.notify();
  }

  async approveAllRetags() {
    if (this.retagReviewQueue.length === 0) return;
    for (const item of this.retagReviewQueue) {
      const updatedChar = { ...item.char };
      if (updatedChar.data.data) {
        updatedChar.data.data.tags = item.newTags;
      } else {
        updatedChar.data.tags = item.newTags;
      }
      await saveCharacter(updatedChar);
      this.taggedCharacters = this.taggedCharacters.filter(c => c.id !== item.char.id);
    }
    this.retagReviewQueue = [];
    this.notify();
  }

  async mergeAllRetags() {
    if (this.retagReviewQueue.length === 0) return;
    for (const item of this.retagReviewQueue) {
      const updatedChar = { ...item.char };
      const combined = Array.from(new Set([...item.oldTags, ...item.newTags]));
      if (updatedChar.data.data) {
        updatedChar.data.data.tags = combined;
      } else {
        updatedChar.data.tags = combined;
      }
      await saveCharacter(updatedChar);
      this.taggedCharacters = this.taggedCharacters.filter(c => c.id !== item.char.id);
    }
    this.retagReviewQueue = [];
    this.notify();
  }

  rejectAllRetags() {
    for (const item of this.retagReviewQueue) {
      this.taggedCharacters = this.taggedCharacters.filter(c => c.id !== item.char.id);
    }
    this.retagReviewQueue = [];
    this.notify();
  }

  async startTagging() {
    if (this.untaggedCharacters.length === 0 || this.isTagging) return;
    
    this.isTagging = true;
    this.taggingMode = 'untagged';
    this.isPaused = false;
    this.visibilityPaused = false;
    this.releasePauseWaiters();
    this.isCompleted = false;
    this.stopRequested = false;
    this.apiKeyMissing = false;
    
    const charsToProcess = this.batchSize === 0 ? this.untaggedCharacters : this.untaggedCharacters.slice(0, this.batchSize);
    this.progress = { current: 0, total: charsToProcess.length, success: 0, failed: 0 };
    
    this.logs = charsToProcess.map(c => ({
      id: c.id,
      name: c.data?.data?.name || c.data?.name || '未知角色',
      status: 'pending' as const
    }));
    this.notify();

    const API_BATCH_SIZE = 5;

    for (let i = 0; i < charsToProcess.length; i += API_BATCH_SIZE) {
      if (this.stopRequested) break;
      
      await this.waitWhilePaused();
      
      if (this.stopRequested) break;

      const batch = charsToProcess.slice(i, i + API_BATCH_SIZE);
      const fullBatch = await Promise.all(
        batch.map(async (c) => {
          if (c.data?.description || c.data?.first_mes) return c;
          const full = await getCharacter(c.id);
          return full || c;
        })
      );
      
      try {
        const tagsList = await generateTagsForCharacters(fullBatch);

        for (let j = 0; j < fullBatch.length; j++) {
          const char = fullBatch[j];
          const tags = tagsList[j];

          if (tags && tags.length > 0) {
            const updatedChar = { ...char };
            if (updatedChar.data?.data) {
              updatedChar.data.data.tags = tags;
            } else if (updatedChar.data) {
              updatedChar.data.tags = tags;
            }
            await saveCharacter(updatedChar);
            
            this.progress.current++;
            this.progress.success++;
            const logIndex = this.logs.findIndex(l => l.id === char.id);
            if (logIndex !== -1) this.logs[logIndex] = { ...this.logs[logIndex], status: 'success', tags };
          } else {
            this.progress.current++;
            this.progress.failed++;
            const logIndex = this.logs.findIndex(l => l.id === char.id);
            if (logIndex !== -1) this.logs[logIndex] = { ...this.logs[logIndex], status: 'failed', errorMsg: 'AI未返回有效标签' };
            if (this.errorCallback) this.errorCallback(`角色 ${char.data?.data?.name || char.data?.name} 打标失败：AI未返回有效标签`);
          }
          this.notify();
        }
      } catch (error: any) {
        if (error.message === "API_KEY_MISSING") {
          this.apiKeyMissing = true;
          this.isTagging = false;
          if (this.errorCallback) this.errorCallback("打标中断：未配置 API Key");
          this.notify();
          return;
        }
        
        console.error(`Failed to tag batch starting at ${i}:`, error);
        if (this.errorCallback) this.errorCallback(`打标中断：API 请求失败 (${error.message || String(error)})`);
        
        for (let j = 0; j < batch.length; j++) {
          this.progress.current++;
          this.progress.failed++;
          const logIndex = this.logs.findIndex(l => l.id === batch[j].id);
          if (logIndex !== -1) this.logs[logIndex] = { ...this.logs[logIndex], status: 'failed', errorMsg: error.message || String(error) };
        }
        this.notify();
        // Pause on error so user can see it
        this.isPaused = true;
        this.notify();
      }
      
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    this.isTagging = false;
    this.isPaused = false;
    if (!this.stopRequested && this.progress.total > 0) {
      this.isCompleted = true;
    }
    await this.loadCharacters();
  }

  async startBatchSummary() {
    if (this.unsummarizedCharacters.length === 0 || this.isTagging) return;

    this.isTagging = true;
    this.taggingMode = 'summary';
    this.isPaused = false;
    this.visibilityPaused = false;
    this.releasePauseWaiters();
    this.isCompleted = false;
    this.stopRequested = false;
    this.apiKeyMissing = false;

    const charsToProcess = this.batchSize === 0 ? this.unsummarizedCharacters : this.unsummarizedCharacters.slice(0, this.batchSize);
    this.progress = { current: 0, total: charsToProcess.length, success: 0, failed: 0 };

    this.logs = charsToProcess.map(c => ({
      id: c.id,
      name: c.data?.data?.name || c.data?.name || c.name || '未知角色',
      status: 'pending' as const
    }));
    this.notify();

    for (let i = 0; i < charsToProcess.length; i++) {
      if (this.stopRequested) break;

      await this.waitWhilePaused();

      if (this.stopRequested) break;

      const char = charsToProcess[i];
      try {
        const fullChar = await getCharacter(char.id) || char;
        const summary = await generateSummaryForCharacter(fullChar);

        if (summary) {
          fullChar.aiSummary = summary;
          if (fullChar.data?.data) {
            fullChar.data.data.aiSummary = summary;
          } else if (fullChar.data) {
            fullChar.data.aiSummary = summary;
          }
          await saveCharacter(fullChar);

          this.progress.current++;
          this.progress.success++;
          const logIndex = this.logs.findIndex(l => l.id === char.id);
          if (logIndex !== -1) {
            this.logs[logIndex] = { ...this.logs[logIndex], status: 'success', tags: [summary.substring(0, 30) + '...'] };
          }
        } else {
          this.progress.current++;
          this.progress.failed++;
          const logIndex = this.logs.findIndex(l => l.id === char.id);
          if (logIndex !== -1) {
            this.logs[logIndex] = { ...this.logs[logIndex], status: 'failed', errorMsg: 'AI未返回有效总结' };
          }
          if (this.errorCallback) this.errorCallback(`角色 ${char.data?.data?.name || char.data?.name || char.name} 总结失败：AI未返回有效总结`);
        }
      } catch (error: any) {
        if (error.message === "API_KEY_MISSING") {
          this.apiKeyMissing = true;
          this.isTagging = false;
          if (this.errorCallback) this.errorCallback("总结中断：未配置 API Key");
          this.notify();
          return;
        }

        console.error(`Failed to summarize char ${char.id}:`, error);
        this.progress.current++;
        this.progress.failed++;
        const logIndex = this.logs.findIndex(l => l.id === char.id);
        if (logIndex !== -1) {
          this.logs[logIndex] = { ...this.logs[logIndex], status: 'failed', errorMsg: error.message || String(error) };
        }
        if (this.errorCallback) this.errorCallback(`总结中断：API 请求失败 (${error.message || String(error)})`);
      }

      this.notify();
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    this.isTagging = false;
    this.isPaused = false;
    if (!this.stopRequested && this.progress.total > 0) {
      this.isCompleted = true;
    }
    await this.loadCharacters();
  }
}

export const taggerState = new TaggerState();

// 退到后台（页面不可见）就自动暂停打标，回到前台自动接着跑。
if (typeof document !== 'undefined') {
  const syncVisibility = () => taggerState.handleVisibility(document.visibilityState === 'visible');
  document.addEventListener('visibilitychange', syncVisibility);
  window.addEventListener('pageshow', syncVisibility);
  window.addEventListener('pagehide', () => taggerState.handleVisibility(false));
}

export function useTaggerState() {
  const [state, setState] = useState({
    isTagging: taggerState.isTagging,
    taggingMode: taggerState.taggingMode,
    isPaused: taggerState.isPaused,
    isCompleted: taggerState.isCompleted,
    progress: taggerState.progress,
    logs: taggerState.logs,
    untaggedCharacters: taggerState.untaggedCharacters,
    taggedCharacters: taggerState.taggedCharacters,
    unsummarizedCharacters: taggerState.unsummarizedCharacters,
    summarizedCharacters: taggerState.summarizedCharacters,
    retagReviewQueue: taggerState.retagReviewQueue,
    batchSize: taggerState.batchSize,
    apiKeyMissing: taggerState.apiKeyMissing,
    logsExpanded: taggerState.logsExpanded
  });

  useEffect(() => {
    const update = () => {
      setState({
        isTagging: taggerState.isTagging,
        taggingMode: taggerState.taggingMode,
        isPaused: taggerState.isPaused,
        isCompleted: taggerState.isCompleted,
        progress: { ...taggerState.progress },
        logs: [...taggerState.logs],
        untaggedCharacters: [...taggerState.untaggedCharacters],
        taggedCharacters: [...taggerState.taggedCharacters],
        unsummarizedCharacters: [...taggerState.unsummarizedCharacters],
        summarizedCharacters: [...taggerState.summarizedCharacters],
        retagReviewQueue: [...taggerState.retagReviewQueue],
        batchSize: taggerState.batchSize,
        apiKeyMissing: taggerState.apiKeyMissing,
        logsExpanded: taggerState.logsExpanded
      });
    };
    const unsubscribe = taggerState.subscribe(update);
    return () => {
      unsubscribe();
    };
  }, []);

  return state;
}
