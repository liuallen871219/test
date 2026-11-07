Course.register({
  id: 'm07', num: '07', title: 'Database & Data Architecture', zh: '資料庫與資料架構',
  intro: '大部分 API 的效能瓶頸與資料錯誤都發生在資料庫。本模組帶你掌握交易與隔離等級、連線池、索引、鎖，以及跨服務時如何維持資料一致。',
  goals: [
    '設計有約束的關聯式 Schema，判斷何時該用 NoSQL',
    '說明各隔離等級會防止哪些異常，正確處理交易重試',
    '計算連線池大小，讀懂 EXPLAIN ANALYZE 並建立正確的索引',
    '用樂觀鎖、悲觀鎖或原子更新解決併發寫入問題',
    '用 Transactional Outbox 解決「寫資料庫 + 發訊息」的雙寫問題'
  ],
  lessons: [
    {
      id: 'relational', title: 'Relational Database', zh: '關聯式資料庫',
      html: `
<p>關聯式資料庫用<b>資料表、主鍵、外鍵與約束</b>保證資料正確。PostgreSQL 是現今後端的首選之一：完整 ACID、豐富型別（JSONB、陣列、範圍）、強大的擴充（pgvector、PostGIS）、成熟的生態。</p>
${code('sql', String.raw`
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  email       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)                         -- 同租戶內 email 不重複
);

CREATE TABLE orders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  user_id     UUID NOT NULL REFERENCES users(id),
  status      TEXT NOT NULL CHECK (status IN ('pending','paid','shipped','cancelled')),
  total_cents BIGINT NOT NULL CHECK (total_cents >= 0),   -- 金額存最小單位整數
  currency    CHAR(3) NOT NULL,
  version     INT NOT NULL DEFAULT 1,                     -- 樂觀鎖用（本模組第 5 節）
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`, '讓資料庫幫你守住規則：NOT NULL、UNIQUE、CHECK、FOREIGN KEY')}
${table(['類型', '代表', '擅長', '不擅長'], [
  ['關聯式', 'PostgreSQL、MySQL', '交易、複雜查詢、資料一致性', '超大規模寫入的水平擴展（需分片）'],
  ['文件型', 'MongoDB', '彈性結構、整份文件讀寫', '跨文件交易與 JOIN'],
  ['Key-Value', 'Redis、DynamoDB', '極低延遲的鍵查詢', '依其他欄位查詢'],
  ['寬欄式', 'Cassandra', '海量寫入、時間序列', '彈性查詢、強一致'],
  ['搜尋引擎', 'Elasticsearch / OpenSearch', '全文檢索、聚合', '作為主要資料來源']
])}
${note('tip', '預設選 PostgreSQL，有明確需求（例如每秒數十萬次寫入、全文搜尋）時再引入專用資料庫，並把它當成<b>衍生資料</b>由主資料庫同步過去。')}
${note('warn', '資料庫 Schema 變更也要「Expand and Contract」：先加欄位（可為 null）→ 程式同時寫新舊 → 回填資料 → 改讀新欄位 → 移除舊欄位。正式環境建立索引用 <code>CREATE INDEX CONCURRENTLY</code> 避免鎖表。')}
`,
      qa: [
        ['什麼時候會選 NoSQL 而不是 PostgreSQL？', '<p>當資料存取模式非常明確且單一（例如只用 key 查詢的 Session、購物車）、需要極端的寫入吞吐或跨區域多主寫入（DynamoDB、Cassandra）、或資料本質是文件且很少需要跨文件交易時。但多數業務系統的資料高度關聯、需要交易與彈性查詢，PostgreSQL 的 JSONB 也能處理部分彈性結構需求。選擇時應從「查詢模式」與「一致性需求」出發，而不是追求流行。</p>']
      ]
    },
    {
      id: 'transactions', title: 'Database Transactions', zh: '交易與隔離等級',
      html: `
<p><b>ACID</b>：Atomicity（全有或全無）、Consistency（滿足所有約束）、Isolation（併發交易互不干擾的程度）、Durability（提交後不會遺失）。其中「隔離」有不同等級：</p>
${table(['異常', '說明'], [
  ['Dirty Read', '讀到別人尚未提交的資料'],
  ['Non-repeatable Read', '同一交易中兩次讀同一列，結果不同'],
  ['Phantom Read', '同一交易中兩次範圍查詢，筆數不同'],
  ['Lost Update', '兩個交易讀同一值、各自計算後寫回，其中一個更新被覆蓋'],
  ['Write Skew', '兩個交易各自檢查條件成立後寫入不同列，合起來違反規則（例如值班醫生全部請假）']
])}
${table(['隔離等級（PostgreSQL）', 'Dirty', 'Non-repeatable', 'Phantom', 'Lost Update', 'Write Skew'], [
  ['Read Committed（預設）', '✅ 防止', '❌', '❌', '❌', '❌'],
  ['Repeatable Read（快照）', '✅', '✅', '✅', '✅（衝突時報錯）', '❌'],
  ['Serializable（SSI）', '✅', '✅', '✅', '✅', '✅（衝突時報錯）']
])}
${code('python', String.raw`
from sqlalchemy.exc import DBAPIError

async def transfer(session_factory, src: str, dst: str, cents: int, retries: int = 3):
    for attempt in range(retries):
        try:
            async with session_factory() as session:
                async with session.begin():                       # 離開區塊自動 COMMIT，例外則 ROLLBACK
                    await session.execute(text("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE"))
                    bal = (await session.execute(text("SELECT balance FROM accounts WHERE id=:id"), {"id": src})).scalar_one()
                    if bal < cents:
                        raise InsufficientFunds()
                    await session.execute(text("UPDATE accounts SET balance = balance - :c WHERE id=:id"), {"c": cents, "id": src})
                    await session.execute(text("UPDATE accounts SET balance = balance + :c WHERE id=:id"), {"c": cents, "id": dst})
            return
        except DBAPIError as e:
            if getattr(e.orig, "sqlstate", None) == "40001" and attempt < retries - 1:   # serialization_failure
                continue                                          # 序列化衝突：整個交易重試
            raise
`, 'Serializable 交易必須準備好重試')}
${note('warn', '交易要短：<b>不要在交易中呼叫外部 API 或 LLM</b>。交易期間持有的鎖與連線會被佔住數秒，整個系統的吞吐量會急遽下降。')}
`,
      qa: [
        ['PostgreSQL 預設的隔離等級是什麼？會有什麼問題？', '<p>預設是 Read Committed：每條 SQL 看到的是執行當下已提交的資料。它不防止 Lost Update——兩個請求同時「讀餘額 → 程式計算 → 寫回」，後寫的會覆蓋前者。解法：用原子更新（<code>SET balance = balance - 100</code>）、<code>SELECT ... FOR UPDATE</code>、樂觀鎖，或在關鍵流程使用 Serializable 並處理 40001 重試。</p>']
      ]
    },
    {
      id: 'pooling', title: 'Connection Pooling', zh: '連線池',
      html: `
<p>建立一條 PostgreSQL 連線要經過 TCP、TLS、認證，伺服器還要為每條連線建立一個行程（約數 MB 記憶體）。連線池讓應用程式<b>重複使用</b>已建立的連線。</p>
${code('python', String.raw`
from sqlalchemy.ext.asyncio import create_async_engine

engine = create_async_engine(
    "postgresql+asyncpg://app:***@db:5432/shop",
    pool_size=10,          # 常駐連線數
    max_overflow=5,        # 尖峰時可額外建立的連線
    pool_timeout=3,        # 等不到連線時 3 秒後報錯（快速失敗，不要無限等）
    pool_recycle=1800,     # 30 分鐘換新，避免被防火牆或資料庫切斷
    pool_pre_ping=True,    # 取用前先檢查連線是否還活著
)
`, 'SQLAlchemy 非同步連線池設定')}
<h3>最容易被忽略的計算</h3>
${table(['項目', '數量'], [
  ['Kubernetes Pod 數', '10'],
  ['每個 Pod 的 worker 行程', '4'],
  ['每個行程的 pool_size + max_overflow', '15'],
  ['<b>最多連線數</b>', '<b>10 × 4 × 15 = 600</b>'],
  ['PostgreSQL 預設 max_connections', '100']
])}
<p>自動擴展時 Pod 增加，連線數會跟著暴增並打爆資料庫。對策：</p>
<ul>
  <li>從小的 pool 開始（每行程 5–10），用壓測找出最佳值。連線數超過 CPU 核心數太多反而會變慢。</li>
  <li>在應用程式與資料庫之間放 <b>PgBouncer</b>（transaction pooling 模式），讓數千個客戶端連線共用少量資料庫連線。注意：此模式下 Session 層級功能（如 <code>SET</code>、advisory lock、部分 prepared statement）需特別處理。</li>
  <li>監控「等待連線的時間」與「使用中的連線數」。</li>
</ul>
`,
      qa: [
        ['API 在流量高峰時出現大量「等待資料庫連線逾時」，你會怎麼處理？', '<p>先判斷是連線不夠還是連線被佔太久。看指標：查詢延遲是否變長（慢查詢佔住連線）、是否有交易包住外部呼叫、是否有連線洩漏（沒有歸還）。若是查詢慢，優先修索引或查詢；若是總連線數不足，計算 Pod × 行程 × pool 是否超過資料庫上限，考慮 PgBouncer。同時設定短的 pool_timeout 快速失敗並回 503，避免請求無限堆積。</p>']
      ]
    },
    {
      id: 'indexing', title: 'Database Indexing', zh: '索引',
      html: `
<p>索引（預設是 B-Tree）讓資料庫不必掃描整張表就能找到資料，代價是寫入變慢、佔用空間。</p>
${code('sql', String.raw`
-- 常見查詢：某租戶的訂單，依時間倒序分頁
SELECT id, status, total_cents FROM orders
WHERE tenant_id = $1 AND status = 'paid'
ORDER BY created_at DESC
LIMIT 20;

-- 複合索引：等值條件放前面，排序欄位放後面
CREATE INDEX CONCURRENTLY idx_orders_tenant_status_created
  ON orders (tenant_id, status, created_at DESC);

-- 部分索引：只為常查的資料建立，更小更快
CREATE INDEX CONCURRENTLY idx_orders_pending ON orders (created_at) WHERE status = 'pending';

-- 運算式索引：查詢用 lower(email) 時
CREATE INDEX CONCURRENTLY idx_users_email_lower ON users (lower(email));

EXPLAIN (ANALYZE, BUFFERS) SELECT ...;
`, '依查詢模式設計索引')}
${code('plain', String.raw`
Limit  (cost=0.43..8.95 rows=20) (actual time=0.041..0.112 rows=20 loops=1)
  ->  Index Scan using idx_orders_tenant_status_created on orders
        Index Cond: ((tenant_id = '...') AND (status = 'paid'))
Planning Time: 0.210 ms
Execution Time: 0.140 ms
`, '好的執行計畫：Index Scan，0.14 ms（沒有索引時可能是 Seq Scan + Sort，數百 ms）')}
${table(['常見錯誤', '原因', '修正'], [
  ['<code>WHERE lower(email) = ...</code> 不走索引', '對欄位套函式', '建立運算式索引'],
  ['<code>LIKE \'%keyboard%\'</code> 很慢', '前綴萬用字元無法用 B-Tree', '全文檢索或 pg_trgm 索引'],
  ['複合索引 (a, b) 卻只查 b', '最左前綴原則', '調整欄位順序或另建索引'],
  ['每個欄位都建索引', '寫入變慢、浪費空間', '依實際查詢建立，移除未使用的索引'],
  ['外鍵沒有索引', 'JOIN 與刪除父資料時全表掃描', '為外鍵欄位建索引']
])}
`,
      qa: [
        ['複合索引的欄位順序該怎麼決定？', '<p>依查詢模式：(1) 等值條件的欄位放前面（如 tenant_id、status）；(2) 範圍條件或排序欄位放後面（如 created_at）；(3) 遵守最左前綴原則——索引 (a, b, c) 可服務 a、a+b、a+b+c 的查詢，但不能單獨服務 b。可以用 <code>INCLUDE</code> 加入只需要讀取的欄位形成覆蓋索引，避免回表。最後一定要用 EXPLAIN ANALYZE 以真實資料驗證。</p>']
      ]
    },
    {
      id: 'locking', title: 'Optimistic / Pessimistic Locking', zh: '樂觀鎖與悲觀鎖',
      html: `
${table(['', '樂觀鎖（Optimistic）', '悲觀鎖（Pessimistic）'], [
  ['假設', '衝突很少', '衝突很常見'],
  ['做法', '讀取時記下 version，更新時檢查 version 沒變', '讀取時就鎖住該列（<code>SELECT ... FOR UPDATE</code>）'],
  ['衝突時', '更新 0 列 → 重試或回 409', '其他交易排隊等待'],
  ['優點', '不阻塞、適合長時間編輯（表單）', '保證成功、邏輯簡單'],
  ['缺點', '高衝突時大量重試', '降低併發、可能死結']
])}
${code('sql', String.raw`
-- 樂觀鎖：客戶端拿到 version=7，更新時帶回來
UPDATE products SET name = $1, version = version + 1
WHERE id = $2 AND version = 7;            -- 影響 0 列 → 已被別人改過，回 409

-- 悲觀鎖：交易內鎖住該列直到 COMMIT
BEGIN;
SELECT stock FROM products WHERE id = $1 FOR UPDATE;
UPDATE products SET stock = stock - 1 WHERE id = $1;
COMMIT;

-- 原子條件更新：計數器類操作的最佳解，一條 SQL 完成檢查與更新
UPDATE products SET stock = stock - $2
WHERE id = $1 AND stock >= $2
RETURNING stock;                           -- 沒有回傳列 → 庫存不足

-- 工作佇列：多個 worker 各自拿不同的工作，不互相等待
SELECT id FROM jobs WHERE status = 'queued'
ORDER BY created_at LIMIT 10
FOR UPDATE SKIP LOCKED;
`, '四種常見模式')}
${note('tip', 'HTTP 也有樂觀鎖：回應帶 <code>ETag: "v7"</code>，客戶端更新時送 <code>If-Match: "v7"</code>，不符就回 <code>412 Precondition Failed</code>。')}
${note('warn', '<b>死結</b>：交易 A 鎖了列 1 等列 2，交易 B 鎖了列 2 等列 1。預防：所有交易以相同順序（例如依 id 排序）取得鎖，並保持交易簡短。PostgreSQL 會偵測死結並中止其中一方，程式要能重試。')}
`,
      qa: [
        ['搶購活動中扣庫存，你會用哪種方式？', '<p>首選原子條件更新：<code>UPDATE ... SET stock = stock - 1 WHERE id = ? AND stock >= 1</code>，一條 SQL 完成檢查與扣減，不需要先讀再寫，也不會超賣。若熱門商品的單列更新成為瓶頸，可以把庫存預先載入 Redis 用 Lua 原子扣減、再非同步寫回資料庫，或把庫存拆成多個分桶分散鎖競爭，並以佇列削峰。可到「互動實驗」比較各種做法的執行順序。</p>']
      ]
    },
    {
      id: 'consistency', title: 'Data Consistency', zh: '資料一致性',
      html: `
${table(['模型', '保證', '例子'], [
  ['強一致（Linearizable）', '寫入後所有人立即讀到新值', '單一主資料庫'],
  ['讀己之寫（Read-your-writes）', '自己寫入的資料自己一定讀得到', '更新個人資料後重新整理頁面'],
  ['單調讀（Monotonic reads）', '不會先讀到新值、又讀到舊值', '同一使用者固定讀同一個副本'],
  ['最終一致（Eventual）', '停止寫入後，最終所有副本會一致', '讀取副本、快取、搜尋索引']
])}
<h3>讀取副本的延遲問題</h3>
<p>為了分擔讀取壓力，常把讀取導向唯讀副本。但副本有<b>複寫延遲</b>（毫秒到數秒）：使用者剛下單，馬上去「我的訂單」頁面卻看不到。</p>
<ul>
  <li>寫入後一段時間內（例如 5 秒），該使用者的讀取導向主庫。</li>
  <li>記錄寫入的 LSN，讀取時選擇已追上該位置的副本。</li>
  <li>關鍵流程（付款狀態、庫存）一律讀主庫。</li>
  <li>前端樂觀更新：直接用 API 回傳的新資料更新畫面，不必馬上重新查詢。</li>
</ul>
${note('info', '<b>CAP 定理</b>：網路分割（P）發生時，只能在一致性（C）與可用性（A）間取捨。<b>PACELC</b> 補充：即使沒有分割，也要在延遲（L）與一致性（C）之間取捨——這才是日常設計最常面對的問題。')}
`,
      qa: [
        ['使用者更新資料後立刻重新整理，卻看到舊資料。可能的原因與解法？', '<p>常見原因：(1) 讀取導向了有複寫延遲的唯讀副本；(2) 快取沒有失效或失效有延遲；(3) CDN 快取了 API 回應。解法依原因：寫入後短時間內讀主庫或用 LSN 追蹤；更新時同步刪除快取（Cache-aside 的失效策略）；個人化回應設定 <code>Cache-Control: private, no-store</code>。重點是要能說出「讀己之寫」這個一致性需求，並針對它設計。</p>']
      ]
    },
    {
      id: 'distributed-tx', title: 'Distributed Transactions', zh: '分散式交易',
      html: `
<p>當一個業務操作跨越多個資料庫或服務（訂單 DB、付款服務、庫存服務），單一資料庫交易就無能為力了。</p>
<h3>2PC（兩階段提交）為何少用</h3>
<p>協調者先請所有參與者「準備」（鎖住資源），全部同意後再「提交」。問題：協調者故障時參與者會卡在鎖定狀態；所有參與者都要支援 XA 協定；HTTP 服務之間無法使用；延遲高。微服務中通常改用 <b>Saga</b>（模組 08）。</p>
<h3>雙寫問題（Dual Write）</h3>
${code('python', String.raw`
# ❌ 兩個系統無法同時成功或同時失敗
await db.insert_order(order)            # 成功
await kafka.publish("OrderPlaced", e)   # 失敗 → 庫存服務永遠不知道有這筆訂單
                                         # 若順序顛倒：訊息發了、資料庫卻沒寫入
`)}
<h3>解法：Transactional Outbox</h3>
${flow(['同一個資料庫交易：寫入訂單 + 寫入 outbox 表', 'Relay（輪詢或 CDC）讀取 outbox', '發布到 Broker', '標記已發送'])}
${code('python', String.raw`
async def place_order(session, cmd):
    async with session.begin():
        order = Order(**cmd)
        session.add(order)
        session.add(OutboxEvent(                       # 同一個交易，保證「都成功或都失敗」
            aggregate_id=order.id,
            type="order.placed.v1",
            payload={"order_id": str(order.id), "total_cents": order.total_cents},
        ))
    return order

async def relay_forever(session_factory, producer):
    while True:
        async with session_factory() as session, session.begin():
            rows = (await session.execute(text(
                "SELECT * FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED"
            ))).mappings().all()
            for r in rows:
                await producer.send(topic="orders", key=str(r["aggregate_id"]), value=r["payload"])
                await session.execute(text("UPDATE outbox SET sent_at = now() WHERE id = :id"), {"id": r["id"]})
        await asyncio.sleep(0.5)
`, 'Outbox 寫入與 Relay（至少一次發送 → 消費者需冪等）')}
${note('info', '大規模系統常用 <b>CDC</b>（Change Data Capture，如 Debezium）直接讀資料庫的 WAL 來發布 outbox 事件，延遲更低，也不必輪詢。')}
`,
      qa: [
        ['如何確保「訂單寫入資料庫」和「發送 OrderPlaced 事件」不會一個成功一個失敗？', '<p>用 Transactional Outbox：在同一個資料庫交易中寫入訂單與一筆 outbox 事件，交易提交就代表兩者都成功。由獨立的 relay 程序（輪詢 + SKIP LOCKED，或 CDC）把 outbox 事件發布到 Broker，成功後標記已發送。因為 relay 可能在「已發送、未標記」時當機，所以是至少一次投遞，消費者必須以事件 ID 做冪等處理。</p>']
      ]
    }
  ],
  labs: [
    {
      title: '併發扣庫存模擬器',
      desc: '商品只剩 1 件，交易 A 和交易 B 幾乎同時下單。選擇一種處理方式，逐步看兩個交易的執行順序與最終結果。',
      render(root) {
        const MODES = {
          none: { name: '無保護（先讀再寫）', steps: [
            ['BEGIN;\nSELECT stock FROM products WHERE id=1;\n→ 1', '', 'stock = 1', 'A 讀到庫存 1，程式判斷可以賣。'],
            ['', 'BEGIN;\nSELECT stock FROM products WHERE id=1;\n→ 1', 'stock = 1', 'B 也讀到 1——A 還沒寫入，Read Committed 不會阻止這次讀取。'],
            ['UPDATE products SET stock = 0 WHERE id=1;\nCOMMIT;', '', 'stock = 0', 'A 在程式中算出 1 − 1 = 0 並寫回。'],
            ['', 'UPDATE products SET stock = 0 WHERE id=1;\nCOMMIT;', 'stock = 0', 'B 也算出 0 並寫回，覆蓋了 A 的結果（Lost Update）。'],
            ['✔ 訂單成立', '✔ 訂單成立', 'stock = 0（但賣出 2 件）', '<span class="pill bad">超賣！</span> 只有 1 件庫存卻成立了 2 筆訂單。']
          ] },
          optimistic: { name: '樂觀鎖（version）', steps: [
            ['SELECT stock, version FROM products WHERE id=1;\n→ (1, 7)', '', 'stock = 1, version = 7', 'A 讀到庫存與版本號。'],
            ['', 'SELECT stock, version FROM products WHERE id=1;\n→ (1, 7)', 'stock = 1, version = 7', 'B 也讀到同樣的版本號。'],
            ['UPDATE products SET stock=0, version=8\nWHERE id=1 AND version=7;\n→ 1 row', '', 'stock = 0, version = 8', 'A 更新成功，版本號遞增。'],
            ['', 'UPDATE products SET stock=0, version=8\nWHERE id=1 AND version=7;\n→ 0 rows', 'stock = 0, version = 8', 'B 的條件 version=7 已不成立，影響 0 列。'],
            ['✔ 訂單成立', '重新讀取 → (0, 8)\n庫存不足 → 409', 'stock = 0', '<span class="pill ok">正確</span> B 偵測到衝突、重試後發現庫存不足。沒有任何等待，但衝突多時會大量重試。']
          ] },
          pessimistic: { name: '悲觀鎖（FOR UPDATE）', steps: [
            ['BEGIN;\nSELECT stock FROM products\nWHERE id=1 FOR UPDATE;\n→ 1（取得列鎖）', '', 'stock = 1 🔒A', 'A 讀取並鎖住這一列。'],
            ['', 'BEGIN;\nSELECT stock FROM products\nWHERE id=1 FOR UPDATE;\n⏳ 等待中…', 'stock = 1 🔒A', 'B 想鎖同一列，必須等 A 結束。'],
            ['UPDATE products SET stock = 0 WHERE id=1;\nCOMMIT;（釋放鎖）', '⏳', 'stock = 0', 'A 扣庫存並提交，鎖被釋放。'],
            ['', '→ 0（取得列鎖）\n庫存不足 → ROLLBACK; 409', 'stock = 0', 'B 拿到鎖後讀到的是最新值 0。'],
            ['✔ 訂單成立', '✘ 庫存不足', 'stock = 0', '<span class="pill ok">正確</span> 保證正確，但 B 必須等待；熱門商品會讓大量請求排隊。']
          ] },
          atomic: { name: '原子條件更新', steps: [
            ['UPDATE products SET stock = stock - 1\nWHERE id=1 AND stock >= 1\nRETURNING stock;\n→ 1 row（stock = 0）', '', 'stock = 0', '檢查與扣減在同一條 SQL 中完成，資料庫保證原子性。'],
            ['', 'UPDATE products SET stock = stock - 1\nWHERE id=1 AND stock >= 1\nRETURNING stock;\n→ 0 rows', 'stock = 0', 'B 執行時條件 stock >= 1 已不成立。'],
            ['✔ 訂單成立', '✘ 庫存不足 → 409', 'stock = 0', '<span class="pill ok">正確</span> 只要一次往返、不需要先讀，計數器類操作的最佳解。']
          ] }
        };
        root.innerHTML = '<div class="btn-row modes">' + Object.entries(MODES).map(([k, m]) => '<button type="button" class="chip" data-m="' + k + '">' + m.name + '</button>').join('') + '</div><div class="sim"></div>';
        const esc = Course.ui.esc;
        const start = k => {
          root.querySelectorAll('.modes .chip').forEach(c => c.classList.toggle('on', c.dataset.m === k));
          const steps = MODES[k].steps;
          Course.ui.stepper(root.querySelector('.sim'), {
            count: steps.length,
            render(view, i) {
              view.innerHTML = '<div class="tbl"><table><thead><tr><th>#</th><th>交易 A</th><th>交易 B</th><th>資料庫</th></tr></thead><tbody>' +
                steps.slice(0, i + 1).map((s, j) => '<tr style="' + (j === i ? 'background:var(--accent-weak)' : 'opacity:.7') + '"><td>' + (j + 1) + '</td><td><pre style="margin:0;font:.78rem/1.5 var(--mono);white-space:pre-wrap">' + esc(s[0]) + '</pre></td><td><pre style="margin:0;font:.78rem/1.5 var(--mono);white-space:pre-wrap">' + esc(s[1]) + '</pre></td><td><code>' + esc(s[2]) + '</code></td></tr>').join('') +
                '</tbody></table></div><div class="st-detail">' + steps[i][3] + '</div>';
            }
          });
        };
        root.querySelector('.modes').onclick = e => { const b = e.target.closest('[data-m]'); if (b) start(b.dataset.m); };
        start('none');
      }
    }
  ],
  quiz: [
    { q: 'PostgreSQL 預設隔離等級 Read Committed <b>無法</b>防止下列哪個問題？', options: ['Dirty Read', 'Lost Update（先讀再寫被覆蓋）', '讀到未提交資料', '交易提交後資料遺失'], answer: 1, explain: 'Read Committed 只保證讀到已提交資料。「讀 → 計算 → 寫回」仍可能互相覆蓋，需要原子更新、鎖或更高隔離等級。' },
    { q: '10 個 Pod、每個 Pod 4 個 worker、每個 worker 連線池上限 15，最多可能建立幾條資料庫連線？', options: ['15', '60', '150', '600'], answer: 3, explain: '10 × 4 × 15 = 600，遠超過 PostgreSQL 預設的 100。這是自動擴展時打爆資料庫的常見原因。' },
    { q: '已有索引 (tenant_id, created_at)，下列哪個查詢<b>最無法</b>有效使用它？', options: ['WHERE tenant_id = ? ORDER BY created_at', 'WHERE tenant_id = ? AND created_at > ?', 'WHERE created_at > ?（不帶 tenant_id）', 'WHERE tenant_id = ?'], answer: 2, explain: '最左前綴原則：複合索引必須從第一個欄位開始使用。' },
    { q: '多個 worker 從 jobs 表搶工作，希望彼此不等待、也不重複拿到同一筆，應使用？', options: ['SELECT ... FOR UPDATE NOWAIT', 'SELECT ... FOR UPDATE SKIP LOCKED', 'SERIALIZABLE 隔離等級', '不加鎖直接讀'], answer: 1, explain: 'SKIP LOCKED 會跳過已被其他交易鎖住的列，是用資料庫實作工作佇列的標準做法。' },
    { q: '使用者剛更新資料就重新整理，卻看到舊資料，最可能的原因是？', options: ['資料庫索引損壞', '讀取被導向有複寫延遲的唯讀副本', 'TLS 交握失敗', 'JSON 序列化錯誤'], answer: 1, explain: '這是「讀己之寫」一致性問題。可在寫入後短時間內讀主庫，或追蹤複寫位置。' },
    { q: 'Transactional Outbox 解決的是什麼問題？', options: ['資料庫連線不足', '寫入資料庫與發送訊息無法一起成功或一起失敗（雙寫問題）', 'SQL Injection', '索引失效'], answer: 1, explain: '把事件寫進同一個資料庫交易的 outbox 表，再由 relay 發布，保證兩者一致（至少一次投遞）。' }
  ],
  sheet: [
    '預設 PostgreSQL；讓資料庫用 NOT NULL、UNIQUE、CHECK、FK 守住規則；金額存整數最小單位。',
    'Schema 變更也用 Expand and Contract；正式環境用 CREATE INDEX CONCURRENTLY。',
    'Read Committed 不防 Lost Update；Serializable 要處理 40001 重試；交易內不要呼叫外部 API。',
    '總連線數 = Pod × 行程 × pool；從小 pool 開始壓測；必要時加 PgBouncer；pool_timeout 要短。',
    '複合索引：等值欄位在前、範圍／排序在後；最左前綴；用 EXPLAIN ANALYZE 驗證。',
    '計數器用原子條件更新；表單編輯用樂觀鎖（version / ETag + If-Match）；佇列用 FOR UPDATE SKIP LOCKED。',
    '唯讀副本有複寫延遲：關鍵讀取走主庫，或寫入後短時間讀主庫（讀己之寫）。',
    '2PC 在微服務中少用；雙寫問題用 Transactional Outbox（+ CDC），消費者要冪等。'
  ]
});
