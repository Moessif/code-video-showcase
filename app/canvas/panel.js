/**
 * panel.js — schema 驱动的属性面板（C2-04）。
 *
 * 只认 D3 契约里的 schema 形状：
 *   { [prop]: { type: 'text'|'color'|'size'|'number'|'enum', label?, maxLength?, min?, max?, step?, options? } }
 *
 * 控件类型：
 *   text   → <input type="text">（maxLength 来自 schema）
 *   color  → <input type="color"> + 文本输入（兼容 rgba()/var()，颜色值以文本为准）
 *   number → <input type="number"> + 滑杆
 *   size   → 同 number（标签带 px，step 默认 1）
 *   enum   → <select>（options: ['a','b'] 或 [{value,label}]）
 *
 * 本模块不碰 canvas，只负责生成控件并回调 onChange(prop, value)。
 */

const HEX6 = /^#[0-9a-f]{6}$/i;

function el(tag, cls = '', text = '') {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== '') n.textContent = text;
  return n;
}

function optionList(spec) {
  const raw = Array.isArray(spec.options) ? spec.options : [];
  return raw.map((o) => (
    o && typeof o === 'object' && !Array.isArray(o)
      ? { value: o.value, label: o.label == null ? String(o.value) : String(o.label) }
      : { value: o, label: String(o) }
  ));
}

function numberField(prop, spec, value, onChange) {
  const wrap = el('div', 'color-row');
  const min = Number.isFinite(Number(spec.min)) ? Number(spec.min) : 0;
  const max = Number.isFinite(Number(spec.max)) ? Number(spec.max) : 1000;
  const step = Number.isFinite(Number(spec.step)) ? Number(spec.step) : 1;
  const v = Number.isFinite(Number(value)) ? Number(value) : min;

  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(v);

  const num = document.createElement('input');
  num.type = 'number';
  num.min = String(min);
  num.max = String(max);
  num.step = String(step);
  num.value = String(v);

  const emit = (raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(max, Math.max(min, n));
    range.value = String(clamped);
    num.value = String(clamped);
    onChange(prop, clamped);
  };

  range.addEventListener('input', () => emit(range.value));
  num.addEventListener('input', () => { if (num.value !== '') emit(num.value); });

  wrap.append(range, num);
  return wrap;
}

function colorField(prop, spec, value, onChange) {
  const wrap = el('div', 'color-row');
  const text = String(value == null ? '' : value);

  const swatch = document.createElement('input');
  swatch.type = 'color';
  swatch.value = HEX6.test(text) ? text.toLowerCase() : '#ffffff';

  const txt = document.createElement('input');
  txt.type = 'text';
  txt.placeholder = '#rrggbb / rgba()';
  txt.value = text;

  const sync = (v) => {
    txt.value = v;
    if (HEX6.test(v)) swatch.value = v.toLowerCase();
    onChange(prop, v);
  };

  swatch.addEventListener('input', () => sync(swatch.value));
  txt.addEventListener('change', () => {
    const v = txt.value.trim();
    if (v) sync(v);
  });

  wrap.append(swatch, txt);
  return wrap;
}

function textField(prop, spec, value, onChange) {
  const input = document.createElement('input');
  input.type = 'text';
  if (Number.isFinite(Number(spec.maxLength)) && Number(spec.maxLength) > 0) {
    input.maxLength = Number(spec.maxLength);
  }
  input.value = value == null ? '' : String(value);
  input.addEventListener('input', () => onChange(prop, input.value));
  return input;
}

function enumField(prop, spec, value, onChange) {
  const select = document.createElement('select');
  const opts = optionList(spec);
  let matched = false;
  for (const opt of opts) {
    const o = document.createElement('option');
    o.value = String(opt.value);
    o.textContent = opt.label;
    if (String(opt.value) === String(value)) { o.selected = true; matched = true; }
    select.append(o);
  }
  if (!matched && opts.length) select.selectedIndex = 0;
  select.addEventListener('change', () => {
    const raw = select.value;
    const hit = opts.find((o) => String(o.value) === raw);
    const v = hit ? hit.value : raw;
    onChange(prop, typeof v === 'number' ? v : (Number.isFinite(Number(v)) && String(Number(v)) === raw ? Number(v) : v));
  });
  return select;
}

/**
 * 渲染一个节点的属性面板。
 * @param {HTMLElement} root
 * @param {null | {id:string, role?:string, rect:number[], props?:object, schema?:object}} entry
 * @param {{onChange?: (prop: string, value: any) => void}} [opts]
 */
export function renderInspector(root, entry, { onChange = () => {} } = {}) {
  root.innerHTML = '';
  if (!entry) {
    root.append(el('p', 'muted', '未选中节点。点击画面里的可编辑区域（文本 / 关键词 / HUD / 编号）。'));
    return;
  }

  const head = el('div', 'insp-head');
  head.append(el('code', '', entry.id), el('span', 'badge', entry.role || 'node'));
  root.append(head);

  if (Array.isArray(entry.rect) && entry.rect.length === 4) {
    const r = entry.rect.map((n) => (Number(n).toFixed(1)));
    root.append(el('p', 'muted mono', `rect ${r[0]}, ${r[1]}, ${r[2]}, ${r[3]}`));
  }

  const fields = Object.entries(entry.schema || {});
  if (!fields.length) {
    root.append(el('p', 'muted', '该节点没有 schema（只读）。'));
    return;
  }

  for (const [prop, specRaw] of fields) {
    const spec = (specRaw && typeof specRaw === 'object') ? specRaw : { type: 'text' };
    const type = String(spec.type || 'text');
    const value = entry.props ? entry.props[prop] : undefined;

    const row = el('div', 'field-row');
    row.append(el('label', '', spec.label || prop));

    let control;
    if (type === 'color') control = colorField(prop, spec, value, onChange);
    else if (type === 'enum') control = enumField(prop, spec, value, onChange);
    else if (type === 'number' || type === 'size') control = numberField(prop, spec, value, onChange);
    else control = textField(prop, spec, value, onChange);

    row.append(control);
    root.append(row);
  }
}

/**
 * 渲染 patch 列表 + 导出按钮。
 * @param {HTMLElement} root
 * @param {Array} patches
 * @param {{onCopy?:Function, onDownload?:Function, onClear?:Function}} [opts]
 */
export function renderPatches(root, patches = [], { onCopy, onDownload, onClear } = {}) {
  root.innerHTML = '';

  const head = el('div', 'insp-head');
  head.append(el('h3', '', 'patches'), el('span', 'badge', String(patches.length)));
  root.append(head);

  if (!patches.length) {
    root.append(el('p', 'muted', '还没有 patch。改动任意控件会写进 spec.patches。'));
  } else {
    const pre = el('pre', 'json');
    pre.textContent = JSON.stringify(patches, null, 2);
    root.append(pre);
  }

  const bar = el('div', 'btn-row');
  const copy = el('button', '', '复制 patches JSON');
  const dl = el('button', '', '下载 spec.patches.json');
  const clear = el('button', '', '清空');
  copy.disabled = dl.disabled = clear.disabled = !patches.length;
  if (onCopy) copy.addEventListener('click', onCopy);
  if (onDownload) dl.addEventListener('click', onDownload);
  if (onClear) clear.addEventListener('click', onClear);
  bar.append(copy, dl, clear);
  root.append(bar);
}

/** 面板只读显示用：把 entry 深拷贝一份，避免外部改到 __hit 里的活对象。 */
export function cloneEntry(entry) {
  if (!entry) return null;
  try { return JSON.parse(JSON.stringify(entry)); } catch { return null; }
}
