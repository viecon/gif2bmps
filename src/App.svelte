<script>
    import JSZip from 'jszip';
    import { GifParser } from './lib/gifParser.js';
    import { createBMP } from './lib/bmpEncoder.js';

    let selectedFiles = $state([]);
    let filePreviews = $state({}); // 儲存每個檔案的預覽 URL
    let isDragover = $state(false);
    let isProcessing = $state(false);
    let progress = $state(0);
    let progressText = $state('');
    let status = $state({ type: '', message: '' });
    let gifInfo = $state(null); // 儲存 GIF 資訊用於生成代碼
    let isCopied = $state(false); // 複製狀態

    let fileInput;
    
    // 拖曳排序狀態
    let draggedIndex = $state(null);
    let dragOverIndex = $state(null);

    // 使用 Canvas 進行圖片 resize（雙線性插值）
    function resizeFrame(frame, targetWidth, targetHeight) {
        // 如果尺寸相同，直接返回
        if (frame.width === targetWidth && frame.height === targetHeight) {
            return frame;
        }

        // 創建源 canvas
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = frame.width;
        srcCanvas.height = frame.height;
        const srcCtx = srcCanvas.getContext('2d');
        const srcImageData = srcCtx.createImageData(frame.width, frame.height);
        srcImageData.data.set(frame.data);
        srcCtx.putImageData(srcImageData, 0, 0);

        // 創建目標 canvas 並進行高品質縮放
        const dstCanvas = document.createElement('canvas');
        dstCanvas.width = targetWidth;
        dstCanvas.height = targetHeight;
        const dstCtx = dstCanvas.getContext('2d');
        
        // 設定高品質縮放
        dstCtx.imageSmoothingEnabled = true;
        dstCtx.imageSmoothingQuality = 'high';
        
        // 繪製縮放後的圖片
        dstCtx.drawImage(srcCanvas, 0, 0, targetWidth, targetHeight);
        
        // 取得縮放後的像素資料
        const dstImageData = dstCtx.getImageData(0, 0, targetWidth, targetHeight);
        
        return {
            width: targetWidth,
            height: targetHeight,
            data: dstImageData.data
        };
    }

    function handleDragOver(e) {
        e.preventDefault();
        isDragover = true;
    }

    function handleDragLeave() {
        isDragover = false;
    }

    function handleDrop(e) {
        e.preventDefault();
        isDragover = false;
        addFiles(e.dataTransfer.files);
    }

    function handleFileSelect(e) {
        addFiles(e.target.files);
        fileInput.value = '';
    }

    function addFiles(files) {
        for (const file of files) {
            if (file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif')) {
                if (!selectedFiles.some(f => f.name === file.name && f.size === file.size)) {
                    selectedFiles = [...selectedFiles, file];
                    // 建立預覽 URL
                    const previewUrl = URL.createObjectURL(file);
                    filePreviews = { ...filePreviews, [file.name + file.size]: previewUrl };
                }
            }
        }
    }

    function removeFile(index) {
        const file = selectedFiles[index];
        const key = file.name + file.size;
        // 釋放預覽 URL
        if (filePreviews[key]) {
            URL.revokeObjectURL(filePreviews[key]);
            const newPreviews = { ...filePreviews };
            delete newPreviews[key];
            filePreviews = newPreviews;
        }
        selectedFiles = selectedFiles.filter((_, i) => i !== index);
    }

    // 拖曳排序相關函數
    function handleItemDragStart(e, index) {
        draggedIndex = index;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index);
    }

    function handleItemDragOver(e, index) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (draggedIndex !== null && draggedIndex !== index) {
            dragOverIndex = index;
        }
    }

    function handleItemDragLeave() {
        dragOverIndex = null;
    }

    function handleItemDrop(e, index) {
        e.preventDefault();
        if (draggedIndex !== null && draggedIndex !== index) {
            const newFiles = [...selectedFiles];
            const [draggedFile] = newFiles.splice(draggedIndex, 1);
            newFiles.splice(index, 0, draggedFile);
            selectedFiles = newFiles;
        }
        draggedIndex = null;
        dragOverIndex = null;
    }

    function handleItemDragEnd() {
        draggedIndex = null;
        dragOverIndex = null;
    }

    function getPreviewUrl(file) {
        return filePreviews[file.name + file.size] || '';
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
    
    function generateCodeSnippet() {
        if (!gifInfo || gifInfo.length === 0) return '';
        
        const framesList = '0, ' + gifInfo.map(info => info.frameCount).join(', ');
        const widthsList = '0, ' + gifInfo.map(info => info.scaledWidth).join(', ');
        const heightsList = '0, ' + gifInfo.map(info => info.scaledHeight).join(', ');
        
        return `const int numberOfStates = ${gifInfo.length};
const int gifFrames[numberOfStates + 1] = {${framesList}};

// 設定每個 GIF 的寬、高（縮放後）
const int gifW[numberOfStates + 1] = {${widthsList}};
const int gifH[numberOfStates + 1] = {${heightsList}};`;
    }
    
    async function copyCode() {
        const code = generateCodeSnippet();
        try {
            await navigator.clipboard.writeText(code);
            isCopied = true;
            setTimeout(() => {
                isCopied = false;
            }, 2000);
        } catch (err) {
            status = {
                type: 'error',
                message: '複製失敗，請手動選擇複製'
            };
        }
    }

    async function convert() {
        if (selectedFiles.length === 0) return;

        isProcessing = true;
        progress = 0;
        status = { type: '', message: '' };

        try {
            const zip = new JSZip();
            let totalFrames = 0;
            let processedFrames = 0;

            // 首先計算總幀數
            progressText = '正在分析 GIF 檔案...';
            const allFrames = [];
            const gifInfoData = [];

            for (let gifIndex = 0; gifIndex < selectedFiles.length; gifIndex++) {
                const file = selectedFiles[gifIndex];
                const arrayBuffer = await file.arrayBuffer();
                const parser = new GifParser(arrayBuffer);
                const frames = parser.parse();
                allFrames.push({ gifIndex, frames });
                totalFrames += frames.length;
                
                // 收集 GIF 資訊（使用第一幀的原始尺寸）
                if (frames.length > 0) {
                    const maxDimension = Math.max(frames[0].width, frames[0].height);
                    const scale = 128 / maxDimension;
                    const scaledWidth = Math.round(frames[0].width * scale);
                    const scaledHeight = Math.round(frames[0].height * scale);
                    
                    gifInfoData.push({
                        frameCount: frames.length,
                        width: frames[0].width,
                        height: frames[0].height,
                        scaledWidth: scaledWidth,
                        scaledHeight: scaledHeight
                    });
                }
            }

            progressText = `正在轉換 ${totalFrames} 幀...`;

            // 轉換並添加到 ZIP（幀編號從 0 開始）
            for (const { gifIndex, frames } of allFrames) {
                for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
                    const frame = frames[frameIndex];
                    // 計算等比例縮放後的尺寸（最長邊為 128）
                    const maxDimension = Math.max(frame.width, frame.height);
                    const scale = 128 / maxDimension;
                    const targetWidth = Math.round(frame.width * scale);
                    const targetHeight = Math.round(frame.height * scale);
                    
                    const resizedFrame = resizeFrame(frame, targetWidth, targetHeight);
                    const bmpData = createBMP(resizedFrame.width, resizedFrame.height, resizedFrame.data);
                    const filename = `frame${gifIndex + 1}-${frameIndex}.bmp`;
                    zip.file(filename, bmpData);

                    processedFrames++;
                    progress = (processedFrames / totalFrames) * 100;
                    progressText = `正在轉換: ${processedFrames}/${totalFrames} 幀`;

                    // 讓 UI 有機會更新
                    if (processedFrames % 5 === 0) {
                        await new Promise(r => setTimeout(r, 0));
                    }
                }
            }

            progressText = '正在產生 ZIP 檔案...';

            const zipBlob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 }
            }, (metadata) => {
                progress = metadata.percent;
            });

            // 下載 ZIP
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'frames.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            status = {
                type: 'success',
                message: `成功轉換 ${totalFrames} 幀！ZIP 檔案已開始下載。`
            };
            
            // 儲存 GIF 資訊
            gifInfo = gifInfoData;

        } catch (error) {
            console.error(error);
            status = {
                type: 'error',
                message: `轉換失敗：${error.message}`
            };
        }

        isProcessing = false;
    }
</script>

<div class="container">
    <h1>GIF 轉 BMP 工具</h1>
    
    <div class="upload-area">
        <div 
            class="drop-zone" 
            class:dragover={isDragover}
            role="button"
            tabindex="0"
            ondragover={handleDragOver}
            ondragleave={handleDragLeave}
            ondrop={handleDrop}
            onclick={() => fileInput.click()}
            onkeydown={(e) => e.key === 'Enter' && fileInput.click()}
        >
            <div class="drop-zone-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
            </div>
            <div class="drop-zone-text">拖放 GIF 檔案到這裡</div>
            <div class="drop-zone-hint">或點擊選擇檔案（可多選）</div>
        </div>
        <input 
            type="file" 
            bind:this={fileInput}
            accept=".gif,image/gif" 
            multiple
            onchange={handleFileSelect}
            style="display: none;"
        >
        
        {#if selectedFiles.length > 0}
            <div class="file-list" role="list" aria-label="已選擇的 GIF 檔案">
                {#each selectedFiles as file, index (file.name + file.size)}
                    <div 
                        class="file-item"
                        class:dragging={draggedIndex === index}
                        class:drag-over={dragOverIndex === index}
                        draggable="true"
                        role="listitem"
                        aria-grabbed={draggedIndex === index}
                        ondragstart={(e) => handleItemDragStart(e, index)}
                        ondragover={(e) => handleItemDragOver(e, index)}
                        ondragleave={handleItemDragLeave}
                        ondrop={(e) => handleItemDrop(e, index)}
                        ondragend={handleItemDragEnd}
                    >
                        <span class="file-item-drag-handle">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <circle cx="9" cy="6" r="2"/>
                                <circle cx="15" cy="6" r="2"/>
                                <circle cx="9" cy="12" r="2"/>
                                <circle cx="15" cy="12" r="2"/>
                                <circle cx="9" cy="18" r="2"/>
                                <circle cx="15" cy="18" r="2"/>
                            </svg>
                        </span>
                        <div class="file-item-preview">
                            <img src={getPreviewUrl(file)} alt={file.name} />
                        </div>
                        <span class="file-item-name">{file.name}</span>
                        <span class="file-item-size">{formatSize(file.size)}</span>
                        <span class="file-item-order">#{index + 1}</span>
                        <button class="file-item-remove" onclick={() => removeFile(index)}>×</button>
                    </div>
                {/each}
            </div>
            <p class="drag-hint">💡 拖曳項目可調整順序，順序會影響輸出的 GIF 編號</p>
        {/if}
        
        <button 
            class="convert-btn" 
            disabled={selectedFiles.length === 0 || isProcessing}
            onclick={convert}
        >
            {isProcessing ? '處理中...' : '開始轉換'}
        </button>
        
        {#if isProcessing}
            <div class="progress-container">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: {progress}%"></div>
                </div>
                <div class="progress-text">{progressText}</div>
            </div>
        {/if}
        
        <div class="status-container">
            {#if status.message}
                <div class="status {status.type}">
                    {status.message}
                </div>
            {/if}
        </div>
        
        {#if gifInfo && gifInfo.length > 0}
            <div class="code-section">
                <div class="code-header">
                    <h3>Arduino code</h3>
                    <button class="copy-btn" class:copied={isCopied} onclick={copyCode}>
                        {#if isCopied}
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            已複製
                        {:else}
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                            複製
                        {/if}
                    </button>
                </div>
                <pre class="code-block"><code>{generateCodeSnippet()}</code></pre>
            </div>
        {/if}
    </div>
    
    <div class="info-section">
        <h2>使用說明</h2>
        <p>此工具可以將多個 GIF 動圖的每一幀轉換成 BMP 格式並打包下載。</p>
        <ul>
            <li>支援上傳多個 GIF 檔案</li>
            <li>自動解析每個 GIF 的所有幀（coalesce）</li>
            <li>所有 BMP 檔案會打包成 <code>frames.zip</code> 下載</li>
            <li>所有處理都在瀏覽器本地完成，不會上傳到伺服器</li>
        </ul>
    </div>
</div>

<style>
    :global(*) {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }

    :global(body) {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        background: #f8f9fa;
        min-height: 100vh;
        padding: 40px 20px;
    }

    .container {
        max-width: 640px;
        margin: 0 auto;
    }

    h1 {
        color: #1a1a1a;
        font-size: 24px;
        font-weight: 600;
        margin-bottom: 24px;
    }

    .upload-area {
        background: #fff;
        border: 1px solid #e5e5e5;
        border-radius: 6px;
        padding: 24px;
        margin-bottom: 16px;
    }

    .drop-zone {
        border: 1.5px dashed #d0d0d0;
        border-radius: 6px;
        padding: 48px 24px;
        cursor: pointer;
        transition: all 0.15s ease;
        background: #fafafa;
    }

    .drop-zone:hover {
        border-color: #999;
        background: #f5f5f5;
    }
    
    .drop-zone.dragover {
        border-color: #666;
        background: #f0f0f0;
    }

    .drop-zone-icon {
        color: #999;
        margin-bottom: 12px;
    }

    .drop-zone-text {
        color: #333;
        font-size: 15px;
        font-weight: 500;
    }

    .drop-zone-hint {
        color: #999;
        font-size: 13px;
        margin-top: 6px;
    }

    .file-list {
        margin-top: 24px;
    }

    .file-item {
        display: flex;
        align-items: center;
        padding: 10px 12px;
        background: #fafafa;
        border: 1px solid #eee;
        border-radius: 6px;
        margin-bottom: 6px;
        cursor: grab;
        transition: all 0.15s ease;
    }

    .file-item:hover {
        background: #f5f5f5;
    }

    .file-item:active {
        cursor: grabbing;
    }

    .file-item.dragging {
        opacity: 0.4;
    }

    .file-item.drag-over {
        border-color: #333;
        background: #f0f0f0;
    }

    .file-item-drag-handle {
        margin-right: 10px;
        color: #ccc;
        display: flex;
        align-items: center;
        cursor: grab;
    }

    .file-item-drag-handle:hover {
        color: #999;
    }

    .file-item-preview {
        width: 40px;
        height: 40px;
        margin-right: 12px;
        border-radius: 4px;
        overflow: hidden;
        background: #fff;
        border: 1px solid #e5e5e5;
        flex-shrink: 0;
    }

    .file-item-preview img {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }

    .file-item-name {
        flex: 1;
        font-size: 14px;
        font-weight: 500;
        color: #1a1a1a;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .file-item-size {
        color: #999;
        font-size: 12px;
        margin-left: 12px;
    }

    .file-item-order {
        background: #f0f0f0;
        color: #666;
        font-size: 11px;
        padding: 3px 8px;
        border-radius: 4px;
        margin-left: 10px;
        font-weight: 500;
    }

    .file-item-remove {
        background: none;
        color: #ccc;
        border: none;
        width: 24px;
        height: 24px;
        cursor: pointer;
        margin-left: 8px;
        font-size: 18px;
        line-height: 1;
        border-radius: 4px;
        transition: all 0.15s;
    }

    .file-item-remove:hover {
        background: #fee;
        color: #e55;
    }

    .drag-hint {
        margin-top: 16px;
        font-size: 12px;
        color: #999;
        text-align: center;
    }

    .convert-btn {
        background: #1a1a1a;
        color: #fff;
        border: none;
        padding: 12px 24px;
        font-size: 14px;
        font-weight: 500;
        border-radius: 4px;
        cursor: pointer;
        margin-top: 20px;
        transition: all 0.15s;
        width: 100%;
    }

    .convert-btn:hover:not(:disabled) {
        background: #333;
    }

    .convert-btn:active:not(:disabled) {
        transform: scale(0.98);
        transform-origin: center;
    }

    .convert-btn:disabled {
        background: #e5e5e5;
        color: #999;
        cursor: not-allowed;
    }

    .progress-container {
        margin-top: 20px;
    }

    .progress-bar {
        height: 4px;
        background: #e5e5e5;
        border-radius: 2px;
        overflow: hidden;
    }

    .progress-fill {
        height: 100%;
        background: #1a1a1a;
        transition: width 0.2s ease;
    }

    .progress-text {
        margin-top: 8px;
        color: #666;
        font-size: 12px;
        text-align: center;
    }
    
    .status-container {
        min-height: 57px;
        margin-top: 16px;
    }

    .status {
        padding: 12px 16px;
        border-radius: 4px;
        font-size: 13px;
        display: flex;
        align-items: center;
        opacity: 0;
        animation: statusFadeIn 0.2s ease forwards;
    }
    
    @keyframes statusFadeIn {
        from {
            opacity: 0;
            transform: translateY(-5px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .status.success {
        background: #f0fdf4;
        color: #166534;
        border: 1px solid #bbf7d0;
    }

    .status.error {
        background: #fef2f2;
        color: #991b1b;
        border: 1px solid #fecaca;
    }

    .info-section {
        background: #fff;
        border: 1px solid #e5e5e5;
        border-radius: 6px;
        padding: 24px;
    }

    .info-section h2 {
        color: #1a1a1a;
        font-size: 15px;
        font-weight: 600;
        margin-bottom: 12px;
    }

    .info-section p {
        color: #666;
        font-size: 14px;
        line-height: 1.6;
    }

    .info-section ul {
        color: #666;
        font-size: 13px;
        margin-left: 16px;
        margin-top: 12px;
        line-height: 1.8;
    }

    .info-section li {
        margin-bottom: 4px;
    }

    .info-section code {
        background: #f5f5f5;
        padding: 2px 5px;
        border-radius: 3px;
        font-size: 12px;
        font-family: 'SF Mono', Monaco, monospace;
    }
    
    .code-section {
        background: #fff;
        border: 1px solid #e5e5e5;
        border-radius: 6px;
        padding: 24px;
        margin-bottom: 16px;
    }
    
    .code-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
    }
    
    .code-header h3 {
        color: #1a1a1a;
        font-size: 15px;
        font-weight: 600;
    }
    
    .copy-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        background: #fff;
        border: 1px solid #d0d0d0;
        border-radius: 4px;
        padding: 6px 12px;
        font-size: 13px;
        color: #333;
        cursor: pointer;
        transition: all 0.15s ease;
    }
    
    .copy-btn.copied {
        background: #f0fdf4;
        border-color: #86efac;
        color: #166534;
    }
    
    .copy-btn:hover {
        background: #f5f5f5;
        border-color: #999;
    }
    
    .copy-btn.copied:hover {
        background: #dcfce7;
        border-color: #86efac;
    }
    
    .copy-btn:active {
        transform: scale(0.98);
        transform-origin: center;
    }
    
    .code-block {
        background: #1e1e1e;
        border-radius: 6px;
        padding: 16px;
        overflow-x: auto;
        margin: 0;
    }
    
    .code-block code {
        font-family: 'SF Mono', Consolas, 'Courier New', monospace;
        font-size: 13px;
        line-height: 1.6;
        color: #d4d4d4;
        background: transparent;
        padding: 0;
        white-space: pre;
    }
</style>
