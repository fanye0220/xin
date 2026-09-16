import { getFallbackAvatar } from '../lib/avatar';
import React, { useRef, useState } from 'react';
import { Upload, FileJson, QrCode, Trash2, Download, Library, Share2 } from 'lucide-react';
import { CharacterCard, saveCharacter, saveCharacters, getOrCreateNestedFolder, resolveFolderPath } from '../lib/db';
import { SelectQRModal } from './SelectQRModal';
import { ExportQRModal } from './ExportQRModal';

interface Props {
  character: CharacterCard;
  onUpdate: (updatedCharacter: CharacterCard) => void;
}

interface QRSet {
  id: string;
  sourceName: string;
  replies: any[];
  metadata?: any;
}

export function QuickRepliesSection({ character, onUpdate }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSelectModalOpen, setIsSelectModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const targetData = character.data.data ? character.data.data : character.data;

  const getQRSets = (): QRSet[] => {
    if (targetData.extensions?.tavern_qr_sets) {
       return targetData.extensions.tavern_qr_sets;
    }
    if (targetData.extensions?.quick_replies && targetData.extensions.quick_replies.length > 0) {
       return [{
          id: 'default',
          sourceName: targetData.extensions?.qr_filename || '原有的快速回复',
          replies: targetData.extensions.quick_replies
       }];
    }
    return [];
  };

  const qrSets = getQRSets();
  const hasQuickReplies = qrSets.length > 0;

  const handleLibrarySelection = async (qrChars: CharacterCard[]) => {
    try {
      const updatedChar = { ...character };
      updatedChar.data = JSON.parse(JSON.stringify(updatedChar.data || {}));
      let tData = updatedChar.data.data ? updatedChar.data.data : updatedChar.data;
      
      let newSets = [...getQRSets()];

      for (const qrChar of qrChars) {
        const qrData = qrChar.data || {};
        let newQRs = [];
        let metadata = null;
        if (Array.isArray(qrData)) {
          newQRs = qrData;
        } else if (qrData.qrList && Array.isArray(qrData.qrList)) {
          newQRs = qrData.qrList;
          metadata = qrData;
        } else if (qrData.quick_replies && Array.isArray(qrData.quick_replies)) {
          newQRs = qrData.quick_replies;
          metadata = qrData;
        }
        
        newSets.push({
          id: Date.now().toString() + Math.random().toString(),
          sourceName: qrChar.name,
          replies: JSON.parse(JSON.stringify(newQRs)),
          metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined
        });
      }

      tData.extensions = { 
        ...(tData.extensions || {}), 
        tavern_qr_sets: newSets,
        quick_replies: newSets.flatMap(s => s.replies),
        qr_filename: newSets.length > 0 ? `${newSets[newSets.length-1].sourceName}.json` : undefined
      };

      await saveCharacter(updatedChar);
      onUpdate(updatedChar);
      setIsSelectModalOpen(false);
    } catch (e) {
      console.error(e);
      try { alert('绑定失败: ' + (e instanceof Error ? e.message : String(e))); } catch (err) {}
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const updatedChar = { ...character };
    updatedChar.data = JSON.parse(JSON.stringify(updatedChar.data || {}));
    let tData = updatedChar.data.data ? updatedChar.data.data : updatedChar.data;
    let newSets = [...getQRSets()];
    const charsToSave: CharacterCard[] = [];

    // Get the folder ID for Quick Replies implicitly
    const targetFolderId = await getOrCreateNestedFolder(['快速回复']);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target?.result as string);
          reader.onerror = reject;
          reader.readAsText(file);
        });

        const json = JSON.parse(text);
        
        let newQRs = [];
        let metadata = null;
        if (Array.isArray(json)) {
          newQRs = json;
        } else if (json.qrList && Array.isArray(json.qrList)) {
          newQRs = json.qrList;
          metadata = json;
        } else if (json.quick_replies && Array.isArray(json.quick_replies)) {
          newQRs = json.quick_replies;
          metadata = json;
        } else {
          throw new Error('Invalid format');
        }

        newSets.push({
          id: Date.now().toString() + Math.random().toString(),
          sourceName: file.name,
          replies: newQRs,
          metadata: metadata
        });

        // Also save this to the library!
        const charName = metadata?.name || file.name.replace(/\.[^/.]+$/, "");
        charsToSave.push({
          id: crypto.randomUUID(),
          name: charName,
          avatarUrlFallback: getFallbackAvatar(charName),
          data: json,
          createdAt: Date.now(),
          folderId: targetFolderId,
          avatarHistory: []
        });

      } catch (error) {
        console.error(`Failed to parse Quick Replies JSON for ${file.name}`, error);
        alert(`文件 ${file.name} 解析失败`);
      }
    }

    tData.extensions = { 
      ...(tData.extensions || {}), 
      tavern_qr_sets: newSets,
      quick_replies: newSets.flatMap(s => s.replies),
      qr_filename: newSets.length > 0 ? newSets[newSets.length-1].sourceName : undefined
    };

    if (charsToSave.length > 0) {
      await saveCharacters(charsToSave);
      // Give some visual feedback that QRs were also saved to the app library
      try {
          alert(`已成功绑定，并同步存入“快速回复”分类，一共 ${charsToSave.length} 个配置！`);
      } catch (e) {}
    }

    await saveCharacter(updatedChar);
    onUpdate(updatedChar);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDeleteSet = async (id: string) => {
    const updatedChar = { ...character };
    let tData = updatedChar.data.data ? updatedChar.data.data : updatedChar.data;
    
    let newSets = getQRSets().filter(s => s.id !== id);

    if (newSets.length === 0) {
       if (tData.extensions?.quick_replies) {
          delete tData.extensions.quick_replies;
       }
       if (tData.extensions?.tavern_qr_sets) {
          delete tData.extensions.tavern_qr_sets;
       }
       if (tData.extensions?.qr_filename) {
          delete tData.extensions.qr_filename;
       }
    } else {
       tData.extensions.tavern_qr_sets = newSets;
       tData.extensions.quick_replies = newSets.flatMap(s => s.replies);
    }
    
    await saveCharacter(updatedChar);
    onUpdate(updatedChar);
  };

  const handleDownloadClick = (share: boolean = false) => {
    if (qrSets.length === 0) return;
    if (qrSets.length === 1) {
      exportSets([qrSets[0]], share);
    } else {
      setIsExportModalOpen(true);
    }
  };

  const exportSets = async (setsToExport: QRSet[], share = false) => {
    if (setsToExport.length === 0) return;

    if (setsToExport.length === 1) {
      const set = setsToExport[0];
      if (!set.replies || set.replies.length === 0) return;
      
      let exportData: any = set.replies;
      if (set.metadata) {
        exportData = { ...set.metadata };
        if (exportData.qrList) exportData.qrList = set.replies;
        else if (exportData.quick_replies) exportData.quick_replies = set.replies;
      } else {
        exportData = {
          version: 2,
          name: character.name,
          qrList: set.replies
        };
      }

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      let filename = set.sourceName || `${character.name}_qr.json`;
      if (!filename.endsWith('.json')) {
        filename += '.json';
      }
      if (typeof window !== 'undefined' && !!(window as any).Android) {
          import('../lib/appBridge').then(async ({ shareFileOnAndroid, exportFileToMIU }) => {
              const buffer = blob.arrayBuffer ? await blob.arrayBuffer() : await new Response(blob).arrayBuffer();
              if (share) {
                  await shareFileOnAndroid(filename, buffer, 'application/json');
              } else {
                  const savedPath = await exportFileToMIU(filename, buffer, 'application/json', false);
                  if (savedPath) {
                      alert(`导出成功！\n文件已存至：${savedPath.split('Download/')[1] || savedPath}`);
                  }
              }
          });
      } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
      }
    } else {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      
      setsToExport.forEach((set, index) => {
        if (!set.replies || set.replies.length === 0) return;
        
        let exportData: any = set.replies;
        if (set.metadata) {
          exportData = { ...set.metadata };
          if (exportData.qrList) exportData.qrList = set.replies;
          else if (exportData.quick_replies) exportData.quick_replies = set.replies;
        } else {
          exportData = {
            version: 2,
            name: character.name,
            qrList: set.replies
          };
        }

        let filename = set.sourceName || `${character.name}_qr${index > 0 ? `_${index}` : ''}.json`;
        if (!filename.endsWith('.json')) {
            filename += '.json';
        }
        
        let finalFilename = filename;
        let counter = 1;
        while (zip.file(finalFilename)) {
            const parts = filename.split('.json');
            finalFilename = `${parts[0]}(${counter}).json`;
            counter++;
        }
        zip.file(finalFilename, JSON.stringify(exportData, null, 2));
      });
      
      const content = await zip.generateAsync({ type: 'blob' });
      const zipFileName = `${character.name}_QRs.zip`;
      if (typeof window !== 'undefined' && !!(window as any).Android) {
          import('../lib/appBridge').then(async ({ shareFileOnAndroid, exportFileToMIU }) => {
              const buffer = await content.arrayBuffer();
              if (share) {
                  await shareFileOnAndroid(zipFileName, buffer, 'application/zip');
              } else {
                  const savedPath = await exportFileToMIU(zipFileName, buffer, 'application/zip', false);
                  if (savedPath) {
                      alert(`批量导出成功！共导出 ${setsToExport.length} 个快速回复集。\n文件已存至：${savedPath.split('Download/')[1] || savedPath}`);
                  }
              }
          });
      } else {
          const url = URL.createObjectURL(content);
          const a = document.createElement('a');
          a.href = url;
          a.download = zipFileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
      }
    }
  };

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-4 text-white/80">
        <QrCode className="w-5 h-5" />
        <h3 className="text-sm font-semibold uppercase tracking-wider">快速回复 (QUICK REPLIES)</h3>
      </div>

      <div className="border border-dashed border-white/20 rounded-2xl p-6 bg-white/5 relative overflow-hidden">
        {hasQuickReplies ? (
          <div className="flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2 text-green-400">
                <div className="w-2 h-2 rounded-full bg-green-400"></div>
                <span className="font-medium text-sm text-white/90">已绑定 {qrSets.length} 个快捷回复集</span>
              </div>
              <button 
                onClick={async () => {
                  const updatedChar = { ...character };
                  let tData = updatedChar.data.data ? updatedChar.data.data : updatedChar.data;
                  if (tData.extensions?.quick_replies) delete tData.extensions.quick_replies;
                  if (tData.extensions?.tavern_qr_sets) delete tData.extensions.tavern_qr_sets;
                  await saveCharacter(updatedChar);
                  onUpdate(updatedChar);
                }}
                className="text-white/40 hover:text-red-400 transition"
                title="清空所有快速回复"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {qrSets.map((set) => (
                <div key={set.id} className="bg-white/10 hover:bg-white/15 rounded-xl p-4 flex items-center justify-between transition group">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-white/90 truncate">{set.sourceName}</div>
                    <div className="text-white/50 text-xs mt-1">{set.replies.length} 个回复项</div>
                  </div>
                  <button 
                    onClick={() => handleDeleteSet(set.id)}
                    className="p-2 text-white/40 hover:text-red-400 transition shrink-0"
                    title="删除此配置"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-2 mt-2">
              <button 
                onClick={() => handleDownloadClick()}
                className="flex-1 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium transition flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" /> 导出快速回复 
              </button>
              <button 
                onClick={() => setIsSelectModalOpen(true)}
                className="flex-1 py-3 bg-purple-500/20 hover:bg-purple-500/40 text-purple-300 rounded-xl font-medium transition flex items-center justify-center gap-2"
              >
                <Library className="w-4 h-4" /> 添加 (库)
              </button>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium transition flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4" /> 添加 (本地)
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-4">
            <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4 text-white/40">
              <Upload className="w-8 h-8" />
            </div>
            <p className="text-white/60 mb-6 font-medium text-sm">未绑定任何快速回复配置</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium transition flex items-center gap-2"
              >
                <Upload className="w-4 h-4" /> 本地导入
              </button>
              <button 
                onClick={() => setIsSelectModalOpen(true)}
                className="px-6 py-2.5 bg-purple-500/20 hover:bg-purple-500/40 text-purple-300 rounded-xl font-medium transition flex items-center gap-2"
              >
                <Library className="w-4 h-4" /> 从库中选择
              </button>
            </div>
          </div>
        )}

        <SelectQRModal 
          isOpen={isSelectModalOpen}
          onClose={() => setIsSelectModalOpen(false)}
          onSelect={handleLibrarySelection}
        />

        <ExportQRModal
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          qrSets={qrSets}
          onExport={exportSets}
        />

        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept=".json" 
          multiple
          onChange={handleFileUpload}
        />
      </div>
    </div>
  );
}
