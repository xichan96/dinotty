import { COLORS, FILL_COLORS, STROKE_WIDTHS } from '../constants.js';

// SVG icon helper — Lucide-style 20x20, stroke-width 1.5
function icon(paths) {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const ICONS = {
  select: icon('<path d="M4 4l7 17 2.5-6.5L20 12z"/><path d="M14.5 14.5L18 18"/>'),
  pen: icon('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>'),
  marker: icon('<path d="M18.37 2.63a2.12 2.12 0 0 1 3 3L14 13l-4 1 1-4Z"/>'),
  highlighter: icon('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'),
  eraser: icon('<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>'),
  rectangle: icon('<rect x="3" y="3" width="18" height="18" rx="2"/>'),
  ellipse: icon('<ellipse cx="12" cy="12" rx="10" ry="10"/>'),
  diamond: icon('<path d="M12 2 L22 12 L12 22 L2 12 Z"/>'),
  line: icon('<path d="M5 19L19 5"/>'),
  arrow: icon('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'),
  text: icon('<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>'),
  image: icon('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'),
  undo: icon('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>'),
  redo: icon('<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>'),
  download: icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  trash: icon('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
  grid: icon('<path d="M3 3h18v18H3z"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>'),
};

export function renderToolbar(h, board, state) {
  const tool = board.getTool();
  const children = [];

  const toolGroups = [
    [{ id: 'select', icon: ICONS.select, label: '选择', key: 'V' }],
    [
      { id: 'pen', icon: ICONS.pen, label: '画笔', key: 'P' },
      { id: 'marker', icon: ICONS.marker, label: '马克笔' },
      { id: 'highlighter', icon: ICONS.highlighter, label: '荧光笔' },
      { id: 'eraser', icon: ICONS.eraser, label: '橡皮擦', key: 'E' },
    ],
    [
      { id: 'rectangle', icon: ICONS.rectangle, label: '矩形', key: 'R' },
      { id: 'ellipse', icon: ICONS.ellipse, label: '椭圆', key: 'O' },
      { id: 'diamond', icon: ICONS.diamond, label: '菱形', key: 'D' },
      { id: 'line', icon: ICONS.line, label: '线段', key: 'L' },
      { id: 'arrow', icon: ICONS.arrow, label: '箭头', key: 'A' },
    ],
    [
      { id: 'text', icon: ICONS.text, label: '文本', key: 'T' },
      { id: 'image', icon: ICONS.image, label: '图片' },
    ],
  ];

  for (const group of toolGroups) {
    const buttons = group.map(t =>
      h('button', {
        class: 'wb-tool-btn' + (tool === t.id ? ' active' : ''),
        title: `${t.label}${t.key ? ` (${t.key})` : ''}`,
        onClick: () => {
          board.setTool(t.id);
          if (t.id === 'image') board.tools.image.openFile();
          state.activeTool = t.id;
        },
        innerHTML: t.icon,
      })
    );
    children.push(h('div', { class: 'wb-tool-group' }, buttons));
    children.push(h('div', { class: 'wb-divider' }));
  }

  // Undo / Redo
  children.push(h('div', { class: 'wb-tool-group' }, [
    h('button', {
      class: 'wb-tool-btn',
      title: '撤销 (Ctrl+Z)',
      disabled: !board.history.canUndo(),
      onClick: () => { board.undo(); },
      innerHTML: ICONS.undo,
    }),
    h('button', {
      class: 'wb-tool-btn',
      title: '重做 (Ctrl+Shift+Z)',
      disabled: !board.history.canRedo(),
      onClick: () => { board.redo(); },
      innerHTML: ICONS.redo,
    }),
  ]));
  children.push(h('div', { class: 'wb-divider' }));

  // Stroke color
  children.push(h('div', { class: 'wb-tool-group' }, [
    h('button', {
      class: 'wb-tool-btn wb-color-btn',
      title: '描边颜色',
      onClick: () => { state.showColorPicker = !state.showColorPicker; },
    }, [
      h('span', { class: 'wb-color-preview', style: { background: state.strokeColor } }),
    ]),
    h('button', {
      class: 'wb-tool-btn wb-color-btn',
      title: '填充颜色',
      onClick: () => { state.showFillPicker = !state.showFillPicker; },
    }, [
      h('span', {
        class: 'wb-color-preview wb-fill-preview',
        style: { background: state.fillColor || 'transparent', borderColor: state.fillColor ? state.fillColor : '#ccc' },
      }),
    ]),
  ]));

  // Stroke width
  children.push(h('div', { class: 'wb-tool-group' }, [
    h('button', {
      class: 'wb-tool-btn',
      title: '线宽',
      onClick: () => { state.showWidthPicker = !state.showWidthPicker; },
    }, [
      h('span', { style: { display: 'block', width: '16px', height: Math.min(state.strokeWidth, 6) + 'px', background: '#333', borderRadius: '2px' } }),
    ]),
  ]));
  children.push(h('div', { class: 'wb-divider' }));

  // Grid toggle
  children.push(h('div', { class: 'wb-tool-group' }, [
    h('button', {
      class: 'wb-tool-btn' + (state.showGrid ? ' active' : ''),
      title: state.showGrid ? '隐藏网格' : '显示网格',
      onClick: () => {
        state.showGrid = !state.showGrid;
        board.renderer.showGrid = state.showGrid;
        board.markDirty();
      },
      innerHTML: ICONS.grid,
    }),
  ]));
  children.push(h('div', { class: 'wb-divider' }));

  // Export / Clear
  children.push(h('div', { class: 'wb-tool-group' }, [
    h('button', {
      class: 'wb-tool-btn',
      title: '导出',
      onClick: () => { state.showExport = true; },
      innerHTML: ICONS.download,
    }),
    h('button', {
      class: 'wb-tool-btn',
      title: '清空画布',
      onClick: async () => {
        if (await board.pluginCtx.ui.confirm('确定清空画布？')) board.clearAll();
      },
      innerHTML: ICONS.trash,
    }),
  ]));

  return children;
}

export function renderColorPicker(h, colors, current, onSelect, onClose) {
  const swatches = colors.map(c =>
    h('button', {
      class: 'wb-swatch' + (c === current ? ' active' : ''),
      style: { background: c || 'transparent' },
      onClick: () => onSelect(c),
    })
  );

  return h('div', { class: 'wb-popup wb-color-picker' }, [
    h('div', { class: 'wb-popup-header' }, [
      h('span', null, '颜色'),
      h('button', { class: 'wb-popup-close', onClick: onClose }, '×'),
    ]),
    h('div', { class: 'wb-swatches' }, swatches),
  ]);
}

export function renderWidthPicker(h, widths, current, onSelect, onClose) {
  const items = widths.map(w =>
    h('button', {
      class: 'wb-width-option' + (w === current ? ' active' : ''),
      onClick: () => onSelect(w),
    }, [
      h('span', { style: { display: 'block', width: '40px', height: Math.min(w, 8) + 'px', background: '#333', borderRadius: '2px' } }),
      h('span', { class: 'wb-width-label' }, w + 'px'),
    ])
  );

  return h('div', { class: 'wb-popup wb-width-picker' }, [
    h('div', { class: 'wb-popup-header' }, [
      h('span', null, '线宽'),
      h('button', { class: 'wb-popup-close', onClick: onClose }, '×'),
    ]),
    h('div', { class: 'wb-width-options' }, items),
  ]);
}
