import { shellEscapePath } from './shell'

function fileExtension(filePath: string): string {
  // 步骤1：只读取最后一个路径片段，兼容 Windows 和 Unix 分隔符。
  const normalizedPath = filePath.replace(/\\/g, '/')
  const lastSeparatorIndex = normalizedPath.lastIndexOf('/')
  const fileName = normalizedPath.slice(lastSeparatorIndex + 1)

  // 步骤2：提取最后一个扩展名并统一为小写。
  const lastDotIndex = fileName.lastIndexOf('.')
  if (lastDotIndex <= 0 || lastDotIndex === fileName.length - 1) return ''
  return fileName.slice(lastDotIndex + 1).toLocaleLowerCase()
}

export function isRunnableCodeFile(filePath: string): boolean {
  // 步骤1：按扩展名判断是否可以用常见解释器直接运行。
  const extension = fileExtension(filePath)
  switch (extension) {
    case 'py':
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'ts':
    case 'mts':
    case 'cts':
    case 'jsx':
    case 'tsx':
    case 'sh':
    case 'ps1':
    case 'bat':
    case 'cmd':
    case 'go':
    case 'java':
    case 'rb':
    case 'php':
    case 'lua':
    case 'pl':
    case 'r':
    case 'swift':
    case 'dart':
      return true
    default:
      return false
  }
}

function quotePowerShellPath(filePath: string): string {
  // 步骤1：PowerShell 单引号字符串通过重复单引号转义。
  const escapedPath = filePath.replace(/'/g, "''")
  return `'${escapedPath}'`
}

function quoteCmdPath(filePath: string): string {
  // 步骤1：Windows 文件名不能包含双引号，直接用双引号包住完整路径。
  return `"${filePath}"`
}

function normalizeWindowsRunPath(filePath: string): string {
  // 步骤1：Windows 命令参数统一使用反斜杠，避免扩展路径混用分隔符。
  const normalizedPath = filePath.replace(/\//g, '\\')

  // 步骤2：扩展 UNC 路径恢复为普通网络共享路径。
  const extendedNetworkPrefix = '\\\\?\\UNC\\'
  if (normalizedPath.startsWith(extendedNetworkPrefix)) {
    return `\\\\${normalizedPath.slice(extendedNetworkPrefix.length)}`
  }

  // 步骤3：本地扩展路径移除 Windows API 专用前缀。
  const extendedLocalPrefix = '\\\\?\\'
  if (normalizedPath.startsWith(extendedLocalPrefix)) {
    return normalizedPath.slice(extendedLocalPrefix.length)
  }

  // 步骤4：普通 Windows 路径只保留分隔符规范化结果。
  return normalizedPath
}

function isWindowsRunPath(filePath: string): boolean {
  // 步骤1：盘符绝对路径和 UNC 路径都只能在 Windows shell 中直接运行。
  return /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\')
}

function quotedPathForShell(filePath: string, shellType: string): string {
  // 步骤1：根据活动终端的 shell 使用对应路径引用方式。
  if (shellType === 'powershell') return quotePowerShellPath(filePath)
  if (shellType === 'cmd') return quoteCmdPath(filePath)
  return shellEscapePath(filePath)
}

export function buildRunCodeCommand(filePath: string, shellType: string): string | null {
  // 步骤1：不支持的文件不生成任何终端命令。
  const extension = fileExtension(filePath)
  if (!isRunnableCodeFile(filePath)) return null
  if (shellType === 'wsl') return null

  // 步骤2：shell 元数据尚未到达时，根据绝对路径识别 Windows 本地终端。
  const effectiveShellType = shellType || (isWindowsRunPath(filePath) ? 'powershell' : '')
  const windowsShell = effectiveShellType === 'powershell' || effectiveShellType === 'cmd'
  const commandPath = windowsShell ? normalizeWindowsRunPath(filePath) : filePath
  const quotedPath = quotedPathForShell(commandPath, effectiveShellType)

  // 步骤3：脚本类文件使用对应解释器直接运行。
  switch (extension) {
    case 'py':
      return `${windowsShell ? 'python' : 'python3'} ${quotedPath}`
    case 'js':
    case 'mjs':
    case 'cjs':
      return `node ${quotedPath}`
    case 'ts':
    case 'mts':
    case 'cts':
    case 'jsx':
    case 'tsx':
      return `npx tsx ${quotedPath}`
    case 'sh':
      return `bash ${quotedPath}`
    case 'ps1':
      if (effectiveShellType === 'powershell') return `& ${quotedPath}`
      if (effectiveShellType === 'cmd') {
        return `powershell -ExecutionPolicy Bypass -File ${quotedPath}`
      }
      return `pwsh -File ${quotedPath}`
    case 'bat':
    case 'cmd':
      if (effectiveShellType === 'powershell') return `& ${quotedPath}`
      if (effectiveShellType === 'cmd') return `call ${quotedPath}`
      return `cmd.exe /c ${quotedPath}`
    case 'go':
      return `go run ${quotedPath}`
    case 'java':
      return `java ${quotedPath}`
    case 'rb':
      return `ruby ${quotedPath}`
    case 'php':
      return `php ${quotedPath}`
    case 'lua':
      return `lua ${quotedPath}`
    case 'pl':
      return `perl ${quotedPath}`
    case 'r':
      return `Rscript ${quotedPath}`
    case 'swift':
      return `swift ${quotedPath}`
    case 'dart':
      return `dart ${quotedPath}`
    default:
      return null
  }
}
