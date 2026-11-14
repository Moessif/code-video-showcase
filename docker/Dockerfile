# code-video-showcase — pinned render image
#
# 为什么固定：README 说「same spec, same bytes on any machine」，但跨机确定性
# 实际绑定 Node / Chrome / FFmpeg / 字体版本。这个镜像把这些钉死。
#
#   docker build -f docker/Dockerfile -t cvs:2.3.5 .
#   docker run --rm -v "$PWD/out:/app/out" cvs:2.3.5 \
#     node bin/cvs.mjs build fixtures/mini-41s/spec.json --root . --no-audio
#
# Chrome 用 Debian 的 chromium（版本随镜像 digest 固定）；字体用 fonts-noto-cjk，
# 与 shared/fonts 的自托管字体二选一——容器内优先系统字体，避免 160MB 复制。
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      chromium \
      python3 \
      python3-numpy \
      python3-scipy \
      fonts-noto-cjk \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_EXE=/usr/bin/chromium
# 容器里以 root 运行 Chromium，必须关渲染沙箱（这是显式、可审计的开关）。
ENV CVS_NO_SANDBOX=1
ENV PYTHON=python3
ENV FFMPEG=ffmpeg
ENV FFPROBE=ffprobe
# 容器内没有自托管字体时，doctor 不应把 shared/fonts 缺失当硬失败；
# 页面会回退到系统 Noto CJK。
ENV CVS_ALLOW_SYSTEM_FONTS=1

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .

# 构建时自检（失败会让镜像构建失败，这正是我们想要的）
RUN node scripts/doctor.mjs --json > /tmp/doctor.json || (cat /tmp/doctor.json && exit 1)

CMD ["node", "bin/cvs.mjs", "--help"]
