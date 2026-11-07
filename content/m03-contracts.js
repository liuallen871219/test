Course.register({
  id: 'm03', num: '03', title: 'API Documentation & Contracts', zh: 'API 文件與契約',
  intro: 'API 的契約要寫下來、能被機器驗證，並且在演進時不破壞既有使用者。本模組以 OpenAPI 為中心，談 Schema 設計、驗證、契約測試與相容性。',
  goals: [
    '讀懂並撰寫 OpenAPI 3.1 規格，理解 Code-first 與 Design-first 的取捨',
    '用 Pydantic 實作請求／回應驗證與統一錯誤格式（RFC 9457）',
    '說明契約測試的價值，以及它和整合測試的差別',
    '判斷一個變更是否破壞相容性，並用 Expand-and-Contract 安全地演進 Schema'
  ],
  lessons: [
    {
      id: 'openapi', title: 'OpenAPI Specification', zh: 'OpenAPI 規格',
      html: `
<p><b>OpenAPI</b>（前身是 Swagger）是描述 HTTP API 的業界標準格式，用 YAML 或 JSON 寫成。一份規格可以同時用來產生文件、產生客戶端 SDK、產生 Mock Server、驗證請求、做契約測試。</p>
${code('yaml', String.raw`
openapi: 3.1.0
info:
  title: Shop API
  version: 1.4.0
paths:
  /v1/orders/{order_id}:
    get:
      summary: 取得單一訂單
      operationId: getOrder
      parameters:
        - name: order_id
          in: path
          required: true
          schema: { type: string, pattern: "^ord_[A-Za-z0-9]+$" }
      responses:
        "200":
          description: 成功
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Order" }
        "404":
          description: 找不到訂單
          content:
            application/problem+json:
              schema: { $ref: "#/components/schemas/Problem" }
components:
  schemas:
    Order:
      type: object
      required: [id, status, total]
      properties:
        id: { type: string }
        status: { type: string, enum: [pending, paid, shipped, cancelled] }
        total: { $ref: "#/components/schemas/Money" }
    Money:
      type: object
      required: [amount, currency]
      properties:
        amount: { type: string, example: "1299.50" }
        currency: { type: string, example: TWD }
`, 'openapi.yaml 的基本結構')}
${table(['', 'Code-first', 'Design-first'], [
  ['流程', '先寫程式，由框架自動產生規格（FastAPI 內建）', '先寫規格、討論定稿，再實作'],
  ['優點', '規格永遠與程式一致、上手快', '前後端可並行開發、更早發現設計問題'],
  ['缺點', '容易「程式寫成什麼樣，API 就長什麼樣」', '需要工具確保實作符合規格'],
  ['適合', '內部服務、小團隊', '對外 API、多團隊協作']
])}
`,
      qa: [
        ['你們團隊用 Code-first 還是 Design-first？為什麼？', '<p>可以這樣回答：內部服務用 Code-first（FastAPI 從型別自動產生規格，維護成本低），但在 CI 中把產生的 <code>openapi.json</code> 存檔並比對差異，任何契約變更都要在 PR 中被審查。對外 API 則採 Design-first，先在 PR 中審查 YAML 規格，再用契約測試確保實作符合規格。重點是展現你知道兩者的取捨，並有機制避免契約意外改變。</p>']
      ]
    },
    {
      id: 'swagger-ui', title: 'Swagger UI', zh: '互動式 API 文件',
      html: `
<p><b>Swagger UI</b> 把 OpenAPI 規格變成可以直接在瀏覽器中試打的文件。FastAPI 會自動提供：</p>
<ul>
  <li><code>/docs</code>：Swagger UI</li>
  <li><code>/redoc</code>：ReDoc（適合閱讀的版面）</li>
  <li><code>/openapi.json</code>：機器可讀的規格</li>
</ul>
${code('python', String.raw`
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(
    title="Shop API",
    version="1.4.0",
    description="訂單、商品與付款 API。所有金額以字串表示。",
)

class CreateOrder(BaseModel):
    product_id: str = Field(examples=["p_123"])
    quantity: int = Field(ge=1, le=99, examples=[2])

@app.post(
    "/v1/orders",
    tags=["orders"],
    summary="建立訂單",
    status_code=201,
    responses={409: {"description": "庫存不足"}, 422: {"description": "欄位驗證失敗"}},
)
async def create_order(body: CreateOrder):
    """建立一筆訂單並保留庫存 15 分鐘。"""
    ...
`, '用 tags、summary、examples、responses 讓文件更完整')}
${note('tip', '好文件的標準：每個端點都有說明、範例請求與回應、所有可能的錯誤碼、認證方式。可以從規格自動產生 SDK（例如 openapi-generator），讓使用者不必手寫 HTTP 呼叫。')}
${note('warn', '對外服務若不想公開內部端點，可以設定 <code>FastAPI(docs_url=None, redoc_url=None)</code> 關閉，或把文件放在需要登入的路徑。')}
`,
      qa: [
        ['怎樣算是「好的 API 文件」？', '<p>開發者能在幾分鐘內完成第一個成功的呼叫（Time to First Call）。具體要有：快速開始範例、認證說明、每個端點的參數與範例、所有錯誤碼與處理建議、分頁與限流說明、變更紀錄（Changelog）。文件應從規格自動產生並在 CI 中更新，避免和程式脫節。</p>']
      ]
    },
    {
      id: 'schema-design', title: 'API Schema Design', zh: 'Schema 設計',
      html: `
<p>Schema 定義每個欄位的型別與限制。設計得越精確，客戶端越不容易出錯，驗證也越能自動化。</p>
<h3>必填、選填、可為 null 是三件不同的事</h3>
${table(['宣告', '意義', 'Pydantic 寫法'], [
  ['必填、不可 null', '一定要有值', '<code>name: str</code>'],
  ['選填（可省略）', '不傳就用預設值', '<code>nickname: str = ""</code>'],
  ['必填但可 null', '一定要傳，但可以明確傳 null', '<code>middle_name: str | None</code>'],
  ['選填且可 null', '不傳或傳 null 都行', '<code>coupon: str | None = None</code>']
])}
<p>這在 PATCH 特別重要：「沒傳欄位」代表不修改，「傳 null」代表清空，兩者要能區分（Pydantic 可用 <code>model_fields_set</code> 判斷）。</p>
<h3>設計原則</h3>
<ul>
  <li><b>用最精確的型別</b>：<code>integer</code> 而非 <code>number</code>；日期用 <code>format: date-time</code>。</li>
  <li><b>加上限制</b>：<code>minLength</code>、<code>maximum</code>、<code>pattern</code>、陣列 <code>maxItems</code>。這也是安全防線（模組 05）。</li>
  <li><b>列舉要謹慎</b>：回應中的 enum 未來新增值時，寫死 switch 的客戶端可能出錯。文件中要說明「可能新增值，請處理未知值」。</li>
  <li><b>重用元件</b>：Money、Address、Problem 等用 <code>$ref</code> 共用，確保一致。</li>
  <li><b>請求與回應分開定義</b>：<code>UserCreate</code>（含密碼）和 <code>UserOut</code>（不含密碼）不要共用同一個模型。</li>
</ul>
`,
      qa: [
        ['PATCH 時怎麼區分「不修改這個欄位」和「把欄位清空」？', '<p>不傳該欄位代表不修改；明確傳 <code>null</code> 代表清空。實作上不能只看值是否為 None，要看客戶端「有沒有傳」。Pydantic v2 可用 <code>body.model_dump(exclude_unset=True)</code> 只取出有傳的欄位，再套用到資料庫。另一種做法是採用 JSON Merge Patch（RFC 7396）規範，語意明確。</p>']
      ]
    },
    {
      id: 'validation', title: 'Request / Response Validation', zh: '請求與回應驗證',
      html: `
<p><b>輸入驗證</b>擋掉不合法的請求；<b>輸出驗證</b>確保不會意外洩漏欄位、也不會回傳不符合契約的資料。</p>
${code('python', String.raw`
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")      # 不認識的欄位直接拒絕
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    display_name: str = Field(min_length=1, max_length=50)

    @field_validator("display_name")
    @classmethod
    def no_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("不可只有空白")
        return v.strip()

class UserOut(BaseModel):                          # 回應模型：沒有 password
    id: str
    email: EmailStr
    display_name: str

app = FastAPI()

@app.post("/v1/users", response_model=UserOut, status_code=201)
async def create_user(body: UserCreate):
    user = await users.create(body)                # user 物件可能含 password_hash
    return user                                     # response_model 會過濾掉多餘欄位

# 統一錯誤格式：RFC 9457 Problem Details
@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, media_type="application/problem+json", content={
        "type": "https://api.shop.example/problems/validation-error",
        "title": "請求欄位驗證失敗",
        "status": 422,
        "instance": str(request.url.path),
        "errors": [{"field": ".".join(map(str, e["loc"][1:])), "message": e["msg"]} for e in exc.errors()],
    })
`, 'Pydantic 驗證 + 回應模型過濾 + RFC 9457 錯誤格式')}
${code('json', String.raw`
{
  "type": "https://api.shop.example/problems/validation-error",
  "title": "請求欄位驗證失敗",
  "status": 422,
  "instance": "/v1/users",
  "errors": [
    {"field": "password", "message": "String should have at least 12 characters"}
  ]
}
`, '客戶端收到的錯誤回應')}
`,
      qa: [
        ['為什麼要定義獨立的回應模型？直接回傳資料庫物件不行嗎？', '<p>直接回傳 ORM 物件很容易意外洩漏 <code>password_hash</code>、內部旗標、其他使用者的資料（OWASP API3：物件屬性層級授權失效）。回應模型是白名單，只輸出明確宣告的欄位；同時也確保回應符合契約，資料庫欄位改名不會直接影響 API。</p>']
      ]
    },
    {
      id: 'contract-testing', title: 'Contract Testing', zh: '契約測試（概念）',
      html: `
<p>微服務 A 呼叫服務 B。B 改了一個欄位名稱，B 自己的測試全部通過，部署後 A 就壞了。<b>契約測試</b>就是用來在部署前抓到這種問題。</p>
${table(['測試方式', '做法', '問題'], [
  ['端對端整合測試', '把 A、B 都部署起來一起測', '慢、不穩定、環境難維護，問題發現得晚'],
  ['契約測試', '把「A 對 B 的期望」寫成契約，A、B 各自獨立驗證', '需要建立契約流程，但快速且可在各自的 CI 執行']
])}
<h3>兩種主要做法</h3>
<ul>
  <li><b>Schema-based（提供者驅動）</b>：以 OpenAPI 為契約，驗證提供者的實際回應符合規格（例如 Schemathesis 自動產生測試）。</li>
  <li><b>Consumer-Driven Contracts（消費者驅動）</b>：每個消費者寫下「我會送什麼、期待收到什麼」（例如 Pact），提供者在 CI 中驗證所有消費者的契約。好處是提供者能確切知道哪些欄位有人在用。</li>
</ul>
${flow(['消費者測試產生契約檔', '上傳到 Contract Broker', '提供者 CI 下載並驗證', '全部通過才能部署'])}
${note('info', '本節談「為什麼」與「是什麼」；實際用 Schemathesis 與 Pact 撰寫測試在模組 11。')}
`,
      qa: [
        ['契約測試和整合測試有什麼不同？', '<p>整合測試把多個服務真的接在一起測，驗證的是「整體能運作」，但慢、脆弱、問題定位困難。契約測試把服務之間的約定抽成契約，消費者用 Mock 驗證自己符合契約，提供者單獨驗證自己滿足契約，兩邊都能在各自的 CI 中快速執行。它不取代少量的端對端測試，但能大幅減少「部署後才發現介面不相容」的情況。</p>']
      ]
    },
    {
      id: 'schema-evolution', title: 'Schema Evolution', zh: 'Schema 演進',
      html: `
<p>需求一定會變。關鍵是在<b>不中斷既有客戶端</b>的前提下演進。最重要的模式是 <b>Expand and Contract</b>（又稱 Parallel Change）：</p>
${flow(['1. Expand：新增新欄位，新舊並存', '2. 遷移：通知並協助客戶端改用新欄位', '3. 觀察：監控舊欄位使用量', '4. Contract：使用量歸零後移除舊欄位'])}
${code('js', String.raw`
// 想把 name 拆成 first_name / last_name

// 階段 1：同時回傳新舊欄位
{"id": "usr_42", "name": "王小明", "first_name": "小明", "last_name": "王"}

// 階段 4：確認沒有客戶端再讀 name（例如追蹤一個月），才在新主版本移除
{"id": "usr_42", "first_name": "小明", "last_name": "王"}
`, 'Expand and Contract 範例')}
<h3>Tolerant Reader（寬容讀取者）</h3>
<p>客戶端應該<b>忽略不認識的欄位</b>，而不是遇到就報錯。這是讓「新增欄位」成為相容變更的前提。在你寫的客戶端（包括呼叫第三方 API）中也要這樣做：Pydantic 預設 <code>extra="ignore"</code> 正是如此。</p>
${note('tip', '對外請求用 <code>extra="forbid"</code>（嚴格，及早發現客戶端錯字）；解析外部回應用 <code>extra="ignore"</code>（寬容，對方新增欄位不會讓你壞掉）。')}
`,
      qa: [
        ['要把一個被廣泛使用的欄位改名，你會怎麼做？', '<p>用 Expand and Contract：先同時輸出新舊欄位（寫入時兩者同步），在文件與 Changelog 中標示舊欄位已棄用，並在回應加上 Deprecation Header；透過日誌或指標追蹤哪些客戶端還在讀舊欄位，主動聯絡；確認使用量歸零（或到達公告的淘汰日）後，在下一個主版本移除。整個過程不讓任何客戶端突然壞掉。</p>']
      ]
    },
    {
      id: 'backward-compat', title: 'Backward Compatibility', zh: '向後相容',
      html: `
<p>判斷規則有個不對稱：<b>對請求要寬鬆變更，對回應要保守變更</b>。</p>
${table(['變更', '請求端', '回應端'], [
  ['新增選填欄位', '✅ 相容', '✅ 相容（客戶端需是 Tolerant Reader）'],
  ['新增必填欄位', '❌ 破壞：舊客戶端沒送', '✅ 相容'],
  ['移除欄位', '✅ 通常相容（伺服器不再讀）', '❌ 破壞：客戶端可能依賴'],
  ['欄位改名', '❌ 破壞', '❌ 破壞'],
  ['改變型別（數字 → 字串）', '❌ 破壞', '❌ 破壞'],
  ['放寬限制（maxLength 50 → 100）', '✅ 相容', '⚠️ 可能破壞：客戶端資料庫欄位可能只有 50'],
  ['收緊限制（maxLength 100 → 50）', '❌ 破壞', '✅ 相容'],
  ['enum 新增值', '✅ 相容', '⚠️ 可能破壞：客戶端 switch 沒處理新值'],
  ['改變預設值或行為', '⚠️ 視情況', '⚠️ 視情況，常被忽略']
])}
<h3>在 CI 中自動檢查</h3>
${code('bash', String.raw`
# 比較主分支與 PR 的 OpenAPI 規格，發現破壞性變更就讓 CI 失敗
oasdiff breaking main/openapi.yaml pr/openapi.yaml --fail-on ERR
`, '使用 oasdiff 偵測破壞性變更')}
${note('ex', '曾有團隊把錯誤回應的 <code>code</code> 從整數改成字串，自認只是「格式整理」，結果所有用 <code>if err.code == 1001</code> 判斷的客戶端全部失效。錯誤格式同樣是契約的一部分。')}
`,
      qa: [
        ['在回應的 enum 新增一個值，算破壞性變更嗎？', '<p>嚴格來說可能是。若客戶端用窮舉的 switch 或強型別 enum 解析，遇到未知值會拋出例外。實務做法：在文件中事先聲明「enum 未來可能新增值，請處理未知值」，並讓官方 SDK 以 fallback 值（例如 <code>UNKNOWN</code>）處理；新增值時仍要在 Changelog 公告。對請求端的 enum 新增值則是相容的。</p>']
      ]
    }
  ],
  labs: [
    {
      title: 'Schema 驗證器',
      desc: '左邊是「建立訂單」的 JSON Schema。編輯右邊的請求內容，即時看到 API 會回傳 201 還是 422，以及錯誤出現在哪個欄位。也可以點上方的範例快速切換。',
      render(root) {
        const schema = {
          type: 'object', required: ['customer_email', 'items'], additionalProperties: false,
          properties: {
            customer_email: { type: 'string', format: 'email' },
            items: {
              type: 'array', minItems: 1, maxItems: 50,
              items: {
                type: 'object', required: ['product_id', 'quantity'], additionalProperties: false,
                properties: {
                  product_id: { type: 'string', pattern: '^p_[a-z0-9]+$' },
                  quantity: { type: 'integer', minimum: 1, maximum: 99 }
                }
              }
            },
            coupon: { type: ['string', 'null'], maxLength: 20 },
            shipping: { type: 'string', enum: ['standard', 'express'] }
          }
        };
        const samples = {
          '有效請求': { customer_email: 'amy@example.com', items: [{ product_id: 'p_123', quantity: 2 }], shipping: 'express' },
          '缺少必填欄位': { items: [{ product_id: 'p_123', quantity: 2 }] },
          '型別與範圍錯誤': { customer_email: 'amy@example.com', items: [{ product_id: 'p_123', quantity: '2' }, { product_id: 'P-9', quantity: 0 }] },
          '多餘欄位與 enum 錯誤': { customer_email: 'not-an-email', items: [{ product_id: 'p_1', quantity: 1 }], shipping: 'drone', is_admin: true }
        };
        const typeOf = v => v === null ? 'null' : Array.isArray(v) ? 'array' : (typeof v === 'number' && Number.isInteger(v)) ? 'integer' : typeof v;
        const matches = (v, t) => t === 'number' ? typeof v === 'number' : (t === 'integer' ? typeOf(v) === 'integer' : typeOf(v) === t);
        function validate(v, s, loc, errs) {
          const types = [].concat(s.type || []);
          if (types.length && !types.some(t => matches(v, t))) { errs.push([loc, '型別應為 ' + types.join(' 或 ') + '，收到 ' + typeOf(v)]); return; }
          if (s.enum && !s.enum.includes(v)) errs.push([loc, '只能是 ' + s.enum.join(' / ') + ' 其中之一']);
          if (typeof v === 'string') {
            if (s.maxLength != null && v.length > s.maxLength) errs.push([loc, '長度不可超過 ' + s.maxLength]);
            if (s.pattern && !new RegExp(s.pattern).test(v)) errs.push([loc, '格式需符合 ' + s.pattern]);
            if (s.format === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) errs.push([loc, '不是有效的 email']);
          }
          if (typeof v === 'number') {
            if (s.minimum != null && v < s.minimum) errs.push([loc, '不可小於 ' + s.minimum]);
            if (s.maximum != null && v > s.maximum) errs.push([loc, '不可大於 ' + s.maximum]);
          }
          if (Array.isArray(v)) {
            if (s.minItems != null && v.length < s.minItems) errs.push([loc, '至少需要 ' + s.minItems + ' 筆']);
            if (s.maxItems != null && v.length > s.maxItems) errs.push([loc, '最多 ' + s.maxItems + ' 筆']);
            if (s.items) v.forEach((x, i) => validate(x, s.items, loc.concat(i), errs));
          }
          if (typeOf(v) === 'object') {
            (s.required || []).forEach(k => { if (!(k in v)) errs.push([loc.concat(k), '必填欄位']); });
            Object.keys(v).forEach(k => {
              if (s.properties && s.properties[k]) validate(v[k], s.properties[k], loc.concat(k), errs);
              else if (s.additionalProperties === false) errs.push([loc.concat(k), '不允許的額外欄位']);
            });
          }
        }
        root.innerHTML = '<div class="btn-row">' + Object.keys(samples).map(k => '<button type="button" class="chip" data-s="' + k + '">' + k + '</button>').join('') + '</div>' +
          '<div class="grid2"><div class="panel"><h4>JSON Schema（CreateOrder）</h4><pre>' + Course.ui.esc(JSON.stringify(schema, null, 2)) + '</pre></div>' +
          '<div><div class="panel"><h4>請求內容 POST /v1/orders</h4><textarea spellcheck="false" rows="12" style="min-height:220px"></textarea></div>' +
          '<div class="panel" style="margin-top:12px"><h4>API 回應 <span class="pill resp-pill"></span></h4><pre class="resp"></pre></div></div></div>';
        const ta = root.querySelector('textarea');
        const run = () => {
          const pill = root.querySelector('.resp-pill'), out = root.querySelector('.resp');
          let data;
          try { data = JSON.parse(ta.value); } catch (e) {
            pill.className = 'pill bad resp-pill'; pill.textContent = '400 Bad Request';
            out.textContent = JSON.stringify({ title: 'JSON 解析失敗', status: 400, detail: e.message }, null, 2); return;
          }
          const errs = []; validate(data, schema, ['body'], errs);
          if (!errs.length) {
            pill.className = 'pill ok resp-pill'; pill.textContent = '201 Created';
            out.textContent = JSON.stringify({ id: 'ord_7Gx2Qk', status: 'pending', items: data.items }, null, 2);
          } else {
            pill.className = 'pill bad resp-pill'; pill.textContent = '422 Unprocessable Content';
            out.textContent = JSON.stringify({ type: 'https://api.shop.example/problems/validation-error', title: '請求欄位驗證失敗', status: 422, errors: errs.map(([l, m]) => ({ field: l.slice(1).join('.'), message: m })) }, null, 2);
          }
        };
        root.querySelector('.btn-row').onclick = e => {
          const b = e.target.closest('[data-s]'); if (!b) return;
          root.querySelectorAll('.btn-row .chip').forEach(c => c.classList.toggle('on', c === b));
          ta.value = JSON.stringify(samples[b.dataset.s], null, 2); run();
        };
        ta.addEventListener('input', run);
        root.querySelector('[data-s]').click();
      }
    },
    {
      title: '這個變更會破壞相容性嗎？',
      desc: '判斷每個 API 變更對既有客戶端是否安全。',
      render(root) {
        Course.ui.classify(root, {
          choices: ['相容（安全）', '破壞性變更', '可能破壞，需評估'],
          items: [
            { html: '在 <b>回應</b> 中新增一個 <code>tracking_url</code> 欄位', answer: 0, explain: '只要客戶端忽略不認識的欄位（Tolerant Reader），新增回應欄位是相容的。' },
            { html: '在 <b>請求</b> 中新增一個<b>必填</b>的 <code>phone</code> 欄位', answer: 1, explain: '舊客戶端不會送這個欄位，請求會被拒絕。應改成選填並給預設值。' },
            { html: '把回應中的 <code>price</code> 從數字 <code>1299.5</code> 改成字串 <code>"1299.50"</code>', answer: 1, explain: '型別改變，強型別客戶端會解析失敗。應新增新欄位或在新版本中變更。' },
            { html: '請求中 <code>note</code> 的長度上限從 100 放寬到 500', answer: 0, explain: '放寬請求限制不影響既有客戶端（舊請求仍然合法）。' },
            { html: '回應中 <code>status</code> 的 enum 新增 <code>refunded</code>', answer: 2, explain: '若客戶端用窮舉 switch 處理，未知值可能造成錯誤。應事先在文件說明 enum 會擴充，並公告。' },
            { html: '移除回應中的 <code>legacy_id</code> 欄位', answer: 1, explain: '只要有客戶端還在讀它就會壞掉。應先標示棄用、追蹤使用量，在新主版本才移除。' },
            { html: '新增一個端點 <code>GET /v1/orders/{id}/invoice</code>', answer: 0, explain: '新增端點不影響任何既有呼叫。' },
            { html: '列表端點預設 <code>limit</code> 從 50 改為 20', answer: 2, explain: '型別與欄位都沒變，但行為改變了。依賴「一次拿 50 筆」又沒處理分頁的客戶端會少拿資料。' }
          ]
        });
      }
    }
  ],
  quiz: [
    { q: 'FastAPI 預設在哪個路徑提供 Swagger UI？', options: ['/swagger', '/docs', '/api-docs', '/openapi'], answer: 1, explain: '/docs 是 Swagger UI，/redoc 是 ReDoc，/openapi.json 是規格本身。' },
    { q: '使用者的 ORM 物件含有 password_hash，怎麼確保它不會出現在 API 回應中？', options: ['在前端隱藏該欄位', '定義不含該欄位的回應模型（response_model）', '把欄位改名', '用 HTTPS 加密'], answer: 1, explain: '回應模型是白名單，只輸出明確宣告的欄位，從根本避免洩漏。' },
    { q: 'RFC 9457 定義的是什麼？', options: ['API 版本命名規則', 'HTTP API 的錯誤回應格式（Problem Details）', 'JWT 結構', 'OpenAPI 檔案格式'], answer: 1, explain: 'Problem Details 定義了 type、title、status、detail、instance 等欄位，媒體類型是 application/problem+json。' },
    { q: '下列哪個變更對既有客戶端是<b>安全</b>的？', options: ['在請求新增必填欄位', '刪除回應中的欄位', '在回應中新增選填欄位', '把欄位型別從整數改為字串'], answer: 2, explain: '回應新增欄位在客戶端遵守 Tolerant Reader 原則時是相容的；其他三項都會破壞現有客戶端。' },
    { q: 'Expand and Contract 模式的正確順序是？', options: ['直接移除舊欄位 → 通知客戶端', '新增新欄位並與舊欄位並存 → 遷移客戶端 → 確認舊欄位無人使用 → 移除', '先升主版本再新增欄位', '同時移除舊欄位並新增新欄位'], answer: 1, explain: '先擴充、再遷移、再收縮，整個過程中所有客戶端都能正常運作。' },
    { q: '消費者驅動契約測試（如 Pact）相比端對端整合測試，最大的優勢是？', options: ['完全不需要寫測試', '服務可以在各自的 CI 中快速、獨立地驗證介面相容性', '可以測試 UI', '不需要 OpenAPI'], answer: 1, explain: '契約讓提供者與消費者各自驗證，不必部署整套環境，問題也能更早、更精確地被發現。' }
  ],
  sheet: [
    'OpenAPI 是 HTTP API 的標準契約格式，可產生文件、SDK、Mock、驗證與測試。',
    'Code-first 維護成本低；Design-first 適合對外與多團隊協作。兩者都要讓契約變更可被審查。',
    '必填、選填、可為 null 是三件事；PATCH 用 <code>exclude_unset</code> 區分「沒傳」與「傳 null」。',
    '請求模型用 <code>extra="forbid"</code>；回應一定要有獨立模型，避免洩漏欄位。',
    '錯誤格式統一用 RFC 9457 Problem Details（application/problem+json）。',
    '契約測試在部署前抓出介面不相容：Schema-based（Schemathesis）或消費者驅動（Pact）。',
    'Expand and Contract：新增 → 遷移 → 觀察 → 移除；客戶端要當 Tolerant Reader。',
    '請求端寬鬆變更、回應端保守變更；enum 新增值與預設值改變常被忽略；CI 用 oasdiff 自動檢查。'
  ]
});
