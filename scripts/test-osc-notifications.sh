#!/usr/bin/env bash
# OSC 9/777/BEL 终端通知检测 - 端到端手动验证脚本
#
# 用法：在 dinotty 的终端 pane 里执行（不是本地 Terminal！）：
#   bash scripts/test-osc-notifications.sh
#
# 每个用例会打印标题、发送转义序列、等待观察。
# 涉及 bell 的用例之间间隔 >2s（检测端 bell 的 debounce 窗口按 pane 计）。
#
# ⚠️ 弹窗抑制规则（设计行为，不是 bug）：
#   - 通知来源 pane 是聚焦 pane 且应用在前台 -> 不弹 toast
#   - 「当前标签页不弹窗」（ignore_current_tab，默认开启）-> 当前 tab 内任何 pane 都不弹
#   因此在发出序列的同一 tab 里盯着看，toast 不会出现；通知仍会进入铃铛面板历史。
#   验证 toast 的正确姿势：sleep 3; printf '\e]9;hello\a'，3 秒内切到其他 tab。
#
# 前置条件：
#   - dinotty 后端为包含 OSC 检测的版本（notification.osc_notify 默认开启）
#   - 观察方式：铃铛面板的通知历史（始终累积），或按上述方式从后台 tab 触发

set -u

PASS_MS=2500   # 略大于 2s debounce 窗口，避免相邻用例互相干扰

hr() { printf '\n\033[90m────────────────────────────────────────────────\033[0m\n'; }

# announce <编号> <标题> <期望结果>
announce() {
    hr
    printf '\033[1;36m[%s] %s\033[0m\n' "$1" "$2"
    printf '\033[90m期望：%s\033[0m\n' "$3"
}

wait_next() {
    printf '\033[90m（观察 toast 后按回车继续）\033[0m '
    read -r _
}

# ── 正向用例 ────────────────────────────────────────────────

announce 1 "OSC 9 带消息" "1 条 info 通知，正文 = 「任务完成」"
printf '\e]9;任务完成\a'
wait_next

announce 2 "OSC 9 消息含分号" "1 条通知，正文 = 「part one;part two」（分号重组）"
printf '\e]9;part one;part two\a'
wait_next

announce 3 "OSC 777 标准 notifysend" "1 条通知，标题 = 构建 完成，正文 = 所有测试通过"
printf '\e]777;notifysend;构建完成;所有测试通过\a'
wait_next

announce 4 "OSC 777 notify 前缀变体" "1 条通知，无标题，正文 = 只有正文"
printf '\e]777;notify;只有正文\a'
wait_next

announce 5 "OSC 9 ST 终止符" "1 条通知，正文 = via ST"
printf '\e]9;via ST\e\\'
wait_next

# ── 负向用例（terminal-announce，不应触发通知）──────────────

announce 6 "OSC 9 progress / cwd announce" "无任何通知"
printf '\e]9;4;50\a'
printf '\e]9;9;"/tmp"\a'
printf '\e]9;4\a'
printf '\e]9;9\a'
wait_next

announce 7 "OSC 777 非 notifysend token" "无任何通知"
printf '\e]777;progress;50\a'
printf '\e]777;settabicon;Title\a'
wait_next

# ── 限流用例 ────────────────────────────────────────────────

announce 8 "同内容 debounce" "只有 1 条通知（第 2 条在 2s 窗口内被去重）"
printf '\e]9;same message\a'
printf '\e]9;same message\a'
wait_next

announce 9 "不同内容放行" "2 条通知（权限请求 + turn 完成）"
printf '\e]9;permission needed\a'
printf '\e]9;turn complete\a'
wait_next

# ── BEL 用例（bell 的 debounce 键按 pane 计，用例间已隔 2.5s+）──

announce 10 "裸 BEL" "1 条 bell 通知"
printf '\a'
wait_next

announce 11 "OSC 9 空消息视为 bell" "1 条 bell 通知"
printf '\e]9;\a'
wait_next

announce 12 "BEL 洪水封顶" "只有 1 条 bell 通知（50 个 0x07 被 2s 窗口压成 1 次）"
for _ in $(seq 1 50); do printf '\a'; done
wait_next

# ── 截断与编码 ─────────────────────────────────────────────

announce 13 "超长消息截断" "1 条通知，正文被截断（约 1KB，尾部无乱码）"
printf '\e]9;%s\a' "$(head -c 4096 /dev/zero | tr '\0' 'a')"
wait_next

announce 14 "中文消息往返" "1 条通知，正文 = 你好，世界（无乱码）"
printf '\e]9;你好，世界\a'
wait_next

# ── 收尾提示 ────────────────────────────────────────────────

hr
printf '\033[1;32m全部用例发送完毕。\033[0m\n'
TIPS='补充验证（脚本覆盖不了）：
  1. 后台 tab：sleep 3; printf '\''\e]9;hello\a'\''，3 秒内切到其他 tab，toast 应弹出且原 tab 有未读标记
  2. 开关：设置面板关闭「OSC 通知」后重跑用例 1，应无通知；重新打开后恢复
  3. Claude Code：某 tab 跑长任务（不配 hook），切到别的 tab，任务完成/权限请求应自动通知
  4. debounce 配置：/api/settings 里 osc_notify_debounce_ms 默认 2000
  5. 当前 tab 不弹窗是设计行为（ignore_current_tab），通知历史仍可在铃铛面板查看'
printf '%s\n' "$TIPS"
