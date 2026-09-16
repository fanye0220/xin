import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { getMemosForCharacter, saveMemo, deleteMemo, CharacterMemo } from '../lib/db';
import { StickyNote, Image as ImageIcon, File, Trash2, Plus, Download, X, Share2, Pin, Edit, FileUp, Eye } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

export function CharacterMemosSection({ characterId }: { characterId: string }) {
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

  const handleDownloadFile = (memo: CharacterMemo, share: boolean = false) => {
      if (!memo.blob) return;
      if (typeof window !== 'undefined' && !!(window as any).Android) {
          Promise.all([
              import('../lib/appBridge')
          ]).then(async ([{ shareFileOnAndroid, exportFileToMIU }]) => {
              const buffer = await memo.blob!.arrayBuffer();
              if (share) {
                  await shareFileOnAndroid(memo.content, buffer);
              } else {
                  await exportFileToMIU(memo.content, buffer, memo.blob!.type || '', false);
              }
          });
          return;
      }

      const url = URL.createObjectURL(memo.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = memo.content;
      a.click();
      URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h3 className="text-xl font-bold text-white flex items-center gap-2">
           <StickyNote className="w-5 h-5 text-blue-400 shrink-0" />
           <span className="truncate">备忘录与剧场</span>
        </h3>
        <div className="flex gap-2 self-start sm:self-auto w-full sm:w-auto">
            <button
                onClick={() => setIsReorderingMode(!isReorderingMode)}
                className={`flex-1 sm:flex-none justify-center px-3 py-2 ${isReorderingMode ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-white/5 text-white/70 border-white/10'} hover:bg-white/10 border rounded-lg text-sm transition flex items-center gap-1.5`}
            >
                <Edit className="w-4 h-4" />
                {isReorderingMode ? '完成' : '排序'}
            </button>
            <button
                onClick={() => setIsAddingMode(true)}
                className="flex-1 sm:flex-none justify-center px-3 py-2 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 rounded-lg text-sm transition flex items-center gap-1.5"
            >
                <Plus className="w-4 h-4" />
                笔记
            </button>
            <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 sm:flex-none justify-center px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 rounded-lg text-sm transition flex items-center gap-1.5"
            >
                <FileUp className="w-4 h-4" />
                更多
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
            className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex justify-center items-center p-4 sm:p-6"
            onClick={() => setIsAddingMode(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-slate-900 border border-white/10 shadow-2xl rounded-2xl flex flex-col w-full max-h-[85vh] max-w-3xl overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex-none p-4 sm:p-6 border-b border-white/10 flex items-center justify-between bg-black/20">
                 <h3 className="font-bold text-lg text-white flex items-center gap-2">
                    <Plus className="w-5 h-5 text-purple-400" />
                    新建笔记
                 </h3>
                 <button onClick={() => setIsAddingMode(false)} className="p-2 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-xl transition">
                    <X className="w-5 h-5" />
                 </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-900 flex flex-col gap-4">
                <textarea 
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl p-4 text-white resize-none min-h-[200px] focus:outline-none focus:border-purple-500/50"
                  placeholder="在这里写下脑洞、小剧场或设定补充（支持 Markdown）"
                  value={newText}
                  onChange={e => setNewText(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="flex-none p-4 sm:p-6 border-t border-white/10 flex justify-end gap-2 bg-black/20">
                  <button 
                    onClick={() => setIsAddingMode(false)}
                    className="px-5 py-2.5 rounded-xl text-sm bg-white/5 hover:bg-white/10 text-white/70 transition"
                  >
                      取消
                  </button>
                  <button 
                    onClick={handleCreateTextMemo}
                    className="px-5 py-2.5 rounded-xl text-sm bg-purple-500 hover:bg-purple-600 text-white transition font-medium shadow-lg shadow-purple-500/20 disabled:opacity-50"
                    disabled={!newText.trim()}
                  >
                      保存笔记
                  </button>
              </div>
            </motion.div>
          </motion.div>
      )}
      </AnimatePresence>
, document.body)}

      {memos.length === 0 && !isAddingMode ? (
         <div className="flex flex-col items-center justify-center p-12 bg-white/5 rounded-2xl border border-white/10 text-center border-dashed border-2">
            <StickyNote className="w-12 h-12 text-white/20 mb-4" />
            <h4 className="text-white/80 font-medium mb-2">暂无备忘信息</h4>
            <p className="text-white/40 text-sm max-w-sm">
              你可以用它来记录设定补充、剧本大纲、贴图或是存储写好的小剧场。
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
                      className={`bg-white/5 border ${memo.isPinned ? 'border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.15)]' : 'border-white/10'} rounded-xl overflow-hidden group break-inside-avoid shadow-lg relative ${isReorderingMode ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  >
                                            {memo.type !== 'file' && (
                          <div className="absolute top-3 right-3 flex gap-2 z-10 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                              <button
                                  onClick={() => handleTogglePin(memo)}
                                 className={`p-2 bg-black/40 ${memo.isPinned ? 'text-purple-400' : 'text-white/50 hover:text-white'} hover:bg-white/10 rounded-lg transition`}
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
                              <div className="p-2 text-purple-400">
                                 <Pin className="w-4 h-4 fill-current" />
                              </div>
                          </div>
                      )}

                                            {memo.type === 'text' && (
                          <div className="p-5 cursor-pointer group/text relative" onClick={() => { setReadingMemo(memo); setEditMemoContent(memo.content); setIsEditingMemo(false); }}>
                             <div className="prose prose-sm prose-invert memo-prose-adapt max-w-none text-white/80 leading-relaxed markdown-body line-clamp-[8]">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {memo.content}
                                </ReactMarkdown>
                             </div>
                             <div className="absolute inset-0 bg-gradient-to-t from-[#1b2234] via-transparent to-transparent opacity-0 group-hover/text:opacity-100 transition-opacity flex items-end justify-center pb-4">
                               <span className="bg-white/10 backdrop-blur-md px-3 py-1 rounded-full text-xs text-white shadow-lg pointer-events-none">
                                 点击全屏阅读
                               </span>
                             </div>
                             <div className="mt-4 text-[11px] text-white/30 relative z-10">
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
                                 <button onClick={() => setViewingMemoFile(memo)} className="p-1.5 bg-black/40 hover:bg-purple-500 text-white/70 hover:text-white rounded-lg transition" title="查看数据">
                                    <Eye className="w-4 h-4" />
                                 </button>
                                 
                                 <button onClick={() => handleDownloadFile(memo, false)} className="p-1.5 bg-black/40 hover:bg-blue-500 text-white/70 hover:text-white rounded-lg transition" title={typeof window !== 'undefined' && !!(window as any).Android ? "下载到MIU目录" : "下载"}>
                                    <Download className="w-4 h-4" />
                                 </button>
                             </div>
                          </div>
                      )}

                      {memo.type === 'file' && memo.blob && (
                          <div className="p-4 sm:p-5 flex items-center gap-4">
                              <div className="w-12 h-12 bg-blue-500/20 text-blue-400 rounded-xl flex items-center justify-center shrink-0 shadow-inner">
                                  <File className="w-6 h-6" />
                              </div>
                              <div className="flex-1 min-w-0">
                                  <div className="text-[15px] font-medium text-white/90 truncate">{memo.content}</div>
                                  <div className="text-xs text-white/40 mt-1">{new Date(memo.createdAt).toLocaleString()}</div>
                              </div>
                              <div className="flex gap-1 sm:gap-2 shrink-0 items-center">
                                  <button onClick={() => setViewingMemoFile(memo)} className="w-10 h-10 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-full text-white/70 hover:text-white transition" title="查看内容">
                                      <Eye className="w-5 h-5" />
                                  </button>
                                  
                                  <button onClick={() => handleDownloadFile(memo, false)} className="w-10 h-10 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-full text-white/70 hover:text-white transition" title={typeof window !== 'undefined' && !!(window as any).Android ? "下载到MIU目录" : "下载"}>
                                      <Download className="w-5 h-5" />
                                  </button>
                                  <button onClick={() => handleTogglePin(memo)} className={`w-10 h-10 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-full transition ${memo.isPinned ? 'text-purple-400' : 'text-white/70 hover:text-white'}`} title={memo.isPinned ? "取消置顶" : "置顶"}>
                                      <Pin className={`w-5 h-5 ${memo.isPinned ? 'fill-current' : ''}`} />
                                  </button>
                                  <button onClick={() => handleDelete(memo.id)} className="w-10 h-10 flex items-center justify-center bg-white/5 hover:bg-red-500/20 text-red-400 hover:text-red-300 rounded-full transition shadow-sm" title="删除">
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
             className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex justify-center items-center p-4 sm:p-6"
             onClick={() => setReadingMemo(null)}
           >
             <motion.div
               initial={{ scale: 0.95, opacity: 0, y: 20 }}
               animate={{ scale: 1, opacity: 1, y: 0 }}
               exit={{ scale: 0.95, opacity: 0, y: 20 }}
               className="bg-slate-900 border border-white/10 shadow-2xl rounded-2xl flex flex-col w-full max-h-[85vh] max-w-4xl overflow-hidden"
               onClick={e => e.stopPropagation()}
             >
               <div className="flex-none p-4 sm:p-6 border-b border-white/10 flex items-center justify-between bg-black/20">
                  <div className="flex items-center gap-3">
                     <StickyNote className="w-5 h-5 text-blue-400" />
                     <h3 className="font-bold text-lg text-white">备忘录</h3>
                     <span className="text-sm text-white/40 ml-2 hidden sm:inline">{new Date(readingMemo.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                     {!isEditingMemo && readingMemo.type === 'text' && (
                        <button onClick={() => setIsEditingMemo(true)} className="p-2 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white rounded-xl transition" title="编辑笔记">
                           <Edit className="w-5 h-5" />
                        </button>
                     )}
                     <button onClick={() => { handleDelete(readingMemo.id); setReadingMemo(null); }} className="p-2 bg-white/5 hover:bg-red-500/20 text-white/50 hover:text-red-400 rounded-xl transition">
                        <Trash2 className="w-5 h-5" />
                     </button>
                     <button onClick={() => setReadingMemo(null)} className="p-2 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-xl transition">
                        <X className="w-5 h-5" />
                     </button>
                  </div>
               </div>
               <div className="flex-1 overflow-y-auto p-4 sm:p-8 md:p-12 bg-slate-900 relative">
                  {isEditingMemo ? (
                    <div className="h-full flex flex-col gap-4">
                       <textarea 
                           className="flex-1 bg-white/5 border border-white/10 rounded-xl p-4 text-white resize-none focus:outline-none focus:border-purple-500/50"
                           value={editMemoContent}
                           onChange={e => setEditMemoContent(e.target.value)}
                       />
                       <div className="flex justify-end gap-2">
                           <button onClick={() => setIsEditingMemo(false)} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 transition">取消</button>
                           <button onClick={handleSaveEdit} className="px-4 py-2 rounded-lg bg-purple-500 hover:bg-purple-600 text-white transition font-medium" disabled={!editMemoContent.trim()}>保存</button>
                       </div>
                    </div>
                  ) : (
                    <div className="prose prose-invert memo-prose-adapt prose-base sm:prose-lg max-w-none text-white/80 leading-relaxed markdown-body" onClick={e => e.stopPropagation()}>
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
    <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-4 sm:p-6" onClick={onClose}>
        <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}
        >
            <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/20">
               <h3 className="font-semibold text-white/90 truncate pr-4 flex items-center gap-2">
                 <File className="w-5 h-5 text-blue-400" />
                 {memo.content}
               </h3>
               <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition">
                  <X className="w-5 h-5 text-white/60" />
               </button>
            </div>
            <div className="flex-1 overflow-auto p-4 custom-scrollbar bg-[#0f111a]">
               {loading ? (
                  <div className="flex items-center justify-center h-full text-white/50">正在解析数据...</div>
               ) : (
                  <pre className="text-[13px] text-slate-300 font-mono whitespace-pre-wrap break-all">
                     {content.length > 50000 ? content.substring(0, 50000) + "\n\n... (内容过大，为防止卡顿已截断显示)" : content}
                  </pre>
               )}
            </div>
        </motion.div>
    </div>,
    document.body
  );
}
