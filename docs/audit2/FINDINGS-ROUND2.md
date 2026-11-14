# 第二轮集群 · 聚合结论（68 findings → 45 项去重）

> 基线 v2.5.1（`936b3d4`）· 9 视角独立审计 · 全文证据见各 agent 产物 `out/_audit/<id>/`
> 交叉印证规则：≥2 视角独立命中 → 置信 ×2。

## 一、P0（13 项，全部立刻落地）

| ID | 项 | 来源（交叉印证） | 修法锚点 | 工作量 | 像素影响 |
|---|---|---|---|---|---|
| R2-01 | **true peak 全链路失明**：qa 量 dBFS 采样峰，交付物实测 +2.7 dBTP；QA 只测 master，平台件裸奔 | N03-F1+F2 × N07-F1 | qa-audio 8× 过采样 dBTP + concat loudnorm 后 alimiter + QA 遍历 delivery 各行抽音轨 | M | 否 |
| R2-02 | `--plan` 打错路径 → cue/HF 两项检查**静默消失**仍全绿 | N07-F5 × N09 方法论 | plan 给了但不存在 → exit 2；checks 完整性断言 | S | 否 |
| R2-03 | 24/32-bit 位深按幅值猜 → 真 32-bit 低电平素材全表错 18 dB | N07-F6 | wave.getsampwidth 判位深 | S | 否 |
| R2-04 | **八连闪 3.75 Hz 违反 WCAG 2.3.1**（全画面亮度 Δ32%），QA 的 blackdetect 只测黑不测白 | N08-F1（YAVG 全量逐帧实证） | 默认/fixture flash 改 4×0.5s；qa-video 加 flash-rate 检查 | M | **是** |
| R2-05 | layout0 默认强调色 #ffcf5c × 6/13 浅色主题 = **1.38:1 白字白底**；兜底阈值 2.2/2.0 低于 WCAG 大字 3:1 | N08-F2 × N02-F3 | timeline 兜底改 theme accent；cardColors layout0 加极性重算 | M | **是** |
| R2-06 | **胶囊 HUD 文字右/中心对齐泄漏**（scene 设 textAlign 无 save/restore，drawCapsuleLabel 不自设 left）——全主题全帧中招 | N02-F1（放大取证）+ 本席独立复核 common.js:204 / segment.html:543 | drawCapsuleLabel 显式 textAlign='left' | S | **是** |
| R2-07 | page 字段漏 `..` 检查 = **服务端任意文件存在性 oracle**（assets/outDir 都拦了唯独 page 没拦） | N05-F1 + 本席复核 spec.mjs:422-438 | page gate 加 segments.includes('..') + 新码 E_PAGE_TRAVERSAL | S | 否 |
| R2-08 | install.ps1 全文 0 个 `$`（发布即 ParseError），README 却把它当 Windows 第一条命令 | N01-F1 | 已重写 + PARSE_OK；CI 加语法门禁 | S | 否 |
| R2-09 | **9:16 项目 + `--platform` 永远出不了绿灯**：master 被硬编 1920×1080，QA 按 spec.format 判 FAIL | N01-F2 × N03-F2 | master = 项目原生画幅（spec.format）；SKILL 契约同步「master 恒为原生尺寸」 | M | 否（横屏不变） |
| R2-10 | `--concurrency 8` 实测 8/23 段失败 + 负收益（1.28×）；无钳制无错峰 | N06-F1 × N04-F6 × N01-F3 | compile 钳 ≤ 物理核/2；CDP 失败文案给自救路径 | M | 否 |
| R2-11 | **master.mp4 不幂等**（同 spec 两次全缓存构建 sha 不同）——与 SKILL「确定性」卖点直接矛盾 | N04-F1（哈希实证） | 正式编码钉 threads + bitexact；contract 加双跑断言 | M | 否 |
| R2-12 | golden 的 Chrome 环境闸门 `actual:null` 仍判 `match:true` —— 9/9 相符的一半来源是假绿 | N09-F2 | null → 不匹配 + `reason:probe-failed` | S | 否 |
| R2-13 | v2.5.1 那次 41s 构建没进 runs.jsonl（文档引用的记录是 2.5.0 的） | N09-F1 | 查 recordRun 分支，补 + 契约「每次 build 必追加」 | S | 否 |

## 二、P1（按 ICE 排序）

| ID | 项 | 来源 | 工作量 |
|---|---|---|---|
| R2-14 | `--json` stdout 污染（plan/deliver 尾挂人类日志；build 根本没有 --json；history 有文档没实现） | N04-F2 | M |
| R2-15 | `cvs plan` spec 错 exit 1，路由表无此支 | N04-F3 | S |
| R2-16 | 未知 flag 静默忽略（`--strik`/`--pform` 也 exit 0——漏 --strict 的假阳性会写进结论）；`--set meta.brand=2024` 被强转成数字 | N04-F8 | M |
| R2-17 | render-manifest cached 条目缺 expected/seconds → 完成定义④增量下不可执行；键序随机；updated 破坏幂等 | N04-F4 | S |
| R2-18 | 一个坏 page 连坐健康段（failedSegments 假阳性 ×2）；`.mjs` 当页面 lint 放行烧 373s 才失败 | N04-F5 | M |
| R2-19 | API 硬编码 --concurrency 2 无视 spec；evictOldJobs 不删磁盘目录 | N04-F6 | M |
| R2-20 | 同一次构建 stdout 混 Windows/POSIX 两种路径风格（agent 抓成片路径会 ENOENT） | N04-F7 | S |
| R2-21 | 全管线无 GOP 控制：成片最大 GOP 242 帧（8.07s），平台必二转 | N03-F3 | S |
| R2-22 | H.264 level 不受控：master 5.0 / douyin 4.0 互相打架 | N03-F4 | S |
| R2-23 | two-pass pass1 缺 X264_PARAMS/COLOR_TAGS → 率控预测自始错误 | N03-F5 | S |
| R2-24 | subdiv 用最小间距猜 + offset 自由搜索 = 挑尺子换了个维度继续挑 | N07-F3 | M |
| R2-25 | flash cue 间距固定 0.25s 与 BPM 无关 → **90 BPM 下 beat grid 崩到 31.4%**（v2.5.1 的成绩只在 120 成立） | N07-F2 × N03-F6 | M |
| R2-26 | tempo 探测八度混淆（90 BPM 报 59.37）；纯正弦报 90.81 且 PASS | N07-F4 | M |
| R2-27 | synth 响度随 BPM/时长漂 2.9 dB；npm qa:audio 量的是未归一 wav | N07-F7 | M |
| R2-28 | theme-audit 只审 token 不审上屏组合 → 能全绿而画面 1.3:1 | N08-F3 × N02-F6 | M |
| R2-29 | `?title=` 单传时胶囊复读标题 | N02-F2 | S |
| R2-30 | `cvs image` 的 card/poster/story 带生产 HUD（帧号/TC） | N02-F4 | M |
| R2-31 | locale 是死字段；Latin 长词只缩字号不换行（40px 地板后出血） | N08-F5 | L（做最小版：按词断 2 行） |
| R2-32 | SRT 无 BOM 纯 LF（记事本/剪辑器乱码面）；VTT 无 Language 头 | N08-F6 | S |
| R2-33 | 字幕 7-8 字/秒（CJK 建议 ≤5）+ 12 对零间隙 | N08-F4 | S |
| R2-34 | E_PAGE_MISSING 不回显 root——ERRORS.md 白纸黑字承诺了 | N01-F4 | S |
| R2-35 | `cvs wizard --help` 不打印帮助反而起服务占 5181 | N01-F5 | S |
| R2-36 | `cvs new` 品牌兜底=项目名，一路放行上屏；空串拦得住、等值兜底拦不住 | N01-F6 | S |
| R2-37 | qa 附属产物散落仓库根（contact.jpg/独立入口的 qa-audio 默认路径）；cvs new 默认 outDir=out 会互踩 | N01-F7 × N09-F6 | S |
| R2-38 | 字体加载挂 → __ready 永置不了 false 报错，image --page 120s 超时假死 | N08-F8 | M |
| R2-39 | 静态服务器 no-store 废掉字体缓存（每段重解码 CJK woff2） | N06-F6 | S |
| R2-40 | count_frames 全解码在 concat/QA 重复 3-4 遍（每次成片 ~25-34s 白烧） | N06-F4/F5/F7 | M |
| R2-41 | combos 矩阵 13/20 风格缺行，测试只比列不比行——「脱节即红」是假的 | N09-F5 | M |
| R2-42 | README 仍是 13 styles / v2.3.5 口吻（真实 20 风格） | N09-F4 | S |
| R2-43 | E_SPAWN 注册未使用（registry 死条目，覆盖率口径盲区） | N09-F7 | S |

## 三、P2（记台账，本轮不做，理由如实）

- 竖屏底部 40% 死区（N02-F5）与配方页标题 scrim（N02-F3）：视觉重设计，逐页评审后再动。
- accentInk/accent APCA 42-58（N02-F6+N08）：并入 R2-28 有效色矩阵一起看，单点改色会牵动 13 主题像素。
- xfade 两次有损编码（N03-F7）、<5s 结构文法（N03-F8）、GPU 探测文案（N06-F2）、浏览器 warmup（N06-F3）、capture 路径报告（N06-F8）、合成床音色打磨（N07-F8）、reduced-motion（N08-F7）。
- `--audio` 用户素材 24-bit 路径等 edge case 的 CI 化。

## 四、落地波次（依赖排序）

1. **波1 纯逻辑零像素**：R2-02/03/07/12/13/15/16/17/20/32/33/34/35/36/37/42/43 + install.ps1 CI 门禁 + R2-41
2. **波2 编码参数（改 mp4 字节不改画面）**：R2-21/22/23/01(TP 链)/09(master 原生尺寸)/10(并发钳)/11(bitexact)
3. **波3 音频网格与 tempo**：R2-24/25/26/27（与波2 的 qa-audio TP 同文件，串行做）
4. **波4 API/渲染恢复语义**：R2-14/18/19/28/30/38/39/40
5. **波5 像素波（golden 重定基线）**：R2-04/05/06/29 —— 每处改动前后目视对照 + D7 注记
6. **终验**：contract 全绿 + test:all + browser + 41s strict 全链路重跑 + 幂等双跑 + 三端推送
