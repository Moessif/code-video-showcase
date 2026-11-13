#!/usr/bin/env node
/**
 * test-inspect.mjs — D3 编辑契约的端到端验收（big-card 页面，真实 Chrome）。
 *
 *   CHROME_EXE="C:/Program Files/Google/Chrome/Application/chrome.exe" node scripts/test-inspect.mjs
 *
 * 断言（全部真实执行）：
 *   1. window.__hit 非空；每个 entry 有 id / rect[4] / schema
 *   2. schema 覆盖 text / color / size / number / enum
 *   3. __inspect 在已知文本矩形中心返回对应 id；空白处返回 null
 *   4. __patch(id, { color: '#00ff00' }) 后 __spec().patches 增加，
 *      且同一 t 的 canvas.toDataURL 与 patch 前不同（页内哈希对比），关键词矩形内真的出现绿色像素
 *   5. 再 renderFrame 同一 t，toDataURL 与 patch 后一致（确定性）
 *   6. 同 id 二次 patch 就地合并 props（不新增条目）；文本 patch 同样生效
 *
 * 退出码 0/1。零 npm 依赖，只连本机 Chrome 与临时静态服务器。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, evaluate, browserCandidates, launchRetry } from '../templates/cdp.mjs';
import { createStaticServer } from '../app/canvas/serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
  return ok;
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

async function waitFor(client, sessionId, fn, timeoutMs = 30000, label = 'condition') {
  const started = Date.now();
  let lastErr = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const v = await evaluate(client, sessionId, fn);
      if (v) return true;
    } catch (e) { lastErr = e; }
    await sleep(120);
  }
  console.log(`[wait] timeout: ${label}${lastErr ? ` — ${lastErr.message}` : ''}`);
  return false;
}

const PAGE_URL = '/templates/big-card.html?theme=coral-noir&seg=1&t0=0&speed=1&dur=3';
// 带内容参数：v2.3.5 起页面不再回退到开发者占位文案，无 ?title/?sub 时标题就是空的，
// 而「颜色 patch 改变像素」这条断言必须作用在真的有字的帧上。
const SEGMENT_URL = '/templates/segment.html?theme=aqua-morandi&seg=1&t0=0&speed=1&dur=3&title=ContractProbe&sub=subtitle&brand=CVS';
// 同一页的空内容形态：用来断言「空文本不注册命中区」。
const SEGMENT_EMPTY_URL = '/templates/segment.html?theme=aqua-morandi&seg=1&t0=0&speed=1&dur=3';

async function main() {
  const candidates = browserCandidates();
  if (!candidates.length) {
    console.error('no Chrome/Edge found; set CHROME_EXE');
    process.exit(1);
  }
  console.log(`[browser] ${candidates[0]}`);

  const server = createStaticServer(ROOT);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const url = `${origin}${PAGE_URL}`;
  console.log(`[server] ${ROOT} -> ${url}`);

  let browser = null;
  try {
    browser = await launchRetry({
      executablePath: process.env.CHROME_EXE || candidates[0],
      width: 1920,
      height: 1080,
      timeout: 30000,
    });
    const { client, sessionId } = browser;

    await client.send('Page.navigate', { url }, sessionId);
    await sleep(600);
    const ready = await waitFor(client, sessionId, () => window.__ready === true || !!window.__bootError, 30000, 'window.__ready');
    if (!ready) throw new Error('page did not become ready');
    const boot = await evaluate(client, sessionId, () => window.__bootError || null);
    if (boot) throw new Error('page boot error: ' + boot);

    section('contract surface');
    const surface = await evaluate(client, sessionId, () => ({
      ready: window.__ready === true,
      spec: typeof window.__spec,
      inspect: typeof window.__inspect,
      patch: typeof window.__patch,
      hitIsArray: Array.isArray(window.__hit),
      bridge: !!window.__editBridge,
      duration: window.DURATION,
    }));
    check('__ready === true', surface.ready === true);
    check('__spec / __inspect / __patch 已安装', surface.spec === 'function' && surface.inspect === 'function' && surface.patch === 'function');
    check('__hit 是数组', surface.hitIsArray === true);
    check('__editBridge 已安装', surface.bridge === true);

    section('hit map API（begin/add/hit + 后注册优先）');
    const api = await evaluate(client, sessionId, () => {
      const b = window.__editBridge;
      const saved = b.entries.slice();
      const countBefore = saved.length;
      b.begin();
      b.add({ id: 'test.bottom', role: 'test', rect: [10, 10, 100, 100], props: { text: 'b' }, schema: { text: { type: 'text' } } });
      b.add({ id: 'test.top', role: 'test', rect: [10, 10, 100, 100], props: { text: 't' }, schema: { text: { type: 'text' } } });
      const topHit = b.hit(50, 50);
      const inspectTop = window.__inspect(50, 50);
      b.begin();
      for (const e of saved) b.add(e);
      const m = b.metrics();
      const p = b.clientToCanvas(0, 0);
      return {
        begin: typeof b.begin,
        add: typeof b.add,
        hit: typeof b.hit,
        topHit: topHit && topHit.id,
        inspectTop: inspectTop && inspectTop.id,
        restored: b.entries.length,
        countBefore,
        metrics: m,
        origin: p,
      };
    });
    check('begin / add / hit 都是函数', api.begin === 'function' && api.add === 'function' && api.hit === 'function');
    check('hit() 后注册优先', api.topHit === 'test.top' && api.inspectTop === 'test.top', `${api.topHit} / ${api.inspectTop}`);
    check('begin()+add() 可恢复命中表', api.restored === api.countBefore, `${api.restored}/${api.countBefore}`);
    check('metrics() 反映画布位图/CSS 尺寸', api.metrics.width === 1920 && api.metrics.height === 1080 && Math.abs(api.metrics.scaleX - 1) < 1e-6, JSON.stringify(api.metrics));
    check('clientToCanvas(0,0) 落在画布原点', Math.abs(api.origin.x) < 1e-6 && Math.abs(api.origin.y) < 1e-6, JSON.stringify(api.origin));

    section('hit map');
    const table = await evaluate(client, sessionId, () => {
      window.renderFrame(0.8);
      const hit = window.__hit || [];
      const schemaTypes = [];
      const entries = hit.map((e) => {
        const schema = e.schema || {};
        for (const v of Object.values(schema)) if (v && v.type) schemaTypes.push(v.type);
        return {
          id: e.id,
          role: e.role,
          rect: e.rect,
          schemaKeys: Object.keys(schema),
          props: e.props,
        };
      });
      return { count: hit.length, entries, schemaTypes };
    });

    check('window.__hit 非空', table.count > 0, `entries=${table.count}`);
    const badId = table.entries.filter((e) => typeof e.id !== 'string' || !e.id);
    const badRect = table.entries.filter((e) => !Array.isArray(e.rect) || e.rect.length !== 4 || !e.rect.every((n) => Number.isFinite(Number(n))));
    const badSchema = table.entries.filter((e) => !e.schemaKeys.length);
    check('每个 entry 都有 id', badId.length === 0, `${table.entries.length} entries`);
    check('每个 entry 都有 rect[4]（有限数值）', badRect.length === 0, badRect.map((e) => e.id).join(',') || 'ok');
    check('每个 entry 都有 schema', badSchema.length === 0, badSchema.map((e) => e.id).join(',') || 'ok');
    check('schema 覆盖 text/color/size', ['text', 'color', 'size'].every((t) => table.schemaTypes.includes(t)), [...new Set(table.schemaTypes)].join(','));
    check('schema 覆盖 number/enum', table.schemaTypes.includes('number') && table.schemaTypes.includes('enum'), [...new Set(table.schemaTypes)].join(','));
    check('big-card 五个规定节点齐全',
      ['card.first', 'card.keyword', 'card.color', 'card.layout', 'card.index'].every((id) => table.entries.some((e) => e.id === id)),
      table.entries.map((e) => e.id).join(' '));

    section('__inspect');
    const probe = await evaluate(client, sessionId, () => {
      const hit = window.__hit || [];
      const kw = hit.find((e) => e.id === 'card.keyword');
      if (!kw) return { error: 'card.keyword missing' };
      const [x, y, w, h] = kw.rect;
      const cx = x + w / 2;
      const cy = y + h / 2;
      const got = window.__inspect(cx, cy);
      const miss = window.__inspect(1911, 1075);
      return {
        cx, cy,
        want: 'card.keyword',
        got: got && got.id,
        gotRect: got && got.rect,
        miss: miss === null ? null : miss.id,
        rect: kw.rect,
      };
    });
    check('矩形中心命中 card.keyword', probe.got === 'card.keyword', `center=(${Number(probe.cx).toFixed(1)}, ${Number(probe.cy).toFixed(1)}) -> ${probe.got}`);
    check('矩形两端不越界', Array.isArray(probe.rect) && probe.rect[2] > 0 && probe.rect[3] > 0);
    check('空白处返回 null', probe.miss === null, `(1911,1075) -> ${probe.miss}`);

    section('__patch（颜色）');
    const colorPatch = await evaluate(client, sessionId, () => {
      const hash = (s) => {
        let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
        return h.toString(16);
      };
      const canvas = document.querySelector('canvas');
      window.renderFrame(0.8);
      const before = canvas.toDataURL('image/png');
      const patchesBefore = window.__spec().patches.length;
      const ret = window.__patch('card.keyword', { color: '#00ff00' });
      const after = canvas.toDataURL('image/png');
      const patchesAfter = window.__spec().patches.length;
      window.renderFrame(0.8);
      const again = canvas.toDataURL('image/png');

      let green = 0;
      const kw = (window.__hit || []).find((e) => e.id === 'card.keyword');
      if (kw) {
        const ctx = canvas.getContext('2d');
        const x = Math.max(0, Math.floor(kw.rect[0]));
        const y = Math.max(0, Math.floor(kw.rect[1]));
        const w = Math.min(canvas.width - x, Math.max(1, Math.floor(kw.rect[2])));
        const h = Math.min(canvas.height - y, Math.max(1, Math.floor(kw.rect[3])));
        const data = ctx.getImageData(x, y, w, h).data;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 1] > 180 && data[i] < 100 && data[i + 2] < 100) green++;
        }
      }

      const spec = window.__spec();
      const rec = (spec.patches || []).find((p) => p.id === 'card.keyword');
      return {
        beforeHash: hash(before),
        afterHash: hash(after),
        againHash: hash(again),
        bytesBefore: before.length,
        bytesAfter: after.length,
        changed: before !== after,
        deterministic: after === again,
        patchesBefore,
        patchesAfter,
        ret,
        green,
        record: rec,
        hitCount: (window.__hit || []).length,
      };
    });

    check('toDataURL 在 patch 前后不同', colorPatch.changed === true, `${colorPatch.beforeHash} -> ${colorPatch.afterHash}`);
    check('__spec().patches 增加 1 条', colorPatch.patchesAfter === colorPatch.patchesBefore + 1, `${colorPatch.patchesBefore} -> ${colorPatch.patchesAfter}`);
    check('__patch 返回值含 id/props/diff', !!colorPatch.ret && colorPatch.ret.id === 'card.keyword' && !!colorPatch.ret.diff, JSON.stringify(colorPatch.ret && colorPatch.ret.diff));
    check('patch 记录写入 spec.patches', !!colorPatch.record && colorPatch.record.props && colorPatch.record.props.color === '#00ff00', JSON.stringify(colorPatch.record));
    check('patch 后同 t 重绘确定（toDataURL 一致）', colorPatch.deterministic === true, `${colorPatch.afterHash} === ${colorPatch.againHash}`);
    check('关键词矩形内出现绿色像素', colorPatch.green > 0, `green=${colorPatch.green}`);
    check('patch 后 __hit 仍非空', colorPatch.hitCount > 0, `entries=${colorPatch.hitCount}`);

    section('__patch（主题强调色覆盖 · 回归）');
    // 回归：主题路径下 layout0 的 accent 原先只认 ?color=，__patch('card.color') 不改变画面。
    const accent = await evaluate(client, sessionId, () => {
      const hash = (s) => {
        let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
        return h.toString(16);
      };
      const canvas = document.querySelector('canvas');
      window.renderFrame(0.8);
      const before = hash(canvas.toDataURL('image/png'));
      const colorEntry = (window.__hit || []).find((e) => e.id === 'card.color');
      const beforeColor = colorEntry && colorEntry.props.color;
      const ret = window.__patch('card.color', { color: '#00ffff' });
      const after = hash(canvas.toDataURL('image/png'));
      const afterColor = (window.__hit || []).find((e) => e.id === 'card.color')?.props.color;
      return { changed: before !== after, beforeColor, afterColor, ret };
    });
    check('card.color patch 改变主题强调色画面', accent.changed === true, `${accent.beforeColor} -> ${accent.afterColor}`);
    check('__hit 里 card.color 的 props 已更新', accent.afterColor === '#00ffff', String(accent.afterColor));

    section('__patch（同 id 合并 / 文本）');
    const merged = await evaluate(client, sessionId, () => {
      const canvas = document.querySelector('canvas');
      const n0 = window.__spec().patches.length;
      const before = canvas.toDataURL('image/png');
      const ret = window.__patch('card.keyword', { size: 200 });
      const spec = window.__spec();
      const rec = spec.patches.find((p) => p.id === 'card.keyword');
      const after = canvas.toDataURL('image/png');
      const n1 = spec.patches.length;

      const n2 = window.__spec().patches.length;
      const beforeText = canvas.toDataURL('image/png');
      window.__patch('card.first', { text: '测试' });
      const afterText = canvas.toDataURL('image/png');
      const spec2 = window.__spec();
      const firstRec = spec2.patches.find((p) => p.id === 'card.first');
      return {
        n0, n1, n2, n3: spec2.patches.length,
        mergedProps: rec && rec.props,
        sizeChanged: before !== after,
        textChanged: beforeText !== afterText,
        firstRec,
        op: ret.diff && ret.diff.op,
      };
    });

    check('同 id 二次 patch 不新增条目', merged.n1 === merged.n0, `${merged.n0} -> ${merged.n1}`);
    check('合并后保留 color 且写入 size', !!merged.mergedProps && merged.mergedProps.color === '#00ff00' && merged.mergedProps.size === 200, JSON.stringify(merged.mergedProps));
    check('合并 patch 后画面变化', merged.sizeChanged === true, `diff.op=${merged.op}`);
    check('文本 patch 新增一条记录', merged.n3 === merged.n2 + 1, `${merged.n2} -> ${merged.n3}`);
    check('文本 patch 生效', merged.textChanged === true && !!merged.firstRec && merged.firstRec.props.text === '测试', JSON.stringify(merged.firstRec && merged.firstRec.props));

    section('__spec 快照');
    const snap = await evaluate(client, sessionId, () => {
      const a = window.__spec();
      a.patches.push({ id: 'hacked', scope: 'x', props: { text: 'x' } });
      const b = window.__spec();
      return { aLen: a.patches.length, bLen: b.patches.length, entries: b.patches.map((p) => `${p.scope}:${p.id}`) };
    });
    check('__spec 返回副本（外部改动不污染）', snap.aLen === snap.bLen + 1, `mutated=${snap.aLen} live=${snap.bLen}`);
    console.log(`[patches] ${snap.entries.join('  ')}`);

    section('__inspectRect / __patchMany（框选）');
    const multi = await evaluate(client, sessionId, () => {
      const canvas = document.querySelector('canvas');
      window.renderFrame(0.8);
      window.__editBridge.clearPatches();
      const all = window.__inspectRect(0, 0, 1920, 1080);
      const ids = all.map((e) => e.id);
      const before = canvas.toDataURL('image/png');
      const ret = window.__patchMany(['card.first', 'card.keyword'], { color: '#ff0000' });
      const after = canvas.toDataURL('image/png');
      const patches = window.__spec().patches.map((p) => `${p.scope}:${p.id}`);
      return { count: all.length, ids, retCount: ret.count, changed: before !== after, patches };
    });
    check('__inspectRect 全屏框选 >= 3 个节点', multi.count >= 3, multi.ids.join(','));
    check('__patchMany 命中 2 个节点', multi.retCount === 2, String(multi.retCount));
    check('__patchMany 写入 2 条 patch', multi.patches.length === 2, multi.patches.join(' '));
    check('框选统一改色后画面变化', multi.changed === true);

    section('segment.html 契约（HUD / 标题 / patch 可复现）');
    await client.send('Page.navigate', { url: `${origin}${SEGMENT_URL}` }, sessionId);
    await sleep(600);
    const segReady = await waitFor(client, sessionId, () => window.__ready === true || !!window.__bootError, 30000, 'segment ready');
    check('segment 页面就绪', segReady === true);
    const segBoot = await evaluate(client, sessionId, () => window.__bootError || null);
    check('segment 无启动错误', !segBoot, segBoot || '');

    const seg = await evaluate(client, sessionId, () => {
      window.renderFrame(1.2);
      const hit = window.__hit || [];
      const types = [];
      for (const e of hit) for (const v of Object.values(e.schema || {})) if (v && v.type) types.push(v.type);
      const title = hit.find((e) => e.id === 'title.main');
      const got = title ? window.__inspect(title.rect[0] + title.rect[2] / 2, title.rect[1] + title.rect[3] / 2) : null;
      const subEntry = hit.find((e) => e.id === 'title.sub');
      return {
        ids: hit.map((e) => e.id), types: [...new Set(types)], titleHit: got && got.id, duration: window.DURATION,
        subText: subEntry ? subEntry.props.text : null,
      };
    });
    check('segment 注册 HUD 胶囊/倒计时/水印 + 主标题/副标题',
      ['hud.capsule', 'hud.countdown', 'hud.stamp', 'title.main', 'title.sub'].every((id) => seg.ids.includes(id)),
      seg.ids.join(' '));
    check('segment schema 覆盖 text/color/size', ['text', 'color', 'size'].every((t) => seg.types.includes(t)), seg.types.join(','));
    check('segment 主标题中心命中 title.main', seg.titleHit === 'title.main', String(seg.titleHit));
    check('segment DURATION = 3.0', Number(seg.duration) === 3, String(seg.duration));
    // aqua-morandi 是玻璃主题。回归：eff() 曾从 params.hud.sub 取副标题（该字段不存在），
    // 一路回退到 DEF.subText —— 玻璃主题的 DEF.subText 是材质描述占位文案，
    // 于是 ?sub= 被静默丢弃，成片上出现「半透明白 · 1px 高光边 …」。
    check('segment 玻璃主题下 ?sub= 真的进画面（不被占位文案顶掉）', seg.subText === 'subtitle', String(seg.subText));

    // D3：__spec() 是深拷贝快照（改它不该影响画面），编辑入口是 __patch。
    // 真正的契约是「params 是 patch 的合并基座」：scope 级 patch 必须能覆盖 params。
    // 回归：eff() 曾用 mergePatches(P,'title',null,{}) 之外的 hud.sub 取值，
    // 于是 __patch('title',{sub}) 这种 scope 级补丁被完全忽略。
    const segTruth = await evaluate(client, sessionId, () => {
      const subText = () => {
        const e = (window.__hit || []).find((x) => x.id === 'title.sub');
        return e ? e.props.text : null;
      };
      window.renderFrame(1.2);
      const paramsSub = window.__spec().params.title.sub;
      const renderedSub = subText();
      window.__patch('title', { sub: '改过的副标题' });
      window.renderFrame(1.2);
      const viaScope = subText();
      window.__editBridge.clearPatches();
      window.renderFrame(1.2);
      return { paramsSub, renderedSub, viaScope, restored: subText() };
    });
    check('segment params.title.sub 与画面一致', segTruth.paramsSub === segTruth.renderedSub, `${segTruth.paramsSub} / ${segTruth.renderedSub}`);
    check('segment scope 级 __patch(title,{sub}) 覆盖 params', segTruth.viaScope === '改过的副标题', String(segTruth.viaScope));
    check('segment clearPatches 后回到 params 值', segTruth.restored === 'subtitle', String(segTruth.restored));

    const segPatch = await evaluate(client, sessionId, () => {
      const hash = (s) => {
        let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
        return h.toString(16);
      };
      const canvas = document.querySelector('canvas');
      window.renderFrame(1.2);
      const before = canvas.toDataURL('image/png');
      const n0 = window.__spec().patches.length;
      const ret = window.__patch('title.main', { color: '#00ff00' });
      const after = canvas.toDataURL('image/png');
      window.renderFrame(1.2);
      const again = canvas.toDataURL('image/png');
      const ret2 = window.__patch('hud.capsule', { text: '测试标签' });
      const after2 = canvas.toDataURL('image/png');
      return {
        changed: before !== after,
        deterministic: after === again,
        capsuleChanged: after !== after2,
        n0,
        n1: window.__spec().patches.length,
        ret,
        ret2,
        hash: hash(after),
      };
    });
    check('segment 标题颜色 patch 生效', segPatch.changed === true, JSON.stringify(segPatch.ret && segPatch.ret.diff));
    check('segment patch 后同 t 重绘确定', segPatch.deterministic === true);
    check('segment HUD 胶囊文案 patch 生效', segPatch.capsuleChanged === true, JSON.stringify(segPatch.ret2 && segPatch.ret2.props));
    check('segment patches 计数 +2', segPatch.n1 === segPatch.n0 + 2, `${segPatch.n0} -> ${segPatch.n1}`);

    // 空内容形态：D3 契约不能宣告没有像素的编辑目标。
    await client.send('Page.navigate', { url: `${origin}${SEGMENT_EMPTY_URL}` }, sessionId);
    await sleep(600);
    await waitFor(client, sessionId, () => window.__ready === true || !!window.__bootError, 30000, 'segment(empty) ready');
    const segEmpty = await evaluate(client, sessionId, () => {
      window.renderFrame(1.2);
      const hit = window.__hit || [];
      const zero = hit.filter((e) => !e.rect || e.rect[2] <= 0 || e.rect[3] <= 0).map((e) => e.id);
      return { ids: hit.map((e) => e.id), zero };
    });
    check('segment 无内容时不注册 title.main / title.sub',
      !segEmpty.ids.includes('title.main') && !segEmpty.ids.includes('title.sub'), segEmpty.ids.join(' '));
    check('segment 命中区里没有零宽/零高矩形', segEmpty.zero.length === 0, segEmpty.zero.join(' '));
    check('segment 无内容时 HUD 命中区仍在', segEmpty.ids.includes('hud.capsule'), segEmpty.ids.join(' '));

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) {
      console.log('RESULT: FAIL');
      process.exitCode = 1;
    } else {
      console.log('RESULT: PASS');
      process.exitCode = 0;
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  }
}

main().catch((e) => {
  console.error('[fatal]', e && e.stack || e);
  process.exit(1);
});
