// GIF Parser - 解析 GIF 檔案並提取每一幀
export class GifParser {
    constructor(arrayBuffer) {
        this.data = new Uint8Array(arrayBuffer);
        this.pos = 0;
        this.frames = [];
        this.globalColorTable = null;
        this.width = 0;
        this.height = 0;
    }

    parse() {
        // 讀取 Header
        const signature = this.readString(6);
        if (signature !== 'GIF87a' && signature !== 'GIF89a') {
            throw new Error('Invalid GIF file');
        }

        // 讀取 Logical Screen Descriptor
        this.width = this.readUint16();
        this.height = this.readUint16();
        const packed = this.readByte();
        const bgColorIndex = this.readByte();
        const pixelAspectRatio = this.readByte();

        const globalColorTableFlag = (packed & 0x80) !== 0;
        const globalColorTableSize = 1 << ((packed & 0x07) + 1);

        // 讀取 Global Color Table
        if (globalColorTableFlag) {
            this.globalColorTable = this.readColorTable(globalColorTableSize);
        }

        // 創建畫布來累積幀
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.ctx = this.canvas.getContext('2d');

        // 解析區塊
        let transparentIndex = -1;
        let disposalMethod = 0;

        while (this.pos < this.data.length) {
            const blockType = this.readByte();

            if (blockType === 0x21) {
                // Extension
                const extType = this.readByte();
                if (extType === 0xF9) {
                    // Graphics Control Extension
                    const blockSize = this.readByte();
                    const gcPacked = this.readByte();
                    const delayTime = this.readUint16();
                    transparentIndex = this.readByte();
                    this.readByte(); // Block terminator

                    disposalMethod = (gcPacked >> 2) & 0x07;
                    const transparentFlag = (gcPacked & 0x01) !== 0;
                    if (!transparentFlag) {
                        transparentIndex = -1;
                    }
                } else {
                    // Skip other extensions
                    this.skipSubBlocks();
                }
            } else if (blockType === 0x2C) {
                // Image Descriptor
                const frameData = this.readFrame(transparentIndex, disposalMethod);
                this.frames.push(frameData);
                transparentIndex = -1;
                disposalMethod = 0;
            } else if (blockType === 0x3B) {
                // Trailer - end of GIF
                break;
            } else if (blockType === 0x00) {
                // Skip padding
                continue;
            } else {
                // Unknown block, try to skip
                break;
            }
        }

        return this.frames;
    }

    readFrame(transparentIndex, disposalMethod) {
        const left = this.readUint16();
        const top = this.readUint16();
        const width = this.readUint16();
        const height = this.readUint16();
        const packed = this.readByte();

        const localColorTableFlag = (packed & 0x80) !== 0;
        const interlaceFlag = (packed & 0x40) !== 0;
        const localColorTableSize = 1 << ((packed & 0x07) + 1);

        let colorTable = this.globalColorTable;
        if (localColorTableFlag) {
            colorTable = this.readColorTable(localColorTableSize);
        }

        // LZW Minimum Code Size
        const lzwMinCodeSize = this.readByte();

        // 讀取 LZW 壓縮數據
        const compressedData = this.readSubBlocks();

        // 解壓縮 LZW 數據
        const pixels = this.decompressLZW(compressedData, lzwMinCodeSize, width * height);

        // 處理 disposal method
        let previousImageData;
        if (disposalMethod === 2) {
            // Restore to background
            this.ctx.clearRect(left, top, width, height);
        } else if (disposalMethod === 3) {
            // Restore to previous - 保存當前狀態
            previousImageData = this.ctx.getImageData(0, 0, this.width, this.height);
        }

        // 繪製幀到畫布
        const imageData = this.ctx.getImageData(left, top, width, height);
        const framePixels = imageData.data;

        for (let i = 0; i < pixels.length; i++) {
            const colorIndex = pixels[i];
            if (colorIndex !== transparentIndex && colorTable && colorIndex < colorTable.length) {
                const color = colorTable[colorIndex];
                let x = i % width;
                let y = Math.floor(i / width);

                if (interlaceFlag) {
                    y = this.deinterlace(y, height);
                }

                const pixelIndex = (y * width + x) * 4;
                framePixels[pixelIndex] = color[0];     // R
                framePixels[pixelIndex + 1] = color[1]; // G
                framePixels[pixelIndex + 2] = color[2]; // B
                framePixels[pixelIndex + 3] = 255;      // A
            }
        }

        this.ctx.putImageData(imageData, left, top);

        // 獲取完整畫布作為幀
        const fullFrameData = this.ctx.getImageData(0, 0, this.width, this.height);

        // 如果 disposal method 是 3，恢復之前的狀態
        if (disposalMethod === 3 && previousImageData) {
            this.ctx.putImageData(previousImageData, 0, 0);
        }

        return {
            width: this.width,
            height: this.height,
            data: fullFrameData.data
        };
    }

    deinterlace(y, height) {
        const interlaceOffsets = [0, 4, 2, 1];
        const interlaceSteps = [8, 8, 4, 2];

        let line = 0;
        for (let pass = 0; pass < 4; pass++) {
            for (let row = interlaceOffsets[pass]; row < height; row += interlaceSteps[pass]) {
                if (line === y) return row;
                line++;
            }
        }
        return y;
    }

    decompressLZW(data, minCodeSize, pixelCount) {
        const clearCode = 1 << minCodeSize;
        const endCode = clearCode + 1;

        let codeSize = minCodeSize + 1;
        let nextCode = endCode + 1;
        let codeMask = (1 << codeSize) - 1;

        // 初始化碼表
        let codeTable = [];
        for (let i = 0; i < clearCode; i++) {
            codeTable[i] = [i];
        }
        codeTable[clearCode] = [];
        codeTable[endCode] = null;

        const output = [];
        let bitBuffer = 0;
        let bitsInBuffer = 0;
        let dataIndex = 0;
        let prevCode = null;

        while (output.length < pixelCount && dataIndex < data.length) {
            // 填充 bit buffer
            while (bitsInBuffer < codeSize && dataIndex < data.length) {
                bitBuffer |= data[dataIndex++] << bitsInBuffer;
                bitsInBuffer += 8;
            }

            // 讀取 code
            const code = bitBuffer & codeMask;
            bitBuffer >>= codeSize;
            bitsInBuffer -= codeSize;

            if (code === clearCode) {
                // 重置碼表
                codeSize = minCodeSize + 1;
                nextCode = endCode + 1;
                codeMask = (1 << codeSize) - 1;
                codeTable = [];
                for (let i = 0; i < clearCode; i++) {
                    codeTable[i] = [i];
                }
                codeTable[clearCode] = [];
                codeTable[endCode] = null;
                prevCode = null;
                continue;
            }

            if (code === endCode) {
                break;
            }

            let entry;
            if (code < nextCode) {
                entry = codeTable[code];
            } else if (code === nextCode && prevCode !== null) {
                entry = [...codeTable[prevCode], codeTable[prevCode][0]];
            } else {
                // Invalid code
                break;
            }

            if (entry) {
                output.push(...entry);

                if (prevCode !== null && nextCode < 4096) {
                    codeTable[nextCode] = [...codeTable[prevCode], entry[0]];
                    nextCode++;

                    if (nextCode > codeMask && codeSize < 12) {
                        codeSize++;
                        codeMask = (1 << codeSize) - 1;
                    }
                }
            }

            prevCode = code;
        }

        return output;
    }

    readColorTable(size) {
        const colors = [];
        for (let i = 0; i < size; i++) {
            colors.push([
                this.readByte(),
                this.readByte(),
                this.readByte()
            ]);
        }
        return colors;
    }

    readSubBlocks() {
        const data = [];
        while (true) {
            const size = this.readByte();
            if (size === 0) break;
            for (let i = 0; i < size; i++) {
                data.push(this.readByte());
            }
        }
        return data;
    }

    skipSubBlocks() {
        while (true) {
            const size = this.readByte();
            if (size === 0) break;
            this.pos += size;
        }
    }

    readByte() {
        return this.data[this.pos++] || 0;
    }

    readUint16() {
        const val = this.data[this.pos] | (this.data[this.pos + 1] << 8);
        this.pos += 2;
        return val;
    }

    readString(length) {
        let str = '';
        for (let i = 0; i < length; i++) {
            str += String.fromCharCode(this.readByte());
        }
        return str;
    }
}
