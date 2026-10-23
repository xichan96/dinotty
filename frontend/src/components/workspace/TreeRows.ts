import { defineComponent, ref, h, onMounted, nextTick, watch } from 'vue'
import type { VNode } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { setInternalDrag, clearInternalDrag } from '../../composables/internalDragState'

function hasType(dt: DataTransfer | undefined | null, type: string): boolean {
  if (!dt) return false
  const t = dt.types
  return t.includes ? t.includes(type) : (t as any).contains(type)
}

export interface DirEntry {
  name: string
  is_dir: boolean
  size: number
}

export function treeFolderIcon(expanded: boolean): VNode {
  const d = expanded
    ? 'M2 5h5l1 1h7v7H2V5zm1 1v6h10V7H8L7 6H3z'
    : 'M2 4h4.5l1 1H14v9H2V4zm1 1v8h10V7H8l-1-1H3z'
  return h('span', { class: ['tree-kind-icon', 'tree-kind-icon-folder', { open: expanded }] }, [
    h(
      'svg',
      { viewBox: '0 0 16 16', class: 'tree-svg', fill: 'currentColor', 'aria-hidden': 'true' },
      [h('path', { d })]
    ),
  ])
}

const DEFAULT_FILE_ICON_COLOR = '#9aa0a6'

// Same palette as the UX prototype (file-tree-ux.html). No extra icon assets:
// only the fill of the existing document glyph changes.
const FILE_EXT_COLORS: Record<string, string> = {
  ts: '#6fa8dc',
  tsx: '#6fa8dc',
  js: '#d6c85a',
  jsx: '#d6c85a',
  mjs: '#d6c85a',
  cjs: '#d6c85a',
  vue: '#41b883',
  rs: '#dea584',
  json: '#cbcb41',
  md: '#8cb4d9',
  mdx: '#8cb4d9',
  css: '#a074c4',
  scss: '#a074c4',
  sass: '#a074c4',
  less: '#a074c4',
  html: '#e37933',
  htm: '#e37933',
  toml: '#9c6b3f',
  yml: '#c97b63',
  yaml: '#c97b63',
  svg: '#e9b35a',
  png: '#b78fd6',
  jpg: '#b78fd6',
  jpeg: '#b78fd6',
  gif: '#b78fd6',
  webp: '#b78fd6',
  ico: '#b78fd6',
  py: '#3572a5',
  go: '#00add8',
  java: '#b07219',
  sh: '#89e051',
  bash: '#89e051',
  zsh: '#89e051',
  lock: '#8a8a8a',
  gitignore: '#8a8a8a',
}

function fileIconColor(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1)
  if (base === '.gitignore') return FILE_EXT_COLORS.gitignore
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return DEFAULT_FILE_ICON_COLOR
  return FILE_EXT_COLORS[base.slice(dot + 1).toLowerCase()] ?? DEFAULT_FILE_ICON_COLOR
}

export function treeFileIcon(name = ''): VNode {
  return h(
    'span',
    {
      class: 'tree-kind-icon tree-kind-icon-file',
      style: name ? { color: fileIconColor(name) } : undefined,
    },
    [
      h(
        'svg',
        { viewBox: '0 0 16 16', class: 'tree-svg', fill: 'currentColor', 'aria-hidden': 'true' },
        [
          h('path', {
            d: 'M4 2h5.2L13 5.8V14H4V2zm1 1v10h7V6.5H8.5L9 6 8 5H5zm5.2 0L12 5.8h-2V3h-.8z',
          }),
        ]
      ),
    ]
  )
}

/** One 1px vertical rule per ancestor level; rows carry their own depth. */
export function treeGuides(depth: number): VNode | null {
  if (depth <= 0) return null
  return h(
    'span',
    { class: 'tree-guides', 'aria-hidden': 'true' },
    Array.from({ length: depth }, (_, i) => h('i', { key: i }))
  )
}

export function absJoinWorkspaceRoot(root: string, rel: string): string {
  const r = root.replace(/[/\\]+$/, '')
  if (!rel) return r
  const parts = rel.split('/').filter(Boolean)
  if (/^[A-Za-z]:[\\/]/.test(r)) {
    return r + '\\' + parts.join('\\')
  }
  return r + '/' + parts.join('/')
}

// --- Drag-and-drop helpers -------------------------------------------------
// TreeRows recurses, so the hover timer and the auto-scroll loop must live at
// module scope: the row being hovered can belong to a different recursion
// instance than the row being dragged.

const HOVER_EXPAND_MS = 600
const AUTOSCROLL_EDGE_PX = 24

let hoverExpandTimer: ReturnType<typeof setTimeout> | null = null
let hoverExpandRel: string | null = null
let dragCleanupInstalled = false

function clearHoverExpand() {
  if (hoverExpandTimer) clearTimeout(hoverExpandTimer)
  hoverExpandTimer = null
  hoverExpandRel = null
}

function scheduleHoverExpand(rel: string, isExpanded: boolean, expand: () => void) {
  if (isExpanded) {
    clearHoverExpand()
    return
  }
  if (hoverExpandRel === rel && hoverExpandTimer) return
  clearHoverExpand()
  hoverExpandRel = rel
  hoverExpandTimer = setTimeout(() => {
    hoverExpandTimer = null
    hoverExpandRel = null
    expand()
  }, HOVER_EXPAND_MS)
}

let autoScrollFrame: number | null = null
let autoScrollEl: HTMLElement | null = null
let autoScrollSpeed = 0

function findScrollContainer(el: HTMLElement): HTMLElement | null {
  const wrap = el.closest('.file-workspace-tree-wrap')
  if (wrap instanceof HTMLElement) return wrap
  let node = el.parentElement
  while (node) {
    const overflowY = getComputedStyle(node).overflowY
    if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight) return node
    node = node.parentElement
  }
  return null
}

function stopAutoScroll() {
  if (autoScrollFrame !== null) cancelAnimationFrame(autoScrollFrame)
  autoScrollFrame = null
  autoScrollEl = null
  autoScrollSpeed = 0
}

function autoScrollTick() {
  autoScrollFrame = null
  if (!autoScrollEl) return
  autoScrollEl.scrollTop += autoScrollSpeed
  autoScrollFrame = requestAnimationFrame(autoScrollTick)
}

function updateAutoScroll(clientY: number, sourceEl: HTMLElement) {
  const container = findScrollContainer(sourceEl)
  if (!container) {
    stopAutoScroll()
    return
  }
  const rect = container.getBoundingClientRect()
  let speed = 0
  if (clientY < rect.top + AUTOSCROLL_EDGE_PX) {
    speed = -Math.ceil((rect.top + AUTOSCROLL_EDGE_PX - clientY) / 4)
  } else if (clientY > rect.bottom - AUTOSCROLL_EDGE_PX) {
    speed = Math.ceil((clientY - (rect.bottom - AUTOSCROLL_EDGE_PX)) / 4)
  }
  if (!speed) {
    stopAutoScroll()
    return
  }
  autoScrollEl = container
  autoScrollSpeed = Math.max(-18, Math.min(18, speed))
  if (autoScrollFrame === null) autoScrollFrame = requestAnimationFrame(autoScrollTick)
}

function installDragCleanup() {
  if (dragCleanupInstalled) return
  dragCleanupInstalled = true
  const cleanup = () => {
    clearHoverExpand()
    stopAutoScroll()
  }
  document.addEventListener('dragend', cleanup, true)
  document.addEventListener('drop', cleanup, true)
}

function leftElement(ev: DragEvent): boolean {
  const to = ev.relatedTarget as Node | null
  return !to || !(ev.currentTarget as HTMLElement).contains(to)
}

export const TreeInlineInput = defineComponent({
  name: 'TreeInlineInput',
  props: {
    placeholder: { type: String, default: '' },
    /** Prefilled text (rename starts with the current name). */
    initialValue: { type: String, default: '' },
    /** Commit failed: keep the row mounted and show this next to the input. */
    error: { type: String, default: '' },
  },
  emits: ['commit', 'cancel'],
  setup(props, { emit }) {
    const model = ref(props.initialValue)
    const inputRef = ref<HTMLInputElement | null>(null)
    const composing = ref(false)
    // Once a decision is made the input is about to unmount; a trailing blur
    // must not emit a second commit/cancel pair.
    let finished = false
    // A failed async commit re-arms the input so Enter/blur can retry.
    watch(
      () => props.error,
      (err) => {
        if (err) finished = false
      }
    )
    onMounted(() =>
      nextTick(() => {
        const el = inputRef.value
        if (!el) return
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      })
    )

    function commit() {
      if (finished) return
      finished = true
      const name = model.value.trim()
      if (name) emit('commit', name)
      else emit('cancel')
    }

    function cancel() {
      if (finished) return
      finished = true
      emit('cancel')
    }

    return () =>
      h('span', { class: 'tree-inline-field' }, [
        h('input', {
          ref: inputRef,
          class: 'tree-inline-input',
          type: 'text',
          autocomplete: 'off',
          spellcheck: false,
          placeholder: props.placeholder,
          value: model.value,
          onInput: (e: Event) => {
            model.value = (e.target as HTMLInputElement).value
          },
          onCompositionstart: () => {
            composing.value = true
          },
          onCompositionend: (e: CompositionEvent) => {
            composing.value = false
            model.value = (e.target as HTMLInputElement).value
          },
          onKeydown: (e: KeyboardEvent) => {
            // Enter/Escape while an IME candidate window is open belongs to the
            // IME, not to us — committing here would submit a half-typed name.
            if (composing.value || e.isComposing) return
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          },
          onBlur: () => {
            if (composing.value) return
            commit()
          },
        }),
        props.error
          ? h('span', { class: 'tree-inline-error', title: props.error }, props.error)
          : null,
      ])
  },
})

export const TreeRows = defineComponent({
  name: 'TreeRows',
  props: {
    paneId: { type: String, required: true },
    depth: { type: Number, required: true },
    relPath: { type: String, required: true },
    workspaceRoot: { type: String, default: '' },
    cache: { type: Object, required: true },
    expanded: { type: Object, required: true },
    selectedRel: { type: String, default: undefined },
    /** Row currently targeted by the context menu; shown with a dashed
     *  outline that is independent of the blue selection. */
    ctxTargetRel: { type: String, default: undefined },
    inlineCreate: { type: Object, default: null },
    inlinePlaceholder: { type: String, default: '' },
    inlineRename: { type: Object, default: undefined },
    gitStatus: { type: Object, default: () => ({}) },
  },
  emits: [
    'toggle',
    'select-file',
    'select-dir',
    'inline-create-commit',
    'inline-create-cancel',
    'inline-rename-commit',
    'inline-rename-cancel',
    'context-menu',
    'long-press',
    'move-entry',
    'swipe-action',
    'upload-to-dir',
  ],
  setup(p, { emit }) {
    const { t } = useI18n()
    const swipedRel = ref<string | null>(null)

    function getGitBadge(rel: string, isDir: boolean): { badge: string; cls: string } | null {
      const gs = p.gitStatus as Record<string, string>
      if (!gs || Object.keys(gs).length === 0) return null
      if (!isDir) {
        const status = gs[rel]
        if (!status) return null
        switch (status) {
          case 'modified':
          case 'staged_modified':
            return { badge: 'M', cls: 'git-modified' }
          case 'untracked':
            return { badge: 'U', cls: 'git-untracked' }
          case 'staged_new':
            return { badge: 'A', cls: 'git-untracked' }
          case 'deleted':
          case 'staged_deleted':
            return { badge: 'D', cls: 'git-deleted' }
          default:
            return { badge: 'M', cls: 'git-modified' }
        }
      }
      const prefix = rel ? rel + '/' : ''
      for (const path of Object.keys(gs)) {
        if (path.startsWith(prefix)) return { badge: '', cls: 'git-modified' }
      }
      return null
    }

    // One gesture recognizer per row: a left swipe reveals the action buttons,
    // a still hold opens the context menu. Mutually exclusive by design — once
    // the long press fires, movement no longer turns the gesture into a swipe.
    function makeTouchHandlers(rel: string, isDir: boolean) {
      const LONG_PRESS_MS = 500
      const MOVE_CANCEL_PX = 10
      const SWIPE_THRESHOLD = 30
      let timer: ReturnType<typeof setTimeout> | null = null
      let startX = 0
      let startY = 0
      let longPressFired = false
      let swiping = false

      function clearTimer() {
        if (timer) clearTimeout(timer)
        timer = null
      }

      return {
        onTouchstart: (e: TouchEvent) => {
          if (e.touches.length !== 1) return
          clearTimer()
          const touch = e.touches[0]
          startX = touch.clientX
          startY = touch.clientY
          longPressFired = false
          swiping = false
          timer = setTimeout(() => {
            timer = null
            longPressFired = true
            emit('long-press', { clientX: startX, clientY: startY }, rel, isDir)
          }, LONG_PRESS_MS)
        },
        onTouchmove: (e: TouchEvent) => {
          if (e.touches.length !== 1) return
          if (longPressFired) return
          const touch = e.touches[0]
          const dx = touch.clientX - startX
          const dy = touch.clientY - startY
          if (timer && (Math.abs(dx) > MOVE_CANCEL_PX || Math.abs(dy) > MOVE_CANCEL_PX)) {
            clearTimer()
          }
          if (!swiping && dx < -SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 2) {
            swiping = true
            swipedRel.value = rel
          }
          if (swiping) e.preventDefault()
        },
        onTouchend: (e: TouchEvent) => {
          clearTimer()
          if (swiping || longPressFired) e.preventDefault()
          swiping = false
        },
        onTouchcancel: () => {
          clearTimer()
          swiping = false
        },
      }
    }

    return () => {
      const entries = (p.cache as Record<string, DirEntry[]>)[p.relPath]
      const isRoot = p.relPath === ''
      if (entries === undefined && !isRoot && !(p.expanded as Set<string>).has(p.relPath)) {
        return null
      }
      const rows: ReturnType<typeof h>[] = []
      // Indentation comes from rendered guide spans, not padding, so each
      // level's 1px rule lines up with the content that follows it.
      const rowPad = { paddingLeft: 'var(--tree-base-hpad)' }
      const stateRow = (kind: 'loading' | 'empty') =>
        h(
          'div',
          {
            class: ['tree-state-row', `tree-state-row-${kind}`],
            key: `__state_${kind}__`,
            style: rowPad,
          },
          [
            treeGuides(p.depth),
            h('span', { class: 'tree-twistie-placeholder' }),
            h(
              'span',
              { class: 'tree-state-icon' },
              kind === 'loading' ? [h('span', { class: 'tree-state-spinner' })] : []
            ),
            h(
              'span',
              { class: 'tree-state-text' },
              kind === 'loading' ? t('filePreview.loading') : t('filePreview.emptyFolder')
            ),
          ]
        )
      const ic = p.inlineCreate as {
        parentRel: string
        kind: 'file' | 'dir'
        value?: string
        error?: string
      } | null
      if (ic && ic.parentRel === p.relPath) {
        rows.push(
          h('div', { class: 'tree-row tree-inline-create', key: '__ic__', style: rowPad }, [
            treeGuides(p.depth),
            h('span', { class: 'tree-twistie-placeholder' }),
            h(TreeInlineInput, {
              placeholder: p.inlinePlaceholder as string,
              initialValue: ic.value ?? '',
              error: ic.error ?? '',
              onCommit: (name: string) => emit('inline-create-commit', name),
              onCancel: () => emit('inline-create-cancel'),
            }),
          ])
        )
      }
      if (entries === undefined) {
        rows.push(stateRow('loading'))
      } else if (entries.length === 0) {
        rows.push(stateRow('empty'))
      }
      const ir = p.inlineRename as
        | { rel: string; isDir: boolean; value?: string; error?: string }
        | undefined
      for (const e of entries ?? []) {
        const rel = p.relPath ? `${p.relPath}/${e.name}` : e.name
        const isExp = (p.expanded as Set<string>).has(rel)
        const isRenaming = !!(ir && ir.rel === rel)
        const gitInfo = getGitBadge(rel, e.is_dir)
        if (e.is_dir) {
          const labelContent = isRenaming
            ? h(TreeInlineInput, {
                placeholder: e.name,
                initialValue: ir?.value ?? e.name,
                error: ir?.error ?? '',
                onCommit: (name: string) => emit('inline-rename-commit', name),
                onCancel: () => emit('inline-rename-cancel'),
              })
            : h('span', { class: ['tree-label', { sel: p.selectedRel === rel }] }, [
                h('span', { class: 'tree-label-text' }, e.name),
                // Directories report changes with a dot; the label itself
                // keeps the normal foreground (prototype behaviour).
                gitInfo
                  ? h('span', { class: 'tree-dir-dot', title: t('filePreview.modified') })
                  : null,
              ])
          rows.push(
            h(
              'div',
              {
                class: [
                  'tree-row',
                  'dir',
                  {
                    'tree-row-swipe': !isRenaming && swipedRel.value === rel,
                    'ctx-target': p.ctxTargetRel === rel,
                  },
                ],
                key: rel,
                style: rowPad,
                draggable: true,
                'data-rel': rel,
                ...makeTouchHandlers(rel, true),
                onContextmenu: (ev: MouseEvent) => {
                  ev.preventDefault()
                  ev.stopPropagation()
                  emit('context-menu', { ev, rel, isDir: true })
                },
                onDragstart: (ev: DragEvent) => {
                  ev.dataTransfer?.setData('application/x-tree-move', rel)
                  const root = p.workspaceRoot as string
                  if (root) {
                    ev.dataTransfer?.setData('text/plain', absJoinWorkspaceRoot(root, rel))
                  }
                  ev.dataTransfer!.effectAllowed = 'copyMove'
                  setInternalDrag(rel)
                },
                onDragend: () => {
                  clearHoverExpand()
                  stopAutoScroll()
                  setTimeout(clearInternalDrag, 200)
                },
                onDragover: (ev: DragEvent) => {
                  if (hasType(ev.dataTransfer, 'application/x-tree-move')) {
                    ev.preventDefault()
                    ev.dataTransfer!.dropEffect = 'move'
                    ;(ev.currentTarget as HTMLElement).classList.add('drop-target')
                  } else if (hasType(ev.dataTransfer, 'Files')) {
                    ev.preventDefault()
                    ev.dataTransfer!.dropEffect = 'copy'
                    ;(ev.currentTarget as HTMLElement).classList.add('drop-target-upload')
                  } else {
                    return
                  }
                  installDragCleanup()
                  scheduleHoverExpand(rel, isExp, () => emit('toggle', rel))
                },
                onDragleave: (ev: DragEvent) => {
                  ;(ev.currentTarget as HTMLElement).classList.remove(
                    'drop-target',
                    'drop-target-upload'
                  )
                  if (leftElement(ev)) {
                    if (hoverExpandRel === rel) clearHoverExpand()
                  }
                },
                onDrop: (ev: DragEvent) => {
                  clearHoverExpand()
                  stopAutoScroll()
                  ev.preventDefault()
                  ev.stopPropagation()
                  ;(ev.currentTarget as HTMLElement).classList.remove(
                    'drop-target',
                    'drop-target-upload'
                  )
                  if (hasType(ev.dataTransfer, 'application/x-tree-move')) {
                    const srcRel = ev.dataTransfer?.getData('application/x-tree-move')
                    if (srcRel && srcRel !== rel && !rel.startsWith(srcRel + '/')) {
                      emit('move-entry', { src: srcRel, destDir: rel })
                    }
                  } else if (hasType(ev.dataTransfer, 'Files')) {
                    emit('upload-to-dir', rel, ev)
                  }
                },
              },
              [
                treeGuides(p.depth),
                h(
                  'button',
                  {
                    type: 'button',
                    class: ['tree-twistie', { open: isExp }],
                    onClick: () => emit('toggle', rel),
                  },
                  isExp ? '▼' : '▶'
                ),
                h(
                  'span',
                  {
                    class: 'tree-folder-hit',
                    onClick: () => {
                      emit('toggle', rel)
                      emit('select-dir', rel)
                    },
                  },
                  [treeFolderIcon(isExp), labelContent]
                ),
                !isRenaming
                  ? h('div', { class: 'tree-swipe-actions' }, [
                      h(
                        'button',
                        {
                          type: 'button',
                          class: 'tree-swipe-btn',
                          onClick: (ev: Event) => {
                            ev.stopPropagation()
                            emit('swipe-action', { rel, action: 'copy-path' })
                          },
                        },
                        t('filePreview.copyPath')
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          class: 'tree-swipe-btn tree-swipe-btn-accent',
                          onClick: (ev: Event) => {
                            ev.stopPropagation()
                            emit('swipe-action', { rel, action: 'insert-to-terminal' })
                          },
                        },
                        t('filePreview.insertToTerminal')
                      ),
                    ])
                  : null,
              ]
            )
          )
          if (isExp) {
            rows.push(
              h(TreeRows, {
                paneId: p.paneId,
                depth: p.depth + 1,
                relPath: rel,
                workspaceRoot: p.workspaceRoot,
                cache: p.cache,
                expanded: p.expanded,
                selectedRel: p.selectedRel,
                ctxTargetRel: p.ctxTargetRel,
                inlineCreate: p.inlineCreate,
                inlinePlaceholder: p.inlinePlaceholder,
                inlineRename: p.inlineRename,
                gitStatus: p.gitStatus,
                onToggle: (x: string) => emit('toggle', x),
                onSelectFile: (x: string) => emit('select-file', x),
                onSelectDir: (x: string) => emit('select-dir', x),
                onInlineCreateCommit: (x: string) => emit('inline-create-commit', x),
                onInlineCreateCancel: () => emit('inline-create-cancel'),
                onInlineRenameCommit: (x: string) => emit('inline-rename-commit', x),
                onInlineRenameCancel: () => emit('inline-rename-cancel'),
                onContextMenu: (payload: { ev: MouseEvent; rel: string; isDir: boolean }) =>
                  emit('context-menu', payload),
                onLongPress: (
                  pos: { clientX: number; clientY: number },
                  rel: string,
                  isDir: boolean
                ) => emit('long-press', pos, rel, isDir),
                onMoveEntry: (payload: { src: string; destDir: string }) =>
                  emit('move-entry', payload),
                onSwipeAction: (payload: { rel: string; action: string }) =>
                  emit('swipe-action', payload),
                onUploadToDir: (dir: string, ev: DragEvent) => emit('upload-to-dir', dir, ev),
              })
            )
          }
        } else {
          const fileLabelContent = isRenaming
            ? h(TreeInlineInput, {
                placeholder: e.name,
                initialValue: ir?.value ?? e.name,
                error: ir?.error ?? '',
                onCommit: (name: string) => emit('inline-rename-commit', name),
                onCancel: () => emit('inline-rename-cancel'),
              })
            : h(
                'span',
                {
                  class: ['tree-label', gitInfo?.cls, { sel: p.selectedRel === rel }],
                },
                [
                  h('span', { class: 'tree-label-text' }, e.name),
                  gitInfo?.badge
                    ? h('span', { class: `tree-git-badge git-${gitInfo.badge}` }, gitInfo.badge)
                    : null,
                ]
              )
          rows.push(
            h(
              'div',
              {
                class: [
                  'tree-row',
                  'file',
                  {
                    'tree-row-swipe': !isRenaming && swipedRel.value === rel,
                    'ctx-target': p.ctxTargetRel === rel,
                  },
                ],
                key: rel,
                style: rowPad,
                draggable: true,
                'data-rel': rel,
                ...makeTouchHandlers(rel, false),
                onContextmenu: (ev: MouseEvent) => {
                  ev.preventDefault()
                  ev.stopPropagation()
                  emit('context-menu', { ev, rel, isDir: false })
                },
                onDragstart: (ev: DragEvent) => {
                  ev.dataTransfer?.setData('application/x-tree-move', rel)
                  const root = p.workspaceRoot as string
                  if (root) {
                    ev.dataTransfer?.setData('text/plain', absJoinWorkspaceRoot(root, rel))
                  }
                  ev.dataTransfer!.effectAllowed = 'copyMove'
                  setInternalDrag(rel)
                },
                onDragend: () => {
                  clearHoverExpand()
                  stopAutoScroll()
                  setTimeout(clearInternalDrag, 200)
                },
              },
              [
                h(
                  'span',
                  {
                    class: 'tree-file-hit',
                    onClick: isRenaming ? undefined : () => emit('select-file', rel),
                  },
                  [
                    treeGuides(p.depth),
                    h('span', { class: 'tree-twistie-placeholder' }),
                    treeFileIcon(e.name),
                    fileLabelContent,
                  ]
                ),
                !isRenaming
                  ? h('div', { class: 'tree-swipe-actions' }, [
                      h(
                        'button',
                        {
                          type: 'button',
                          class: 'tree-swipe-btn',
                          onClick: (ev: Event) => {
                            ev.stopPropagation()
                            emit('swipe-action', { rel, action: 'copy-path' })
                          },
                        },
                        t('filePreview.copyPath')
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          class: 'tree-swipe-btn tree-swipe-btn-accent',
                          onClick: (ev: Event) => {
                            ev.stopPropagation()
                            emit('swipe-action', { rel, action: 'insert-to-terminal' })
                          },
                        },
                        t('filePreview.insertToTerminal')
                      ),
                    ])
                  : null,
              ]
            )
          )
        }
      }
      let bgLongPressTimer: ReturnType<typeof setTimeout> | null = null
      let bgLongPressFired = false
      let bgStartX = 0
      let bgStartY = 0

      return h(
        'div',
        {
          class: 'tree-rows',
          onDragover: (ev: DragEvent) => {
            if (hasType(ev.dataTransfer, 'application/x-tree-move')) {
              ev.preventDefault()
              ev.dataTransfer!.dropEffect = 'move'
            } else if (hasType(ev.dataTransfer, 'Files')) {
              ev.preventDefault()
              ev.dataTransfer!.dropEffect = 'copy'
            } else {
              return
            }
            if (p.depth === 0) {
              installDragCleanup()
              updateAutoScroll(ev.clientY, ev.currentTarget as HTMLElement)
            }
          },
          onDragleave: (ev: DragEvent) => {
            if (p.depth !== 0 || !leftElement(ev)) return
            clearHoverExpand()
            stopAutoScroll()
          },
          onDrop: (ev: DragEvent) => {
            clearHoverExpand()
            stopAutoScroll()
            ev.preventDefault()
            const srcRel = ev.dataTransfer?.getData('application/x-tree-move')
            if (srcRel !== undefined && srcRel.includes('/')) {
              emit('move-entry', { src: srcRel, destDir: '' })
            } else if (hasType(ev.dataTransfer, 'Files')) {
              emit('upload-to-dir', '', ev)
            }
          },
          onContextmenu: (ev: MouseEvent) => {
            if (ev.target === ev.currentTarget) {
              ev.preventDefault()
              ev.stopPropagation()
              emit('context-menu', { ev, rel: '', isDir: true })
            }
          },
          onTouchstart: (e: TouchEvent) => {
            if (e.target !== e.currentTarget || e.touches.length !== 1) return
            const touch = e.touches[0]
            bgStartX = touch.clientX
            bgStartY = touch.clientY
            bgLongPressFired = false
            bgLongPressTimer = setTimeout(() => {
              bgLongPressFired = true
              emit('long-press', { clientX: bgStartX, clientY: bgStartY }, '', true)
            }, 500)
          },
          onTouchmove: (e: TouchEvent) => {
            if (!bgLongPressTimer) return
            const touch = e.touches[0]
            if (
              Math.abs(touch.clientX - bgStartX) > 10 ||
              Math.abs(touch.clientY - bgStartY) > 10
            ) {
              clearTimeout(bgLongPressTimer)
              bgLongPressTimer = null
            }
          },
          onTouchend: (e: TouchEvent) => {
            if (bgLongPressTimer) clearTimeout(bgLongPressTimer)
            bgLongPressTimer = null
            if (bgLongPressFired) e.preventDefault()
          },
          onTouchcancel: () => {
            if (bgLongPressTimer) clearTimeout(bgLongPressTimer)
            bgLongPressTimer = null
          },
        },
        rows
      )
    }
  },
})
