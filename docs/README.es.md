<p align="center">
  <img src="images/logo.png" alt="Logotipo de Dinotty" width="200" />
</p>

<h1 align="center">Dinotty</h1>

<p align="center">
  <a href="https://github.com/xichan96/dinotty/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="Licencia"></a>
  <img src="https://img.shields.io/badge/language-Rust-orange" alt="Rust">
  <img src="https://img.shields.io/badge/frontend-Vue%203-brightgreen" alt="Vue 3">
  <a href="https://github.com/xichan96/dinotty/stargazers"><img src="https://img.shields.io/github/stars/xichan96/dinotty?style=social" alt="Estrellas en GitHub"></a>
  <a href="https://github.com/xichan96/dinotty/releases"><img src="https://img.shields.io/github/downloads/xichan96/dinotty/total" alt="Descargas en GitHub"></a>
  <a href="https://github.com/xichan96/dinotty/issues"><img src="https://img.shields.io/github/issues/xichan96/dinotty" alt="Issues en GitHub"></a>
</p>

<p align="center">
  <a href="../README.md">中文</a> | <a href="./README.en.md">English</a> | <a href="./README.ru.md">Русский</a> | <a href="./README.pt.md">Português</a> | <a href="./README.ko.md">한국어</a> | Español | <a href="./README.de.md">Deutsch</a> | <a href="./README.fr.md">Français</a>
</p>

---

Un terminal para agentes de código.

Ejecuta Claude Code, opencode, Codex u OpenClaw en cualquier dispositivo -- simple, extensible, multidispositivo, nunca pierde una sesión.

## Capturas de pantalla

<p align="center">
  <img src="images/1.png" alt="Ejecutando Claude Code en el móvil" width="250" />
  <img src="images/2.png" alt="Distribución completa del teclado con htop" width="250" />
  <img src="images/3.png" alt="Ajustes del tema" width="250" />
</p>
<p align="center">
  <img src="images/4.png" alt="Teclado personalizado de accesos directos" width="250" />
  <img src="images/5.png" alt="Monitor del sistema" width="250" />
  <img src="images/6.png" alt="Sistema de notificaciones" width="250" />
</p>
<p align="center">
  <img src="images/7.png" alt="Tablet en horizontal con diseño de nivel escritorio" width="500" />
</p>

## Demostración de escritorio

El cliente de escritorio ofrece una experiencia profesional comparable a iTerm2:

**Split Broadcast** - División multinpanel arrastrable, escribe en un panel y ejecuta en todos simultáneamente:

<p align="center">
  <img src="images/gif/1-split-broadcast.gif" alt="Demo de Split Broadcast" width="600" />
</p>

**Marcadores de comandos** - Clic derecho en el texto del terminal para marcar, gestión de grupos, ejecución con un clic:

<p align="center">
  <img src="images/gif/2-command-bookmark.gif" alt="Demo de marcadores de comandos" width="600" />
</p>

**Conexión SSH y explorador de archivos** - Cliente SSH integrado, sesiones remotas como si fueran locales, gestión completa de archivos por SFTP:

<p align="center">
  <img src="images/gif/3-ssh-file-browser.gif" alt="Demo de conexión SSH y explorador de archivos" width="600" />
</p>

**Gestión de workspaces y Mission Control** - Aislamiento multi-workspace, vista general de Mission Control, cambio rápido:

<p align="center">
  <img src="images/gif/4-workspace-mission-control.gif" alt="Demo de gestión de workspaces" width="600" />
</p>

**Sistema de plugins** - Plugins JS con recarga en caliente, incluye CC Switch, JSON Formatter y más:

<p align="center">
  <img src="images/gif/5-plugin.gif" alt="Demo del sistema de plugins" width="600" />
</p>

**Sistema unificado de layout** - Terminal, plugin, explorador de archivos y vista previa web son todos paneles; división arrastrable, movimiento entre pestañas, extracción como nueva pestaña:

<p align="center">
  <img src="images/gif/6-layout-sys.gif" alt="Demo del sistema unificado de layout" width="600" />
</p>

## ¿Por qué Dinotty?

Los agentes de código basados en terminal (Claude Code, opencode, Codex, OpenClaw, etc.) son potentes, pero están encerrados en una sola ventana de terminal. Dinotty te permite:

- **Gestionar agentes desde cualquier dispositivo** - trabajo profundo en escritorio, escanea un código QR en tu móvil al salir del escritorio para seguir monitorizando y gestionando el trabajo de tu agente sin interrupciones
- **Sincronización multidispositivo, cambio sin interrupciones** - empieza en el portátil, continúa en el móvil; vuelve al portátil y retoma exactamente donde lo dejaste
- **Verificar la salida del agente directamente** - diffs de código, páginas renderizadas, archivos generados, todo visible en el navegador integrado
- **Nunca pierdas tu sesión** - desconexión, bloqueo de pantalla, cambio de dispositivo - vuelve y todo está exactamente donde lo dejaste

### Ligero - no es un escritorio remoto

| | Dinotty | Escritorio remoto (VNC/RDP/Parsec) |
|---|---|---|
| **Datos transmitidos** | Solo texto (JSON, bytes) | Píxeles completos de pantalla a 30-60 fps |
| **Ancho de banda** | ~1–10 KB/s típico | ~1–10 MB/s (100–1000x más) |
| **Compatible con datos móviles** | ✅ Funciona en 3G/4G sin lag | ❌ Entrecortado, alta latencia, consume datos |
| **Tolerancia a señal débil** | ✅ Reconexión automática, sin pérdida de frames | ❌ Pantalla congelada, lag de entrada |
| **Consumo de batería** | Bajo (renderizado de texto) | Alto (decodificación de video) |
| **Adaptación de resolución** | Texto nativo a cualquier tamaño | Bitmap escalado, borroso en móvil |
| **Interacción** | Touch nativo, teclado personalizado | Ratón simulado, UI de escritorio diminuta |

## Características principales

- **Terminal virtual en servidor** - parser VTE completo, el servidor conoce el estado exacto de la pantalla, permite recuperación de sesión e instantáneas de pantalla
- **Persistencia de sesión** - los procesos PTY sobreviven a desconexiones, reconexión automática con backoff exponencial, refresca la página para restaurar
- **División de paneles y multi-pestañas** - división arrastrable, gestión multi-pestaña con ciclo de vida de panel liderado por servidor
- **Gestión de workspaces** - aislamiento multi-workspace, vista general de Mission Control, pestañas de plugin con scope de workspace
- **Modo broadcast** - entrada en un panel, ejecución simultánea en todos los paneles, gratis
- **Marcadores de comandos** - clic derecho en texto del terminal para marcar, gestión de grupos, ejecución con un clic
- **Conexión SSH remota** - cliente SSH integrado con auth por contraseña/clave, sesiones remotas como locales
- **Gestión remota de archivos (SFTP)** - se activa automáticamente en conexiones SSH, navegación/edición/subida/descarga completa de archivos
- **Lista de servidores** - gestiona múltiples servidores remotos, cambio rápido de conexión
- **Diseño responsivo** - vertical apila en pilas, horizontal lado a lado; botones optimizados para touch y redimensionado de paneles
- **Teclado personalizable de atajos** - añade Ctrl/Esc/teclas de función para móvil, soporta secuencias escape arbitrarias
- **Explorador de archivos integrado** - resaltado de código, renderizado Markdown, vista previa de documentos Office, reproducción de audio/vídeo
- **Indicadores de cambios Git** - marcas en el gutter para líneas añadidas/modificadas/eliminadas, diff inline, Stage/Revert
- **Vista previa web** - proxy inverso integrado para previsualizar servidores de desarrollo locales en iframe
- **Sistema de notificaciones** - detección de terminal bell/OSC, push por WebSocket, alertas sonoras configurables
- **Monitor del sistema** - gráficas en tiempo real de CPU/memoria/red
- **Sistema de plugins** - plugins JS + puente CLI, recarga en caliente; incluye CC Switch, JSON Formatter, gestor de conversaciones de Claude Code, etc.
- **Open API** - endpoint HTTP para control desde dispositivos externos (Stream Deck, Shortcuts, scripts de automatización)
- **Paleta de comandos** - lanzador de comandos de acceso rápido
- **App de escritorio** - cliente nativo opcional basado en Tauri

## Diferenciadores clave

- **Terminal virtual en servidor** - no es un pipe WebSocket-a-PTY; el PTY sobrevive a la desconexión, refresca la página para restaurar la sesión
- **Sincronización multidispositivo** - sincronización basada en navegador, trabajo profundo en escritorio, toma el control desde el móvil
- **Transporte ligero solo texto** - ~1-10 KB/s, fluido en 3G/4G, 100-1000x menos ancho de banda que escritorio remoto
- **Entorno autónomo** - explorador de archivos integrado, vista previa web, cambios Git, SSH/SFTP, sistema de plugins
- **Gratis y de código abierto** - autohospedado, sin suscripción, sin tasas de relay

Ver [comparación con otras soluciones](getting-started/comparison.en.md) para más detalles.

## Instalación

Descarga el instalador o binario para tu plataforma desde [GitHub Releases](https://github.com/xichan96/dinotty/releases):

| Plataforma | Formato | Notas |
|----------|--------|-------|
| **macOS** | `.dmg` | Abrir y arrastrar a Applications |
| **Linux** | `.deb` | `sudo dpkg -i dinotty_*.deb` |
| **Windows** | `.exe` / build desde fuente | Ejecuta `dinotty-server.exe` desde PowerShell, o compila desde fuente |

> También puedes compilar desde fuente, ver "Inicio rápido" más abajo.

**Nota para macOS**: Como la app no está firmada, macOS puede mostrar **"Dinotty" está dañado y no se puede abrir**. Ejecuta el siguiente comando después de la instalación para quitar la restricción:

```bash
xattr -cr /Applications/Dinotty.app
```

**Instalación en una línea en Linux**:

```bash
VERSION=$(curl -s https://api.github.com/repos/xichan96/dinotty/releases/latest | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | sed 's/^v//') && curl -LO "https://github.com/xichan96/dinotty/releases/download/v${VERSION}/dinotty-server_${VERSION}-1_amd64.deb" && sudo dpkg -i "dinotty-server_${VERSION}-1_amd64.deb"
```

**Inicio en Linux**:

```bash
# systemd
systemctl start dinotty
systemctl enable dinotty  # auto-inicio en arranque

# Contenedor Docker
nohup dinotty-server &
```

**Inicio en Windows**:

```powershell
# PowerShell
.\dinotty-server.exe -p 8999

# Opcional: sobreescribir el shell por defecto antes de la autodetección
$env:DINOTTY_SHELL = "pwsh.exe"
.\dinotty-server.exe
```

En Windows, el shell por defecto se detecta en este orden: `DINOTTY_SHELL` -> `pwsh.exe` -> `powershell.exe` -> `%ComSpec%` / `cmd.exe`.

El puerto por defecto es **8999**. Después de iniciar, visita `http://<tu-ip>:8999`. Usa `-p` para especificar un puerto personalizado:

```bash
dinotty-server -p 3000
```

## Inicio rápido

```bash
# Clonar repo (shallow clone recomendado - más rápido y pequeño)
git clone --depth 1 --single-branch -b dev git@github.com:xichan96/dinotty.git
cd dinotty

# Compilar frontend
cd frontend && pnpm install && pnpm run build && cd ..

# Ejecutar servidor
cargo run
```

Equivalente en Windows PowerShell:

```powershell
git clone --depth 1 --single-branch -b dev git@github.com:xichan96/dinotty.git
cd dinotty
cd frontend
pnpm install
pnpm run build
cd ..
cargo run
```

Abre http://127.0.0.1:8999 en tu navegador.

```bash
# Backend con logging de depuración
RUST_LOG=debug cargo run

# Type-check del frontend
cd frontend && npx vue-tsc --noEmit
```

```powershell
# Logging de depuración en Windows PowerShell
$env:RUST_LOG = "debug"
cargo run
```

## Stack tecnológico

| Capa | Tecnología |
|-------|-----------|
| Backend | Rust, Axum 0.7, Tokio, portable-pty, vte, russh, russh-sftp |
| Frontend | Vue 3, TypeScript, Vite, xterm.js 5 |
| Escritorio | Tauri |

**Escrito en Rust · Un solo binario · Cero dependencias** - Ejecuta una máquina de estados VT completa en el servidor, no un proxy que reenvía pipes, así las sesiones sobreviven a la desconexión.

## Más documentación

- [Comparación](getting-started/comparison.en.md) - diferencias vs ttyd/gotty/Wetty y otras soluciones remotas de AI coding
- [Guía de despliegue](getting-started/deployment.en.md) - systemd, Docker, ejecución nativa en Windows, build multiplataforma, configuración
- [Guía de release](getting-started/releasing.en.md) - gestión unificada de versiones, PRs de versión, promoción de `dev` a `main`, tags y GitHub Releases
- [Editor de archivos](features/file-editor.en.md) - paneles divididos, edición multicursor, sincronización cross-file de Cursor Group
- [Sistema de notificaciones](features/notifications.en.md) - HTTP API, integración con Claude Code, Open API
- [Sistema de plugins](plugins/plugins.en.md) - instalación, manifiesto, API, plugins integrados
- [Desarrollo de plugins](plugins/plugin-development.md) - guía completa de desarrollo de plugins
- [API del portapapeles del host](api/clipboard-api.md) - endpoint sensible autenticado usado por el pegado desde host móvil
- [MCP Server](api/mcp-server.md) - servidor MCP JSON-RPC integrado para que asistentes IA operen sesiones de terminal
- [Sistema de permisos por token](internals/token-system.md) - control de acceso fine-grained multi-token basado en capabilities
- [Event Bus](internals/event-bus.md) - bus de eventos global para dispatch entre módulos
- [Audit Log y Webhook](internals/audit-webhook.md) - tracking de uso de API y notificaciones externas
- [Contribuir](getting-started/contributing.en.md) - estrategia de ramas, convención de commits, estilo de código

## Contribuidores

¡Gracias a todas las personas que han contribuido a Dinotty!

<a href="https://github.com/xichan96/dinotty/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=xichan96/dinotty" />
</a>

## Star History

![Star History](images/star-history.svg)

## Licencia

MIT
