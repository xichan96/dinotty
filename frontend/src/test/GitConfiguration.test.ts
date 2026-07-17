import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GitConfiguration from '../components/workspace/GitConfiguration.vue'

const configurationMocks = vi.hoisted(function createConfigurationMocks() {
  return { authFetch: vi.fn() }
})

vi.mock('../composables/apiBase', function mockApiBase() {
  return {
    apiUrl: function returnApiPath(path: string) {
      return path
    },
    authFetch: configurationMocks.authFetch,
    getApiBase: vi.fn(async function getApiBase() {
      return ''
    }),
  }
})

const localConfiguration = {
  user_name: 'Alice',
  user_email: 'alice@example.com',
  credential_helper: 'manager-core',
  default_branch: 'main',
  gpg_sign: false,
  signing_key: '',
}

describe('GitConfiguration', function gitConfigurationSuite() {
  beforeEach(function resetConfigurationMocks() {
    // 步骤1：分别返回本地/全局配置、工具诊断和保存成功结果。
    configurationMocks.authFetch.mockReset()
    configurationMocks.authFetch.mockImplementation(async function respondToConfigurationRequest(
      url: string,
      options?: RequestInit
    ) {
      if (options) return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (url.startsWith('/api/workspace/git-config?')) {
        return new Response(
          JSON.stringify({
            local: localConfiguration,
            global: {
              ...localConfiguration,
              user_name: 'Global Alice',
              user_email: 'global@example.com',
            },
          }),
          { status: 200 }
        )
      }
      return new Response(
        JSON.stringify({
          tools: [
            { name: 'git', available: true, version: 'git version 2.50.0' },
            { name: 'ssh', available: true, version: 'OpenSSH_9.9p1' },
            { name: 'gpg', available: false, version: '' },
          ],
        }),
        { status: 200 }
      )
    })
  })

  it('loads diagnostics and saves repository configuration', async function savesConfiguration() {
    // 步骤1：展开面板，确认工具诊断与本地配置已加载。
    const wrapper = mount(GitConfiguration, {
      props: { paneId: 'pane-1', repository: 'apps/web' },
    })
    await flushPromises()
    await wrapper.get('[data-testid="git-configuration-heading"]').trigger('click')
    expect(wrapper.findAll('[data-testid="git-diagnostic-tool"]')).toHaveLength(3)
    expect(wrapper.get('[data-testid="git-config-user-name"]').element).toHaveProperty(
      'value',
      'Alice'
    )

    // 步骤2：修改身份并保存，所有白名单字段和明确作用域一次发送。
    await wrapper.get('[data-testid="git-config-user-name"]').setValue('Alice New')
    await wrapper.get('[data-testid="git-config-user-email"]').setValue('new@example.com')
    await wrapper.get('[data-testid="git-config-save"]').trigger('click')
    await flushPromises()
    expect(configurationMocks.authFetch).toHaveBeenCalledWith(
      '/api/workspace/git-config-update?pane_id=pane-1&repository=apps%2Fweb',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          scope: 'local',
          user_name: 'Alice New',
          user_email: 'new@example.com',
          credential_helper: 'manager-core',
          default_branch: 'main',
          gpg_sign: false,
          signing_key: '',
        }),
      })
    )
  })
})
