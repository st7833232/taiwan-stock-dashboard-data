# taiwan-stock-dashboard-data

台股研究儀表板的公開執行時資料庫。網站只讀取根目錄 `manifest.json`，再載入該檔案指向的同一版不可變快照。

## 更新規則

1. 建立新的 `snapshots/YYYY-MM-DD-HHmmss/` 目錄。
2. 寫入 `research.json`、`selection-history.json` 與 `paper-account.json`。
3. 驗證三份 JSON 後，最後更新根目錄 `manifest.json`。
4. 所有檔案必須在同一個 commit 中推送到 `main`。

既有快照不可覆寫或刪除。日常資料更新不需要重新建置或部署網站。

## 安全界線

這是公開資料庫，只能存放公開研究與完全虛擬的模擬交易資料。不得提交帳密、憑證、Cookie、Token、真實庫存或任何個人資料。
