/**
 * edit-bridge.mjs — 编辑契约 D3 的浏览器实现（仅 Canvas 页面使用）。
 *
 *   import { createEditBridge, mergePatches } from './edit-bridge.mjs';
 *
 *   const bridge = createEditBridge({
 *     getSpec:  () => SPEC,                     // 返回页面自己的 spec 对象（含 patches: []）
 *     setPatch: (patches, record) => { SPEC.patches = patches; },
 *     renderAt: (t) => window.renderFrame(t),   // t 由 setTime() 记录
 *     canvas,                                   // <canvas>，用于 DPR / CSS 缩放换算
 *   });
 *   bridge.install();                           // window.__spec / __inspect / __patch / __hit
 *
 * 页面在每次 renderFrame 开头调用 bridge.begin()，绘制过程中把可编辑区域 add() 进去；
 * 命中测试由 bridge 自己维护，**不读 DOM**。默认渲染路径只调用 begin/add，不额外绘制任何像素。
 *
 * 坐标系（D4/D3 约定）：
 *   - __inspect(x, y) 的入参是 **画布位图坐标**（1920×1080 设计坐标）；宿主页面负责
 *     把鼠标事件换算到画布坐标。宿主可直接用 bridge.clientToCanvas(clientX, clientY)，
 *     它已经处理 devicePixelRatio 与 CSS transform/缩放（canvas.width / rect.width）。
 *   - rect 一律是 [x, y, w, h]，画布位图坐标，左上原点。
 *
 * patch 语义：
 *   __patch('card.first', { text: '新文案' })
 *     → 记录 { id: 'card.first', scope: 'card', props: { text: '新文案' } }
 *     → 合并进 spec.patches（同 id+scope 的已有条目就地合并）
 *     → renderAt(当前 t) → 返回 { id, props, diff }
 *   __patch('card', { color: '#00ff00' })      // id 不含 '.' = scope 级 patch
 *     → 记录 { id: null, scope: 'card', props: {...} }，页面用 mergePatches() 应用到该 scope 的所有节点。
 *
 * 页面侧应用 patch 的唯一正确姿势：
 *   const props = mergePatches(SPEC.patches, 'card', 'card.first', {});
 *   const text  = props.text ?? DEFAULT_TEXT;
 * 这样 __patch 之后重绘即可复现；bridge 本身不碰 canvas 像素。
 */

export const EDIT_CONTRACT_VERSION = 1;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function normalizeRect(rect) {
  if (Array.isArray(rect) && rect.length === 4) {
    const r = [Number(rect[0]), Number(rect[1]), Number(rect[2]), Number(rect[3])];
    return r.every(isNum) ? r : null;
  }
  if (rect && typeof rect === 'object') {
    const r = [Number(rect.x), Number(rect.y), Number(rect.w ?? rect.width), Number(rect.h ?? rect.height)];
    return r.every(isNum) ? r : null;
  }
  return null;
}

function cloneEntry(e) {
  let schema = {};
  try { schema = JSON.parse(JSON.stringify(e.schema || {})); } catch { schema = {}; }
  return {
    id: e.id,
    role: e.role ?? null,
    rect: e.rect.slice(),
    props: { ...e.props },
    schema,
  };
}

/**
 * 把 patches 里能作用到某个节点的 props 合并出来（后写的覆盖先写的）。
 *
 * - `p.id === id`：精确命中该节点（__patch('card.first', …)）。
 * - `p.id == null && p.scope === scope`：scope 级 patch（__patch('card', …)），作用于该 scope 的所有节点。
 *
 * @param {Array<{id?:string|null, scope?:string|null, props?:object}>} patches
 * @param {string|null} scope 节点所属 scope，如 'card' / 'hud' / 'title'
 * @param {string|null} id    节点 id，如 'card.first'
 * @param {object} out        合并目标（会被就地修改并返回）
 */
export function mergePatches(patches, scope, id, out = {}) {
  if (!Array.isArray(patches)) return out;
  for (const p of patches) {
    if (!p || typeof p !== 'object' || !p.props || typeof p.props !== 'object') continue;
    const direct = id != null && p.id === id;
    const scoped = (p.id == null || p.id === '') && scope != null && p.scope === scope;
    if (direct || scoped) Object.assign(out, p.props);
  }
  return out;
}

/**
 * @param {object} opts
 * @param {() => object} opts.getSpec       返回页面 spec（必须含 patches 数组）
 * @param {(patches:object[], record:object|null) => void} [opts.setPatch] 把新 patches 写回 spec
 * @param {(t:number) => void} [opts.renderAt] 重绘某一时刻
 * @param {HTMLCanvasElement} [opts.canvas]  用于 DPR / CSS 缩放换算
 * @param {Window} [opts.namespace]          安装目标，默认 window
 */
export function createEditBridge({ getSpec, setPatch, renderAt, canvas, namespace } = {}) {
  /** @type {Array<{id:string, role:string|null, rect:number[], props:object, schema:object}>} */
  const entries = [];
  let time = 0;
  let dropped = 0;
  let fallbackPatches = [];

  function specObject() {
    try { return typeof getSpec === 'function' ? getSpec() : null; } catch { return null; }
  }

  function patchList() {
    const s = specObject();
    if (s && Array.isArray(s.patches)) return s.patches;
    return fallbackPatches;
  }

  function snapshot() {
    const s = specObject();
    if (!s) return {};
    try { return JSON.parse(JSON.stringify(s)); } catch { return { ...s }; }
  }

  /** 清空命中表；window.__hit 引用的是同一个数组，不会被替换。 */
  function begin() {
    entries.length = 0;
    return entries;
  }

  /** 注册一个可编辑区域。非法条目被丢弃并计入 stats().dropped，不影响渲染。 */
  function add(entry) {
    if (!entry || typeof entry !== 'object') { dropped++; return null; }
    if (typeof entry.id !== 'string' || !entry.id) { dropped++; return null; }
    const rect = normalizeRect(entry.rect);
    if (!rect) { dropped++; return null; }
    const schema = (entry.schema && typeof entry.schema === 'object' && !Array.isArray(entry.schema))
      ? entry.schema : {};
    const props = (entry.props && typeof entry.props === 'object' && !Array.isArray(entry.props))
      ? { ...entry.props } : {};
    const rec = { id: entry.id, role: entry.role ?? null, rect, props, schema };
    entries.push(rec);
    return rec;
  }

  /** 最上层（后注册优先）的条目；未命中返回 null。入参是画布位图坐标。 */
  function hit(x, y) {
    if (!isNum(x) || !isNum(y)) return null;
    for (let i = entries.length - 1; i >= 0; i--) {
      const [rx, ry, rw, rh] = entries[i].rect;
      if (rx <= x && x <= rx + rw && ry <= y && y <= ry + rh) return entries[i];
    }
    return null;
  }

  /** 对外只读副本：命中则返回 { id, role, rect, props, schema }，否则 null。 */
  function inspect(x, y) {
    const e = hit(x, y);
    return e ? cloneEntry(e) : null;
  }

  /**
   * 改内存 spec → 重绘当前时刻 → 返回 { id, props, diff }。
   * id 含 '.' 时是节点 patch；不含 '.' 时是 scope 级 patch（id 记为 null）。
   */
  function patch(id, props) {
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('__patch(id, props): id must be a non-empty string');
    }
    if (!props || typeof props !== 'object' || Array.isArray(props)) {
      throw new Error('__patch(id, props): props must be a plain object');
    }
    const list = patchList();
    const dot = id.indexOf('.');
    const targetId = dot > 0 ? id : null;
    const scope = dot > 0 ? id.slice(0, dot) : id;

    let idx = -1;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || typeof e !== 'object') continue;
      if ((e.id ?? null) === targetId && (e.scope ?? null) === scope) { idx = i; break; }
    }

    let op = 'add';
    let before = null;
    if (idx >= 0) {
      op = 'merge';
      before = { ...list[idx].props };
      Object.assign(list[idx].props, props);
    } else {
      list.push({ id: targetId, scope, props: { ...props } });
      idx = list.length - 1;
    }

    if (typeof setPatch === 'function') setPatch(list, list[idx]);
    if (typeof renderAt === 'function') renderAt(time);

    return {
      id,
      props: { ...props },
      scope,
      diff: {
        op,
        index: idx,
        before,
        after: { ...list[idx].props },
        patches: list.length,
        t: time,
      },
    };
  }

  /** 矩形框选：返回与矩形相交的所有节点（后注册优先，保持绘制顺序）。 */
  function inspectRect(x0, y0, x1, y1) {
    const n = [x0, y0, x1, y1].map(Number);
    if (!n.every(Number.isFinite)) return [];
    const [ax, ay, bx, by] = n;
    const rx = Math.min(ax, bx);
    const ry = Math.min(ay, by);
    const rw = Math.abs(bx - ax);
    const rh = Math.abs(by - ay);
    const out = [];
    for (const e of entries) {
      const [ex, ey, ew, eh] = e.rect;
      if (ex < rx + rw && ex + ew > rx && ey < ry + rh && ey + eh > ry) out.push(cloneEntry(e));
    }
    return out;
  }

  /**
   * 批量 patch：对每个目标节点应用同一组 props。
   * targets 可以是 id 字符串数组，或 __inspectRect 返回的 entry 数组。
   */
  function patchMany(targets, props) {
    if (!Array.isArray(targets)) throw new Error('__patchMany(targets, props): targets must be an array');
    if (!props || typeof props !== 'object' || Array.isArray(props)) {
      throw new Error('__patchMany(targets, props): props must be a plain object');
    }
    const results = [];
    for (const t of targets) {
      const id = typeof t === 'string' ? t : t && t.id;
      if (typeof id === 'string' && id) results.push(patch(id, props));
    }
    return { count: results.length, results };
  }

  /** 清空 patches 并重绘。 */
  function clearPatches() {
    const list = patchList();
    list.length = 0;
    if (typeof setPatch === 'function') setPatch(list, null);
    if (typeof renderAt === 'function') renderAt(time);
    return { patches: 0, t: time };
  }

  function exportPatches() {
    try { return JSON.parse(JSON.stringify(patchList())); } catch { return []; }
  }

  function setTime(t) {
    if (isNum(t)) time = t;
    return time;
  }
  function getTime() { return time; }

  /** 画布位图大小 / CSS 大小 / DPR —— 宿主换算与自检用。 */
  function metrics() {
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    if (!canvas || typeof canvas.getBoundingClientRect !== 'function') {
      return { width: 0, height: 0, cssWidth: 0, cssHeight: 0, scaleX: 1, scaleY: 1, dpr };
    }
    const r = canvas.getBoundingClientRect();
    return {
      width: canvas.width,
      height: canvas.height,
      cssWidth: r.width,
      cssHeight: r.height,
      scaleX: r.width ? canvas.width / r.width : 1,
      scaleY: r.height ? canvas.height / r.height : 1,
      dpr,
    };
  }

  /**
   * 视口 client 坐标（页面 CSS 像素）→ 画布位图坐标。
   * 已经处理 DPR 与 canvas 的 CSS 缩放；宿主收到鼠标事件后调用它即可。
   */
  function clientToCanvas(clientX, clientY) {
    if (!canvas || typeof canvas.getBoundingClientRect !== 'function') {
      return { x: clientX, y: clientY };
    }
    const r = canvas.getBoundingClientRect();
    const m = metrics();
    return { x: (clientX - r.left) * m.scaleX, y: (clientY - r.top) * m.scaleY };
  }

  function stats() {
    return { entries: entries.length, dropped, patches: patchList().length, time };
  }

  function install(target) {
    const w = target || namespace || (typeof window !== 'undefined' ? window : null);
    if (!w) throw new Error('createEditBridge: no window to install on');
    w.__spec = () => snapshot();
    w.__inspect = (x, y) => inspect(x, y);
    w.__inspectRect = (x0, y0, x1, y1) => inspectRect(x0, y0, x1, y1);
    w.__patch = (id, props) => patch(id, props);
    w.__patchMany = (targets, props) => patchMany(targets, props);
    w.__hit = entries;            // 实时数组：每次 renderFrame 后内容更新，引用不变
    w.__editBridge = api;         // clientToCanvas / metrics / exportPatches / clearPatches …
    return api;
  }

  const api = {
    version: EDIT_CONTRACT_VERSION,
    install,
    begin,
    add,
    hit,
    inspect,
    inspectRect,
    patch,
    patchMany,
    clearPatches,
    spec: snapshot,
    exportPatches,
    setTime,
    getTime,
    metrics,
    clientToCanvas,
    stats,
    get entries() { return entries; },
    get patches() { return patchList(); },
  };
  return api;
}
