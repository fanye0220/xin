import { getFallbackAvatar } from "../lib/avatar";
import React, { useState, useEffect, useRef } from "react";
import {
  getChatsForCharacter,
  deleteChat,
  saveChat,
  saveChatsBulk,
  ChatLog,
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
  CheckSquare,
  XSquare,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageContent } from "./MessageContent";
import { ChatCleanerModal } from "./ChatCleanerModal";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Virtuoso } from "react-virtuoso";

interface Props {
  characterId: string;
  characterName: string;
  regexScripts: any[];
  avatar?: string;
  onOpenChat?: (chatId: string) => void;
  onOpenImport?: (files?: FileList | File[]) => void;
  refreshKey?: number;
}

export function CharacterChatsSection({
  characterId,
  characterName,
  regexScripts,
  avatar,
  onOpenChat,
  onOpenImport,
  refreshKey,
}: Props) {
  const [chats, setChats] = useState<any[]>([]);
  const [selectedChat, setSelectedChat] = useState<ChatLog | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingNoteFor, setEditingNoteFor] = useState<string | null>(null);
  const [editNoteContent, setEditNoteContent] = useState("");
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [visibleCount, setVisibleCount] = useState(30);
  const observerTarget = useRef<HTMLDivElement>(null);
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
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

  const formatCustomTags = (text: string) => {
    if (!text) return "";
    let result = text;
    // Format various Think tags: <think>, [think], {{think}}
    const thinkRegex =
      /(?:<|&lt;|\[+|\\\[+|\{+)\s*(?:think|thought|thinking)\s*(?:>|&gt;|\]+|\\\]+|\}+)([\s\S]*?)(?:<|&lt;|\[+|\\\[+|\{+)\/\s*(?:think|thought|thinking)\s*(?:>|&gt;|\]+|\\\]+|\}+)/gi;
    result = result.replace(
      thinkRegex,
      '<details class="text-sm bg-[rgba(255,255,255,0.05)] [.light-theme_&]:bg-black/5 border border-[rgba(255,255,255,0.1)] [.light-theme_&]:border-black/10 rounded-lg p-2 my-2 w-full max-w-full overflow-hidden"><summary class="cursor-pointer font-bold text-[#8491CD] hover:opacity-80 transition-opacity select-none">🤔 思维链</summary><div class="mt-2 text-[#707CB1] break-words whitespace-pre-wrap max-w-full overflow-x-auto">$1</div></details>',
    );

    // Apply user defined custom tags
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
    const { getChatById } = await import("../lib/db");
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
      const { getChatById } = await import("../lib/db");
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
    if (selectedChat?.id === idToDelete) setSelectedChat(null);
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
            if (lowerName.endsWith(".json") || lowerName.endsWith(".jsonl")) {
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

            try {
              const arrayBuffer = await zipEntry.async("arraybuffer");
              const blob = new Blob([arrayBuffer]);
              const text = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target?.result as string);
                reader.onerror = reject;
                reader.readAsText(blob, "utf-8");
              });
              let parsedMessages: any[] = [];

              if (lowerName.endsWith(".jsonl")) {
                const lines = text.trim().split("\n");
                for (let k = 0; k < lines.length; k++) {
                  try {
                    const parsed = JSON.parse(lines[k]);
                    if (parsed) parsedMessages.push(parsed);
                  } catch (e) {}
                  if (k % 500 === 0) await new Promise((r) => setTimeout(r, 0));
                }
              } else {
                try {
                  const data = JSON.parse(text);
                  if (Array.isArray(data)) parsedMessages = data;
                  else if (data.chat && Array.isArray(data.chat))
                    parsedMessages = data.chat;
                  else parsedMessages = [data];
                } catch (err) {
                  if (text.trim().split("\n").length > 1) {
                    const lines = text.trim().split("\n");
                    for (let k = 0; k < lines.length; k++) {
                      try {
                        const parsed = JSON.parse(lines[k]);
                        if (parsed) parsedMessages.push(parsed);
                      } catch (e) {}
                      if (k % 500 === 0)
                        await new Promise((r) => setTimeout(r, 0));
                    }
                  }
                }
              }

              if (parsedMessages.length === 0) continue;

              let charId = characterId;
              try {
                const { initDB } = await import("../lib/db");
                const db = await initDB();
                const allChars = await db.getAll("characters");
                const pathParts = zipEntry.name.split("/");
                if (pathParts.length > 1) {
                  let charNameIndex = pathParts.length - 2;
                  if (pathParts[charNameIndex] === "聊天记录" && pathParts.length > 2) {
                    charNameIndex = pathParts.length - 3;
                  }
                  const parentFolderName = pathParts[charNameIndex];
                  const folderMatch = allChars.find((c: any) => c.name.toLowerCase() === parentFolderName.toLowerCase());
                  if (folderMatch) charId = folderMatch.id;
                }
                if (charId === characterId) {
                  const aiMessage = parsedMessages.find((m: any) => !m.is_user && m.name);
                  if (aiMessage && aiMessage.name) {
                    const match = allChars.find((c: any) => c.name.toLowerCase() === aiMessage.name?.toLowerCase());
                    if (match) charId = match.id;
                  }
                }
              } catch (e) {}

              const chatName = zipEntry.name.split("/").pop() || zipEntry.name;
              const finalMessages = parsedMessages.map((m: any) => ({
                ...m,
                is_user: m.is_user !== undefined ? m.is_user : m.is_name !== chatName,
                send_date: m.send_date || Date.now(),
                mes: m.mes || m.text || "",
              }));

              pendingChats.push({
                id: crypto.randomUUID(),
                characterId: charId,
                name: chatName.replace(/\.[^/.]+$/, ""),
                messages: finalMessages,
                createdAt: zipEntry.date ? zipEntry.date.getTime() : Date.now(),
              });
              imported++;
            } catch (e) {
              console.error(
                `Failed to parse file inside zip: ${zipEntry.name}`,
                e,
              );
            }
          }
        } else {
          setImportProgress({
            show: true,
            current: 0,
            total: 1,
            message: `正在解析文件 ${file.name}...`,
          });

          const text = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.onerror = reject;
            reader.readAsText(file, "utf-8");
          });
          let parsedMessages: any[] = [];

          if (file.name.toLowerCase().endsWith(".jsonl")) {
            const lines = text.trim().split("\n");
            for (let k = 0; k < lines.length; k++) {
              try {
                const parsed = JSON.parse(lines[k]);
                if (parsed) parsedMessages.push(parsed);
              } catch (e) {}
              if (k % 500 === 0) await new Promise((r) => setTimeout(r, 0));
            }
          } else {
            try {
              const data = JSON.parse(text);
              if (Array.isArray(data)) parsedMessages = data;
              else if (data.chat && Array.isArray(data.chat))
                parsedMessages = data.chat;
              else parsedMessages = [data];
            } catch (err) {
              if (text.trim().split("\n").length > 1) {
                const lines = text.trim().split("\n");
                for (let k = 0; k < lines.length; k++) {
                  try {
                    const parsed = JSON.parse(lines[k]);
                    if (parsed) parsedMessages.push(parsed);
                  } catch (e) {}
                  if (k % 500 === 0) await new Promise((r) => setTimeout(r, 0));
                }
              }
            }
          }

          if (parsedMessages.length === 0) continue;

          let charId = characterId;
          try {
            const { initDB } = await import("../lib/db");
            const db = await initDB();
                const allChars = await db.getAll("characters");
            const aiMessage = parsedMessages.find((m: any) => !m.is_user && m.name);
            if (aiMessage && aiMessage.name) {
              const match = allChars.find((c: any) => c.name.toLowerCase() === aiMessage.name?.toLowerCase());
              if (match) charId = match.id;
            }
          } catch (e) {}

          const chatName = file.name.replace(/\.[^/.]+$/, "");
          const finalMessages = parsedMessages.map((m: any) => ({
            ...m,
            is_user: m.is_user !== undefined ? m.is_user : m.is_name !== chatName,
            send_date: m.send_date || Date.now(),
            mes: m.mes || m.text || "",
          }));

          pendingChats.push({
            id: crypto.randomUUID(),
            characterId: charId,
            name: chatName,
            messages: finalMessages,
            createdAt: file.lastModified || Date.now(),
          });
          imported++;
        }
      } catch (e) {
        console.error(e);
        alert(
          `解析文件 ${file.name} 失败，请确保格式为记录导出的 zip, jsonl 或 json 格式。`,
        );
      }
    }

    if (pendingChats.length > 0) {
      setImportProgress((prev) => ({
        ...prev,
        message: "正在保存记录到数据库...",
      }));
      await saveChatsBulk(pendingChats, (current, total, phase) => {
        setImportProgress((prev) => ({
          ...prev,
          current,
          total,
          message: phase,
        }));
      });
    }

    if (imported > 0) {
      loadChats();
    }

    setTimeout(() => {
      setImportProgress({ show: false, current: 0, total: 0, message: "" });
    }, 500);
  };

  const applyRegexes = (text: string) => {
    let result = text;
    if (regexScripts && Array.isArray(regexScripts)) {
      // Filter placement 3 or disabled=false
      const validScripts = regexScripts.filter(
        (s) =>
          !s.disabled &&
          (s.regex || s.findRegex) &&
          (s.replacementString !== undefined || s.replaceString !== undefined),
      );

      for (const script of validScripts) {
        try {
          let pattern = script.regex || script.findRegex;
          let flags = "g";
          if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
            const lastSlash = pattern.lastIndexOf("/");
            flags = pattern.substring(lastSlash + 1);
            if (!flags.includes("g")) flags += "g";
            pattern = pattern.substring(1, lastSlash);
          }

          pattern = pattern.replace(/{{char}}/gi, characterName);
          pattern = pattern.replace(/{{user}}/gi, "User");
          let rawReplace =
            script.replacementString !== undefined
              ? script.replacementString
              : script.replaceString;
          let replaceStr = rawReplace
            .replace(/{{char}}/gi, characterName)
            .replace(/{{user}}/gi, "User");

          const re = new RegExp(pattern, flags);
          result = result.replace(re, replaceStr);
        } catch (e) {
          // invalid regex, skip
        }
      }
    }

    return result;
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
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-blue-400 shrink-0" />
            <span className="truncate">
              聊天记录{" "}
              <span className="text-white/50 text-base font-normal">
                ({chats.length})
              </span>
            </span>
          </h3>
          <AnimatePresence>
            {importProgress.show && (
              <motion.div
                initial={{ opacity: 0, y: -50, x: '-50%' }}
                animate={{ opacity: 1, y: 0, x: '-50%' }}
                exit={{ opacity: 0, y: -50, x: '-50%' }}
                className="fixed top-12 sm:top-20 left-1/2 z-[100] bg-slate-800/90 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl p-3 sm:p-4 w-[90%] max-w-[16rem] sm:w-72 pointer-events-auto"
              >
                <div className="flex items-center gap-3 mb-2">
                  <UploadCloud className="w-5 h-5 text-blue-400 animate-bounce shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-white truncate">
                      正在导入记录
                    </h4>
                    <p className="text-xs text-white/50 truncate">
                      {importProgress.message}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-blue-400/80 shrink-0">
                    {importProgress.total > 0
                      ? Math.round((importProgress.current / importProgress.total) * 100)
                      : 0}%
                  </span>
                </div>
                <div className="w-full bg-black/40 rounded-full h-1.5 overflow-hidden relative">
                  <div 
                    className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-300 relative"
                    style={{ width: `${importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}%` }}
                  >
                    <div className="absolute inset-0 bg-white/20 animate-pulse" />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="flex gap-2 self-start sm:self-auto w-full sm:w-auto mt-2 sm:mt-0">
          <button
            onClick={() => setIsCleanerOpen(true)}
            className="flex-1 sm:flex-none justify-center px-3 py-2 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 text-purple-400 rounded-lg text-sm transition flex items-center gap-1.5"
            title="清理记录和分支"
          >
            <Trash2 className="w-4 h-4 shrink-0" />
            <span>清理</span>
          </button>
          <button
            onClick={() => {
              if (onOpenImport) {
                onOpenImport();
              } else {
                fileInputRef.current?.click();
              }
            }}
            className="flex-1 sm:flex-none justify-center px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 rounded-lg text-sm transition flex items-center gap-1.5"
          >
            <UploadCloud className="w-4 h-4 shrink-0" />
            <span>导入</span>
          </button>
        </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".json,.jsonl,.zip"
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
          <div className="flex flex-col items-center justify-center p-12 bg-white/5 rounded-2xl border border-white/10 text-center border-dashed border-2">
            <FileJson className="w-12 h-12 text-white/20 mb-4" />
            <h4 className="text-white/80 font-medium mb-2">
              暂无绑定的聊天记录
            </h4>
            <div className="flex flex-col items-center gap-4 mt-2">
              <p className="text-white/40 text-sm max-w-sm">
                点击右上角导入按钮，或直接拖拽 JSONL/ZIP
                文件到窗口中绑定至此角色。
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {chats.slice(0, visibleCount).map((chat) => (
                <div
                  key={chat.id}
                  onClick={() => handleChatClick(chat)}
                  className="group cursor-pointer bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-500/50 rounded-2xl p-4 transition-all hover:shadow-[0_0_20px_rgba(59,130,246,0.1)] relative h-full flex flex-col"
                >
                  <div className="flex justify-between items-start mb-2 gap-3">
                    <div className="p-2 bg-blue-500/20 rounded-lg flex-shrink-0">
                      <MessageSquare className="w-5 h-5 text-blue-400" />
                    </div>

                    <div className="flex-1 min-w-0 pt-0.5">
                      {editingNoteFor === chat.id ? (
                        <div
                          className="w-full"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            autoFocus
                            className="w-full bg-black/40 border border-blue-500/50 rounded flex px-2 py-1 text-sm text-blue-300 focus:outline-none placeholder-blue-300/30"
                            value={editNoteContent}
                            onChange={(e) => setEditNoteContent(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveNote(chat);
                            }}
                            onBlur={() => handleSaveNote(chat)}
                            placeholder="添加故事备注..."
                          />
                        </div>
                      ) : (
                        <div
                          className="text-sm font-medium text-blue-300 cursor-pointer hover:text-blue-200 transition flex items-center gap-2"
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
                              <span className="text-xs text-blue-300/50 shrink-0 flex items-center gap-1 leading-none pt-0.5">
                                <Edit2 className="w-3 h-3" />
                              </span>
                            </>
                          ) : (
                            <span className="text-blue-300/50 flex items-center gap-1 font-normal">
                              <Plus className="w-3.5 h-3.5" /> 添加内容备注...
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
                    className="font-medium text-white mb-2 truncate text-sm flex-1"
                    title={chat.name}
                  >
                    {chat.name}
                  </h4>
                  <div className="flex justify-between items-center text-xs text-white/40 mt-auto">
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

      <AnimatePresence>
        {selectedChat && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 20 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className="fixed inset-0 z-[120] bg-slate-900/80 backdrop-blur-sm flex flex-col p-4 sm:p-6 [.light-theme_&]:bg-black/20"
          >
            <div className="max-w-4xl mx-auto w-full flex flex-col h-full bg-slate-900/80 backdrop-blur-xl rounded-3xl border border-white/10 overflow-hidden shadow-2xl ring-1 ring-white/5 [.light-theme_&]:bg-white/80 [.light-theme_&]:backdrop-blur-3xl [.light-theme_&]:border-black/5 [.light-theme_&]:shadow-[0_8px_40px_rgba(0,0,0,0.1)]">
              <div className="p-4 sm:p-5 border-b border-white/10 flex justify-between items-center shrink-0 bg-transparent">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                  <button
                    onClick={() => setSelectedChat(null)}
                    className="flex items-center justify-center w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition shrink-0"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <h3
                    className="text-base sm:text-lg font-medium text-white truncate"
                    title={selectedChat.name}
                  >
                    {selectedChat.name}
                  </h3>
                </div>
                <button
                  onClick={(e) => handleDelete(selectedChat.id, e)}
                  className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition shrink-0"
                  title="删除这条聊天记录"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-[1_1_100%] min-h-0 bg-slate-900">
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
                                import("../lib/db").then((m) =>
                                  m.getCharacterBlob(characterId).then((b) => {
                                    if (b && b.avatarBlob)
                                      e.currentTarget.src = URL.createObjectURL(
                                        b.avatarBlob,
                                      );
                                  }),
                                );
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
                            className={`flex items-center gap-2 text-xs ${msg.is_user ? "flex-row-reverse text-slate-400 [.light-theme_&]:text-blue-600" : "text-slate-400 [.light-theme_&]:text-slate-500"}`}
                          >
                            <span className="font-semibold">
                              {msg.name || (msg.is_user ? "User" : "Character")}
                            </span>
                            {dateString && <span>· {dateString}</span>}
                          </div>

                          <div
                            className={`px-5 py-3 rounded-2xl max-w-full min-w-0 overflow-x-auto ${
                              msg.is_user
                                ? "bg-blue-600/20 text-blue-50 border border-blue-500/20 rounded-tr-sm shadow-sm backdrop-blur-md [.light-theme_&]:bg-blue-600/90 [.light-theme_&]:text-white [.light-theme_&]:border-blue-500/30"
                                : "bg-white/[0.04] text-white/90 border border-white/5 rounded-tl-sm shadow-sm backdrop-blur-md [.light-theme_&]:bg-indigo-950/80 [.light-theme_&]:text-indigo-100 [.light-theme_&]:border-indigo-500/20"
                            }`}
                          >
                            <div
                              className={`prose prose-sm max-w-none chat-bubble-prose
                                prose-headings:text-white/90 prose-p:leading-relaxed 
                                prose-a:text-blue-400 hover:prose-a:text-blue-300
                                prose-strong:text-white prose-code:text-pink-300
                                prose-pre:bg-black/30 prose-pre:max-w-full
                                [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 break-words w-full \n                                 ${msg.is_user ? "prose-p:text-slate-100 text-slate-100 [.light-theme_&]:prose-p:text-white [.light-theme_&]:text-white" : "prose-invert"}`}
                            >
                              <MessageContent
                                content={formatCustomTags(
                                  applyRegexes(msg.mes || ""),
                                )}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }}
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
            className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setDeleteChatId(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 border border-white/10 rounded-2xl p-6 max-w-sm w-full shadow-2xl"
            >
              <h3 className="text-xl font-bold mb-2 text-white">
                删除聊天记录？
              </h3>
              <p className="text-slate-400 mb-6">
                此操作无法撤销，确定要删除这条聊天记录吗？
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDeleteChatId(null)}
                  className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 hover:text-white transition"
                >
                  取消
                </button>
                <button
                  onClick={confirmDeleteChat}
                  className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white transition shadow-lg shadow-red-500/20"
                >
                  删除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
