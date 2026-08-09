<p align="center">
  <img src="images/logo.png" alt="Logo do Dinotty" width="200" />
</p>

<h1 align="center">Dinotty</h1>

<p align="center">
  <a href="https://github.com/xichan96/dinotty/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="Licença"></a>
  <img src="https://img.shields.io/badge/language-Rust-orange" alt="Rust">
  <img src="https://img.shields.io/badge/frontend-Vue%203-brightgreen" alt="Vue 3">
  <a href="https://github.com/xichan96/dinotty/stargazers"><img src="https://img.shields.io/github/stars/xichan96/dinotty?style=social" alt="Stars no GitHub"></a>
  <a href="https://github.com/xichan96/dinotty/releases"><img src="https://img.shields.io/github/downloads/xichan96/dinotty/total" alt="Downloads no GitHub"></a>
  <a href="https://github.com/xichan96/dinotty/issues"><img src="https://img.shields.io/github/issues/xichan96/dinotty" alt="Issues no GitHub"></a>
</p>

<p align="center">
  <a href="../README.md">中文</a> | <a href="./README.en.md">English</a> | <a href="./README.ru.md">Русский</a> | Português | <a href="./README.ko.md">한국어</a> | <a href="./README.es.md">Español</a> | <a href="./README.de.md">Deutsch</a> | <a href="./README.fr.md">Français</a>
</p>

---

Um terminal para agentes de código.

Rode Claude Code, opencode, Codex ou OpenClaw em qualquer dispositivo -- simples, extensível, multidispositivo, nunca perde uma sessão.

**Uma sessão no celular · iPad · desktop**

Pare no computador, continue no celular e volte ao desktop — tudo exatamente como estava. A sessão sobrevive a quedas de conexão e restaura ao atualizar a página.

**Tudo é um painel — monte seu terminal como blocos de montar**

Terminal, plugins, arquivos, SSH e visualização web são todos painéis. Arraste para montar o seu próprio espaço de trabalho.

## Screenshots

<p align="center">
  <img src="images/1.png" alt="Rodando Claude Code no celular" width="250" />
  <img src="images/2.png" alt="Layout completo de teclado com htop" width="250" />
  <img src="images/3.png" alt="Configurações de tema" width="250" />
</p>
<p align="center">
  <img src="images/4.png" alt="Teclado customizado de atalhos" width="250" />
  <img src="images/5.png" alt="Monitor do sistema" width="250" />
  <img src="images/6.png" alt="Sistema de notificações" width="250" />
</p>
<p align="center">
  <img src="images/7.png" alt="Tablet em paisagem com layout nível desktop" width="500" />
</p>

## Demo no desktop

O cliente desktop oferece uma experiência profissional comparável ao iTerm2:

**Split Broadcast** - Divisão multinpainel arrastável, digite em um painel e execute em todos simultaneamente:

<p align="center">
  <img src="images/gif/1-split-broadcast.gif" alt="Demo do Split Broadcast" width="600" />
</p>

**Bookmarks de comandos** - Clique direito no texto do terminal para favoritar, gestão de grupos, execução com um clique:

<p align="center">
  <img src="images/gif/2-command-bookmark.gif" alt="Demo dos bookmarks de comandos" width="600" />
</p>

**Conexão SSH e navegador de arquivos** - Cliente SSH embutido, sessões remotas parecem locais, gestão completa de arquivos SFTP:

<p align="center">
  <img src="images/gif/3-ssh-file-browser.gif" alt="Demo de conexão SSH e navegador de arquivos" width="600" />
</p>

**Gestão de workspaces e Mission Control** - Isolamento multi-workspace, visão geral do Mission Control, troca rápida:

<p align="center">
  <img src="images/gif/4-workspace-mission-control.gif" alt="Demo de gestão de workspaces" width="600" />
</p>

**Sistema de plugins** - Plugins JS com hot-reload, vem com CC Switch, JSON Formatter e mais:

<p align="center">
  <img src="images/gif/5-plugin.gif" alt="Demo do sistema de plugins" width="600" />
</p>

**Sistema unificado de layout** - Terminal, plugin, navegador de arquivos e pré-visualização web são todos painéis; divisão arrastável, movimentação entre abas, extração como nova aba:

<p align="center">
  <img src="images/gif/6-layout-sys.gif" alt="Demo do sistema unificado de layout" width="600" />
</p>

## Por que Dinotty?

Agentes de código baseados em terminal (Claude Code, opencode, Codex, OpenClaw, etc.) são poderosos, mas estão trancados dentro de uma única janela de terminal. O Dinotty permite que você:

- **Gerencie agentes de qualquer dispositivo** - trabalho profundo no desktop, escaneie um QR code no celular ao sair da mesa para continuar monitorando e gerenciando o trabalho do seu agente sem interrupção
- **Sync multidispositivo, troca sem interrupções** - comece no notebook, continue no celular; volte ao notebook e pegue exatamente de onde parou
- **Verifique a saída do agente diretamente** - diffs de código, páginas renderizadas, arquivos gerados, tudo visível no navegador embutido
- **Nunca perca sua sessão** - desconexão, tela bloqueada, troca de dispositivo - volte e tudo está exatamente onde você deixou

### Leve - não é desktop remoto

| | Dinotty | Desktop remoto (VNC/RDP/Parsec) |
|---|---|---|
| **Dados transmitidos** | Só texto (JSON, bytes) | Pixels completos da tela a 30-60 fps |
| **Largura de banda** | ~1–10 KB/s típico | ~1–10 MB/s (100–1000x mais) |
| **Amigável a dados móveis** | ✅ Funciona em 3G/4G sem lag | ❌ Travado, alta latência, consome dados |
| **Tolerância a sinal fraco** | ✅ Reconexão automática, sem perda de frames | ❌ Tela congelada, lag de entrada |
| **Consumo de bateria** | Baixo (renderização de texto) | Alto (decodificação de vídeo) |
| **Adaptação de resolução** | Texto nativo em qualquer tamanho | Bitmap escalado, borrado no celular |
| **Interação** | Touch nativo, teclado customizado | Mouse simulado, UI de desktop minúscula |

## Recursos principais

- **Terminal virtual no servidor** - parser VTE completo, servidor sabe o estado exato da tela, permite recuperação de sessão e snapshots de tela
- **Persistência de sessão** - processos PTY sobrevivem a desconexões, reconexão automática com backoff exponencial, atualize a página para restaurar
- **Divisão de painéis e multi-abas** - divisão arrastável, gestão multi-aba com ciclo de vida de painel liderado pelo servidor
- **Gestão de workspaces** - isolamento multi-workspace, visão geral do Mission Control, abas de plugin com escopo de workspace
- **Modo broadcast** - entrada em um painel, execução simultânea em todos os painéis, grátis
- **Bookmarks de comandos** - clique direito no texto do terminal para favoritar, gestão de grupos, execução com um clique
- **Conexão SSH remota** - cliente SSH embutido com auth por senha/chave, sessões remotas parecem locais
- **Gestão remota de arquivos (SFTP)** - ativada automaticamente em conexões SSH, navegação/edição/upload/download completo de arquivos
- **Lista de servidores** - gerencie múltiplos servidores remotos, troca rápida de conexão
- **Layout responsivo** - retrato empilha verticalmente, paisagem lado a lado; botões otimizados para touch e redimensionamento de painéis
- **Teclado customizável de atalhos** - adicione Ctrl/Esc/teclas de função para mobile, suporta sequências escape arbitrárias
- **Navegador de arquivos embutido** - highlight de código, renderização Markdown, pré-visualização de documentos Office, reprodução de áudio/vídeo
- **Indicadores de mudanças Git** - marcas na gutter para linhas adicionadas/modificadas/removidas, diff inline, Stage/Revert
- **Pré-visualização web** - reverse proxy embutido para pré-visualizar dev servers locais em iframe
- **Sistema de notificações** - detecção de terminal bell/OSC, push via WebSocket, alertas sonoros configuráveis
- **Monitor do sistema** - gráficos em tempo real de CPU/memória/rede
- **Sistema de plugins** - plugins JS + ponte CLI, hot-reload; vem com CC Switch, JSON Formatter, gerenciador de conversas Claude Code, etc.
- **Open API** - endpoint HTTP para controle de dispositivos externos (Stream Deck, Shortcuts, scripts de automação)
- **Paleta de comandos** - launcher de comandos de acesso rápido
- **App de desktop** - cliente nativo opcional baseado em Tauri

## Diferenciadores principais

- **Terminal virtual no servidor** - não é um pipe WebSocket-para-PTY; PTY sobrevive a desconexão, atualize a página para restaurar a sessão
- **Sync multidispositivo** - sync baseado em navegador, trabalho profundo no desktop, assuma o controle do mobile
- **Transporte leve só de texto** - ~1-10 KB/s, fluido em 3G/4G, 100-1000x menos largura de banda que desktop remoto
- **Ambiente autossuficiente** - navegador de arquivos embutido, pré-visualização web, mudanças Git, SSH/SFTP, sistema de plugins
- **Grátis e open source** - auto-hospedado, sem assinatura, sem taxas de relay

Veja [comparação com outras soluções](getting-started/comparison.en.md) para detalhes.

## Instalação

Baixe o instalador ou binário para sua plataforma no [GitHub Releases](https://github.com/xichan96/dinotty/releases):

| Plataforma | Formato | Notas |
|----------|--------|-------|
| **macOS** | `.dmg` | Abra e arraste para Applications |
| **Linux** | `.deb` | `sudo dpkg -i dinotty_*.deb` |
| **Windows** | `.exe` / build da fonte | Rode `dinotty-server.exe` pelo PowerShell, ou compile da fonte |

> Você também pode compilar da fonte, veja "Início rápido" abaixo.

**Nota para macOS**: Como o app não é assinado, o macOS pode mostrar **"Dinotty" está danificado e não pode ser aberto**. Rode o seguinte comando após a instalação para remover a restrição:

```bash
xattr -cr /Applications/Dinotty.app
```

**Instalação de uma linha no Linux**:

```bash
VERSION=$(curl -s https://api.github.com/repos/xichan96/dinotty/releases/latest | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | sed 's/^v//') && curl -LO "https://github.com/xichan96/dinotty/releases/download/v${VERSION}/dinotty-server_${VERSION}-1_amd64.deb" && sudo dpkg -i "dinotty-server_${VERSION}-1_amd64.deb"
```

**Início no Linux**:

```bash
# systemd
systemctl start dinotty
systemctl enable dinotty  # auto-iniciar no boot

# Container Docker
nohup dinotty-server &
```

**Início no Windows**:

```powershell
# PowerShell
.\dinotty-server.exe -p 8999

# Opcional: sobrescrever o shell padrão antes da autodetecção
$env:DINOTTY_SHELL = "pwsh.exe"
.\dinotty-server.exe
```

No Windows, o shell padrão é detectado nesta ordem: `DINOTTY_SHELL` -> `pwsh.exe` -> `powershell.exe` -> `%ComSpec%` / `cmd.exe`.

A porta padrão é **8999**. Após iniciar, visite `http://<seu-ip>:8999`. Use `-p` para especificar uma porta customizada:

```bash
dinotty-server -p 3000
```

## Início rápido

```bash
# Clonar repositório (shallow clone recomendado - mais rápido e menor)
git clone --depth 1 --single-branch -b dev git@github.com:xichan96/dinotty.git
cd dinotty

# Build do frontend
cd frontend && pnpm install && pnpm run build && cd ..

# Rodar servidor
cargo run
```

Equivalente no Windows PowerShell:

```powershell
git clone --depth 1 --single-branch -b dev git@github.com:xichan96/dinotty.git
cd dinotty
cd frontend
pnpm install
pnpm run build
cd ..
cargo run
```

Abra http://127.0.0.1:8999 no seu navegador.

```bash
# Backend com log de depuração
RUST_LOG=debug cargo run

# Type-check do frontend
cd frontend && npx vue-tsc --noEmit
```

```powershell
# Log de depuração no Windows PowerShell
$env:RUST_LOG = "debug"
cargo run
```

## Stack tecnológico

| Camada | Tecnologia |
|-------|-----------|
| Backend | Rust, Axum 0.7, Tokio, portable-pty, vte, russh, russh-sftp |
| Frontend | Vue 3, TypeScript, Vite, xterm.js 5 |
| Desktop | Tauri |

**Escrito em Rust · Binário único · Zero dependências** - Roda uma máquina de estados VT completa no servidor, não um proxy de encaminhamento de pipes, então sessões sobrevivem a desconexões.

## Mais documentação

- [Comparação](getting-started/comparison.en.md) - diferenças vs ttyd/gotty/Wetty e outras soluções remotas de AI coding
- [Guia de deploy](getting-started/deployment.en.md) - systemd, Docker, execução nativa no Windows, build multiplataforma, configuração
- [Guia de release](getting-started/releasing.en.md) - gestão unificada de versões, PRs de versão, promoção de `dev` para `main`, tags e GitHub Releases
- [Editor de arquivos](features/file-editor.en.md) - painéis divididos, edição multicursor, sincronização cross-file do Cursor Group
- [Sistema de notificações](features/notifications.en.md) - HTTP API, integração com Claude Code, Open API
- [Sistema de plugins](plugins/plugins.en.md) - instalação, manifest, API, plugins embutidos
- [Desenvolvimento de plugins](plugins/plugin-development.md) - guia completo de desenvolvimento de plugins
- [API de clipboard do host](api/clipboard-api.md) - endpoint sensível autenticado usado pelo paste de host mobile
- [MCP Server](api/mcp-server.md) - servidor MCP JSON-RPC embutido para assistentes IA operarem sessões de terminal
- [Sistema de permissões por token](internals/token-system.md) - controle de acesso fine-grained multi-token baseado em capabilities
- [Event Bus](internals/event-bus.md) - barramento de eventos global para dispatch entre módulos
- [Audit Log e Webhook](internals/audit-webhook.md) - rastreamento de uso de API e notificações externas
- [Contribuindo](getting-started/contributing.en.md) - estratégia de branches, convenção de commits, estilo de código

## Contribuidores

Obrigado a todas as pessoas que contribuíram para o Dinotty!

<a href="https://github.com/xichan96/dinotty/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=xichan96/dinotty" />
</a>

## Star History

![Star History](images/star-history.svg)

## Licença

MIT
