import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X, ArrowUpRight, ShieldCheck, Sparkles, FileText } from 'lucide-react';
import { CURRENT_APP_VERSION, VersionInfo } from '../config/version';
import { openExternalUrl } from '../lib/appBridge';

interface Props {
  isOpen: boolean;
  versionInfo: VersionInfo | null;
  onClose: () => void;
  onIgnoreVersion?: (version: string) => void;
  isLightMode?: boolean;
}

export function UpdateModal({ isOpen, versionInfo, onClose, onIgnoreVersion, isLightMode }: Props) {
  if (!versionInfo) return null;

  const handleDownload = () => {
    if (versionInfo.downloadUrl) {
      openExternalUrl(versionInfo.downloadUrl);
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
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={versionInfo.forceUpdate ? undefined : onClose}
            className="fixed inset-0 bg-black/60 [.light-theme_&]:!bg-black/25 backdrop-blur-sm z-[80]"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={`fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-[420px] sm:max-w-[440px] rounded-3xl border shadow-2xl z-[90] flex flex-col overflow-hidden transition-all duration-200 ${
              isLightMode
                ? 'bg-white text-slate-900 border-[#e2e8f0]'
                : 'bg-slate-900/95 text-slate-100 border-white/10 backdrop-blur-2xl'
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 sm:p-6 pb-4 border-b border-white/10 [.light-theme_&]:!border-[#f1f5f9] shrink-0 gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-10 h-10 rounded-2xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center text-blue-400 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!border-blue-200 [.light-theme_&]:!text-blue-600 shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base sm:text-lg font-bold text-slate-100 [.light-theme_&]:!text-[#0f172a] truncate">
                    发现新版本
                  </h2>
                  <div className="flex items-center gap-1.5 mt-0.5 text-xs">
                    <span className="text-slate-400 [.light-theme_&]:!text-slate-500 text-[11px]">
                      当前 v{CURRENT_APP_VERSION}
                    </span>
                    <span className="text-slate-500 [.light-theme_&]:!text-slate-400 text-[11px]">→</span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold font-mono bg-blue-500/15 text-blue-400 border border-blue-500/30 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-blue-600 [.light-theme_&]:!border-blue-200">
                      v{versionInfo.version}
                    </span>
                  </div>
                </div>
              </div>

              {!versionInfo.forceUpdate && (
                <button
                  type="button"
                  onClick={onClose}
                  className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition cursor-pointer bg-white/10 hover:bg-white/20 text-white/90 hover:text-white border border-white/10 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:active:!bg-[#cbd5e1] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#e2e8f0] shrink-0"
                  title="关闭"
                >
                  <X className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              )}
            </div>

            {/* Content Body */}
            <div className="p-5 sm:p-6 space-y-4 flex-1 overflow-y-auto">
              {/* Release Notes */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 [.light-theme_&]:!text-slate-500">
                  <FileText className="w-3.5 h-3.5" />
                  <span>更新内容</span>
                </div>
                <div className="rounded-2xl p-4 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap select-text max-h-56 overflow-y-auto border bg-white/[0.04] border-white/10 text-slate-200 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-[#1e293b]">
                  {versionInfo.releaseNotes?.trim() || '本次更新包含稳定性提升与已知体验优化。'}
                </div>
              </div>

              {versionInfo.forceUpdate && (
                <div className="flex items-center gap-2 p-3 rounded-2xl border text-xs bg-amber-500/10 border-amber-500/20 text-amber-300 [.light-theme_&]:!bg-amber-50 [.light-theme_&]:!border-amber-200 [.light-theme_&]:!text-amber-800">
                  <ShieldCheck className="w-4 h-4 shrink-0 text-amber-400 [.light-theme_&]:!text-amber-600" />
                  <span>此版本包含重要关键更新，需更新后继续使用</span>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="p-5 sm:p-6 pt-0 space-y-3 shrink-0">
              <button
                type="button"
                onClick={handleDownload}
                className="w-full py-3 px-4 rounded-2xl font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.98] shadow-sm bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white [.light-theme_&]:!bg-[#007aff] [.light-theme_&]:hover:!bg-[#0062cc]"
              >
                <Download className="w-4 h-4 stroke-[2.2]" />
                <span>立即下载更新</span>
                <ArrowUpRight className="w-4 h-4 opacity-80" />
              </button>

              {!versionInfo.forceUpdate && (
                <div className="flex items-center justify-between px-1">
                  <button
                    type="button"
                    onClick={handleIgnore}
                    className="text-xs text-slate-400 hover:text-slate-200 [.light-theme_&]:!text-slate-400 [.light-theme_&]:hover:!text-slate-600 transition cursor-pointer py-1 px-1.5 rounded-lg hover:bg-white/5 [.light-theme_&]:hover:!bg-slate-100"
                  >
                    忽略此版本
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="text-xs font-medium text-slate-300 hover:text-white [.light-theme_&]:!text-slate-600 [.light-theme_&]:hover:!text-[#0f172a] transition cursor-pointer py-1 px-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!border-[#e2e8f0]"
                  >
                    稍后再说
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
