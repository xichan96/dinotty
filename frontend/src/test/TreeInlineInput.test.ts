import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { TreeInlineInput } from '../components/workspace/TreeRows'

describe('TreeInlineInput', () => {
  it('prefills the initial value', () => {
    const wrapper = mount(TreeInlineInput, { props: { initialValue: 'main.ts' } })
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('main.ts')
  })

  it('shows the inline error and re-arms Enter after a failed commit', async () => {
    const wrapper = mount(TreeInlineInput, {
      props: { initialValue: 'a.ts', error: '' },
    })
    const input = wrapper.find('input')
    await input.setValue('b.ts')

    await input.trigger('keydown', { key: 'Enter' })
    const commits = wrapper.emitted('commit') ?? []
    expect(commits[commits.length - 1]).toEqual(['b.ts'])

    // The parent keeps the row mounted and passes the failure back.
    await wrapper.setProps({ error: 'That name is already taken' })
    expect(wrapper.find('.tree-inline-error').text()).toBe('That name is already taken')

    // A second Enter must commit again instead of being swallowed by the
    // "already finished" guard.
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('commit')?.length).toBe(2)
  })
})
