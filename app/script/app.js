/**
 * app/script/app.js — C2-06 剧本表格编辑器（浏览器端）。
 *
 * 单一数据源：state.spec。表格、校验、JSON 预览、总时长/帧数/段数全部从它派生；
 * 编辑只走 applyRowEdit()，不直接改 DOM 状态。
 */
import {
  specToRows,
  applyRowEdit,
  validateRows,
  specHash,
  specTotals,
  resolveStructure,
  COPY_LIMITS,
} from './model.mjs';

const FIXTURE_URL = '/fixtures/mini-41s/spec.json';

const state = {
  spec: null,
  original: null,
  source: '',
  dirty: new Set(),
  /** @type {Array<{rowId:string|null, field:string|null, code:string, message:string, level:string}>} */
  issues: [],
};

const $ = (id) => document.getElementById(id);
const els = {
  tbody: $('tbody'),
  stats: $('stats'),
  formula: $('formula'),
  status: $('status'),
  issues: $('issues'),
  issueCount: $('issue-count'),
  json: $('json'),
  hash: $('hash'),
  empty: $('empty'),
  toast: $('toast'),
};

const COLUMNS = [
  { label: '#', cls: 'col-idx', value: (r) => String(r.index + 1), muted: true },
  { label: 'ID', cls: 'col-id mono', value: (r) => r.id },
  { label: '角色', value: (r) => r.role, badge: true },
  { label: '名称', field: 'name', value: (r) => r.name, text: true },
  { label: '起始秒', cls: 'col-num', value: (r) => r.start.toFixed(3), muted: true },
  { label: '时长', cls: 'col-num', value: (r) => r.duration.toFixed(3), muted: true },
  { label: 'first', field: 'first', value: (r) => r.first },
  { label: 'keyword', field: 'keyword', value: (r) => r.keyword },
  { label: 'recipe', field: 'recipe', value: (r) => r.recipe },
  { label: 't0', field: 't0', cls: 'col-num', value: (r) => r.t0 },
  { label: 'speed', field: 'speed', cls: 'col-num', value: (r) => r.speed },
];

const ROLE_LABEL = {
  opening: 'opening',
  card: 'card',
  scene: 'scene',
  more: 'more',
  flash: 'flash',
  ending: 'ending',
};

let toastTimer = null;
function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 4200);
}

function setStatus(text) {
  els.status.textContent = text;
}

function issueKey(rowId, field) {
  return `${rowId || '*'}:${field || '*'}`;
}

function render() {
  if (!state.spec) return;
  const rows = specToRows(state.spec);
  state.issues = validateRows(state.spec);
  const totals = specTotals(state.spec);
  const st = resolveStructure(state.spec);
  const hash = specHash(state.spec);

  // 顶部统计（公式与 templates/spec.mjs specDuration 一致）
  els.stats.textContent =
    `总时长 ${totals.duration.toFixed(3)}s · ${totals.frames} 帧 · ${rows.length} 段 · ${totals.fps}fps · hash ${hash}`;
  const roundCount = Array.isArray(state.spec.rounds) ? state.spec.rounds.length : 0;
  els.formula.textContent =
    `D = ${st.opening} + ${roundCount}×${st.round} + ${st.moreCard} + ${st.flash.count}×${st.flash.each} + ${st.ending} = ${totals.nominal}s`;
  els.hash.textContent = hash;

  // 行级 issue 索引
  const byRow = new Map();
  const byCell = new Map();
  for (const issue of state.issues) {
    if (issue.rowId) byRow.set(issue.rowId, (byRow.get(issue.rowId) || 0) + 1);
    if (issue.rowId && issue.field) byCell.set(issueKey(issue.rowId, issue.field), issue);
  }

  els.tbody.textContent = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.dataset.rowId = row.id;
    tr.dataset.role = row.role;
    if (byRow.has(row.id)) tr.classList.add('row-bad');

    for (const col of COLUMNS) {
      const td = document.createElement('td');
      if (col.cls) td.className = col.cls;

      const editable = col.field && row.editable.includes(col.field);
      if (editable) {
        td.classList.add('editable');
        td.dataset.field = col.field;
        td.tabIndex = 0; // 键盘可达：Tab 聚焦，Enter/F2 编辑
        td.title = `双击或 Enter 编辑 ${col.field}（${row.role} 行）`;
      }

      const raw = col.value(row);
      if (raw === null || raw === undefined || raw === '') {
        td.textContent = '—';
        td.classList.add('muted');
      } else {
        td.textContent = String(raw);
      }

      if (col.badge) {
        const span = document.createElement('span');
        span.className = `role role-${row.role}`;
        span.textContent = ROLE_LABEL[row.role] || String(raw);
        td.textContent = '';
        td.appendChild(span);
      }

      if (editable && state.dirty.has(`${row.id}:${col.field}`)) td.classList.add('dirty');

      const cellIssue = col.field ? byCell.get(issueKey(row.id, col.field)) : null;
      if (cellIssue) {
        td.classList.add('cell-bad');
        td.title = `[${cellIssue.code}] ${cellIssue.message}`;
      }
      tr.appendChild(td);
    }
    els.tbody.appendChild(tr);
  }

  // 校验面板
  els.issueCount.textContent = String(state.issues.length);
  els.issueCount.className = `badge ${state.issues.some((i) => i.level === 'error') ? 'bad' : state.issues.length ? 'warn' : 'ok'}`;
  els.issues.textContent = '';
  if (!state.issues.length) {
    const li = document.createElement('li');
    li.className = 'issue ok';
    li.textContent = '✓ 没有发现问题';
    els.issues.appendChild(li);
  } else {
    for (const issue of state.issues) {
      const li = document.createElement('li');
      li.className = `issue ${issue.level}`;
      if (issue.rowId) {
        li.dataset.rowId = issue.rowId;
        li.tabIndex = 0;
        li.title = '点击定位到该行';
      }
      const code = document.createElement('code');
      code.textContent = issue.code;
      const text = document.createElement('span');
      text.textContent = ` ${issue.rowId ? `${issue.rowId}${issue.field ? '.' + issue.field : ''} — ` : ''}${issue.message}`;
      li.append(code, text);
      els.issues.appendChild(li);
    }
  }

  els.json.textContent = JSON.stringify(state.spec, null, 2);
  els.empty.hidden = true;
}

function beginEdit(td) {
  if (!td || td.querySelector('input')) return;
  const tr = td.closest('tr');
  const rowId = tr?.dataset.rowId;
  const field = td.dataset.field;
  if (!rowId || !field) return;
  const row = specToRows(state.spec).find((r) => r.id === rowId);
  if (!row) return;

  const input = document.createElement('input');
  input.className = 'cell-input';
  input.type = 'text';
  const raw = row[field];
  input.value = raw === null || raw === undefined ? '' : String(raw);
  if (field === 't0' || field === 'speed') input.inputMode = 'decimal';
  td.textContent = '';
  td.classList.add('editing');
  td.appendChild(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    if (!commit) {
      render();
      return;
    }
    try {
      state.spec = applyRowEdit(state.spec, rowId, field, input.value);
      state.dirty.add(`${rowId}:${field}`);
      setStatus(`已修改 ${rowId}.${field} · 未下载`);
      render();
    } catch (err) {
      toast(String(err.message || err));
      render();
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
}

async function copyJson() {
  const text = JSON.stringify(state.spec, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    toast('JSON 已复制到剪贴板');
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand && document.execCommand('copy');
    area.remove();
    toast(ok ? 'JSON 已复制到剪贴板' : '复制失败：浏览器拒绝了剪贴板权限');
  }
}

function downloadJson() {
  const blob = new Blob([JSON.stringify(state.spec, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'project.spec.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus(`已下载 project.spec.json · hash ${specHash(state.spec)}`);
}

async function load(source = FIXTURE_URL) {
  try {
    const res = await fetch(source, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const spec = await res.json();
    state.spec = spec;
    state.original = JSON.parse(JSON.stringify(spec));
    state.source = source;
    state.dirty.clear();
    setStatus(`已加载 ${source}`);
    render();
  } catch (err) {
    els.stats.textContent = '加载失败';
    els.empty.hidden = false;
    els.empty.textContent = `无法加载 ${source}：${err.message}。请确认用 node app/script/serve.mjs 启动，并从仓库根访问。`;
    toast(`加载失败：${err.message}`);
  }
}

// ── 事件 ────────────────────────────────────────────────────────────────────
els.tbody.addEventListener('dblclick', (e) => {
  const td = e.target.closest('td[data-field]');
  if (td) beginEdit(td);
});
// 键盘编辑：聚焦的单元格按 Enter/F2 进入编辑（与双击等价）。
els.tbody.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== 'F2') return;
  const td = e.target.closest('td[data-field]');
  if (td) { e.preventDefault(); beginEdit(td); }
});

function jumpToRow(li) {
  const tr = els.tbody.querySelector(`tr[data-row-id="${CSS.escape(li.dataset.rowId)}"]`);
  if (!tr) return;
  tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
  tr.classList.add('flash');
  setTimeout(() => tr.classList.remove('flash'), 900);
}
els.issues.addEventListener('click', (e) => {
  const li = e.target.closest('li[data-row-id]');
  if (li) jumpToRow(li);
});
els.issues.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const li = e.target.closest('li[data-row-id]');
  if (li) { e.preventDefault(); jumpToRow(li); }
});

$('btn-download').addEventListener('click', downloadJson);
$('btn-copy').addEventListener('click', copyJson);
$('btn-reset').addEventListener('click', () => {
  state.spec = JSON.parse(JSON.stringify(state.original));
  state.dirty.clear();
  setStatus('已恢复原始 spec');
  render();
});

// 提示文案里带上限，避免用户猜
els.issues.title = `first ≤ ${COPY_LIMITS.first} 字，keyword ≤ ${COPY_LIMITS.keyword} 字`;

load();
