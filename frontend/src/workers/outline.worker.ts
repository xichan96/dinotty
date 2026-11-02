/**
 * Off-main-thread code/JSON outline scanning.
 *
 * Protocol: receives `{ id, mode, language, text }` and replies
 * `{ id, source }` with the same id so the composable can drop stale replies.
 */
import {
  buildOutlineSync,
  type OutlineWorkerReply,
  type OutlineWorkerRequest,
} from '../utils/outlineBuild'

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<OutlineWorkerRequest>) => void) | null
  postMessage: (message: OutlineWorkerReply) => void
}

scope.onmessage = (event) => {
  const { id, mode, language, text } = event.data
  const source = buildOutlineSync({ mode, language, text })
  scope.postMessage({ id, source })
}
