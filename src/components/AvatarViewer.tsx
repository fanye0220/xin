import { getFallbackAvatar, resolveAvatarUrl } from '../lib/avatar';
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { X, Upload, Check, Trash2, Download, Share2, Image as ImageIcon, FolderOpen, FolderArchive, Search, Loader2, ChevronRight } from 'lucide-react';
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
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSourceSheet, setShowSourceSheet] = useState(false);

  // Android 本地 MIU 目录选择器
  const [showMiuPicker, setShowMiuPicker] = useState(false);
  const [miuFiles, setMiuFiles] = useState<string[]>([]);
  const [isLoadingMiu, setIsLoadingMiu] = useState(false);
  const [miuSearch, setMiuSearch] = useState('');

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

  const processAndSetAvatar = async (file: Blob | File, originalName?: string) => {
    setIsProcessing(true);
    try {
      const fileName = originalName || (file as File).name || 'avatar.png';
      const isImg = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(fileName);
      if (!isImg) {
        alert("所选文件不是图片格式，请在文件管理中选择 PNG、JPG 或 WEBP 图片。");
        return;
      }

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
      let finalFile: File;
      try {
        let pngBlob: Blob = file;
        if (file.type !== 'image/png' && !fileName.toLowerCase().endsWith('.png')) {
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
        
        const cleanName = fileName.replace(/\.[^/.]+$/, "") + ".png";
        try {
          finalFile = new File([newBuffer], cleanName, { type: 'image/png' });
        } catch (e) {
          finalFile = new Blob([newBuffer], { type: 'image/png' }) as any;
          Object.defineProperty(finalFile, 'name', { value: cleanName });
        }
      } catch (err) {
        console.error("Failed to inject data into new avatar", err);
        alert("无法处理该图片。如果问题持续存在，请尝试另一张图片。");
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
      import('../lib/thumbCache').then(({ evictCharacterThumb }) => {
        evictCharacterThumb(character.id);
      }).catch(() => {});
      window.dispatchEvent(new CustomEvent('charactersUpdated'));
      onUpdate(updatedCharacter);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const originalName = file.name;
    e.target.value = ''; // 重置 input，确保再次选择同名文件仍能触发
    await processAndSetAvatar(file, originalName);
  };

  const handleOpenMiuPicker = async () => {
    setIsLoadingMiu(true);
    setShowMiuPicker(true);
    try {
      const { pickAndroidFiles } = await import('../lib/appBridge');
      const files = await pickAndroidFiles();
      const imgFiles = files.filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f));
      setMiuFiles(imgFiles);
    } catch (e) {
      console.error('Failed to load Android files', e);
      setMiuFiles([]);
    } finally {
      setIsLoadingMiu(false);
    }
  };

  const handleSelectMiuFile = async (filePath: string) => {
    setShowMiuPicker(false);
    setIsProcessing(true);
    try {
      const { readLocalFileBuffer } = await import('../lib/appBridge');
      const buffer = await readLocalFileBuffer(filePath);
      if (!buffer) {
        alert('读取本地文件失败，请检查文件是否存在');
        return;
      }
      const rawName = filePath.split('/').pop() || 'avatar.png';
      let mime = 'image/png';
      if (rawName.toLowerCase().endsWith('.jpg') || rawName.toLowerCase().endsWith('.jpeg')) mime = 'image/jpeg';
      else if (rawName.toLowerCase().endsWith('.webp')) mime = 'image/webp';
      else if (rawName.toLowerCase().endsWith('.gif')) mime = 'image/gif';

      const file = new File([buffer], rawName, { type: mime });
      await processAndSetAvatar(file, rawName);
    } catch (e) {
      alert('处理本地文件失败');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSelectHistory = (blob: Blob) => {
    setPreviewBlob(blob);
  };

  const handleSetAsAvatar = async () => {
    if (!previewBlob || previewBlob === character.avatarBlob) return;
    setIsProcessing(true);

    // 确保把正在被替换的原头像安全放进历史列表, 防止原头像永久丢失
    let newHistory = character.avatarHistory ? [...character.avatarHistory] : [];
    if (character.avatarBlob) {
      const isCurrentInHistory = newHistory.some(
        b => b === character.avatarBlob || (b.size === character.avatarBlob?.size && b.type === character.avatarBlob?.type)
      );
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

    // 在历史列表中更新或加入选中的新头像 finalFile
    const previewIndex = newHistory.findIndex(
      b => b === previewBlob || (b.size === previewBlob.size && b.type === previewBlob.type)
    );
    if (previewIndex >= 0) {
      newHistory[previewIndex] = finalFile;
    } else {
      newHistory.unshift(finalFile);
    }

    const updatedCharacter = {
      ...character,
      avatarBlob: finalFile,
      originalFile: finalFile,
      avatarHistory: newHistory,
      updatedAt: Date.now()
    };
    
    delete updatedCharacter.localFilePath;
    await saveCharacter(updatedCharacter);
    import('../lib/thumbCache').then(({ evictCharacterThumb }) => {
      evictCharacterThumb(character.id);
    }).catch(() => {});
    window.dispatchEvent(new CustomEvent('charactersUpdated'));
    onUpdate(updatedCharacter);
    setPreviewBlob(null); // Reset preview so it matches current
    setIsProcessing(false);
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
    import('../lib/thumbCache').then(({ evictCharacterThumb }) => {
      evictCharacterThumb(character.id);
    }).catch(() => {});
    window.dispatchEvent(new CustomEvent('charactersUpdated'));
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
            onClick={() => setShowSourceSheet(true)}
            disabled={isProcessing}
            className="text-purple-400 text-sm font-medium flex items-center gap-1.5 hover:text-purple-300 transition active:scale-95 disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            上传新头像
          </button>
          {/* 系统相册选择（限制为图片格式，Android 会默认调起图库/相册） */}
          <input 
            type="file" 
            ref={galleryInputRef} 
            className="hidden" 
            accept="image/png, image/jpeg, image/webp, image/gif" 
            onChange={handleUpload}
          />
          {/* 文件管理选择（放宽为所有文件格式，Android 会调起系统文件选择器，可在任意文件夹中找图） */}
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="*/*" 
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

      {/* 处理中的遮罩动画 */}
      {isProcessing && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm z-[70] flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-10 h-10 text-purple-400 animate-spin" />
          <span className="text-white/90 text-sm font-medium">正在读取并设置新头像...</span>
        </div>
      )}

      {/* 底部上弹选择弹窗 (Action Sheet / 上弹的弹窗) */}
      <AnimatePresence>
        {showSourceSheet && (
          <div className="fixed inset-0 z-[75] flex items-end justify-center">
            {/* 遮罩背景 */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSourceSheet(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            {/* 上弹面板 */}
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
              className="relative w-full max-w-lg bg-slate-900 border-t border-white/10 rounded-t-3xl p-5 pb-8 shadow-2xl flex flex-col gap-3"
            >
              {/* 顶部把手条 */}
              <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-1" />

              <div className="text-center mb-1">
                <h4 className="text-base font-semibold text-white">选择图片方式</h4>
                <p className="text-xs text-white/50 mt-0.5">请选择从相册或系统文件管理中挑选图片</p>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    setShowSourceSheet(false);
                    galleryInputRef.current?.click();
                  }}
                  className="w-full flex items-center gap-3.5 p-3.5 rounded-2xl bg-white/5 hover:bg-white/10 active:scale-[0.99] border border-white/5 transition text-left"
                >
                  <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
                    <ImageIcon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white">从手机相册选取</div>
                    <div className="text-xs text-white/40">打开系统相册与图库</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/30" />
                </button>

                <button
                  onClick={() => {
                    setShowSourceSheet(false);
                    fileInputRef.current?.click();
                  }}
                  className="w-full flex items-center gap-3.5 p-3.5 rounded-2xl bg-white/5 hover:bg-white/10 active:scale-[0.99] border border-white/5 transition text-left"
                >
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <FolderOpen className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white">从文件管理中查找</div>
                    <div className="text-xs text-white/40">浏览手机内部存储、Download 或未入相册的图片</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/30" />
                </button>

                {isAndroid() && (
                  <button
                    onClick={() => {
                      setShowSourceSheet(false);
                      handleOpenMiuPicker();
                    }}
                    className="w-full flex items-center gap-3.5 p-3.5 rounded-2xl bg-white/5 hover:bg-white/10 active:scale-[0.99] border border-white/5 transition text-left"
                  >
                    <div className="w-10 h-10 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0">
                      <FolderArchive className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white">从 Download/MIU 目录选择</div>
                      <div className="text-xs text-white/40">直接浏览手机 MIU 本地角色卡与图片</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-white/30" />
                  </button>
                )}
              </div>

              <button
                onClick={() => setShowSourceSheet(false)}
                className="w-full py-3 mt-1 rounded-2xl bg-white/10 hover:bg-white/15 active:scale-[0.99] text-white/80 font-medium text-sm transition"
              >
                取消
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Android 本地 Download/MIU 目录图片选择器弹窗 */}
      <AnimatePresence>
        {showMiuPicker && (
          <div className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              className="bg-slate-900 border border-white/10 rounded-t-3xl sm:rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden shadow-2xl"
            >
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FolderArchive className="w-5 h-5 text-cyan-400" />
                  <span className="font-semibold text-white">从 MIU 目录选择图片</span>
                </div>
                <button
                  onClick={() => setShowMiuPicker(false)}
                  className="p-1 rounded-full text-white/60 hover:text-white hover:bg-white/10"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-3 border-b border-white/10 bg-slate-800/50">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    type="text"
                    value={miuSearch}
                    onChange={(e) => setMiuSearch(e.target.value)}
                    placeholder="搜索 MIU 目录文件名..."
                    className="w-full bg-black/30 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {isLoadingMiu ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-2 text-white/50">
                    <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
                    <span>正在扫描 Download/MIU 目录...</span>
                  </div>
                ) : miuFiles.length === 0 ? (
                  <div className="text-center py-12 text-white/40 text-sm">
                    <p>在 Download/MIU 目录下未找到图片</p>
                    <p className="text-xs text-white/30 mt-1">您可以点击【文件管理】在手机其他任意文件夹中选图</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                    {miuFiles
                      .filter((f) => !miuSearch || f.toLowerCase().includes(miuSearch.toLowerCase()))
                      .map((filePath, idx) => {
                        const fileName = filePath.split("/").pop() || "";
                        const url = getLocalImageUrl(filePath);
                        return (
                          <div
                            key={idx}
                            onClick={() => handleSelectMiuFile(filePath)}
                            className="group flex flex-col items-center gap-1.5 p-1.5 rounded-xl border border-white/10 bg-white/5 hover:border-cyan-500 hover:bg-cyan-500/10 cursor-pointer transition active:scale-95"
                          >
                            <div className="w-full aspect-square rounded-lg overflow-hidden bg-black/40 relative">
                              <img
                                src={url}
                                alt={fileName}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            </div>
                            <span className="text-[11px] text-white/70 truncate w-full text-center" title={fileName}>
                              {fileName}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
    )}
    </AnimatePresence>,
    document.body
  );
}
