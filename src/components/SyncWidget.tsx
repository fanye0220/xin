import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle, AlertCircle, Cloud } from 'lucide-react';
import { onSyncStateChange, SyncState } from '../lib/drive';

export function SyncWidget() {
  const [syncState, setSyncState] = useState<SyncState | null>(null);

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
        className="fixed top-16 left-1/2 z-[60] flex items-center gap-3 bg-slate-800/90 backdrop-blur-md border border-white/10 shadow-xl px-5 py-2.5 rounded-full max-w-[90vw] whitespace-nowrap"
      >
        {syncState.isActive ? (
          <Loader2 className="w-5 h-5 text-blue-400 animate-spin shrink-0" />
        ) : syncState.completed ? (
          <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
        ) : syncState.isError ? (
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
        ) : (
          <Cloud className="w-5 h-5 text-blue-400 shrink-0" />
        )}
        <div className="flex items-center truncate">
          <span className="text-sm font-medium text-white truncate">
            {syncState.taskName ? <span className="text-white/60 mr-1">{syncState.taskName}:</span> : ''}
            {syncState.message}
          </span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
