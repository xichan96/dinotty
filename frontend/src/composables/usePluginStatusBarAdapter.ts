import { h, type Component } from 'vue'
import {
  Activity,
  Cpu,
  MemoryStick,
  HardDrive,
  Wifi,
  Gpu,
  Gauge,
  Cloud,
  Server,
  Database,
  Zap,
  Clock,
} from 'lucide-vue-next'
import type { RegisteredSeries } from '../stores/pluginMonitor'
import type { StatusBarItem } from '../stores/statusBarItems'

const DEFAULT_ICON = 'Activity'

// Map of supported icon names to lucide-vue-next components. Plugins specify
// the name as a string; we resolve here so plugin code can't reach into the
// lucide package directly. Keep this list curated - adding a name here exposes
// it to plugin authors as a documented icon.
const ICON_MAP: Record<string, Component> = {
  Activity,
  Cpu,
  MemoryStick,
  HardDrive,
  Wifi,
  Gpu,
  Gauge,
  Cloud,
  Server,
  Database,
  Zap,
  Clock,
}

function resolveIcon(name?: string): Component {
  if (!name) return Activity
  return ICON_MAP[name] ?? Activity
}

/**
 * Adapt a plugin MonitorSeries to a StatusBarItem for status bar rendering.
 * The series' `statusText()` is called on each render; null result renders nothing
 * (the item is filtered upstream before reaching the renderer in that case).
 */
export function pluginSeriesToStatusBarItem(
  s: RegisteredSeries,
  onClick: (event: MouseEvent) => void
): StatusBarItem {
  const icon = resolveIcon(s.statusIcon ?? DEFAULT_ICON)
  return {
    id: s.id,
    position: 'right',
    priority: 200,
    tooltip: s.label,
    onClick,
    defaultVisible: s.defaultVisible,
    visible: s.visible,
    render: () => {
      const text = s.statusText?.()
      if (text == null) return null
      return h('span', { class: 'metric-content' }, [
        h(icon, { size: 14 }),
        h('span', { class: 'metric-value' }, text),
      ])
    },
  }
}
