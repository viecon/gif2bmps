<script>
    import JSZip from 'jszip';
    import { GifParser } from './lib/gifParser.js';
    import { createBMP } from './lib/bmpEncoder.js';

    let selectedFiles = $state([]);
    let isDragover = $state(false);
    let isProcessing = $state(false);
    let progress = $state(0);
    let progressText = $state('');
    let status = $state({ type: '', message: '' });

    let fileInput;

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
                }
            }
        }
    }

    function removeFile(index) {
        selectedFiles = selectedFiles.filter((_, i) => i !== index);
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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

            for (let gifIndex = 0; gifIndex < selectedFiles.length; gifIndex++) {
                const file = selectedFiles[gifIndex];
                const arrayBuffer = await file.arrayBuffer();
                const parser = new GifParser(arrayBuffer);
                const frames = parser.parse();
                allFrames.push({ gifIndex, frames });
                totalFrames += frames.length;
            }

            progressText = `正在轉換 ${totalFrames} 幀...`;

            // 轉換並添加到 ZIP（幀編號從 0 開始）
            for (const { gifIndex, frames } of allFrames) {
                for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
                    const frame = frames[frameIndex];
                    // Resize 幀到 128x128
                    const resizedFrame = resizeFrame(frame, 128, 128);
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
            <div class="file-list">
                {#each selectedFiles as file, index (file.name + file.size)}
                    <div class="file-item">
                        <span class="file-item-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                                <circle cx="8.5" cy="8.5" r="1.5"/>
                                <polyline points="21 15 16 10 5 21"/>
                            </svg>
                        </span>
                        <span class="file-item-name">{file.name}</span>
                        <span class="file-item-size">{formatSize(file.size)}</span>
                        <button class="file-item-remove" onclick={() => removeFile(index)}>×</button>
                    </div>
                {/each}
            </div>
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
        
        {#if status.message}
            <div class="status {status.type}">
                {status.message}
            </div>
        {/if}
    </div>
    
    <div class="info-section">
        <h2>使用說明</h2>
        <p>此工具可以將多個 GIF 動圖的每一幀轉換成 BMP 格式並打包下載。</p>
        <ul>
            <li>支援上傳多個 GIF 檔案</li>
            <li>自動解析每個 GIF 的所有幀（coalesce）</li>
            <li>輸出尺寸：128×128</li>
            <li>輸出檔名格式：<code>frame{'{'}GIF編號{'}'}-{'{'}幀編號{'}'}.bmp</code>（GIF 從 1 開始，幀從 0 開始）</li>
            <li>輸出格式：BMP3（Windows 3.x BITMAPINFOHEADER）</li>
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
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: linear-gradient(135deg, #e8ecf1 0%, #d1d8e0 100%);
        min-height: 100vh;
        padding: 20px;
    }

    .container {
        max-width: 800px;
        margin: 0 auto;
    }

    h1 {
        color: #2d3436;
        text-align: center;
        margin-bottom: 30px;
    }

    .upload-area {
        background: white;
        border-radius: 16px;
        padding: 40px;
        text-align: center;
        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        margin-bottom: 20px;
    }

    .drop-zone {
        border: 3px dashed #636e72;
        border-radius: 12px;
        padding: 60px 20px;
        cursor: pointer;
        transition: all 0.3s ease;
        background: #f5f6fa;
    }

    .drop-zone:hover, .drop-zone.dragover {
        background: #dfe6e9;
        border-color: #2d3436;
    }

    .drop-zone-icon {
        color: #636e72;
        margin-bottom: 15px;
    }

    .drop-zone-text {
        color: #666;
        font-size: 18px;
    }

    .drop-zone-hint {
        color: #999;
        font-size: 14px;
        margin-top: 10px;
    }

    .file-list {
        margin-top: 20px;
        text-align: left;
    }

    .file-item {
        display: flex;
        align-items: center;
        padding: 12px;
        background: #f5f5f5;
        border-radius: 8px;
        margin-bottom: 8px;
    }

    .file-item-icon {
        margin-right: 12px;
        color: #636e72;
        display: flex;
        align-items: center;
    }

    .file-item-name {
        flex: 1;
        font-weight: 500;
        color: #333;
    }

    .file-item-size {
        color: #888;
        font-size: 14px;
    }

    .file-item-remove {
        background: #ff4757;
        color: white;
        border: none;
        border-radius: 50%;
        width: 24px;
        height: 24px;
        cursor: pointer;
        margin-left: 12px;
        font-size: 14px;
        line-height: 1;
    }

    .file-item-remove:hover {
        background: #ff3344;
    }

    .convert-btn {
        background: #2d3436;
        color: white;
        border: none;
        padding: 16px 48px;
        font-size: 18px;
        border-radius: 50px;
        cursor: pointer;
        margin-top: 20px;
        transition: transform 0.2s, box-shadow 0.2s;
    }

    .convert-btn:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 5px 20px rgba(45, 52, 54, 0.3);
    }

    .convert-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .progress-container {
        margin-top: 20px;
    }

    .progress-bar {
        height: 20px;
        background: #e0e0e0;
        border-radius: 10px;
        overflow: hidden;
    }

    .progress-fill {
        height: 100%;
        background: #2d3436;
        transition: width 0.3s ease;
    }

    .progress-text {
        margin-top: 10px;
        color: #666;
        font-size: 14px;
    }

    .status {
        margin-top: 15px;
        padding: 12px;
        border-radius: 8px;
    }

    .status.success {
        background: #d4edda;
        color: #155724;
    }

    .status.error {
        background: #f8d7da;
        color: #721c24;
    }

    .info-section {
        background: white;
        border-radius: 16px;
        padding: 30px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
    }

    .info-section h2 {
        color: #333;
        margin-bottom: 15px;
    }

    .info-section p {
        color: #666;
        line-height: 1.6;
    }

    .info-section ul {
        color: #666;
        margin-left: 20px;
        margin-top: 10px;
    }

    .info-section li {
        margin-bottom: 8px;
    }

    .info-section code {
        background: #f0f0f0;
        padding: 2px 6px;
        border-radius: 4px;
        font-family: monospace;
    }
</style>
