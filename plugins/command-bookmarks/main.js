export function activate(ctx) {
  const h = ctx.h

  const bookmarks = ctx.ref([])
  const selectedPanes = ctx.ref(new Set())
  const editingId = ctx.ref(null)
  const editName = ctx.ref('')
  const editCommand = ctx.ref('')
  const addMode = ctx.ref(false)
  const newName = ctx.ref('')
  const newCommand = ctx.ref('')
  const sendFeedback = ctx.ref(null)

  async function loadBookmarks() {
    try {
      const data = await ctx.storage.get('bookmarks')
      bookmarks.value = data || []
    } catch {
      bookmarks.value = []
    }
  }

  async function saveBookmarks() {
    await ctx.storage.set('bookmarks', bookmarks.value)
  }

  function addBookmark() {
    const name = newName.value.trim()
    const command = newCommand.value.trim()
    if (!name || !command) return
    bookmarks.value = [...bookmarks.value, { id: Date.now().toString(), name, command }]
    newName.value = ''
    newCommand.value = ''
    addMode.value = false
    saveBookmarks()
  }

  function removeBookmark(id) {
    bookmarks.value = bookmarks.value.filter(b => b.id !== id)
    saveBookmarks()
  }

  function startEdit(bm) {
    editingId.value = bm.id
    editName.value = bm.name
    editCommand.value = bm.command
  }

  function saveEdit(id) {
    const name = editName.value.trim()
    const command = editCommand.value.trim()
    if (!name || !command) return
    bookmarks.value = bookmarks.value.map(b =>
      b.id === id ? { ...b, name, command } : b
    )
    editingId.value = null
    saveBookmarks()
  }

  function cancelEdit() {
    editingId.value = null
  }

  function togglePane(id) {
    const s = new Set(selectedPanes.value)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    selectedPanes.value = s
  }

  function selectAllPanes(panes) {
    selectedPanes.value = new Set(panes.map(p => p.id))
  }

  function deselectAllPanes() {
    selectedPanes.value = new Set()
  }

  function sendToTerminals(command) {
    const targets = selectedPanes.value
    if (targets.size === 0) {
      ctx.ui.notify('请先选择目标终端', 'warn')
      return
    }
    for (const paneId of targets) {
      ctx.terminal.send(paneId, command + '\n')
    }
    sendFeedback.value = `已发送到 ${targets.size} 个终端`
    setTimeout(() => { sendFeedback.value = null }, 1500)
  }

  function moveBookmark(index, direction) {
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= bookmarks.value.length) return
    const arr = [...bookmarks.value]
    ;[arr[index], arr[newIndex]] = [arr[newIndex], arr[index]]
    bookmarks.value = arr
    saveBookmarks()
  }

  loadBookmarks()

  ctx.commands.register('command-bookmarks.open', () => {})

  ctx.commands.registerQuickPick('command-bookmarks.quick', {
    title: 'Command Bookmarks',
    async items() {
      const data = await ctx.storage.get('bookmarks')
      const bms = data || []
      return bms.map(bm => ({
        label: bm.name,
        detail: bm.command,
        icon: '★',
        action() {
          const paneId = ctx.terminal.activePaneId()
          if (!paneId) {
            ctx.ui.notify('没有活动终端', 'warn')
            return
          }
          ctx.terminal.send(paneId, bm.command + '\n')
        },
      }))
    },
  })

  return {
    component: {
      render() {
        const panes = ctx.terminal.listPanes()
        const selected = selectedPanes.value
        const allSelected = panes.length > 0 && panes.every(p => selected.has(p.id))

        return h('div', { class: 'cb-root' }, [

          // Header
          h('div', { class: 'cb-header' }, [
            h('h2', { class: 'cb-title' }, 'Command Bookmarks'),
            sendFeedback.value
              ? h('span', { class: 'cb-feedback' }, sendFeedback.value)
              : null,
          ].filter(Boolean)),

          h('div', { class: 'cb-layout' }, [

            // Left: bookmarks list
            h('div', { class: 'cb-panel cb-panel-main' }, [
              h('div', { class: 'cb-panel-header' }, [
                h('span', { class: 'cb-panel-title' }, '收藏命令'),
                h('span', { class: 'cb-count' }, `${bookmarks.value.length} 条`),
                h('button', {
                  class: 'cb-btn cb-btn-primary',
                  onClick: () => { addMode.value = !addMode.value },
                }, addMode.value ? '取消' : '+ 添加'),
              ]),

              // Add form
              addMode.value ? h('div', { class: 'cb-add-form' }, [
                h('input', {
                  class: 'cb-input',
                  placeholder: '命令名称',
                  value: newName.value,
                  onInput: e => { newName.value = e.target.value },
                  onKeydown: e => { if (e.key === 'Enter') document.querySelector('.cb-cmd-input')?.focus() },
                }),
                h('textarea', {
                  class: 'cb-textarea cb-cmd-input',
                  placeholder: '命令内容（支持多行）',
                  value: newCommand.value,
                  rows: 3,
                  onInput: e => { newCommand.value = e.target.value },
                  onKeydown: e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addBookmark()
                  },
                }),
                h('div', { class: 'cb-add-actions' }, [
                  h('button', { class: 'cb-btn cb-btn-primary', onClick: addBookmark }, '保存'),
                  h('span', { class: 'cb-hint' }, 'Ctrl/Cmd+Enter 快速保存'),
                ]),
              ]) : null,

              // Bookmark items
              h('div', { class: 'cb-list' },
                bookmarks.value.length === 0 && !addMode.value
                  ? [h('div', { class: 'cb-empty' }, '暂无收藏命令，点击 "+ 添加" 开始')]
                  : bookmarks.value.map((bm, idx) => {
                    const isEditing = editingId.value === bm.id

                    if (isEditing) {
                      return h('div', { key: bm.id, class: 'cb-item cb-item-editing' }, [
                        h('input', {
                          class: 'cb-input',
                          value: editName.value,
                          onInput: e => { editName.value = e.target.value },
                        }),
                        h('textarea', {
                          class: 'cb-textarea',
                          value: editCommand.value,
                          rows: 3,
                          onInput: e => { editCommand.value = e.target.value },
                          onKeydown: e => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit(bm.id)
                          },
                        }),
                        h('div', { class: 'cb-item-actions' }, [
                          h('button', { class: 'cb-btn cb-btn-primary', onClick: () => saveEdit(bm.id) }, '保存'),
                          h('button', { class: 'cb-btn cb-btn-ghost', onClick: cancelEdit }, '取消'),
                        ]),
                      ])
                    }

                    return h('div', { key: bm.id, class: 'cb-item' }, [
                      h('div', { class: 'cb-item-top' }, [
                        h('span', { class: 'cb-item-name' }, bm.name),
                        h('div', { class: 'cb-item-actions' }, [
                          idx > 0
                            ? h('button', { class: 'cb-btn cb-btn-icon', onClick: () => moveBookmark(idx, -1), title: '上移' }, '↑')
                            : null,
                          idx < bookmarks.value.length - 1
                            ? h('button', { class: 'cb-btn cb-btn-icon', onClick: () => moveBookmark(idx, 1), title: '下移' }, '↓')
                            : null,
                          h('button', { class: 'cb-btn cb-btn-ghost', onClick: () => startEdit(bm) }, '编辑'),
                          h('button', { class: 'cb-btn cb-btn-danger', onClick: () => removeBookmark(bm.id) }, '删除'),
                          h('button', {
                            class: 'cb-btn cb-btn-primary',
                            onClick: () => sendToTerminals(bm.command),
                            disabled: selected.size === 0,
                          }, '发送'),
                        ].filter(Boolean)),
                      ]),
                      h('pre', { class: 'cb-item-cmd' }, bm.command),
                    ])
                  })
              ),
            ]),

            // Right: terminal selector
            h('div', { class: 'cb-panel cb-panel-side' }, [
              h('div', { class: 'cb-panel-header' }, [
                h('span', { class: 'cb-panel-title' }, '目标终端'),
                panes.length > 0
                  ? h('button', {
                    class: 'cb-btn cb-btn-ghost',
                    onClick: () => { allSelected ? deselectAllPanes() : selectAllPanes(panes) },
                  }, allSelected ? '取消全选' : '全选')
                  : null,
              ].filter(Boolean)),

              panes.length === 0
                ? h('div', { class: 'cb-empty' }, '没有打开的终端')
                : h('div', { class: 'cb-pane-list' },
                  panes.map(p =>
                    h('label', {
                      key: p.id,
                      class: 'cb-pane-item' + (selected.has(p.id) ? ' cb-pane-selected' : ''),
                    }, [
                      h('input', {
                        type: 'checkbox',
                        class: 'cb-checkbox',
                        checked: selected.has(p.id),
                        onChange: () => togglePane(p.id),
                      }),
                      h('span', { class: 'cb-pane-title' }, p.title || 'Terminal'),
                      p.active ? h('span', { class: 'cb-pane-badge' }, 'active') : null,
                    ].filter(Boolean))
                  )
                ),
            ]),
          ]),
        ])
      },
    },
  }
}
