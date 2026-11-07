/* API Engineering 互動式課程 — 核心程式（路由、進度、測驗、共用元件） */
(function () {
  'use strict';

  const STORE_KEY = 'api-eng-course:v1';
  const PASS = 0.7;
  const modules = [];
  const byId = {};
  let cleanups = [];
  let searchIndex = [];

  /* ---------- 進度儲存（localStorage，失敗時仍可使用） ---------- */
  const defaults = () => ({ lessons: {}, quiz: {}, checks: {}, name: '', theme: '' });
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return Object.assign(defaults(), raw ? JSON.parse(raw) : {});
    } catch (e) { return defaults(); }
  }
  let state = load();
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 無法儲存時忽略 */ } }

  /* ---------- 共用 HTML 產生器（內容檔使用） ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const STR = String.raw`"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'`;
  const NUM = String.raw`\b\d+(?:\.\d+)?\b`;
  const kw = words => String.raw`\b(?:` + words.trim().split(/\s+/).join('|') + String.raw`)\b`;
  const RULES = {
    python: [
      ['c', String.raw`#[^\n]*`], ['s', STR], ['d', String.raw`@[A-Za-z_][\w.]*`],
      ['k', kw('and as assert async await break class continue def del elif else except finally for from global if import in is lambda None nonlocal not or pass raise return True False try while with yield match case')],
      ['n', NUM]
    ],
    sql: [
      ['c', String.raw`--[^\n]*`], ['s', String.raw`'(?:''|[^'])*'`],
      ['k', kw('select from where and or not insert into values update set delete create table index on primary key references unique null default begin commit rollback for join left right inner outer group by order having limit offset as returning if exists extension using alter add column constraint check cascade with isolation level serializable repeatable read committed transaction lock nowait skip locked explain analyze desc asc distinct count now in is between like true false row security policy enable')],
      ['n', NUM]
    ],
    bash: [
      ['c', String.raw`(?:^|\s)#[^\n]*`], ['s', STR],
      ['k', kw('if then fi for do done echo export curl docker kubectl pip uv git cd sudo openssl grpcurl k6 locust schemathesis npx helm')],
      ['n', NUM]
    ],
    yaml: [
      ['c', String.raw`#[^\n]*`], ['s', STR], ['p', String.raw`^\s*-?\s*[A-Za-z_][\w.\-/]*(?=\s*:)`],
      ['k', kw('true false null')], ['n', NUM]
    ],
    json: [
      ['p', String.raw`"(?:\\.|[^"\\])*"(?=\s*:)`], ['s', String.raw`"(?:\\.|[^"\\])*"`],
      ['k', kw('true false null')], ['n', String.raw`-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b`]
    ],
    js: [
      ['c', String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`], ['s', STR],
      ['k', kw('const let var function return if else for while new class import from export default async await try catch throw true false null undefined of in typeof')],
      ['n', NUM]
    ],
    proto: [
      ['c', String.raw`\/\/[^\n]*`], ['s', STR],
      ['k', kw('syntax package service rpc returns message stream repeated optional string int32 int64 bool double float bytes enum import')],
      ['n', NUM]
    ],
    graphql: [
      ['c', String.raw`#[^\n]*`], ['s', STR],
      ['k', kw('query mutation subscription type input schema fragment on enum interface implements')],
      ['n', NUM]
    ],
    http: [
      ['k', String.raw`^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|HTTP\/[\d.]+)\b`],
      ['p', String.raw`^[A-Za-z][\w-]*(?=:)`], ['s', String.raw`"(?:\\.|[^"\\])*"`], ['n', String.raw`\b\d{3}\b`]
    ],
    nginx: [
      ['c', String.raw`#[^\n]*`], ['s', STR],
      ['k', kw('server location listen proxy_pass proxy_set_header proxy_buffering proxy_read_timeout upstream server_name ssl_certificate ssl_certificate_key gzip return add_header limit_req limit_req_zone keepalive')],
      ['n', NUM]
    ],
    docker: [
      ['c', String.raw`#[^\n]*`], ['s', STR],
      ['k', String.raw`^\s*(?:FROM|RUN|COPY|WORKDIR|ENV|EXPOSE|CMD|ENTRYPOINT|USER|ARG|HEALTHCHECK|AS)\b|\bAS\b`]
    ],
    plain: []
  };
  const LANG_NAME = { python: 'Python', sql: 'SQL', bash: 'Shell', yaml: 'YAML', json: 'JSON', js: 'JavaScript', proto: 'Protocol Buffers', graphql: 'GraphQL', http: 'HTTP', nginx: 'Nginx', docker: 'Dockerfile', plain: 'Text' };

  function highlight(src, lang) {
    const rules = RULES[lang] || RULES.plain;
    if (!rules.length) return esc(src);
    const re = new RegExp(rules.map(r => '(' + r[1] + ')').join('|'), 'gm' + (lang === 'sql' || lang === 'docker' ? 'i' : ''));
    let out = '', last = 0, m;
    while ((m = re.exec(src))) {
      if (m[0] === '') { re.lastIndex++; continue; }
      let i = 1; while (m[i] === undefined) i++;
      out += esc(src.slice(last, m.index)) + '<span class="t-' + rules[i - 1][0] + '">' + esc(m[0]) + '</span>';
      last = re.lastIndex;
    }
    return out + esc(src.slice(last));
  }

  function dedent(src) {
    const lines = src.replace(/^\n+/, '').replace(/\s+$/, '').split('\n');
    const ind = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
    return lines.map(l => l.slice(ind)).join('\n');
  }

  function code(lang, src, title) {
    const body = dedent(src);
    return '<figure class="code"><figcaption><span>' + esc(title || LANG_NAME[lang] || lang) +
      '</span><button type="button" class="copy" data-copy>複製</button></figcaption><pre><code>' +
      highlight(body, lang) + '</code></pre></figure>';
  }

  function table(head, rows) {
    return '<div class="tbl"><table><thead><tr>' + head.map(h => '<th>' + h + '</th>').join('') +
      '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div>';
  }

  const NOTE_LABEL = { tip: '重點', warn: '常見錯誤', info: '補充', ex: '實務案例' };
  function note(kind, html) {
    return '<div class="note note-' + kind + '"><strong>' + NOTE_LABEL[kind] + '</strong><div>' + html + '</div></div>';
  }

  function flow(items) {
    return '<div class="flow">' + items.map((t, i) => (i ? '<span class="flow-arrow" aria-hidden="true">→</span>' : '') + '<span class="flow-step">' + t + '</span>').join('') + '</div>';
  }

  Object.assign(window, { esc, code, table, note, flow });

  /* ---------- 共用互動元件（實驗使用） ---------- */
  const fmt = (n, d = 0) => Number(n).toLocaleString('zh-TW', { maximumFractionDigits: d, minimumFractionDigits: d });

  function range(name, label, min, max, step, val, unit = '') {
    return '<label class="fld"><span>' + label + ' <output data-unit="' + esc(unit) + '">' + val + unit + '</output></span>' +
      '<input type="range" name="' + name + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '"></label>';
  }

  function classify(root, cfg) {
    const total = cfg.items.length;
    root.innerHTML = '<div class="classify">' + cfg.items.map((it, i) =>
      '<div class="cl-item" data-i="' + i + '"><div class="cl-q">' + it.html + '</div><div class="cl-choices">' +
      cfg.choices.map((c, j) => '<button type="button" class="chip" data-j="' + j + '">' + c + '</button>').join('') +
      '</div><div class="cl-explain" hidden></div></div>').join('') +
      '<div class="lab-foot"><span class="cl-score">已作答 0 / ' + total + '</span><button type="button" class="btn ghost" data-reset>重新開始</button></div></div>';
    let answered = 0, correct = 0;
    root.onclick = e => {
      if (e.target.closest('[data-reset]')) { classify(root, cfg); return; }
      const b = e.target.closest('.chip'); if (!b) return;
      const item = b.closest('.cl-item'); if (item.dataset.done) return;
      item.dataset.done = '1';
      const it = cfg.items[+item.dataset.i], j = +b.dataset.j, ans = [].concat(it.answer), ok = ans.includes(j);
      answered++; if (ok) correct++;
      b.classList.add(ok ? 'ok' : 'bad');
      if (!ok) item.querySelectorAll('.chip').forEach(x => { if (ans.includes(+x.dataset.j)) x.classList.add('ok'); });
      const ex = item.querySelector('.cl-explain');
      ex.hidden = false;
      ex.innerHTML = (ok ? '<strong class="good">答對了！</strong>' : '<strong class="bad">再想想：</strong>') + it.explain;
      root.querySelector('.cl-score').textContent = '已作答 ' + answered + ' / ' + total + '，答對 ' + correct + ' 題' + (answered === total && correct === total ? '，全對！' : '');
    };
  }

  function stepper(root, cfg) {
    let i = 0;
    root.innerHTML = '<div class="stepper"><div class="st-view"></div><div class="st-ctrl">' +
      '<button type="button" class="btn" data-prev>← 上一步</button><span class="st-count"></span>' +
      '<button type="button" class="btn primary" data-next>下一步 →</button>' +
      '<button type="button" class="btn ghost" data-reset>重來</button></div></div>';
    const view = root.querySelector('.st-view');
    const draw = () => {
      cfg.render(view, i);
      root.querySelector('.st-count').textContent = (i + 1) + ' / ' + cfg.count;
      root.querySelector('[data-prev]').disabled = i === 0;
      root.querySelector('[data-next]').disabled = i === cfg.count - 1;
    };
    root.querySelector('[data-prev]').onclick = () => { if (i > 0) { i--; draw(); } };
    root.querySelector('[data-next]').onclick = () => { if (i < cfg.count - 1) { i++; draw(); } };
    root.querySelector('[data-reset]').onclick = () => { i = 0; draw(); };
    draw();
    return { redraw: draw, reset: () => { i = 0; draw(); } };
  }

  /* 循序圖：actors = ['使用者', ...]，steps = [{from, to, label, detail}] */
  function sequence(root, cfg) {
    const n = cfg.actors.length;
    stepper(root, {
      count: cfg.steps.length,
      render(view, cur) {
        let rows = '';
        cfg.steps.slice(0, cur + 1).forEach((s, k) => {
          const a = Math.min(s.from, s.to), b = Math.max(s.from, s.to);
          const dir = s.from === s.to ? 'self' : (s.to > s.from ? 'right' : 'left');
          rows += '<div class="seq-row' + (k === cur ? ' cur' : '') + '" style="grid-template-columns:repeat(' + n + ',1fr)">' +
            '<div class="seq-arrow ' + dir + '" style="grid-column:' + (a + 1) + ' / ' + (b + 2) + ';--span:' + (b - a + 1) + '"><span>' + (k + 1) + '. ' + s.label + '</span></div></div>';
        });
        const s = cfg.steps[cur];
        view.innerHTML = '<div class="seq"><div class="seq-head" style="grid-template-columns:repeat(' + n + ',1fr)">' +
          cfg.actors.map(a => '<div class="seq-actor">' + a + '</div>').join('') + '</div>' +
          '<div class="seq-body" style="--n:' + n + '">' + rows + '</div></div>' +
          '<div class="st-detail"><h4>' + (cur + 1) + '. ' + s.label + '</h4>' + s.detail + '</div>';
        const body = view.querySelector('.seq-body'); body.scrollTop = body.scrollHeight;
      }
    });
  }

  /* ---------- 註冊與統計 ---------- */
  function register(m) {
    m.lessons.forEach((l, i) => { l.key = m.id + ':' + l.id; l.idx = m.num + '.' + (i + 1); });
    modules.push(m); byId[m.id] = m;
  }
  const lessonDone = l => !!state.lessons[l.key];
  const quizPassed = m => !!(state.quiz[m.id] && state.quiz[m.id].passed);
  function modStats(m) {
    const done = m.lessons.filter(lessonDone).length;
    const units = m.lessons.length + 1, got = done + (quizPassed(m) ? 1 : 0);
    return { done, total: m.lessons.length, quiz: quizPassed(m), pct: got / units, complete: got === units };
  }
  function allStats() {
    let lessons = 0, done = 0, quizzes = 0, passed = 0, labs = 0, qs = 0;
    modules.forEach(m => {
      lessons += m.lessons.length; done += m.lessons.filter(lessonDone).length;
      quizzes++; if (quizPassed(m)) passed++;
      labs += (m.labs || []).length; qs += m.quiz.length;
    });
    return { lessons, done, quizzes, passed, labs, qs, pct: (done + passed) / Math.max(1, lessons + quizzes) };
  }

  /* ---------- 版面 ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  let main;

  const PHASES = [
    ['基礎', ['m01', 'm02', 'm03']], ['身分與安全', ['m04', 'm05']], ['架構與資料', ['m06', 'm07', 'm08']],
    ['效能、可靠性與測試', ['m09', 'm10', 'm11']], ['部署與維運', ['m12', 'm13', 'm14']], ['AI 與實戰', ['m15', 'm16']]
  ];

  function buildSidebar() {
    const nav = $('#mod-nav');
    nav.innerHTML = '<a class="nav-home" href="#/">課程首頁</a>' + PHASES.map(([name, ids]) =>
      '<div class="nav-phase">' + name + '</div>' + ids.filter(id => byId[id]).map(id => {
        const m = byId[id];
        return '<a class="nav-mod" href="#/' + m.id + '" data-mod="' + m.id + '"><span class="nav-num">' + m.num +
          '</span><span class="nav-title">' + m.title + '<small>' + m.zh + '</small></span><span class="nav-bar"><i></i></span></a>';
      }).join('')).join('') + '<a class="nav-finish" href="#/finish" data-mod="finish">學習報告與結業證書</a>';
  }

  function updateSidebar(active) {
    $$('.nav-mod').forEach(a => {
      const m = byId[a.dataset.mod], s = modStats(m);
      a.querySelector('.nav-bar i').style.width = Math.round(s.pct * 100) + '%';
      a.classList.toggle('complete', s.complete);
    });
    if (active !== undefined) $$('#mod-nav a').forEach(a => a.classList.toggle('active', (a.dataset.mod || '') === active || (!active && a.classList.contains('nav-home'))));
    const st = allStats();
    $('#total-pct').textContent = Math.round(st.pct * 100) + '%';
    $('#total-bar').style.width = Math.round(st.pct * 100) + '%';
  }

  function nextTarget() {
    for (const m of modules) {
      const l = m.lessons.find(x => !lessonDone(x));
      if (l) return '#/' + m.id + '/learn/' + l.id;
      if (!quizPassed(m)) return '#/' + m.id + '/quiz';
    }
    return '#/finish';
  }

  /* ---------- 首頁 ---------- */
  function renderHome() {
    const st = allStats();
    $('#crumb').textContent = '課程首頁';
    main.innerHTML =
      '<section class="hero"><p class="eyebrow">API Engineering Roadmap</p><h1>從 HTTP 到 AI-Powered API<br>的後端工程師養成課程</h1>' +
      '<p class="lead">16 個模組、' + st.lessons + ' 節課、' + st.labs + ' 個互動實驗、' + st.qs + ' 題測驗。每一節都有概念、圖表、Python 範例與面試題，最後用 6 個真實專案把所學串起來。</p>' +
      '<div class="hero-cta"><a class="btn primary lg" href="' + nextTarget() + '">' + (st.done ? '繼續學習' : '開始第一課') + ' →</a>' +
      '<a class="btn lg" href="#/m16">先看實戰專案</a></div>' +
      '<div class="stat-row"><div class="stat"><b>' + Math.round(st.pct * 100) + '%</b><span>總進度</span></div>' +
      '<div class="stat"><b>' + st.done + ' / ' + st.lessons + '</b><span>已完成節數</span></div>' +
      '<div class="stat"><b>' + st.passed + ' / ' + st.quizzes + '</b><span>通過測驗</span></div></div></section>' +
      '<section class="how"><h2>怎麼使用這門課</h2><ol class="how-list">' +
      '<li><b>讀課程內容</b>：每節讀完按「標記完成」，進度會存在你的瀏覽器。</li>' +
      '<li><b>做互動實驗</b>：調參數、按步驟播放，親手看到概念如何運作。</li>' +
      '<li><b>通過小測驗</b>：答對 70% 以上即通過，可以重複作答。</li>' +
      '<li><b>完成實戰專案</b>：模組 16 的專案是能放進履歷、能在面試中說明的成果。</li></ol>' +
      note('tip', '範例程式以 <b>Python 3.12 + FastAPI</b> 撰寫。建議邊讀邊在本機建一個練習專案，把範例實際跑一次，比只看懂更有用。') + '</section>' +
      '<section class="roadmap"><h2>課程地圖</h2>' + PHASES.map(([name, ids]) =>
        '<div class="phase"><h3>' + name + '</h3><div class="mod-grid">' + ids.filter(id => byId[id]).map(id => {
          const m = byId[id], s = modStats(m);
          return '<a class="mod-card' + (s.complete ? ' complete' : '') + '" href="#/' + m.id + '"><span class="mc-num">' + m.num + '</span>' +
            '<span class="mc-title">' + m.title + '</span><span class="mc-zh">' + m.zh + '</span>' +
            '<span class="mc-meta">' + m.lessons.length + ' 節 · ' + (m.labs || []).length + ' 個實驗 · ' + m.quiz.length + ' 題</span>' +
            '<span class="mc-bar"><i style="width:' + Math.round(s.pct * 100) + '%"></i></span></a>';
        }).join('') + '</div></div>').join('') + '</section>';
  }

  /* ---------- 模組頁 ---------- */
  const TABS = [['learn', '課程內容'], ['labs', '互動實驗'], ['quiz', '小測驗'], ['sheet', '重點整理']];

  function renderModule(m, tab, anchor) {
    if (!TABS.some(t => t[0] === tab)) tab = 'learn';
    const s = modStats(m), idx = modules.indexOf(m), prev = modules[idx - 1], next = modules[idx + 1];
    $('#crumb').textContent = '模組 ' + m.num + ' · ' + m.title;
    main.innerHTML =
      '<header class="mod-head"><p class="eyebrow">模組 ' + m.num + '</p><h1>' + m.title + '</h1><p class="mod-zh">' + m.zh + '</p>' +
      '<p class="lead">' + m.intro + '</p><div class="goals"><h2>學習目標</h2><ul>' + m.goals.map(g => '<li>' + g + '</li>').join('') + '</ul></div>' +
      '<div class="mod-prog"><span class="mp-bar"><i style="width:' + Math.round(s.pct * 100) + '%"></i></span><span class="mp-text">' +
      s.done + ' / ' + s.total + ' 節完成 · 測驗' + (s.quiz ? '已通過' : '未通過') + '</span></div></header>' +
      '<nav class="tabs" role="tablist">' + TABS.map(([k, label]) =>
        '<a role="tab" href="#/' + m.id + '/' + k + '" class="' + (k === tab ? 'on' : '') + '" aria-selected="' + (k === tab) + '">' + label +
        (k === 'labs' ? ' <small>' + (m.labs || []).length + '</small>' : k === 'quiz' ? ' <small>' + m.quiz.length + '</small>' : '') + '</a>').join('') + '</nav>' +
      '<section class="tab-body"></section>' +
      '<nav class="pager">' + (prev ? '<a href="#/' + prev.id + '">← ' + prev.num + ' ' + prev.title + '</a>' : '<span></span>') +
      (next ? '<a href="#/' + next.id + '">' + next.num + ' ' + next.title + ' →</a>' : '<a href="#/finish">學習報告 →</a>') + '</nav>';
    const body = $('.tab-body', main);
    if (tab === 'learn') renderLessons(m, body, anchor);
    else if (tab === 'labs') renderLabs(m, body);
    else if (tab === 'quiz') renderQuiz(m, body);
    else renderSheet(m, body);
  }

  function refreshModHead(m) {
    const s = modStats(m);
    const bar = $('.mp-bar i', main), txt = $('.mp-text', main);
    if (bar) bar.style.width = Math.round(s.pct * 100) + '%';
    if (txt) txt.textContent = s.done + ' / ' + s.total + ' 節完成 · 測驗' + (s.quiz ? '已通過' : '未通過');
    updateSidebar();
  }

  function renderLessons(m, body, anchor) {
    body.innerHTML = '<ol class="toc">' + m.lessons.map(l =>
      '<li class="' + (lessonDone(l) ? 'done' : '') + '" data-key="' + l.key + '"><a href="#/' + m.id + '/learn/' + l.id + '"><span class="toc-idx">' + l.idx +
      '</span>' + l.title + ' <small>' + l.zh + '</small></a></li>').join('') + '</ol>' +
      m.lessons.map(l => {
        const qa = (l.qa || []).map(([q, a]) => '<details class="qa"><summary><span class="qa-tag">面試題</span>' + q + '</summary><div class="qa-a">' + a + '</div></details>').join('');
        const checks = l.checklist ? '<div class="checklist"><h3>需求檢核表</h3>' + l.checklist.map((c, i) => {
          const k = l.key + ':' + i;
          return '<label class="chk"><input type="checkbox" data-check="' + k + '"' + (state.checks[k] ? ' checked' : '') + '><span>' + c + '</span></label>';
        }).join('') + '<p class="chk-count"></p></div>' : '';
        return '<article class="lesson' + (lessonDone(l) ? ' done' : '') + '" id="L-' + m.id + '-' + l.id + '">' +
          '<header><span class="idx">' + l.idx + '</span><div><h2>' + l.title + '</h2><p class="zh">' + l.zh + '</p></div></header>' +
          '<div class="prose">' + l.html + '</div>' + qa + checks +
          '<footer><button type="button" class="btn done-btn" data-key="' + l.key + '">' + (lessonDone(l) ? '✓ 已完成（點擊取消）' : '標記完成') + '</button></footer></article>';
      }).join('');

    const updateChecks = () => $$('.checklist', body).forEach(c => {
      const all = $$('input', c), on = all.filter(x => x.checked).length;
      $('.chk-count', c).textContent = '完成 ' + on + ' / ' + all.length + ' 項';
    });
    updateChecks();

    body.addEventListener('click', e => {
      const b = e.target.closest('.done-btn'); if (!b) return;
      const key = b.dataset.key;
      if (state.lessons[key]) delete state.lessons[key]; else state.lessons[key] = Date.now();
      save();
      const done = !!state.lessons[key];
      b.textContent = done ? '✓ 已完成（點擊取消）' : '標記完成';
      b.closest('.lesson').classList.toggle('done', done);
      const li = $('.toc li[data-key="' + key + '"]', body); if (li) li.classList.toggle('done', done);
      refreshModHead(m);
      if (done) {
        const nextArt = b.closest('.lesson').nextElementSibling;
        if (nextArt && nextArt.classList.contains('lesson')) nextArt.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    body.addEventListener('change', e => {
      const c = e.target.closest('[data-check]'); if (!c) return;
      if (c.checked) state.checks[c.dataset.check] = 1; else delete state.checks[c.dataset.check];
      save(); updateChecks();
    });

    if (anchor) {
      const el = document.getElementById('L-' + m.id + '-' + anchor);
      if (el) requestAnimationFrame(() => { el.scrollIntoView({ block: 'start' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); });
    }
  }

  function renderLabs(m, body) {
    const labs = m.labs || [];
    if (!labs.length) { body.innerHTML = '<p class="empty">本模組的練習在課程內容的檢核表中。</p>'; return; }
    body.innerHTML = labs.map((lab, i) => '<section class="lab"><header><span class="lab-tag">實驗 ' + (i + 1) + '</span><h2>' + lab.title + '</h2></header>' +
      '<p class="lab-desc">' + lab.desc + '</p><div class="lab-root" data-lab="' + i + '"></div></section>').join('');
    labs.forEach((lab, i) => {
      const root = $('[data-lab="' + i + '"]', body);
      try {
        const c = lab.render(root);
        if (typeof c === 'function') cleanups.push(c);
      } catch (err) {
        root.innerHTML = '<p class="bad">實驗載入失敗：' + esc(err.message) + '</p>';
        console.error(err);
      }
    });
  }

  function renderQuiz(m, body) {
    const qs = m.quiz, rec = state.quiz[m.id];
    body.innerHTML = '<p class="quiz-head">共 ' + qs.length + ' 題，答對 ' + Math.ceil(qs.length * PASS) + ' 題以上即通過。' +
      (rec ? ' 目前最佳成績：<b>' + Math.round(rec.best * 100) + '%</b>' + (rec.passed ? '（已通過）' : '') : '') + '</p>' +
      '<form class="quiz" novalidate>' + qs.map((q, i) => '<fieldset class="q" data-i="' + i + '"><legend><span class="qn">' + (i + 1) + '</span><span>' + q.q + '</span></legend>' +
        q.options.map((o, j) => '<label class="opt"><input type="radio" name="q' + i + '" value="' + j + '"><span>' + o + '</span></label>').join('') +
        '<div class="explain" hidden></div></fieldset>').join('') +
      '<div class="quiz-actions"><button type="submit" class="btn primary">提交答案</button><button type="button" class="btn" data-retry hidden>重新作答</button></div>' +
      '<div class="quiz-result" aria-live="polite"></div></form>';
    const form = $('form', body), result = $('.quiz-result', body);
    form.addEventListener('submit', e => {
      e.preventDefault();
      const answers = qs.map((q, i) => { const c = $('input[name="q' + i + '"]:checked', form); return c ? +c.value : -1; });
      const missing = answers.filter(a => a < 0).length;
      if (missing) { result.className = 'quiz-result warn'; result.textContent = '還有 ' + missing + ' 題未作答。'; return; }
      let correct = 0;
      qs.forEach((q, i) => {
        const fs = $('.q[data-i="' + i + '"]', form), ok = answers[i] === q.answer;
        if (ok) correct++;
        fs.classList.add(ok ? 'right' : 'wrong');
        $$('.opt', fs).forEach((lab, j) => { if (j === q.answer) lab.classList.add('ans'); if (j === answers[i] && !ok) lab.classList.add('picked'); });
        $$('input', fs).forEach(x => { x.disabled = true; });
        const ex = $('.explain', fs); ex.hidden = false;
        ex.innerHTML = '<strong>' + (ok ? '正確。' : '正確答案：' + String.fromCharCode(65 + q.answer) + '。') + '</strong>' + q.explain;
      });
      const score = correct / qs.length, passed = score >= PASS;
      const prev = state.quiz[m.id] || { best: 0, passed: false };
      state.quiz[m.id] = { best: Math.max(prev.best, score), passed: prev.passed || passed, at: Date.now() };
      save(); refreshModHead(m);
      result.className = 'quiz-result ' + (passed ? 'good' : 'bad');
      result.innerHTML = '答對 ' + correct + ' / ' + qs.length + ' 題（' + Math.round(score * 100) + '%）— ' +
        (passed ? '通過！' + (modules[modules.indexOf(m) + 1] ? ' <a href="#/' + modules[modules.indexOf(m) + 1].id + '">前往下一個模組 →</a>' : ' <a href="#/finish">查看學習報告 →</a>') : '還差一點，看完解析後再試一次。');
      $('[type=submit]', form).hidden = true; $('[data-retry]', form).hidden = false;
      result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    $('[data-retry]', form).addEventListener('click', () => { renderQuiz(m, body); body.scrollIntoView({ block: 'start' }); });
    // 讓選項顯示 A/B/C/D
    $$('.q', form).forEach(fs => $$('.opt > span', fs).forEach((sp, j) => sp.insertAdjacentHTML('afterbegin', '<b class="opt-key">' + String.fromCharCode(65 + j) + '</b>')));
  }

  function sheetHTML(m) {
    return '<div class="sheet"><h2>模組 ' + m.num + '：' + m.title + '（' + m.zh + '）重點整理</h2><ul>' + m.sheet.map(x => '<li>' + x + '</li>').join('') + '</ul></div>';
  }
  function renderSheet(m, body) {
    body.innerHTML = sheetHTML(m) + '<div class="sheet-actions"><button type="button" class="btn" data-print>列印／存成 PDF</button></div>';
    $('[data-print]', body).onclick = () => printHTML(sheetHTML(m));
  }

  /* ---------- 學習報告與證書 ---------- */
  function radarSVG() {
    const n = modules.length, R = 120, cx = 160, cy = 160;
    const pt = (i, r) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    let grid = '';
    [0.25, 0.5, 0.75, 1].forEach(f => { grid += '<polygon class="rd-grid" points="' + modules.map((_, i) => pt(i, R * f).join(',')).join(' ') + '"/>'; });
    const axes = modules.map((m, i) => { const [x, y] = pt(i, R), [lx, ly] = pt(i, R + 18); return '<line class="rd-axis" x1="' + cx + '" y1="' + cy + '" x2="' + x + '" y2="' + y + '"/><text class="rd-label" x="' + lx + '" y="' + ly + '">' + m.num + '</text>'; }).join('');
    const poly = modules.map((m, i) => pt(i, Math.max(0.02, modStats(m).pct) * R).join(',')).join(' ');
    return '<svg class="radar" viewBox="0 0 320 320" role="img" aria-label="各模組完成度雷達圖">' + grid + axes + '<polygon class="rd-val" points="' + poly + '"/></svg>';
  }

  function renderFinish() {
    const st = allStats();
    $('#crumb').textContent = '學習報告與結業證書';
    const eligible = st.passed === st.quizzes && st.done === st.lessons;
    const avg = modules.reduce((a, m) => a + ((state.quiz[m.id] || {}).best || 0), 0) / modules.length;
    main.innerHTML = '<header class="mod-head"><p class="eyebrow">學習報告</p><h1>你的學習進度</h1>' +
      '<p class="lead">完成全部 ' + st.lessons + ' 節並通過 ' + st.quizzes + ' 個模組測驗後，即可產生結業證書。</p></header>' +
      '<div class="report"><div class="report-chart">' + radarSVG() + '<p class="muted center">各模組完成度（含測驗）</p></div>' +
      '<div class="report-side"><div class="stat-row col"><div class="stat"><b>' + Math.round(st.pct * 100) + '%</b><span>總進度</span></div>' +
      '<div class="stat"><b>' + st.done + ' / ' + st.lessons + '</b><span>已完成節數</span></div>' +
      '<div class="stat"><b>' + st.passed + ' / ' + st.quizzes + '</b><span>通過測驗</span></div>' +
      '<div class="stat"><b>' + Math.round(avg * 100) + '%</b><span>測驗平均最佳成績</span></div></div></div></div>' +
      table(['模組', '節數', '測驗', '狀態'], modules.map(m => {
        const s = modStats(m), q = state.quiz[m.id];
        return ['<a href="#/' + m.id + '">' + m.num + ' ' + m.title + '</a>', s.done + ' / ' + s.total, q ? Math.round(q.best * 100) + '%' : '—',
          s.complete ? '<span class="good">完成</span>' : '<span class="muted">進行中</span>'];
      })) +
      '<section class="cert-form"><h2>結業證書</h2>' + (eligible
        ? '<p>恭喜完成全部課程！輸入你要印在證書上的名字：</p><div class="row"><input type="text" id="cert-name" maxlength="40" placeholder="你的名字" value="' + esc(state.name || '') + '"><button type="button" class="btn primary" id="cert-btn">產生並列印證書</button></div>'
        : '<p class="muted">尚未達成條件：還有 ' + (st.lessons - st.done) + ' 節未完成、' + (st.quizzes - st.passed) + ' 個測驗未通過。</p><a class="btn primary" href="' + nextTarget() + '">繼續學習 →</a>') +
      '<p class="muted small">此證書為本課程的完成證明，並非官方或第三方認證。</p></section>' +
      '<section class="reset-zone"><h2>重設進度</h2><p class="muted">清除這個瀏覽器中保存的所有學習紀錄。</p><button type="button" class="btn danger" id="reset-btn">清除全部進度</button></section>';
    const btn = $('#cert-btn');
    if (btn) btn.onclick = () => {
      const name = $('#cert-name').value.trim();
      if (!name) { $('#cert-name').focus(); return; }
      state.name = name; save();
      const d = new Date();
      printHTML('<div class="cert"><div class="cert-inner"><p class="cert-eyebrow">Certificate of Completion</p><h1>結業證書</h1><p class="cert-name">' + esc(name) + '</p>' +
        '<p>已完成 <b>API Engineering：從 HTTP 到 AI-Powered API</b> 互動式課程<br>全部 ' + modules.length + ' 個模組、' + st.lessons + ' 節課程，並通過所有模組測驗（平均成績 ' + Math.round(avg * 100) + '%）。</p>' +
        '<p class="cert-mods">' + modules.map(m => m.title).join(' · ') + '</p>' +
        '<p class="cert-date">' + d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日</p></div></div>');
    };
    $('#reset-btn').onclick = () => {
      if (!confirm('確定要清除全部學習進度嗎？此動作無法復原。')) return;
      state = defaults(); save(); applyTheme(); renderFinish(); updateSidebar('finish');
    };
  }

  /* ---------- 列印 ---------- */
  function printHTML(html) {
    const area = $('#print-area');
    area.innerHTML = html;
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); area.innerHTML = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  }

  /* ---------- 搜尋 ---------- */
  function buildSearch() {
    const tmp = document.createElement('div');
    searchIndex = [];
    modules.forEach(m => m.lessons.forEach(l => {
      tmp.innerHTML = l.html;
      searchIndex.push({ m, l, head: (l.title + ' ' + l.zh).toLowerCase(), text: tmp.textContent.replace(/\s+/g, ' ') });
    }));
  }
  function doSearch(q) {
    const box = $('#search-results');
    q = q.trim().toLowerCase();
    if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
    const hits = [];
    searchIndex.forEach(it => {
      const inHead = it.head.includes(q), pos = it.text.toLowerCase().indexOf(q);
      if (inHead || pos >= 0) hits.push({ it, score: inHead ? 0 : 1, pos });
    });
    hits.sort((a, b) => a.score - b.score);
    box.hidden = false;
    box.innerHTML = hits.length ? hits.slice(0, 20).map(({ it, pos }) => {
      const snip = pos >= 0 ? esc(it.text.slice(Math.max(0, pos - 18), pos + 42)) : '';
      return '<a href="#/' + it.m.id + '/learn/' + it.l.id + '"><b>' + it.l.idx + ' ' + esc(it.l.title) + '</b><small>' + esc(it.l.zh) + (snip ? ' — …' + snip + '…' : '') + '</small></a>';
    }).join('') : '<p class="muted">找不到「' + esc(q) + '」</p>';
  }

  /* ---------- 主題 ---------- */
  function applyTheme() {
    if (state.theme) document.documentElement.setAttribute('data-theme', state.theme);
    else document.documentElement.removeAttribute('data-theme');
    const b = $('#theme-btn');
    if (b) b.textContent = isDark() ? '淺色模式' : '深色模式';
  }
  function isDark() {
    const t = document.documentElement.getAttribute('data-theme');
    return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /* ---------- 路由 ---------- */
  function route() {
    cleanups.forEach(f => { try { f(); } catch (e) { /* ignore */ } });
    cleanups = [];
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    const page = parts[0] || '', tab = parts[1] || 'learn', anchor = parts[2] || '';
    if (byId[page]) renderModule(byId[page], tab, anchor);
    else if (page === 'finish') renderFinish();
    else renderHome();
    updateSidebar(byId[page] || page === 'finish' ? page : '');
    document.body.classList.remove('drawer-open');
    if (!anchor) window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }

  function start() {
    main = $('#main');
    applyTheme();
    modules.sort((a, b) => a.num.localeCompare(b.num));
    buildSidebar(); buildSearch();

    $('#theme-btn').onclick = () => { state.theme = isDark() ? 'light' : 'dark'; save(); applyTheme(); };
    $('#menu-btn').onclick = () => document.body.classList.toggle('drawer-open');
    $('#scrim').onclick = () => document.body.classList.remove('drawer-open');
    $('#search').addEventListener('input', e => doSearch(e.target.value));
    $('#search-results').addEventListener('click', e => { if (e.target.closest('a')) { $('#search').value = ''; doSearch(''); } });

    // 範圍滑桿即時顯示數值
    document.addEventListener('input', e => {
      const r = e.target;
      if (r.type === 'range' && r.closest('.fld')) { const o = r.closest('.fld').querySelector('output'); if (o) o.textContent = r.value + (o.dataset.unit || ''); }
    });
    // 複製程式碼
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-copy]'); if (!b) return;
      const text = b.closest('figure').querySelector('pre').textContent;
      const ok = () => { b.textContent = '已複製'; setTimeout(() => { b.textContent = '複製'; }, 1400); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok, () => fallbackCopy(text, ok));
      else fallbackCopy(text, ok);
    });
    window.addEventListener('hashchange', route);
    route();
  }
  function fallbackCopy(text, ok) {
    const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); ok(); } catch (e) { /* ignore */ }
    t.remove();
  }

  window.Course = { register, start, ui: { range, classify, stepper, sequence, fmt, esc } };
})();
