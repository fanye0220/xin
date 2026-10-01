import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Download, X, ArrowUpRight, ShieldCheck } from 'lucide-react';
import { CURRENT_APP_VERSION, VersionInfo } from '../config/version';

interface Props {
  isOpen: boolean;
  versionInfo: VersionInfo | null;
  onClose: () => void;
  onIgnoreVersion?: (version: string) => void;
}

export function UpdateModal({ isOpen, versionInfo, onClose, onIgnoreVersion }: Props) {
  if (!isOpen || !versionInfo) return null;

  const handleDownload = () => {
    if (versionInfo.downloadUrl) {
      window.open(versionInfo.downloadUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleIgnore = () => {
    if (onIgnoreVersion && versionInfo.version) {
      onIgnoreVersion(versionInfo.version);
    }
    onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative w-full max-w-md overflow-hidden bg-slate-900 border border-purple-500/30 rounded-3xl shadow-2xl"
        >
          {/* Glowing Top Decoration */}
          <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-purple-500/20 via-pink-500/10 to-transparent pointer-events-none" />

          <div className="relative p-6 space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-gradient-to-tr from-purple-500 to-pink-500 rounded-2xl shadow-lg shadow-purple-500/30 text-white">
                  <Sparkles className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    发现新版本
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-white/50">当前: v{CURRENT_APP_VERSION}</span>
                    <span className="text-xs text-white/30">→</span>
                    <span className="text-xs font-semibold px-2 py-0.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-full">
                      v{versionInfo.version}
                    </span>
                  </div>
                </div>
              </div>

              {!versionInfo.forceUpdate && (
                <button
                  onClick={onClose}
                  className="p-2 text-white/40 hover:text-white rounded-full hover:bg-white/10 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Release Notes */}
            {versionInfo.releaseNotes && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-white/60 uppercase tracking-wider">
                  更新说明
                </div>
                <div className="p-3.5 bg-white/5 border border-white/10 rounded-2xl text-sm text-white/80 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  {versionInfo.releaseNotes}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2.5 pt-2">
              <button
                onClick={handleDownload}
                className="w-full py-3 px-4 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-semibold text-sm rounded-2xl shadow-lg shadow-purple-500/25 flex items-center justify-center gap-2 transition active:scale-[0.98]"
              >
                <Download className="w-4 h-4" />
                <span>立即下载更新</span>
                <ArrowUpRight className="w-4 h-4 opacity-70" />
              </button>

              {!versionInfo.forceUpdate && (
                <div className="flex items-center justify-between text-xs text-white/40 px-1 pt-1">
                  <button
                    onClick={handleIgnore}
                    className="hover:text-white/70 transition"
                  >
                    忽略此版本
                  </button>
                  <button
                    onClick={onClose}
                    className="hover:text-white/70 transition font-medium text-white/60"
                  >
                    稍后再说
                  </button>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
