# taiwan-stock-dashboard-data

台股研究儀表板的公開執行時資料庫。網站只讀取根目錄 `manifest.json`，再載入該檔案指向的同一版不可變快照。

## 每日資料更新

每日研究與 20 萬模擬帳戶更新必須遵守 [`DAILY_UPDATE_PROTOCOL.md`](./DAILY_UPDATE_PROTOCOL.md)，策略版本、門檻與風控數值以根目錄 `strategy-config.json` 為機器可讀的單一設定來源。核心原則：

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
- publication recovery 會比較最新 research.strategyVersion 與 `strategy-config.json`；舊策略即使日期完整也會回到 `RESEARCH_REQUIRED`。
- `entry-dual-track-v2` 策略 contract：Market Regime 門檻、100 分權重、BUY 流動性、RR、Breakout 量比、全市場排名、新聞來源分級與最多 3 個 BUY 候選。舊 v1 snapshot 在 migration 期間只會 skip 此 validator。

## 安全界線

這是公開資料庫，只能存放公開研究與完全虛擬的模擬交易資料。不得提交帳密、憑證、Cookie、Token、真實庫存或任何個人資料。

不得因本資料庫更新而修改或部署 `st7833232/taiwan-stock-research-dashboard`，GitHub資料管線依本協議自動接續；不得建立重複的ChatGPT/Work計算排程。
# 對話查閱流程

官方 capture 後由 GitHub Actions 執行 `scripts/screen-market.mjs`，將全市場逐檔結果寫入 `raw/<交易日>/screening-results.json`，並以單一 Git Data commit 發布三份 immutable snapshots 與 manifest。對話只需讀取 manifest 與 `raw/<交易日>/daily-report.json`、`publication-state.json`、最新 validation run；不必重抓16MB研究輸入或另開Work任務。流程不呼叫LLM API、不修改Dashboard。

`SNAPSHOT_UPDATED_EVIDENCE_PENDING` 只代表資料快照與全市場篩選已更新，不能視為完整研究。必要信用證據與其他研究Hard Gate未通過時，維持WATCH/NO_TRADE與空新單；所有缺項保留在逐檔結果。帳戶執行尚未通過確定性風控時，既有委託記為未確認，禁止猜測成交。

重試保存已PASS的Gate與可驗證的官方auxiliary證據；週/月證據可使用targetDate之前已捕獲的archive，但仍須另驗freshness。來源內容不變且設定不變時NO_CHANGE；只有capture時間變更不重做快照。遠端main變動即停止發布並保存workflow artifact，下一次從新main重跑，禁止force push。


## 自動接續，不需對話催跑

唯一執行入口為 `node scripts/run-daily-pipeline.mjs`。台北時間工作日18:00～23:30每半小時檢查，07:20、08:20恢復前一盤後日期；GitHub排程可能延遲。完整成功先去重，部分研究繼續補官方證據，無新內容不建立新revision。來源或validator失敗留artifact，下次自動接續。

查閱 `raw/<date>/daily-report.json`、`pipeline-status.json`、`evidence-pending.json` 與對應 workflow run。`validation.status=PASS` 只表示三層檔案驗證；`researchComplete` 必須另行成立，信用／財務／事件未完成不能混稱完整研究。財報與TDCC原始擷取已自動化；原始payload不會自行證明品質、前瞻事件風險或除權息調整已驗證。

本管線是Node.js / GitHub Actions運算，不呼叫LLM API，不建立Work補跑任務。Dashboard仍只讀manifest，不修改／部署Dashboard。

`evidencePending.fundamental` 僅計入財務證據未完成的個股。證據完整但品質未通過者另列 `fundamentalQualityRejected`（代號與失敗原因），不阻止 `researchComplete`，但 Fundamental 買進 Gate 維持不通過；其他必要證據缺項仍阻止研究完成。

財報 PDF 蒐集以 5 分鐘批次保存進度，不再固定只處理 12 筆。可處理的佇列仍有項目且本輪正式資料驗證成功時，Actions 自動接續，單一接續鏈最多 40 輪；既有定時排程仍會繼續處理剩餘項目。連線與 OCR 暫時失敗依退避時間重試，官方限流會停止本輪接續。已下載的 PDF、期間表與 OCR 頁面會重用，仍須核對合併財報版本、公開截止時間、檔案雜湊、累計期間、幣別單位與母公司淨利。

前一年同期已驗證為虧損或零基期時，年增率維持 `null`，另列 `COMPARATIVE_GROWTH_NOT_APPLICABLE`，不再把已取得數字稱為證據缺失，且不放行買進。缺少數字、獲利口徑不同及無法證明當時版本的資料仍保留 pending。金融業沒有揭露的毛利欄位不會被捏造或以其他收益替代。
