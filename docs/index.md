---
layout: page
head:
  - - meta
    - http-equiv: refresh
      content: 0; url=/dinotty/zh/
---

<script setup>
import { onMounted } from 'vue'
onMounted(() => {
  const base = '/dinotty'
  const path = window.location.pathname.replace(/\/$/, '')
  const lang = path.endsWith('/en') ? `${base}/en/` : `${base}/zh/`
  window.location.replace(lang)
})
</script>

<div style="padding: 2rem; text-align: center;">
  <p>Redirecting...</p>
  <p><a href="/dinotty/zh/">中文文档</a> · <a href="/dinotty/en/">English docs</a></p>
</div>
