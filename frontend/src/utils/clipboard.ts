import { authFetch, apiUrl } from '../composables/apiBase'

function copyViaRange(text: string): void {
  const priorSelection = window.getSelection()
  const savedRanges: Range[] = []
  if (priorSelection) {
    for (let i = 0; i < priorSelection.rangeCount; i++)
      savedRanges.push(priorSelection.getRangeAt(i).cloneRange())
  }
  const span = document.createElement('span')
  span.textContent = text
  span.style.position = 'fixed'
  span.style.opacity = '0'
  span.style.whiteSpace = 'pre'
  document.body.appendChild(span)
  const range = document.createRange()
  range.selectNodeContents(span)
  let ok = false
  try {
    priorSelection?.removeAllRanges()
    priorSelection?.addRange(range)
    ok = document.execCommand('copy')
  } finally {
    priorSelection?.removeAllRanges()
    savedRanges.forEach((r) => priorSelection?.addRange(r))
    span.remove()
  }
  if (!ok) throw new Error('execCommand copy failed')
}

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    copyViaRange(text)
  }
}

export async function readHostClipboard(): Promise<string | null> {
  try {
    const response = await authFetch(apiUrl('/api/clipboard'))
    if (!response.ok) throw new Error('clipboard request failed')
    const body = (await response.json()) as { text?: unknown }
    if (typeof body.text !== 'string') throw new Error('invalid clipboard response')
    return body.text
  } catch {
    return null
  }
}
