import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MessageSquare, BookOpen, Layers, Sparkles, FileText, Eye, EyeOff } from "lucide-react";
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

  const [showMainTokens, setShowMainTokens] = useState<boolean>(() => {
    return typeof localStorage !== "undefined" && localStorage.getItem("miu_show_main_page_tokens") !== "false";
  });

  const toggleShowMainTokens = () => {
    const next = !showMainTokens;
    setShowMainTokens(next);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("miu_show_main_page_tokens", next ? "true" : "false");
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("mainPageTokensVisibilityChanged", { detail: { show: next } }));
    }
  };

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
      title: "人设与基础设定",
      tokens: breakdown.description + breakdown.personality,
      chars: breakdown.descriptionChars + breakdown.personalityChars,
      color: "bg-blue-500",
      desc: "包含角色的外貌背景、性格语气、行为机制等常驻人设信息",
      icon: Sparkles,
    },
    {
      title: breakdown.alternateGreetingsCount > 0
        ? `开场白统计 (${breakdown.alternateGreetingsCount + 1} 条)`
        : "开场白统计",
      tokens: breakdown.firstMessage + breakdown.alternateGreetings,
      chars: breakdown.firstMessageChars + (breakdown.alternateGreetingsChars || 0),
      color: "bg-amber-500",
      desc: breakdown.alternateGreetingsCount > 0
        ? `首条开场白 (${breakdown.firstMessage} T) + ${breakdown.alternateGreetingsCount} 条备用问候语 (${breakdown.alternateGreetings} T)`
        : "开启对话时角色的初始开场问候消息",
      icon: MessageSquare,
    },
    {
      title: breakdown.worldbookEntriesCount > 0
        ? `嵌入世界书 (${breakdown.worldbookEntriesCount} 个条目)`
        : "嵌入世界书",
      tokens: breakdown.worldbook,
      chars: breakdown.worldbookChars || 0,
      color: "bg-indigo-500",
      desc: "卡片内置词条集，命中关键词时按需动态激活插入",
      icon: BookOpen,
    },
    {
      title: "对话场景 (Scenario)",
      tokens: breakdown.scenario,
      chars: breakdown.scenarioChars,
      color: "bg-emerald-500",
      desc: "初始环境背景或开局特定场景设定",
      icon: Layers,
    },
    {
      title: "示例对话 (Examples)",
      tokens: breakdown.mesExample,
      chars: breakdown.mesExampleChars,
      color: "bg-cyan-500",
      desc: "示范语气及交互规范的对话样例",
      icon: FileText,
    },
    {
      title: "系统指令 (System Prompt)",
      tokens: breakdown.systemPrompt + breakdown.postHistoryInstructions,
      chars: breakdown.systemPromptChars,
      color: "bg-rose-500",
      desc: "卡片内置的系统提示词或深度指导指令",
      icon: Layers,
    },
  ].filter((sec) => sec.tokens > 0 || sec.chars > 0);

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
          {/* Header - 包含标题与主页字符显隐控制按键 */}
          <div className={`flex items-center justify-between gap-3 px-6 py-4.5 border-b shrink-0 transition-colors ${
            isLightMode ? "border-[#e2ecf9]" : "border-white/10"
          }`}>
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-base sm:text-lg truncate detail-card-text">
                Token 占用分析
              </h3>
              <p className="text-xs truncate mt-0.5 detail-card-text-muted">
                {charName}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={toggleShowMainTokens}
                className={`px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 cursor-pointer border ${
                  showMainTokens
                    ? "bg-[#007aff]/10 border-[#007aff]/30 text-[#007aff] [.light-theme_&]:!bg-[#007aff]/10 [.light-theme_&]:!border-[#007aff]/30 [.light-theme_&]:!text-[#007aff] shadow-2xs"
                    : "bg-white/10 border-white/15 text-white/60 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!text-slate-500"
                }`}
                title={showMainTokens ? "主页角色卡正在显示字符/Token (点击隐藏)" : "主页角色卡已隐藏字符/Token (点击显示)"}
              >
                {showMainTokens ? (
                  <Eye className="w-3.5 h-3.5 shrink-0 text-[#007aff] stroke-[2.2]" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 shrink-0 text-white/50 [.light-theme_&]:!text-slate-400" />
                )}
                <span className="text-[11px] sm:text-xs font-medium">
                  {showMainTokens ? "主页字符: 显示" : "主页字符: 隐藏"}
                </span>
              </button>

              <button
                onClick={onClose}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition cursor-pointer bg-white/10 hover:bg-white/20 text-white/90 hover:text-white border border-white/10 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:active:!bg-[#cbd5e1] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:!shadow-2xs"
                title="关闭"
              >
                <X className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5 custom-scrollbar">
            {/* Top Stat Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <div className="detail-card p-3.5 rounded-2xl transition-colors">
                <div className="text-[11px] font-medium mb-1 detail-card-text-muted">
                  人设与设定
                </div>
                <div className="text-xl font-bold font-mono detail-card-text">
                  {formatTokenCount(breakdown.description + breakdown.personality)}
                </div>
                <div className="text-[10px] mt-0.5 detail-card-text-muted">
                  描述与性格特质
                </div>
              </div>

              <div className="detail-card p-3.5 rounded-2xl transition-colors">
                <div className="text-[11px] font-medium mb-1 detail-card-text-muted">
                  开场白统计
                </div>
                <div className="text-xl font-bold font-mono detail-card-text">
                  {formatTokenCount(breakdown.firstMessage + breakdown.alternateGreetings)}
                </div>
                <div className="text-[10px] mt-0.5 detail-card-text-muted">
                  {breakdown.alternateGreetingsCount > 0
                    ? `含 ${breakdown.alternateGreetingsCount + 1} 条问候语`
                    : "初始问候消息"}
                </div>
              </div>

              <div className="col-span-2 sm:col-span-1 detail-card p-3.5 rounded-2xl transition-colors">
                <div className="text-[11px] font-medium mb-1 detail-card-text-muted">
                  字符总数
                </div>
                <div className="text-xl font-bold font-mono detail-card-text">
                  {breakdown.totalCharCount.toLocaleString()} <span className="text-xs font-normal">字符</span>
                </div>
                <div className="text-[10px] mt-0.5 detail-card-text-muted">
                  共计 {formatTokenCount(breakdown.totalTokens)} Tokens
                </div>
              </div>
            </div>

            {/* Visual Token Distribution Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-medium detail-card-text-muted">
                <span>字段空间占用比率</span>
                <span className="font-mono text-[11px] font-bold text-slate-700 dark:text-slate-200">
                  {breakdown.totalTokens.toLocaleString()} Tokens
                </span>
              </div>
              <div className="w-full h-3 rounded-full overflow-hidden flex p-0.5 gap-1 bg-slate-100/90 border border-slate-200/80 dark:bg-slate-800/80 dark:border-white/10 shadow-inner">
                {sections.map((s, idx) => {
                  const pct = getPercent(s.tokens);
                  if (pct <= 0) return null;
                  return (
                    <div
                      key={idx}
                      style={{ width: `${Math.max(2, pct)}%` }}
                      className={`h-full rounded-full ${s.color} transition-all duration-300 shadow-2xs`}
                      title={`${s.title}: ${s.tokens.toLocaleString()} T (${pct}%)`}
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
                              ? "bg-stone-100 border-stone-200 text-stone-800"
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
              className={`px-6 py-2.5 rounded-2xl text-xs sm:text-sm font-bold transition active:scale-95 cursor-pointer shadow-sm ${
                isLightMode
                  ? "bg-[#007aff] hover:bg-[#0062cc] text-white"
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
