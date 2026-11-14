# 离线 / 内网部署

> 目标：一台**没有外网**的机器，从发布包到出第一条片，全程不访问 registry / CDN。
> 验证命令：`bash arm.sh --offline`（失败即退出，不静默降级）。

## 0. 发布物清单

发布包 = 仓库 + 以下三件（由发布方在有网机器上生成）：

| 产物 | 生成命令 | 用途 |
|---|---|---|
| `vendor/*.tgz` + `vendor/manifest.json` | `node scripts/vendor.mjs` | npm 依赖离线安装 |
| `dist/fonts-bundle.tar.zst` + `.sha256` | `node scripts/bundle-fonts.mjs` | 1187 个 OFL 字体（≈160 MB） |
| `docker/Dockerfile` | 仓库自带 | 固定 Node/Chrome/FFmpeg/Python 的镜像 |

> 字体与 `vendor/` 都不进 git（体积原因），但必须随 release 附件分发。
> `shared/fonts/` 在 fresh clone 下是空的；缺字体时页面会**静默回退系统字体**，
> 所以 `doctor` 把它当硬失败（容器里可用 `CVS_ALLOW_SYSTEM_FONTS=1` 交给系统 Noto CJK）。

## 1. 有网机器：造发布物

```bash
npm ci --no-audit --no-fund
node scripts/build-fonts.mjs      # -> shared/fonts/ + licenses
node scripts/bundle-fonts.mjs     # -> dist/fonts-bundle.tar.zst + sha256
node scripts/vendor.mjs           # -> vendor/*.tgz + manifest.json
```

把 `vendor/` 与 `dist/fonts-bundle.tar.zst` 一起带进内网。

## 2. 内网机器：装

```bash
# 1) 校验字体包（sha256 必须与发布方一致）
sha256sum -c fonts-bundle.tar.zst.sha256
tar -xf fonts-bundle.tar.zst -C .          # 写出 shared/fonts/
# 2) 依赖（离线）
node --version                              # 必须 >= 22
bash arm.sh --offline
```

`arm.sh --offline` 的内部动作：

```bash
npm cache add vendor/*.tgz --cache vendor/npm-cache
npm ci --offline --no-audit --no-fund --cache vendor/npm-cache
```

任何一步失败都会 `bad` 并让脚本非零退出——**不会**回退到 `npm install`，
因为那会绕过 lockfile、在内网里悄悄改变依赖版本。

## 3. 内网机器：跑

```bash
node scripts/doctor.mjs            # 人读
node scripts/doctor.mjs --json     # 机器读：resolved 绝对路径 + cliVersion
node bin/cvs.mjs build project.spec.json --root . --no-audio   # 无音轨的快速验证
node bin/cvs.mjs build project.spec.json --root . --platform douyin --strict
```

断网后可选/必选矩阵：

| 命令 | 断网结果 | 依据 |
|---|---|---|
| `bash arm.sh --offline` | ✅（有 vendor/） | `npm ci --offline` |
| `node scripts/build-fonts.mjs` | ✅（有 node_modules） | 纯本地复制 |
| `node bin/cvs.mjs lint/plan` | ✅ | 纯 Node，无网络 |
| `node bin/cvs.mjs build --no-audio` | ✅ | 只依赖本机 Chrome/FFmpeg |
| `node bin/cvs.mjs build`（自动配乐） | ✅（有 Python numpy/scipy） | `synth_audio.py` 本地合成 |
| 渲染远程页面 | ❌ 默认禁止 | `E_PAGE_REMOTE`（SSRF 闸门） |

## 4. 容器形态（可选，推荐）

```bash
docker build -f docker/Dockerfile -t cvs:2.3.5 .
docker run --rm -v "$PWD/out:/app/out" cvs:2.3.5 \
  node bin/cvs.mjs build fixtures/mini-41s/spec.json --root . --no-audio
```

镜像把 Node 22 / Chromium / FFmpeg / Python+numpy+scipy 钉在一个 digest 里，
跨机复现时以镜像 digest 为准，而不是「我这台机器能跑」。

## 5. 已知边界

- **字体包 160 MB**：`bundle-fonts.mjs` 打的是全量 woff2。若只需要中文，可在发布机上先裁剪
  `shared/fonts/`（保留 `noto-sans-sc` / `noto-serif-sc`）。
- **Chrome 版本**：跨机逐像素一致要求 Chrome 版本 + 字体集合同时固定；只固定 Node 不够。
- **`vendor/` 只覆盖直接依赖**：`npm ci --offline` 仍需要传递依赖在 cache 里；
  `vendor.mjs` 的 `npm cache add` 只填直接依赖的 tgz。完整离线请用
  `npm ci` 后打包整个 `node_modules`，或直接用容器镜像。
