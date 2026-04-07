# Configuration

This add-on has no options in the Home Assistant UI. All configuration is done via a single `config.json` file placed in the add-on's own configuration directory.

## Config Directory

Place your `config.json` file in the following directory on your host:

```
/addon_configs/89e82855_xray/
```

> **Note:** This is **not** the main Home Assistant configuration folder (`/homeassistant/`). It is a separate per-add-on directory managed by the Supervisor.

### How to access the config directory

- **File editor add-on** — install [File editor](https://github.com/home-assistant/addons/tree/master/configurator) or Studio Code Server. Open it and navigate to `/addon_configs/89e82855_xray/`.
- **Samba / SMB share** — if you use the [Samba share](https://github.com/home-assistant/addons/tree/master/samba) add-on, enable the **addon_configs** share in its settings. The directory will be available on your network as `\\<HA_IP>\addon_configs\89e82855_xray\`.
- **SSH / Terminal** — connect via SSH or the Terminal add-on and work with the directory directly at `/addon_configs/89e82855_xray/`.

Create the directory and place your `config.json` file there before starting the add-on. If the add-on is already running without a config file, it will wait for the file to appear and then start `xray`.

## Config File Format

For detailed information on configuring Xray, please refer to the **[official Project X documentation](https://xtls.github.io/config/)**.

Standard `geoip.dat` and `geosite.dat` files are bundled with the add-on and can be used in your routing rules.

## Ports

The add-on exposes ports **4999–5011** (TCP and UDP). Map them in the **Network** tab of the add-on settings to match the local bound ports in your `config.json` (e.g., `"port": 5001` in your inbound configuration).
