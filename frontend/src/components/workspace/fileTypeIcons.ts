/**
 * File-type glyphs rendered by the bundled Seti icon font.
 *
 * Seti UI (https://github.com/jesseweed/seti-ui) is MIT licensed; the font
 * ships as assets/fonts/seti.woff with its license next to it. Codepoints and
 * colors mirror the `vs-seti-icon-theme` extension bundled with VS Code,
 * trimmed to the file types this tree is likely to show.
 */
export interface FileTypeGlyph {
  /** Private-use codepoint rendered by the seti font. */
  char: string
  color: string
}

const DEFAULT_GLYPH: FileTypeGlyph = { char: '\uE023', color: '#d4d7d6' }

/** Exact names win over extensions, matching VS Code's lookup order. */
const BY_NAME: Record<string, FileTypeGlyph> = {
  readme: { char: '\uE04D', color: '#519aba' },
  'readme.md': { char: '\uE04D', color: '#519aba' },
  'readme.txt': { char: '\uE04D', color: '#519aba' },
  'readme.rst': { char: '\uE04D', color: '#519aba' },
  license: { char: '\uE05A', color: '#cbcb41' },
  'license.md': { char: '\uE05A', color: '#cbcb41' },
  'license.txt': { char: '\uE05A', color: '#cbcb41' },
  '.gitignore': { char: '\uE034', color: '#41535b' },
  '.gitattributes': { char: '\uE034', color: '#41535b' },
  '.gitmodules': { char: '\uE034', color: '#41535b' },
  makefile: { char: '\uE05F', color: '#e37933' },
  gnumakefile: { char: '\uE05F', color: '#e37933' },
  dockerfile: { char: '\uE025', color: '#519aba' },
  containerfile: { char: '\uE025', color: '#519aba' },
  'yarn.lock': { char: '\uE0A6', color: '#519aba' },
  'package-lock.json': { char: '\uE067', color: '#41535b' },
  'tsconfig.json': { char: '\uE097', color: '#519aba' },
  'jsconfig.json': { char: '\uE097', color: '#519aba' },
  changelog: { char: '\uE012', color: '#519aba' },
  'changelog.md': { char: '\uE012', color: '#519aba' },
  '.env': { char: '\uE019', color: '#6d8086' },
  '.env.local': { char: '\uE019', color: '#6d8086' },
  '.env.development': { char: '\uE019', color: '#6d8086' },
  '.env.production': { char: '\uE019', color: '#6d8086' },
}

const BY_EXT: Record<string, FileTypeGlyph> = {
  ts: { char: '\uE099', color: '#519aba' },
  tsx: { char: '\uE099', color: '#519aba' },
  js: { char: '\uE051', color: '#cbcb41' },
  jsx: { char: '\uE051', color: '#cbcb41' },
  mjs: { char: '\uE051', color: '#cbcb41' },
  cjs: { char: '\uE051', color: '#cbcb41' },
  vue: { char: '\uE09D', color: '#8dc149' },
  rs: { char: '\uE082', color: '#6d8086' },
  go: { char: '\uE03A', color: '#519aba' },
  py: { char: '\uE07B', color: '#519aba' },
  pyi: { char: '\uE07B', color: '#519aba' },
  java: { char: '\uE050', color: '#cc3e44' },
  kt: { char: '\uE058', color: '#e37933' },
  kts: { char: '\uE058', color: '#e37933' },
  c: { char: '\uE00C', color: '#519aba' },
  h: { char: '\uE00C', color: '#a074c4' },
  cc: { char: '\uE01A', color: '#519aba' },
  cpp: { char: '\uE01A', color: '#519aba' },
  cxx: { char: '\uE01A', color: '#519aba' },
  hpp: { char: '\uE01A', color: '#a074c4' },
  hxx: { char: '\uE01A', color: '#a074c4' },
  cs: { char: '\uE00B', color: '#519aba' },
  php: { char: '\uE070', color: '#a074c4' },
  rb: { char: '\uE081', color: '#cc3e44' },
  swift: { char: '\uE092', color: '#e37933' },
  lua: { char: '\uE05E', color: '#519aba' },
  sql: { char: '\uE022', color: '#f55385' },
  sh: { char: '\uE089', color: '#8dc149' },
  bash: { char: '\uE089', color: '#8dc149' },
  zsh: { char: '\uE089', color: '#8dc149' },
  fish: { char: '\uE089', color: '#8dc149' },
  html: { char: '\uE048', color: '#e37933' },
  htm: { char: '\uE048', color: '#e37933' },
  xml: { char: '\uE0A5', color: '#e37933' },
  css: { char: '\uE01D', color: '#519aba' },
  scss: { char: '\uE01D', color: '#519aba' },
  less: { char: '\uE01D', color: '#519aba' },
  sass: { char: '\uE084', color: '#f55385' },
  svg: { char: '\uE091', color: '#a074c4' },
  json: { char: '\uE055', color: '#cbcb41' },
  jsonc: { char: '\uE055', color: '#cbcb41' },
  json5: { char: '\uE055', color: '#cbcb41' },
  yml: { char: '\uE0A7', color: '#a074c4' },
  yaml: { char: '\uE0A7', color: '#a074c4' },
  toml: { char: '\uE019', color: '#6d8086' },
  ini: { char: '\uE019', color: '#6d8086' },
  conf: { char: '\uE019', color: '#6d8086' },
  properties: { char: '\uE019', color: '#6d8086' },
  csv: { char: '\uE01E', color: '#8dc149' },
  md: { char: '\uE060', color: '#519aba' },
  mdx: { char: '\uE060', color: '#519aba' },
  txt: { char: '\uE023', color: '#d4d7d6' },
  rst: { char: '\uE023', color: '#d4d7d6' },
  log: { char: '\uE023', color: '#d4d7d6' },
  pdf: { char: '\uE06D', color: '#cc3e44' },
  png: { char: '\uE04C', color: '#a074c4' },
  jpg: { char: '\uE04C', color: '#a074c4' },
  jpeg: { char: '\uE04C', color: '#a074c4' },
  gif: { char: '\uE04C', color: '#a074c4' },
  webp: { char: '\uE04C', color: '#a074c4' },
  bmp: { char: '\uE04C', color: '#a074c4' },
  ico: { char: '\uE02F', color: '#cbcb41' },
  zip: { char: '\uE0A9', color: '#6d8086' },
  tar: { char: '\uE0A9', color: '#6d8086' },
  gz: { char: '\uE0A9', color: '#6d8086' },
  bz2: { char: '\uE0A9', color: '#6d8086' },
  xz: { char: '\uE0A9', color: '#6d8086' },
  '7z': { char: '\uE0A9', color: '#6d8086' },
  rar: { char: '\uE0A9', color: '#6d8086' },
  lock: { char: '\uE05D', color: '#8dc149' },
}

export function fileTypeGlyph(name: string): FileTypeGlyph {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'))
  const base = name.slice(slash + 1).toLowerCase()
  const named = BY_NAME[base]
  if (named) return named
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return DEFAULT_GLYPH
  return BY_EXT[base.slice(dot + 1)] ?? DEFAULT_GLYPH
}
