/**
 * app/versions/app.js — C2-07 版本树（浏览器端）。
 *
 * 存储：localStorage['cvs.versions.v1']（快照列表）与 ['cvs.versions.current']（编辑缓冲区）。
 * diff：统一走 model.mjs 的 diffSpecs()，页面只负责把 unified diff 排成左右两列。
 */
import {
  createVersionStore,
  readCurrent,
  writeCurrent,
  diffSpecs,
  specHash,
  specTotals,
  validateRows,
} from './model.mjs';

const FIXTURE_URL = '/fixtures/mini-41s/spec.json';

const storage = window.localStorage;
const store = createVersionStore(storage);

const $ = (id) => document.getElementById(id);
const els = {
  currentStats: $('current-stats'),
  currentHash: $('current-hash'),
  currentJson: $('current-json'),
  applyHint: $('apply-hint'),
  status: $('status'),
  name: $('version-name'),
  file: $('file-input'),
  versionCount: $('version-count'),
  versionList: $('version-list'),
  empty: $('empty'),
  diffLabel: $('diff-label'),
  diffEmpty: $('diff-empty'),
  diffScroll: $('diff-scroll'),
  diffBody: $('diff-body'),
  diffLeftTitle: $('diff-left-title'),
  diffRightTitle: $('diff-right-title'),
  toast: $('toast'),
};

const state = {
  current: null,
  versions: [],
  /** @type {string[]} 最多两个，按勾选先后 */
  selected: [],
};

let toastTimer = null;
function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 4000);
}

function setStatus(text) {
  els.status.textContent = text;
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const fmtTime = (ts) => new Date(ts).toLocaleString('zh-CN', { hour12: false });

function summarize(spec) {
  const totals = specTotals(spec);
  const issues = validateRows(spec);
  const errors = issues.filter((i) => i.level === 'error').length;
  return {
    totals,
    issues,
    text:
      `${spec?.meta?.name || '(未命名)'} · ${totals.duration.toFixed(3)}s · ${totals.frames} 帧 · ` +
      `${totals.segments} 段 · hash ${specHash(spec)} · 校验 ${errors ? `${errors} 处错误` : '通过'}`,
  };
}

function renderCurrent() {
  const { text } = summarize(state.current);
  els.currentStats.textContent = text;
  els.currentHash.textContent = specHash(state.current);
  if (els.currentJson.value !== JSON.stringify(state.current, null, 2)) {
    els.currentJson.value = JSON.stringify(state.current, null, 2);
  }
}

function parseCurrentText() {
  let spec;
  try {
    spec = JSON.parse(els.currentJson.value);
  } catch (err) {
    throw new Error(`JSON 解析失败：${err.message}`);
  }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('spec 必须是一个 JSON 对象');
  }
  return spec;
}

function setCurrent(spec, { persist = true, status = '' } = {}) {
  state.current = clone(spec);
  if (persist) writeCurrent(storage, state.current);
  renderCurrent();
  if (status) setStatus(status);
}

function applyJson() {
  try {
    const spec = parseCurrentText();
    setCurrent(spec, { status: `已应用缓冲区 JSON · hash ${specHash(spec)}` });
    els.applyHint.textContent = '已应用。保存版本后可从列表恢复。';
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

function saveVersion() {
  let spec;
  try {
    spec = parseCurrentText();
  } catch (err) {
    toast(err.message);
    return;
  }
  setCurrent(spec, { status: '' });
  try {
    const { entry, deduped } = store.save(spec, els.name.value, { now: Date.now() });
    els.name.value = '';
    state.versions = store.list();
    renderVersions();
    renderDiff();
    toast(deduped ? `内容与「${entry.name}」相同，已更新该版本时间` : `已保存版本「${entry.name}」`);
    setStatus(`已保存「${entry.name}」· hash ${entry.hash}`);
  } catch (err) {
    toast(`保存失败：${err.message}`);
  }
}

function renderVersions() {
  els.versionCount.textContent = String(state.versions.length);
  els.empty.hidden = state.versions.length > 0;
  els.versionList.textContent = '';

  for (const version of state.versions) {
    const li = document.createElement('li');
    li.className = 'version';
    li.dataset.id = version.id;

    const label = document.createElement('label');
    label.className = 'check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.id = version.id;
    box.checked = state.selected.includes(version.id);
    box.setAttribute('aria-label', `选择版本 ${version.name}`);
    label.appendChild(box);

    const main = document.createElement('div');
    main.className = 'v-main';
    const name = document.createElement('div');
    name.className = 'v-name';
    name.textContent = version.name;
    const meta = document.createElement('div');
    meta.className = 'v-meta';
    meta.textContent = `${fmtTime(version.ts)} · ${version.hash} · ${Number(version.duration).toFixed(3)}s`;
    main.append(name, meta);

    const restore = document.createElement('button');
    restore.type = 'button';
    restore.dataset.act = 'restore';
    restore.dataset.id = version.id;
    restore.textContent = '恢复';

    const del = document.createElement('button');
    del.type = 'button';
    del.dataset.act = 'delete';
    del.dataset.id = version.id;
    del.className = 'danger';
    del.textContent = '删除';

    li.append(label, main, restore, del);
    els.versionList.appendChild(li);
  }
}

function toggleSelection(id, checked) {
  let next = state.selected.filter((x) => x !== id);
  if (checked) next.push(id);
  if (next.length > 2) next = next.slice(-2);
  state.selected = next;
  renderVersions();
  renderDiff();
}

/** unified diff → 左右两列的行。 */
export function parseUnified(text) {
  const rows = [];
  let minus = [];
  let plus = [];
  const flush = () => {
    const n = Math.max(minus.length, plus.length);
    for (let i = 0; i < n; i++) {
      rows.push({
        left: minus[i] ?? '',
        right: plus[i] ?? '',
        leftType: i < minus.length ? 'del' : 'void',
        rightType: i < plus.length ? 'add' : 'void',
      });
    }
    minus = [];
    plus = [];
  };

  for (const line of String(text).split('\n')) {
    if (!line) continue;
    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;
    if (line.startsWith('@@')) {
      flush();
      rows.push({ sep: line });
      continue;
    }
    const t = line[0];
    const s = line.slice(1);
    if (t === '-') {
      if (plus.length) flush();
      minus.push(s);
    } else if (t === '+') {
      plus.push(s);
    } else {
      flush();
      rows.push({ left: s, right: s, leftType: 'ctx', rightType: 'ctx' });
    }
  }
  flush();
  return rows;
}

function renderDiff() {
  const picked = state.selected
    .map((id) => state.versions.find((v) => v.id === id))
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts);

  if (picked.length !== 2) {
    els.diffEmpty.hidden = false;
    els.diffScroll.hidden = true;
    els.diffLabel.textContent = '';
    els.diffBody.textContent = '';
    els.diffEmpty.textContent =
      state.versions.length < 2
        ? '至少保存两个版本后才能对比。'
        : '勾选两个版本后在这里对比；左旧右新。';
    return;
  }

  const [left, right] = picked;
  els.diffLeftTitle.textContent = `${left.name} · ${left.hash}`;
  els.diffRightTitle.textContent = `${right.name} · ${right.hash}`;

  const text = diffSpecs(left.spec, right.spec, {
    from: `${left.name} (${left.hash})`,
    to: `${right.name} (${right.hash})`,
  });
  els.diffBody.textContent = '';

  if (!text) {
    els.diffEmpty.hidden = false;
    els.diffScroll.hidden = true;
    els.diffLabel.textContent = '无差异';
    els.diffEmpty.textContent = '两个版本内容一致（hash 相同）。';
    return;
  }

  const rows = parseUnified(text);
  els.diffEmpty.hidden = true;
  els.diffScroll.hidden = false;

  let adds = 0;
  let dels = 0;
  for (const row of rows) {
    if (row.sep) {
      const tr = document.createElement('tr');
      tr.className = 'hunk';
      const td = document.createElement('td');
      td.colSpan = 2;
      td.textContent = row.sep;
      tr.appendChild(td);
      els.diffBody.appendChild(tr);
      continue;
    }
    if (row.leftType === 'del') dels++;
    if (row.rightType === 'add') adds++;
    const tr = document.createElement('tr');
    tr.className = 'diff-row';
    const leftTd = document.createElement('td');
    leftTd.className = `diff-cell ${row.leftType}`;
    leftTd.textContent = row.left;
    const rightTd = document.createElement('td');
    rightTd.className = `diff-cell ${row.rightType}`;
    rightTd.textContent = row.right;
    tr.append(leftTd, rightTd);
    els.diffBody.appendChild(tr);
  }
  els.diffLabel.textContent = `-${dels} / +${adds}`;
}

async function loadSample({ status = '已载入示例 spec' } = {}) {
  try {
    const res = await fetch(FIXTURE_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const spec = await res.json();
    setCurrent(spec, { status });
    toast(status);
  } catch (err) {
    toast(`载入示例失败：${err.message}`);
  }
}

async function importFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    let spec;
    try {
      spec = JSON.parse(text);
    } catch (err) {
      throw new Error(`JSON 解析失败：${err.message}`);
    }
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('文件内容不是 spec 对象');
    setCurrent(spec, { status: `已导入 ${file.name}` });
    toast(`已导入 ${file.name}`);
  } catch (err) {
    toast(err.message);
  } finally {
    els.file.value = '';
  }
}

function downloadCurrent() {
  let spec;
  try {
    spec = parseCurrentText();
  } catch (err) {
    toast(err.message);
    return;
  }
  const blob = new Blob([JSON.stringify(spec, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'project.spec.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus(`已下载 project.spec.json · hash ${specHash(spec)}`);
}

// ── 事件 ────────────────────────────────────────────────────────────────────
$('btn-save').addEventListener('click', saveVersion);
$('btn-apply').addEventListener('click', applyJson);
$('btn-import').addEventListener('click', () => els.file.click());
$('btn-sample').addEventListener('click', () => loadSample());
$('btn-download').addEventListener('click', downloadCurrent);

els.file.addEventListener('change', () => importFile(els.file.files?.[0]));

els.currentJson.addEventListener('input', () => {
  setStatus('缓冲区有未应用的修改');
  els.applyHint.textContent = '修改后点「应用 JSON」，或直接「保存当前 spec」。';
});

els.empty.addEventListener('click', (e) => {
  const action = e.target.closest('button')?.dataset.action;
  if (action === 'save') saveVersion();
  else if (action === 'import') els.file.click();
  else if (action === 'sample') loadSample({ status: '已载入示例 spec，可保存为版本' });
});

els.versionList.addEventListener('change', (e) => {
  const box = e.target.closest('input[type="checkbox"]');
  if (!box) return;
  toggleSelection(box.dataset.id, box.checked);
});

els.versionList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const version = state.versions.find((v) => v.id === id);
  if (!version) return;

  if (btn.dataset.act === 'restore') {
    setCurrent(version.spec, { status: `已恢复「${version.name}」到缓冲区（未下载）` });
    toast(`已恢复「${version.name}」；点「下载当前」导出`);
  } else if (btn.dataset.act === 'delete') {
    if (!window.confirm(`删除版本「${version.name}」？此操作不可撤销。`)) return;
    store.remove(id);
    state.selected = state.selected.filter((x) => x !== id);
    state.versions = store.list();
    renderVersions();
    renderDiff();
    toast(`已删除「${version.name}」`);
  }
});

// ── 启动 ────────────────────────────────────────────────────────────────────
async function boot() {
  state.versions = store.list();
  renderVersions();

  const saved = readCurrent(storage);
  if (saved) {
    setCurrent(saved, { persist: false, status: '已从浏览器缓冲区恢复上次编辑' });
  } else {
    await loadSample({ status: '未找到缓冲区，已载入示例 spec' });
  }
  renderDiff();
}

boot();
