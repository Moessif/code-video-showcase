/**
 * transitions.mjs — 段间转场的单一真值（v2.5）。
 *
 * 背景：v2.4 之前 concat 只有硬切（stream-copy）。对标 editly / Remotion
 * (@remotion/transitions) / Motion Canvas，转场是视频编译器的基本能力缺口。
 *
 * 实现选型：FFmpeg `xfade`。理由：
 *   - 段 mp4 仍各自独立渲染（保持逐段确定性 / 缓存 / resume）；
 *   - 转场只在拼接阶段做，不污染单段像素；
 *   - xfade 的 offset 数学与「段起点平移」是同一件事，可以共用一个公式。
 *
 * 核心数学（N 段、时长 d_i、转场时长 t、帧率 fps）：
 *   tf = round(t * fps)
 *   第 i 段（0 基）在成片里的起点 = 原起点 - i * tf      （前面 i 个转场各吃掉 tf）
 *   每段渲染时长 frames_i 不变
 *   成片总帧 = 原总帧 - (N-1) * tf
 *   xfade 第 k 个 offset（秒）= 第 k+1 段平移后的 start   ← 单一真值
 *
 * 因此 plan / 字幕 cue / 配乐 / concat 全部读同一份平移后的段起点，不会失配。
 * 默认关闭（t=0 / name=null）时所有值与旧版逐字节一致。
 *
 * 纯数据 + 纯函数，零依赖，Node 与浏览器都能跑。
 */

/**
 * 可用的 xfade 转场。token 即 FFmpeg `xfade=transition=<token>`。
 * kind 恒为 'xfade'（拼接阶段实现）；保留字段以便将来加 canvas 侧转场。
 * dark/light 标记那些会产生纯黑/纯白帧的转场——它们可能触发 QA 的 black/white 检查。
 */
export const TRANSITIONS = {
  fade: { token: 'fade', label: '交叉淡化', dark: false },
  dissolve: { token: 'dissolve', label: '溶解噪点', dark: false },
  fadeblack: { token: 'fadeblack', label: '过黑场', dark: true },
  fadewhite: { token: 'fadewhite', label: '过白场', dark: true },
  fadegrays: { token: 'fadegrays', label: '过灰场', dark: false },
  wipeleft: { token: 'wipeleft', label: '左擦除', dark: false },
  wiperight: { token: 'wiperight', label: '右擦除', dark: false },
  wipeup: { token: 'wipeup', label: '上擦除', dark: false },
  wipedown: { token: 'wipedown', label: '下擦除', dark: false },
  slideleft: { token: 'slideleft', label: '左推', dark: false },
  slideright: { token: 'slideright', label: '右推', dark: false },
  slideup: { token: 'slideup', label: '上推', dark: false },
  slidedown: { token: 'slidedown', label: '下推', dark: false },
  coverleft: { token: 'coverleft', label: '左覆盖', dark: false },
  coverright: { token: 'coverright', label: '右覆盖', dark: false },
  revealleft: { token: 'revealleft', label: '左揭示', dark: false },
  revealright: { token: 'revealright', label: '右揭示', dark: false },
  circleopen: { token: 'circleopen', label: '圆形开', dark: false },
  circleclose: { token: 'circleclose', label: '圆形关', dark: false },
  circlecrop: { token: 'circlecrop', label: '圆裁切', dark: true },
  rectcrop: { token: 'rectcrop', label: '方裁切', dark: true },
  radial: { token: 'radial', label: '径向扫', dark: false },
  smoothleft: { token: 'smoothleft', label: '平滑左', dark: false },
  smoothright: { token: 'smoothright', label: '平滑右', dark: false },
  zoomin: { token: 'zoomin', label: ' zoom 入', dark: false },
  pixelize: { token: 'pixelize', label: '像素化', dark: false },
  hblur: { token: 'hblur', label: '水平模糊', dark: false },
  squeezeh: { token: 'squeezeh', label: '水平挤压', dark: false },
  squeezev: { token: 'squeezev', label: '垂直挤压', dark: false },
  diagtl: { token: 'diagtl', label: '对角左上', dark: false },
  diagbr: { token: 'diagbr', label: '对角右下', dark: false },
  hlslice: { token: 'hlslice', label: '水平左切片', dark: false },
  hrslice: { token: 'hrslice', label: '水平右切片', dark: false },
  vuslice: { token: 'vuslice', label: '垂直上切片', dark: false },
  vdslice: { token: 'vdslice', label: '垂直下切片', dark: false },
};

export const TRANSITION_IDS = Object.keys(TRANSITIONS);

/** 默认转场时长（秒）。够看清又不拖节奏。 */
export const DEFAULT_TRANSITION_DURATION = 0.4;

/** 合法转场名？ */
export function isTransition(v) {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(TRANSITIONS, v);
}

/** 「关闭」的拼写（硬切）。这些不是非法值，validateSpec 不该报错。 */
export function isTransitionOff(v) {
  return v === undefined || v === null || v === '' || v === false || v === 'none' || v === 'cut';
}

/**
 * 归一化转场配置。返回 null 表示「关闭」（硬切，与旧版一致）。
 * @param {unknown} raw  spec.render.transition / CLI --transition
 * @param {unknown} dur  spec.render.transitionDuration / CLI --transition-duration
 */
export function normalizeTransition(raw, dur) {
  if (isTransitionOff(raw)) return null;
  const name = String(raw);
  if (!isTransition(name)) {
    const e = new Error(`unknown transition "${name}"; valid: ${TRANSITION_IDS.join(', ')}`);
    e.code = 'E_TRANSITION';
    throw e;
  }
  let t = dur === undefined || dur === null || dur === '' ? DEFAULT_TRANSITION_DURATION : Number(dur);
  if (!Number.isFinite(t) || t <= 0) {
    const e = new Error(`transition duration must be > 0, got ${dur}`);
    e.code = 'E_TRANSITION_DURATION';
    throw e;
  }
  // 上限 2s：再长就不是转场是叠化了，且会吃掉短段的大部分时长。
  t = Math.min(t, 2);
  return { name, token: TRANSITIONS[name].token, duration: t, dark: !!TRANSITIONS[name].dark };
}

/**
 * 把转场重叠应用到段起点上（每段渲染时长不变）。
 * 返回新数组；不修改入参。transition=null 时原样返回（逐字节一致）。
 *
 * @param {Array<{startFrame:number,frames:number}>} segments
 * @param {number} fps
 * @param {{duration:number}|null} transition
 */
export function shiftSegments(segments, fps, transition) {
  if (!transition || !Array.isArray(segments) || segments.length === 0) return segments;
  const tf = Math.round(transition.duration * fps);
  if (tf <= 0) return segments;
  return segments.map((s, i) => {
    const startFrame = s.startFrame - i * tf;
    const endFrame = startFrame + s.frames;
    return {
      ...s,
      startFrame,
      endFrame,
      start: startFrame / fps,
      end: endFrame / fps,
    };
  });
}

/**
 * 成片总帧数（转场后）。接收**原始**段，内部自己平移。
 * transition=null 时等于最后一段 endFrame。
 */
export function totalFrames(segments, fps, transition) {
  if (!segments.length) return 0;
  const shifted = shiftSegments(segments, fps, transition);
  return shifted[shifted.length - 1].endFrame;
}

/**
 * xfade 链的 offset（秒），长度 N-1。
 *
 * ⚠ 接收**已平移**的段（即 plan.segments —— timeline.mjs 已经 shiftSegments 过）。
 * 这里**不再平移**：第 k 个 offset 直接 = 第 k+1 段的 start。
 * 若再调一次 shiftSegments 会二次平移，产生负 offset，xfade 链塌缩成最后一段。
 * （shiftSegments / totalFrames 接收原始段；xfade* 接收已平移段——两类不要混用。）
 */
export function xfadeOffsets(segments, fps, transition) {
  if (!transition || !Array.isArray(segments)) return [];
  return segments.slice(1).map((s) => Number(s.start.toFixed(6)));
}

/**
 * 生成 FFmpeg xfade 滤镜链（视频）。输入标签 [0:v]..[N-1:v]，输出 [vout]。
 * 接收**已平移**的段（plan.segments）。单段或关闭时返回 null（调用方走硬切）。
 */
export function xfadeFilterGraph(segments, fps, transition) {
  if (!transition || segments.length < 2) return null;
  const offsets = xfadeOffsets(segments, fps, transition);
  const parts = [];
  let prev = '[0:v]';
  for (let k = 0; k < offsets.length; k++) {
    const out = k === offsets.length - 1 ? '[vout]' : `[vx${k}]`;
    parts.push(`${prev}[${k + 1}:v]xfade=transition=${transition.token}:duration=${transition.duration}:offset=${offsets[k]}${out}`);
    prev = out;
  }
  return parts.join(';');
}