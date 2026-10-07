import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle2, AlertCircle, Cloud, X } from 'lucide-react';
import { onSyncStateChange, SyncState, clearSyncState } from '../lib/drive';
import { useTaggerState } from '../lib/taggerState';

export function SyncWidget({ isLightMode, onOpenSync }: { isLightMode: boolean; onOpenSync?: () => void }) {
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const { isTagging, isPaused, isCompleted } = useTaggerState();

  const isTaggerActive = isTagging || isPaused || isCompleted;

  useEffect(() => {
    const unsub = onSyncStateChange((s) => {
      if (s.isActive || s.completed || s.isError) {
        setSyncState(s);
      } else {
        setSyncState(null);
      }
    });
    return () => { unsub(); };
  }, []);

  if (!syncState) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20, x: '-50%', scale: 0.95 }}
        animate={{ opacity: 1, y: 0, x: '-50%', scale: 1 }}
        exit={{ opacity: 0, y: -20, x: '-50%', scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        onClick={onOpenSync}
        style={{
          top: isTaggerActive 
            ? 'max(4.75rem, calc(env(safe-area-inset-top, 0px) + 3.75rem))' 
            : 'max(1.25rem, calc(env(safe-area-inset-top, 0px) + 0.5rem))'
        }}
        className={`fixed left-1/2 z-[600] flex items-center gap-2.5 backdrop-blur-2xl border px-4 py-2 sm:px-4.5 sm:py-2.5 rounded-full max-w-[92vw] whitespace-nowrap shadow-2xl transition-all select-none ${
          onOpenSync ? 'cursor-pointer hover:scale-[1.02] active:scale-[0.98]' : ''
        } ${
          isLightMode
            ? 'bg-white/95 border-[#e2ecf9] text-[#0f172a] shadow-[0_12px_36px_rgba(0,0,0,0.12)] [.light-theme_&]:!bg-white [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#e2ecf9]'
            : 'bg-slate-900/95 border-white/15 text-white shadow-[0_12px_36px_rgba(0,0,0,0.5)]'
        }`}
        title={onOpenSync ? "点击打开云端同步面板" : undefined}
      >
        {syncState.isActive ? (
          <Loader2 className="w-4 h-4 animate-spin shrink-0 text-blue-500 [.light-theme_&]:!text-blue-600" />
        ) : syncState.completed ? (
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 [.light-theme_&]:!text-emerald-600" />
        ) : syncState.isError ? (
          <AlertCircle className="w-4 h-4 shrink-0 text-red-500 [.light-theme_&]:!text-red-600" />
        ) : (
          <Cloud className="w-4 h-4 shrink-0 text-blue-500 [.light-theme_&]:!text-blue-600" />
        )}
        
        <div className="flex items-center truncate min-w-0">
          <span className="text-xs sm:text-sm font-medium truncate">
            {syncState.taskName ? (
              <span className={`mr-1.5 font-bold ${
                syncState.completed 
                  ? 'text-emerald-400 [.light-theme_&]:!text-emerald-600' 
                  : syncState.isError 
                  ? 'text-red-400 [.light-theme_&]:!text-red-600' 
                  : isLightMode ? 'text-[#64748b]' : 'text-white/60'
              }`}>
                {syncState.taskName}:
              </span>
            ) : null}
            {syncState.message}
          </span>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            clearSyncState();
          }}
          className="p-1 hover:bg-white/20 rounded-full transition text-white/50 hover:text-white shrink-0 ml-0.5 [.light-theme_&]:!text-slate-400 [.light-theme_&]:hover:!text-slate-800 [.light-theme_&]:hover:!bg-black/5 cursor-pointer"
          title="关闭提示"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
