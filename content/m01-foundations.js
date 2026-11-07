Course.register({
  id: 'm01', num: '01', title: 'Foundations', zh: 'API 基礎',
  intro: '在設計任何 API 之前，先搞懂一個請求從客戶端出發、穿過網路、抵達伺服器再回來的每一步。這些基礎決定了你之後排查效能與錯誤的能力。',
  goals: [
    '用「契約」的角度解釋什麼是 API，並分辨不同類型的 API',
    '讀懂 HTTP 請求與回應的結構，說出 HTTP/1.1、HTTP/2、HTTP/3 的差異',
    '說明 DNS、TCP、TLS 各自負責什麼，以及它們如何影響延遲',
    '描述一個 API 請求在伺服器內部經過的完整生命週期',
    '避開 JSON 序列化的常見陷阱（時間、精度、金額）'
  ],
  lessons: [
    {
      id: 'what-is-api', title: 'What is an API?', zh: '什麼是 API？',
      html: `
<p><b>API（Application Programming Interface）</b>是兩個軟體之間約定好的溝通方式：可以呼叫什麼、要提供什麼資料、會得到什麼結果、出錯時怎麼表示。把它想成一份<b>契約</b>最貼切——提供者承諾「你這樣問，我就這樣答」，使用者則依賴這份承諾寫程式。</p>
${table(['類型', '溝通方式', '例子'], [
  ['Library API', '同一個程式內的函式呼叫', 'Python 的 <code>json.loads()</code>'],
  ['OS API', '程式呼叫作業系統', '開檔、建立網路連線（system call）'],
  ['Web API', '透過網路（通常是 HTTP）呼叫遠端服務', '天氣、金流、LLM API']
])}
<p>這門課談的是 <b>Web API</b>。依使用對象又可分成三種：</p>
<ul>
  <li><b>Public API</b>：開放給任何開發者，例如 GitHub API。相容性要求最高。</li>
  <li><b>Partner API</b>：只給合作夥伴，例如金流商提供給特約商店的 API。</li>
  <li><b>Internal API</b>：公司內部服務之間互相呼叫，例如訂單服務呼叫庫存服務。</li>
</ul>
${code('http', String.raw`
GET /v1/weather?city=Taipei HTTP/1.1
Host: api.example.com
Accept: application/json

HTTP/1.1 200 OK
Content-Type: application/json

{"city": "Taipei", "temp_c": 27.5, "condition": "cloudy"}
`, '一次 Web API 呼叫：請求與回應')}
${note('tip', '一旦有人依賴你的 API，它就是契約。改欄位名稱、改型別、改錯誤格式都可能讓別人的程式壞掉——這是模組 03 與 14 的主題。')}
`,
      qa: [
        ['API 和「網站後端」有什麼不同？', '<p>網站後端可能直接產生 HTML 給瀏覽器看；API 則回傳結構化資料（如 JSON）給「程式」使用。同一個後端可以同時服務網頁、手機 App 與第三方系統，這正是把功能設計成 API 的價值：一份邏輯、多種客戶端。</p>']
      ]
    },
    {
      id: 'http', title: 'HTTP / HTTPS', zh: '超文本傳輸協定',
      html: `
<p>HTTP 是 Web API 的共同語言。一個請求由三部分組成：<b>請求行</b>（方法、路徑、版本）、<b>Header</b>（中繼資料）、<b>Body</b>（內容，可省略）。回應則是<b>狀態行</b>、Header 與 Body。</p>
${code('http', String.raw`
POST /v1/orders HTTP/1.1
Host: api.shop.example
Content-Type: application/json
Authorization: Bearer eyJhbGciOi...
Content-Length: 46

{"product_id": "p_123", "quantity": 2}

HTTP/1.1 201 Created
Content-Type: application/json
Location: /v1/orders/ord_789

{"id": "ord_789", "status": "pending"}
`, '請求（上）與回應（下）')}
<h3>常見 Header</h3>
${table(['Header', '方向', '用途'], [
  ['<code>Content-Type</code>', '雙向', 'Body 的格式，例如 <code>application/json</code>'],
  ['<code>Accept</code>', '請求', '客戶端希望拿到的格式'],
  ['<code>Authorization</code>', '請求', '身分憑證，例如 <code>Bearer &lt;token&gt;</code>'],
  ['<code>Cache-Control</code>', '雙向', '快取規則（模組 09）'],
  ['<code>Location</code>', '回應', '新建資源的位址，常搭配 201'],
  ['<code>Retry-After</code>', '回應', '告訴客戶端多久後再試，常搭配 429 / 503']
])}
<h3>HTTP 版本演進</h3>
${table(['版本', '傳輸層', '重點改進', '仍存在的問題'], [
  ['HTTP/1.1', 'TCP', 'Keep-Alive 連線重用', '一條連線同時只能處理一個請求（排隊）'],
  ['HTTP/2', 'TCP', '多工（多個請求共用一條連線）、Header 壓縮', 'TCP 層掉一個封包，全部請求一起等'],
  ['HTTP/3', 'QUIC（UDP）', '每個串流獨立，掉包不互相影響；交握更快', '部分企業網路會擋 UDP']
])}
<p><b>HTTPS</b> = HTTP + TLS，提供三個保證：<b>加密</b>（別人看不到內容）、<b>完整性</b>（內容沒被竄改）、<b>身分驗證</b>（你連到的真的是該網域的伺服器）。今天所有對外 API 都應該只提供 HTTPS。</p>
`,
      qa: [
        ['HTTP/2 解決了什麼問題？HTTP/3 為什麼改用 UDP？', '<p>HTTP/1.1 一條連線一次只能處理一個請求，瀏覽器只好開很多條連線。HTTP/2 用多工讓多個請求共用一條 TCP 連線，但 TCP 保證順序，一個封包遺失會讓同連線上所有串流一起等待（head-of-line blocking）。HTTP/3 改用基於 UDP 的 QUIC，在使用者空間自己實作可靠傳輸，每個串流獨立重傳，且把傳輸與加密交握合併，建立連線更快。</p>']
      ]
    },
    {
      id: 'tcp-tls-dns', title: 'TCP / TLS / DNS', zh: '網路底層三兄弟',
      html: `
<p>在 HTTP 請求真正送出之前，還有三件事要先完成：</p>
${flow(['DNS：網域 → IP', 'TCP：建立可靠連線', 'TLS：協商加密', 'HTTP：送出請求'])}
<h3>DNS — 找到伺服器在哪</h3>
<p>依序查詢：瀏覽器快取 → 作業系統快取 → 遞迴解析器（ISP 或 8.8.8.8）→ 根伺服器 → 頂級網域（.com）→ 權威伺服器。結果會依 <b>TTL</b> 快取。常見紀錄：<code>A</code>（IPv4）、<code>AAAA</code>（IPv6）、<code>CNAME</code>（別名）、<code>TXT</code>（驗證用文字）。</p>
<h3>TCP — 可靠、有序的連線</h3>
<p>三向交握：<code>SYN</code> → <code>SYN-ACK</code> → <code>ACK</code>，花費 <b>1 個 RTT</b>（往返時間）才能開始傳資料。TCP 負責重傳遺失的封包並保證順序。新連線還有「慢啟動」，一開始傳輸速度較慢。</p>
<h3>TLS — 加密與身分驗證</h3>
<p>TLS 1.3 交握只需 <b>1 個 RTT</b>（TLS 1.2 需要 2 個）。過程中伺服器出示憑證，客戶端驗證憑證鏈是否由信任的 CA 簽發、網域是否相符。TLS 1.3 還支援 0-RTT 恢復連線，但 0-RTT 資料可能被重放，只適合冪等請求。</p>
${code('bash', String.raw`
# 查 DNS
dig api.github.com +short

# 拆解一次 HTTPS 請求的耗時（單位：秒，皆為從開始起算的累計時間）
curl -o /dev/null -s -w "dns=%{time_namelookup} tcp=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total}\n" https://api.github.com
`, '親手量測每個階段')}
${note('tip', '新連線光是 TCP + TLS 1.3 就要 2 個 RTT。若伺服器在美國（RTT 約 150ms），還沒送出請求就先花了 300ms。這就是為什麼<b>連線重用</b>（模組 09）與 CDN 如此重要。')}
`,
      qa: [
        ['在瀏覽器輸入網址按 Enter 之後發生了什麼？', '<ol><li>解析 URL，查 DNS 取得 IP（逐層快取）。</li><li>與該 IP 建立 TCP 連線（三向交握）。</li><li>TLS 交握：驗證憑證、協商金鑰。</li><li>送出 HTTP 請求；途中可能經過 CDN、負載平衡器、反向代理。</li><li>應用程式處理請求（驗證、查資料庫…）並回應。</li><li>瀏覽器解析回應；若是 HTML 會再發出更多請求取得 CSS / JS / 圖片。</li></ol><p>面試時能說出每一步可能的耗時與快取點，會比只列步驟更加分。</p>']
      ]
    },
    {
      id: 'lifecycle', title: 'Request & Response Lifecycle', zh: '請求與回應的生命週期',
      html: `
<p>請求抵達你的系統後，通常會經過這些層：</p>
${flow(['負載平衡器', '反向代理（TLS 終止）', 'ASGI 伺服器（Uvicorn）', 'Middleware（日誌、認證、CORS）', '路由', '驗證輸入', 'Handler → Service → DB', '序列化回應'])}
<p>回應再沿原路返回，Middleware 有機會加上 Header、記錄耗時。理解這條路徑，才能判斷「慢」或「錯」發生在哪一層。</p>
${code('python', String.raw`
import time
import uuid
from fastapi import FastAPI, Request

app = FastAPI()

@app.middleware("http")
async def request_context(request: Request, call_next):
    # 每個請求一個 ID，方便在日誌中串起整條路徑
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    start = time.perf_counter()
    response = await call_next(request)          # 交給後面的路由與 handler
    elapsed_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Request-ID"] = request_id
    response.headers["Server-Timing"] = f"app;dur={elapsed_ms:.1f}"
    return response

@app.get("/v1/health")
async def health():
    return {"status": "ok"}
`, 'FastAPI middleware：加上 Request ID 與處理耗時')}
<h3>延遲從哪裡來？</h3>
${table(['來源', '典型量級', '改善方向'], [
  ['網路往返（RTT）', '1–200 ms', 'CDN、就近部署、連線重用'],
  ['排隊等待', '0 – 數秒', '擴充容量、限流、背壓'],
  ['應用程式邏輯', '1–50 ms', 'Profiling、避免同步阻塞'],
  ['資料庫查詢', '1–500 ms', '索引、減少 N+1、快取'],
  ['呼叫外部 API', '50 ms – 數十秒（LLM）', '逾時、非同步、串流、快取'],
  ['序列化', '通常 < 5 ms', '大型回應才需要在意']
])}
`,
      qa: [
        ['使用者回報 API 變慢，你會怎麼排查？', '<p>先確認範圍：所有端點還是特定端點？所有使用者還是特定地區？從什麼時候開始？接著看指標：p50 與 p99 延遲、錯誤率、流量是否變化。再用分散式追蹤（模組 13）找出時間花在哪一段——資料庫、外部呼叫還是應用程式本身。最後對照當時的部署或設定變更。重點是<b>用資料縮小範圍</b>，而不是憑感覺猜。</p>']
      ]
    },
    {
      id: 'json', title: 'JSON / Serialization', zh: '資料格式與序列化',
      html: `
<p><b>序列化</b>是把程式中的物件轉成可以傳輸的位元組；反序列化則相反。JSON 因為人類可讀、各語言都支援，成為 Web API 的預設格式，但它有幾個必須知道的陷阱：</p>
${table(['陷阱', '問題', '建議做法'], [
  ['沒有日期型別', '各自用不同格式，時區混亂', 'ISO 8601 並帶時區，統一 UTC：<code>"2026-11-07T08:30:00Z"</code>'],
  ['數字精度', 'JavaScript 的 Number 只能精確表示到 2<sup>53</sup>', '64 位元 ID 用字串傳：<code>"id": "9007199254740993"</code>'],
  ['金額', '浮點數 0.1 + 0.2 ≠ 0.3', '用最小單位整數（分）或十進位字串，並附幣別'],
  ['二進位資料', 'JSON 不能直接放', 'Base64 編碼，或改提供下載網址'],
  ['命名風格', 'snake_case 與 camelCase 混用', '整個 API 選一種並寫進規範']
])}
${code('python', String.raw`
from datetime import datetime, timezone
from decimal import Decimal
from pydantic import BaseModel

class Money(BaseModel):
    amount: Decimal          # 用 Decimal，不用 float
    currency: str            # ISO 4217，例如 "TWD"

class Order(BaseModel):
    id: str                  # 長整數 ID 以字串輸出
    total: Money
    created_at: datetime

order = Order(
    id="9007199254740993",
    total=Money(amount=Decimal("1299.50"), currency="TWD"),
    created_at=datetime.now(timezone.utc),
)
print(order.model_dump_json())
# {"id":"9007199254740993","total":{"amount":"1299.50","currency":"TWD"},"created_at":"2026-11-07T08:30:00.123456Z"}
`, '用 Pydantic 正確序列化時間與金額')}
<h3>JSON 以外的選擇</h3>
${table(['格式', '可讀性', '大小／速度', '需要 Schema', '常見用途'], [
  ['JSON', '高', '中', '否', '對外 REST API'],
  ['Protocol Buffers', '低（二進位）', '小／快', '是（.proto）', 'gRPC、內部服務'],
  ['MessagePack', '低', '小／快', '否', '快取、即時通訊']
])}
`,
      qa: [
        ['為什麼訂單 ID 有時候要用字串傳，而不是數字？', '<p>JSON 本身沒有限制數字大小，但 JavaScript 用 IEEE 754 雙精度浮點數表示數字，只能精確表示到 2<sup>53</sup>−1。若後端用 64 位元整數（例如 Snowflake ID），前端解析後最後幾位數會被改掉，造成查不到資料。用字串傳就沒有這個問題，ID 本來也不需要做數學運算。</p>']
      ]
    },
    {
      id: 'principles', title: 'API Design Principles', zh: 'API 設計原則',
      html: `
<p>好的 API 讓使用者「猜得到」它怎麼運作。以下原則會貫穿整門課：</p>
<ul>
  <li><b>一致性</b>：命名、分頁、錯誤格式在所有端點都一樣。學會一個，就會全部。</li>
  <li><b>可預測</b>：同樣的輸入得到同樣的結果；副作用清楚標示。</li>
  <li><b>由外而內（Outside-in）</b>：從使用者要完成的任務出發，而不是直接暴露資料庫結構。</li>
  <li><b>明確的錯誤</b>：告訴使用者錯在哪、怎麼修，而不是只回 500。</li>
  <li><b>安全的預設值</b>：預設最小權限、分頁有上限、敏感欄位預設不回傳。</li>
  <li><b>可演進</b>：從第一天就考慮版本與相容性。</li>
</ul>
${table(['不好的設計', '比較好的設計', '原因'], [
  ['<code>POST /getUserOrders</code>', '<code>GET /users/{id}/orders</code>', '用 HTTP 方法表達動作，URI 表達資源'],
  ['有的端點回 <code>userId</code>，有的回 <code>user_id</code>', '全部統一 <code>user_id</code>', '一致性'],
  ['錯誤時回 200 + <code>{"success": false}</code>', '回 4xx / 5xx + 結構化錯誤', '讓客戶端與監控系統能正確判斷'],
  ['列表一次回傳全部資料', '預設分頁、限制最大筆數', '保護伺服器，回應時間可預期'],
  ['回傳資料表的所有欄位', '只回傳客戶端需要的欄位', '避免洩漏內部資料，降低耦合']
])}
${note('info', '<b>API First</b>：先寫 API 規格（OpenAPI）並與使用者討論，確認後才開始實作。前後端可以同時開工，也能更早發現設計問題。')}
`,
      qa: [
        ['你怎麼判斷一個 API 設計得好不好？', '<p>從使用者的角度看：(1) 新手能否在不看太多文件的情況下猜出用法（一致性與命名）；(2) 出錯時能否從錯誤訊息知道怎麼修；(3) 完成一個常見任務需要呼叫幾次；(4) 未來新增功能時是否不必破壞現有使用者；(5) 是否有安全的預設值。可以舉自己設計過或用過的 API 為例說明。</p>']
      ]
    }
  ],
  labs: [
    {
      title: '請求生命週期瀑布圖',
      desc: '調整網路與伺服器條件，看一次 HTTPS 請求的時間花在哪裡。試試把「連線狀態」改成重用既有連線，比較差異。（簡化模型：DNS 以 1 個 RTT 估算，忽略 TCP 慢啟動。）',
      render(root) {
        const { range, fmt } = Course.ui;
        root.innerHTML = `
<div class="controls">
  ${range('rtt', '網路往返時間 RTT', 10, 300, 5, 80, ' ms')}
  ${range('server', '伺服器處理時間', 5, 1000, 5, 120, ' ms')}
  ${range('size', '回應大小', 1, 2000, 1, 50, ' KB')}
  ${range('bw', '下載頻寬', 1, 100, 1, 20, ' Mbps')}
  <label class="fld"><span>TLS 版本</span><select name="tls"><option value="1">TLS 1.3（1 個 RTT）</option><option value="2">TLS 1.2（2 個 RTT）</option></select></label>
  <label class="fld"><span>連線狀態</span><select name="conn"><option value="new">全新連線（需查 DNS）</option><option value="dns">全新連線（DNS 已快取）</option><option value="reuse">重用既有連線（Keep-Alive）</option></select></label>
</div>
<div class="bars"></div>
<div class="kpis"></div>
<div class="out insight"></div>`;
        const val = n => +root.querySelector('[name=' + n + ']').value;
        const calc = () => {
          const rtt = val('rtt'), conn = root.querySelector('[name=conn]').value;
          const phases = [
            ['DNS 查詢', conn === 'new' ? rtt : 0],
            ['TCP 交握', conn === 'reuse' ? 0 : rtt],
            ['TLS 交握', conn === 'reuse' ? 0 : rtt * val('tls')],
            ['等待首位元組', rtt + val('server')],
            ['下載內容', val('size') * 8 / val('bw')]
          ];
          const total = phases.reduce((a, p) => a + p[1], 0);
          let t = 0;
          root.querySelector('.bars').innerHTML = phases.map(([name, d]) => {
            const left = t / total * 100, w = Math.max(d / total * 100, d ? 0.6 : 0);
            t += d;
            return '<div class="bar-row"><span>' + name + '</span><span class="bar-track"><span class="bar-fill" style="left:' + left + '%;width:' + w + '%"></span></span><span class="bar-val">' + fmt(d) + ' ms</span></div>';
          }).join('');
          const setup = phases[0][1] + phases[1][1] + phases[2][1];
          root.querySelector('.kpis').innerHTML =
            '<div class="kpi"><b>' + fmt(total) + ' ms</b><span>總耗時</span></div>' +
            '<div class="kpi"><b>' + fmt(setup) + ' ms</b><span>建立連線（DNS+TCP+TLS）</span></div>' +
            '<div class="kpi"><b>' + fmt(setup / total * 100) + '%</b><span>花在建立連線的比例</span></div>';
          root.querySelector('.insight').innerHTML = setup / total > 0.4
            ? '超過 4 成時間花在<b>建立連線</b>。對策：重用連線（Keep-Alive、HTTP 連線池）、使用 TLS 1.3、把服務部署得離使用者更近（CDN / 邊緣節點）。'
            : (val('server') / total > 0.5 ? '大部分時間花在<b>伺服器處理</b>。對策：Profiling 找出慢的程式碼、加索引、加快取，或把耗時工作改成非同步。' : '時間分布相對平均。可以試著把 RTT 調高，模擬跨國使用者。');
        };
        root.addEventListener('input', calc);
        calc();
      }
    }
  ],
  quiz: [
    { q: '使用 TLS 1.3 建立全新的 HTTPS 連線，在送出第一個 HTTP 請求之前，至少需要幾個 RTT（不計 DNS）？', options: ['0 個', '1 個', '2 個', '3 個'], answer: 2, explain: 'TCP 三向交握 1 個 RTT，加上 TLS 1.3 交握 1 個 RTT，共 2 個。TLS 1.2 則需要 3 個。' },
    { q: '哪一個 HTTP 版本建立在 QUIC（UDP）之上？', options: ['HTTP/1.0', 'HTTP/1.1', 'HTTP/2', 'HTTP/3'], answer: 3, explain: 'HTTP/3 使用 QUIC，解決了 TCP 層的 head-of-line blocking，並把傳輸與加密交握合併。' },
    { q: '後端使用 64 位元整數作為訂單 ID，為什麼常以字串放進 JSON？', options: ['字串比數字更省空間', 'JavaScript 的 Number 只能精確表示到 2^53，大數字會失真', 'JSON 規格不允許超過 10 位數的數字', '資料庫只能輸出字串'], answer: 1, explain: 'JSON 規格沒有限制數字大小，但 JavaScript 用雙精度浮點數解析，超過 2^53 會損失精度。' },
    { q: '下列哪一項<b>不是</b> HTTPS 提供的保證？', options: ['傳輸內容加密', '內容未被竄改', '確認伺服器擁有該網域', '伺服器程式沒有安全漏洞'], answer: 3, explain: 'TLS 保護的是傳輸過程。應用程式本身的漏洞（例如 SQL Injection）仍需要另外防護，見模組 05。' },
    { q: '客戶端要告訴伺服器「我送出的 Body 是 JSON」，應該設定哪個 Header？', options: ['Content-Type: application/json', 'Accept: application/json', 'Authorization: application/json', 'Cache-Control: json'], answer: 0, explain: 'Content-Type 描述「這份 Body 是什麼格式」；Accept 則是「我希望收到什麼格式」。' },
    { q: 'API 回傳時間欄位時，最好的做法是？', options: ['回傳伺服器所在地的當地時間字串', '回傳 ISO 8601 格式並帶時區，例如 2026-11-07T08:30:00Z', '回傳「3 分鐘前」這種相對時間', '依使用者語系回傳不同格式'], answer: 1, explain: 'ISO 8601 + 時區（建議統一 UTC）讓所有客戶端都能正確解析，顯示格式交給前端依使用者時區處理。' }
  ],
  sheet: [
    'API 是契約：一旦有人使用，任何改動都要考慮相容性。',
    'HTTP 請求 = 請求行 + Header + Body；回應 = 狀態行 + Header + Body。',
    'HTTP/2 用多工共用連線；HTTP/3 改用 QUIC（UDP）避免 TCP 的隊頭阻塞。',
    '新 HTTPS 連線：DNS +（TCP 1 RTT）+（TLS 1.3 1 RTT），連線重用能省下大量延遲。',
    '用 <code>curl -w</code> 可以拆解 DNS、TCP、TLS、TTFB 各階段耗時。',
    '每個請求帶 Request ID，日誌與追蹤才串得起來。',
    'JSON 陷阱：時間用 ISO 8601 + UTC、大整數 ID 用字串、金額不用浮點數。',
    '設計原則：一致、可預測、由外而內、明確錯誤、安全預設、可演進。'
  ]
});
