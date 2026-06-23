#!/bin/bash

# 在远程服务器构建 dpkg 包
set -e

SERVER="dinotty-server"
REMOTE_DIR="~/dinotty"

echo "=== 1. 安装 Rust ==="
ssh $SERVER "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"
ssh $SERVER "source ~/.cargo/env && rustc --version"

echo "=== 2. 安装构建依赖 ==="
ssh $SERVER "sudo apt-get update && sudo apt-get install -y build-essential pkg-config libssl-dev"

echo "=== 3. 克隆代码 ==="
ssh $SERVER "rm -rf $REMOTE_DIR && git clone https://github.com/xichan96/dinotty.git $REMOTE_DIR" 2>/dev/null || \
ssh $SERVER "rm -rf $REMOTE_DIR && git clone git@github.com:xichan96/dinotty.git $REMOTE_DIR" 2>/dev/null || \
{
    echo "需要手动上传代码或配置 git 访问"
    exit 1
}

echo "=== 4. 安装 cargo-deb ==="
ssh $SERVER "source ~/.cargo/env && cargo install cargo-deb"

echo "=== 5. 构建 dpkg ==="
ssh $SERVER "source ~/.cargo/env && cd $REMOTE_DIR && cargo deb --release"

echo "=== 6. 获取构建产物 ==="
scp $SERVER:$REMOTE_DIR/target/debian/*.deb ./

echo "=== 完成 ==="
ls -lh *.deb
