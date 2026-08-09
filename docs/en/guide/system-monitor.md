# System Monitor

Dinotty has a built-in system monitor showing real-time CPU, memory, and network metrics for the server. No need to install htop or Activity Monitor separately.

## Opening the Monitor

| Method | Action |
|--------|--------|
| Terminal toolbar | Click the "Monitor" icon in the pane title bar |
| Command Palette | Type `monitor.open` |
| Settings -> Monitor | View long-history data |

Monitor data comes from the server, reflecting the **server host's load**, not the client's.

## Real-time Metrics

| Metric | Description |
|--------|-------------|
| CPU | Overall usage percentage + per-core line chart |
| Memory | Used / total / swap |
| Network | Inbound / outbound throughput (KB/s) |
| Process count | Total server process count |

Refresh defaults to once per second. Adjust the interval in settings (1s / 2s / 5s).

## Historical Data

Below the real-time stats is a 60-second line chart:

- CPU line (red)
- Memory line (green)
- Network line (blue)

Hover for exact values. History is in-memory only, cleared on server restart.

## Monitor Popover

The MonitorPopover at the top of the terminal pane is a lightweight popup:

- Click the "Monitor" icon to pop
- Does not switch panes, overlays the current pane
- Shows the current pane's usage (PTY output volume, child process CPU / memory)

Useful for diagnosing whether an agent is stuck or consuming too much.

## Typical Use Cases

### Diagnosing a stuck agent

Agent stops responding:

1. Open that pane's MonitorPopover
2. Check if PTY output volume is still growing
3. Check if child process CPU is at zero (agent exited / waiting for input)
4. Check if child process memory is spiking (pre-OOM)

### Server load monitoring

For a VPS-deployed server:

1. Open Dinotty remotely
2. Settings -> Monitor for long-history view
3. Spot sustained 90%+ CPU, locate the offending process

### Multi-device shared monitoring

The server has a single source of monitor data; all connected devices see the same view. Mobile can also check server load.

## Notification Integration

Configure threshold alerts in settings:

- CPU > 80% for 30s -> trigger notification
- Memory > 90% -> trigger notification

Notifications push to all devices via the [Notification System](../features/notifications).

## Next Steps

- [Notifications](../features/notifications) - Threshold alerts
- [Multi-device Sync & Mission Control](multi-device-sync) - Multi-device shared data
- [Appearance & Themes](appearance) - Chart colors follow theme
