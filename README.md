# 薪資簿 SalaryBook V1.1

繁體中文、本機優先的薪資紀錄 PWA，支援 Android 與桌面瀏覽器。程式部署到 GitHub Pages；薪資資料留在使用者目前裝置的 IndexedDB。

- 月份總覽：可切換收入組成圓環圖，以及實領、扣款與暫支薪分配圖。
- 歷史趨勢：依年份及公司篩選應發、實領、扣款折線；缺漏月份保留空白。
- 薪資紀錄：手動新增、修改、刪除、核對、原圖保存及修訂紀錄。
- 匯入薪資單：兩頁 JPG、PNG、PDF，本機 OCR 及人工確認。
- 本機備份：支援密碼加密、還原預覽、合併與 CSV 匯出。
- 離線 PWA：Service Worker 預快取網站、PDF 引擎、OCR 模型。

## 本機啟動

需要 Node.js 24。

```powershell
npm ci
npm test
npm run build
npm run dev
```

開啟伺服器顯示的 localhost 網址。首次載入後等待離線資源就緒。不要直接打開 `index.html`，瀏覽器本機資料庫、PDF 與離線功能需要 localhost 或 HTTPS。

首頁可載入「虛構示範資料」試用；這些數字不屬於任何實際薪資紀錄。匯入自己的薪資單後，請逐項人工確認 OCR 結果。

## GitHub Pages 部署

1. 將此專案推送到 `hanjhou2000716/salarybook-pwa` 的 `main` 分支。
2. GitHub Actions 會執行核心檢查、建置 `dist/` 並部署 GitHub Pages。
3. Pages 設定使用 GitHub Actions。成功後網址為 `https://hanjhou2000716.github.io/salarybook-pwa/`。

此 repository 與 Pages 網站為公開內容。公開版本不包含個人薪資紀錄、原始薪資圖片、雇主名稱、OCR 原文或真實薪資驗收值。網站使用者的資料只存在其瀏覽器內。

## 圖表資料規則

收入圖以已確認紀錄的收入細項加總，必須與原單應發總額相符才顯示占比。現金流圖需滿足應發＝實領＋扣款＋另已發暫支薪。任何待確認細項或差額都會顯示核對提示。公司公提退休金獨立列示。

月份多筆給付會合併；未登錄月份以空隙呈現，不計作零收入。備份資料格式及 IndexedDB 結構維持 V1.0 相容。

## 測試

`npm test` 驗證虛構示範紀錄、收入與現金流圖表加總、月份缺口、同月多筆薪資、篩選及備份相容性。Actions 會在部署前執行核心測試與建置。
