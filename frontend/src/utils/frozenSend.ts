export type SendDataFn = (data: string) => void | Promise<void>

export function createFrozenSendFn(senders: SendDataFn[], onDispatch?: () => void): SendDataFn {
  return (data: string) => {
    const results = senders.map((send) => send(data))
    onDispatch?.()
    const aggregate = Promise.all(results).then(() => undefined)
    // Transport layer logs failures already.
    void aggregate.catch(() => {})
    return aggregate
  }
}
