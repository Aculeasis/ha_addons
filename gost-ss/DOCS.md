# Configuration

This Home Assistant add-on runs [Shadowsocks-libev](https://github.com/shadowsocks/shadowsocks-libev) and [GOST v3](https://gost.run/) proxy instances based on config files you provide. No add-on options needed — just drop your config files and start.


## Config Directory

Place your config files in the following directory on your host:

```
/addon_configs/89e82855_gost-ss/
```

> **Note:** This is **not** the main Home Assistant configuration folder (`/homeassistant/`). It is a separate per-add-on directory managed by the Supervisor.

### How to access the config directory

- **File editor add-on** — install [File editor](https://github.com/home-assistant/addons/tree/master/configurator) or Studio Code Server. Open it and navigate to `/addon_configs/89e82855_gost-ss/`.
- **Samba / SMB share** — if you use the [Samba share](https://github.com/home-assistant/addons/tree/master/samba) add-on, enable the **addon_configs** share in its settings. The directory will be available on your network as `\\<HA_IP>\addon_configs\89e82855_gost-ss\`.
- **SSH / Terminal** — connect via SSH or the Terminal add-on and work with the directory directly at `/addon_configs/89e82855_gost-ss/`.

Create the directory and place your config files there before starting the add-on.

## File Naming

The add-on determines what proxy daemon to launch based on the file extension and naming pattern:

### Shadowsocks (JSON)

Each JSON file must follow this naming pattern:

```
<type>-<name>.json
```

- **`<type>`** — the shadowsocks binary to run: `local`, `server`, `redir`, or `tunnel`
- **`<name>`** — a label for the instance, used as a log prefix; can contain dashes

Files with an unrecognized `<type>` are skipped with an error message.

| Filename              | Binary launched | Log prefix    |
|-----------------------|-----------------|---------------|
| `local-proxy.json`    | `ss-local`      | `[proxy]`     |
| `server-home.json`    | `ss-server`     | `[home]`      |
| `local-work-vpn.json` | `ss-local`      | `[work-vpn]`  |
| `tunnel-dns.json`     | `ss-tunnel`     | `[dns]`       |

### GOST (YAML)

Any YAML configuration files placed in the directory are automatically run via `gost`:

```
<name>.yaml
```
or `<name>.yml`

- **`<name>`** — a label for the instance, used as a log prefix; can contain dashes

| Filename              | Binary launched | Log prefix    |
|-----------------------|-----------------|---------------|
| `gost-tunnel.yaml`    | `gost`          | `[gost-tunnel]`|

## Config File Format

### Shadowsocks

Standard shadowsocks-libev JSON. Example for a client (`ss-local`):

```json
{
    "server": "your.ss.server.com",
    "server_port": 8388,
    "local_address": "0.0.0.0",
    "local_port": 5001,
    "password": "your_password",
    "method": "chacha20-ietf-poly1305",
    "timeout": 300,
    "fast_open": false
}
```

Example for a server (`ss-server`):

```json
{
    "server": "0.0.0.0",
    "server_port": 5002,
    "password": "your_password",
    "method": "aes-256-gcm",
    "timeout": 300,
    "fast_open": false
}
```

### GOST

Standard GOST V3 YAML configuration. Example for a simple proxy client:

```yaml
services:
  - name: service-0
    addr: :5003
    handler:
      type: http
    listener:
      type: tcp
    forwarder:
      nodes:
        - name: target-0
          addr: target.server.com:8443
          connector:
            type: http
          dialer:
            type: tcp
```

## Ports

The add-on exposes ports **4999–5011** (TCP and UDP). Map them in the **Network** tab of the add-on settings to match the local bound ports in your config files (e.g. `local_port` for SS or `addr: :<port>` for GOST).

Each instance must use a unique port.
