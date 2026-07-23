export type SendDataFn = (data: string) => void | Promise<void>

export function createFrozenSendFn(senders: SendDataFn[], onDispatch?: () => void): SendDataFn {
  return (data: string) => {
    const results = senders.map((send) => send(data))
    onDispatch?.()
    return Promise.all(results).then(() => undefined)
  }
}
