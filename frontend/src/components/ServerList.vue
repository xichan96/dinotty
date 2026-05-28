<template>
  <Teleport to="body">
    <div v-if="visible" class="serverlist-backdrop" @click.self="close">
      <div class="serverlist-panel">
        <div class="serverlist-header">
          <h2>Connections</h2>
          <button class="serverlist-close" @click="close">✕</button>
        </div>

        <div class="serverlist-body">
          <div
            v-for="(srv, i) in servers"
            :key="i"
            class="server-item"
            :class="{ active: i === activeIndex }"
            @click="connect(i)"
          >
            <div class="server-status" :class="i === activeIndex ? 'online' : ''"></div>
            <div class="server-info">
              <span class="server-name">{{ srv.name }}</span>
              <span class="server-addr">{{ srv.host }}:{{ srv.port }}</span>
            </div>
            <button class="server-del" @click.stop="removeServer(i)">✕</button>
          </div>

          <div class="server-add-form">
            <input v-model="newName" placeholder="Name" class="server-input" />
            <input v-model="newHost" placeholder="Host / IP" class="server-input" />
            <input v-model="newPort" placeholder="Port" class="server-input short" type="number" />
            <button class="server-add-btn" @click="addServer">+</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

interface Server {
  name: string
  host: string
  port: number
}

const emit = defineEmits<{
  connect: [host: string, port: number]
}>()

const visible = ref(false)
const servers = ref<Server[]>([])
const activeIndex = ref(0)
const newName = ref('')
const newHost = ref('')
const newPort = ref('8999')

function load() {
  try {
    const raw = localStorage.getItem('dinotty_servers')
    if (raw) {
      const data = JSON.parse(raw)
      servers.value = data.servers || []
      activeIndex.value = data.activeIndex || 0
    }
  } catch {}

  if (servers.value.length === 0) {
    servers.value.push({ name: 'Local', host: location.hostname, port: parseInt(location.port) || 8999 })
    save()
  }
}

function save() {
  localStorage.setItem('dinotty_servers', JSON.stringify({
    servers: servers.value,
    activeIndex: activeIndex.value,
  }))
}

function open() { visible.value = true }
function close() { visible.value = false }

function connect(i: number) {
  activeIndex.value = i
  save()
  const srv = servers.value[i]
  emit('connect', srv.host, srv.port)
  close()
}

function addServer() {
  if (!newHost.value.trim()) return
  servers.value.push({
    name: newName.value.trim() || newHost.value.trim(),
    host: newHost.value.trim(),
    port: parseInt(newPort.value) || 8999,
  })
  newName.value = ''
  newHost.value = ''
  newPort.value = '8999'
  save()
}

function removeServer(i: number) {
  if (servers.value.length <= 1) return
  servers.value.splice(i, 1)
  if (activeIndex.value >= servers.value.length) {
    activeIndex.value = servers.value.length - 1
  }
  save()
}

function getActiveServer(): Server | null {
  return servers.value[activeIndex.value] || null
}

onMounted(load)

defineExpose({ open, close, getActiveServer })
</script>

<style scoped>
.serverlist-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 930;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px) 0;
}

.serverlist-panel {
  width: 90vw;
  max-width: 400px;
  background: var(--bg-surface, #1A1A1A);
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  overflow: hidden;
}

.serverlist-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border, #333);
}
.serverlist-header h2 {
  font-size: 15px;
  font-weight: 600;
  color: var(--fg-bright);
}
.serverlist-close {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted);
}

.serverlist-body {
  padding: 12px 16px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  max-height: 400px;
  overflow-y: auto;
}

.server-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
}
.server-item:hover { background: rgba(255,255,255,0.05); }
.server-item.active { background: rgba(77,127,255,0.1); }

.server-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--fg-muted, #666);
  flex-shrink: 0;
}
.server-status.online { background: #00C200; }

.server-info { flex: 1; min-width: 0; }
.server-name {
  display: block;
  font-size: 13px;
  color: var(--fg-bright);
}
.server-addr {
  display: block;
  font-size: 11px;
  color: var(--fg-muted);
  font-family: var(--font-mono);
}

.server-del {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 11px;
  color: var(--fg-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
}
.server-item:hover .server-del { opacity: 1; }

.server-add-form {
  display: flex;
  gap: 6px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border, #333);
}
.server-input {
  flex: 1;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--fg);
  padding: 6px 8px;
  font-size: 12px;
  min-width: 0;
}
.server-input.short { max-width: 60px; }
.server-add-btn {
  width: 32px;
  border-radius: 4px;
  background: var(--accent);
  color: #fff;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
