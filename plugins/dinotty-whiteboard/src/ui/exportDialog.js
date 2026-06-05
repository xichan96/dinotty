import { exportAsJson, canvasToBlob, downloadBlob, downloadText } from '../utils/export.js';

export function renderExportDialog(h, board, onClose) {
  async function exportPng() {
    const elements = board.elements;
    const bounds = board.getWorldBounds(elements);
    if (!bounds) {
      board.pluginCtx.ui.notify('画布为空', 'warn');
      return;
    }

    const padding = 20;
    const offscreen = document.createElement('canvas');
    offscreen.width = bounds.width + padding * 2;
    offscreen.height = bounds.height + padding * 2;
    const ctx = offscreen.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);
    ctx.translate(-bounds.x + padding, -bounds.y + padding);

    // Render each element using a temporary renderer
    const tempRenderer = {
      ctx,
      renderElement: board.renderer.renderElement.bind(board.renderer),
    };
    const origCtx = board.renderer.ctx;
    board.renderer.ctx = ctx;
    for (const el of elements) {
      ctx.save();
      ctx.globalAlpha = el.opacity ?? 1;
      board.renderer.renderElement(el);
      ctx.restore();
    }
    board.renderer.ctx = origCtx;

    const blob = await canvasToBlob(offscreen);
    if (blob) {
      downloadBlob(blob, 'whiteboard.png');
      board.pluginCtx.ui.notify('PNG 导出完成');
    }
    onClose();
  }

  async function exportJpg() {
    const elements = board.elements;
    const bounds = board.getWorldBounds(elements);
    if (!bounds) {
      board.pluginCtx.ui.notify('画布为空', 'warn');
      return;
    }

    const padding = 20;
    const offscreen = document.createElement('canvas');
    offscreen.width = bounds.width + padding * 2;
    offscreen.height = bounds.height + padding * 2;
    const ctx = offscreen.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);
    ctx.translate(-bounds.x + padding, -bounds.y + padding);

    const origCtx = board.renderer.ctx;
    board.renderer.ctx = ctx;
    for (const el of elements) {
      ctx.save();
      ctx.globalAlpha = el.opacity ?? 1;
      board.renderer.renderElement(el);
      ctx.restore();
    }
    board.renderer.ctx = origCtx;

    const blob = await canvasToBlob(offscreen, 'image/jpeg');
    if (blob) {
      downloadBlob(blob, 'whiteboard.jpg');
      board.pluginCtx.ui.notify('JPG 导出完成');
    }
    onClose();
  }

  function exportJson() {
    const data = {
      version: 1,
      elements: board.elements,
      viewport: board.viewport.serialize(),
      background: '#1e1e1e',
    };
    downloadText(exportAsJson(data), 'whiteboard.json');
    board.pluginCtx.ui.notify('JSON 导出完成');
    onClose();
  }

  return h('div', { class: 'wb-export-overlay', onClick: onClose }, [
    h('div', { class: 'wb-export-dialog', onClick: (e) => e.stopPropagation() }, [
      h('div', { class: 'wb-export-header' }, [
        h('span', null, '导出'),
        h('button', { class: 'wb-popup-close', onClick: onClose }, '×'),
      ]),
      h('div', { class: 'wb-export-options' }, [
        h('button', { class: 'wb-export-btn', onClick: exportPng }, [
          h('span', { class: 'wb-export-icon' }, '🖼'),
          h('span', null, '导出为 PNG'),
        ]),
        h('button', { class: 'wb-export-btn', onClick: exportJpg }, [
          h('span', { class: 'wb-export-icon' }, '📷'),
          h('span', null, '导出为 JPG'),
        ]),
        h('button', { class: 'wb-export-btn', onClick: exportJson }, [
          h('span', { class: 'wb-export-icon' }, '{ }'),
          h('span', null, '导出为 JSON'),
        ]),
      ]),
    ]),
  ]);
}
