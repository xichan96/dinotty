import type { Component } from 'vue'
import BuiltinKeyboardInfo from '../components/settings/BuiltinKeyboardInfo.vue'

/**
 * 宿主为随 app 分发的内置插件贡献的整页视图。
 * builtin-keyboard 不导出 component（键盘设置属于应用级设置，统一放在
 * 设置 → 键盘），因此 PluginView 在插件无 exports.component 时回退到
 * 宿主的信息卡视图，提供「去设置 → 键盘配置」跳转入口。
 */
export const HOST_PLUGIN_VIEWS: Record<string, Component> = {
  'builtin-keyboard': BuiltinKeyboardInfo,
}

export function hasHostPluginView(pluginId: string): boolean {
  return pluginId in HOST_PLUGIN_VIEWS
}
