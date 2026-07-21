package com.dinotty.mobile

import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  // Note: the template's enableEdgeToEdge() call is intentionally removed —
  // it draws the webview underneath the system navigation bar, hiding
  // Dinotty's bottom action row (see themes.xml opt-out).

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // Pad the content view by the system bar (and IME) insets so the webview
    // bottom edge sits exactly on top of the navigation bar / keyboard,
    // regardless of any edge-to-edge behavior applied by the platform or wry.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
  }

  private fun findWebView(v: View?): WebView? {
    if (v is WebView) return v
    if (v is ViewGroup) {
      for (i in 0 until v.childCount) {
        findWebView(v.getChildAt(i))?.let { return it }
      }
    }
    return null
  }

  @Deprecated("Deprecated in Java")
  override fun onBackPressed() {
    // Back walks the webview history (terminal page -> connect page) so the
    // user can switch servers; only exits the app when there is no history.
    val wv = findWebView(window.decorView.rootView)
    if (wv != null && wv.canGoBack()) {
      wv.goBack()
    } else {
      @Suppress("DEPRECATION")
      super.onBackPressed()
    }
  }
}
