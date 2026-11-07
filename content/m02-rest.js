Course.register({
  id: 'm02', num: '02', title: 'REST API Design', zh: 'REST API 設計',
  intro: 'REST 是目前最普遍的 Web API 風格。這個模組教你把業務需求轉成資源、選對 HTTP 方法與狀態碼，並處理分頁、冪等與版本這些每個正式 API 都會遇到的問題。',
  goals: [
    '說明 REST 的核心約束，以及為什麼「無狀態」很重要',
    '把業務需求建模成資源與 URI',
    '正確使用 HTTP 方法與狀態碼，知道哪些方法是安全、哪些是冪等',
    '實作 Cursor 分頁、Idempotency-Key 與 API 版本策略'
  ],
  lessons: [
    {
      id: 'rest-architecture', title: 'REST Architecture', zh: 'REST 架構風格',
      html: `
<p><b>REST（Representational State Transfer）</b>是 Roy Fielding 在 2000 年提出的架構風格。它不是協定，而是一組<b>約束</b>：</p>
${table(['約束', '意思', '帶來的好處'], [
  ['Client–Server', '前後端分離，各自演進', '同一個 API 可服務多種客戶端'],
  ['Stateless（無狀態）', '每個請求自帶所有需要的資訊，伺服器不保存對話狀態', '任何一台伺服器都能處理任何請求 → 容易水平擴展'],
  ['Cacheable', '回應要標示能否快取', '減少重複請求、降低延遲'],
  ['Uniform Interface', '用統一的方式操作資源（URI + HTTP 方法 + 表示法）', '學一次就會用全部端點'],
  ['Layered System', '中間可以有代理、閘道、CDN，客戶端不需要知道', '可插入快取、安全層'],
  ['Code on Demand（選用）', '伺服器可傳送程式碼給客戶端執行', '實務上很少用在 API']
])}
<h3>Richardson 成熟度模型</h3>
${table(['等級', '特徵', '例子'], [
  ['Level 0', '一個端點，全部用 POST', '<code>POST /api</code> + <code>{"action": "getUser"}</code>'],
  ['Level 1', '有資源的概念', '<code>POST /users/42</code>'],
  ['Level 2', '資源 + 正確的 HTTP 方法與狀態碼', '<code>GET /users/42</code> → 200 / 404'],
  ['Level 3', '加上 HATEOAS（回應中附帶下一步可用的連結）', '<code>"links": {"cancel": "/orders/7/cancel"}</code>']
])}
${note('tip', '大多數正式 API 做到 Level 2 就很好用了。面試時能說出「為什麼無狀態有利擴展」比背出六個約束更重要。')}
`,
      qa: [
        ['REST 的「無狀態」是指伺服器不能有資料庫嗎？', '<p>不是。無狀態指的是<b>對話狀態</b>（session state）不保存在處理請求的那台伺服器記憶體裡；每個請求要自帶身分憑證與必要參數。資源狀態（資料庫裡的訂單）當然存在。這樣負載平衡器可以把請求丟給任何一台伺服器，某台掛掉也不會遺失使用者的登入狀態。</p>']
      ]
    },
    {
      id: 'resource-modeling', title: 'Resource Modeling', zh: '資源建模',
      html: `
<p>REST 的核心是<b>資源</b>（名詞），而不是動作（動詞）。建模步驟：</p>
<ol>
  <li>列出使用者要完成的任務（例如「下訂單」「查物流」）。</li>
  <li>找出其中的名詞：使用者、商品、訂單、付款、出貨。</li>
  <li>決定資源之間的關係（一對多、多對多）。</li>
  <li>決定哪些是<b>獨立資源</b>、哪些是<b>子資源</b>。</li>
</ol>
${table(['情境', '建議', '理由'], [
  ['訂單的明細項目', '<code>/orders/{id}/items</code>（子資源）', '明細離開訂單就沒有意義'],
  ['使用者的訂單', '<code>/orders?user_id=42</code> 或 <code>/users/42/orders</code>', '訂單本身是獨立資源，兩種都常見，選一種保持一致'],
  ['「取消訂單」這種動作', '<code>POST /orders/{id}/cancel</code> 或 <code>PATCH /orders/{id}</code> + <code>{"status": "cancelled"}</code>', '狀態轉換有業務規則時，用動作子資源更清楚'],
  ['搜尋', '<code>GET /products?q=keyboard</code>', '搜尋是對集合的篩選']
])}
${note('warn', '不要把資料表直接變成 API。資料庫可能有 <code>order_line_tmp</code>、<code>user_profile_ext</code> 這類內部結構；API 應該反映使用者看到的概念，內部重構時 API 才不必跟著改。')}
${code('json', String.raw`
{
  "id": "ord_789",
  "status": "paid",
  "customer": {"id": "usr_42", "name": "王小明"},
  "items": [
    {"product_id": "p_123", "name": "機械鍵盤", "quantity": 1, "unit_price": {"amount": "2490", "currency": "TWD"}}
  ],
  "total": {"amount": "2490", "currency": "TWD"},
  "created_at": "2026-11-07T08:30:00Z"
}
`, '一個訂單資源的表示法（Representation）')}
`,
      qa: [
        ['「取消訂單」該怎麼設計？用 DELETE 可以嗎？', '<p>通常不建議用 DELETE。取消後訂單仍然存在（要保留紀錄、可能要退款），只是狀態改變。兩種常見做法：(1) <code>POST /orders/{id}/cancel</code>，把它當成一個有業務規則的動作，可附上取消原因；(2) <code>PATCH /orders/{id}</code> 更新狀態。若取消涉及退款、庫存回補等流程，第一種語意更清楚，也比較好做權限控管。</p>']
      ]
    },
    {
      id: 'methods-status', title: 'HTTP Methods & Status Codes', zh: 'HTTP 方法與狀態碼',
      html: `
${table(['方法', '用途', '安全（不改變資源）', '冪等（重複執行結果相同）'], [
  ['<code>GET</code>', '讀取資源', '是', '是'],
  ['<code>POST</code>', '建立資源、執行動作', '否', '<b>否</b>'],
  ['<code>PUT</code>', '完整取代資源', '否', '是'],
  ['<code>PATCH</code>', '部分更新', '否', '不一定（看設計）'],
  ['<code>DELETE</code>', '刪除資源', '否', '是'],
  ['<code>HEAD</code> / <code>OPTIONS</code>', '只取 Header／查詢可用方法（CORS 預檢）', '是', '是']
])}
<p><b>冪等</b>的意思是：同一個請求送一次或送十次，伺服器的最終狀態相同。網路逾時後，客戶端可以安心重送冪等請求；POST 則需要額外的 Idempotency-Key（本模組第 6 節）。</p>
<h3>最常用的狀態碼</h3>
${table(['狀態碼', '意義', '使用時機'], [
  ['200 OK', '成功', 'GET、PUT、PATCH 成功並回傳內容'],
  ['201 Created', '已建立', 'POST 建立資源，搭配 <code>Location</code> Header'],
  ['202 Accepted', '已接受，稍後處理', '非同步任務（模組 09、15）'],
  ['204 No Content', '成功但沒有內容', 'DELETE 成功'],
  ['400 Bad Request', '請求格式錯誤', 'JSON 解析失敗、參數型別錯'],
  ['401 Unauthorized', '未認證', '沒帶 Token 或 Token 無效'],
  ['403 Forbidden', '已認證但無權限', '一般使用者想刪別人的資料'],
  ['404 Not Found', '資源不存在', '也可用來隱藏「存在但你無權看」的資源'],
  ['409 Conflict', '與目前狀態衝突', 'Email 已註冊、版本衝突'],
  ['422 Unprocessable Content', '格式正確但內容不合法', '欄位驗證失敗（FastAPI 預設）'],
  ['429 Too Many Requests', '超過限流', '搭配 <code>Retry-After</code>'],
  ['500 / 502 / 503 / 504', '伺服器端錯誤', '程式錯誤／上游錯誤／暫時無法服務／上游逾時']
])}
${code('python', String.raw`
from fastapi import FastAPI, HTTPException, Response, status

app = FastAPI()

@app.post("/v1/orders", status_code=status.HTTP_201_CREATED)
async def create_order(body: CreateOrder, response: Response):
    order = await orders.create(body)
    response.headers["Location"] = f"/v1/orders/{order.id}"
    return order

@app.delete("/v1/orders/{order_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_item(order_id: str, item_id: str):
    if not await orders.remove_item(order_id, item_id):
        raise HTTPException(status_code=404, detail="item not found")
`, 'FastAPI：回傳正確的狀態碼')}
`,
      qa: [
        ['401 和 403 有什麼差別？', '<p>401 表示「我不知道你是誰」——沒帶憑證或憑證無效，客戶端應該去登入或更新 Token。403 表示「我知道你是誰，但你不能做這件事」——重新登入也沒用。另外，有些 API 對「存在但無權存取」的資源刻意回 404，避免洩漏資源是否存在。</p>']
      ]
    },
    {
      id: 'uri-design', title: 'URI Design', zh: 'URI 設計',
      html: `
<ul>
  <li><b>用名詞複數</b>：<code>/orders</code>、<code>/orders/{id}</code></li>
  <li><b>小寫、用連字號</b>：<code>/shipping-addresses</code>，不要 <code>/ShippingAddresses</code></li>
  <li><b>巢狀不超過兩層</b>：<code>/orders/{id}/items</code> 可以；<code>/users/{u}/orders/{o}/items/{i}/reviews</code> 太深，改成 <code>/reviews?item_id=...</code></li>
  <li><b>動作放在 HTTP 方法</b>：不要 <code>/createOrder</code>、<code>/orders/delete</code></li>
  <li><b>篩選、排序、分頁放 Query String</b>：<code>/orders?status=paid&amp;sort=-created_at&amp;limit=20</code></li>
  <li><b>不要暴露實作細節</b>：不要 <code>/api/orders.php</code>、<code>/orders_table</code></li>
  <li><b>ID 用不可猜測的格式</b>：<code>ord_7Gx2...</code> 或 UUID，避免列舉攻擊（模組 05 的 BOLA）</li>
</ul>
${table(['❌ 避免', '✅ 建議'], [
  ['<code>GET /getAllUsers</code>', '<code>GET /users</code>'],
  ['<code>POST /users/42/delete</code>', '<code>DELETE /users/42</code>'],
  ['<code>GET /user/42</code>（單數）', '<code>GET /users/42</code>'],
  ['<code>GET /orders?page=2&amp;Page_Size=10</code>', '<code>GET /orders?cursor=abc&amp;limit=10</code>'],
  ['<code>GET /v1/users/42/orders/7/items/3/product</code>', '<code>GET /v1/products/{product_id}</code>']
])}
`,
      qa: [
        ['在 URI 中放動詞一定是錯的嗎？', '<p>不一定。當操作不是單純的 CRUD，而是有業務意義的動作（取消、核准、重新寄送驗證信），用 <code>POST /orders/{id}/cancel</code> 這種「控制器資源」是被廣泛接受的做法，Google 的 API 設計指南也有類似的 custom method（<code>POST /orders/{id}:cancel</code>）。重點是全 API 保持一致。</p>']
      ]
    },
    {
      id: 'pagination', title: 'Pagination / Filtering / Sorting', zh: '分頁、篩選與排序',
      html: `
<p>任何列表端點都要分頁，否則資料一多就會拖垮資料庫與客戶端。兩種主流做法：</p>
${table(['', 'Offset 分頁', 'Cursor（Keyset）分頁'], [
  ['參數', '<code>?offset=40&amp;limit=20</code>', '<code>?cursor=eyJpZCI6MTIzfQ&amp;limit=20</code>'],
  ['SQL', '<code>OFFSET 40 LIMIT 20</code>', '<code>WHERE (created_at, id) &lt; (:t, :id) LIMIT 20</code>'],
  ['跳到第 N 頁', '可以', '不行（只能上一頁／下一頁）'],
  ['深分頁效能', '差：資料庫要先掃過前面所有資料', '好：直接用索引定位'],
  ['資料變動時', '可能重複或漏資料', '穩定'],
  ['適合', '後台管理、資料量小', '動態牆、大型列表、對外 API']
])}
${code('python', String.raw`
import base64, json
from datetime import datetime
from fastapi import Query

def encode_cursor(created_at: datetime, id_: int) -> str:
    raw = json.dumps({"t": created_at.isoformat(), "id": id_}).encode()
    return base64.urlsafe_b64encode(raw).decode()

def decode_cursor(cursor: str) -> tuple[datetime, int]:
    data = json.loads(base64.urlsafe_b64decode(cursor.encode()))
    return datetime.fromisoformat(data["t"]), data["id"]

@app.get("/v1/orders")
async def list_orders(cursor: str | None = None, limit: int = Query(20, ge=1, le=100)):
    sql = "SELECT * FROM orders"
    params: dict = {"limit": limit + 1}              # 多拿一筆，用來判斷有沒有下一頁
    if cursor:
        t, last_id = decode_cursor(cursor)
        sql += " WHERE (created_at, id) < (:t, :id)"
        params |= {"t": t, "id": last_id}
    sql += " ORDER BY created_at DESC, id DESC LIMIT :limit"
    rows = await db.fetch_all(sql, params)

    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = encode_cursor(rows[-1]["created_at"], rows[-1]["id"]) if has_more else None
    return {"data": rows, "next_cursor": next_cursor}
`, 'Cursor 分頁實作（需要 (created_at, id) 複合索引）')}
<h3>篩選與排序慣例</h3>
<ul>
  <li>篩選：<code>?status=paid&amp;created_after=2026-01-01T00:00:00Z</code></li>
  <li>排序：<code>?sort=-created_at,name</code>（負號表示遞減），並用<b>白名單</b>限制可排序欄位</li>
  <li><code>limit</code> 一定要有上限（例如 100），防止一次撈出百萬筆</li>
</ul>
`,
      qa: [
        ['為什麼大型列表要用 Cursor 分頁而不是 Offset？', '<p>Offset 分頁在 <code>OFFSET 100000</code> 時，資料庫仍要掃描並丟棄前十萬筆，越後面越慢；而且如果使用者翻頁時有新資料插入，會看到重複或漏掉的資料。Cursor 分頁記住「上一頁最後一筆的排序鍵」，下一頁直接用 <code>WHERE (created_at, id) &lt; ...</code> 走索引，效能穩定且不受新資料影響。代價是不能直接跳到第 N 頁。排序鍵要加上唯一的 id 作為 tie-breaker，否則同時間的資料會被漏掉。</p>']
      ]
    },
    {
      id: 'idempotency', title: 'Idempotency', zh: '冪等性設計',
      html: `
<p>情境：客戶端送出「付款 1000 元」，網路逾時沒收到回應。它該重送嗎？如果第一次其實成功了，重送就會<b>重複扣款</b>。解法是 <b>Idempotency-Key</b>：</p>
${flow(['客戶端產生唯一 key（UUID）', '每次重送都帶同一個 key', '伺服器第一次處理並保存結果', '之後收到同 key → 直接回傳保存的結果'])}
${code('http', String.raw`
POST /v1/payments HTTP/1.1
Idempotency-Key: 8e03978e-40d5-43e8-bc93-6894a57f9324
Content-Type: application/json

{"order_id": "ord_789", "amount": "1000", "currency": "TWD"}
`)}
${code('python', String.raw`
import hashlib, json
from fastapi import Header, HTTPException, Request

async def create_payment(request: Request, body: PaymentIn,
                         idempotency_key: str = Header(..., alias="Idempotency-Key")):
    fingerprint = hashlib.sha256(json.dumps(body.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()

    async with db.transaction():
        # 用唯一鍵搶占這個 key；衝突代表已經有人處理過（或正在處理）
        inserted = await db.execute(
            """INSERT INTO idempotency_keys (key, user_id, fingerprint, status)
               VALUES (:k, :u, :f, 'processing')
               ON CONFLICT (key, user_id) DO NOTHING""",
            {"k": idempotency_key, "u": request.state.user_id, "f": fingerprint})

    if not inserted:
        rec = await db.fetch_one("SELECT * FROM idempotency_keys WHERE key=:k AND user_id=:u",
                                 {"k": idempotency_key, "u": request.state.user_id})
        if rec["fingerprint"] != fingerprint:
            raise HTTPException(422, "Idempotency-Key 已用於不同的請求內容")
        if rec["status"] == "processing":
            raise HTTPException(409, "相同請求仍在處理中，請稍後重試")
        return json.loads(rec["response_body"])          # 回傳第一次的結果

    result = await payments.charge(body)
    await db.execute("UPDATE idempotency_keys SET status='done', response_body=:r WHERE key=:k AND user_id=:u",
                     {"r": json.dumps(result), "k": idempotency_key, "u": request.state.user_id})
    return result
`, 'Idempotency-Key 的伺服器端處理（簡化版）')}
${note('warn', '常見錯誤：(1) key 沒有綁定使用者，不同使用者可能撞 key；(2) 沒有比對請求內容，同一個 key 被拿去送不同金額；(3) 沒設過期時間，表無限長大（通常保存 24 小時～數天）。')}
`,
      qa: [
        ['如何讓 POST 建立訂單變成冪等？', '<p>要求客戶端在請求中帶 <code>Idempotency-Key</code>（客戶端產生的 UUID）。伺服器用 (key, 使用者) 作為唯一鍵存一筆紀錄：第一次收到時標記處理中並執行，完成後保存回應；之後收到相同 key 直接回傳保存的回應；若相同 key 卻是不同請求內容，回 422。要處理「處理中又收到重送」的情況（回 409 或等待），並設定過期清理。這也是 Stripe 等金流 API 的做法。</p>']
      ]
    },
    {
      id: 'versioning', title: 'API Versioning', zh: 'API 版本控制',
      html: `
<p>當你必須做出<b>不相容的變更</b>（移除欄位、改型別、改行為）時，需要版本讓舊客戶端繼續運作。</p>
${table(['策略', '範例', '優點', '缺點'], [
  ['URI 路徑', '<code>/v1/orders</code>', '最直觀、好除錯、好快取', '版本是整個 API 一起升級'],
  ['Header', '<code>API-Version: 2026-11-01</code>', 'URI 乾淨；可用日期做細緻版本', '不易在瀏覽器測試，容易忘記帶'],
  ['Media Type', '<code>Accept: application/vnd.shop.v2+json</code>', '符合 HTTP 語意', '最複雜，工具支援較差'],
  ['Query String', '<code>/orders?version=2</code>', '簡單', '容易和其他參數混在一起，較少用']
])}
<ul>
  <li><b>對外 API</b>：最常見的是 URI 主版本（<code>/v1</code>），或像 Stripe 一樣用日期版本 Header。</li>
  <li><b>只有破壞性變更才升主版本</b>：新增欄位、新增端點不需要升版。</li>
  <li><b>同時維護的版本越少越好</b>：通常最多兩個，舊版要有明確的淘汰時程（模組 14）。</li>
</ul>
${code('python', String.raw`
from fastapi import APIRouter, FastAPI

v1 = APIRouter(prefix="/v1")
v2 = APIRouter(prefix="/v2")

@v1.get("/orders/{order_id}")
async def get_order_v1(order_id: str):
    order = await orders.get(order_id)
    return {"id": order.id, "total": float(order.total)}          # 舊格式：數字

@v2.get("/orders/{order_id}")
async def get_order_v2(order_id: str):
    order = await orders.get(order_id)
    return {"id": order.id, "total": {"amount": str(order.total), "currency": order.currency}}

app = FastAPI()
app.include_router(v1)
app.include_router(v2)
`, '兩個版本共用同一套業務邏輯，只在輸出層轉換')}
`,
      qa: [
        ['什麼情況需要升 API 主版本？', '<p>只有破壞性變更才需要：移除或改名欄位、改變欄位型別或意義、讓原本選填的參數變必填、改變錯誤碼或認證方式、改變預設行為。新增選填參數、新增回應欄位、新增端點都屬於相容變更，不用升版——前提是客戶端被要求「忽略不認識的欄位」。實作上應讓新舊版本共用業務邏輯，只在邊界轉換格式。</p>']
      ]
    }
  ],
  labs: [
    {
      title: 'REST 設計挑戰',
      desc: '針對每個情境，選出最合適的 HTTP 方法、URI 與狀態碼，按「檢查答案」看解析。',
      render(root) {
        const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
        const CODES = ['200', '201', '202', '204', '400', '401', '403', '404', '409', '422', '429'];
        const S = [
          { t: '建立一筆新訂單', m: 'POST', uris: ['/createOrder', '/orders', '/orders/new'], u: 1, c: ['201'], ex: 'POST 到集合建立資源，回 201 並在 Location Header 附上新訂單網址。' },
          { t: '取得使用者 42 的訂單列表下一頁', m: 'GET', uris: ['/getUserOrders?id=42&page=2', '/users/42/orders?cursor=abc&limit=20', '/users/42/orders/page/2'], u: 1, c: ['200'], ex: '讀取用 GET，分頁參數放 Query String，大型列表用 cursor。' },
          { t: '以完整新內容取代商品 7 的資料', m: 'PUT', uris: ['/products/7', '/products/update/7', '/updateProduct?id=7'], u: 0, c: ['200', '204'], ex: 'PUT 是完整取代且冪等；回 200（附新內容）或 204 都可以。' },
          { t: '只修改使用者 42 的 email', m: 'PATCH', uris: ['/users/42/email/update', '/users/42', '/user?id=42'], u: 1, c: ['200'], ex: '部分更新用 PATCH，URI 指向資源本身。' },
          { t: '刪除一則留言，成功後不需要回傳內容', m: 'DELETE', uris: ['/comments/15', '/comments/15/delete', '/deleteComment/15'], u: 0, c: ['204'], ex: 'DELETE 成功且沒有內容時回 204 No Content。' },
          { t: '建立訂單時 quantity 填了 -3（JSON 格式正確）', m: 'POST', uris: ['/orders', '/orders/validate', '/orders/error'], u: 0, c: ['422', '400'], ex: '格式正確但內容不合法，常用 422（FastAPI 預設）；有些 API 統一用 400，兩者都可接受，重點是全 API 一致並附上欄位錯誤細節。' },
          { t: '用已經註冊過的 email 再註冊一次', m: 'POST', uris: ['/users', '/register/user', '/users/42'], u: 0, c: ['409'], ex: '請求與伺服器目前狀態衝突，回 409 Conflict。' },
          { t: '沒有帶 Token 就呼叫「取得我的個人資料」', m: 'GET', uris: ['/me', '/getMe', '/users/me/get'], u: 0, c: ['401'], ex: '未認證回 401，並可附上 <code>WWW-Authenticate</code> Header。' },
          { t: '已登入的一般使用者想刪除別人的訂單', m: 'DELETE', uris: ['/orders/88', '/orders/88/remove', '/admin/deleteOrder/88'], u: 0, c: ['403', '404'], ex: '已認證但無權限回 403；若不想洩漏訂單是否存在，回 404 也是常見且安全的做法。' },
          { t: '使用者一分鐘內打了 500 次 API，超過上限', m: 'GET', uris: ['/products', '/products/limit', '/rate-limit'], u: 0, c: ['429'], ex: '超過限流回 429 Too Many Requests，並附 <code>Retry-After</code> 告訴客戶端何時再試。' }
        ];
        const sel = (name, opts, extra) => '<select name="' + name + '"' + (extra || '') + '><option value="">選擇…</option>' + opts.map((o, i) => '<option value="' + i + '">' + Course.ui.esc(o) + '</option>').join('') + '</select>';
        root.innerHTML = '<div class="classify">' + S.map((s, i) =>
          '<div class="cl-item" data-i="' + i + '"><div class="cl-q"><b>' + (i + 1) + '. ' + s.t + '</b></div>' +
          '<div class="controls" style="margin:0">' +
          '<label class="fld"><span>方法</span>' + sel('m', METHODS) + '</label>' +
          '<label class="fld"><span>URI</span>' + sel('u', s.uris) + '</label>' +
          '<label class="fld"><span>狀態碼</span>' + sel('c', CODES) + '</label></div>' +
          '<div class="cl-explain" hidden></div></div>').join('') +
          '<div class="lab-foot"><span class="score">尚未檢查</span><span class="btn-row" style="margin:0"><button type="button" class="btn primary" data-check>檢查答案</button><button type="button" class="btn ghost" data-reset>清除</button></span></div></div>';
        root.querySelector('[data-check]').onclick = () => {
          let ok = 0, parts = 0;
          S.forEach((s, i) => {
            const item = root.querySelector('.cl-item[data-i="' + i + '"]');
            const get = n => item.querySelector('[name=' + n + ']');
            const m = get('m').value === '' ? '' : METHODS[+get('m').value];
            const u = get('u').value === '' ? -1 : +get('u').value;
            const c = get('c').value === '' ? '' : CODES[+get('c').value];
            const res = [m === s.m, u === s.u, s.c.includes(c)];
            res.forEach(r => { parts++; if (r) ok++; });
            ['m', 'u', 'c'].forEach((n, k) => { get(n).style.borderColor = res[k] ? 'var(--good)' : 'var(--bad)'; });
            const ex = item.querySelector('.cl-explain'); ex.hidden = false;
            ex.innerHTML = (res.every(Boolean) ? '<strong class="good">全對！</strong>' : '<strong class="bad">參考答案：</strong><code>' + s.m + ' ' + Course.ui.esc(s.uris[s.u]) + '</code> → <code>' + s.c.join(' 或 ') + '</code>。') + s.ex;
          });
          root.querySelector('.score').textContent = '答對 ' + ok + ' / ' + parts + ' 個選項';
        };
        root.querySelector('[data-reset]').onclick = () => {
          root.querySelectorAll('select').forEach(s => { s.value = ''; s.style.borderColor = ''; });
          root.querySelectorAll('.cl-explain').forEach(e => { e.hidden = true; });
          root.querySelector('.score').textContent = '尚未檢查';
        };
      }
    }
  ],
  quiz: [
    { q: '下列哪個 HTTP 方法<b>不是</b>冪等的？', options: ['GET', 'PUT', 'DELETE', 'POST'], answer: 3, explain: 'POST 每次執行都可能建立新資源，重送會產生重複資料，因此需要 Idempotency-Key 才能安全重試。' },
    { q: 'REST 的「無狀態」約束最主要帶來什麼好處？', options: ['不需要資料庫', '任何伺服器都能處理任何請求，容易水平擴展', '回應一定可以被快取', '不需要身分驗證'], answer: 1, explain: '對話狀態不存在單台伺服器上，負載平衡器可以自由分配請求，伺服器掛掉也不影響使用者。' },
    { q: '動態牆這種資料持續新增的大型列表，最適合哪種分頁？', options: ['Offset 分頁', 'Cursor（Keyset）分頁', '一次回傳全部資料', '用 page 參數但不限制 limit'], answer: 1, explain: 'Cursor 分頁走索引、效能穩定，資料新增時也不會重複或漏掉。' },
    { q: '已登入的使用者嘗試修改他沒有權限的資源，最恰當的狀態碼是？', options: ['400', '401', '403', '500'], answer: 2, explain: '已認證但無權限是 403；401 是「未認證」。若不想洩漏資源存在，也可回 404。' },
    { q: '客戶端用同一個 Idempotency-Key 重送了<b>金額不同</b>的付款請求，伺服器應該？', options: ['用新金額再扣一次款', '回傳第一次的結果', '拒絕請求（例如回 422），因為 key 已用於不同內容', '忽略 key 照常處理'], answer: 2, explain: '伺服器要比對請求內容的指紋。同 key 不同內容代表客戶端有 bug，應該拒絕而不是猜測意圖。' },
    { q: '下列哪個變更<b>需要</b>升級 API 主版本？', options: ['新增一個選填的查詢參數', '在回應中新增一個欄位', '把 price 欄位從數字改成物件', '新增一個端點'], answer: 2, explain: '改變欄位型別會讓既有客戶端解析失敗，是破壞性變更。其他三項都是相容的新增。' }
  ],
  sheet: [
    'REST 六約束中最關鍵的是無狀態與統一介面；多數 API 做到成熟度 Level 2 即可。',
    '資源是名詞、用複數；動作交給 HTTP 方法；不要把資料表結構直接變成 API。',
    '安全方法：GET、HEAD、OPTIONS；冪等方法：GET、PUT、DELETE（POST 不是）。',
    '201 + Location、204 無內容、401 未認證、403 無權限、409 衝突、422 驗證失敗、429 限流。',
    'URI：小寫、連字號、巢狀不超過兩層，篩選排序分頁放 Query String。',
    'Cursor 分頁：用 (排序鍵, id) 當游標、多拿一筆判斷下一頁、建立複合索引、limit 設上限。',
    'Idempotency-Key：綁定使用者、比對請求指紋、處理「處理中」狀態、設定過期。',
    '只有破壞性變更才升主版本；新舊版本共用業務邏輯，只在邊界轉換格式。'
  ]
});
