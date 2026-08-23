// Bridge `vue` imports in an externally-built plugin bundle to the
// host's Vue runtime. The host assigns `window.__DINOTTY_VUE__ = import * as vue`
// before any bridged plugin is loaded, so plugin components share the exact
// same runtime instance as the host app (no second Vue copy, reactive state
// stays connected).
const vue = (window as unknown as { __DINOTTY_VUE__?: Record<string, unknown> }).__DINOTTY_VUE__
if (!vue) {
  throw new Error('host vue bridge missing: window.__DINOTTY_VUE__ not assigned')
}

// Named exports enumerated to cover vue/compiler-sfc runtime helpers.
// Extended as plugin builds reveal additional imports.
export const ref = vue.ref as never
export const reactive = vue.reactive as never
export const computed = vue.computed as never
export const watch = vue.watch as never
export const onMounted = vue.onMounted as never
export const onUnmounted = vue.onUnmounted as never
export const onBeforeUnmount = vue.onBeforeUnmount as never
export const nextTick = vue.nextTick as never
export const h = vue.h as never
export const defineComponent = vue.defineComponent as never
export const getCurrentInstance = vue.getCurrentInstance as never
export const toDisplayString = vue.toDisplayString as never
export const normalizeClass = vue.normalizeClass as never
export const normalizeStyle = vue.normalizeStyle as never
export const openBlock = vue.openBlock as never
export const createElementBlock = vue.createElementBlock as never
export const createElementVNode = vue.createElementVNode as never
export const createBlock = vue.createBlock as never
export const createVNode = vue.createVNode as never
export const createCommentVNode = vue.createCommentVNode as never
export const createTextVNode = vue.createTextVNode as never
export const withCtx = vue.withCtx as never
export const withDirectives = vue.withDirectives as never
export const withModifiers = vue.withModifiers as never
export const withKeys = vue.withKeys as never
export const vModelText = vue.vModelText as never
export const vShow = vue.vShow as never
export const mergeProps = vue.mergeProps as never
export const renderList = vue.renderList as never
export const renderSlot = vue.renderSlot as never
export const resolveComponent = vue.resolveComponent as never
export const resolveDirective = vue.resolveDirective as never
export const resolveDynamicComponent = vue.resolveDynamicComponent as never
export const resolveTransitionHooks = vue.resolveTransitionHooks as never
export const setBlockTracking = vue.setBlockTracking as never
export const useSlots = vue.useSlots as never
export const useAttrs = vue.useAttrs as never
export const isRef = vue.isRef as never
export const unref = vue.unref as never
export const toRef = vue.toRef as never
export const toRefs = vue.toRefs as never
export const customRef = vue.customRef as never
export const triggerRef = vue.triggerRef as never
export const shallowRef = vue.shallowRef as never
export const shallowReactive = vue.shallowReactive as never
export const readonly = vue.readonly as never
export const proxyRefs = vue.proxyRefs as never
export const markRaw = vue.markRaw as never
export const toRaw = vue.toRaw as never
export const effectScope = vue.effectScope as never
export const EffectScope = vue.EffectScope as never
export const watchEffect = vue.watchEffect as never
export const watchPostEffect = vue.watchPostEffect as never
export const watchSyncEffect = vue.watchSyncEffect as never
export const Teleport = vue.Teleport as never
export const Suspense = vue.Suspense as never
export const KeepAlive = vue.KeepAlive as never
export const Transition = vue.Transition as never
export const TransitionGroup = vue.TransitionGroup as never
export const Fragment = vue.Fragment as never
export const Static = vue.Static as never
export const Text = vue.Text as never
export const Comment = vue.Comment as never
