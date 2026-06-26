# ============================================================
# Dinotty 多阶段构建 Dockerfile
#   阶段 1: 构建前端 (node)
#   阶段 2: 编译 Rust 二进制 (rust + musl)
#   阶段 3: 最小运行时 (alpine + tini)
# ============================================================

# --- 阶段 1: 前端构建 ---
FROM node:22-alpine AS frontend

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# 缓存依赖层
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml frontend/
RUN cd frontend && pnpm install --frozen-lockfile

# 构建前端
COPY frontend/ frontend/
RUN cd frontend && pnpm build

# --- 阶段 2: Rust 编译 ---
FROM rust:1-alpine AS builder

RUN apk add --no-cache musl-dev

WORKDIR /app

# 缓存 Cargo 依赖（写空源码触发依赖编译）
COPY Cargo.toml Cargo.lock build.rs ./
RUN mkdir -p src && \
    echo 'fn main() {}' > src/main.rs && \
    echo '' > src/lib.rs && \
    cargo build --release -p dinotty-server 2>/dev/null || true && \
    rm -rf src

# 复制实际源码和前端产物
COPY src/ src/
COPY src-tauri/ src-tauri/ 
COPY build.rs ./
COPY --from=frontend /app/frontend/dist/ frontend/dist/

# 重新编译（依赖已缓存）
RUN touch src/main.rs src/lib.rs && \
    cargo build --release -p dinotty-server && \
    strip target/release/dinotty-server

# --- 阶段 3: 运行时 ---
FROM alpine:3.21 AS runtime

# PTY 和终端依赖
RUN apk add --no-cache \
    bash \
    zsh \
    coreutils \
    ca-certificates \
    tini \
    curl

# 创建非 root 用户
RUN adduser -D -s /bin/bash -h /home/dinotty dinotty

WORKDIR /home/dinotty

# 复制二进制和入口脚本
COPY --from=builder /app/target/release/dinotty-server /usr/local/bin/dinotty-server
COPY deploy/docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# 插件和数据目录
RUN mkdir -p /home/dinotty/.dinotty/plugins && \
    chown -R dinotty:dinotty /home/dinotty

USER dinotty

ENV DINOTTY_PORT=8999
ENV RUST_LOG=info

EXPOSE 8999

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["dinotty-server"]
