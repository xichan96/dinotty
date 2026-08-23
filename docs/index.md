---
layout: page
head:
  - - meta
    - http-equiv: refresh
      content: 0; url=/dinotty/en/
---

<script setup>
import { onMounted } from 'vue'
onMounted(() => {
  const base = '/dinotty'
  const path = window.location.pathname.replace(/\/$/, '')
  const lang = path.endsWith('/zh') ? `${base}/zh/` : `${base}/en/`
  window.location.replace(lang)
})
</script>

<div style="padding: 2rem; text-align: center;">
  <p>Redirecting...</p>
  <p><a href="/dinotty/en/">English docs</a> · <a href="/dinotty/zh/">中文文档</a></p>
</div>
