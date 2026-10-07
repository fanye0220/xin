import { getFallbackAvatar } from "../lib/avatar";
import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  getChatsForCharacter,
  deleteChat,
  saveChat,
  saveChatsBulk,
  ChatLog,
  getChatById,
  getCharacterBlob,
} from "../lib/db";
import { isAndroid } from "../lib/appBridge";
import {
  MessageSquare,
  Trash2,
  Calendar,
  FileJson,
  UploadCloud,
  Edit2,
  Plus,
  ArrowLeft,
  GitBranch,
  BookOpen,
  Sliders,
  Type,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageContent } from "./MessageContent";
import { ChatCleanerModal } from "./ChatCleanerModal";
import { Virtuoso } from "react-virtuoso";
import { useBubbleTheme, ColorSphere } from "../lib/bubbleThemes";

interface Props {
  characterId: string;
  characterName: string;
  regexScripts: any[];
  avatar?: string;
  onOpenChat?: (chatId: string) => void;
  onOpenImport?: (files?: FileList | File[]) => void;
  refreshKey?: number;
  isLightMode?: boolean;
}

export function CharacterChatsSection({
  characterId,
  characterName,
  regexScripts,
  avatar,
  onOpenChat,
  onOpenImport,
  refreshKey,
  isLightMode = false,
}: Props) {
  const { themeId: bubbleThemeId, theme: bubbleTheme, setTheme: setBubbleTheme, allThemes: bubbleThemes } = useBubbleTheme();
  const [showBubblePicker, setShowBubblePicker] = useState(false);
  const [chats, setChats] = useState<any[]>([]);
  const [selectedChat, setSelectedChat] = useState<ChatLog | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const readerFileInputRef = useRef<HTMLInputElement>(null);
  const [editingNoteFor, setEditingNoteFor] = useState<string | null>(null);
  const [editNoteContent, setEditNoteContent] = useState("");
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [visibleCount, setVisibleCount] = useState(30);
  const observerTarget = useRef<HTMLDivElement>(null);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [readingMode, setReadingMode] = useState<'novel' | 'bubble'>(() => {
    return (localStorage.getItem('chat_reader_mode') as 'novel' | 'bubble') || 'novel';
  });
  const [novelFontSize, setNovelFontSize] = useState<number>(() => {
    return parseInt(localStorage.getItem('chat_reader_font_size') || '15', 10);
  });
  const [readingProgress, setReadingProgress] = useState(0);
  const readerScrollRef = useRef<HTMLDivElement>(null);
  const [enabledRegexIds, setEnabledRegexIds] = useState<Set<number>>(() => {
    const initial = new Set<number>();
    if (Array.isArray(regexScripts)) {
      regexScripts.forEach((s, idx) => {
        if (!s.disabled) initial.add(idx);
      });
    }
    return initial;
  });

  const [importProgress, setImportProgress] = useState<{
    show: boolean;
    current: number;
    total: number;
    message: string;
  }>({ show: false, current: 0, total: 0, message: "" });

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + 30, chats.length));
        }
      },
      { rootMargin: "400px" },
    );
    if (observerTarget.current) observer.observe(observerTarget.current);
    return () => observer.disconnect();
  }, [chats.length]);

  const loadChats = async () => {
    const { getChatsMetadataForCharacter } = await import("../lib/db");
    const list = await getChatsMetadataForCharacter(characterId, characterName);
    setChats(list.sort((a, b) => b.createdAt - a.createdAt));
  };

  useEffect(() => {
    loadChats();
    const savedTags = localStorage.getItem("chatViewer_customTags");
    if (savedTags) {
      try {
        setCustomTags(JSON.parse(savedTags));
      } catch (e) {}
    }
    const savedAvatar = localStorage.getItem("chatViewer_userAvatar");
    if (savedAvatar) {
      setUserAvatar(savedAvatar);
    }
  }, [characterId]);

  useEffect(() => {
    if (refreshKey !== undefined) {
      loadChats();
    }
  }, [refreshKey]);

  useEffect(() => {
    localStorage.setItem('chat_reader_mode', readingMode);
  }, [readingMode]);

  useEffect(() => {
    localStorage.setItem('chat_reader_font_size', novelFontSize.toString());
  }, [novelFontSize]);

  const formatCustomTags = (text: string) => {
    if (!text) return "";
    let result = text;
    const thinkRegex =
      /(?:<|&lt;|\[+|\\\[+|\{+)\s*(?:think|thought|thinking)\s*(?:>|&gt;|\]+|\\\]+|\}+)([\s\S]*?)(?:<|&lt;|\[+|\\\[+|\{+)\/\s*(?:think|thought|thinking)\s*(?:>|&gt;|\]+|\\\]+|\}+)/gi;
    result = result.replace(
      thinkRegex,
      '<details class="text-sm bg-[rgba(255,255,255,0.05)] [.light-theme_&]:bg-black/5 border border-[rgba(255,255,255,0.1)] [.light-theme_&]:border-black/10 rounded-lg p-2 my-2 w-full max-w-full overflow-hidden"><summary class="cursor-pointer font-bold text-[#8491CD] hover:opacity-80 transition-opacity select-none">🤔 思维链</summary><div class="mt-2 text-[#707CB1] break-words whitespace-pre-wrap max-w-full overflow-x-auto">$1</div></details>',
    );

    const processedTags = new Set(
      customTags
        .map((t) =>
          t
            .replace(/^<*\/?|\/?>*$/g, "")
            .replace(/^\[*\/?|\/?\]*$/g, "")
            .replace(/^\{*\/?|\/?\}*$/g, "")
            .trim(),
        )
        .filter(Boolean),
    );

    processedTags.forEach((tag) => {
      const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pairedRe = new RegExp(
        `(?:<|&lt;|\\[|\\{)\\s*${escapedTag}(?:\\s+(?:[^>&\\]\\}]+))?(?:>|&gt;|\\]|\\})([\\s\\S]*?)(?:<|&lt;|\\[|\\{)\\/\\s*${escapedTag}\\s*(?:>|&gt;|\\]|\\})`,
        "gi",
      );
      result = result.replace(
        pairedRe,
        `<details class="text-sm bg-[rgba(255,255,255,0.05)] [.light-theme_&]:bg-black/5 border border-[rgba(255,255,255,0.1)] [.light-theme_&]:border-black/10 rounded-lg p-2 my-2 w-full max-w-full overflow-hidden"><summary class="cursor-pointer font-bold text-[#8491CD] select-none">${tag}</summary><div class="mt-2 text-[#707CB1] whitespace-pre-wrap break-words max-w-full overflow-x-auto">$1</div></details>`,
      );
      const singleRe = new RegExp(
        `(?:<|&lt;|\\[|\\{)\\s*${escapedTag}(?:\\s+(?:[^>&\\]\\}]+))?\\/?\\s*(?:>|&gt;|\\]|\\})`,
        "gi",
      );
      result = result.replace(
        singleRe,
        `<div class="text-sm border-l-2 border-[#8491CD]/50 pl-3 py-1 my-2 text-[#8491CD] italic text-xs"><span class="font-bold">&lt;${tag}&gt;</span></div>`,
      );
      const singleCloseRe = new RegExp(
        `(?:<|&lt;|\\[|\\{)\\/\\s*${escapedTag}\\s*(?:>|&gt;|\\]|\\})`,
        "gi",
      );
      result = result.replace(
        singleCloseRe,
        `<div class="text-sm border-l-2 border-[#8491CD]/50 pl-3 py-1 my-2 text-[#8491CD] italic text-xs"><span class="font-bold">&lt;/${tag}&gt;</span></div>`,
      );
    });

    return result;
  };

  const handleSaveNote = async (chatMeta: any) => {
    const fullChat = await getChatById(chatMeta.id);
    if (fullChat) {
      await saveChat({ ...fullChat, note: editNoteContent });
    }
    setEditingNoteFor(null);
    loadChats();
  };

  const handleChatClick = async (chatMeta: any) => {
    if (onOpenChat) {
      onOpenChat(chatMeta.id);
    } else {
      const chat = await getChatById(chatMeta.id);
      setSelectedChat(chat || null);
    }
  };

  const [deleteChatId, setDeleteChatId] = useState<string | null>(null);

  const confirmDeleteChat = async () => {
    if (!deleteChatId) return;
    const idToDelete = deleteChatId;
    setDeleteChatId(null);
    setChats((prev) => prev.filter((c) => c.id !== idToDelete));
    if (selectedChat?.id === idToDelete) {
      const remaining = chats.filter((c) => c.id !== idToDelete);
      if (remaining.length > 0) {
        const nextChat = await getChatById(remaining[0].id);
        setSelectedChat(nextChat || null);
      } else {
        setSelectedChat(null);
      }
    }
    await deleteChat(idToDelete);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteChatId(id);
  };

  const handleFileUpload = async (files: FileList | File[]) => {
    let imported = 0;
    const pendingChats: ChatLog[] = [];

    setImportProgress({
      show: true,
      current: 0,
      total: 1,
      message: "正在分析文件...",
    });

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        if (file.name.toLowerCase().endsWith(".zip")) {
          const { default: JSZip } = await import("jszip");
          const zip = new JSZip();
          const loadedZip = await zip.loadAsync(file, {
            decodeFileName: function (bytes: any) {
              try {
                return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
              } catch (e) {
                return new TextDecoder("gbk").decode(new Uint8Array(bytes));
              }
            }
          });

          const filesToProcess = [];
          for (const relativePath in loadedZip.files) {
            const zipEntry = loadedZip.files[relativePath];
            if (zipEntry.dir) continue;

            const lowerName = zipEntry.name.toLowerCase();
            if (lowerName.endsWith(".json") || lowerName.endsWith(".jsonl") || lowerName.endsWith(".txt")) {
              filesToProcess.push(zipEntry);
            }
          }

          setImportProgress({
            show: true,
            current: 0,
            total: filesToProcess.length,
            message: `正在解析压缩包 ${file.name}...`,
          });

          for (let j = 0; j < filesToProcess.length; j++) {
            const zipEntry = filesToProcess[j];
            const lowerName = zipEntry.name.toLowerCase();

            if (j % 10 === 0) {
              setImportProgress({
                show: true,
                current: j + 1,
                total: filesToProcess.length,
                message: `正在解析: ${zipEntry.name.split("/").pop()}`,
              });
              await new Promise((r) => setTimeout(r, 0));
            }

            const text = await zipEntry.async("text");
            let messages: any[] = [];

            if (lowerName.endsWith(".jsonl")) {
              const { parseJsonlChat } = await import("../lib/chatParse");
              messages = parseJsonlChat(text);
            } else if (lowerName.endsWith(".txt")) {
              const { parseTextChatLog } = await import("../lib/chatParse");
              const entryChatName = (zipEntry.name.split("/").pop() || zipEntry.name).replace(/\.[^/.]+$/, "");
              messages = parseTextChatLog(text, entryChatName).messages;
            } else {
              try {
                const j = JSON.parse(text);
                messages = Array.isArray(j) ? j : j.messages || j.chat || [];
              } catch (e) {}
            }

            const { sanitizeChatMessages } = await import("../lib/chatParse");
            const sanitized = sanitizeChatMessages(messages);
            if (sanitized.isChat && sanitized.messages.length > 0) {
              // 压缩包内先按所在文件夹名找角色（跳过「聊天记录」这一层），再按聊天里的角色名找，最后才落到当前角色
              let targetCharacterId = characterId;
              try {
                const pathParts = zipEntry.name.split("/");
                let nameIndex = pathParts.length > 1 ? pathParts.length - 2 : -1;
                if (nameIndex >= 0 && pathParts[nameIndex] === "聊天记录" && pathParts.length > 2) {
                  nameIndex = pathParts.length - 3;
                }
                const folderName = nameIndex >= 0 ? pathParts[nameIndex] : "";
                if (folderName) {
                  const { initDB } = await import("../lib/db");
                  const db = await initDB();
                  const allChars: any[] = await db.getAll("characters");
                  const folderMatch = allChars.find(
                    (c: any) => c.name && c.name.toLowerCase() === folderName.toLowerCase(),
                  );
                  if (folderMatch) targetCharacterId = folderMatch.id;
                  if (targetCharacterId === characterId) {
                    const aiMessage = sanitized.messages.find((m: any) => !m.is_user && m.name);
                    if (aiMessage && aiMessage.name) {
                      const nameMatch = allChars.find(
                        (c: any) => c.name && c.name.toLowerCase() === String(aiMessage.name).toLowerCase(),
                      );
                      if (nameMatch) targetCharacterId = nameMatch.id;
                    }
                  }
                }
              } catch (e) {}

              const newChat: ChatLog = {
                id: `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                characterId: targetCharacterId,
                name: zipEntry.name.split("/").pop()?.replace(/\.[^/.]+$/, "") || "导入的记录",
                messages: sanitized.messages,
                createdAt: Date.now(),
                messageCount: sanitized.messages.length,
              };
              pendingChats.push(newChat);
              imported++;
            }
          }
        } else {
          const text = await file.text();
          let messages: any[] = [];
          const lowerName = file.name.toLowerCase();

          if (lowerName.endsWith(".jsonl")) {
            const { parseJsonlChat } = await import("../lib/chatParse");
            messages = parseJsonlChat(text);
          } else if (lowerName.endsWith(".txt")) {
            const { parseTextChatLog } = await import("../lib/chatParse");
            const fileChatName = file.name.replace(/\.[^/.]+$/, "");
            messages = parseTextChatLog(text, fileChatName).messages;
          } else {
            try {
              const j = JSON.parse(text);
              messages = Array.isArray(j) ? j : j.messages || j.chat || [];
            } catch (e) {}
          }

          const { sanitizeChatMessages } = await import("../lib/chatParse");
          const sanitized = sanitizeChatMessages(messages);
          if (sanitized.isChat && sanitized.messages.length > 0) {
            const newChat: ChatLog = {
              id: `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              characterId,
              name: file.name.replace(/\.[^/.]+$/, "") || "导入的记录",
              messages: sanitized.messages,
              createdAt: Date.now(),
              messageCount: sanitized.messages.length,
            };
            pendingChats.push(newChat);
            imported++;
          }
        }
      } catch (e) {
        console.error("Error processing file", file.name, e);
      }
    }

    if (pendingChats.length > 0) {
      await saveChatsBulk(pendingChats, (processed, total, phase) => {
        setImportProgress((prev) => ({
          ...prev,
          current: processed,
          total,
          message: phase,
        }));
      });
    }

    if (imported > 0) {
      await loadChats();
      if (pendingChats.length > 0 && selectedChat) {
        // switch to latest imported chat
        setSelectedChat(pendingChats[pendingChats.length - 1]);
      }
    }

    setTimeout(() => {
      setImportProgress({ show: false, current: 0, total: 0, message: "" });
    }, 500);
  };

  const applyRegexes = (text: string, place: 1 | 2 = 2) => {
    let result = text || "";
    if (!result) return "";
    if (regexScripts && Array.isArray(regexScripts)) {
      regexScripts.forEach((script, idx) => {
        if (!enabledRegexIds.has(idx)) return;
        if (script.promptOnly) return;
        if (Array.isArray(script.placement) && script.placement.length > 0 && !script.placement.includes(place)) return;

        try {
          let pattern = script.regex || script.findRegex || "";
          let flags = "g";
          if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
            const lastSlash = pattern.lastIndexOf("/");
            flags = pattern.substring(lastSlash + 1);
            if (!flags.includes("g")) flags += "g";
            pattern = pattern.substring(1, lastSlash);
          }

          pattern = pattern
            .replace(/{{char}}/gi, characterName)
            .replace(/<BOT>|<CHAR>/gi, characterName)
            .replace(/{{user}}/gi, "User")
            .replace(/<USER>/gi, "User");

          let rawReplace =
            script.replacementString !== undefined
              ? script.replacementString
              : script.replaceString || "";
          let replaceStr = rawReplace
            .replace(/{{char}}/gi, characterName)
            .replace(/<BOT>|<CHAR>/gi, characterName)
            .replace(/{{user}}/gi, "User")
            .replace(/<USER>/gi, "User");

          const re = new RegExp(pattern, flags);
          result = result.replace(re, replaceStr);
        } catch (e) {}
      });
    }
    return result;
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const max = el.scrollHeight - el.clientHeight;
    if (max > 0) {
      setReadingProgress(Math.min(100, Math.max(0, (el.scrollTop / max) * 100)));
    } else {
      setReadingProgress(0);
    }
  };

  const toggleRegex = (idx: number) => {
    setEnabledRegexIds((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  const [isCleanerOpen, setIsCleanerOpen] = useState(false);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        className="space-y-6 relative"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-col flex-1 min-w-0">
            <h3 className="text-xl font-bold text-white/90 [.light-theme_&]:!text-[#0f172a]">
              <span className="truncate">
                聊天记录{" "}
                <span className="text-white/50 [.light-theme_&]:!text-[#64748b] text-base font-normal">
                  ({chats.length})
                </span>
              </span>
            </h3>
            <AnimatePresence>
              {importProgress.show && (
                <motion.div
                  initial={{ opacity: 0, y: -20, x: "-50%" }}
                  animate={{ opacity: 1, y: 0, x: "-50%" }}
                  exit={{ opacity: 0, y: -20, x: "-50%" }}
                  className={`fixed top-5 left-1/2 z-[100] backdrop-blur-xl border rounded-full px-4 py-2 sm:px-4.5 sm:py-2 flex items-center gap-2.5 max-w-[92vw] w-auto pointer-events-auto overflow-hidden select-none ${
                    isLightMode
                      ? 'bg-slate-800/95 border-blue-100 shadow-[0_8px_30px_rgba(0,0,0,0.08)]'
                      : 'bg-slate-900/90 border-white/15 shadow-[0_8px_30px_rgba(0,0,0,0.25)]'
                  }`}
                >
                  <UploadCloud className={`w-4 h-4 animate-bounce shrink-0 ${isLightMode ? 'text-blue-500' : 'text-blue-400'}`} />
                  <span className={`text-xs sm:text-sm font-medium whitespace-nowrap ${isLightMode ? 'text-slate-800' : 'text-slate-100'}`}>
                    {importProgress.message || "正在导入记录"}
                  </span>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                    isLightMode ? 'text-blue-600 bg-blue-50' : 'text-blue-300 bg-blue-500/20'
                  }`}>
                    {importProgress.total > 0 ? Math.round((importProgress.current / importProgress.total) * 100) : 0}%
                  </span>
                  <div className={`absolute bottom-0 left-0 right-0 h-[2.5px] overflow-hidden ${isLightMode ? 'bg-slate-200' : 'bg-black/30'}`}>
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 [.light-theme_&]:!from-blue-600 [.light-theme_&]:!to-indigo-600 transition-all duration-300"
                      style={{
                        width: `${importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="grid grid-cols-2 sm:flex sm:items-center sm:gap-2 w-full sm:w-auto gap-1.5 mt-2 sm:mt-0">
            <button
              onClick={() => {
                if (onOpenImport) {
                  onOpenImport();
                } else {
                  fileInputRef.current?.click();
                }
              }}
              className="soft-pill px-2.5 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-medium flex items-center justify-center gap-1 sm:gap-1.5 transition active:scale-95 cursor-pointer shadow-xs whitespace-nowrap"
              title="导入聊天记录"
            >
              <UploadCloud className="w-3.5 h-3.5 sm:w-4 sm:h-4 opacity-70 shrink-0" />
              <span>导入记录</span>
            </button>
            <button
              onClick={() => setIsCleanerOpen(true)}
              className="soft-pill px-2.5 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-medium flex items-center justify-center gap-1 sm:gap-1.5 transition active:scale-95 cursor-pointer shadow-xs hover:!text-red-400 whitespace-nowrap"
              title="清理记录和分支"
            >
              <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 opacity-70 shrink-0" />
              <span>清理记录</span>
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".json,.jsonl,.txt,.zip"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) {
                if (onOpenImport) {
                  onOpenImport(e.target.files);
                } else {
                  handleFileUpload(e.target.files);
                }
              }
            }}
          />
        </div>

        {chats.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 rounded-2xl bg-white/5 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!shadow-xs text-white/40 [.light-theme_&]:!text-[#64748b]">
            <FileJson className="w-12 h-12 mb-3 opacity-50 text-white/40 [.light-theme_&]:!text-[#64748b]" />
            <p className="text-sm font-medium text-white/70 [.light-theme_&]:!text-[#0f172a]">当前角色未包含聊天记录</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {chats.slice(0, visibleCount).map((chat) => (
                <div
                  key={chat.id}
                  onClick={() => handleChatClick(chat)}
                  className="group cursor-pointer bg-white/[0.06] hover:bg-white/[0.09] rounded-2xl p-4 transition-all shadow-md hover:shadow-xl relative h-full flex flex-col [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:hover:!bg-[#ffffff] [.light-theme_&]:!shadow-sm"
                >
                  <div className="flex justify-between items-start mb-2 gap-3">
                    <div className="flex-1 min-w-0 pt-0.5">
                      {editingNoteFor === chat.id ? (
                        <div
                          className="w-full"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            autoFocus
                            className="w-full bg-black/40 border border-blue-500/50 rounded flex px-2 py-1 text-sm text-blue-400 [.light-theme_&]:!text-[#007aff] [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:!border-blue-400 focus:outline-none placeholder-blue-300/30 [.light-theme_&]:placeholder-[#007aff]/40"
                            value={editNoteContent}
                            onChange={(e) => setEditNoteContent(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveNote(chat);
                            }}
                            onBlur={() => handleSaveNote(chat)}
                            placeholder="添加内容备注..."
                          />
                        </div>
                      ) : (
                        <div
                          className="text-sm font-semibold text-blue-400 [.light-theme_&]:!text-[#007aff] cursor-pointer hover:text-blue-300 [.light-theme_&]:hover:!text-blue-700 transition flex items-center gap-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingNoteFor(chat.id);
                            setEditNoteContent(chat.note || "");
                          }}
                          title="点击编辑备注"
                        >
                          {chat.note ? (
                            <>
                              <span className="truncate">{chat.note}</span>
                              <span className="text-xs text-blue-400/70 [.light-theme_&]:!text-[#007aff]/70 shrink-0 flex items-center gap-1 leading-none pt-0.5">
                                <Edit2 className="w-3 h-3 stroke-[2]" />
                              </span>
                            </>
                          ) : (
                            <span className="text-blue-400/80 [.light-theme_&]:!text-[#007aff] flex items-center gap-1 font-medium">
                              <Plus className="w-3.5 h-3.5 stroke-[2.5]" /> 添加内容备注...
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={(e) => handleDelete(chat.id, e)}
                      className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <h4
                    className="font-medium text-white [.light-theme_&]:!text-[#0f172a] mb-2 truncate text-sm flex-1"
                    title={chat.name}
                  >
                    {chat.name}
                  </h4>
                  <div className="flex justify-between items-center text-xs text-white/40 [.light-theme_&]:!text-slate-500 mt-auto">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(chat.createdAt).toLocaleDateString()}
                    </span>
                    <span>{chat.messageCount} 条消息</span>
                  </div>
                </div>
              ))}
            </div>
            {visibleCount < chats.length && (
              <div ref={observerTarget} className="h-10 w-full" />
            )}
          </>
        )}
      </motion.div>

      {/* Novel & Bubble Chat Viewer Modal */}
      <AnimatePresence>
        {selectedChat && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 20 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className="fixed inset-0 z-[120] bg-slate-950/85 backdrop-blur-md flex flex-col p-2 pt-[max(1.75rem,env(safe-area-inset-top))] sm:p-5 sm:pt-[max(1.75rem,env(safe-area-inset-top))] [.light-theme_&]:bg-black/30"
          >
            <div className="max-w-4xl mx-auto w-full flex flex-col h-full bg-slate-900/90 backdrop-blur-2xl rounded-3xl border border-white/10 overflow-hidden shadow-2xl ring-1 ring-white/5 [.light-theme_&]:bg-white/95 [.light-theme_&]:border-black/10 [.light-theme_&]:shadow-[0_8px_40px_rgba(0,0,0,0.12)]">
              {/* Reader Header */}
              <div className="px-4 py-3 sm:px-5 sm:py-3.5 border-b border-white/10 flex justify-between items-center shrink-0 bg-white/[0.02]">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                  <button
                    onClick={() => setSelectedChat(null)}
                    className="flex items-center justify-center w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition shrink-0"
                    title="返回列表"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <h3
                    className="text-sm sm:text-base font-semibold text-white truncate flex items-center gap-2"
                    title={selectedChat.name}
                  >
                    <span>{selectedChat.name}</span>
                    <span className="text-xs text-blue-400/80 font-normal px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20">
                      {selectedChat.messages?.length || 0} 幕
                    </span>
                  </h3>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  {/* Mode Toggle: Novel vs Bubble */}
                  <div className="flex items-center bg-white/5 border border-white/10 rounded-full p-0.5">
                    <button
                      onClick={() => setReadingMode('novel')}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition ${
                        readingMode === 'novel'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-white/60 hover:text-white'
                      }`}
                      title="小说沉浸排版"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">小说模式</span>
                    </button>
                    <button
                      onClick={() => setReadingMode('bubble')}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition ${
                        readingMode === 'bubble'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-white/60 hover:text-white'
                      }`}
                      title="气泡对话模式"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">气泡模式</span>
                    </button>
                  </div>

                  {/* Font Size Adjuster in Novel Mode */}
                  {readingMode === 'novel' && (
                    <div className="hidden sm:flex items-center bg-white/5 border border-white/10 rounded-full px-1 py-0.5">
                      <button
                        onClick={() => setNovelFontSize((prev) => Math.max(13, prev - 1))}
                        className="px-1.5 py-0.5 text-xs text-white/60 hover:text-white transition font-mono"
                        title="缩小字号"
                      >
                        A-
                      </button>
                      <span className="text-[11px] text-blue-300 font-mono px-1">{novelFontSize}</span>
                      <button
                        onClick={() => setNovelFontSize((prev) => Math.min(22, prev + 1))}
                        className="px-1.5 py-0.5 text-xs text-white/60 hover:text-white transition font-mono"
                        title="放大字号"
                      >
                        A+
                      </button>
                    </div>
                  )}

                  {/* Bubble ColorSphere in Bubble Mode */}
                  {readingMode === 'bubble' && (
                    <div className="relative">
                      <button
                        onClick={() => setShowBubblePicker(!showBubblePicker)}
                        className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition active:scale-95"
                        title={`气泡色彩球：${bubbleTheme.name}（点击切换）`}
                      >
                        <ColorSphere
                          botColor={bubbleTheme.botColor}
                          userColor={bubbleTheme.userColor}
                          size={20}
                        />
                      </button>

                      <AnimatePresence>
                        {showBubblePicker && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 10, transformOrigin: "top right" }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 10 }}
                            className="bubble-picker-popover absolute top-full right-0 mt-2 backdrop-blur-2xl rounded-2xl shadow-2xl w-60 p-3 z-50 overflow-hidden"
                          >
                            <div className="bubble-picker-divider flex items-center justify-between pb-2 mb-2 border-b">
                              <span className="bubble-picker-title text-xs font-bold flex items-center gap-2">
                                <ColorSphere botColor={bubbleTheme.botColor} userColor={bubbleTheme.userColor} size={16} />
                                切换气泡色彩球
                              </span>
                            </div>
                            <div className="flex flex-col gap-1 max-h-60 overflow-y-auto pr-0.5">
                              {bubbleThemes.map((t) => {
                                const isSelected = bubbleThemeId === t.id;
                                return (
                                  <button
                                    key={t.id}
                                    onClick={() => {
                                      setBubbleTheme(t.id);
                                      setShowBubblePicker(false);
                                    }}
                                    className={`bubble-picker-item w-full flex items-center gap-2.5 p-2 rounded-xl text-left transition ${
                                      isSelected ? 'is-selected font-semibold' : ''
                                    }`}
                                  >
                                    <ColorSphere botColor={t.botColor} userColor={t.userColor} size={24} />
                                    <div className="flex-1 truncate">
                                      <div className="text-xs font-bold">{t.name}</div>
                                      <div className="bubble-picker-item-badge text-[10px] truncate">{t.badge}</div>
                                    </div>
                                    {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />}
                                  </button>
                                );
                              })}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {/* Import Timeline Shortcut */}
                  <label
                    className="p-1.5 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-lg transition cursor-pointer flex items-center gap-1 text-xs"
                    title="导入时间线分支"
                  >
                    <UploadCloud className="w-4 h-4 text-blue-400" />
                    <span className="hidden md:inline">导入时间线</span>
                    <input
                      ref={readerFileInputRef}
                      type="file"
                      multiple
                      accept=".json,.jsonl,.txt,.zip"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.length) {
                          handleFileUpload(e.target.files);
                        }
                      }}
                    />
                  </label>

                  <button
                    onClick={(e) => handleDelete(selectedChat.id, e)}
                    className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition shrink-0"
                    title="删除此记录"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Timeline Tabs Bar (Lovespace Style) */}
              {chats.length > 1 && (
                <div className="tl-tabs-wrap">
                  {chats.map((c) => {
                    const isActive = c.id === selectedChat.id;
                    return (
                      <button
                        key={c.id}
                        onClick={async () => {
                          if (c.id !== selectedChat.id) {
                            const target = await getChatById(c.id);
                            if (target) setSelectedChat(target);
                          }
                        }}
                        className={`tl-tab ${isActive ? "active" : ""}`}
                        title={c.name}
                      >
                        <GitBranch className="w-3 h-3" />
                        <span className="max-w-[120px] truncate">{c.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Regex Switcher Bar (Lovespace Style) */}
              {regexScripts && regexScripts.length > 0 && (
                <div className="regex-bar">
                  <span className="text-[11px] font-semibold text-white/60 [.light-theme_&]:!text-slate-700 uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1.5 select-none">
                    <Sparkles className="w-3.5 h-3.5 text-blue-400 [.light-theme_&]:!text-blue-600" />
                    正则
                  </span>
                  {regexScripts.map((s, idx) => {
                    const isEnabled = enabledRegexIds.has(idx);
                    const name = s.scriptName || s.name || `正则 ${idx + 1}`;
                    return (
                      <button
                        key={idx}
                        onClick={() => toggleRegex(idx)}
                        className={`regex-chip ${isEnabled ? "on" : ""}`}
                        title={`点击${isEnabled ? "禁用" : "启用"}此正则`}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Reader Content Area */}
              <div 
                ref={readerScrollRef}
                onScroll={handleScroll}
                className="flex-[1_1_100%] min-h-0 overflow-y-auto custom-scrollbar relative"
              >
                {readingMode === 'novel' ? (
                  /* Novel Literary Flow Layout */
                  <div className="novel-wrap" style={{ fontSize: `${novelFontSize}px` }}>
                    {selectedChat.messages?.map((msg: any, idx: number) => {
                      const isUser = !!msg.is_user;
                      const showNameDrop =
                        !isUser &&
                        (idx === 0 ||
                          (idx > 0 && selectedChat.messages[idx - 1]?.is_user));

                      const rawText = msg.mes || msg.message || msg.content || "";
                      const formattedText = formatCustomTags(applyRegexes(rawText, isUser ? 1 : 2));

                      if (isUser) {
                        return (
                          <div key={idx} className="msg-block">
                            <div className="msg-user-wrap">
                              <span className="msg-user-label">{msg.name || "You"}</span>
                              <div className="msg-user-text">
                                <MessageContent
                                  content={formattedText}
                                  characterName={characterName}
                                  themeMode={isLightMode ? 'light' : 'dark'}
                                />
                              </div>
                            </div>
                            <div className="msg-divider">·</div>
                          </div>
                        );
                      }

                      return (
                        <div key={idx} className="msg-block">
                          {showNameDrop && (
                            <div className="char-name-drop">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                              {msg.name || characterName}
                            </div>
                          )}
                          <div className="msg-char text-white/90 [.light-theme_&]:!text-[#0f172a]">
                            <MessageContent
                              content={formattedText}
                              characterName={characterName}
                              themeMode={isLightMode ? 'light' : 'dark'}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Bubble IM Layout */
                  <Virtuoso
                    style={{ height: "100%" }}
                    data={selectedChat.messages}
                    initialTopMostItemIndex={
                      selectedChat.messages ? selectedChat.messages.length - 1 : 0
                    }
                    itemContent={(i, msg) => {
                      const dateString = msg.send_date
                        ? new Date(msg.send_date).toLocaleString()
                        : "";
                      const formattedText = formatCustomTags(
                        applyRegexes(msg.mes || msg.message || msg.content || "", msg.is_user ? 1 : 2)
                      );
                      return (
                        <div
                          className={`flex gap-4 pb-6 mt-4 ${msg.is_user ? "flex-row-reverse" : ""} overflow-hidden w-full min-w-0 px-4 sm:px-6`}
                        >
                          <div className="shrink-0 pt-1">
                            {msg.is_user ? (
                              userAvatar ? (
                                <div className="w-10 h-10 rounded-full border border-white/20 bg-black/30 flex items-center justify-center shrink-0 shadow-lg overflow-hidden">
                                  <img
                                    src={userAvatar}
                                    alt="user avatar"
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-white/10 text-slate-300 border border-white/20 flex items-center justify-center shadow-lg font-bold [.light-theme_&]:bg-blue-600 [.light-theme_&]:text-white [.light-theme_&]:border-transparent [.light-theme_&]:shadow-blue-500/20">
                                  {msg.name?.charAt(0) || "U"}
                                </div>
                              )
                            ) : avatar ? (
                              <img
                                src={avatar}
                                alt="avatar"
                                className="w-10 h-10 rounded-full object-cover shadow-lg border border-white/10"
                                onError={(e) => {
                                  getCharacterBlob(characterId).then((b) => {
                                    if (b && b.avatarBlob)
                                      e.currentTarget.src = URL.createObjectURL(b.avatarBlob);
                                  });
                                }}
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-white/[0.05] flex items-center justify-center shadow-sm border border-white/10 text-slate-200 font-bold [.light-theme_&]:bg-indigo-900 [.light-theme_&]:text-indigo-200 [.light-theme_&]:border-indigo-500/30 [.light-theme_&]:shadow-lg">
                                {msg.name?.charAt(0) || "AI"}
                              </div>
                            )}
                          </div>

                          <div
                            className={`max-w-[85%] md:max-w-[80%] min-w-0 ${msg.is_user ? "items-end" : "items-start"} flex flex-col gap-1`}
                          >
                            <div
                              className={`flex items-center gap-2 text-xs ${msg.is_user ? "flex-row-reverse text-slate-400 [.light-theme_&]:text-slate-500" : "text-slate-400 [.light-theme_&]:text-slate-500"}`}
                            >
                              <span className="font-semibold">
                                {msg.name || (msg.is_user ? "User" : "Character")}
                              </span>
                              {dateString && <span>· {dateString}</span>}
                            </div>

                            <div
                              className="relative px-5 py-3 rounded-2xl max-w-full min-w-0 shadow-sm transition-colors"
                              style={{
                                backgroundColor: msg.is_user ? bubbleTheme.userColor : bubbleTheme.botColor,
                                color: msg.is_user ? bubbleTheme.userTextColor : bubbleTheme.botTextColor,
                              }}
                            >
                              <div
                                className="prose prose-sm max-w-none chat-bubble-prose
                                  prose-headings:text-inherit prose-p:leading-relaxed 
                                  prose-a:underline hover:opacity-80
                                  prose-strong:font-bold prose-code:text-pink-300
                                  prose-pre:bg-black/30 prose-pre:max-w-full
                                  [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 break-words w-full"
                              >
                                <MessageContent
                                  content={formattedText}
                                  characterName={characterName}
                                  themeMode={isLightMode ? 'light' : 'dark'}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  />
                )}
              </div>

              {/* Bottom Sticky Reading Progress Bar */}
              <div className="h-[2px] w-full bg-white/5 shrink-0 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-150"
                  style={{ width: `${readingProgress}%` }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Branch Tool Modal */}
      <ChatCleanerModal
        isOpen={isCleanerOpen}
        onClose={() => setIsCleanerOpen(false)}
        characterId={characterId}
        onDeleted={() => {
          loadChats();
        }}
      />

      {/* Delete Chat Confirmation Modal */}
      <AnimatePresence>
        {deleteChatId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-end justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setDeleteChatId(null)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-[#1c1c1e] [.light-theme_&]:!bg-[#ffffff] border-t border-white/10 [.light-theme_&]:!border-black/5 rounded-t-3xl p-5 sm:p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl select-none"
            >
              {/* Indicator Handle */}
              <div className="w-10 h-1 bg-white/20 [.light-theme_&]:!bg-black/10 rounded-full mx-auto mb-4" />

              <h3 className="text-base sm:text-lg font-bold text-center text-white [.light-theme_&]:!text-[#0f172a] mb-1.5">
                删除聊天记录？
              </h3>
              <p className="text-xs sm:text-sm text-center text-white/70 [.light-theme_&]:!text-slate-600 mb-6 px-2 leading-relaxed">
                此操作无法撤销，确定要删除这条聊天记录吗？
              </p>

              <div className="space-y-2.5">
                <button
                  onClick={confirmDeleteChat}
                  className="w-full py-3.5 rounded-2xl bg-[#FE2C55] hover:bg-[#E02447] active:bg-[#D41C3E] text-white font-bold text-sm sm:text-base transition-all shadow-md shadow-[#FE2C55]/25 cursor-pointer active:scale-[0.98]"
                >
                  删除聊天记录
                </button>
                <button
                  onClick={() => setDeleteChatId(null)}
                  className="w-full py-3.5 rounded-2xl bg-white/10 hover:bg-white/15 active:bg-white/5 text-white/90 [.light-theme_&]:!bg-[#f2f3f5] [.light-theme_&]:hover:!bg-[#e5e6eb] [.light-theme_&]:!text-[#0f172a] font-semibold text-sm sm:text-base transition-all cursor-pointer active:scale-[0.98]"
                >
                  取消
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
