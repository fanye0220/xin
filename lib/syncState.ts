export type SyncState = {
  isActive: boolean;
  taskName: string;
  message: string;
  isError: boolean;
  completed: boolean;
};

let syncState: SyncState = {
  isActive: false,
  taskName: '',
  message: '',
  isError: false,
  completed: false,
};

const syncListeners = new Set<(state: SyncState) => void>();
let syncClearTimer: ReturnType<typeof setTimeout> | null = null;

export function onSyncStateChange(listener: (state: SyncState) => void) {
  syncListeners.add(listener);
  listener(syncState);
  return () => syncListeners.delete(listener);
}

export function isSyncTaskBusy(): boolean {
  return syncState.isActive;
}

export function clearSyncState() {
  if (syncClearTimer) {
    clearTimeout(syncClearTimer);
    syncClearTimer = null;
  }
  syncState = { isActive: false, taskName: '', message: '', isError: false, completed: false };
  syncListeners.forEach(fn => fn(syncState));
}

export function updateSyncState(update: Partial<SyncState>) {
  if (syncClearTimer) {
    clearTimeout(syncClearTimer);
    syncClearTimer = null;
  }
  syncState = { ...syncState, ...update };
  syncListeners.forEach(fn => fn(syncState));

  if (!syncState.isActive && (syncState.completed || syncState.isError)) {
    syncClearTimer = setTimeout(() => {
      if (!syncState.isActive) {
        clearSyncState();
      }
    }, 60000);
  }
}
