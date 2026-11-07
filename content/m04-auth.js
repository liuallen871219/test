Course.register({
  id: 'm04', num: '04', title: 'Authentication & Authorization', zh: '身分驗證與授權',
  intro: '「你是誰」（Authentication）與「你能做什麼」（Authorization）是每個 API 的第一道關卡。本模組從 API Key、JWT、OAuth 2.0、OpenID Connect 一路談到授權模型、Token 生命週期與服務之間的認證。',
  goals: [
    '依情境選擇 API Key、JWT、OAuth 2.0 或 OIDC，並說明理由',
    '正確驗證 JWT（簽章、演算法、exp、iss、aud），避開常見漏洞',
    '說明 Authorization Code + PKCE 流程的每一步與它防範的攻擊',
    '設計 RBAC / ABAC 權限檢查，並處理 Token 撤銷與服務間認證'
  ],
  lessons: [
    {
      id: 'api-keys', title: 'API Keys', zh: 'API 金鑰',
      html: `
<p>API Key 是一串長隨機字串，用來識別<b>呼叫的應用程式或開發者</b>（而非終端使用者）。適合伺服器對伺服器的呼叫、開發者平台（例如 LLM API、地圖 API）。</p>
<h3>正確的做法</h3>
<ul>
  <li><b>高熵隨機</b>：至少 32 位元組，用 <code>secrets</code> 模組產生。</li>
  <li><b>加上前綴</b>：如 <code>sk_live_</code>，方便辨識環境，也讓 GitHub 等平台的 Secret Scanning 能偵測外洩。</li>
  <li><b>只存雜湊</b>：資料庫只存 SHA-256 雜湊；明文只在建立時顯示一次。</li>
  <li><b>權限範圍（Scope）</b>：唯讀金鑰、特定資源的金鑰。</li>
  <li><b>支援多把同時有效</b>：才能無停機輪替（先發新的、更新服務、再撤銷舊的）。</li>
  <li><b>放在 Header</b>：<code>Authorization: Bearer ...</code> 或 <code>X-API-Key</code>，絕不放在 URL（會進入日誌與瀏覽紀錄）。</li>
</ul>
${code('python', String.raw`
import hashlib, hmac, secrets

PREFIX = "sk_live_"

def generate_api_key() -> tuple[str, str]:
    """回傳（給使用者的明文金鑰, 存進資料庫的雜湊）"""
    plain = PREFIX + secrets.token_urlsafe(32)
    return plain, hashlib.sha256(plain.encode()).hexdigest()

async def authenticate(api_key: str):
    if not api_key.startswith(PREFIX):
        return None
    digest = hashlib.sha256(api_key.encode()).hexdigest()
    record = await db.fetch_one("SELECT * FROM api_keys WHERE key_hash = :h AND revoked_at IS NULL", {"h": digest})
    if record is None or not hmac.compare_digest(record["key_hash"], digest):
        return None
    await db.execute("UPDATE api_keys SET last_used_at = now() WHERE id = :id", {"id": record["id"]})
    return record
`, '產生與驗證 API Key')}
${note('info', 'API Key 這種高熵隨機字串用 SHA-256 雜湊就足夠；使用者自訂的<b>密碼</b>則必須用 Argon2 或 bcrypt 這類慢速雜湊，因為密碼可被字典攻擊。')}
`,
      qa: [
        ['為什麼 API Key 只存雜湊？存加密後的版本不行嗎？', '<p>加密是可逆的，金鑰（解密用）一旦和資料庫一起外洩，所有 API Key 都會被還原。雜湊不可逆，即使資料庫外洩，攻擊者也拿不到可用的金鑰。驗證時只需把收到的金鑰雜湊後比對即可。代價是無法再次顯示金鑰給使用者——所以 API Key 只在建立時顯示一次，遺失就重新產生。</p>']
      ]
    },
    {
      id: 'jwt', title: 'JWT', zh: 'JSON Web Token',
      html: `
<p>JWT 由三段 Base64URL 字串以點號相連：<code>Header.Payload.Signature</code>。伺服器用簽章確認內容沒被竄改，因此可以<b>不查資料庫</b>就知道使用者是誰（自包含 Token）。</p>
${code('json', String.raw`
{"alg": "RS256", "typ": "JWT", "kid": "2026-11-key"}
{"iss": "https://auth.shop.example", "sub": "usr_42", "aud": "shop-api",
 "exp": 1794042000, "iat": 1794041100, "scope": "orders:read orders:write"}
`, 'Header（上）與 Payload（下）解碼後的內容')}
${note('warn', 'Payload 只是 Base64 編碼，<b>任何人都能解碼讀取</b>。不要放密碼、身分證字號等敏感資料。簽章保護的是「完整性」，不是「機密性」。')}
${table(['演算法', '類型', '特性', '適合'], [
  ['HS256', '對稱（共用密鑰）', '簽與驗用同一把密鑰', '只有單一服務簽發與驗證'],
  ['RS256 / ES256', '非對稱（私鑰簽、公鑰驗）', '公鑰可透過 JWKS 端點公開', '多個服務需要驗證 Token（主流）']
])}
<h3>驗證清單（缺一不可）</h3>
<ol>
  <li>驗證<b>簽章</b>，並<b>白名單指定演算法</b>（防 <code>alg: none</code> 與演算法混淆攻擊）。</li>
  <li>檢查 <code>exp</code>（過期）與 <code>nbf</code>（生效時間），允許少量時鐘誤差。</li>
  <li>檢查 <code>iss</code>（簽發者）是否為信任的授權伺服器。</li>
  <li>檢查 <code>aud</code>（對象）是否為你的 API——防止拿給別的服務的 Token 來打你。</li>
  <li>最後才檢查 <code>scope</code> / 角色是否足夠。</li>
</ol>
${code('python', String.raw`
import jwt                                   # PyJWT
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

jwks = jwt.PyJWKClient("https://auth.shop.example/.well-known/jwks.json")  # 會快取公鑰
bearer = HTTPBearer()

def current_claims(cred: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    try:
        key = jwks.get_signing_key_from_jwt(cred.credentials).key
        return jwt.decode(
            cred.credentials, key,
            algorithms=["RS256"],             # 白名單，絕不接受 none
            audience="shop-api",
            issuer="https://auth.shop.example",
            leeway=30,                        # 容許 30 秒時鐘誤差
            options={"require": ["exp", "iat", "sub"]},
        )
    except jwt.PyJWTError:
        raise HTTPException(401, "invalid token", headers={"WWW-Authenticate": "Bearer"})

def require_scope(scope: str):
    def checker(claims: dict = Depends(current_claims)) -> dict:
        if scope not in claims.get("scope", "").split():
            raise HTTPException(403, f"missing scope: {scope}")
        return claims
    return checker
`, 'FastAPI 中正確驗證 JWT')}
`,
      qa: [
        ['JWT 有什麼缺點？什麼時候不該用？', '<p>主要缺點是<b>難以撤銷</b>：在過期前它都有效，使用者登出或被停權後仍能使用，只能靠短效期或維護撤銷清單（又失去了無狀態的好處）。此外 Token 較大、Payload 可被讀取、實作錯誤（不驗 aud、接受 alg none）很常見。若是單一網站的使用者登入，伺服器端 Session（Cookie + Redis）通常更簡單安全；JWT 適合跨服務、跨網域、由獨立授權伺服器簽發的情境。</p>']
      ]
    },
    {
      id: 'oauth2', title: 'OAuth 2.0', zh: '授權框架',
      html: `
<p>OAuth 2.0 解決的問題是：<b>讓第三方應用程式在不知道使用者密碼的情況下，取得有限的存取權</b>。例如「讓記帳 App 讀取你的銀行交易紀錄，但不能轉帳」。</p>
${table(['角色', '說明', '例子'], [
  ['Resource Owner', '資源擁有者', '使用者本人'],
  ['Client', '想取得存取權的應用程式', '記帳 App'],
  ['Authorization Server', '驗證使用者、發放 Token', 'Google、Auth0、Keycloak'],
  ['Resource Server', '保管資源的 API', '銀行 API']
])}
<h3>授權類型（Grant Types）</h3>
${table(['類型', '適用情境', '狀態'], [
  ['Authorization Code + PKCE', 'Web、行動 App、SPA——有使用者參與', '✅ 推薦'],
  ['Client Credentials', '機器對機器，沒有使用者', '✅ 推薦'],
  ['Device Authorization', '電視、CLI 等輸入不便的裝置', '✅ 推薦'],
  ['Refresh Token', '用長效 Token 換新的 Access Token', '✅ 搭配使用'],
  ['Implicit', '舊式 SPA，Token 直接放在網址', '❌ 已淘汰'],
  ['Password（ROPC）', 'App 直接收使用者密碼', '❌ 已淘汰']
])}
<p><b>PKCE</b>（Proof Key for Code Exchange）讓客戶端在換 Token 時證明「我就是當初發起授權的那個人」，防止授權碼在轉址過程中被攔截後遭冒用。OAuth 2.1 草案已要求所有客戶端都使用 PKCE。</p>
${code('python', String.raw`
import base64, hashlib, secrets

code_verifier = secrets.token_urlsafe(64)                 # 存在客戶端，不外傳
code_challenge = base64.urlsafe_b64encode(
    hashlib.sha256(code_verifier.encode()).digest()
).rstrip(b"=").decode()                                   # 放進授權請求的網址
state = secrets.token_urlsafe(16)                         # 防 CSRF，回來時要比對
`, '產生 PKCE 參數')}
${note('tip', '到「互動實驗」逐步播放完整的 Authorization Code + PKCE 流程。')}
`,
      qa: [
        ['PKCE 防止的是什麼攻擊？', '<p>授權碼攔截攻擊。在行動 App 或 SPA 中無法安全保存 client_secret，若惡意程式攔截了轉址網址中的 authorization code，就能自己去換 Token。PKCE 要求客戶端一開始送出 <code>code_challenge</code>（verifier 的雜湊），換 Token 時必須提供原始的 <code>code_verifier</code>；攻擊者只拿到 code 卻沒有 verifier，換不到 Token。</p>']
      ]
    },
    {
      id: 'oidc', title: 'OpenID Connect', zh: '身分層',
      html: `
<p>OAuth 2.0 只管「授權」，沒有定義「使用者是誰」。<b>OpenID Connect（OIDC）</b>在 OAuth 2.0 之上加了身分層，是「用 Google / Apple 登入」背後的標準。</p>
${table(['', 'ID Token', 'Access Token'], [
  ['給誰看', '客戶端（你的 App）', '資源伺服器（API）'],
  ['用途', '證明「使用者是誰、何時登入」', '證明「可以存取哪些資源」'],
  ['格式', '一定是 JWT', '可以是 JWT 或不透明字串'],
  ['關鍵 Claim', '<code>sub</code>、<code>email</code>、<code>nonce</code>、<code>aud</code>=client_id', '<code>scope</code>、<code>aud</code>=API']
])}
<ul>
  <li>請求時 scope 包含 <code>openid</code>（再加上 <code>profile</code>、<code>email</code>）就會拿到 ID Token。</li>
  <li><b>Discovery</b>：<code>/.well-known/openid-configuration</code> 列出所有端點與 JWKS 位置，客戶端可自動設定。</li>
  <li><b>nonce</b>：客戶端產生、放進 ID Token，回來時比對，防止重放。</li>
  <li><b>UserInfo 端點</b>：用 Access Token 查詢更多使用者資料。</li>
</ul>
${note('warn', '兩個常見錯誤：(1) 拿 ID Token 去呼叫 API——它的 aud 是你的 App，不是 API；(2) 拿 Access Token 當作登入證明——它不保證是發給你的 App。')}
`,
      qa: [
        ['OAuth 2.0 和 OpenID Connect 的差別是什麼？', '<p>OAuth 2.0 是授權框架，回答「這個 App 可以代表使用者做什麼」，產出 Access Token。OIDC 是建立在 OAuth 2.0 上的身分驗證協定，回答「使用者是誰」，額外產出 ID Token（JWT）並定義了標準的使用者資訊 Claim、Discovery 與 UserInfo 端點。做「第三方登入」要用 OIDC；只是要存取 API 用 OAuth 2.0 即可。</p>']
      ]
    },
    {
      id: 'rbac-abac', title: 'RBAC / ABAC', zh: '授權模型',
      html: `
${table(['模型', '概念', '例子', '優缺點'], [
  ['RBAC', '使用者 → 角色 → 權限', 'admin 可以退款；support 只能查詢', '簡單易懂；規則細時角色會爆炸'],
  ['ABAC', '依屬性與政策判斷', '「同部門」且「金額 &lt; 5000」才可核准', '彈性大；政策難以審查與除錯'],
  ['ReBAC', '依關係判斷（Google Zanzibar）', '文件的「編輯者」或其所屬團隊成員可編輯', '適合協作類產品（OpenFGA、SpiceDB）']
])}
<p>授權檢查有兩層，<b>兩層都要做</b>：</p>
<ul>
  <li><b>功能層級</b>：這個角色能不能呼叫「退款」這個功能？（OWASP API5）</li>
  <li><b>物件層級</b>：這筆訂單是不是屬於這個使用者／租戶？（OWASP API1，最常見的 API 漏洞）</li>
</ul>
${code('python', String.raw`
from fastapi import Depends, HTTPException

ROLE_PERMISSIONS = {
    "admin":   {"orders:read", "orders:refund", "users:manage"},
    "support": {"orders:read"},
    "customer": {"orders:read:own"},
}

def require_permission(perm: str):
    def checker(user=Depends(current_user)):
        perms = set().union(*(ROLE_PERMISSIONS.get(r, set()) for r in user.roles))
        if perm not in perms:
            raise HTTPException(403, "forbidden")
        return user
    return checker

@app.get("/v1/orders/{order_id}")
async def get_order(order_id: str, user=Depends(current_user)):
    # 物件層級授權：查詢條件一定帶上 tenant 與擁有者
    order = await db.fetch_one(
        "SELECT * FROM orders WHERE id = :id AND tenant_id = :t",
        {"id": order_id, "t": user.tenant_id})
    if order is None or ("support" not in user.roles and order["user_id"] != user.id):
        raise HTTPException(404, "order not found")      # 不洩漏是否存在
    return order

@app.post("/v1/orders/{order_id}/refund")
async def refund(order_id: str, user=Depends(require_permission("orders:refund"))):
    ...
`, '功能層級 + 物件層級授權')}
`,
      qa: [
        ['多租戶 SaaS 如何避免 A 公司看到 B 公司的資料？', '<p>(1) 每張業務資料表都有 <code>tenant_id</code>，所有查詢都必須帶上它，最好由資料存取層自動加上，而不是靠每個開發者記得；(2) 在資料庫層再加一道 PostgreSQL Row-Level Security，即使程式漏寫條件也查不到別人的資料；(3) tenant_id 從已驗證的 Token 取得，絕不信任客戶端傳來的值；(4) 寫自動化測試：用 A 租戶的 Token 存取 B 租戶資源必須失敗。</p>']
      ]
    },
    {
      id: 'token-lifecycle', title: 'Token Lifecycle', zh: 'Token 生命週期',
      html: `
${flow(['登入', '發放短效 Access Token（5–15 分鐘）+ 長效 Refresh Token', 'Access Token 過期', '用 Refresh Token 換新的一組（輪替）', '登出／異常 → 撤銷'])}
<h3>設計重點</h3>
<ul>
  <li><b>Access Token 短效</b>：外洩時影響時間有限，也減少撤銷的需求。</li>
  <li><b>Refresh Token 輪替（Rotation）</b>：每次使用都換一把新的，舊的立即失效。</li>
  <li><b>重用偵測</b>：若已失效的 Refresh Token 又被使用，代表可能被竊——撤銷該使用者整個 Token 家族，要求重新登入。</li>
  <li><b>網頁端儲存</b>：放在 <code>HttpOnly; Secure; SameSite</code> Cookie，JavaScript 讀不到，降低 XSS 竊取風險；避免放 localStorage。</li>
  <li><b>撤銷機制</b>：Redis 撤銷清單（以 <code>jti</code> 為鍵，TTL 設為剩餘效期），或在使用者資料存 <code>token_version</code>，改密碼時遞增讓舊 Token 全部失效。</li>
</ul>
${code('python', String.raw`
async def refresh(refresh_token: str):
    rec = await db.fetch_one("SELECT * FROM refresh_tokens WHERE token_hash = :h", {"h": sha256(refresh_token)})
    if rec is None:
        raise HTTPException(401)
    if rec["used_at"] is not None or rec["revoked_at"] is not None:
        # 舊 Token 被重複使用 → 可能遭竊，撤銷整個家族
        await db.execute("UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = :f", {"f": rec["family_id"]})
        raise HTTPException(401, "token reuse detected")
    if rec["expires_at"] < now():
        raise HTTPException(401, "expired")

    await db.execute("UPDATE refresh_tokens SET used_at = now() WHERE id = :id", {"id": rec["id"]})
    new_refresh = await issue_refresh_token(rec["user_id"], family_id=rec["family_id"])
    return {"access_token": issue_access_token(rec["user_id"], ttl_minutes=10),
            "refresh_token": new_refresh, "expires_in": 600}
`, 'Refresh Token 輪替與重用偵測')}
`,
      qa: [
        ['使用者按下「登出所有裝置」，用 JWT 要怎麼實作？', '<p>JWT 本身無法被「收回」，常見做法：(1) 使用者資料表存 <code>token_version</code>，簽發時放進 Claim，驗證時比對，登出所有裝置就遞增版本——需要每次查一下（可快取在 Redis）；(2) 撤銷該使用者所有 Refresh Token，Access Token 因為很短效（例如 10 分鐘）會自然失效；(3) 需要立即生效時，搭配 Redis 撤銷清單。回答時點出「短效 Access Token + 可撤銷的 Refresh Token」這個核心組合。</p>']
      ]
    },
    {
      id: 's2s-auth', title: 'Service-to-Service Authentication', zh: '服務間認證',
      html: `
<p>「內網就安全」的時代已經過去。<b>零信任</b>原則下，服務之間的呼叫也要驗證身分與權限。</p>
${table(['方式', '做法', '優點', '注意'], [
  ['mTLS', '雙方都出示憑證，互相驗證', '傳輸層就完成認證與加密', '憑證發放與輪替要自動化（Service Mesh、SPIFFE）'],
  ['OAuth Client Credentials', '服務用自己的 client_id/secret 換短效 JWT', '有 scope、可集中管理', 'secret 仍需安全保存'],
  ['Workload Identity', 'Kubernetes ServiceAccount Token、雲端 IAM 角色', '沒有長期密鑰，平台自動輪替', '綁定特定平台'],
  ['請求簽章（HMAC）', '用密鑰簽署整個請求（如 AWS SigV4）', '防竄改、防重放', '實作較複雜'],
  ['共用靜態 API Key', '所有服務用同一把', '簡單', '❌ 外洩影響全部、無法區分呼叫者']
])}
${code('python', String.raw`
import httpx

async def get_service_token() -> str:
    # 用 Client Credentials 換取只給「庫存服務」用的短效 Token（實務上要快取到快過期）
    async with httpx.AsyncClient() as client:
        r = await client.post("https://auth.internal/oauth/token", data={
            "grant_type": "client_credentials",
            "client_id": "order-service",
            "client_secret": settings.order_service_secret,   # 來自 Secret Manager，不寫在程式裡
            "audience": "inventory-service",
            "scope": "inventory:reserve",
        }, timeout=5)
        r.raise_for_status()
        return r.json()["access_token"]
`, '訂單服務以 Client Credentials 呼叫庫存服務')}
${note('tip', '最佳實務：每個服務有自己的身分、只拿需要的權限（最小權限）、憑證短效且自動輪替。能用 Workload Identity 就不要用長期密鑰。')}
`,
      qa: [
        ['微服務之間要怎麼做認證？在內網還需要嗎？', '<p>需要。內網一旦有一個服務被攻破，沒有認證就能橫向移動到所有服務。常見方案：用 Service Mesh（Istio / Linkerd）自動為每個服務發放憑證做 mTLS，解決「是哪個服務在呼叫」；再用短效 JWT（Client Credentials 或傳遞使用者 Token）解決「有沒有權限做這件事」。密鑰透過 Workload Identity 或 Secret Manager 管理，避免寫死在設定檔。</p>']
      ]
    }
  ],
  labs: [
    {
      title: 'JWT 解碼與驗證器',
      desc: '產生或貼上一個 JWT，看它的內容、到期時間與安全警告。HS256 簽章會用你輸入的密鑰即時驗證（使用瀏覽器的 Web Crypto，資料不會離開你的電腦）。試著改動 Payload 中的一個字元，看簽章是否還有效。',
      render(root) {
        const esc = Course.ui.esc;
        const te = new TextEncoder();
        const b64u = bytes => { let s = ''; bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
        const encJSON = o => b64u(te.encode(JSON.stringify(o)));
        const dec = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); };
        const hasCrypto = !!(window.crypto && crypto.subtle);
        async function hmac(secret, data) {
          const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
          return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(data))));
        }
        const CLAIMS = { iss: '簽發者（誰發的）', sub: '主體（使用者 ID）', aud: '對象（給哪個 API）', exp: '到期時間', iat: '簽發時間', nbf: '生效時間', jti: 'Token 唯一 ID（可用於撤銷）', scope: '權限範圍', role: '角色', email: 'Email（注意：Payload 任何人都能讀）', name: '名稱' };
        root.innerHTML = `
<div class="btn-row">
  <button type="button" class="chip" data-gen="ok">產生有效 Token</button>
  <button type="button" class="chip" data-gen="expired">產生已過期 Token</button>
  <button type="button" class="chip" data-gen="none">產生 alg: none Token</button>
  <button type="button" class="chip" data-gen="leaky">產生含敏感資料的 Token</button>
</div>
<div class="controls">
  <label class="fld"><span>HS256 密鑰（驗證與產生用）</span><input type="text" name="secret" value="course-demo-secret"></label>
</div>
<label class="fld"><span>JWT</span><textarea name="token" spellcheck="false" rows="4" style="min-height:96px"></textarea></label>
<div class="kpis jwt-status"></div>
<div class="grid2"><div class="panel"><h4>Header</h4><pre class="h"></pre></div><div class="panel"><h4>Payload</h4><pre class="p"></pre></div></div>
<div class="claims" style="margin-top:12px"></div>
<div class="warns"></div>`;
        const ta = root.querySelector('[name=token]'), secretEl = root.querySelector('[name=secret]');
        async function gen(kind) {
          const now = Math.floor(Date.now() / 1000);
          let header = { alg: 'HS256', typ: 'JWT' };
          let payload = { iss: 'https://auth.shop.example', sub: 'usr_42', aud: 'shop-api', iat: now, exp: now + 900, jti: 'tok_' + Math.random().toString(36).slice(2, 10), scope: 'orders:read orders:write' };
          if (kind === 'expired') { payload.iat = now - 7200; payload.exp = now - 3600; }
          if (kind === 'leaky') { payload.exp = now + 86400 * 30; payload.email = 'amy@example.com'; payload.password = 'hunter2'; payload.role = 'admin'; }
          if (kind === 'none') { header = { alg: 'none', typ: 'JWT' }; payload.role = 'admin'; ta.value = encJSON(header) + '.' + encJSON(payload) + '.'; run(); return; }
          const si = encJSON(header) + '.' + encJSON(payload);
          ta.value = si + '.' + (hasCrypto ? await hmac(secretEl.value, si) : 'signature-unavailable');
          run();
        }
        async function run() {
          const t = ta.value.trim(), st = root.querySelector('.jwt-status'), warns = [];
          const parts = t.split('.');
          let header, payload;
          try {
            if (parts.length !== 3) throw new Error('JWT 必須由三段組成（以 . 分隔）');
            header = JSON.parse(dec(parts[0])); payload = JSON.parse(dec(parts[1]));
          } catch (e) {
            st.innerHTML = '<div class="kpi bad"><b>無法解析</b><span>' + esc(e.message) + '</span></div>';
            root.querySelector('.h').textContent = ''; root.querySelector('.p').textContent = ''; root.querySelector('.claims').innerHTML = ''; root.querySelector('.warns').innerHTML = '';
            return;
          }
          root.querySelector('.h').textContent = JSON.stringify(header, null, 2);
          root.querySelector('.p').textContent = JSON.stringify(payload, null, 2);
          let sig = '<div class="kpi"><b>—</b><span>簽章</span></div>';
          if (String(header.alg).toLowerCase() === 'none') {
            sig = '<div class="kpi bad"><b>未簽章</b><span>alg: none</span></div>';
            warns.push(['bad', '<b>alg: none</b>：這個 Token 沒有簽章，任何人都能偽造。伺服器必須白名單指定演算法並拒絕它。']);
          } else if (header.alg === 'HS256' && hasCrypto) {
            const ok = (await hmac(secretEl.value, parts[0] + '.' + parts[1])) === parts[2];
            sig = '<div class="kpi ' + (ok ? 'good' : 'bad') + '"><b>' + (ok ? '有效' : '無效') + '</b><span>HS256 簽章</span></div>';
            if (!ok) warns.push(['bad', '簽章不符：內容被改過，或密鑰不正確。伺服器應回 401。']);
          } else {
            sig = '<div class="kpi"><b>未驗證</b><span>' + esc(header.alg) + '（需公鑰）</span></div>';
          }
          const now = Date.now() / 1000;
          let expK = '<div class="kpi bad"><b>沒有 exp</b><span>永不過期</span></div>';
          if (typeof payload.exp === 'number') {
            const left = payload.exp - now;
            expK = left > 0 ? '<div class="kpi good"><b>' + (left > 3600 ? Math.round(left / 3600) + ' 小時' : Math.round(left / 60) + ' 分鐘') + '</b><span>剩餘效期</span></div>'
              : '<div class="kpi bad"><b>已過期</b><span>' + Math.round(-left / 60) + ' 分鐘前</span></div>';
            if (payload.iat && payload.exp - payload.iat > 86400) warns.push(['warn', 'Access Token 效期超過 1 天。外洩時影響時間太長，建議 5–15 分鐘並搭配 Refresh Token。']);
          } else warns.push(['bad', '缺少 <b>exp</b>：Token 永遠有效，一旦外洩無法自然失效。']);
          if (!payload.aud) warns.push(['warn', '缺少 <b>aud</b>：無法確認這個 Token 是發給哪個 API 的。']);
          ['password', 'secret', 'credit_card', 'id_number'].forEach(k => { if (k in payload) warns.push(['bad', 'Payload 含有 <b>' + k + '</b>。JWT Payload 只是 Base64 編碼，任何人都能讀取！']); });
          if (payload.email) warns.push(['warn', 'Payload 含有 email。可以放，但請記得它對任何拿到 Token 的人都是可見的。']);
          st.innerHTML = sig + expK + '<div class="kpi"><b>' + esc(header.alg || '?') + '</b><span>演算法</span></div>';
          root.querySelector('.claims').innerHTML = table(['Claim', '值', '說明'], Object.keys(payload).map(k => {
            let v = payload[k];
            if ((k === 'exp' || k === 'iat' || k === 'nbf') && typeof v === 'number') v = v + '（' + new Date(v * 1000).toLocaleString('zh-TW') + '）';
            return ['<code>' + esc(k) + '</code>', esc(typeof v === 'object' ? JSON.stringify(v) : v), CLAIMS[k] || '自訂 Claim'];
          }));
          root.querySelector('.warns').innerHTML = warns.length ? warns.map(([k, m]) => note(k === 'bad' ? 'warn' : 'info', m)).join('') : note('tip', '沒有發現明顯問題。伺服器端仍需檢查 iss、aud 與 scope。');
        }
        root.querySelector('.btn-row').onclick = e => { const b = e.target.closest('[data-gen]'); if (b) gen(b.dataset.gen); };
        ta.addEventListener('input', run); secretEl.addEventListener('input', run);
        if (!hasCrypto) root.insertAdjacentHTML('afterbegin', note('info', '此瀏覽器環境不支援 Web Crypto，將無法驗證簽章，但仍可解碼。'));
        gen('ok');
      }
    },
    {
      title: 'OAuth 2.0 Authorization Code + PKCE 流程',
      desc: '一步步播放「用第三方帳號登入並呼叫 API」的完整流程。注意哪些步驟經過瀏覽器（前通道）、哪些是伺服器直接連線（後通道）。',
      render(root) {
        Course.ui.sequence(root, {
          actors: ['使用者／瀏覽器', '你的 App（Client）', '授權伺服器', 'API（資源伺服器）'],
          steps: [
            { from: 0, to: 1, label: '點擊「登入」', detail: '<p>App 產生三個隨機值：<code>code_verifier</code>（自己保存）、<code>code_challenge</code> = BASE64URL(SHA256(verifier))、<code>state</code>（防 CSRF）。</p>' },
            { from: 1, to: 0, label: '302 轉址到授權伺服器', detail: code('http', 'HTTP/1.1 302 Found\nLocation: https://auth.example/authorize?response_type=code\n  &client_id=shop-web&redirect_uri=https://shop.example/callback\n  &scope=openid%20orders:read&state=af0ifjsldkj\n  &code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256') + '<p>這一步走<b>前通道</b>（經過瀏覽器），所以網址中不能有任何秘密。</p>' },
            { from: 0, to: 2, label: '使用者登入並同意授權', detail: '<p>使用者在<b>授權伺服器</b>的頁面輸入密碼（App 完全看不到密碼），並看到「shop-web 想要讀取你的訂單」的同意畫面。</p>' },
            { from: 2, to: 0, label: '302 轉址回 App，附上授權碼', detail: code('http', 'HTTP/1.1 302 Found\nLocation: https://shop.example/callback?code=SplxlOBeZQQYbYS6WxSbIA&state=af0ifjsldkj') + '<p>授權碼短效（通常 1 分鐘內）且只能用一次。</p>' },
            { from: 0, to: 1, label: '瀏覽器帶著 code 回到 App', detail: '<p>App 先檢查 <code>state</code> 與自己保存的一致，不一致就拒絕（可能是 CSRF 攻擊）。</p>' },
            { from: 1, to: 2, label: '用 code + code_verifier 換 Token', detail: code('http', 'POST /token HTTP/1.1\nHost: auth.example\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=authorization_code&code=SplxlOBeZQQYbYS6WxSbIA\n&redirect_uri=https://shop.example/callback&client_id=shop-web\n&code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk') + '<p>這是<b>後通道</b>（伺服器直連）。授權伺服器計算 SHA256(verifier) 與當初的 challenge 比對，攔截到 code 的攻擊者因為沒有 verifier 而無法換到 Token。</p>' },
            { from: 2, to: 1, label: '回傳 Token', detail: code('json', '{\n  "access_token": "eyJhbGciOiJSUzI1NiIs...",\n  "token_type": "Bearer",\n  "expires_in": 600,\n  "refresh_token": "8xLOxBtZp8...",\n  "id_token": "eyJhbGciOiJSUzI1NiIs..."\n}') + '<p>因為 scope 有 <code>openid</code>，所以也拿到 OIDC 的 ID Token（給 App 確認使用者身分）。</p>' },
            { from: 1, to: 3, label: '帶 Access Token 呼叫 API', detail: code('http', 'GET /v1/orders HTTP/1.1\nHost: api.shop.example\nAuthorization: Bearer eyJhbGciOiJSUzI1NiIs...') },
            { from: 3, to: 3, label: 'API 驗證 Token', detail: '<p>用授權伺服器 JWKS 的公鑰驗證簽章 → 檢查 <code>exp</code>、<code>iss</code>、<code>aud</code>=shop-api → 檢查 <code>scope</code> 包含 <code>orders:read</code> → 物件層級授權（只能看自己的訂單）。</p>' },
            { from: 3, to: 1, label: '回傳資料', detail: '<p>完成！10 分鐘後 Access Token 過期，App 用 Refresh Token 換一組新的（並輪替 Refresh Token），使用者不必重新登入。</p>' }
          ]
        });
      }
    }
  ],
  quiz: [
    { q: 'JWT 的 Payload 有什麼特性？', options: ['經過加密，只有伺服器能讀', '只是 Base64URL 編碼，任何人都能解碼讀取', '每次請求都會改變', '只能放使用者 ID'], answer: 1, explain: '簽章保證完整性而非機密性。敏感資料不要放進 JWT（除非使用 JWE 加密）。' },
    { q: '驗證 JWT 時檢查 aud（audience）是為了防止什麼？', options: ['Token 過期', '發給其他服務的 Token 被拿來呼叫你的 API', '演算法被改成 none', '使用者密碼外洩'], answer: 1, explain: '同一個授權伺服器可能為多個 API 簽發 Token，aud 確保這個 Token 確實是給你的 API 使用的。' },
    { q: '單頁應用程式（SPA）要讓使用者登入並呼叫 API，應使用哪種 OAuth 流程？', options: ['Implicit', 'Password（ROPC）', 'Authorization Code + PKCE', 'Client Credentials'], answer: 2, explain: 'Implicit 與 ROPC 已淘汰；Client Credentials 沒有使用者參與。有使用者的公開客戶端應使用 Authorization Code + PKCE。' },
    { q: '使用者 A 把網址中的訂單 ID 改成別人的，就能看到別人的訂單。這是哪一類問題？', options: ['功能層級授權失效', '物件層級授權失效（BOLA）', 'CORS 設定錯誤', 'TLS 版本太舊'], answer: 1, explain: 'BOLA 是 OWASP API Security Top 10 第一名。每次存取物件都要檢查它是否屬於目前使用者／租戶。' },
    { q: 'Refresh Token 輪替時，偵測到一個「已使用過」的 Refresh Token 再次被使用，最安全的處理是？', options: ['照常發放新 Token', '忽略並回傳舊 Token', '撤銷整個 Token 家族並要求重新登入', '延長 Access Token 效期'], answer: 2, explain: '已使用的 Token 再出現，代表攻擊者或合法使用者其中一方拿到的是被竊的副本，無法分辨，只能全部撤銷。' },
    { q: '微服務之間的呼叫，下列哪個做法最<b>不</b>建議？', options: ['用 Service Mesh 做 mTLS', '每個服務用 Client Credentials 取得短效 Token', '使用 Kubernetes Workload Identity', '所有服務共用同一把永久 API Key'], answer: 3, explain: '共用密鑰一旦外洩，所有服務都受影響，而且無法分辨是哪個服務在呼叫，也做不到最小權限。' }
  ],
  sheet: [
    'Authentication = 你是誰；Authorization = 你能做什麼。兩者都要做。',
    'API Key：高熵 + 前綴 + 只存雜湊 + Scope + 可同時多把（方便輪替）；不要放 URL。',
    'JWT 驗證：簽章（白名單演算法）→ exp / nbf → iss → aud → scope。Payload 任何人都能讀。',
    'RS256 / ES256 + JWKS 讓多個服務都能驗證 Token；HS256 只適合單一服務。',
    'OAuth 2.0：有使用者用 Authorization Code + PKCE，機器對機器用 Client Credentials；Implicit、ROPC 已淘汰。',
    'OIDC 在 OAuth 上加身分層：ID Token 給 App、Access Token 給 API，不要混用。',
    '授權要檢查功能層級與物件層級；多租戶查詢一律帶 tenant_id，可加 Row-Level Security。',
    'Access Token 短效、Refresh Token 輪替並偵測重用；網頁端用 HttpOnly Secure SameSite Cookie。',
    '服務間認證：mTLS、Client Credentials、Workload Identity；避免共用永久密鑰。'
  ]
});
