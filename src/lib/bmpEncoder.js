// BMP 編碼器 - 將 RGBA 資料轉換為 BMP 格式
export function createBMP(width, height, rgbaData) {
    // BMP 使用 24-bit (BGR 格式)
    const rowSize = Math.ceil((width * 3) / 4) * 4; // 每行必須是 4 的倍數
    const pixelDataSize = rowSize * height;
    const fileSize = 54 + pixelDataSize; // Header (14) + Info Header (40) + Pixel Data

    const buffer = new ArrayBuffer(fileSize);
    const view = new DataView(buffer);

    // BMP File Header (14 bytes)
    view.setUint8(0, 0x42); // 'B'
    view.setUint8(1, 0x4D); // 'M'
    view.setUint32(2, fileSize, true); // File size
    view.setUint16(6, 0, true); // Reserved
    view.setUint16(8, 0, true); // Reserved
    view.setUint32(10, 54, true); // Pixel data offset

    // DIB Header (BITMAPINFOHEADER - 40 bytes)
    view.setUint32(14, 40, true); // Header size
    view.setInt32(18, width, true); // Width
    view.setInt32(22, height, true); // Height (positive = bottom-up)
    view.setUint16(26, 1, true); // Color planes
    view.setUint16(28, 24, true); // Bits per pixel
    view.setUint32(30, 0, true); // Compression (0 = none)
    view.setUint32(34, pixelDataSize, true); // Image size
    view.setInt32(38, 2835, true); // X pixels per meter (72 DPI)
    view.setInt32(42, 2835, true); // Y pixels per meter (72 DPI)
    view.setUint32(46, 0, true); // Colors in color table
    view.setUint32(50, 0, true); // Important colors

    // Pixel Data (BGR, bottom-up)
    const pixels = new Uint8Array(buffer, 54);
    for (let y = 0; y < height; y++) {
        const srcRow = height - 1 - y; // BMP 從底部開始
        for (let x = 0; x < width; x++) {
            const srcIndex = (srcRow * width + x) * 4;
            const dstIndex = y * rowSize + x * 3;
            pixels[dstIndex] = rgbaData[srcIndex + 2];     // B
            pixels[dstIndex + 1] = rgbaData[srcIndex + 1]; // G
            pixels[dstIndex + 2] = rgbaData[srcIndex];     // R
        }
    }

    return new Uint8Array(buffer);
}
