import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const pickerMocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
}))

vi.mock('../composables/apiBase', () => ({
  apiUrl: (path: string) => path,
  authFetch: pickerMocks.authFetch,
  getApiBase: async () => '',
}))

vi.mock('../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

import ShellPicker from '../components/settings/ShellPicker.vue'

function probeResponse(shells = baseShells()) {
  return {
    platform: 'windows',
    default_shell: { kind: 'powershell', program: 'C:\\pwsh.exe', distro: null },
    current_selection: { kind: 'auto', distro: null, status: 'available', reason: null },
    shells,
    warnings: [],
  }
}

function baseShells() {
  return [
    { kind: 'powershell', program: 'C:\\pwsh.exe', distro: null },
    { kind: 'wsl', program: 'C:\\Windows\\System32\\wsl.exe', distro: null },
    {
      kind: 'wsl',
      program: 'C:\\Windows\\System32\\wsl.exe',
      distro: 'Ubuntu Dev',
    },
  ]
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('ShellPicker', () => {
  beforeEach(() => pickerMocks.authFetch.mockReset())

  it('does not probe until opened and only renders detected shells after loading', async () => {
    const request = deferred<Response>()
    pickerMocks.authFetch.mockReturnValue(request.promise)
    const wrapper = mount(ShellPicker, { props: { kind: 'auto', distro: null } })

    expect(pickerMocks.authFetch).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="shell-picker-trigger"]').trigger('click')

    expect(pickerMocks.authFetch).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('settings.shellProbe.loading')
    expect(wrapper.text()).not.toContain('settings.shellKind.powershell')

    request.resolve(jsonResponse(probeResponse()))
    await flushPromises()

    expect(wrapper.text()).toContain('settings.shellKind.powershell')
    expect(wrapper.text()).toContain('Ubuntu Dev')
    expect(wrapper.text()).not.toContain('settings.shellKind.bash')
    expect(wrapper.text()).not.toContain('settings.shellProbe.group.automatic')
  })

  it('probes again after each close-to-open transition', async () => {
    pickerMocks.authFetch.mockResolvedValue(jsonResponse(probeResponse()))
    const wrapper = mount(ShellPicker, { props: { kind: 'auto', distro: null } })
    const trigger = wrapper.get('[data-testid="shell-picker-trigger"]')

    await trigger.trigger('click')
    await flushPromises()
    await wrapper.get('[role="listbox"]').trigger('keydown', { key: 'Escape' })
    await trigger.trigger('click')
    await flushPromises()

    expect(pickerMocks.authFetch).toHaveBeenCalledTimes(2)
  })

  it('emits an exact WSL distribution and supports keyboard selection', async () => {
    pickerMocks.authFetch.mockResolvedValue(jsonResponse(probeResponse()))
    const wrapper = mount(ShellPicker, { props: { kind: 'auto', distro: null } })

    await wrapper.get('[data-testid="shell-picker-trigger"]').trigger('click')
    await flushPromises()
    const options = wrapper.findAll('[role="option"]')
    const ubuntuIndex = options.findIndex((option) => option.text().includes('Ubuntu Dev'))
    expect(ubuntuIndex).toBeGreaterThanOrEqual(0)
    const listbox = wrapper.get('[role="listbox"]')
    await listbox.trigger('keydown', { key: 'End' })
    await listbox.trigger('keydown', { key: 'ArrowUp' })
    await listbox.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('select')).toEqual([[{ kind: 'wsl', distro: 'Ubuntu Dev' }]])
  })

  it('only shows named user distributions in the WSL group', async () => {
    pickerMocks.authFetch.mockResolvedValue(
      jsonResponse(
        probeResponse([
          ...baseShells(),
          {
            kind: 'wsl',
            program: 'C:\\Windows\\System32\\wsl.exe',
            distro: 'docker-desktop',
          },
          {
            kind: 'wsl',
            program: 'C:\\Windows\\System32\\wsl.exe',
            distro: 'rancher-desktop-data',
          },
          {
            kind: 'wsl',
            program: 'C:\\Windows\\System32\\wsl.exe',
            distro: 'podman-machine-default',
          },
        ])
      )
    )
    const wrapper = mount(ShellPicker, { props: { kind: 'auto', distro: null } })

    await wrapper.get('[data-testid="shell-picker-trigger"]').trigger('click')
    await flushPromises()

    const optionText = wrapper.findAll('[role="option"]').map((option) => option.text())
    expect(wrapper.find('.shell-group-label').exists()).toBe(false)
    expect(optionText).toContain('Ubuntu Dev(WSL)')
    expect(optionText).not.toContain('settings.shellKind.wslDefault')
    expect(optionText).not.toContain('docker-desktop')
    expect(optionText).not.toContain('rancher-desktop-data')
    expect(optionText).not.toContain('podman-machine-default')

    await wrapper.setProps({ kind: 'wsl', distro: 'Ubuntu Dev' })
    expect(wrapper.get('[data-testid="shell-picker-trigger"]').text()).toContain('Ubuntu Dev(WSL)')
  })

  it('shows a retry state without changing the selection', async () => {
    pickerMocks.authFetch.mockResolvedValueOnce(jsonResponse({}, 503))
    const wrapper = mount(ShellPicker, { props: { kind: 'wsl', distro: 'Ubuntu Dev' } })

    await wrapper.get('[data-testid="shell-picker-trigger"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('settings.shellProbe.failed')
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('discards a response from an earlier open request', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    pickerMocks.authFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const wrapper = mount(ShellPicker, { props: { kind: 'auto', distro: null } })
    const trigger = wrapper.get('[data-testid="shell-picker-trigger"]')

    await trigger.trigger('click')
    await trigger.trigger('click')
    await trigger.trigger('click')
    second.resolve(
      jsonResponse(
        probeResponse([{ kind: 'cmd', program: 'C:\\Windows\\System32\\cmd.exe', distro: null }])
      )
    )
    await flushPromises()
    first.resolve(jsonResponse(probeResponse()))
    await flushPromises()

    expect(wrapper.text()).toContain('settings.shellKind.cmd')
    expect(wrapper.text()).not.toContain('Ubuntu Dev')
  })
})
