import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, CheckCircle, AlertCircle, Cloud } from 'lucide-react';
import { onSyncStateChange, SyncState } from '../lib/drive';

export function SyncWidget({ isLightMode }: { isLightMode: boolean }) {
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
        className={`fixed top-16 left-1/2 z-[60] flex items-center gap-2.5 backdrop-blur-xl border px-4 py-2 rounded-full max-w-[90vw] whitespace-nowrap shadow-2xl ${
          isLightMode
            ? 'bg-white border-blue-50 text-[#0f172a] shadow-[0_4px_20px_rgba(0,0,0,0.06)]'
            : 'bg-slate-900/90 border-white/15 text-white shadow-[0_8px_30px_rgba(0,0,0,0.2)]'
        }`}
      >
        {syncState.isActive ? (
          <Loader2 className={`w-4 h-4 animate-spin shrink-0 ${isLightMode ? 'text-blue-600' : 'text-blue-400'}`} />
        ) : syncState.completed ? (
          <CheckCircle className={`w-4 h-4 shrink-0 ${isLightMode ? 'text-[#1DB954]' : 'text-emerald-400'}`} />
        ) : syncState.isError ? (
          <AlertCircle className={`w-4 h-4 shrink-0 ${isLightMode ? 'text-red-600' : 'text-red-400'}`} />
        ) : (
          <Cloud className={`w-4 h-4 shrink-0 ${isLightMode ? 'text-blue-600' : 'text-blue-400'}`} />
        )}
        <div className="flex items-center truncate">
          <span className="text-xs sm:text-sm font-medium truncate">
            {syncState.taskName ? <span className={`mr-1.5 ${isLightMode ? 'text-[#64748b]' : 'text-white/60'}`}>{syncState.taskName}:</span> : ''}
            {syncState.message}
          </span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
