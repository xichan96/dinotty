import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import {
  getRemoteServerTransport,
  invokeTransportLifecycle,
  recoverRemoteServerTransport,
  registerRemoteServerTransport,
  unregisterRemoteServerTransports,
  validateRemoteServerTransportResult,
} from '../composables/useRemoteServerTransports'

const Form = defineComponent({ name: 'TransportForm', template: '<div />' })

afterEach(() => {
  unregisterRemoteServerTransports('transport-test')
})

describe('remote server transport registry', () => {
  it('registers by plugin identity and unregisters with the plugin', () => {
    const registration = registerRemoteServerTransport('transport-test', {
      id: 'connector',
      label: 'Connector',
      component: Form,
    })

    expect(getRemoteServerTransport({ pluginId: 'transport-test', transportId: 'connector' })?.label).toBe('Connector')
    registration.dispose()
    expect(getRemoteServerTransport({ pluginId: 'transport-test', transportId: 'connector' })).toBeUndefined()
  })

  it('rejects malformed registrations and accepts only loopback origin results', () => {
    expect(() => registerRemoteServerTransport('transport-test', { id: 'not valid', label: 'x', component: Form })).toThrow(
      'must match'
    )
    expect(validateRemoteServerTransportResult({ url: 'https://example.test' })).toMatchObject({ ok: false })
    expect(validateRemoteServerTransportResult({ url: 'http://127.0.0.1:8899/path' })).toMatchObject({ ok: false })
    expect(validateRemoteServerTransportResult({ url: 'http://localhost:8899/' })).toEqual({ ok: true, url: 'http://localhost:8899' })
  })

  it('recovers without tokens, marks errors unavailable, and runs cleanup lifecycle', async () => {
    const recover = vi.fn().mockRejectedValue(new Error('connector is down'))
    const deleted = vi.fn()
    const unload = vi.fn()
    registerRemoteServerTransport('transport-test', {
      id: 'connector',
      label: 'Connector',
      component: Form,
      recover,
      onDeleted: deleted,
      onUnload: unload,
    })
    const server = {
      id: 'server-1',
      name: 'A',
      url: 'http://127.0.0.1:8899',
      transport: { pluginId: 'transport-test', transportId: 'connector' },
    }

    await recoverRemoteServerTransport('transport-test', [server])
    expect(recover).toHaveBeenCalledWith([{ id: 'server-1', name: 'A', url: 'http://127.0.0.1:8899' }])
    expect(getRemoteServerTransport(server.transport)).toMatchObject({ available: false, error: 'connector is down' })

    await invokeTransportLifecycle('deleted', server)
    await invokeTransportLifecycle('unload', server)
    expect(deleted).toHaveBeenCalledWith({ id: 'server-1', name: 'A', url: 'http://127.0.0.1:8899' })
    expect(unload).toHaveBeenCalledTimes(1)
  })
})
