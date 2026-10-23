# PROGRESS — opt/opt-tree-ui

## 目标
TreeRows 交互与视觉：触摸手势状态机、整行命中、内联输入 blur、拖拽自动展开/滚动、加载/空态、原型树外观（导引线/28px/彩色图标/目录变更点）。

## 已核实
- 原型 `file-tree-ux.html`：guides 每层 1px 竖线；行高 28px；彩色扩展名；目录变更 6px 圆点。
- 原 TreeRows 同时 spread swipe/longpress 同名 handler，后者覆盖前者；文件行仅 label 可点。
- `filePreview.loading` 已有；无空文件夹键。
- 拖拽 hover 接线为 useFileOperations 空函数；只能经 emit('toggle') 联动（不改 FileWorkspacePreview.vue）。

## 改动
- [x] 1 触摸手势状态机：makeTouchHandlers 合并 swipe/longpress，长按后禁滑动。
- [x] 2 文件行整行命中：tree-file-hit 包住占位+图标+文字。
- [x] 3 TreeInlineInput：blur 提交（空名取消）、composition 守卫、Enter/Escape 去重。
- [x] 4 拖拽：悬停 600ms emit toggle 自动展开（已展开跳过）；上下 24px 自动滚动（closest .file-workspace-tree-wrap，回退 overflow 祖先）；dragleave/drop/dragend 清理。
- [x] 5 加载/空态：expanded 且 cache undefined → 缩进 loading 行；entries=[]（含根）→ 空文件夹；复用 filePreview.loading，新增 filePreview.emptyFolder（en/zh）。
- [ ] 6 导引线/28px/彩色图标/目录变更点

## 测试结果
- npm test：191 passed / 1 skipped（1932 tests）；prettier check、vue-tsc -b 通过。

## 未完成
- 第 6 项。
