import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { getMemosForCharacter, saveMemo, deleteMemo, CharacterMemo } from '../lib/db';
import { getDownloadTooltip } from '../lib/appBridge';
import { StickyNote, Image as ImageIcon, File, Trash2, Plus, Download, X, Share2, Pin, Edit, FileUp, Eye, Save, ChevronDown, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
    const [isExpanded, setIsExpanded] = useState(false);

    if (!src) return null;

    return (
        <>
            <img 
                src={src} 
                alt={alt} 
                className="cursor-zoom-in rounded-lg max-h-[60vh] object-contain hover:opacity-90 transition"
                onClick={(e) => {
                    e.stopPropagation();
                    setIsExpanded(true);
                }}
            />
            {createPortal(
<AnimatePresence>
                {isExpanded && (
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[120] bg-black/95 flex items-center justify-center cursor-zoom-out"
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsExpanded(false);
                        }}
                    >
                        <TransformWrapper
                            initialScale={1}
                            minScale={0.5}
                            maxScale={5}
                            centerOnInit
                        >
                            <TransformComponent 
                                wrapperClass="w-full h-full" 
                                wrapperStyle={{ width: '100%', height: '100%' }}
                                contentClass="w-full h-full flex items-center justify-center"
                                contentStyle={{ width: '100%', height: '100%' }}
                            >
                                <img 
                                    src={src} 
                                    alt={alt} 
                                    className="w-full h-full object-contain cursor-grab active:cursor-grabbing"
                                    onClick={(e) => e.stopPropagation()} 
                                    draggable={false}
                                />
                            </TransformComponent>
                        </TransformWrapper>
                        <button 
                            className="absolute top-4 right-4 p-2 bg-black/40 hover:bg-black/60 text-white rounded-full transition z-10"
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsExpanded(false);
                            }}
                        >
                            <X className="w-6 h-6" />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
, document.body)}
        </>
    );
}

export function CharacterMemosSection({ characterId, isLightMode = false }: { characterId: string; isLightMode?: boolean }) {
  const [memos, setMemos] = useState<CharacterMemo[]>([]);
  const [isAddingMode, setIsAddingMode] = useState(false);
  const [isReorderingMode, setIsReorderingMode] = useState(false);
  const [newText, setNewText] = useState('');
  const [readingMemo, setReadingMemo] = useState<CharacterMemo | null>(null);
  const [viewingMemoFile, setViewingMemoFile] = useState<CharacterMemo | null>(null);
  const [isEditingMemo, setIsEditingMemo] = useState(false);
  const [editMemoContent, setEditMemoContent] = useState('');
  const [expandedMemoIds, setExpandedMemoIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toggleMemoExpand = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedMemoIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const loadMemos = async () => {
    const list = await getMemosForCharacter(characterId);
    setMemos(list);
  };

  useEffect(() => {
    loadMemos();
  }, [characterId]);

  const handleTogglePin = async (memo: CharacterMemo) => {
    await saveMemo({ ...memo, isPinned: !memo.isPinned });
    loadMemos();
  };

  const handleSaveEdit = async () => {
    if (!readingMemo || !editMemoContent.trim()) return;
    const updatedMemo = { ...readingMemo, content: editMemoContent.trim() };
    await saveMemo(updatedMemo);
    setReadingMemo(updatedMemo);
    setIsEditingMemo(false);
    loadMemos();
  };

  const handleCreateTextMemo = async () => {
    if (!newText.trim()) return;
    await saveMemo({
      id: crypto.randomUUID(),
      characterId,
      type: 'text',
      content: newText.trim(),
      createdAt: Date.now()
    });
    setNewText('');
    setIsAddingMode(false);
    loadMemos();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(file.name);
        
        let content = file.name;
        let finalBlob: Blob | undefined = file;
        
        if (!isImage && (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt') || file.name.toLowerCase().endsWith('.md'))) {
           content = await new Promise<string>((resolve, reject) => {
             const reader = new FileReader();
             reader.onload = (e) => resolve(e.target?.result as string);
             reader.onerror = reject;
             reader.readAsText(file, "utf-8");
           });
           finalBlob = undefined;
           await saveMemo({
              id: crypto.randomUUID(),
              characterId,
              type: 'text',
              content: content,
              createdAt: Date.now()
            });
            continue;
        }

        await saveMemo({
          id: crypto.randomUUID(),
          characterId,
          type: isImage ? 'image' : 'file',
          content: content,
          blob: finalBlob,
          createdAt: Date.now()
        });
    }
    
    if (fileInputRef.current) fileInputRef.current.value = '';
    loadMemos();
  };

  const handleDelete = async (id: string) => {
    if (confirm('确定要删除这条记录吗？')) {
      await deleteMemo(id);
      loadMemos();
    }
  };

  const handleReorder = async (newMemos: CharacterMemo[]) => {
     setMemos(newMemos);
     for (let i = 0; i < newMemos.length; i++) {
        if (newMemos[i].order !== i) {
           newMemos[i].order = i;
           await saveMemo(newMemos[i]);
        }
     }
  };

  const handleDownloadFile = async (memo: CharacterMemo, share: boolean = true) => {
      if (!memo.blob) return;
      const { downloadOrShareFile } = await import('../lib/appBridge');
      await downloadOrShareFile(memo.content, memo.blob, memo.blob.type || '*/*', share);
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h3 className="text-xl font-bold text-white/90 [.light-theme_&]:!text-[#0f172a]">
           <span className="truncate">备忘录与剧场</span>
        </h3>
        <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto hide-scrollbar flex-nowrap shrink-0 max-w-full w-full sm:w-auto">
            <button
                onClick={() => setIsReorderingMode(!isReorderingMode)}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition active:scale-95 shadow-xs flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                  isReorderingMode 
                    ? 'bg-blue-600 text-white border border-blue-500 shadow-sm [.light-theme_&]:!border-blue-600' 
                    : 'soft-pill'
                }`}
            >
                <Edit className="w-3.5 h-3.5 sm:w-4 sm:h-4 opacity-70 shrink-0" />
                <span>{isReorderingMode ? '完成' : '排序'}</span>
            </button>
            <button
                onClick={() => setIsAddingMode(true)}
                className="soft-pill px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition active:scale-95 shadow-xs flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
                <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 opacity-70 shrink-0" />
                <span>新建笔记</span>
            </button>
            <button
                onClick={() => fileInputRef.current?.click()}
                className="soft-pill px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition active:scale-95 shadow-xs flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
                <FileUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 opacity-70 shrink-0" />
                <span>导入文件</span>
            </button>
        </div>
        <input 
            type="file" 
            multiple
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.txt,.md,.json,.jsonl,.js,.css,.html"
        />
      </div>

      {createPortal(
<AnimatePresence>
      {isAddingMode && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex justify-center items-center p-4 sm:p-6 [.light-theme_&]:bg-black/40"
            onClick={() => setIsAddingMode(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
              className="bg-slate-900 border border-white/10 shadow-2xl rounded-2xl flex flex-col w-full max-h-[85vh] max-w-3xl overflow-hidden [.light-theme_&]:bg-[#FCFCFC] [.light-theme_&]:border-black/5"
              onClick={e => e.stopPropagation()}
            >
               <div className="flex-none p-4 sm:p-6 border-b border-white/10 flex items-center justify-between bg-black/20 [.light-theme_&]:border-black/5 [.light-theme_&]:bg-black/5">
                 <h3 className="text-lg font-semibold text-white [.light-theme_&]:text-[#1c1c1e] flex items-center gap-2">
                    <Plus className="w-5 h-5 text-blue-400" />
                    新建笔记
                 </h3>
                 <button onClick={() => setIsAddingMode(false)} className="p-1 hover:bg-white/10 rounded-full text-white/60 hover:text-white transition [.light-theme_&]:hover:bg-black/10 [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:text-[#1c1c1e] cursor-pointer">
                    <X className="w-5 h-5" />
                 </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                <textarea 
                  className="w-full bg-black/30 border border-white/10 rounded-lg p-4 text-white text-sm focus:outline-none focus:border-blue-500 transition min-h-[220px] resize-none [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10 [.light-theme_&]:text-[#1c1c1e]"
                  placeholder="在这里写下脑洞、小剧场或设定补充（支持 Markdown）"
                  value={newText}
                  onChange={e => setNewText(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="flex-none p-4 sm:p-6 border-t border-white/10 bg-black/20 flex justify-end gap-3 [.light-theme_&]:border-black/5 [.light-theme_&]:bg-black/5">
                  <button 
                    onClick={() => setIsAddingMode(false)}
                    className="px-4 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:text-[#1c1c1e] [.light-theme_&]:hover:bg-black/10 cursor-pointer"
                  >
                      取消
                  </button>
                  <button 
                    onClick={handleCreateTextMemo}
                    className="px-6 py-2 rounded-full font-bold text-xs sm:text-sm bg-white text-black hover:bg-neutral-200 [.light-theme_&]:!bg-black [.light-theme_&]:!text-white [.light-theme_&]:hover:!bg-neutral-800 transition flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
                    disabled={!newText.trim()}
                  >
                      <Save className="w-4 h-4 stroke-[2.5]" />
                      保存笔记
                  </button>
              </div>
            </motion.div>
          </motion.div>
      )}
      </AnimatePresence>
, document.body)}

      {memos.length === 0 && !isAddingMode ? (
         <div className="flex flex-col items-center justify-center p-8 rounded-2xl bg-white/5 border border-white/5 [.light-theme_&]:!bg-[#f8fafc] [.light-theme_&]:!border-[#e2e8f0] text-white/40 [.light-theme_&]:!text-[#64748b] text-center">
            <StickyNote className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm font-medium">当前角色暂无备忘信息</p>
            <p className="text-xs text-white/30 [.light-theme_&]:!text-[#94a3b8] mt-1">
              可记录设定补充、剧本大纲、贴图或存储小剧场
            </p>
         </div>
      ) : (
          <Reorder.Group 
             axis="y" 
             values={memos} 
             onReorder={handleReorder} 
             className="flex flex-col gap-4"
          >
              {memos.map(memo => (
                  <Reorder.Item 
                      key={memo.id} 
                      value={memo} 
                      dragListener={isReorderingMode}
                      className={`rounded-2xl overflow-hidden group break-inside-avoid shadow-xs relative w-full max-w-full bg-white/5 border border-white/10 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-[#e2e8f0] ${isReorderingMode ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  >
                      {memo.type === 'text' && (() => {
                        const isExpanded = expandedMemoIds.has(memo.id);
                        const isLongDocument = memo.content.length > 180 || (memo.content.match(/\n/g) || []).length >= 4;

                        return (
                          <div
                            className="p-4 sm:p-5 cursor-pointer group/text relative w-full max-w-full overflow-hidden"
                            onClick={() => {
                              setReadingMemo(memo);
                              setEditMemoContent(memo.content);
                              setIsEditingMemo(false);
                            }}
                          >
                            <div className="relative w-full max-w-full overflow-hidden">
                              <div
                                className={`prose prose-sm prose-invert [.light-theme_&]:!prose-slate memo-prose-adapt max-w-full w-full text-white/85 [.light-theme_&]:!text-[#0f172a] leading-relaxed markdown-body break-words break-all overflow-hidden transition-all duration-200 ${
                                  isLongDocument && !isExpanded ? 'max-h-[140px] sm:max-h-[160px] overflow-hidden' : ''
                                }`}
                              >
                                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                                  {memo.content}
                                </ReactMarkdown>
                              </div>

                              {isLongDocument && !isExpanded && (
                                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-900/95 via-slate-900/70 to-transparent [.light-theme_&]:from-[#ffffff] [.light-theme_&]:via-[#ffffff]/80" />
                              )}
                            </div>

                            <div 
                              className="mt-3 flex items-center justify-between gap-2 pt-2.5 border-t border-white/10 [.light-theme_&]:!border-[#e2e8f0] relative z-10 w-full"
                              style={{ borderColor: isLightMode ? '#e2e8f0' : 'rgba(255, 255, 255, 0.1)' }}
                            >
                              {isLongDocument ? (
                                <button
                                  type="button"
                                  onClick={(e) => toggleMemoExpand(memo.id, e)}
                                  className="text-xs font-semibold text-[#007aff] [.light-theme_&]:!text-[#007aff] flex items-center gap-1 cursor-pointer transition active:scale-95 py-1 px-2.5 -ml-2 rounded-lg hover:bg-white/5 [.light-theme_&]:hover:!bg-black/5 shrink-0"
                                  title={isExpanded ? '折叠收起' : '展开全文'}
                                >
                                  <span>{isExpanded ? '收起全文' : '展开全文'}</span>
                                  {isExpanded ? (
                                    <ChevronUp className="w-3.5 h-3.5 stroke-[2.2]" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5 stroke-[2.2]" />
                                  )}
                                </button>
                              ) : (
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className="text-[11px] text-white/40 [.light-theme_&]:!text-slate-400">
                                    便签记事
                                  </span>
                                  {memo.isPinned && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-[#007aff]/15 text-[#007aff] border border-[#007aff]/25 [.light-theme_&]:!bg-[#007aff]/12 [.light-theme_&]:!text-[#007aff] [.light-theme_&]:!border-[#007aff]/25 shrink-0">
                                      置顶
                                    </span>
                                  )}
                                </div>
                              )}

                              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                                <span className="text-[11px] text-white/40 [.light-theme_&]:!text-slate-500">
                                  {new Date(memo.createdAt).toLocaleDateString()} {new Date(memo.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>

                                <button 
                                  onClick={(e) => { e.stopPropagation(); handleTogglePin(memo); }}
                                  className={`soft-pill p-2 rounded-xl transition active:scale-95 cursor-pointer shadow-xs ${
                                      memo.isPinned 
                                          ? '!bg-[#007aff] !text-white !border-[#007aff] [.light-theme_&]:!bg-[#007aff] [.light-theme_&]:!text-white [.light-theme_&]:!border-[#007aff] shadow-sm' 
                                          : 'hover:!text-white [.light-theme_&]:hover:!text-[#0f172a]'
                                  }`} 
                                  title={memo.isPinned ? "取消置顶" : "置顶记事"}
                                >
                                  <Pin className={`w-3.5 h-3.5 ${memo.isPinned ? 'fill-current' : ''}`} />
                                </button>

                                <button 
                                  onClick={(e) => { e.stopPropagation(); handleDelete(memo.id); }}
                                  className="soft-pill p-2 rounded-xl transition active:scale-95 cursor-pointer shadow-xs hover:!text-red-400 hover:!border-red-500/30 [.light-theme_&]:hover:!text-red-600 [.light-theme_&]:hover:!border-red-300" 
                                  title="删除"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {memo.type === 'image' && memo.blob && (
                          <div className="relative w-full overflow-hidden">
                             <MemoImage memo={memo} />
                             <div 
                               className="p-3 bg-white/5 [.light-theme_&]:!bg-[#f8fafc] border-t border-white/10 [.light-theme_&]:!border-[#e2e8f0] flex items-center justify-between gap-2"
                               style={{ borderColor: isLightMode ? '#e2e8f0' : 'rgba(255, 255, 255, 0.1)' }}
                             >
                                <div className="flex items-center gap-1.5 text-xs text-white/60 [.light-theme_&]:!text-[#64748b] truncate">
                                   <span>{new Date(memo.createdAt).toLocaleDateString()} {new Date(memo.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                   {memo.isPinned && (
                                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-[#007aff]/15 text-[#007aff] border border-[#007aff]/25 [.light-theme_&]:!bg-[#007aff]/12 [.light-theme_&]:!text-[#007aff] [.light-theme_&]:!border-[#007aff]/25 shrink-0">
                                        置顶
                                      </span>
                                   )}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <button 
                                        onClick={() => handleDownloadFile(memo, true)} 
                                        className="soft-pill px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-xs text-[#007aff] [.light-theme_&]:!text-[#007aff]" 
                                        title={getDownloadTooltip("下载图片")}
                                    >
                                        <Download className="w-3.5 h-3.5" />
                                        <span>下载</span>
                                    </button>
                                    <button 
                                        onClick={() => handleTogglePin(memo)} 
                                        className={`soft-pill p-2 rounded-xl transition active:scale-95 cursor-pointer shadow-xs ${
                                            memo.isPinned 
                                                ? '!bg-[#007aff] !text-white !border-[#007aff] [.light-theme_&]:!bg-[#007aff] [.light-theme_&]:!text-white [.light-theme_&]:!border-[#007aff] shadow-sm' 
                                                : 'hover:!text-white [.light-theme_&]:hover:!text-[#0f172a]'
                                        }`} 
                                        title={memo.isPinned ? "取消置顶" : "置顶图片"}
                                    >
                                        <Pin className={`w-3.5 h-3.5 ${memo.isPinned ? 'fill-current' : ''}`} />
                                    </button>
                                    <button 
                                        onClick={() => handleDelete(memo.id)} 
                                        className="soft-pill p-2 rounded-xl transition active:scale-95 cursor-pointer shadow-xs hover:!text-red-400 hover:!border-red-500/30 [.light-theme_&]:hover:!text-red-600 [.light-theme_&]:hover:!border-red-300" 
                                        title="删除"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                             </div>
                          </div>
                      )}

                      {memo.type === 'file' && memo.blob && (
                          <div className="p-3.5 sm:p-4.5 flex flex-col gap-3">
                              {/* Top Row: File Icon + File Name & Meta */}
                              <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-10 h-10 sm:w-11 sm:h-11 bg-blue-500/10 text-[#007aff] [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-[#007aff] rounded-xl flex items-center justify-center shrink-0 shadow-inner">
                                      <File className="w-5 h-5 sm:w-5.5 sm:h-5.5" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                      <div
                                          onClick={() => setViewingMemoFile(memo)}
                                          className="text-sm font-semibold text-white/90 [.light-theme_&]:!text-[#0f172a] truncate cursor-pointer hover:text-[#007aff] [.light-theme_&]:hover:text-[#007aff] transition"
                                          title={memo.content}
                                      >
                                          {memo.content}
                                      </div>
                                      <div className="flex items-center gap-1.5 sm:gap-2 text-xs text-white/40 [.light-theme_&]:!text-slate-500 mt-0.5 truncate">
                                          <span>{new Date(memo.createdAt).toLocaleDateString()} {new Date(memo.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                          {memo.blob?.size ? (
                                              <>
                                                  <span>·</span>
                                                  <span>
                                                      {memo.blob.size < 1024 
                                                          ? `${memo.blob.size} B` 
                                                          : memo.blob.size < 1024 * 1024 
                                                              ? `${(memo.blob.size / 1024).toFixed(1)} KB` 
                                                              : `${(memo.blob.size / (1024 * 1024)).toFixed(1)} MB`}
                                                  </span>
                                              </>
                                          ) : null}
                                          {memo.isPinned && (
                                              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-[#007aff]/15 text-[#007aff] border border-[#007aff]/25 [.light-theme_&]:!bg-[#007aff]/12 [.light-theme_&]:!text-[#007aff] [.light-theme_&]:!border-[#007aff]/25 shrink-0">
                                                  置顶
                                              </span>
                                          )}
                                      </div>
                                  </div>
                              </div>

                              {/* Bottom Action Bar: Soft-pill buttons & Grey divider line */}
                              <div 
                                className="flex items-center justify-between pt-2.5 border-t border-white/10 [.light-theme_&]:!border-[#e2e8f0]"
                                style={{ borderColor: isLightMode ? '#e2e8f0' : 'rgba(255, 255, 255, 0.1)' }}
                              >
                                  <div className="flex items-center gap-1.5 sm:gap-2">
                                      <button 
                                          onClick={() => setViewingMemoFile(memo)} 
                                          className="soft-pill px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-xs" 
                                          title="查看文件内容"
                                      >
                                          <Eye className="w-3.5 h-3.5 opacity-80" />
                                          <span>查看</span>
                                      </button>
                                      
                                      <button 
                                          onClick={() => handleDownloadFile(memo, true)} 
                                          className="soft-pill px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-xs text-[#007aff] [.light-theme_&]:!text-[#007aff]" 
                                          title={getDownloadTooltip("下载")}
                                      >
                                          <Download className="w-3.5 h-3.5" />
                                          <span>下载文件</span>
                                      </button>
                                  </div>

                                  <div className="flex items-center gap-1.5">
                                      <button 
                                          onClick={() => handleTogglePin(memo)} 
                                          className={`soft-pill p-2 rounded-xl transition active:scale-95 cursor-pointer shadow-xs ${
                                              memo.isPinned 
                                                  ? '!bg-[#007aff] !text-white !border-[#007aff] [.light-theme_&]:!bg-[#007aff] [.light-theme_&]:!text-white [.light-theme_&]:!border-[#007aff] shadow-sm' 
                                                  : 'hover:!text-white [.light-theme_&]:hover:!text-[#0f172a]'
                                          }`} 
                                          title={memo.isPinned ? "取消置顶" : "置顶文件"}
                                      >
                                          <Pin className={`w-3.5 h-3.5 ${memo.isPinned ? 'fill-current' : ''}`} />
                                      </button>
                                      <button 
                                          onClick={() => handleDelete(memo.id)} 
                                          className="soft-pill p-2 rounded-xl transition active:scale-95 cursor-pointer shadow-xs hover:!text-red-400 hover:!border-red-500/30 [.light-theme_&]:hover:!text-red-600 [.light-theme_&]:hover:!border-red-300" 
                                          title="删除"
                                      >
                                          <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                  </div>
                              </div>
                          </div>
                      )}
                  </Reorder.Item>
              ))}
          </Reorder.Group>
      )}

      {createPortal(
<AnimatePresence>
        {viewingMemoFile && (
           <FileContentModal memo={viewingMemoFile} onClose={() => setViewingMemoFile(null)} />
        )}
      </AnimatePresence>,
      document.body
      )}

      {createPortal(
<AnimatePresence>
        {readingMemo && (
           <motion.div
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             exit={{ opacity: 0 }}
             transition={{ duration: 0.18 }}
             className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex justify-center items-center p-4 sm:p-6 [.light-theme_&]:bg-black/40"
             onClick={() => setReadingMemo(null)}
           >
             <motion.div
               initial={{ scale: 0.95, opacity: 0, y: 20 }}
               animate={{ scale: 1, opacity: 1, y: 0 }}
               exit={{ scale: 0.95, opacity: 0, y: 20 }}
               transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
               className="bg-slate-900 border border-white/10 shadow-2xl rounded-2xl flex flex-col w-full max-h-[85vh] max-w-4xl overflow-hidden [.light-theme_&]:bg-[#FCFCFC] [.light-theme_&]:border-black/5"
               onClick={e => e.stopPropagation()}
             >
               <div className="flex-none p-4 sm:p-6 border-b border-white/10 flex items-center justify-between bg-black/20 [.light-theme_&]:border-black/5 [.light-theme_&]:bg-black/5">
                  <div className="flex items-center gap-3">
                     <StickyNote className="w-5 h-5 text-blue-400" />
                     <h3 className="font-semibold text-lg text-white [.light-theme_&]:text-[#1c1c1e]">备忘录</h3>
                     <span className="text-sm text-white/40 [.light-theme_&]:text-slate-400 ml-2 hidden sm:inline">{new Date(readingMemo.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                     {!isEditingMemo && readingMemo.type === 'text' && (
                        <button onClick={() => setIsEditingMemo(true)} className="p-1.5 hover:bg-white/10 rounded-full text-white/70 hover:text-white transition [.light-theme_&]:hover:bg-black/10 [.light-theme_&]:!text-slate-600 [.light-theme_&]:hover:!text-[#1c1c1e] cursor-pointer" title="编辑笔记">
                           <Edit className="w-4.5 h-4.5" />
                        </button>
                     )}
                     <button onClick={() => { handleDelete(readingMemo.id); setReadingMemo(null); }} className="p-1.5 hover:bg-red-500/20 text-[#ff3b30] hover:text-red-400 [.light-theme_&]:!text-[#ff3b30] [.light-theme_&]:hover:!bg-red-50 rounded-full transition cursor-pointer active:scale-95" title="删除">
                        <Trash2 className="w-4.5 h-4.5 stroke-[2.2]" />
                     </button>
                     <button onClick={() => setReadingMemo(null)} className="p-1.5 hover:bg-white/10 rounded-full text-white/70 hover:text-white transition [.light-theme_&]:hover:bg-black/10 [.light-theme_&]:!text-slate-600 [.light-theme_&]:hover:!text-[#1c1c1e] cursor-pointer" title="关闭">
                        <X className="w-5 h-5" />
                     </button>
                  </div>
               </div>
               <div className="flex-1 overflow-y-auto p-4 sm:p-8 md:p-12 relative">
                  {isEditingMemo ? (
                    <div className="h-full flex flex-col gap-4">
                       <textarea 
                           className="w-full flex-1 bg-black/30 border border-white/10 rounded-xl p-4 text-white text-sm sm:text-base focus:outline-none focus:border-blue-500 transition min-h-[220px] resize-none [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10 [.light-theme_&]:text-[#1c1c1e]"
                           value={editMemoContent}
                           onChange={e => setEditMemoContent(e.target.value)}
                           autoFocus
                       />
                       <div className="flex justify-end gap-3 pt-2">
                           <button onClick={() => setIsEditingMemo(false)} className="px-4 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:text-[#1c1c1e] [.light-theme_&]:hover:bg-black/10 cursor-pointer">取消</button>
                           <button onClick={handleSaveEdit} className="px-6 py-2 rounded-full font-bold text-xs sm:text-sm bg-white text-black hover:bg-neutral-200 [.light-theme_&]:!bg-black [.light-theme_&]:!text-white [.light-theme_&]:hover:!bg-neutral-800 transition flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50" disabled={!editMemoContent.trim()}>
                              <Save className="w-4 h-4 stroke-[2.5]" />
                              保存
                           </button>
                       </div>
                    </div>
                  ) : (
                    <div className="prose prose-invert [.light-theme_&]:!prose-slate memo-prose-adapt prose-base sm:prose-lg max-w-none text-white/80 [.light-theme_&]:!text-[#0f172a] leading-relaxed markdown-body" onClick={e => e.stopPropagation()}>
                       <ReactMarkdown 
                           remarkPlugins={[remarkGfm]}
                           components={{
                               img: ({node, ...props}) => <MarkdownImage src={props.src} alt={props.alt} />
                           }}
                       >
                            {readingMemo.content}
                       </ReactMarkdown>
                    </div>
                  )}
               </div>
             </motion.div>
           </motion.div>
        )}
      </AnimatePresence>
, document.body)}
    </div>
  );
}

function MemoImage({ memo }: { memo: CharacterMemo }) {
    const [url, setUrl] = useState('');
    const [isExpanded, setIsExpanded] = useState(false);

    useEffect(() => {
        if (!memo.blob) return;
        const objectUrl = URL.createObjectURL(memo.blob);
        setUrl(objectUrl);
        return () => URL.revokeObjectURL(objectUrl);
    }, [memo]);

    if (!url) return <div className="h-48 bg-white/5 animate-pulse" />;

    return (
        <>
            <div 
               className="h-32 sm:h-48 w-full bg-black/20 hover:bg-black/30 transition cursor-zoom-in flex items-center justify-center overflow-hidden"
               onClick={() => setIsExpanded(true)}
               title="点击展开大图"
            >
               <img src={url} alt={memo.content} className="min-w-full min-h-full object-cover" />
            </div>

            {createPortal(
<AnimatePresence>
                {isExpanded && (
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center cursor-zoom-out"
                    >
                        <TransformWrapper
                            initialScale={1}
                            minScale={0.5}
                            maxScale={5}
                            centerOnInit
                        >
                            <TransformComponent 
                                wrapperClass="w-full h-full" 
                                wrapperStyle={{ width: '100%', height: '100%' }}
                                contentClass="w-full h-full flex items-center justify-center"
                                contentStyle={{ width: '100%', height: '100%' }}
                            >
                                <img 
                                    src={url} 
                                    alt={memo.content} 
                                    className="w-full h-full object-contain cursor-grab active:cursor-grabbing"
                                    onClick={(e) => e.stopPropagation()} 
                                    draggable={false}
                                />
                            </TransformComponent>
                        </TransformWrapper>
                        <button 
                            className="absolute top-4 right-4 p-2 bg-black/40 hover:bg-black/60 text-white rounded-full transition z-10"
                            onClick={() => setIsExpanded(false)}
                        >
                            <X className="w-6 h-6" />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
, document.body)}
        </>
    );
}


function FileContentModal({ memo, onClose }: { memo: CharacterMemo, onClose: () => void }) {
  const [content, setContent] = useState<string>('');
  const [loading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!memo.blob) {
         setContent('文件数据不存在。');
         setIsLoading(false);
         return;
      }
      try {
         const name = memo.content.toLowerCase();
         if (name.endsWith('.png') || memo.type === 'image') {
            const { extractTavernData } = await import('../lib/png');
            const buffer = await memo.blob.arrayBuffer();
            const data = await extractTavernData(buffer);
            if (data) {
                setContent(JSON.stringify(data, null, 2));
            } else {
                setContent('未找到内嵌的酒馆角色数据 (可能只是一张普通图片)。');
            }
         } else {
             const text = await new Promise<string>((resolve, reject) => {
               const reader = new FileReader();
               reader.onload = (e) => resolve(e.target?.result as string);
               reader.onerror = reject;
               reader.readAsText(memo.blob!, "utf-8");
             });
             if (name.endsWith('.json') || name.endsWith('.jsonl')) {
                 try {
                     if (name.endsWith('.jsonl')) {
                         const lines = text.trim().split('\n').map(l => JSON.parse(l));
                         setContent(JSON.stringify(lines, null, 2));
                     } else {
                         const obj = JSON.parse(text);
                         setContent(JSON.stringify(obj, null, 2));
                     }
                 } catch (e) {
                     setContent(text);
                 }
             } else {
                 setContent(text);
             }
         }
      } catch (e: any) {
         setContent('读取文件出错: ' + e.message);
      }
      setIsLoading(false);
    }
    load();
  }, [memo]);

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 [.light-theme_&]:bg-black/40" onClick={onClose}>
        <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden [.light-theme_&]:bg-[#FCFCFC] [.light-theme_&]:border-black/5"
            onClick={e => e.stopPropagation()}
        >
            <div className="flex-none p-4 sm:p-6 border-b border-white/10 flex items-center justify-between bg-black/20 [.light-theme_&]:border-black/5 [.light-theme_&]:bg-black/5">
               <h3 className="font-semibold text-lg text-white [.light-theme_&]:text-[#1c1c1e] truncate pr-4 flex items-center gap-2">
                 <File className="w-5 h-5 text-blue-400" />
                 {memo.content}
               </h3>
               <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full text-white/60 hover:text-white transition [.light-theme_&]:hover:bg-black/10 [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:text-[#1c1c1e] cursor-pointer">
                  <X className="w-5 h-5" />
               </button>
            </div>
            <div className="flex-1 overflow-auto p-4 sm:p-6 custom-scrollbar bg-black/20 [.light-theme_&]:bg-[#f8fafc]">
               {loading ? (
                  <div className="flex items-center justify-center h-full text-white/50 [.light-theme_&]:text-slate-400">正在解析数据...</div>
               ) : (
                  <pre className="text-[13px] text-slate-300 [.light-theme_&]:text-[#0f172a] font-mono whitespace-pre-wrap break-all">
                     {content.length > 50000 ? content.substring(0, 50000) + "\n\n... 内容过大，为防止卡顿已截断显示" : content}
                  </pre>
               )}
            </div>
        </motion.div>
    </div>,
    document.body
  );
}
