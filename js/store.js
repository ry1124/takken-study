// 学習の記録(完了した日・読んだ章・問題の正誤・過去問の点数)をこの端末に保存する
const STORE_KEY = 'takken-study-v1';

function emptyState() {
  return { done: {}, read: {}, quiz: {}, scores: {} };
}

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyState();
    return Object.assign(emptyState(), JSON.parse(raw));
  } catch (e) {
    return emptyState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    showToast('保存できませんでした。記録タブからバックアップを取ってください');
  }
}

// 1問ぶんの結果を記録する。last = 直近で正解したか
function recordAnswer(qid, ok) {
  const r = state.quiz[qid] || { n: 0, ok: 0, last: null };
  r.n += 1;
  if (ok) r.ok += 1;
  r.last = ok;
  r.at = new Date().toISOString();
  state.quiz[qid] = r;
  saveState();
}

function exportBackup() {
  return JSON.stringify({ app: 'takken-study', version: APP_VERSION, savedAt: new Date().toISOString(), state }, null, 1);
}

function importBackup(text) {
  const obj = JSON.parse(text);
  if (!obj || obj.app !== 'takken-study' || !obj.state) throw new Error('このアプリのバックアップではありません');
  state = Object.assign(emptyState(), obj.state);
  saveState();
}
