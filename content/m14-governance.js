Course.register({
  id: 'm14', num: '14', title: 'API Governance & Lifecycle', zh: 'API 治理與生命週期',
  intro: '當公司有數十個團隊、數百個 API 時，問題從「怎麼寫一個好 API」變成「怎麼讓所有 API 都一致、找得到、能安全地演進與退場」。本模組談組織層級的版本政策、淘汰流程、API 目錄、治理規則與開發者體驗。',
  goals: [
    '制定組織層級的版本與支援政策',
    '依標準 Header 與溝通時程淘汰舊 API',
    '用 CI 自動檢查相容性與設計規範（oasdiff、Spectral）',
    '建立 API 目錄並以開發者體驗（DX）為核心設計平台'
  ],
  lessons: [
    {
      id: 'versioning-strategy', title: 'API Versioning Strategy', zh: '組織層級的版本策略',
      html: `
<p>模組 02 談的是技術上怎麼標示版本；這裡談的是<b>組織要怎麼管理版本</b>，讓所有團隊行為一致。</p>
${table(['策略', '做法', '適合'], [
  ['URI 主版本 + 相容演進', '<code>/v1</code> 中只做相容變更，破壞性變更才開 <code>/v2</code>', '多數公司的對外 API'],
  ['日期版本釘選', '每個帳號釘選首次使用時的版本（如 <code>2026-11-01</code>），伺服器內部以轉換層相容舊版', '對外平台型 API（Stripe 模式）'],
  ['不做版本（只允許相容變更）', '內部 API 以 Expand and Contract 演進，搭配契約測試', '內部服務、消費者可控']
])}
<h3>政策要寫清楚的事</h3>
<ul>
  <li><b>什麼算破壞性變更</b>（附判斷表，見模組 03）。</li>
  <li><b>支援期間</b>：例如新主版本發布後，舊主版本至少維護 12 個月。</li>
  <li><b>同時維護的版本數上限</b>：例如最多 2 個主版本。</li>
  <li><b>規格版本</b>：OpenAPI 的 <code>info.version</code> 用語意化版本（1.4.0）記錄每次變更，與 URI 的主版本分開。</li>
  <li><b>Changelog</b>：每次變更都要記錄並公告。</li>
</ul>
${note('tip', '版本越多，維運成本越高（每個版本都要測試、修安全漏洞）。最好的版本策略是<b>盡量不需要新版本</b>：從一開始就把擴充性設計進去，並嚴格執行相容性檢查。')}
`,
      qa: [
        ['Stripe 的日期版本是怎麼運作的？優缺點是什麼？', '<p>每個帳號在第一次呼叫時被釘選到當時的 API 版本（一個日期），之後即使 API 有破壞性變更，該帳號仍得到舊行為；客戶可以在準備好時主動升級，或用 Header 單次指定版本測試。伺服器內部只維護最新的實作，透過一連串「版本轉換層」把回應轉回舊格式。優點是客戶永遠不會被迫中斷、平台可以頻繁改進；缺點是轉換層的實作與測試成本高，需要很好的工程紀律。</p>']
      ]
    },
    {
      id: 'deprecation', title: 'API Deprecation', zh: 'API 淘汰',
      html: `
${flow(['設計', 'Beta', 'GA（正式）', 'Deprecated（棄用：仍可用，不建議）', 'Sunset（公告的停止日）', 'Retired（回 410 Gone）'])}
<h3>用標準 Header 通知</h3>
${code('http', String.raw`
HTTP/1.1 200 OK
Deprecation: @1798761600
Sunset: Mon, 31 May 2027 00:00:00 GMT
Link: <https://docs.shop.example/migrate/v2>; rel="deprecation", </v2/orders>; rel="successor-version"
`, 'Deprecation（RFC 9745，值為 Unix 時間）+ Sunset（RFC 8594）')}
${code('python', String.raw`
DEPRECATED = {
    "/v1/orders": {"deprecation": "@1798761600", "sunset": "Mon, 31 May 2027 00:00:00 GMT",
                   "link": '<https://docs.shop.example/migrate/v2>; rel="deprecation"'},
}

@app.middleware("http")
async def deprecation_headers(request, call_next):
    response = await call_next(request)
    route = request.scope.get("route")
    info = DEPRECATED.get(route.path if route else "")
    if info:
        response.headers["Deprecation"] = info["deprecation"]
        response.headers["Sunset"] = info["sunset"]
        response.headers["Link"] = info["link"]
        log.info("deprecated_api_called", route=route.path,
                 api_key_id=getattr(request.state, "api_key_id", None))   # 知道誰還在用
    return response
`, '自動加上棄用 Header，並記錄仍在使用的客戶')}
<h3>溝通時程（對外 API）</h3>
${table(['時間', '動作'], [
  ['T − 12 個月', '公告棄用、發布遷移指南、回應加上 Deprecation Header'],
  ['T − 6 個月', '依使用紀錄 Email 通知仍在使用的客戶'],
  ['T − 3 個月', '<b>Brownout</b>：排定的短時間停用（例如每週二 10 分鐘），讓沒注意到的客戶發現'],
  ['T − 1 個月', '最後通知，協助大客戶遷移'],
  ['T', '停止服務，回 <code>410 Gone</code> 並附遷移連結']
])}
`,
      qa: [
        ['你要下線一個舊版 API，但不知道誰還在用，怎麼辦？', '<p>先加上 Deprecation / Sunset Header，並在程式與 Gateway 層記錄每次呼叫的 API Key、User-Agent、來源服務，彙整出仍在使用的清單並主動聯絡。內部服務可透過分散式追蹤與服務目錄找到呼叫者。剩下找不到的，用 Brownout（短時間、事先公告的停用）讓他們浮出水面。下線後回 410 而不是 404，並在回應中附上遷移指南。</p>']
      ]
    },
    {
      id: 'backward-compat', title: 'Backward Compatibility', zh: '相容性的自動化把關',
      html: `
<p>模組 03 列出了判斷規則；在組織層級，重點是<b>讓機器檢查，而不是靠人記得</b>。</p>
${table(['檢查', '工具', '時機'], [
  ['OpenAPI 破壞性變更', 'oasdiff', '每個 PR'],
  ['設計規範（命名、分頁、錯誤格式）', 'Spectral', '每個 PR'],
  ['消費者契約', 'Pact（can-i-deploy）', '部署前'],
  ['事件 Schema 相容性', 'Schema Registry（BACKWARD 模式）', '註冊新 Schema 時'],
  ['回應快照', 'pytest snapshot', '每個 PR']
])}
${code('python', String.raw`
# tests/test_openapi_contract.py
import json
from pathlib import Path
from app.main import app

SNAPSHOT = Path(__file__).parent / "openapi.snapshot.json"

def test_openapi_matches_snapshot():
    current = app.openapi()
    expected = json.loads(SNAPSHOT.read_text())
    assert current == expected, (
        "OpenAPI 規格改變了。若是預期中的變更，請執行 make update-openapi-snapshot "
        "並在 PR 中說明是否為破壞性變更。"
    )
`, '把契約變更變成「PR 中看得見的差異」')}
${note('tip', '常見流程：CI 偵測到破壞性變更時讓檢查失敗，除非 PR 加上 <code>breaking-change-approved</code> 標籤並經 API 審查者核准。這讓破壞性變更成為<b>刻意的決定</b>，而不是意外。')}
`,
      qa: [
        ['如何在組織內防止有人不小心做出破壞性變更？', '<p>把檢查自動化並放進每個 PR：(1) oasdiff 比對新舊 OpenAPI，發現破壞性變更就失敗；(2) Spectral 檢查設計規範；(3) 契約快照讓任何規格變更都出現在 diff 中；(4) 消費者驅動契約在部署前驗證；(5) 破壞性變更需要特殊標籤與審查者核准，並自動產生 Changelog。工具負責抓問題，人只需要審查少數刻意的變更。</p>']
      ]
    },
    {
      id: 'discovery', title: 'API Discovery', zh: 'API 探索',
      html: `
<p>開發者找不到既有的 API，就會自己再做一個——結果公司裡有三個「取得使用者資料」的 API，各自不一致。<b>API Discovery</b> 讓 API 容易被找到、被理解、被試用。</p>
${table(['對外（開發者入口網站）', '對內（服務目錄）'], [
  ['產品導向的分類與搜尋', '依系統、團隊、領域分類'],
  ['快速開始、範例、SDK 下載', '擁有者、Slack 頻道、On-call 聯絡方式'],
  ['自助申請 API Key、沙盒環境', '生命週期（實驗 / 正式 / 棄用）、SLO'],
  ['定價、配額、狀態頁', '依賴關係：誰提供、誰使用']
])}
${note('warn', '<b>Shadow API</b>（沒人登記的 API）與 <b>Zombie API</b>（以為下線卻還在跑的舊版本）是 OWASP API9「資產管理不當」的典型例子。它們通常沒有更新安全修補，是攻擊者最喜歡的入口。可從 Gateway 流量與雲端資源掃描比對目錄，找出未登記的端點。')}
`,
      qa: [
        ['公司裡有很多重複功能的 API，你會怎麼改善？', '<p>(1) 建立統一的 API 目錄，要求每個 API 登記擁有者、文件與生命週期，並把登記整合進服務建立的範本（讓正確的事變成最容易的事）；(2) 新 API 設計審查時先查目錄，避免重複；(3) 盤點重複的 API，選出一個標準版本，其他走棄用流程；(4) 從 Gateway 與追蹤資料自動偵測未登記的 API。</p>']
      ]
    },
    {
      id: 'catalog', title: 'API Catalog', zh: 'API 目錄',
      html: `
<p>Backstage（Spotify 開源、CNCF 專案）是常見的內部開發者平台，用放在每個 repo 中的 <code>catalog-info.yaml</code> 描述元件與 API，自動組成全公司的目錄。</p>
${code('yaml', String.raw`
apiVersion: backstage.io/v1alpha1
kind: API
metadata:
  name: orders-api
  description: 訂單建立、查詢與取消
  tags: [orders, rest]
  links:
    - url: https://grafana.internal/d/orders
      title: 儀表板
spec:
  type: openapi
  lifecycle: production
  owner: team-checkout
  system: commerce
  definition:
    $text: ./openapi.yaml
---
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: orders-service
spec:
  type: service
  lifecycle: production
  owner: team-checkout
  system: commerce
  providesApis: [orders-api]
  consumesApis: [inventory-api, payments-api]
`, 'catalog-info.yaml：API 與服務的關係')}
<ul>
  <li>規格（OpenAPI / AsyncAPI / gRPC）直接從 repo 讀取，<b>目錄與程式碼同步</b>。</li>
  <li><code>providesApis</code> / <code>consumesApis</code> 形成依賴圖：要淘汰 API 時，一眼看出影響哪些服務。</li>
  <li>可以掛上 CI 狀態、儀表板、On-call、技術文件等外掛。</li>
</ul>
`,
      qa: [
        ['API 目錄要怎麼避免變成沒人更新的過時文件？', '<p>讓目錄資料<b>來自程式碼</b>而不是人工維護：catalog-info.yaml 與 OpenAPI 放在服務 repo，隨 PR 一起更新；服務範本預設就產生這些檔案；CI 驗證檔案存在且格式正確；目錄自動從 repo 掃描匯入。再搭配從實際流量偵測未登記的 API，讓目錄反映真實狀態。</p>']
      ]
    },
    {
      id: 'governance-policies', title: 'Governance Policies', zh: '治理規則',
      html: `
<p>治理的目標是<b>一致性與安全性</b>，而不是官僚。最有效的方式是「鋪好的路」（Paved Road）：提供範本、函式庫、自動化檢查，讓遵守規範成為最省力的選擇。</p>
<h3>API 風格指南應涵蓋</h3>
<ul>
  <li>命名（資源複數、kebab-case 路徑、snake_case 欄位）</li>
  <li>分頁、篩選、排序的統一參數</li>
  <li>錯誤格式（RFC 9457）與錯誤碼命名</li>
  <li>認證方式、冪等鍵、限流 Header</li>
  <li>版本與棄用政策</li>
  <li>時間、金額、ID 的格式</li>
</ul>
${code('yaml', String.raw`
# .spectral.yaml
extends: ["spectral:oas"]
rules:
  paths-kebab-case:
    description: 路徑必須使用小寫與連字號
    severity: error
    given: "$.paths[*]~"
    then:
      function: pattern
      functionOptions:
        match: "^(/([a-z0-9-]+|\\{[a-z_]+\\}))+$"
  properties-snake-case:
    description: 欄位名稱必須是 snake_case
    severity: error
    given: "$..properties[*]~"
    then:
      function: casing
      functionOptions: { type: snake }
  operation-description:
    description: 每個操作都要有說明
    severity: warn
    given: "$.paths[*][get,post,put,patch,delete]"
    then: { field: description, function: truthy }
`, 'Spectral：把風格指南變成自動化檢查')}
${table(['做法', '說明'], [
  ['自動化優先', '能用 Lint 檢查的就不要靠人審查'],
  ['分級審查', '內部小改動自動通過；新對外 API、破壞性變更才需要設計審查'],
  ['提供範本與 SDK', '新服務範本內建認證、日誌、指標、錯誤格式'],
  ['清楚的擁有權', '每個 API 都有負責團隊與聯絡方式'],
  ['定期檢討規則', '規則要服務開發者，過時的規則要調整']
])}
`,
      qa: [
        ['如何推動 API 規範又不拖慢開發速度？', '<p>把規範變成工具：用 Spectral 在 PR 自動檢查並給出明確的修正建議；提供已內建規範的服務範本與共用函式庫，讓開發者不必自己實作；只對高風險變更（新的對外 API、破壞性變更）做人工設計審查，並設定回應時限。治理團隊的角色是「平台與顧問」，而不是「關卡」。</p>']
      ]
    },
    {
      id: 'dx', title: 'Developer Experience (DX)', zh: '開發者體驗',
      html: `
<p>API 的使用者是開發者。<b>DX</b> 決定了別人願不願意用你的 API、整合要花多久、會開多少客服工單。最重要的指標是 <b>Time to First Call（TTFC）</b>：從打開文件到第一次成功呼叫要多久。</p>
${table(['面向', '好的做法'], [
  ['上手', '5 分鐘快速開始、可複製的 curl 範例、自助取得測試金鑰'],
  ['文件', '每個端點都有範例、所有錯誤碼與處理建議、互動式試打'],
  ['錯誤訊息', '說明哪裡錯、怎麼修，附上文件連結與 request_id'],
  ['SDK', '主流語言的官方 SDK，從 OpenAPI 產生並人工潤飾'],
  ['測試', '沙盒 / 測試模式，可模擬各種情境（付款失敗、Webhook 重送）'],
  ['透明', 'Changelog、狀態頁、限流 Header（剩餘額度）'],
  ['支援', '社群論壇、技術支援管道、回應時間承諾']
])}
${code('json', String.raw`
{
  "type": "https://docs.shop.example/errors/insufficient_stock",
  "title": "庫存不足",
  "status": 409,
  "detail": "商品 p_123 目前庫存 1，請求數量 3。",
  "request_id": "req_7Gx2Qk",
  "suggestion": "請降低數量，或訂閱到貨通知 POST /v1/products/p_123/restock-alerts"
}
`, '好的錯誤訊息本身就是文件')}
${note('tip', '衡量 DX：TTFC、文件頁面跳出率、API 錯誤中 4xx 的比例（使用者用錯）、整合相關的客服工單數、SDK 下載與活躍使用量。定期找新手開發者做可用性測試，觀察他們卡在哪裡。')}
`,
      qa: [
        ['你會怎麼評估並改善一個 API 的開發者體驗？', '<p>先量測：TTFC、最常見的 4xx 錯誤（代表使用者最常用錯的地方）、客服工單主題、文件搜尋但找不到的關鍵字。再找幾位沒用過的開發者實際整合並觀察。改善通常從快速開始指南、錯誤訊息品質、範例程式與 SDK 著手，並把常見錯誤的修正方式直接寫進錯誤回應。改善後持續追蹤同樣的指標。</p>']
      ]
    }
  ],
  labs: [
    {
      title: '版本號該怎麼升？',
      desc: '依語意化版本（SemVer）判斷每個變更應該升 Major（破壞性）、Minor（相容的新功能）還是 Patch（相容的修正）。',
      render(root) {
        Course.ui.classify(root, {
          choices: ['Major（破壞性）', 'Minor（新增功能）', 'Patch（修正）'],
          items: [
            { html: '新增選填查詢參數 <code>?include=items</code>，讓列表一次帶回明細', answer: 1, explain: '新增選填參數不影響既有呼叫，是相容的新功能。' },
            { html: '修正錯誤訊息中的錯字', answer: 2, explain: '不改變契約的修正。（但若客戶端是用比對錯誤訊息字串判斷錯誤——這正是為什麼要提供穩定的錯誤碼。）' },
            { html: '移除 <code>GET /v1/legacy-export</code> 端點', answer: 0, explain: '移除端點會讓使用它的客戶端失敗，必須走棄用流程並在主版本變更中移除。' },
            { html: '新增 <code>POST /v1/refunds</code> 端點', answer: 1, explain: '新增端點是相容的新功能。' },
            { html: '把回應中的 <code>amount</code> 從數字改為字串', answer: 0, explain: '改變型別是破壞性變更。' },
            { html: '修正 bug：Cursor 分頁偶爾會重複回傳上一頁的最後一筆', answer: 2, explain: '讓行為符合文件描述的修正屬於 Patch。但若有客戶依賴錯誤行為，仍要在 Changelog 說明。' },
            { html: '在回應中新增 <code>currency</code> 欄位', answer: 1, explain: '對 Tolerant Reader 而言是相容的新增。' },
            { html: '列表預設排序從「最舊在前」改成「最新在前」', answer: 0, explain: '型別沒變，但行為改變會讓依賴預設順序的客戶端出錯，屬於破壞性變更。' }
          ]
        });
      }
    }
  ],
  quiz: [
    { q: '標示某個 API 將在特定日期停止服務的標準 HTTP Header 是？', options: ['Expires', 'Sunset', 'Retry-After', 'Cache-Control'], answer: 1, explain: 'Sunset（RFC 8594）標示停止服務的日期；Deprecation（RFC 9745）標示已棄用。' },
    { q: 'API 正式下線後，對仍在呼叫的請求最適合回什麼狀態碼？', options: ['200', '404', '410 Gone', '500'], answer: 2, explain: '410 明確表示資源已永久移除，並可附上遷移指南。' },
    { q: '在 API 淘汰流程中，「Brownout」是指？', options: ['永久刪除 API', '事先公告的短時間停用，讓還沒遷移的使用者發現', '降低回應速度', '關閉文件'], answer: 1, explain: 'Brownout 能讓沒注意到公告的使用者在正式停止前發現問題。' },
    { q: 'Spectral 主要用來做什麼？', options: ['壓力測試', '依規則自動檢查 OpenAPI 是否符合設計規範', '部署 API', '產生 JWT'], answer: 1, explain: 'Spectral 是 OpenAPI / AsyncAPI 的 Linter，可自訂組織的風格規則。' },
    { q: 'OWASP API9「資產管理不當」最典型的例子是？', options: ['密碼太短', '以為下線卻還在運行、沒人維護的舊版 API', '沒有壓縮', '使用 HTTP/2'], answer: 1, explain: 'Zombie / Shadow API 沒有安全修補，常成為攻擊入口。' },
    { q: '衡量開發者體驗最常用的指標之一 TTFC 是指？', options: ['Total Test File Count', 'Time to First Call：從開始到第一次成功呼叫所需時間', 'Token Time For Cache', 'Time to Fix Crash'], answer: 1, explain: 'TTFC 越短，代表文件、金鑰申請與範例越好用。' }
  ],
  sheet: [
    '組織要有一致的版本政策：破壞性變更定義、支援期間、版本數上限、Changelog。',
    '最好的版本策略是少開新版：設計時就預留擴充性，嚴格執行相容性檢查。',
    '生命週期：Beta → GA → Deprecated → Sunset → Retired（410 Gone）。',
    '淘汰：Deprecation + Sunset + Link Header、記錄仍在使用的客戶、提前 6–12 個月公告、Brownout。',
    '相容性自動化：oasdiff、Spectral、契約快照、Pact can-i-deploy、Schema Registry。',
    'API 目錄（Backstage catalog-info.yaml）資料來自 repo；providesApis / consumesApis 形成依賴圖。',
    'Shadow / Zombie API 是安全風險；從 Gateway 流量比對目錄找出未登記端點。',
    '治理靠「鋪好的路」：範本、函式庫、自動化 Lint；只對高風險變更做人工審查。',
    'DX：Time to First Call、可行動的錯誤訊息、SDK、沙盒、Changelog、狀態頁。'
  ]
});
