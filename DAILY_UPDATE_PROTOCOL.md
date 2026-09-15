# 每日推薦與 20 萬模擬帳戶更新協議

本文件是 `st7833232/taiwan-stock-dashboard-data` 的日常資料發布規範。日常研究對話只授權更新本資料庫的公開 JSON；不得因此修改或部署 `st7833232/taiwan-stock-research-dashboard`，不得提交任何秘密資訊或真實庫存。

允許本資料庫建立純資料基礎設施排程，用於自動擷取、保存與驗證 TWSE、TPEx 等官方公開市場資料。此類排程不得自行產生研究結論、推薦、模擬交易、修改 `manifest.json` 或部署網站；其輸出只能作為後續資料完整性 Gate 與研究流程的官方原始證據。

目前研究進場策略版本：`entry-dual-track-v1`。

### 官方市場資料擷取器例外

- 可使用 GitHub Actions 定時執行官方公開資料擷取器。
- 優先直接讀取官方 API／OpenAPI；若官方 API 無法取得，才依序嘗試同機構官方 HTML／CSV／其他免費官方端點。
- TPEx 上櫃個股三大法人明細主要來源為免費官方 OpenAPI `tpex_3insti_daily_trading`；TPEx 官方三大法人買賣明細 HTML／CSV／legacy result endpoint 為 fallback 與交叉驗證。S35 付費資料商品不得作為主要 Gate。
- 擷取器的網路錯誤、403、timeout、WAF/CDN、解析失敗、動態頁無法展開或無法取得 payload 只能記錄為 `VERIFY_FAILED`，不得轉述為「官方資料缺失」。
- 只有官方 payload／頁面實際顯示目標交易日，才能記為 `PASS`。一旦某來源對該交易日 PASS，後續其他擷取失敗不得將其降級。
- `CONFIRMED_MISSING` 必須有可讀官方來源明確顯示目標日不存在／尚未發布，且至少另一個官方來源或端點交叉確認。
- Search snippet、搜尋索引日期、第三方資料不得作為 freshness Gate 證據。
- 原始擷取結果應保存於日期化路徑（例如 `raw/YYYY-MM-DD/`），並保留來源、擷取時間、HTTP／解析狀態與官方資料日期，供後續稽核。

## 1. 基準狀態與權限邊界

- 僅操作 `main`。
- 開始時記錄 `main` HEAD SHA，讀取根目錄 `manifest.json`，再依其路徑讀取最新版 `research.json`、`selection-history.json`、`paper-account.json`。
- 現有 snapshot 為不可變資料；不得覆寫、刪除或事後修正。
- 不得自行升級或改變既有 schemaVersion、既有欄位語意或網站資料介面。新增向後相容的研究欄位可以使用，但不得破壞舊資料讀取。
- 若現有結構不足以安全表達某項操作，Fail Closed，不自行發明不相容 schema。

## 2. 交易日與資料完整性 Gate

所有日期時間使用 `Asia/Taipei`。

更新前必須確認：

1. 研究日為台灣證券市場正式交易日。
2. 本次所需收盤價、成交量及研究所依賴的關鍵盤後資料已正式公開。
3. 各主要來源的資料日期一致，且不得晚於本次研究截止點。
4. 不使用未正式發布、預估當正式數字、未來資料或事後資訊回填先前決策。

任一關鍵條件不成立即 `NO_UPDATE`：不得建立新 snapshot、不得新增 selection history、不得更新 paper account、不得修改 manifest、不得建立資料發布 commit。

「下一交易日」必須依台灣市場實際交易日決定，不等同下一日曆日。

## 3. 每日研究

研究母體包含當日有效的上市、上櫃普通股與 ETF，排除權證、ETN、可轉換公司債、特別股及其他不屬策略母體的商品。

優先研究股價 200 元以下、流動性合理且具有可驗證未來題材的標的；核心 ETF 可因市場代表性保留，不受 200 元優先條件限制。

研究至少涵蓋：國際市場與總經、台股與產業環境、產業題材與資金輪動、基本面、營收與財務趨勢、估值、技術、成交量、法人與公開籌碼、催化劑、風險、條件式進場與百分比配置。

可自主新增、保留、升級、降級或排除候選。不得為每日輸出而硬推薦；沒有合理買點時必須標示觀望、配置 0% 與等待條件。總配置不得超過 100%，現金可為 100%。研究推薦不等於模擬或真實成交。

新的 `research.json` 應寫入 `strategyVersion: "entry-dual-track-v1"`，讓同日重跑可以辨識方法論是否已實質改變。

### 3.1 進場策略：Pullback + Breakout 雙軌制

不再把「回測到指定價格」設為唯一可進場方式。每個 `group = priority` 且 A 級家族的標的，必須同時評估以下兩條互補路徑：

#### A. Pullback 回測型

- 價格回到事先定義的支撐／偏好區。
- 必須有可驗證的止穩條件，例如量縮、收回關鍵價、或未跌破結構支撐。
- 法人不得出現與研究方向明顯相反的重大反手。
- 只有價格進區但籌碼明顯惡化時，不得因「碰到目標價」自動進場。

#### B. Breakout 突破型

- 若標的沒有回測，但正式突破近期平台、壓力位或前高，可評估以較小 starter position 先建立部位。
- 突破必須至少由價格突破確認，並搭配量能或法人方向等可驗證條件；不得單純看到上漲就追價。
- 風險偏多／中性環境可以使用一般 starter；市場偏空、外資大幅賣超或櫃買明顯弱勢時，提高突破門檻並縮小 starter 部位。
- 每個突破條件必須設定 `maxChase`，避免隔日跳空過大仍追價。
- 若隔日開盤已高於 `maxChase`，該突破路徑必須取消，不得事後改價追買。

每個 priority 標的必須在研究中明確表達：

- `pullbackEntry`
- `breakoutTrigger`
- `maxChase`
- `invalidCondition`

若某一路徑缺乏足夠證據，應標示 `unavailable`，不得主觀補足。

突破型不是用來取代回測型；兩者的目的是降低「只等回測而錯失趨勢起漲」與「無限制追高」兩種相反風險。

## 4. Snapshot 與 selection history

Gate 通過後，以執行當下台北時間建立 `revision = YYYY-MM-DD-HHmmss`，並建立：

- `snapshots/<revision>/research.json`
- `snapshots/<revision>/selection-history.json`
- `snapshots/<revision>/paper-account.json`

不得覆寫既有 revision。

`selection-history.json` 由上一版複製後更新，每個正式研究交易日只能有一筆。

一般同日重跑且沒有新的正式資料或方法論變化時回報 `NO_CHANGE`，不得建立無意義 revision。

但若 `DAILY_UPDATE_PROTOCOL.md` 的策略版本已改變，或前一版 `research.strategyVersion` 與現行策略版本不同，視為方法論實質變更，可以同日重新產生研究 snapshot。此時：

- 不得新增重複日期；必須以新研究結果取代 `selection-history` 中當日那一筆。
- 不得改寫舊 snapshot；只能建立新的 revision。
- 同日新策略不得倒推或改寫今天已經發生的模擬成交，只能影響今天研究結論與下一交易日 `nextOrders`。

`selected` 僅能包含當日 `research.json` 中 `group = priority` 且屬 A 級評等家族的標的（A、A+、A- 後接說明皆可）。穩定度、連續入選與出現率只能由歷史紀錄重新計算，禁止人工累加。

## 5. 20 萬模擬帳戶：禁止前視偏誤

模擬帳戶起始資金固定為 `200000 TWD`，與真實庫存完全分離，絕不進行真實下單。

今日只能處理「前一交易日最新版 `paper-account.json` 已存在的 `nextOrders`」。不得使用今日研究結果新增、刪除、修改或倒推今日委託。

成交判定只能依前一版 nextOrder 已公開記錄的：

- `tradingDate`
- `code`
- `side`
- `shares`
- `executionRule`
- `cancelCondition`
- 其他當時已存在的失效／成交規則

再配合今日正式市場資料機械式判斷。

若規則不足以唯一判定成交與成交價，或市場資料精度不足，不得猜測成交；在 ledger 留下「無法確認／不成交」及原因。除非既有規則明確支援，否則不模擬部分成交。

多筆委託依既有順序／優先規則處理，不得因事後報酬重新排序。資金不足時不得讓現金為負，也不得自行縮減股數；後續委託依既有規則取消／拒絕並留下 ledger 原因。

交易成本沿用既有 paper-account 規則；不得自行猜券商折扣、稅率或費率。公司行動只能依正式生效資料處理，並須留下可追溯紀錄，不得把除權息、分割或減資誤判為投資績效。

每筆今日既有委託，不論成交、未成交、取消、條件未觸發或資料不足，都要在 ledger 留下可重算狀態與原因。

完成後至少驗證：

- `cash >= 0`
- positions 股數與 ledger 一致
- 平均成本可由交易流水重算
- 帳戶總權益可由現金與持倉市值重算
- 無重複成交
- 今日新決策沒有被當成今日成交

## 6. 新的 nextOrders

完成今日既有委託處理與今日研究後，才可建立新的 `nextOrders`，且 `tradingDate` 必須是實際下一個台股交易日。

每筆 order 至少要能讓下一次執行不靠模型主觀補充即可判定：有效交易日、方向、代碼、股數、價格／觸發規則、取消條件與必要失效規則。

### 6.1 Pullback order

回測型 order 必須明確寫出價格區間與取消條件。若還需要量縮、收盤確認等只能在收盤後確認的條件，則不得假裝成開盤成交；必須設計成能由下一次執行使用正式 OHLC／成交量機械判定的規則。

### 6.2 Breakout stop-entry order

突破型 order 可以使用日線 OHLC 模擬 stop-entry，但必須在建立時固定：

- `trigger price`
- `gap-up handling`
- `max-chase`
- `execution price rule`
- `cancelCondition`

建議的可重算機械規則：

- 若下一交易日官方開盤價 > `maxChase`：取消，不成交。
- 若開盤價介於 `trigger price` 與 `maxChase`：視為跳空觸發，以官方開盤價模擬成交。
- 若開盤價 < `trigger price`，但官方最高價 >= `trigger price`：視為盤中 stop 被觸發，以 `trigger price` 模擬成交。
- 若最高價 < `trigger price`：未觸發，不成交。

若研究要求的突破確認還包含「當日收盤必須站穩」等事後才能知道的條件，就不能用上述盤中 stop 規則；應延後到下一個研究日再決策，避免前視偏誤。

同一標的同一交易日若同時設計 Pullback 與 Breakout 路徑，必須做成互斥條件或單一複合 order，避免同一天雙重成交。

不得建立明顯超出可用現金且沒有明確資金處理規則的委託組合。

## 7. Manifest、原子提交與併發保護

三份 snapshot JSON 全部建立並驗證完成後，最後才更新根目錄 `manifest.json`：

- `revision` 指向本次 revision
- 三個 path 必須全部指向同一個 `snapshots/<revision>/`
- `updatedAt` 使用含 `+08:00` 的完整 ISO 8601 台北時間

三份 snapshot 與 manifest 必須在同一個 Git commit 中進入 `main`。不得用多個 commit 造成 manifest 暫時指向不存在或不完整的資料。

提交前再次取得 `main` HEAD。若已不同於開始時記錄的 base SHA，必須重新讀取最新狀態並正常 reconcile；不得 force push、不得用舊資料覆蓋新資料。

## 8. Commit 前驗證

必須驗證：JSON 可解析、manifest schemaVersion 維持現行版本、revision/path 一致、三個資料檔存在、日期格式正確、selection history 無重複日期、selected 符合 priority + A 級資格、代碼格式合理、現金與持倉可重算、無今日決策今日成交、無未來資料、無真實庫存與秘密資訊。

使用 `entry-dual-track-v1` 的新研究還必須驗證：priority A 級候選有雙軌欄位；若存在突破型 `nextOrders`，其 trigger、gap-up、max-chase、成交價與取消條件足以機械重算。

任何關鍵驗證失敗都不得提交部分結果。

## 9. 狀態回報

成功資料提交：`DATA_UPDATED`，只能稱「資料檔已更新」，不得稱網站已重新部署。

非交易日、資料不完整或驗證失敗：`NO_UPDATE`，GitHub 保持原狀。

同日已成功發布且沒有新的有效資料或方法論變化：`NO_CHANGE`，不得建立無意義 commit。

成功時回報：交易／研究日期、推薦清單與分層、主要升降級、Pullback／Breakout 進場條件、模擬帳戶現金與持倉、今日成交／未成交、新的下一交易日條件單、commit SHA 與 validation run。失敗或無變更時只回報狀態與原因。
