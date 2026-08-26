import { describe, expect, it } from 'vitest'

// @ts-expect-error build-seed is an executable ESM script without a TypeScript declaration file.
import { assertNoHostGlobalSelectors } from '../keyboard/builtin-keyboard/build-seed.mjs'

describe('builtin keyboard seed host-global CSS tripwire', () => {
  it('accepts realistic scoped SFC rules', () => {
    const css = `
      .suggestion-bar[data-v-d0382cf6] { display: flex; }
      .keyboard[data-v-d0382cf6] .key[data-v-d0382cf6] { min-width: 2rem; }
      @media (max-width: 600px) {
        .suggestion[data-v-d0382cf6]:is(.active, .wide) { color: var(--text-color); }
      }
    `

    expect(() => assertNoHostGlobalSelectors(css)).not.toThrow()
  })

  it.each([
    ['#system-mobile-kb', '#system-mobile-kb { position: relative; }'],
    ['#mobile-kb', '#mobile-kb { display: grid; }'],
    ['#app-root', '#app-root { min-height: 100%; }'],
    ['html', 'html { font-size: 16px; }'],
    ['body', 'body { margin: 0; }'],
    [':root', ':root { --keyboard-height: 18rem; }'],
  ])('rejects the host-global token %s and names it', (token, css) => {
    expect(() => assertNoHostGlobalSelectors(css)).toThrowError(
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    )
  })

  it('collects and names every host-global token found', () => {
    const css = '#system-mobile-kb, #mobile-kb, #app-root, html, body, :root { color: red; }'

    expect(() => assertNoHostGlobalSelectors(css)).toThrowError(
      /#system-mobile-kb, #mobile-kb, #app-root, :root, html, body/
    )
  })

  it.each(['.x[data-v-a1]{width:calc(2 * 1px)}', '.x[data-v-a1]{width:calc(2*1px)}'])(
    'accepts calc multiplication: %s',
    (css) => {
      expect(() => assertNoHostGlobalSelectors(css)).not.toThrow()
    }
  )

  it.each([
    '.x[data-v-a1]{background:url(body-bg.png)}',
    '.x[data-v-a1]{background:url(html-icon.svg)}',
  ])('ignores host-global tokens in unquoted URLs: %s', (css) => {
    expect(() => assertNoHostGlobalSelectors(css)).not.toThrow()
  })

  it('still rejects a body rule after stripping an unquoted URL containing body', () => {
    const css = '.x[data-v-a1]{background:url(body-bg.png)} body { margin: 0 }'

    expect(() => assertNoHostGlobalSelectors(css)).toThrowError(/body/)
  })

  it('does not match html or body inside longer CSS identifiers', () => {
    const css = `
      .mkb-body[data-v-a1] { display: flex; }
      .x[data-v-a1] { --html-safe: 1; }
    `

    expect(() => assertNoHostGlobalSelectors(css)).not.toThrow()
  })

  it('ignores host-global tokens that appear only inside strings', () => {
    expect(() => assertNoHostGlobalSelectors('.x[data-v-a1] { content: "body"; }')).not.toThrow()
  })

  it('still rejects a body rule after stripping a string containing body', () => {
    const css = '.x[data-v-a1] { content: "body"; } body { margin: 0; }'

    expect(() => assertNoHostGlobalSelectors(css)).toThrowError(/body/)
  })

  it.each([
    String.raw`.key\,wide[data-v-a1] { color: red; }`,
    '.key[data-v-a1] {}' + '\\',
    String.raw`.key[data-v-a1] { content: "safe\"; }`,
  ])('accepts escape edge cases: %s', (css) => {
    expect(() => assertNoHostGlobalSelectors(css)).not.toThrow()
  })

  it('accepts a custom mixin block', () => {
    expect(() =>
      assertNoHostGlobalSelectors('@mixin --theme { --payload: { red }; }')
    ).not.toThrow()
  })

  it('ignores html and body inside comments', () => {
    const css = '/* html { color: red; } body { margin: 0; } */ .x[data-v-a1] { color: blue; }'

    expect(() => assertNoHostGlobalSelectors(css)).not.toThrow()
  })

  it('rejects a host-global rule nested inside @media', () => {
    const css = '@media (max-width: 600px) { #mobile-kb { display: block; } }'

    expect(() => assertNoHostGlobalSelectors(css)).toThrowError(/#mobile-kb/)
  })

  it('rejects a host-global rule nested inside @keyframes', () => {
    const css = '@keyframes reveal { from { opacity: 0; } body { opacity: 1; } }'

    expect(() => assertNoHostGlobalSelectors(css)).toThrowError(/body/)
  })
})
