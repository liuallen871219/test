Course.register({
  id: 'm16', num: '16', title: 'Real-World Projects', zh: '實戰專案',
  intro: '把前 15 個模組的能力整合成可運作、可展示的系統。每個專案都有需求規格、架構、關鍵設計決策與可勾選的檢核表（進度會保存在你的瀏覽器）。建議依方向挑選 3 個專案完整完成，而不是 6 個都做一半。',
  goals: [
    '依交付標準完成至少 3 個可部署、有測試、有文件的專案',
    '在專案中實際應用冪等、交易、快取、限流、可觀測性等工程實務',
    '用架構圖與設計決策紀錄說明「為什麼這樣做」',
    '能在技術討論中清楚說明專案的取捨與量測結果'
  ],
  lessons: [
    {
      id: 'guide', title: 'Project Guide', zh: '交付標準與選題建議',
      html: `
<h3>建議組合</h3>
${table(['方向', '建議專案', '展現的能力'], [
  ['一般後端', 'Authentication Service → E-commerce API → Payment API', '安全、資料一致性、冪等、交易'],
  ['AI 後端', 'Authentication Service → AI Agent API → Distributed Microservices Platform', 'LLM 整合、串流、Agent、分散式系統'],
  ['平台／基礎設施', 'Authentication Service → E-commerce API → Distributed Microservices Platform', '部署、可觀測性、擴展、韌性']
])}
<p>可以用「互動實驗」中的專案規劃器，依你的方向與每週時間估算時程。</p>
<h3>每個專案的交付標準</h3>
<ul>
  <li><b>README</b>：功能說明、架構圖、技術選型與<b>設計決策的理由</b>、如何在本機執行。</li>
  <li><b>OpenAPI 文件</b>：所有端點、範例、錯誤碼。</li>
  <li><b>測試</b>：單元 + 整合（Testcontainers），關鍵流程至少一個 E2E。</li>
  <li><b>一鍵啟動</b>：<code>docker compose up</code> 就能跑起來（含資料庫、Redis 等依賴）。</li>
  <li><b>CI</b>：每次 push 自動跑 Lint、測試、建置映像檔。</li>
  <li><b>可觀測性</b>：結構化日誌、<code>/metrics</code>、至少一個 Grafana 儀表板截圖。</li>
  <li><b>量測結果</b>：負載測試報告（p95、錯誤率、瓶頸與改善）。</li>
  <li><b>線上 Demo</b>（選擇性）：部署到託管容器平台。</li>
  <li><b>技術說明文章</b>：寫一篇「我如何設計 X」的文章，說明遇到的問題與取捨。</li>
</ul>
${code('plain', String.raw`
my-project/
├── src/app/                 # FastAPI 應用（routers / services / repositories 分層）
├── tests/
│   ├── unit/
│   ├── integration/         # Testcontainers
│   └── e2e/
├── migrations/              # Alembic
├── docs/
│   ├── architecture.md      # 架構圖 + 設計決策紀錄（ADR）
│   └── load-test-report.md
├── openapi.yaml
├── docker-compose.yml
├── Dockerfile
├── .github/workflows/ci.yml
└── README.md
`, '建議的專案結構')}
${note('tip', '設計決策紀錄（ADR）的格式很簡單：<b>背景</b>（要解決什麼問題）→ <b>選項</b>（考慮過哪些做法）→ <b>決定</b> → <b>後果</b>（取捨與風險）。這份紀錄比程式碼本身更能展現你的工程判斷力。')}
`,
      qa: [
        ['介紹專案時，怎樣才能讓人覺得你真的懂？', '<p>不要只列出用了哪些技術，而是說明：(1) 要解決什麼問題、有哪些限制；(2) 你考慮過哪些做法、為什麼選這個（例如「扣庫存用原子條件更新而不是悲觀鎖，因為…」）；(3) 遇到的困難與如何驗證解法（測試、壓測數據）；(4) 如果規模放大十倍，你會改哪裡。準備好被追問細節，例如冪等鍵怎麼處理併發、快取怎麼失效。</p>']
      ]
    },
    {
      id: 'auth-service', title: 'Authentication Service', zh: '身分驗證服務',
      html: `
<p>每個系統都需要的基礎服務，也是其他專案的前置條件。重點在<b>安全細節</b>做得是否到位。</p>
${flow(['Client', 'API Gateway / FastAPI', 'Auth Service', 'PostgreSQL（使用者、Refresh Token）', 'Redis（限流、撤銷清單）', 'Email 服務（驗證信）'])}
${table(['端點', '說明'], [
  ['<code>POST /v1/users</code>', '註冊（寄送 Email 驗證）'],
  ['<code>POST /v1/auth/token</code>', '登入，回傳 Access + Refresh Token'],
  ['<code>POST /v1/auth/refresh</code>', '輪替 Refresh Token（偵測重用）'],
  ['<code>POST /v1/auth/logout</code>', '撤銷目前裝置或所有裝置'],
  ['<code>GET /v1/auth/oidc/google/callback</code>', '第三方登入（Authorization Code + PKCE）'],
  ['<code>POST /v1/auth/password-reset</code>', '寄送重設連結（一次性、短效 Token）'],
  ['<code>GET /.well-known/jwks.json</code>', '公開公鑰，讓其他服務驗證 JWT'],
  ['<code>GET /v1/admin/users</code>', '管理員功能（RBAC）']
])}
<h3>關鍵設計決策</h3>
<ul>
  <li>密碼用 <b>Argon2id</b>；登入失敗訊息不透露「帳號不存在」或「密碼錯誤」。</li>
  <li>JWT 用 <b>RS256 / ES256</b> + JWKS + <code>kid</code>，支援金鑰輪替。</li>
  <li>Access Token 10 分鐘；Refresh Token 輪替並偵測重用（模組 04）。</li>
  <li>登入、註冊、重設密碼端點依 IP 與帳號雙重限流。</li>
  <li>所有安全事件寫入稽核紀錄（登入、改密碼、權限變更）。</li>
</ul>
`,
      checklist: [
        '註冊與 Email 驗證流程，密碼以 Argon2id 雜湊',
        '登入回傳短效 Access Token（RS256）與 Refresh Token',
        'Refresh Token 輪替與重用偵測，支援登出所有裝置',
        'JWKS 端點與金鑰輪替（kid）',
        '用 OIDC（Authorization Code + PKCE）實作第三方登入',
        'RBAC：至少 admin / user 兩種角色，功能層級授權',
        '登入端點限流（Redis）與失敗次數鎖定',
        '安全的密碼重設流程（一次性、短效、使用後失效）',
        '單元 + 整合測試涵蓋：過期 Token、錯誤簽章、alg none、重用的 Refresh Token',
        'OpenAPI 文件、Docker Compose、CI、README 架構圖'
      ],
      qa: [
        ['你的 Auth Service 如何讓其他服務驗證 Token，又能安全地輪替簽章金鑰？', '<p>使用非對稱簽章（RS256 / ES256）：Auth Service 用私鑰簽發 JWT，在 Header 帶上 <code>kid</code>；公鑰透過 <code>/.well-known/jwks.json</code> 公開，其他服務依 kid 取得並快取公鑰驗證，不需要共享密鑰。輪替時先把新公鑰加入 JWKS（新舊並存），等各服務快取更新後再開始用新私鑰簽發，舊公鑰保留到所有舊 Token 過期後才移除。</p>']
      ]
    },
    {
      id: 'ecommerce-api', title: 'E-commerce API', zh: '電商 API',
      html: `
<p>電商是面試最常被拿來討論的領域：商品、購物車、訂單、庫存，涵蓋資料建模、併發、快取與效能。</p>
${flow(['Client', 'FastAPI', 'PostgreSQL（商品、訂單、庫存）', 'Redis（商品快取、購物車）', 'Outbox → 事件（OrderPlaced）'])}
${table(['資源', '重點'], [
  ['商品 <code>/v1/products</code>', 'Cursor 分頁、篩選（分類、價格區間）、排序白名單、全文搜尋、ETag + Redis 快取'],
  ['購物車 <code>/v1/cart</code>', '登入前後合併、價格以結帳時為準'],
  ['訂單 <code>/v1/orders</code>', 'Idempotency-Key、價格快照、狀態機（pending → paid → shipped / cancelled）'],
  ['庫存', '原子條件更新防超賣、下單保留 15 分鐘、逾時自動釋放'],
  ['後台 <code>/v1/admin/*</code>', 'RBAC、操作稽核']
])}
<h3>關鍵設計決策</h3>
<ul>
  <li>訂單明細保存<b>下單當時</b>的商品名稱與價格，避免商品改價後訂單金額跟著變。</li>
  <li>金額以整數「分」儲存並附幣別。</li>
  <li>扣庫存使用<b>原子條件更新</b>（模組 07），以併發測試證明不會超賣。</li>
  <li>商品讀取量遠大於寫入：Cache-aside + TTL 抖動 + 更新時刪除快取。</li>
  <li>下單寫入 Outbox，發布 <code>OrderPlaced</code> 供通知、分析使用。</li>
</ul>
`,
      checklist: [
        '商品列表：Cursor 分頁、篩選、排序白名單，並有對應的複合索引',
        '商品詳情：ETag + Cache-Control，Redis Cache-aside（含 TTL 抖動與空值快取）',
        '購物車 API，結帳時重新驗證價格與庫存',
        '建立訂單支援 Idempotency-Key，訂單保存價格快照',
        '庫存原子扣減，併發整合測試證明不超賣',
        '訂單狀態機與取消流程（釋放庫存）',
        'Transactional Outbox 發布 OrderPlaced 事件',
        '後台 API 的 RBAC 與物件層級授權測試',
        '用 Locust 或 k6 壓測商品列表與下單，寫出報告（p95、瓶頸、改善前後）',
        'OpenAPI、Schemathesis 測試、Docker Compose、CI'
      ],
      qa: [
        ['你的電商 API 如何處理大量使用者同時搶購同一件商品？', '<p>扣庫存用一條原子 SQL：<code>UPDATE ... SET stock = stock - :n WHERE id = :id AND stock >= :n</code>，根據影響列數判斷成功與否，不會超賣也不需要先讀再寫；下單請求帶 Idempotency-Key 防止重複送出。若熱門商品的單列更新成為瓶頸，可以把庫存預先載入 Redis 以 Lua 原子扣減，再非同步寫回資料庫，或用佇列削峰。最後用併發整合測試與壓測數據證明行為正確。</p>']
      ]
    },
    {
      id: 'payment-api', title: 'Payment API', zh: '金流 API',
      html: `
<p>金流專案展現你對<b>正確性</b>的重視：每一筆錢都不能多、不能少、不能重複。可以串接金流商的沙盒環境，或自己寫一個模擬的支付處理器（PSP）。</p>
${flow(['商店（Client）', 'Payment API', 'PostgreSQL（付款、帳本、冪等鍵、Outbox）', '模擬 PSP / 沙盒', 'Webhook Worker → 商店的 Webhook URL'])}
<h3>付款狀態機</h3>
${flow(['requires_payment', 'processing', 'succeeded', 'refunded（部分 / 全額）'])}
<p>失敗路徑：<code>processing → failed</code>；結果未知時 <code>processing → unknown</code>，由對帳任務確認。</p>
<h3>關鍵設計決策</h3>
<ul>
  <li>所有建立／扣款／退款端點強制 <b>Idempotency-Key</b>，並比對請求指紋（模組 02）。</li>
  <li>呼叫 PSP 時傳遞<b>決定性產生</b>的冪等鍵；逾時視為「結果未知」而非失敗（模組 10）。</li>
  <li><b>複式記帳帳本</b>：每筆異動同時記借方與貸方，總和永遠為零，帳本只新增不修改。</li>
  <li>Webhook：HMAC 簽章（含時間戳）、指數退避重送、事件 ID、投遞紀錄與手動重送（模組 06）。</li>
  <li>每日<b>對帳</b>：比對 PSP 報表與內部帳本，產出差異報告。</li>
</ul>
${code('sql', String.raw`
-- 複式記帳：一次付款成功產生兩筆分錄，金額相加為 0
CREATE TABLE ledger_entries (
  id          BIGSERIAL PRIMARY KEY,
  journal_id  UUID NOT NULL,             -- 同一次交易的分錄共用
  account     TEXT NOT NULL,             -- 例如 'customer:usr_42'、'merchant:m_7'、'fees'
  amount      BIGINT NOT NULL,           -- 正數借方、負數貸方（以分為單位）
  currency    CHAR(3) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 驗證：SELECT journal_id FROM ledger_entries GROUP BY journal_id HAVING sum(amount) <> 0; 應該沒有結果
`)}
`,
      checklist: [
        '付款狀態機，非法的狀態轉換被拒絕（有單元測試）',
        '所有寫入端點支援 Idempotency-Key（綁定商店、比對指紋、處理「處理中」）',
        '模擬 PSP 可設定成功、失敗、逾時、延遲回應',
        'PSP 逾時時進入「結果未知」，由背景任務查詢並更新',
        '部分與全額退款，退款總額不能超過付款金額',
        '複式記帳帳本，並有測試驗證每筆交易總和為 0',
        'Webhook：HMAC 簽章、時間戳、指數退避重送、投遞紀錄與手動重送',
        'Transactional Outbox 確保狀態變更與 Webhook 事件一致',
        '每日對帳任務與差異報告',
        '重複請求、併發退款、Webhook 重送的整合測試'
      ],
      qa: [
        ['你的金流 API 如何確保使用者不會被重複扣款？', '<p>三層防護：(1) 對外 API 要求 Idempotency-Key，以（商店, key）為唯一鍵保存第一次的結果，重送時直接回傳，相同 key 不同內容則拒絕；(2) 呼叫 PSP 時傳遞由付款 ID 決定性產生的冪等鍵，重試不會產生新的扣款；(3) 逾時時不假設失敗，而是標記為結果未知並查詢 PSP 狀態。資料庫層以唯一約束防止同一付款產生兩筆成功紀錄，並以對帳任務作為最後防線。</p>']
      ]
    },
    {
      id: 'realtime-chat', title: 'Real-time Chat API', zh: '即時聊天 API',
      html: `
<p>即時系統的重點是<b>有狀態連線的擴展</b>：多台伺服器、斷線重連、訊息不遺失也不重複。</p>
${flow(['Client（WebSocket）', 'Load Balancer', 'Chat Server ×N', 'Redis Pub/Sub（跨伺服器廣播）+ 在線狀態', 'PostgreSQL（訊息持久化）'])}
<h3>關鍵設計決策</h3>
<ul>
  <li>每則訊息有<b>房間內遞增的序號</b>：客戶端重連時送出「最後收到的序號」，伺服器補齊遺漏的訊息。</li>
  <li>客戶端產生 <code>client_msg_id</code>：重送時伺服器去重，避免重複訊息。</li>
  <li>先寫資料庫再廣播；廣播透過 Redis Pub/Sub 讓所有伺服器上的成員都收到。</li>
  <li>在線狀態以 Redis 加 TTL 心跳維護，伺服器當機時自動過期。</li>
  <li>每個連線的訊息速率限制與最大訊息大小；慢速客戶端的傳送佇列設上限（背壓）。</li>
  <li>歷史訊息用 REST + Cursor 分頁載入；即時訊息才走 WebSocket。</li>
</ul>
`,
      checklist: [
        'WebSocket 連線在交握時驗證身分，未授權的房間無法加入',
        '訊息持久化，房間內遞增序號',
        '重連後依最後序號補齊遺漏訊息',
        'client_msg_id 去重，重送不會產生重複訊息',
        'Redis Pub/Sub 跨伺服器廣播，用兩個以上實例實測',
        '在線狀態（心跳 + TTL）與「正在輸入」提示',
        '每連線速率限制、訊息大小上限、慢速客戶端背壓處理',
        '歷史訊息 REST API（Cursor 分頁）',
        '優雅關閉：通知客戶端重連，滾動更新時不遺失訊息',
        '壓測同時連線數與訊息延遲，寫出報告'
      ],
      qa: [
        ['聊天服務如何保證使用者斷線重連後不會漏訊息？', '<p>每個房間的訊息有單調遞增的序號，並先持久化再廣播。客戶端記錄最後收到的序號，重連時一併送出，伺服器查詢資料庫補送之後的所有訊息，再繼續即時推送。客戶端以序號去重與排序，所以補送與即時推送重疊也沒關係。送出端則用 client_msg_id 讓重送具冪等性。</p>']
      ]
    },
    {
      id: 'ai-agent-api', title: 'AI Agent API', zh: 'AI Agent API',
      html: `
<p>一個能回答公司文件問題、並能代替使用者執行有限操作的 AI 助理 API。重點不是「接上 LLM」，而是<b>可靠性、安全邊界、成本與評估</b>。</p>
${flow(['Client', 'FastAPI（SSE）', 'Agent Worker（佇列）', 'LLM API', '工具：RAG 檢索（pgvector）／訂單查詢／建立工單', 'PostgreSQL + Redis', 'OTel → Trace 與成本儀表板'])}
${table(['端點', '說明'], [
  ['<code>POST /v1/chat/stream</code>', '對話問答，SSE 串流，附引用來源'],
  ['<code>POST /v1/agent-runs</code>', '建立 Agent 任務（202 + run_id，Idempotency-Key）'],
  ['<code>GET /v1/agent-runs/{id}/events</code>', 'SSE 事件串流（支援 Last-Event-ID）'],
  ['<code>POST /v1/agent-runs/{id}/approvals</code>', '核准或拒絕高風險工具呼叫'],
  ['<code>POST /v1/documents</code>', '上傳文件 → 背景切塊、產生 Embedding'],
  ['MCP Server', '把同一組工具以 MCP 提供給其他 AI 應用']
])}
<h3>關鍵設計決策</h3>
<ul>
  <li>工具以<b>使用者身分</b>執行並做物件層級授權；寫入類工具需要人工核准。</li>
  <li>RAG 檢索在 SQL 層以 tenant_id 過濾；文件內容在提示中標示為「資料而非指示」。</li>
  <li>每個任務有步數、Token、時間上限；依租戶的 Token 配額與限流。</li>
  <li>Prompt Caching：固定的系統提示與工具定義放在最前面，監控快取命中率。</li>
  <li>每次 LLM 呼叫記錄 OTel <code>gen_ai.*</code> 屬性與估算成本。</li>
  <li><b>評估集</b>：至少 30 個真實問題（含應該拒答的問題與 Prompt Injection 案例），提示或模型變更時在 CI 中執行。</li>
</ul>
`,
      checklist: [
        '串流對話端點（SSE），處理斷線、錯誤事件，結束時記錄 usage',
        '文件上傳 → 背景切塊與 Embedding → pgvector 檢索（帶租戶過濾）',
        '回答附引用來源，文件中沒有答案時明確說不知道',
        '工具呼叫迴圈：參數驗證、物件層級授權、迴圈上限、錯誤以 is_error 回傳',
        'Agent 任務 API：202 + run_id、SSE 事件、核准與取消端點、每步持久化',
        '結構化輸出（Pydantic）用於分類或抽取步驟',
        '依租戶的 Token 配額、步數／時間／成本上限',
        'Prompt Caching 並在儀表板顯示命中率與每日成本',
        'OTel Trace（含 gen_ai 屬性）串起 API → Worker → LLM → 工具',
        '評估集（含 Prompt Injection 與跨租戶案例）在 CI 中執行並產出分數報告',
        '把工具以 MCP Server 提供（選做）'
      ],
      qa: [
        ['你怎麼證明你的 AI 助理「夠好」可以上線？', '<p>用評估集而不是感覺：收集具代表性的真實問題（含難題、應拒答的問題、Prompt Injection、跨租戶存取嘗試），為每題定義評分標準，量測回答正確率、引用正確率、拒答正確率與每題成本；每次修改提示、檢索或模型都在 CI 重跑並比較。上線後再看使用者回饋、拒絕率、截斷率與成本指標，並以金絲雀或功能開關逐步放量。</p>']
      ]
    },
    {
      id: 'microservices-platform', title: 'Distributed Microservices Platform', zh: '分散式微服務平台',
      html: `
<p>綜合型專案：把前面的服務拆分成多個微服務並部署到 Kubernetes，展現分散式系統、部署與可觀測性的完整能力。<b>先做好單體，再拆分</b>——這本身就是值得寫進設計紀錄的決策。</p>
${flow(['API Gateway（Kong / Envoy）', 'Auth', 'Catalog', 'Orders', 'Payments', 'Notifications', 'Kafka（事件）', 'OTel Collector → Tempo / Prometheus / Loki → Grafana'])}
<h3>關鍵設計決策</h3>
<ul>
  <li>對外 REST、對內同步呼叫用 gRPC（設定 deadline），非同步整合用 Kafka 事件。</li>
  <li>每個服務擁有自己的資料庫；跨服務一致性用 <b>Outbox + Saga</b>（結帳：建立訂單 → 扣款 → 保留庫存 → 通知）。</li>
  <li>消費者冪等、DLQ、事件 Schema 版本化。</li>
  <li>Helm Chart 部署；探針、資源限制、HPA、PodDisruptionBudget。</li>
  <li>Canary 部署（Argo Rollouts 或 Service Mesh 流量切分）。</li>
  <li>每個服務定義 SLO 與 Burn Rate 告警，Grafana 儀表板。</li>
  <li>混沌實驗：殺 Pod、注入付款延遲，驗證斷路器與降級。</li>
</ul>
`,
      checklist: [
        '至少 4 個服務，各自擁有資料庫，服務間不直接存取彼此的資料表',
        'API Gateway：路由、JWT 驗證、限流、Request ID',
        '內部 gRPC 呼叫（含 deadline）與 .proto 契約',
        'Kafka 事件 + Transactional Outbox + 冪等消費者 + DLQ',
        '結帳 Saga，各步驟失敗時正確補償（有整合測試）',
        '跨服務分散式追蹤：一次結帳在 Grafana 中看得到完整 Trace',
        'Helm 部署到 Kubernetes（kind / minikube 或雲端），探針、資源、HPA、PDB',
        'CI/CD：建置映像檔、契約測試（Pact 或 Schemathesis）、部署到 staging',
        'Canary 部署並示範自動回滾',
        '每個服務的 SLO 儀表板與 Burn Rate 告警',
        '混沌實驗報告：注入故障、觀察結果、改進項目'
      ],
      qa: [
        ['你為什麼把系統拆成微服務？如果重來會怎麼做？', '<p>誠實說明取捨：微服務帶來獨立部署與擴展、團隊自主、故障隔離，但也帶來分散式交易、網路故障、除錯與維運成本。在這個專案中拆分的目的是學習與展示這些問題的解法（Outbox、Saga、追蹤、契約測試）；在真實的小團隊中，通常會先做模組化單體，等到團隊規模、部署頻率或擴展需求出現瓶頸時，再沿著業務邊界拆出服務。能清楚說出「什麼時候不該用微服務」本身就是加分。</p>']
      ]
    }
  ],
  labs: [
    {
      title: '專案規劃器',
      desc: '選擇你的方向、每週可投入的時間與經驗，得到建議的專案順序、預估時程與需要先複習的模組。',
      render(root) {
        const P = {
          auth: { name: 'Authentication Service', h: 30, mods: ['02', '04', '05', '11'] },
          ecom: { name: 'E-commerce API', h: 40, mods: ['02', '03', '07', '09'] },
          pay: { name: 'Payment API', h: 45, mods: ['02', '06', '07', '10'] },
          chat: { name: 'Real-time Chat API', h: 35, mods: ['06', '08', '09'] },
          ai: { name: 'AI Agent API', h: 50, mods: ['06', '10', '13', '15'] },
          micro: { name: 'Distributed Microservices Platform', h: 70, mods: ['08', '12', '13', '14'] }
        };
        const PLAN = { backend: ['auth', 'ecom', 'pay'], ai: ['auth', 'ai', 'micro'], platform: ['auth', 'ecom', 'micro'] };
        const ID = { auth: 'auth-service', ecom: 'ecommerce-api', pay: 'payment-api', chat: 'realtime-chat', ai: 'ai-agent-api', micro: 'microservices-platform' };
        const { range, fmt } = Course.ui;
        root.innerHTML = `
<div class="controls">
  <label class="fld"><span>方向</span><select name="dir"><option value="backend">一般後端</option><option value="ai">AI 後端</option><option value="platform">平台／基礎設施</option></select></label>
  <label class="fld"><span>經驗</span><select name="exp"><option value="1.4">剛開始寫後端</option><option value="1.0" selected>有一些後端經驗</option><option value="0.75">已有實務經驗</option></select></label>
  ${range('hrs', '每週可投入時間', 4, 30, 1, 10, ' 小時')}
  <label class="fld"><span>加選第 4 個專案</span><select name="extra"><option value="">不加選</option><option value="chat">Real-time Chat API</option><option value="pay">Payment API</option><option value="ai">AI Agent API</option></select></label>
</div>
<div class="pp-out"></div>`;
        const calc = () => {
          const dir = root.querySelector('[name=dir]').value, mult = +root.querySelector('[name=exp]').value, hrs = +root.querySelector('[name=hrs]').value;
          const extra = root.querySelector('[name=extra]').value;
          const list = PLAN[dir].slice(); if (extra && !list.includes(extra)) list.push(extra);
          let week = 0;
          const rows = list.map((k, i) => {
            const p = P[k], w = Math.ceil(p.h * mult / hrs);
            const from = week + 1; week += w;
            return ['<b>' + (i + 1) + '. <a href="#/m16/learn/' + ID[k] + '">' + p.name + '</a></b>', '約 ' + fmt(p.h * mult) + ' 小時', '第 ' + from + '–' + week + ' 週', p.mods.map(m => '<a href="#/m' + m + '">' + m + '</a>').join('、')];
          });
          root.querySelector('.pp-out').innerHTML = table(['專案', '預估工時', '時程', '先複習的模組'], rows) +
            '<div class="kpis"><div class="kpi"><b>' + week + ' 週</b><span>完成全部專案</span></div><div class="kpi"><b>約 ' + fmt(week / 4.3, 1) + ' 個月</b><span>以每週 ' + hrs + ' 小時計</span></div></div>' +
            note('tip', '一次專注一個專案並完整達到交付標準。每完成一個，就把設計決策與量測結果寫進 README，這比同時開好幾個半成品更有價值。');
        };
        root.addEventListener('input', calc); root.addEventListener('change', calc);
        calc();
      }
    }
  ],
  quiz: [
    { q: '電商專案中，訂單明細為什麼要保存下單當時的商品價格？', options: ['節省資料庫空間', '商品之後改價時，既有訂單的金額不應跟著改變', '讓查詢更快', '規範要求必須重複儲存'], answer: 1, explain: '訂單是一份歷史事實，價格快照確保帳務與使用者看到的金額一致。' },
    { q: '金流 API 呼叫第三方 PSP 逾時，最恰當的處理是？', options: ['直接標記失敗並請使用者重新付款', '標記為結果未知，以相同冪等鍵重試或查詢 PSP 狀態後再決定', '直接標記成功', '刪除這筆付款'], answer: 1, explain: '逾時不代表失敗，直接當失敗可能造成重複扣款。' },
    { q: '複式記帳帳本的核心不變量是？', options: ['每筆分錄金額都是正數', '同一筆交易的所有分錄金額總和為 0', '每天只能有一筆交易', '帳本可以隨時修改'], answer: 1, explain: '借貸平衡讓錯誤可被偵測，帳本也應只新增不修改。' },
    { q: '聊天服務中，訊息的「房間內遞增序號」主要用途是？', options: ['美化顯示', '讓客戶端重連後補齊遺漏的訊息並去重排序', '加密訊息', '計算費用'], answer: 1, explain: '客戶端送出最後收到的序號，伺服器補送之後的訊息。' },
    { q: 'AI Agent API 專案中，下列哪個做法最能防止跨租戶資料外洩？', options: ['在系統提示中強調不要洩漏資料', '在 RAG 檢索的 SQL 中以已驗證的 tenant_id 過濾', '使用更大的模型', '關閉日誌'], answer: 1, explain: '權限要在資料存取層強制執行，不能依賴模型的行為。' },
    { q: '關於微服務平台專案，下列哪個說法最合理？', options: ['所有系統一開始都應該拆成微服務', '微服務帶來獨立部署與擴展，但也有分散式複雜度；小團隊通常先從模組化單體開始', '微服務之間應該共用同一個資料庫', '微服務不需要分散式追蹤'], answer: 1, explain: '能說明何時不該使用微服務，展現的是工程判斷力。' }
  ],
  sheet: [
    '依方向挑 3 個專案完整完成：一般後端（Auth、電商、金流）、AI 後端（Auth、AI Agent、微服務）、平台（Auth、電商、微服務）。',
    '交付標準：README + 架構圖 + ADR、OpenAPI、單元／整合／E2E 測試、docker compose、CI、儀表板、壓測報告、技術文章。',
    'Auth：Argon2id、RS256 + JWKS + kid 輪替、Refresh Token 輪替與重用偵測、登入限流、稽核紀錄。',
    '電商：價格快照、整數金額、原子扣庫存、Cursor 分頁 + 索引、Cache-aside、Outbox。',
    '金流：Idempotency-Key、傳遞決定性冪等鍵、逾時＝結果未知、複式記帳、Webhook 簽章與重送、對帳。',
    '聊天：房間序號補訊息、client_msg_id 去重、先寫再廣播、Redis Pub/Sub、心跳 TTL、背壓。',
    'AI Agent：工具授權與人工核准、租戶過濾的 RAG、預算與配額、Prompt Caching、gen_ai Trace、評估集進 CI。',
    '微服務：各自資料庫、gRPC + deadline、Kafka + Outbox + Saga、Helm + HPA + PDB、Canary、SLO、混沌實驗。'
  ]
});
