# 每日推薦與 20 萬模擬帳戶更新協議

本文件是 `st7833232/taiwan-stock-dashboard-data` 的日常資料發布規範。日常研究對話只授權更新本資料庫的公開 JSON；不得因此修改或部署 `st7833232/taiwan-stock-research-dashboard`，不得提交任何秘密資訊或真實庫存。

允許本資料庫建立純資料基礎設施排程，用於自動擷取、保存與驗證 TWSE、TPEx 等官方公開市場資料。此類排程不得自行產生研究結論、推薦、模擬交易、修改 `manifest.json` 或部署網站；其輸出只能作為後續資料完整性 Gate 與研究流程的官方原始證據。

目前研究進場策略版本：`entry-dual-track-v2`。

機器可執行的門檻與權重以根目錄 `strategy-config.json` 為單一設定來源；DAILY_UPDATE_PROTOCOL.md、排程提示詞與 validator 不得各自維護互相衝突的數值。策略版本變更時，`check-daily-publication.mjs` 必須把舊策略 publication 視為 `RESEARCH_REQUIRED`。

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

新的 `research.json` 應寫入 `strategyVersion: "entry-dual-track-v2"`，讓同日重跑可以辨識方法論是否已實質改變。

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

### 3.2 entry-dual-track-v2：全市場篩選、事件確認與決策 Gate

本版本在保留 Pullback + Breakout 雙軌互斥的前提下，新增下列強制研究規則。這些規則屬於研究與候選委託生成層；真實券商送單、成交、部分成交、拒單、撤單等狀態仍必須由外部 deterministic Execution Engine／Broker API 回報，研究流程不得自行宣稱成交。

#### A. 全市場母體與流動性

- 普通股母體為上市、上櫃普通股；ETF 必須與普通股分開評估，不得完整套用普通股的 TDCC、投信認養、公司營收／EPS 權重。
- 排除權證、ETN、可轉債、牛熊證、停止交易、交易狀態異常、Corporate Action 無法確認、資料品質無法確認的標的。
- 研究仍優先股價 <= 200 元；> 200 元不是品質扣分，但原則僅列 WATCH／Secondary Candidate，除非策略另有授權。
- 普通股 BUY 候選預設要求 20 日中位數日成交金額 >= NT$50,000,000；低於門檻可以 WATCH，不得自動 BUY。
- Position value 相對 20 日中位數成交金額不得達到不合理比例；無法以縮小部位解決時 Fail Closed。

#### B. Market Regime 與 BUY 門檻

- BULL：正常評估新多單，最低 BUY Score 82。
- NEUTRAL：提高最低 BUY Score 至 86，並降低單筆風險與總曝險。
- BEAR：一般普通股不得建立新多單，只允許 HOLD／REDUCE／SELL／WATCH／NO_TRADE。
- HIGH_RISK：禁止新建多單，只允許既有風險管理。
- 高 Score 不得覆蓋 Market Regime Hard Gate。

#### C. 允許策略與候選排序

只允許：
- BREAKOUT
- TREND_PULLBACK
- CHIP_ACCUMULATION_BREAKOUT

禁止以猜底、單純 RSI 超賣、單日法人買超、單一券商買超或單一新聞標題作為 BUY 觸發。

Hard Gate 通過後才做 Cross-Sectional Ranking。主要 Priority BUY Candidate 應同時：
- 達到對應 Market Regime 的最低 Score；
- 位於 Eligible Universe 前段，原則採前 10%，且排名不差於 Top 50；
- 最多保留 3 個 Priority BUY Candidate；
- 不得為湊滿 3 檔降低門檻。

#### D. Score 100 與避免重複計分

普通股評分：
- Trend 18
- Momentum 8
- Volume + Liquidity 10
- Market Regime 8
- Institutional 15
- TDCC / Large Holder 8
- Margin / Short / Lending 6
- Fundamental Quality 10
- Industry / News / Catalyst 5
- Risk / Reward + Execution Quality 12

總分必須 = 100。

相同底層資料不得重複完整計分：法人主要計 Institutional；TDCC 主要計 Large Holder；融資／借券主要計 Margin / Short / Lending；題材與新聞主要計 Industry / News / Catalyst。Score 只用於排序，不能覆蓋 Hard Gate。

#### E. 技術與雙軌 Entry

BREAKOUT：
- EOD 模式必須正式收盤站上有效壓力或近 20 日高點。
- Volume / VolumeMA20 >= 1.5 為標準有效門檻；1.2～1.49 原則 WATCH；<1.2 不得標準 BREAKOUT BUY。
- 必須有合理 Stop 與 Risk / Reward >= 2。
- Extreme Volume + Upper Shadow + Weak Close + Institutional Selling 視為 EXHAUSTION_RISK。

TREND_PULLBACK：
- 中期趨勢仍向上。
- 回測 MA10／MA20／前波突破位／結構支撐。
- 理想為回檔量縮，止跌後再度轉強。
- 尚未止跌或結構支撐已失效不得提前猜底。

Priority Candidate 可同時建立 Pullback Route 與 Breakout Route，但必須 MUTUALLY_EXCLUSIVE；任一路實際成交後另一條取消。Breakout 必須保留 maxChase／max entry；開盤或實際價格高於 max entry 時取消，不得追價。

#### F. 籌碼與 TDCC

- 外資、投信、自營商必須拆開評估，至少檢查 1D／3D／5D／10D／20D（資料可取得時）。
- TDCC 為週頻；只要使用官方最近一期已公布資料即視為 VALID。
- 400+、800+、1000+ 高度相關，不得各自重複完整加分。
- 大戶增加、散戶下降、法人偏買、融資穩定／下降、借券未惡化屬高品質確認，但任何單一籌碼指標不得直接觸發 BUY。

#### G. News / Event / Catalyst

新聞與事件只可作為 Confirmation／Risk Filter／Catalyst Quality，不得單獨觸發 BUY。

來源分級：
- SOURCE_A：交易所、公開資訊觀測站、公司公告、法說、主管機關、政府正式公告與其他一手來源。
- SOURCE_B：可信主流財經媒體、專業產業媒體，只能作 Confirmation，除非有 SOURCE_A 交叉確認。
- SOURCE_C：社群、論壇、匿名消息、未確認轉載，不得正面加分或觸發 BUY。

至少辨識事件類型：EARNINGS、REVENUE、GUIDANCE、INVESTOR_CONFERENCE、MAJOR_ORDER、CAPEX、PRODUCT、INDUSTRY_PRICE、POLICY、REGULATION、LITIGATION、GOVERNANCE、TRADING_HALT、DISPOSITION、CORPORATE_ACTION、SUPPLY_CHAIN、GEOPOLITICAL、OTHER。

催化劑必須考慮：
- source quality
- event timestamp / age
- event direction
- price confirmation
- volume confirmation
- institutional confirmation

Positive News + Price Weak + Institutional Selling 應標記為正面新聞背離並降低品質。

未來 1 個交易日若存在重大二元事件（重大財報、重大法說、監管／司法結果、重大公司事件），而本策略不是 Event Strategy，禁止新建部位。

#### H. Risk / Reward、帳戶與相關性

- 所有 BUY 必須有 Entry、Max Entry、Stop、Candidate Position Size 與合理市場結構可支持的 Risk / Reward >= 2。
- 不得任意縮 Stop 或任意提高 Target 製造 RR >= 2。
- 單筆預設風險 0.5% Account Equity；Hard Cap 1.0%。
- 單一股票最大曝險 10%；同一產業 20%；總持股曝險 50%。
- 單日最大已實現 + 未實現虧損 1.5%；單週最大虧損 4%；連續 3 筆 realized loss 停止新增交易並重新檢查策略與市場環境。
- 多檔同產業／同題材／高 Beta 高相關候選不得視為完全獨立風險。

#### I. EOD 與 Execution 分離

目前研究預設為 EOD：
- 只能使用完整正式日 K 建立新 BUY Setup。
- 盤後 BUY 只代表交易意圖與候選 nextOrder，不代表已送單或已成交。
- 真實送單前必須重新取得 latest quote、bid、ask、cash、holdings、open orders、trading status，再由 deterministic code 重算 position size、RR、單股曝險、產業曝險、總曝險、spread、signal expiration。
- 若實際價格高於 max entry、RR 降到 <2、spread 異常、訊號過期、資金或曝險超限，取消訊號。
- LLM 與 deterministic risk calculation 衝突時，以 deterministic engine 為準。

#### J. Dashboard 相容性

新的 research snapshot 仍必須維持現有 Dashboard contract：
- 頂層 conclusion 非空，若有 decision.summary 必須一致。
- 所有 Dashboard candidate 必須有具體 avoid 與 invalid。
- Priority candidate 必須保留 invalidCondition，且 invalid 與 invalidCondition 語意／內容一致。
- 不得使用「資料不足」「資料失效」等 generic placeholder 作為 avoid／invalid。
- 本次策略升級不得破壞既有 manifest、selection-history、paper-account 與 Dashboard 讀取介面。

### 3.3 v2 機器可驗證研究欄位

為了讓 CI 可以驗證新版策略，而不是只依賴自然語言，`entry-dual-track-v2` 的新 research snapshot 必須額外提供向後相容欄位；Dashboard 可以忽略這些新欄位，但資料發布 validator 必須檢查。

頂層 `strategyProfile` 至少包含：

- `version = "entry-dual-track-v2"`
- `signalMode = "EOD"`
- `marketRegime = BULL | NEUTRAL | BEAR | HIGH_RISK`
- `buyScoreThreshold`：BULL=82、NEUTRAL=86；BEAR/HIGH_RISK 可為 null
- `liquidityMedianTurnover20dMin = 50000000`
- `priorityMaxCandidates = 3`
- `priorityPercentileMax = 10`
- `priorityRankMax = 50`
- `minRiskReward = 2`
- `riskPerTradePct = 0.5`
- `riskPerTradeHardCapPct = 1`
- `singleStockExposureMaxPct = 10`
- `sectorExposureMaxPct = 20`
- `totalExposureMaxPct = 50`
- `dailyLossLimitPct = 1.5`
- `weeklyLossLimitPct = 4`
- `scoreWeights` 必須為 Trend18 / Momentum8 / Volume10 / Market8 / Institutional15 / LargeHolder8 / MarginShortLending6 / Fundamental15 / RiskReward12，其中 Fundamental 15 內含 Fundamental Quality 10 + Industry/News/Catalyst 5。

每個 `candidate` 至少額外提供：

- `assetType = STOCK | ETF`
- `decision = BUY | SELL | REDUCE | HOLD | WATCH | NO_TRADE`
- `strategy = BREAKOUT | TREND_PULLBACK | CHIP_ACCUMULATION_BREAKOUT | EXIT | NONE`
- `score`
- `scores`，其子項加總必須等於 score 且不得超過各權重上限
- `universeRank`、`universePercentile`（無法可靠取得時可為 null，但不得因此虛構）
- `liquidityMedianTurnover20d`
- `volumeRatio20d`
- `riskReward`
- `newsEvent`，至少包含 `sourceQuality`、`eventType`、`direction`、`eventTimestamp`、`catalystStatus`

若 candidate.decision = BUY，則必須同時滿足：

- assetType=STOCK；ETF 若沒有獨立 ETF Profile 不得 BUY。
- marketRegime=BULL 時 score >=82；NEUTRAL 時 score >=86；BEAR/HIGH_RISK 不得 BUY。
- liquidityMedianTurnover20d >= 50000000。
- riskReward >=2。
- strategy 必須是三個允許的進場策略之一。
- BREAKOUT 的 volumeRatio20d >=1.5。
- universeRank 若非 null 必須 <=50；universePercentile 若非 null 必須 <=10。
- 必須存在可執行的 entry / maxChase / stop / invalidation 資訊；不得只輸出自然語言推薦。

新聞欄位不得把 SOURCE_C 當成 BUY 的正面依據。若重大事件風險尚未確認，candidate 必須 WATCH/NO_TRADE，不得 BUY。

validator 對舊的 `entry-dual-track-v1` snapshot 只做 migration skip；從第一份正式 `entry-dual-track-v2` snapshot 起，上述欄位全部強制。

### 3.4 V2 Research Input 資料層

- `summarize-official-market-data.mjs` 不得再使用固定 10 檔代號；必須從 TWSE / TPEx 當日官方全市場收盤資料動態建立普通股與 ETF Universe。
- 先以當日正式收盤資料建立全市場候選，再對股價偏好與流動性做 preliminary screen；當日成交金額不得冒充 20 日中位數成交金額。
- `research-input.json` 必須保留每個 deep-dive candidate 的 `historyCoverageTradingDays`、`liquidityMedianTurnover20d`、`volumeMA20`、`volumeRatio20d`、`ma120Ready`。
- 歷史覆蓋不足 20 個交易日時，不得宣稱通過 20 日流動性 Gate；不足 120 個交易日時，不得虛構 MA120 或依賴 MA120 的 BUY 判斷。
- TDCC 使用官方 OpenAPI `/v1/opendata/1-5` 作為週頻輔助來源；對歷史 targetDate 重跑時不得抓取「現在最新」TDCC 再倒灌歷史研究，避免前視偏誤。
- V2 BUY 的 `universeRank` 與 `universePercentile` 必須有實際可驗證數值；不得以 null 繞過 Cross-Sectional Ranking Gate。
- 歷史資料或 ranking 尚未 ready 時，研究可以輸出 WATCH / NO_TRADE，但不得以估計值補齊 BUY Hard Gate。

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

使用 `entry-dual-track-v2` 的新研究還必須驗證：priority A 級候選有雙軌欄位；若存在突破型 `nextOrders`，其 trigger、gap-up、max-chase、成交價與取消條件足以機械重算。

任何關鍵驗證失敗都不得提交部分結果。

## 9. 狀態回報

成功資料提交：`DATA_UPDATED`，只能稱「資料檔已更新」，不得稱網站已重新部署。

非交易日、資料不完整或驗證失敗：`NO_UPDATE`，GitHub 保持原狀。

同日已成功發布且沒有新的有效資料或方法論變化：`NO_CHANGE`，不得建立無意義 commit。

成功時回報：交易／研究日期、推薦清單與分層、主要升降級、Pullback／Breakout 進場條件、模擬帳戶現金與持倉、今日成交／未成交、新的下一交易日條件單、commit SHA 與 validation run。失敗或無變更時只回報狀態與原因。
