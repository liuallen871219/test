# API Engineering Roadmap 互動式課程 — 課程規劃

> 狀態：規劃稿 v2（依提供的 API Engineering Roadmap 16 模組重新規劃，待確認後開始實作 HTML）
> 形式：單一 HTML 檔、可離線開啟、可放上 GitHub Pages、無需安裝任何套件

---

## 1. 課程定位

| 項目 | 內容 |
|---|---|
| 課程名稱 | API Engineering：從 HTTP 到 AI-Powered API 的後端工程師養成 |
| 目標學員 | 會寫基礎程式、想成為後端／API 工程師，或想轉往 AI 後端（LLM 應用）的人 |
| 先備知識 | 任一程式語言基礎（範例用 Python）、會用 Git 與命令列 |
| 學習總時數 | 約 150–200 小時（課程內容約 60 小時 + 專案實作約 90–140 小時） |
| 建議時程 | 20 週（每週 8–10 小時） |
| 範例技術棧 | Python · FastAPI · PostgreSQL · Redis · Docker · Kubernetes · OpenTelemetry · Anthropic SDK |

### 關於「完成後能得到工作機會」

課程本身無法保證錄取。能提高錄取機會的是**可被驗證的產出**，因此課程終點不是「看完」，而是學員手上有：

1. **3 個以上部署上線的專案**（模組 16，GitHub + 線上 Demo + 架構說明）
2. **對準職缺關鍵字的履歷**（附加模組的履歷產生器）
3. **系統設計與技術面試的練習紀錄**（題庫 + 答題框架）
4. **技能自評報告**：標出與目標職缺的落差與補強順序

---

## 2. 每個模組的固定結構

| 區塊 | 內容 |
|---|---|
| 學習目標 | 3–4 條「完成後能做到什麼」 |
| 課程內容 | 依 Roadmap 的每個主題一節，每節：概念說明 → 圖表／比較表 → 程式碼範例 → 常見錯誤 → 面試會怎麼問 |
| 互動實驗 | 每模組至少 1 個，全部在瀏覽器內運算 |
| 小測驗 | 每模組 6–8 題，即時回饋與解析，70% 及格可解鎖模組完成徽章 |
| 重點整理 | 一頁 Cheat Sheet，可列印 |

---

## 3. 課程模組（16 + 1）

### 01. Foundations
**目標**：說得出一個 HTTPS 請求從輸入網址到收到回應的每一步。

| 節次 | 重點 |
|---|---|
| What is an API? | API 是契約；Library API vs Web API；Client / Server 角色 |
| HTTP / HTTPS | 請求行、Header、Body；HTTP/1.1 vs HTTP/2 vs HTTP/3 |
| TCP / TLS / DNS | 三向交握、TLS 1.3 交握、DNS 解析流程與快取 |
| Request & Response Lifecycle | 從瀏覽器到伺服器再回來的完整路徑與耗時來源 |
| JSON / Serialization | JSON、Protobuf、MessagePack 比較；序列化成本；時間與數字精度陷阱 |
| API Design Principles | 一致性、可預測性、最小驚訝、以使用者為中心 |

**互動實驗**：請求生命週期瀑布圖 — 逐步播放 DNS → TCP → TLS → HTTP → 回應，調整網路延遲看總耗時變化

### 02. REST API Design
**目標**：能把一個業務需求設計成一致、可擴充的 REST API。

| 節次 | 重點 |
|---|---|
| REST Architecture | 六大約束（無狀態、可快取、統一介面…）、Richardson 成熟度模型 |
| Resource Modeling | 名詞而非動詞、資源關係、子資源 vs 篩選 |
| HTTP Methods & Status Codes | 安全性與冪等性對照表；2xx/4xx/5xx 正確用法 |
| URI Design | 命名規則、巢狀深度、複數形 |
| Pagination / Filtering / Sorting | Offset vs Cursor 分頁的取捨與實作 |
| Idempotency | Idempotency-Key 設計：儲存、過期、重複請求的回應 |
| API Versioning | URI / Header / Media Type 版本策略比較 |

**互動實驗**：REST 設計挑戰 — 給定情境，選出正確的 Method + URI + Status Code，即時評分與解析

### 03. API Documentation & Contracts
**目標**：用 OpenAPI 建立 API 契約，並確保修改不破壞既有使用者。

| 節次 | 重點 |
|---|---|
| OpenAPI Specification | 結構（paths、components、schemas）；Code-first vs Design-first |
| Swagger UI | FastAPI 自動產生文件；文件即測試入口 |
| API Schema Design | 型別、必填、列舉、nullable 的設計原則 |
| Request / Response Validation | Pydantic 驗證、統一錯誤格式（RFC 9457 Problem Details） |
| Contract Testing | 契約測試的概念（本節講「為什麼」，模組 11 講「怎麼做」） |
| Schema Evolution | 新增欄位、改型別、移除欄位的安全做法 |
| Backward Compatibility | Breaking vs Non-breaking change 判斷表 |

**互動實驗**：Schema 驗證器 — 編輯 JSON 請求即時對照 Schema 驗證；比較 v1 / v2 Schema 自動標出 Breaking Change

### 04. Authentication & Authorization
**目標**：能為 API 選擇並實作正確的身分驗證與授權機制。

| 節次 | 重點 |
|---|---|
| API Keys | 產生、雜湊儲存、輪替、權限範圍 |
| JWT | 結構（Header.Payload.Signature）、簽章演算法、常見漏洞（alg=none、不驗 exp） |
| OAuth 2.0 | Authorization Code + PKCE、Client Credentials；各角色職責 |
| OpenID Connect | ID Token vs Access Token；與 OAuth 的差別 |
| RBAC / ABAC | 角色式 vs 屬性式授權；多租戶權限設計 |
| Token Lifecycle | Access / Refresh Token、撤銷、短效期策略 |
| Service-to-Service Authentication | mTLS、Client Credentials、Workload Identity |

**互動實驗**：JWT 解碼器（貼上 Token 解析內容與到期時間）＋ OAuth 2.0 授權碼流程逐步動畫

### 05. API Security
**目標**：辨識常見 API 攻擊並知道對應的防禦方式。

| 節次 | 重點 |
|---|---|
| TLS / mTLS | 憑證鏈、雙向驗證使用時機 |
| CORS / CSRF / XSS | Preflight 流程、SameSite Cookie、輸出編碼 |
| Rate Limiting | Token Bucket、Sliding Window；依使用者／IP／租戶限流 |
| Input Validation | 白名單驗證、大小限制、型別強制 |
| SQL Injection | 參數化查詢、ORM 仍可能出錯的地方 |
| SSRF | 內網位址封鎖、URL 解析陷阱、雲端 metadata 端點 |
| OWASP API Security Top 10 | 逐項說明（BOLA、Broken Auth…）與範例 |

**互動實驗**：漏洞辨識挑戰（判斷程式片段是否有 SQLi / SSRF / BOLA 風險）＋ Token Bucket 限流模擬器

### 06. API Architectures
**目標**：依需求選擇合適的 API 通訊方式並說明取捨。

| 節次 | 重點 |
|---|---|
| REST | 優缺點回顧與適用情境 |
| GraphQL | Schema、Resolver、N+1 問題與 DataLoader |
| gRPC / Protocol Buffers | IDL、四種串流模式、適合內部服務 |
| WebSockets | 雙向即時通訊、連線管理與擴展 |
| Server-Sent Events | 單向串流（LLM 串流回應的主流做法） |
| Webhooks | 簽章驗證、重送、冪等處理 |
| Event-Driven APIs | 事件 vs 命令、AsyncAPI 規格 |

**互動實驗**：架構選擇器 — 回答需求問題（即時性、方向、客戶端類型…），推薦架構並說明理由

### 07. Database & Data Architecture
**目標**：能設計資料表、寫出高效查詢並正確處理併發。

| 節次 | 重點 |
|---|---|
| Relational Database | 正規化、關聯、PostgreSQL 為何是後端首選 |
| Database Transactions | ACID、隔離等級與各自會出現的異常 |
| Connection Pooling | 為何需要、Pool 大小怎麼估、PgBouncer |
| Database Indexing | B-Tree、複合索引順序、EXPLAIN 解讀 |
| Optimistic / Pessimistic Locking | version 欄位 vs SELECT … FOR UPDATE |
| Data Consistency | 強一致 vs 最終一致 |
| Distributed Transactions | 2PC 的問題、為何改用 Saga（銜接模組 08） |

**互動實驗**：併發更新模擬器 — 兩個請求同時扣庫存，切換「無鎖／樂觀鎖／悲觀鎖」看結果差異

### 08. Distributed Systems
**目標**：理解微服務之間如何溝通、如何維持資料一致。

| 節次 | 重點 |
|---|---|
| Service Discovery | Client-side vs Server-side、DNS、Kubernetes Service |
| Message Queues | RabbitMQ / Kafka / SQS 比較；至少一次投遞與冪等消費者 |
| Eventual Consistency | 使用者體驗上的處理方式 |
| Saga Pattern | 編排 vs 協調；補償交易 |
| CQRS | 讀寫分離的時機與代價 |
| Event Sourcing | 事件儲存、重播、快照 |
| Distributed Coordination | 分散式鎖、Leader Election、etcd / Redis 鎖的陷阱 |

**互動實驗**：Saga 模擬器 — 下單流程（訂單 → 付款 → 庫存 → 出貨），任選一步失敗看補償交易如何回滾

### 09. API Performance
**目標**：找出效能瓶頸並用正確的手段優化。

| 節次 | 重點 |
|---|---|
| Caching Strategies | Cache-aside、Write-through、HTTP 快取（ETag、Cache-Control） |
| Redis | 資料結構、TTL、快取雪崩／穿透／擊穿 |
| Compression | gzip / brotli 的取捨 |
| Connection Reuse | Keep-Alive、HTTP Client 連線池 |
| Async Processing | async I/O、背景任務、202 Accepted 模式 |
| Load Balancing | 演算法比較（Round Robin、Least Conn、一致性雜湊） |
| Performance Profiling | p50 / p95 / p99、火焰圖、找出慢查詢 |

**互動實驗**：快取模擬器 — 調整 TTL、命中率、資料庫延遲，看平均與 p99 延遲變化

### 10. API Reliability
**目標**：讓服務在依賴失敗時仍能正確運作或優雅降級。

| 節次 | 重點 |
|---|---|
| Error Handling | 錯誤分類（可重試 vs 不可重試）、統一錯誤回應 |
| Retry & Backoff | 指數退避 + Jitter、重試風暴 |
| Idempotency | 從「安全重試」角度回顧（設計面見模組 02） |
| Circuit Breaker | Closed / Open / Half-Open 狀態機 |
| Timeout Management | 逾時預算、逐層遞減 |
| Bulkhead Pattern | 資源隔離避免連鎖故障 |
| Graceful Degradation | 降級策略與功能開關 |

**互動實驗**：斷路器模擬器 — 調整下游失敗率，觀察斷路器狀態切換與重試次數

### 11. API Testing
**目標**：為 API 建立分層測試與效能測試。

| 節次 | 重點 |
|---|---|
| Unit Testing | pytest、測試替身（Mock / Fake） |
| Integration Testing | Testcontainers 啟動真實資料庫 |
| Contract Testing | Consumer-Driven Contracts（Pact）、Schemathesis |
| End-to-End Testing | 範圍與維護成本 |
| Load Testing | k6 / Locust；Little's Law 估算併發 |
| Chaos Engineering | 故障注入的原則與起步方式 |

**互動實驗**：負載曲線模擬器 — 增加 RPS 看延遲與錯誤率在飽和點後如何暴增

### 12. API Deployment & Infrastructure
**目標**：把 API 容器化並安全地部署上雲。

| 節次 | 重點 |
|---|---|
| Reverse Proxy | Nginx 的角色：TLS 終止、轉發、靜態檔 |
| API Gateway | 認證、限流、路由集中處理；Kong / 雲端 Gateway |
| Docker | 多階段建置、映像檔瘦身、非 root 執行 |
| Kubernetes | Deployment、Service、Ingress、HPA、健康檢查 |
| CI/CD | GitHub Actions：測試 → 建置 → 部署 |
| Service Mesh | Istio / Linkerd 能解決什麼、何時不需要 |
| Cloud Deployment | 託管服務選擇（容器平台、Serverless、資料庫） |

**互動實驗**：部署策略模擬器 — Rolling / Blue-Green / Canary，注入有 bug 的新版本看影響範圍

### 13. Monitoring & Observability
**目標**：能定義 SLO，並在事故發生時快速定位問題。

| 節次 | 重點 |
|---|---|
| Structured Logging | JSON Log、Correlation ID、不記錄敏感資料 |
| Metrics | RED / USE 方法、Counter / Gauge / Histogram |
| Distributed Tracing | Span、Trace Context 傳遞 |
| OpenTelemetry | 自動與手動埋點、Collector |
| Prometheus / Grafana | PromQL 基礎、儀表板設計 |
| SLI / SLO / SLA | 三者差異、錯誤預算 |
| Incident Management | 告警分級、On-call、事後檢討（Blameless Postmortem） |

**互動實驗**：SLO 錯誤預算計算器 — 輸入 SLO 與請求量，算出每月可容許的失敗數與停機時間

### 14. API Governance & Lifecycle
**目標**：在組織內長期維護多個 API 而不失控。

| 節次 | 重點 |
|---|---|
| API Versioning Strategy | 組織層級的版本政策（技術面見模組 02） |
| API Deprecation | Deprecation / Sunset Header、遷移溝通時程 |
| Backward Compatibility | 自動化檢查（CI 中跑 Schema diff） |
| API Discovery | 讓開發者找得到 API |
| API Catalog | Backstage 等內部平台 |
| Governance Policies | Lint 規則（Spectral）、設計審查流程 |
| Developer Experience (DX) | 文件、SDK、範例、錯誤訊息品質 |

**互動實驗**：變更分類挑戰 — 判斷每個 API 變更是 Major / Minor / Patch，以及是否需要 Deprecation 流程

### 15. AI-Powered APIs
**目標**：能設計並上線一個整合 LLM 的 API 服務。

| 節次 | 重點 |
|---|---|
| LLM API Integration | Messages API 結構、system prompt、stop_reason、usage |
| Function / Tool Calling | 工具定義、工具呼叫迴圈、錯誤回報 |
| Structured Outputs | JSON Schema、Pydantic 驗證輸出 |
| Streaming Responses | 用 FastAPI + SSE 串流 LLM 回應 |
| AI Agent APIs | Workflow vs Agent、長時任務 API 設計（202 + 狀態查詢） |
| MCP Integration | Model Context Protocol：提供工具與資源的標準協定 |
| Context Management | 對話歷史管理、RAG 檢索、上下文壓縮 |
| Token & Cost Optimization | Prompt Caching、Batch、模型路由、輸出長度控制 |
| LLM Observability | Token / 成本 / 延遲指標、Trace、Eval 回歸測試 |

**互動實驗**：Token 月成本計算器 ＋ Agent 迴圈逐步模擬器（看 messages 陣列如何隨工具呼叫變化）

### 16. Real-World Projects
**目標**：整合前 15 個模組，完成可放進履歷的專案。

| 專案 | 必備功能 | 主要用到的模組 | 履歷價值 |
|---|---|---|---|
| Authentication Service | 註冊／登入、JWT + Refresh Token、OAuth 登入、RBAC、限流 | 02、04、05、11 | ★★★ 每家公司都需要 |
| E-commerce API | 商品、購物車、訂單、Cursor 分頁、快取、庫存併發控制 | 02、03、07、09 | ★★★ 面試最常被問的領域 |
| Payment API | 冪等鍵、Webhook（簽章 + 重送）、狀態機、對帳 | 02、06、07、10 | ★★★★ 展現對正確性的重視 |
| Real-time Chat API | WebSocket、在線狀態、訊息持久化、水平擴展（Redis Pub/Sub） | 06、08、09 | ★★★ |
| AI Agent API | 工具呼叫、SSE 串流、長時任務佇列、成本追蹤、LLM 觀測 | 06、10、13、15 | ★★★★ AI 職缺加分最多 |
| Distributed Microservices Platform | 將上述服務拆分、API Gateway、Saga、Tracing、K8s 部署 | 08、12、13、14 | ★★★★★ 綜合能力展現 |

**建議組合**：
- 想走一般後端：Authentication Service + E-commerce API + Payment API
- 想走 AI 後端：Authentication Service + AI Agent API + Distributed Microservices Platform

**每個專案的交付標準**：README（架構圖、技術選型理由、如何執行）、OpenAPI 文件、測試（含整合測試）、Docker Compose 一鍵啟動、線上 Demo、一篇技術說明文章

**互動功能**：每個專案提供需求檢核表（可勾選、會儲存進度）與參考架構圖

### 附加模組：Career Launch（求職衝刺）
> Roadmap 原本沒有這個模組，為了「完成後能得到工作機會」的目標而加入。

| 節次 | 重點 |
|---|---|
| 職缺地圖 | 後端工程師、API 工程師、AI 後端／LLM 應用工程師、平台工程師的差異與 JD 關鍵字 |
| 履歷撰寫 | 「動作 + 技術 + 量化成果」寫法、專案描述範例 |
| 作品集包裝 | GitHub README、Demo 影片、技術文章 |
| 技術面試 | API 設計題、系統設計框架（需求 → 估算 → API → 架構 → 深入 → 取捨） |
| 求職策略 | 投遞管道（104、Cake、LinkedIn、Yourator 等）、內推與人脈、面試後追蹤 |

**互動實驗**：
- 技能自評 → 各職缺匹配度與落差（並連回對應模組）
- 履歷條列產生器
- 面試翻卡練習（約 40 題，涵蓋 16 個模組）

### 結業：學習報告與證書
- 顯示各模組完成度、測驗分數、技能雷達圖、專案完成狀態
- 輸入姓名產生可列印的結業證書（課程完成證明，非正式認證）

---

## 4. Roadmap 中重複主題的處理方式

Roadmap 有幾個主題出現在多個模組，每次會從不同角度切入並互相連結，避免重複：

| 主題 | 第一次出現 | 第二次出現 |
|---|---|---|
| Idempotency | 02：API 怎麼設計冪等鍵 | 10：如何靠冪等安全地重試 |
| Contract Testing | 03：契約的概念與價值 | 11：用工具實際寫契約測試 |
| Backward Compatibility | 03：Schema 層面的判斷規則 | 14：組織流程與 CI 自動檢查 |
| API Versioning | 02：技術上的版本方式 | 14：組織層級的版本與淘汰政策 |
| REST | 02：完整設計方法 | 06：與其他架構比較 |
| Rate Limiting | 05：從安全角度防濫用 | 12：在 API Gateway 集中實作 |

---

## 5. 互動功能總覽

| 功能 | 說明 |
|---|---|
| 進度追蹤 | 每節可標記完成；側邊欄顯示各模組狀態；頂部總進度條 |
| 測驗 | 16 模組 × 6–8 題 ≈ 110 題，含解析，70% 及格，可重測 |
| 互動實驗 | 約 20 個，全部在瀏覽器內運算 |
| 程式碼範例 | 語法高亮、一鍵複製 |
| 專案檢核表 | 6 個專案的需求清單，可勾選並儲存 |
| 搜尋 | 依主題關鍵字快速找到對應節次 |
| 深色／淺色模式 | 依系統設定，可手動切換 |
| 手機版 | 側邊欄改為抽屜選單，無橫向捲動 |
| 列印 | Cheat Sheet 與結業證書有列印專用版面 |

---

## 6. 技術實作規劃

- **單一 `index.html`**：HTML + CSS + 原生 JavaScript，不依賴外部函式庫
- **資料驅動**：課程內容以 JS 物件定義（模組 → 節次 → 測驗 → 實驗），方便擴充
- **進度儲存**：`localStorage`（存在學員自己的瀏覽器；讀寫有錯誤處理，無法儲存時仍可正常使用）
- **路由**：URL hash（例如 `#m07`），可分享特定模組連結
- **範例語言**：Python + FastAPI；LLM 範例使用官方 Anthropic Python SDK
- **檔案結構**：

```
/index.html            課程主檔
/docs/course-plan.md   本規劃文件
/README                使用說明
```

> 內容量約 120 節，單檔會很大。若之後要多人維護，可改為「`index.html` + 每模組一個 JS 內容檔」，學員端體驗相同。

---

## 7. 建議學習時程（20 週）

| 週次 | 模組 | 專案產出 |
|---|---|---|
| 1 | 01 Foundations | — |
| 2–3 | 02 REST、03 Documentation | — |
| 4–5 | 04 Auth、05 Security | **Authentication Service** |
| 6 | 06 Architectures | — |
| 7–8 | 07 Database | **E-commerce API** |
| 9 | 08 Distributed Systems | — |
| 10 | 09 Performance、10 Reliability | **Payment API** |
| 11 | 11 Testing | 為前三個專案補齊測試與壓測 |
| 12–13 | 12 Deployment、13 Observability | 部署上線 + 監控儀表板 |
| 14 | 14 Governance | — |
| 15–16 | 15 AI-Powered APIs | **AI Agent API** |
| 17–18 | 16 Projects | **Real-time Chat** 或 **Microservices Platform** |
| 19–20 | Career Launch | 履歷、作品集頁面、投遞與模擬面試 |

---

## 8. 實作分階段

| 階段 | 內容 | 目的 |
|---|---|---|
| 第 1 階段 | 課程框架（導覽、進度、測驗、主題切換）＋ 模組 01–03 完整內容 | 先確認風格與內容深度 |
| 第 2 階段 | 模組 04–10 | 核心後端能力 |
| 第 3 階段 | 模組 11–15 | 工程實務與 AI API |
| 第 4 階段 | 模組 16 + Career Launch + 結業證書 | 求職產出 |

---

## 9. 驗收標準

- [ ] 16 個模組 + 附加模組，所有 Roadmap 主題都有對應節次
- [ ] 每模組有測驗與解析、至少 1 個可運作的互動實驗
- [ ] 6 個專案都有需求檢核表與參考架構
- [ ] 手機與桌面版面正常、深淺色模式正常
- [ ] 重新整理後進度保留
- [ ] 結業證書可列印

---

## 10. 待確認事項

1. **範例語言**：以 Python + FastAPI 為主是否 OK？是否需要 Node.js / Go 版本？
2. **附加模組**：是否保留 Career Launch 求職模組？
3. **求職市場**：以台灣職缺為主，還是也涵蓋海外遠端職缺？
4. **實作方式**：依第 8 節分階段做（先交付模組 01–03 讓你確認），還是一次做完 16 模組？
5. **介面語言**：主題名稱保留英文（業界用語）＋ 中文說明，是否 OK？
