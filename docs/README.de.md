<p align="center">
  <img src="images/logo.png" alt="Dinotty Logo" width="200" />
</p>

<h1 align="center">Dinotty</h1>

<p align="center">
  <a href="https://github.com/xichan96/dinotty/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="Lizenz"></a>
  <img src="https://img.shields.io/badge/language-Rust-orange" alt="Rust">
  <img src="https://img.shields.io/badge/frontend-Vue%203-brightgreen" alt="Vue 3">
  <a href="https://github.com/xichan96/dinotty/stargazers"><img src="https://img.shields.io/github/stars/xichan96/dinotty?style=social" alt="GitHub Stars"></a>
  <a href="https://github.com/xichan96/dinotty/releases"><img src="https://img.shields.io/github/downloads/xichan96/dinotty/total" alt="GitHub Downloads"></a>
  <a href="https://github.com/xichan96/dinotty/issues"><img src="https://img.shields.io/github/issues/xichan96/dinotty" alt="GitHub Issues"></a>
</p>

<p align="center">
  <a href="../README.md">中文</a> | <a href="./README.en.md">English</a> | <a href="./README.ru.md">Русский</a> | <a href="./README.pt.md">Português</a> | <a href="./README.ko.md">한국어</a> | <a href="./README.es.md">Español</a> | Deutsch | <a href="./README.fr.md">Français</a>
</p>

---

Ein Terminal für Coding-Agenten.

Claude Code, opencode, Codex oder OpenClaw auf jedem Gerät -- schlicht, erweiterbar, geräteübergreifend, verliert nie eine Session.

## Screenshots

<p align="center">
  <img src="images/1.png" alt="Claude Code auf dem Handy" width="250" />
  <img src="images/2.png" alt="Vollständige Tastaturbelegung mit htop" width="250" />
  <img src="images/3.png" alt="Theme-Einstellungen" width="250" />
</p>
<p align="center">
  <img src="images/4.png" alt="Custom Shortcut-Tastatur" width="250" />
  <img src="images/5.png" alt="Systemmonitor" width="250" />
  <img src="images/6.png" alt="Benachrichtigungssystem" width="250" />
</p>
<p align="center">
  <img src="images/7.png" alt="Tablet im Querformat mit Desktop-Level-Layout" width="500" />
</p>

## Desktop-Demo

Der Desktop-Client bietet ein professionelles Erlebnis vergleichbar mit iTerm2:

**Split Broadcast** - Ziehbare Multi-Pane-Aufteilung, tippe in einem Pane und führe in allen gleichzeitig aus:

<p align="center">
  <img src="images/gif/1-split-broadcast.gif" alt="Split Broadcast Demo" width="600" />
</p>

**Command Bookmarks** - Rechtsklick auf Terminaltext zum Bookmarken, Gruppenverwaltung, Ein-Klick-Ausführung:

<p align="center">
  <img src="images/gif/2-command-bookmark.gif" alt="Command Bookmarks Demo" width="600" />
</p>

**SSH-Verbindung und Dateibrowser** - Eingebauter SSH-Client, Remote-Sessions fühlen sich lokal an, vollständiges SFTP-Dateimanagement:

<p align="center">
  <img src="images/gif/3-ssh-file-browser.gif" alt="SSH-Verbindung und Dateibrowser Demo" width="600" />
</p>

**Workspace-Management und Mission Control** - Multi-Workspace-Isolation, Mission Control-Übersicht, schnelles Wechseln:

<p align="center">
  <img src="images/gif/4-workspace-mission-control.gif" alt="Workspace-Management Demo" width="600" />
</p>

**Plugin-System** - Hot-Reload-fähige JS-Plugins, inklusive CC Switch, JSON Formatter und mehr:

<p align="center">
  <img src="images/gif/5-plugin.gif" alt="Plugin-System Demo" width="600" />
</p>

**Einheitliches Layout-System** - Terminal, Plugin, Dateibrowser und Web-Vorschau sind alles Panes; ziehbare Aufteilung, Tab-übergreifendes Verschieben, als neues Tab extrahieren:

<p align="center">
  <img src="images/gif/6-layout-sys.gif" alt="Einheitliches Layout-System Demo" width="600" />
</p>

## Warum Dinotty?

Terminalbasierte Coding-Agenten (Claude Code, opencode, Codex, OpenClaw usw.) sind mächtig, aber in einem einzelnen Terminalfenster eingesperrt. Dinotty ermöglicht dir:

- **Agenten von jedem Gerät verwalten** - tiefes Arbeiten am Desktop, scanne einen QR-Code auf dem Handy wenn du den Schreibtisch verlässt, um die Arbeit deines Agenten ohne Unterbrechung weiter zu überwachen und zu steuern
- **Multi-Gerät-Sync, nahtloser Wechsel** - starte auf dem Laptop, fahre auf dem Handy fort; kehre zum Laptop zurück und mach genau da weiter, wo du aufgehört hast
- **Agenten-Output direkt verifizieren** - Code-Diffs, gerenderte Seiten, generierte Dateien, alles im eingebauten Browser sichtbar
- **Verliere nie deine Session** - Verbindungsabbruch, Bildschirmsperre, Gerätewechsel - komme zurück und alles ist genau da, wo du es verlassen hast

### Leichtgewichtig - kein Remote-Desktop

| | Dinotty | Remote-Desktop (VNC/RDP/Parsec) |
|---|---|---|
| **Übertragene Daten** | Nur Text (JSON, Bytes) | Vollständige Bildschirmpixel bei 30-60 fps |
| **Bandbreite** | ~1–10 KB/s typisch | ~1–10 MB/s (100–1000x mehr) |
| **Mobildaten-freundlich** | ✅ Funktioniert auf 3G/4G ohne Lag | ❌ Ruckelig, hohe Latenz, verbraucht Daten |
| **Toleranz bei schwachem Signal** | ✅ Auto-Reconnect, kein Frame-Verlust | ❌ Eingefrorener Bildschirm, Input-Lag |
| **Akkuverbrauch** | Niedrig (Text-Rendering) | Hoch (Video-Decodierung) |
| **Auflösungsanpassung** | Nativer Text in jeder Größe | Skaliertes Bitmap, unscharf auf dem Handy |
| **Interaktion** | Natives Touch, custom Tastatur | Simulierte Maus, winzige Desktop-UI |

## Hauptfunktionen

- **Serverseitiges virtuelles Terminal** - vollständiger VTE-Parser, Server kennt exakten Bildschirmzustand, ermöglicht Session-Recovery und Bildschirm-Snapshots
- **Session-Persistenz** - PTY-Prozesse überleben Verbindungsabbruch, Auto-Reconnect mit exponentiellem Backoff, Seite aktualisieren zum Wiederherstellen
- **Pane-Aufteilung und Multi-Tabs** - ziehbare Aufteilung, Multi-Tab-Verwaltung mit servergeführtem Pane-Lebenszyklus
- **Workspace-Management** - Multi-Workspace-Isolation, Mission Control-Übersicht, Workspace-scoped Plugin-Tabs
- **Broadcast-Modus** - Eingabe in einem Pane, gleichzeitige Ausführung in allen Panes, kostenlos
- **Command Bookmarks** - Rechtsklick auf Terminaltext zum Bookmarken, Gruppenverwaltung, Ein-Klick-Ausführung
- **Remote SSH-Verbindung** - eingebauter SSH-Client mit Passwort/Key-Auth, Remote-Sessions fühlen sich lokal an
- **Remote-Dateiverwaltung (SFTP)** - automatisch aktiviert bei SSH-Verbindungen, vollständiges Datei-Browsen/Editieren/Upload/Download
- **Serverliste** - mehrere Remote-Server verwalten, schnelles Wechseln der Verbindungen
- **Responsives Layout** - Hochformat stapelt vertikal, Querformat nebeneinander; touch-optimierte Buttons und Pane-Resizing
- **Anpassbare Shortcut-Tastatur** - füge Ctrl/Esc/Funktionstasten für Mobile hinzu, unterstützt beliebige Escape-Sequenzen
- **Eingebauter Dateibrowser** - Code-Highlighting, Markdown-Rendering, Office-Dokument-Vorschau, Audio/Video-Wiedergabe
- **Git-Änderungsindikatoren** - Gutter-Markierungen für hinzugefügte/geänderte/gelöschte Zeilen, Inline-Diff, Stage/Revert
- **Web-Vorschau** - eingebauter Reverse-Proxy zum Vorschauen lokaler Dev-Server in iframe
- **Benachrichtigungssystem** - Terminal-Bell/OSC-Erkennung, WebSocket-Push, konfigurierbare Sound-Alerts
- **Systemmonitor** - Echtzeit-CPU/Speicher/Netzwerk-Charts
- **Plugin-System** - JS-Plugins + CLI-Bridge, Hot-Reload; liefert CC Switch, JSON Formatter, Claude Code Conversation Manager usw.
- **Open API** - HTTP-Endpoint für externe Gerätesteuerung (Stream Deck, Shortcuts, Automatisierungs-Skripte)
- **Befehlspalette** - Schnellzugriff-Befehls-Launcher
- **Desktop-App** - optionaler nativer Client auf Tauri-Basis

## Hauptunterschiedsmerkmale

- **Serverseitiges virtuelles Terminal** - keine WebSocket-zu-PTY-Pipe; PTY übersteht Verbindungsabbruch, Seite aktualisieren zum Wiederherstellen der Session
- **Multi-Gerät-Sync** - browserbasierte Sync, tiefes Arbeiten am Desktop, vom Mobile übernehmen
- **Leichtgewichtiger Text-only-Transport** - ~1-10 KB/s, flüssig auf 3G/4G, 100-1000x weniger Bandbreite als Remote-Desktop
- **Selbst-contained-Umgebung** - eingebauter Dateibrowser, Web-Vorschau, Git-Änderungen, SSH/SFTP, Plugin-System
- **Kostenlos und Open Source** - selbst gehostet, kein Abo, keine Relay-Gebühren

Siehe [Vergleich mit anderen Lösungen](getting-started/comparison.en.md) für Details.

## Installation

Lade den Installer oder Binary für deine Plattform von [GitHub Releases](https://github.com/xichan96/dinotty/releases) herunter:

| Plattform | Format | Hinweise |
|----------|--------|-------|
| **macOS** | `.dmg` | Öffnen und in Applications ziehen |
| **Linux** | `.deb` | `sudo dpkg -i dinotty_*.deb` |
| **Windows** | `.exe` / Source-Build | Starte `dinotty-server.exe` aus PowerShell, oder baue aus dem Source |

> Du kannst auch aus dem Source bauen, siehe "Schnellstart" unten.

**macOS-Hinweis**: Da die App nicht signiert ist, zeigt macOS möglicherweise **"Dinotty" ist beschädigt und kann nicht geöffnet werden**. Führe nach der Installation den folgenden Befehl aus, um die Beschränkung zu entfernen:

```bash
xattr -cr /Applications/Dinotty.app
```

**Linux Ein-Zeilen-Installation**:

```bash
VERSION=$(curl -s https://api.github.com/repos/xichan96/dinotty/releases/latest | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | sed 's/^v//') && curl -LO "https://github.com/xichan96/dinotty/releases/download/v${VERSION}/dinotty-server_${VERSION}-1_amd64.deb" && sudo dpkg -i "dinotty-server_${VERSION}-1_amd64.deb"
```

**Linux-Start**:

```bash
# systemd
systemctl start dinotty
systemctl enable dinotty  # Auto-Start beim Booten

# Docker-Container
nohup dinotty-server &
```

**Windows-Start**:

```powershell
# PowerShell
.\dinotty-server.exe -p 8999

# Optional: Default-Shell vor der Auto-Detection überschreiben
$env:DINOTTY_SHELL = "pwsh.exe"
.\dinotty-server.exe
```

Unter Windows wird die Default-Shell in dieser Reihenfolge erkannt: `DINOTTY_SHELL` -> `pwsh.exe` -> `powershell.exe` -> `%ComSpec%` / `cmd.exe`.

Default-Port ist **8999**. Öffne nach dem Start `http://<deine-ip>:8999`. Verwende `-p` für einen benutzerdefinierten Port:

```bash
dinotty-server -p 3000
```

## Schnellstart

```bash
# Repo klonen (Shallow Clone empfohlen - schneller und kleiner)
git clone --depth 1 --single-branch -b dev git@github.com:xichan96/dinotty.git
cd dinotty

# Frontend bauen
cd frontend && pnpm install && pnpm run build && cd ..

# Server starten
cargo run
```

Windows PowerShell Äquivalent:

```powershell
git clone --depth 1 --single-branch -b dev git@github.com:xichan96/dinotty.git
cd dinotty
cd frontend
pnpm install
pnpm run build
cd ..
cargo run
```

Öffne http://127.0.0.1:8999 in deinem Browser.

```bash
# Backend mit Debug-Logging
RUST_LOG=debug cargo run

# Frontend Type-Check
cd frontend && npx vue-tsc --noEmit
```

```powershell
# Windows PowerShell Debug-Logging
$env:RUST_LOG = "debug"
cargo run
```

## Tech-Stack

| Schicht | Technologie |
|-------|-----------|
| Backend | Rust, Axum 0.7, Tokio, portable-pty, vte, russh, russh-sftp |
| Frontend | Vue 3, TypeScript, Vite, xterm.js 5 |
| Desktop | Tauri |

**In Rust geschrieben · Single Binary · Zero Dependencies** - Führt eine vollständige VT-Zustandsmaschine auf dem Server aus, kein Pipe-Forwarding-Proxy, sodass Sessions Verbindungsabbruch überleben.

## Weitere Dokumentation

- [Vergleich](getting-started/comparison.en.md) - Unterschiede vs ttyd/gotty/Wetty und andere AI-Coding-Remote-Lösungen
- [Deployment-Guide](getting-started/deployment.en.md) - systemd, Docker, Windows-Native-Run, Cross-Platform-Build, Konfiguration
- [Release-Guide](getting-started/releasing.en.md) - einheitliches Versionsmanagement, Versions-PRs, `dev`-zu-`main`-Promotion, Tags und GitHub Releases
- [Datei-Editor](features/file-editor.en.md) - Pane-Aufteilung, Multi-Cursor-Editing, Cursor Group Cross-File-Sync
- [Benachrichtigungssystem](features/notifications.en.md) - HTTP API, Claude Code-Integration, Open API
- [Plugin-System](plugins/plugins.en.md) - Installation, Manifest, API, eingebaute Plugins
- [Plugin-Entwicklung](plugins/plugin-development.md) - vollständiger Plugin-Entwicklungs-Guide
- [Host-Zwischenablage-API](api/clipboard-api.md) - sensibler authentifizierter Endpoint für Mobile-Host-Paste
- [MCP Server](api/mcp-server.md) - eingebauter MCP JSON-RPC-Server für AI-Assistenten zum Operieren von Terminal-Sessions
- [Token-Berechtigungssystem](internals/token-system.md) - Capability-basierte Multi-Token-Fine-Grained-Access-Control
- [Event Bus](internals/event-bus.md) - globaler Event Bus für modulübergreifenden Event-Dispatch
- [Audit Log und Webhook](internals/audit-webhook.md) - API-Nutzungs-Tracking und externe Benachrichtigungen
- [Contributing](getting-started/contributing.en.md) - Branch-Strategie, Commit-Konvention, Code-Stil

## Mitwirkende

Danke an alle, die zu Dinotty beigetragen haben!

<a href="https://github.com/xichan96/dinotty/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=xichan96/dinotty" />
</a>

## Star History

![Star History](images/star-history.svg)

## Lizenz

MIT
