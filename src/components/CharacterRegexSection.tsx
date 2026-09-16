import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Upload, Download, Share2, Trash2, Edit2, Check, X as XIcon, ChevronDown, ChevronUp, Plus, Save } from 'lucide-react';
import { CharacterCard, saveCharacter } from '../lib/db';
import { useBackHandler } from '../lib/useBackHandler';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  character: CharacterCard;
  onUpdate: (updatedCharacter: CharacterCard) => void;
}

export function CharacterRegexSection({ character, onUpdate }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  useBackHandler(editingIndex !== null, () => {
    setEditingIndex(null);
    return true;
  });

  const targetData = character.data.data ? character.data.data : character.data;
  const regexScripts: any[] = targetData.extensions?.regex_scripts || [];

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = reject;
        reader.readAsText(file, "utf-8");
      });
      const parsed = JSON.parse(text);
      
      let importedScripts: any[] = [];
      if (Array.isArray(parsed)) {
        importedScripts = parsed;
      } else if (parsed.regex_scripts && Array.isArray(parsed.regex_scripts)) {
        importedScripts = parsed.regex_scripts;
      } else {
        importedScripts = [parsed];
      }

      if (importedScripts.length === 0) {
        alert('没有在文件中找到正则替换脚本。');
        return;
      }

      if (confirm(`成功读取 ${importedScripts.length} 个正则脚本，是否覆盖当前的正则？（取消则为追加）`)) {
         // Overwrite
         saveRegexScripts(importedScripts);
      } else {
         // Append
         saveRegexScripts([...regexScripts, ...importedScripts]);
      }
    } catch (err) {
      console.error('导入正则失败', err);
      alert('导入失败，无效的JSON文件。');
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleExport = async (share: boolean = false) => {
    if (regexScripts.length === 0) {
      alert('没有可以导出的正则。');
      return;
    }
    
    const jsonStr = JSON.stringify(regexScripts, null, 2);
    const filename = `${character.name}_regex_scripts.json`;
    
    if (typeof window !== 'undefined' && !!(window as any).Android) {
        const { exportFileToMIU, shareFileOnAndroid } = await import('../lib/appBridge');
        const bytes = new TextEncoder().encode(jsonStr);
        if (share) {
            await shareFileOnAndroid(filename, bytes.buffer, 'application/json');
        } else {
            const savedPath = await exportFileToMIU(filename, bytes.buffer, 'application/json', false);
            if (savedPath) {
                alert(`导出正则成功！\n文件已存至：${savedPath.split('Download/')[1] || savedPath}`);
            }
        }
    } else {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(jsonStr);
        const a = document.createElement('a');
        a.href = dataStr;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
  };

  const saveRegexScripts = (newScripts: any[]) => {
    const updatedChar = { ...character };
    updatedChar.data = JSON.parse(JSON.stringify(updatedChar.data || {}));
    let tData = updatedChar.data.data ? updatedChar.data.data : updatedChar.data;
    
    if (!tData.extensions) tData.extensions = {};
    tData.extensions.regex_scripts = newScripts;
    
    saveCharacter(updatedChar).then(() => {
      onUpdate(updatedChar);
    });
  };

  const handleDelete = (index: number) => {
    if (confirm('确定要删除这条正则吗？')) {
      const newScripts = [...regexScripts];
      newScripts.splice(index, 1);
      saveRegexScripts(newScripts);
      if (expandedIndex === index) {
        setExpandedIndex(null);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-xl font-bold">正则替换</h3>
          <p className="text-white/60 text-sm mt-1">
            用于对聊天内容进行自动替换的正则表达式
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setEditForm({
                id: crypto.randomUUID(),
                scriptName: '新规则',
                regex: '',
                replacementString: '',
                placement: [1, 2], // Default placement options mapping to some common positions like formatting
                disabled: false,
              });
              setEditingIndex(-1);
            }}
            className="p-2 rounded-full bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition"
            title="新增正则规则"
          >
            <Plus className="w-5 h-5" />
          </button>
          <input 
            type="file" 
            accept=".json" 
            ref={fileInputRef} 
            onChange={handleImport} 
            className="hidden" 
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-full bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition"
            title="导入正则"
          >
            <Upload className="w-5 h-5" />
          </button>
          {regexScripts.length > 0 && (
            <button
              onClick={() => handleExport(false)}
              className="p-2 rounded-full bg-green-500/20 text-green-300 hover:bg-green-500/30 transition"
              title="导出全部正则"
            >
              <Download className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {regexScripts.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 text-white/40 border border-white/5 rounded-2xl bg-white/5">
          <Edit2 className="w-12 h-12 mb-3 opacity-50" />
          <p>当前角色未包含正则替换</p>
        </div>
      ) : (
        <div className="space-y-2">
          {regexScripts.map((script, index) => {
            const isExpanded = expandedIndex === index;
            const title = script.scriptName || script.name || `正则替换 ${index + 1}`;
            return (
              <div 
                key={script.id || index} 
                className="bg-white/5 border border-white/10 rounded-xl p-4 transition-colors hover:bg-white/10 group flex flex-col"
              >
                <div className="flex justify-between items-start w-full gap-4">
                  <div 
                    className="flex flex-col flex-1 min-w-0 pb-1 cursor-pointer group" 
                    onClick={() => setExpandedIndex(isExpanded ? null : index)}
                  >
                    <div className="flex gap-2 mb-1.5 flex-wrap items-center">
                      <span className={`w-2 h-2 rounded-full flex-none ${script.disabled ? 'bg-red-500/50' : 'bg-green-500'}`}></span>
                      <span className="font-semibold text-white/90 break-words line-clamp-2 leading-snug">{title}</span>
                    </div>

                    {isExpanded ? (
                      <div className="text-white/90 whitespace-pre-wrap text-sm leading-relaxed pr-2 break-words w-full" onClick={e => e.stopPropagation()}>
                        <div className="mt-2 space-y-3">
                          <div>
                            <span className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1 block">匹配规则 (RegEx)</span>
                            <div className="font-mono text-sm break-all font-medium text-blue-300">
                              {script.regex || script.findRegex || '未设定'}
                            </div>
                          </div>
                          <div>
                            <span className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1 block">替换内容</span>
                            <div className="font-mono text-sm break-all font-medium text-green-300">
                              {script.replacementString || script.replaceString || ''}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs text-white/60">
                            {script.placement && Array.isArray(script.placement) && (
                              <span className="px-2 py-1 bg-black/40 rounded-md border border-white/5">插入位置: {script.placement.join(', ')}</span>
                            )}
                            {script.disabled && (
                              <span className="px-2 py-1 bg-red-500/20 text-red-300 rounded-md border border-red-500/20">已禁用</span>
                            )}
                          </div>
                        </div>
                        <button 
                          onClick={(e) => { e.stopPropagation(); setExpandedIndex(null); }}
                          className="mt-3 flex items-center justify-center gap-1 text-purple-400 text-sm font-medium py-1.5 hover:bg-white/5 rounded-lg transition w-full cursor-pointer"
                        >
                          <ChevronUp className="w-4 h-4" /> 收起 
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="text-white/70 text-sm line-clamp-2 break-words w-full font-mono">
                          {script.regex || script.findRegex || '未设定'}
                        </div>
                        <div className="mt-1.5 text-purple-400 text-xs font-medium flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                          <span>展开全文</span>
                          <ChevronDown className="w-3 h-3" />
                        </div>
                      </>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-1 flex-none opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditForm({ ...script });
                        setEditingIndex(index);
                      }}
                      className="p-2 text-white/60 hover:text-blue-400 hover:bg-blue-500/20 rounded-lg transition"
                      title="编辑"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(index);
                      }}
                      className="p-2 text-white/60 hover:text-red-400 hover:bg-red-500/20 rounded-lg transition"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* RegEx Editor Modal */}
      {createPortal(
        <AnimatePresence>
          {editingIndex !== null && (
            <motion.div
              key="regex-edit-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex justify-center items-center p-4 sm:p-6 [.light-theme_&]:bg-black/40"
              onClick={() => setEditingIndex(null)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                className="bg-slate-900 flex flex-col w-full max-h-[85vh] border border-white/10 rounded-2xl shadow-2xl max-w-3xl overflow-hidden [.light-theme_&]:bg-[#FCFCFC] [.light-theme_&]:border-black/5"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex-none p-4 sm:p-6 border-b border-white/10 flex items-center justify-between bg-black/20 [.light-theme_&]:border-black/5 [.light-theme_&]:bg-black/5">
                  <h3 className="text-lg font-semibold text-white [.light-theme_&]:text-[#1c1c1e]">{editingIndex === -1 ? '新增正则规则' : '编辑正则规则'}</h3>
                  <button onClick={() => setEditingIndex(null)} className="p-1 hover:bg-white/10 rounded-full text-white/60 hover:text-white transition [.light-theme_&]:hover:bg-black/10 [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:text-[#1c1c1e]">
                    <XIcon className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-1 [.light-theme_&]:text-[#1c1c1e]">规则名称</label>
                    <input
                      type="text"
                      value={editForm.scriptName || editForm.name || ''}
                      onChange={(e) => setEditForm({ ...editForm, scriptName: e.target.value })}
                      className="w-full bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-purple-500 transition [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10 [.light-theme_&]:text-[#1c1c1e]"
                      placeholder="例如: 屏蔽特定格式的星号动作"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-1 [.light-theme_&]:text-[#1c1c1e]">匹配正则表达式 (RegEx)</label>
                    <textarea
                      value={editForm.regex || editForm.findRegex || ''}
                      onChange={(e) => setEditForm({ ...editForm, regex: e.target.value })}
                      className="w-full bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-purple-500 transition font-mono min-h-[100px] [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10 [.light-theme_&]:text-[#1c1c1e]"
                      placeholder="输入合法的正则表达式"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-1 [.light-theme_&]:text-[#1c1c1e]">替换为内容 (Replacement)</label>
                    <textarea
                      value={editForm.replacementString ?? editForm.replaceString ?? ''}
                      onChange={(e) => setEditForm({ ...editForm, replacementString: e.target.value })}
                      className="w-full bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-purple-500 transition font-mono min-h-[100px] [.light-theme_&]:bg-black/5 [.light-theme_&]:border-black/10 [.light-theme_&]:text-[#1c1c1e]"
                      placeholder="输入替换内容，可使用 $1, $2 等捕获组"
                    />
                  </div>
                  
                  <div className="flex gap-4 items-center">
                     <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-white/70 [.light-theme_&]:text-[#1c1c1e]">
                       <input
                         type="checkbox"
                         checked={!editForm.disabled}
                         onChange={(e) => setEditForm({ ...editForm, disabled: !e.target.checked })}
                         className="rounded bg-black/30 border-white/10 text-purple-500 focus:ring-purple-500/20 [.light-theme_&]:bg-white [.light-theme_&]:border-black/20"
                       />
                       启用
                     </label>
                  </div>
                </div>

                <div className="flex-none p-4 sm:p-6 border-t border-white/10 bg-black/20 flex justify-end gap-3 [.light-theme_&]:border-black/5 [.light-theme_&]:bg-black/5">
                  <button
                    onClick={() => setEditingIndex(null)}
                    className="px-4 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition [.light-theme_&]:text-slate-500 [.light-theme_&]:hover:text-[#1c1c1e] [.light-theme_&]:hover:bg-black/10"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => {
                      const newScripts = [...regexScripts];
                      if (editingIndex === -1) {
                        newScripts.push(editForm);
                      } else {
                        newScripts[editingIndex] = editForm;
                      }
                      saveRegexScripts(newScripts);
                      setEditingIndex(null);
                    }}
                    className="px-6 py-2 rounded-lg bg-purple-500 text-white hover:bg-purple-600 transition flex items-center gap-2 shadow-lg shadow-purple-500/20"
                  >
                    <Save className="w-4 h-4" />
                    保存
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
