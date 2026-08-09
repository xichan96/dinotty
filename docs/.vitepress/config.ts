import { defineConfig } from 'vitepress'

const GITHUB = 'https://github.com/xichan96/dinotty'

const zhNav = [
  { text: '使用文档', link: '/zh/introduction' },
  { text: '开发文档', link: '/zh/plugins/plugin-development' },
  { text: 'GitHub', link: GITHUB }
]

const enNav = [
  { text: 'User Docs', link: '/en/introduction' },
  { text: 'Dev Docs', link: '/zh/plugins/plugin-development' },
  { text: 'GitHub', link: GITHUB }
]

const zhSidebar = [
  {
    text: '使用文档',
    items: [
      { text: '介绍', link: '/zh/introduction' },
      { text: '方案对比', link: '/zh/getting-started/comparison' },
      { text: '安装', link: '/zh/installation' },
      { text: '部署指南', link: '/zh/getting-started/deployment' },
      {
        text: '使用指南',
        items: [
          { text: '多端同步与 Mission Control', link: '/zh/guide/multi-device-sync' },
          { text: 'Tab 与分屏管理', link: '/zh/guide/tabs-and-panes' },
          { text: '工作区管理', link: '/zh/guide/workspace' },
          { text: 'SSH 远程与 SFTP', link: '/zh/guide/ssh-sftp' },
          { text: '广播模式', link: '/zh/guide/broadcast' },
          { text: '命令收藏', link: '/zh/guide/command-favorites' },
          { text: '网页预览', link: '/zh/guide/web-preview' },
          { text: '移动键盘与快捷键', link: '/zh/guide/mobile-keyboard' },
          { text: '系统监控', link: '/zh/guide/system-monitor' },
          { text: '外观主题', link: '/zh/guide/appearance' }
        ]
      },
      {
        text: '功能',
        items: [
          { text: '文件编辑器', link: '/zh/features/file-editor' },
          { text: '通知系统', link: '/zh/features/notifications' }
        ]
      },
      {
        text: '插件',
        items: [
          { text: '安装与使用', link: '/zh/plugins/plugins' }
        ]
      },
      { text: 'Roadmap', link: '/zh/roadmap' }
    ]
  },
  {
    text: '开发文档',
    items: [
      { text: '插件开发指南', link: '/zh/plugins/plugin-development' },
      {
        text: 'API',
        items: [
          { text: '总览', link: '/zh/api/' },
          { text: 'Tabs & Panes API', link: '/zh/api/tabs-panes-api' },
          { text: 'Open API（终端读写）', link: '/zh/api/open-api' },
          { text: 'Mission Control API', link: '/zh/api/mission-control-api' },
          { text: 'Clipboard API', link: '/zh/api/clipboard-api' },
          { text: 'MCP Server', link: '/zh/api/mcp-server' }
        ]
      },
      {
        text: '内部机制',
        items: [
          { text: 'Event Bus', link: '/zh/internals/event-bus' },
          { text: 'Token 权限系统', link: '/zh/internals/token-system' },
          { text: '审计与 Webhook', link: '/zh/internals/audit-webhook' }
        ]
      },
      { text: '贡献指南', link: '/zh/getting-started/contributing' },
      { text: '发布指南', link: '/zh/getting-started/releasing' }
    ]
  }
]

const enSidebar = [
  {
    text: 'User Docs',
    items: [
      { text: 'Introduction', link: '/en/introduction' },
      { text: 'Comparison', link: '/en/getting-started/comparison' },
      { text: 'Installation', link: '/en/installation' },
      { text: 'Deployment', link: '/en/getting-started/deployment' },
      {
        text: 'Usage Guide',
        items: [
          { text: 'Multi-device Sync & Mission Control', link: '/en/guide/multi-device-sync' },
          { text: 'Tabs & Panes', link: '/en/guide/tabs-and-panes' },
          { text: 'Workspace Management', link: '/en/guide/workspace' },
          { text: 'SSH & SFTP', link: '/en/guide/ssh-sftp' },
          { text: 'Broadcast Mode', link: '/en/guide/broadcast' },
          { text: 'Command Favorites', link: '/en/guide/command-favorites' },
          { text: 'Web Preview', link: '/en/guide/web-preview' },
          { text: 'Mobile Keyboard & Shortcuts', link: '/en/guide/mobile-keyboard' },
          { text: 'System Monitor', link: '/en/guide/system-monitor' },
          { text: 'Appearance & Themes', link: '/en/guide/appearance' }
        ]
      },
      {
        text: 'Features',
        items: [
          { text: 'File Editor', link: '/en/features/file-editor' },
          { text: 'Notifications', link: '/en/features/notifications' }
        ]
      },
      {
        text: 'Plugins',
        items: [
          { text: 'Install & Use', link: '/en/plugins/plugins' }
        ]
      },
      { text: 'Roadmap', link: '/en/roadmap' }
    ]
  },
  {
    text: 'Dev Docs',
    items: [
      { text: 'Plugin Development Guide (中文)', link: '/zh/plugins/plugin-development' },
      {
        text: 'API',
        items: [
          { text: 'Overview', link: '/en/api/' },
          { text: 'Tabs & Panes API', link: '/en/api/tabs-panes-api' },
          { text: 'Open API (Terminal I/O)', link: '/en/api/open-api' },
          { text: 'Mission Control API', link: '/en/api/mission-control-api' },
          { text: 'Clipboard API', link: '/en/api/clipboard-api' },
          { text: 'MCP Server', link: '/en/api/mcp-server' }
        ]
      },
      {
        text: 'Internals (中文)',
        items: [
          { text: 'Event Bus', link: '/zh/internals/event-bus' },
          { text: 'Token Permission System', link: '/zh/internals/token-system' },
          { text: 'Audit Log & Webhook', link: '/zh/internals/audit-webhook' }
        ]
      },
      { text: 'Contributing Guide', link: '/en/getting-started/contributing' },
      { text: 'Releasing Guide', link: '/en/getting-started/releasing' }
    ]
  }
]

export default defineConfig({
  base: '/dinotty/',
  cleanUrls: true,
  lastUpdated: true,
  title: 'Dinotty',
  description: '为 Coding Agent 场景打造的终端 -- 简洁、可拓展、多端同步，会话永不丢失',

  srcExclude: ['README.*.md', 'README.md'],

  head: [
    ['link', { rel: 'icon', href: '/images/logo.png' }]
  ],

  locales: {
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      themeConfig: {
        nav: zhNav,
        sidebar: zhSidebar,
        outline: { label: '本页目录' },
        docFooter: { prev: '上一页', next: '下一页' },
        lastUpdated: { text: '最后更新' },
        search: { provider: 'local', options: { translations: { button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' } } } }
      }
    },
    en: {
      label: 'English',
      lang: 'en-US',
      themeConfig: {
        nav: enNav,
        sidebar: enSidebar
      }
    }
  },

  themeConfig: {
    logo: '/images/logo.png',
    socialLinks: [{ icon: 'github', link: GITHUB }],
    footer: {
      message: '基于 MIT 许可发布',
      copyright: 'Copyright © 2024-present xichan96'
    },
    search: { provider: 'local' }
  }
})
