import { defineConfig } from 'vitepress'

const GITHUB = 'https://github.com/xichan96/dinotty'

const zhNav = [
  { text: '入门', link: '/zh/getting-started/deployment' },
  { text: '功能', link: '/zh/features/file-editor' },
  { text: '插件', link: '/zh/plugins/plugins' },
  { text: 'API', link: '/zh/api/agent-api' },
  { text: '内部', link: '/zh/internals/event-bus' }
]

const enNav = [
  { text: 'Getting Started', link: '/en/getting-started/deployment' },
  { text: 'Features', link: '/en/features/file-editor' },
  { text: 'Plugins', link: '/en/plugins/plugins' }
]

const zhSidebar = [
  {
    text: '开始',
    items: [
      { text: '介绍', link: '/zh/introduction' },
      { text: '方案对比', link: '/zh/getting-started/comparison' },
      { text: '部署指南', link: '/zh/getting-started/deployment' },
      { text: '发布指南', link: '/zh/getting-started/releasing' },
      { text: '贡献指南', link: '/zh/getting-started/contributing' }
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
      { text: '插件系统', link: '/zh/plugins/plugins' },
      { text: '插件开发指南', link: '/zh/plugins/plugin-development' }
    ]
  },
  {
    text: 'API',
    items: [
      { text: 'Agent API', link: '/zh/api/agent-api' },
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
  }
]

const enSidebar = [
  {
    text: 'Getting Started',
    items: [
      { text: 'Introduction', link: '/en/introduction' },
      { text: 'Comparison', link: '/en/getting-started/comparison' },
      { text: 'Deployment', link: '/en/getting-started/deployment' },
      { text: 'Releasing', link: '/en/getting-started/releasing' },
      { text: 'Contributing', link: '/en/getting-started/contributing' }
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
      { text: 'Plugin System', link: '/en/plugins/plugins' }
    ]
  },
  {
    text: '更多文档',
    items: [
      {
        text: 'API · Internals · Plugin Dev (中文)',
        link: '/zh/api/agent-api'
      }
    ]
  }
]

export default defineConfig({
  base: '/dinotty/',
  cleanUrls: true,
  lastUpdated: true,
  title: 'Dinotty',
  description: '为 Coding Agent 打造的多端同步终端服务器',

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
