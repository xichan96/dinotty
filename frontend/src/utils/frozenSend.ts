export type SendDataFn = (data: string) => void | Promise<void>

export function createFrozenSendFn(senders: SendDataFn[], onDispatch?: () => void): SendDataFn {
  return (data: string) => {
    // A synchronously throwing sender must not starve the remaining panes
    // (broadcast invariant, keyboard-plugin-design.md §二 #6).
    const results = senders.map((send) => {
      try {
        return send(data)
      } catch (err) {
        return Promise.reject(err)
      }
    })
    onDispatch?.()
    const aggregate = Promise.all(results).then(() => undefined)
    // Transport layer logs failures already.
    void aggregate.catch(() => {})
    return aggregate
  }
}
