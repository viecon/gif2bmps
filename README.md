# GIF 轉 BMP 工具

一個純前端的工具，可以將多個 GIF 動圖的每一幀轉換成 BMP 格式並打包下載。

## 功能

- 支援上傳多個 GIF 檔案（拖放或點擊選擇）
- 自動解析每個 GIF 的所有幀
- 將每幀轉換為 24-bit BMP 格式
- 輸出檔名格式：`frame{GIF編號}-{幀編號}.bmp`（從 0 開始）
- 所有 BMP 檔案會打包成 `frames.zip` 下載
- 所有處理都在瀏覽器本地完成，不會上傳到伺服器

## 技術棧

- Svelte 5
- Vite
- JSZip

## 開發

```bash
# 安裝依賴
npm install

# 啟動開發伺服器
npm run dev

# 建構生產版本
npm run build
```
