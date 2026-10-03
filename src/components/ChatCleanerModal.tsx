import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Copy, GitBranch, X, Check, MessageSquare, Calendar, Eye, ArrowLeft } from 'lucide-react';
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
    <div className="fixed inset-0 z-[200] flex items-center justify-center sm:p-6 bg-slate-900 [.light-theme_&]:!bg-black/40 sm:bg-black/60 sm:backdrop-blur-md">
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className="relative w-full max-w-4xl h-[100dvh] sm:h-[85vh] sm:max-h-[85vh] bg-slate-900 [.light-theme_&]:!bg-[#ffffff] sm:border border-white/10 [.light-theme_&]:!border-[#e2e8f0] sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden text-white [.light-theme_&]:!text-[#0f172a]"
      >
        {/* Header - Left aligned navigation/close button */}
        <div className="flex items-center gap-3 p-4 border-b border-white/10 [.light-theme_&]:!border-[#cbd5e1] shrink-0 bg-white/[0.04] [.light-theme_&]:!bg-[#ffffff] pt-[max(1.75rem,env(safe-area-inset-top))] sm:pt-[max(1.75rem,env(safe-area-inset-top))]">
          <button 
            onClick={mode !== 'menu' ? () => setMode('menu') : onClose} 
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-xl transition [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:hover:!bg-black/5 cursor-pointer active:scale-95"
            title={mode !== 'menu' ? "返回上一级" : "关闭"}
          >
            {mode !== 'menu' ? <ArrowLeft className="w-5 h-5 stroke-[2]" /> : <X className="w-5 h-5 stroke-[2]" />}
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <h3 className="text-white [.light-theme_&]:!text-[#0f172a] font-bold text-base sm:text-lg truncate">
              {mode === 'menu' ? '记录清理助手' : mode === 'duplicate' ? '查重清理' : '分支清理'}
            </h3>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar [.light-theme_&]:!bg-[#f8fafc]">
          {mode === 'menu' && (
             <div className="flex flex-col h-full items-center justify-center max-w-2xl mx-auto space-y-10 py-8">
               <div className="text-center space-y-2">
                 <h2 className="text-2xl font-bold text-white [.light-theme_&]:!text-[#0f172a] tracking-wide">清理工具</h2>
                 <p className="text-sm font-medium text-white/80 [.light-theme_&]:!text-[#475569]">整理和优化您的角色对话记录</p>
               </div>
               
               <div className="grid sm:grid-cols-2 gap-6 w-full">
                 <button
                   onClick={handleDuplicateCheck}
                   className="group relative overflow-hidden bg-slate-800/90 hover:bg-slate-800 border border-white/15 hover:border-orange-500/50 rounded-2xl p-6 text-left transition-all duration-300 hover:shadow-lg hover:shadow-orange-500/10 hover:-translate-y-1 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:!shadow-sm [.light-theme_&]:hover:!border-orange-400 cursor-pointer"
                 >
                   <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity [.light-theme_&]:opacity-5">
                     <Copy className="w-24 h-24 text-orange-400 transform rotate-12" />
                   </div>
                   <div className="relative z-10 flex flex-col gap-4">
                     <div className="w-12 h-12 bg-orange-500/20 text-orange-400 [.light-theme_&]:!bg-orange-50 [.light-theme_&]:!text-orange-500 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-xs">
                       <Copy className="w-6 h-6 stroke-[2]" />
                     </div>
                     <div>
                       <h4 className="text-lg font-bold text-white [.light-theme_&]:!text-[#0f172a] mb-2">查重清理</h4>
                       <p className="text-sm font-medium text-white/80 [.light-theme_&]:!text-[#475569] leading-relaxed">
                         找出内容完全一致的重复记录，自动为您勾选较旧版本以供删除，快速释放空间。
                       </p>
                     </div>
                   </div>
                 </button>

                 <button
                   onClick={handleBranchCheck}
                   className="group relative overflow-hidden bg-slate-800/90 hover:bg-slate-800 border border-white/15 hover:border-blue-500/50 rounded-2xl p-6 text-left transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/10 hover:-translate-y-1 [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-[#cbd5e1] [.light-theme_&]:!shadow-sm [.light-theme_&]:hover:!border-blue-400 cursor-pointer"
                 >
                   <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity [.light-theme_&]:opacity-5">
                     <GitBranch className="w-24 h-24 text-blue-400 transform rotate-12" />
                   </div>
                   <div className="relative z-10 flex flex-col gap-4">
                     <div className="w-12 h-12 bg-blue-500/20 text-blue-400 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-blue-500 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-xs">
                       <GitBranch className="w-6 h-6 stroke-[2]" />
                     </div>
                     <div>
                       <h4 className="text-lg font-bold text-white [.light-theme_&]:!text-[#0f172a] mb-2">分支清理</h4>
                       <p className="text-sm font-medium text-white/80 [.light-theme_&]:!text-[#475569] leading-relaxed">
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
                  <p className="text-white/80 [.light-theme_&]:!text-[#475569] text-sm font-medium">正在检索记录...</p>
                </div>
              ) : groups.length === 0 ? (
                <div className="py-20 flex flex-col items-center justify-center text-white/70 [.light-theme_&]:!text-[#475569] space-y-3">
                  {mode === 'duplicate' ? <Copy className="w-12 h-12 mb-1 opacity-30 text-white [.light-theme_&]:!text-[#64748b]" /> : <GitBranch className="w-12 h-12 mb-1 opacity-30 text-white [.light-theme_&]:!text-[#64748b]" />}
                  <p className="text-sm font-medium">没有找到符合条件的记录</p>
                  <button
                    onClick={() => setMode('menu')}
                    className="mt-2 px-5 py-2 rounded-xl text-xs sm:text-sm font-semibold text-white/90 hover:text-white bg-white/10 hover:bg-white/20 border border-white/10 transition [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#cbd5e1] cursor-pointer"
                  >
                    返回上一级
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  {groups.map((group, gIdx) => (
                    <div key={group.id} className="bg-slate-800/80 [.light-theme_&]:!bg-[#ffffff] rounded-2xl border border-white/10 [.light-theme_&]:!border-[#cbd5e1] overflow-hidden shadow-sm mb-6">
                      <div className="px-4 py-3 bg-white/[0.04] [.light-theme_&]:!bg-[#f8fafc] border-b border-white/10 [.light-theme_&]:!border-[#e2e8f0] flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${mode === 'duplicate' ? 'bg-orange-500/20 text-orange-400 [.light-theme_&]:!bg-orange-50 [.light-theme_&]:!text-orange-600' : 'bg-blue-500/20 text-blue-400 [.light-theme_&]:!bg-blue-50 [.light-theme_&]:!text-[#007aff]'}`}>
                            {mode === 'duplicate' ? <Copy className="w-4 h-4" /> : <GitBranch className="w-4 h-4" />}
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-white [.light-theme_&]:!text-[#0f172a]">{(group as any).characterName || '未归类角色'}</h4>
                            <div className="text-[11px] font-medium text-white/70 [.light-theme_&]:!text-[#475569] flex items-center gap-2 mt-0.5">
                              <span className="uppercase tracking-wider font-semibold">GROUP {gIdx + 1}</span>
                              <span className="w-1 h-1 rounded-full bg-white/40 [.light-theme_&]:!bg-black/30"></span>
                              <span>{group.chats.length} 条记录</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="p-3.5 space-y-3 bg-black/10 [.light-theme_&]:!bg-[#f8fafc]/50">
                        {group.chats.map((chat: any, idx: number) => {
                          const isMain = idx === 0 && mode === 'duplicate'; // Auto-keep the first one in duplicate mode (newest)
                          const isSelected = selectedToDelete.has(chat.id);
                          return (
                            <div 
                              key={chat.id} 
                              onClick={() => toggleSelection(chat.id)}
                              className={`p-4 rounded-xl flex items-center gap-3.5 cursor-pointer transition-all duration-200 border ${
                                isSelected 
                                  ? 'bg-rose-500/15 border-rose-500/50 [.light-theme_&]:!bg-[#fff1f2] [.light-theme_&]:!border-rose-300 shadow-sm' 
                                  : isMain 
                                    ? 'bg-emerald-500/10 border-emerald-500/30 [.light-theme_&]:!bg-[#f0fdf4] [.light-theme_&]:!border-emerald-300 shadow-sm' 
                                    : 'bg-white/[0.04] border-white/10 hover:border-white/20 hover:bg-white/[0.08] [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!border-[#e2e8f0] [.light-theme_&]:hover:!border-[#cbd5e1] [.light-theme_&]:hover:!bg-[#fcfcfd] shadow-xs'
                              }`}
                            >
                              <div className="shrink-0">
                                 {isSelected ? (
                                   <div className="w-5.5 h-5.5 rounded-full bg-[#ff3b30] text-white flex items-center justify-center shadow-xs transition-transform active:scale-95">
                                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                                   </div>
                                 ) : (
                                   <div className={`w-5.5 h-5.5 rounded-full border-2 flex items-center justify-center transition-colors ${
                                     isMain 
                                       ? 'border-emerald-500 bg-emerald-500/10' 
                                       : 'border-white/30 [.light-theme_&]:!border-[#cbd5e1] hover:[.light-theme_&]:!border-[#94a3b8]'
                                   }`} />
                                 )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <h4 className={`text-sm font-semibold truncate ${isSelected ? 'line-through opacity-60 text-white [.light-theme_&]:!text-[#94a3b8]' : 'text-white [.light-theme_&]:!text-[#0f172a]'}`}>{chat.name || '未命名聊天'}</h4>
                                  {isMain && !isSelected && <span className="text-[10.5px] px-2.5 py-0.5 rounded-full font-bold shrink-0 bg-[#34c759] text-white shadow-xs">最新记录 (推荐保留)</span>}
                                  {idx === 0 && mode === 'branch' && !isSelected && <span className="text-[10.5px] px-2.5 py-0.5 rounded-full font-bold shrink-0 bg-[#007aff] text-white shadow-xs">最长分支</span>}
                                </div>
                                <div className="text-xs text-white/70 [.light-theme_&]:!text-[#64748b] font-medium flex flex-wrap items-center gap-3 mt-1.5">
                                  <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5 text-white/60 [.light-theme_&]:!text-[#64748b]" /> {chat.messageCount || chat.messages?.length || 0} 楼</span>
                                  <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-white/60 [.light-theme_&]:!text-[#64748b]" /> {new Date(chat.createdAt).toLocaleString()}</span>
                                </div>
                                <div className="mt-2 text-xs text-white/70 [.light-theme_&]:!text-[#64748b] line-clamp-1 italic">
                                  "{chat.lastMessagePreview || (chat.messages && chat.messages.length > 0 ? chat.messages[chat.messages.length - 1]?.mes?.substring(0, 50) : '')}..."
                                </div>
                              </div>
                              <div className="shrink-0 flex items-center">
                                <button
                                  onClick={(e) => { e.stopPropagation(); setViewingChat(chat); }}
                                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap border border-white/10 [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#334155] [.light-theme_&]:!border-[#cbd5e1] shadow-xs cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5 text-white/70 [.light-theme_&]:!text-[#64748b]" />
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

        {mode !== 'menu' && groups.length > 0 && !loading && (
          <div className="p-3.5 sm:p-4 border-t border-white/10 [.light-theme_&]:!border-[#cbd5e1] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-black/30 [.light-theme_&]:!bg-[#ffffff] sm:rounded-b-2xl shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
             <div className="text-xs sm:text-sm font-medium text-white/80 [.light-theme_&]:!text-[#334155] text-center sm:text-left">
                {selectedToDelete.size > 0 ? (
                    <span className="text-rose-400 [.light-theme_&]:!text-[#e11d48] font-bold">已选中 {selectedToDelete.size} 个记录准备清理</span>
                ) : (
                    <span>请勾选不需要的记录以进行清理</span>
                )}
             </div>
             <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
                <button
                  onClick={() => setMode('menu')}
                  className="flex-1 sm:flex-none justify-center px-4 py-2.5 sm:py-2 rounded-xl text-xs sm:text-sm font-semibold text-white/90 hover:text-white bg-white/10 hover:bg-white/20 border-0 border-none transition [.light-theme_&]:!bg-[#f1f5f9] [.light-theme_&]:hover:!bg-[#e2e8f0] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-none cursor-pointer whitespace-nowrap"
                >
                  返回
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={selectedToDelete.size === 0}
                  className="flex-1 sm:flex-none justify-center px-4 py-2.5 sm:py-2 rounded-xl text-xs sm:text-sm font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:hover:bg-rose-600 transition flex items-center gap-1.5 cursor-pointer shadow-md whitespace-nowrap"
                >
                  <Trash2 className="w-4 h-4 shrink-0" />
                  <span>清理选中项</span>
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
              className="absolute inset-y-0 right-0 w-full sm:w-[450px] bg-slate-900 [.light-theme_&]:!bg-[#ffffff] border-l border-white/10 [.light-theme_&]:!border-[#cbd5e1] z-20 flex flex-col shadow-2xl"
            >
              <div className="flex items-center gap-3 p-4 border-b border-white/10 [.light-theme_&]:!border-[#cbd5e1] shrink-0 bg-white/[0.04] [.light-theme_&]:!bg-[#ffffff] pt-[max(1.75rem,env(safe-area-inset-top))] sm:pt-[max(1.75rem,env(safe-area-inset-top))]">
                <button 
                  onClick={() => setViewingChat(null)} 
                  className="p-2 hover:bg-white/10 rounded-xl transition-colors [.light-theme_&]:hover:!bg-black/5 [.light-theme_&]:!text-[#0f172a] cursor-pointer"
                >
                  <ArrowLeft className="w-5 h-5 text-white [.light-theme_&]:!text-[#0f172a]" />
                </button>
                <div>
                  <h3 className="text-white [.light-theme_&]:!text-[#0f172a] font-bold line-clamp-1 max-w-[280px]">{viewingChat.name || '聊天详情'}</h3>
                  <div className="text-xs font-medium text-white/70 [.light-theme_&]:!text-[#475569] mt-0.5">{viewingChat.messages?.length || 0} 条消息</div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950/40 [.light-theme_&]:!bg-[#f8fafc] custom-scrollbar pb-[max(1rem,env(safe-area-inset-bottom))]">
                 {viewingChat.messages?.map((m: any, i: number) => (
                    <div key={i} className={`flex flex-col ${m.is_user ? 'items-end' : 'items-start'}`}>
                       <span className="text-[11px] font-semibold text-white/60 [.light-theme_&]:!text-[#64748b] mb-1 px-1 uppercase tracking-wider">{m.is_user ? 'User' : (m.name || 'AI')}</span>
                       <div className={`p-3.5 rounded-2xl max-w-[88%] text-sm leading-relaxed shadow-xs ${m.is_user ? 'bg-blue-600 text-white border border-blue-500 rounded-tr-sm [.light-theme_&]:!bg-[#007aff] [.light-theme_&]:!text-white [.light-theme_&]:!border-transparent' : 'bg-slate-800 text-white border border-white/10 rounded-tl-sm [.light-theme_&]:!bg-[#ffffff] [.light-theme_&]:!text-[#0f172a] [.light-theme_&]:!border-[#cbd5e1]'}`}>
                          {m.mes}
                       </div>
                    </div>
                 ))}
                 {!viewingChat.messages?.length && (
                   <div className="flex flex-col items-center justify-center text-white/60 [.light-theme_&]:!text-[#475569] py-20">
                     <MessageSquare className="w-12 h-12 mb-3 opacity-30" />
                     <span className="text-sm font-medium">该记录没有任何消息</span>
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
