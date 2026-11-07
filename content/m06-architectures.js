Course.register({
  id: 'm06', num: '06', title: 'API Architectures', zh: 'API 架構風格',
  intro: 'REST 不是唯一答案。即時聊天、LLM 串流、內部高頻呼叫、通知第三方系統，各自有更合適的通訊方式。本模組比較七種架構，讓你能在系統設計中說清楚「為什麼選這個」。',
  goals: [
    '比較 REST、GraphQL、gRPC、WebSocket、SSE、Webhook、事件驅動的適用情境',
    '解決 GraphQL 的 N+1 問題，並理解它在快取與安全上的挑戰',
    '用 FastAPI 實作 WebSocket 與 SSE 端點，並處理水平擴展',
    '設計可靠的 Webhook：簽章、重送、冪等'
  ],
  lessons: [
    {
      id: 'rest', title: 'REST', zh: '回顧與總覽',
      html: `
<p>REST 的優勢是<b>普遍</b>：任何語言、任何工具都能呼叫，能利用 HTTP 快取，生態系最成熟。它的弱點是<b>過度取得</b>（拿到不需要的欄位）、<b>取得不足</b>（一個畫面要打好幾個 API），以及只能由客戶端發起請求。</p>
${table(['架構', '方向', '傳輸', '格式', '最適合'], [
  ['REST', '請求→回應', 'HTTP/1.1+', 'JSON', '公開 API、CRUD、大多數情境'],
  ['GraphQL', '請求→回應（+訂閱）', 'HTTP', 'JSON', '前端需彈性組合資料、多種客戶端'],
  ['gRPC', '請求→回應、四種串流', 'HTTP/2', 'Protobuf（二進位）', '內部微服務、高效能、強型別'],
  ['WebSocket', '雙向、全雙工', 'TCP（HTTP 升級）', '自訂', '聊天、多人協作、遊戲'],
  ['SSE', '伺服器→客戶端單向', 'HTTP', '文字事件', '通知、進度、<b>LLM 串流回應</b>'],
  ['Webhook', '伺服器→伺服器推送', 'HTTP POST', 'JSON', '通知第三方系統事件（付款完成）'],
  ['事件驅動', '發布→訂閱（非同步）', 'Message Broker', 'JSON / Avro / Protobuf', '服務解耦、一個事件多個處理者']
])}
${note('tip', '實務上常常混用：對外用 REST、內部服務用 gRPC、即時功能用 WebSocket / SSE、服務之間用事件解耦、對合作夥伴用 Webhook。')}
`,
      qa: [
        ['你會在什麼情況下不選 REST？', '<p>(1) 內部服務之間高頻、低延遲的呼叫，需要強型別契約——選 gRPC；(2) 多種前端（Web、App、手錶）各自需要不同的資料組合，REST 需要很多客製端點——考慮 GraphQL 或 BFF；(3) 需要伺服器主動推送——SSE（單向）或 WebSocket（雙向）；(4) 需要通知外部系統——Webhook；(5) 需要多個服務各自反應同一件事、且不想彼此耦合——事件驅動。</p>']
      ]
    },
    {
      id: 'graphql', title: 'GraphQL', zh: '查詢語言式 API',
      html: `
<p>GraphQL 只有一個端點，客戶端用查詢語言<b>精確指定要哪些欄位</b>，一次取得多種相關資源。</p>
${code('graphql', String.raw`
type Order {
  id: ID!
  status: String!
  customer: User!
  items: [OrderItem!]!
}

type Query {
  order(id: ID!): Order
}

# 客戶端查詢：只拿需要的欄位，一次取得訂單、顧客與明細
query {
  order(id: "ord_789") {
    status
    customer { name }
    items { quantity product { name } }
  }
}
`, 'Schema 與查詢')}
<h3>N+1 問題與 DataLoader</h3>
<p>查 20 筆訂單，每筆的 <code>customer</code> resolver 各自查一次資料庫 → 1 + 20 次查詢。<b>DataLoader</b> 會把同一輪的請求收集起來，合併成一次 <code>WHERE id IN (...)</code>。</p>
${code('python', String.raw`
import strawberry
from strawberry.dataloader import DataLoader

async def load_users(ids: list[str]) -> list["User"]:
    rows = await db.fetch_all("SELECT * FROM users WHERE id = ANY(:ids)", {"ids": ids})
    by_id = {r["id"]: User(id=r["id"], name=r["name"]) for r in rows}
    return [by_id.get(i) for i in ids]          # 順序必須和 ids 一致

@strawberry.type
class User:
    id: strawberry.ID
    name: str

@strawberry.type
class Order:
    id: strawberry.ID
    customer_id: strawberry.Private[str]

    @strawberry.field
    async def customer(self, info: strawberry.Info) -> User:
        return await info.context["user_loader"].load(self.customer_id)

# 每個請求建立新的 DataLoader（避免跨請求快取到別人的資料）
async def get_context():
    return {"user_loader": DataLoader(load_fn=load_users)}
`, 'Strawberry + DataLoader')}
<h3>GraphQL 的挑戰</h3>
<ul>
  <li><b>HTTP 快取不好用</b>：查詢多用 POST，需改用 Persisted Queries 或應用層快取。</li>
  <li><b>惡意查詢</b>：深層巢狀查詢可拖垮伺服器，需限制深度、複雜度與執行時間。</li>
  <li><b>欄位層級授權</b>：每個 resolver 都要考慮權限。</li>
  <li><b>錯誤處理</b>：通常回 200 並在 <code>errors</code> 陣列中描述，監控要特別處理。</li>
</ul>
`,
      qa: [
        ['GraphQL 適合什麼情境？什麼時候不建議用？', '<p>適合：多種客戶端需要不同資料形狀、畫面需要組合多個資源、前端團隊想自主決定資料需求、以及作為多個後端服務前的聚合層。不建議：簡單的 CRUD 或公開 API（REST 更通用、好快取）、檔案上傳下載、團隊沒有能力處理查詢複雜度限制與 N+1 問題時。</p>']
      ]
    },
    {
      id: 'grpc', title: 'gRPC / Protocol Buffers', zh: '高效能 RPC',
      html: `
<p>gRPC 用 <b>Protocol Buffers</b> 定義介面（IDL），自動產生各語言的客戶端與伺服器程式碼，跑在 HTTP/2 上，以二進位格式傳輸。</p>
${code('proto', String.raw`
syntax = "proto3";
package inventory.v1;

service InventoryService {
  rpc Reserve(ReserveRequest) returns (ReserveResponse);                 // Unary
  rpc WatchStock(WatchRequest) returns (stream StockEvent);              // Server streaming
}

message ReserveRequest {
  string order_id = 1;
  string sku = 2;
  int32 quantity = 3;
}

message ReserveResponse {
  bool ok = 1;
  int32 remaining = 2;
}

message WatchRequest { string sku = 1; }
message StockEvent  { string sku = 1; int32 quantity = 2; }
`, 'inventory.proto')}
${table(['RPC 類型', '說明', '例子'], [
  ['Unary', '一個請求、一個回應', '保留庫存'],
  ['Server streaming', '一個請求、多個回應', '持續推送庫存變化'],
  ['Client streaming', '多個請求、一個回應', '上傳大量感測器資料'],
  ['Bidirectional', '雙向串流', '即時語音辨識']
])}
${code('python', String.raw`
import grpc
from inventory.v1 import inventory_pb2, inventory_pb2_grpc   # 由 grpcio-tools 產生

class Inventory(inventory_pb2_grpc.InventoryServiceServicer):
    async def Reserve(self, request, context):
        remaining = await stock.reserve(request.sku, request.quantity)
        if remaining is None:
            await context.abort(grpc.StatusCode.FAILED_PRECONDITION, "insufficient stock")
        return inventory_pb2.ReserveResponse(ok=True, remaining=remaining)

async def serve():
    server = grpc.aio.server()
    inventory_pb2_grpc.add_InventoryServiceServicer_to_server(Inventory(), server)
    server.add_insecure_port("[::]:50051")      # 正式環境應使用 TLS / mTLS
    await server.start()
    await server.wait_for_termination()

# 客戶端一定要設定 deadline（逾時）
# await stub.Reserve(req, timeout=0.5)
`, 'Python gRPC 伺服器（grpc.aio）')}
<ul>
  <li><b>Schema 演進</b>：欄位以編號識別，可以新增欄位；<b>不可</b>重用或改變既有欄位編號。</li>
  <li><b>Deadline</b>：每次呼叫都要設逾時，並在服務間傳遞剩餘時間。</li>
  <li><b>瀏覽器</b>：無法直接呼叫，需要 gRPC-Web 或 REST 轉接（如 gRPC-Gateway）。</li>
</ul>
`,
      qa: [
        ['gRPC 為什麼比 REST + JSON 快？', '<p>(1) Protobuf 是二進位格式，比 JSON 小且解析快；(2) HTTP/2 多工，一條連線同時處理多個呼叫，減少建立連線成本；(3) 由 IDL 產生程式碼，不需要執行時反射。但「快」通常只在高頻內部呼叫時才顯著；對外 API 的瓶頸往往是網路與資料庫，REST 的通用性更重要。</p>']
      ]
    },
    {
      id: 'websockets', title: 'WebSockets', zh: '雙向即時通訊',
      html: `
<p>WebSocket 從一個 HTTP 請求開始（<code>Upgrade: websocket</code>，伺服器回 <code>101 Switching Protocols</code>），之後變成一條<b>持久、雙向</b>的連線。</p>
${code('python', String.raw`
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI()

class Rooms:
    def __init__(self):
        self.members: dict[str, set[WebSocket]] = {}

    async def join(self, room: str, ws: WebSocket):
        await ws.accept()
        self.members.setdefault(room, set()).add(ws)

    def leave(self, room: str, ws: WebSocket):
        self.members.get(room, set()).discard(ws)

    async def broadcast(self, room: str, message: dict):
        for ws in list(self.members.get(room, ())):
            await ws.send_json(message)

rooms = Rooms()

@app.websocket("/ws/rooms/{room_id}")
async def chat(ws: WebSocket, room_id: str):
    user = await authenticate_ws(ws)          # 在交握時驗證（Cookie 或第一則訊息帶 Token）
    if user is None:
        await ws.close(code=4401)
        return
    await rooms.join(room_id, ws)
    try:
        while True:
            data = await ws.receive_json()
            await rooms.broadcast(room_id, {"from": user.name, "text": data["text"][:2000]})
    except WebSocketDisconnect:
        rooms.leave(room_id, ws)
`, 'FastAPI 聊天室（單機版）')}
<h3>上線前要解決的問題</h3>
<ul>
  <li><b>水平擴展</b>：使用者 A 連在伺服器 1、B 連在伺服器 2，廣播要透過 <b>Redis Pub/Sub</b> 或 NATS 等訊息骨幹轉發。</li>
  <li><b>心跳</b>：定期 ping/pong 偵測斷線，避免殭屍連線佔用資源。</li>
  <li><b>重連</b>：客戶端以指數退避重連，並補齊斷線期間的訊息（用訊息序號）。</li>
  <li><b>背壓</b>：客戶端收不完時要限制佇列長度或斷開，避免伺服器記憶體爆掉。</li>
  <li><b>部署</b>：長連線讓滾動更新變複雜，要支援優雅關閉（通知客戶端重連）。</li>
</ul>
`,
      qa: [
        ['WebSocket 服務要如何水平擴展？', '<p>連線是有狀態的，負載平衡器要支援 WebSocket（並視需要設定 sticky session）。跨伺服器的訊息傳遞透過共用的 Pub/Sub 骨幹：每台伺服器訂閱自己有連線的房間頻道，收到訊息就推給本機的連線。另外要用 Redis 等共享儲存維護線上狀態，並設定每台機器的最大連線數與優雅關閉流程。可用模組 16 的 Real-time Chat 專案實作。</p>']
      ]
    },
    {
      id: 'sse', title: 'Server-Sent Events', zh: '伺服器推送事件',
      html: `
<p>SSE 是在一般 HTTP 回應上持續寫入文字事件的單向串流。它比 WebSocket 簡單得多：走普通 HTTP、穿得過大部分代理、瀏覽器內建 <code>EventSource</code> 並會自動重連。<b>主流 LLM API 的串流回應都使用 SSE。</b></p>
${code('http', String.raw`
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache

id: 1
event: progress
data: {"percent": 30}

id: 2
event: progress
data: {"percent": 80}

id: 3
event: done
data: {"report_url": "/v1/reports/r_55"}
`, 'SSE 格式：每個事件以空行結束')}
${code('python', String.raw`
import asyncio, json
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

app = FastAPI()

@app.get("/v1/jobs/{job_id}/events")
async def job_events(job_id: str, request: Request):
    async def stream():
        last_id = int(request.headers.get("Last-Event-ID", 0))   # 斷線重連時從這裡繼續
        while not await request.is_disconnected():
            for ev in await jobs.events_after(job_id, last_id):
                last_id = ev.id
                yield f"id: {ev.id}\nevent: {ev.type}\ndata: {json.dumps(ev.data)}\n\n"
                if ev.type == "done":
                    return
            yield ": keep-alive\n\n"                                # 註解行，防止代理切斷閒置連線
            await asyncio.sleep(1)
    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
`, 'FastAPI SSE 端點，支援 Last-Event-ID 續傳')}
${note('warn', '反向代理預設會緩衝回應，導致事件一次全部送達。Nginx 要設定 <code>proxy_buffering off;</code>（或回應 Header <code>X-Accel-Buffering: no</code>），並拉長 <code>proxy_read_timeout</code>。')}
`,
      qa: [
        ['LLM 串流回應為什麼通常用 SSE 而不是 WebSocket？', '<p>LLM 回應是典型的「一個請求、伺服器持續推送」單向場景，不需要雙向通道。SSE 就是普通的 HTTP 回應：可沿用既有的認證、負載平衡、日誌與代理設定；不需要升級協定；斷線可用 Last-Event-ID 續傳。WebSocket 則要處理連線狀態、心跳與擴展，對這個需求來說成本過高。</p>']
      ]
    },
    {
      id: 'webhooks', title: 'Webhooks', zh: '事件回呼',
      html: `
<p>Webhook 是「反向 API」：事件發生時，<b>你的伺服器主動 POST 到客戶設定的 URL</b>。例如金流在付款成功時通知商店。</p>
${code('json', String.raw`
{
  "id": "evt_1Qx9",
  "type": "payment.succeeded",
  "created_at": "2026-11-07T08:30:00Z",
  "data": {"payment_id": "pay_77", "order_id": "ord_789", "amount": "1000", "currency": "TWD"}
}
`, 'Webhook 事件內容')}
<h3>發送端（你）的責任</h3>
<ul>
  <li><b>簽章</b>：用每個客戶專屬的密鑰對「時間戳 + 內容」做 HMAC，放進 Header。</li>
  <li><b>重送</b>：對方非 2xx 或逾時，以指數退避重試（例如 1 分、5 分、30 分…最多 3 天）。</li>
  <li><b>至少一次投遞</b>：可能重複送達，事件要有唯一 <code>id</code>。</li>
  <li><b>不保證順序</b>：在文件中說明，或附上版本號讓接收端判斷新舊。</li>
  <li><b>防 SSRF</b>：驗證客戶設定的 URL（模組 05）。</li>
  <li><b>可觀測</b>：提供投遞紀錄與「重新送出」功能。</li>
</ul>
${code('python', String.raw`
import hashlib, hmac, time

def sign(secret: str, body: bytes, ts: int) -> str:
    return hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()

# 發送端
ts = int(time.time())
headers = {"Webhook-Timestamp": str(ts), "Webhook-Signature": "v1=" + sign(secret, body, ts)}

# 接收端
async def receive(request: Request):
    body = await request.body()                                   # 用原始 bytes 驗簽，不要先解析 JSON
    ts = int(request.headers["Webhook-Timestamp"])
    if abs(time.time() - ts) > 300:
        raise HTTPException(400, "timestamp too old")              # 防重放
    expected = "v1=" + sign(secret, body, ts)
    if not hmac.compare_digest(expected, request.headers["Webhook-Signature"]):
        raise HTTPException(401, "bad signature")
    event = json.loads(body)
    if await already_processed(event["id"]):                       # 冪等：重複事件直接回 200
        return {"ok": True}
    await queue.enqueue("handle_event", event)                     # 先回 2xx，再非同步處理
    return {"ok": True}
`, 'HMAC 簽章：發送與驗證')}
`,
      qa: [
        ['接收 Webhook 時，為什麼要「先回 200 再非同步處理」？', '<p>發送端通常有很短的逾時（例如 10 秒）。若在請求中同步處理耗時業務邏輯，容易逾時而被判定失敗、觸發重送，造成重複處理與雪崩。正確做法是：驗證簽章 → 以事件 ID 去重 → 寫入佇列 → 立即回 2xx；背景工作者再處理業務邏輯，失敗時由自己的佇列重試。</p>']
      ]
    },
    {
      id: 'event-driven', title: 'Event-Driven APIs', zh: '事件驅動 API',
      html: `
<p>在事件驅動架構中，服務<b>發布「發生了什麼事」</b>，而不是直接呼叫其他服務。訂閱者各自決定要做什麼。</p>
${table(['', 'Command（命令）', 'Event（事件）'], [
  ['語意', '「請做這件事」', '「這件事已經發生了」'],
  ['命名', '<code>ReserveStock</code>', '<code>OrderPlaced</code>'],
  ['接收者', '一個特定的處理者', '零到多個訂閱者'],
  ['耦合', '發送者知道接收者', '發布者不知道誰在訂閱']
])}
${flow(['訂單服務發布 OrderPlaced', 'Broker（Kafka / RabbitMQ）', '庫存服務：保留庫存', '通知服務：寄確認信', '分析服務：更新報表'])}
${code('json', String.raw`
{
  "specversion": "1.0",
  "id": "c8f1e2a0-7a1b-4c2e-9e7a-1d2f3a4b5c6d",
  "source": "/services/order",
  "type": "com.shop.order.placed.v1",
  "time": "2026-11-07T08:30:00Z",
  "datacontenttype": "application/json",
  "data": {"order_id": "ord_789", "user_id": "usr_42", "total": {"amount": "2490", "currency": "TWD"}}
}
`, 'CloudEvents 格式的事件（業界標準的事件封裝）')}
<ul>
  <li><b>AsyncAPI</b>：像 OpenAPI 一樣描述事件通道與訊息格式的規格。</li>
  <li><b>Schema Registry</b>：集中管理事件 Schema 與相容性規則（常搭配 Avro / Protobuf）。</li>
  <li><b>代價</b>：最終一致性、除錯困難（需要分散式追蹤）、要處理重複與亂序事件。</li>
</ul>
${note('info', '訊息佇列、Saga、CQRS、Event Sourcing 等深入主題在模組 08。')}
`,
      qa: [
        ['事件驅動架構的優缺點是什麼？', '<p>優點：服務解耦（新增訂閱者不需要改發布者）、削峰填谷（Broker 緩衝流量）、單一服務故障不會同步拖垮呼叫鏈、天然保留事件歷史。缺點：最終一致性讓業務流程更難推理；除錯與追蹤困難；必須處理重複、亂序、毒訊息；事件 Schema 變成跨團隊契約，需要治理。適合「一件事要觸發多個獨立後續動作」的情境，不適合需要立即得到結果的查詢。</p>']
      ]
    }
  ],
  labs: [
    {
      title: '架構選擇器',
      desc: '回答下面的問題，看哪種 API 架構最適合你的情境，以及理由。',
      render(root) {
        const Q = [
          ['caller', '誰會呼叫這個 API？', [['public', '瀏覽器或行動 App'], ['internal', '公司內部的其他服務'], ['third', '第三方系統（需要在事件發生時被通知）']]],
          ['flow', '資料怎麼流動？', [['rr', '請求 → 回應'], ['push', '伺服器持續單向推送（進度、LLM 回應）'], ['duplex', '雙向即時（聊天、協作編輯）'], ['notify', '事件發生時通知，不需要保持連線']]],
          ['shape', '客戶端是否需要彈性組合多種資源、只拿需要的欄位？', [['yes', '是，不同畫面需求差很多'], ['no', '否，資料形狀固定']]],
          ['perf', '效能與強型別的要求？', [['high', '極高（內部高頻呼叫、低延遲）'], ['normal', '一般']]],
          ['fan', '同一件事是否需要被多個服務各自處理？', [['yes', '是，且不希望彼此耦合'], ['no', '否']]]
        ];
        const A = {
          REST: '通用、好除錯、能利用 HTTP 快取，工具與生態最成熟。',
          GraphQL: '讓客戶端精確選擇欄位、一次取得多種資源，減少過度取得與多次往返。',
          gRPC: '二進位 Protobuf + HTTP/2，低延遲、強型別、自動產生程式碼，支援串流。',
          WebSocket: '持久的雙向連線，適合雙方都會主動送訊息的即時互動。',
          SSE: '基於普通 HTTP 的單向串流，簡單、可自動重連，是 LLM 串流的主流做法。',
          Webhook: '事件發生時主動通知外部系統，對方不必輪詢。',
          '事件驅動（Message Broker）': '發布者與訂閱者解耦，一個事件可被多個服務獨立處理，並能緩衝流量。'
        };
        const W = {
          caller: { public: { REST: 2, GraphQL: 2, SSE: 1, WebSocket: 1 }, internal: { gRPC: 3, '事件驅動（Message Broker）': 2, REST: 1 }, third: { Webhook: 3, REST: 1 } },
          flow: { rr: { REST: 2, GraphQL: 2, gRPC: 2 }, push: { SSE: 4, WebSocket: 1, gRPC: 1 }, duplex: { WebSocket: 4, gRPC: 1 }, notify: { Webhook: 3, '事件驅動（Message Broker）': 3 } },
          shape: { yes: { GraphQL: 3 }, no: { REST: 1 } },
          perf: { high: { gRPC: 3 }, normal: { REST: 1 } },
          fan: { yes: { '事件驅動（Message Broker）': 4 }, no: {} }
        };
        root.innerHTML = Q.map(([k, q, opts]) => '<div class="cl-item" style="margin-bottom:10px"><div class="cl-q"><b>' + q + '</b></div><div class="cl-choices" data-q="' + k + '">' +
          opts.map(([v, l]) => '<button type="button" class="chip" data-v="' + v + '">' + l + '</button>').join('') + '</div></div>').join('') +
          '<div class="out arch-out"><p class="muted" style="margin:0">回答至少兩題後顯示建議。</p></div>';
        const ans = {};
        root.onclick = e => {
          const b = e.target.closest('.chip'); if (!b) return;
          const g = b.closest('[data-q]');
          g.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b));
          ans[g.dataset.q] = b.dataset.v;
          const score = {}; Object.keys(A).forEach(k => { score[k] = 0; });
          Object.entries(ans).forEach(([q, v]) => Object.entries(W[q][v] || {}).forEach(([k, s]) => { score[k] += s; }));
          if (Object.keys(ans).length < 2) return;
          const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
          const max = ranked[0][1] || 1;
          root.querySelector('.arch-out').innerHTML = '<h4 style="margin-top:0">建議：' + ranked[0][0] + '</h4><p>' + A[ranked[0][0]] + '</p><div class="bars">' +
            ranked.slice(0, 5).map(([k, s]) => '<div class="bar-row"><span>' + k.replace('（Message Broker）', '') + '</span><span class="bar-track"><span class="bar-fill" style="left:0;width:' + (s / max * 100) + '%"></span></span><span class="bar-val">' + s + ' 分</span></div>').join('') +
            '</div>' + (ranked[1][1] >= max - 1 ? '<p class="small muted" style="margin:10px 0 0">第二名分數很接近：實務上常組合使用，例如「' + ranked[0][0] + ' + ' + ranked[1][0] + '」。</p>' : '');
        };
      }
    }
  ],
  quiz: [
    { q: '要把 LLM 產生的文字即時、逐字地顯示給使用者，最常見的做法是？', options: ['輪詢（每秒打一次 API）', 'Server-Sent Events', 'Webhook', '批次處理後寄 Email'], answer: 1, explain: '這是單向的伺服器推送，SSE 簡單且相容於一般 HTTP 基礎設施，也是主流 LLM API 的做法。' },
    { q: 'GraphQL 的 N+1 問題通常用什麼解決？', options: ['增加資料庫連線數', 'DataLoader 批次合併查詢', '改用 REST', '關閉巢狀查詢'], answer: 1, explain: 'DataLoader 收集同一輪的 key，合併成一次 WHERE id IN (...) 查詢。' },
    { q: '關於 gRPC，下列何者<b>錯誤</b>？', options: ['使用 Protocol Buffers 定義介面', '建立在 HTTP/2 之上', '瀏覽器可以不經轉接直接呼叫原生 gRPC', '支援雙向串流'], answer: 2, explain: '瀏覽器無法直接控制 HTTP/2 frame，需要 gRPC-Web 或 REST 轉接層。' },
    { q: 'WebSocket 聊天服務部署到多台伺服器後，連在不同伺服器的使用者收不到彼此的訊息。最常見的解法是？', options: ['改用 HTTP/1.0', '透過 Redis Pub/Sub 等訊息骨幹在伺服器之間轉發', '只部署一台伺服器', '讓客戶端輪詢'], answer: 1, explain: '每台伺服器只知道自己的連線，需要共享的 Pub/Sub 層轉發廣播訊息。' },
    { q: '接收 Webhook 時，驗證 HMAC 簽章應該使用什麼資料？', options: ['解析後再重新序列化的 JSON', '收到的原始請求 Body bytes（加上時間戳）', '只驗證事件 ID', '只驗證來源 IP'], answer: 1, explain: '重新序列化可能改變空白或欄位順序，導致簽章不符。必須用原始 bytes。' },
    { q: '「OrderPlaced」與「ReserveStock」的差別是？', options: ['兩者都是命令', 'OrderPlaced 是事件（已發生），ReserveStock 是命令（請求執行）', '兩者都是事件', '只有命名風格不同'], answer: 1, explain: '事件描述過去發生的事實，可有多個訂閱者；命令要求特定接收者執行動作。' }
  ],
  sheet: [
    'REST：通用首選；GraphQL：彈性取資料；gRPC：內部高效能；WebSocket：雙向即時；SSE：單向推送；Webhook：通知外部；事件：解耦。',
    'GraphQL 要處理 N+1（DataLoader）、查詢深度與複雜度限制、欄位授權、快取。',
    'gRPC：.proto 是契約，欄位編號不可重用；每次呼叫都要設 deadline；瀏覽器需 gRPC-Web。',
    'WebSocket 上線要處理：跨機器廣播（Pub/Sub）、心跳、重連補訊息、背壓、優雅關閉。',
    'SSE：text/event-stream、Last-Event-ID 續傳、keep-alive 註解行、代理要關閉緩衝。',
    'Webhook：HMAC（時間戳 + 原始 body）、指數退避重送、事件 ID 去重、先回 2xx 再處理、防 SSRF。',
    '事件描述「已發生的事」；用 CloudEvents 封裝、AsyncAPI 描述、Schema Registry 管理相容性。'
  ]
});
