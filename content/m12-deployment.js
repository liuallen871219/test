Course.register({
  id: 'm12', num: '12', title: 'API Deployment & Infrastructure', zh: 'API 部署與基礎設施',
  intro: '程式寫好只是開始。本模組從反向代理、API Gateway、Docker、Kubernetes 一路到 CI/CD、Service Mesh 與雲端部署選擇，讓你能把 API 安全、可重複、零停機地交付到正式環境。',
  goals: [
    '設定反向代理與 API Gateway，知道哪些職責該集中、哪些留在服務內',
    '寫出安全、精簡、可快取的多階段 Dockerfile',
    '在 Kubernetes 上設定探針、資源、優雅關閉與自動擴展',
    '建立 CI/CD 流程，並比較 Rolling、Blue-Green、Canary 部署策略'
  ],
  lessons: [
    {
      id: 'reverse-proxy', title: 'Reverse Proxy', zh: '反向代理',
      html: `
<p>反向代理站在應用程式前面，代替它處理與網路有關的雜事：<b>TLS 終止、路由、壓縮、緩衝、請求大小限制、逾時、靜態檔案</b>。常見選擇：Nginx、Caddy、Envoy、Traefik。</p>
${code('nginx', String.raw`
upstream app_upstream {
    server 10.0.1.11:8000;
    server 10.0.1.12:8000;
    keepalive 32;                              # 與後端保持連線，避免每次重新建立
}

server {
    listen 443 ssl;
    server_name api.shop.example;
    client_max_body_size 2m;                   # 限制請求大小

    location / {
        proxy_pass http://app_upstream;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }

    location /v1/chat/stream {                 # SSE / LLM 串流
        proxy_pass http://app_upstream;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;                   # 不緩衝，事件即時送出
        proxy_read_timeout 300s;
    }
}
`, 'Nginx 反向代理（含串流端點）')}
${note('warn', '應用程式在代理後面看到的來源 IP 都是代理的 IP。要從 <code>X-Forwarded-For</code> 取得真實 IP，但<b>只能信任來自你自己代理的 Header</b>，否則攻擊者可以偽造 IP 繞過 IP 限流。Uvicorn 用 <code>--proxy-headers --forwarded-allow-ips="10.0.0.0/8"</code> 設定信任範圍。')}
`,
      qa: [
        ['為什麼 FastAPI 前面通常還要放 Nginx 或負載平衡器？', '<p>應用程式伺服器（Uvicorn）專注在執行業務邏輯，不擅長處理大量慢速客戶端連線、TLS、壓縮與靜態檔案。反向代理能：終止 TLS 並集中管理憑證、緩衝慢速上傳下載保護應用程式 worker、限制請求大小、在多個實例間做負載平衡與健康檢查、統一設定逾時與安全 Header。在 Kubernetes 中這個角色由 Ingress Controller 或 Gateway 擔任。</p>']
      ]
    },
    {
      id: 'api-gateway', title: 'API Gateway', zh: 'API 閘道',
      html: `
<p>API Gateway 是所有外部請求的單一入口，集中處理<b>橫切關注點</b>，讓每個微服務不必重複實作。</p>
${table(['適合放在 Gateway', '應留在服務內'], [
  ['TLS、路由、API 版本對應', '業務規則與資料驗證'],
  ['身分驗證（驗證 JWT / API Key）', '物件層級授權（這筆訂單是不是你的）'],
  ['限流、配額、IP 封鎖', '交易與資料一致性'],
  ['請求日誌、指標、追蹤 ID 注入', '業務事件'],
  ['CORS、請求大小限制', '服務特定的錯誤處理']
])}
${code('yaml', String.raw`
_format_version: "3.0"
services:
  - name: orders
    url: http://orders.shop.svc.cluster.local:80
    routes:
      - name: orders-v1
        paths: ["/v1/orders"]
    plugins:
      - name: jwt                    # 驗證 Token
      - name: rate-limiting
        config:
          minute: 600
          policy: local
      - name: correlation-id         # 注入 Request ID
        config:
          header_name: X-Request-ID
`, 'Kong 宣告式設定範例')}
<ul>
  <li><b>產品</b>：Kong、Envoy Gateway、Tyk、AWS API Gateway、Google Apigee 等。</li>
  <li><b>BFF（Backend for Frontend）</b>：為特定前端（Web、App）聚合多個服務的資料，與 Gateway 不同，它包含展示邏輯。</li>
  <li><b>AI Gateway</b>：針對 LLM 流量的 Gateway，依 Token 限流、模型路由、快取、成本統計（模組 15）。</li>
</ul>
${note('warn', '不要把業務邏輯塞進 Gateway。它會變成所有團隊都要改、卻沒人擁有的瓶頸，也讓測試與部署變得困難。')}
`,
      qa: [
        ['API Gateway 已經驗證了 JWT，後端服務還需要驗證嗎？', '<p>建議仍要做至少一層：(1) 後端應只接受來自 Gateway 的流量（網路政策或 mTLS），否則繞過 Gateway 就等於沒有驗證；(2) 後端仍需做<b>物件層級授權</b>（這筆資料是否屬於該使用者），這是 Gateway 無法知道的；(3) 零信任架構下，服務會再驗證 Token 的簽章與 aud，成本很低（公鑰快取）。Gateway 負責粗粒度防護，服務負責細粒度授權。</p>']
      ]
    },
    {
      id: 'docker', title: 'Docker', zh: '容器化',
      html: `
${code('docker', String.raw`
# ---- 建置階段：安裝依賴 ----
FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv    # 正式專案建議固定 uv 版本
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project                 # 先只裝依賴：程式碼改動時這層可被快取
COPY src ./src
RUN uv sync --frozen --no-dev

# ---- 執行階段：只帶需要的東西 ----
FROM python:3.12-slim
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=builder --chown=app:app /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER app                                                           # 不要用 root 執行
EXPOSE 8000
CMD ["uvicorn", "shop.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
`, '多階段 Dockerfile（使用 uv）')}
${table(['原則', '原因'], [
  ['多階段建置', '最終映像檔不含編譯工具，更小、攻擊面更少'],
  ['先複製依賴描述檔再複製程式碼', '依賴沒變時重用快取層，建置快很多'],
  ['非 root 使用者', '容器被入侵時權限有限'],
  ['固定基底映像檔版本', '建置可重現，避免 latest 悄悄改變'],
  ['設定 <code>.dockerignore</code>', '避免把 .git、.env、測試資料打包進去'],
  ['設定從環境變數讀取', '同一個映像檔部署到所有環境（12-Factor）'],
  ['不要把密鑰寫進映像檔', '映像檔的每一層都能被讀出'],
  ['CI 中掃描漏洞', '例如 Trivy、Grype']
])}
${code('yaml', String.raw`
# docker-compose.yml — 本機開發一鍵啟動
services:
  api:
    build: .
    ports: ["8000:8000"]
    environment:
      DATABASE_URL: postgresql+asyncpg://shop:shop@db:5432/shop
      REDIS_URL: redis://redis:6379/0
    depends_on: [db, redis]
  db:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: shop, POSTGRES_PASSWORD: shop, POSTGRES_DB: shop }
  redis:
    image: redis:7-alpine
`)}
`,
      qa: [
        ['怎麼讓 Docker 映像檔更小、建置更快？', '<p>(1) 多階段建置，執行階段只複製虛擬環境與程式碼；(2) 使用 slim 或 distroless 基底；(3) 調整 COPY 順序，先複製 lock 檔安裝依賴，再複製程式碼，讓依賴層能被快取；(4) .dockerignore 排除不需要的檔案；(5) 合併 RUN 指令並清除套件管理器快取；(6) CI 中啟用 BuildKit 快取（例如 registry cache）。</p>']
      ]
    },
    {
      id: 'kubernetes', title: 'Kubernetes', zh: '容器編排',
      html: `
${code('yaml', String.raw`
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders
  namespace: shop
spec:
  replicas: 3
  strategy:
    rollingUpdate: { maxSurge: 1, maxUnavailable: 0 }    # 一次多開一個新的，舊的等新的就緒才關
  selector: { matchLabels: { app: orders } }
  template:
    metadata: { labels: { app: orders } }
    spec:
      terminationGracePeriodSeconds: 40
      containers:
        - name: api
          image: registry.example.com/shop/orders:1.8.3
          ports: [{ containerPort: 8000 }]
          envFrom:
            - configMapRef: { name: orders-config }
            - secretRef: { name: orders-secrets }
          resources:
            requests: { cpu: "250m", memory: "256Mi" }     # 排程依據
            limits:   { memory: "512Mi" }                  # 超過記憶體會被 OOMKill
          readinessProbe:                                  # 失敗 → 暫時不接流量
            httpGet: { path: /readyz, port: 8000 }
            periodSeconds: 5
          livenessProbe:                                   # 失敗 → 重啟容器
            httpGet: { path: /livez, port: 8000 }
            periodSeconds: 10
            failureThreshold: 3
          lifecycle:
            preStop:
              exec: { command: ["sleep", "10"] }           # 等負載平衡器把自己移除後再關閉
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: orders, namespace: shop }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: orders }
  minReplicas: 3
  maxReplicas: 30
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: 65 } }
`, 'Deployment + HPA')}
${table(['探針', '問的問題', '失敗時', '常見錯誤'], [
  ['readiness', '現在可以接流量嗎？', '從 Service 移除，不重啟', '—'],
  ['liveness', '程式是不是卡死了？', '重啟容器', '檢查資料庫連線 → 資料庫一慢，所有 Pod 被重啟，雪上加霜'],
  ['startup', '啟動完成了嗎？', '啟動期間暫停 liveness', '啟動慢的服務沒設，被 liveness 誤殺']
])}
<h3>優雅關閉</h3>
${flow(['Pod 被標記終止', 'preStop：sleep 讓 LB 移除', '送出 SIGTERM', '應用程式停止接新請求、完成進行中的請求', '逾時後 SIGKILL'])}
${note('tip', 'HPA 依 CPU 擴展不適合所有服務：處理佇列的 worker 應依<b>佇列長度</b>擴展（KEDA），LLM 推論服務可依<b>併發請求數</b>擴展。另外設定 PodDisruptionBudget，避免節點維護時一次停掉太多副本。')}
`,
      qa: [
        ['liveness 和 readiness probe 有什麼差別？liveness 應該檢查資料庫嗎？', '<p>readiness 決定 Pod 是否接收流量，失敗只會暫時移出 Service；liveness 決定容器是否要被重啟。liveness <b>不應</b>檢查資料庫等外部依賴：資料庫一變慢，所有 Pod 的 liveness 都失敗並同時重啟，服務完全中斷且無法自癒。liveness 只檢查行程本身是否健康（例如 event loop 是否還能回應）；依賴狀態可放在 readiness，但也要小心避免全部同時被移出。</p>']
      ]
    },
    {
      id: 'cicd', title: 'CI/CD', zh: '持續整合與部署',
      html: `
${flow(['Lint / 型別檢查', '單元測試', '建置映像檔', '整合 + 契約測試', '安全掃描', '部署 staging', 'Smoke / E2E', '正式環境（Canary）'])}
${code('yaml', String.raw`
name: ci
on:
  push: { branches: [main] }
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install uv && uv sync --frozen
      - run: uv run ruff check . && uv run mypy src
      - run: uv run pytest -m "not e2e" --maxfail=1          # 單元 + 整合（Testcontainers）
      - name: 檢查 API 破壞性變更
        run: |
          uv run python -m shop.export_openapi > openapi.json
          oasdiff breaking origin-openapi.json openapi.json --fail-on ERR

  build:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t registry.example.com/shop/orders:${"$"}{{ github.sha }} .
      - run: docker push registry.example.com/shop/orders:${"$"}{{ github.sha }}
`, 'GitHub Actions：測試、契約檢查、建置')}
<ul>
  <li><b>映像檔用 commit SHA 標記</b>，同一個映像檔從 staging 推進到 production，不重新建置。</li>
  <li><b>GitOps</b>（Argo CD、Flux）：把 Kubernetes 設定放在 Git，部署就是合併 PR，狀態可審查、可回滾。</li>
  <li><b>部署 ≠ 發布</b>：用功能開關讓程式先上線但不啟用，再逐步對使用者開放。</li>
  <li><b>資料庫遷移</b>獨立執行，且必須與新舊版本程式都相容（Expand and Contract）。</li>
</ul>
`,
      qa: [
        ['資料庫 Schema 變更如何搭配零停機部署？', '<p>滾動部署時新舊版本會同時運作，所以每次遷移都必須同時相容兩個版本。例如改欄位名稱要拆成多次部署：(1) 新增新欄位（可為 null），程式同時寫新舊欄位；(2) 回填資料；(3) 程式改讀新欄位；(4) 確認無誤後才移除舊欄位。遷移在部署前作為獨立步驟執行，大表的索引用 CONCURRENTLY，避免長時間鎖表。</p>']
      ]
    },
    {
      id: 'service-mesh', title: 'Service Mesh', zh: '服務網格',
      html: `
<p>Service Mesh 在每個服務旁邊（或節點層）放一個代理（通常是 Envoy），由控制平面統一設定，把<b>服務間通訊的能力從程式碼中抽出來</b>。</p>
${table(['功能', '說明'], [
  ['自動 mTLS', '每個服務都有身分憑證，自動加密與互相驗證（模組 04、05）'],
  ['流量管理', '重試、逾時、依比例切分流量（Canary）、鏡像流量'],
  ['韌性', '異常實例自動剔除（outlier detection，類似斷路器）'],
  ['可觀測性', '不改程式就能取得服務間的延遲、錯誤率、拓撲圖'],
  ['授權政策', '「只有 orders 服務能呼叫 payments 的 /charge」']
])}
${code('yaml', String.raw`
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata: { name: payments, namespace: shop }
spec:
  hosts: [payments]
  http:
    - route:
        - destination: { host: payments, subset: v1 }
          weight: 90
        - destination: { host: payments, subset: v2 }
          weight: 10                                    # 10% 流量給新版本
      timeout: 3s
      retries: { attempts: 2, perTryTimeout: 1s, retryOn: "5xx,reset,connect-failure" }
`, 'Istio：Canary 流量切分 + 逾時與重試')}
${note('warn', '代價：多一層代理帶來延遲與資源消耗、學習與維運成本高、除錯更複雜。服務數量少（例如 &lt; 10 個）時，用函式庫與 Gateway 通常就夠了。若同時在 Mesh 與程式中設定重試，要小心重試次數相乘（模組 10）。')}
`,
      qa: [
        ['什麼時候需要導入 Service Mesh？', '<p>當服務數量多、由多個團隊用不同語言開發，且需要統一的 mTLS、流量控制與可觀測性時——要在每種語言的函式庫裡一致地實作這些功能成本太高。若有合規要求所有內部流量加密，Mesh 也是最省力的方式。反之，服務少、團隊小、沒有零信任需求時，Mesh 的複雜度往往大於收益。</p>']
      ]
    },
    {
      id: 'cloud', title: 'Cloud Deployment', zh: '雲端部署',
      html: `
${table(['選項', '例子', '優點', '缺點'], [
  ['虛擬機', 'EC2、Compute Engine', '完全掌控', '自己管作業系統、擴展、修補'],
  ['託管容器平台', 'Cloud Run、ECS Fargate、Azure Container Apps', '只要給映像檔，自動擴展（可縮到 0）', '客製化能力有限、長連線有限制'],
  ['託管 Kubernetes', 'GKE、EKS、AKS', '彈性最大、生態最完整', '學習與維運成本高'],
  ['Serverless Function', 'Lambda、Cloud Functions', '按請求計費、免管伺服器', '冷啟動、執行時間限制、連線池困難']
])}
${code('bash', String.raw`
# 把映像檔部署到 Cloud Run（台灣區域 asia-east1）
gcloud run deploy orders \
  --image asia-east1-docker.pkg.dev/my-proj/shop/orders:1.8.3 \
  --region asia-east1 \
  --min-instances 1 --max-instances 20 \
  --concurrency 80 \
  --set-secrets DATABASE_URL=orders-db-url:latest
`, '託管容器平台：一行指令部署')}
<h3>上雲必備</h3>
<ul>
  <li><b>基礎設施即程式碼（IaC）</b>：Terraform / OpenTofu、Pulumi，環境可重建、變更可審查。</li>
  <li><b>託管資料服務</b>：資料庫（RDS、Cloud SQL）、快取、佇列交給雲端，備份與高可用設定好。</li>
  <li><b>多可用區</b>：至少跨兩個可用區部署，單一機房故障不中斷。</li>
  <li><b>密鑰管理</b>：Secret Manager / KMS，不放在環境變數檔或程式碼。</li>
  <li><b>成本監控</b>：設定預算告警；閒置資源、過大的規格、跨區流量都很燒錢。</li>
  <li><b>區域選擇</b>：考慮使用者延遲與資料落地法規。</li>
</ul>
`,
      qa: [
        ['新創公司的第一個 API 服務，你會怎麼選部署方式？', '<p>通常建議先用託管容器平台（Cloud Run、ECS Fargate）+ 託管資料庫：只要準備好 Dockerfile，就有自動擴展、HTTPS、滾動更新，維運成本最低，讓團隊專注在產品。等到服務數量、客製化需求（GPU、長連線、複雜網路）或成本規模讓它不再適合時，再遷移到 Kubernetes。因為一開始就容器化並用 IaC 管理，之後遷移的成本可控。</p>']
      ]
    }
  ],
  labs: [
    {
      title: '部署策略模擬器',
      desc: '選擇部署策略，決定新版本是否有 bug（不會讓健康檢查失敗的邏輯錯誤），按「開始部署」觀察受影響的使用者比例與所需資源。',
      render(root) {
        root.innerHTML = `
<div class="controls">
  <label class="fld"><span>部署策略</span><select name="st"><option value="rolling">Rolling Update（滾動）</option><option value="bg">Blue-Green（藍綠）</option><option value="canary">Canary（金絲雀）</option></select></label>
  <label class="fld"><span>新版本</span><select name="bug"><option value="0">沒有問題</option><option value="1">有 bug（錯誤率 30%）</option></select></label>
</div>
<div class="btn-row"><button type="button" class="btn primary" data-go>開始部署</button></div>
<div class="dep-view"></div>
<div class="kpis dep-kpi"></div>
<div class="log dep-log"></div>`;
        const OLD = 'v1', NEW = 'v2';
        const cell = c => '<span style="display:inline-grid;place-items:center;width:42px;height:30px;border-radius:6px;font:600 .72rem var(--mono);margin:2px;' +
          (c === OLD ? 'background:var(--surface-2);color:var(--muted)' : c === 'bad' ? 'background:var(--bad-weak);color:var(--bad);outline:1px solid var(--bad)' : c === NEW ? 'background:var(--accent-weak);color:var(--accent);outline:1px solid var(--accent)' : 'background:transparent;outline:1px dashed var(--border);color:var(--muted)') + '">' +
          (c === 'off' ? '—' : c === 'bad' ? 'v2✘' : c) + '</span>';
        const fill = (n, total, bug) => Array.from({ length: total }, (_, i) => i < n ? (bug ? 'bad' : NEW) : OLD);
        function frames(st, bug) {
          const F = [];
          if (st === 'rolling') {
            F.push({ rows: [['正式環境', fill(0, 10)]], v2: 0, extra: 10, msg: '開始滾動更新：每次替換 2 個實例（maxSurge）。' });
            for (let n = 2; n <= 10; n += 2) {
              F.push({ rows: [['正式環境', fill(n, 10, bug)]], v2: n * 10, extra: 20, msg: '替換到 ' + n + ' / 10 個實例，健康檢查通過。' + (bug ? ' 錯誤率上升到 ' + (n * 3) + '%' : '') });
              if (bug && n >= 4) {
                F.push({ rows: [['正式環境', fill(n, 10, bug)]], v2: n * 10, extra: 20, alert: true, msg: '⚠ 監控告警：錯誤率超過門檻，開始回滾（rollout undo）。' });
                for (let m = n - 2; m >= 0; m -= 2) F.push({ rows: [['正式環境', fill(m, 10, bug)]], v2: m * 10, extra: 20, msg: '回滾中：剩 ' + m + ' 個新版本實例。' });
                F.push({ rows: [['正式環境', fill(0, 10)]], v2: 0, extra: 0, done: '已回滾。回滾和部署一樣需要逐步替換，期間持續有使用者受影響。' });
                return F;
              }
            }
            F[F.length - 1].done = '部署完成。全程只需多 20% 的資源，但新舊版本會同時存在一段時間（API 必須相容）。';
          } else if (st === 'bg') {
            F.push({ rows: [['Blue（線上）', fill(0, 10)], ['Green', Array(10).fill('off')]], v2: 0, extra: 0, msg: 'Blue 環境服務所有流量。' });
            F.push({ rows: [['Blue（線上）', fill(0, 10)], ['Green', fill(10, 10, bug)]], v2: 0, extra: 100, msg: '建立完整的 Green 環境（需要 2 倍資源），執行 smoke test。' });
            F.push({ rows: [['Blue', fill(0, 10)], ['Green（線上）', fill(10, 10, bug)]], v2: 100, extra: 100, msg: '切換負載平衡器：100% 流量瞬間轉到 Green。' + (bug ? ' 錯誤率 30%，<b>所有使用者</b>都可能遇到錯誤。' : '') });
            if (bug) {
              F.push({ rows: [['Blue（線上）', fill(0, 10)], ['Green', fill(10, 10, bug)]], v2: 0, extra: 100, alert: true, msg: '⚠ 監控告警：立即切回 Blue（數秒內完成）。' });
              F.push({ rows: [['Blue（線上）', fill(0, 10)], ['Green', Array(10).fill('off')]], v2: 0, extra: 0, done: '已回滾。回滾極快，但切換那一刻影響的是 100% 使用者；且需要 2 倍資源。' });
            } else {
              F.push({ rows: [['Blue', Array(10).fill('off')], ['Green（線上）', fill(10, 10)]], v2: 100, extra: 0, done: '觀察無誤後關閉 Blue。新舊版本不會同時服務流量，但需要短暫的 2 倍資源。' });
            }
          } else {
            F.push({ rows: [['正式環境', fill(0, 10)]], v2: 0, extra: 0, msg: '開始金絲雀部署。' });
            F.push({ rows: [['正式環境', fill(1, 10, bug)]], v2: 10, extra: 10, msg: '1 個金絲雀實例接收 10% 流量，自動比較新舊版本的錯誤率與延遲。' });
            if (bug) {
              F.push({ rows: [['正式環境', fill(1, 10, bug)]], v2: 10, extra: 10, alert: true, msg: '⚠ 自動分析：金絲雀錯誤率 30%，舊版本 0.2% → 判定失敗。' });
              F.push({ rows: [['正式環境', fill(0, 10)]], v2: 0, extra: 0, done: '自動回滾。只有 10% 流量、短時間內受影響——這就是金絲雀的價值。' });
            } else {
              [3, 5, 10].forEach(n => F.push({ rows: [['正式環境', fill(n, 10)]], v2: n * 10, extra: 10, msg: '指標正常，擴大到 ' + (n * 10) + '% 流量。' }));
              F[F.length - 1].done = '部署完成。逐步放量需要較長時間，並依賴良好的監控與自動分析。';
            }
          }
          return F;
        }
        let timers = [];
        const run = () => {
          timers.forEach(clearTimeout); timers = [];
          const st = root.querySelector('[name=st]').value, bug = root.querySelector('[name=bug]').value === '1';
          const F = frames(st, bug);
          const logEl = root.querySelector('.dep-log'); logEl.innerHTML = '';
          let peak = 0;
          F.forEach((f, i) => timers.push(setTimeout(() => {
            root.querySelector('.dep-view').innerHTML = f.rows.map(([l, cells]) => '<div style="margin-bottom:6px"><div class="small muted">' + l + '</div>' + cells.map(cell).join('') + '</div>').join('');
            if (bug) peak = Math.max(peak, f.v2);
            root.querySelector('.dep-kpi').innerHTML = '<div class="kpi"><b>' + f.v2 + '%</b><span>新版本流量</span></div>' +
              '<div class="kpi ' + (bug && peak ? 'bad' : '') + '"><b>' + (bug ? peak + '%' : '0%') + '</b><span>受 bug 影響的流量（峰值）</span></div>' +
              '<div class="kpi"><b>+' + f.extra + '%</b><span>額外資源</span></div>';
            logEl.insertAdjacentHTML('beforeend', '<div class="' + (f.alert ? 'bad' : f.done ? 'ok' : 'info') + '">' + (i + 1) + '. ' + (f.done || f.msg) + '</div>');
            logEl.scrollTop = logEl.scrollHeight;
          }, i * 800)));
        };
        root.querySelector('[data-go]').onclick = run;
        run();
        return () => timers.forEach(clearTimeout);
      }
    }
  ],
  quiz: [
    { q: '在 Nginx 後面的應用程式要取得使用者真實 IP，下列何者正確？', options: ['直接讀取連線的來源 IP', '讀取 X-Forwarded-For，但只信任來自自己代理的值', '任何請求帶的 X-Forwarded-For 都可信任', '要求使用者在 Body 中提供 IP'], answer: 1, explain: '攻擊者可以自行加上 X-Forwarded-For，必須設定只信任特定代理位址。' },
    { q: '下列哪項<b>不適合</b>放在 API Gateway？', options: ['驗證 JWT 簽章', '限流與配額', '判斷這筆訂單是否屬於目前使用者', '注入 Request ID'], answer: 2, explain: '物件層級授權需要業務資料，應在服務內處理。' },
    { q: 'Dockerfile 中先 COPY 依賴描述檔並安裝依賴，再 COPY 程式碼，主要目的是？', options: ['讓映像檔更安全', '依賴沒變時可重用快取層，加快建置', '讓容器以非 root 執行', '減少執行時記憶體'], answer: 1, explain: 'Docker 以層為單位快取，程式碼常改、依賴不常改，所以把依賴層放前面。' },
    { q: 'liveness probe 檢查資料庫連線，資料庫變慢時會發生什麼？', options: ['沒有影響', '所有 Pod 被判定不健康而同時重啟，造成全面中斷', '自動擴充資料庫', '只有一個 Pod 重啟'], answer: 1, explain: 'liveness 不應依賴外部服務，否則一個依賴的問題會被放大成整個服務的停擺。' },
    { q: '新版本有 bug 時，哪種部署策略能讓<b>受影響的使用者最少</b>？', options: ['Blue-Green', 'Canary 搭配自動分析', '一次全部替換', '關閉監控直接部署'], answer: 1, explain: 'Canary 只讓少量流量先使用新版本，偵測到異常就自動回滾。' },
    { q: '下列關於 Service Mesh 的敘述何者正確？', options: ['任何規模都應該導入', '可在不改程式碼的情況下提供 mTLS、流量切分與可觀測性，但有複雜度與資源成本', '會取代資料庫', '只能用於 Serverless'], answer: 1, explain: '服務少時，Mesh 的成本常大於收益。' }
  ],
  sheet: [
    '反向代理：TLS 終止、路由、緩衝、大小限制、逾時；SSE 要關閉緩衝；只信任自己代理的 X-Forwarded-*。',
    'API Gateway 處理橫切關注點（認證、限流、路由、日誌）；業務邏輯與物件授權留在服務。',
    'Dockerfile：多階段、先裝依賴再複製程式碼、非 root、固定版本、.dockerignore、不放密鑰、掃描漏洞。',
    'K8s：requests/limits、readiness 控制流量、liveness 只檢查自身、startup 保護慢啟動、preStop + SIGTERM 優雅關閉。',
    'HPA 依 CPU；佇列 worker 依佇列長度（KEDA）；設定 PodDisruptionBudget。',
    'CI/CD：Lint → 測試 → 建置（SHA 標記）→ 契約與安全檢查 → staging → 正式；GitOps；部署 ≠ 發布。',
    'Rolling 省資源但新舊並存；Blue-Green 回滾快但需 2 倍資源；Canary 影響最小但需要好的監控。',
    'Service Mesh：自動 mTLS、流量切分、韌性、可觀測性；服務少時不一定值得。',
    '先選託管容器平台 + 託管資料庫；IaC、多可用區、Secret Manager、成本告警。'
  ]
});
