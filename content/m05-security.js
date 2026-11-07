Course.register({
  id: 'm05', num: '05', title: 'API Security', zh: 'API 安全',
  intro: '攻擊者不會照著文件呼叫你的 API。本模組逐一拆解最常見的 API 攻擊手法，以及在程式碼、設定與架構層面對應的防禦方式。',
  goals: [
    '正確設定 TLS / mTLS 與安全相關的 HTTP Header',
    '分辨 CORS、CSRF、XSS 三者，並知道各自的防禦方式',
    '選擇合適的限流演算法並以 Redis 實作分散式限流',
    '在程式碼中辨識並修正 SQL Injection、SSRF 與 Mass Assignment',
    '說明 OWASP API Security Top 10 每一項的意義'
  ],
  lessons: [
    {
      id: 'tls-mtls', title: 'TLS / mTLS', zh: '傳輸層安全',
      html: `
<ul>
  <li><b>只允許 TLS 1.2 以上</b>，優先 TLS 1.3；關閉舊的加密套件。</li>
  <li><b>HSTS</b>：<code>Strict-Transport-Security</code> 告訴瀏覽器之後一律用 HTTPS。</li>
  <li><b>憑證自動續期</b>（ACME / Let's Encrypt、雲端憑證服務），並<b>監控到期日</b>——憑證過期是很常見的全站停擺原因。</li>
  <li><b>TLS 終止點</b>：通常在負載平衡器或反向代理；內部流量在零信任架構下也應加密（mTLS）。</li>
</ul>
${code('nginx', String.raw`
server {
    listen 443 ssl;
    http2 on;
    server_name api.shop.example;

    ssl_certificate     /etc/ssl/api.crt;
    ssl_certificate_key /etc/ssl/api.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;

    location / {
        proxy_pass http://app_upstream;
    }
}
`, 'Nginx 的 TLS 與安全 Header 設定')}
<h3>mTLS（雙向 TLS）</h3>
<p>一般 TLS 只有<b>客戶端驗證伺服器</b>。mTLS 讓<b>伺服器也驗證客戶端憑證</b>，適合：B2B 合作夥伴 API（例如銀行間）、內部微服務（Service Mesh 自動處理）、IoT 裝置。</p>
${code('bash', String.raw`
# 檢查伺服器憑證：簽發者、到期日、支援的 TLS 版本
openssl s_client -connect api.shop.example:443 -servername api.shop.example </dev/null 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates

# 使用客戶端憑證呼叫需要 mTLS 的 API
curl --cert client.crt --key client.key https://partner-api.bank.example/v1/transfers
`)}
`,
      qa: [
        ['TLS 在負載平衡器終止後，後端用 HTTP 可以嗎？', '<p>傳統做法認為內網可信，但在零信任原則下不建議：內網一旦有機器被入侵，明文流量（包含 Token、個資）就會被竊聽。建議在負載平衡器終止後重新加密到後端，或用 Service Mesh 自動做 mTLS。至少在合規要求（如 PCI DSS 處理信用卡資料）下，內部傳輸加密通常是必要的。</p>']
      ]
    },
    {
      id: 'cors-csrf-xss', title: 'CORS / CSRF / XSS', zh: '瀏覽器相關的三種威脅',
      html: `
${table(['', 'CORS', 'CSRF', 'XSS'], [
  ['是什麼', '瀏覽器的跨來源存取<b>控制機制</b>（不是攻擊）', '誘使已登入的使用者瀏覽器送出非本意的請求', '把惡意腳本注入頁面，在受害者瀏覽器中執行'],
  ['誰執行', '瀏覽器依伺服器的 Header 決定', '惡意網站利用瀏覽器自動帶 Cookie', '攻擊者的 JavaScript'],
  ['防禦', '白名單 Origin，不要對有憑證的請求用 <code>*</code>', 'SameSite Cookie、CSRF Token、檢查 Origin', '輸出編碼、CSP、HttpOnly Cookie、正確 Content-Type']
])}
<h3>CORS</h3>
<p>瀏覽器預設禁止網頁讀取不同來源（協定 + 網域 + 連接埠）的回應。若前端在 <code>https://shop.example</code>、API 在 <code>https://api.shop.example</code>，API 要明確允許。非簡單請求（如帶 <code>Authorization</code> 或 JSON body）會先送 <code>OPTIONS</code> 預檢請求。</p>
${code('python', String.raw`
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://shop.example", "https://admin.shop.example"],  # 白名單，不要用 "*"
    allow_credentials=True,          # 需要帶 Cookie 時；此時 origins 不能是 "*"
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    max_age=600,                     # 預檢結果快取 10 分鐘
)
`, 'FastAPI CORS 設定')}
${note('warn', 'CORS 只約束瀏覽器。curl、後端程式、攻擊腳本完全不受 CORS 影響——它<b>不是</b>存取控制，API 仍然需要認證與授權。')}
<h3>CSRF</h3>
<p>只有<b>以 Cookie 做身分驗證</b>時才有 CSRF 風險，因為瀏覽器會自動帶上 Cookie。用 <code>Authorization: Bearer</code> Header 的 API 不受影響（惡意網站無法讓瀏覽器自動帶上 Header）。防禦：Cookie 設 <code>SameSite=Lax</code> 或 <code>Strict</code>、狀態變更請求要求 CSRF Token、檢查 <code>Origin</code> Header。</p>
<h3>XSS</h3>
<p>API 雖然回 JSON，但若內容（例如商品評論）被前端以 <code>innerHTML</code> 插入頁面，就會形成儲存型 XSS。後端應：正確設定 <code>Content-Type: application/json</code> 與 <code>X-Content-Type-Options: nosniff</code>；前端應：預設做輸出編碼、設定 CSP。</p>
`,
      qa: [
        ['設定了 CORS 只允許自己的網域，API 就安全了嗎？', '<p>不是。CORS 是瀏覽器實作的機制，用來保護使用者不被惡意網頁讀取資料，對直接發送 HTTP 請求的工具（curl、Postman、腳本）完全沒有約束力。API 的安全仍然取決於認證、授權、輸入驗證與限流。CORS 設定錯誤（例如反射任何 Origin 又允許 credentials）反而會造成資料外洩。</p>']
      ]
    },
    {
      id: 'rate-limiting', title: 'Rate Limiting', zh: '限流',
      html: `
<p>限流保護系統不被濫用（暴力破解、爬蟲）、控制成本（尤其是 LLM API）、確保租戶之間的公平性，並防止流量尖峰壓垮服務。</p>
${table(['演算法', '原理', '優點', '缺點'], [
  ['Fixed Window', '每個時間窗（如每分鐘）計數', '最簡單、省記憶體', '窗口交界處可能瞬間通過 2 倍流量'],
  ['Sliding Window Log', '記錄每個請求時間戳', '最精確', '記憶體用量大'],
  ['Sliding Window Counter', '用前後兩個窗口加權估算', '精確度與成本平衡', '是近似值'],
  ['Token Bucket', '桶子以固定速率補充 Token，每個請求消耗一個', '允許合理的突發流量', '要調兩個參數'],
  ['Leaky Bucket', '請求進佇列，以固定速率流出', '輸出非常平滑', '突發請求會排隊延遲']
])}
<h3>限流的維度</h3>
<ul>
  <li><b>依 API Key / 使用者 / 租戶</b>：最常見，可依方案（免費 / 付費）設定不同額度。</li>
  <li><b>依 IP</b>：用在未登入端點（登入、註冊、忘記密碼）。</li>
  <li><b>依端點</b>：登入端點要更嚴格（防暴力破解）；昂貴端點（匯出報表、LLM 呼叫）單獨限制。</li>
  <li><b>依成本</b>：LLM API 常依 Token 數而非請求數限流。</li>
</ul>
${code('python', String.raw`
import time
import redis.asyncio as redis
from fastapi import HTTPException, Request

r = redis.from_url("redis://localhost:6379")

async def rate_limit(request: Request, limit: int = 100, window: int = 60):
    key_id = request.state.api_key_id                 # 認證後取得
    window_start = int(time.time()) // window
    key = f"rl:{key_id}:{window_start}"
    async with r.pipeline(transaction=True) as pipe:
        pipe.incr(key)
        pipe.expire(key, window * 2)
        count, _ = await pipe.execute()
    remaining = max(0, limit - count)
    request.state.rate_headers = {"RateLimit-Limit": str(limit), "RateLimit-Remaining": str(remaining)}
    if count > limit:
        retry_after = window - int(time.time()) % window
        raise HTTPException(429, "rate limit exceeded", headers={"Retry-After": str(retry_after)})
`, '用 Redis 實作分散式固定窗口限流（多台伺服器共用計數）')}
${note('tip', '到「互動實驗」調整 Token Bucket 的容量與補充速率，看突發流量如何被處理。限流也常集中在 API Gateway 處理（模組 12）。')}
`,
      qa: [
        ['Token Bucket 和 Fixed Window 怎麼選？', '<p>Fixed Window 最簡單，但在窗口邊界可能讓 2 倍流量通過（例如 59 秒與 61 秒各打滿上限）。Token Bucket 用「容量」控制可接受的突發量、用「補充速率」控制長期平均速率，能允許使用者偶爾的爆量（例如頁面載入時一次打 10 個 API），又能限制持續的高頻請求，是多數 API Gateway 的預設選擇。分散式環境下要把狀態放 Redis，並用 Lua 腳本確保「讀取—計算—寫回」是原子操作。</p>']
      ]
    },
    {
      id: 'input-validation', title: 'Input Validation', zh: '輸入驗證',
      html: `
<p>原則：<b>所有外部輸入都不可信</b>——Body、Query、Header、Cookie、上傳檔案、甚至第三方 API 與 LLM 的回應。</p>
<ul>
  <li><b>白名單優於黑名單</b>：定義「允許什麼」，而不是試圖列出所有壞東西。</li>
  <li><b>型別、長度、範圍、格式、列舉</b>都要限制（模組 03 的 Schema）。</li>
  <li><b>大小限制</b>：請求 Body 上限（如 1 MB）、陣列筆數、JSON 巢狀深度，防止資源耗盡。</li>
  <li><b>檔案上傳</b>：檢查大小、用檔案內容（magic bytes）判斷類型而非副檔名、用隨機檔名、存在網站根目錄以外或物件儲存。</li>
  <li><b>路徑</b>：防止 <code>../</code> 路徑穿越。</li>
  <li><b>在伺服器端驗證</b>：前端驗證只是使用者體驗，可以被繞過。</li>
</ul>
${code('python', String.raw`
from pathlib import Path
from pydantic import BaseModel, ConfigDict, Field, HttpUrl

class CreateReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rating: int = Field(ge=1, le=5)
    title: str = Field(min_length=1, max_length=100)
    body: str = Field(max_length=5000)
    tags: list[str] = Field(default=[], max_length=10)      # 陣列最多 10 個
    website: HttpUrl | None = None

UPLOAD_ROOT = Path("/srv/uploads").resolve()

def safe_path(user_filename: str) -> Path:
    target = (UPLOAD_ROOT / user_filename).resolve()
    if not target.is_relative_to(UPLOAD_ROOT):               # 擋掉 ../../etc/passwd
        raise ValueError("invalid path")
    return target
`, '用 Schema 限制輸入，並防止路徑穿越')}
`,
      qa: [
        ['有了前端表單驗證，後端還需要驗證嗎？', '<p>一定要。前端驗證只是讓使用者更快得到回饋，攻擊者可以直接用 curl 或改寫請求繞過前端。後端是唯一可信的驗證點，所有限制（型別、長度、權限、業務規則）都必須在後端再檢查一次。</p>']
      ]
    },
    {
      id: 'sql-injection', title: 'SQL Injection', zh: 'SQL 注入',
      html: `
<p>當使用者輸入被直接拼接進 SQL 字串，攻擊者就能改變查詢的結構。</p>
${code('python', String.raw`
# ❌ 危險：輸入 email = "x' OR '1'='1" 會回傳所有使用者
query = f"SELECT * FROM users WHERE email = '{email}'"
await conn.execute(query)

# ✅ 安全：參數化查詢，資料庫把參數當成「值」而非「SQL 語法」
await conn.fetch("SELECT * FROM users WHERE email = $1", email)          # asyncpg

# ✅ ORM 也是參數化的
from sqlalchemy import select
stmt = select(User).where(User.email == email)
`, '危險與安全的寫法')}
<h3>參數化也救不了的地方：識別字</h3>
<p>欄位名稱、表格名稱、<code>ORDER BY</code> 方向不能用參數傳入，必須用<b>白名單</b>：</p>
${code('python', String.raw`
SORTABLE = {"created_at": "created_at", "price": "price", "name": "name"}

def order_clause(sort: str) -> str:
    desc = sort.startswith("-")
    column = SORTABLE.get(sort.lstrip("-"))
    if column is None:
        raise HTTPException(400, "unsupported sort field")
    return f"ORDER BY {column} {'DESC' if desc else 'ASC'}"   # 只會出現白名單中的值
`, '排序欄位白名單')}
<h3>縱深防禦</h3>
<ul>
  <li>應用程式使用的資料庫帳號只給必要權限（不能 <code>DROP TABLE</code>）。</li>
  <li>錯誤訊息不要回傳 SQL 細節給客戶端。</li>
  <li>NoSQL 也有注入：MongoDB 若直接把 JSON 當查詢條件，<code>{"password": {"$ne": null}}</code> 可繞過密碼檢查。</li>
</ul>
`,
      qa: [
        ['用了 ORM 就不會有 SQL Injection 嗎？', '<p>大部分情況下是安全的，因為 ORM 會產生參數化查詢。但以下情況仍有風險：使用 <code>text()</code> 或 raw SQL 並用 f-string 拼接；把使用者輸入當成欄位名稱或排序欄位；某些 ORM 的 <code>extra()</code> / <code>order_by(user_input)</code>。所以仍要遵守「值用參數、識別字用白名單」的原則，並用靜態分析工具（如 Bandit、Semgrep）在 CI 中檢查。</p>']
      ]
    },
    {
      id: 'ssrf', title: 'SSRF', zh: '伺服器端請求偽造',
      html: `
<p>當你的伺服器會<b>依使用者提供的 URL 發出請求</b>，攻擊者就能讓伺服器去存取它本來碰不到的地方：內部服務、資料庫管理介面、雲端 metadata 端點（<code>http://169.254.169.254/</code> 可能洩漏雲端憑證）。</p>
<p>高風險功能：Webhook 設定、網址預覽、從 URL 匯入圖片、PDF / HTML 轉檔，以及<b>讓 LLM Agent 呼叫的「抓取網頁」工具</b>。</p>
${code('python', String.raw`
import ipaddress, socket
from urllib.parse import urlparse

def assert_public_url(url: str) -> str:
    """回傳已驗證的 IP，呼叫端應直接連到這個 IP，避免 DNS rebinding。"""
    p = urlparse(url)
    if p.scheme not in ("https",):
        raise ValueError("only https allowed")
    if not p.hostname:
        raise ValueError("missing host")
    infos = socket.getaddrinfo(p.hostname, p.port or 443, proto=socket.IPPROTO_TCP)
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise ValueError(f"blocked address: {ip}")
    return infos[0][4][0]

# 發送請求時：不跟隨轉址（或每次轉址都重新驗證）、設定短逾時、限制回應大小
# httpx.get(url, follow_redirects=False, timeout=5)
`, '驗證 URL 不指向內部網路')}
<h3>防禦清單</h3>
<ul>
  <li>能用<b>網域白名單</b>就用白名單（例如只允許合作夥伴的網域）。</li>
  <li>解析 DNS 後檢查 IP，封鎖私有、迴環、鏈路本地位址；連線時使用已驗證的 IP，防 <b>DNS rebinding</b>。</li>
  <li>停用自動轉址，或每次轉址都重新驗證。</li>
  <li>透過專用的<b>出口代理</b>（egress proxy）發送對外請求，網路層隔離內部服務。</li>
  <li>雲端啟用 IMDSv2 等需要額外 Token 的 metadata 存取方式。</li>
</ul>
`,
      qa: [
        ['設計一個 Webhook 功能時，要注意哪些安全問題？', '<p>對外送出（你呼叫客戶的 URL）：防 SSRF——驗證 URL 為公開位址、禁止轉址、短逾時、透過出口代理；對 payload 做 HMAC 簽章讓客戶驗證來源；附上時間戳防重放。接收端（別人呼叫你）：驗證簽章、檢查時間戳、以事件 ID 去重（冪等）、快速回 2xx 後非同步處理。詳見模組 06 的 Webhooks。</p>']
      ]
    },
    {
      id: 'owasp-top10', title: 'OWASP API Security Top 10', zh: 'OWASP API 十大風險（2023）',
      html: `
${table(['編號', '風險', '說明', '主要防禦'], [
  ['API1', 'Broken Object Level Authorization', '改 ID 就能存取別人的資料', '每次存取物件都檢查擁有者／租戶'],
  ['API2', 'Broken Authentication', '認證機制有缺陷：弱密碼、Token 不驗證、無暴力破解防護', '標準協定、MFA、登入限流'],
  ['API3', 'Broken Object Property Level Authorization', '回傳不該看的欄位，或能修改不該改的欄位（Mass Assignment）', '回應模型白名單、更新欄位白名單'],
  ['API4', 'Unrestricted Resource Consumption', '沒有限流、分頁、大小限制，導致服務癱瘓或帳單爆炸', '限流、配額、Body 與分頁上限、逾時'],
  ['API5', 'Broken Function Level Authorization', '一般使用者能呼叫管理員功能', '每個端點明確宣告所需權限，預設拒絕'],
  ['API6', 'Unrestricted Access to Sensitive Business Flows', '自動化濫用業務流程：搶票、刷優惠券', '裝置指紋、行為分析、CAPTCHA、業務層限制'],
  ['API7', 'Server Side Request Forgery', '伺服器被誘導存取內部資源', 'URL 驗證、出口代理、網段隔離'],
  ['API8', 'Security Misconfiguration', '預設帳密、詳細錯誤堆疊、錯誤 CORS、缺少安全 Header', '設定基準線、自動化掃描'],
  ['API9', 'Improper Inventory Management', '忘記下線的舊版 API、未列管的測試環境', 'API 目錄（模組 14）、淘汰流程'],
  ['API10', 'Unsafe Consumption of APIs', '盲目信任第三方 API 的回應', '驗證外部回應、逾時、TLS、限制轉址']
])}
${code('python', String.raw`
# API3 Mass Assignment 範例
# ❌ 使用者送 {"display_name": "Amy", "role": "admin"} 就變成管理員
await db.users.update(user_id, **await request.json())

# ✅ 只允許更新明確列出的欄位
class UpdateProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str | None = Field(None, max_length=50)
    bio: str | None = Field(None, max_length=500)

await db.users.update(user_id, **body.model_dump(exclude_unset=True))
`, 'Mass Assignment 與修正')}
`,
      qa: [
        ['OWASP API Top 10 中你認為最常見的是哪一項？如何系統性地防範？', '<p>API1 BOLA 最常見，因為它無法靠框架自動處理，每個端點都要寫對。系統性防範：(1) 在資料存取層強制帶入目前使用者／租戶條件，而不是每個 handler 自己寫；(2) 使用不可猜測的 ID；(3) 為每個資源寫「跨使用者存取必須失敗」的自動化測試；(4) Code Review 檢查清單；(5) 資料庫 Row-Level Security 作為最後防線。</p>']
      ]
    }
  ],
  labs: [
    {
      title: '找出漏洞',
      desc: '閱讀每段程式碼，判斷它是安全的，還是有哪一類漏洞。',
      render(root) {
        Course.ui.classify(root, {
          choices: ['安全', 'SQL Injection', 'SSRF', 'BOLA', 'Mass Assignment', 'XSS'],
          items: [
            { html: code('python', `cur.execute(f"SELECT * FROM users WHERE email = '{email}'")`), answer: 1, explain: '使用者輸入直接拼進 SQL。改用參數化查詢：<code>cur.execute("... WHERE email = %s", (email,))</code>。' },
            { html: code('python', `stmt = select(User).where(User.email == email)\nuser = (await session.execute(stmt)).scalar_one_or_none()`), answer: 0, explain: 'SQLAlchemy 運算式會產生參數化查詢，是安全的。' },
            { html: code('python', `@app.post("/v1/link-preview")\nasync def preview(body: PreviewIn):\n    r = httpx.get(body.url, follow_redirects=True)\n    return extract_title(r.text)`), answer: 2, explain: '伺服器依使用者提供的 URL 發出請求，且跟隨轉址，可被導向內網或 metadata 端點。需驗證目標 IP、禁止轉址、透過出口代理。' },
            { html: code('python', `@app.get("/v1/invoices/{invoice_id}")\nasync def get_invoice(invoice_id: int, user=Depends(current_user)):\n    return await db.get(Invoice, invoice_id)`), answer: 3, explain: '有驗證登入，卻沒檢查發票是否屬於該使用者，改 ID 就能看別人的發票。查詢時要加上擁有者／租戶條件。' },
            { html: code('python', `@app.patch("/v1/me")\nasync def update_me(request: Request, user=Depends(current_user)):\n    data = await request.json()\n    await db.users.update(user.id, **data)`), answer: 4, explain: '使用者可以送 <code>{"role": "admin"}</code> 或 <code>{"balance": 99999}</code>。用明確的 Pydantic 模型限定可更新欄位。' },
            { html: code('python', `@app.get("/v1/greet", response_class=HTMLResponse)\nasync def greet(name: str):\n    return f"<h1>Hello {name}</h1>"`), answer: 5, explain: '把輸入直接放進 HTML。<code>?name=&lt;script&gt;...</code> 會在瀏覽器執行。要做 HTML 跳脫，或改用會自動跳脫的模板引擎。' },
            { html: code('python', `sort = request.query_params.get("sort", "created_at")\nrows = await conn.fetch(f"SELECT * FROM products ORDER BY {sort}")`), answer: 1, explain: '欄位名稱無法參數化，必須用白名單對照，否則可注入任意 SQL。' },
            { html: code('python', `@app.get("/v1/orders/{order_id}")\nasync def get_order(order_id: str, user=Depends(current_user)):\n    order = await db.fetch_one(\n        "SELECT * FROM orders WHERE id = $1 AND tenant_id = $2 AND user_id = $3",\n        order_id, user.tenant_id, user.id)\n    if order is None:\n        raise HTTPException(404)\n    return OrderOut.model_validate(order)`), answer: 0, explain: '參數化查詢、帶入租戶與擁有者條件、用回應模型輸出——這是正確的寫法。' }
          ]
        });
      }
    },
    {
      title: 'Token Bucket 限流模擬器',
      desc: '桶子最多裝「容量」個 Token，每秒補充固定數量；每個請求消耗一個 Token，沒有 Token 就回 429。試試「瞬間送出 10 個」看突發流量，再開啟持續流量看長期速率。',
      render(root) {
        const { range, fmt } = Course.ui;
        root.innerHTML = `
<div class="controls">
  ${range('cap', '桶子容量（可接受的突發量）', 1, 20, 1, 5, ' 個')}
  ${range('rate', '補充速率', 0.5, 10, 0.5, 2, ' 個/秒')}
  ${range('auto', '持續流量', 0, 20, 1, 0, ' 請求/秒')}
</div>
<div class="btn-row"><button type="button" class="btn primary" data-one>送出 1 個請求</button><button type="button" class="btn" data-burst>瞬間送出 10 個</button><button type="button" class="btn ghost" data-clear>清除紀錄</button></div>
<div class="bars"><div class="bar-row"><span>桶內 Token</span><span class="bar-track"><span class="bar-fill tb-fill" style="left:0;width:0"></span></span><span class="bar-val tb-val"></span></div></div>
<div class="kpis"><div class="kpi good"><b class="tb-ok">0</b><span>通過（200）</span></div><div class="kpi bad"><b class="tb-no">0</b><span>被拒（429）</span></div><div class="kpi"><b class="tb-rate">0</b><span>最近 5 秒通過速率（個/秒）</span></div></div>
<p class="muted small">最近 80 個請求（綠＝通過，紅＝429）</p><div class="dots tb-dots"></div>
<div class="log tb-log" style="margin-top:10px"></div>`;
        const v = n => +root.querySelector('[name=' + n + ']').value;
        let tokens = v('cap'), last = performance.now(), acc = 0, ok = 0, no = 0;
        const hist = [], passTimes = [];
        const log = (cls, msg) => {
          const el = root.querySelector('.tb-log');
          el.insertAdjacentHTML('afterbegin', '<div class="' + cls + '">' + new Date().toLocaleTimeString('zh-TW') + '  ' + msg + '</div>');
          while (el.children.length > 40) el.lastChild.remove();
        };
        const request = () => {
          if (tokens >= 1) {
            tokens -= 1; ok++; hist.push(1); passTimes.push(performance.now());
            log('ok', '200 OK（剩餘 Token ' + fmt(tokens, 1) + '）');
          } else {
            no++; hist.push(0);
            const wait = (1 - tokens) / v('rate');
            log('bad', '429 Too Many Requests  Retry-After: ' + Math.ceil(wait) + ' 秒');
          }
          while (hist.length > 80) hist.shift();
          draw();
        };
        const draw = () => {
          const cap = v('cap');
          root.querySelector('.tb-fill').style.width = (Math.min(tokens, cap) / cap * 100) + '%';
          root.querySelector('.tb-val').textContent = fmt(tokens, 1) + ' / ' + cap;
          root.querySelector('.tb-ok').textContent = ok;
          root.querySelector('.tb-no').textContent = no;
          const now = performance.now();
          while (passTimes.length && now - passTimes[0] > 5000) passTimes.shift();
          root.querySelector('.tb-rate').textContent = fmt(passTimes.length / 5, 1);
          root.querySelector('.tb-dots').innerHTML = hist.map(h => h ? '<i></i>' : '<i class="x"></i>').join('');
        };
        const timer = setInterval(() => {
          const now = performance.now(), dt = (now - last) / 1000; last = now;
          tokens = Math.min(v('cap'), tokens + dt * v('rate'));
          acc += dt * v('auto');
          let n = 0;
          while (acc >= 1 && n < 50) { acc -= 1; n++; request(); }
          draw();
        }, 100);
        root.querySelector('[data-one]').onclick = request;
        root.querySelector('[data-burst]').onclick = () => { for (let i = 0; i < 10; i++) request(); };
        root.querySelector('[data-clear]').onclick = () => { ok = 0; no = 0; hist.length = 0; passTimes.length = 0; root.querySelector('.tb-log').innerHTML = ''; draw(); };
        root.querySelector('[name=cap]').addEventListener('input', () => { tokens = Math.min(tokens, v('cap')); draw(); });
        draw();
        return () => clearInterval(timer);
      }
    }
  ],
  quiz: [
    { q: '下列關於 CORS 的敘述何者正確？', options: ['CORS 可以阻止 curl 存取你的 API', 'CORS 是瀏覽器依伺服器回應的 Header 執行的跨來源控制', '設定 allow_origins=["*"] 並允許 credentials 是安全的', 'CORS 可以取代身分驗證'], answer: 1, explain: 'CORS 只對瀏覽器有效。帶憑證的請求不能使用萬用字元來源，CORS 也不能取代認證與授權。' },
    { q: '下列哪種 API 認證方式<b>不</b>受 CSRF 影響？', options: ['Session Cookie', '沒有設定 SameSite 的 Cookie', '放在 Authorization Header 的 Bearer Token', 'Basic Auth 由瀏覽器自動帶上'], answer: 2, explain: 'CSRF 利用瀏覽器「自動」帶上憑證。惡意網站無法讓瀏覽器自動加上 Authorization Header。' },
    { q: '使用者傳入 sort=price 來排序，最安全的實作是？', options: ['把 sort 直接拼進 ORDER BY', '用參數化查詢 ORDER BY $1', '用白名單把 sort 對應到允許的欄位名稱', '用正規表示式移除單引號'], answer: 2, explain: '識別字無法參數化（ORDER BY $1 會被當成常數），黑名單過濾容易被繞過，白名單是正確做法。' },
    { q: '下列哪個功能最容易出現 SSRF 風險？', options: ['使用者上傳大頭貼檔案', '使用者設定 Webhook URL，由伺服器呼叫', '使用者修改暱稱', '使用者查詢自己的訂單'], answer: 1, explain: '只要伺服器會依使用者提供的 URL 發出請求，就要防範 SSRF。' },
    { q: 'Token Bucket 中「容量」參數主要控制什麼？', options: ['長期平均速率', '可接受的突發請求量', '每個請求的逾時時間', '資料庫連線數'], answer: 1, explain: '容量決定一次能爆發多少請求；補充速率才決定長期平均速率。' },
    { q: '使用者送出 {"role": "admin"} 就把自己升為管理員，這屬於 OWASP API Top 10 的哪一項？', options: ['API1 BOLA', 'API3 物件屬性層級授權失效（Mass Assignment）', 'API7 SSRF', 'API9 資產管理不當'], answer: 1, explain: 'API3 涵蓋「讀到不該讀的欄位」與「改到不該改的欄位」，修正方式是用明確的欄位白名單。' }
  ],
  sheet: [
    '只開 TLS 1.2+，加 HSTS 與 nosniff；憑證自動續期並監控到期；B2B 與內部服務考慮 mTLS。',
    'CORS 是瀏覽器機制不是存取控制；Origin 用白名單，帶憑證時不能用 *。',
    'CSRF 只影響 Cookie 認證：SameSite、CSRF Token、檢查 Origin。XSS：輸出編碼、CSP、HttpOnly。',
    '限流演算法：Fixed Window 最簡單、Token Bucket 允許突發；狀態放 Redis；回 429 + Retry-After。',
    '所有外部輸入（含第三方與 LLM 回應）都不可信：白名單、大小上限、伺服器端驗證。',
    'SQL：值用參數化、識別字用白名單、資料庫帳號最小權限。',
    'SSRF：網域白名單、解析後檢查 IP、禁止轉址、出口代理；LLM 抓網頁工具也要防。',
    'OWASP API Top 10 前三名：BOLA、認證失效、物件屬性授權失效（Mass Assignment）。'
  ]
});
