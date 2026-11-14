/**
 * app/versions/model.mjs — C2-07 版本树的存储层。
 *
 * 复用 app/script/model.mjs 的全部纯函数（specToRows / diffSpecs / specHash …），
 * 额外提供基于「类 localStorage」对象的快照仓库。storage 由调用方注入，
 * 因此本模块在 Node 里可用内存 Map 测试，在浏览器里传 window.localStorage。
 *
 * 存储格式（key: cvs.versions.v1）：
 *   [{ id, name, ts, hash, duration, spec }]
 */

import { specHash, specTotals } from '../script/model.mjs';

export * from '../script/model.mjs';

export const VERSIONS_KEY = 'cvs.versions.v1';
export const CURRENT_KEY = 'cvs.versions.current';
export const MAX_VERSIONS = 200;

const clone = (v) => JSON.parse(JSON.stringify(v));

function isEntry(v) {
  return (
    v &&
    typeof v === 'object' &&
    typeof v.id === 'string' &&
    typeof v.hash === 'string' &&
    v.spec &&
    typeof v.spec === 'object'
  );
}

function assertStorage(storage) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new TypeError('createVersionStore 需要一个实现 getItem/setItem 的 storage');
  }
}

/**
 * @param {{getItem(k:string):string|null,setItem(k:string,v:string):void,removeItem?(k:string):void}} storage
 */
export function createVersionStore(storage) {
  assertStorage(storage);

  const readAll = () => {
    try {
      const raw = storage.getItem(VERSIONS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
    } catch {
      return [];
    }
  };

  const writeAll = (list) => {
    storage.setItem(VERSIONS_KEY, JSON.stringify(list.slice(0, MAX_VERSIONS)));
    return list;
  };

  return {
    /** 新 → 旧。 */
    list() {
      return readAll()
        .slice()
        .sort((a, b) => b.ts - a.ts || String(b.id).localeCompare(String(a.id)));
    },

    get(id) {
      return readAll().find((v) => v.id === id) || null;
    },

    /**
     * 保存快照。内容哈希相同的版本视为同一版：更新名称与时间，不新增。
     * @returns {{entry:object, deduped:boolean}}
     */
    save(spec, name, { now = Date.now() } = {}) {
      if (!spec || typeof spec !== 'object') throw new TypeError('save 需要 spec 对象');
      const hash = specHash(spec);
      const list = readAll();
      const existing = list.find((v) => v.hash === hash);
      const label = String(name ?? '').trim() || existing?.name || `版本 ${new Date(now).toLocaleString('zh-CN', { hour12: false })}`;
      const entry = {
        id: existing?.id ?? `v${now}-${hash}`,
        name: label,
        ts: now,
        hash,
        duration: specTotals(spec).duration,
        spec: clone(spec),
      };
      const next = existing ? list.map((v) => (v.id === existing.id ? entry : v)) : [entry, ...list];
      writeAll(next);
      return { entry, deduped: Boolean(existing) };
    },

    rename(id, name) {
      const label = String(name ?? '').trim();
      if (!label) throw new Error('版本名称不能为空');
      const list = readAll();
      let hit = null;
      const next = list.map((v) => {
        if (v.id !== id) return v;
        hit = { ...v, name: label };
        return hit;
      });
      if (!hit) throw new Error(`版本 "${id}" 不存在`);
      writeAll(next);
      return hit;
    },

    /** @returns {number} 删除条数（0 或 1）。 */
    remove(id) {
      const list = readAll();
      const next = list.filter((v) => v.id !== id);
      if (next.length !== list.length) writeAll(next);
      return list.length - next.length;
    },

    clear() {
      storage.setItem(VERSIONS_KEY, '[]');
    },
  };
}

/** 读取当前编辑缓冲区（浏览器 localStorage）。 */
export function readCurrent(storage) {
  assertStorage(storage);
  try {
    const raw = storage.getItem(CURRENT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 写入当前编辑缓冲区。配额满/隐私模式会抛错——吞掉并返回 false，不能让 boot/restore 崩。 */
export function writeCurrent(storage, spec) {
  assertStorage(storage);
  try {
    storage.setItem(CURRENT_KEY, JSON.stringify(spec));
    return true;
  } catch {
    return false;
  }
}
