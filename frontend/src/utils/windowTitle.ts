type TitleTarget = { title: string }

interface TauriWindow {
  setTitle?: (title: string) => void | Promise<void>
}

export function formatWindowTitle(workspaceName?: string): string {
  return workspaceName?.trim() || 'Dinotty'
}

export function updateDocumentTitle(
  workspaceName?: string,
  target: TitleTarget = document
): string {
  const title = formatWindowTitle(workspaceName)
  target.title = title
  return title
}

export async function setTauriWindowTitle(
  title: string,
  invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>,
  getCurrentWindow: () => TauriWindow | undefined
): Promise<void> {
  try {
    await invoke('set_window_title', { title })
    return
  } catch {}

  try {
    await getCurrentWindow()?.setTitle?.(title)
  } catch {}
}
