<p align="center">
  <img src="images/logo.png" alt="Logo de Dinotty" width="200" />
</p>

<h1 align="center">Dinotty</h1>

<p align="center">
  <a href="https://github.com/xichan96/dinotty/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="Licence"></a>
  <img src="https://img.shields.io/badge/language-Rust-orange" alt="Rust">
  <img src="https://img.shields.io/badge/frontend-Vue%203-brightgreen" alt="Vue 3">
  <a href="https://github.com/xichan96/dinotty/stargazers"><img src="https://img.shields.io/github/stars/xichan96/dinotty?style=social" alt="Étoiles GitHub"></a>
  <a href="https://github.com/xichan96/dinotty/releases"><img src="https://img.shields.io/github/downloads/xichan96/dinotty/total" alt="Téléchargements GitHub"></a>
  <a href="https://github.com/xichan96/dinotty/issues"><img src="https://img.shields.io/github/issues/xichan96/dinotty" alt="Issues GitHub"></a>
</p>

<p align="center">
  <a href="../README.md">中文</a> | <a href="./README.en.md">English</a> | <a href="./README.ru.md">Русский</a> | <a href="./README.pt.md">Português</a> | <a href="./README.ko.md">한국어</a> | <a href="./README.es.md">Español</a> | <a href="./README.de.md">Deutsch</a> | Français
</p>

---

Un terminal pour agents de code.

Lancez Claude Code, opencode, Codex ou OpenClaw sur n'importe quel appareil -- simple, extensible, multi-appareils, ne perd jamais une session.

**Une seule session sur mobile · iPad · bureau**

Commencez sur l'ordinateur, continuez sur le téléphone, revenez au bureau — tout est exactement là où vous l'aviez laissé. La session survit aux déconnexions et se restaure au rechargement de la page.

**Tout est un panneau — assemblez votre terminal comme des blocs**

Terminal, plugins, fichiers, SSH et aperçu web sont tous des panneaux. Faites glisser pour composer votre propre espace de travail.

## Captures d'écran

<p align="center">
  <img src="images/1.png" alt="Claude Code sur mobile" width="250" />
  <img src="images/2.png" alt="Disposition clavier complète avec htop" width="250" />
  <img src="images/3.png" alt="Paramètres de thème" width="250" />
</p>
<p align="center">
  <img src="images/4.png" alt="Clavier de raccourcis personnalisé" width="250" />
  <img src="images/5.png" alt="Moniteur système" width="250" />
  <img src="images/6.png" alt="Système de notifications" width="250" />
</p>
<p align="center">
  <img src="images/7.png" alt="Tablette en paysage avec disposition niveau desktop" width="500" />
</p>

## Démo desktop

Le client desktop offre une expérience professionnelle comparable à iTerm2 :

**Split Broadcast** - Division multi-panneaux déplaçable, tapez dans un panneau et exécutez dans tous simultanément :

<p align="center">
  <img src="images/gif/1-split-broadcast.gif" alt="Démo Split Broadcast" width="600" />
</p>

**Marque-pages de commandes** - Clic droit sur le texte du terminal pour marquer, gestion de groupes, exécution en un clic :

<p align="center">
  <img src="images/gif/2-command-bookmark.gif" alt="Démo marque-pages de commandes" width="600" />
</p>

**Connexion SSH et navigateur de fichiers** - Client SSH intégré, sessions distantes comme en local, gestion complète des fichiers SFTP :

<p align="center">
  <img src="images/gif/3-ssh-file-browser.gif" alt="Démo connexion SSH et navigateur de fichiers" width="600" />
</p>

**Gestion des workspaces et Mission Control** - Isolation multi-workspace, vue d'ensemble Mission Control, bascule rapide :

<p align="center">
  <img src="images/gif/4-workspace-mission-control.gif" alt="Démo gestion des workspaces" width="600" />
</p>

**Système de plugins** - Plugins JS hot-reloadable, inclut CC Switch, JSON Formatter et plus :

<p align="center">
  <img src="images/gif/5-plugin.gif" alt="Démo système de plugins" width="600" />
</p>

**Système de layout unifié** - Terminal, plugin, navigateur de fichiers et aperçu web sont tous des panneaux ; division déplaçable, déplacement inter-onglets, extraction comme nouvel onglet :

<p align="center">
  <img src="images/gif/6-layout-sys.gif" alt="Démo système de layout unifié" width="600" />
</p>

## Pourquoi Dinotty ?

Les agents de code basés sur terminal (Claude Code, opencode, Codex, OpenClaw, etc.) sont puissants, mais enfermés dans une seule fenêtre de terminal. Dinotty vous permet de :

- **Gérer les agents depuis n'importe quel appareil** - travail approfondi sur desktop, scannez un QR code sur votre mobile en quittant votre bureau pour continuer à surveiller et gérer le travail de votre agent sans interruption
- **Sync multi-appareils, bascule sans interruption** - commencez sur le laptop, continuez sur le mobile ; retournez au laptop et reprenez exactement où vous étiez
- **Vérifier la sortie de l'agent directement** - diffs de code, pages rendues, fichiers générés, tout visible dans le navigateur intégré
- **Ne perdez jamais votre session** - déconnexion, verrouillage d'écran, changement d'appareil - revenez et tout est exactement où vous l'avez laissé

### Léger - pas un bureau distant

| | Dinotty | Bureau distant (VNC/RDP/Parsec) |
|---|---|---|
| **Données transmises** | Texte uniquement (JSON, octets) | Pixels complets de l'écran à 30-60 fps |
| **Bande passante** | ~1–10 KB/s typique | ~1–10 MB/s (100–1000x plus) |
| **Compatible données mobiles** | ✅ Fonctionne sur 3G/4G sans lag | ❌ Saccadé, latence élevée, consomme des données |
| **Tolérance au signal faible** | ✅ Reconnexion auto, sans perte de frames | ❌ Écran figé, lag d'entrée |
| **Consommation batterie** | Faible (rendu texte) | Élevée (décodage vidéo) |
| **Adaptation résolution** | Texte natif à toute taille | Bitmap mis à l'échelle, flou sur mobile |
| **Interaction** | Touch natif, clavier personnalisé | Souris simulée, UI desktop minuscule |

## Fonctionnalités principales

- **Terminal virtuel côté serveur** - parser VTE complet, le serveur connaît l'état exact de l'écran, permet la récupération de session et les instantanés d'écran
- **Persistance de session** - les processus PTY survivent à la déconnexion, reconnexion auto avec backoff exponentiel, rafraîchir la page pour restaurer
- **Division de panneaux et multi-onglets** - division déplaçable, gestion multi-onglets avec cycle de vie des panneaux piloté par le serveur
- **Gestion des workspaces** - isolation multi-workspace, vue d'ensemble Mission Control, onglets de plugin à portée workspace
- **Mode broadcast** - entrée dans un panneau, exécution simultanée dans tous les panneaux, gratuit
- **Marque-pages de commandes** - clic droit sur le texte du terminal pour marquer, gestion de groupes, exécution en un clic
- **Connexion SSH distante** - client SSH intégré avec auth par mot de passe/clé, sessions distantes comme en local
- **Gestion distante des fichiers (SFTP)** - activée automatiquement sur les connexions SSH, navigation/édition/upload/download complet des fichiers
- **Liste de serveurs** - gérer plusieurs serveurs distants, bascule rapide de connexion
- **Layout responsive** - portrait empile verticalement, paysage côte à côte ; boutons optimisés touch et redimensionnement des panneaux
- **Clavier de raccourcis personnalisable** - ajoutez Ctrl/Esc/touches de fonction pour mobile, supporte des séquences escape arbitraires
- **Navigateur de fichiers intégré** - coloration syntaxique, rendu Markdown, aperçu de documents Office, lecture audio/vidéo
- **Indicateurs de changements Git** - marques de gouttière pour lignes ajoutées/modifiées/supprimées, diff inline, Stage/Revert
- **Aperçu web** - reverse proxy intégré pour prévisualiser les dev servers locaux en iframe
- **Système de notifications** - détection terminal bell/OSC, push via WebSocket, alertes sonores configurables
- **Moniteur système** - graphiques temps réel CPU/mémoire/réseau
- **Système de plugins** - plugins JS + pont CLI, hot-reload ; livré avec CC Switch, JSON Formatter, gestionnaire de conversations Claude Code, etc.
- **Open API** - endpoint HTTP pour contrôle par appareils externes (Stream Deck, Shortcuts, scripts d'automatisation)
- **Palette de commandes** - lanceur de commandes à accès rapide
- **App desktop** - client natif optionnel basé sur Tauri

## Différenciateurs clés

- **Terminal virtuel côté serveur** - pas un pipe WebSocket-vers-PTY ; le PTY survit à la déconnexion, rafraîchir la page pour restaurer la session
- **Sync multi-appareils** - sync basée navigateur, travail approfondi sur desktop, prise de contrôle depuis le mobile
- **Transport léger texte uniquement** - ~1-10 KB/s, fluide sur 3G/4G, 100-1000x moins de bande passante que le bureau distant
- **Environnement autonome** - navigateur de fichiers intégré, aperçu web, changements Git, SSH/SFTP, système de plugins
- **Gratuit et open source** - auto-hébergé, sans abonnement, sans frais de relais

Voir [comparaison avec d'autres solutions](getting-started/comparison.en.md) pour plus de détails.

## Installation

Téléchargez l'installateur ou le binaire pour votre plateforme depuis [GitHub Releases](https://github.com/xichan96/dinotty/releases) :

| Plateforme | Format | Notes |
|----------|--------|-------|
| **macOS** | `.dmg` | Ouvrir et glisser dans Applications |
| **Linux** | `.deb` | `sudo dpkg -i dinotty_*.deb` |
| **Windows** | `.exe` / build depuis source | Lancez `dinotty-server.exe` depuis PowerShell, ou compilez depuis source |

> Vous pouvez aussi compiler depuis source, voir « Démarrage rapide » ci-dessous.

**Note macOS** : L'app n'étant pas signée, macOS peut afficher **« Dinotty » est endommagé et ne peut pas être ouvert**. Exécutez la commande suivante après l'installation pour lever la restriction :

```bash
xattr -cr /Applications/Dinotty.app
```

**Installation Linux en une ligne** :

```bash
VERSION=$(curl -s https://api.github.com/repos/xichan96/dinotty/releases/latest | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | sed 's/^v//') && curl -LO "https://github.com/xichan96/dinotty/releases/download/v${VERSION}/dinotty-server_${VERSION}-1_amd64.deb" && sudo dpkg -i "dinotty-server_${VERSION}-1_amd64.deb"
```

**Démarrage Linux** :

```bash
# systemd
systemctl start dinotty
systemctl enable dinotty  # auto-démarrage au boot

# Conteneur Docker
nohup dinotty-server &
```

**Démarrage Windows** :

```powershell
# PowerShell
.\dinotty-server.exe -p 8999

# Optionnel : surcharger le shell par défaut avant l'auto-détection
$env:DINOTTY_SHELL = "pwsh.exe"
.\dinotty-server.exe
```

Sur Windows, le shell par défaut est détecté dans cet ordre : `DINOTTY_SHELL` -> `pwsh.exe` -> `powershell.exe` -> `%ComSpec%` / `cmd.exe`.

Le port par défaut est **8999**. Après démarrage, visitez `http://<votre-ip>:8999`. Utilisez `-p` pour spécifier un port personnalisé :

```bash
dinotty-server -p 3000
```

## Démarrage rapide

```bash
# Cloner le repo (shallow clone recommandé - plus rapide et plus petit)
git clone --depth 1 --single-branch -b dev git@github.com:xichan96/dinotty.git
cd dinotty

# Build du frontend
cd frontend && pnpm install && pnpm run build && cd ..

# Lancer le serveur
cargo run
```

Équivalent Windows PowerShell :

```powershell
git clone --depth 1 --single-branch -b dev git@github.com:xichan96/dinotty.git
cd dinotty
cd frontend
pnpm install
pnpm run build
cd ..
cargo run
```

Ouvrez http://127.0.0.1:8999 dans votre navigateur.

```bash
# Backend avec logging debug
RUST_LOG=debug cargo run

# Type-check du frontend
cd frontend && npx vue-tsc --noEmit
```

```powershell
# Logging debug Windows PowerShell
$env:RUST_LOG = "debug"
cargo run
```

## Stack technique

| Couche | Technologie |
|-------|-----------|
| Backend | Rust, Axum 0.7, Tokio, portable-pty, vte, russh, russh-sftp |
| Frontend | Vue 3, TypeScript, Vite, xterm.js 5 |
| Desktop | Tauri |

**Écrit en Rust · Binaire unique · Zéro dépendance** - Exécute une machine d'états VT complète sur le serveur, pas un proxy de transfert de pipes, donc les sessions survivent à la déconnexion.

## Plus de documentation

- [Comparaison](getting-started/comparison.en.md) - différences vs ttyd/gotty/Wetty et autres solutions remote de AI coding
- [Guide de déploiement](getting-started/deployment.en.md) - systemd, Docker, exécution native Windows, build cross-platform, configuration
- [Guide de release](getting-started/releasing.en.md) - gestion unifiée des versions, PRs de version, promotion `dev` vers `main`, tags et GitHub Releases
- [Éditeur de fichiers](features/file-editor.en.md) - panneaux divisés, édition multi-curseur, sync cross-file de Cursor Group
- [Système de notifications](features/notifications.en.md) - HTTP API, intégration Claude Code, Open API
- [Système de plugins](plugins/plugins.en.md) - installation, manifeste, API, plugins intégrés
- [Développement de plugins](plugins/plugin-development.md) - guide complet de développement de plugins
- [API presse-papiers hôte](api/clipboard-api.md) - endpoint sensible authentifié utilisé par le paste hôte mobile
- [MCP Server](api/mcp-server.md) - serveur MCP JSON-RPC intégré pour que les assistants IA opèrent des sessions terminal
- [Système de permissions par token](internals/token-system.md) - contrôle d'accès fine-grained multi-token basé sur capabilities
- [Event Bus](internals/event-bus.md) - bus d'événements global pour le dispatch inter-modules
- [Audit Log et Webhook](internals/audit-webhook.md) - tracking d'usage API et notifications externes
- [Contribuer](getting-started/contributing.en.md) - stratégie de branches, convention de commits, style de code

## Contributeurs

Merci à toutes les personnes qui ont contribué à Dinotty !

<a href="https://github.com/xichan96/dinotty/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=xichan96/dinotty" />
</a>

## Star History

![Star History](images/star-history.svg)

## Licence

MIT
