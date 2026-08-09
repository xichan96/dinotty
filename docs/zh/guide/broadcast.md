# 广播模式

广播模式（Broadcast）让一个 pane 的输入同步发送到当前 Tab 的所有 pane。适合在多台服务器上同时执行相同命令。

## 启用广播

| 方式 | 操作 |
|------|------|
| 工具栏按钮 | 点击 pane 标题栏右侧的「广播」图标 |
| Command Palette | 输入 `broadcast.toggle` |
| 快捷键 | `Cmd + Shift + B` |

启用后，当前 pane 标题栏显示**红色徽章**，表示输入会广播。

## 输入同步

广播模式下，在源 pane 输入的每个字节都会同时发送到当前 Tab 的所有终端 pane：

- **键盘输入**：字符、回车、Ctrl+C、Tab 补全等
- **粘贴**：长内容会同步粘贴到所有 pane
- **快捷键**：`Ctrl + C` 会同时中断所有 pane 的当前进程

::: warning 不广播的内容
- pane 的尺寸调整（resize）只作用于当前 pane
- 文件编辑器 pane 不参与广播（只有终端 pane 才广播）
- 网页预览、插件 pane 不参与广播
:::

## 典型用法

### 多服务器批量操作

1. 在 Tab 中分屏 4 个终端 pane，分别 SSH 到 4 台服务器
2. 启用广播
3. 输入 `sudo apt update && sudo apt upgrade -y`
4. 4 台服务器同时执行升级

### 集群部署验证

1. 分屏连接到集群各节点
2. 启用广播
3. 输入 `kubectl get pods -A` 或 `docker ps`
4. 对比各节点输出是否一致

### 故障演练

1. 多 pane 连接到主备两台机器
2. 广播输入故障命令（如 `systemctl stop nginx`）
3. 观察主备切换行为

## 关闭广播

再次点击「广播」按钮或快捷键 `Cmd + Shift + B` 关闭。关闭后输入只作用于当前 pane。

::: tip 自动关闭
切换 Tab 时广播会自动关闭，避免误操作。回到原 Tab 需重新启用。
:::

## 跨工作区限制

广播是 Tab 级别的--只影响当前 Tab 内的 pane，不会跨 Tab 广播。如果需要在多个工作区同步执行，需要分别启用广播。

## 下一步

- [命令收藏](command-favorites) - 把常用命令存起来一键执行（不广播，但可在每个 pane 重复点击）
- [Tab 与分屏管理](tabs-and-panes) - 分屏多 pane 布局
- [SSH 远程与 SFTP](ssh-sftp) - 多服务器连接
