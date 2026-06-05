import { Board } from './core/board.js';
import { renderToolbar, renderColorPicker, renderWidthPicker } from './ui/toolbar.js';
import { renderExportDialog } from './ui/exportDialog.js';
import { drawMinimap } from './ui/minimap.js';
import { COLORS, FILL_COLORS, STROKE_WIDTHS, DEFAULTS } from './constants.js';
import { getClipboard } from './utils/clipboard.js';
import { copyElements } from './utils/clipboard.js';
import { resizeTextElement } from './elements/text.js';

export function activate(ctx) {
  const { h, ref, reactive, onMounted, onUnmounted } = ctx;

  ctx.commands.register('whiteboard.open', () => {});
  ctx.commands.register('whiteboard.new', () => {});
  ctx.commands.register('whiteboard.clear', () => {});
  ctx.commands.register('whiteboard.export-png', () => {});
  ctx.commands.register('whiteboard.export-json', () => {});

  const component = {
    setup() {
      const rootRef = ref(null);

      const state = reactive({
        activeTool: 'pen',
        strokeColor: DEFAULTS.strokeColor,
        fillColor: DEFAULTS.fillColor,
        strokeWidth: DEFAULTS.strokeWidth,
        zoom: 1,
        showGrid: true,
        showColorPicker: false,
        showFillPicker: false,
        showWidthPicker: false,
        showExport: false,
        editingText: null,
      });

      // Store imperatively-created elements and board
      let board = null;
      let toolbarEl = null;
      let canvasContainer = null;
      let statusbarEl = null;
      let popupsEl = null;
      let overlayEl = null;
      let minimapCanvas = null;
      let activeTextEdit = null;

      function cleanupTextEdit() {
        if (activeTextEdit) {
          activeTextEdit.remove();
          activeTextEdit = null;
        }
        state.editingText = null;
      }

      function updateToolbar() {
        if (!toolbarEl || !board) return;
        // Re-render toolbar into the existing element
        const vnode = h('div', { class: 'wb-toolbar-inner' }, renderToolbar(h, board, state));
        // Use Vue to patch just the toolbar content
        // Simpler: just rebuild toolbar HTML
        toolbarEl.innerHTML = '';
        const items = renderToolbar(h, board, state);
        for (const item of items) {
          // Each item is a VNode — we need to render it
        }
      }

      onMounted(() => {
        const root = rootRef.value;
        if (!root) return;

        // Build entire UI imperatively
        root.innerHTML = '';

        // Toolbar
        toolbarEl = document.createElement('div');
        toolbarEl.className = 'wb-toolbar';
        root.appendChild(toolbarEl);

        // Canvas container
        canvasContainer = document.createElement('div');
        canvasContainer.className = 'wb-canvas-container';
        root.appendChild(canvasContainer);

        // Canvas
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;touch-action:none;';
        canvasContainer.appendChild(canvas);

        // Minimap
        minimapCanvas = document.createElement('canvas');
        minimapCanvas.width = 160;
        minimapCanvas.height = 120;
        minimapCanvas.className = 'wb-minimap-canvas';
        minimapCanvas.style.cssText = 'position:absolute;bottom:10px;right:10px;border:1px solid #e0e0e0;border-radius:6px;background:#fafafa;z-index:5;pointer-events:none;display:none;';
        canvasContainer.appendChild(minimapCanvas);

        // Text overlay container
        overlayEl = document.createElement('div');
        overlayEl.className = 'wb-overlay-layer';
        canvasContainer.appendChild(overlayEl);

        // Popups container
        popupsEl = document.createElement('div');
        popupsEl.className = 'wb-popups';
        root.appendChild(popupsEl);

        // Status bar
        statusbarEl = document.createElement('div');
        statusbarEl.className = 'wb-statusbar';
        root.appendChild(statusbarEl);

        // Create board
        board = new Board(canvas, ctx);
        board.currentStrokeWidth = state.strokeWidth;
        board.currentStrokeColor = state.strokeColor;
        board.currentFillColor = state.fillColor;
        board.setTool('pen');

        // Text editing callback
        board.tools.text.setOnTextEdit((el) => {
          cleanupTextEdit();
          state.editingText = el;

          const vp = board.viewport;
          const dpr = window.devicePixelRatio || 1;
          const sx = el.x * vp.zoom + vp.x;
          const sy = el.y * vp.zoom + vp.y;
          const sw = el.width * vp.zoom;
          const sh = el.height * vp.zoom;

          const textarea = document.createElement('textarea');
          textarea.value = el.content || '';
          textarea.className = 'wb-text-edit-overlay';
          textarea.style.cssText = `left:${sx}px;top:${sy}px;width:${Math.max(100, sw)}px;height:${Math.max(30, sh)}px;font-size:${el.fontSize * vp.zoom}px;font-family:${el.fontFamily};text-align:${el.textAlign || 'left'};`;
          overlayEl.appendChild(textarea);
          activeTextEdit = textarea;

          const origContent = el.content || '';
          function autoResize() {
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
          }
          textarea.addEventListener('input', () => {
            el.content = textarea.value;
            resizeTextElement(el);
            autoResize();
            board.markDirty();
          });
          textarea.addEventListener('blur', () => {
            if (textarea.value.trim()) {
              board.tools.text.finishEditing(el, textarea.value);
            } else {
              el.content = origContent;
              if (!origContent) board.removeElement(el.id);
              else { resizeTextElement(el); board.markDirty(); }
            }
            cleanupTextEdit();
          });
          textarea.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
              el.content = origContent;
              if (!origContent) board.removeElement(el.id);
              else { resizeTextElement(el); board.markDirty(); }
              cleanupTextEdit();
            }
          });
          requestAnimationFrame(() => { textarea.focus(); autoResize(); });
        });

        // Paste override
        const origOnKeyDown = board._onKeyDown.bind(board);
        board._onKeyDown = (e) => {
          const ctrl = e.ctrlKey || e.metaKey;
          if (ctrl && e.key === 'v' && !state.editingText) {
            const clipboard = getClipboard();
            if (clipboard && clipboard.length > 0) {
              e.preventDefault();
              for (const el of clipboard) {
                el.x += 20;
                el.y += 20;
                board.addElement(el);
              }
            }
          }
          origOnKeyDown(e);
        };

        board.copySelected = () => {
          const selected = board.getSelectedElements();
          if (selected.length > 0) {
            copyElements(selected);
            ctx.ui.notify('已复制 ' + selected.length + ' 个元素');
          }
        };

        board.load();

        // Sync tool changes from keyboard shortcuts back to Vue state
        board.setOnToolChange((name) => {
          state.activeTool = name;
          renderToolbarUI();
          updateStatusBar();
        });

        // Render toolbar using Vue's h() into a container
        renderToolbarUI();

        // Status bar update
        updateStatusBar();

        // Main loop
        const toolNames = {
          select: '选择', pen: '画笔', marker: '马克笔', highlighter: '荧光笔',
          eraser: '橡皮擦', rectangle: '矩形', ellipse: '椭圆', diamond: '菱形',
          line: '线段', arrow: '箭头', text: '文本', image: '图片',
        };

        let lastZoom = -1;
        let lastTool = '';
        let lastElementCount = -1;

        const tick = () => {
          if (!board || board._disposed) { requestAnimationFrame(tick); return; }

          // Sync zoom
          const z = board.viewport.zoom;
          if (Math.abs(z - lastZoom) > 0.001) {
            lastZoom = z;
            state.zoom = z;
            updateStatusBar();
          }

          // Sync grid
          if (board.renderer.showGrid !== state.showGrid) {
            board.renderer.showGrid = state.showGrid;
          }

          // Update minimap
          minimapCanvas.style.display = board.elements.length > 0 ? 'block' : 'none';
          if (board.elements.length > 0) {
            drawMinimap(minimapCanvas, board, board._cssWidth, board._cssHeight);
          }

          // Update element count
          if (board.elements.length !== lastElementCount) {
            lastElementCount = board.elements.length;
            updateStatusBar();
          }

          requestAnimationFrame(tick);
        };
        tick();
      });

      function renderToolbarUI() {
        if (!toolbarEl || !board) return;
        toolbarEl.innerHTML = '';

        const tool = state.activeTool;

        const toolGroups = [
          [{ id: 'select', label: '选择', key: 'V/1', svg: '<path d="M4 4l7 17 2.5-6.5L20 12z"/><path d="M14.5 14.5L18 18"/>' }],
          [
            { id: 'pen', label: '画笔', key: 'P/7', svg: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>' },
            { id: 'marker', label: '马克笔', svg: '<path d="M18.37 2.63a2.12 2.12 0 0 1 3 3L14 13l-4 1 1-4Z"/>' },
            { id: 'highlighter', label: '荧光笔', svg: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>' },
            { id: 'eraser', label: '橡皮擦', key: 'E/9', svg: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>' },
          ],
          [
            { id: 'rectangle', label: '矩形', key: 'R/2', svg: '<rect x="3" y="3" width="18" height="18" rx="2"/>' },
            { id: 'ellipse', label: '椭圆', key: 'O/4', svg: '<ellipse cx="12" cy="12" rx="10" ry="10"/>' },
            { id: 'diamond', label: '菱形', key: 'D/3', svg: '<path d="M12 2 L22 12 L12 22 L2 12 Z"/>' },
            { id: 'line', label: '线段', key: 'L/6', svg: '<path d="M5 19L19 5"/>' },
            { id: 'arrow', label: '箭头', key: 'A/5', svg: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>' },
          ],
          [
            { id: 'text', label: '文本', key: 'T/8', svg: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>' },
            { id: 'image', label: '图片', key: '0', svg: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>' },
          ],
        ];

        function makeSVG(paths) {
          return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
        }

        function makeBtn(innerHTML, title, onClick, active = false, disabled = false) {
          const btn = document.createElement('button');
          btn.className = 'wb-tool-btn' + (active ? ' active' : '');
          btn.title = title;
          btn.innerHTML = innerHTML;
          if (disabled) btn.disabled = true;
          btn.addEventListener('click', onClick);
          return btn;
        }

        for (const group of toolGroups) {
          const groupEl = document.createElement('div');
          groupEl.className = 'wb-tool-group';
          for (const t of group) {
            const btn = makeBtn(
              makeSVG(t.svg),
              `${t.label}${t.key ? ` (${t.key})` : ''}`,
              () => {
                state.activeTool = t.id;
                board.setTool(t.id);
                if (t.id === 'image') board.tools.image.openFile();
                renderToolbarUI();
              },
              tool === t.id
            );
            groupEl.appendChild(btn);
          }
          toolbarEl.appendChild(groupEl);

          const divider = document.createElement('div');
          divider.className = 'wb-divider';
          toolbarEl.appendChild(divider);
        }

        // Undo/Redo
        const undoGroup = document.createElement('div');
        undoGroup.className = 'wb-tool-group';
        undoGroup.appendChild(makeBtn(
          makeSVG('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>'),
          '撤销 (Ctrl+Z)', () => { board.undo(); renderToolbarUI(); }, false, !board.history.canUndo()
        ));
        undoGroup.appendChild(makeBtn(
          makeSVG('<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>'),
          '重做 (Ctrl+Shift+Z)', () => { board.redo(); renderToolbarUI(); }, false, !board.history.canRedo()
        ));
        toolbarEl.appendChild(undoGroup);

        const div2 = document.createElement('div');
        div2.className = 'wb-divider';
        toolbarEl.appendChild(div2);

        // Colors
        const colorGroup = document.createElement('div');
        colorGroup.className = 'wb-tool-group';

        const strokeBtn = makeBtn('', '描边颜色', () => {
          state.showColorPicker = !state.showColorPicker;
          state.showFillPicker = false;
          state.showWidthPicker = false;
          renderPopups();
        });
        const strokePreview = document.createElement('span');
        strokePreview.className = 'wb-color-preview';
        strokePreview.style.background = state.strokeColor;
        strokeBtn.innerHTML = '';
        strokeBtn.appendChild(strokePreview);
        colorGroup.appendChild(strokeBtn);

        const fillBtn = makeBtn('', '填充颜色', () => {
          state.showFillPicker = !state.showFillPicker;
          state.showColorPicker = false;
          state.showWidthPicker = false;
          renderPopups();
        });
        const fillPreview = document.createElement('span');
        fillPreview.className = 'wb-color-preview wb-fill-preview';
        fillPreview.style.background = state.fillColor || 'transparent';
        fillPreview.style.borderColor = state.fillColor || '#ccc';
        fillBtn.innerHTML = '';
        fillBtn.appendChild(fillPreview);
        colorGroup.appendChild(fillBtn);
        toolbarEl.appendChild(colorGroup);

        // Width
        const widthGroup = document.createElement('div');
        widthGroup.className = 'wb-tool-group';
        const widthBtn = makeBtn('', '线宽', () => {
          state.showWidthPicker = !state.showWidthPicker;
          state.showColorPicker = false;
          state.showFillPicker = false;
          renderPopups();
        });
        const widthIndicator = document.createElement('span');
        widthIndicator.style.cssText = `display:block;width:16px;height:${Math.min(state.strokeWidth, 6)}px;background:#333;border-radius:2px;`;
        widthBtn.innerHTML = '';
        widthBtn.appendChild(widthIndicator);
        widthGroup.appendChild(widthBtn);
        toolbarEl.appendChild(widthGroup);

        const div3 = document.createElement('div');
        div3.className = 'wb-divider';
        toolbarEl.appendChild(div3);

        // Grid toggle
        const gridGroup = document.createElement('div');
        gridGroup.className = 'wb-tool-group';
        gridGroup.appendChild(makeBtn(
          makeSVG('<path d="M3 3h18v18H3z"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>'),
          state.showGrid ? '隐藏网格' : '显示网格',
          () => {
            state.showGrid = !state.showGrid;
            board.renderer.showGrid = state.showGrid;
            board.markDirty();
            renderToolbarUI();
          },
          state.showGrid
        ));
        toolbarEl.appendChild(gridGroup);

        const div4 = document.createElement('div');
        div4.className = 'wb-divider';
        toolbarEl.appendChild(div4);

        // Export / Clear
        const actionGroup = document.createElement('div');
        actionGroup.className = 'wb-tool-group';
        actionGroup.appendChild(makeBtn(
          makeSVG('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
          '导出', () => { state.showExport = !state.showExport; renderPopups(); }
        ));
        actionGroup.appendChild(makeBtn(
          makeSVG('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
          '清空画布', () => {
            showConfirm('确定清空画布？此操作不可撤销。').then(ok => {
              if (ok) { board.clearAll(); renderToolbarUI(); }
            });
          }
        ));
        toolbarEl.appendChild(actionGroup);
      }

      function renderPopups() {
        if (!popupsEl) return;
        popupsEl.innerHTML = '';

        if (state.showColorPicker) {
          const popup = createColorPopup(COLORS, state.strokeColor, (c) => {
            state.strokeColor = c;
            board.currentStrokeColor = c;
            state.showColorPicker = false;
            for (const el of board.getSelectedElements()) el.strokeColor = c;
            board.history.push(board.elements);
            board.scheduleSave();
            board.markDirty();
            renderToolbarUI();
            renderPopups();
          });
          popupsEl.appendChild(popup);
        }

        if (state.showFillPicker) {
          const popup = createColorPopup(FILL_COLORS, state.fillColor, (c) => {
            state.fillColor = c;
            board.currentFillColor = c;
            state.showFillPicker = false;
            for (const el of board.getSelectedElements()) el.fillColor = c;
            board.history.push(board.elements);
            board.scheduleSave();
            board.markDirty();
            renderToolbarUI();
            renderPopups();
          });
          popupsEl.appendChild(popup);
        }

        if (state.showWidthPicker) {
          const popup = createWidthPopup(STROKE_WIDTHS, state.strokeWidth, (w) => {
            state.strokeWidth = w;
            board.currentStrokeWidth = w;
            state.showWidthPicker = false;
            for (const el of board.getSelectedElements()) el.strokeWidth = w;
            board.history.push(board.elements);
            board.scheduleSave();
            board.markDirty();
            renderToolbarUI();
            renderPopups();
          });
          popupsEl.appendChild(popup);
        }

        if (state.showExport) {
          const popup = createExportPopup();
          popupsEl.appendChild(popup);
        }
      }

      function createColorPopup(colors, current, onSelect) {
        const popup = document.createElement('div');
        popup.className = 'wb-popup wb-color-picker';

        const header = document.createElement('div');
        header.className = 'wb-popup-header';
        header.innerHTML = '<span>颜色</span>';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'wb-popup-close';
        closeBtn.textContent = '×';
        closeBtn.onclick = () => { state.showColorPicker = false; state.showFillPicker = false; renderPopups(); };
        header.appendChild(closeBtn);
        popup.appendChild(header);

        const swatches = document.createElement('div');
        swatches.className = 'wb-swatches';
        for (const c of colors) {
          const s = document.createElement('button');
          s.className = 'wb-swatch' + (c === current ? ' active' : '');
          s.style.background = c || 'transparent';
          s.onclick = () => onSelect(c);
          swatches.appendChild(s);
        }
        popup.appendChild(swatches);
        return popup;
      }

      function createWidthPopup(widths, current, onSelect) {
        const popup = document.createElement('div');
        popup.className = 'wb-popup wb-width-picker';

        const header = document.createElement('div');
        header.className = 'wb-popup-header';
        header.innerHTML = '<span>线宽</span>';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'wb-popup-close';
        closeBtn.textContent = '×';
        closeBtn.onclick = () => { state.showWidthPicker = false; renderPopups(); };
        header.appendChild(closeBtn);
        popup.appendChild(header);

        const options = document.createElement('div');
        options.className = 'wb-width-options';
        for (const w of widths) {
          const opt = document.createElement('button');
          opt.className = 'wb-width-option' + (w === current ? ' active' : '');
          const bar = document.createElement('span');
          bar.style.cssText = `display:block;width:40px;height:${Math.min(w, 8)}px;background:#333;border-radius:2px;`;
          const label = document.createElement('span');
          label.className = 'wb-width-label';
          label.textContent = w + 'px';
          opt.appendChild(bar);
          opt.appendChild(label);
          opt.onclick = () => onSelect(w);
          options.appendChild(opt);
        }
        popup.appendChild(options);
        return popup;
      }

      function createExportPopup() {
        const overlay = document.createElement('div');
        overlay.className = 'wb-export-overlay';
        overlay.onclick = (e) => { if (e.target === overlay) { state.showExport = false; renderPopups(); } };

        const dialog = document.createElement('div');
        dialog.className = 'wb-export-dialog';

        const header = document.createElement('div');
        header.className = 'wb-export-header';
        header.innerHTML = '<span>导出</span>';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'wb-popup-close';
        closeBtn.textContent = '×';
        closeBtn.onclick = () => { state.showExport = false; renderPopups(); };
        header.appendChild(closeBtn);
        dialog.appendChild(header);

        const options = document.createElement('div');
        options.className = 'wb-export-options';

        const exports = [
          { icon: '🖼', label: '导出为 PNG', fn: () => exportPng() },
          { icon: '📷', label: '导出为 JPG', fn: () => exportJpg() },
          { icon: '{ }', label: '导出为 JSON', fn: () => exportJson() },
        ];

        for (const exp of exports) {
          const btn = document.createElement('button');
          btn.className = 'wb-export-btn';
          btn.innerHTML = `<span class="wb-export-icon">${exp.icon}</span><span>${exp.label}</span>`;
          btn.onclick = () => { exp.fn(); state.showExport = false; renderPopups(); };
          options.appendChild(btn);
        }

        dialog.appendChild(options);
        overlay.appendChild(dialog);
        return overlay;
      }

      function exportPng() {
        const bounds = board.getWorldBounds(board.elements);
        if (!bounds) { ctx.ui.notify('画布为空', 'warn'); return; }
        const pad = 20;
        const off = document.createElement('canvas');
        off.width = bounds.width + pad * 2;
        off.height = bounds.height + pad * 2;
        const c = off.getContext('2d');
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, off.width, off.height);
        c.translate(-bounds.x + pad, -bounds.y + pad);
        const origCtx = board.renderer.ctx;
        board.renderer.ctx = c;
        for (const el of board.elements) { c.save(); c.globalAlpha = el.opacity ?? 1; board.renderer.renderElement(el); c.restore(); }
        board.renderer.ctx = origCtx;
        off.toBlob(blob => { if (blob) { downloadBlob(blob, 'whiteboard.png'); ctx.ui.notify('PNG 导出完成'); } });
      }

      function exportJpg() {
        const bounds = board.getWorldBounds(board.elements);
        if (!bounds) { ctx.ui.notify('画布为空', 'warn'); return; }
        const pad = 20;
        const off = document.createElement('canvas');
        off.width = bounds.width + pad * 2;
        off.height = bounds.height + pad * 2;
        const c = off.getContext('2d');
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, off.width, off.height);
        c.translate(-bounds.x + pad, -bounds.y + pad);
        const origCtx = board.renderer.ctx;
        board.renderer.ctx = c;
        for (const el of board.elements) { c.save(); c.globalAlpha = el.opacity ?? 1; board.renderer.renderElement(el); c.restore(); }
        board.renderer.ctx = origCtx;
        off.toBlob(blob => { if (blob) { downloadBlob(blob, 'whiteboard.jpg'); ctx.ui.notify('JPG 导出完成'); } }, 'image/jpeg');
      }

      function exportJson() {
        const data = { version: 1, elements: board.elements, viewport: board.viewport.serialize(), background: '#ffffff' };
        downloadText(JSON.stringify(data, null, 2), 'whiteboard.json');
        ctx.ui.notify('JSON 导出完成');
      }

      function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
      }

      function downloadText(text, filename) {
        downloadBlob(new Blob([text], { type: 'application/json' }), filename);
      }

      function showConfirm(message) {
        return new Promise(resolve => {
          const overlay = document.createElement('div');
          overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:100;';
          const dialog = document.createElement('div');
          dialog.style.cssText = 'background:#fff;border-radius:12px;padding:24px;min-width:280px;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.18);text-align:center;font-family:var(--font-sans,-apple-system,BlinkMacSystemFont,sans-serif);';
          const msg = document.createElement('p');
          msg.style.cssText = 'margin:0 0 20px;font-size:14px;color:#333;line-height:1.5;';
          msg.textContent = message;
          const btns = document.createElement('div');
          btns.style.cssText = 'display:flex;gap:10px;justify-content:center;';
          const cancelBtn = document.createElement('button');
          cancelBtn.textContent = '取消';
          cancelBtn.style.cssText = 'padding:8px 24px;border:1px solid #ddd;border-radius:8px;background:#fff;color:#666;font-size:13px;cursor:pointer;transition:background 0.15s;';
          cancelBtn.onmouseenter = () => cancelBtn.style.background = '#f5f5f5';
          cancelBtn.onmouseleave = () => cancelBtn.style.background = '#fff';
          const okBtn = document.createElement('button');
          okBtn.textContent = '确定';
          okBtn.style.cssText = 'padding:8px 24px;border:none;border-radius:8px;background:#e53935;color:#fff;font-size:13px;cursor:pointer;transition:background 0.15s;';
          okBtn.onmouseenter = () => okBtn.style.background = '#c62828';
          okBtn.onmouseleave = () => okBtn.style.background = '#e53935';
          cancelBtn.onclick = () => { overlay.remove(); resolve(false); };
          okBtn.onclick = () => { overlay.remove(); resolve(true); };
          overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } };
          btns.appendChild(cancelBtn);
          btns.appendChild(okBtn);
          dialog.appendChild(msg);
          dialog.appendChild(btns);
          overlay.appendChild(dialog);
          document.body.appendChild(overlay);
          cancelBtn.focus();
        });
      }

      function updateStatusBar() {
        if (!statusbarEl) return;
        const toolNames = {
          select: '选择', pen: '画笔', marker: '马克笔', highlighter: '荧光笔',
          eraser: '橡皮擦', rectangle: '矩形', ellipse: '椭圆', diamond: '菱形',
          line: '线段', arrow: '箭头', text: '文本', image: '图片',
        };
        statusbarEl.innerHTML = '';

        const left = document.createElement('span');
        left.textContent = (toolNames[state.activeTool] || state.activeTool) + ' | ' + (board ? board.elements.length + ' 元素' : '');
        statusbarEl.appendChild(left);

        const right = document.createElement('span');
        right.className = 'wb-statusbar-right';

        const zoomOut = document.createElement('button');
        zoomOut.className = 'wb-zoom-btn';
        zoomOut.title = '缩小 (Ctrl+-)';
        zoomOut.textContent = '−';
        zoomOut.onclick = () => { if (board) board.zoomOut(); };
        right.appendChild(zoomOut);

        const zoomLabel = document.createElement('span');
        zoomLabel.className = 'wb-zoom-label';
        zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
        right.appendChild(zoomLabel);

        const zoomIn = document.createElement('button');
        zoomIn.className = 'wb-zoom-btn';
        zoomIn.title = '放大 (Ctrl+=)';
        zoomIn.textContent = '+';
        zoomIn.onclick = () => { if (board) board.zoomIn(); };
        right.appendChild(zoomIn);

        const zoomReset = document.createElement('button');
        zoomReset.className = 'wb-zoom-btn';
        zoomReset.title = '重置缩放 (Ctrl+0)';
        zoomReset.textContent = '1:1';
        zoomReset.onclick = () => { if (board) { board.viewport.reset(); board.markDirty(); } };
        right.appendChild(zoomReset);

        statusbarEl.appendChild(right);
      }

      onUnmounted(() => {
        cleanupTextEdit();
        if (board) {
          board.save();
          board.dispose();
          board._disposed = true;
        }
      });

      // Render function returns only the root container — Vue never touches internals
      return () => {
        return h('div', { ref: rootRef, class: 'whiteboard-plugin' });
      };
    },
  };

  return { component, dispose() {} };
}
