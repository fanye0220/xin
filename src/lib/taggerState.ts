import { useState, useEffect } from 'react';
import { getCharacters, saveCharacter, getCharacter } from './db';
import { generateTagsForCharacters } from './ai';

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
  taggingMode: 'untagged' | 'tagged' | null = null;
  isPaused = false;
  stopRequested = false;
  apiKeyMissing = false;
  progress: TaggingProgress = { current: 0, total: 0, success: 0, failed: 0 };
  logs: TaggingLog[] = [];
  untaggedCharacters: any[] = [];
  taggedCharacters: any[] = [];
  retagReviewQueue: RetagReviewItem[] = [];
  batchSize = 10;
  logsExpanded = true;
  
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
    const response = await getCharacters(1, 10000, 'all', '', [], 'newest_import', false);
    const allChars = response.characters;
    
    this.untaggedCharacters = [];
    this.taggedCharacters = [];

    allChars.forEach(c => {
      const data = c.data?.data || c.data;
      const rawData = c.data;
      const isPreset = !!(rawData.prompts || rawData.temperature !== undefined || rawData.top_p !== undefined);
      const isStandaloneWorldbook = rawData.entries !== undefined;
      const isTheme = rawData.blur_strength !== undefined || rawData.main_text_color !== undefined || rawData.chat_display !== undefined;
      const isQR = Array.isArray(rawData) ? rawData.length > 0 && rawData[0].label !== undefined : (rawData.quick_replies !== undefined || rawData.qrList !== undefined);
      const isScript = rawData.type === 'script' && rawData.content !== undefined && rawData.name !== undefined;
      const tags = data.tags || [];
      const isBeautify = tags.some((t: string) => t.includes('美化') || t.includes('预设') || t.includes('UI') || t.includes('主题') || t.includes('工具') || t.includes('插件') || t.includes('正则') || t.includes('组件') || t.includes('工作流'));
      
      if (isPreset || isBeautify || isStandaloneWorldbook || isTheme || isQR || isScript) return;
      
      if (!tags || tags.length === 0) {
        this.untaggedCharacters.push(c);
      } else {
        this.taggedCharacters.push(c);
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
    this.notify();
  }

  stopTagging() {
    this.stopRequested = true;
    this.isPaused = false;
    this.notify();
  }

  dismiss() {
    this.stopRequested = true;
    this.isTagging = false;
    this.isPaused = false;
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
      
      while (this.isPaused) {
        if (this.stopRequested) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      if (this.stopRequested) break;

      const batch = charsToProcess.slice(i, i + API_BATCH_SIZE);
      const batchData = batch.map(c => c.data?.data || c.data);
      
      try {
        const tagsList = await generateTagsForCharacters(batchData);

        for (let j = 0; j < batch.length; j++) {
          const char = batch[j];
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
      
      while (this.isPaused) {
        if (this.stopRequested) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      if (this.stopRequested) break;

      const batch = charsToProcess.slice(i, i + API_BATCH_SIZE);
      const batchData = batch.map(c => c.data?.data || c.data);
      
      try {
        const tagsList = await generateTagsForCharacters(batchData);

        for (let j = 0; j < batch.length; j++) {
          const char = batch[j];
          const tags = tagsList[j];

          if (tags && tags.length > 0) {
            const updatedChar = { ...char };
            if (updatedChar.data.data) {
              updatedChar.data.data.tags = tags;
            } else {
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
    await this.loadCharacters();
  }
}

export const taggerState = new TaggerState();

export function useTaggerState() {
  const [state, setState] = useState({
    isTagging: taggerState.isTagging,
    taggingMode: taggerState.taggingMode,
    isPaused: taggerState.isPaused,
    progress: taggerState.progress,
    logs: taggerState.logs,
    untaggedCharacters: taggerState.untaggedCharacters,
    taggedCharacters: taggerState.taggedCharacters,
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
        progress: { ...taggerState.progress },
        logs: [...taggerState.logs],
        untaggedCharacters: [...taggerState.untaggedCharacters],
        taggedCharacters: [...taggerState.taggedCharacters],
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
