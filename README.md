# taiwan-stock-dashboard-data

台股研究儀表板的公開執行時資料庫。網站只讀取根目錄 `manifest.json`，再載入該檔案指向的同一版不可變快照。

## 每日資料更新

每日研究與 20 萬模擬帳戶更新必須遵守 [`DAILY_UPDATE_PROTOCOL.md`](./DAILY_UPDATE_PROTOCOL.md)。核心原則：

1. 先確認台股交易日與盤後資料完整性；不完整即 Fail Closed，不更新。
2. 只依前一交易日已存在的 `nextOrders` 判斷今日模擬成交，禁止用今日結果倒推交易。
3. 建立新的 `snapshots/YYYY-MM-DD-HHmmss/`，既有 snapshot 不可覆寫或刪除。
4. 寫入 `research.json`、`selection-history.json` 與 `paper-account.json`，完成驗證後才更新根目錄 `manifest.json`。
5. 三份 snapshot JSON 與 manifest 必須在同一個 commit 中推送到 `main`。
6. 提交前重新確認 `main` HEAD 未被其他程序更新；不得 force push 或用舊基準覆蓋新資料。

日常資料更新不需要重新建置或部署網站；GitHub 資料提交成功只能稱為「資料檔已更新」。

## 自動驗證

每次 push / pull request 會執行：

```bash
node scripts/validate-data.mjs
node scripts/validate-dashboard-contract.mjs
node scripts/validate-strategy-v2.mjs
```

目前驗證包含：

- `manifest.json` revision、schemaVersion、Asia/Taipei `updatedAt` 與三個 snapshot path。
- 三份 JSON 可解析且 manifest 指向的檔案存在。
- selection history 日期與 selected 不重複，且當期 selected 必須來自 priority + A 級候選。
- 模擬帳戶起始資金、非負現金、持倉、平均成本可由 ledger 重算。
- `nextOrders` 必須具備未來交易日、代碼、方向、股數、成交規則與取消條件。
- 舊 snapshot 不得修改／刪除；新增 snapshot 與 manifest 必須同一 commit。
- 基本秘密資訊格式掃描。
- Dashboard `conclusion / avoid / invalid / invalidCondition` contract。
- `entry-dual-track-v2` 策略 contract：Market Regime 門檻、100 分權重、BUY 流動性、RR、Breakout 量比、全市場排名、新聞來源分級與最多 3 個 BUY 候選。舊 v1 snapshot 在 migration 期間只會 skip 此 validator。

## 安全界線

這是公開資料庫，只能存放公開研究與完全虛擬的模擬交易資料。不得提交帳密、憑證、Cookie、Token、真實庫存或任何個人資料。

不得因本資料庫更新而修改或部署 `st7833232/taiwan-stock-research-dashboard`，也不得建立或恢復任何排程。
