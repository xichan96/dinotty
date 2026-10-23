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
- [x] 6 外观：depth 条带导引线（8px/层，border-box 对齐内容）、行高 28px、扩展名彩色 file 图标（原型色板）、目录变更 6px 圆点；真实 Chrome 实测行高 28、导引线 x=8/16、图标起点 40。

## 测试结果
- npm test：191 passed / 1 skipped（1932 tests）；prettier check、vue-tsc -b 通过。
- Chrome 几何夹具（/tmp/tree-fixture）：dir/file/state/inline 行高均 28；guides 8/16；icon x=40；.ts 图标 rgb(111,168,220)；圆点 6x6。

## 未完成
- 无（六项已完成）。
- 未在真实应用里跑交互回归（需要服务端/8999 端口与桌面壳），仅做 Chrome 静态几何验证。
