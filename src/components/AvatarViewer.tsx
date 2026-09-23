import { getFallbackAvatar, resolveAvatarUrl } from '../lib/avatar';
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { X, Upload, Check, Trash2, Download, Share2 } from 'lucide-react';
import { CharacterCard, saveCharacter, resolveFolderPath } from '../lib/db';
import { isAndroid, getLocalImageUrl, getDownloadTooltip } from '../lib/appBridge';

interface Props {
  isOpen: boolean;
  character: CharacterCard;
  onClose: () => void;
  onUpdate: (updatedCharacter: CharacterCard) => void;
}

export function AvatarViewer({ isOpen, character, onClose, onUpdate }: Props) {
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string>('');
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [historyUrls, setHistoryUrls] = useState<{ blob: Blob, url: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    if (previewBlob) {
      objectUrl = URL.createObjectURL(previewBlob);
      setCurrentAvatarUrl(objectUrl);
    } else if (character.avatarBlob) {
      objectUrl = URL.createObjectURL(character.avatarBlob);
      setCurrentAvatarUrl(objectUrl);
    } else if (character.localFilePath) {
      setCurrentAvatarUrl(getLocalImageUrl(character.localFilePath, character.updatedAt || character.createdAt));
    } else {
      setCurrentAvatarUrl(resolveAvatarUrl(character.avatarUrlFallback, character.name || character.id));
    }
    
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [character.avatarBlob, character.localFilePath, character.avatarUrlFallback, previewBlob, character.updatedAt, character.createdAt]);

  useEffect(() => {
    const urls = (character.avatarHistory || []).map(blob => ({
      blob,
      url: URL.createObjectURL(blob)
    }));
    
    // Add current avatar to history if it's not there and is a blob
    if (character.avatarBlob) {
      const isCurrentInHistory = character.avatarHistory?.some(b => b === character.avatarBlob || (b.size === character.avatarBlob?.size && b.type === character.avatarBlob?.type));
      if (!isCurrentInHistory) {
        urls.unshift({
          blob: character.avatarBlob,
          url: URL.createObjectURL(character.avatarBlob)
        });
      }
    } else if (character.localFilePath && (!character.avatarHistory || character.avatarHistory.length === 0)) {
      const localUrl = getLocalImageUrl(character.localFilePath, character.updatedAt || character.createdAt);
      urls.unshift({
        blob: null as any,
        url: localUrl
      });
    }

    setHistoryUrls(urls);

    return () => {
      urls.forEach(item => {
        if (item.blob) URL.revokeObjectURL(item.url);
      });
    };
  }, [character.avatarHistory, character.avatarBlob, character.localFilePath]);

  const convertToPng = async (blob: Blob): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(img.src);
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // Resize if too large (mobile canvas limit prevention)
        const MAX_SIZE = 1024;
        if (width > MAX_SIZE || height > MAX_SIZE) {
          if (width > height) {
            height = Math.round((height * MAX_SIZE) / width);
            width = MAX_SIZE;
          } else {
            width = Math.round((width * MAX_SIZE) / height);
            height = MAX_SIZE;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('No canvas context'));
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('Canvas toBlob failed'));
        }, 'image/png');
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(img.src);
        reject(e);
      };
      img.src = URL.createObjectURL(blob);
    });
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
      const newHistory = character.avatarHistory ? [...character.avatarHistory] : [];
    if (character.avatarBlob) {
      const isCurrentInHistory = newHistory.some(b => b === character.avatarBlob || (b.size === character.avatarBlob?.size && b.type === character.avatarBlob?.type));
      if (!isCurrentInHistory) {
        newHistory.unshift(character.avatarBlob);
      }
    } else if (character.localFilePath) {
      try {
        const { readLocalFileBuffer } = await import('../lib/appBridge');
        const buffer = await readLocalFileBuffer(character.localFilePath);
        if (buffer) {
          let ext = 'image/png';
          if (character.localFilePath.endsWith('.jpg') || character.localFilePath.endsWith('.jpeg')) ext = 'image/jpeg';
          else if (character.localFilePath.endsWith('.webp')) ext = 'image/webp';
          const blob = new Blob([buffer], { type: ext });
          const isCurrentInHistory = newHistory.some(b => b.size === blob.size && b.type === blob.type);
          if (!isCurrentInHistory) {
             newHistory.unshift(blob);
          }
        }
      } catch (err) {
        console.error("Failed to read local old avatar", err);
      }
    }
    
    // Inject current character data into the new PNG so it becomes a valid Tavern card
    let finalFile: File = file;
    
    try {
      let pngBlob: Blob = file;
      if (file.type !== 'image/png' && !file.name.toLowerCase().endsWith('.png')) {
        pngBlob = await convertToPng(file);
      }
      
      const { injectTavernData } = await import('../lib/png');
      let buffer = await pngBlob.arrayBuffer();
      
      const charData = JSON.parse(JSON.stringify(character.data));
      if (charData.avatar) delete charData.avatar;
      if (charData.data && charData.data.avatar) delete charData.data.avatar;
      
      let newBuffer: ArrayBuffer;
      try {
        newBuffer = injectTavernData(buffer, charData);
      } catch (err) {
        if (pngBlob === file) {
          pngBlob = await convertToPng(file);
          buffer = await pngBlob.arrayBuffer();
          newBuffer = injectTavernData(buffer, charData);
        } else {
          throw err;
        }
      }
      
      const fileName = (file.name || 'avatar').replace(/\.[^/.]+$/, "") + ".png";
      try {
        finalFile = new File([newBuffer], fileName, { type: 'image/png' });
      } catch (e) {
        finalFile = new Blob([newBuffer], { type: 'image/png' }) as any;
        Object.defineProperty(finalFile, 'name', { value: fileName });
      }
    } catch (err) {
      console.error("Failed to inject data into new avatar", err);
      alert("无法处理该图片。如果问题持续存在，请尝试另一张图片。");
      setIsProcessing(false);
      return;
    }
    
    newHistory.unshift(finalFile);

    const updatedCharacter = {
      ...character,
      avatarBlob: finalFile,
      originalFile: finalFile,
      avatarHistory: newHistory,
      updatedAt: Date.now()
    };
    
    delete updatedCharacter.localFilePath;
    await saveCharacter(updatedCharacter);
    onUpdate(updatedCharacter);
    setPreviewBlob(null);
    setIsProcessing(false);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("charactersUpdated"));
    }
  };

  const handleSelectHistory = (blob: Blob) => {
    setPreviewBlob(blob);
  };

  const handleSetAsAvatar = async () => {
    if (!previewBlob || previewBlob === character.avatarBlob) return;

    setIsProcessing(true);
      let finalFile: File;
    if (typeof File !== 'undefined' && previewBlob instanceof File) {
      finalFile = previewBlob;
    } else {
      try {
        finalFile = new File([previewBlob], 'avatar.png', { type: previewBlob.type });
      } catch (e) {
        finalFile = new Blob([previewBlob], { type: previewBlob.type }) as any;
        Object.defineProperty(finalFile, 'name', { value: 'avatar.png' });
      }
    }
    
    try {
      let pngBlob: Blob = previewBlob;
      if (previewBlob.type !== 'image/png' && !(previewBlob as any).name?.toLowerCase().endsWith('.png')) {
        pngBlob = await convertToPng(previewBlob);
      }
      
      const { injectTavernData } = await import('../lib/png');
      let buffer = await pngBlob.arrayBuffer();
      
      const charData = JSON.parse(JSON.stringify(character.data));
      if (charData.avatar) delete charData.avatar;
      if (charData.data && charData.data.avatar) delete charData.data.avatar;
      
      let newBuffer: ArrayBuffer;
      try {
        newBuffer = injectTavernData(buffer, charData);
      } catch (err) {
        if (pngBlob === previewBlob) {
          pngBlob = await convertToPng(previewBlob);
          buffer = await pngBlob.arrayBuffer();
          newBuffer = injectTavernData(buffer, charData);
        } else {
          throw err;
        }
      }
      
      try {
        finalFile = new File([newBuffer], 'avatar.png', { type: 'image/png' });
      } catch (e) {
        finalFile = new Blob([newBuffer], { type: 'image/png' }) as any;
        Object.defineProperty(finalFile, 'name', { value: 'avatar.png' });
      }
    } catch (err) {
      console.error("Failed to inject data into history avatar", err);
      alert("处理头像失败，可能该头像已损坏。");
      setIsProcessing(false);
      return;
    }

    const newHistory = (character.avatarHistory || []).map(b => b === previewBlob ? finalFile : b);

    const updatedCharacter = {
      ...character,
      avatarBlob: finalFile,
      originalFile: finalFile,
      avatarHistory: newHistory,
      updatedAt: Date.now()
    };
    
    delete updatedCharacter.localFilePath;
    await saveCharacter(updatedCharacter);
    onUpdate(updatedCharacter);
    setPreviewBlob(null);
    setIsProcessing(false);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("charactersUpdated"));
    }
  };

  const handleDeleteHistory = async (e: React.MouseEvent, blobToDelete: Blob) => {
    e.stopPropagation();
    
    const newHistory = (character.avatarHistory || []).filter(b => b !== blobToDelete && !(b.size === blobToDelete.size && b.type === blobToDelete.type));
    
    const updatedCharacter = {
      ...character,
      avatarHistory: newHistory
    };

    if (previewBlob === blobToDelete) {
      setPreviewBlob(null);
    }

    await saveCharacter(updatedCharacter);
    onUpdate(updatedCharacter);
    
      

  };

  const handleExportAvatar = async (share: boolean = true) => {
    let blobToExport = previewBlob || character.avatarBlob;
    let fallbackBuffer: ArrayBuffer | null = null;
    let isLocalFile = false;

    if (!blobToExport) {
        if (character.localFilePath && !previewBlob) {
            isLocalFile = true;
            // dynamic import appBridge
            const { readLocalFileBuffer } = await import('../lib/appBridge');
            fallbackBuffer = await readLocalFileBuffer(character.localFilePath);
            if (!fallbackBuffer) return;
        } else {
            return;
        }
    }

    let ext = 'png';
    if (blobToExport && blobToExport.type === 'image/jpeg') ext = 'jpg';
    else if (blobToExport && blobToExport.type === 'image/webp') ext = 'webp';
    else if (isLocalFile && character.localFilePath?.endsWith('.jpg')) ext = 'jpg';
    else if (isLocalFile && character.localFilePath?.endsWith('.jpeg')) ext = 'jpg';
    else if (isLocalFile && character.localFilePath?.endsWith('.webp')) ext = 'webp';

    const exportName = `${character.name || 'avatar'}_image.${ext}`;
    const mime = blobToExport ? blobToExport.type : (ext === 'jpg' ? 'image/jpeg' : `image/${ext}`);
    const buffer = blobToExport ? await blobToExport.arrayBuffer() : fallbackBuffer;
    if (!buffer) return;

    try {
        const { downloadOrShareFile } = await import('../lib/appBridge');
        await downloadOrShareFile(exportName, buffer, mime, share);
    } catch(e) {
        alert('导出图片失败');
    }
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="avatar-viewer-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] bg-black flex flex-col"
        >
      <div className="absolute top-0 left-0 right-0 p-4 pt-[max(1.75rem,env(safe-area-inset-top))] sm:pt-[max(1.75rem,env(safe-area-inset-top))] flex justify-between items-center z-10 bg-gradient-to-b from-black/60 to-transparent">
        <button onClick={onClose} className="p-2 rounded-full bg-black/40 text-white hover:bg-black/60 transition">
          <X className="w-6 h-6" />
        </button>
        <div className="text-white font-medium drop-shadow-md">
          {previewBlob && previewBlob !== character.avatarBlob ? '预览历史头像' : '当前头像'}
        </div>
        <div className="flex gap-2">
          
          <button 
            onClick={() => handleExportAvatar(true)}
            className="p-2 rounded-full bg-black/40 text-white hover:bg-white/20 transition"
            title={getDownloadTooltip("下载图片")}
          >
            <Download className="w-6 h-6" />
          </button>
          {previewBlob && previewBlob !== character.avatarBlob && (
            <button 
              onClick={(e) => handleDeleteHistory(e, previewBlob)}
              className="p-2 rounded-full bg-black/40 text-red-400 hover:bg-red-500/20 transition"
              title="删除此历史头像"
            >
              <Trash2 className="w-6 h-6" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 relative flex flex-col items-center justify-center overflow-hidden">
        <TransformWrapper
          initialScale={1}
          minScale={0.5}
          maxScale={5}
          centerOnInit
        >
          <TransformComponent 
            wrapperClass="w-full h-full" 
            wrapperStyle={{ width: '100%', height: '100%' }}
            contentClass="w-full h-full flex items-center justify-center p-4"
            contentStyle={{ width: '100%', height: '100%' }}
          >
            <motion.img
              key={currentAvatarUrl}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              src={currentAvatarUrl}
              alt="Current Avatar"
              draggable={false}
              className="w-full h-full object-contain cursor-grab active:cursor-grabbing"
              onError={(e) => {
                 const target = e.target as HTMLImageElement;
                 const fallback = getFallbackAvatar(character.name || character.id);
                 if (target.src !== fallback && !target.src.startsWith("blob:")) {
                     target.src = fallback;
                     setCurrentAvatarUrl(fallback);
                 }
              }}
              
            />
          </TransformComponent>
        </TransformWrapper>
        <AnimatePresence>
          {previewBlob && previewBlob !== character.avatarBlob && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute bottom-8 left-1/2 -translate-x-1/2"
            >
              <button
                onClick={handleSetAsAvatar}
                className="bg-purple-500 hover:bg-purple-600 text-white px-6 py-3 rounded-full font-medium shadow-lg shadow-purple-500/20 flex items-center gap-2 transition"
              >
                <Check className="w-5 h-5" />
                设为当前头像
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="bg-slate-900 rounded-t-3xl p-6 pb-8 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-white/80 font-medium">历史头像</h3>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="text-purple-400 text-sm font-medium flex items-center gap-1 hover:text-purple-300 transition"
          >
            <Upload className="w-4 h-4" />
            上传新头像
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="image/png, image/jpeg, image/webp" 
            onChange={handleUpload}
          />
        </div>

        <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
          {historyUrls.length === 0 && !character.avatarBlob && (
            <div className="text-white/40 text-sm py-4">暂无历史头像</div>
          )}
          {historyUrls.map((item, index) => {
            const isActualCurrent = item.blob === character.avatarBlob || (character.avatarBlob && item.blob && item.blob.size === character.avatarBlob.size && item.blob.type === character.avatarBlob.type) || (!item.blob && !character.avatarBlob && !!character.localFilePath);
            const isPreviewed = item.blob === previewBlob || (!previewBlob && isActualCurrent);
            
            return (
              <div 
                key={index}
                onClick={() => handleSelectHistory(item.blob)}
                className={`group relative w-20 h-20 flex-shrink-0 rounded-xl overflow-hidden cursor-pointer snap-start transition-all ${isPreviewed ? 'ring-2 ring-purple-500 scale-105' : 'ring-1 ring-white/10 hover:ring-white/30 opacity-70 hover:opacity-100'}`}
              >
                <img src={item.url || undefined} alt={`History ${index}`} className="w-full h-full object-cover" />
                {isActualCurrent && (
                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                    <div className="bg-purple-500 rounded-full p-1">
                      <Check className="w-4 h-4 text-white" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
    )}
    </AnimatePresence>,
    document.body
  );
}
