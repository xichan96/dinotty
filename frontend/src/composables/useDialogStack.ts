import { onUnmounted, ref, watch } from 'vue'

const stack: symbol[] = []

export function useDialogStack(visible: () => boolean) {
  const id = Symbol()
  const depth = ref(0)

  function remove() {
    const index = stack.indexOf(id)
    if (index !== -1) stack.splice(index, 1)
  }

  watch(
    visible,
    (value) => {
      remove()
      if (value) {
        depth.value = stack.length
        stack.push(id)
      }
    },
    { immediate: true }
  )

  onUnmounted(remove)

  function isTop() {
    return stack[stack.length - 1] === id
  }

  return { depth, isTop }
}
