<template>
  <div ref="containerRef" class="monaco-editor-wrap"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as monaco from 'monaco-editor'
import { onThemeChange } from '../../composables/useSettings'
import { registerLanguageCompletions } from './languageCompletions'
import { initBuiltInDiagnostics } from './languageDiagnostics'
import { useSyntaxCheck } from './useSyntaxCheck'
import {
  applyGitDecorations,
  clearGitDecorations,
  fetchGitDiff,
  stageLines,
  revertLines,
  createDiffWidget,
  findChangeAtLine,
  type GitChange,
  type GitDiffData,
} from './gitDecorations'
import { registerEditor, unregisterEditor } from '../../composables/useEditorRegistry'

const props = withDefaults(
  defineProps<{
    modelValue: string
    language?: string
    readonly?: boolean
    filePath?: string
    paneId?: string
    leafId?: string
  }>(),
  { language: 'plaintext', readonly: false }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  save: []
  'selection-change': [payload: { text: string; rect: DOMRect | null }]
}>()

const containerRef = ref<HTMLElement | null>(null)
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let ignoreChange = false
let gitDecorationIds: string[] = []
let gitDiffData: GitDiffData | null = null
let activeDiffWidget: { dispose: () => void } | null = null
let scheduleCheck: (
  paneId: string | undefined,
  filePath: string | undefined,
  language: string
) => void = () => {}
let disposeSyntaxCheck: () => void = () => {}
let lastSelectionText = ''

function getTheme(): string {
  const root = document.documentElement
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim()
  if (!bg) return 'vs-dark'
  const r = parseInt(bg.slice(1, 3), 16) || 0
  const g = parseInt(bg.slice(3, 5), 16) || 0
  const b = parseInt(bg.slice(5, 7), 16) || 0
  return (r + g + b) / 3 < 128 ? 'vs-dark' : 'vs'
}

onMounted(() => {
  if (!containerRef.value) return
  editor = monaco.editor.create(containerRef.value, {
    value: props.modelValue,
    language: props.language,
    theme: getTheme(),
    readOnly: props.readonly,
    minimap: { enabled: true },
    glyphMargin: false,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    fontSize: 13,
    lineNumbers: 'on',
    wordWrap: 'on',
    quickSuggestions: true,
    suggestOnTriggerCharacters: true,
    tabSize: 2,
    renderWhitespace: 'selection',
    overviewRulerLanes: 3,
    hideCursorInOverviewRuler: true,
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  })

  editor.onDidChangeModelContent(() => {
    if (ignoreChange) return
    const val = editor!.getValue()
    emit('update:modelValue', val)
    scheduleCheck(props.paneId, props.filePath, props.language)
  })

  if (props.leafId) {
    registerEditor(props.leafId, editor)
  }

  registerLanguageCompletions(props.language)

  initBuiltInDiagnostics()
  const syntaxCheck = useSyntaxCheck(editor)
  scheduleCheck = syntaxCheck.scheduleCheck
  disposeSyntaxCheck = syntaxCheck.dispose

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    emit('save')
  })

  editor.onMouseDown((e) => {
    if (
      (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
        e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS) &&
      gitDiffData?.changes.length &&
      e.target.position
    ) {
      const line = e.target.position.lineNumber
      const change = findChangeAtLine(gitDiffData.changes, line)
      if (change) openDiffWidget(change)
    }
  })

  editor.onDidChangeCursorSelection((e) => {
    const sel = e.selection
    if (!sel.isEmpty()) {
      const model = editor!.getModel()
      if (!model) {
        if (lastSelectionText) {
          lastSelectionText = ''
          emit('selection-change', { text: '', rect: null })
        }
        return
      }
      const text = model.getValueInRange(sel)
      if (!text) {
        if (lastSelectionText) {
          lastSelectionText = ''
          emit('selection-change', { text: '', rect: null })
        }
        return
      }
      if (text === lastSelectionText) return
      lastSelectionText = text
      const endLine = sel.endLineNumber
      const endCol = sel.endColumn
      const visiblePos = editor!.getScrolledVisiblePosition({ lineNumber: endLine, column: endCol })
      if (!visiblePos) {
        emit('selection-change', { text, rect: null })
        return
      }
      const editorDom = editor!.getDomNode()
      if (!editorDom) {
        emit('selection-change', { text, rect: null })
        return
      }
      const editorRect = editorDom.getBoundingClientRect()
      const x = editorRect.left + visiblePos.left
      const y = editorRect.top + visiblePos.top + visiblePos.height
      emit('selection-change', { text, rect: new DOMRect(x, y, 0, 0) })
    } else {
      if (lastSelectionText) {
        lastSelectionText = ''
        emit('selection-change', { text: '', rect: null })
      }
    }
  })

  loadGitDecorations()
})

const unsubTheme = onThemeChange(() => {
  if (editor) {
    monaco.editor.setTheme(getTheme())
  }
})

async function loadGitDecorations() {
  if (!editor || !props.filePath || !props.paneId) return
  clearGitDecorations(editor, gitDecorationIds)
  gitDecorationIds = []
  gitDiffData = null
  const data = await fetchGitDiff(props.paneId, props.filePath)
  if (!data || !data.isGitRepo || !editor) return
  gitDiffData = data
  gitDecorationIds = applyGitDecorations(editor, data.changes)
}

function closeDiffWidget() {
  if (activeDiffWidget) {
    activeDiffWidget.dispose()
    activeDiffWidget = null
  }
}

function openDiffWidget(change: GitChange) {
  if (!editor || !gitDiffData?.originalContent) return
  closeDiffWidget()
  activeDiffWidget = createDiffWidget(
    editor,
    change,
    gitDiffData.originalContent,
    gitDiffData.changes,
    {
      onStage: async (c) => {
        if (!props.paneId || !props.filePath) return
        const ok = await stageLines(props.paneId, props.filePath, c.modifiedStart, c.modifiedEnd)
        if (ok) {
          closeDiffWidget()
          await loadGitDecorations()
        }
      },
      onRevert: async (c) => {
        if (!props.paneId || !props.filePath || !gitDiffData?.originalContent) return
        const origLines = gitDiffData.originalContent.split('\n')
        const start = (c.originalStart ?? 1) - 1
        const end = c.originalEnd ?? start
        const lines = origLines.slice(start, end).join('\n')
        const ok = await revertLines(
          props.paneId,
          props.filePath,
          c.modifiedStart,
          c.modifiedEnd,
          lines
        )
        if (ok) {
          closeDiffWidget()
          emit('save')
        }
      },
      onClose: closeDiffWidget,
      onNavigate: (c) => openDiffWidget(c),
    }
  )
}

onBeforeUnmount(() => {
  disposeSyntaxCheck()
  closeDiffWidget()
  unsubTheme()
  if (props.leafId) {
    unregisterEditor(props.leafId)
  }
  editor?.dispose()
  editor = null
})

watch(
  () => props.modelValue,
  (val) => {
    if (!editor) return
    if (editor.getValue() === val) return
    ignoreChange = true
    editor.setValue(val)
    ignoreChange = false
    scheduleCheck(props.paneId, props.filePath, props.language)
  }
)

watch(
  () => props.language,
  (lang) => {
    if (!editor) return
    registerLanguageCompletions(lang)
    const model = editor.getModel()
    if (model) monaco.editor.setModelLanguage(model, lang)
    scheduleCheck(props.paneId, props.filePath, lang)
  }
)

watch(
  () => props.readonly,
  (ro) => {
    editor?.updateOptions({ readOnly: ro })
  }
)

watch(
  () => props.filePath,
  () => {
    closeDiffWidget()
    loadGitDecorations()
    scheduleCheck(props.paneId, props.filePath, props.language)
  }
)

defineExpose({
  refreshGitDecorations: loadGitDecorations,
  getEditor: () => editor,
})
</script>

<style scoped>
.monaco-editor-wrap {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
</style>
