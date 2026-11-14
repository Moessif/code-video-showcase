# 覆盖矩阵 / Coverage（v2.5）

纯代码卡点视频编译器在 **领域（domain）× 风格（style）× 效果（effect）× 转场（transition）**
四个维度上的能力清单。本表是单一真值的人类可读投影：

- 领域真值：`scripts/nl2spec.mjs` 的 `KIND_IDS` / `KIND_DEFAULT_*` / `KIND_RULES`
- 风格真值：`templates/style-pages.mjs` 的 `STYLE_PAGES` / `STYLE_RECIPE_IDS`
- 效果真值：`templates/effects.mjs` 的 `EFFECTS`
- 转场真值：`templates/transitions.mjs` 的 `TRANSITIONS`
- 动效档位：`templates/motion-profile.mjs` 的 `MOTION_PROFILES` / `STYLE_MOTION` / `KIND_MOTION`

改任何一个枚举，都要同步本表（`scripts/test-domains.mjs` / `test-style-pages.mjs` /
`test-effects.mjs` / `test-transitions.mjs` 会交叉校验，脱节即红）。

---

## 1. 领域（24）

8 个原有 + 16 个 v2.5 新增垂直场景。每个领域带默认风格 / 主题 / 节奏（mood→BPM）/
时长 / CTA / 首屏文案，`nl2spec` 关键词可自动识别。

| id | 名称 | 默认风格 | 默认主题 | mood | 时长 | 典型结构 |
|----|------|----------|----------|------|------|----------|
| promo | 宣传片 | cyber-pixel | coral-noir | electronic | 30 | 钩子→卖点×N→CTA |
| launch | 产品发布 | minimal | coral-noir | restrained | 41 | 悬念→揭幕→特性→预约 |
| knowledge | 知识科普 | flat | paper-journal | restrained | 41 | 问题→原理→结论→关注 |
| ecommerce | 电商带货 | vertical | aqua-morandi | upbeat | 15 | 痛点→商品→证据→下单 |
| brand-story | 品牌故事 | ink-wash | celadon-paper | guofeng | 60 | 起源→历程→价值观→了解 |
| data-report | 数据报告 | data-viz | blueprint-stone | electronic | 30 | 概览→指标×N→洞察→报告 |
| recruiting | 招聘 | whiteboard | graphite-signal | upbeat | 30 | 团队→岗位→福利→投递 |
| annual | 年度总结 | three-d | amber-noir | epic | 60 | 开场→节点×N→展望→明年见 |
| **tutorial** | 教程教学 | screencast | blueprint-stone | restrained | 41 | 钩子→步骤 1-2-3→成果→跟做 |
| **changelog** | 版本更新 | kinetic | coral-noir | electronic | 20 | 版本徽章→新特性→演示→升级 |
| **event** | 活动邀请 | brutalist | pop-acid | upbeat | 20 | 名称/日期→讲者/议程→地点→报名 |
| **podcast** | 播客音频 | editorial | paper-journal | restrained | 30 | 金句卡→波形→节目名→订阅 |
| **travel** | 旅行目的地 | ink-wash | celadon-paper | guofeng | 30 | 全景→3 亮点→贴士→出发 |
| **food** | 美食食谱 | flat | paper-journal | upbeat | 25 | 成品→食材→步骤→装盘 |
| **fitness** | 健身训练 | brutalist | pop-acid | upbeat | 20 | 动作→次数计时→要领→挑战 |
| **realestate** | 房产展示 | minimal | ice-minimal | restrained | 30 | 外观→关键数据→房间→联系 |
| **fintech** | 金融科普 | blueprint | blueprint-stone | restrained | 35 | 痛点问→机制图→信任数→CTA |
| **healthcare** | 健康养生 | flat | aqua-morandi | restrained | 30 | 症状/问→指导→免责→咨询 |
| **course** | 课程教育 | swiss | ice-minimal | restrained | 41 | 成果承诺→大纲→讲师→报名 |
| **gaming** | 游戏高光 | cyber-glitch | cyber-neon | electronic | 15 | 神操作→回放/数据→主播→关注 |
| **music** | 音乐发行 | vaporwave | cyber-neon | electronic | 20 | 封面→频谱→发行日→预存 |
| **nonprofit** | 公益影响 | editorial | paper-journal | restrained | 30 | 一个故事→影响数据→请求→捐赠 |
| **sports** | 体育战报 | kinetic | coral-noir | epic | 15 | 比分→关键球→MVP→下一场 |
| **localbiz** | 本地商家 | risograph | paper-journal | upbeat | 20 | 门店→优惠→口碑→到店/地图 |

mood→BPM：`electronic 120 · restrained 90 · epic 100 · upbeat 128 · guofeng 80`。
首屏推荐预设见 `content/presets.json`（16 组）。

---

## 2. 风格（20）

13 个原有 + 6 个 v2.5 新增 + 收编此前未注册的 `kinetic`。每个风格映射到真实渲染页
（`templates/recipe-*.html`），逐帧确定性、横竖屏真重排。

| id | 名称 | 渲染页 | 档位 | 视觉特征 |
|----|------|--------|------|----------|
| cyber-pixel | 赛博像素 | cyber-pixel.html | maximal | 霓虹像素抖动 + 扫描线 |
| cyber-glitch | 赛博故障 | recipe-glitch.html | maximal | RGB 分离 + 信号干扰 |
| pixel-8bit | 8-bit 像素 | recipe-8bit.html | dynamic | 街机像素 + 限定色板 |
| ink-wash | 水墨 | recipe-inkwash.html | calm | 宣纸墨色晕染 + 留白 |
| guofeng | 国风 | recipe-guofeng.html | calm | 东方器物 + 青瓷 |
| great-wall | 长城 | recipe-greatwall.html | dynamic | 关隘山峦 + 暗金 |
| whiteboard | 白板 | recipe-whiteboard.html | calm | 手绘线稿 + 讲解 |
| three-d | 3D | recipe-threed.html | dynamic | 立体材质 + 黑金 |
| data-viz | 数据可视化 | recipe-datarace.html | standard | 数字滚动 + 条形竞速 |
| screencast | 录屏 | recipe-screencast.html | standard | 代码窗口 + 光标 |
| flat | 扁平插画 | recipe-flat.html | standard | 矢量色块 + 圆角 |
| minimal | 极简大字 | recipe-minimal.html | calm | 留白 + 大字 + 高级灰 |
| vertical | 竖屏卡片 | segment.html | dynamic | 通用竖屏卡 |
| **kinetic** | 动态字体 | recipe-kinetic.html | dynamic | 逐字入场 + 速度线 + 巨型描边数字 |
| **swiss** | 瑞士网格 | recipe-swiss.html | calm | 12 列网格 + 发丝线 + 单红锚点 + 越大越轻 |
| **editorial** | 报纸编辑 | recipe-editorial.html | calm | 衬线大标 + 栏线 + 首字下沉 + 半调图 |
| **brutalist** | 新粗野主义 | recipe-brutalist.html | dynamic | 粗边框 + 硬投影 + 撞色 + 贴纸徽章 |
| **vaporwave** | 蒸汽波 | recipe-vaporwave.html | dynamic | 渐变天空 + 透视网格 + 扫描线落日 + 镀铬字 |
| **blueprint** | 工程蓝图 | recipe-blueprint.html | standard | 普鲁士蓝 + 尺寸箭头 + 标题栏 + 十字线 |
| **risograph** | 孔版印刷 | recipe-risograph.html | calm | 双专色 + 套印错位 + 颗粒平涂 + 纸纹 |

---

## 3. 效果（26）

`templates/effects.mjs` 的命名目录。**纯核**（core）是 `(t, seed, 参数)` 的纯函数，
Node 单测可证明确定性；**canvas 包装**（draw）只在浏览器跑。复用 `motion.js` 的
grain/scanlines/RGBSplit/bloom/halation/kineticText（re-export，不抄第二份）。

| 类别 | 效果 | 纯核 | 说明 |
|------|------|------|------|
| text | typewriter | typewriterText | 打字机逐字 |
| text | scramble | scrambleText | 乱码解码揭示（种子闪烁） |
| text | splitFlap | splitFlapProgress | 翻牌逐字归位 |
| text | maskWipe | — | 遮罩擦除（kineticText clip/wipe） |
| text | charStagger | — | 逐字错峰（kineticText rise） |
| particle | confetti | particleField | 彩纸（种子闭式抛物） |
| particle | sparks | particleField | 火花（径向爆发衰减） |
| particle | snow | particleField | 落雪（正弦横移 + 下落） |
| particle | bubbles | particleField | 气泡（上浮 + 描边） |
| particle | embers | particleField | 余烬（上浮 + 呼吸闪烁） |
| post | grain | — | 颗粒（motion.js，种子噪点 tile 滚动） |
| post | scanlines | — | 扫描线 |
| post | chromatic | — | 色散（RGB 分离） |
| post | bloom | — | 泛光（降采样模糊叠加） |
| post | halation | — | 光晕（暖色高光溢出） |
| post | vignette | vignetteFactor | 暗角（径向压暗） |
| post | halftone | halftoneRadius | 半调网点（按亮度画点） |
| post | dotGrid | — | 点阵背景 |
| post | lightLeak | — | 漏光（暖色光斑漂移） |
| post | crt | — | CRT（扫描线 + 暗角 + 边缘色散） |
| post | duotone | — | 双色调（亮度映射两色） |
| camera | kenBurns | kenBurns | 肯·伯恩斯缓动推拉 |
| camera | shake | cameraShake | 衰减抖动 |
| camera | parallax | parallaxOffset | 视差图层偏移 |
| audio | beatPulse | beatPulse | 节拍脉冲（指数衰减） |
| audio | spectrum | spectrumBins | 确定性伪频谱条 |

探针页 `templates/effects-probe.html` 一帧叠多种效果；`scripts/test-effects-render.mjs`
真机验证 canvas 路径确定性（同 t 同哈希、异 t 异哈希、横竖屏重排）。

---

## 4. 转场（35）

`templates/transitions.mjs`，FFmpeg `xfade` 实现。段 mp4 仍各自独立渲染（保持逐段
确定性 / 缓存 / resume），转场只在拼接阶段做。**单一真值数学**：N 段、转场时长 t、
帧率 fps，`tf=round(t*fps)`，第 i 段成片起点 = 原起点 − i·tf，成片总帧 = 原总帧 −
(N−1)·tf，xfade 第 k 个 offset = 第 k+1 段平移后起点。plan / 字幕 cue / 配乐 / concat
全读同一份平移后起点。**默认关闭逐字节不变**。

约束：转场时长必须 **短于最短段**（否则该段被两侧重叠吃光，plan 阶段报
`E_TRANSITION_DURATION`）。内段若要「干净不重叠」的转场，宜 > 2×转场时长。
拼接已做内存上限（解码线程 2 / 滤镜单线程 / x264 lookahead 8），N 路同时解码不 OOM。

fade · dissolve · fadeblack · fadewhite · fadegrays · wipeleft/right/up/down ·
slideleft/right/up/down · coverleft/right · revealleft/right · circleopen/close ·
circlecrop · rectcrop · radial · smoothleft/right · zoomin · pixelize · hblur ·
squeezeh/v · diagtl/br · hlslice/hrslice/vuslice/vdslice

`dark:true`（fadeblack/fadewhite/circlecrop/rectcrop）会产生纯黑/白帧，可能触发 QA
black/white 检查，按需选用。

---

## 5. 领域 × 风格 推荐矩阵

默认搭配见第 1 表；下面是「也合适」的扩展建议（✓ 推荐 · ○ 可用）：

| 领域 \ 风格 | swiss | editorial | brutalist | vaporwave | blueprint | risograph | kinetic | minimal | flat | ink-wash |
|------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| tutorial | ○ | | | | ✓ | | | | ○ | |
| changelog | ○ | | ○ | | | | ✓ | ○ | | |
| event | | | ✓ | ○ | | ○ | ○ | | | |
| podcast | | ✓ | | | | ○ | | ○ | | |
| travel | | ○ | | | | ○ | | | | ✓ |
| food | | ○ | ○ | | | ✓ | | | ✓ | |
| fitness | | | ✓ | | | | ✓ | | | |
| realestate | ✓ | ○ | | | ○ | | | ✓ | | |
| fintech | ✓ | | | | ✓ | | | ○ | | |
| healthcare | ○ | ○ | | | | ○ | | | ✓ | |
| course | ✓ | ○ | | | ○ | | | ○ | | |
| gaming | | | ○ | ✓ | | | ✓ | | | |
| music | | | ○ | ✓ | | ○ | ✓ | | | |
| nonprofit | | ✓ | | | | ○ | | ○ | | |
| sports | | | ✓ | | | | ✓ | | | |
| localbiz | | ○ | ○ | | | ✓ | | | ○ | |

---

## 6. 动效教义（motion doctrine）

来自 `motion-doctrine` skill，落到 `MOTION_PROFILES` 的四档乘数（calm/standard/
dynamic/maximal）。standard 档所有乘数为 1 → 与旧版逐像素一致。

- **入场 ≤ 800ms，出场 ≈ 入场 × 0.75**；错峰 stagger ≤ 500ms。
- **禁 bounce/elastic**（廉价弹跳）；`back.out(1.4–1.7)` 轻过冲可用。
- **高潮前留白 0.3–0.75s**（静止蓄力），不要全程满动。
- **一部片 2–3 种转场**就够，别堆砌；运动载体 continuity 优先硬切而非交叉淡化。
- 档位由 `kind × style` 推导（style 特例 > kind 默认），显式 `look.motion` 最优先。

---

## 7. 研究来源（v2.5 背书）

- **Remotion**：`@remotion/transitions`（21 presentations）、`noise`/`motion-blur`/`paths`/`three`；
  场景重叠 total = A+B−transition，与本片 xfade 数学同构。
- **Motion Canvas**：tween/spring/signals/flow；slideTransition/zoomIn/zoomOut/fade。
- **editly**：gl-transitions（214 shader）+ directional/random；图层模型。
- **FFCreator**：~90 animate.css 效果 + 23 场景转场 shader。
- **GSAP**：eases（power/sine/expo/circ/back/elastic/bounce/steps）、ScrambleText/SplitText。
- **本地 skill**：motion-doctrine（时序律）、guizang-social-card（Swiss/Editorial）、
  theme-factory（10 调色板）、algorithmic-art（种子闭式生成）、
  creating-product-ad-video-scripts-subtitled（kinetic 字幕 / 9 品类）。

> 边界：xfade token 以 FFmpeg wiki 56 个为准，本片收录 35 个常用；更新版 FFmpeg 可能
> 新增 token（如 fadefast/fadeslow），未收录者用 `E_TRANSITION` 挡住而非静默硬切。