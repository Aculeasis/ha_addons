# Configuration

This Home Assistant add-on runs Privoxy, a non-caching web proxy with advanced filtering capabilities. It can block ads, manage cookies, modify HTTP headers, and filter web traffic for privacy enhancement.

The add-on has no options in the Home Assistant UI. All configuration is done via Privoxy configuration files placed in the add-on's own configuration directory.

## Config Directory

The add-on stores its configuration in the following directory on your host:

```
/addon_configs/89e82855_privoxy/
```

> **Note:** This is **not** the main Home Assistant configuration folder (`/homeassistant/`). It is a separate per-add-on directory managed by the Supervisor.

### How to access the config directory

- **File editor add-on** — install [File editor](https://github.com/home-assistant/addons/tree/master/configurator) or Studio Code Server. Open it and navigate to `/addon_configs/89e82855_privoxy/`.
- **Samba / SMB share** — if you use the [Samba share](https://github.com/home-assistant/addons/tree/master/samba) add-on, enable the **addon_configs** share in its settings. The directory will be available on your network as `\\<HA_IP>\addon_configs\89e82855_privoxy\`.
- **SSH / Terminal** — connect via SSH or the Terminal add-on and work with the directory directly at `/addon_configs/89e82855_privoxy/`.

## First Start

On first start, if the configuration directory is empty, the add-on automatically copies the default Privoxy configuration files from `/etc/privoxy/` to `/config/` (which maps to `/addon_configs/89e82855_privoxy/` on the host). The `listen-address` is also changed from `127.0.0.1` to `0.0.0.0` so the proxy is accessible from the host network.

You can then customize the configuration files to your needs. The main configuration file is `config`.

After making changes, restart the add-on for them to take effect.

## Config File Format

For detailed information on configuring Privoxy, please refer to the **[official Privoxy documentation](https://www.privoxy.org/user-manual/)**.

## Ports

The add-on exposes port **8118** (TCP). This is the default Privoxy HTTP proxy port. Map it in the **Network** tab of the add-on settings if you need to change the host-side port.