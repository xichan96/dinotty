# 文件大纲面板设计

> 状态：设计稿 + 可交互原型，未开工  
> 更新时间：2026-11-02  
> 范围：文件预览 / 编辑器（桌面端与移动端）  
> 关联 issue：[#329](https://github.com/xichan96/dinotty/issues/329)、[#330](https://github.com/xichan96/dinotty/issues/330)、[#292](https://github.com/xichan96/dinotty/issues/292)  
> 原型：[`docs/public/prototypes/outline-panel.html`](/prototypes/outline-panel.html)

## 1. 背景与目标

长 Markdown、Agent 生成的设计文档、大代码文件和结构化配置，目前只能靠滚动条定位。预览区已经有文件树、搜索和面包屑，但缺少“当前文件内部结构”这一层。

本设计增加**文件大纲（Outline）**：按文件类型展示标题、代码符号或 key 树，点击跳转，滚动时高亮当前章节。

目标：

1. Markdown 标题层级（预览模式与源码模式都支持）。
2. 代码符号（Monaco provider 优先，正则回退）。
3. JSON / YAML / TOML 的 key 树。
4. 过滤、折叠、默认展开层级、scroll spy、点击跳转。
5. 桌面上是**覆盖式右侧面板**，不挤压正文；移动端退化为底部抽屉 + 浮动按钮。
6. 空状态明确：无标题 / 无符号 / 解析失败。

非目标（第一版）：

- 从大纲编辑结构；
- PDF 书签、Office 标题（等 pdf.js / 统一文档模型）；
- 多文件符号索引、全局大纲；
- 大纲内的拖拽排序。

---

## 2. 产品形态

### 2.1 桌面：覆盖式右侧面板

```text
┌ tabs ──────────────────────────────────────┐
│ breadcrumbs                                │
│ [Preview]                     [outline] Save│
├──────────┬────────────────────────┬────────┤
│ explorer │  preview（宽度不变）    │ 大纲   │
│          │  …被面板覆盖的部分…     │ overlay│
└──────────┴────────────────────────┴────────┘
```

- 面板 `position: absolute` 在预览容器内，**不参与 flex 布局**；开关、拖拽宽度都不会改变正文宽度。
- 默认 300px，可拖拽 220–480px；左边缘 8px 热区，双击热区恢复 300px。
- 遮挡正文时使用三个线索，而不是全屏 modal：
  - 1px `--border` 左边界；
  - 左侧 22px 渐变淡出 + 负向阴影；
  - 面板使用实色 `--bg-surface`，保证自身可读性。
- 工具栏的 outline 按钮负责开关，按钮维护 `aria-pressed`；`Esc` 关闭；面板 footer 常驻提示。
- 面板 header 包含：标题、条目数、全部展开 / 全部折叠、关闭。折叠状态与当前 active 项在本次会话内保留。

### 2.2 移动端：底部抽屉

- 断点建议 ≤ 720px（与现有移动端布局保持一致后确认）。
- 同一个组件改成 72% 高度的 bottom sheet；`Esc` / 点击遮罩关闭。
- 关闭时右下角显示 46px 浮动按钮；打开后隐藏浮动按钮，显示遮罩。
- 行高从 26px 提升到 32px，搜索框 34px。
- 原型不做手势拖拽关闭，最终实现再决定是否支持下滑。

### 2.3 视觉规格

复用 Dinotty 暗色 token，不引入新色板：

| 元素 | 取值 |
| --- | --- |
| 面板背景 | `--bg-surface` `#252526` |
| 边界 / 分割线 | `--border` `#3C3C3C` / `--divider` `#2D2D2D` |
| active 行 | `--palette-select` `#2A2D2E` + 2px `--accent` 左条 |
| hover | `--bg-hover` `#2A2A2C` |
| 文字 | `--fg` / `--fg-bright` / `--fg-muted` |
| 代码符号色 | 复用 `--color-cyan/yellow/magenta/blue`，低饱和 |
| 字体 | UI `--font-ui`，行号/值 `--font-mono` |

图标最终用 lucide；原型用内联 SVG 和简单几何字符示意。

---

## 3. 交互

### 3.1 折叠与默认层级

- 树节点带 `aria-expanded`；默认展开深度 2（深度 `< 2` 的节点展开）。
- header 提供 expand all / collapse all。
- 用户手动折叠后，scroll spy 命中被折叠的子项时自动展开其祖先（否则高亮不可见）。
- 筛选时忽略折叠状态：只显示命中项及其祖先。

### 3.2 过滤

- 输入即过滤，大小写不敏感，匹配条目文本；命中片段高亮。
- 保留命中项的祖先链，数量显示 `命中数 / 总数`。
- 无命中时展示独立空状态（不是“无标题”），带清空按钮。
- `Esc` 关闭面板；`/` 在面板打开时聚焦过滤框。不劫持 Ctrl/⌘+F。

### 3.3 Scroll spy

- 监听预览容器自身的 `scroll`（不是 window），`requestAnimationFrame` 节流，passive。
- 阅读线：容器顶部 + 88px；取最后一个越过阅读线的标题/符号。
- Markdown 用渲染后的 `h1–h6` DOM 与 id；代码 / JSON 用行元素位置。
- 点击条目后临时抑制 spy（约 1.2s），避免平滑滚动过程中高亮乱跳。

### 3.4 点击跳转

| 模式 | 行为 |
| --- | --- |
| Markdown 预览 | 按 GitHub slug 找到标题 id，滚动预览容器到标题上方 26px |
| Markdown 源码 | Monaco `revealLineInCenter(line)` + 聚焦编辑器 |
| 代码 / JSON 源码 | 滚动到对应源码行上方约 72px；行闪烁一次 |
| JSON 预览（未来） | 按 key 路径定位渲染节点 |

点击后 active 行立即更新，并在大纲树内 `scrollIntoView({ block: 'nearest' })`。

### 3.5 空状态

| 状态 | 文案方向 | 操作 |
| --- | --- | --- |
| 无标题 | “No headings found”，解释需要 H1–H6 | 重新扫描 |
| 无符号 | “No symbols found”，说明 provider 与正则都没有结果 | 重新扫描 |
| 无 key | “No keys found”，文件为空或顶层是标量 | 重新扫描 |
| 解析失败 | “Couldn't parse this file” + 失败行/原因 | Retry |
| 过滤无结果 | “No matches” + 当前关键字 | 清空过滤 |

解析失败必须显示具体行号或 provider 超时信息，不能只显示空树。

### 3.6 可访问性

- `role="tree"` / `treeitem`，`aria-level`、`aria-expanded`。
- 图标不是唯一信息载体：Markdown 显示 H1–H6 badge，代码显示 interface/class/function 等。
- 工具栏按钮有 `title` 和 `aria-label`；开关有 `aria-pressed`。
- 移动端遮罩关闭与 `Esc` 等价。

---

## 4. 数据来源

### 4.1 Markdown

**解析**：复用 `useFileEditor.ts` 现有的 `marked` 懒加载，避免第二次解析。

- 当前代码对 `editorText` 做 300ms debounce 后调用 `m.parse(src)`。
- 改为先 `marked.lexer(src)`，再把 token 交给 `marked.parser(tokens)` 渲染；同一份 token 列表里取 `heading` token，产出 outline。
- 标题行号：heading token 只有 `raw`，没有行号；在 lexer 结果上按 `raw` 长度累加，或用 `walkTokens` 维护源偏移。最终以“源文件行号”为准。
- 预览与源码共用 `editorText`，包括未保存的脏 buffer。

**slug（与 #330 对齐）**：

- GitHub 风格：转小写 → 去标点 → 空格转 `-` → 重复标题加 `-1`、`-2`。
- 保留 Unicode 字母/数字与 emoji；`Goals & non-goals` → `goals--non-goals`（`&` 被移除后留下两个空格）。
- 每个文档一个 slugger 实例；预览重渲染必须得到相同 id。
- #330 负责渲染层注入 id 与本页锚点跳转；本设计只消费同一套 slug，不另造规则。

**跳转**：

- 预览模式：滚动预览容器到 `document.getElementById(slug)`。
- 源码模式：`revealLineInCenter(line)`，沿用 `EditorPane.vue` 中搜索结果的 reveal 路径。

### 4.2 代码

**优先**：Monaco document symbols。

- 符号来源：当前 model 的 `DocumentSymbolProvider`，层级映射为 children，`range.startLineNumber` 作为行号。
- `SymbolKind` 映射到图标：interface / class / function / method / property / const / type。
- 需要处理 provider 异步、超时、切换 tab 时的过期结果（用 model version + token 丢弃旧结果）。

**实现约束（重要）**：Monaco standalone 0.55 的公开 API 只有
`monaco.languages.registerDocumentSymbolProvider`，**没有公开的
`executeDocumentSymbolProvider`**。可选路径：

1. 薄适配层访问 Monaco 内部 `DocumentSymbolProviderRegistry`（版本升级可能失效，需要 pin 版本 + 回归测试）；
2. 对 TS/JS 直接通过 Monaco 的 TypeScript language service 适配器取 symbols；
3. 其他语言走正则回退。

建议第一版先做 2 + 3，把 provider 访问封装成 `collectDocumentSymbols(model)`，后续替换内部 registry 时不影响 UI。

**正则回退**：只提取顶层声明，按语言维护模式表。

| 语言 | 提取 | 置信度 |
| --- | --- | --- |
| Rust | fn / struct / enum / trait / impl / mod / const | 顶层高，宏与嵌套低 |
| TypeScript / JS | function / class / interface / type / const | 高，块内声明会漏 |
| Python | def / class / 顶层赋值 | 高，装饰器忽略 |
| Go | func / type / const / var | 高，方法按 receiver 分组 |
| Java / Kotlin | class / interface / enum / fun / method | 中 |
| C / C++ | 函数、struct / class / namespace | 中，宏与模板易误判 |
| Ruby / PHP | def / class / module / function | 中 |

边界：

- 注释、字符串、minified / generated 代码可能误报；命中为空时宁可显示空状态。
- 回退结果在 UI 上标注来源（如 “regex”），不冒充语言服务器。
- 支持的语言列表与阈值写入配置，便于关闭。

### 4.3 JSON / YAML / TOML

- 解析成统一节点：`key`、类型（object / array / scalar）、行号、children。
- 顶层 key + 嵌套 key；数组默认显示为 `[n]` 叶子，展开后显示索引（开放项）。
- **懒展开**：只渲染当前展开分支；大文件解析放 worker。
- 起始阈值（写进配置，可调）：
  - 超过 500 个节点：默认只展开 2 层；
  - 超过 2000 个节点：行虚拟化；
  - 解析失败：显示失败行 + Retry。
- YAML 多文档、锚点/别名，TOML table / array-of-tables 作为后续兼容项。

---

## 5. 数据模型

```ts
export type OutlineKind =
  | 'heading'
  | 'interface' | 'class' | 'function' | 'method' | 'property' | 'const' | 'type'
  | 'object' | 'array' | 'scalar'

export interface OutlineItem {
  id: string
  label: string
  kind: OutlineKind
  line: number
  anchor?: string        // Markdown 预览 slug
  value?: string         // JSON 叶子预览
  children?: OutlineItem[]
}

export interface OutlineSource {
  items: OutlineItem[]
  status: 'ok' | 'empty' | 'error'
  message?: string
  errorDetail?: string
}
```

`id` 必须稳定（Markdown 用 slug，代码用 `name:line`，JSON 用 key 路径），用于折叠记忆与 active 状态。

---

## 6. 与现有组件的接入点

### `FilePreviewContent.vue`

- 当前根节点 `.file-workspace-preview` 自身就是滚动容器（`overflow: auto`）。覆盖层不能放在它的滚动内容里，否则会跟随内容滚走。
- 建议在 `EditorPane.vue` 中包一层 `.preview-wrap { position: relative }`，把 `<FilePreviewContent>` 和 `<OutlinePanel>` 并列为兄弟；或者由 `FilePreviewContent` 内部拆出“滚动内容 + overlay”两层。
- 传入：`filePath`、`meta.kind/language`、`editorText`、`mdShowPreview`、`markdownEditorHtml`、Markdown 预览 DOM ref。
- 预览 DOM ref 目前是内部的 `mdPreviewEl`，需要 `defineExpose` 或 emit 给父层，供 scroll spy 与锚点跳转使用。

### `useFileEditor.ts`

- 在现有 debounce 的 marked 流程中，把 `m.parse(src)` 改为 `tokens = m.lexer(src)` + `m.parser(tokens)`；同时产出 `markdownOutline`。
- slugger 跟随 buffer，不随组件挂载重建；dirty buffer 使用 `editorText`。
- 不建议为了大纲再跑一次完整 Markdown 解析。

### `EditorPane.vue`

- 已通过 `whenEditorReady(leaf.id)` 拿到 Monaco，并在搜索定位中使用 `revealLineInCenter`。大纲的源码定位复用同一入口。
- 每个 pane 维护自己的 outline 开关与滚动位置；切换 tab 时重新计算当前文件的 outline。
- Markdown 预览 / 源码切换时，点击大纲条目应根据当前模式选择 anchor 或行号。

### `MonacoEditor.vue`

- 暴露 `getEditor()` / `getModel()` 或一个 `revealLineInCenter` 方法；收集 symbols 时读取当前 model。
- 不改变现有编辑器 UI。

### 建议新增

- `frontend/src/components/workspace/OutlinePanel.vue`
- `frontend/src/composables/useOutline.ts`（数据源聚合、缓存、状态机）
- `frontend/src/utils/markdownOutline.ts`（lexer → items、GitHub slugger）
- i18n key：`outline.title/emptyHeadings/emptySymbols/emptyKeys/parseError/filterPlaceholder/...`

---

## 7. 性能与稳定性

- 复用现有 300ms debounce；Markdown outline 与渲染同源，不额外解析。
- 缓存按 tab buffer 版本（或内容 hash）失效；切换 tab 优先使用缓存。
- scroll spy 只读几何，按 rAF 节流；大文件虚拟化后按可见区间计算。
- 解析失败 / provider 超时都进入 error 状态，不留下半棵树。
- 面板开关只改变 overlay，不触发正文 reflow；拖拽只改 CSS 变量。

---

## 8. 开放问题（需要拍板）

1. **默认宽度**：300px 是否合适？还是 280 / 360？宽度是全局、按工作区，还是每设备记住？
2. **展开状态记忆**：是否按文件持久化折叠状态？第一版建议只做会话内记忆。
3. **移动端形态**：底部抽屉 vs 全屏抽屉；断点取 720 还是 768；浮动按钮是否常驻。
4. **快捷键**：除工具栏和 `Esc` 外，是否增加全局开关（如 Ctrl/⌘+Shift+O）？需要先排查冲突。
5. **代码回退策略**：正则回退默认开启还是只对白名单语言开启？UI 是否显示 “regex” 标记？
6. **JSON 数组**：默认折叠为 `[n]`，还是直接展开索引？大数组是否只显示前 N 项？
7. **scroll spy 与手动折叠**：命中折叠子项时自动展开祖先是否可接受？还是只高亮可见项？
8. **多 pane**：每个编辑器 pane 独立开关，还是整个工作区共享一个大纲？
9. **大文件阈值**：500 懒展开 / 2000 虚拟化 / 1MB 解析上限是否合适？
10. **预览面包屑**（#329 的可选项）：是否第一版就做“当前章节路径”？

---

## 9. 验证建议

- 单测：GitHub slug 重复与特殊字符；过滤保留祖先；默认展开深度；空状态选择；YAML/TOML 节点映射。
- 组件测试：点击 reveal、scroll spy、面板开关不改变正文宽度、拖拽 clamp、移动端抽屉开关。
- 真实浏览器/截图：使用 `file://` 打开原型检查布局；原型已内置 1440px 桌面和 390px 移动端示例。
- 代码 provider：pin Monaco 版本，对内部 registry 访问做回归；provider 超时与 tab 切换竞态必须有测试。

---

## 10. 原型说明

打开 [`docs/public/prototypes/outline-panel.html`](/prototypes/outline-panel.html)（无需构建或联网）。

顶部控制条可切换：

- **File**：Markdown / TypeScript / JSON 三套 mock 文件；
- **Width**：Narrow 240 / Default 300 / Wide 420，也可直接拖拽面板左边缘；
- **State**：Normal / Empty / Parse error；
- **Mobile**：390px 手机框 + 底部抽屉 + 浮动按钮；
- **Reset**：恢复默认状态。

原型中的正文是 mock 内容，但滚动、scroll spy、锚点/行号跳转、过滤、折叠、空状态和宽度拖拽都是真实联动。
