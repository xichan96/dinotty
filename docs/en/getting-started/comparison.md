# Comparison with Other Solutions

How Dinotty compares to common web terminals and AI coding remote solutions.

## Comparison with Other Terminals

| Capability | Dinotty | ttyd | gotty | Wetty |
|---|---|---|---|---|
| Server-side virtual terminal (VT Screen) | ✅ | ❌ | ❌ | ❌ |
| Session survives network disconnect | ✅ | ❌ | ❌ | ❌ |
| Refresh page = restore session | ✅ | ❌ | ❌ | ❌ |
| Built-in file browser & preview | ✅ | ❌ | ❌ | ❌ |
| Git change indicators | ✅ | ❌ | ❌ | ❌ |
| Built-in web preview (reverse proxy) | ✅ | ❌ | ❌ | ❌ |
| Customizable shortcut keyboard | ✅ | ❌ | ❌ | ❌ |
| Broadcast mode | ✅ | ❌ | ❌ | ❌ |
| Command bookmarks | ✅ | ❌ | ❌ | ❌ |
| Plugin system | ✅ | ❌ | ❌ | ❌ |
| Workspace management | ✅ | ❌ | ❌ | ❌ |
| SSH remote + SFTP | ✅ | ❌ | ❌ | ❌ |
| Cookie Session + Token auth | ✅ | ✅ | ❌ | ✅ |

Other web terminals are thin WebSocket-to-PTY pipes. Dinotty runs a **full virtual terminal emulator on the server**, enabling session recovery and screen snapshots. Combined with the built-in file/web browser, it provides a self-contained environment where coding agents work and users verify results.

## AI Coding Solutions Comparison

| | Dinotty | Claude Code Remote | Codex Web | Happy | hapi | Termius | tmux |
|---|---|---|---|---|---|---|---|
| Positioning | Web terminal server | Built-in multi-device | Cloud agent | AI Agent remote client | AI Agent remote client | SSH client | Terminal multiplexer |
| Approach | Server-side VTE + Web UI | Anthropic cloud + local | OpenAI cloud | CLI proxy wrapper | CLI proxy wrapper | Native app | Server-side process |
| Web access | ✅ | ✅ claude.ai/code | ✅ chatgpt.com/codex | ✅ | ✅ PWA | ❌ | ❌ |
| Native app | Tauri (macOS/Linux/Windows) | iOS + Android | ❌ | iOS + Android | ❌ (PWA) | All platforms | ❌ |
| General terminal | ✅ Local + SSH | ❌ AI agents only | ❌ AI agents only | ❌ AI agents only | ❌ AI agents only | ✅ SSH | ✅ |
| Coding agent support | ✅ File browser/preview/notify | ✅ Built-in | ✅ Built-in | ✅ Voice/approve | ✅ Voice/workspace | ❌ | ❌ |
| Split screen | ✅ Native drag | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ tmux commands |
| Broadcast mode | ✅ Free | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Command bookmarks | ✅ Free | ❌ | ❌ | ❌ | ❌ | 💰 Paid | ❌ |
| Plugin system | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Workspace management | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Multi-device sync | ✅ Browser-based | ✅ Cross-device session sync | ✅ Cloud sessions | ✅ | ✅ | ✅ Vault | ❌ Requires SSH |
| Relay service | Planned | ✅ Anthropic hosted | ✅ OpenAI hosted | ✅ | ✅ | SaaS | ❌ |
| Deployment | Self-hosted | SaaS | SaaS | Relay service | Self-hosted/relay | SaaS | Self-hosted |
| Code runs on | Your own server | Local / Anthropic cloud | OpenAI cloud | Local | Local | Remote SSH | Remote server |
| Price | 🆓 Free & open source | 💰 Pro subscription | 💰 Plus subscription | Relay service | Self-hosted/relay | 💰 $10/mo | 🆓 but painful |

Claude Code and Codex each offer built-in remote solutions, but are limited to their own agent ecosystem. Happy and hapi are third-party remote control layers that wrap CLI tools for phone-based approval and voice interaction. Dinotty is a general-purpose web terminal server where agents run natively on the server, with a full working environment including file browser, web preview, and plugin system, delivering a professional experience on both desktop and mobile.
