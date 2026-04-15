# Configuration

Configuration is stored in `config.yaml`. Edit via the web UI (Settings panel) or directly by file.

## Config Location

```
/addon_configs/89e82855_proxy-monitor/config.yaml
```

A default config is created on first start. Access via File Editor, Samba (`addon_configs` share), or SSH.

## Proxy Options

| Option | Description |
|--------|-------------|
| `host`, `port` | Proxy server address |
| `username`, `password` | SOCKS5 authentication (optional) |
| `tcp_check` | Enable TCP check (default: true) |
| `udp_check` | Enable UDP relay check (default: false) |

## How Checks Work

- **TCP** – Connects through SOCKS5, requests test URL, reports latency and external IP.
- **UDP** – Sends DNS query through SOCKS5 UDP relay. For proxies supporting UDP.