Course.register({
  id: 'm08', num: '08', title: 'Distributed Systems', zh: '分散式系統',
  intro: '一旦系統拆成多個服務，網路就會延遲、訊息會重複、服務會掛掉。本模組介紹微服務之間如何找到彼此、如何透過訊息溝通，以及沒有單一資料庫交易時如何維持業務正確。',
  goals: [
    '說明服務發現的兩種模式與 Kubernetes 中的做法',
    '比較 RabbitMQ、Kafka、SQS，並實作冪等消費者與死信佇列',
    '用 Saga（協調式或編排式）處理跨服務的業務流程與補償',
    '判斷何時需要 CQRS 與 Event Sourcing，以及分散式鎖的正確用法'
  ],
  lessons: [
    {
      id: 'service-discovery', title: 'Service Discovery', zh: '服務發現',
      html: `
<p>在容器與自動擴展的環境中，服務實例的 IP 隨時在變。<b>服務發現</b>讓呼叫端用「名稱」找到目前健康的實例。</p>
${table(['模式', '做法', '例子', '取捨'], [
  ['Client-side', '客戶端查詢註冊中心，自己挑選實例並做負載平衡', 'Consul + 客戶端函式庫', '少一跳、彈性高；每種語言都要實作'],
  ['Server-side', '客戶端呼叫固定位址，由負載平衡器轉發', 'Kubernetes Service、雲端 LB', '客戶端最簡單；多一跳'],
  ['DNS-based', '用 DNS 名稱解析到實例', 'K8s 的 <code>inventory.shop.svc.cluster.local</code>', '通用；DNS 快取可能導致延遲更新']
])}
${code('yaml', String.raw`
apiVersion: v1
kind: Service
metadata:
  name: inventory
  namespace: shop
spec:
  selector:
    app: inventory          # 轉發到所有帶這個 label、且 readiness probe 通過的 Pod
  ports:
    - port: 80
      targetPort: 8000
# 其他服務只要呼叫 http://inventory.shop.svc.cluster.local（同 namespace 可簡寫 http://inventory）
`, 'Kubernetes Service：內建的伺服器端服務發現')}
${note('tip', '服務發現與<b>健康檢查</b>密不可分：只有 readiness probe 通過的實例才會收到流量（模組 12）。Service Mesh 則在此之上加入 mTLS、重試與流量切分。')}
`,
      qa: [
        ['在 Kubernetes 中，服務 A 如何找到服務 B？', '<p>為服務 B 建立 Service 物件，它會得到穩定的 ClusterIP 與 DNS 名稱（<code>b.namespace.svc.cluster.local</code>）。服務 A 透過 DNS 呼叫這個名稱，kube-proxy（或 eBPF 實作）把流量轉到後端 readiness 通過的 Pod。Pod 擴縮或重建時，Endpoints 會自動更新，呼叫端完全不用改設定。</p>']
      ]
    },
    {
      id: 'message-queues', title: 'Message Queues', zh: '訊息佇列',
      html: `
${table(['', 'RabbitMQ', 'Kafka', 'AWS SQS'], [
  ['模型', '訊息佇列（Broker 推送給消費者）', '分散式日誌（消費者自己追蹤 offset）', '託管佇列'],
  ['訊息保留', '消費後刪除', '依時間或大小保留，可重播', '消費後刪除（最多保留 14 天）'],
  ['順序', '單一佇列內大致有序', '同一 partition 內有序（依 key 分配）', '標準佇列不保證；FIFO 佇列保證'],
  ['吞吐量', '中高', '極高', '高（自動擴展）'],
  ['適合', '任務分派、複雜路由', '事件串流、多個消費群組、重播', '不想維運 Broker 的雲端應用']
])}
<h3>投遞語意</h3>
<ul>
  <li><b>At-most-once</b>：收到就確認，處理失敗會遺失。</li>
  <li><b>At-least-once</b>：處理完才確認，可能重複投遞——<b>最常見</b>。</li>
  <li><b>Exactly-once</b>：端到端很難做到；實務上是「至少一次 + 冪等消費者」＝<b>效果上只處理一次</b>。</li>
</ul>
${code('python', String.raw`
async def handle_message(msg):
    event = json.loads(msg.body)
    async with session_factory() as session, session.begin():
        # 去重與業務處理放在同一個交易中
        inserted = await session.execute(text(
            "INSERT INTO processed_messages (message_id, consumer) VALUES (:id, 'inventory') "
            "ON CONFLICT DO NOTHING"), {"id": event["id"]})
        if inserted.rowcount == 0:
            return                                    # 已處理過，直接確認
        await reserve_stock(session, event["data"]["order_id"])
    # 交易成功提交後才 ack；若在 ack 前當機，訊息會重送，但會被上面的去重擋下

async def consume(queue):
    async for msg in queue:
        try:
            await handle_message(msg)
            await msg.ack()
        except TransientError:
            await msg.nack(requeue=True)              # 暫時性錯誤：稍後重試
        except Exception:
            await msg.reject(requeue=False)           # 超過重試次數或無法處理 → 送到死信佇列（DLQ）
`, '冪等消費者 + 確認時機 + 死信佇列')}
${note('warn', '<b>毒訊息</b>（格式錯誤、永遠會失敗的訊息）若無限重試會卡住整個佇列。一定要設定最大重試次數與 DLQ，並監控 DLQ 的訊息量。')}
`,
      qa: [
        ['Kafka 如何保證訊息順序？', '<p>Kafka 只保證<b>同一個 partition 內</b>有序。生產者以訊息的 key（例如 order_id）決定 partition，同一筆訂單的事件就會進入同一個 partition、依序被消費。不同 key 之間沒有順序保證。消費群組中，一個 partition 同時只會被一個消費者處理。若消費者以多執行緒平行處理同一 partition 的訊息，就會破壞順序，需要特別小心。</p>']
      ]
    },
    {
      id: 'eventual-consistency', title: 'Eventual Consistency', zh: '最終一致性',
      html: `
<p>跨服務透過事件同步資料，代表在一段時間內各服務看到的狀態不同。設計重點是<b>讓使用者理解並接受這個過渡狀態</b>。</p>
<ul>
  <li><b>明確的中間狀態</b>：訂單顯示「處理中」，而不是假裝已完成。</li>
  <li><b>202 Accepted + 狀態查詢</b>：長流程回傳任務 ID，客戶端輪詢或透過 SSE / Webhook 取得結果。</li>
  <li><b>樂觀 UI</b>：前端先顯示預期結果，失敗時再回滾並提示。</li>
  <li><b>對帳（Reconciliation）</b>：定期比對各服務資料，修正因 bug 或遺失訊息造成的不一致。</li>
</ul>
${code('python', String.raw`
async def on_product_updated(session, event):
    # 事件可能亂序抵達：只套用比目前更新的版本
    result = await session.execute(text("""
        INSERT INTO product_cache (id, name, price_cents, version)
        VALUES (:id, :name, :price, :v)
        ON CONFLICT (id) DO UPDATE
          SET name = EXCLUDED.name, price_cents = EXCLUDED.price_cents, version = EXCLUDED.version
          WHERE product_cache.version < EXCLUDED.version
    """), {"id": event["id"], "name": event["name"], "price": event["price_cents"], "v": event["version"]})
`, '用版本號處理亂序事件')}
${code('http', String.raw`
POST /v1/orders HTTP/1.1
→ 202 Accepted
  Location: /v1/orders/ord_789
  {"id": "ord_789", "status": "processing"}

GET /v1/orders/ord_789 HTTP/1.1
→ 200 OK
  {"id": "ord_789", "status": "confirmed"}
`, '非同步流程的 API 設計')}
`,
      qa: [
        ['最終一致的系統中，如何避免使用者看到混亂的狀態？', '<p>(1) 在 API 與 UI 中明確呈現中間狀態（processing / pending）；(2) 寫入後立刻讀取的頁面使用寫入時回傳的資料，或讀取權威來源；(3) 事件帶版本號，消費者只套用較新的版本，避免舊事件覆蓋新狀態；(4) 有逾時與補償機制，處理卡住的流程；(5) 定期對帳修正異常。</p>']
      ]
    },
    {
      id: 'saga', title: 'Saga Pattern', zh: 'Saga 長流程交易',
      html: `
<p>Saga 把跨服務的業務流程拆成一連串<b>本地交易</b>，每一步都有對應的<b>補償動作</b>。某一步失敗時，依相反順序執行前面步驟的補償。</p>
${table(['步驟', '動作', '補償'], [
  ['1', '建立訂單（PENDING）', '取消訂單'],
  ['2', '扣款', '退款'],
  ['3', '保留庫存', '釋放庫存'],
  ['4', '安排出貨', '—（最後一步，或稱 pivot 之後只能往前重試）']
])}
${table(['', '協調式（Orchestration）', '編排式（Choreography）'], [
  ['做法', '中央協調者依序呼叫各服務', '各服務監聽事件、完成後發布下一個事件'],
  ['優點', '流程集中、容易理解與監控', '沒有中央節點、服務高度解耦'],
  ['缺點', '協調者可能變得肥大', '流程分散在各處，難以追蹤與修改'],
  ['適合', '步驟多、規則複雜（多數業務流程）', '步驟少、團隊各自獨立']
])}
${code('python', String.raw`
STEPS = [
    ("create_order",  "cancel_order"),
    ("charge_payment", "refund_payment"),
    ("reserve_stock", "release_stock"),
    ("schedule_shipping", None),
]

async def run_saga(saga_id: str, ctx: dict):
    done = []
    for action, compensation in STEPS:
        try:
            await call_with_retry(action, ctx, idempotency_key=f"{saga_id}:{action}")
            done.append(compensation)
            await save_state(saga_id, f"{action}:ok")          # 持久化狀態，協調者重啟後可接續
        except BusinessError as e:                              # 例如餘額不足、庫存不足
            await save_state(saga_id, f"{action}:failed")
            for comp in reversed([c for c in done if c]):
                await call_with_retry(comp, ctx, idempotency_key=f"{saga_id}:{comp}")
            await save_state(saga_id, "compensated")
            raise SagaFailed(str(e))
    await save_state(saga_id, "completed")
`, '簡化的協調式 Saga（正式環境可用 Temporal 等工作流程引擎）')}
${note('warn', 'Saga 沒有隔離性：其他人可能在中途看到「已扣款但尚未保留庫存」的狀態。常用<b>語意鎖</b>（例如訂單狀態 PENDING 時禁止其他操作）緩解。補償動作必須<b>冪等</b>且可重試，並且是業務上的「反向操作」（退款），而不是刪除紀錄。')}
`,
      qa: [
        ['Saga 和資料庫交易有什麼不同？', '<p>資料庫交易提供 ACID，失敗時自動回滾，中間狀態對外不可見。Saga 是一連串已提交的本地交易，失敗時要靠補償動作「在業務上抵銷」，中間狀態是可見的（缺乏隔離性），因此需要語意鎖、狀態機與冪等補償。Saga 換來的是不需要跨服務鎖定資源，適合長時間、跨服務的流程。可以到互動實驗看各種失敗情境下的補償順序。</p>']
      ]
    },
    {
      id: 'cqrs', title: 'CQRS', zh: '命令查詢職責分離',
      html: `
<p><b>CQRS</b>（Command Query Responsibility Segregation）把「寫入模型」和「讀取模型」分開：</p>
${flow(['Command（下單、改價）', '寫入模型：正規化、嚴格驗證', '發布事件', 'Projection 更新讀取模型', 'Query：反正規化、為畫面最佳化'])}
<p>例如「訂單列表頁」需要訂單、顧客名稱、商品縮圖、物流狀態，橫跨四個服務。與其每次查詢都即時組合，不如維護一張專門的 <code>order_summaries</code> 讀取表，由事件持續更新。</p>
${code('python', String.raw`
async def project(session, event):
    match event["type"]:
        case "order.placed.v1":
            await session.execute(text(
                "INSERT INTO order_summaries (order_id, user_id, total_cents, status, item_count) "
                "VALUES (:o, :u, :t, 'placed', :n) ON CONFLICT (order_id) DO NOTHING"),
                {"o": event["data"]["order_id"], "u": event["data"]["user_id"],
                 "t": event["data"]["total_cents"], "n": len(event["data"]["items"])})
        case "shipment.dispatched.v1":
            await session.execute(text(
                "UPDATE order_summaries SET status = 'shipped', tracking_no = :tn WHERE order_id = :o"),
                {"o": event["data"]["order_id"], "tn": event["data"]["tracking_no"]})
`, 'Projection：把事件轉成讀取模型')}
${table(['適合', '不適合'], [
  ['讀寫比例懸殊、讀取需要組合多個來源', '簡單的 CRUD'],
  ['讀取需要不同的儲存（搜尋引擎、快取）', '團隊無法接受最終一致'],
  ['讀寫需要獨立擴展', '資料量小、查詢單純']
])}
${note('info', 'CQRS 不一定要搭配 Event Sourcing。最輕量的 CQRS 就是「寫主庫、讀副本」或「用 Materialized View 提供報表」。')}
`,
      qa: [
        ['你會在什麼情況下採用 CQRS？', '<p>當讀取需求與寫入需求差異很大時：例如寫入需要嚴格的業務規則與正規化，但讀取需要跨多個服務組合、全文搜尋或高度聚合的資料，且讀取量遠大於寫入量。CQRS 讓兩邊用各自最適合的模型與儲存，並獨立擴展。代價是讀取模型最終一致、需要維護 projection 與重建機制，所以簡單的 CRUD 不值得。</p>']
      ]
    },
    {
      id: 'event-sourcing', title: 'Event Sourcing', zh: '事件溯源',
      html: `
<p>傳統做法儲存「目前狀態」（餘額 = 700）。<b>Event Sourcing</b> 儲存「發生過的所有事件」，目前狀態由重播事件得出。</p>
${code('python', String.raw`
from dataclasses import dataclass, field

@dataclass
class Account:
    id: str
    balance: int = 0
    version: int = 0
    closed: bool = False

    def apply(self, event: dict) -> None:
        match event["type"]:
            case "AccountOpened":  self.balance = 0
            case "MoneyDeposited": self.balance += event["amount"]
            case "MoneyWithdrawn": self.balance -= event["amount"]
            case "AccountClosed":  self.closed = True
        self.version += 1

def load(account_id: str, events: list[dict]) -> Account:
    acc = Account(id=account_id)
    for e in events:                      # 也可從快照（snapshot）開始重播，加快載入
        acc.apply(e)
    return acc

# 寫入新事件時用 expected_version 做樂觀併發控制：
# INSERT INTO events (stream_id, version, type, data) VALUES (...)   -- (stream_id, version) 唯一
`, '以事件重建帳戶狀態')}
${table(['優點', '挑戰'], [
  ['完整稽核軌跡：每次變更都有紀錄', '查詢必須靠 Projection（通常搭配 CQRS）'],
  ['可以「時間旅行」：重建任意時間點的狀態', '事件 Schema 演進：舊事件要能被新程式理解（upcasting）'],
  ['修正 bug 後重播即可重建讀取模型', '個資刪除（GDPR）：事件不可變，常用加密後刪除金鑰（crypto-shredding）'],
  ['天然適合事件驅動整合', '學習曲線高、工具較少']
])}
`,
      qa: [
        ['Event Sourcing 適合什麼領域？', '<p>適合需要完整稽核軌跡、狀態轉換本身有業務意義的領域：金融帳務、訂單生命週期、保險理賠、庫存異動。不適合以「目前狀態」為核心、很少需要歷史的系統（例如使用者偏好設定）。導入時通常搭配 CQRS 提供查詢，並且要先規劃好事件版本演進與快照策略。</p>']
      ]
    },
    {
      id: 'coordination', title: 'Distributed Coordination', zh: '分散式協調',
      html: `
<p>有些工作必須「同一時間只有一個實例在做」：每日結算排程、Leader 選舉、對同一資源的獨占操作。</p>
${code('python', String.raw`
import secrets
import redis.asyncio as redis

r = redis.from_url("redis://localhost:6379")

RELEASE = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
"""

async def with_lock(name: str, ttl_ms: int, fn):
    token = secrets.token_hex(16)                              # 唯一值：只能釋放自己的鎖
    if not await r.set(f"lock:{name}", token, nx=True, px=ttl_ms):
        return None                                            # 別人正在做
    try:
        return await fn()
    finally:
        await r.eval(RELEASE, 1, f"lock:{name}", token)        # 原子地「比對後刪除」
`, 'Redis 分散式鎖（SET NX PX + Lua 釋放）')}
${note('warn', '<b>鎖可能在你不知情時過期</b>：GC 暫停、網路延遲讓程式執行超過 TTL，另一個實例就會拿到鎖，兩邊同時寫入。關鍵情境要用 <b>Fencing Token</b>：每次取得鎖時拿到一個遞增號碼，寫入資源時帶上，資源端拒絕比已見過更小的號碼。')}
${table(['工具', '一致性保證', '適合'], [
  ['Redis 鎖', '效率導向，非強保證', '避免重複工作（重複了也只是浪費）'],
  ['PostgreSQL advisory lock', '綁定資料庫連線', '已經有 PostgreSQL 的排程任務'],
  ['etcd / ZooKeeper / Consul', '基於共識演算法（Raft / ZAB），強保證', 'Leader 選舉、正確性關鍵的協調'],
  ['Kubernetes Lease', '基於 etcd', '控制器、Operator 的 Leader 選舉']
])}
`,
      qa: [
        ['用 Redis 實作分散式鎖有什麼要注意的？', '<p>(1) 用 <code>SET key token NX PX ttl</code> 一次完成「不存在才設定」與過期時間，避免當機後鎖永不釋放；(2) value 用唯一 token，釋放時用 Lua 比對後才刪除，避免刪到別人的鎖；(3) TTL 要大於最長執行時間，或用續約機制；(4) 意識到鎖可能過期而失去互斥，正確性關鍵的場景要搭配 fencing token 或改用 etcd / ZooKeeper；(5) Redis 主從切換時鎖可能遺失。</p>']
      ]
    }
  ],
  labs: [
    {
      title: 'Saga 模擬器',
      desc: '模擬「下單 → 扣款 → 保留庫存 → 安排出貨」的 Saga。選擇要讓哪一步失敗與協調方式，按「執行」觀察補償動作如何依相反順序回滾。',
      render(root) {
        const STEPS = [
          { svc: '訂單服務', act: '建立訂單（PENDING）', comp: '取消訂單', evt: 'OrderCreated' },
          { svc: '付款服務', act: '扣款 NT$2,490', comp: '退款 NT$2,490', evt: 'PaymentCompleted' },
          { svc: '庫存服務', act: '保留庫存 ×1', comp: '釋放庫存 ×1', evt: 'StockReserved' },
          { svc: '物流服務', act: '安排出貨', comp: null, evt: 'ShipmentScheduled' }
        ];
        root.innerHTML = `
<div class="controls">
  <label class="fld"><span>讓哪一步失敗？</span><select name="fail"><option value="-1">全部成功</option><option value="1">扣款失敗（餘額不足）</option><option value="2">保留庫存失敗（庫存不足）</option><option value="3">安排出貨失敗（地址無法配送）</option></select></label>
  <label class="fld"><span>協調方式</span><select name="mode"><option value="orch">協調式（Orchestration）</option><option value="chor">編排式（Choreography）</option></select></label>
</div>
<div class="btn-row"><button type="button" class="btn primary" data-run>執行 Saga</button></div>
<div class="kpis saga-steps"></div>
<div class="log saga-log"></div>`;
        let timers = [];
        const clear = () => { timers.forEach(clearTimeout); timers = []; };
        const box = (i, state) => {
          const el = root.querySelector('[data-s="' + i + '"]');
          const map = { idle: ['', '等待中'], run: ['', '執行中…'], ok: ['good', '✔ 成功'], fail: ['bad', '✘ 失敗'], comp: ['', '↩ 已補償'] };
          el.className = 'kpi ' + map[state][0];
          el.querySelector('span').textContent = STEPS[i].svc + '：' + map[state][1];
        };
        const reset = () => {
          root.querySelector('.saga-steps').innerHTML = STEPS.map((s, i) => '<div class="kpi" data-s="' + i + '"><b>' + (i + 1) + '. ' + s.act + '</b><span>' + s.svc + '：等待中</span></div>').join('');
          root.querySelector('.saga-log').innerHTML = '';
        };
        const log = (cls, m) => root.querySelector('.saga-log').insertAdjacentHTML('beforeend', '<div class="' + cls + '">' + m + '</div>');
        root.querySelector('[data-run]').onclick = () => {
          clear(); reset();
          const fail = +root.querySelector('[name=fail]').value, orch = root.querySelector('[name=mode]').value === 'orch';
          const plan = [];
          for (let i = 0; i < STEPS.length; i++) {
            const s = STEPS[i];
            plan.push(() => { box(i, 'run'); log('info', orch ? '協調者 → ' + s.svc + '：' + s.act : (i === 0 ? s.svc + ' 收到下單請求 → ' + s.act : s.svc + ' 收到 ' + STEPS[i - 1].evt + ' 事件 → ' + s.act)); });
            if (i === fail) {
              plan.push(() => { box(i, 'fail'); log('bad', s.svc + '：' + s.act + ' 失敗' + (orch ? '，回報協調者' : '，發布 ' + s.evt.replace(/Completed|Reserved|Scheduled|Created/, '') + 'Failed 事件')); });
              for (let j = i - 1; j >= 0; j--) {
                const c = STEPS[j];
                if (!c.comp) continue;
                plan.push(() => { box(j, 'comp'); log('warn', (orch ? '協調者 → ' + c.svc + '：' : c.svc + ' 收到失敗事件 → ') + c.comp + '（冪等，可重試）'); });
              }
              plan.push(() => log('bad', 'Saga 結束：已補償。訂單狀態 → CANCELLED，通知使用者失敗原因。'));
              break;
            }
            plan.push(() => { box(i, 'ok'); log('ok', s.svc + '：完成' + (orch ? '' : '，發布 ' + s.evt)); });
            if (i === STEPS.length - 1) plan.push(() => log('ok', 'Saga 完成：訂單狀態 → CONFIRMED。'));
          }
          plan.forEach((fn, k) => timers.push(setTimeout(fn, 550 * k)));
        };
        reset();
        return clear;
      }
    }
  ],
  quiz: [
    { q: '下列關於 Kafka 順序保證的敘述何者正確？', options: ['整個 topic 全域有序', '同一個 partition 內有序', '完全不保證順序', '只有使用 FIFO 模式才有序'], answer: 1, explain: '依 key 分配到同一 partition 的訊息會依序被消費，跨 partition 沒有順序保證。' },
    { q: '「至少一次投遞」搭配什麼，可以達到效果上只處理一次？', options: ['增加消費者數量', '冪等消費者（以訊息 ID 去重）', '關閉 ack', '縮短訊息保留時間'], answer: 1, explain: '重複的訊息被去重機制擋下，業務效果就只發生一次。' },
    { q: 'Saga 中第 3 步失敗了，應該怎麼做？', options: ['重新執行第 1 步', '依相反順序執行第 2、1 步的補償動作', '刪除所有資料庫紀錄', '忽略錯誤繼續第 4 步'], answer: 1, explain: '補償依相反順序執行，抵銷已完成步驟的業務效果。' },
    { q: '下列哪個是 Saga 相較於資料庫交易的主要缺點？', options: ['無法跨服務', '缺乏隔離性：中間狀態對其他人可見', '一定比較慢', '無法重試'], answer: 1, explain: '每一步都是已提交的本地交易，需要語意鎖等方式處理中間狀態。' },
    { q: 'CQRS 的核心概念是？', options: ['所有資料都放在同一張表', '把寫入模型與讀取模型分開，各自最佳化', '只能搭配 NoSQL', '禁止使用事件'], answer: 1, explain: '讀寫分離讓兩邊用各自最適合的資料結構與儲存，並可獨立擴展。' },
    { q: '使用 Redis 分散式鎖時，為什麼釋放鎖要用 Lua 腳本比對 token？', options: ['讓速度更快', '避免刪除到已過期後被其他實例取得的鎖', 'Redis 不支援 DEL', '為了加密'], answer: 1, explain: '若自己的鎖已過期、被別人取得，直接 DEL 會刪掉別人的鎖。比對 token 並原子刪除才安全。' }
  ],
  sheet: [
    '服務發現：Client-side、Server-side、DNS；K8s Service 提供穩定名稱，只轉發給 readiness 通過的 Pod。',
    'RabbitMQ 適合任務分派；Kafka 是可重播的日誌、partition 內有序；SQS 免維運。',
    '實務投遞語意是至少一次 → 消費者必須冪等；處理完才 ack；設定重試上限與 DLQ。',
    '最終一致：明確的中間狀態、202 + 狀態查詢、事件帶版本號處理亂序、定期對帳。',
    'Saga：本地交易 + 補償；協調式易追蹤、編排式較解耦；補償要冪等、用語意鎖處理隔離。',
    'CQRS 分開讀寫模型，讀取模型由 Projection 更新；最輕量版是讀副本或 Materialized View。',
    'Event Sourcing 儲存事件而非狀態：稽核與重播的好處，代價是 Projection、Schema 演進與個資刪除。',
    '分散式鎖：SET NX PX + 唯一 token + Lua 釋放；鎖可能過期，關鍵場景用 fencing token 或 etcd。'
  ]
});
