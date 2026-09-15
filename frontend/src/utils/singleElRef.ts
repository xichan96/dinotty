import type { ComponentPublicInstance, Ref } from 'vue'

/**
 * Builds a function ref that stores a single element.
 *
 * A string ref on an element inside `v-for` is compiled with `ref_for: true`,
 * and the runtime collects every value into an array. The declared
 * `ref<HTMLElement>()` then actually holds `HTMLElement[]` at runtime, so
 * `.contains()` / `.getBoundingClientRect()` / `.focus()` on it throws — the
 * type checker cannot see this. Function refs are not collected, which keeps
 * the single-element contract the callers assume.
 *
 * Call once during setup and bind the result:
 *   const setFoo = singleElRef(fooRef)   ->   :ref="setFoo"
 * Building the function inline in the template would hand Vue a new identity on
 * every render and re-invoke it on each patch.
 */
export function singleElRef<T extends Element>(target: Ref<T | null>) {
  return (el: Element | ComponentPublicInstance | null): void => {
    target.value = (el as T | null) ?? null
  }
}
