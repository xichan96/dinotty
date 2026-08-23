# Dinotty systemd Deployment Guide

## Default Configuration: Managed Service Terminal

After the deb install, Dinotty runs as a dedicated service user `dinotty` with the following hardening:

| Directive | Effect |
|-----------|--------|
| `User=dinotty` | Dedicated low-privilege account, isolated from host users |
| `ProtectSystem=strict` | Entire filesystem read-only (except explicit exceptions) |
| `ProtectHome=read-only` | `/home` readable but not writable |
| `NoNewPrivileges=true` | Blocks `sudo`, setuid, and other privilege escalation |
| `ReadWritePaths=/var/lib/dinotty /tmp` | Only the data directory and `/tmp` are writable |

Best for scenarios that require isolation: shared servers, teaching demos, ops jump hosts, etc.

## Personal Development Terminal

If you want Dinotty to act as your own development terminal (equivalent to SSH accessed through a browser), run it under your own user:

```bash
sudo systemctl edit dinotty.service
```

Write the following, replacing `<your-username>` with your Linux username:

```ini
[Service]
User=<your-username>
Group=<your-username>
ProtectHome=false
NoNewPrivileges=false
ReadWritePaths=/var/lib/dinotty /tmp /home/<your-username>
WorkingDirectory=/home/<your-username>
```

```bash
# Fix data directory ownership
sudo chown -R <your-username>:<your-username> /var/lib/dinotty

# Reload and restart
sudo systemctl daemon-reload
sudo systemctl restart dinotty.service
```

After this change, terminals inside Dinotty will:

- Return your username from `whoami`
- Load your own `~/.bashrc` and toolchains (nvm/rbenv/pyenv, etc.)
- Read/write project directories like `~/projects/...` directly
- Be able to `sudo` and install packages

### Security Note

In personal development terminal mode, the Dinotty web UI has full permissions of your account. If the service is exposed to the public internet:

1. **Set an auth token** — edit `/etc/dinotty/env` and set `DINOTTY_TOKEN=<strong-password>`
2. **Or restrict the listen address** — listen on `127.0.0.1` only and access via an SSH tunnel or reverse proxy

## Environment Variables

Edit `/etc/dinotty/env` (copy from the example on first use):

```bash
sudo cp /etc/dinotty/env.example /etc/dinotty/env
sudo vim /etc/dinotty/env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `DINOTTY_PORT` | `8999` | Service port |
| `DINOTTY_TOKEN` | (empty, auto-generated) | Auth token |
| `RUST_LOG` | `info` | Log level |
| `SHELL` | `/bin/bash` | Default shell |

## Common Commands

```bash
# Check service status
sudo systemctl status dinotty.service

# Follow logs
sudo journalctl -u dinotty.service -f

# Restart the service
sudo systemctl restart dinotty.service
```
