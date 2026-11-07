Course.register({
  id: 'm09', num: '09', title: 'API Performance', zh: 'API 效能',
  intro: '效能優化的第一原則是「先量測，再優化」。本模組介紹快取、壓縮、連線重用、非同步處理與負載平衡這些最有效的手段，以及如何用 Profiling 找出真正的瓶頸。',
  goals: [
    '依情境選擇快取策略，並處理快取雪崩、穿透與擊穿',
    '使用 HTTP 快取（Cache-Control、ETag）減少不必要的請求',
    '正確重用連線、避免阻塞 event loop、把耗時工作移到背景',
    '用百分位數判斷效能，並用 Profiler 與資料庫統計找出瓶頸'
  ],
  lessons: [
    {
      id: 'caching-strategies', title: 'Caching Strategies', zh: '快取策略',
      html: `
<p>快取可以放在每一層：瀏覽器 → CDN → API Gateway → 應用程式（Redis / 記憶體）→ 資料庫自身的緩衝。越靠近使用者越快，但也越難失效。</p>
${table(['模式', '讀取', '寫入', '適合'], [
  ['Cache-aside（旁路）', '應用程式先查快取，沒有再查 DB 並寫入快取', '寫 DB 後<b>刪除</b>快取', '最常見、最通用'],
  ['Read-through', '快取層自己去 DB 載入', '—', '使用支援此模式的快取函式庫'],
  ['Write-through', '—', '同時寫快取與 DB', '讀多、需要快取一直是最新'],
  ['Write-behind', '—', '先寫快取，非同步批次寫 DB', '寫入量極大、可容忍少量遺失'],
  ['Refresh-ahead', '在過期前主動更新', '—', '熱門且計算昂貴的資料']
])}
<h3>HTTP 快取</h3>
${table(['Header', '意思'], [
  ['<code>Cache-Control: public, max-age=300</code>', '任何快取（含 CDN）可保存 5 分鐘'],
  ['<code>Cache-Control: private, max-age=60</code>', '只有使用者瀏覽器可快取（個人化資料）'],
  ['<code>Cache-Control: no-store</code>', '完全不要快取（敏感資料）'],
  ['<code>ETag</code> + <code>If-None-Match</code>', '內容沒變就回 <code>304 Not Modified</code>，不傳 Body']
])}
${code('python', String.raw`
import hashlib, json
from fastapi import Request, Response

@app.get("/v1/products/{product_id}")
async def get_product(product_id: str, request: Request, response: Response):
    product = await products.get(product_id)
    body = json.dumps(product, sort_keys=True).encode()
    etag = '"' + hashlib.sha256(body).hexdigest()[:16] + '"'
    if request.headers.get("If-None-Match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
    return product
`, 'ETag 與 Cache-Control')}
${note('warn', '個人化或含權限的資料<b>絕不能</b>標成 <code>public</code>，否則 CDN 可能把 A 使用者的資料回給 B。')}
`,
      qa: [
        ['Cache-aside 寫入時為什麼「刪除快取」而不是「更新快取」？', '<p>兩個併發寫入可能以不同順序更新 DB 和快取，導致快取停在舊值。刪除快取讓下一次讀取從 DB 重新載入，比較不容易出現長期不一致，而且如果資料之後沒人讀，也省下寫快取的成本。仍有極小的競態視窗（讀到舊值後才寫回快取），可搭配短 TTL 或延遲雙刪降低影響。</p>']
      ]
    },
    {
      id: 'redis', title: 'Redis', zh: '記憶體資料庫',
      html: `
${table(['資料結構', '常見用途'], [
  ['String', '快取物件、計數器、分散式鎖'],
  ['Hash', '物件欄位（使用者 Session）'],
  ['List / Stream', '簡易佇列、事件串流'],
  ['Set', '去重、標籤、線上使用者'],
  ['Sorted Set', '排行榜、滑動窗口限流、延遲任務'],
  ['HyperLogLog', '近似不重複計數（UV）']
])}
<h3>三大快取問題</h3>
${table(['問題', '情境', '解法'], [
  ['雪崩（Avalanche）', '大量 key 同時過期，流量瞬間全打到 DB', 'TTL 加隨機抖動、多層快取、限流保護 DB'],
  ['穿透（Penetration）', '查詢根本不存在的資料，每次都打到 DB（常是攻擊）', '快取空結果（短 TTL）、Bloom Filter、參數驗證'],
  ['擊穿（Breakdown / Stampede）', '某個超熱門 key 過期瞬間，上千請求同時重建', '單一飛行（只讓一個請求重建，其他等待）、提前刷新']
])}
${code('python', String.raw`
import asyncio, json, random
import redis.asyncio as redis

r = redis.from_url("redis://localhost:6379")
_inflight: dict[str, asyncio.Future] = {}
MISSING = "__none__"

async def get_product_cached(pid: str):
    key = f"product:v2:{pid}"                                 # key 帶版本，格式改變時直接換新 key
    if (raw := await r.get(key)) is not None:
        return None if raw == MISSING.encode() else json.loads(raw)

    if key in _inflight:                                      # 同一個 process 內的單一飛行
        return await _inflight[key]
    fut = asyncio.get_running_loop().create_future()
    _inflight[key] = fut
    try:
        product = await db_get_product(pid)
        ttl = 300 + random.randint(0, 60)                     # 抖動，避免同時過期
        if product is None:
            await r.set(key, MISSING, ex=30)                  # 快取空結果，防穿透
        else:
            await r.set(key, json.dumps(product), ex=ttl)
        fut.set_result(product)
        return product
    except Exception as e:
        fut.set_exception(e)
        raise
    finally:
        _inflight.pop(key, None)
`, 'Cache-aside + TTL 抖動 + 空值快取 + 單一飛行')}
${note('info', '跨多台機器的擊穿防護可用 Redis 鎖（模組 08）只讓一個實例重建。Redis 記憶體滿時依 <code>maxmemory-policy</code> 淘汰資料，純快取用途常設為 <code>allkeys-lru</code>。')}
`,
      qa: [
        ['快取雪崩、穿透、擊穿有什麼不同？各怎麼處理？', '<p>雪崩是大量 key 同時失效（或快取整個掛掉），解法是 TTL 隨機化、多層快取、對 DB 限流與熔斷。穿透是查不存在的資料、快取永遠不命中，解法是快取空值、Bloom Filter、輸入驗證。擊穿是單一熱點 key 過期的瞬間大量請求同時重建，解法是單一飛行（互斥重建）、熱點資料提前刷新或永不過期＋背景更新。</p>']
      ]
    },
    {
      id: 'compression', title: 'Compression', zh: '壓縮',
      html: `
<p>JSON 是重複性很高的文字，壓縮後通常只剩 10–30%。客戶端以 <code>Accept-Encoding</code> 告知支援的格式，伺服器以 <code>Content-Encoding</code> 回應。</p>
${table(['演算法', '壓縮率', '速度', '說明'], [
  ['gzip', '好', '快', '支援最廣，預設選擇'],
  ['Brotli（br）', '更好（比 gzip 再小 15–25%）', '高等級時較慢', '適合靜態資源預先壓縮，動態回應用低等級'],
  ['zstd', '好', '非常快', '新興選擇，瀏覽器支援逐漸普及']
])}
${code('python', String.raw`
from fastapi.middleware.gzip import GZipMiddleware

app.add_middleware(GZipMiddleware, minimum_size=1000)   # 小於 1KB 不壓縮：省 CPU，效益也低
`, 'FastAPI 開啟 gzip')}
<ul>
  <li><b>不要壓縮</b>已壓縮的內容（JPEG、PNG、ZIP、影片）。</li>
  <li>壓縮常交給反向代理或 CDN 處理，應用程式專心處理業務。</li>
  <li>串流回應（SSE）要確認壓縮不會造成緩衝延遲。</li>
  <li>比壓縮更有效的是<b>少傳一點</b>：分頁、欄位選擇（<code>?fields=id,name</code>）、移除不必要的巢狀資料。</li>
</ul>
`,
      qa: [
        ['回應很大，你會先壓縮還是先做別的事？', '<p>先問「客戶端真的需要這麼多資料嗎？」：加上分頁、讓客戶端選擇欄位、拆分成摘要與詳細兩個端點，這通常比壓縮更有效，也同時降低資料庫與序列化成本。接著再開啟 gzip / brotli 壓縮（通常在代理層），並確認大於門檻才壓縮。最後才考慮換成 Protobuf 等二進位格式。</p>']
      ]
    },
    {
      id: 'connection-reuse', title: 'Connection Reuse', zh: '連線重用',
      html: `
<p>模組 01 算過：新的 HTTPS 連線要 2 個 RTT 以上。呼叫外部 API 時，如果<b>每個請求都建立新的 HTTP 客戶端</b>，就是在每次呼叫都付這筆成本。</p>
${code('python', String.raw`
from contextlib import asynccontextmanager
import httpx
from fastapi import FastAPI, Request

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 整個應用程式共用一個客戶端：內建連線池與 Keep-Alive
    app.state.http = httpx.AsyncClient(
        timeout=httpx.Timeout(5.0, connect=2.0),
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
        http2=True,                                   # 需要安裝 httpx[http2]
    )
    yield
    await app.state.http.aclose()

app = FastAPI(lifespan=lifespan)

@app.get("/v1/rates")
async def rates(request: Request):
    r = await request.app.state.http.get("https://fx.example.com/latest")
    r.raise_for_status()
    return r.json()

# ❌ 反例：每個請求都 new 一個客戶端，連線無法重用
# async with httpx.AsyncClient() as client:
#     await client.get(...)
`, '在應用程式生命週期中共用 HTTP 客戶端')}
<ul>
  <li>資料庫連線用連線池（模組 07）；Redis 客戶端也是同樣道理。</li>
  <li>官方 SDK（例如 LLM 的 Python SDK）內部也有連線池，<b>建立一次、全域重用</b>。</li>
  <li>設定連線池上限，避免對下游造成過大壓力。</li>
</ul>
`,
      qa: [
        ['為什麼不應該在每個請求中建立新的 HTTP 客戶端？', '<p>每個新客戶端都有自己的空連線池，代表每次呼叫都要重新 DNS 查詢、TCP 交握與 TLS 交握，延遲增加數十到數百毫秒，也會消耗大量檔案描述符與 CPU。高流量下還可能耗盡本機的暫時連接埠（TIME_WAIT 堆積）。正確做法是在應用程式啟動時建立一個客戶端並共用，設定合理的連線池上限與逾時。</p>']
      ]
    },
    {
      id: 'async-processing', title: 'Async Processing', zh: '非同步處理',
      html: `
<h3>1. async I/O：在等待時去做別的事</h3>
<p>API 大部分時間在等待資料庫、外部 API、LLM。<code>async</code> 讓一個行程在等待時處理其他請求。<b>關鍵是不要阻塞 event loop</b>：在 <code>async def</code> 裡呼叫同步的 <code>requests.get()</code> 或做大量 CPU 運算，會讓整個行程的所有請求一起卡住。</p>
${code('python', String.raw`
import asyncio

@app.get("/v1/dashboard")
async def dashboard(user=Depends(current_user)):
    # 三個獨立查詢平行執行：總時間 ≈ 最慢的那一個，而不是三者相加
    orders, notices, points = await asyncio.gather(
        orders_api.recent(user.id),
        notice_api.unread(user.id),
        loyalty_api.points(user.id),
    )
    return {"orders": orders, "notices": notices, "points": points}

@app.post("/v1/documents")
async def upload(file: UploadFile):
    data = await file.read()
    text = await asyncio.to_thread(parse_pdf, data)    # CPU 密集或同步函式庫丟到執行緒，不阻塞 event loop
    return {"chars": len(text)}
`, 'asyncio.gather 與 to_thread')}
<h3>2. 背景任務：讓使用者不必等</h3>
<p>產生報表、寄信、影片轉檔、批次呼叫 LLM——這些工作不該讓 HTTP 請求等著。回 <code>202 Accepted</code> 與任務 ID，交給背景 worker。</p>
${code('python', String.raw`
from arq import create_pool
from arq.connections import RedisSettings

@app.post("/v1/reports", status_code=202)
async def create_report(body: ReportIn, user=Depends(current_user)):
    job_id = f"report:{user.id}:{body.month}"                  # 用業務鍵當 job id，重複提交不會重複執行
    pool = await create_pool(RedisSettings())
    await pool.enqueue_job("build_report", user.id, body.month, _job_id=job_id)
    return {"job_id": job_id, "status_url": f"/v1/jobs/{job_id}"}

# worker.py
async def build_report(ctx, user_id: str, month: str):
    ...                                                        # 可能跑好幾分鐘，失敗時佇列會重試

class WorkerSettings:
    functions = [build_report]
    max_tries = 3
`, '用 Arq（基於 Redis 的 async 任務佇列）處理背景工作')}
${note('warn', 'FastAPI 的 <code>BackgroundTasks</code> 在同一個行程中執行，伺服器重啟就會遺失，只適合「失敗也沒關係」的小事（例如寫一筆非關鍵日誌）。重要工作要用持久化的任務佇列（Celery、Arq、RQ、Dramatiq）。')}
`,
      qa: [
        ['在 FastAPI 的 async def 端點裡呼叫同步的資料庫驅動會怎樣？', '<p>同步呼叫會阻塞 event loop，在它完成之前，這個 worker 行程的所有其他請求都無法被處理，吞吐量會急遽下降、延遲飆高。解法：改用非同步驅動（asyncpg、httpx.AsyncClient）；或把端點宣告成普通 <code>def</code>，FastAPI 會自動在執行緒池執行；或用 <code>asyncio.to_thread()</code> 包裝同步呼叫。</p>']
      ]
    },
    {
      id: 'load-balancing', title: 'Load Balancing', zh: '負載平衡',
      html: `
${table(['', 'L4（傳輸層）', 'L7（應用層）'], [
  ['看得到', 'IP、連接埠', 'HTTP 路徑、Header、Cookie'],
  ['能力', '轉發 TCP/UDP 連線，非常快', '依路徑路由、TLS 終止、重試、改寫 Header'],
  ['例子', 'AWS NLB', 'Nginx、Envoy、AWS ALB']
])}
${table(['演算法', '說明', '適合'], [
  ['Round Robin', '依序輪流', '每台機器規格相同、請求成本相近'],
  ['Weighted', '依權重分配', '機器規格不同、金絲雀發布'],
  ['Least Connections', '送給目前連線最少的', '請求處理時間差異大（如 LLM、長連線）'],
  ['Power of Two Choices', '隨機挑兩台，選負載較低的', '大規模下效果接近最佳、成本低'],
  ['一致性雜湊', '同一個 key 總是送到同一台', '有本機快取、WebSocket、分片']
])}
<ul>
  <li><b>健康檢查</b>：主動（定期打 <code>/healthz</code>）＋被動（觀察錯誤率），自動移除不健康的實例。</li>
  <li><b>連線排空（Draining）</b>：下線前停止分配新請求，等進行中的請求完成。</li>
  <li><b>全域負載平衡</b>：GeoDNS 或 Anycast 把使用者導到最近的區域。</li>
</ul>
`,
      qa: [
        ['後端是 LLM 推論服務，每個請求耗時從 1 秒到 60 秒不等，該用哪種負載平衡演算法？', '<p>Round Robin 會讓某些機器剛好累積很多長請求而過載。應使用 Least Connections（或 Least Outstanding Requests）、Power of Two Choices，讓請求優先送到目前負載較低的實例。若有 GPU 推論伺服器，還可依佇列長度或 KV Cache 使用率做更精細的路由，並設定每台的最大併發數，超過時排隊或回 429 / 503。</p>']
      ]
    },
    {
      id: 'profiling', title: 'Performance Profiling', zh: '效能分析',
      html: `
<h3>看百分位數，不要只看平均</h3>
<p>平均 100ms 可能代表 99% 請求 50ms、1% 請求 5 秒。<b>p95 / p99</b>（95% / 99% 的請求快於此值）才反映使用者的真實體驗。當一個頁面要呼叫 10 個服務，任一個慢就整頁慢——這叫<b>尾延遲放大</b>。</p>
${flow(['建立基準（壓測 + 指標）', '提出假設', '一次只改一件事', '再量測比較', '保留有效的改動'])}
${table(['工具', '用途'], [
  ['分散式追蹤（模組 13）', '找出請求時間花在哪個服務、哪個呼叫'],
  ['<code>py-spy</code>', '取樣式 Profiler，可附加到正式環境運行中的行程，產生火焰圖'],
  ['<code>pyinstrument</code> / <code>cProfile</code>', '開發時分析單一函式或請求'],
  ['<code>pg_stat_statements</code>', '找出資料庫中總耗時最高的查詢'],
  ['<code>EXPLAIN ANALYZE</code>', '分析單一查詢的執行計畫（模組 07）']
])}
${code('bash', String.raw`
# 對執行中的 Uvicorn 行程取樣 30 秒，輸出火焰圖
py-spy record --pid 12345 --duration 30 --output profile.svg

# 即時查看最耗時的函式（類似 top）
py-spy top --pid 12345
`, 'py-spy')}
${code('sql', String.raw`
-- 總耗時最高的前 10 個查詢（需要啟用 pg_stat_statements 擴充）
SELECT calls, round(total_exec_time) AS total_ms, round(mean_exec_time, 1) AS mean_ms, query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
`)}
${note('ex', '常見發現：一個列表 API 回傳 50 筆資料，卻執行了 51 次 SQL（N+1）。改用 JOIN 或一次 <code>WHERE id IN (...)</code> 後，p95 從 800ms 降到 60ms。')}
`,
      qa: [
        ['你會怎麼找出 API 的效能瓶頸？', '<p>先確認問題：哪個端點、哪個百分位數、從何時開始。用分散式追蹤看一個慢請求的時間分佈，定位是資料庫、外部呼叫還是應用程式本身。資料庫部分用 pg_stat_statements 找出最耗時查詢並 EXPLAIN；應用程式部分用 py-spy 產生火焰圖。改善後用相同的壓測情境比較前後的 p95 / p99，一次只改一件事，才知道哪個改動有效。</p>']
      ]
    }
  ],
  labs: [
    {
      title: '快取與延遲模擬器',
      desc: '模擬 4,000 個請求。調整快取命中率、資料庫延遲與容量，觀察平均值與 p99 的差異，以及命中率下降時資料庫如何被壓垮。（簡化的排隊模型）',
      render(root) {
        const { range, fmt } = Course.ui;
        root.innerHTML = `
<div class="controls">
  ${range('hit', '快取命中率', 0, 99, 1, 90, '%')}
  ${range('rps', '每秒請求數', 100, 5000, 100, 1500, '')}
  ${range('dbcap', '資料庫可承受 QPS', 100, 3000, 50, 600, '')}
  ${range('db', '資料庫查詢延遲（無負載時）', 5, 300, 5, 40, ' ms')}
  ${range('cache', 'Redis 延遲', 0.5, 10, 0.5, 1, ' ms')}
</div>
<div class="btn-row"><button type="button" class="btn" data-storm>模擬快取雪崩（命中率瞬間變 0）</button></div>
<div class="kpis cs-kpi"></div>
<div class="bars cs-bars"></div>
<div class="out cs-note" style="margin-top:12px"></div>`;
        const v = n => +root.querySelector('[name=' + n + ']').value;
        const randn = () => { let u = 0, w = 0; while (!u) u = Math.random(); while (!w) w = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w); };
        const ln = s => Math.exp(s * randn() - s * s / 2);
        const calc = () => {
          const h = v('hit') / 100, rps = v('rps'), cap = v('dbcap');
          const miss = rps * (1 - h), rho = miss / cap;
          const kpi = root.querySelector('.cs-kpi'), bars = root.querySelector('.cs-bars'), noteEl = root.querySelector('.cs-note');
          if (rho >= 1) {
            kpi.innerHTML = '<div class="kpi bad"><b>' + fmt(miss) + '</b><span>打到資料庫的 QPS</span></div><div class="kpi bad"><b>' + fmt(rho * 100) + '%</b><span>資料庫使用率</span></div><div class="kpi bad"><b>' + fmt((1 - cap / miss) * 100) + '%</b><span>預估逾時／失敗比例</span></div>';
            bars.innerHTML = '';
            noteEl.innerHTML = '<b class="bad">資料庫過載。</b> 請求進來的速度大於處理速度，佇列無限增長，延遲飆升直到逾時，甚至拖垮依賴同一資料庫的其他服務。對策：提高命中率、TTL 加抖動避免同時失效、對資料庫限流並快速失敗（模組 10 的斷路器）、擴充讀取副本。';
            return;
          }
          const dbEff = v('db') / Math.max(0.05, 1 - rho), c = v('cache');
          const s = [];
          for (let i = 0; i < 4000; i++) s.push(Math.random() < h ? c * ln(0.3) : c + dbEff * ln(0.6));
          s.sort((a, b) => a - b);
          const pct = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
          const mean = s.reduce((a, b) => a + b, 0) / s.length;
          const rows = [['平均', mean], ['p50', pct(0.5)], ['p95', pct(0.95)], ['p99', pct(0.99)]];
          const max = rows[3][1];
          kpi.innerHTML = '<div class="kpi"><b>' + fmt(miss) + '</b><span>打到資料庫的 QPS</span></div><div class="kpi ' + (rho > 0.8 ? 'bad' : '') + '"><b>' + fmt(rho * 100) + '%</b><span>資料庫使用率</span></div><div class="kpi"><b>' + fmt(dbEff, 1) + ' ms</b><span>含排隊的資料庫延遲</span></div>';
          bars.innerHTML = rows.map(([k, x]) => '<div class="bar-row"><span>' + k + '</span><span class="bar-track"><span class="bar-fill" style="left:0;width:' + (x / max * 100) + '%"></span></span><span class="bar-val">' + fmt(x, 1) + ' ms</span></div>').join('');
          noteEl.innerHTML = rho > 0.8
            ? '資料庫使用率超過 80%，<b>排隊延遲開始非線性增加</b>。命中率只要再掉幾個百分點，延遲就會急遽惡化。'
            : (pct(0.5) < 5 ? 'p50 很低（大多數請求命中快取），但 <b>p99 反映的是未命中的請求</b>，比 p50 高出 ' + fmt(pct(0.99) / pct(0.5)) + ' 倍。只看平均會低估使用者體驗的落差。' : '試著把命中率從 90% 調到 99%，看資料庫負載與 p95 的變化。');
        };
        root.addEventListener('input', calc);
        let t;
        root.querySelector('[data-storm]').onclick = () => {
          const el = root.querySelector('[name=hit]'), prev = el.value;
          el.value = 0; el.dispatchEvent(new Event('input', { bubbles: true }));
          clearTimeout(t);
          t = setTimeout(() => { el.value = prev; el.dispatchEvent(new Event('input', { bubbles: true })); }, 2500);
        };
        calc();
        return () => clearTimeout(t);
      }
    }
  ],
  quiz: [
    { q: '使用者的個人訂單資料應設定哪個 Cache-Control？', options: ['public, max-age=3600', 'private, max-age=60（或 no-store）', '不設定任何 Header', 's-maxage=86400'], answer: 1, explain: '個人化資料不能讓 CDN 等共享快取保存，否則可能把 A 的資料回給 B。' },
    { q: '大量快取 key 在同一時間過期，導致資料庫瞬間被打爆，這稱為？', options: ['快取穿透', '快取雪崩', '快取擊穿', '快取命中'], answer: 1, explain: '雪崩的解法包括 TTL 加隨機抖動、多層快取、保護資料庫的限流與熔斷。' },
    { q: '攻擊者大量查詢不存在的商品 ID，每次都打到資料庫。最直接的緩解是？', options: ['延長 TTL', '快取空結果（短 TTL）或使用 Bloom Filter', '關閉快取', '增加 CPU'], answer: 1, explain: '這是快取穿透。快取「不存在」這個結果，或用 Bloom Filter 先排除一定不存在的 key。' },
    { q: '在 FastAPI 的 async def 端點中直接呼叫 requests.get()（同步）會造成？', options: ['沒有影響', '阻塞 event loop，同一行程的其他請求都被卡住', '自動變成非同步', '只影響這一個請求'], answer: 1, explain: '同步 I/O 會霸佔 event loop。應改用 httpx.AsyncClient 或 asyncio.to_thread。' },
    { q: '後端每個請求的處理時間差異很大（1 秒到 60 秒），哪種負載平衡演算法較合適？', options: ['Round Robin', 'Least Connections', '固定送到第一台', 'IP Hash'], answer: 1, explain: 'Least Connections 依目前負載分配，避免某台累積過多長請求。' },
    { q: '下列哪個指標最能反映「少數使用者遇到很慢的請求」？', options: ['平均延遲', 'p50', 'p99', '總請求數'], answer: 2, explain: 'p99 是 99% 請求都比它快的值，能看到尾端延遲；平均值會被大量快速請求稀釋。' }
  ],
  sheet: [
    '先量測再優化；看 p95 / p99，不要只看平均；扇出越多，尾延遲放大越嚴重。',
    'Cache-aside 最通用：讀取未命中時載入，寫入後刪除快取；key 帶版本號。',
    'HTTP 快取：public / private / no-store、max-age、ETag + If-None-Match → 304。個人化資料不可 public。',
    '雪崩：TTL 抖動；穿透：空值快取 / Bloom Filter；擊穿：單一飛行、提前刷新。',
    '壓縮 JSON（> 1KB），交給代理層；但先想辦法少傳資料：分頁、欄位選擇。',
    'HTTP 客戶端、資料庫、Redis、SDK 都要建立一次、全域重用，設定連線上限與逾時。',
    '不要阻塞 event loop：async 驅動、gather 平行、to_thread 包同步；重工作用持久化任務佇列 + 202。',
    '負載平衡：長短差異大的請求用 Least Connections / P2C；健康檢查 + 連線排空。',
    'Profiling：追蹤定位 → py-spy 火焰圖 → pg_stat_statements → EXPLAIN；一次只改一件事。'
  ]
});
