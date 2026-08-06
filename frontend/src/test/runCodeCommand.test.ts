import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useTreeContextMenu } from '../composables/useTreeContextMenu'
import { buildRunCodeCommand, isRunnableCodeFile } from '../utils/runCodeCommand'

describe('run code commands', function runCodeCommandSuite() {
  it('recognizes directly runnable source files', function recognizesRunnableFiles() {
    // 步骤1：确认常见脚本和单文件源码会显示运行入口。
    const runnablePaths = [
      'hello.py',
      'hello.js',
      'hello.tsx',
      'hello.sh',
      'hello.ps1',
      'hello.go',
      'Hello.java',
      'hello.rb',
      'hello.php',
      'hello.lua',
      'hello.pl',
      'hello.r',
      'hello.swift',
      'hello.dart',
    ]
    for (let pathIndex = 0; pathIndex < runnablePaths.length; pathIndex += 1) {
      expect(isRunnableCodeFile(runnablePaths[pathIndex])).toBe(true)
    }

    // 步骤2：文档、数据和二进制文件不显示运行入口。
    expect(isRunnableCodeFile('notes.md')).toBe(false)
    expect(isRunnableCodeFile('data.csv')).toBe(false)
    expect(isRunnableCodeFile('program.exe')).toBe(false)
  })

  it('builds commands for PowerShell, cmd, and Unix shells', function buildsShellCommands() {
    // 步骤1：PowerShell 使用单引号路径，并用调用运算符执行脚本。
    expect(buildRunCodeCommand('C:\\Work Files\\hello.py', 'powershell')).toBe(
      "python 'C:\\Work Files\\hello.py'"
    )
    expect(buildRunCodeCommand('C:\\Work Files\\setup.ps1', 'powershell')).toBe(
      "& 'C:\\Work Files\\setup.ps1'"
    )

    // 步骤2：cmd 使用双引号路径，并通过 call 执行批处理文件。
    expect(buildRunCodeCommand('C:\\Work Files\\hello.py', 'cmd')).toBe(
      'python "C:\\Work Files\\hello.py"'
    )
    expect(buildRunCodeCommand('C:\\Work Files\\setup.cmd', 'cmd')).toBe(
      'call "C:\\Work Files\\setup.cmd"'
    )

    // 步骤3：Unix 和 SSH 终端使用对应解释器与 POSIX 路径引用。
    expect(buildRunCodeCommand('/home/user/hello world.py', 'bash')).toBe(
      "python3 '/home/user/hello world.py'"
    )
    expect(buildRunCodeCommand('/home/user/app.tsx', 'ssh')).toBe('npx tsx /home/user/app.tsx')
    expect(buildRunCodeCommand('/home/user/data.csv', 'bash')).toBeNull()
  })

  it('normalizes Windows extended paths before running code', function normalizesExtendedPaths() {
    // 步骤1：移除本地扩展路径前缀，并把混用的正斜杠统一为反斜杠。
    const extendedLocalPath =
      '\\\\?\\D:\\BaiduSyncdisk\\obsidian笔记AI版/知识网络/教程/教程配套代码/analyzer.py'
    expect(buildRunCodeCommand(extendedLocalPath, 'powershell')).toBe(
      "python 'D:\\BaiduSyncdisk\\obsidian笔记AI版\\知识网络\\教程\\教程配套代码\\analyzer.py'"
    )

    // 步骤2：扩展 UNC 路径恢复为普通网络共享路径。
    const extendedNetworkPath = '\\\\?\\UNC\\server\\share/scripts/report.py'
    expect(buildRunCodeCommand(extendedNetworkPath, 'cmd')).toBe(
      'python "\\\\server\\share\\scripts\\report.py"'
    )

    // 步骤3：Unix 路径保持原样，不应用 Windows 规则。
    expect(buildRunCodeCommand('/home/user/scripts/report.py', 'bash')).toBe(
      'python3 /home/user/scripts/report.py'
    )
  })

  it('uses PowerShell rules for a Windows path before shell metadata arrives', function infersWindowsShell() {
    // 步骤1：模拟终端刚连接、shell 类型还没有写回 Pane 的瞬间。
    const command = buildRunCodeCommand(
      'C:\\Users\\Administrator\\Desktop\\新建文件夹 (5)\\generate_sample_data.py',
      ''
    )

    // 步骤2：Windows 路径仍应使用 python 和 PowerShell 引号规则。
    expect(command).toBe(
      "python 'C:\\Users\\Administrator\\Desktop\\新建文件夹 (5)\\generate_sample_data.py'"
    )
  })

  it('does not generate Windows workspace commands for WSL terminals', function rejectsWslPath() {
    expect(buildRunCodeCommand('C:\\Work Files\\hello.py', 'wsl')).toBeNull()
  })
})

describe('tree run code action', function treeRunCodeActionSuite() {
  it('dispatches the selected file path to the active terminal', function dispatchesRunEvent() {
    // 步骤1：创建文件树右键菜单所需的最小状态。
    const selectedRel = ref<string | null>(null)
    const selectedIsDir = ref(false)
    const meta = ref<{ kind: string } | null>(null)
    const editorDirty = ref(false)
    const editorText = ref('')
    const editorBaseline = ref('')
    const childCache = ref({})
    const expanded = ref(new Set<string>())
    const inlineCreate = ref<{ parentRel: string; kind: 'file' | 'dir' } | null>(null)
    const inlineRename = ref<{ rel: string; isDir: boolean } | null>(null)
    const narrow = ref(false)

    function absolutePath(relativePath: string): string {
      return `/workspace/${relativePath}`
    }
    function parentRelPath(): string {
      return ''
    }
    async function ensureChildren(): Promise<void> {}
    async function deleteSelected(): Promise<boolean> {
      return true
    }
    async function onSelectFile(): Promise<void> {}
    function onSelectDir(): void {}
    function triggerUpload(): void {}
    async function downloadFile(): Promise<void> {}
    function translate(key: string): string {
      return key
    }

    const contextMenu = useTreeContextMenu({
      selectedRel,
      selectedIsDir,
      meta,
      editorDirty,
      editorText,
      editorBaseline,
      childCache,
      expanded,
      inlineCreate,
      inlineRename,
      narrow,
      absolutePath,
      parentRelPath,
      ensureChildren,
      deleteSelected,
      onSelectFile,
      onSelectDir,
      triggerUpload,
      downloadFile,
      paneId: () => 'test-pane',
      t: translate,
    })

    // 步骤2：在 Python 文件上打开右键菜单并执行“运行代码”。
    const eventListener = vi.fn()
    window.addEventListener('terminal-run-code', eventListener)
    contextMenu.onTreeContextMenu({
      ev: new MouseEvent('contextmenu', { clientX: 20, clientY: 30 }),
      rel: 'scripts/hello.py',
      isDir: false,
    })
    const runCodeContextMenu = contextMenu as typeof contextMenu & { ctxRunCode: () => void }
    runCodeContextMenu.ctxRunCode()

    // 步骤3：事件携带绝对路径，且菜单已关闭。
    expect(eventListener).toHaveBeenCalledOnce()
    const runEvent = eventListener.mock.calls[0][0] as CustomEvent<{ path: string }>
    expect(runEvent.detail.path).toBe('/workspace/scripts/hello.py')
    expect(contextMenu.contextMenu.value).toBeNull()
    window.removeEventListener('terminal-run-code', eventListener)
  })
})
