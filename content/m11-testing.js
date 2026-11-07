Course.register({
  id: 'm11', num: '11', title: 'API Testing', zh: 'API 測試',
  intro: '測試讓你有信心修改程式。本模組依測試金字塔由下而上：單元、整合、契約、端對端，再到負載測試與混沌工程，每一層都用 Python 工具實際示範。',
  goals: [
    '用 pytest 寫出快速、獨立的單元測試，並正確 Mock 外部依賴',
    '用 Testcontainers 對真實資料庫做整合測試',
    '用 Schemathesis 從 OpenAPI 自動產生測試，理解消費者驅動契約',
    '設計負載測試並用 Little\'s Law 解讀結果，以安全的方式進行混沌實驗'
  ],
  lessons: [
    {
      id: 'unit', title: 'Unit Testing', zh: '單元測試',
      html: `
${table(['層級', '數量', '速度', '測什麼'], [
  ['單元測試', '最多', '毫秒', '業務邏輯、計算、驗證規則'],
  ['整合測試', '中等', '秒', 'API + 資料庫 + 快取等真實元件'],
  ['契約測試', '中等', '秒', '服務之間的介面'],
  ['端對端測試', '最少', '分鐘', '關鍵使用者旅程']
])}
<p>單元測試的重點是<b>把業務邏輯從框架與 I/O 中抽離</b>，讓它可以被快速、大量地測試。</p>
${code('python', String.raw`
# pricing.py — 純函式，沒有 I/O，最容易測試
from decimal import Decimal

def order_total(items: list[tuple[Decimal, int]], coupon_pct: int = 0, shipping: Decimal = Decimal("60")) -> Decimal:
    subtotal = sum((price * qty for price, qty in items), Decimal("0"))
    discounted = subtotal * (100 - coupon_pct) / 100
    if discounted >= Decimal("1000"):
        shipping = Decimal("0")                              # 滿千免運
    return discounted.quantize(Decimal("1")) + shipping

# test_pricing.py
import pytest
from decimal import Decimal
from pricing import order_total

@pytest.mark.parametrize("items, coupon, expected", [
    ([(Decimal("500"), 1)], 0, Decimal("560")),              # 未滿千，加運費
    ([(Decimal("500"), 2)], 0, Decimal("1000")),             # 剛好滿千，免運
    ([(Decimal("1200"), 1)], 20, Decimal("1020")),           # 折扣後 960 未滿千 → 加運費
    ([], 0, Decimal("60")),                                  # 邊界：空購物車
])
def test_order_total(items, coupon, expected):
    assert order_total(items, coupon) == expected
`, 'parametrize：一次涵蓋正常、邊界與特殊情況')}
<h3>測試 API 層：替換依賴</h3>
${code('python', String.raw`
import pytest
import httpx
from app.main import app, get_payment_client

class FakePaymentClient:
    def __init__(self): self.charges = []
    async def charge(self, amount, key):
        self.charges.append((amount, key))
        return {"id": "ch_test", "status": "succeeded"}

@pytest.fixture
def fake_payments():
    fake = FakePaymentClient()
    app.dependency_overrides[get_payment_client] = lambda: fake     # FastAPI 的依賴替換
    yield fake
    app.dependency_overrides.clear()

@pytest.mark.anyio
async def test_pay_order_charges_once(fake_payments):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        for _ in range(2):                                           # 同一個冪等鍵送兩次
            r = await client.post("/v1/orders/ord_1/pay", headers={"Idempotency-Key": "k1"})
            assert r.status_code == 200
    assert len(fake_payments.charges) == 1                           # 只扣一次款
`, '用 dependency_overrides 注入 Fake，測試冪等行為')}
${note('tip', '優先使用 <b>Fake</b>（簡單的可運作替代品）而非過度設定的 Mock。Mock 太多的測試會綁死實作細節，重構時大量失敗卻抓不到真正的 bug。')}
`,
      qa: [
        ['怎樣算是好的單元測試？', '<p>快（毫秒級）、獨立（不依賴執行順序與外部服務）、可重複（不受時間、隨機數影響——需要時注入時鐘）、只測一個行為且名稱清楚描述該行為、測「行為」而非「實作」（重構時不必改測試）。涵蓋正常路徑、邊界值與錯誤情況。覆蓋率是參考指標，不是目標：100% 覆蓋率也可能沒有任何有意義的斷言。</p>']
      ]
    },
    {
      id: 'integration', title: 'Integration Testing', zh: '整合測試',
      html: `
<p>Mock 資料庫無法抓到 SQL 寫錯、索引缺失、交易隔離、約束衝突這類問題。整合測試用<b>真實的元件</b>驗證它們一起運作。</p>
${code('python', String.raw`
# conftest.py
import pytest
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from testcontainers.postgres import PostgresContainer

@pytest.fixture(scope="session")
def pg_url():
    with PostgresContainer("postgres:16-alpine") as pg:              # 測試期間啟動真正的 PostgreSQL
        yield pg.get_connection_url().replace("psycopg2", "asyncpg")

@pytest.fixture(scope="session")
async def engine(pg_url):
    eng = create_async_engine(pg_url)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)                 # 或執行 Alembic migration
    yield eng
    await eng.dispose()

@pytest.fixture
async def session(engine):
    async with engine.connect() as conn:
        trans = await conn.begin()
        s = async_sessionmaker(bind=conn, expire_on_commit=False)()
        yield s
        await s.close()
        await trans.rollback()                                       # 每個測試結束都回滾，互不影響

# test_inventory.py
@pytest.mark.anyio
async def test_reserve_never_oversells(session):
    await create_product(session, sku="kb-1", stock=1)
    first = await reserve(session, "kb-1", 1)
    second = await reserve(session, "kb-1", 1)
    assert first is True and second is False
`, 'Testcontainers：每次測試都用乾淨的真實 PostgreSQL')}
<ul>
  <li>Container 在整個測試 session 只啟動一次，每個測試用交易回滾隔離，速度可接受。</li>
  <li>CI 中可用 Docker 直接執行；也可用 <code>docker compose</code> 啟動 Redis、Kafka 等依賴。</li>
  <li>用與正式環境<b>相同版本</b>的資料庫映像檔。</li>
</ul>
`,
      qa: [
        ['資料庫相關的測試，你會 Mock 還是用真的資料庫？', '<p>業務邏輯的單元測試會把資料存取抽象成介面並用 Fake；但存取層本身（Repository、SQL、交易與鎖的行為）一定用真實資料庫測，因為 Mock 無法驗證 SQL 是否正確、約束是否生效、併發行為是否如預期。Testcontainers 讓這件事在本機與 CI 都很容易，搭配每個測試交易回滾保持速度與隔離。</p>']
      ]
    },
    {
      id: 'contract', title: 'Contract Testing', zh: '契約測試（實作）',
      html: `
<h3>Schema-based：Schemathesis</h3>
<p>Schemathesis 讀取你的 OpenAPI 規格，<b>自動產生大量測試輸入</b>（包含邊界值與奇怪的值），檢查 API 是否：不回 500、回應符合 Schema、狀態碼有在規格中宣告等。它常常能找出你沒想到的錯誤。</p>
${code('bash', String.raw`
# 對執行中的服務跑所有內建檢查
schemathesis run http://localhost:8000/openapi.json --checks all

# 常見發現：
#  - 某個欄位送超長字串 → 500（應該是 422）
#  - 回應少了規格中標記為 required 的欄位
#  - 回傳了規格沒宣告的狀態碼
`, 'Schemathesis：基於屬性的 API 測試')}
<h3>消費者驅動：Pact</h3>
<p>消費者（例如訂單服務）在自己的測試中描述「我會送什麼、期待收到什麼」，產生契約檔；提供者（庫存服務）的 CI 下載所有消費者的契約並對實際服務重播驗證。</p>
${code('json', String.raw`
{
  "consumer": {"name": "order-service"},
  "provider": {"name": "inventory-service"},
  "interactions": [{
    "description": "reserve stock for an order",
    "providerState": "sku kb-1 has 5 units",
    "request": {"method": "POST", "path": "/v1/reservations",
                "body": {"sku": "kb-1", "quantity": 2, "order_id": "ord_1"}},
    "response": {"status": 201,
                 "body": {"reservation_id": "res_123", "remaining": 3}}
  }]
}
`, 'Pact 契約檔（由消費者測試自動產生）')}
${flow(['消費者 CI：產生契約', '上傳 Pact Broker', '提供者 CI：驗證所有契約', 'can-i-deploy 檢查', '部署'])}
${note('tip', '提供者從契約可以知道<b>哪些欄位真的有人在用</b>，移除沒人用的欄位就很安心；反之，改動被依賴的欄位會讓提供者自己的 CI 失敗。')}
`,
      qa: [
        ['Schemathesis 和 Pact 有什麼不同？', '<p>Schemathesis 以提供者的 OpenAPI 為契約，自動產生輸入去「打」API，驗證實作符合規格、找出崩潰與 Schema 不符——它保證「API 做到了規格說的」。Pact 以消費者的實際期望為契約，驗證「提供者滿足每個消費者真正依賴的部分」。前者適合對外 API 與規格驗證，後者適合內部多服務間的相容性；兩者可以並用。</p>']
      ]
    },
    {
      id: 'e2e', title: 'End-to-End Testing', zh: '端對端測試',
      html: `
<p>E2E 測試在<b>部署好的完整環境</b>中，模擬使用者完成一整段旅程。它最接近真實，但也最慢、最脆弱、最難除錯，所以數量要少，只涵蓋<b>最關鍵的流程</b>。</p>
${code('python', String.raw`
import os, uuid
import httpx
import pytest

BASE = os.environ["E2E_BASE_URL"]            # 例如 staging 環境

@pytest.mark.e2e
def test_checkout_journey():
    with httpx.Client(base_url=BASE, timeout=10) as c:
        email = f"e2e+{uuid.uuid4().hex[:8]}@example.com"          # 每次用新帳號，避免互相干擾
        assert c.post("/v1/users", json={"email": email, "password": "e2e-Passw0rd!!", "display_name": "E2E"}).status_code == 201
        token = c.post("/v1/auth/token", data={"username": email, "password": "e2e-Passw0rd!!"}).json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}

        order = c.post("/v1/orders", json={"items": [{"product_id": "p_test", "quantity": 1}]}, headers=h).json()
        pay = c.post(f"/v1/orders/{order['id']}/pay", headers={**h, "Idempotency-Key": str(uuid.uuid4())})
        assert pay.status_code == 200

        status = c.get(f"/v1/orders/{order['id']}", headers=h).json()["status"]
        assert status in ("paid", "processing")                     # 最終一致：接受中間狀態
`, '關鍵旅程：註冊 → 登入 → 下單 → 付款')}
<ul>
  <li>使用專用的測試資料與帳號，測試後清理或定期重置環境。</li>
  <li>外部依賴（金流）用沙盒環境。</li>
  <li>失敗時保留完整日誌與 Trace ID，否則很難除錯。</li>
  <li>同一組腳本可以排程在正式環境執行，作為<b>合成監控</b>（Synthetic Monitoring）。</li>
</ul>
`,
      qa: [
        ['E2E 測試常常不穩定（flaky），你會怎麼處理？', '<p>先找根因而不是一律重跑：常見原因有共享測試資料互相干擾（改用每次獨立的資料）、固定 sleep 等待非同步結果（改成有上限的輪詢條件）、外部依賴不穩（用沙盒或 stub）、環境資源不足。把不穩定的測試隔離並追蹤修復，同時減少 E2E 數量，把可以下放的驗證移到整合或契約測試層。</p>']
      ]
    },
    {
      id: 'load', title: 'Load Testing', zh: '負載測試',
      html: `
${table(['類型', '目的', '做法'], [
  ['Load test', '確認在預期流量下符合 SLO', '以目標流量持續 15–30 分鐘'],
  ['Stress test', '找出極限與失敗方式', '逐步加壓直到崩潰'],
  ['Spike test', '測試突然的流量尖峰', '瞬間拉高到數倍'],
  ['Soak test', '找出記憶體洩漏、連線耗盡', '中等流量持續數小時']
])}
${code('python', String.raw`
# locustfile.py — 執行：locust -f locustfile.py --host https://staging.api.shop.example
from locust import HttpUser, task, between

class Shopper(HttpUser):
    wait_time = between(1, 3)                       # 每個虛擬使用者的思考時間

    def on_start(self):
        r = self.client.post("/v1/auth/token", data={"username": "load@example.com", "password": "..."})
        self.client.headers["Authorization"] = "Bearer " + r.json()["access_token"]

    @task(10)
    def browse(self):
        self.client.get("/v1/products?limit=20", name="/v1/products")

    @task(3)
    def view_product(self):
        self.client.get("/v1/products/p_123", name="/v1/products/{id}")

    @task(1)
    def checkout(self):
        self.client.post("/v1/orders", json={"items": [{"product_id": "p_123", "quantity": 1}]})
`, 'Locust：用 Python 描述使用者行為（任務權重模擬真實比例）')}
${code('js', String.raw`
// k6：在 thresholds 中直接寫通過標準，CI 中不達標就失敗
export const options = {
  stages: [{ duration: "2m", target: 200 }, { duration: "10m", target: 200 }, { duration: "2m", target: 0 }],
  thresholds: { http_req_duration: ["p(95)<300", "p(99)<800"], http_req_failed: ["rate<0.01"] },
};
`, 'k6 的階段與門檻')}
<h3>Little's Law</h3>
<p><b>L = λ × W</b>：系統中同時進行的請求數 = 每秒請求數 × 平均回應時間。1,000 RPS、平均 200ms → 同時有 200 個請求在處理中。若每個 worker 只能同時處理 1 個，你至少需要 200 個 worker。到「互動實驗」看延遲在接近容量上限時如何暴增。</p>
`,
      qa: [
        ['你會怎麼規劃一次負載測試？', '<p>(1) 定目標：預期尖峰流量與 SLO（例如 p95 &lt; 300ms、錯誤率 &lt; 1%）；(2) 依正式環境的流量比例設計情境（瀏覽:下單 = 10:1）；(3) 在規格接近正式環境的環境執行，資料量也要接近；(4) 先暖機，再逐步加壓；(5) 同時觀察應用程式、資料庫、快取的指標，找出第一個飽和的資源；(6) 記錄結果作為基準，每次重大變更後重跑比較。</p>']
      ]
    },
    {
      id: 'chaos', title: 'Chaos Engineering', zh: '混沌工程',
      html: `
<p>混沌工程是<b>有計畫地注入故障</b>，驗證系統的韌性機制（重試、斷路器、降級、自動修復）真的有效——在真正的事故發生之前。</p>
${flow(['定義穩態（例如結帳成功率 > 99.5%）', '提出假設（付款延遲 800ms 時穩態不變）', '最小爆炸半徑注入故障', '觀察指標', '修正弱點、自動化'])}
${code('yaml', String.raw`
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: payment-latency
  namespace: shop
spec:
  action: delay
  mode: all
  selector:
    namespaces: [shop]
    labelSelectors:
      app: payment
  delay:
    latency: "800ms"
    jitter: "200ms"
  duration: "5m"
`, 'Chaos Mesh：對付款服務注入 800ms 網路延遲 5 分鐘')}
${table(['實驗', '驗證'], [
  ['殺掉一個 Pod', '自動重建、流量無中斷（readiness probe、多副本）'],
  ['下游延遲 +800ms', '逾時與斷路器生效，非核心功能降級'],
  ['資料庫主節點故障切換', '連線池重連、錯誤率在可接受範圍內恢復'],
  ['Redis 完全不可用', '快取失效時資料庫撐得住（或限流保護）'],
  ['整個可用區斷線', '跨可用區部署是否真的有效']
])}
${note('warn', '從 staging 開始、在上班時間進行、事先通知相關團隊、準備好立即中止的方法。成熟後再到正式環境做小範圍實驗或舉辦「Game Day」演練。')}
`,
      qa: [
        ['混沌工程會不會太冒險？怎麼安全地開始？', '<p>混沌工程的目的就是用可控的方式，提早發現一定會在某天以不可控方式出現的問題。安全起步：先在 staging；定義清楚的穩態指標與中止條件；從最小的爆炸半徑（單一 Pod、單一服務、少量流量）開始；在團隊都在線的時間進行；每次實驗都有假設與結論，發現的弱點要排入修復。測試中也可以用 Toxiproxy 在整合測試注入延遲與斷線。</p>']
      ]
    }
  ],
  labs: [
    {
      title: '負載曲線模擬器',
      desc: '把每秒請求數往右拉，觀察系統接近容量上限時，延遲與錯誤率如何從平穩變成暴增。（以簡化的排隊模型估算）',
      render(root) {
        const { range, fmt } = Course.ui;
        root.innerHTML = `
<div class="controls">
  ${range('cap', '系統最大處理能力', 100, 2000, 50, 500, ' RPS')}
  ${range('base', '無負載時的處理時間', 10, 300, 5, 40, ' ms')}
  ${range('rps', '目前流量', 0, 2000, 10, 300, ' RPS')}
  ${range('to', '客戶端逾時', 500, 10000, 500, 2000, ' ms')}
</div>
<svg class="lt-chart" viewBox="0 0 640 280" style="width:100%;height:auto;display:block" role="img" aria-label="延遲對流量的曲線"></svg>
<div class="kpis lt-kpi"></div>
<div class="out lt-note"></div>`;
        const v = n => +root.querySelector('[name=' + n + ']').value;
        const model = (rps, cap, base, to) => {
          const rho = rps / cap;
          if (rho >= 0.999) return { p50: to, p99: to, err: 1 - cap / Math.max(rps, 1) + (rps ? 0 : 0), tput: cap, sat: true };
          const mean = base / (1 - rho);
          const p50 = Math.min(to, mean * Math.LN2), p99 = Math.min(to, mean * Math.log(100));
          const err = Math.exp(-to / mean);
          return { p50, p99, err, tput: rps * (1 - err), sat: false };
        };
        const draw = () => {
          const cap = v('cap'), base = v('base'), rps = v('rps'), to = v('to');
          const W = 640, H = 280, L = 48, R = 12, T = 14, B = 46, maxX = 2000, maxY = to * 1.1;
          const X = x => L + x / maxX * (W - L - R), Y = y => T + (1 - Math.min(y, maxY) / maxY) * (H - T - B);
          let p50 = '', p99 = '';
          for (let i = 0; i <= 160; i++) {
            const x = i / 160 * maxX, m = model(x, cap, base, to);
            p50 += (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(m.p50).toFixed(1);
            p99 += (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(m.p99).toFixed(1);
          }
          const ticksX = [0, 500, 1000, 1500, 2000].map(t => '<text x="' + X(t) + '" y="' + (H - B + 16) + '" text-anchor="middle" style="fill:var(--muted);font-size:11px">' + t + '</text>').join('');
          const ticksY = [0, 0.25, 0.5, 0.75, 1].map(f => { const y = to * f; return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(y) + '" y2="' + Y(y) + '" style="stroke:var(--border)"/><text x="' + (L - 6) + '" y="' + (Y(y) + 4) + '" text-anchor="end" style="fill:var(--muted);font-size:11px">' + fmt(y) + '</text>'; }).join('');
          root.querySelector('.lt-chart').innerHTML = ticksY + ticksX +
            '<line x1="' + X(cap) + '" x2="' + X(cap) + '" y1="' + T + '" y2="' + (H - B) + '" style="stroke:var(--bad);stroke-dasharray:4 4"/><text x="' + (X(cap) + 4) + '" y="' + (T + 10) + '" style="fill:var(--bad);font-size:11px">容量上限</text>' +
            '<path d="' + p99 + '" style="fill:none;stroke:var(--warn);stroke-width:2"/><path d="' + p50 + '" style="fill:none;stroke:var(--accent);stroke-width:2.5"/>' +
            '<line x1="' + X(rps) + '" x2="' + X(rps) + '" y1="' + T + '" y2="' + (H - B) + '" style="stroke:var(--text);stroke-width:1.5"/>' +
            '<text x="' + (L + 10) + '" y="' + (T + 44) + '" style="fill:var(--accent);font-size:11px">— p50</text><text x="' + (L + 10) + '" y="' + (T + 58) + '" style="fill:var(--warn);font-size:11px">— p99</text>' +
            '<text x="' + ((L + W - R) / 2) + '" y="' + (H - 6) + '" text-anchor="middle" style="fill:var(--muted);font-size:11px">每秒請求數（RPS）</text>' +
            '<text x="12" y="' + T + '" style="fill:var(--muted);font-size:11px">ms</text>';
          const m = model(rps, cap, base, to);
          const conc = m.tput * (m.p50 / Math.LN2) / 1000;
          root.querySelector('.lt-kpi').innerHTML =
            '<div class="kpi"><b>' + fmt(rps / cap * 100) + '%</b><span>使用率</span></div>' +
            '<div class="kpi"><b>' + fmt(m.p50) + ' ms</b><span>p50 延遲</span></div>' +
            '<div class="kpi ' + (m.p99 > to * 0.5 ? 'bad' : '') + '"><b>' + fmt(m.p99) + ' ms</b><span>p99 延遲</span></div>' +
            '<div class="kpi ' + (m.err > 0.01 ? 'bad' : 'good') + '"><b>' + fmt(m.err * 100, 1) + '%</b><span>逾時／失敗率</span></div>' +
            '<div class="kpi"><b>' + (m.sat ? '持續增加' : fmt(conc)) + '</b><span>同時處理中的請求（L = λW）</span></div>';
          const u = rps / cap;
          root.querySelector('.lt-note').innerHTML = u >= 1
            ? '<b class="bad">已超過容量。</b> 進來的請求比處理得快，佇列持續增長，延遲直接撞上逾時。此時應限流或負載削減，快速拒絕部分請求，而不是讓所有請求一起變慢。'
            : u > 0.8 ? '使用率超過 80%：<b>延遲開始非線性上升</b>，一點點流量波動就會造成明顯的延遲尖峰。容量規劃通常以 60–70% 作為正常上限。'
            : '系統運作在舒適區。持續向右拉，觀察曲線在接近容量上限前開始「翹起來」的位置。';
        };
        root.addEventListener('input', draw);
        draw();
      }
    },
    {
      title: '這該用哪種測試？',
      desc: '為每個要驗證的情境選擇最合適（最便宜又能有效抓到問題）的測試類型。',
      render(root) {
        Course.ui.classify(root, {
          choices: ['單元測試', '整合測試', '契約測試', '端對端測試', '負載測試', '混沌實驗'],
          items: [
            { html: '滿千免運、折扣碼、四捨五入等<b>價格計算規則</b>是否正確', answer: 0, explain: '純業務邏輯，用 parametrize 的單元測試最快最完整。' },
            { html: '<b>扣庫存的 SQL</b> 在兩個交易同時執行時不會超賣', answer: 1, explain: '需要真實資料庫的交易與鎖行為，Mock 抓不到。用 Testcontainers 整合測試。' },
            { html: '庫存服務改了回應格式後，<b>訂單服務是否還能正常解析</b>', answer: 2, explain: '服務間介面相容性正是契約測試（Pact）要解決的問題。' },
            { html: '使用者能否完成<b>註冊 → 下單 → 付款</b>的完整流程', answer: 3, explain: '跨多個服務的關鍵旅程，用少量 E2E 測試涵蓋。' },
            { html: '雙十一預估尖峰 3,000 RPS 時，<b>p95 是否仍低於 300ms</b>', answer: 4, explain: '需要模擬真實流量並量測延遲分布，這是負載測試。' },
            { html: '付款服務<b>延遲 800ms</b> 時，斷路器與降級是否如預期運作', answer: 5, explain: '刻意注入故障驗證韌性機制，屬於混沌實驗（也可在整合測試中用 Toxiproxy 小規模驗證）。' },
            { html: 'Email 格式錯誤時 API 回 422 且錯誤訊息指出欄位', answer: [0, 1], explain: '可用 API 層的單元測試（ASGITransport + 依賴替換）快速驗證；若涉及資料庫唯一約束才需要整合測試。' }
          ]
        });
      }
    }
  ],
  quiz: [
    { q: '依測試金字塔，哪一種測試數量應該最多？', options: ['端對端測試', '整合測試', '單元測試', '手動測試'], answer: 2, explain: '單元測試快、穩定、便宜，應占最大比例；端對端測試最慢最脆弱，只涵蓋關鍵流程。' },
    { q: '要驗證 SQL 交易在併發下不會超賣，最合適的做法是？', options: ['Mock 資料庫回傳值', '用 Testcontainers 啟動真實 PostgreSQL 做整合測試', '只做程式碼審查', '在正式環境直接試'], answer: 1, explain: '交易、鎖與約束的行為只有真實資料庫才能驗證。' },
    { q: 'Schemathesis 主要做什麼？', options: ['產生前端畫面', '依 OpenAPI 規格自動產生大量輸入測試 API', '部署服務', '監控正式環境'], answer: 1, explain: '它是基於屬性的測試工具，能找出伺服器 500、Schema 不符等問題。' },
    { q: '系統每秒處理 500 個請求、平均回應時間 0.4 秒，依 Little\'s Law 同時有多少請求在處理中？', options: ['200', '500', '1250', '125'], answer: 0, explain: 'L = λ × W = 500 × 0.4 = 200。' },
    { q: '長時間（數小時）以中等流量運行，目的是找出記憶體洩漏與連線耗盡，這稱為？', options: ['Spike test', 'Soak test', 'Smoke test', 'Unit test'], answer: 1, explain: 'Soak（浸泡）測試專門找出只有長時間運行才會出現的問題。' },
    { q: '開始進行混沌工程時，下列哪個做法<b>最不</b>恰當？', options: ['先在 staging 環境實驗', '定義穩態指標與中止條件', '第一次就在正式環境關掉整個資料庫', '從最小爆炸半徑開始'], answer: 2, explain: '混沌工程強調可控與漸進，從小範圍開始並隨時能中止。' }
  ],
  sheet: [
    '測試金字塔：大量單元 → 適量整合與契約 → 少量 E2E；再加上負載測試與混沌實驗。',
    '單元測試：抽離業務邏輯成純函式；parametrize 涵蓋邊界；優先用 Fake 而非過度 Mock。',
    'FastAPI：httpx.ASGITransport 直接測 app；dependency_overrides 注入替代品。',
    '整合測試：Testcontainers 啟動與正式環境相同版本的資料庫；每個測試交易回滾隔離。',
    'Schemathesis 依 OpenAPI 自動找出 500 與 Schema 不符；Pact 驗證消費者真正依賴的介面。',
    'E2E 只測關鍵旅程，用獨立資料、有上限的輪詢；同一腳本可當正式環境的合成監控。',
    '負載測試：Load / Stress / Spike / Soak；用 thresholds 定義通過標準；L = λ × W。',
    '使用率超過 ~80% 延遲非線性上升；容量規劃保留餘裕。',
    '混沌工程：定義穩態 → 假設 → 最小爆炸半徑注入 → 觀察 → 修正；從 staging 開始。'
  ]
});
