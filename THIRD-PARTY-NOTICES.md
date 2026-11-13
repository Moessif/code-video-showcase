# Third-Party Notices · code-video-showcase

本仓库的分发物包含以下第三方字体（Silkscreen 等可选组件除外）。字体本身不进入 git，
由 `node scripts/build-fonts.mjs` 生成到 `shared/fonts/`，许可文本复制到
`shared/fonts/licenses/`。

## Fonts

| 字族 | npm 包 | 许可 |
|---|---|---|
| Noto Sans SC | `@fontsource/noto-sans-sc` | SIL Open Font License 1.1 |
| Noto Serif SC | `@fontsource/noto-serif-sc` | SIL Open Font License 1.1 |
| ZCOOL KuaiLe | `@fontsource/zcool-kuaile` | SIL Open Font License 1.1 |
| JetBrains Mono | `@fontsource/jetbrains-mono` | SIL Open Font License 1.1 |
| Inter | `@fontsource/inter` | SIL Open Font License 1.1 |
| Playfair Display | `@fontsource/playfair-display` | SIL Open Font License 1.1 |
| Orbitron | `@fontsource/orbitron` | SIL Open Font License 1.1 |

分发要求（OFL 1.1）：

1. 随字体二进制附带 OFL 文本与版权行（`shared/fonts/licenses/*.txt`）。
2. 若修改字体文件，不得使用其 Reserved Font Name。
3. 若将字体嵌入成片再分发，OFL 允许；但字体文件本身再分发时仍需带许可。

> 本文件不能替代各字体包内的完整 OFL 文本；以 `shared/fonts/licenses/` 为准。

## Runtime

- FFmpeg（LGPL/GPL，取决于构建）：仅作为外部可执行文件调用，不随仓库分发。
- Chrome / Chromium / Edge：仅作为外部浏览器调用，不随仓库分发。
- Python 3 + numpy/scipy：仅用于配乐合成与音频质检，不随仓库分发。
