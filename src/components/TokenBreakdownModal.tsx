import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MessageSquare, BookOpen, Layers, Sparkles, FileText } from "lucide-react";
import { CharacterTokenBreakdown, formatTokenCount } from "../lib/tokens";

interface TokenBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  charName: string;
  breakdown: CharacterTokenBreakdown;
  isLightMode?: boolean;
}

export function TokenBreakdownModal({
  isOpen,
  onClose,
  charName,
  breakdown,
  isLightMode: propIsLightMode,
}: TokenBreakdownModalProps) {
  const [isLightMode, setIsLightMode] = useState(() => {
    if (typeof propIsLightMode === "boolean") return propIsLightMode;
    return (
      typeof document !== "undefined" && (
        document.documentElement.classList.contains("light-theme") ||
        document.body.classList.contains("light-theme") ||
        localStorage.getItem("tavern_theme") === "light"
      )
    );
  });

  useEffect(() => {
    if (typeof propIsLightMode === "boolean") {
      setIsLightMode(propIsLightMode);
      return;
    }
    const checkTheme = () => {
      const isLight =
        typeof document !== "undefined" && (
          document.documentElement.classList.contains("light-theme") ||
          document.body.classList.contains("light-theme") ||
          localStorage.getItem("tavern_theme") === "light"
        );
      setIsLightMode(Boolean(isLight));
    };
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    if (typeof document !== "undefined") {
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
      window.addEventListener("storage", checkTheme);
    }
    return () => {
      observer.disconnect();
      if (typeof window !== "undefined") {
        window.removeEventListener("storage", checkTheme);
      }
    };
  }, [propIsLightMode]);

  if (!isOpen) return null;

  // Percentage calculations
  const total = Math.max(1, breakdown.totalTokens);
  const getPercent = (val: number) => Math.round((val / total) * 100);

  const sections = [
    {
      title: "设定描述 (Description)",
      tokens: breakdown.description,
      chars: breakdown.descriptionChars,
      color: "bg-blue-500",
      desc: "角色的外貌、背景、设定等基础信息，常驻进入提示词",
      icon: FileText,
    },
    {
      title: "角色性格 (Personality)",
      tokens: breakdown.personality,
      chars: breakdown.personalityChars,
      color: "bg-purple-500",
      desc: "说话语气、行为风格与心理特质，常驻进入提示词",
      icon: Sparkles,
    },
    {
      title: "对话场景 (Scenario)",
      tokens: breakdown.scenario,
      chars: breakdown.scenarioChars,
      color: "bg-emerald-500",
      desc: "初始环境背景或开局设定，常驻进入提示词",
      icon: Layers,
    },
    {
      title: "初始问候语 (First Message)",
      tokens: breakdown.firstMessage,
      chars: breakdown.firstMessageChars,
      color: "bg-amber-500",
      desc: "首次开启对话时角色发出的第一条消息",
      icon: MessageSquare,
    },
    ...(breakdown.alternateGreetings > 0
      ? [
          {
            title: `备用问候语 (${breakdown.alternateGreetingsCount} 条)`,
            tokens: breakdown.alternateGreetings,
            chars: 0,
            color: "bg-orange-500",
            desc: "切换开场白备选方案，仅激活时占上下文",
            icon: MessageSquare,
          },
        ]
      : []),
    ...(breakdown.mesExample > 0
      ? [
          {
            title: "示例对话 (Examples)",
            tokens: breakdown.mesExample,
            chars: breakdown.mesExampleChars,
            color: "bg-cyan-500",
            desc: "示范大模型语气及交互规范的对话样例",
            icon: MessageSquare,
          },
        ]
      : []),
    ...(breakdown.worldbook > 0
      ? [
          {
            title: `嵌入世界书 (${breakdown.worldbookEntriesCount} 个条目)`,
            tokens: breakdown.worldbook,
            chars: 0,
            color: "bg-indigo-500",
            desc: "卡片内置词条集，命中关键词时按需动态激活插入",
            icon: BookOpen,
          },
        ]
      : []),
  ];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className={`fixed inset-0 backdrop-blur-sm transition-colors ${
            isLightMode ? "bg-black/30" : "bg-black/60"
          }`}
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className={`relative w-full max-w-lg max-h-[85vh] rounded-3xl flex flex-col shadow-2xl overflow-hidden border backdrop-blur-2xl transition-colors ${
            isLightMode
              ? "bg-white border-[#e2ecf9] text-slate-900"
              : "bg-slate-900/95 border-white/10 text-slate-100"
          }`}
        >
          {/* Header - 仅保留文字标题 */}
          <div className={`flex items-center justify-between gap-3 px-6 py-4.5 border-b shrink-0 transition-colors ${
            isLightMode ? "border-[#e2ecf9]" : "border-white/10"
          }`}>
            <div className="min-w-0">
              <h3 className="font-bold text-base sm:text-lg truncate detail-card-text">
                Token 占用分析
              </h3>
              <p className="text-xs truncate mt-0.5 detail-card-text-muted">
                {charName}
              </p>
            </div>
            <button
              onClick={onClose}
              className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition cursor-pointer border ${
                isLightMode
                  ? "bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-600 hover:text-slate-900 border-slate-200 shadow-2xs"
                  : "bg-white/10 hover:bg-white/15 text-white/60 hover:text-white border-transparent"
              }`}
              title="关闭"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5 custom-scrollbar">
            {/* Top Stat Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <div className="detail-card p-3.5 rounded-2xl transition-colors">
                <div className="text-[11px] font-medium mb-1 detail-card-text-muted">
                  常驻提示词
                </div>
                <div className="text-xl font-bold font-mono detail-card-text">
                  {formatTokenCount(breakdown.permanentTokens)}
                </div>
                <div className="text-[10px] mt-0.5 detail-card-text-muted">
                  描述 + 性格 + 场景
                </div>
              </div>

              <div className="detail-card p-3.5 rounded-2xl transition-colors">
                <div className="text-[11px] font-medium mb-1 detail-card-text-muted">
                  初始对话上下文
                </div>
                <div className="text-xl font-bold font-mono detail-card-text">
                  {formatTokenCount(breakdown.initialTokens)}
                </div>
                <div className="text-[10px] mt-0.5 detail-card-text-muted">
                  常驻 + 首条消息
                </div>
              </div>

              <div className="col-span-2 sm:col-span-1 detail-card p-3.5 rounded-2xl transition-colors">
                <div className="text-[11px] font-medium mb-1 detail-card-text-muted">
                  整卡包含总量
                </div>
                <div className="text-xl font-bold font-mono detail-card-text">
                  {formatTokenCount(breakdown.totalTokens)}
                </div>
                <div className="text-[10px] mt-0.5 detail-card-text-muted">
                  共计 {breakdown.totalCharCount.toLocaleString()} 字符
                </div>
              </div>
            </div>

            {/* Visual Token Distribution Bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-medium detail-card-text-muted">
                <span>字段空间占用比率</span>
                <span className="font-mono text-[11px]">{breakdown.totalTokens.toLocaleString()} Tokens</span>
              </div>
              <div className={`w-full h-2.5 rounded-full overflow-hidden flex p-0.5 gap-0.5 border transition-colors ${
                isLightMode ? "bg-slate-100 border-[#e2ecf9]" : "bg-white/10 border-white/10"
              }`}>
                {sections.map((s, idx) => {
                  const pct = getPercent(s.tokens);
                  if (pct <= 0) return null;
                  return (
                    <div
                      key={idx}
                      style={{ width: `${pct}%` }}
                      className={`h-full rounded-full ${s.color} transition-all duration-300`}
                      title={`${s.title}: ${s.tokens} T (${pct}%)`}
                    />
                  );
                })}
              </div>
            </div>

            {/* Field Breakdown Cards */}
            <div className="space-y-2.5">
              <h4 className="text-xs font-bold tracking-wider detail-card-text-muted">
                各组成字段细则
              </h4>
              <div className="space-y-2">
                {sections.map((sec, idx) => {
                  const IconComp = sec.icon;
                  return (
                    <div
                      key={idx}
                      className="detail-card p-3.5 rounded-2xl transition-all"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <IconComp className="w-3.5 h-3.5 shrink-0 detail-card-text-muted" />
                          <span className="font-semibold text-xs sm:text-sm truncate detail-card-text">
                            {sec.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 font-mono">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${
                            isLightMode
                              ? "bg-white border-[#e2ecf9] text-slate-800"
                              : "bg-white/10 border-white/15 text-white/90"
                          }`}>
                            {sec.tokens.toLocaleString()} T
                          </span>
                          <span className="text-[11px] detail-card-text-muted">
                            ({getPercent(sec.tokens)}%)
                          </span>
                        </div>
                      </div>
                      <p className="text-[11px] leading-relaxed detail-card-text-muted">
                        {sec.desc}
                        {sec.chars > 0 && ` · 约 ${sec.chars.toLocaleString()} 字符`}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className={`p-4 border-t flex justify-end shrink-0 transition-colors ${
            isLightMode ? "border-[#e2ecf9]" : "border-white/10"
          }`}>
            <button
              onClick={onClose}
              className={`px-6 py-2.5 rounded-2xl text-xs sm:text-sm font-semibold transition active:scale-95 cursor-pointer shadow-xs ${
                isLightMode
                  ? "bg-slate-900 hover:bg-slate-800 text-white"
                  : "bg-white/10 hover:bg-white/15 text-white"
              }`}
            >
              知道了
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}