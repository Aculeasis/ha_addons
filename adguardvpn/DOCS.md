# AdguardVPN

A Home Assistant add-on that wraps AdGuard VPN CLI to provide a SOCKS5 proxy. Route traffic through AdGuard VPN servers for privacy and geo-location access.

## Setup

1. Install → Set mode to `login` → Start
2. Open logs, copy the authorization link
3. Open the link in browser and login
4. Wait a few minutes for authorization to complete
5. Set mode to `normal` → Restart
6. Proxy ready at `YOUR_HA_IP:15554`

> ⚠️ **Note**: If you used AdGuard User/Pass for login, remove credentials after successful authentication. Account credentials login is deprecated and may be removed in the future.

## Proxy Access

| Access | Address |
|--------|---------|
| External | `socks5://user:user@YOUR_HA_IP:15554` |
| Inside HAOS | `socks5://user:user@89e82855_adguardvpn:15554` |

Replace `user:user` with your configured SOCKS credentials.

## Configuration

### Mode
| Value | Description |
|-------|-------------|
| `normal` | Connect to VPN |
| `login` | Authenticate account |
| `logout` | Log out |
| `locations` | Show available locations |
| `reinstall` | Reinstall CLI binary |

### Location
VPN server: city (`Amsterdam`), country (`Netherlands`), ISO (`NL`), or `fastest`.

### Credentials
- **AdGuard User/Pass** — Deprecated. Browser login recommended.
- **SOCKS User/Pass** — Proxy authentication (required)

### Other Settings
| Setting | Default | Description |
|---------|---------|-------------|
| SOCKS Port | 15554 | Proxy port |
| Version | latest | CLI version (e.g., `1.6.24-release`, `1.7.15-nightly`, `1.6.26-beta`) |
| Crash Reports | false | Send to AdGuard |
| Telemetry | false | Send to AdGuard |
| Show Connect Progress | false | Show connection progress in logs |
| Log Max Size | 10 | Max log file size (KB) before truncation |

## Manual CLI Installation

To install a specific CLI version manually:

1. Download desired version from [AdGuardVPNCLI releases](https://github.com/AdguardTeam/AdGuardVPNCLI/releases)
2. Copy `adguardvpn-cli` binary to `/addon_configs/89e82855_adguardvpn/`
3. Restart the add-on

The add-on config directory also contains logs and other data files.

## Watchdog

Auto-restarts VPN if proxy becomes unresponsive.

| Setting | Default | Description |
|---------|---------|-------------|
| Enabled | false | Enable watchdog |
| Check Interval | 30s | Health check frequency |
| Failure Threshold | 6 | Failures before restart |
| Pause After Restart | 30m | Cooldown period |
| Test URL | http://1.1.1.1 | URL for connection test |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Not logged in | Mode → `login` |
| Won't connect | Check logs, try different location |
| Proxy inaccessible | Check firewall, port mapping |
| Watchdog loops | Increase threshold/pause |