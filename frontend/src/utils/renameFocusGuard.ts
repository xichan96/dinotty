/**
 * Focus guard for the inline tab-title rename editor.
 *
 * Double-clicking a tab title swaps the `<span class="tab-title">` for an
 * `<input class="tab-title-input">` and focuses it. Activating the tab is
 * asynchronous (it awaits the server, then focuses the terminal on a later
 * tick), so that deferred focus can land *after* the input took focus. The
 * resulting `blur` closes the editor, which made renaming feel like it almost
 * never worked — the box opened and vanished within a frame or two.
 *
 * Anything that focuses the terminal after a state change must therefore leave
 * focus alone while the rename input owns it.
 */

/** Class of the inline rename editor rendered by `TabBar.vue`. */
export const TAB_TITLE_INPUT_CLASS = 'tab-title-input'

/** True when `el` is the tab-title rename input (i.e. the user is renaming). */
export function isRenamingTabTitle(el: Element | null | undefined): boolean {
  return !!el && el.classList.contains(TAB_TITLE_INPUT_CLASS)
}
