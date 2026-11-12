# code-video-showcase

**A pure-code, beat-synced showcase-video skill — every frame drawn with HTML/Canvas/SVG/Three.js, every sound synthesized with Python, assembled by FFmpeg. No video, image or music generation models.**

An Agent Skill for producing 30–90 s "style showcase" films: an 8 s opening, eleven style segments with 1 s big cards between them, an eight-flash montage, and a cinematic ending — all reproducible frame by frame.

> **中文简介**：这是一个「用代码做视频」的 Agent Skill：画面用 HTML/Canvas/SVG/Three.js 逐帧渲染，配乐用 Python（numpy/scipy）合成，最后由 FFmpeg 合成 30–90 秒的卡点风格展示片，全程不调用任何视频、图像或音乐生成模型。仓库里包含剪辑结构公式、13 套主题、11 种风格配方、大字卡系统、120 BPM 配乐方案、零依赖 CDP/Playwright 渲染管线、视频/音频质检和可运行模板。完整中文说明见 [中文](#中文)。

> **一键安装 / Install in one sentence**
>
> 把这句话发给你的 Agent：「把这个仓库安装成 Agent Skill：`git clone https://github.com/Moessif/code-video-showcase.git ~/.dsh/skills/code-video-showcase`（Claude Code 换成 `~/.claude/skills/`，通用 Agent 用 `.agents/skills/`），装好后读一遍 `SKILL.md` 确认可用。」
>
> Send this to your agent: "Install https://github.com/Moessif/code-video-showcase as an Agent Skill: clone it into `~/.dsh/skills/code-video-showcase` (`~/.claude/skills/` for Claude Code, `.agents/skills/` for generic agents), then read `SKILL.md` to confirm it works."

[![MIT License](https://img.shields.io/badge/license-MIT-d97757?style=flat-square)](LICENSE)
[![Node 20+](https://img.shields.io/badge/node-%E2%89%A5%2020-3c873a?style=flat-square)](https://nodejs.org/)
[![FFmpeg](https://img.shields.io/badge/ffmpeg-libx264%20%2B%20AAC-007808?style=flat-square)](https://ffmpeg.org/)
[![No generative models](https://img.shields.io/badge/generative%20models-none-d97757?style=flat-square)](#design-constraints)
[![Latest release](https://img.shields.io/github/v/release/Moessif/code-video-showcase?style=flat-square&color=d97757)](https://github.com/Moessif/code-video-showcase/releases)

**Changelog / 更新历史**：[CHANGELOG.md](CHANGELOG.md) · [GitHub Releases](https://github.com/Moessif/code-video-showcase/releases)

> **Credits / 致谢**：This skill started from a prompt by the creator **Mixx.ftr** — this repository is an independent engineering reconstruction and extension of that prompt into runnable templates, themes and a deterministic render pipeline.
>
> 本技能最初起源于创作者 **Mixx.ftr** 的提示词，仓库是在其基础上做的工程化整理与扩展（模板、主题系统、预览与渲染管线）。

## Compiler pipeline (v2.1)

v2.1 turns the skill into a **video compiler**: `spec.json` is the single source of truth, `plan.json` is a build plan with a content hash per segment, and recompiles only re-render what changed.

```text
spec.json (IR) → spec-lint → plan.json (per-segment hash) → render-farm (cache) → master.mp4 → qa
```

```bash
# validate / plan / compile a project
node scripts/spec-lint.mjs --spec fixtures/mini-41s/spec.json --root .
node templates/plan.mjs  --spec fixtures/mini-41s/spec.json --root . --print
node scripts/compile.mjs --spec fixtures/mini-41s/spec.json --root . --no-qa --concurrency 4

# unified CLI
node bin/cvs.mjs new "赛博像素的宣传片，30秒竖屏" --out project.spec.json
node bin/cvs.mjs ref poster.jpg --spec project.spec.json --out project.spec.json
node bin/cvs.mjs lint project.spec.json --root .
node bin/cvs.mjs build project.spec.json --concurrency 4
node bin/cvs.mjs motion matrix      # motion profile table
node bin/cvs.mjs image --spec project.spec.json   # same spec -> image set (cover/card/poster/story)
```

`cvs ref` extracts a palette / accent / density from a reference image (deterministic 96×96 OKLab k-means, APCA-gated, top-3 theme candidates) and writes it into `look.theme` + `look.accentOverride` — it extracts statistics, never copies pixels. The same core (`scripts/ref-core.mjs`) runs in the browser, so the wizard accepts a dragged image directly and records `meta.reference`.

**Motion profiles** (`templates/motion-profile.mjs`) — `look.motion` picks one of `calm` / `standard` / `dynamic` / `maximal`; omit it and the compiler derives one from *video type × art style* (cyber-pixel → `maximal`, launch/minimal/ink-wash → `calm`, knowledge → `standard`). The level travels to every page as `?mp=<level>` and scales the transition, easing, stagger, impact, shake, flash, push and the grain/scanline/paper texture layers. `standard` reproduces the pre-v2.3 output **byte for byte**, so existing projects are unchanged.

**Style → page** (`templates/style-pages.mjs`) — the single source of truth for "which page renders this art style". Each of the 12 styles maps to a real page (`cyber-pixel` → `templates/cyber-pixel.html`, `guofeng` → `templates/recipe-guofeng.html`, …); `?recipe=` is now only an in-page hint, not what selects the page. Generators (`scripts/nl2spec.mjs`, `app/wizard/`) read this table, and an unknown style falls back to the generic scene page rather than the placeholder skeleton. Before v2.3.1 every style silently rendered the placeholder (audit finding F1).

**Accent override** — `look.accentOverride` (brand colour from `cvs brand apply`, or the contrast-safe colour from `content/combos.json` `_meta.accentFix`) is expanded by the plan into `?accent=/#…&accentInk=/#…&accentSoft=/#…` on **every** segment URL, and `themeFromURL()` applies it via `accentOverride()`. Without an override no parameter is added, so existing films are byte-identical. Before v2.3.1 no page ever received the override: brand colours never appeared in the video, and `accentFix` only silenced the linter (audit finding F3). It is part of `segmentHash`, so changing a brand colour always re-renders.

**Images, not just video** (`cvs image`) — the pipeline was always "code draws each frame → Chrome → PNG/JPEG", so a still was already the same render as a video frame. `cvs image` turns that into a product surface: it renders one hero frame of the spec's style segment into a set of social sizes (`cover` 1920×1080, `wide` 2560×1080, `card` 1080×1080, `poster` 1080×1350, `story` 1080×1920, `avatar` 800×800) and writes `image-manifest.json` with per-image sha256. It reuses the **plan's segment URL**, so `?theme=` / `?mp=` / `?accent=` match the film exactly — the image and the video are the same picture. One browser renders every size; identical inputs give an identical sha256.

| Piece | File |
|---|---|
| IR schema | `schema/project.spec.schema.json` |
| normalize / validate / migrate (`timeline v1` → spec) | `templates/spec.mjs` |
| spec → plan + `segmentHash` | `templates/plan.mjs` |
| motion profiles (levels + kind×style derivation) | `templates/motion-profile.mjs` |
| style → rendered page (single source of truth) | `templates/style-pages.mjs` |
| easing / spring / CJK type / texture (single source) | `templates/motion.js` |
| spec → image set (`cover`/`card`/`poster`/`story`) | `scripts/image.mjs` |
| content-addressed cache | `<outDir>/.cache/<hash>.mp4` (`render-farm --cache`) |
| one-command build | `scripts/compile.mjs` |
| gates (pages / theme / APCA / resource caps) | `scripts/spec-lint.mjs` |

**Untrusted specs.** A `spec.json` may come from a user, a form, or an API body, so `templates/spec.mjs` is also a security boundary: `rounds[].id` must match `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` (it becomes a filename and a line in the ffmpeg concat list, so it must not carry `../` or a newline); page paths may not be absolute URLs (`E_PAGE_REMOTE`, opt in with `render.allowRemotePages: true`) or absolute filesystem paths (`E_PAGE_ABS`); and `flash.count` / segment seconds / total frames are capped. `server/api.mjs` keeps CORS **same-origin by default** (`--cors <origin>` to allow one), caps its queue (`MAX_QUEUE`) and job history (`MAX_JOBS`), and scrubs absolute paths out of error messages. The three static servers refuse dotfiles.

**Surfaces** (each is a zero-dependency static app, `node app/<name>/serve.mjs`):

| Surface | Port | Purpose |
|---|---|---|
| `app/wizard/` | 5181 | 8 presets + 7 cards + reference-image upload → valid `spec.json` |
| `app/canvas/` | 5182 | scrub + click-to-inspect + Shift-drag marquee + live patch |
| `app/script/` | 5183 | storyboard table editing with overflow checks |
| `app/versions/` | 5184 | localStorage version tree + side-by-side diff |
| `server/api.mjs` | 5190 | job queue: `POST /jobs` → compile → `master.mp4` |
| `app/review/` | 5185 | review page: player + frame-level comments (localStorage) |

**Guards**

```bash
npm run test:all        # pure-Node suites (spec, script, assets, variants, reflow, ref, brand, ingest)
npm run test:browser    # canvas contract, wizard reference, 9:16 reflow, recipes, cyber-pixel determinism
npm run golden          # 3 projects × 3 frames, byte-exact still hashes (fixtures/golden/manifest.json)
npm run test:perf       # cold vs cached compile wall-time gate
npm run brand -- check --spec project.spec.json --brand content/brands/tech-dark.json
```

**Ingest** (optional, from real footage):

```bash
node ingest/cli.mjs --input <file-or-dir> --target 60 --out out/ingest
```

Measured on this machine (Windows 10, 41 s fixture, 1230 frames, 1080p30):

| Pass | Wall time | Notes |
|---|---|---|
| cold compile @4 | **4m30s** | batch workers (one browser per shard), 600 ms stagger; 1230 frames |
| cold compile @2 | **4m48s** | same output; 4-way Chrome cold start contends on this box |
| warm recompile | **1.9–3.2s** | 23/23 segments served from the content cache |
| QA | 10 pass / 1 warn / 0 fail | warn = no audio track |

Before the batch worker (one process + one browser per segment) the same cold compile took `9m34s`. `npm run test:perf` re-runs this gate.

## Preview

> **There is no finished demo video in this repository**, and the reference sample file is not distributed. The previews are analysis artifacts of the 61 s reference showcase the skill was reverse-engineered from, plus a placeholder still rendered from the shipped big-card template.

![1 fps contact sheet of the 61 s reference showcase](assets/contact-1fps.jpg)

*1 fps contact sheet (8×8 tiles) of the reference film: the typing opening, eleven big-card / style-segment rounds, the eight-flash montage and the ending. Generated by `scripts/analyze-reference.sh`.*

![Eleven style segments of the reference](assets/style-tiles.jpg)

*One representative frame from each of the eleven style segments: flat-science, Fourier math, product launch, whiteboard, cyber glitch, ink-wash, data race, 8-bit, code screencast, Three.js clay, vertical short.*

![Twelve big cards of the reference](assets/card-tiles.jpg)

*All twelve big cards — eleven "what do you want to make?" prompts plus the "还有更多?" card — across four alternating layouts: accent-colour, paper, dark centred, dark left-aligned.*

![Spectrogram of the reference soundtrack](assets/audio-spectrogram.png)

*Log-frequency spectrogram of the reference soundtrack: sparse intro (0–8 s), full-band groove from 8 s, visible 4 s structural seams, near-silent tail from 60.4 s.*

![Placeholder still rendered from templates/big-card.html](assets/template-demo-card.jpg)

*`templates/big-card.html` rendered through `templates/render-segment.mjs` at 1920×1080: dark layout, "想开 / 产品发布会?" card, `STYLE 03 / 11`. Placeholder content — replace the copy, keep the timing.*

Theme previews are in [Themes](#themes): `assets/theme-previews/theme-three-up.jpg`, `theme-contact-sheet.jpg`, and per-theme stills `01-coral-noir.jpg` – `08-crimson-theater.jpg` (generated by `scripts/theme-preview.mjs`).

## What it is

The skill is a production recipe, not a model. It packages the structure measured off a real 61 s showcase: a declarative timeline + plan, a big-card system, thirteen theme palettes (OKLCH-derived, APCA-audited), eleven art-direction/technical/sound recipes, a 120 BPM synthesized score, a deterministic zero-dependency CDP / Playwright → FFmpeg pipeline, parallel rendering with resume, video + audio QA gates, an optional gated AI lane, and runnable templates. Because every frame is a pure function of `t`, renders are deterministic: the same second always produces the same frame, on any machine.

**v2 adds** — `timeline.json → plan.json` (single source of truth, exact frame snapping), `color.js` (OKLCH/OKLab + APCA), `motion.js` (closed-form springs, CJK kinsoku layout, kinetic type, grain/RGB-split/bloom), a zero-dependency Chrome DevTools Protocol driver, `render-farm.mjs` (parallel + retries + resume), platform delivery presets, `qa-video.mjs` + `qa-audio.py`, `doctor.mjs`, `new-project.mjs`, and `ai-lane.mjs` (disabled by default).

### At a glance

| Property | Default target | Notes |
|---|---|---|
| Format | 1920×1080, 30 fps, 1× device scale | one HTML page per segment |
| Length | 61.0 s = 1830 frames | generalized by the formula below |
| Video | H.264 High, `yuv420p`, bt709, CRF 21 master / 22–24 delivery | maxrate-capped; +faststart; intermediate CRF 12 |
| Audio | 48 kHz stereo AAC 192–320 kbps, −14 LUFS | synthesized, no samples; two-pass loudnorm |
| Tempo | 120 BPM — 0.5 s per beat, 2 s per bar | 1 s card = 2 beats, 3 s style segment = 6 beats |
| Theme | 13 palettes, default `coral-noir` | omitting `?theme=` keeps the original coral `#d97757` on `#0e0e0d` visuals; see [Themes](#themes) |
| Type | OFL fonts only, served locally | Noto Sans/Serif CJK SC, Inter, JetBrains Mono, Orbitron, Playfair Display, Ma Shan Zheng, Long Cang, ZCOOL KuaiLe, ZCOOL QingKe HuangYou, Press Start 2P |
| Determinism | frame = f(t) | no CSS animation, rAF, `Date.now`, `Math.random`; no burned-in subtitles |

Measured on the reference sample: container 61.013 s / video 61.000 s, 1830 frames, 60 scene cuts, H.264 ≈ 3.53 Mbps, AAC 48 kHz stereo ≈ 196.8 kbps, 26.9 MB. Source data in `assets/scene-cuts.txt` and `assets/audio-analysis.json`.

### The timeline formula

```text
0 ── opening (O = 8 s) ── 8 ── N × 4 s rounds = 44 s ── 52 ── "还有更多?" card 1 s ── 53
  ── eight flashes 2 s (8 × 0.25 s) ── 55 ── ending (E = 6 s) ── 61

total = O + N·R + 1 + 2 + E          # 8 + 11×4 + 1 + 2 + 6 = 61 s
```

Each round `R = 4 s` = one big card (1 s / 2 beats) + one style segment (3 s / 6 beats). The first frame of every style segment is the beat hit. Frame check: each segment is `round(duration × 30)` frames and the whole film must total **1830**.

### The 10-stage workflow

1. **Lock the brief** — topic, brand placeholder `{{BRAND}}`, duration, number of styles `N`, one line per style, ending CTA.
2. **Write the edit table** — every segment as `[start, end, type, style, t0, speed]` in one JSON/Markdown constant file; all later scripts read it.
3. **Prepare the environment** — `node scripts/doctor.mjs` checks Node, Chrome/Edge (Playwright optional), FFmpeg, numpy + scipy and local fonts; see `references/render-pipeline.md` for the cross-platform setup.
4. **Scaffold the project** — static server, `common.js`, segment / card / render / concat / audio templates.
5. **Implement segments one at a time** (an 11-segment outer loop): scene → 5–6 stills → contact sheet → full render → `ffprobe` frame count.
6. **Opening (8 s)** — character-by-character typing, three scrolling code columns, particle burst, white flash.
7. **Big cards** — four layouts rotating, 2 beats each: slam-in, speed lines, echo type, `STYLE 0X / 11`.
8. **Eight flashes + ending (optional)** — eight 0.25 s micro-posters, then a 6 s cinematic ending.
9. **Score the film** — 120 BPM, A minor, sharing the exact timing constants of the edit table; verify against a spectrogram.
10. **Assemble and QA** — segment MP4s → concat → platform preset (CRF + loudnorm) → `qa-video` / `qa-audio` → contact sheet + spectrogram + human review.

The mandatory inner loop for every segment:

```text
design -> write HTML -> stills at t=0.2/0.8/1.4/2.0/2.6 -> contact sheet
       -> full render -> ffprobe frames == duration*30 -> log -> next segment
```

Do not write all eleven segments and then render once; get one segment perfect and copy it.

### Big-card system (1 s / 2 beats)

| Layout | Background | First line | Keyword | Underline |
|---|---|---|---|---|
| A | accent colour | black 70 px | black 170 px | black 8–12 px |
| B | paper `#f4efe6` | black 70 px | black 170 px | accent 8–12 px |
| C | dark `#0e0e0d`, centred | white 70 px | accent 170 px | none |
| D | dark `#0e0e0d`, left-aligned | white 70 px | accent 170 px | none |

- Beat 1 (`t=0`): first line slams in; beat 2 (`t=0.5`): keyword + suffix slams in.
- Slam = scale `1.7 → 1`, blur `16 → 0` px, 0.11 s, `outExpo`; plus accent speed lines, radial glow and 6 px / 12 px screen shake.
- Background: 600 px outlined echo text drifting horizontally; `STYLE 0X / 11` bottom-right; music drops to 6% during the card, then the style segment opens with its own hit.
- Pre-render blur layers once and cross-fade with `globalAlpha` — never run `ctx.filter` per frame.

### The 120 BPM soundtrack

Pure numpy/scipy synthesis — no samples, no audio model:

- **Instruments**: kick (sine sweep), snare, clap, hat, crash, sub boom, noise riser, reverse crash, whoosh, plucked string, FM e-piano, FM bell, supersaw, 808, square/triangle leads, flute.
- **Harmony**: A minor, one chord pair per 6-beat segment — Am/F, C/G, F/G, C/F, Am/G, Am/Em, Dm/E, C/G, Dm/G, F/G, Am/F.
- **Arrangement**: pad + typing clicks → sub boom at 4.55 s, kick crescendo → 8th hats from 5.5 s → snare roll 6.5–7.95 s → reverse crash at 7.45 s. Cards drop the music to 6%; the first frame of each style segment is a six-layer hit.
- **Mix**: kick-envelope sidechain (55% duck), 2.2 s synthetic convolution reverb, `tanh` soft clip, normalize to −0.6 dBFS.
- **Reference measurements**: 120.0 BPM, phase 0.0 s, 86.3% of 102 strong onsets inside ±30 ms of the grid (median error 0 ms); card hits measure 8–9× the previous 300 ms of energy, style-segment hits 2.8–3.5×.

### Rendering pipeline (v2)

1. `timeline.mjs` validates `timeline.json`, snaps every segment to integer frame boundaries and writes `out/plan.json` + `out/segments.txt`. This is the only place that computes duration/frames/cues.
2. `render-segment.mjs` serves the project root over HTTP (fonts and assets same-origin; never `file://`), launches headless Chromium via Playwright **or raw CDP** with system Chrome/Edge, waits for `document.fonts.ready` and `window.__ready`, then renders each frame. Single full-viewport canvases are captured with `canvas.toDataURL()` (30–50% faster); DOM overlays fall back to `Page.captureScreenshot({ optimizeForSpeed: true })`. Frames are piped to `ffmpeg -f image2pipe … -crf 12 -preset veryfast`, converted from full to limited range and tagged `bt709/bt709/bt709/tv`.
3. `render-farm.mjs` runs segments in parallel (one process + browser per segment), retries failures, verifies frame counts, and resumes finished segments from `out/render-manifest.json`.
4. `concat-and-encode.sh` stream-copies the segments (falling back to a normalising re-encode), applies a platform preset (master/youtube/bilibili/douyin/xiaohongshu/weixin/archive), one CRF final pass, two-pass EBU R128 loudness (`−14 LUFS`, `−1 dBTP`), `+faststart`.
5. `qa-video.mjs` and `qa-audio.py` gate the result: frame count, colour tags, black/frozen frames, silence, loudness, VMAF (optional), beat-grid and cue alignment, HF restraint, contact sheet.

### QA gate (automated + human)

```bash
node scripts/qa-video.mjs out/final.mp4 --plan out/plan.json
python scripts/qa-audio.py audio/mix.wav --plan out/plan.json --strict
node scripts/theme-audit.mjs --strict
node scripts/determinism-check.mjs --page "segments/01.html?theme=coral-noir" --t 0.5
```

**Automated** — frames = `plan.stats.frames`; size/fps/colour tags; black ≤ max(0.5 s, 1%); no unexpected freeze outside card/flash windows; no mid-film silence > 1 s; −14 ±1 LUFS, true peak ≤ −1 dBTP; ≥80% of cues within ±30 ms; BPM ±2; ≥70% onsets on the beat grid; 8–16 kHz key-vs-rest ≥ +6 dB; theme WCAG (and APCA report). `qa-video.mjs` fails hard on pix_fmt/size/frames and (with `--ref`) VMAF; `--strict` promotes warnings.

**Human** — no console errors/404s; every font passes `document.fonts.check()` with no missing CJK glyphs; 5–6 stills per style segment and a 1 fps contact sheet; grep proves no CSS animation/rAF/`Date.now`/`Math.random`; no per-frame `ctx.filter` or large `shadowBlur`; coordinates cached before camera transforms; 1920×1080 at 1×, `preserveDrawingBuffer: true`, WebGL via SwiftShader; a cover frame and a one-page spec sheet are produced.

## Themes

A theme is not three swapped colours: it is a role palette (14 tokens), one background material, HUD specs and four accent colours. Thirteen themes ship in `templates/themes.js`; **omitting `?theme=` renders the original `coral-noir` visuals, pixel for pixel**. The five v2 themes are derived in OKLCH and audited with both WCAG 2 and APCA (`node scripts/theme-audit.mjs`).

| # | id | Name | Mode | Material | Best for |
|---|---|---|---|---|---|
| 01 | `coral-noir` | Coral Noir / 珊瑚暗夜 | dark | film grain | default / product & tech launch |
| 02 | `claude-light` | Claude Light / 橙光白 | light | warm paper | brand / knowledge / interview |
| 03 | `aqua-morandi` | Aqua Morandi / 水蓝白·莫兰迪 | light | liquid glass · soft light | beauty / lifestyle / light tech |
| 04 | `amber-noir` | Amber Noir / 琥珀黑金 | dark | brushed foil | premium / luxury / annual film |
| 05 | `blueprint-stone` | Blueprint Stone / 蓝图纸 | light | blueprint grid | engineering / architecture / data |
| 06 | `graphite-signal` | Graphite Signal / 石墨信号 | dark | matte industrial | developer / hardware / hard tech |
| 07 | `celadon-paper` | Celadon Paper / 青瓷白 | light | ink wash | oriental / culture / minimal |
| 08 | `crimson-theater` | Crimson Theater / 绯墨剧场 | dark | stage spotlight | fashion / art / teaser / mood |
| 09 | `cyber-neon` | Cyber Neon / 赛博霓虹 | dark | neon glow + grid | tech / gaming / trailer / stream |
| 10 | `paper-journal` | Paper Journal / 纸质手账 | light | paper + fine grid | knowledge / tutorial / lifestyle |
| 11 | `dark-gold-cinema` | Dark Gold Cinema / 暗金电影 | dark | foil + grain | premium / cinematic / annual film |
| 12 | `ice-minimal` | Ice Minimal / 冰蓝极简 | light | cold matte | SaaS / data / medical / minimal |
| 13 | `pop-acid` | Pop Acid / 波普酸色 | dark | glow spot + grain | street / music / social / youth |

![Three featured themes](assets/theme-previews/theme-three-up.jpg)

*Three featured themes side by side: coral-noir (default), claude-light, aqua-morandi.*

![Theme contact sheet](assets/theme-previews/theme-contact-sheet.jpg)

*Contact sheet of all thirteen themes. Per-theme stills: `assets/theme-previews/01-coral-noir.jpg` … `13-pop-acid.jpg`.*

![Default theme still](assets/theme-previews/01-coral-noir.jpg)

*`coral-noir` — the default theme, identical to the pre-theme visuals.*

Pick a theme through the query string. Both templates read it with `themeFromURL()`; aliases work (`?theme=aqua`, `?theme=claude`, `?theme=珊瑚`) and an unknown value falls back to `coral-noir`:

```bash
# style segment (relative --page keeps ?theme=; the renderer appends seg/t0/speed/dur)
node render-segment.mjs --page /segments/01.html?theme=aqua-morandi --out out/01.mp4 --duration 3

# big-card stills
node render-segment.mjs --page /big-card.html?theme=graphite-signal --still 0.5,1.0 --outdir out/stills
```

Theme choice is an intake decision, not a rendering tweak: collect the brief with `references/intake.md` (at most two rounds, lock the theme, write `brief.json`), then read the full spec in `references/themes.md`. Audit every palette change with `node scripts/theme-audit.mjs --strict` — all thirteen themes pass WCAG today (APCA flags a few dark-theme muted greys). For a real brand colour use `accentOverride(themeRef, input)` in `themes.js` and store the returned `override` in `brief.json`; do not invent a fourteenth theme.

## Quick start (v2)

The templates are a scaffold, not a finished film.

```bash
# 0) environment check — node, Chrome/Edge, ffmpeg, python, fonts
node scripts/doctor.mjs

# 1) scaffold a runnable project (runtime + segments/*.html + timeline.json + BRIEF.json)
node scripts/new-project.mjs --out ../my-showcase --name my-showcase \
  --theme cyber-neon --styles 11 --fonts
cd ../my-showcase

# 2) validate the timeline and generate the plan + concat list
node templates/timeline.mjs --spec timeline.json \
  --out out/plan.json --concat out/segments.txt --print

# 3) cheap stills first — t=0.2,0.8,1.4,2.0,2.6
node templates/render-segment.mjs --page "segments/01.html?theme=cyber-neon" \
  --still 0.2,0.8,1.4,2.0,2.6 --outdir out/stills

# 4) render one segment, then the whole film in parallel (resume-safe)
node templates/render-segment.mjs --page "segments/01.html?theme=cyber-neon" \
  --out out/r01-style.mp4 --duration 3 --t0 0.35 --speed 1.4
node templates/render-farm.mjs --plan out/plan.json --concurrency 4 --resume

# 5) soundtrack (--plan lands every cue on the timeline; refine the arrangement after)
python templates/synth_audio.py --plan out/plan.json --out audio/mix.wav

# 6) concat + platform preset (master | youtube | bilibili | douyin | xiaohongshu | weixin | archive)
bash templates/concat-and-encode.sh --platform master out/segments.txt audio/mix.wav out/final.mp4 61 30

# 7) QA gate
node scripts/qa-video.mjs out/final.mp4 --plan out/plan.json
python scripts/qa-audio.py audio/mix.wav --plan out/plan.json --strict
node scripts/theme-audit.mjs --strict
```

`segments.txt` is generated by `timeline.mjs`; it is a concat-demuxer list with absolute paths:

```text
file 'E:/my-showcase/out/00-opening.mp4'
file 'E:/my-showcase/out/r01-card.mp4'
file 'E:/my-showcase/out/r01-style.mp4'
...
```

Notes:

- **No Playwright required.** `render-segment.mjs` tries Playwright, then falls back to system Chrome/Edge over raw CDP (`templates/cdp.mjs`). Set `CHROME_EXE` or `--browser` to pin a build.
- Single full-viewport canvases are captured with `canvas.toDataURL()`; pages with DOM overlays or WebGL readback problems automatically use CDP screenshots. Force it with `window.__capture = 'cdp'`.
- Style segments take `--t0 0.35 --speed 1.4`; the renderer appends `?seg=1&t0=&speed=&dur=` and `common.js` maps clip time `u` to scene time `t = t0 + u·speed`.
- `timeline.json` is the single source of truth. Never hand-compute `round(duration × 30)`; 0.25 s flashes snap to 8/7/8/7 frames at 30 fps. See `references/timeline-schema.md`.
- For manual browser previews, serve the project root (`python -m http.server -d . 4600`) and open `http://localhost:4600/segments/01.html?theme=cyber-neon`. `file://` will not work because pages import ES modules.
- The templates expect a local `shared/fonts.css` with `@font-face` rules. `new-project --fonts` copies the bundled set; otherwise download OFL fonts yourself.
- Useful env vars: `CHROME_EXE` / `FFMPEG_EXE` for the renderer; `FFMPEG` / `FFPROBE` / `PLATFORM` / `CRF` for the shell script; `PYTHON` for audio QA. `--help` is implemented by every script.
- `synth_audio.py` is a toolkit plus a runnable 8 s demo; extend `build_arrangement()` to the full 61 s timeline using `references/audio-recipes.md`, and read `plan.json` cues so audio and cuts share one time base.

## Install as an Agent Skill

The repository is a self-contained skill folder: `SKILL.md` carries the YAML frontmatter (`name`, `description`, `license: MIT`, `compatibility`, `allowed-tools`) and the code agent reads it before acting.

```bash
# DeepSeek Harness
cp -r code-video-showcase ~/.dsh/skills/

# Claude Code
cp -r code-video-showcase ~/.claude/skills/

# Generic SKILL.md-compatible agents
cp -r code-video-showcase .agents/skills/
```

Once installed, the skill auto-triggers on prompts such as 卡点视频 / 风格展示视频 / 纯代码做视频 / 「类似 Opus 5.5 或 DeepSeek 风格展示」 / 逐帧渲染 / 用代码做视频 / HTML Canvas 视频 / 程序化视频 — and on the English equivalents ("beat-synced showcase video", "render video frame by frame in code"). The agent then follows the ten-stage workflow, copies the templates and renders locally.

## Requirements

| Component | Requirement | Why |
|---|---|---|
| Node.js | ≥ 20 (24 recommended; raw CDP needs the global `WebSocket`, Node ≥ 22) | renderer + raw-CDP driver |
| npm packages | **none required**; `playwright`/`playwright-core` optional | fallback driver; system Chrome/Edge is enough |
| Browser | Chrome, Edge or Chromium (Playwright bundled also works) | frame capture; WebGL via SwiftShader args |
| FFmpeg + ffprobe | libx264, AAC, `loudnorm`, `blackdetect`/`freezedetect`/`silencedetect`; `libvmaf` optional | encode, concat, loudness, QA, contact sheets |
| Python | ≥ 3.10 with numpy + scipy (matplotlib optional) | soundtrack synthesis, audio QA, spectrogram |
| Fonts | all OFL, served locally | CJK + display type; no CDN at render time |

### Platform notes

- **Windows**: the renderer tries Playwright (if installed), then system Chrome/Edge over raw CDP. Set `CHROME_EXE` or `--browser` to pin a build. Browser stderr goes to a temp log, and the Chrome profile is removed by a detached cleanup so each segment process exits promptly.
- **WSL / Linux**: if Playwright's bundled download is slow, use Chrome for Testing with `--browser` (the raw-CDP path needs no npm package at all); headless Chromium may need `libnss3/libnspr4/libasound2`, obtainable without root via `apt-get download` + `dpkg-deb -x` into `~/.local/opt/chromium-libs` and `LD_LIBRARY_PATH`.
- Keep `node_modules`, Python venvs, browser caches and scratch frames on the Linux filesystem: in the reference measurements `/mnt/e` wrote ~2000 small files in ~4.9 s versus ~0.05 s on ext4. Frames are piped straight to ffmpeg and never hit disk; rendering is local and CPU-bound, with no cloud service or generation API involved.

## Repo structure

```text
code-video-showcase/
├─ SKILL.md                          # the skill itself — workflow, constraints, index
├─ README.md / CHANGELOG.md          # this file / release notes
├─ package.json                     # npm scripts: test, doctor, plan, render, qa, theme:audit
├─ .github/workflows/render-smoke.yml# CI: 2 s render + concat + QA
├─ references/
│  ├─ timeline-schema.md             # v2: timeline.json → plan.json, frame snapping, render farm
│  ├─ motion-and-color.md            # v2: springs, easing, CJK layout, OKLCH/APCA, transitions
│  ├─ platform-presets.md            # v2: platform resolution/CRF/LUFS + ffmpeg recipes
│  ├─ qa.md                          # v2: video/audio thresholds and JSON reports
│  ├─ ai-lane.md                     # v2: optional AI asset lane, model table, licences
│  ├─ intake.md                      # pre-flight brief intake + theme lock (brief.json)
│  ├─ original-brief.txt             # the original 61 s brief — copy and rebrand
│  ├─ reference-film-analysis.md     # measured breakdown of the reference (cuts/frames/audio)
│  ├─ style-recipes.md               # 11 styles: art direction + technique + sound
│  ├─ themes.md                      # 13 themes: palettes, materials, HUD, cardColors, QA
│  ├─ big-card-and-typography.md     # 4 card layouts, type scale, slam parameters
│  ├─ audio-recipes.md               # 120 BPM arrangement, synthesis formulas, mix chain
│  └─ render-pipeline.md             # browser/CDP / FFmpeg / cross-platform setup and commands
├─ templates/
│  ├─ color.js                       # v2: OKLCH/OKLab, APCA, palette derivation
│  ├─ motion.js                      # v2: springs, easing, CJK kinsoku, kinetic type, textures
│  ├─ common.js                      # easing, seeded random, noise/fbm, segment mode, re-exports
│  ├─ themes.js                      # 13 themes: palettes, materials, HUD, cardColors/chrome
│  ├─ timeline.mjs                   # v2: validate timeline → plan.json + segments.txt
│  ├─ timeline.example.json          # 61 s / 11 rounds example
│  ├─ render-segment.mjs             # frame-by-frame renderer → ffmpeg (Playwright or raw CDP)
│  ├─ cdp.mjs                        # v2: zero-dependency Chrome DevTools Protocol driver
│  ├─ render-farm.mjs                # v2: parallel renders, retries, resume, manifest
│  ├─ concat-and-encode.sh           # v2: platform presets, CRF, loudnorm, bt709
│  ├─ synth_audio.py                 # numpy/scipy instrument library + arrangement demo
│  ├─ segment.html / big-card.html   # style-segment / big-card skeletons
│  └─ theme-board.html / theme-sheet.html
├─ scripts/
│  ├─ qa-video.mjs                   # v2: container/frames/black/freeze/silence/LUFS/VMAF/contact
│  ├─ qa-audio.py                    # v2: BPM/grid/cue alignment/clipping/HF/spectrogram
│  ├─ doctor.mjs                     # v2: environment check
│  ├─ new-project.mjs                # v2: one-command scaffold
│  ├─ ai-lane.mjs                    # v2: AI asset validation / overlay commands
│  ├─ test-core.mjs                  # v2: pure-module regression tests
│  ├─ determinism-check.mjs          # v2: same t twice, byte-identical check
│  ├─ theme-preview.mjs              # render all theme previews, contact sheet and three-up
│  ├─ theme-audit.mjs                # WCAG + APCA audit (--strict for CI)
│  ├─ analyze-reference.sh           # any reference MP4 -> contact sheet/cuts/spectrogram
│  └─ qa-check.sh                    # legacy per-segment check (still works)
└─ assets/                           # evidence images and measured data
   ├─ contact-1fps.jpg               # 1 fps contact sheet of the 61 s reference
   ├─ template-demo-segment.jpg / template-demo-card.jpg
   ├─ audio-spectrogram.png
   ├─ theme-previews/                # theme stills + contact sheet + three-up
   └─ audio-analysis.json / scene-cuts.txt / colors-per-second.json
```

## The 11 styles

| # | Style | Core technique | Key elements | Signature sound |
|---|---|---|---|---|
| 01 | Flat-science explainer | Canvas 2D layered circles / triangles / dashed orbit | sun, earth, light beam, label capsules | marimba |
| 02 | Math animation | Canvas 2D + DFT epicycles + KaTeX | golden heart, formulas, live N/θ | FM e-piano arpeggio + pad |
| 03 | Minimal product launch | canvas type + Three.js `LatheGeometry` | metal ring, LED halo, "Nova Ring" | per-beat sub + bells |
| 04 | Hand-drawn whiteboard | SVG `stroke-dashoffset` + turbulence | bulb → code → clapper, red circle | ukulele + marker noise |
| 05 | Cyber glitch | Canvas gradients / perspective grid + RGB split | striped sun, city, glitch slices | distorted 16th saw + four-on-the-floor |
| 06 | Ink-wash (guofeng) | Canvas fbm ridges + paper texture | mountains, red sun, boat, vertical calligraphy | guzheng pentatonic + taiko + flute |
| 07 | Data visualisation | Canvas bar race + CSS 3D perspective | bars, year counter, glass card | square arpeggio + ticks |
| 08 | 8-bit pixel | 240×135 canvas, pixelated 8× | robot, coins, slime, pixel HUD | chiptune + jump/coin SFX |
| 09 | Code screencast | Canvas editor + typed code | file tree, line numbers, live preview | lo-fi e-piano + vinyl noise |
| 10 | Three.js 3D | `Lathe`/`TorusKnot` + `PhysicalMaterial` | clay studio, glass and metal spheres | bell arpeggio + boings |
| 11 | Vertical short | Canvas phone frame + pop-in UI | 9:16, step cards, comments and likes | 808 + supersaw + trap hats |

Every style segment carries the same chrome: a top-left capsule with the themed index number (coral in the default theme) and style name, a bottom-right 3-second countdown, a faint brand watermark, one or two in-style labels, and no bottom subtitles.

Each of the eleven segments keeps its own palette by default; the theme unifies the film through capsule/HUD chrome, `cardColors()` and `theme.accents` rather than repainting every segment — see the last section of `references/style-recipes.md`.

## Design constraints

- **Deterministic frames.** Every frame is a pure function of `t`. Forbidden: CSS `transition`/`animation`, `requestAnimationFrame` in the page, `Date.now()`, `performance.now()`, `Math.random()`. Use `mulberry32(seed)` and value noise/fbm instead.
- **The renderer drives time.** A page exposes `window.DURATION`, `window.renderFrame(t)`, `window.__ready` (and optionally `window.__bootError`); the renderer calls `renderFrame(i/fps)` — the page never schedules itself.
- **No baked subtitles.** All text is part of the composition (capsules, HUD, labels); bottom subtitle bars are banned.
- **Themes are data.** Every colour comes from `templates/themes.js` (`?theme=` → `chrome(theme)`, `cardColors(theme, layout)`, `drawThemeBackground`); never hard-code `#d97757` in a page.
- **WebGL specifics.** `{ preserveDrawingBuffer: true }`, launch flags `--use-angle=swiftshader --enable-webgl --ignore-gpu-blocklist --enable-unsafe-swiftshader`, camera motion by parameter, never by wall clock.
- **Cheap frames.** Pre-render blur/noise/paper layers once, cross-fade with alpha, and inspect five stills before a full render; avoid per-frame `ctx.filter` and wide `shadowBlur` (per-frame filters are 10×+ slower under software rendering); cache layout coordinates before camera transforms.
- **One page, one segment.** No shared runtime state between pages; visuals and audio import the same timeline constants.
- **OFL fonts only, served locally.** Load with `document.fonts.load(...)` for every family and weight, then `document.fonts.ready`, then set `window.__ready`.

## License & credits

Released under the **MIT License** — see [LICENSE](LICENSE).

Credits and provenance:

- The structure, timing and visual grammar come from a frame-by-frame analysis of a 61 s reference style-showcase video. The analysis is documented in `references/reference-film-analysis.md`, with evidence in `assets/`.
- **Original prompt credit:** the seed prompt behind this skill came from the creator **Mixx.ftr**; the templates, theme system, preview tooling, render pipeline and QA checklist in this repository are an independent engineering extension built on top of it.
- The production brief that this skill operationalizes is included verbatim as `references/original-brief.txt`.
- No third-party code or media assets are bundled. All artwork is meant to be drawn at runtime; the soundtrack is synthesized.
- Fonts are **not** bundled — download OFL-licensed font files yourself and serve them locally.
- The coral `#d97757` brand colour and the sample copy are placeholders; replace them with your own brand and script.

## Language

This README is bilingual: English first, Chinese below. `SKILL.md` itself is written in Chinese and is the authoritative source for the workflow. [跳到中文](#中文).

## 中文

**这是一个「用代码做视频」的 Agent Skill：** 画面由 HTML/Canvas/SVG/Three.js 逐帧绘制，配乐由 Python（numpy/scipy）纯合成，最后交给 FFmpeg 合成 30–90 秒的卡点风格展示片。全程不调用任何视频、图像或音乐生成模型，每一帧都是时间 `t` 的纯函数，可复现、可逐帧检查。

### 这个项目是什么

它不是模型，而是一套可复用的制作方法。内容来自对一支 61 秒风格展示样片的逐帧拆解：时间轴/计划、4 套大字卡版式、11 种风格的「美术 + 技术 + 音色」配方、120 BPM 配乐、零依赖 CDP/Playwright 逐帧渲染管线、并行渲染、视频/音频质检，以及可直接运行的模板。样片的结构是固定句式：开场 8 秒 → 11 轮 × 4 秒（大字卡 1 秒 + 风格段 3 秒）→ 「还有更多?」卡 1 秒 → 八连闪 2 秒 → 结尾 6 秒，合计 61 秒 / 1830 帧。公式可推广到任意风格数 `N`，30–90 秒的短片都能套用。

**v2 新增**：`timeline.json → plan.json`（唯一真源、精确帧吸附）、`color.js`（OKLCH/OKLab + APCA）、`motion.js`（闭式弹簧 / CJK 避头尾 / 动态字体 / 颗粒 / RGB 分离 / Bloom）、原生 CDP 驱动、`render-farm`（并行 + 重试 + 断点续渲）、平台交付预设、`qa-video` + `qa-audio`、`doctor`、`new-project`、可选 `ai-lane`（默认关闭）。

### 仓库里有什么

- **十阶段工作流**：从需求定稿、剪辑表、环境准备，到逐段实现、配乐、合成与质检（见 `SKILL.md`）。
- **时间结构公式**：总时长 = `O + N·R + 1 + 2 + E`；每段帧数 `round(duration × 30)`，全片合计必须为 1830。
- **大字卡系统**：强调色底 / 米白底 / 黑底居中 / 黑底左对齐 4 套版式；砸入缩放 1.7→1、模糊 16→0 px、0.11 秒 `outExpo`；速度线、径向光晕、6/12 px 抖动、600 px 描边回声字。
- **13 套主题配色**：珊瑚暗夜（默认，与原版逐值一致）、橙光白、水蓝白·莫兰迪、琥珀黑金、蓝图纸、石墨信号、青瓷白、绯墨剧场、赛博霓虹、纸质手账、暗金电影、冰蓝极简、波普酸色。一套主题 = 角色色板 + 材质 + HUD 规格 + 点缀色；后 5 套由 OKLCH 派生并过 WCAG + APCA 审计。数据源 `templates/themes.js`，规范见 `references/themes.md`。
- **11 种风格配方**：每种都给出调色板、构图、6 拍动效表、技术实现要点和专属音色。
- **120 BPM 配乐方案**：A 小调、纯 numpy/scipy 合成；大字卡音乐压到 6% 形成 drop-out，风格段第一帧是六层叠加的「啪」；侧链 55%、2.2 秒混响、`tanh` 软削波、归一化到 −0.6 dBFS。
- **渲染管线与质检**：`timeline.mjs` 生成 plan → Playwright 或系统 Chrome/Edge 原生 CDP →（单 canvas 页用 `toDataURL`，否则 CDP 截图）→ `image2pipe` → libx264 CRF12 中间片（bt709）→ 并行 `render-farm`（重试/续渲）→ concat + 平台预设 CRF + 两遍 loudnorm −14 LUFS → `qa-video` / `qa-audio`（帧数、黑帧、冻结、静音、VMAF、BPM、cue ±30 ms、高频克制、频谱图）。
- **参考样片拆解与原始任务书**：`references/reference-film-analysis.md` 记录实测切点、画面与音频数据；`references/original-brief.txt` 是可改品牌直接复用的完整任务书。

### 预览说明

仓库里**没有**提交成片视频，参考样片文件也不随仓库分发。预览素材是样片拆解图和模板占位实拍帧，图注与说明见上方英文 [Preview](#preview) 一节：`assets/contact-1fps.jpg`（全片 1 fps 接触表）、`style-tiles.jpg`（11 种风格各取一帧）、`card-tiles.jpg`（12 张大字卡）、`audio-spectrogram.png`（音频频谱）、`template-demo-card.jpg`（模板占位实拍）。

主题预览图单独放在 `assets/theme-previews/`：三拼对比 `theme-three-up.jpg`、全集联系表 `theme-contact-sheet.jpg`、单主题 `01-coral-noir.jpg`–`08-crimson-theater.jpg`，见下文 [主题配色](#主题配色)。

### 主题配色

主题不是「换三个颜色」，而是**角色色板（14 个 token）+ 材质 + HUD 规格 + 点缀色**四层一起换。`templates/themes.js` 内置 13 套主题（后 5 套由 OKLCH 派生、WCAG + APCA 审计）；**不传 `?theme=` 时渲染原版 `coral-noir` 画面，逐像素一致**。

| # | id | 名称 | 明暗 | 主材质 | 适合内容 |
|---|---|---|---|---|---|
| 01 | `coral-noir` | 珊瑚暗夜 / Coral Noir | 深色 | 胶片颗粒 | 默认 / 科技发布 / 产品片 |
| 02 | `claude-light` | 橙光白 / Claude Light | 浅色 | 纸面柔光 | 品牌 / 知识 / 访谈 |
| 03 | `aqua-morandi` | 水蓝白·莫兰迪 / Aqua Morandi | 浅色 | 液态玻璃 · 柔光 | 美妆 / 生活方式 / 轻科技 |
| 04 | `amber-noir` | 琥珀黑金 / Amber Noir | 深色 | 金属烫金 | 高端 / 奢品 / 年度片 |
| 05 | `blueprint-stone` | 蓝图纸 / Blueprint Stone | 浅色 | 蓝图网格 | 工程 / 建筑 / 数据 |
| 06 | `graphite-signal` | 石墨信号 / Graphite Signal | 深色 | 哑光工业 | 开发者 / 硬件 / 硬核科技 |
| 07 | `celadon-paper` | 青瓷白 / Celadon Paper | 浅色 | 水墨晕染 | 东方 / 文化 / 极简 |
| 08 | `crimson-theater` | 绯墨剧场 / Crimson Theater | 深色 | 舞台聚光 | 时尚 / 艺术 / 预告 |
| 09 | `cyber-neon` | 赛博霓虹 / Cyber Neon | 深色 | 霓虹辉光 + 网格 | 科技 / 游戏 / 预告 / 直播 |
| 10 | `paper-journal` | 纸质手账 / Paper Journal | 浅色 | 纸面 + 细网格 | 知识 / 教程 / 生活 |
| 11 | `dark-gold-cinema` | 暗金电影 / Dark Gold Cinema | 深色 | 烫金 + 颗粒 | 高端 / 电影感 / 年度片 |
| 12 | `ice-minimal` | 冰蓝极简 / Ice Minimal | 浅色 | 冷白哑光 | SaaS / 数据 / 医疗 |
| 13 | `pop-acid` | 波普酸色 / Pop Acid | 深色 | 光斑 + 颗粒 | 潮流 / 音乐 / 社交 |

![三套主推主题](assets/theme-previews/theme-three-up.jpg)

*三套主推主题对比：珊瑚暗夜（默认）/ 橙光白 / 水蓝白·莫兰迪。*

![主题联系表](assets/theme-previews/theme-contact-sheet.jpg)

*13 套主题联系表。单主题大图：`assets/theme-previews/01-coral-noir.jpg` … `13-pop-acid.jpg`；可用 `node scripts/theme-preview.mjs --root <project>` 重新生成。*

![默认主题静帧](assets/theme-previews/01-coral-noir.jpg)

*`coral-noir` 默认主题，与原版视觉一致。*

选主题用查询参数：两个模板都由 `themeFromURL()` 读取，支持别名（`?theme=aqua`、`?theme=claude`、`?theme=珊瑚`），未知值回退 `coral-noir`：

```bash
# 风格段（相对 --page 保留 ?theme=，渲染器自动追加 seg/t0/speed/dur）
node render-segment.mjs --page /segments/01.html?theme=aqua-morandi --out out/01.mp4 --duration 3

# 大字卡静帧
node render-segment.mjs --page /big-card.html?theme=graphite-signal --still 0.5,1.0 --outdir out/stills
```

主题选择属于「信息采集」，不是渲染参数：先按 `references/intake.md` 收信息（最多 2 轮）、锁定主题、写 `brief.json`，完整规范见 `references/themes.md`。任何配色改动都跑 `node scripts/theme-audit.mjs --strict`——当前 13 套 WCAG 全部通过。用户有真实品牌色时用 `themes.js` 的 `accentOverride(themeRef, input)`，把返回的 `override` 写进 `brief.json`，不要自创第 14 套主题。

### 快速开始

模板是脚手架，不是成片。

```bash
# 0) 环境体检（Node / Chrome / FFmpeg / numpy+scipy / 字体）
node scripts/doctor.mjs

# 1) 脚手架：复制运行时 + 生成 segments/*.html + timeline.json + BRIEF.json
node scripts/new-project.mjs --out ../my-showcase --name my-showcase \
  --theme cyber-neon --styles 11 --fonts
cd ../my-showcase

# 2) 校验时间轴并生成 plan.json / segments.txt
node templates/timeline.mjs --spec timeline.json \
  --out out/plan.json --concat out/segments.txt --print

# 3) 先出静帧（便宜）—— t=0.2/0.8/1.4/2.0/2.6
node templates/render-segment.mjs --page "segments/01.html?theme=cyber-neon" \
  --still 0.2,0.8,1.4,2.0,2.6 --outdir out/stills

# 4) 单段 → 全片并行（--resume 断点续渲）
node templates/render-segment.mjs --page "segments/01.html?theme=cyber-neon" \
  --out out/r01-style.mp4 --duration 3 --t0 0.35 --speed 1.4
node templates/render-farm.mjs --plan out/plan.json --concurrency 4 --resume

# 5) 配乐（--plan 让每个 cue 落在时间轴上；再按 references/audio-recipes.md 精修）
python templates/synth_audio.py --plan out/plan.json --out audio/mix.wav

# 6) 合成 + 平台预设
bash templates/concat-and-encode.sh --platform master out/segments.txt audio/mix.wav out/final.mp4 61 30

# 7) 质检
node scripts/qa-video.mjs out/final.mp4 --plan out/plan.json
python scripts/qa-audio.py audio/mix.wav --plan out/plan.json --strict
node scripts/theme-audit.mjs --strict
```

补充说明：

- **不需要 Playwright**：`render-segment.mjs` 先试 Playwright，失败则用系统 Chrome/Edge 的原生 CDP（`templates/cdp.mjs`）。`CHROME_EXE` 或 `--browser` 可指定浏览器。
- 单 canvas 全屏页面用 `canvas.toDataURL()` 取帧；有 DOM 叠加或 WebGL 读回问题时自动回退 CDP 截图。页面可设 `window.__capture='cdp'` 强制。
- 风格段可传 `--t0 0.35 --speed 1.4`：渲染器自动拼成 `?seg=1&t0=&speed=&dur=`，`common.js` 按 `t = t0 + u*speed` 映射场景时间。
- `timeline.json` 是唯一真源，不要手算 `round(duration×30)`；30 fps 下 0.25 s 闪段会吸附成 8/7/8/7 帧。字段见 `references/timeline-schema.md`。
- 手动预览时起静态服务器：`python -m http.server -d . 4600`，打开 `http://localhost:4600/segments/01.html?theme=cyber-neon`；页面以 ES module 导入，`file://` 打不开。
- `templates/` 的 HTML 引用 `/shared/fonts.css`；`new-project --fonts` 会复制仓库自带字体，否则自行下载 OFL 字体。
- 常用环境变量：`CHROME_EXE` / `FFMPEG_EXE`（渲染器）、`FFMPEG` / `FFPROBE` / `PLATFORM` / `CRF`（合成）、`PYTHON`（音频 QA）。
- `synth_audio.py` 是「音色库 + 8 秒 demo」，完整 61 秒编排按 `references/audio-recipes.md` 扩展 `build_arrangement()`，并读 `plan.json` 的 cues 保证音画同一时间基准。

### 安装为 Agent Skill

整个仓库就是一个技能目录，`SKILL.md` 带 YAML frontmatter（`name`、`description`、`license: MIT`、`compatibility`、`allowed-tools`）。把文件夹复制到对应技能目录即可：DeepSeek Harness 为 `~/.dsh/skills/`，Claude Code 为 `~/.claude/skills/`，通用 SKILL.md 兼容 agent 为 `.agents/skills/`。

安装后，提到「卡点视频」「风格展示视频」「纯代码做视频」「类似 Opus 5.5 / DeepSeek 风格展示」「逐帧渲染」「用代码做视频」「HTML Canvas 视频」「程序化视频」时会自动触发；Agent 会按十阶段工作流执行、复制模板并在本地渲染。

### 环境要求

| 组件 | 要求 | 用途 |
|---|---|---|
| Node.js | ≥ 20（推荐 24；原生 CDP 需要全局 `WebSocket`，即 Node ≥ 22） | 渲染脚本 + 原生 CDP |
| npm 包 | **非必需**；`playwright` / `playwright-core` 可选 | 系统 Chrome/Edge 即可渲染 |
| 浏览器 | Chrome、Edge 或 Chromium（Playwright 自带也支持） | 逐帧截图；WebGL 走 SwiftShader |
| FFmpeg + ffprobe | 含 libx264、AAC、`loudnorm`、`blackdetect`/`freezedetect`/`silencedetect`；`libvmaf` 可选 | 编码、拼接、响度、质检、接触表 |
| Python | ≥ 3.10 + numpy + scipy（matplotlib 可选） | 配乐合成、音频 QA、频谱图 |
| 字体 | 全部 OFL、本地文件 | 中文与展示字体；渲染时不依赖 CDN |

平台要点：Windows 下渲染器先试 Playwright（若装），再走系统 Chrome/Edge 原生 CDP；`CHROME_EXE` / `--browser` 可指定版本。Chrome 的 stderr 写入临时日志、profile 由 detached 进程清理，避免每段进程拖尾。WSL/Linux 下若 Playwright 浏览器下载慢，可直接用 Chrome for Testing + `--browser`（原生 CDP 路径不需要 npm 包）；缺 `libnss3/libnspr4/libasound2` 时可用 `apt-get download` + `dpkg-deb -x` 解到用户目录并设 `LD_LIBRARY_PATH`。`node_modules`、venv、浏览器缓存和临时帧建议放 Linux 文件系统：实测 `/mnt/e` 写 2000 个小文件约 4.9 秒，ext4 约 0.05 秒；逐帧渲染直接管道给 ffmpeg，不落盘。整个过程在本地 CPU 完成，不调用云端服务。

### 11 种风格速查

| # | 风格 | 核心手法 | 关键元素 | 专属音色 |
|---|---|---|---|---|
| 01 | 扁平插画科普 | Canvas 2D 分层圆 / 三角 / 虚线轨道 | 太阳、地球、光束、标签胶囊 | 马林巴 |
| 02 | 数学动画 | Canvas 2D + DFT 本轮 + KaTeX | 金色心形、公式、实时 N/θ | FM 电钢琶音 + 铺底 |
| 03 | 极简发布会 | Canvas 大字 + Three.js `LatheGeometry` | 金属戒指、LED 环、Nova Ring | 逐拍重低音 + 钟声 |
| 04 | 手绘白板 | SVG `stroke-dashoffset` + turbulence | 灯泡 → 代码 → 场记板、红圈 | 尤克里里 + 马克笔摩擦 |
| 05 | 赛博故障 | Canvas 渐变 / 透视网格 + RGB 分离 | 条纹落日、城市、故障切片 | 失真锯齿 16 分 + 四拍底鼓 |
| 06 | 水墨国风 | Canvas fbm 山峦 + 宣纸纹理 | 远山、红日、渔舟、竖排书法 | 古筝五声 + 太鼓 + 笛 |
| 07 | 数据可视化 | Canvas 条形赛跑 + CSS 3D 透视 | 条形图、年份、玻璃卡 | 方波琶音 + 滴答 |
| 08 | 8-bit 像素 | 240×135 低分辨率 + pixelated | 机器人、金币、史莱姆、像素 HUD | 芯片音乐 + 跳跃/金币 |
| 09 | 代码录屏 | Canvas 编辑器 + 逐字代码 | 文件树、行号、实时预览 | lo-fi 电钢 + 黑胶噪声 |
| 10 | Three.js 三维 | `Lathe`/`TorusKnot` + `PhysicalMaterial` | 粘土影棚、玻璃球、金属球 | 钟声琶音 + 弹跳 |
| 11 | 竖屏短视频 | Canvas 手机壳 + 弹出动画 | 9:16、步骤卡、评论/点赞 | 808 + 超级锯齿 + trap 镲 |

每段统一装置：左上角主题化编号胶囊标签（默认主题为珊瑚）、右下 3 秒倒计时、右上淡色品牌水印、1–2 个风格内小标签；不使用底部字幕。

11 个风格段默认保留各自色板；主题通过胶囊/HUD、`cardColors()` 与 `theme.accents` 统一整片气质，而不是把每段重刷一遍——换色规则见 `references/style-recipes.md` 末节。

### 确定性约束

- 画面是 `t` 的纯函数：禁止 CSS `transition`/`animation`、页面内 `requestAnimationFrame`、`Date.now`、`performance.now`、`Math.random`；随机一律用 `mulberry32(seed)`。
- 页面只暴露 `window.DURATION`、`window.renderFrame(t)`、`window.__ready`（可选 `window.__bootError`），由渲染器逐帧驱动，页面自己不做动画循环。
- 字体只用 OFL、本地同源加载；渲染前逐个 `document.fonts.load()`，再等 `document.fonts.ready`。
- 主题只从 `templates/themes.js` 取色（`?theme=` → `chrome(theme)` / `cardColors(theme, layout)` / `drawThemeBackground`），禁止在页面里写死 `#d97757`。
- 模糊、纸纹、噪声等重图层预渲染一次再交叉淡化；避免逐帧 `ctx.filter` 和大面积 `shadowBlur`；镜头变换前缓存坐标。
- 一个 HTML 只做一个片段；画面和音频共用同一份剪辑表时间常数。

### 许可与致谢

以 **MIT License** 发布，详见 [LICENSE](LICENSE)。

- 方法、时间结构与视觉语法来自对一支 61 秒参考样片的逐帧拆解，分析见 `references/reference-film-analysis.md`，证据图在 `assets/`。
- **原始提示词致谢：** 本技能的起点是创作者 **Mixx.ftr** 的提示词；仓库中的模板、主题系统、预览工具、渲染管线与质检是在其基础上独立完成的工程化扩展。
- 驱动整个技能的原始任务书完整保留在 `references/original-brief.txt`，可改品牌直接复用。
- 仓库不包含任何第三方代码或媒体素材；画面在运行时绘制，配乐实时合成。
- 字体不随仓库分发，请自行下载 OFL 字体并在本地提供服务。
- 珊瑚色 `#d97757` 与样片文案是占位示例，正式制作时替换成自己的品牌与脚本。

---

## Star History / Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=Moessif/code-video-showcase&type=Date)](https://www.star-history.com/#Moessif/code-video-showcase&Date)

> Star History 图的生成与嵌入方法参考：[如何拥有漂亮的 GitHub Star History 折线图](https://blog.csdn.net/SoulmateY/article/details/135317109)（CSDN）。
