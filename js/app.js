// 宅建 合格プラン: 今日やること・テキスト・確認問題・計画・記録
const D = TAKKEN_DATA;
const PLAN = D.plan;
const CHAPTERS = {};      // 章id -> 章
const SUBJECT_OF = {};    // 章id -> 科目
const QUESTIONS = {};     // 問題id -> 問題(+章id)
D.subjects.forEach((s) => s.chapters.forEach((c) => {
  CHAPTERS[c.id] = c;
  SUBJECT_OF[c.id] = s;
  c.quiz.forEach((q) => { QUESTIONS[q.id] = Object.assign({ ch: c.id }, q); });
}));

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WD = ['日', '月', '火', '水', '木', '金', '土'];

// ===== 日付 =====
function todayStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}
function parseDay(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function daysBetween(a, b) { return Math.round((parseDay(b) - parseDay(a)) / 86400000); }
function fmtDay(s, withYear) {
  const d = parseDay(s);
  return `${withYear ? d.getFullYear() + '年' : ''}${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`;
}

// ===== 共通 =====
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => t.classList.add('hidden'), 2200);
}

let currentTab = 'today';
const backTo = { chapter: 'text', quiz: 'quizmenu' };

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  $('view-' + name).scrollTop = 0;
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  RENDER[tab]();
  showView(tab);
  if (tab === 'plan') scrollPlanToToday(false);
  if (pendingReload) location.reload(); // 問題を解いている間に見つけた更新を、解き終わってから反映する
}

function chapterTitle(id) {
  const c = CHAPTERS[id];
  return `第${c.no}章 ${c.title}`;
}

function todoHtml(todo) {
  return todo.split('\n').map((l) => `<li>${esc(l.replace(/^[①②③]/, ''))}</li>`).join('');
}

// 章ごとの確認問題の成績
function chapterStats(id) {
  const qs = CHAPTERS[id].quiz;
  const tried = qs.filter((q) => state.quiz[q.id]);
  const okNow = tried.filter((q) => state.quiz[q.id].last).length;
  return { total: qs.length, tried: tried.length, okNow };
}

// 「間違えた問題」: 一度でも間違えて、まだ3回続けて正解していない問題
function wrongIds() {
  return Object.keys(QUESTIONS).filter((id) => isWeak(state.quiz[id]));
}

// この7日間に間違えた問題(日曜の週テスト用)
function weekWrongIds() {
  const since = Date.now() - 7 * 86400000;
  return wrongIds().filter((id) => new Date(state.quiz[id].at).getTime() >= since);
}

// ===== 宅建業法の一問一答(毎日) =====
const IPPON_SIZE = 15;
// 章を最初に読む日。その日を過ぎた章だけを一問一答に出す
const CH_FIRST_DAY = {};
PLAN.forEach((p) => p.ch.forEach((id) => { if (!CH_FIRST_DAY[id]) CH_FIRST_DAY[id] = p.d; }));

function ipponPool() {
  const t = todayStr();
  const reached = Object.keys(CHAPTERS).filter((id) => id.startsWith('gyoho-') && CH_FIRST_DAY[id] && CH_FIRST_DAY[id] <= t);
  const chs = reached.length ? reached : ['gyoho-01'];
  return chs.flatMap((id) => CHAPTERS[id].quiz.map((q) => q.id));
}

// 間違えた問題 → まだ解いていない問題 → 最後に解いたのが古い問題、の順に10問
function ipponSet() {
  const pool = ipponPool();
  const rank = (id) => {
    const r = state.quiz[id];
    if (isWeak(r)) return [0, r.at];
    if (!r) return [1, ''];
    return [2, r.at];
  };
  return shuffle(pool.slice())
    .sort((a, b) => { const x = rank(a); const y = rank(b); return x[0] - y[0] || String(x[1]).localeCompare(String(y[1])); })
    .slice(0, IPPON_SIZE);
}

// ===== 関門 =====
// 直近3回の点数(関門の日までの、from以降に入力した点数)
function recentScores(item, gateDay) {
  return PLAN.filter((p) => p.score && state.scores[p.d] && p.d >= (item.from || '') && p.d <= gateDay)
    .map((p) => Number(state.scores[p.d])).slice(-3);
}

// 関門の1項目の結果: { value, pass(null=未入力), text }
function gateResult(item, gateDay) {
  if (item.type === 'streak3') {
    const s = recentScores(item, gateDay);
    if (s.length < 3) return { value: s, pass: null, text: `点数が${s.length}回分しかありません（3回分必要）` };
    return { value: s, pass: s.every((x) => x >= item.target), text: `直近3回：${s.join('・')}点` };
  }
  const v = state.gates[item.id];
  if (v === undefined || v === '') return { value: null, pass: null, text: '未入力' };
  const unit = item.type === 'pct' ? '%' : '点';
  return { value: v, pass: item.target == null ? true : Number(v) >= item.target, text: `${v}${unit}` };
}

function gateDays() {
  return PLAN.filter((p) => p.gate);
}

// 関門の日から7日以内で、届かなかった(または未入力の)関門
function failedGateNow() {
  const t = todayStr();
  return gateDays().find((p) => p.d <= t && daysBetween(p.d, t) <= 7
    && p.gate.some((it) => it.target != null && gateResult(it, p.d).pass !== true));
}

// ===== 今日 =====
function renderToday() {
  const t = todayStr();
  const first = PLAN[0].d;
  const left = daysBetween(t, D.exam);
  let html = `<div class="hero">
    <div class="hero-date">${fmtDay(t, true)}</div>
    <div class="hero-count">${left >= 0 ? `試験まで <b>${left}</b> 日` : '試験は終わりました'}</div>
  </div>`;

  let day = PLAN.find((p) => p.d === t);
  let label = '今日やること';
  if (!day && t < first) {
    day = PLAN[0];
    label = `${fmtDay(first)}から始まります`;
  }
  // 関門に届かなかった週は、次に進まず復習を優先する
  const failed = failedGateNow();
  if (failed && failed.d !== t) {
    const miss = failed.gate.filter((it) => it.target != null && gateResult(it, failed.d).pass !== true);
    html += `<div class="card alert">
      <div class="card-label">関門に届いていません（${fmtDay(failed.d)}）</div>
      <p class="alert-text">${miss.map((it) => `${esc(it.label)}：${esc(gateResult(it, failed.d).text)}（目標 ${it.target}${it.type === 'pct' ? '%' : '点'}）`).join('<br>')}</p>
      <p class="muted">ルールどおり、今週は先に進まず、この科目の×の問題と弱点ノートの復習を優先してください。もう一度測って届いたら、関門の日の数値を書き換えてください。</p>
      <button class="btn ghost" data-plan-detail="${failed.d}">関門の日を開く</button>
    </div>`;
  }

  if (day) html += dayCard(day, label);

  // 宅建業法の一問一答(毎日)
  if (t >= first) {
    const n = state.ippon[t] || 0;
    const fin = n >= IPPON_SIZE;
    html += `<div class="card ${fin ? 'soft' : 'main'} ippon">
      <div class="card-label">毎日の一問一答<span class="pill">宅建業法</span></div>
      <p class="muted">間違えた問題を優先して${IPPON_SIZE}問出します。3回続けて正解するまで、何度でも出ます。</p>
      <button class="btn ${fin ? 'done' : 'primary'}" data-quiz-mode="ippon">${fin ? `✓ 今日の${IPPON_SIZE}問は解きました（もう一度解く）` : `一問一答を始める（今日 ${n}/${IPPON_SIZE}問）`}</button>
    </div>`;
  }

  // 遅れている日(予定日を過ぎて未完了)
  const behind = PLAN.filter((p) => p.d < t && !p.rest && !state.done[p.d]);
  if (behind.length) {
    html += `<div class="card warn">
      <div class="card-label">まだ終わっていない日が ${behind.length} 日あります</div>
      <p class="muted">日曜の週テストまでに取り戻してください。いちばん古いのは ${fmtDay(behind[0].d)} の「${esc(behind[0].theme)}」です。</p>
      <button class="btn ghost" data-go-plan="1">計画で確認する</button>
    </div>`;
  }

  // 明日の予定
  const next = PLAN.find((p) => p.d > (day ? day.d : t));
  if (next) {
    html += `<div class="card soft"><div class="card-label">次の予定 ${fmtDay(next.d)}</div>
      <div class="next-theme">${esc(next.theme)}</div></div>`;
  }
  $('today-body').innerHTML = html;
}

function dayCard(day, label) {
  const done = !!state.done[day.d];
  let h = `<div class="card main ${done ? 'is-done' : ''}">
    <div class="card-label">${esc(label)}${day.phase ? `<span class="pill">${esc(day.phase)}</span>` : ''}</div>
    <h2 class="theme">${esc(day.theme)}</h2>
    <ol class="todo">${todoHtml(day.todo)}</ol>`;
  if (day.memo) h += `<p class="memo">${esc(day.memo)}</p>`;
  if (day.ch.length) {
    h += `<div class="links">` + day.ch.map((id) => {
      const s = chapterStats(id);
      return `<div class="link-row">
        <button class="btn ghost" data-open-ch="${id}">📖 ${esc(chapterTitle(id))}</button>
        ${s.total ? `<button class="btn ghost small" data-quiz-ch="${id}">問題 ${s.okNow}/${s.total}</button>` : ''}
      </div>`;
    }).join('') + `</div>`;
  }
  if (day.subj === '週テスト') {
    const w = weekWrongIds().length;
    h += `<button class="btn ghost" data-quiz-mode="week" ${w ? '' : 'disabled'}>今週間違えた確認問題を解き直す（${w}問）</button>`;
  }
  if (day.score) {
    const v = state.scores[day.d] || '';
    h += `<label class="score-row" for="score-${day.d}">点数（50点満点）
      <input id="score-${day.d}" class="score-input" type="number" min="0" max="50" inputmode="numeric" value="${esc(v)}" data-score-day="${day.d}"></label>`;
  }
  if (day.gate) h += gateBox(day);
  if (!day.rest) {
    h += `<button class="btn ${done ? 'done' : 'primary'}" data-toggle-day="${day.d}">${done ? '✓ 完了しました（取り消す）' : 'この日の分を完了にする'}</button>`;
  }
  return h + `</div>`;
}

// 関門の日の入力欄と判定
function gateBox(day) {
  let h = `<div class="gate">`;
  day.gate.forEach((it) => {
    const r = gateResult(it, day.d);
    const badge = r.pass === null ? '' : r.pass ? '<span class="badge ok">合格ライン</span>' : '<span class="badge ng">届いていない</span>';
    const goal = it.target == null ? '記録する' : `目標 ${it.target}${it.type === 'pct' ? '%' : '点'}以上`;
    if (it.type === 'streak3') {
      h += `<div class="gate-item"><div class="gate-head">${esc(it.label)}${badge}</div>
        <div class="gate-sub">${esc(goal)}・${esc(r.text)}</div></div>`;
    } else {
      const max = it.type === 'pct' ? 100 : 50;
      h += `<label class="gate-item" for="gate-${it.id}"><div class="gate-head">${esc(it.label)}${badge}</div>
        <div class="gate-row"><span class="gate-sub">${esc(goal)}</span>
        <span><input id="gate-${it.id}" class="score-input" type="number" min="0" max="${max}" inputmode="numeric"
          value="${esc(state.gates[it.id] ?? '')}" data-gate-id="${it.id}" data-gate-max="${max}"> ${it.type === 'pct' ? '%' : '点'}</span></div></label>`;
    }
  });
  return h + `</div>`;
}

// ===== テキスト =====
function renderText() {
  let html = '';
  D.subjects.forEach((s, i) => {
    html += `<h2 class="section-title">${'①②③④'[i]} ${esc(s.name)}<span class="section-sub">${esc(s.when)}</span></h2>`;
    if (!s.ready) {
      html += `<div class="card soft"><p class="muted">まだ作っていません。この科目に入る前に追加します。</p></div>`;
      return;
    }
    html += `<ul class="list">` + s.chapters.map((c) => {
      const st = chapterStats(c.id);
      const read = state.read[c.id];
      return `<li class="list-row" data-open-ch="${c.id}">
        <span class="row-no">${c.no}</span>
        <span class="row-main"><span class="row-title">${esc(c.title)}</span>
          <span class="row-sub">${read ? '読んだ' : '未読'}・問題 ${st.okNow}/${st.total}</span></span>
        <span class="row-mark ${read ? 'on' : ''}">${read ? '✓' : ''}</span>
      </li>`;
    }).join('') + `</ul>`;
  });
  $('text-body').innerHTML = html;
}

let openChapterId = null;
function openChapter(id) {
  openChapterId = id;
  const c = CHAPTERS[id];
  const s = SUBJECT_OF[id];
  $('chapter-crumb').textContent = s.name;
  const read = !!state.read[id];
  const ids = s.chapters.map((x) => x.id);
  const i = ids.indexOf(id);
  $('chapter-body').innerHTML = `<h1 class="ch-title">第${c.no}章<br>${esc(c.title)}</h1>
    ${c.html}
    <div class="ch-actions">
      ${c.quiz.length ? `<button class="btn primary" data-quiz-ch="${id}">確認問題を解く（${c.quiz.length}問）</button>` : ''}
      <button class="btn ${read ? 'done' : 'ghost'}" data-toggle-read="${id}">${read ? '✓ 読みました（取り消す）' : '読み終えた'}</button>
      <div class="pager">
        ${i > 0 ? `<button class="btn ghost small" data-open-ch="${ids[i - 1]}">‹ 第${c.no - 1}章</button>` : '<span></span>'}
        ${i < ids.length - 1 ? `<button class="btn ghost small" data-open-ch="${ids[i + 1]}">第${c.no + 1}章 ›</button>` : '<span></span>'}
      </div>
    </div>`;
  backTo.chapter = currentTab;
  showView('chapter');
}

// ===== 問題 =====
function renderQuizMenu() {
  const wrong = wrongIds();
  const allIds = Object.keys(QUESTIONS);
  const answered = allIds.filter((id) => state.quiz[id]).length;
  const t = todayStr();
  const today = PLAN.find((p) => p.d === t);
  let html = `<div class="quick">
    <button class="quick-btn" data-quiz-mode="ippon">
      <b>毎日の一問一答</b><span>宅建業法 ${IPPON_SIZE}問</span></button>
    <button class="quick-btn" data-quiz-mode="wrong" ${wrong.length ? '' : 'disabled'}>
      <b>間違えた問題</b><span>${wrong.length}問（3回続けて正解で外れる）</span></button>
    <button class="quick-btn" data-quiz-mode="random" ${allIds.length ? '' : 'disabled'}>
      <b>ランダムに20問</b><span>全${allIds.length}問から</span></button>
    <button class="quick-btn" data-quiz-mode="new" ${answered < allIds.length ? '' : 'disabled'}>
      <b>まだ解いていない問題</b><span>${allIds.length - answered}問</span></button>
  </div>`;
  if (today && today.ch.length) {
    html += `<button class="btn primary" data-quiz-mode="today">今日の範囲を解く（${today.ch.map((id) => '第' + CHAPTERS[id].no + '章').join('・')}）</button>`;
  }
  D.subjects.filter((s) => s.ready).forEach((s) => {
    html += `<h2 class="section-title">${esc(s.name)}</h2><ul class="list">` + s.chapters.map((c) => {
      const st = chapterStats(c.id);
      const cls = st.tried === 0 ? '' : st.okNow === st.total ? 'good' : 'bad';
      return `<li class="list-row" data-quiz-ch="${c.id}">
        <span class="row-no">${c.no}</span>
        <span class="row-main"><span class="row-title">${esc(c.title)}</span></span>
        <span class="score-chip ${cls}">${st.tried ? `${st.okNow}/${st.total}` : '未'}</span>
      </li>`;
    }).join('') + `</ul>`;
  });
  $('quizmenu-body').innerHTML = html;
}

let quiz = null; // { ids, i, results, title }

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function startQuiz(ids, title, mode) {
  if (!ids.length) { showToast('出題できる問題がありません'); return; }
  quiz = { ids, i: 0, results: [], title, answered: false, mode: mode || '' };
  backTo.quiz = currentTab;
  showView('quiz');
  renderQuestion();
}

function startQuizMode(mode) {
  const all = Object.keys(QUESTIONS);
  if (mode === 'ippon') startQuiz(ipponSet(), '一問一答', 'ippon');
  else if (mode === 'week') startQuiz(shuffle(weekWrongIds()), '今週間違えた問題');
  else if (mode === 'wrong') startQuiz(shuffle(wrongIds()), '間違えた問題');
  else if (mode === 'random') startQuiz(shuffle(all.slice()).slice(0, 20), 'ランダム20問');
  else if (mode === 'new') startQuiz(all.filter((id) => !state.quiz[id]).slice(0, 10), 'まだ解いていない問題');
  else if (mode === 'today') {
    const today = PLAN.find((p) => p.d === todayStr());
    startQuiz(today.ch.flatMap((id) => CHAPTERS[id].quiz.map((q) => q.id)), '今日の範囲');
  }
}

function renderQuestion() {
  const id = quiz.ids[quiz.i];
  const q = QUESTIONS[id];
  $('quiz-progress').textContent = `${quiz.title}　${quiz.i + 1} / ${quiz.ids.length}`;
  quiz.answered = false;
  $('quiz-body').innerHTML = `<div class="q-chapter">${esc(chapterTitle(q.ch))}</div>
    <p class="q-text">${esc(q.q)}</p>
    <div class="ox">
      <button class="ox-btn" data-answer="1" aria-label="正しい（○）">○</button>
      <button class="ox-btn" data-answer="0" aria-label="誤り（×）">×</button>
    </div>
    <div id="q-result"></div>`;
}

function answerQuestion(choice) {
  if (quiz.answered) return;
  quiz.answered = true;
  const id = quiz.ids[quiz.i];
  const q = QUESTIONS[id];
  const ok = choice === q.a;
  recordAnswer(id, ok);
  quiz.results.push(ok);
  if (quiz.mode === 'ippon') {
    const t = todayStr();
    state.ippon[t] = (state.ippon[t] || 0) + 1;
    saveState();
  }
  document.querySelectorAll('.ox-btn').forEach((b) => {
    const isAns = (b.dataset.answer === '1') === q.a;
    b.classList.add(isAns ? 'is-answer' : 'is-other');
    b.disabled = true;
  });
  const last = quiz.i === quiz.ids.length - 1;
  $('q-result').innerHTML = `<div class="result ${ok ? 'ok' : 'ng'}">
      <div class="result-head">${ok ? '正解' : '不正解'}　答えは ${q.a ? '○' : '×'}</div>
      ${q.exp ? `<div class="exp"><div class="exp-label">解説</div><p>${esc(q.exp)}</p></div>` : ''}
      ${ok ? `<button class="guess-btn" id="btn-guess">理由を説明できない（勘で当たった）→ ×にする</button>` : ''}
    </div>
    <div class="q-actions">
      <button class="btn ghost small" data-open-ch="${q.ch}">テキストで確認</button>
      <button class="btn primary" id="btn-next-q">${last ? '結果を見る' : '次の問題'}</button>
    </div>`;
}

function nextQuestion() {
  if (quiz.i < quiz.ids.length - 1) {
    quiz.i += 1;
    renderQuestion();
    $('view-quiz').scrollTop = 0;
    return;
  }
  const ok = quiz.results.filter(Boolean).length;
  const n = quiz.results.length;
  const wrongHere = quiz.ids.filter((id, k) => !quiz.results[k]);
  $('quiz-progress').textContent = quiz.title;
  $('quiz-body').innerHTML = `<div class="finish">
      <div class="finish-score"><b>${ok}</b> / ${n}</div>
      <p class="muted">${ok === n ? '全問正解です。' : `間違えた ${n - ok} 問は「間違えた問題だけ」からもう一度解けます。`}</p>
    </div>
    ${wrongHere.length ? `<h2 class="section-title">間違えた問題</h2><ul class="list">` + wrongHere.map((id) => {
      const q = QUESTIONS[id];
      return `<li class="list-row static"><span class="row-main"><span class="row-title">${esc(q.q)}</span>
        <span class="row-sub">答え ${q.a ? '○' : '×'}${q.exp ? '：' + esc(q.exp) : ''}</span></span></li>`;
    }).join('') + `</ul>` : ''}
    <div class="q-actions">
      ${wrongHere.length ? `<button class="btn ghost" id="btn-retry-wrong">間違えた問題をもう一度</button>` : ''}
      <button class="btn primary" id="btn-finish-quiz">終わる</button>
    </div>`;
  quiz.retry = wrongHere;
}

// ===== 計画 =====
let planOnlyOpen = false;
function renderPlan() {
  const t = todayStr();
  let html = '';
  let month = '';
  PLAN.forEach((p) => {
    if (planOnlyOpen && (p.rest || state.done[p.d] || p.d > t)) return;
    const m = p.d.slice(0, 7);
    if (m !== month) {
      month = m;
      html += `<h2 class="month">${Number(m.slice(0, 4))}年${Number(m.slice(5))}月</h2>`;
    }
    const done = !!state.done[p.d];
    const late = !done && !p.rest && p.d < t;
    html += `<div class="plan-row ${p.d === t ? 'today' : ''} ${p.rest ? 'rest' : ''} ${done ? 'done' : ''} ${late ? 'late' : ''}" id="plan-${p.d}">
      <div class="plan-date"><b>${Number(p.d.slice(8))}</b><span>${WD[parseDay(p.d).getDay()]}</span></div>
      <div class="plan-main" data-plan-detail="${p.d}">
        <div class="plan-theme">${esc(p.theme)}</div>
        <div class="plan-sub">${p.gate ? '<b class="gate-mark">関門</b>・' : ''}${esc(p.subj)}${state.scores[p.d] ? `・${esc(state.scores[p.d])}点` : ''}${p.memo ? '・⚠️' : ''}</div>
      </div>
      ${p.rest ? '<span class="plan-check rest"></span>' : `<button class="plan-check ${done ? 'on' : ''}" data-toggle-day="${p.d}" aria-label="${done ? '完了を取り消す' : '完了にする'}">${done ? '✓' : ''}</button>`}
    </div>`;
  });
  if (!html) html = `<div class="card soft"><p class="muted">終わっていない日はありません。</p></div>`;
  $('plan-body').innerHTML = html;
  $('btn-plan-filter').textContent = planOnlyOpen ? 'すべて表示' : '未完了だけ';
}

function scrollPlanToToday(smooth) {
  const t = todayStr();
  const target = PLAN.find((p) => p.d >= t);
  const el = target && $('plan-' + target.d);
  if (el) el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
}

function showPlanDetail(d) {
  const p = PLAN.find((x) => x.d === d);
  if (!$('view-chapter').classList.contains('active')) backTo.chapter = currentTab;
  $('chapter-crumb').textContent = p.gate ? '関門' : '計画';
  $('chapter-body').innerHTML = `<h1 class="ch-title">${fmtDay(d, true)}</h1>` + dayCard(p, p.rest ? '休み' : 'この日にやること');
  openChapterId = null;
  showView('chapter');
}

// ===== 記録 =====
function renderRecord() {
  const t = todayStr();
  const studyDays = PLAN.filter((p) => !p.rest);
  const due = studyDays.filter((p) => p.d <= t);
  const doneN = studyDays.filter((p) => state.done[p.d]).length;
  const answered = Object.keys(QUESTIONS).filter((id) => state.quiz[id]);
  const okNow = answered.filter((id) => state.quiz[id].last).length;
  const readN = Object.keys(state.read).filter((id) => CHAPTERS[id]).length;
  const nCh = Object.keys(CHAPTERS).length;

  // 連続して完了している日数(休みの日はとばす)
  let streak = 0;
  for (let i = PLAN.length - 1; i >= 0; i--) {
    const p = PLAN[i];
    if (p.d > t || p.rest) continue;
    if (state.done[p.d]) streak += 1;
    else if (p.d === t) continue;
    else break;
  }

  const scores = PLAN.filter((p) => state.scores[p.d]);
  let html = `<div class="stats">
    <div class="stat"><b>${doneN}</b><span>完了した日<br>（予定 ${due.length} 日まで）</span></div>
    <div class="stat"><b>${streak}</b><span>連続で<br>完了した日</span></div>
    <div class="stat"><b>${readN}/${nCh}</b><span>読んだ章</span></div>
    <div class="stat"><b>${answered.length ? Math.round(okNow / answered.length * 100) : 0}%</b><span>確認問題の正解率<br>（${answered.length}問解いた）</span></div>
  </div>`;

  html += `<h2 class="section-title">関門</h2><ul class="list">` + gateDays().map((p) => {
    const rs = p.gate.map((it) => gateResult(it, p.d));
    const judged = p.gate.filter((it) => it.target != null);
    let chip = '<span class="score-chip">これから</span>';
    if (p.d <= t) {
      if (rs.some((r) => r.pass === null)) chip = '<span class="score-chip bad">未入力</span>';
      else if (judged.every((it) => gateResult(it, p.d).pass)) chip = '<span class="score-chip good">通過</span>';
      else chip = '<span class="score-chip bad">未達</span>';
    }
    return `<li class="list-row" data-plan-detail="${p.d}">
      <span class="row-main"><span class="row-title">${esc(p.theme.replace('関門：', ''))}</span>
        <span class="row-sub">${fmtDay(p.d, true)}${p.d <= t ? '・' + rs.map((r) => esc(r.text)).join('／') : ''}</span></span>
      ${chip}</li>`;
  }).join('') + `</ul>`;

  html += `<h2 class="section-title">過去問・模試の点数</h2>`;
  html += scores.length ? `<ul class="list">` + scores.map((p) => `<li class="list-row static">
      <span class="row-main"><span class="row-title">${esc(p.theme)}</span><span class="row-sub">${fmtDay(p.d)}</span></span>
      <span class="score-chip ${Number(state.scores[p.d]) >= 37 ? 'good' : ''}">${esc(state.scores[p.d])}点</span></li>`).join('') + `</ul>`
    : `<div class="card soft"><p class="muted">3月から、過去問の通し演習や模試を解いた日に「今日」の画面で点数を入れると、ここに並びます。</p></div>`;

  html += `<h2 class="section-title">バックアップ</h2>
    <div class="card soft">
      <p class="muted">記録はこの端末の中だけに保存されます。機種変更やブラウザのデータ削除に備えて、ときどきファイルに書き出してください。</p>
      <div class="btn-row">
        <button class="btn ghost" id="btn-export">書き出す</button>
        <button class="btn ghost" id="btn-import">読み込む</button>
      </div>
    </div>
    <button class="btn ghost" id="btn-check-update">アップデートを確認</button>
    <p class="foot">バージョン ${APP_VERSION}・試験日 ${fmtDay(D.exam, true)}（予定）</p>`;
  $('record-body').innerHTML = html;
}

const RENDER = { today: renderToday, text: renderText, quizmenu: renderQuizMenu, plan: renderPlan, record: renderRecord };

// ===== 操作 =====
document.addEventListener('click', (e) => {
  const el = e.target.closest('button, [data-open-ch], [data-quiz-ch], [data-plan-detail]');
  if (!el) return;
  const ds = el.dataset;
  if (el.classList.contains('tab-btn')) return switchTab(ds.tab);
  if (ds.toggleDay) {
    if (state.done[ds.toggleDay]) delete state.done[ds.toggleDay];
    else { state.done[ds.toggleDay] = new Date().toISOString(); showToast('お疲れさまでした'); }
    saveState();
    if ($('view-chapter').classList.contains('active')) showPlanDetail(ds.toggleDay);
    else RENDER[currentTab]();
    return;
  }
  if (ds.toggleRead) {
    if (state.read[ds.toggleRead]) delete state.read[ds.toggleRead];
    else state.read[ds.toggleRead] = new Date().toISOString();
    saveState();
    return openChapter(ds.toggleRead);
  }
  if (ds.openCh) return openChapter(ds.openCh);
  if (ds.quizCh) return startQuiz(CHAPTERS[ds.quizCh].quiz.map((q) => q.id), `第${CHAPTERS[ds.quizCh].no}章`);
  if (ds.quizMode) return startQuizMode(ds.quizMode);
  if (ds.answer) return answerQuestion(ds.answer === '1');
  if (ds.planDetail) return showPlanDetail(ds.planDetail);
  if (ds.goPlan) { planOnlyOpen = true; return switchTab('plan'); }
  switch (el.id) {
    case 'btn-next-q': return nextQuestion();
    case 'btn-guess': {
      markGuess(quiz.ids[quiz.i]);
      quiz.results[quiz.i] = false;
      const box = el.closest('.result');
      box.classList.replace('ok', 'ng');
      box.querySelector('.result-head').textContent = '勘で当たった → 間違えた問題に入れました';
      el.remove();
      return;
    }
    case 'btn-retry-wrong': return startQuiz(shuffle(quiz.retry.slice()), '間違えた問題');
    case 'btn-finish-quiz':
    case 'btn-quit-quiz': return switchTab(backTo.quiz);
    case 'btn-back-chapter': return switchTab(backTo.chapter);
    case 'btn-plan-filter': planOnlyOpen = !planOnlyOpen; renderPlan(); return planOnlyOpen ? null : scrollPlanToToday(false);
    case 'btn-plan-today': planOnlyOpen = false; renderPlan(); return scrollPlanToToday(true);
    case 'btn-export': return doExport();
    case 'btn-import': return $('backup-file').click();
    case 'btn-check-update': return checkForUpdate(true);
  }
});

document.addEventListener('change', (e) => {
  const { scoreDay, gateId, gateMax } = e.target.dataset;
  if (!scoreDay && !gateId) return;
  const v = e.target.value.trim();
  const val = String(Math.max(0, Math.min(Number(gateMax || 50), Number(v) || 0)));
  if (scoreDay) {
    if (v === '') delete state.scores[scoreDay]; else state.scores[scoreDay] = val;
    showToast('点数を保存しました');
  } else {
    if (v === '') delete state.gates[gateId]; else state.gates[gateId] = val;
    showToast('関門の結果を保存しました');
  }
  saveState();
  // 合格ラインの判定を表示し直す
  if ($('view-chapter').classList.contains('active') && !openChapterId) {
    const d = $('chapter-body').querySelector('[data-toggle-day]');
    if (d) showPlanDetail(d.dataset.toggleDay);
  } else if (currentTab === 'today') {
    renderToday();
  }
});

$('backup-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    importBackup(await f.text());
    showToast('バックアップを読み込みました');
    renderRecord();
  } catch (err) {
    showToast('読み込めませんでした：' + err.message);
  }
});

async function doExport() {
  const name = `宅建の記録_${todayStr()}.json`;
  const blob = new Blob([exportBackup()], { type: 'application/json' });
  // iPhoneでは共有シートから「ファイルに保存」できるようにする
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// 日付が変わったら(アプリを開いたまま翌日になった場合も)今日の画面を描き直す
let lastDay = todayStr();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && todayStr() !== lastDay) {
    lastDay = todayStr();
    RENDER[currentTab]();
  }
  if (document.visibilityState === 'visible') checkForUpdate(false);
});

// ===== 自動アップデート =====
// サーバー上の最新の js/version.js を(キャッシュを通さず)取りに行き、今動いているバージョンと比べる
async function fetchLatestVersion() {
  const res = await fetch(`js/version.js?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('取得できませんでした');
  const m = (await res.text()).match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('バージョンを読み取れませんでした');
  return m[1];
}

let pendingReload = false;
let updateInFlight = false;
// 新しいバージョンがあれば、そのファイル一式を新しいキャッシュに入れてから画面を更新する。
// service-worker.js 自体は中身が変わらないリリースもあるので、ブラウザの更新チェックだけに頼らない
async function checkForUpdate(manual) {
  if (updateInFlight || !('caches' in window)) return;
  updateInFlight = true;
  try {
    const latest = await fetchLatestVersion();
    if (latest === APP_VERSION) {
      if (manual) showToast(`最新のバージョン（${APP_VERSION}）です`);
      return;
    }
    // 同じバージョンへの自動更新は1回だけ(HTTPキャッシュが古いまま再読込を繰り返さないため)
    let tried = null;
    try { tried = localStorage.getItem('takken-update-tried'); } catch (e) { /* なくても動く */ }
    if (!manual && tried === latest) return;
    try { localStorage.setItem('takken-update-tried', latest); } catch (e) { /* なくても動く */ }

    const name = 'takken-cache-' + latest;
    const cache = await caches.open(name);
    await cache.addAll(CORE_ASSETS.map((u) => new Request(u, { cache: 'reload' })));
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== name).map((k) => caches.delete(k)));
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.update().catch(() => {});

    if ($('view-quiz').classList.contains('active')) {
      pendingReload = true;
      showToast(`新しいバージョン（${latest}）があります。問題を終えたら更新します`);
    } else {
      showToast(`新しいバージョン（${latest}）に更新します`);
      setTimeout(() => location.reload(), 900);
    }
  } catch (e) {
    if (manual) showToast('確認できませんでした。通信状態を確かめてください');
  } finally {
    updateInFlight = false;
  }
}

// ===== 起動 =====
$('app-version').textContent = 'v' + APP_VERSION;
switchTab('today'); // 開いたら毎回「今日」から
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(() => {});
}
checkForUpdate(false); // 開いたときに、裏で新しいバージョンがないか確認する
