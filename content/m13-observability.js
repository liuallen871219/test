Course.register({
  id: 'm13', num: '13', title: 'Monitoring & Observability', zh: '監控與可觀測性',
  intro: '可觀測性回答的問題是：「系統現在發生了什麼事？為什麼？」本模組涵蓋日誌、指標、追蹤三大支柱，用 OpenTelemetry 串起來，再以 SLO 決定什麼才值得告警，最後談事故處理與事後檢討。',
  goals: [
    '輸出含 Request ID 與 Trace ID 的結構化日誌，且不記錄敏感資料',
    '用 RED / USE 方法設計指標，避免高基數標籤',
    '以 OpenTelemetry 實作分散式追蹤，理解 Context 傳遞',
    '定義 SLI / SLO、計算錯誤預算，設定 Burn Rate 告警',
    '主導一次事故處理並撰寫 Blameless Postmortem'
  ],
  lessons: [
    {
      id: 'structured-logging', title: 'Structured Logging', zh: '結構化日誌',
      html: `
<p>純文字日誌（<code>"User 42 created order ord_789"</code>）人看得懂，但機器很難搜尋與聚合。<b>結構化日誌</b>以 JSON 輸出固定欄位，就能用「找出 user_id=42 在過去一小時的所有錯誤」這類查詢。</p>
${code('python', String.raw`
import logging, uuid
import structlog
from fastapi import Request

structlog.configure(processors=[
    structlog.contextvars.merge_contextvars,          # 自動帶入目前請求綁定的欄位
    structlog.processors.add_log_level,
    structlog.processors.TimeStamper(fmt="iso", utc=True),
    structlog.processors.dict_tracebacks,
    structlog.processors.JSONRenderer(),
])
log = structlog.get_logger()

@app.middleware("http")
async def bind_context(request: Request, call_next):
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        request_id=request.headers.get("X-Request-ID", str(uuid.uuid4())),
        method=request.method, route=request.url.path,
    )
    return await call_next(request)

async def create_order(cmd, user):
    order = await orders.create(cmd)
    log.info("order_created", order_id=order.id, user_id=user.id, total_cents=order.total_cents)
    return order
`, 'structlog：每一行日誌都自動帶上 request_id')}
${code('json', String.raw`
{"event": "order_created", "level": "info", "timestamp": "2026-11-07T08:30:00.123Z",
 "request_id": "6f1c…", "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
 "method": "POST", "route": "/v1/orders", "order_id": "ord_789", "user_id": "usr_42", "total_cents": 249000}
`, '輸出')}
${table(['要記錄', '不要記錄'], [
  ['事件名稱、相關 ID（請求、使用者、訂單、Trace）', '密碼、Token、API Key、完整信用卡號'],
  ['錯誤與例外堆疊（在伺服器端）', '完整的請求 / 回應 Body（可能含個資）'],
  ['外部呼叫的目標、耗時、狀態碼', '高頻迴圈中的每一次迭代'],
  ['重要業務狀態轉換', '已經在指標中統計過的資料']
])}
${note('tip', '日誌層級：DEBUG（開發用，正式環境關閉）、INFO（業務事件）、WARNING（異常但已處理）、ERROR（需要調查）。大流量服務可對 INFO 做取樣，但錯誤要全部保留。')}
`,
      qa: [
        ['日誌、指標、追蹤分別適合回答什麼問題？', '<p><b>指標</b>回答「有沒有問題、多嚴重」：錯誤率、延遲、流量的趨勢與告警，成本低、可長期保存。<b>追蹤</b>回答「問題在哪裡」：一個慢請求的時間花在哪個服務、哪個呼叫。<b>日誌</b>回答「到底發生什麼事」：特定請求的詳細上下文與錯誤訊息。三者用 trace_id / request_id 串起來，從告警（指標）→ 範例請求（追蹤）→ 細節（日誌）一路往下鑽。</p>']
      ]
    },
    {
      id: 'metrics', title: 'Metrics', zh: '指標',
      html: `
${table(['類型', '特性', '例子'], [
  ['Counter', '只增不減', '請求總數、錯誤總數、處理的 Token 數'],
  ['Gauge', '可增可減的當下值', '進行中的請求數、佇列長度、連線池使用量'],
  ['Histogram', '依區間統計分布，可算百分位數', '請求延遲、回應大小']
])}
${table(['方法', '適用', '指標'], [
  ['RED', '服務（每個 API）', '<b>R</b>ate 每秒請求數、<b>E</b>rrors 錯誤率、<b>D</b>uration 延遲分布'],
  ['USE', '資源（CPU、DB、連線池）', '<b>U</b>tilization 使用率、<b>S</b>aturation 飽和（排隊）、<b>E</b>rrors 錯誤']
])}
${code('python', String.raw`
import time
from prometheus_client import Counter, Gauge, Histogram, make_asgi_app

REQUESTS = Counter("http_requests_total", "HTTP requests", ["method", "route", "status"])
LATENCY = Histogram("http_request_duration_seconds", "Request latency", ["method", "route"],
                    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10))
IN_FLIGHT = Gauge("http_requests_in_flight", "In-flight requests")

@app.middleware("http")
async def metrics_mw(request, call_next):
    IN_FLIGHT.inc()
    start = time.perf_counter()
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
        return response
    finally:
        route = request.scope.get("route").path if request.scope.get("route") else "unmatched"
        LATENCY.labels(request.method, route).observe(time.perf_counter() - start)
        REQUESTS.labels(request.method, route, str(status)).inc()
        IN_FLIGHT.dec()

app.mount("/metrics", make_asgi_app())       # 讓 Prometheus 抓取
`, 'prometheus_client：RED 指標')}
${note('warn', '<b>高基數陷阱</b>：每個不同的標籤組合都是一條新的時間序列。用 <code>route="/v1/orders/{order_id}"</code>（路由模板），<b>不要</b>用實際路徑 <code>/v1/orders/ord_789</code>，也不要把 user_id、email 當標籤——監控系統會被數百萬條序列壓垮。')}
`,
      qa: [
        ['為什麼延遲要用 Histogram 而不是 Gauge 記錄平均值？', '<p>平均值會隱藏尾端延遲，也無法跨多個實例正確合併（各台平均的平均不等於整體平均）。Histogram 記錄每個區間的計數，可以在查詢時跨實例加總後再計算任意百分位數（p95、p99），也能畫出延遲分布熱圖。要注意 bucket 的邊界要涵蓋你的 SLO 門檻（例如 300ms），否則算不準。</p>']
      ]
    },
    {
      id: 'tracing', title: 'Distributed Tracing', zh: '分散式追蹤',
      html: `
<p>一個請求穿過 Gateway → 訂單服務 → 庫存服務 → 資料庫 → 付款服務。<b>Trace</b> 記錄這整趟旅程；每一段工作是一個 <b>Span</b>，有開始時間、耗時、屬性，以及父 Span。</p>
${code('plain', String.raw`
Trace 4bf92f35…  POST /v1/orders                          ████████████████████████ 820 ms
├─ orders: validate_cart                                   █ 12 ms
├─ orders → inventory: POST /v1/reservations                 ███ 95 ms
│   └─ inventory: UPDATE products …                           ██ 61 ms
├─ orders → payments: POST /v1/charges                           ████████████████ 640 ms  ← 瓶頸
│   └─ payments → 第三方金流                                       ███████████████ 610 ms
└─ orders: INSERT orders + outbox                                                  ██ 48 ms
`, '追蹤的瀑布圖：一眼看出時間花在哪裡')}
<h3>Context 傳遞</h3>
<p>服務之間透過 HTTP Header 傳遞追蹤上下文，W3C 標準是 <code>traceparent</code>：</p>
${code('http', String.raw`
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
#            版本-trace-id（整趟旅程共用）-parent-span-id-旗標（01 = 有取樣）
`)}
${table(['取樣方式', '做法', '取捨'], [
  ['Head-based', '請求一開始就決定是否記錄（例如 10%）', '簡單、成本低；可能漏掉少見的錯誤'],
  ['Tail-based', 'Collector 等整個 Trace 完成後再決定（保留所有錯誤與慢請求）', '更有價值；Collector 需要暫存資料']
])}
${note('tip', '訊息佇列也要傳遞 Context：把 traceparent 放進訊息的 header，消費者繼續同一個 Trace，才看得到非同步流程的全貌。')}
`,
      qa: [
        ['分散式追蹤如何把多個服務的 Span 串在一起？', '<p>第一個服務產生 trace-id，之後每次對外呼叫都在 Header（W3C traceparent）帶上 trace-id 與目前 span-id；下游服務讀取後建立子 Span，並以同樣方式往下傳。所有 Span 都送到同一個後端（Jaeger、Tempo、各家 APM），依 trace-id 與父子關係組成樹狀瀑布圖。OpenTelemetry 的自動 instrumentation 會處理常見 HTTP 客戶端與框架的傳遞。</p>']
      ]
    },
    {
      id: 'opentelemetry', title: 'OpenTelemetry', zh: '可觀測性標準',
      html: `
<p><b>OpenTelemetry（OTel）</b>是 CNCF 的開放標準，統一了追蹤、指標、日誌的 API、SDK 與傳輸協定（OTLP）。程式碼只依賴 OTel，後端要換成 Jaeger、Grafana、Datadog 等都不必改程式。</p>
${flow(['應用程式（OTel SDK + 自動 instrumentation）', 'OTLP', 'OTel Collector（接收、處理、取樣、轉送）', 'Traces → Tempo / Jaeger', 'Metrics → Prometheus', 'Logs → Loki / Elasticsearch'])}
${code('python', String.raw`
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

provider = TracerProvider(resource=Resource.create({"service.name": "orders", "service.version": "1.8.3"}))
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint="http://otel-collector:4317", insecure=True)))
trace.set_tracer_provider(provider)

FastAPIInstrumentor.instrument_app(app)          # 自動為每個請求建立 Span
HTTPXClientInstrumentor().instrument()           # 對外呼叫自動帶 traceparent

tracer = trace.get_tracer(__name__)

async def reserve_stock(order_id: str, items: list):
    with tracer.start_as_current_span("reserve_stock") as span:   # 手動加上業務 Span
        span.set_attribute("order.id", order_id)
        span.set_attribute("order.item_count", len(items))
        ...
`, 'Python 服務接入 OpenTelemetry')}
${code('yaml', String.raw`
receivers:
  otlp:
    protocols:
      grpc: {}
      http: {}
processors:
  batch: {}
exporters:
  otlphttp:
    endpoint: https://tempo.internal.example
  prometheus:
    endpoint: 0.0.0.0:8889
service:
  pipelines:
    traces:  { receivers: [otlp], processors: [batch], exporters: [otlphttp] }
    metrics: { receivers: [otlp], processors: [batch], exporters: [prometheus] }
`, 'OTel Collector 設定')}
${note('info', 'OTel 的 <b>Semantic Conventions</b> 定義了標準屬性名稱（例如 <code>http.request.method</code>、<code>db.system</code>），也包含 LLM 呼叫的 <code>gen_ai.*</code> 屬性（模型名稱、Token 數），讓各工具能一致地解讀（模組 15）。')}
`,
      qa: [
        ['為什麼要在應用程式和監控後端之間放 OTel Collector？', '<p>(1) 解耦：應用程式只送 OTLP 到 Collector，換後端只改 Collector 設定；(2) 處理：批次、重試、過濾敏感屬性、加上環境標籤；(3) 取樣：tail-based sampling 需要在 Collector 看到完整 Trace 才能決定；(4) 降低應用程式負擔與對外連線數；(5) 可同時轉送到多個後端。</p>']
      ]
    },
    {
      id: 'prometheus-grafana', title: 'Prometheus / Grafana', zh: '指標查詢與儀表板',
      html: `
<p><b>Prometheus</b> 定期抓取（pull）各服務的 <code>/metrics</code>，以 PromQL 查詢；<b>Grafana</b> 把查詢結果畫成儀表板並設定告警。</p>
${code('plain', String.raw`
# 每秒請求數（依路由）
sum by (route) (rate(http_requests_total[5m]))

# 錯誤率（5xx 比例）
sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))

# p95 延遲（跨所有實例合併後計算）
histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))

# 資料庫連線池飽和度
max(db_pool_in_use) / max(db_pool_size)
`, 'PromQL 常用查詢')}
${code('yaml', String.raw`
groups:
  - name: orders-api
    rules:
      - alert: OrdersHighErrorRate
        expr: |
          sum(rate(http_requests_total{service="orders",status=~"5.."}[5m]))
            / sum(rate(http_requests_total{service="orders"}[5m])) > 0.02
        for: 5m                                   # 持續 5 分鐘才觸發，避免瞬間抖動
        labels: { severity: page }
        annotations:
          summary: "訂單 API 5xx 錯誤率超過 2%"
          runbook: "https://wiki.example.com/runbooks/orders-errors"
`, 'Prometheus 告警規則')}
<h3>儀表板設計</h3>
<ul>
  <li><b>第一層</b>：每個服務的 RED（流量、錯誤率、p50/p95/p99）與 SLO 狀態。</li>
  <li><b>第二層</b>：依路由、依依賴（DB、快取、外部 API）拆解。</li>
  <li><b>第三層</b>：資源 USE（CPU、記憶體、連線池、佇列長度）。</li>
  <li>標示部署時間點，方便對照「是不是剛上線造成的」。</li>
</ul>
${note('tip', '<b>對症狀告警，不要對原因告警</b>：「使用者錯誤率升高」值得叫醒人；「某台 CPU 80%」不一定有影響，放在儀表板就好。每個告警都要能採取行動，並附上 Runbook 連結。')}
`,
      qa: [
        ['你怎麼避免告警疲勞？', '<p>(1) 只對使用者感受得到的症狀（錯誤率、延遲、可用性）發出需要立即處理的告警，其他放儀表板或工單；(2) 以 SLO 的 burn rate 告警取代固定門檻；(3) 設定持續時間（for）避免抖動；(4) 每個告警都要有 Runbook 與負責人；(5) 定期檢討：沒有人處理或總是誤報的告警就調整或刪除；(6) 依嚴重性分級，非緊急的不要在半夜打電話。</p>']
      ]
    },
    {
      id: 'slo', title: 'SLI / SLO / SLA', zh: '服務水準',
      html: `
${table(['名詞', '意思', '例子'], [
  ['SLI（Indicator）', '衡量服務品質的指標，通常是「好事件 / 有效事件」', '回應時間 &lt; 300ms 且非 5xx 的請求比例'],
  ['SLO（Objective）', '內部對 SLI 設定的目標', '30 天內 99.9% 的請求是「好的」'],
  ['SLA（Agreement）', '對客戶的合約承諾，未達成有賠償', '月可用性 99.5%，未達成退 10% 費用']
])}
<p>SLA 應該比 SLO 寬鬆，SLO 是你提早預警的內部標準。</p>
${table(['可用性', '30 天可停機時間', '每週'], [
  ['99%', '7.2 小時', '1.68 小時'],
  ['99.5%', '3.6 小時', '50 分鐘'],
  ['99.9%', '43.2 分鐘', '10 分鐘'],
  ['99.95%', '21.6 分鐘', '5 分鐘'],
  ['99.99%', '4.3 分鐘', '1 分鐘']
])}
<h3>錯誤預算</h3>
<p>SLO 99.9% 代表你<b>允許</b> 0.1% 的請求失敗——這就是<b>錯誤預算</b>。預算還多時可以大膽發布新功能；預算快用完時，優先處理穩定性（凍結非必要的發布）。這讓「開發速度」與「穩定性」的爭論有了客觀依據。</p>
<h3>Burn Rate 告警</h3>
<p>Burn rate = 目前錯誤率 ÷ 允許的錯誤率。Burn rate 1 代表剛好在 30 天用完預算；14.4 代表 1 小時就燒掉 2% 的月預算。Google SRE 建議多視窗告警：</p>
${table(['Burn rate', '觀察視窗', '代表', '動作'], [
  ['14.4', '1 小時（並用 5 分鐘確認）', '1 小時燒掉 2% 預算', '立即呼叫值班'],
  ['6', '6 小時（並用 30 分鐘確認）', '6 小時燒掉 5% 預算', '立即呼叫值班'],
  ['1', '3 天（並用 6 小時確認）', '3 天燒掉 10% 預算', '開工單，上班時間處理']
])}
`,
      qa: [
        ['為什麼不把 SLO 訂成 100%？', '<p>100% 不可能達成（網路、依賴、硬體都會失敗），追求它的成本呈指數成長，還會讓團隊不敢做任何變更。而且使用者也感受不到 99.99% 與 100% 的差別——他們的網路、手機本身就不是 100% 可靠。SLO 應該依使用者的實際期望訂定，剩下的錯誤預算用來承擔創新的風險。</p>']
      ]
    },
    {
      id: 'incident', title: 'Incident Management', zh: '事故管理',
      html: `
${table(['等級', '定義', '回應'], [
  ['SEV1', '核心功能全面中斷或資料外洩', '立即動員、每 30 分鐘對外更新'],
  ['SEV2', '核心功能部分受影響或嚴重降級', '值班立即處理、通知相關團隊'],
  ['SEV3', '非核心功能異常、有替代方案', '上班時間處理']
])}
<h3>事故中的角色</h3>
<ul>
  <li><b>Incident Commander</b>：協調全局、做決策，<b>不</b>親自除錯。</li>
  <li><b>Operations</b>：實際調查與執行修復。</li>
  <li><b>Communications</b>：更新狀態頁、通知客服與利害關係人。</li>
  <li><b>Scribe</b>：記錄時間軸與決策。</li>
</ul>
${flow(['偵測（告警 / 回報）', '宣告事故與分級', '<b>先止血</b>（回滾、切流量、關功能）', '確認恢復', '事後檢討'])}
${note('tip', '<b>先止血再找根因</b>。剛部署後出問題，第一個動作通常是回滾，而不是在線上除錯。')}
<h3>Blameless Postmortem 範本</h3>
${code('plain', String.raw`
標題：2026-11-07 結帳失敗率升高（SEV2）
摘要：14:05–14:47 約 18% 結帳請求失敗，影響約 3,200 位使用者。
影響：結帳成功率從 99.6% 降到 82%；月錯誤預算消耗 35%。
時間軸：
  14:02 部署 payments v2.14（新增重試邏輯）
  14:05 結帳錯誤率告警觸發（burn rate 14.4）
  14:12 IC 宣告 SEV2，懷疑與部署有關
  14:20 回滾 payments 至 v2.13，錯誤率未完全恢復
  14:38 發現第三方金流因重試風暴對我們限流（429）
  14:47 暫停重試佇列，錯誤率恢復正常
根本原因與促成因素：
  - 新重試邏輯沒有抖動，且與 Service Mesh 重試疊加（3×3 倍流量）
  - 對第三方的 429 沒有尊重 Retry-After
做得好的地方：告警 3 分鐘內觸發；回滾流程順利
改進項目（負責人 / 期限）：
  - 移除 Mesh 層對 payments 的重試（@backend-a / 11-14）
  - 重試加入 jitter 並遵守 Retry-After（@backend-b / 11-14）
  - 新增對第三方 429 比例的告警（@sre-c / 11-21）
`, '重點是找出系統與流程的改進，而不是追究個人')}
`,
      qa: [
        ['什麼是 Blameless Postmortem？為什麼重要？', '<p>事後檢討聚焦在「系統與流程如何讓錯誤發生」，而不是「誰犯了錯」。如果事故會導致責怪，人們會隱瞞資訊、害怕變更，組織就失去學習的機會。好的 postmortem 包含影響範圍、詳細時間軸、根本原因與促成因素、做得好的地方，以及有負責人與期限的改進項目，並在團隊間分享。</p>']
      ]
    }
  ],
  labs: [
    {
      title: 'SLO 錯誤預算計算器',
      desc: '設定 SLO 與流量，算出這個月允許多少失敗、可停機多久；再輸入目前的錯誤率，看預算多快會燒完、該不該叫醒值班工程師。',
      render(root) {
        const { fmt } = Course.ui;
        root.innerHTML = `
<div class="controls">
  <label class="fld"><span>SLO 目標</span><select name="slo"><option>99</option><option>99.5</option><option selected>99.9</option><option>99.95</option><option>99.99</option></select></label>
  <label class="fld"><span>每月請求數</span><input type="number" name="req" value="50000000" min="1000" step="1000000"></label>
  <label class="fld"><span>目前錯誤率（%）</span><input type="number" name="err" value="0.5" min="0" max="100" step="0.01"></label>
  <label class="fld"><span>本月已消耗的預算（%）</span><input type="number" name="used" value="20" min="0" max="100" step="1"></label>
</div>
<div class="kpis slo-kpi"></div>
<div class="out slo-note"></div>`;
        const calc = () => {
          const slo = +root.querySelector('[name=slo]').value, req = +root.querySelector('[name=req]').value || 0;
          const err = (+root.querySelector('[name=err]').value || 0) / 100, used = Math.min(100, +root.querySelector('[name=used]').value || 0) / 100;
          const budget = 1 - slo / 100, minutes = 30 * 24 * 60 * budget;
          const burn = budget ? err / budget : 0;
          const remainingDays = burn > 0 ? (1 - used) * 30 / burn : Infinity;
          const t = m => m >= 60 ? fmt(m / 60, 1) + ' 小時' : fmt(m, 1) + ' 分鐘';
          root.querySelector('.slo-kpi').innerHTML =
            '<div class="kpi"><b>' + fmt(req * budget) + '</b><span>本月允許的失敗請求</span></div>' +
            '<div class="kpi"><b>' + t(minutes) + '</b><span>每 30 天可完全停機</span></div>' +
            '<div class="kpi"><b>' + t(minutes / 30 * 7) + '</b><span>每週可完全停機</span></div>' +
            '<div class="kpi ' + (burn >= 6 ? 'bad' : burn > 1 ? '' : 'good') + '"><b>' + fmt(burn, 1) + '×</b><span>目前 Burn Rate</span></div>' +
            '<div class="kpi ' + (remainingDays < 3 ? 'bad' : '') + '"><b>' + (isFinite(remainingDays) ? (remainingDays < 1 ? fmt(remainingDays * 24, 1) + ' 小時' : fmt(remainingDays, 1) + ' 天') : '不會耗盡') + '</b><span>以目前速度，剩餘預算可撐</span></div>';
          let msg;
          if (burn >= 14.4) msg = '<span class="pill bad">立即呼叫值班</span> Burn rate ≥ 14.4：每小時燒掉約 2% 的月預算。先止血（回滾、切流量、關閉功能），再找根因。';
          else if (burn >= 6) msg = '<span class="pill bad">呼叫值班</span> Burn rate ≥ 6：約 6 小時燒掉 5% 預算，需要立即處理。';
          else if (burn > 1) msg = '<span class="pill warn">開工單</span> Burn rate > 1：照這個速度本月預算會在月底前耗盡，安排在上班時間調查。';
          else msg = '<span class="pill ok">正常</span> 錯誤率在預算內。剩餘的預算可以用來承擔發布新功能的風險。';
          if (used >= 1) msg += ' <b>本月預算已用完</b>：依錯誤預算政策，暫停非必要發布，優先處理穩定性。';
          root.querySelector('.slo-note').innerHTML = msg;
        };
        root.addEventListener('input', calc);
        calc();
      }
    }
  ],
  quiz: [
    { q: '下列哪個<b>不適合</b>作為 Prometheus 指標的標籤？', options: ['HTTP 方法', '路由模板（/v1/orders/{id}）', '使用者 ID', '狀態碼'], answer: 2, explain: '使用者 ID 的值有數百萬種，會產生大量時間序列（高基數），拖垮監控系統。' },
    { q: 'RED 方法中的 R、E、D 分別是？', options: ['Rate、Errors、Duration', 'Read、Execute、Delete', 'Retry、Error、Deadline', 'Request、Event、Data'], answer: 0, explain: 'RED 用於服務層：每秒請求數、錯誤率、延遲分布。' },
    { q: 'W3C traceparent Header 的用途是？', options: ['驗證使用者身分', '在服務間傳遞追蹤上下文（trace-id、parent span-id）', '壓縮回應', '設定快取'], answer: 1, explain: '下游服務依此建立子 Span，讓整趟請求能串成一個 Trace。' },
    { q: 'SLO 99.9%，30 天內大約允許多少完全停機時間？', options: ['4.3 分鐘', '43.2 分鐘', '7.2 小時', '3.6 小時'], answer: 1, explain: '30 × 24 × 60 × 0.001 = 43.2 分鐘。' },
    { q: 'Burn rate 為 1 代表什麼？', options: ['服務完全正常，沒有任何錯誤', '以目前速度，剛好在 SLO 週期結束時用完錯誤預算', '每小時燒掉 1% 預算', '已經違反 SLA'], answer: 1, explain: 'Burn rate = 目前錯誤率 / 允許錯誤率；大於 1 會提前耗盡，小於 1 則有剩餘。' },
    { q: '事故發生、懷疑與剛才的部署有關，第一優先應該做什麼？', options: ['在正式環境加 print 除錯', '先止血，例如回滾部署', '先寫 postmortem', '等待問題自行消失'], answer: 1, explain: '先恢復服務、降低影響，再在事後找出根本原因。' }
  ],
  sheet: [
    '三大支柱：指標（有沒有問題）、追蹤（問題在哪）、日誌（發生了什麼）；用 trace_id / request_id 串起來。',
    '結構化 JSON 日誌 + contextvars 自動帶 request_id；不要記錄密碼、Token、完整個資。',
    'Counter / Gauge / Histogram；服務看 RED、資源看 USE；延遲用 Histogram 算百分位數。',
    '標籤用路由模板，不要用實際路徑或使用者 ID（高基數）。',
    'Trace = 多個 Span；W3C traceparent 傳遞 Context；訊息佇列也要傳；Head vs Tail 取樣。',
    'OpenTelemetry：SDK + 自動 instrumentation → OTLP → Collector → 各種後端；遵守 Semantic Conventions。',
    'PromQL：rate()、錯誤比例、histogram_quantile()；對症狀告警、附 Runbook、設定 for。',
    'SLI = 好事件 / 有效事件；SLO 是內部目標、SLA 是合約；錯誤預算決定發布節奏；Burn rate 多視窗告警。',
    '事故：分級 → 指派 IC → 先止血 → 確認恢復 → Blameless Postmortem（含負責人與期限的改進項目）。'
  ]
});
