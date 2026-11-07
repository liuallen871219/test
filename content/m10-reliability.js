Course.register({
  id: 'm10', num: '10', title: 'API Reliability', zh: 'API 可靠性',
  intro: '依賴一定會失敗：資料庫變慢、第三方 API 逾時、LLM 服務過載。可靠的系統不是「不會失敗」，而是失敗時能限制影響範圍、自動恢復，並給使用者合理的結果。',
  goals: [
    '區分可重試與不可重試的錯誤，設計一致的錯誤回應',
    '實作指數退避 + 抖動的重試，並避免重試風暴',
    '用斷路器、逾時預算與艙壁隔離防止連鎖故障',
    '設計降級策略，讓核心功能在部分依賴故障時仍可運作'
  ],
  lessons: [
    {
      id: 'error-handling', title: 'Error Handling', zh: '錯誤處理',
      html: `
${table(['類別', '例子', '該重試嗎？'], [
  ['客戶端錯誤', '400、401、403、404、409、422', '❌ 不要，重試結果一樣'],
  ['限流', '429', '✅ 依 <code>Retry-After</code> 等待後重試'],
  ['暫時性伺服器錯誤', '502、503、504、連線重置、逾時', '✅ 退避後重試（操作需冪等）'],
  ['伺服器程式錯誤', '500（例如 NullPointer）', '⚠️ 通常重試也沒用，但無法和暫時性錯誤完全區分，可有限重試']
])}
<p>回應給客戶端的錯誤要<b>一致、可行動、不洩漏內部細節</b>：</p>
${code('python', String.raw`
import logging
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

log = logging.getLogger("api")

class AppError(Exception):
    status = 500
    code = "internal_error"
    title = "伺服器發生錯誤"

class NotFound(AppError):
    status, code, title = 404, "not_found", "找不到資源"

class InsufficientStock(AppError):
    status, code, title = 409, "insufficient_stock", "庫存不足"

class UpstreamUnavailable(AppError):
    status, code, title = 503, "upstream_unavailable", "服務暫時無法使用，請稍後再試"

def problem(request: Request, err: AppError, detail: str | None = None) -> JSONResponse:
    return JSONResponse(status_code=err.status, media_type="application/problem+json", content={
        "type": f"https://api.shop.example/problems/{err.code}",
        "title": err.title, "status": err.status, "detail": detail,
        "request_id": request.state.request_id,            # 讓客服與工程師能查到對應日誌
    }, headers={"Retry-After": "5"} if err.status == 503 else None)

@app.exception_handler(AppError)
async def app_error(request: Request, exc: AppError):
    return problem(request, exc, str(exc) or None)

@app.exception_handler(Exception)
async def unexpected(request: Request, exc: Exception):
    log.exception("unhandled error", extra={"request_id": request.state.request_id})
    return problem(request, AppError())                     # 不把堆疊或 SQL 回傳給客戶端
`, '例外階層 + 統一錯誤格式 + 不洩漏內部細節')}
`,
      qa: [
        ['API 發生未預期的例外時，應該回什麼給客戶端？', '<p>回 500 與統一格式的錯誤（例如 RFC 9457），只包含通用訊息與 request_id，<b>不要</b>回傳堆疊、SQL 或內部主機名稱——那會洩漏攻擊資訊（OWASP API8）。完整的錯誤細節與上下文寫入伺服器日誌與錯誤追蹤系統（如 Sentry），用 request_id 串起來，並觸發告警。</p>']
      ]
    },
    {
      id: 'retry-backoff', title: 'Retry & Backoff', zh: '重試與退避',
      html: `
<p>暫時性錯誤通常幾百毫秒後就恢復，重試能大幅提升成功率。但錯誤的重試會<b>放大故障</b>。</p>
<ul>
  <li><b>指數退避</b>：等待 0.2s、0.4s、0.8s…，給下游恢復的時間。</li>
  <li><b>加上抖動（Jitter）</b>：大量客戶端同時失敗時，若都在同一時間重試，會形成一波波尖峰。隨機化等待時間把流量攤平。</li>
  <li><b>限制次數與總時間</b>：例如最多 3 次、總共不超過 5 秒。</li>
  <li><b>尊重 Retry-After</b>：伺服器明確告訴你何時再試。</li>
  <li><b>只重試冪等操作</b>：POST 要搭配 Idempotency-Key（下一節）。</li>
</ul>
${code('python', String.raw`
import httpx
from tenacity import (retry, retry_if_exception, stop_after_attempt,
                      stop_after_delay, wait_exponential_jitter)

def is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, (httpx.ConnectError, httpx.ReadTimeout)):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in (429, 502, 503, 504)
    return False

@retry(
    retry=retry_if_exception(is_retryable),
    wait=wait_exponential_jitter(initial=0.2, max=3),      # 指數退避 + 抖動
    stop=(stop_after_attempt(3) | stop_after_delay(5)),    # 次數與總時間上限
    reraise=True,
)
async def get_shipping_quote(client: httpx.AsyncClient, payload: dict) -> dict:
    r = await client.post("https://logistics.example/v1/quotes", json=payload, timeout=2)
    r.raise_for_status()
    return r.json()
`, '用 tenacity 實作有界、有抖動的重試')}
<h3>重試風暴</h3>
<p>若前端、API Gateway、服務 A、服務 B 各自重試 3 次，最底層的服務可能收到 <b>3⁴ = 81 倍</b>的流量——在它最脆弱的時候。</p>
${note('tip', '原則：<b>只在一層重試</b>（通常是最接近失敗點的呼叫端），其他層直接把錯誤往上傳；並設定<b>重試預算</b>（例如重試流量不超過正常流量的 10%），超過就不再重試。許多官方 SDK（包括 LLM 的 SDK）已內建重試，不要再包一層。')}
`,
      qa: [
        ['為什麼重試要加上抖動（jitter）？', '<p>當下游短暫故障時，成千上萬個客戶端幾乎同時收到錯誤。如果它們都用相同的退避時間（例如固定 1 秒後重試），重試請求會在同一時間湧入，形成「驚群」，讓剛恢復的服務再次被打垮。加上隨機抖動能把重試分散在一段時間內，使負載平滑。AWS 建議的「Full Jitter」是在 0 到指數退避上限之間隨機取值。</p>']
      ]
    },
    {
      id: 'idempotency', title: 'Idempotency', zh: '冪等性（可靠性觀點）',
      html: `
<p>模組 02 談的是如何<b>設計</b>冪等鍵；這裡談的是：<b>重試的前提是冪等</b>。只要有逾時，就無法確定上一次是否成功，所以每一個會重試的寫入都必須能安全地重複執行。</p>
${table(['操作', '天然冪等？', '如何讓它冪等'], [
  ['<code>SET status = \'paid\'</code>', '✅', '—'],
  ['<code>SET balance = balance - 100</code>', '❌', '以交易 ID 記錄已處理，或改成「將餘額設為 X（若版本為 N）」'],
  ['INSERT 一筆訂單', '❌', '客戶端產生的 ID / Idempotency-Key + UNIQUE 約束'],
  ['寄出 Email', '❌', '以業務鍵（order_id + 類型）去重'],
  ['呼叫第三方扣款', '❌', '把<b>你自己的</b>冪等鍵傳給第三方（多數金流 API 支援）']
])}
${code('python', String.raw`
async def charge_for_order(saga_id: str, order: Order):
    # 冪等鍵由業務資料「決定性地」產生：同一筆訂單無論重試幾次都是同一個 key
    key = f"order-charge:{order.id}"
    return await payment_client.post(
        "/v1/charges",
        json={"amount": order.total_cents, "currency": order.currency, "reference": order.id},
        headers={"Idempotency-Key": key},
    )

# 資料庫端：用 UPSERT 讓「建立」變成冪等
# INSERT INTO shipments (order_id, status) VALUES ($1, 'scheduled')
# ON CONFLICT (order_id) DO NOTHING;
`, '把冪等鍵一路往下傳')}
${note('warn', '冪等鍵用 <code>uuid4()</code> 在<b>每次重試時重新產生</b>是常見錯誤——那就等於沒有冪等鍵。key 必須在第一次嘗試前產生，並在所有重試中保持不變。')}
`,
      qa: [
        ['呼叫第三方金流逾時了，你不知道是否扣款成功，該怎麼辦？', '<p>前提是呼叫時已帶上冪等鍵（由訂單 ID 決定性產生）。此時可以安全地用同一個 key 重試：若第一次其實成功，金流會回傳同一筆結果而不會重複扣款。若重試仍失敗，將訂單標記為「付款狀態未知」，由背景任務以訂單參考號查詢金流狀態對帳，而不是直接當作失敗並讓使用者再付一次。</p>']
      ]
    },
    {
      id: 'circuit-breaker', title: 'Circuit Breaker', zh: '斷路器',
      html: `
<p>當下游已經故障，繼續呼叫它只會：浪費資源等待逾時、讓下游更難恢復、拖慢自己的所有請求。<b>斷路器</b>偵測到失敗率過高時「跳脫」，直接快速失敗。</p>
${table(['狀態', '行為', '轉換條件'], [
  ['Closed（閉合）', '正常呼叫，統計失敗', '失敗率或連續失敗超過門檻 → Open'],
  ['Open（斷開）', '不呼叫下游，立即失敗或回傳降級結果', '經過冷卻時間 → Half-Open'],
  ['Half-Open（半開）', '放行少量試探請求', '成功 → Closed；失敗 → Open']
])}
${code('python', String.raw`
import time

class CircuitOpen(Exception):
    pass

class CircuitBreaker:
    def __init__(self, failure_threshold=5, reset_timeout=10.0):
        self.failure_threshold, self.reset_timeout = failure_threshold, reset_timeout
        self.failures, self.state, self.opened_at = 0, "closed", 0.0

    async def call(self, fn, *args, **kwargs):
        if self.state == "open":
            if time.monotonic() - self.opened_at < self.reset_timeout:
                raise CircuitOpen()                          # 快速失敗，不碰下游
            self.state = "half_open"                         # 冷卻結束，放一個試探請求
        try:
            result = await fn(*args, **kwargs)
        except Exception:
            self.failures += 1
            if self.state == "half_open" or self.failures >= self.failure_threshold:
                self.state, self.opened_at = "open", time.monotonic()
            raise
        self.failures, self.state = 0, "closed"
        return result

recommendation_breaker = CircuitBreaker(failure_threshold=5, reset_timeout=10)

async def get_recommendations(user_id: str) -> list:
    try:
        return await recommendation_breaker.call(reco_api.fetch, user_id)
    except (CircuitOpen, httpx.HTTPError):
        return await popular_items_cached()                  # 降級：回傳熱門商品
`, '最小可用的斷路器（正式環境可用函式庫或 Service Mesh 的 outlier detection）')}
${note('tip', '每個下游依賴各自一個斷路器；門檻最好用「滑動窗口內的失敗率 + 最低請求數」，避免低流量時一兩個錯誤就跳脫。到「互動實驗」比較有無斷路器的差異。')}
`,
      qa: [
        ['斷路器和重試有什麼關係？可以一起用嗎？', '<p>可以而且常一起用，但順序要對：重試處理「偶發的短暫錯誤」，斷路器處理「持續性故障」。通常斷路器包在重試的外層——斷路器 Open 時連重試都不做，直接快速失敗；Closed 時才允許有限次數的重試。若沒有斷路器，下游掛掉時每個請求都會重試到逾時，資源迅速耗盡並把故障傳遞到上游。</p>']
      ]
    },
    {
      id: 'timeouts', title: 'Timeout Management', zh: '逾時管理',
      html: `
<p><b>沒有逾時的網路呼叫是定時炸彈。</b>許多函式庫預設是無限等待（例如 Python 的 <code>requests</code>）。下游卡住時，你的 worker 會一個個被佔滿，最後整個服務停擺。</p>
<h3>逾時預算（Deadline）要逐層遞減</h3>
${table(['層級', '逾時', '說明'], [
  ['使用者瀏覽器', '10 秒', '使用者願意等待的上限'],
  ['API Gateway', '9 秒', '比客戶端短，才能回傳有意義的錯誤'],
  ['訂單服務', '8 秒（剩餘預算）', '呼叫庫存 + 付款要在這之內完成'],
  ['→ 庫存服務', '1 秒', ''],
  ['→ 付款服務', '5 秒', '第三方金流較慢'],
  ['→ 資料庫查詢', '2 秒（statement_timeout）', '避免慢查詢佔住連線']
])}
${code('python', String.raw`
import asyncio, time
import httpx

client = httpx.AsyncClient(timeout=httpx.Timeout(connect=1.0, read=3.0, write=3.0, pool=1.0))

async def place_order(cmd, deadline: float):
    async def remaining() -> float:
        left = deadline - time.monotonic()
        if left <= 0:
            raise TimeoutError("deadline exceeded")
        return left

    async with asyncio.timeout(await remaining()):              # Python 3.11+
        stock = await client.post(INVENTORY_URL, json=cmd.items, timeout=min(1.0, await remaining()))
        pay = await client.post(PAYMENT_URL, json=cmd.payment, timeout=min(5.0, await remaining()),
                                headers={"X-Request-Deadline": str(deadline)})   # 把剩餘預算傳給下游
        return stock.json(), pay.json()

# 資料庫端：每個連線設定查詢上限
# SET statement_timeout = '2s';
`, '逾時預算與傳遞')}
${note('info', 'LLM 呼叫可能需要數十秒甚至數分鐘。對這類請求：用串流（SSE）讓使用者先看到內容、設定較長但有上限的逾時、或改成非同步任務（202 + 狀態查詢）。')}
`,
      qa: [
        ['逾時時間該怎麼設定？', '<p>依據下游實際的延遲分布（例如 p99.9 再加一些餘裕），而不是隨便填 30 秒。整條呼叫鏈要有總預算，越下層越短，並把剩餘時間傳遞下去（gRPC 的 deadline 會自動傳遞）。區分連線逾時（通常很短，1–2 秒）與讀取逾時。資料庫要設 statement_timeout。逾時後要清楚區分「確定失敗」與「結果未知」，後者需要冪等重試或對帳。</p>']
      ]
    },
    {
      id: 'bulkhead', title: 'Bulkhead Pattern', zh: '艙壁隔離',
      html: `
<p>船艙用隔板分成多個艙室，一艙進水不會讓整艘船沉沒。<b>艙壁模式</b>把資源分隔，讓一個慢依賴不會耗盡所有資源。</p>
<p>情境：API 同時呼叫「推薦服務」與「付款服務」，共用 100 個併發名額。推薦服務變慢後，100 個名額全部卡在等推薦，連付款都無法處理。</p>
${code('python', String.raw`
import asyncio

class Bulkhead:
    def __init__(self, name: str, max_concurrent: int, max_wait: float = 0.05):
        self.name, self.sem, self.max_wait = name, asyncio.Semaphore(max_concurrent), max_wait

    async def run(self, coro_fn, *args):
        try:
            await asyncio.wait_for(self.sem.acquire(), timeout=self.max_wait)
        except TimeoutError:
            raise BulkheadFull(self.name)                 # 艙室已滿：快速失敗，不排隊
        try:
            return await coro_fn(*args)
        finally:
            self.sem.release()

payments_bulkhead = Bulkhead("payments", max_concurrent=50)
reco_bulkhead = Bulkhead("recommendations", max_concurrent=10)   # 非核心功能給較少名額
`, '每個依賴一個獨立的併發上限')}
${table(['隔離層級', '做法'], [
  ['依依賴', '每個下游各自的連線池、Semaphore'],
  ['依流量類型', '核心 API 與後台報表、批次任務部署在不同的實例群'],
  ['依租戶', '每個租戶的併發上限，避免單一大客戶拖垮所有人'],
  ['依資源', '不同 Kubernetes Node Pool、不同資料庫副本']
])}
`,
      qa: [
        ['艙壁模式和限流有什麼不同？', '<p>限流（Rate Limiting）控制的是「單位時間內的請求數」，通常用來保護自己不被外部濫用；艙壁控制的是「同時進行中的工作數」，用來隔離內部資源，避免一個慢依賴或一個大租戶佔滿所有 worker、連線或執行緒。兩者常搭配：外部用限流、內部對每個依賴用艙壁、對持續故障用斷路器。</p>']
      ]
    },
    {
      id: 'graceful-degradation', title: 'Graceful Degradation', zh: '優雅降級',
      html: `
<p>當部分系統故障時，<b>提供「次佳」的結果，而不是整頁錯誤</b>。前提是先區分核心與非核心功能。</p>
${table(['依賴故障', '降級方式'], [
  ['推薦服務', '顯示熱門商品（快取）'],
  ['評論服務', '隱藏評論區塊，商品頁照常顯示'],
  ['即時庫存', '顯示稍早快取的庫存，結帳時再確認'],
  ['搜尋引擎', '退回資料庫的簡單關鍵字查詢'],
  ['LLM 服務', '改用較小的備援模型、回傳預設回覆，或提示「AI 功能暫時無法使用」'],
  ['寫入服務過載', '把寫入放進佇列稍後處理，回 202']
])}
<h3>工具</h3>
<ul>
  <li><b>功能開關／Kill switch</b>：不必部署就能關閉非核心功能（模組 12）。</li>
  <li><b>過期但可用的資料</b>：<code>stale-while-revalidate</code>、保留上次成功的快取。</li>
  <li><b>負載削減（Load Shedding）</b>：過載時優先拒絕低優先級請求（例如背景同步），保住結帳流程。</li>
  <li><b>唯讀模式</b>：資料庫主節點故障時，仍允許瀏覽。</li>
</ul>
${code('python', String.raw`
@app.get("/v1/products/{pid}/page")
async def product_page(pid: str):
    product = await products.get(pid)                       # 核心：失敗就回錯誤
    reviews, reco = await asyncio.gather(
        safe(reviews_api.top(pid), default=None, timeout=0.3),      # 非核心：失敗或太慢就省略
        safe(reco_api.similar(pid), default=await popular_cached(), timeout=0.3),
    )
    return {"product": product, "reviews": reviews, "recommendations": reco,
            "degraded": reviews is None}

async def safe(coro, default, timeout: float):
    try:
        return await asyncio.wait_for(coro, timeout)
    except Exception:
        return default
`, '核心資料必須成功，非核心資料可降級')}
`,
      qa: [
        ['如何設計一個「部分功能故障時仍能運作」的商品頁 API？', '<p>先定義核心（商品資訊、價格、加入購物車）與非核心（推薦、評論、相關文章）。核心依賴失敗才回錯誤；非核心依賴各自設定短逾時、斷路器與降級預設值（快取的熱門商品、隱藏區塊），並在回應中標示 degraded 讓前端調整顯示與監控統計。搭配功能開關可在事故時手動關閉非核心功能，把資源留給核心流程。</p>']
      ]
    }
  ],
  labs: [
    {
      title: '斷路器模擬器',
      desc: '你的 API 每秒呼叫下游 5 次。成功的呼叫花 80ms，失敗的呼叫要等到 2 秒逾時。調高下游失敗率，比較有無斷路器時，有多少時間浪費在等待逾時。',
      render(root) {
        const { range, fmt } = Course.ui;
        root.innerHTML = `
<div class="controls">
  ${range('fail', '下游失敗率', 0, 100, 5, 0, '%')}
  ${range('th', '連續失敗幾次就斷開', 2, 10, 1, 4, ' 次')}
  ${range('cool', '斷開後冷卻時間', 1, 10, 1, 3, ' 秒')}
  <label class="fld"><span>斷路器</span><select name="on"><option value="1">啟用</option><option value="0">停用</option></select></label>
</div>
<div class="kpis cb-states"></div>
<div class="kpis cb-kpi"></div>
<p class="muted small">最近 80 個請求（綠＝成功、紅＝等待逾時後失敗、橘＝斷路器快速失敗並降級）</p><div class="dots cb-dots"></div>
<div class="log cb-log" style="margin-top:10px"></div>
<div class="btn-row"><button type="button" class="btn ghost" data-reset>重設統計</button></div>`;
        const v = n => +root.querySelector('[name=' + n + ']').value;
        let state = 'closed', fails = 0, openedAt = 0, ok = 0, bad = 0, fast = 0, wasted = 0;
        const hist = [];
        const log = (cls, m) => { const el = root.querySelector('.cb-log'); el.insertAdjacentHTML('afterbegin', '<div class="' + cls + '">' + new Date().toLocaleTimeString('zh-TW') + '  ' + m + '</div>'); while (el.children.length > 30) el.lastChild.remove(); };
        const setState = s => { if (s !== state) { log(s === 'open' ? 'bad' : s === 'half' ? 'warn' : 'ok', '狀態變更：' + label(state) + ' → ' + label(s)); state = s; } };
        const label = s => ({ closed: 'Closed', open: 'Open', half: 'Half-Open' }[s]);
        const draw = () => {
          const on = v('on') === 1;
          root.querySelector('.cb-states').innerHTML = [['closed', '正常呼叫下游'], ['open', '不呼叫下游，快速失敗'], ['half', '放行一個試探請求']].map(([k, l]) =>
            '<div class="kpi ' + (on && state === k ? (k === 'closed' ? 'good' : 'bad') : '') + '" style="' + (on && state === k ? 'outline:2px solid var(--accent)' : 'opacity:.6') + '"><b>' + label(k) + '</b><span>' + l + '</span></div>').join('');
          root.querySelector('.cb-kpi').innerHTML = '<div class="kpi good"><b>' + ok + '</b><span>成功</span></div><div class="kpi bad"><b>' + bad + '</b><span>逾時失敗</span></div><div class="kpi"><b>' + fast + '</b><span>快速失敗（降級）</span></div><div class="kpi ' + (wasted > 10 ? 'bad' : '') + '"><b>' + fmt(wasted, 1) + ' 秒</b><span>累計浪費在等待逾時的 worker 時間</span></div>';
          root.querySelector('.cb-dots').innerHTML = hist.map(h => '<i class="' + h + '"></i>').join('');
        };
        const tick = () => {
          const on = v('on') === 1, now = performance.now() / 1000;
          if (!on) state = 'closed';
          if (on && state === 'open') {
            if (now - openedAt >= v('cool')) setState('half');
            else { fast++; hist.push('f'); trim(); draw(); return; }
          }
          const failed = Math.random() * 100 < v('fail');
          if (failed) {
            bad++; wasted += 2; hist.push('x'); fails++;
            if (on && (state === 'half' || fails >= v('th'))) { setState('open'); openedAt = now; }
          } else {
            ok++; wasted += 0; hist.push(''); fails = 0;
            if (state === 'half') setState('closed');
          }
          trim(); draw();
        };
        const trim = () => { while (hist.length > 80) hist.shift(); };
        const timer = setInterval(tick, 200);
        root.querySelector('[data-reset]').onclick = () => { ok = bad = fast = wasted = 0; hist.length = 0; root.querySelector('.cb-log').innerHTML = ''; draw(); };
        draw();
        return () => clearInterval(timer);
      }
    }
  ],
  quiz: [
    { q: '下列哪個錯誤<b>不應該</b>自動重試？', options: ['503 Service Unavailable', '連線被重置', '422 欄位驗證失敗', '504 Gateway Timeout'], answer: 2, explain: '422 是客戶端送出的內容不合法，重試多少次結果都一樣。' },
    { q: '四層服務各自重試 3 次，最底層在最壞情況下可能收到幾倍流量？', options: ['3 倍', '12 倍', '81 倍', '不會增加'], answer: 2, explain: '3 × 3 × 3 × 3 = 81。應只在一層重試，並設定重試預算。' },
    { q: '使用冪等鍵重試付款時，下列何者是<b>錯誤</b>做法？', options: ['以訂單 ID 決定性地產生 key', '在第一次嘗試前產生 key，重試時沿用', '每次重試都用 uuid4() 產生新的 key', '把 key 傳給支援冪等的第三方金流'], answer: 2, explain: '每次都換新 key 等於沒有冪等保護，第三方會把重試當成新的扣款。' },
    { q: '斷路器處於 Open 狀態時會怎麼做？', options: ['照常呼叫下游', '不呼叫下游，直接快速失敗或回傳降級結果', '無限重試', '重新啟動下游服務'], answer: 1, explain: 'Open 時快速失敗可以保護自己的資源，也讓下游有時間恢復。冷卻後進入 Half-Open 試探。' },
    { q: '關於逾時設定，下列何者正確？', options: ['越下層的服務逾時應該越長', '整條呼叫鏈應有總預算，越下層越短，並傳遞剩餘時間', '只要設定資料庫逾時就夠了', 'HTTP 客戶端預設都有合理的逾時，不必設定'], answer: 1, explain: '上層要比下層更晚逾時，才能在下層逾時後回傳有意義的錯誤；很多函式庫預設無限等待。' },
    { q: '推薦服務變慢，導致付款 API 也因為 worker 被佔滿而無法回應。哪個模式最能直接避免這種情況？', options: ['壓縮', '艙壁隔離（每個依賴獨立的併發上限）', 'Cursor 分頁', 'CORS'], answer: 1, explain: '艙壁讓推薦服務最多只能佔用自己的名額，付款仍有獨立的資源。' }
  ],
  sheet: [
    '4xx（除 408、429）不重試；429 依 Retry-After；502/503/504 與連線錯誤退避後重試。',
    '錯誤回應一致（RFC 9457）+ request_id；不洩漏堆疊、SQL、內部主機。',
    '重試 = 指數退避 + 抖動 + 次數與總時間上限；只在一層重試並設重試預算；SDK 已內建就別再包。',
    '重試的前提是冪等：冪等鍵決定性產生、所有重試沿用、往下游傳遞；建立用 UPSERT。',
    '斷路器：Closed → Open（快速失敗）→ Half-Open（試探）；每個依賴一個；包在重試外層。',
    '每個網路呼叫都要有逾時；整條鏈有總預算、逐層遞減、傳遞剩餘時間；DB 設 statement_timeout。',
    '艙壁：每個依賴、流量類型、租戶各自的資源上限，滿了就快速失敗。',
    '優雅降級：區分核心與非核心；快取舊資料、預設值、隱藏區塊、功能開關、負載削減。'
  ]
});
