import { describe, expect, it, vi } from 'vitest'
import {
  formatWindowTitle,
  setTauriWindowTitle,
  updateDocumentTitle,
} from '../utils/windowTitle'

describe('window title', () => {
  it('updates the title when the active workspace changes', () => {
    const target = { title: '' }

    updateDocumentTitle('Default', target)
    expect(target.title).toBe('Dinotty - Default')

    updateDocumentTitle('Project Atlas', target)
    expect(target.title).toBe('Dinotty - Project Atlas')
  })

  it('uses the application name when the workspace name is empty', () => {
    expect(formatWindowTitle()).toBe('Dinotty')
    expect(formatWindowTitle('   ')).toBe('Dinotty')
  })

  it('falls back to the window API when the command fails', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('command unavailable')
    })
    const setTitle = vi.fn(async () => {})

    await setTauriWindowTitle('Dinotty - Project Atlas', invoke, () => ({ setTitle }))

    expect(invoke).toHaveBeenCalledWith('set_window_title', {
      title: 'Dinotty - Project Atlas',
    })
    expect(setTitle).toHaveBeenCalledWith('Dinotty - Project Atlas')
  })

  it('absorbs synchronous fallback errors and rejected title updates', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('command unavailable')
    })

    await expect(
      setTauriWindowTitle('Dinotty', invoke, () => {
        throw new Error('window API unavailable')
      })
    ).resolves.toBeUndefined()

    await expect(
      setTauriWindowTitle('Dinotty', invoke, () => ({
        setTitle: () => Promise.reject(new Error('title update failed')),
      }))
    ).resolves.toBeUndefined()
  })
})
