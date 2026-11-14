/**
 * app.js — 评审页：轮询 job、展示成片/统计/spec、帧级评论（localStorage）。
 *
 * URL 参数：
 *   ?job=<id>                      必填才有内容；id 白名单 ^[a-z0-9-]+$
 *   ?api=http://127.0.0.1:5190     API 基地址，默认本机 5190
 *
 * 评论存储：localStorage["cvs.review.<job>"] =
 *   [{ id, t, text, createdAt }]
 * 零外部资源。
 */

// 默认同源：评审服务器把 /jobs/* 与 /health 反代到 API（CORS 默认关闭，
// 跨源直 fetch 会被拦）。?api=http://… 仍可显式直连 API（需其开启 CORS）。
const DEFAULT_API = '';
const POLL_MS = 2000;
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

const $ = (id) => document.getElementById(id);
const el = {
  empty: $('empty'),
  emptyReason: $('emptyReason'),
  jobLabel: $('jobLabel'),
  conn: $('conn'),
  video: $('video'),
  videoPlaceholder: $('videoPlaceholder'),
  videoPlaceholderText: $('videoPlaceholderText'),
  status: $('status'),
  exitCode: $('exitCode'),
  createdAt: $('createdAt'),
  startedAt: $('startedAt'),
  finishedAt: $('finishedAt'),
  statDuration: $('statDuration'),
  statFrames: $('statFrames'),
  statSegments: $('statSegments'),
  jobError: $('jobError'),
  jobErrorLinks: $('jobErrorLinks'),
  log: $('log'),
  spec: $('spec'),
  specState: $('specState'),
  form: $('commentForm'),
  time: $('commentTime'),
  text: $('commentText'),
  formHint: $('formHint'),
  useCurrent: $('useCurrent'),
  list: $('commentList'),
  commentsEmpty: $('commentsEmpty'),
};

const params = new URLSearchParams(location.search);
const rawJob = (params.get('job') || '').trim();
const job = /^[a-z0-9-]{1,128}$/.test(rawJob) ? rawJob : '';
const api = normalizeApi(params.get('api') || DEFAULT_API);

let comments = [];
let pollTimer = null;
let specLoaded = false;
let lastSpecPath = null;

// ── helpers ─────────────────────────────────────────────────────────────────

function normalizeApi(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
  } catch { /* fall through */ }
  return DEFAULT_API;
}

function setConn(state, text) {
  el.conn.dataset.state = state;
  el.conn.textContent = text;
}

function statusLabel(status) {
  const map = {
    queued: '排队中',
    running: '编译中',
    done: '完成',
    failed: '失败',
    cancelled: '已取消',
    none: '—',
    unknown: '未知',
  };
  return map[status] || status || '—';
}

function setStatus(status) {
  el.status.dataset.status = status || 'none';
  el.status.textContent = statusLabel(status);
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function formatTime(t) {
  const s = Math.max(0, Number(t) || 0);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, '0')}:${rest.toFixed(3).padStart(6, '0')}`;
}

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const ac = new AbortController();
  setTimeout(() => ac.abort(new Error('timeout')), ms);
  return ac.signal;
}

async function fetchJson(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(init.headers || {}) } });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* keep null */ }
  return { res, body, text };
}

// ── 评论存储 ────────────────────────────────────────────────────────────────

function commentsKey() {
  return job ? `cvs.review.${job}` : null;
}

function loadComments() {
  const key = commentsKey();
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((c) => c && Number.isFinite(Number(c.t)) && Number(c.t) >= 0 && typeof c.text === 'string' && c.text.trim())
      .map((c) => ({
        id: String(c.id || `c-${c.t}`),
        t: Number(c.t),
        text: String(c.text),
        createdAt: c.createdAt || null,
      }))
      .sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}

function persistComments() {
  const key = commentsKey();
  if (!key) return false;
  try {
    localStorage.setItem(key, JSON.stringify(comments));
    return true;
  } catch {
    return false;
  }
}

/**
 * 导出 review.json（v2.4 / P1-13）：评论不能只活在这台浏览器的 localStorage 里，
 * 否则「审片意见」无法进入版本快照。这里只下载文件，不写服务器。
 * 把它放到 <outDir>/review.json，`cvs snapshot` 会一起收进 vNNN/。
 */
function exportReview() {
  const payload = {
    schema: 'cvs.review/v1',
    job: job || null,
    exportedAt: new Date().toISOString(),
    comments: comments.map((c) => ({ t: c.t, text: c.text, createdAt: c.createdAt })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'review.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  if (el.formHint) el.formHint.textContent = `已导出 ${comments.length} 条评论到 review.json；放进 <outDir>/ 后 cvs snapshot 会收进版本。`;
}

function renderComments() {
  el.list.textContent = '';
  for (const c of comments) {
    const li = document.createElement('li');
    li.className = 'comment';

    const head = document.createElement('div');
    head.className = 'commentHead';

    const timeBtn = document.createElement('button');
    timeBtn.type = 'button';
    timeBtn.className = 'timeChip';
    timeBtn.textContent = formatTime(c.t);
    timeBtn.title = '跳转到视频该时间';
    timeBtn.addEventListener('click', () => seekTo(c.t));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'deleteBtn';
    del.textContent = '删除';
    del.setAttribute('aria-label', `删除 ${formatTime(c.t)} 处的评论`);
    del.addEventListener('click', () => {
      comments = comments.filter((x) => x.id !== c.id);
      if (persistComments()) {
        renderComments();
        el.formHint.textContent = '评论已删除。';
      } else {
        el.formHint.textContent = 'localStorage 不可用，删除未保存。';
      }
    });

    head.append(timeBtn, del);

    const body = document.createElement('p');
    body.className = 'commentText';
    body.textContent = c.text;

    const meta = document.createElement('span');
    meta.className = 'commentMeta';
    meta.textContent = c.createdAt ? formatDate(c.createdAt) : '';

    li.append(head, body, meta);
    el.list.append(li);
  }
  el.commentsEmpty.hidden = comments.length > 0;
}

function seekTo(t) {
  const v = el.video;
  if (!v.getAttribute('src')) {
    el.formHint.textContent = '成片尚未就绪，无法跳转。';
    return;
  }
  const target = Math.max(0, Number(t) || 0);
  try {
    v.currentTime = target;
    v.play().catch(() => { /* autoplay may be blocked; keep the seek */ });
    v.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.formHint.textContent = `已跳到 ${formatTime(target)}。`;
  } catch {
    el.formHint.textContent = '跳转失败：视频尚未加载。';
  }
}

// ── job 渲染 ────────────────────────────────────────────────────────────────

function setVideo(jobId) {
  if (el.video.getAttribute('src')) return;
  el.video.src = `${api}/jobs/${encodeURIComponent(jobId)}/master.mp4`;
  el.video.load();
  el.videoPlaceholder.hidden = true;
}

el.video.addEventListener('error', () => {
  if (!el.video.getAttribute('src')) return;
  el.videoPlaceholder.hidden = false;
  el.videoPlaceholderText.textContent = '成片加载失败（master.mp4 可能尚未生成或 API 不可达）。';
});

function renderJob(info) {
  const status = info.status || 'unknown';
  setStatus(status);
  el.exitCode.textContent = info.exitCode === null || info.exitCode === undefined ? '—' : String(info.exitCode);
  el.createdAt.textContent = formatDate(info.createdAt);
  el.startedAt.textContent = formatDate(info.startedAt);
  el.finishedAt.textContent = formatDate(info.finishedAt);

  const st = info.stats || {};
  el.statDuration.textContent = Number.isFinite(Number(st.duration)) ? `${Number(st.duration).toFixed(3)} s` : '—';
  el.statFrames.textContent = Number.isFinite(Number(st.frames)) ? String(st.frames) : '—';
  el.statSegments.textContent = Number.isFinite(Number(st.segments)) ? String(st.segments) : '—';

  if (info.error || info.errorCode) {
    el.jobError.hidden = false;
    // 机器可读失败契约：错误码/阶段/失败段，比裸错误串更利于分流。
    const head = [info.errorCode, info.phase ? `phase=${info.phase}` : null].filter(Boolean).join(' · ');
    const segs = Array.isArray(info.failedSegments) && info.failedSegments.length
      ? `\n失败段：${info.failedSegments.join(', ')}` : '';
    el.jobError.textContent = `${head ? head + '\n' : ''}${info.error || ''}${segs}`;
    // 诊断产物链接（同源静态路径）：完整日志 / 阶段诊断 / error.json。
    el.jobErrorLinks.replaceChildren();
    for (const [label, p] of [['构建日志', info.logPath], ['阶段诊断', info.detailPath], ['error.json', info.errorPath]]) {
      if (!p) continue;
      const a = document.createElement('a');
      a.href = `/${p}`; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = label;
      el.jobErrorLinks.append(a, ' ');
    }
  } else {
    el.jobError.hidden = true;
    el.jobError.textContent = '';
    el.jobErrorLinks.replaceChildren();
  }

  el.log.textContent = info.logTail ? info.logTail : '（暂无日志）';
  if (info.specPath) lastSpecPath = info.specPath;

  if (status === 'done') {
    setVideo(info.id || job);
  } else if (status === 'failed') {
    el.videoPlaceholder.hidden = false;
    el.videoPlaceholderText.textContent = '编译失败，见下方构建日志。';
  } else if (status === 'cancelled') {
    el.videoPlaceholder.hidden = false;
    el.videoPlaceholderText.textContent = '任务已取消。';
  } else {
    el.videoPlaceholder.hidden = false;
    el.videoPlaceholderText.textContent = status === 'running' ? '编译中，成片就绪后自动加载…' : '排队中…';
  }
}

function schedulePoll() {
  if (TERMINAL.has(el.status.dataset.status) || !job) return;
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, POLL_MS);
}

async function poll() {
  if (!job) return;
  try {
    const { res, body } = await fetchJson(`${api}/jobs/${encodeURIComponent(job)}`, {
      cache: 'no-store',
      signal: timeoutSignal(8000),
    });
    if (res.status === 404) {
      setConn('bad', 'job 不存在');
      setStatus('unknown');
      el.empty.hidden = false;
      el.emptyReason.textContent = `API 中找不到 job ${job}。确认 id 后刷新页面。`;
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setConn('ok', `API ${api}`);
    renderJob(body || {});
    if (!TERMINAL.has((body && body.status) || '')) schedulePoll();
  } catch (e) {
    setConn('bad', 'API 不可达');
    setStatus('unknown');
    el.empty.hidden = false;
    el.emptyReason.textContent = `无法连接 ${api}：${e.message || e}。确认 \`node server/api.mjs\` 已启动。`;
    schedulePoll();
  }
}

async function loadSpec() {
  if (!job || specLoaded) return;
  specLoaded = true;
  el.specState.textContent = '加载中…';
  // 优先用 API 投影的 specPath（--outdir/--root 变体下猜路径会错）；兜底默认路径。
  const specUrl = lastSpecPath ? `/${lastSpecPath}` : `/out/api/${encodeURIComponent(job)}/project.spec.json`;
  try {
    const res = await fetch(specUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const spec = await res.json();
    el.spec.textContent = JSON.stringify(spec, null, 2);
    el.specState.textContent = lastSpecPath || `out/api/${job}/project.spec.json`;
  } catch (e) {
    el.specState.textContent = `spec 不可用：${e.message || e}`;
    el.spec.textContent = '—';
    specLoaded = false;
  }
}

// ── 表单 ────────────────────────────────────────────────────────────────────

el.useCurrent.addEventListener('click', () => {
  const v = el.video;
  if (!v.getAttribute('src') || !Number.isFinite(v.currentTime)) {
    el.formHint.textContent = '成片尚未就绪，先等编译完成。';
    return;
  }
  el.time.value = v.currentTime.toFixed(3);
  el.time.focus();
});

el.form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (!job) {
    el.formHint.textContent = '没有 job 参数：请用 ?job=<id> 打开页面，评论才会保存。';
    el.time.focus();
    return;
  }
  const t = Number(el.time.value);
  if (!Number.isFinite(t) || t < 0) {
    el.formHint.textContent = '时间码必须是不小于 0 的秒数。';
    el.time.focus();
    return;
  }
  const text = el.text.value.trim();
  if (!text) {
    el.formHint.textContent = '评论内容不能为空。';
    el.text.focus();
    return;
  }
  const id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `c-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  comments.push({ id, t, text, createdAt: new Date().toISOString() });
  comments.sort((a, b) => a.t - b.t);
  if (!persistComments()) {
    comments = comments.filter((c) => c.id !== id);
    el.formHint.textContent = 'localStorage 不可用，评论未保存（隐私模式或存储已满）。';
    return;
  }
  renderComments();
  el.text.value = '';
  el.formHint.textContent = `已保存到 localStorage["cvs.review.${job}"]（${formatTime(t)}）。`;
});

el.time.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    el.text.focus();
  }
});

const exportBtn = $('exportReview');
if (exportBtn) exportBtn.addEventListener('click', exportReview);

// ── boot ────────────────────────────────────────────────────────────────────

function boot() {
  if (!job) {
    el.empty.hidden = false;
    el.emptyReason.textContent = rawJob
      ? `job 参数 "${rawJob}" 非法：只允许小写字母、数字与短横线。`
      : '当前地址没有 job 参数。';
    el.jobLabel.textContent = '无 job';
    el.formHint.textContent = '未指定 job：可以试写评论，但不会保存。';
    setStatus('none');
    el.conn.dataset.state = 'idle';
    el.conn.textContent = '待连接';
    renderComments();
    return;
  }

  el.empty.hidden = true;
  el.jobLabel.textContent = `job ${job}`;
  el.videoPlaceholderText.textContent = '查询任务状态…';
  comments = loadComments();
  renderComments();
  setConn('idle', '连接中…');
  setStatus('queued');
  loadSpec();
  poll();
}

boot();
