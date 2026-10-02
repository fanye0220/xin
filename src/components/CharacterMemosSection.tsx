import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { getMemosForCharacter, saveMemo, deleteMemo, CharacterMemo } from '../lib/db';
import { getDownloadTooltip } from '../lib/appBridge';
import { StickyNote, Image as ImageIcon, File, Trash2, Plus, Download, X, Share2, Pin, Edit, FileUp, Eye, Save } from 'lucide-react';
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        const isImage = file.type.startsWith('image/');
        
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
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap self-start sm:self-auto w-full sm:w-auto">
            <button
                onClick={() => setIsReorderingMode(!isReorderingMode)}
                className={`px-3.5 sm:px-4 py-2 rounded-full text-sm font-medium transition active:scale-95 shadow-xs flex items-center justify-center gap-1.5 cursor-pointer ${
                  isReorderingMode 
                    ? 'bg-blue-600 text-white border border-blue-500 shadow-sm [.light-theme_&]:!border-blue-600' 
                    : 'soft-pill'
                }`}
            >
                <Edit className="w-4 h-4 opacity-70" />
                <span>{isReorderingMode ? '完成' : '排序'}</span>
            </button>
            <button
                onClick={() => setIsAddingMode(true)}
                className="soft-pill px-3.5 sm:px-4 py-2 rounded-full text-sm font-medium transition active:scale-95 shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
            >
                <Plus className="w-4 h-4 opacity-70" />
                <span>新建笔记</span>
            </button>
            <button
                onClick={() => fileInputRef.current?.click()}
                className="soft-pill px-3.5 sm:px-4 py-2 rounded-full text-sm font-medium transition active:scale-95 shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
            >
                <FileUp className="w-4 h-4 opacity-70" />
                <span>导入文件</span>
            </button>
        </div>
        <input 
            type="file" 
            multiple
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            accept=".txt,.md,.json,.jsonl,.js,.css,.html"
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
                      className={`bg-white/5 border ${memo.isPinned ? 'border-blue-500/50 shadow-[0_0_15px_rgba(168,85,247,0.15)]' : 'border-white/10'} rounded-xl overflow-hidden group break-inside-avoid shadow-lg relative ${isReorderingMode ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  >
                                            {memo.type !== 'file' && (
                          <div className="absolute top-3 right-3 flex gap-2 z-10 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                              <button
                                  onClick={() => handleTogglePin(memo)}
                                 className={`p-2 bg-black/40 ${memo.isPinned ? 'text-blue-400' : 'text-white/50 hover:text-white'} hover:bg-white/10 rounded-lg transition`}
                                 title={memo.isPinned ? "取消置顶" : "置顶记录"}
                              >
                                 <Pin className={`w-4 h-4 ${memo.isPinned ? 'fill-current' : ''}`} />
                              </button>
                              <button
                                  onClick={() => handleDelete(memo.id)}
                                 className="p-2 bg-black/40 hover:bg-red-500/80 text-white/50 hover:text-white rounded-lg transition"
                              >
                                 <Trash2 className="w-4 h-4" />
                              </button>
                          </div>
                      )}
                      {memo.type !== 'file' && memo.isPinned && (
                          <div className="absolute top-3 right-3 flex gap-2 z-10 hidden sm:flex sm:group-hover:opacity-0 transition-opacity pointer-events-none">
                              <div className="p-2 text-blue-400">
                                 <Pin className="w-4 h-4 fill-current" />
                              </div>
                          </div>
                      )}

                                             {memo.type === 'text' && (
                          <div className="p-5 cursor-pointer group/text relative" onClick={() => { setReadingMemo(memo); setEditMemoContent(memo.content); setIsEditingMemo(false); }}>
                             <div className="prose prose-sm prose-invert [.light-theme_&]:!prose-slate memo-prose-adapt max-w-none text-white/80 [.light-theme_&]:!text-[#0f172a] leading-relaxed markdown-body line-clamp-[8]">
                                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                                    {memo.content}
                                </ReactMarkdown>
                             </div>
                             <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 [.light-theme_&]:from-slate-200/90 via-transparent to-transparent opacity-0 group-hover/text:opacity-100 transition-opacity flex items-end justify-center pb-4">
                               <span className="bg-white/10 [.light-theme_&]:!bg-black/10 backdrop-blur-md px-3 py-1 rounded-full text-xs text-white [.light-theme_&]:!text-[#0f172a] shadow-lg pointer-events-none">
                                 点击全屏阅读
                               </span>
                             </div>
                             <div className="mt-4 text-[11px] text-white/40 [.light-theme_&]:!text-slate-500 relative z-10">
                                {new Date(memo.createdAt).toLocaleString()}
                             </div>
                          </div>
                      )}

                      {memo.type === 'image' && memo.blob && (
                          <div className="relative">
                             <MemoImage memo={memo} />
                             <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent flex justify-between items-end">
                                <span className="text-xs text-white/60">{new Date(memo.createdAt).toLocaleString()}</span>
                             </div>
                             <div className="absolute bottom-3 right-3 flex gap-2 transition opacity-100 md:opacity-0 md:group-hover:opacity-100">
                                 <button onClick={() => setViewingMemoFile(memo)} className="p-1.5 bg-black/40 hover:bg-blue-500 text-white/70 hover:text-white rounded-lg transition" title="查看数据">
                                    <Eye className="w-4 h-4" />
                                 </button>
                                 
                                 <button onClick={() => handleDownloadFile(memo, true)} className="p-1.5 bg-black/40 hover:bg-blue-500 text-white/70 hover:text-white rounded-lg transition" title={getDownloadTooltip("下载")}>
                                    <Download className="w-4 h-4" />
                                 </button>
                             </div>
                          </div>
                      )}

                      {memo.type === 'file' && memo.blob && (
                          <div className="p-4 sm:p-5 flex items-center gap-4">
                              <div className="w-12 h-12 bg-white/10 text-white/80 [.light-theme_&]:bg-stone-200 [.light-theme_&]:text-stone-800 rounded-xl flex items-center justify-center shrink-0 shadow-inner">
                                  <File className="w-6 h-6" />
                              </div>
                              <div className="flex-1 min-w-0">
                                  <div className="text-[15px] font-medium text-white/90 [.light-theme_&]:!text-[#0f172a] truncate">{memo.content}</div>
                                  <div className="text-xs text-white/40 [.light-theme_&]:!text-slate-500 mt-1">{new Date(memo.createdAt).toLocaleString()}</div>
                              </div>
                              <div className="flex gap-1 sm:gap-2 shrink-0 items-center">
                                  <button onClick={() => setViewingMemoFile(memo)} className="w-10 h-10 flex items-center justify-center bg-white/5 hover:bg-white/10 [.light-theme_&]:!bg-black/5 [.light-theme_&]:hover:!bg-black/10 rounded-full text-white/70 hover:text-white [.light-theme_&]:!text-slate-600 [.light-theme_&]:hover:!text-[#0f172a] transition" title="查看内容">
                                      <Eye className="w-5 h-5" />
                                  </button>
                                  
                                  <button onClick={() => handleDownloadFile(memo, true)} className="w-10 h-10 flex items-center justify-center bg-white/5 hover:bg-white/10 [.light-theme_&]:!bg-black/5 [.light-theme_&]:hover:!bg-black/10 rounded-full text-white/70 hover:text-white [.light-theme_&]:!text-slate-600 [.light-theme_&]:hover:!text-[#0f172a] transition" title={getDownloadTooltip("下载")}>
                                      <Download className="w-5 h-5" />
                                  </button>
                                  <button onClick={() => handleTogglePin(memo)} className={`w-10 h-10 flex items-center justify-center bg-white/5 hover:bg-white/10 [.light-theme_&]:!bg-black/5 [.light-theme_&]:hover:!bg-black/10 rounded-full transition ${memo.isPinned ? 'text-white [.light-theme_&]:!text-blue-600' : 'text-white/70 hover:text-white [.light-theme_&]:!text-slate-600 [.light-theme_&]:hover:!text-[#0f172a]'}`} title={memo.isPinned ? "取消置顶" : "置顶"}>
                                      <Pin className={`w-5 h-5 ${memo.isPinned ? 'fill-current' : ''}`} />
                                  </button>
                                  <button onClick={() => handleDelete(memo.id)} className="w-10 h-10 flex items-center justify-center bg-white/5 hover:bg-red-500/20 text-red-400 hover:text-red-300 [.light-theme_&]:!bg-red-50 [.light-theme_&]:!text-red-500 rounded-full transition shadow-sm" title="删除">
                                      <Trash2 className="w-5 h-5" />
                                  </button>
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
                        <button onClick={() => setIsEditingMemo(true)} className="p-1.5 hover:bg-white/10 rounded-full text-white/60 hover:text-white transition [.light-theme_&]:hover:bg-black/10 [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:text-[#1c1c1e] cursor-pointer" title="编辑笔记">
                           <Edit className="w-4.5 h-4.5" />
                        </button>
                     )}
                     <button onClick={() => { handleDelete(readingMemo.id); setReadingMemo(null); }} className="p-1.5 hover:bg-red-500/20 text-white/50 hover:text-red-400 rounded-full transition cursor-pointer" title="删除">
                        <Trash2 className="w-4.5 h-4.5" />
                     </button>
                     <button onClick={() => setReadingMemo(null)} className="p-1 hover:bg-white/10 rounded-full text-white/60 hover:text-white transition [.light-theme_&]:hover:bg-black/10 [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:text-[#1c1c1e] cursor-pointer" title="关闭">
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
            <div className="flex-1 overflow-auto p-4 sm:p-6 custom-scrollbar bg-black/20 [.light-theme_&]:bg-slate-50">
               {loading ? (
                  <div className="flex items-center justify-center h-full text-white/50 [.light-theme_&]:text-slate-400">正在解析数据...</div>
               ) : (
                  <pre className="text-[13px] text-slate-300 [.light-theme_&]:text-slate-800 font-mono whitespace-pre-wrap break-all">
                     {content.length > 50000 ? content.substring(0, 50000) + "\n\n... 内容过大，为防止卡顿已截断显示" : content}
                  </pre>
               )}
            </div>
        </motion.div>
    </div>,
    document.body
  );
}
