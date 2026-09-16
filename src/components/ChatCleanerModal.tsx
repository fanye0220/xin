import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Copy, GitBranch, X, CheckSquare, MessageSquare, Calendar, Eye, ArrowLeft } from 'lucide-react';
import { getAllChatsMetadata, getChatById, deleteChatsBulk, ChatLog, getChatsForCharacter, getCachedMeta } from '../lib/db';

interface ChatCleanerModalProps {
  isOpen: boolean;
  onClose: () => void;
  characterId?: string; // If provided, only clean for this character
  onDeleted: () => void;
}

export function ChatCleanerModal({ isOpen, onClose, characterId, onDeleted }: ChatCleanerModalProps) {
  const [mode, setMode] = useState<'menu' | 'duplicate' | 'branch'>('menu');
  const [loading, setLoading] = useState(false);
  
  const [groups, setGroups] = useState<{ id: string; characterName?: string; chats: any[] }[]>([]);
  const [selectedToDelete, setSelectedToDelete] = useState<Set<string>>(new Set());
  const [viewingChat, setViewingChat] = useState<ChatLog | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMode('menu');
      setGroups([]);
      setSelectedToDelete(new Set());
      setViewingChat(null);
    }
  }, [isOpen]);

  const handleDuplicateCheck = async () => {
    setLoading(true);
    setMode('duplicate');
    try {
      const allMeta = await getAllChatsMetadata();
      const allChars = await getCachedMeta();
      const charMap = new Map(allChars.map(c => [c.id, c.name]));

      const metaToProcess = characterId ? allMeta.filter(c => c.characterId === characterId || c.firstAiName === characterId /* loosely */) : allMeta;
      
      const map = new Map<string, typeof metaToProcess>();
      for (const meta of metaToProcess) {
        const sig = `${meta.characterId || meta.firstAiName || ''}_${meta.messageCount}_${meta.lastMessagePreview?.substring(0, 50) || ''}`;
        if (!map.has(sig)) map.set(sig, []);
        map.get(sig)!.push(meta);
      }
      
      const dupGroups = Array.from(map.values()).filter(g => g.length > 1);
      
      const toDelete = new Set<string>();
      const formattedGroups = dupGroups.map((g, i) => {
        // Sort descending by date (newest first keep)
        const sorted = [...g].sort((a,b) => b.createdAt - a.createdAt);
        // keep sorted[0], mark rest for deletion
        for (let j = 1; j < sorted.length; j++) {
          toDelete.add(sorted[j].id);
        }
        
        const first = sorted[0];
        
        let fallbackName = first.firstAiName;
        if (!fallbackName || fallbackName === 'AI' || fallbackName === 'System' || fallbackName === 'System Prompt') {
            // we don't have messages loaded here, so we just use first.firstAiName
            fallbackName = first.firstAiName; 
        }
        
        const charName = first.characterId ? charMap.get(first.characterId) : (fallbackName || '未归类 / Uncategorized');

        return {
          id: `dup_${i}`,
          characterName: charName,
          chats: sorted
        };
      });
      
      // Sort groups by character name
      formattedGroups.sort((a, b) => (a.characterName || '').localeCompare(b.characterName || ''));
      setGroups(formattedGroups);
      setSelectedToDelete(toDelete);
    } finally {
      setLoading(false);
    }
  };

  const handleBranchCheck = async () => {
    setLoading(true);
    setMode('branch');
    try {
      const allChars = await getCachedMeta();
      const charMap = new Map(allChars.map(c => [c.id, c.name]));

      const allChats: ChatLog[] = [];
      if (characterId) {
        const chars = await getChatsForCharacter(characterId);
        allChats.push(...chars);
      } else {
        const metas = await getAllChatsMetadata();
        for (const m of metas) {
           const c = await getChatById(m.id);
           if (c) allChats.push(c);
        }
      }
      
      const validChats = allChats.filter(c => c.messages && c.messages.length >= 2);

      const groupsMap = new Map<string, { charName: string, chats: ChatLog[] }>();

      for (const chat of validChats) {
          const charId = chat.characterId;
          
          let fallbackName = chat.firstAiName;
          if (!fallbackName || fallbackName === 'AI' || fallbackName === 'System' || fallbackName === 'System Prompt') {
             const firstAiMsg = chat.messages.find((m: any) => !m.is_user && m.name && m.name !== 'AI' && m.name !== 'System' && m.name !== 'System Prompt');
             if (firstAiMsg) fallbackName = firstAiMsg.name;
          }
          
          const charName = charId ? charMap.get(charId) : (fallbackName || '未归类角色');
          const safeCharName = charName || '未知角色';
          
          // 查找真正的 AI 开场白（跳过 System/System Prompt 等预设消息）
          const realGreeting = chat.messages.find((m: any) => !m.is_user && m.name !== 'System' && m.name !== 'System Prompt' && m.mes && m.mes.trim().length > 0);
          const firstMes = realGreeting ? realGreeting.mes : '';
          
          // 只要角色相同、且开场白（前30个有效字符）一致，就认为是同一开场白衍生出的分支。
          const sig = `${safeCharName}::${firstMes.substring(0, 30).replace(/\s/g, '').toLowerCase()}`;
          
          if (!groupsMap.has(sig)) groupsMap.set(sig, { charName: safeCharName, chats: [] });
          groupsMap.get(sig)!.chats.push(chat);
      }
      
      const branchGroupsList = Array.from(groupsMap.values())
        .filter(g => g.chats.length > 1)
        .map(g => {
            g.chats.sort((a, b) => (b.messages?.length || 0) - (a.messages?.length || 0));
            return g;
        });

      const formattedGroups = branchGroupsList.map((g, i) => {
        return {
          id: `branch_${i}`,
          characterName: g.charName,
          chats: g.chats
        };
      });
      
      formattedGroups.sort((a, b) => (a.characterName || '').localeCompare(b.characterName || ''));
      setGroups(formattedGroups);
      setSelectedToDelete(new Set()); // Let user select manually for branches
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (id: string) => {
    const next = new Set(selectedToDelete);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedToDelete(next);
  };

  const confirmDelete = async () => {
    if (selectedToDelete.size === 0) return;
    await deleteChatsBulk(Array.from(selectedToDelete));
    onDeleted();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center sm:p-6 bg-slate-900 sm:bg-black/60 sm:backdrop-blur-md :bg-[#1c1c1e]/40">
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className="relative w-full max-w-4xl h-[100dvh] sm:h-[85vh] sm:max-h-[85vh] bg-slate-900 sm:border border-white/10 sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden :border-black/5 (0,0,0,0.1)]"
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0 bg-white/[0.02] pt-[max(1rem,env(safe-area-inset-top))] ">
          <div className="flex items-center gap-2">
            <h3 className="text-white font-bold text-lg ">
              {mode === 'menu' ? '记录清理助手' : mode === 'duplicate' ? '查重清理' : '分支清理'}
            </h3>
          </div>
          <button onClick={onClose} className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-xl transition :text-black :bg-black/5">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar">
          {mode === 'menu' && (
             <div className="flex flex-col h-full items-center justify-center max-w-2xl mx-auto space-y-10 py-8">
               <div className="text-center space-y-2">
                 <h2 className="text-2xl font-bold text-white tracking-wide ">清理工具</h2>
                 <p className="text-white/50 ">整理和优化您的角色对话记录</p>
               </div>
               
               <div className="grid sm:grid-cols-2 gap-6 w-full">
                 <button
                   onClick={handleDuplicateCheck}
                   className="group relative overflow-hidden bg-gradient-to-b from-white/10 to-white/5 border border-white/10 hover:border-orange-500/50 rounded-2xl p-6 text-left transition-all duration-300 hover:shadow-lg hover:shadow-orange-500/10 hover:-translate-y-1 :shadow-md :border-orange-400/30"
                 >
                   <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                     <Copy className="w-24 h-24 text-orange-400 transform rotate-12" />
                   </div>
                   <div className="relative z-10 flex flex-col gap-4">
                     <div className="w-12 h-12 bg-gradient-to-br from-orange-400/20 to-orange-600/20 text-orange-400 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-sm">
                       <Copy className="w-6 h-6" />
                     </div>
                     <div>
                       <h4 className="text-lg font-semibold text-white mb-2 ">查重清理</h4>
                       <p className="text-sm text-white/60 leading-relaxed ">
                         找出内容完全一致的重复记录，自动为您勾选较旧版本以供删除，快速释放空间。
                       </p>
                     </div>
                   </div>
                 </button>

                 <button
                   onClick={handleBranchCheck}
                   className="group relative overflow-hidden bg-gradient-to-b from-white/10 to-white/5 border border-white/10 hover:border-purple-500/50 rounded-2xl p-6 text-left transition-all duration-300 hover:shadow-lg hover:shadow-purple-500/10 hover:-translate-y-1 :shadow-md :border-purple-400/30"
                 >
                   <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                     <GitBranch className="w-24 h-24 text-purple-400 transform rotate-12" />
                   </div>
                   <div className="relative z-10 flex flex-col gap-4">
                     <div className="w-12 h-12 bg-gradient-to-br from-purple-400/20 to-purple-600/20 text-purple-400 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-sm">
                       <GitBranch className="w-6 h-6" />
                     </div>
                     <div>
                       <h4 className="text-lg font-semibold text-white mb-2 ">分支清理</h4>
                       <p className="text-sm text-white/60 leading-relaxed ">
                         以角色的开场白智能归类，为您找出具有相同开端的平行分支对话。
                       </p>
                     </div>
                   </div>
                 </button>
               </div>
             </div>
          )}

          {mode !== 'menu' && (
            <div className="space-y-4">
              {loading ? (
                <div className="py-20 flex flex-col items-center justify-center space-y-4">
                  <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-white/50 text-sm ">正在检索记录...</p>
                </div>
              ) : groups.length === 0 ? (
                <div className="py-20 flex flex-col items-center justify-center text-white/40 ">
                  {mode === 'duplicate' ? <Copy className="w-12 h-12 mb-3 opacity-20" /> : <GitBranch className="w-12 h-12 mb-3 opacity-20" />}
                  <p>没有找到符合条件的记录</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {groups.map((group, gIdx) => (
                    <div key={group.id} className="bg-slate-800 rounded-2xl border border-white/5 overflow-hidden shadow-sm ">
                      <div className="px-4 py-3 bg-white/[0.02] border-b border-white/[0.05] flex items-center justify-between ">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${mode === 'duplicate' ? 'bg-orange-500/10 text-orange-400' : 'bg-purple-500/10 text-purple-400'}`}>
                            {mode === 'duplicate' ? <Copy className="w-4 h-4" /> : <GitBranch className="w-4 h-4" />}
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-white/90 ">{(group as any).characterName || '未归类角色'}</h4>
                            <div className="text-[10px] text-white/50 flex items-center gap-2 mt-0.5 ">
                              <span className="uppercase tracking-wider">GROUP {gIdx + 1}</span>
                              <span className="w-1 h-1 rounded-full bg-white/20 "></span>
                              <span>{group.chats.length} 条记录</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="p-3 bg-black/10 space-y-2 ">
                        {group.chats.map((chat: any, idx: number) => {
                          const isMain = idx === 0 && mode === 'duplicate'; // Auto-keep the first one in duplicate mode (newest)
                          const isSelected = selectedToDelete.has(chat.id);
                          return (
                            <div 
                              key={chat.id} 
                              onClick={() => toggleSelection(chat.id)}
                              className={`p-4 rounded-xl flex items-center gap-4 cursor-pointer transition-all duration-200 border ${isSelected ? 'bg-red-500/10 border-red-500/30 shadow-[inset_0_2px_10px_rgba(239,68,68,0.1)]' : isMain ? 'bg-green-500/10 border-green-500/20 ' : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10 :bg-black/5'}`}
                            >
                              <div className="shrink-0">
                                 {isSelected ? (
                                   <div className="w-5 h-5 rounded bg-red-500 text-white flex items-center justify-center shadow-sm">
                                      <CheckSquare className="w-3.5 h-3.5" />
                                   </div>
                                 ) : (
                                   <div className={`w-5 h-5 border rounded flex items-center justify-center ${isMain ? 'border-green-500/50 bg-green-500/5' : 'border-white/20 '}`} />
                                 )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <h4 className={`text-sm font-medium truncate ${isSelected ? 'line-through text-white/40 ' : 'text-white/90 '}`}>{chat.name || '未命名聊天'}</h4>
                                  {isMain && !isSelected && <span className="text-[10px] px-1.5 py-0.5 bg-green-500/10 text-green-400 rounded-md border border-green-500/20 shrink-0">最新记录 (推荐保留)</span>}
                                  {idx === 0 && mode === 'branch' && !isSelected && <span className="text-[10px] px-1.5 py-0.5 bg-purple-500/10 text-purple-400 rounded-md border border-purple-500/20 shrink-0">最长分支</span>}
                                </div>
                                <div className="text-xs text-white/40 flex flex-wrap items-center gap-3 mt-1.5 ">
                                  <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3 text-white/30 " /> {chat.messageCount || chat.messages?.length || 0} 楼</span>
                                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3 text-white/30 " /> {new Date(chat.createdAt).toLocaleString()}</span>
                                </div>
                                <div className="mt-2 text-[11px] text-white/30 line-clamp-1 italic ">
                                  "{chat.lastMessagePreview || (chat.messages && chat.messages.length > 0 ? chat.messages[chat.messages.length - 1]?.mes?.substring(0, 50) : '')}..."
                                </div>
                              </div>
                              <div className="shrink-0 flex items-center">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setViewingChat(chat); }}
                                  className="px-2.5 py-2 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-lg transition-colors flex items-center gap-1.5 text-xs whitespace-nowrap :bg-black/10 :text-black"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span className="hidden sm:inline">查看</span>
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {mode !== 'menu' && (
          <div className="p-4 border-t border-white/10 flex justify-between items-center bg-black/20 sm:rounded-b-2xl shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))] ">
             <div className="text-sm text-white/50 ">
                {selectedToDelete.size > 0 ? (
                    <span className="text-red-400">已选中 {selectedToDelete.size} 个记录准备清理</span>
                ) : (
                    <span className="">请勾选不需要的记录以进行清理</span>
                )}
             </div>
             <div className="flex gap-3">
                <button
                  onClick={() => setMode('menu')}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/10 transition :text-black :bg-black/5"
                >
                  返回
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={selectedToDelete.size === 0}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:hover:bg-red-600 transition flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  清理选中项
                </button>
             </div>
          </div>
        )}

        <AnimatePresence>
          {viewingChat && (
            <motion.div
              initial={{ x: '100%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 250 }}
              className="absolute inset-y-0 right-0 w-full sm:w-[450px] bg-slate-900 border-l border-white/10 z-20 flex flex-col shadow-2xl "
            >
              <div className="flex items-center gap-3 p-4 border-b border-white/10 shrink-0 bg-white/[0.02] pt-[max(1rem,env(safe-area-inset-top))] ">
                <button 
                  onClick={() => setViewingChat(null)} 
                  className="p-2 hover:bg-white/10 rounded-xl transition-colors :bg-black/5"
                >
                  <ArrowLeft className="w-5 h-5 text-white " />
                </button>
                <div>
                  <h3 className="text-white font-medium line-clamp-1 max-w-[280px] ">{viewingChat.name || '聊天详情'}</h3>
                  <div className="text-[11px] text-white/50 mt-0.5 ">{viewingChat.messages?.length || 0} 条消息</div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950/20 custom-scrollbar pb-[max(1rem,env(safe-area-inset-bottom))] ">
                 {viewingChat.messages?.map((m: any, i: number) => (
                    <div key={i} className={`flex flex-col ${m.is_user ? 'items-end' : 'items-start'}`}>
                       <span className={`text-[10px] text-white/30 mb-1 px-1 uppercase tracking-wider `}>{m.is_user ? 'User' : (m.name || 'AI')}</span>
                       <div className={`p-4 rounded-2xl max-w-[88%] text-sm leading-relaxed shadow-sm ${m.is_user ? 'bg-blue-600/20 text-blue-50 border border-blue-500/20 rounded-tr-sm [.light-theme_&]:bg-blue-600/90 [.light-theme_&]:text-white [.light-theme_&]:border-blue-500/30' : 'bg-white/[0.04] text-white/90 border border-white/5 rounded-tl-sm [.light-theme_&]:bg-indigo-950/80 [.light-theme_&]:text-indigo-100 [.light-theme_&]:border-indigo-500/20'}`}>
                          {m.mes}
                       </div>
                    </div>
                 ))}
                 {!viewingChat.messages?.length && (
                   <div className="flex flex-col items-center justify-center text-white/30 py-20 ">
                     <MessageSquare className="w-12 h-12 mb-3 opacity-20" />
                     <span>该记录没有任何消息</span>
                   </div>
                 )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
