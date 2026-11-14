# Motion & colour toolkit（v2）

`templates/motion.js` 与 `templates/color.js` 是纯函数库：不读时钟、不随机、不依赖 DOM（绘制类函数除外）。`common.js` 已把它们重新导出，所以页面只需要：

```js
import {
  spring, springSettle, rateFunc, stagger, track, transitionParams,
  splitGraphemes, layoutCJK, fitText, drawKineticText,
  drawGrain, drawPaperTexture, drawRGBSplit, drawBloom, drawHalation,
  toOklch, toHex, mixOklch, apcaLc, contrastRatio, readableInk,
} from './common.js';
```

## 1. 弹簧（物理，闭式解）

```js
const pop = spring({ stiffness: 170, damping: 26, mass: 1, v0: 0 }); // t(秒) -> 0..1（可过冲）
pop(0) === 0; pop(10) ≈ 1;
springSettle(pop, 0.001); // 0.8s 左右，用来给动画排时长
```

预设（react-spring 同参）：

| 预设 | stiffness | damping | 用途 |
|---|---|---|---|
| `springs.default()` | 170 | 26 | 卡片/元素入场 |
| `springs.gentle()` | 120 | 14 | 大块背景 |
| `springs.wobbly()` | 180 | 12 | 图标/贴纸 |
| `springs.stiff()` | 210 | 20 | 快速 UI |
| `springs.slow()` | 280 | 60 | 镜头缓推 |

> 弹簧是解析解，不是逐帧积分；同一 t 在任何机器上取值相同。

## 2. 缓动与时间轴

```js
rateFunc('smooth' | 'rushFrom' | 'rushInto' | 'thereAndBack' | 'outExpo')
stagger(12, { lagRatio: 0.1 });          // 12 个元素的延迟（0..0.1 s）
const y = track([[0, 0], [0.24, 120, 'outExpo'], [0.8, 120]]);
transitionParams('slam'|'whip'|'glitch'|'fade', p); // { alpha, scale, blur, x, y, rot, ca, flash }
quantize(t, 30);                          // 吸附到帧
```

| 场景 | 时长 | 曲线 |
|---|---|---|
| 大字砸入 | 220 ms | `outExpo` / 过冲 1.08 |
| 卡片切换 | 260–320 ms | `outCubic` |
| 镜头甩入 | 240 ms | `cubic-bezier(.7,0,.2,1)` |
| 硬切白闪 | 60 ms / 6% | 线性衰减 |
| Glitch | 3 帧 `steps(1)` | 33 ms/帧 |

## 3. CJK 排版

```js
const layout = layoutCJK(ctx, '想做科普视频？', 1200, {
  font: '900 120px "Noto Sans SC"', lineHeight: 1.08, letterSpacing: 0,
});
// { lines: [{ text, width, chars: [{char,x,w}] }], width, height, lineHeight, fontSize }

const { size, font } = fitText(ctx, '最多八个汉字', { maxWidth: 1200, maxLines: 1, maxSize: 280 });
```

- 逐字切分用 `Intl.Segmenter('zh', {granularity:'grapheme'})`，emoji/组合字符不会被拆坏。
- 避头尾已内置：行首禁止 `、。，．：；？！）〕］｝」』】》` 等，行末开引号/括号会移到下一行。
- `drawKineticText(ctx, text, p, { mode: 'rise'|'clip'|'wipe'|'blur'|'scale', stagger: 0.55 })` 直接画逐字入场；`p` 是 0..1 的动画进度，由调用方用 `t` 算出。

海报参数：标题字重 700–900，字距 −0.02~−0.04em，行高 0.92–1.05；正文行高 1.25；中英之间留 0.25em；数字用 `tnum`。

## 4. 纹理与后处理

```js
drawGrain(ctx, { alpha: 0.07, seed: 1, t, W, H });       // 256² 噪声瓦片，按 t 滚动
drawPaperTexture(ctx, { W, H, alpha: 0.08, seed: 7, t });
drawScanlines(ctx, { W, H, step: 4, alpha: 0.06 });
drawRGBSplit(ctx, sourceCanvas, { px: 6 });              // 三通道分离
drawBloom(ctx, sourceCanvas, { strength: 0.3, radius: 12 });
drawHalation(ctx, sourceCanvas, { strength: 0.22, color: '#ff5a2a' });
```

- `drawRGBSplit` / `drawBloom` / `drawHalation` 需要一个已经画好的 source canvas；不要在每帧对整屏做多次 `filter blur`（慢），先降采样。
- `drawGrain` 的噪声图只生成一次并缓存；不同 `seed` 对应不同瓦片。

## 5. OKLCH 色彩

```js
toOklch('#d97757');                 // { l: 0.68, c: 0.13, h: 40.6 }
toHex({ l: 0.9, c: 0.05, h: 40 });  // gamut-clamped
mixOklch('#000', '#fff', 0.5);      // OKLab 中点，不是 sRGB 中点
gamut({ l: 0.62, c: 0.4, h: 250 }); // 自动把 chroma 压回 sRGB
derivePalette({ mode: 'dark', accent: '#00dadd' }); // 14 角色一键派生
```

规则：

- 角色 token 只存 `[L, C, H]`；改明暗只改 L，色相不动。
- 明度阶梯（暗色）：bg 0.13 / surface 0.18 / ink 0.96 / muted 0.68；亮色镜像。
- 新增主题优先用 `derivePalette()`，再按材质手工微调 2–3 个值。
- 8–16 kHz 的「高频克制」同样适用于颜色：一套主题只允许 1 个主强调色 + 1 个第二重音。

## 6. APCA 对比度

```js
apcaLc('#ffffff', '#0e0e0d');   // 负值：浅字深底
Math.abs(apcaLc(text, bg));     // 比较时取绝对值
apcaLevel(lc, 24, 700);         // { lc, need: 45, pass: true }
```

| 用途 | 最低 \|Lc\| |
|---|---|
| 正文（<16 px） | 75 |
| 正文（16–24 px） | 60 |
| 大字（≥24 px 或 ≥18.66 px 粗体） | 45 |
| 大面积色块/装饰 | 30 |

`theme-audit.mjs` 同时输出 WCAG 2 与 APCA；WCAG 用于兼容性兜底，APCA 用于判断暗底细字是否真的可读。

## 7. 转场配方

| 名称 | 参数 | 画面 |
|---|---|---|
| `slam` | 白闪 0.85→0 / 0.12 s；scale 1.13→1 / 0.32 s；抖动 14 px | 卡点砸入 |
| `whip` | x ±18%，rot ±2.5°，blur 8→0，240 ms | 卡片甩入 |
| `glitch` | RGB ±6 px，3 帧 steps(1)，尾帧黑场 33 ms | 赛博故障 |
| `fade` | `inOutCubic` 透明度 | 结尾/慢转 |

## 8. 五套新主题（OKLCH 派生）

| id | 名称 | 模式 | 主材质 | 强调 | 适用 |
|---|---|---|---|---|---|
| `cyber-neon` | 赛博霓虹 | dark | 霓虹辉光 + 网格 | `#00dadd` | 科技/游戏/预告 |
| `paper-journal` | 纸质手账 | light | 纸面 + 细网格 | `#c13e2e` | 知识/教程/生活 |
| `dark-gold-cinema` | 暗金电影 | dark | 烫金 + 颗粒 | `#e7b643` | 高端/电影感 |
| `ice-minimal` | 冰蓝极简 | light | 冷白哑光 | `#2171cc` | SaaS/数据/医疗 |
| `pop-acid` | 波普酸色 | dark | 光斑 + 颗粒 | `#dcdb00` | 潮流/音乐/社交 |

全部通过 WCAG 审计；APCA 有少量「次要字」提醒（暗底 muted 在 38–45 Lc），需要更亮时把 `muted` 的 L 提高 0.04–0.06。

## 9. 字体红线

- **OFL-1.1**：Noto Sans/Serif SC、思源黑体/宋体、LXGW 文楷、得意黑（Smiley Sans）——可商用、可改、可子集，但必须附协议，改名字形后要改名。
- **厂商自定义许可**：HarmonyOS Sans、MiSans——只能原样裁剪嵌入，禁止改字形/衍生/单独售卖。
- 任何情况都不得删除版权头，不得把字体当商品卖。
- 子集化：

```bash
pyftsubset in.ttf --text-file=chars.txt --flavor=woff2 \
  --layout-features='kern,liga,ccmp,locl' --no-hinting --desubroutinize \
  --name-IDs='*' -o out.woff2
```

## 10. 设计系统时长参考

| 系统 | 时长阶梯 | 曲线 |
|---|---|---|
| Material 3 | 50–1000 ms | emphasized `(.2,0,0,1)` / decelerate `(.05,.7,.1,1)` |
| IBM Carbon | 70/110/150/240/400/700 ms | productive `(.2,0,.38,.9)` / expressive `(.4,.14,.3,1)` |
| Apple | 转场 ≈ 0.35 s | `.smooth(.5,1)` / `.snappy(.5,.85)` / `.bouncy(.5,.7)` |
