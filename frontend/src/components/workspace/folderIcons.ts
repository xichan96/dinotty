/**
 * Folder glyphs from vscode-icons (MIT; see LICENSE-vscode-icons.txt next to
 * the SVGs). Icons are 32x32 SVGs rendered through <img>, so their colours are
 * baked in and the tree's foreground/selection tint does not affect them.
 *
 * Lookup is by folder basename, case-insensitively. Unknown folders fall back
 * to the plain folder glyph.
 */
const FOLDER_URLS = import.meta.glob('../../assets/icons/folders/*.svg', {
  eager: true,
  // Separate files rather than data URIs: the glyphs are only fetched when a
  // matching folder is actually visible, and browsers cache them per URL.
  query: '?url&no-inline',
  import: 'default',
}) as Record<string, string>

const URL_BY_ICON: Record<string, string> = {}
for (const [path, url] of Object.entries(FOLDER_URLS)) {
  const file = path.slice(path.lastIndexOf('/') + 1).replace(/\.svg$/, '')
  URL_BY_ICON[file] = url
}

const DEFAULT_ICON = 'default_folder'

/** Folder name → icon asset name (without the `_opened` suffix). */
const ICON_BY_NAME: Record<string, string> = {
  src: 'src',
  source: 'src',
  sources: 'src',
  test: 'test',
  tests: 'test',
  __tests__: 'test',
  spec: 'test',
  specs: 'test',
  e2e: 'test',
  doc: 'docs',
  docs: 'docs',
  documentation: 'docs',
  build: 'dist',
  builds: 'dist',
  dist: 'dist',
  out: 'dist',
  output: 'dist',
  outputs: 'dist',
  target: 'dist',
  targets: 'dist',
  release: 'dist',
  releases: 'dist',
  config: 'config',
  configs: 'config',
  '.config': 'config',
  plugin: 'plugin',
  plugins: 'plugin',
  extension: 'plugin',
  extensions: 'plugin',
  script: 'script',
  scripts: 'script',
  '.claude': 'claude',
  '.pytest_cache': 'pytest',
  '.venv': 'python',
  venv: 'python',
  '.virtualenv': 'python',
  virtualenv: 'python',
  __pycache__: 'python',
  '.tox': 'python',
  '.git': 'git',
  '.github': 'github',
  node_modules: 'node',
  asset: 'asset',
  assets: 'asset',
  image: 'asset',
  images: 'asset',
  img: 'asset',
  media: 'asset',
  component: 'component',
  components: 'component',
  widget: 'component',
  widgets: 'component',
  api: 'api',
  apis: 'api',
  app: 'app',
  apps: 'app',
  hook: 'hook',
  hooks: 'hook',
  coverage: 'coverage',
  public: 'public',
  style: 'style',
  styles: 'style',
  css: 'style',
  scss: 'style',
  locale: 'locale',
  locales: 'locale',
  i18n: 'locale',
}

export function folderIconKey(name: string): string {
  return ICON_BY_NAME[name.toLowerCase()] ?? DEFAULT_ICON
}

/** Bundled URL for a folder row; expanded folders use the open-tab variant. */
export function folderIconUrl(name: string, expanded: boolean): string {
  const key = folderIconKey(name)
  const open = `${key}_opened`
  return (
    URL_BY_ICON[expanded ? open : key] ??
    URL_BY_ICON[key] ??
    URL_BY_ICON[open] ??
    URL_BY_ICON[DEFAULT_ICON]
  )
}
