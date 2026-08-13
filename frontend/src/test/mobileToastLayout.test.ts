import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { POSITION } from 'vue-toastification'
import { resolveResponsiveToastPosition } from '../utils/toastPosition'

describe('mobile toast layout', () => {
  it('pins every mobile toast container to a safe top-center viewport slot', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/base.css'), 'utf8')
    const mobileRule = css.slice(css.indexOf('@media (max-width: 768px)'))

    expect(mobileRule).toContain('top: max(12px, env(safe-area-inset-top)) !important')
    expect(mobileRule).toContain('bottom: auto !important')
    expect(mobileRule).toContain('left: 50% !important')
    expect(mobileRule).toContain('transform: translateX(-50%)')
    expect(mobileRule).toContain('width: min(420px, calc(100vw - 24px)) !important')
    expect(mobileRule).toContain('overflow-wrap: anywhere')
    expect(mobileRule).not.toContain('width: 33.33vw')
  })

  it('routes explicit mobile positions into the default container without changing desktop', () => {
    expect(resolveResponsiveToastPosition(POSITION.BOTTOM_CENTER, 390)).toBe(POSITION.TOP_RIGHT)
    expect(resolveResponsiveToastPosition(POSITION.BOTTOM_CENTER, 1024)).toBe(
      POSITION.BOTTOM_CENTER
    )
  })
})
